#!/usr/bin/env bash
# Testes negativos de segurança contra o endpoint dev. Nada destrutivo além do que o script cria e remove.
set -euo pipefail
SCRIPT_NAME=security
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BURST=0 BLOCKED_IP=0 EXPECT_THROTTLE=0
usage() {
  cat <<'EOF'
Uso: security.sh [--local] [--burst N] [--expect-throttle] [--blocked-ip]

  --burst N          dispara N requisições GET /health (paralelismo MIUPY_BURST_PARALLEL, padrão 50)
                     para observar 429; sem 429 é AVISO, ou FALHA com --expect-throttle
  --expect-throttle  exige ao menos um 429 na rajada (use após configurar throttling no stage)
  --blocked-ip       modo "IP fora da allowlist": rode de OUTRA rede; /v1 deve responder 403
  --local            API local (harness em 127.0.0.1); pula verificações exclusivas do API Gateway

Variáveis opcionais (cada uma habilita testes adicionais; veja docs/validacao/aws-dev.md):
  MIUPY_ID_TOKEN[_FILE]                 token do proprietário (obrigatório)
  MIUPY_ID_TOKEN_NAO_PERMITIDO[_FILE]   token válido de um sub FORA da allowlist → 403
  MIUPY_ID_TOKEN_B[_FILE]               token válido de um 2º sub DENTRO da allowlist → isolamento 404
  MIUPY_ID_TOKEN_EXPIRADO[_FILE]        token real do Google já expirado (reuse um token antigo) → 401
  MIUPY_ID_TOKEN_AUD_ERRADA[_FILE]      token real de outro client OAuth → 401
  MIUPY_ALLOWED_ORIGIN                  origem CORS permitida (ex.: http://tauri.localhost)
  MIUPY_EVIL_ORIGIN                     origem não listada (padrão https://evil.example)
EOF
}
while (($#)); do
  case "$1" in
    --local) LOCAL=1 ;;
    --burst) BURST="${2:-}"; [[ "$BURST" =~ ^[0-9]+$ ]] || die "--burst exige um número"; shift ;;
    --expect-throttle) EXPECT_THROTTLE=1 ;;
    --blocked-ip) BLOCKED_IP=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "argumento desconhecido: $1" ;;
  esac
  shift
done

# O modo de IP bloqueado grava registro próprio para não sobrescrever last-security.tsv.
((BLOCKED_IP)) && SCRIPT_NAME=security-ip
init_api
EVIL_ORIGIN="${MIUPY_EVIL_ORIGIN:-https://evil.example}"

# ---------- IP fora da allowlist ----------
if ((BLOCKED_IP)); then
  section "IP fora da allowlist (este script deve estar rodando de outra rede)"
  CASE=ip.health; api GET /health
  info "GET /health de IP bloqueado: HTTP $STATUS ($(ids_text)) — informativo (a allowlist pode ou não cobrir /health)"
  CASE=ip.notes; api GET /v1/notes?limit=1 -k main
  expect "GET /v1/notes com token válido, de IP não permitido" 403
  expect_json "erro FORBIDDEN com requestId" '.error.code == "FORBIDDEN" and (.error.requestId | type == "string")'
  CASE=ip.notes-no-token; api GET /v1/notes?limit=1
  info "GET /v1/notes sem token de IP bloqueado: HTTP $STATUS (o JWT authorizer recusa antes da Lambda; informativo)"
  summary
  exit $?
fi

# ---------- Autenticação ----------
section "Autenticação (todas devem resultar em 401)"
CASE=auth.no-token; api GET /v1/notes
expect "sem Authorization" 401
CASE=auth.empty-bearer; api GET /v1/notes -H 'Authorization: Bearer '
expect "Bearer vazio" 401
CASE=auth.malformed; api GET /v1/notes -H 'Authorization: Bearer abc'
expect "token malformado (não é JWT)" 401
CASE=auth.extra-part; api GET /v1/notes -H 'Authorization: Bearer x extra'
expect "'Bearer x extra' (partes a mais)" 401
CASE=auth.basic; api GET /v1/notes -H 'Authorization: Basic dXNlcjpwYXNz'
expect "esquema Basic" 401

