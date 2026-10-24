# Módulo S3 do app

Cria bucket privado SSE-KMS do app e destino separado SSE-S3 para access logging. Sem recursos implantados, upload implementado, CORS ou marcadores de diretório. Contrato de dados, prefixos, riscos de lockout/recuperação e custos em [armazenamento-s3.md](../../../docs/arquitetura/armazenamento-s3.md).

## Interface

Obrigatórios: `name_prefix` (3–31 caracteres minúsculos/números/hífens), `account_id` (12 dígitos), `aws_region`, `tags` (`map(string)`), `provisioner_arn` (ARN IAM estável desta conta) e `kms_key_arn` (ARN da chave dedicada desta conta/região).

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

Monte `arn:aws:s3:::${name_prefix}-${account_id}-app` na raiz para `s3_bucket_arns` da instância KMS. Assim a chave pode existir antes do S3, sem ciclo. Allowlist não concede ações IAM; raiz deve fornecer roles reais e permissões mínimas nos prefixos corretos. Role API ainda sem implementação/permissões S3 não deve ser ativada por este módulo.

A policy exige os dois headers SSE-KMS, mesmo com criptografia padrão e Bucket Key. Denies usam `s3:*` apenas para proteger todas as ações nos ARNs destes buckets. Demais Allows enumeram ações. `force_destroy = false` evita apagar bucket com objetos, mas não impede expiração de lifecycle ou exclusão explícita de versões por administrador.

## Verificação real em 2026-10-24

Da raiz do checkout, com binário oficial fornecido pelo coordenador:

```sh
env -i PATH=/usr/bin:/bin HOME=/tmp/miupy-infra-terraform TF_DATA_DIR=/tmp/miupy-s3-tfdata /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/s3 init -backend=false -input=false
env -i PATH=/usr/bin:/bin HOME=/tmp/miupy-infra-terraform TF_DATA_DIR=/tmp/miupy-s3-tfdata /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/s3 validate -no-color
/tmp/miupy-infra-terraform/terraform fmt -check -recursive infra/modules/s3
```

`init` instalou AWS `6.70.0` assinado por HashiCorp e gerou lockfile versionado; `validate` retornou `Success! The configuration is valid.` após corrigir incompatibilidade de tipos entre statements condicionais de policy; `fmt -check` passou. Execução sem variáveis AWS, sem ler credenciais e com cache fora do checkout. Terraform `1.17.0`; requisito `>= 1.10.0, < 2.0.0`, provider `~> 6.0`.

Tentativa real com `env -i PATH=/usr/bin:/bin HOME=/tmp/miupy-infra-terraform docker run --rm -v "$PWD":/work -w /work hashicorp/terraform:1.17.0 fmt -check -recursive infra/modules` falhou: `dial unix /var/run/docker.sock: connect: no such file or directory`. Não houve validação em Docker, plan, apply, chamadas a conta AWS, teste de autorização efetiva, entrega de logs ou lifecycle real. A raiz integrada será validada pelo coordenador.

Avaliação adicional: `python3 /tmp/miupy-review-s3-policy.py` extraiu as expressões de policy para scratch puro, substituindo somente referências dos recursos por ARNs sintéticos. `terraform console` gerou JSONs de app e logs (5 statements cada); assertions de allowlist/provisionador, TLS 1.2, chave exigida no app, serviço S3 e destino `logs/*` passaram. Harness temporário fora do Git; não simula autorização real. Revisão cruzada por leitura da frente IAM foi enviada ao coordenador: ausência de CreateKey/gestão de alias na policy provisionadora e necessidade de matrícula inicial MFA pelo proprietário ou ajuste da permissão de enrollment.
