#!/usr/bin/env bash
# DynamoDB dev: configuração da tabela (SSE-KMS, PITR, proteção) e conferência de um item criado via API.
# Somente leitura na AWS. Nunca imprime título, corpo, sub ou outros dados pessoais: só nomes de atributos e metadados.
# `A && ok || fail` é intencional: ok() nunca retorna erro.
# shellcheck disable=SC2015
set -euo pipefail
SCRIPT_NAME=dynamodb
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SKIP_API=0
usage() {
  cat <<'EOF'
Uso: dynamodb.sh [--skip-api]

  --skip-api   só confere a configuração (describe-table / describe-continuous-backups / chave KMS)

Perfil AWS: AWS_PROFILE (ex.: role operator ou provisioner). A leitura do item (get-item) exige
dynamodb:GetItem e kms:Decrypt na chave de dados, hoje concedidos só à role da API: sem isso o passo é
PULADO. Para usar outro perfil só nessa leitura, defina MIUPY_AWS_PROFILE_DADOS.

Variáveis: MIUPY_TF_OUTPUTS_FILE, MIUPY_API_URL, MIUPY_ID_TOKEN[_FILE], AWS_REGION (padrão: região do endpoint).
EOF
}
while (($#)); do
  case "$1" in
    --skip-api) SKIP_API=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "argumento desconhecido: $1" ;;
  esac
  shift
done

need jq aws
TABLE="${MIUPY_DYNAMODB_TABLE:-$(tf_get '.data_table_name.value')}"
KMS_ARN="$(tf_get '.kms_key_arns.value.data')"
BUCKET="$(tf_get '.app_bucket_name.value')"
[[ -n "$TABLE" ]] || die "tabela desconhecida: forneça o output data_table_name (MIUPY_TF_OUTPUTS_FILE) ou MIUPY_DYNAMODB_TABLE."
resolve_api_url
resolve_region
check_aws_identity "$(account_from_bucket "$BUCKET")"
info "tabela: $TABLE"

section "Configuração da tabela"
if aws_run "$WORK/table.json" dynamodb describe-table --table-name "$TABLE" --output json; then
  t="$WORK/table.json"
  jq -e '.Table.TableStatus == "ACTIVE"' "$t" >/dev/null && ok "tabela ACTIVE" || fail "tabela ACTIVE" "$(jq -r .Table.TableStatus "$t")"
  jq -e '[.Table.KeySchema[] | "\(.AttributeName):\(.KeyType)"] == ["pk:HASH", "sk:RANGE"]' "$t" >/dev/null && ok "chaves pk (HASH) + sk (RANGE)" || fail "chaves pk/sk"
  jq -e '(.Table.BillingModeSummary.BillingMode // "") == "PAY_PER_REQUEST"' "$t" >/dev/null && ok "cobrança sob demanda (PAY_PER_REQUEST)" || fail "cobrança sob demanda"
  jq -e '.Table.DeletionProtectionEnabled == true' "$t" >/dev/null && ok "proteção contra exclusão ligada" || fail "proteção contra exclusão ligada"
  jq -e '.Table.SSEDescription.Status == "ENABLED" and .Table.SSEDescription.SSEType == "KMS"' "$t" >/dev/null && ok "SSE-KMS ativo (chave gerenciada pelo cliente)" || fail "SSE-KMS ativo" "SSEDescription ausente: a tabela usa a chave AWS-owned padrão?"
  actual_key="$(jq -r '.Table.SSEDescription.KMSMasterKeyArn // empty' "$t")"
  if [[ -n "$KMS_ARN" && "$actual_key" == "$KMS_ARN" ]]; then ok "chave KMS da tabela é a chave 'data' do Terraform"; else fail "chave KMS da tabela é a chave 'data' do Terraform" "diferente ou ausente"; fi
  jq -e '(.Table.GlobalTableVersion // null) == null and ((.Table.StreamSpecification // null) == null)' "$t" >/dev/null && ok "sem streams nem réplicas globais" || warn "tabela tem stream/réplica global" "não previsto no Terraform"
elif aws_denied; then
  skip "describe-table" "perfil sem dynamodb:DescribeTable ($(aws_err_text))"
else
  fail "describe-table" "$(aws_err_text)"
fi

if aws_run "$WORK/pitr.json" dynamodb describe-continuous-backups --table-name "$TABLE" --output json; then
  jq -e '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus == "ENABLED"' "$WORK/pitr.json" >/dev/null && ok "PITR habilitado" || fail "PITR habilitado"
  earliest="$(jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.EarliestRestorableDateTime // empty' "$WORK/pitr.json")"
  info "restauração possível desde: ${earliest:-n/d (tabela recém-criada)}"
elif aws_denied; then skip "describe-continuous-backups" "perfil sem permissão"
else fail "describe-continuous-backups" "$(aws_err_text)"; fi

section "Chave KMS dos dados"
if [[ -n "$KMS_ARN" ]]; then
  if aws_run "$WORK/key.json" kms describe-key --key-id "$KMS_ARN" --output json; then
    jq -e '.KeyMetadata.KeyState == "Enabled" and .KeyMetadata.KeyManager == "CUSTOMER"' "$WORK/key.json" >/dev/null && ok "chave Enabled e gerenciada pelo cliente" || fail "chave Enabled e gerenciada pelo cliente"
    if aws_run "$WORK/rot.json" kms get-key-rotation-status --key-id "$KMS_ARN" --output json; then
      jq -e '.KeyRotationEnabled == true' "$WORK/rot.json" >/dev/null && ok "rotação automática da chave ligada" || fail "rotação automática da chave ligada"
    elif aws_denied; then skip "rotação da chave" "perfil sem kms:GetKeyRotationStatus"; else fail "rotação da chave" "$(aws_err_text)"; fi
  elif aws_denied; then skip "chave KMS" "perfil sem kms:DescribeKey (esperado para operator)"
  else fail "chave KMS" "$(aws_err_text)"; fi
else
  skip "chave KMS" "output kms_key_arns.data ausente"
fi

if ((SKIP_API)); then summary; exit $?; fi

section "Item gravado pela API"
if ! token_available main; then die "defina MIUPY_ID_TOKEN[_FILE] ou use --skip-api"; fi
need curl
load_token main
require_fresh_token main
init_record
CLEANUPS+=(cleanup_resources finish_record)

CASE=item.create; note_create main dynamodb
expect "POST /v1/notes cria a nota de teste" 201
if [[ -z "$NOTE_ID" ]]; then
  fail "nota de teste criada" "etapas do item puladas"
else
  OWNER_SUB="$(jwt_claim main sub)"
  [[ -n "$OWNER_SUB" ]] || die "token sem claim sub"
  # A chave vai por arquivo (não pela linha de comando) e o sub nunca é impresso.
  jq -n --arg pk "USER#$OWNER_SUB" --arg sk "NOTE#$NOTE_ID" '{pk: {S: $pk}, sk: {S: $sk}}' >"$WORK/key-note.json"
  data_profile=()
  [[ -z "${MIUPY_AWS_PROFILE_DADOS:-}" ]] || data_profile=(--profile "$MIUPY_AWS_PROFILE_DADOS")
  if aws_run "$WORK/item.json" dynamodb get-item "${data_profile[@]}" --table-name "$TABLE" --consistent-read --key "file://$WORK/key-note.json" --output json; then
    if jq -e 'has("Item")' "$WORK/item.json" >/dev/null; then
      ok "item existe na tabela (get-item consistente)"
      info "atributos: $(jq -r '.Item | keys | join(", ")' "$WORK/item.json")"
      jq -e '.Item | has("pk") and has("sk") and has("id") and has("version") and has("createdAt") and has("updatedAt")' "$WORK/item.json" >/dev/null && ok "metadados presentes (pk, sk, id, version, createdAt, updatedAt)" || fail "metadados presentes"
      jq -e --arg pk "USER#$OWNER_SUB" '.Item.pk.S == $pk' "$WORK/item.json" >/dev/null && ok "partição é USER#<sub do token> (isolamento por proprietário)" || fail "partição é USER#<sub do token>"
      jq -e --arg sub "$OWNER_SUB" '.Item.ownerId.S == $sub' "$WORK/item.json" >/dev/null && ok "ownerId gravado coincide com o sub" || fail "ownerId coincide com o sub"
      jq -e '.Item.version.N == "1"' "$WORK/item.json" >/dev/null && ok "version = 1" || fail "version = 1"
      jq -e --arg m "$MARKER" '.Item.body.S | contains($m)' "$WORK/item.json" >/dev/null && ok "corpo gravado como enviado (verificado sem exibir conteúdo)" || fail "corpo gravado como enviado"
    else
      fail "item existe na tabela" "get-item não devolveu Item para a chave esperada"
    fi
  elif aws_denied; then
    skip "get-item do item criado" "perfil sem dynamodb:GetItem/kms:Decrypt (privilégio mínimo: só a role da API lê itens). Use MIUPY_AWS_PROFILE_DADOS com uma sessão autorizada, se quiser este passo."
  else
    fail "get-item do item criado" "$(aws_err_text)"
  fi

  CASE=item.delete; api DELETE "/v1/notes/$NOTE_ID" -k main
  expect "DELETE /v1/notes/{id} remove a nota de teste" 204
  forget_note "$NOTE_ID"
  if [[ -s "$WORK/item.json" ]] && jq -e 'has("Item")' "$WORK/item.json" >/dev/null; then
    if aws_run "$WORK/item-after.json" dynamodb get-item "${data_profile[@]}" --table-name "$TABLE" --consistent-read --key "file://$WORK/key-note.json" --output json; then
      jq -e 'has("Item") | not' "$WORK/item-after.json" >/dev/null && ok "item removido fisicamente após o DELETE" || fail "item removido fisicamente após o DELETE"
    else fail "get-item após o DELETE" "$(aws_err_text)"; fi
  fi
fi

summary
