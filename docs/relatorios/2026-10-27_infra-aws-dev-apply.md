# 2026-10-27 — Infra AWS dev aplicado, logs descritivos e validação preparada

Coordenação pelo Orca (Run `run_63bb3a0d1df4`), workers Sonnet em worktrees; briefs e resultados fora do Git em `/home/cabeto/orca/workspaces/miupy-notes/.briefs-analise-2026-10-27/`.

## O que mudou

- `AGENTS.md` (branch `chore/skills-permissoes-e-relatorios`, `2ec3793`, com push): regra de logs descritivos em erros.
- `feat/habits-mvp` (`07480f2`, sem push): erros 500 registram serviço, operação, status do provedor, cadeia de causas e origem, sem tokens/conteúdo. Falha ao obter o JWKS do Google passa a ser `500` descritivo em vez de log enganoso ("serviço de dados") ou `401` silencioso. Causa do 500 relatado pelo proprietário não confirmada no ambiente dele; módulo de hábitos sem 500 contra DynamoDB Local.
- `feat/infra-aws`:
  - `956555d` allow list de IP na Lambda (`ALLOWED_CIDRS`, `requestContext.http.sourceIp`, fail-closed, `403 ORIGIN_NOT_ALLOWED`, IP mascarado no log, inclui `/health`); logs de erro com módulo/operação/dependência.
  - `c34695d` throttling do stage (5/s, rajada 10), `allowed_cidrs` obrigatória, access log com erros de integração/authorizer.
  - `2f7e8a8` key policy KMS permite `kms:CreateGrant` via DynamoDB a root/administradores (necessário ao `CreateTable` com CMK); `lambda_reserved_concurrency` aceita `null`.
  - `075ed86` merge de `feat/infra-aws-validacao` (scripts `scripts/validacao-aws/*.sh`, guia `docs/validacao/aws-dev.md`).

## Decisões

- Allow list de IP na Lambda (sem WAF/REST): custo zero, mantém JWT nativo do HTTP API; requisição negada ainda invoca a Lambda.
- Reserva de concorrência desligada no dev: conta com limite de 10 execuções simultâneas não aceita reservar. Teto de custo fica no throttling do stage.
- Plan e apply executados como root a pedido explícito do proprietário (o login IAM no console falhou). `initial_provisioner_arn` no tfvars aponta para `user/miupy-notes-bootstrap`, causa do primeiro erro KMS ao aplicar com `user/miupy-provider`.

## Verificação real

- Plan inicial: 61 a criar, 0 destruir. Primeiro apply (proprietário, `miupy-provider`): KMS `MalformedPolicyDocumentException` (lockout check). Segundo apply (root): falhou só em `aws_dynamodb_table.data` (`kms:CreateGrant` negado). Após `2f7e8a8`: plan 9 a criar, 1 a alterar, 0 destruir; `Apply complete! Resources: 9 added, 1 changed, 0 destroyed`. Estado dev no S3: 96 recursos gerenciados.
- `terraform fmt -check`, `validate`, `terraform test` (dev 4, kms 3) aprovados após as mudanças.
- `curl` no endpoint `execute-api` (sa-east-1): `GET /health` 200; `GET /v1/notes` sem token 401; `Bearer` inválido 401. Log da Lambda no CloudWatch com `requestId`, rota, status e duração.
- Worker: `test:api` 226 ok/10 ignorados, build, `check:modules`, `bundle:lambda` em `feat/infra-aws`; `test:api` 242 ok/10 ignorados e `test:web` 210 ok em `feat/habits-mvp`.
- Scripts de validação: `bash -n` e shellcheck limpos; ensaio local (`run-local.sh`) smoke 30 OK, security 41 OK; scripts AWS só com CLI falsa.
- App rodado na worktree `habits-mvp` (`npm run tauri dev`, API 4000, DynamoDB Local): requisições de agenda, notas e `/v1/habits/*` 200/304, sem `ERROR` no log; janela fechada depois.

## Não verificado

CRUD com ID token real, 403 por IP de outra rede, 429 real, persistência no DynamoDB AWS, S3 e correlação CloudWatch (roteiro pronto, não executado). Confirmação das inscrições SNS. Custo fixo estimado (~US$ 7–8/mês, KMS e alarmes) não conferido em fatura.

## Pendências

- Proprietário: confirmar SNS; corrigir `initial_provisioner_arn` para a identidade que fará os próximos applies; manter `lambda_reserved_concurrency = null` no tfvars ou pedir aumento de quota; migrar estado do bootstrap para S3; MFA no root e encerrar sessão root da CLI; confirmar rotação da chave de acesso exposta em chat.
- Executar `docs/validacao/aws-dev.md` (smoke → security → `--blocked-ip` → dynamodb → s3 → cloudwatch) e registrar resultado.
- Merges: security → habits → infra-aws (conflito em `apps/api/src/lambda.ts` e arquivos de `core/` com o fix de logs) → MCP; decisão do proprietário sobre MCP remoto.
- `task-google-sync.ts` ainda engole erro do Google Tasks sem log.
