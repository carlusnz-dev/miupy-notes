#!/usr/bin/env bash
# Smoke do ambiente dev: /health e CRUD mínimo de notas e tarefas com um ID token válido.
# Cria somente recursos marcados "[validacao]" e os remove ao final (inclusive em caso de falha).
set -euo pipefail
SCRIPT_NAME=smoke
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  cat <<'EOF'
Uso: smoke.sh [--local]

Variáveis:
  MIUPY_API_URL            URL da API (padrão: output http_api_endpoint do Terraform)
  MIUPY_TF_OUTPUTS_FILE    JSON de `terraform output -json` (evita consultar o backend)
  MIUPY_ID_TOKEN[_FILE]    ID token do Google do proprietário (prefira o arquivo, modo 600)
  MIUPY_VALIDACAO_DIR      onde gravar os requestIds (padrão ~/.local/state/miupy-validacao)
EOF
}
while (($#)); do
  case "$1" in
    --local) LOCAL=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "argumento desconhecido: $1" ;;
  esac
  shift
done

init_api

section "Saúde"
CASE=health; api GET /health
expect "GET /health" 200
expect_json "GET /health devolve {status: ok}" '.status == "ok"'

section "Notas"
CASE=notes.create; note_create main smoke
expect "POST /v1/notes cria nota" 201
if [[ -z "$NOTE_ID" ]]; then
  fail "id da nota criada é um UUID" "resposta sem id válido; as demais etapas de notas foram puladas"
else
  ok "id da nota criada é um UUID"
  expect_json "nota criada: version 1, corpo gravado, sem ownerId" ".id == \"$NOTE_ID\" and .version == 1 and (.body | contains(\"$MARKER\")) and (has(\"ownerId\") | not)"

  CASE=notes.get; api GET "/v1/notes/$NOTE_ID" -k main
  expect "GET /v1/notes/{id}" 200
  expect_json "nota lida confere com a criada" ".id == \"$NOTE_ID\" and .version == 1 and (.tags == [\"validacao\"])"

  CASE=notes.list; api GET "/v1/notes?limit=5" -k main
  expect "GET /v1/notes?limit=5" 200
  expect_json "lista com items[] e nextCursor" '(.items | type == "array") and has("nextCursor")'

  CASE=notes.metadata; api GET "/v1/notes/metadata?limit=5" -k main
  expect "GET /v1/notes/metadata?limit=5" 200
  expect_json "metadados sem body e sem ownerId" '.items | all((has("body") or has("ownerId")) | not)'

  CASE=notes.summary; api GET "/v1/notes/summary?days=7" -k main
  expect "GET /v1/notes/summary?days=7" 200
  expect_json "resumo traz total e windowDays" 'has("total") and .windowDays == 7'

  jq -n '{version: 1, title: "[validacao] smoke editada"}' >"$WORK/patch.json"
  CASE=notes.patch; api PATCH "/v1/notes/$NOTE_ID" -k main -d "$WORK/patch.json"
  expect "PATCH /v1/notes/{id} com version atual" 200
  expect_json "version avança para 2" '.version == 2'

  CASE=notes.patch-stale; api PATCH "/v1/notes/$NOTE_ID" -k main -d "$WORK/patch.json"
  expect "PATCH com version desatualizada" 409
  expect_json "erro CONFLICT com requestId" '.error.code == "CONFLICT" and (.error.requestId | type == "string")'

  CASE=notes.delete; api DELETE "/v1/notes/$NOTE_ID" -k main
  expect "DELETE /v1/notes/{id}" 204
  forget_note "$NOTE_ID"

  CASE=notes.get-deleted; api GET "/v1/notes/$NOTE_ID" -k main
  expect "GET da nota excluída" 404
fi

section "Tarefas"
TASK_ID="$(new_uuid)"
jq -n --arg id "$TASK_ID" --arg t "[validacao] smoke tarefa" --arg d "$MARKER" '{id: $id, title: $t, description: $d, dueDate: "2030-01-01"}' >"$WORK/task.json"
CASE=tasks.create; api POST /v1/calendar/tasks -k main -d "$WORK/task.json"
expect "POST /v1/calendar/tasks cria tarefa" 201
if [[ "$STATUS" != 201 ]]; then
  fail "tarefa criada" "etapas de tarefas puladas"
else
  CREATED_TASKS+=("$TASK_ID")
  expect_json "tarefa criada: pendente, version 1, sem ownerId" ".id == \"$TASK_ID\" and .status == \"pending\" and .version == 1 and (has(\"ownerId\") | not)"

  CASE=tasks.create-again; api POST /v1/calendar/tasks -k main -d "$WORK/task.json"
  expect "POST repetido com mesmo id e conteúdo é idempotente" 200

  CASE=tasks.get; api GET "/v1/calendar/tasks/$TASK_ID" -k main
  expect "GET /v1/calendar/tasks/{id}" 200

  jq -n '{version: 1, status: "completed"}' >"$WORK/task-patch.json"
  CASE=tasks.complete; api PATCH "/v1/calendar/tasks/$TASK_ID" -k main -d "$WORK/task-patch.json"
  expect "PATCH conclui a tarefa" 200
  expect_json "tarefa concluída com completedAt e version 2" '.status == "completed" and (.completedAt | type == "string") and .version == 2'

  CASE=tasks.list; api GET "/v1/calendar/tasks?status=completed&limit=5" -k main
  expect "GET /v1/calendar/tasks?status=completed" 200
  expect_json "lista de tarefas com items[] e nextCursor" '(.items | type == "array") and has("nextCursor")'

  CASE=tasks.delete-no-version; api DELETE "/v1/calendar/tasks/$TASK_ID" -k main
  expect "DELETE sem version é rejeitado" 400

  CASE=tasks.delete; api DELETE "/v1/calendar/tasks/$TASK_ID?version=2" -k main
  expect "DELETE /v1/calendar/tasks/{id}?version=2" 204
  forget_task "$TASK_ID"

  CASE=tasks.get-deleted; api GET "/v1/calendar/tasks/$TASK_ID" -k main
  expect "GET da tarefa excluída" 404
fi

summary
