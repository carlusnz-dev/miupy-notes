#!/usr/bin/env bash
# CloudWatch dev: correlaciona os requestIds do smoke/security com os logs da Lambda e do access log do API Gateway,
# confere que logs de erro são descritivos e não vazam token/Authorization/corpo, e confere retenção e criptografia dos grupos.
# Somente leitura. O conteúdo dos eventos fica em arquivos temporários; só contagens e campos controlados são impressos.
# `A && ok || fail` é intencional: ok() nunca retorna erro.
# shellcheck disable=SC2015
set -euo pipefail
SCRIPT_NAME=cloudwatch
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WAIT=90 SINCE_MIN="" EXPECT_RETENTION="${MIUPY_EXPECT_LOG_RETENTION:-}" TAIL_GROUP="" EXTRA_IDS=() RECORDS=()
usage() {
  cat <<'EOF'
Uso: cloudwatch.sh [--wait SEG] [--since MIN] [--request-id ID]... [--records ARQ]... [--expect-retention DIAS] [--tail lambda|api]

  --wait SEG            espera até SEG s pela ingestão dos logs (padrão 90)
  --since MIN           janela de busca em minutos (padrão: desde 2 min antes da 1ª requisição registrada)
  --request-id ID       procura só este requestId (apigw ou da aplicação), nos dois grupos
  --records ARQ         TSV de requisições (padrão: last-*.tsv em MIUPY_VALIDACAO_DIR, gerados por smoke/security)
  --expect-retention N  falha se a retenção dos grupos lambda/api for diferente de N dias
  --tail GRUPO          mostra os últimos 15 min de lambda|api (use com --request-id para filtrar) e sai

Perfil AWS: AWS_PROFILE (operator ou monitor: logs:FilterLogEvents, logs:DescribeLogGroups, cloudwatch:DescribeAlarms).
Variáveis: MIUPY_TF_OUTPUTS_FILE, AWS_REGION (ou MIUPY_API_URL), MIUPY_ID_TOKEN[_FILE] (opcional: procura o token literal nos logs).
EOF
}
while (($#)); do
  case "$1" in
    --wait) WAIT="${2:-}"; [[ "$WAIT" =~ ^[0-9]+$ ]] || die "--wait exige número"; shift ;;
    --since) SINCE_MIN="${2:-}"; [[ "$SINCE_MIN" =~ ^[0-9]+$ ]] || die "--since exige minutos"; shift ;;
    --request-id) EXTRA_IDS+=("${2:-}"); [[ "${2:-}" =~ ^[A-Za-z0-9_=-]{6,64}$ ]] || die "--request-id inválido"; shift ;;
    --records) RECORDS+=("${2:-}"); [[ -r "${2:-}" ]] || die "arquivo ilegível: ${2:-}"; shift ;;
    --expect-retention) EXPECT_RETENTION="${2:-}"; [[ "$EXPECT_RETENTION" =~ ^[0-9]+$ ]] || die "--expect-retention exige dias"; shift ;;
    --tail) TAIL_GROUP="${2:-}"; [[ "$TAIL_GROUP" =~ ^(lambda|api)$ ]] || die "--tail aceita lambda ou api"; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "argumento desconhecido: $1" ;;
  esac
  shift
done

need jq aws
G_LAMBDA="$(tf_get '.log_group_names.value.lambda')"
G_API="$(tf_get '.log_group_names.value.api')"
G_AUDIT="$(tf_get '.log_group_names.value.audit')"
BUCKET="$(tf_get '.app_bucket_name.value')"
[[ -n "$G_LAMBDA" && -n "$G_API" ]] || die "output log_group_names (lambda, api) ausente."
if [[ -n "${MIUPY_API_URL:-}" || -n "$(tf_get '.http_api_endpoint.value')" ]]; then resolve_api_url; fi
resolve_region

