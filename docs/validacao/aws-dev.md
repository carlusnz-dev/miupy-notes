# Validação do ambiente AWS dev

> Os scripts já esperam o estado **pós-migração** ([decisão](../decisoes/2026-10-27_kms-gerenciado-aws.md)): SSE-S3, tabela com chave AWS owned e log groups sem KMS. Antes do apply da migração, esses itens falham, o que confirma que ela ainda não foi aplicada.

Roteiro executável (smoke, segurança, DynamoDB, S3, CloudWatch) para rodar **depois do `apply` do ambiente dev**, pelo proprietário. Os scripts ficam em `scripts/validacao-aws/` e **nunca foram executados contra a AWS**: o que foi ensaiado até aqui está em [Estado de verificação](#estado-de-verificação). Não há aprovação do ambiente até o resultado ser registrado em `docs/relatorios/`.

## Resumo dos scripts

| Script | Fala com | Faz | Cria dados? |
|---|---|---|---|
| `smoke.sh` | API (curl) | `/health`; CRUD de notas e tarefas com ID token válido | sim, `[validacao]`, removidos no fim |
| `security.sh` | API (curl) | 401, 403, 400, 413, 404 entre `sub`, CORS, métodos/rotas inesperados, vazamento em erros, rajada (429) | sim, removidos no fim |
| `dynamodb.sh` | AWS CLI + API | chave AWS owned (sem KMS próprio), PITR, proteção contra exclusão; confere o item criado pela API (só metadados) | 1 nota, removida |
| `s3.sh` | AWS CLI | bloqueio público, versionamento, SSE-S3, TLS-only, lifecycle, logging; `--write-test` opcional | só com `--write-test` (objeto sintético em `tmp/uploads/`) |
| `cloudwatch.sh` | AWS CLI | correlaciona requestIds com logs da Lambda e do API Gateway; retenção, descrição dos erros, ausência de token/corpo | não (somente leitura) |
| `run-local.sh` | Docker local | ensaio de smoke/security contra o app real + DynamoDB Local | não toca a AWS |

Convenções: saída `[OK]`/`[FALHA]`/`[PULADO]`/`[AVISO]` por caso, com `apigw=` (header `apigw-requestid`, o `requestId` do access log) e `app=` (header `X-Request-Id`, o `requestId` dos logs da Lambda). Código de saída 1 se houver qualquer `FALHA`; 2 para erro de uso/configuração. Tokens **nunca** são impressos.

## Pré-requisitos

- Ferramentas: `bash` ≥ 4.4, `curl` ≥ 7.55 (usa `-H @arquivo` para o token não aparecer em `ps`), `jq`, AWS CLI v2 e, opcionalmente, `terraform` ≥ 1.10. `run-local.sh` ainda precisa de `docker`, `node` e `npm ci --workspace @miupy-notes/api`.
- Ambiente dev aplicado (com autorização específica do proprietário), segredo da allowlist de `sub` criado e seu `sub` dentro dele.
- Outputs do Terraform. O backend S3 exige credenciais AWS, então salve uma vez, fora do Git:

  ```sh
  mkdir -p ~/.local/state/miupy-validacao
  terraform -chdir=infra/environments/dev output -json > ~/.local/state/miupy-validacao/outputs.json
  export MIUPY_TF_OUTPUTS_FILE=~/.local/state/miupy-validacao/outputs.json
  ```

  Os scripts usam os outputs `http_api_endpoint`, `data_table_name`, `app_bucket_name`, `access_logs_bucket_name` e `log_group_names`. Sem `MIUPY_TF_OUTPUTS_FILE` eles chamam `terraform output -json` por conta própria. `MIUPY_API_URL` substitui o endpoint.
- Região: inferida do endpoint `execute-api`; ou `AWS_REGION`.

### Perfil AWS (privilégio mínimo)

Use `AWS_PROFILE` com a sessão MFA da role humana certa para cada script (roles em `infra/modules/iam/README.md`; sessões duram até 1 h). O que cada perfil alcança, segundo as policies do módulo IAM; **não verificado numa conta real**:

| Script | Perfil | Resultado esperado |
|---|---|---|
| `smoke.sh`, `security.sh` | nenhum (só HTTP) | completo |
| `dynamodb.sh --skip-api`, `dynamodb.sh` | `operator` (`DescribeTable`, `DescribeContinuousBackups`) | tabela e PITR conferidos |
| `dynamodb.sh` (leitura do item) | nenhum perfil humano tem `dynamodb:GetItem` (só a role da API) | `PULADO` com a mensagem de privilégio mínimo; use `MIUPY_AWS_PROFILE_DADOS` só se o proprietário abrir uma sessão autorizada |
| `s3.sh` | `provisioner` (`s3:GetBucket*`, `GetEncryptionConfiguration`, `GetLifecycleConfiguration`) | configuração completa |
| `s3.sh --write-test` | `operator` (prefixo `tmp/uploads/`) | put/head/get/negativas; versão restante é `AVISO` (sem `DeleteObjectVersion`) |
| `cloudwatch.sh` | `operator` ou `monitor` | correlação e vazamento; a leitura de logs antigos cifrados pela CMK extinta pode ser `PULADA` até eles expirarem: registrar |

Na ausência de permissão o script marca `PULADO` e diz qual. Nenhum script amplia permissões nem usa root.

## Obter o ID token sem colá-lo no terminal

O token precisa ter `aud = google_client_id` do ambiente, ser de um `sub` listado em `ALLOWED_SUBS` e dura ~1 h. Os scripts leem `MIUPY_ID_TOKEN_FILE` (preferido, modo 600) ou `MIUPY_ID_TOKEN`.

1. **Pelo app (recomendado; não verificado)**: o app Tauri obtém o token pelo comando `auth_id_token` (`apps/web/src/lib/auth.ts`, `src-tauri/src/auth.rs`), que renova se preciso. Em `npm run tauri dev`, no console das ferramentas de desenvolvimento da janela, execute `navigator.clipboard.writeText(await window.__TAURI_INTERNALS__.invoke("auth_id_token"))` (o nome exato da API global pode variar com a versão do Tauri). Depois, no terminal, sem o token entrar no histórico:

   ```sh
   umask 077; mkdir -p ~/.config/miupy
   wl-paste -n > ~/.config/miupy/id-token      # X11: xclip -o -selection clipboard > ...
   wl-copy --clear                             # limpa a área de transferência
   export MIUPY_ID_TOKEN_FILE=~/.config/miupy/id-token
   ```
2. **Prompt silencioso**: `read -rs MIUPY_ID_TOKEN && export MIUPY_ID_TOKEN` (a digitação não aparece e o valor não vai para o histórico). Cole o token do passo anterior.

Nunca coloque token em argumento de comando, em `.env`, no Git, em relatório ou em chat. Ao terminar: `shred -u ~/.config/miupy/id-token*`. Todos os scripts recusam token expirado antes de chamar a API.

Tokens opcionais, que ligam testes adicionais (sem eles o teste fica `PULADO`):

| Variável (`_FILE` aceito) | Para quê |
|---|---|
| `MIUPY_ID_TOKEN_NAO_PERMITIDO` | token válido de outra conta Google **fora** de `ALLOWED_SUBS` → 403 |
| `MIUPY_ID_TOKEN_B` | token válido de um 2º `sub` **dentro** da allowlist, adicionado só para o teste e removido depois → isolamento entre proprietários (404) |
| `MIUPY_ID_TOKEN_EXPIRADO` | token real já expirado (guarde uma cópia do principal e use-a depois de 1 h) → 401 por `exp` |
| `MIUPY_ID_TOKEN_AUD_ERRADA` | token real emitido para outro client OAuth → 401 por `aud` |
| `MIUPY_ALLOWED_ORIGIN` | origem CORS configurada (ex.: `http://tauri.localhost`) para o teste positivo de preflight |

## Ordem de execução

Rode da raiz do repositório, de um IP permitido, e salve a saída (não contém tokens, mas revise antes de anexar a relatório):

```sh
out=~/.local/state/miupy-validacao; mkdir -p "$out"
scripts/validacao-aws/run-local.sh                       # 0. opcional: ensaio local, sem AWS
scripts/validacao-aws/smoke.sh        2>&1 | tee "$out/saida-smoke.txt"
scripts/validacao-aws/security.sh --burst 300 2>&1 | tee "$out/saida-security.txt"
scripts/validacao-aws/dynamodb.sh     2>&1 | tee "$out/saida-dynamodb.txt"      # AWS_PROFILE=operator
scripts/validacao-aws/s3.sh           2>&1 | tee "$out/saida-s3.txt"            # AWS_PROFILE=provisioner
scripts/validacao-aws/s3.sh --write-test 2>&1 | tee "$out/saida-s3-write.txt"    # AWS_PROFILE=operator
scripts/validacao-aws/cloudwatch.sh --expect-retention 30 2>&1 | tee "$out/saida-cloudwatch.txt"
```

1. `smoke.sh` primeiro: se falhar, pare (token, URL, JWT authorizer ou Lambda). Ele grava os requestIds em `~/.local/state/miupy-validacao/last-smoke.tsv`.
2. `security.sh` (`--burst N` dispara N `GET /health`; `--expect-throttle` torna o 429 obrigatório, só depois de configurar throttling no stage). A rajada pode acionar alarmes de 4xx/limite e e-mails SNS.
3. **De outra rede/IP** (ex.: celular em hotspot): `security.sh --blocked-ip` → espera 403 em `/v1`. Grava `last-security-ip.tsv`, sem sobrescrever o da rodada principal.
4. `dynamodb.sh`, `s3.sh`, `s3.sh --write-test`.
5. `cloudwatch.sh` por último, em até ~1 h depois das requisições (`--wait 180` se a ingestão estiver lenta): lê todos os `last-*.tsv`. `--request-id ID` investiga uma requisição; `--tail lambda|api` mostra os últimos 15 min.

Se um script for interrompido, ele tenta remover o que criou (`trap`). Sobras são notas/tarefas com título/descrição `[validacao]`/`MIUPY_VALIDACAO_MARKER`: liste com `GET /v1/notes/metadata` e remova por `DELETE`.

## Critérios de aprovação

Aprovação do ambiente exige **todos** os itens, com `FALHA = 0` em cada script:

| Script | Aprovado quando | `PULADO`/`AVISO` aceitáveis (registrar o motivo) |
|---|---|---|
| `smoke.sh` | todos `OK` | nenhum |
| `security.sh` (IP permitido) | todos `OK` | tokens opcionais ausentes → aprovação **parcial** do item correspondente; CORS positivo sem `MIUPY_ALLOWED_ORIGIN` |
| `security.sh --blocked-ip` | `GET /v1/notes` com token válido → 403 | — |
| `security.sh --burst N --expect-throttle` | ao menos um 429 e sem 5xx | só após configurar o stage; antes disso o `AVISO` "nenhum 429" é esperado |
| `dynamodb.sh` | tabela ACTIVE, chave AWS owned (sem `SSEDescription`), PITR, proteção de exclusão | leitura do item `PULADA` por privilégio mínimo |
| `s3.sh` | bloqueio público, versionamento, SSE-S3, TLS ≥ 1.2, nenhum Allow para `*`, lifecycle, logging | `PULADO` por permissão do perfil, desde que outro perfil cubra o item |
| `s3.sh --write-test` | put sem header SSE ok (AES256); `aws:kms` explícito e fora do prefixo negados | versão restante do objeto (expira pelo lifecycle) |
| `cloudwatch.sh` | 100% das requisições correlacionadas e com status igual; sem token/`Authorization`/`Bearer`/corpo; retenção definida; erros com mensagem descritiva | `AVISO` de nível `error` só se o teste provocou 5xx |

**Estado esperado hoje.** O código desta branch não tem allowlist de IP (`lambda.ts` não lê `sourceIp`) nem throttling no stage (`runtime.tf` sem `default_route_settings`). Portanto `--blocked-ip` deve **falhar** e a rajada deve dar `AVISO` até as etapas 4 e 5 do plano de `resultado-aws.md`/`arquitetura` serem implementadas. Registre como pendência de infraestrutura, não como defeito dos scripts.

## Estado de verificação

Verificado nesta frente, sem tocar a AWS:

- `bash -n` e `shellcheck` (via contêiner `koalaman/shellcheck`) limpos em todos os `.sh`; `tsc --noEmit` do harness `local-api.ts`.
- `run-local.sh`: `smoke.sh --local` (30 OK) e `security.sh --local --burst 120` (43 OK, 2 PULADO, 1 AVISO) contra o app Express **real** + DynamoDB Local, com JWKS gerado na hora; inclui token expirado e de `aud` errada com assinatura válida, 2º `sub` e `sub` fora da allowlist. O mesmo script confirmou que o log JSON do app não contém token, `Authorization` nem corpo.
- Ramos de falha: `security.sh --blocked-ip` contra a API local falhou como previsto (sem allowlist); `cloudwatch.sh` reprovou ao injetar `Bearer eyJ…` num log falso.
- `dynamodb.sh`, `s3.sh` e `cloudwatch.sh` foram exercitados só com um **`aws` falso** (saídas JSON escritas à mão no formato da CLI, e logs reais do harness). Isso valida a lógica de `jq`, a limpeza e os caminhos de erro, **não** o formato real das respostas da AWS nem as permissões.

**Não verificado** (só possível após o apply): JWT authorizer (assinatura/`iss`/`aud`/`exp` reais; o issuer `https://accounts.google.com` exato), CORS do API Gateway, origem do Tauri, allowlist de IP, throttling, comportamento da Lambda (cold start, formato dos logs), logs reais no CloudWatch, permissões efetivas das roles, `terraform output` pelo backend S3.

Limitações conhecidas dos testes de autenticação: os JWTs sintéticos (expirado, `aud` errada) falham primeiro pela assinatura e só provam o 401; `exp` e `aud` específicos exigem os tokens reais opcionais acima. Erros 401/403 do JWT authorizer têm o corpo `{"message":"Unauthorized"}` do API Gateway (sem o envelope da API); o script só confere o status. Logs de requisições recusadas antes do roteador aparecem com rota `unmatched`.

## Como registrar o resultado

Crie `docs/relatorios/AAAA-MM-DD_aws-validacao.md` (a convenção do índice em `docs/relatorios/README.md`), adicione a linha ao índice e, só para o que foi **aplicado e verificado**, atualize `docs/arquitetura/arquitetura.json` e remova de `docs/arquitetura/api.md` o aviso "não implantada". O relatório deve conter:

1. Data, commit do repositório (`git rev-parse --short HEAD`), região, nome do perfil/role usado (sem ARN nem conta), versões (`aws --version`, `curl --version`, `jq --version`).
2. Por script: comando, contagem `OK/FALHA/PULADO/AVISO` e a lista de `FALHA`/`PULADO`/`AVISO` com o motivo.
3. Requisições de referência: pares `apigw=`/`app=` de 2 ou 3 casos (incluindo um erro) e a linha de log correspondente do `cloudwatch.sh`.
4. Falhas, pendências (allowlist de IP, throttling, tokens opcionais não usados) e comandos **não executados**, sem apresentar nada não rodado como aprovado.
5. Nada de tokens, ID de conta, ARN, URL completa do endpoint, `sub`, e-mail ou conteúdo de notas. Use `****<4 últimos dígitos>` para a conta.

## Variáveis

| Variável | Uso |
|---|---|
| `MIUPY_API_URL` | endpoint HTTPS (padrão: output `http_api_endpoint`) |
| `MIUPY_TF_OUTPUTS_FILE`, `MIUPY_TF_DIR` | JSON de outputs; diretório da raiz Terraform (padrão `infra/environments/dev`) |
| `MIUPY_ID_TOKEN[_FILE]` + variantes `_B`, `_NAO_PERMITIDO`, `_EXPIRADO`, `_AUD_ERRADA` | tokens (ver acima) |
| `MIUPY_ALLOWED_ORIGIN`, `MIUPY_EVIL_ORIGIN` | CORS |
| `MIUPY_AWS_REGION` / `AWS_REGION`, `AWS_PROFILE`, `MIUPY_AWS_PROFILE_DADOS` | AWS CLI |
| `MIUPY_DYNAMODB_TABLE`, `MIUPY_EXPECT_LOG_RETENTION` | sobrescrevem tabela e retenção esperada |
| `MIUPY_VALIDACAO_DIR` | registros de requisições (padrão `~/.local/state/miupy-validacao`) |
| `MIUPY_TIMEOUT`, `MIUPY_BURST_PARALLEL` | timeout por requisição (30 s) e paralelismo da rajada (50) |
| `MIUPY_LOCAL_KEEP`, `MIUPY_LOCAL_EXTRA` | só `run-local.sh`: guarda logs/registros; executa comando extra |
