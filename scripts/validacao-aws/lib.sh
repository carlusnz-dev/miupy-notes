# shellcheck shell=bash
# Biblioteca comum dos scripts de validação do ambiente AWS dev. Carregue com `source`; não execute.
# Nunca imprime tokens: eles ficam em arquivos 0600 num diretório temporário removido ao sair.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then echo "lib.sh deve ser carregada com source." >&2; exit 2; fi

umask 077
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LIB_DIR/../.." && pwd)"
TF_DIR="${MIUPY_TF_DIR:-$REPO_ROOT/infra/environments/dev}"
STATE_DIR="${MIUPY_VALIDACAO_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/miupy-validacao}"
MARKER="MIUPY_VALIDACAO_MARKER"
WORK="$(mktemp -d)"
PASS=0 FAIL=0 SKIP=0 WARN=0 SEQ=0
CLEANUPS=()
API_URL="" REGION="" STATUS="" BODY="" HDRS="" APIGW_ID="" APP_ID="" CASE="" RECORD_FILE=""
LOCAL="${MIUPY_LOCAL:-0}"

_on_exit() {
  local rc=$?
  trap - EXIT
  local fn
  for fn in "${CLEANUPS[@]}"; do "$fn" || true; done
  rm -rf "$WORK"
  exit "$rc"
}
trap _on_exit EXIT
trap 'exit 130' INT TERM

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_OK=$'\e[32m' C_FAIL=$'\e[31m' C_SKIP=$'\e[33m' C_DIM=$'\e[90m' C_OFF=$'\e[0m'
else
  C_OK="" C_FAIL="" C_SKIP="" C_DIM="" C_OFF=""
fi

die() { printf 'ERRO: %s\n' "$*" >&2; exit 2; }
need() { local c; for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "comando obrigatório ausente: $c"; done; }
section() { printf '\n%s\n' "== $* =="; }
info() { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }
ok() { PASS=$((PASS + 1)); printf '  %s[OK]%s     %s%s\n' "$C_OK" "$C_OFF" "$1" "${2:+ — $2}"; }
fail() { FAIL=$((FAIL + 1)); printf '  %s[FALHA]%s  %s%s\n' "$C_FAIL" "$C_OFF" "$1" "${2:+ — $2}"; }
skip() { SKIP=$((SKIP + 1)); printf '  %s[PULADO]%s %s%s\n' "$C_SKIP" "$C_OFF" "$1" "${2:+ — $2}"; }
warn() { WARN=$((WARN + 1)); printf '  %s[AVISO]%s  %s%s\n' "$C_SKIP" "$C_OFF" "$1" "${2:+ — $2}"; }

summary() {
  printf '\nResumo: %d OK, %d FALHA, %d PULADO, %d AVISO\n' "$PASS" "$FAIL" "$SKIP" "$WARN"
  if ((FAIL > 0)); then printf 'Resultado: REPROVADO\n'; return 1; fi
  printf 'Resultado: APROVADO (confira PULADO/AVISO antes de registrar)\n'
}

# ---------- Terraform outputs ----------

tf_outputs() {
  [[ -s "$WORK/outputs.json" ]] && return 0
  if [[ -n "${MIUPY_TF_OUTPUTS_FILE:-}" ]]; then
    [[ -r "$MIUPY_TF_OUTPUTS_FILE" ]] || die "MIUPY_TF_OUTPUTS_FILE ilegível: $MIUPY_TF_OUTPUTS_FILE"
    cp "$MIUPY_TF_OUTPUTS_FILE" "$WORK/outputs.json"
  else
    need terraform
    terraform -chdir="$TF_DIR" output -json >"$WORK/outputs.json" 2>"$WORK/tf.err" ||
      die "terraform output falhou (backend/credenciais?). Salve os outputs em arquivo e use MIUPY_TF_OUTPUTS_FILE."
  fi
  jq -e 'type == "object"' "$WORK/outputs.json" >/dev/null || die "outputs do Terraform inválidos"
}
# Filtro jq sobre o JSON de `terraform output -json`; ex.: tf_get '.data_table_name.value'.
tf_get() { tf_outputs; jq -r "$1 // empty" "$WORK/outputs.json"; }

# ---------- Configuração da API ----------

