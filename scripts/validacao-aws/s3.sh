#!/usr/bin/env bash
# S3 dev: configuração dos buckets do módulo s3 (bloqueio público, versionamento, SSE-S3, TLS-only, lifecycle, logging).
# Somente leitura, exceto com --write-test (um objeto sintético em tmp/uploads/, criado e removido pelo script).
# A API ainda não tem fluxo de arquivos (anexos/exportações estão em "Planejado" em docs/arquitetura/api.md),
# portanto não há upload/download via API para exercitar.
# `A && ok || fail` é intencional: ok() nunca retorna erro.
# shellcheck disable=SC2015
set -euo pipefail
SCRIPT_NAME=s3
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WRITE_TEST=0
usage() {
  cat <<'EOF'
Uso: s3.sh [--write-test]

  --write-test   cria um objeto sintético em tmp/uploads/ (SSE-S3), confere criptografia e conteúdo,
                 testa as negativas (sem SSE e fora dos prefixos aprovados) e remove o objeto.
                 Use o perfil operator (prefixo tmp/uploads/ aprovado). Sem a flag: só leitura de configuração.

Perfil AWS: AWS_PROFILE. As leituras de configuração (get-bucket-*) são do provisionador; o operator só
alcança objetos nos prefixos aprovados, então partes da configuração ficam PULADAS com ele.
Variáveis: MIUPY_TF_OUTPUTS_FILE, AWS_REGION (ou MIUPY_API_URL, de onde se infere a região).
EOF
}
while (($#)); do
  case "$1" in
    --write-test) WRITE_TEST=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "argumento desconhecido: $1" ;;
  esac
  shift
done

need jq aws
APP="$(tf_get '.app_bucket_name.value')"
LOGS="$(tf_get '.access_logs_bucket_name.value')"
[[ -n "$APP" && -n "$LOGS" ]] || die "outputs app_bucket_name/access_logs_bucket_name ausentes."
if [[ -n "${MIUPY_API_URL:-}" || -n "$(tf_get '.http_api_endpoint.value')" ]]; then resolve_api_url; fi
resolve_region
check_aws_identity "$(account_from_bucket "$APP")"

# Confere um bucket; permissões ausentes viram PULADO (o operator não lê a configuração dos buckets).
check_bucket() {
  local kind=$1 bucket=$2 f="$WORK/s3-$1"
  section "Bucket $kind ($bucket)"

  if aws_run "$f.pab" s3api get-public-access-block --bucket "$bucket" --output json; then
    jq -e '.PublicAccessBlockConfiguration | .BlockPublicAcls and .IgnorePublicAcls and .BlockPublicPolicy and .RestrictPublicBuckets' "$f.pab" >/dev/null && ok "bloqueio de acesso público: as 4 opções ligadas" || fail "bloqueio de acesso público: as 4 opções ligadas"
  elif aws_denied; then skip "bloqueio de acesso público" "perfil sem s3:GetBucketPublicAccessBlock"; else fail "bloqueio de acesso público" "$(aws_err_text)"; fi

  if aws_run "$f.ps" s3api get-bucket-policy-status --bucket "$bucket" --output json; then
    jq -e '.PolicyStatus.IsPublic == false' "$f.ps" >/dev/null && ok "política do bucket não é pública" || fail "política do bucket não é pública"
  elif aws_denied; then skip "policy status (IsPublic)" "perfil sem s3:GetBucketPolicyStatus"; else fail "policy status" "$(aws_err_text)"; fi

  if aws_run "$f.own" s3api get-bucket-ownership-controls --bucket "$bucket" --output json; then
    jq -e '.OwnershipControls.Rules[0].ObjectOwnership == "BucketOwnerEnforced"' "$f.own" >/dev/null && ok "ACLs desativadas (BucketOwnerEnforced)" || fail "ACLs desativadas (BucketOwnerEnforced)"
  elif aws_denied; then skip "ownership controls" "perfil sem permissão"; else fail "ownership controls" "$(aws_err_text)"; fi

  if aws_run "$f.ver" s3api get-bucket-versioning --bucket "$bucket" --output json; then
    jq -e '.Status == "Enabled"' "$f.ver" >/dev/null && ok "versionamento habilitado" || fail "versionamento habilitado" "$(jq -c . "$f.ver")"
  elif aws_denied; then skip "versionamento" "perfil sem s3:GetBucketVersioning"; else fail "versionamento" "$(aws_err_text)"; fi

  if aws_run "$f.enc" s3api get-bucket-encryption --bucket "$bucket" --output json; then
    jq -e '.ServerSideEncryptionConfiguration.Rules[0] | .ApplyServerSideEncryptionByDefault.SSEAlgorithm == "AES256" and (.ApplyServerSideEncryptionByDefault.KMSMasterKeyID == null)' "$f.enc" >/dev/null && ok "criptografia padrão SSE-S3 (AES256, sem chave KMS)" || fail "criptografia padrão SSE-S3 (AES256, sem chave KMS)"
  elif aws_denied; then skip "criptografia padrão" "perfil sem s3:GetEncryptionConfiguration"; else fail "criptografia padrão" "$(aws_err_text)"; fi

  if aws_run "$f.pol" s3api get-bucket-policy --bucket "$bucket" --query Policy --output text; then
    cp "$f.pol" "$f.pol.json"
    jq -e '.Statement[] | select(.Sid == "DenyInsecureTransport") | .Effect == "Deny" and .Condition.Bool["aws:SecureTransport"] == "false"' "$f.pol.json" >/dev/null && ok "política nega tráfego sem TLS (aws:SecureTransport=false)" || fail "política nega tráfego sem TLS"
    jq -e '.Statement[] | select(.Sid == "DenyOldTLS") | .Effect == "Deny" and .Condition.NumericLessThan["s3:TlsVersion"] == "1.2"' "$f.pol.json" >/dev/null && ok "política exige TLS ≥ 1.2" || fail "política exige TLS ≥ 1.2"
    jq -e '.Statement[] | select(.Sid == "DenyPrincipalsOutsideAllowlist") | .Effect == "Deny"' "$f.pol.json" >/dev/null && ok "política nega principais fora da allowlist" || fail "política nega principais fora da allowlist"
    jq -e '[.Statement[] | select(.Effect == "Allow" and (.Principal == "*" or .Principal.AWS == "*"))] | length == 0' "$f.pol.json" >/dev/null && ok "nenhum Allow para Principal '*'" || fail "há Allow para Principal '*'"
    jq -e '.Statement[] | select(.Sid == "DenyExplicitNonSSES3") | .Effect == "Deny"' "$f.pol.json" >/dev/null && ok "política nega PutObject com modo SSE explícito diferente de AES256" || fail "política nega PutObject com modo SSE explícito diferente de AES256"
  elif aws_denied; then skip "política do bucket" "perfil sem s3:GetBucketPolicy"; else fail "política do bucket" "$(aws_err_text)"; fi

  if aws_run "$f.lc" s3api get-bucket-lifecycle-configuration --bucket "$bucket" --output json; then
    n="$(jq '[.Rules[] | select(.Status == "Enabled")] | length' "$f.lc")"
    if ((n > 0)); then ok "lifecycle com $n regra(s) ativa(s)" "$(jq -r '[.Rules[].ID] | join(", ")' "$f.lc")"; else fail "lifecycle com regras ativas"; fi
    if [[ "$kind" == app ]]; then
      jq -e '[.Rules[].ID] | contains(["multipart-and-old-versions", "dynamodb-backups"])' "$f.lc" >/dev/null && ok "regras de versões antigas/multipart e de backups presentes" || fail "regras de versões antigas/multipart e de backups presentes"
    fi
  elif aws_denied; then skip "lifecycle" "perfil sem s3:GetLifecycleConfiguration"; else fail "lifecycle" "$(aws_err_text)"; fi

  if [[ "$kind" == app ]]; then
    if aws_run "$f.log" s3api get-bucket-logging --bucket "$bucket" --output json; then
      jq -e --arg t "$LOGS" '.LoggingEnabled.TargetBucket == $t and .LoggingEnabled.TargetPrefix == "logs/"' "$f.log" >/dev/null && ok "server access logging aponta para o bucket de logs (logs/)" || fail "server access logging aponta para o bucket de logs"
    elif aws_denied; then skip "access logging" "perfil sem s3:GetBucketLogging"; else fail "access logging" "$(aws_err_text)"; fi
  fi
}

check_bucket app "$APP"
check_bucket access_logs "$LOGS"

section "Fluxo de arquivos pela API"
skip "upload/download via API" "a API não expõe fluxo de arquivos (anexos/exportações ainda planejados); coberto só por configuração e por --write-test"

if ((WRITE_TEST)); then
  section "Objeto de teste (--write-test)"
  key="tmp/uploads/validacao-$(date -u +%Y%m%dT%H%M%SZ)-$$.txt"
  printf '%s objeto sintético de validação, pode ser apagado\n' "$MARKER" >"$WORK/payload.txt"
  VERSIONS=() OBJ_CLEANED=0
  # Remove as versões criadas; sem s3:DeleteObjectVersion cria um delete marker e a versão expira pelo lifecycle de tmp/uploads/.
  cleanup_object() {
    local v purged=1
    ((OBJ_CLEANED)) && return 0
    OBJ_CLEANED=1
    for v in "${VERSIONS[@]}"; do
      aws --no-cli-pager --region "$REGION" s3api delete-object --bucket "$APP" --key "$key" --version-id "$v" >/dev/null 2>&1 || purged=0
    done
    if ((purged == 0 || ${#VERSIONS[@]} == 0)); then aws --no-cli-pager --region "$REGION" s3api delete-object --bucket "$APP" --key "$key" >/dev/null 2>&1 || true; fi
  }
  CLEANUPS+=(cleanup_object)

  if aws_run "$WORK/put.json" s3api put-object --bucket "$APP" --key "$key" --body "$WORK/payload.txt" --output json; then
    ok "put-object sem header SSE (criptografia padrão do bucket)"
    vid="$(jq -r '.VersionId // empty' "$WORK/put.json")"
    [[ -z "$vid" ]] || VERSIONS+=("$vid")
    if aws_run "$WORK/head.json" s3api head-object --bucket "$APP" --key "$key" --output json; then
      jq -e '.ServerSideEncryption == "AES256"' "$WORK/head.json" >/dev/null && ok "head-object: AES256 (SSE-S3)" || fail "head-object: AES256 (SSE-S3)"
    else fail "head-object" "$(aws_err_text)"; fi
    if aws_run "$WORK/get.json" s3api get-object --bucket "$APP" --key "$key" "$WORK/download.txt" --output json; then
      cmp -s "$WORK/payload.txt" "$WORK/download.txt" && ok "download idêntico ao enviado" || fail "download idêntico ao enviado"
    else fail "get-object" "$(aws_err_text)"; fi
  elif aws_denied; then
    fail "put-object em tmp/uploads/" "negado: o perfil precisa ser operator (s3:PutObject) — $(aws_err_text)"
  else
    fail "put-object em tmp/uploads/" "$(aws_err_text)"
  fi

  # Negativas: devem ser recusadas pela bucket policy / IAM.
  if aws_run "$WORK/neg1.json" s3api put-object --bucket "$APP" --key "tmp/uploads/validacao-sem-sse-$$.txt" --body "$WORK/payload.txt" --server-side-encryption aws:kms --output json; then
    fail "PutObject com SSE-KMS explícito deveria ser negado" "o objeto foi aceito; removendo"
    VERSIONS+=("$(jq -r '.VersionId // empty' "$WORK/neg1.json")")
    aws --no-cli-pager --region "$REGION" s3api delete-object --bucket "$APP" --key "tmp/uploads/validacao-sem-sse-$$.txt" >/dev/null 2>&1 || true
  elif aws_denied; then ok "PutObject com SSE-KMS explícito negado pela bucket policy"
  else fail "PutObject com SSE-KMS explícito negado" "erro inesperado: $(aws_err_text)"; fi

  if aws_run "$WORK/neg2.json" s3api put-object --bucket "$APP" --key "validacao-fora-do-prefixo-$$.txt" --body "$WORK/payload.txt" --output json; then
    fail "PutObject fora dos prefixos aprovados deveria ser negado" "o objeto foi aceito; removendo"
    aws --no-cli-pager --region "$REGION" s3api delete-object --bucket "$APP" --key "validacao-fora-do-prefixo-$$.txt" --version-id "$(jq -r '.VersionId // "null"' "$WORK/neg2.json")" >/dev/null 2>&1 || true
  elif aws_denied; then ok "PutObject fora dos prefixos aprovados negado (IAM de privilégio mínimo)"
  else fail "PutObject fora dos prefixos negado" "erro inesperado: $(aws_err_text)"; fi

  cleanup_object
  if aws_run "$WORK/vers.json" s3api list-object-versions --bucket "$APP" --prefix "$key" --output json; then
    left="$(jq '[(.Versions // [])[]] | length' "$WORK/vers.json")"
    if ((left == 0)); then ok "objeto de teste removido (nenhuma versão restante)"
    else warn "restam $left versão(ões) do objeto de teste" "o operator não tem s3:DeleteObjectVersion; a regra de tmp/uploads/ as expira (tmp_retention_days)"; fi
  else warn "não foi possível listar versões do objeto de teste" "$(aws_err_text)"; fi
else
  skip "objeto de teste (put/get/negativas)" "use --write-test (cria e remove um objeto sintético em tmp/uploads/)"
fi

summary