if [[ -n "$TAIL_GROUP" ]]; then
  group="$G_LAMBDA"; [[ "$TAIL_GROUP" == api ]] && group="$G_API"
  args=(logs tail "$group" --since 15m --format short --region "$REGION")
  if ((${#EXTRA_IDS[@]} > 0)); then args+=(--filter-pattern "\"${EXTRA_IDS[0]}\""); fi
  exec aws --no-cli-pager "${args[@]}"
fi

check_aws_identity "$(account_from_bucket "$BUCKET")"
if token_available main; then load_token main; fi

# ---------- Grupos: retenção e criptografia ----------
section "Grupos de log"
for entry in "lambda:$G_LAMBDA" "api:$G_API" "audit:$G_AUDIT"; do
  name="${entry%%:*}" group="${entry#*:}"
  [[ -n "$group" ]] || continue
  if aws_run "$WORK/lg.json" logs describe-log-groups --log-group-name-prefix "$group" --output json; then
    if jq -e --arg g "$group" '.logGroups | map(select(.logGroupName == $g)) | length == 1' "$WORK/lg.json" >/dev/null; then
      days="$(jq -r --arg g "$group" '.logGroups[] | select(.logGroupName == $g) | .retentionInDays // "nunca"' "$WORK/lg.json")"
      [[ "$days" != nunca ]] && ok "$name: retenção definida" "$days dias" || fail "$name: retenção definida" "sem retenção (guarda para sempre)"
      if [[ -n "$EXPECT_RETENTION" && "$name" != audit ]]; then
        [[ "$days" == "$EXPECT_RETENTION" ]] && ok "$name: retenção = $EXPECT_RETENTION dias" || fail "$name: retenção = $EXPECT_RETENTION dias" "atual: $days"
      fi
      # Sem kmsKeyId o CloudWatch Logs cifra em repouso com chave própria do serviço.
      jq -e --arg g "$group" '.logGroups[] | select(.logGroupName == $g) | .kmsKeyId == null' "$WORK/lg.json" >/dev/null && ok "$name: criptografia padrão do serviço (sem chave KMS própria)" || fail "$name: sem chave KMS própria" "grupo ainda associado a uma chave: migração não aplicada?"
    else
      fail "$name: grupo $group existe"
    fi
  elif aws_denied; then skip "$name: describe-log-groups" "perfil sem logs:DescribeLogGroups"
  else fail "$name: describe-log-groups" "$(aws_err_text)"; fi
done

# ---------- Requisições a correlacionar ----------
ROWS="$WORK/rows.tsv"
: >"$ROWS"
if ((${#EXTRA_IDS[@]} > 0)); then
  for id in "${EXTRA_IDS[@]}"; do printf 'manual\t-\t-\t0\t%s\t%s\t%s\n' "$id" "$id" "$(date +%s%3N)" >>"$ROWS"; done
else
  if ((${#RECORDS[@]} == 0)); then
    shopt -s nullglob
    RECORDS=("$STATE_DIR"/last-*.tsv)
    shopt -u nullglob
  fi
  ((${#RECORDS[@]} > 0)) || die "nenhum registro de requisições em $STATE_DIR: rode smoke.sh/security.sh antes (ou use --request-id)."
  # Só linhas com requestId do API Gateway; a rajada e o limpeza ficam de fora.
  cat "${RECORDS[@]}" | awk -F'\t' '$5 != "-" || $6 != "-"' | grep -v '^BURST' >"$ROWS" || true
fi
TOTAL="$(wc -l <"$ROWS" | tr -d ' ')"
((TOTAL > 0)) || die "nenhuma requisição com requestId nos registros."
FIRST_MS="$(cut -f7 "$ROWS" | sort -n | head -n1)"
START_MS=$((FIRST_MS - 120000))
if [[ -n "$SINCE_MIN" ]]; then START_MS=$(($(date +%s%3N) - SINCE_MIN * 60000)); fi
info "$TOTAL requisições registradas; janela desde $(date -u -d "@$((START_MS / 1000))" +%FT%TZ)"

fetch_events() { # grupo arquivo
  aws_run "$2" logs filter-log-events --log-group-name "$1" --start-time "$START_MS" --end-time "$(($(date +%s%3N) + 60000))" --output json
}
index_events() {
  jq -r '.events[].message | fromjson? | select(.requestId != null and .status != null) | [.requestId, (.status | tostring), (.route // "-")] | @tsv' "$WORK/api.json" >"$WORK/api.idx" 2>/dev/null || : >"$WORK/api.idx"
  jq -r '.events[].message | fromjson? | select(.event == "request.completed") | [.requestId, (.statusCode | tostring), (.level // "-"), (.route // "-"), (.message // "")] | @tsv' "$WORK/lambda.json" >"$WORK/lambda.idx" 2>/dev/null || : >"$WORK/lambda.idx"
}
# Quantas requisições ainda faltam em cada índice (para decidir se espera mais).
count_missing() {
  local missing=0 case_ method path status apigw app
  while IFS=$'\t' read -r case_ method path status apigw app _; do
    if [[ "$apigw" != "-" ]] && ! grep -q "^${apigw}"$'\t' "$WORK/api.idx"; then missing=$((missing + 1)); fi
    if [[ "$app" != "-" ]] && ! grep -q "^${app}"$'\t' "$WORK/lambda.idx"; then missing=$((missing + 1)); fi
  done <"$ROWS"
  echo "$missing"
}

section "Busca nos logs (aguardando ingestão por até ${WAIT}s)"
deadline=$((SECONDS + WAIT))
while :; do
  if ! fetch_events "$G_API" "$WORK/api.json"; then
    if aws_denied; then skip "leitura do access log do API Gateway" "perfil sem logs:FilterLogEvents"; else fail "leitura do access log" "$(aws_err_text)"; fi
    echo '{"events":[]}' >"$WORK/api.json"
  fi
  if ! fetch_events "$G_LAMBDA" "$WORK/lambda.json"; then
    if aws_denied; then skip "leitura dos logs da Lambda" "perfil sem logs:FilterLogEvents"; else fail "leitura dos logs da Lambda" "$(aws_err_text)"; fi
    echo '{"events":[]}' >"$WORK/lambda.json"
  fi
  index_events
  missing="$(count_missing)"
  ((missing == 0 || SECONDS >= deadline)) && break
  info "faltam $missing correspondência(s); nova tentativa em 10 s"
  sleep 10
done
info "eventos lidos: API Gateway $(jq '.events | length' "$WORK/api.json"), Lambda $(jq '.events | length' "$WORK/lambda.json")"

# ---------- Correlação por requestId ----------
section "Correlação por requestId"
api_found=0 api_total=0 api_match=0 lam_found=0 lam_total=0 lam_match=0
declare -A SAMPLE=()
while IFS=$'\t' read -r case_ method path status apigw app _; do
  if [[ "$apigw" != "-" ]]; then
    api_total=$((api_total + 1))
    line="$(grep -m1 "^${apigw}"$'\t' "$WORK/api.idx" || true)"
    if [[ -n "$line" ]]; then
      api_found=$((api_found + 1))
      [[ "$status" == 0 || "$(cut -f2 <<<"$line")" == "$status" ]] && api_match=$((api_match + 1))
    else
      info "sem access log: $case_ ($method) apigw=$apigw"
    fi
  fi
  if [[ "$app" != "-" ]]; then
    lam_total=$((lam_total + 1))
    line="$(grep -m1 "^${app}"$'\t' "$WORK/lambda.idx" || true)"
    if [[ -n "$line" ]]; then
      lam_found=$((lam_found + 1))
      [[ "$status" == 0 || "$(cut -f2 <<<"$line")" == "$status" ]] && lam_match=$((lam_match + 1))
      # Uma amostra por status de erro, para avaliar se a mensagem é descritiva.
      if [[ "$(cut -f2 <<<"$line")" =~ ^[45][0-9][0-9]$ ]]; then SAMPLE["$(cut -f2 <<<"$line")"]="$line"; fi
    else
      info "sem log da Lambda: $case_ ($method) app=$app"
    fi
  fi
done <"$ROWS"

if ((api_total == 0)); then skip "access log do API Gateway" "nenhuma requisição com requestId do API Gateway (apigw-requestid)"
elif ((api_found == api_total && api_match == api_total)); then ok "access log do API Gateway: $api_total/$api_total requisições, status idêntico ao observado"
else fail "access log do API Gateway" "$api_found/$api_total encontradas, $api_match com status igual (ingestão pode levar > ${WAIT}s: tente --wait 180)"; fi
if ((lam_total == 0)); then skip "logs da Lambda" "nenhuma requisição com X-Request-Id da aplicação"
elif ((lam_found == lam_total && lam_match == lam_total)); then ok "logs da Lambda: $lam_total/$lam_total requisições com request.completed e status idêntico"
else fail "logs da Lambda" "$lam_found/$lam_total encontradas, $lam_match com status igual"; fi

section "Logs de erro descritivos"
if ((${#SAMPLE[@]} == 0)); then
  skip "mensagens de erro" "nenhuma requisição 4xx/5xx chegou à Lambda nesta janela (rode security.sh)"
else
  bad=0
  for st in $(printf '%s\n' "${!SAMPLE[@]}" | sort -n); do
    IFS=$'\t' read -r _ code level route message <<<"${SAMPLE[$st]}"
    # Somente campos controlados do logger: nível, rota-template e mensagem fixa.
    info "HTTP $code | $level | $route | ${message:0:140}"
    if ((${#message} < 12)); then bad=1; fi
  done
  ((bad == 0)) && ok "cada status de erro tem mensagem descritiva (não vazia) e rota-template" || fail "mensagens de erro descritivas" "alguma mensagem é curta/vazia"
fi
n_error="$(jq '[.events[].message | fromjson? | select(.level == "error")] | length' "$WORK/lambda.json" 2>/dev/null || echo 0)"
if ((n_error == 0)); then ok "nenhum log de nível error na janela"
else warn "$n_error log(s) de nível error na janela" "esperado só se o teste provocou 5xx; classificações: $(jq -r '[.events[].message | fromjson? | select(.level == "error") | (.classification // .event)] | unique | join(", ")' "$WORK/lambda.json")"; fi
n_timeout="$(jq '[.events[].message | select(test("Task timed out|Runtime\\.|Unhandled|OutOfMemory|ERR_"))] | length' "$WORK/lambda.json" 2>/dev/null || echo 0)"
((n_timeout == 0)) && ok "sem timeout, exceção não tratada ou falta de memória da Lambda" || fail "sinais de falha do runtime da Lambda" "$n_timeout ocorrência(s); investigue com --tail lambda"

section "Vazamento de dados sensíveis nos logs"
leak_scan() { # descrição, regex estendida (case-insensitive)
  local count=0 f
  for f in "$WORK/api.json" "$WORK/lambda.json"; do
    count=$((count + $({ grep -Eio -- "$2" "$f" || true; } | wc -l)))
  done
  if ((count == 0)); then ok "nenhuma ocorrência de $1"; else fail "ocorrências de $1 nos logs" "$count"; fi
}
leak_scan "'Bearer'" 'Bearer[ %]'
leak_scan "cabeçalho Authorization" 'authorization'
leak_scan "JWT (prefixo eyJ…)" 'eyJ[A-Za-z0-9_-]{10,}'
leak_scan "marcador/corpo das notas de teste" "$MARKER|corpo sint"
leak_scan "cabeçalho Cookie/x-api-key" '(^|[^a-z])(cookie|x-api-key)[":= ]'
if [[ -s "$WORK/tok.main" ]]; then
  if grep -qF -f "$WORK/tok.main" "$WORK/api.json" "$WORK/lambda.json"; then fail "o token literal do proprietário aparece nos logs"; else ok "o token literal do proprietário não aparece nos logs"; fi
else
  skip "busca do token literal" "defina MIUPY_ID_TOKEN[_FILE] para incluir este teste"
fi

section "Alarmes (informativo)"
prefix="${G_LAMBDA#/aws/lambda/}"
prefix="${prefix%-api}"
if aws_run "$WORK/alarms.json" cloudwatch describe-alarms --alarm-name-prefix "$prefix" --output json; then
  total="$(jq '.MetricAlarms | length' "$WORK/alarms.json")"
  info "$total alarme(s) com prefixo '$prefix': $(jq -r '[.MetricAlarms[].StateValue] | group_by(.) | map("\(.[0])=\(length)") | join(", ")' "$WORK/alarms.json")"
  jq -r '.MetricAlarms[] | select(.StateValue == "ALARM") | "  EM ALARME: \(.AlarmName)"' "$WORK/alarms.json"
  if ((total > 0)); then ok "alarmes existem para o ambiente"; else fail "alarmes existem para o ambiente"; fi
elif aws_denied; then skip "alarmes" "perfil sem cloudwatch:DescribeAlarms"
else warn "describe-alarms" "$(aws_err_text)"; fi

summary