resolve_api_url() {
  if [[ -n "${MIUPY_API_URL:-}" ]]; then API_URL="$MIUPY_API_URL"; else API_URL="$(tf_get '.http_api_endpoint.value')"; fi
  API_URL="${API_URL%/}"
  [[ -n "$API_URL" ]] || die "URL da API ausente: defina MIUPY_API_URL ou forneça o output http_api_endpoint."
  # Tokens só trafegam em HTTPS; HTTP apenas para o harness local em loopback.
  if [[ "$API_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then return 0; fi
  if [[ "$LOCAL" == 1 && "$API_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]]; then return 0; fi
  die "URL da API recusada (use https://<id>.execute-api.<região>.amazonaws.com; http só com --local em 127.0.0.1)."
}

# Região: AWS_REGION/AWS_DEFAULT_REGION, senão a do endpoint execute-api.
resolve_region() {
  REGION="${MIUPY_AWS_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-}}}"
  if [[ -z "$REGION" ]]; then
    [[ -n "$API_URL" ]] || { if [[ -n "${MIUPY_API_URL:-}" ]]; then API_URL="$MIUPY_API_URL"; else API_URL="$(tf_get '.http_api_endpoint.value')"; fi; }
    if [[ "$API_URL" =~ \.execute-api\.([a-z0-9-]+)\.amazonaws\.com ]]; then REGION="${BASH_REMATCH[1]}"; fi
  fi
  [[ -n "$REGION" ]] || die "Região desconhecida: defina AWS_REGION (ou MIUPY_AWS_REGION)."
}

# ---------- Tokens (nunca impressos) ----------

# kind → variável de ambiente (ou VAR_FILE com o caminho de um arquivo).
token_var() {
  case "$1" in
    main) echo MIUPY_ID_TOKEN ;;
    b) echo MIUPY_ID_TOKEN_B ;;
    forbidden) echo MIUPY_ID_TOKEN_NAO_PERMITIDO ;;
    expired) echo MIUPY_ID_TOKEN_EXPIRADO ;;
    wrongaud) echo MIUPY_ID_TOKEN_AUD_ERRADA ;;
    *) die "tipo de token desconhecido: $1" ;;
  esac
}

token_available() {
  local var file_var
  var="$(token_var "$1")"
  file_var="${var}_FILE"
  [[ -n "${!var:-}" || ( -n "${!file_var:-}" && -r "${!file_var}" ) ]]
}

# Grava o token em $WORK/tok.<kind> e o cabeçalho em $WORK/auth.<kind> (usado por `curl -H @arquivo`).
load_token() {
  local kind=$1 var file_var raw
  var="$(token_var "$kind")"
  file_var="${var}_FILE"
  if [[ -n "${!var:-}" ]]; then
    raw="${!var}"
  elif [[ -n "${!file_var:-}" && -r "${!file_var}" ]]; then
    if [[ -n "$(find "${!file_var}" -maxdepth 0 -perm /077 2>/dev/null)" ]]; then warn "${file_var}" "arquivo legível por outros usuários; use chmod 600"; fi
    raw="$(<"${!file_var}")"
  else
    die "token ausente: defina $var ou ${file_var} (veja docs/validacao/aws-dev.md)."
  fi
  raw="${raw//[[:space:]]/}"
  [[ "$raw" =~ ^[A-Za-z0-9._-]+$ && "$raw" == *.*.* ]] || die "$var não parece um JWT (três partes separadas por ponto)."
  printf '%s' "$raw" >"$WORK/tok.$kind"
  printf 'Authorization: Bearer %s\n' "$raw" >"$WORK/auth.$kind"
  info "token '$kind' carregado (${#raw} caracteres; valor não é exibido)"
}

