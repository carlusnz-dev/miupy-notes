# Infraestrutura Terraform AWS

Base preparada em 2026-10-24: bootstrap separado e módulos IAM, S3 e observabilidade compostos em `environments/dev`. **Estado em 2026-10-27:** bootstrap (estado ainda local) e o ambiente dev (96 recursos, estado no S3) estão aplicados em sa-east-1, verificados só por `curl` e consultas de leitura; veja os relatórios de [bootstrap](../docs/relatorios/2026-10-24_infra-aws-apply.md) e [dev](../docs/relatorios/2026-10-27_infra-aws-dev-apply.md). **O código desta branch remove as chaves KMS próprias e reduz os alarmes ([decisão](../docs/decisoes/2026-10-27_kms-gerenciado-aws.md)); isso ainda não foi aplicado: a conta continua com as quatro chaves do dev, a chave do bootstrap e os 23 alarmes até o próximo apply.** Terraform `>= 1.10.0, < 2.0.0`, execução local com versão oficial `1.17.0`, provider AWS `~> 6.0` travado em `6.70.0`. Contas e valores aprovados entram somente em configuração local ignorada.

```text
infra/
  bootstrap/          # estado: S3 privado/versionado, SSE-S3 e lock S3
  environments/dev/   # composição; backend com chave dev/terraform.tfstate
  modules/
    iam/              # humanos/grupos/roles MFA; runtime/OIDC condicionais
    s3/               # objetos do app e destino separado de access logs (SSE-S3, TLS 1.2+)
    observability/    # logs, SNS, alarmes, dashboard e custo total
```

[Decisão](../docs/decisoes/2026-10-24_infra-aws-base.md), [relatório e verificações](../docs/relatorios/2026-10-24_infra-aws.md), [prefixos/retenção S3](../docs/arquitetura/armazenamento-s3.md), [matriz e primeiro acesso IAM](modules/iam/README.md), [bootstrap/recuperação](bootstrap/README.md) e [alarmes](modules/observability/README.md).

## Runtime HTTP preparado em 2026-10-26

`npm run bundle:lambda --workspace @miupy-notes/api` gera `apps/api/dist/lambda.js` localmente; o provider `archive` monta o ZIP no `plan`, sem upload pelo script. A função usa Node.js 22, `serverless-http` e evento HTTP API v2. `GET /health` é público; `/v1/{proxy+}` exige JWT Google com issuer `https://accounts.google.com` e audience `google_client_id`, depois confere o `sub` na API. Tokens com o issuer alternativo `accounts.google.com`, aceito pela API local, exigem avaliação antes de uso em produção. Origens CORS são exatas em `cors_allowed_origins`.

Preencher `allowed_subs_secret_arn` com ARN exato de segredo **já existente**, cujo `SecretString` contém apenas os `sub` Google autorizados separados por vírgula. O conteúdo nunca entra em tfvars, ambiente Lambda ou estado Terraform. A role só recebe `secretsmanager:GetSecretValue` nesse ARN; a configuração atual pressupõe criptografia do segredo com a chave gerenciada `aws/secretsmanager`. Uma chave de cliente exigiria permissão KMS específica antes de implantar. A allowlist é carregada na inicialização e revalidada a cada 60 segundos por ambiente de execução; falha na atualização nega as requisições privadas. A revogação pode levar até 60 segundos para valer em instâncias quentes.

A tabela única usa `pk`/`sk`, PAY_PER_REQUEST, PITR, proteção de exclusão e criptografia com chave AWS owned (`server_side_encryption { enabled = false }`: sem KMS, sem custo). Não há índice, fila nem acesso S3 na role HTTP. CloudWatch Logs recebe JSON sem corpo, token ou identidade nos grupos com retenção do módulo de observabilidade (criptografia padrão do serviço). A validação local não confirma permissões reais, conexão Google, acesso ao segredo, funcionamento do CORS no Tauri nem custos.

## Limites e pré-requisitos