# JWT sintético: cabeçalho e payload válidos, assinatura inventada (nunca é aceito).
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
forge_jwt() { # $1 = exp relativo em segundos, $2 = aud
  local now header payload
  now="$(date +%s)"
  header="$(printf '{"alg":"RS256","typ":"JWT","kid":"invalido"}' | b64url)"
  payload="$(jq -cn --argjson exp $((now + $1)) --argjson iat $((now - 7200)) --arg aud "$2" '{iss: "https://accounts.google.com", aud: $aud, sub: "0", exp: $exp, iat: $iat}' | b64url)"
  printf '%s.%s.%s' "$header" "$payload" "$(printf 'assinatura-falsa' | b64url)"
}
FORGED_EXPIRED="$(forge_jwt -3600 x.apps.googleusercontent.com)"
FORGED_AUD="$(forge_jwt 3600 outro-client.apps.googleusercontent.com)"
printf 'Authorization: Bearer %s\n' "$FORGED_EXPIRED" >"$WORK/auth.forged-expired"
printf 'Authorization: Bearer %s\n' "$FORGED_AUD" >"$WORK/auth.forged-aud"
CASE=auth.forged-bad-signature; api GET /v1/notes -k forged-aud
expect "JWT com assinatura inválida" 401
CASE=auth.forged-expired; api GET /v1/notes -k forged-expired
expect "JWT sintético expirado" 401
info "JWTs sintéticos falham primeiro pela assinatura; exp e aud específicos só são provados pelos tokens reais abaixo."

if token_available expired; then
  load_token expired
  CASE=auth.expired-real; api GET /v1/notes -k expired
  expect "token real do Google, já expirado" 401
else
  skip "token real expirado" "defina MIUPY_ID_TOKEN_EXPIRADO[_FILE] (reuse um token com mais de 1 h)"
fi
if token_available wrongaud; then
  load_token wrongaud
  CASE=auth.wrong-aud-real; api GET /v1/notes -k wrongaud
  expect "token real com aud de outro client OAuth" 401
else
  skip "token real com aud errada" "defina MIUPY_ID_TOKEN_AUD_ERRADA[_FILE] (token de outro client OAuth)"
fi

section "Allowlist de sub (403)"
if token_available forbidden; then
  load_token forbidden
  CASE=sub.not-allowed; api GET /v1/notes?limit=1 -k forbidden
  expect "token válido de sub fora da allowlist" 403
  expect_json "erro FORBIDDEN com requestId, sem detalhes" '.error.code == "FORBIDDEN" and (.error.requestId | type == "string")'
  CASE=sub.not-allowed-post; api POST /v1/notes -k forbidden -d "$(jbody '{title: "[validacao] negado"}')"
  expect "POST com sub fora da allowlist" 403
else
  skip "sub fora da allowlist" "defina MIUPY_ID_TOKEN_NAO_PERMITIDO[_FILE] (outra conta Google, não listada em ALLOWED_SUBS)"
fi
if ((LOCAL)); then skip "IP fora da allowlist" "só no ambiente AWS (rode com --blocked-ip de outra rede)"
else skip "IP fora da allowlist" "rode novamente com --blocked-ip a partir de outra rede/IP"; fi

# ---------- Validação de entrada ----------
section "Validação de entrada"
CASE=input.id-invalid-get; api GET /v1/notes/nao-e-uuid -k main
expect "GET com id não-UUID" 400
expect_json "erro VALIDATION_ERROR com requestId" '.error.code == "VALIDATION_ERROR" and (.error.requestId | type == "string")'
CASE=input.id-invalid-patch; api PATCH /v1/notes/nao-e-uuid -k main -d "$(jbody '{version: 1, title: "x"}')"
expect "PATCH com id não-UUID" 400
CASE=input.id-invalid-delete; api DELETE /v1/notes/nao-e-uuid -k main
expect "DELETE com id não-UUID" 400
CASE=input.unknown-field; api POST /v1/notes -k main -d "$(jbody '{title: "[validacao] x", ownerId: "outro"}')"
expect "campo desconhecido (ownerId) no corpo" 400
if [[ "$STATUS" == 201 ]]; then CREATED_NOTES+=("$(json_get .id)"); fi
CASE=input.bad-json; api POST /v1/notes -k main -d "$(rawbody '{"title": ')"
expect "JSON malformado" 400
CASE=input.limit-zero; api GET "/v1/notes?limit=0" -k main
expect "limit fora do intervalo" 400
CASE=input.cursor-forged; api GET "/v1/notes?cursor=nao-e-cursor" -k main
expect "cursor inválido" 400
# $b é variável do jq, não do shell.
# shellcheck disable=SC2016
long_body="$(jbody --arg b "$(head -c 100001 /dev/zero | tr '\0' a)" '{title: "[validacao] x", body: $b}')"
CASE=input.body-over-schema; api POST /v1/notes -k main -d "$long_body"
expect "body acima de 100 000 caracteres (mas < 256 kB)" 400