# Lê uma claim do payload do JWT sem imprimir o token; saída só em variável do chamador.
jwt_claim() {
  local payload
  payload="$(cut -d. -f2 "$WORK/tok.$1" | tr '_-' '/+')"
  while ((${#payload} % 4)); do payload+="="; done
  printf '%s' "$payload" | base64 -d 2>/dev/null | jq -r ".$2 // empty" 2>/dev/null || true
}

# Falha cedo se o token principal já expirou (o IdToken do Google dura 1 h).
require_fresh_token() {
  local exp now
  exp="$(jwt_claim "$1" exp)"
  now="$(date +%s)"
  [[ "$exp" =~ ^[0-9]+$ ]] || die "token '$1' sem claim exp legível."
  ((exp > now + 60)) || die "token '$1' expirado ou prestes a expirar; gere outro (docs/validacao/aws-dev.md)."
  info "token '$1' válido por mais $(((exp - now) / 60)) min"
}

# ---------- Chamadas HTTP ----------

header_value() { { grep -i "^$1:" "$HDRS" || true; } | tail -n1 | cut -d: -f2- | tr -d ' \r'; }

init_record() {
  mkdir -p "$STATE_DIR"
  RECORD_FILE="$STATE_DIR/${SCRIPT_NAME}-$(date -u +%Y%m%dT%H%M%SZ).tsv"
  : >"$RECORD_FILE"
}

# Anexa a execução ao registro lido por cloudwatch.sh (somente metadados, sem corpo ou token).
record() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${CASE:-?}" "$1" "$2" "$3" "$4" "$5" "$(date +%s%3N)" >>"$RECORD_FILE"; }

finish_record() {
  [[ -n "$RECORD_FILE" && -s "$RECORD_FILE" ]] || return 0
  cp "$RECORD_FILE" "$STATE_DIR/last-${SCRIPT_NAME}.tsv"
  info "requestIds registrados em $RECORD_FILE (cloudwatch.sh lê last-${SCRIPT_NAME}.tsv)"
}

# api MÉTODO CAMINHO [-k tipo-de-token] [-d arquivo.json] [-H 'Cabeçalho: valor'] [--path-as-is]
# Define STATUS, BODY (arquivo), HDRS (arquivo), APIGW_ID e APP_ID.
api() {
  local method=$1 path=$2 kind="" data="" asis=() extra=()
  shift 2
  while (($#)); do
    case "$1" in
      -k) kind=$2; shift 2 ;;
      -d) data=$2; shift 2 ;;
      -H) extra+=(-H "$2"); shift 2 ;;
      --path-as-is) asis=(--path-as-is); shift ;;
      *) die "api: opção desconhecida $1" ;;
    esac
  done
  SEQ=$((SEQ + 1))
  BODY="$WORK/body.$SEQ" HDRS="$WORK/hdrs.$SEQ"
  local args=(-sS --max-time "${MIUPY_TIMEOUT:-30}" -o "$BODY" -D "$HDRS" -w '%{http_code}' -X "$method" "${asis[@]}")
  if [[ -n "$kind" ]]; then args+=(-H "@$WORK/auth.$kind"); fi
  if [[ -n "$data" ]]; then args+=(-H 'Content-Type: application/json' --data-binary "@$data"); fi
  STATUS="$(curl "${args[@]}" "${extra[@]}" "$API_URL$path" 2>"$WORK/curl.err")" || STATUS=000
  : >>"$BODY"
  : >>"$HDRS"
  APIGW_ID="$(header_value apigw-requestid)"
  APP_ID="$(header_value x-request-id)"
  record "$method" "$path" "$STATUS" "${APIGW_ID:--}" "${APP_ID:--}"
  if ((STATUS >= 400 || STATUS == 0)); then head -c 4096 "$BODY" >>"$WORK/error-bodies.txt"; fi
  return 0
}

ids_text() { printf 'apigw=%s app=%s' "${APIGW_ID:--}" "${APP_ID:--}"; }

# expect "descrição" '200|201' → compara STATUS com uma regex.
expect() {
  if [[ "$STATUS" =~ ^($2)$ ]]; then ok "$1" "HTTP $STATUS ($(ids_text))"
  else fail "$1" "esperado HTTP $2, veio $STATUS ($(ids_text))$([[ $STATUS == 000 ]] && echo "; $(head -c 160 "$WORK/curl.err")")"; fi
}

# expect_json "descrição" 'filtro jq booleano' → avalia o corpo da última resposta.
expect_json() {
  if jq -e "$2" "$BODY" >/dev/null 2>&1; then ok "$1"; else fail "$1" "corpo fora do contrato ($(ids_text))"; fi
}

# jbody [opções jq] 'filtro' → caminho de um arquivo temporário com o JSON; rawbody 'texto' idem, sem JSON.
jbody() { local f="$WORK/in.$((++SEQ))"; jq -n "$@" >"$f"; printf '%s' "$f"; }
rawbody() { local f="$WORK/in.$((++SEQ))"; printf '%s' "$1" >"$f"; printf '%s' "$f"; }

