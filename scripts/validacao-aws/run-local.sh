#!/usr/bin/env bash
# Ensaio local de smoke.sh e security.sh: DynamoDB Local (Docker, em memória, porta aleatória) +
# app Express real com JWKS gerado na hora. Não toca na AWS. Exige docker, node e `npm ci` já feito.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
DIR="scripts/validacao-aws"
WORK="$(mktemp -d)"
CONTAINER="miupy-validacao-local-$$"
HARNESS_PID=""

# shellcheck disable=SC2329  # chamada pelo trap EXIT
cleanup() {
  local rc=$?
  trap - EXIT
  [[ -n "$HARNESS_PID" ]] && kill "$HARNESS_PID" 2>/dev/null || true
  # MIUPY_LOCAL_KEEP=DIR guarda o log do app e os registros de requisições (sem tokens) para inspeção.
  if [[ -n "${MIUPY_LOCAL_KEEP:-}" ]]; then
    mkdir -p "$MIUPY_LOCAL_KEEP"
    cp "$WORK/api.log" "$MIUPY_LOCAL_KEEP/" 2>/dev/null || true
    cp -r "$WORK/state" "$MIUPY_LOCAL_KEEP/" 2>/dev/null || true
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

command -v docker >/dev/null || { echo "ERRO: docker ausente" >&2; exit 2; }
[[ -x node_modules/.bin/tsx ]] || { echo "ERRO: rode npm ci --workspace @miupy-notes/api antes" >&2; exit 2; }

docker run -d --rm --name "$CONTAINER" -p 127.0.0.1::8000 amazon/dynamodb-local:3.3.1 -jar DynamoDBLocal.jar -inMemory >/dev/null
DB_PORT="$(docker port "$CONTAINER" 8000/tcp | head -n1 | awk -F: '{print $NF}')"
API_PORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
export DYNAMODB_ENDPOINT="http://127.0.0.1:$DB_PORT" NOTES_TABLE_NAME="miupy-validacao-local"
export MIUPY_LOCAL_PORT="$API_PORT" MIUPY_LOCAL_TOKEN_DIR="$WORK/tokens" LOG_FORMAT=json LOG_LEVEL=debug

for _ in $(seq 1 30); do
  node apps/api/scripts/create-local-table.mjs >"$WORK/table.log" 2>&1 && break
  sleep 1
done
grep -q "Tabela" "$WORK/table.log" || { echo "ERRO: DynamoDB Local não respondeu" >&2; cat "$WORK/table.log" >&2; exit 2; }

node_modules/.bin/tsx "$DIR/local-api.ts" >"$WORK/api.log" 2>&1 &
HARNESS_PID=$!
for _ in $(seq 1 30); do
  curl -fs "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://127.0.0.1:$API_PORT/health" >/dev/null || { echo "ERRO: harness não subiu" >&2; cat "$WORK/api.log" >&2; exit 2; }

export MIUPY_LOCAL=1 MIUPY_API_URL="http://127.0.0.1:$API_PORT" MIUPY_VALIDACAO_DIR="$WORK/state"
export MIUPY_ID_TOKEN_FILE="$WORK/tokens/main.jwt" MIUPY_ID_TOKEN_B_FILE="$WORK/tokens/b.jwt"
export MIUPY_ID_TOKEN_NAO_PERMITIDO_FILE="$WORK/tokens/forbidden.jwt" MIUPY_ID_TOKEN_EXPIRADO_FILE="$WORK/tokens/expired.jwt"
export MIUPY_ID_TOKEN_AUD_ERRADA_FILE="$WORK/tokens/wrongaud.jwt"

rc=0
"$DIR/smoke.sh" --local || rc=1
"$DIR/security.sh" --local "$@" || rc=1
# Comando extra opcional (ex.: ensaiar outro script com um `aws` falso no PATH).
if [[ -n "${MIUPY_LOCAL_EXTRA:-}" ]]; then bash -c "$MIUPY_LOCAL_EXTRA" || rc=1; fi

echo
echo "== Logs do harness: sem token, corpo ou marcador de teste =="
leaks=0
for token in "$WORK"/tokens/*.jwt; do
  if grep -qF -f "$token" "$WORK/api.log"; then echo "  [FALHA] token $(basename "$token") aparece nos logs"; leaks=1; fi
done
if grep -Eiq 'Bearer|authorization|eyJ[A-Za-z0-9_-]{10,}|MIUPY_VALIDACAO_MARKER|corpo sintético' "$WORK/api.log"; then echo "  [FALHA] logs contêm Bearer/Authorization/JWT/corpo de teste"; leaks=1; fi
((leaks == 0)) && echo "  [OK]     $(wc -l <"$WORK/api.log") linhas de log sem token, Authorization ou corpo"
((leaks == 0)) || rc=1
exit "$rc"