section "Corpo maior que 256 kB"
head -c 300000 /dev/zero | tr '\0' a >"$WORK/big.txt"
jq -n --rawfile b "$WORK/big.txt" '{title: "[validacao] grande", body: $b}' >"$WORK/big.json"
CASE=input.payload-too-large; api POST /v1/notes -k main -d "$WORK/big.json"
expect "POST com corpo de ~300 kB" 413
expect_json "erro PAYLOAD_TOO_LARGE com requestId" '.error.code == "PAYLOAD_TOO_LARGE" and (.error.requestId | type == "string")'

# ---------- Isolamento entre proprietários ----------
section "Isolamento entre proprietários"
if token_available b; then
  load_token b
  CASE=iso.create; note_create main security-isolamento
  if [[ -n "$NOTE_ID" ]]; then
    CASE=iso.get-b; api GET "/v1/notes/$NOTE_ID" -k b
    expect "sub B lê nota do sub A" 404
    jq -n '{version: 1, title: "[validacao] invasor"}' >"$WORK/patch.json"
    CASE=iso.patch-b; api PATCH "/v1/notes/$NOTE_ID" -k b -d "$WORK/patch.json"
    expect "sub B edita nota do sub A" 404
    CASE=iso.delete-b; api DELETE "/v1/notes/$NOTE_ID" -k b
    expect "sub B exclui nota do sub A" 404
    CASE=iso.list-b; api GET "/v1/notes/metadata?limit=100" -k b
    expect "sub B lista metadados" 200
    if jq -e --arg id "$NOTE_ID" '.items | map(.id) | index($id) | not' "$BODY" >/dev/null 2>&1; then ok "nota do sub A não aparece na lista do sub B"; else fail "nota do sub A aparece na lista do sub B"; fi
    CASE=iso.get-a; api GET "/v1/notes/$NOTE_ID" -k main
    expect "nota do sub A continua acessível ao dono (não foi alterada nem removida)" 200
    expect_json "version segue 1 e título original" '.version == 1 and (.title | startswith("[validacao] security-isolamento"))'
  else
    fail "criar nota do sub A para o teste de isolamento" "HTTP $STATUS ($(ids_text))"
  fi
else
  skip "nota de outro sub → 404" "defina MIUPY_ID_TOKEN_B[_FILE] (2º sub temporariamente na allowlist; remova depois)"
fi

# ---------- CORS ----------
section "CORS (tratado pelo API Gateway)"
if ((LOCAL)); then
  skip "CORS" "o harness local não tem API Gateway; verifique no ambiente AWS"
else
  CASE=cors.evil-preflight; api OPTIONS /v1/notes -H "Origin: $EVIL_ORIGIN" -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'
  if grep -qi '^access-control-allow-origin:' "$HDRS"; then fail "preflight de origem não listada não devolve Allow-Origin" "$(grep -i '^access-control-allow-origin:' "$HDRS" | tr -d '\r')"; else ok "preflight de origem não listada não devolve Allow-Origin" "HTTP $STATUS ($(ids_text))"; fi
  CASE=cors.evil-simple; api GET /health -H "Origin: $EVIL_ORIGIN"
  if grep -qi '^access-control-allow-origin:' "$HDRS"; then fail "GET /health de origem não listada sem Allow-Origin"; else ok "GET /health de origem não listada sem Allow-Origin"; fi
  CASE=cors.evil-credentials; api GET /v1/notes?limit=1 -k main -H "Origin: $EVIL_ORIGIN"
  if grep -qi '^access-control-allow-origin:' "$HDRS"; then fail "resposta autenticada para origem não listada sem Allow-Origin"; else ok "resposta autenticada para origem não listada sem Allow-Origin"; fi
  if [[ -n "${MIUPY_ALLOWED_ORIGIN:-}" ]]; then
    CASE=cors.allowed-preflight; api OPTIONS /v1/notes -H "Origin: $MIUPY_ALLOWED_ORIGIN" -H 'Access-Control-Request-Method: PATCH' -H 'Access-Control-Request-Headers: authorization,content-type'
    expect "preflight da origem permitida" '200|204'
    allow_origin="$(header_value access-control-allow-origin)"
    if [[ "$allow_origin" == "$MIUPY_ALLOWED_ORIGIN" ]]; then ok "Allow-Origin ecoa apenas a origem permitida"; else fail "Allow-Origin ecoa apenas a origem permitida" "recebido '${allow_origin:-ausente}'"; fi
    if [[ "$(header_value access-control-allow-origin)" == "*" ]]; then fail "Allow-Origin não é '*'"; fi
    allow_methods="$(header_value access-control-allow-methods)"
    if [[ "$allow_methods" == *PUT* ]]; then fail "Allow-Methods não inclui PUT" "$allow_methods"; else ok "Allow-Methods sem PUT" "${allow_methods:-ausente}"; fi
  else
    skip "preflight da origem permitida" "defina MIUPY_ALLOWED_ORIGIN (ex.: http://tauri.localhost)"
  fi