json_get() { jq -r "$1 // empty" "$BODY" 2>/dev/null || true; }

new_uuid() { if [[ -r /proc/sys/kernel/random/uuid ]]; then cat /proc/sys/kernel/random/uuid; else uuidgen | tr '[:upper:]' '[:lower:]'; fi; }
is_uuid() { [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; }

# ---------- Recursos de teste (criados e removidos pelo próprio script) ----------

CREATED_NOTES=() CREATED_TASKS=()
cleanup_resources() {
  local id version
  [[ -n "$API_URL" && -s "$WORK/auth.main" ]] || return 0
  CASE=cleanup
  for id in "${CREATED_NOTES[@]}"; do api DELETE "/v1/notes/$id" -k main || true; done
  for id in "${CREATED_TASKS[@]}"; do
    api GET "/v1/calendar/tasks/$id" -k main || true
    [[ "$STATUS" == 200 ]] || continue
    version="$(json_get .version)"
    api DELETE "/v1/calendar/tasks/$id?version=$version" -k main || true
  done
}

forget_note() { local keep=() id; for id in "${CREATED_NOTES[@]}"; do [[ "$id" == "$1" ]] || keep+=("$id"); done; CREATED_NOTES=("${keep[@]}"); }
forget_task() { local keep=() id; for id in "${CREATED_TASKS[@]}"; do [[ "$id" == "$1" ]] || keep+=("$id"); done; CREATED_TASKS=("${keep[@]}"); }

# note_create [token] → NOTE_ID (vazio se falhar); registra para limpeza.
NOTE_ID=""
note_create() {
  local kind=${1:-main} label=${2:-$SCRIPT_NAME}
  jq -n --arg t "[validacao] $label $(date -u +%FT%TZ)" --arg b "$MARKER corpo sintético" '{title: $t, body: $b, tags: ["validacao"]}' >"$WORK/note.json"
  api POST /v1/notes -k "$kind" -d "$WORK/note.json"
  NOTE_ID=""
  if [[ "$STATUS" == 201 ]]; then
    NOTE_ID="$(json_get .id)"
    if is_uuid "$NOTE_ID"; then CREATED_NOTES+=("$NOTE_ID"); else NOTE_ID=""; fi
  fi
  return 0
}

# Inicialização comum dos scripts que falam com a API.
init_api() {
  need curl jq base64 date
  resolve_api_url
  load_token main
  require_fresh_token main
  init_record
  CLEANUPS+=(cleanup_resources finish_record)
  info "API: $API_URL"
}

# ---------- AWS CLI (somente leitura, salvo o objeto de teste do s3.sh --write-test) ----------

AWS_ERR="$WORK/aws.err"
sanitize() { sed -E 's/[0-9]{12}/************/g' | head -c "${1:-240}"; }
# aws_run ARQUIVO_DE_SAÍDA args... → rc do aws; erro em $AWS_ERR.
aws_run() { local out=$1; shift; aws --no-cli-pager --region "$REGION" "$@" >"$out" 2>"$AWS_ERR"; }
aws_denied() { grep -Eqi 'AccessDenied|not authorized|UnauthorizedOperation|AccessDeniedException' "$AWS_ERR"; }
aws_err_text() { sanitize 240 <"$AWS_ERR" | tr '\n' ' '; }

# Confere que as credenciais AWS existem e que a conta é a dos recursos (nome do bucket contém a conta).
check_aws_identity() {
  need aws
  local account expected="${1:-}"
  if ! aws_run "$WORK/id.txt" sts get-caller-identity --query Account --output text; then
    die "credenciais AWS indisponíveis ($(aws_err_text)). Defina AWS_PROFILE (docs/validacao/aws-dev.md)."
  fi
  account="$(tr -d '[:space:]' <"$WORK/id.txt")"
  if [[ -n "$expected" && "$account" != "$expected" ]]; then die "conta AWS ativa (****${account: -4}) difere da dos recursos (****${expected: -4})."; fi
  info "conta AWS ativa: ****${account: -4} (região $REGION)"
}

# Extrai o ID da conta do nome do bucket `<prefixo>-<conta>-app`.
account_from_bucket() { [[ "$1" =~ -([0-9]{12})- ]] && printf '%s' "${BASH_REMATCH[1]}" || true; }
