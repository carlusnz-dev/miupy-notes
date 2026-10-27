# Módulo S3 do app

Cria o bucket privado do app e o destino separado de access logging, ambos com SSE-S3 (`AES256`, chave gerenciada pelo S3, sem custo por request). Aplicado no dev em 2026-10-27 com SSE-KMS (versão anterior); o modo SSE-S3 descrito aqui está só no código até o próximo apply ([decisão](../../../docs/decisoes/2026-10-27_kms-gerenciado-aws.md)). Sem upload implementado, CORS ou marcadores de diretório. Contrato de dados, prefixos, riscos de lockout/recuperação e custos em [armazenamento-s3.md](../../../docs/arquitetura/armazenamento-s3.md).

## Interface

Obrigatórios: `name_prefix` (3–31 caracteres minúsculos/números/hífens), `account_id` (12 dígitos), `aws_region`, `tags` (`map(string)`) e `provisioner_arn` (ARN IAM estável desta conta).

| Opcionais | Tipo | Default proposto |
|---|---|---|
| `allowed_principal_arns` | `list(string)` | `[]`; raiz e provisionador são acrescentados automaticamente |
| `enable_request_metrics` | `bool` | `false`; quando ativo, `FilterId = EntireBucket` |
| `exports_retention_days` | `number` inteiro positivo | 30 |
| `imports_retention_days` | `number` inteiro positivo | 7 |
| `tmp_retention_days` | `number` inteiro positivo | 1 |
| `noncurrent_retention_days` | `number` inteiro positivo | 90 |
| `backup_transition_days` | `number` inteiro positivo | 90 |
| `backup_retention_days` | `number` inteiro positivo | 365; mínimo transição + 90 |
| `access_logs_retention_days` | `number` inteiro positivo | 90 |

Outputs: `bucket_name`, `bucket_arn`, `access_logs_bucket_name`, `access_logs_bucket_arn`. Nomes `${name_prefix}-${account_id}-app` e `${name_prefix}-${account_id}-access-logs`; apenas partição comercial `aws`. O provider é recebido da raiz, que deve usar `aws_region`; não há descoberta de conta/identidade.

Monte `arn:aws:s3:::${name_prefix}-${account_id}-app` na raiz para as policies IAM, sem ciclo com o módulo. Allowlist não concede ações IAM; raiz deve fornecer roles reais e permissões mínimas nos prefixos corretos. Role API ainda sem implementação/permissões S3 não deve ser ativada por este módulo.

Policy dos dois buckets: `DenyInsecureTransport` (`aws:SecureTransport = false`), `DenyOldTLS` (`s3:TlsVersion < 1.2`), `DenyPrincipalsOutsideAllowlist` e `DenyExplicitNonSSES3`. Os dois primeiros isentam principais de serviço (a entrega de access logs é interna ao S3). A criptografia padrão aplica `AES256`, então o upload não precisa de header SSE; o último deny barra só quem pede explicitamente outro modo (por exemplo `aws:kms`). Futuro código de upload: não envie `x-amz-server-side-encryption` ou envie `AES256`. Denies usam `s3:*` apenas para proteger todas as ações nos ARNs destes buckets. Demais Allows enumeram ações. `force_destroy = false` evita apagar bucket com objetos, mas não impede expiração de lifecycle ou exclusão explícita de versões por administrador.

## Verificação

`terraform test` (`tests/policies.tftest.hcl`, provider simulado) confere os quatro denies, `aws:SecureTransport = false`, `s3:TlsVersion < 1.2` e `AES256` nos dois buckets. Não substitui `plan` real, teste de autorização efetiva, entrega de logs ou lifecycle real; esses itens seguem em `docs/validacao/aws-dev.md`.