fi

# ---------- Métodos e rotas inesperados ----------
section "Métodos e rotas inesperados"
CASE=method.post-health; api POST /health -d "$(rawbody '{}')"
expect "POST /health" '404|405'
CASE=method.put-health; api PUT /health
expect "PUT /health" '404|405'
CASE=method.put-notes; api PUT /v1/notes -k main -d "$(rawbody '{}')"
expect "PUT /v1/notes" '404|405'
CASE=method.delete-collection; api DELETE /v1/notes -k main
expect "DELETE na coleção /v1/notes" '404|405'
CASE=method.patch-collection; api PATCH /v1/notes -k main -d "$(rawbody '{}')"
expect "PATCH na coleção /v1/notes" '404|405'
CASE=route.unknown; api GET /v1/inexistente -k main
expect "rota inexistente sob /v1" 404
CASE=route.unknown-root; api GET /admin
expect "rota inexistente na raiz" 404
CASE=route.traversal; api GET "/v1/notes/%2e%2e/%2e%2e/health" -k main --path-as-is
expect "caminho com %2e%2e" '400|404'
CASE=method.trace; api TRACE /v1/notes -k main
expect "TRACE /v1/notes" '400|404|405|501'

section "Vazamento de informação nas respostas"
CASE=info.headers; api GET /health
if grep -qi '^x-powered-by:' "$HDRS"; then fail "sem X-Powered-By" "$(grep -i '^x-powered-by:' "$HDRS" | tr -d '\r')"; else ok "sem X-Powered-By"; fi
if [[ -s "$WORK/error-bodies.txt" ]]; then
  if grep -Eiq 'stack|node_modules|\.(js|ts):[0-9]+|arn:aws|at [A-Za-z.<>]+ \(' "$WORK/error-bodies.txt"; then fail "corpos de erro sem stack trace, caminhos ou ARNs"; else ok "corpos de erro sem stack trace, caminhos ou ARNs"; fi
fi

# ---------- Rajada ----------
section "Throttling"
if ((BURST > 0)); then
  PAR="${MIUPY_BURST_PARALLEL:-50}"
  info "disparando $BURST requisições GET /health (paralelo $PAR); pode acionar alarmes de 4xx/limite"
  CASE=burst.start; record BURST "/health x$BURST" 0 - -
  seq 1 "$BURST" | xargs -P "$PAR" -I{} curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 "$API_URL/health" >"$WORK/burst.txt" 2>/dev/null || true
  distribution="$(sort "$WORK/burst.txt" | uniq -c | awk '{printf "%s×HTTP%s ", $1, $2}')"
  info "distribuição: $distribution"
  count_429="$(grep -c '^429$' "$WORK/burst.txt" || true)"
  count_5xx="$(grep -c '^5' "$WORK/burst.txt" || true)"
  if ((count_429 > 0)); then ok "rajada provocou throttling" "$count_429 respostas 429"
  elif ((EXPECT_THROTTLE)); then fail "rajada provocou throttling (429)" "nenhum 429 em $BURST requisições"
  else warn "nenhum 429 na rajada" "stage sem throttling configurado? (runtime.tf ainda não define default_route_settings)"; fi
  if ((count_5xx > 0)); then warn "rajada gerou 5xx" "$count_5xx respostas; verifique concorrência reservada da Lambda e os logs"; else ok "rajada sem 5xx"; fi
  sleep 2
  CASE=burst.after; api GET /health
  expect "API volta a responder após a rajada" 200
else
  skip "rajada → 429" "use --burst N (ex.: --burst 300; com --expect-throttle após configurar o stage)"
fi

summary