Antes de qualquer chamada real, o proprietário deve aprovar conta, região, orçamento, destinatário, prefixo, retenções e custo. `us-east-1`, `miupy-dev`, US$ 10/mês e retenções dos exemplos são **propostas**, sem aprovação implícita. `alert_email` e `monthly_budget_usd` não têm default; o exemplo contém somente `voce@example.com`. Não versionar tfvars reais, backend local, estado, planos, credenciais ou conteúdo pessoal. Lambda, HTTP API e tabela DynamoDB do dev foram aplicados em 2026-10-27 (o roteiro `docs/validacao/aws-dev.md` ainda não foi executado); SQS e EventBridge seguem adiados. O segredo de allowlist deve existir fora do Terraform.

1. Preparar identidade externa administrativa com MFA e sessão temporária, permissões revisadas de bootstrap e IAM. Informar seu ARN IAM estável em `initial_provisioner_arn`; ARN STS de sessão não serve. Ela precisa constar nas allowlists para conseguir criar e manter os recursos sem lockout. Não usar root na rotina.
2. Criar bootstrap com identidade externa e depois migrar seu estado. O provisionador do app não recebe administração do backend; as permissões opcionais são somente para o estado dev e seu lock.
3. A instalação inicial do dev também exige identidade externa: a role provisioner não cria humanos, grupos, suas próprias policies ou a boundary protegida. Alterações nesses itens continuam com a identidade externa. Não resolver falhas de autorização anexando AdministratorAccess. Identity Center é a alternativa recomendada para acesso humano recorrente.
4. Após implantação autorizada, IAM → Users → usuário → Security credentials → habilitar acesso ao console, senha temporária e troca obrigatória; cadastrar MFA como administrador externo, com nome do dispositivo igual ao usuário. O humano entra com MFA e usa Switch role para a função atribuída, por exemplo `miupy-dev/miupy-dev-provisioner`. [Procedimento completo](modules/iam/README.md#primeiro-acesso-manual-após-autorização-de-implantação). Senhas/QR/seeds/access keys nunca entram no Terraform; preferir sessões temporárias/SSO. A primeira matrícula MFA é externa, pois a autogestão de substituição exige MFA já presente.
5. Billing and Cost Management → Billing preferences → habilitar **Receive Billing Alerts**. As métricas EstimatedCharges e os alarmes ficam em `us-east-1`; aprovar acesso IAM a Billing se necessário. Ativar em Cost allocation tags as tags `Project` e `Environment` depois de elas aparecerem na conta. Orçamento é TOTAL da conta, sem filtro de serviço/tag.
6. Confirmar **cada** assinatura SNS pelo link Confirm subscription enviado ao e-mail. Até isso ocorrer, fica `PendingConfirmation`. Se a aplicação estiver fora de us-east-1, há também tópico e assinatura de billing nessa região. Confirmar e testar a entrega em manutenção autorizada; nada disso foi feito nesta sessão.

## Ordem futura de execução — não executada nesta entrega

Atualização de continuidade: criação do bootstrap concluída em 2026-10-24. O roteiro abaixo foi preservado como referência; neste checkout, não sobrescrever configurações/estado nem repetir a criação. O próximo passo é preparar a migração conforme o README do bootstrap.

Comandos abaixo partem da raiz do repositório, com Terraform 1.17.0 no PATH e sessão temporária externa já autorizada. Arquivos de configuração devem permanecer privados, inclusive planos (podem conter dados sensíveis). Cada `plan`/`apply` depende de autorização específica para a conta real e revisão de custo/policies.

```sh
umask 077
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
# Preencher somente valores aprovados localmente.
terraform -chdir=infra/bootstrap init -backend=false -input=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
# Revisar plano privado e obter autorização antes de aplicar.
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output
```

Preservar cópia cifrada do estado inicial fora do repositório; ele contém detalhes administrativos. Preencher `backend.hcl` com outputs do bootstrap, com `encrypt=true` e `use_lockfile=true`, **sem `kms_key_id`**: o bucket usa SSE-S3 e nega escrita que peça outro modo SSE.

```sh
cp infra/bootstrap/backend.hcl.example infra/bootstrap/backend.hcl
# Preencher bucket, conta e região; manter key bootstrap/terraform.tfstate.
cp infra/bootstrap/backend.s3.tf.example infra/bootstrap/backend_override.tf
terraform -chdir=infra/bootstrap init -migrate-state -backend-config=backend.hcl
# Confirmar migração somente se o destino estiver correto e vazio/esperado.
cp infra/environments/dev/terraform.tfvars.example infra/environments/dev/terraform.tfvars
cp infra/environments/dev/backend.hcl.example infra/environments/dev/backend.hcl
# Preencher valores aprovados; manter key dev/terraform.tfstate, distinta do bootstrap.
terraform -chdir=infra/environments/dev init -backend-config=backend.hcl
terraform -chdir=infra/environments/dev validate
npm run bundle:lambda --workspace @miupy-notes/api
terraform -chdir=infra/environments/dev plan -out=dev.tfplan
# Revisar plano privado e obter autorização antes de aplicar.
terraform -chdir=infra/environments/dev apply dev.tfplan
```

Se dev já tiver estado local, usar `init -migrate-state`; `-reconfigure` não copia estado. Usar workspace `default`: workspaces adicionais exigem revisar prefixos/permissões. Conferir criptografia, versionamento e lock no destino com acesso autorizado; restaurar backup em ambiente isolado antes de confiar nele. Nunca sobrescrever estado inesperado, executar force-unlock sem comprovar término do escritor, remover `prevent_destroy` do bootstrap para contornar erro ou agendar a exclusão de uma chave KMS antiga enquanto houver dados dependentes. [Recuperação e permissões separadas estado/lock](bootstrap/README.md#permissões-do-backend).

## Composição e ganchos futuros

### Acesso por IP, throttling e concorrência (dev)

O HTTP API v2 não aceita WAF nem resource policy; a defesa em camadas é: (1) `default_route_settings` do stage com `api_throttling_rate_limit` (padrão 5 req/s) e `api_throttling_burst_limit` (padrão 10), que respondem 429 sem invocar a Lambda; (2) `lambda_reserved_concurrency` (padrão 5, máximo aceito 20): **inativa no dev**, onde o valor é `null` porque a conta tem limite de concorrência 10 e não aceita reservar; sem ela o tráfego negado continua invocando a Lambda, limitado só pelo item 1 (até ~13 milhões de invocações/mês a 5 req/s, na ordem de US$ 3–15 com o API Gateway), e a rede de segurança é o budget com alarme; (3) `allowed_cidrs`, repassada à Lambda como `ALLOWED_CIDRS`, que nega com 403 qualquer outra origem, inclusive em `/health`; (4) JWT Google no gateway e allowlist de `sub`. `allowed_cidrs` é obrigatória, validada (sem lista vazia nem `/0`) e `sensitive`; o IP é dado pessoal, por isso só aparece no tfvars local e no estado cifrado (e como variável de ambiente da Lambda, visível a quem tem `lambda:GetFunctionConfiguration`). IP residencial dinâmico exige atualizar o tfvars e reaplicar; mantenha um caminho de recuperação via identidade administrativa. Bloqueio de borda (REST API + resource policy, WAF/CloudFront) ficou fora por custo/reescrita; reavalie após os testes.

A raiz calcula ARNs de roles/buckets de forma determinística, evitando ciclos. Não há chaves KMS próprias: S3 e bootstrap usam SSE-S3, DynamoDB a chave AWS owned, CloudWatch Logs e SNS a criptografia padrão do serviço. O controle de acesso fica em IAM, policies de bucket/tabela e boundary.

A raiz dev agora compõe tabela `<prefix>-data`, role e função Lambda, HTTP API v2 com JWT Google e log groups com retenção. `api_s3_prefixes=[]` mantém runtime sem S3; autorizar prefixos só quando existir consumidor. Objetos têm estrutura preparada, sem funcionalidade HTTP de upload/exportação. IAM compartilhado não isola usuários HTTP: `sub` e chaves derivadas do proprietário continuam no backend.

O ApiId gerado alimenta diretamente os alarmes nativos 5xx e 4xx. Access logs são JSON com `requestId`, `route`, `status` e `responseLatency` numéricos (README de observabilidade) mais `integrationStatus`, `integrationLatency`, `integrationError`, `authorizerError` e `gatewayError`/`gatewayErrorType`, sem IP, corpo, token, identidade ou caminho; Lambda deve usar `LOG_FORMAT=json`. Nomes de função/tabela/grupos devem coincidir com os outputs. Alarmes têm ações SNS ativas e `notBreaching` para dados ausentes; antes dos recursos/telemetria podem ficar em INSUFFICIENT_DATA/OK, sem provar que a aplicação está saudável.

Request metrics S3 e seus alarmes compartilham a flag `enable_s3_request_metrics` e FilterId `EntireBucket`. CloudTrail completo não é criado; `enable_cloudtrail_alarms` só habilita filtros/alarmes e exige uma trilha externa entregando eventos de gerenciamento no grupo de auditoria. `enable_cost_anomaly_detection=false` evita conflito com monitor dimensional existente; revisar antes de ativar. OIDC está desligado e, mesmo ativado, cria só confiança exata sem permissões de deploy.

## Criptografia e TLS em trânsito

| Camada | Estado do código (2026-10-27) |
|---|---|
| S3 (app, logs, estado) | `AES256`. Policy: `DenyInsecureTransport` (`aws:SecureTransport = false`), `DenyOldTLS` (`s3:TlsVersion < 1.2`), `DenyExplicitNonSSES3`. Testado em `modules/s3/tests` e, para o estado, só por leitura (o bootstrap não tem `terraform test`). |
| SNS | Policy `DenyPublishWithoutTLS`; publicadores restritos a CloudWatch/Budgets da conta. Testado em `modules/observability/tests`. |
| API Gateway HTTP API | O endpoint `execute-api` só atende HTTPS (não existe listener HTTP) e usa a política TLS padrão do serviço, TLS 1.2 como mínimo e 1.3 aceito; não há domínio customizado nem `security_policy` a configurar. Esta é a documentação da AWS, não verificada por scan do endpoint. |
| Lambda → DynamoDB / Secrets Manager | SDK v3 com endpoints AWS padrão (HTTPS). `createHandler` recusa iniciar se houver qualquer `AWS_ENDPOINT_URL*` no ambiente; `DYNAMODB_ENDPOINT` só existe em `server.ts` (API local, restrita a loopback). Testado em `apps/api/src/lambda.test.ts`. |
| App (Tauri/React) | CSP em `src-tauri/tauri.conf.json`: `connect-src 'self' ipc: http://ipc.localhost https:` em produção; loopback HTTP/WS só em `devCsp`. O cliente (`apps/web/src/lib/api-base-url.ts`) recusa `VITE_API_BASE_URL` HTTP fora de loopback. Testes de unidade; a CSP não foi exercitada numa janela Tauri. |
| DynamoDB / Logs | Chave AWS owned / criptografia padrão do serviço, sem KMS próprio. |

Perdas e compensações da remoção das CMKs, ordem do apply, migração e reversão: [decisão](../docs/decisoes/2026-10-27_kms-gerenciado-aws.md).

## Estimativa de custo

Proposta em us-east-1, sem créditos, impostos ou tráfego de saída, depois de remover as chaves KMS e reduzir os alarmes. Rever preços e volumes antes de aprovar; os valores abaixo vêm da tabela de preços já citada neste repositório e **não foram reconsultados**.

| Item | Premissa e estimativa mensal |
|---|---|
| KMS | Nenhuma chave própria: US$ 0 (antes: 4 chaves no dev + 1 no bootstrap = US$ 5 fixos). Chaves antigas custam até serem excluídas (janela de 30 dias a partir do agendamento). |
| Alarmes de métrica | 7 da aplicação + 3 de billing = 10 × US$ 0,10 = US$ 1,00 sem franquia; US$ 0 se a conta ainda tem a franquia de 10 alarmes padrão livre. S3 +2 e CloudTrail +2 (opt-in, desligados). Sem alarme composto nem métricas customizadas no padrão. |
| Dashboard | Um, dentro da franquia de três (US$ 3 se a conta já a usou). |
| Logs CloudWatch | Ingestão aproximadamente US$ 0,50/GB e armazenamento aproximadamente US$ 0,03/GB/mês; retenção (30/30/90 dias) e volume determinam o consumo. |
| S3 app/logs/estado | Como exemplo, 1 GB STANDARD total ≈ US$ 0,023/mês, mais versões, requests e transições. SSE-S3 não tem custo por request. |
| DynamoDB | Sob demanda e PITR: custo por uso e por GB; chave AWS owned sem custo. |
| Lambda / HTTP API | Por invocação; o tráfego negado por IP ainda invoca (ver defesa 2). |
| SNS, Budgets, Cost Anomaly | E-mail e franquias gratuitos em uso normal; Budgets sem ações é gratuito; Cost Anomaly desligado. |
| Secrets Manager | US$ 0,40/segredo, criado fora do Terraform (pré-existente). |

**Novo fixo esperado:** entre ~US$ 0,40 (franquias de alarmes e dashboard livres, só o segredo) e ~US$ 4,40 (sem nenhuma franquia: US$ 1,00 de alarmes + US$ 3,00 de dashboard + US$ 0,40 do segredo), sem contar uso variável. Antes: ~US$ 8,10 só com franquias, ~US$ 12,60 sem. A faixa baixa depende de franquias que não foram confirmadas na conta. [KMS](https://aws.amazon.com/kms/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [SNS](https://aws.amazon.com/sns/pricing/), [Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), [CloudTrail](https://aws.amazon.com/cloudtrail/pricing/). Alertas financeiros atrasam horas e **não impõem teto rígido**.

## Validação local segura

Docker estava instalado, mas sem daemon/socket; por orientação explícita do coordenador, usamos o binário oficial 1.17.0 em `/tmp/miupy-infra-terraform/terraform`, SHA256 conferido. Não houve validação em contêiner. Comandos executados e resultados estão no relatório. Para repetir localmente, sem variáveis AWS e sem configuração pessoal da CLI:

```sh
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 TF_CLI_CONFIG_FILE=/dev/null /tmp/miupy-infra-terraform/terraform fmt -check -recursive infra
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 TF_CLI_CONFIG_FILE=/dev/null /tmp/miupy-infra-terraform/terraform -chdir=infra/bootstrap init -backend=false -input=false
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 TF_CLI_CONFIG_FILE=/dev/null /tmp/miupy-infra-terraform/terraform -chdir=infra/bootstrap validate
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 TF_CLI_CONFIG_FILE=/dev/null /tmp/miupy-infra-terraform/terraform -chdir=infra/environments/dev init -backend=false -input=false
env -i PATH=/usr/bin:/bin CHECKPOINT_DISABLE=1 TF_CLI_CONFIG_FILE=/dev/null /tmp/miupy-infra-terraform/terraform -chdir=infra/environments/dev validate
```

Com daemon disponível, equivalentes (não validados nesta sessão):

```sh
docker run --rm -v "$PWD/infra":/work -w /work hashicorp/terraform:1.17.0 fmt -check -recursive
docker run --rm -v "$PWD/infra":/work -w /work/bootstrap hashicorp/terraform:1.17.0 init -backend=false -input=false
docker run --rm -v "$PWD/infra":/work -w /work/bootstrap hashicorp/terraform:1.17.0 validate
docker run --rm -v "$PWD/infra":/work -w /work/environments/dev hashicorp/terraform:1.17.0 init -backend=false -input=false
docker run --rm -v "$PWD/infra":/work -w /work/environments/dev hashicorp/terraform:1.17.0 validate
```

`terraform test` em dev, IAM, S3 e observabilidade usa apenas `mock_provider`: seus comandos `plan` são avaliação sintética sem conta. Não substitui teste de autorização efetiva, assinatura SNS, billing, migração, lifecycle, concorrência do lock ou restauração. Nenhum acesso real está autorizado por estes comandos de documentação. Publicação futura somente após revisão do proprietário: `git push -u origin feat/infra-aws`, seguido de PR para develop; não executado aqui.
