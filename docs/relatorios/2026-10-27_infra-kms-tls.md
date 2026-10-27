# Relatório: infra sem KMS próprio, TLS e ressalvas da revisão (2026-10-27)

Branch `feat/infra-aws`, sem push, sem `plan`/`apply` e sem chamada à AWS. Decisão e plano de migração: [2026-10-27_kms-gerenciado-aws.md](../decisoes/2026-10-27_kms-gerenciado-aws.md).

## Mudanças
- **KMS removido do código** (módulo `infra/modules/kms` apagado; S3 e estado em SSE-S3; DynamoDB com chave AWS owned; Logs e SNS sem KMS; policies IAM de KMS removidas). Blocos `removed` com `destroy = false` esquecem as chaves sem agendar exclusão; `moved` evita recriar a configuração de criptografia do S3.
- **TLS**: deny de HTTP e de TLS < 1.2 nos buckets (app, logs e estado); `DenyPublishWithoutTLS` nos tópicos SNS; Lambda recusa `AWS_ENDPOINT_URL*`; CSP do Tauri (`connect-src` HTTPS remoto, loopback só em `devCsp`); cliente web recusa HTTP fora de loopback (`apps/web/src/lib/api-base-url.ts`).
- **M1**: `api.md`, `stacks.md`, `apps/api/README.md`, `infra/README.md`, `infra/modules/s3/README.md` e demais READMEs atualizados. **M2**: provisioner com API Gateway v2 restrito (`/apis`, `/apis/*`, `/tags/*`) e leituras `s3:Get*` do provider; ações KMS removidas. `secretsmanager:DescribeSecret` não foi adicionado: nenhum recurso Terraform lê o segredo. **M3**: 7 alarmes de métrica + 3 de billing (antes 23 + composto), tabela de custo reescrita e texto da concorrência reservada corrigido (inativa no dev).
- **B1** `expose_headers` no CORS (cobre `GET /health`, pois o CORS é da API inteira); **B4** `handler` separa falha de inicialização de falha da invocação, com novo evento `lambda.invoke_failed`; **B5** coberto em `armazenamento-s3.md`.
- Scripts `scripts/validacao-aws/{s3,dynamodb,cloudwatch}.sh` e `docs/validacao/aws-dev.md` passam a esperar o estado pós-migração.

## Verificação executada
| Comando | Resultado |
|---|---|
| `terraform fmt -check -recursive infra` | ok |
| `init -backend=false` + `validate` em `bootstrap`, `environments/dev`, `modules/iam`, `modules/s3` | ok (bootstrap avisa de `kms_deletion_window_days` não declarado no tfvars local) |
| `terraform test` iam / s3 / observability / dev | 8/8, 1/1, 1/1, 4/4 |
| `npm run build`, `npm run check:modules`, `npm run bundle:lambda` | ok |
| `env -u DYNAMODB_TEST_ENDPOINT npm run test:api` | 238 testes: 228 pass, 0 fail, 10 skipped (DynamoDB Local) |
| `npm run test:web` | 212 pass, 0 fail |
| `bash -n scripts/validacao-aws/*.sh`, `git diff --check` | ok |

## Não verificado
- `terraform plan` real: a lista de recursos afetados é estimativa a partir do código. Em particular, o provider pode se comportar diferente do suposto na troca de `server_side_encryption` da tabela e na desassociação de KMS dos log groups.
- `modules/observability` isolado não valida (alias `aws.billing`); coberto pelo `validate` do dev e por seu `terraform test`. Bootstrap não tem `terraform test`.
- A CSP não foi exercitada numa janela Tauri nem em navegador (o Chrome do Playwright não está instalado; não baixei). Risco: estilos injetados pelo CodeMirror/GSAP e capas externas.
- Que CloudWatch Alarms e Budgets não publicam em SNS cifrado com `alias/aws/sns`, a política TLS do endpoint `execute-api` e as franquias de alarmes/dashboard da conta vêm da documentação da AWS, não da conta.
- Scripts de validação só passaram em `bash -n`; roteiro `aws-dev.md` não executado.
- Um `rg` com glob amplo imprimiu uma linha de comentário do `terraform.tfvars` local; nenhum valor foi lido ou registrado.
