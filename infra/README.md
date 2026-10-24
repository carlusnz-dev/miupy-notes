# Infraestrutura Terraform AWS

Base preparada e validada localmente em 2026-10-24: bootstrap separado e módulos IAM, KMS, S3 e observabilidade compostos em `environments/dev`. **Nada implantado; nenhum plan contra conta ou acesso AWS real.** Terraform `>= 1.10.0, < 2.0.0`, execução local com versão oficial `1.17.0`, provider AWS `~> 6.0` travado em `6.70.0`. Contas e valores aprovados entram somente em configuração local ignorada.

```text
infra/
  bootstrap/          # estado: S3 privado/versionado, SSE-KMS e lock S3
  environments/dev/   # composição; backend com chave dev/terraform.tfstate
  modules/
    iam/              # humanos/grupos/roles MFA; runtime/OIDC condicionais
    kms/              # chaves separadas por finalidade e perímetro explícito
    s3/               # objetos do app e destino separado de access logs
    observability/    # logs, SNS, alarmes, dashboard e custo total
```

[Decisão](../docs/decisoes/2026-10-24_infra-aws-base.md), [relatório e verificações](../docs/relatorios/2026-10-24_infra-aws.md), [prefixos/retenção S3](../docs/arquitetura/armazenamento-s3.md), [matriz e primeiro acesso IAM](modules/iam/README.md), [bootstrap/recuperação](bootstrap/README.md) e [alarmes](modules/observability/README.md).

## Limites e pré-requisitos

Antes de qualquer chamada real, o proprietário deve aprovar conta, região, orçamento, destinatário, prefixo, retenções e custo. `us-east-1`, `miupy-dev`, US$ 10/mês e retenções dos exemplos são **propostas**, sem aprovação implícita. `alert_email` e `monthly_budget_usd` não têm default; o exemplo contém somente `voce@example.com`. Não versionar tfvars reais, backend local, estado, planos, credenciais ou conteúdo pessoal. Não há Lambda, API Gateway, tabela DynamoDB, SQS, Secrets Manager ou EventBridge criados por esta base.

1. Preparar identidade externa administrativa com MFA e sessão temporária, permissões revisadas de bootstrap e IAM/KMS. Informar seu ARN IAM estável em `initial_provisioner_arn`; ARN STS de sessão não serve. Ela precisa constar nas allowlists para conseguir criar e manter os recursos sem lockout. Não usar root na rotina.
2. Criar bootstrap com identidade externa e depois migrar seu estado. O provisionador do app não recebe administração do backend; as permissões opcionais são somente para o estado dev e seu lock.
3. A instalação inicial do dev também exige identidade externa: a role provisioner não cria chaves KMS, humanos, grupos, suas próprias policies ou a boundary protegida. Alterações nesses itens e aliases KMS continuam com a identidade externa. Não resolver falhas de autorização anexando AdministratorAccess. Identity Center é a alternativa recomendada para acesso humano recorrente.
4. Após implantação autorizada, IAM → Users → usuário → Security credentials → habilitar acesso ao console, senha temporária e troca obrigatória; cadastrar MFA como administrador externo, com nome do dispositivo igual ao usuário. O humano entra com MFA e usa Switch role para a função atribuída, por exemplo `miupy-dev/miupy-dev-provisioner`. [Procedimento completo](modules/iam/README.md#primeiro-acesso-manual-após-autorização-de-implantação). Senhas/QR/seeds/access keys nunca entram no Terraform; preferir sessões temporárias/SSO. A primeira matrícula MFA é externa, pois a autogestão de substituição exige MFA já presente.
5. Billing and Cost Management → Billing preferences → habilitar **Receive Billing Alerts**. As métricas EstimatedCharges e os alarmes ficam em `us-east-1`; aprovar acesso IAM a Billing se necessário. Ativar em Cost allocation tags as tags `Project` e `Environment` depois de elas aparecerem na conta. Orçamento é TOTAL da conta, sem filtro de serviço/tag.
6. Confirmar **cada** assinatura SNS pelo link Confirm subscription enviado ao e-mail. Até isso ocorrer, fica `PendingConfirmation`. Se a aplicação estiver fora de us-east-1, há também tópico/assinatura/chave exclusivos de billing nessa região. Confirmar e testar a entrega em manutenção autorizada; nada disso foi feito nesta sessão.

## Ordem futura de execução — não executada nesta entrega

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

Preservar cópia cifrada do estado inicial fora do repositório; ele contém detalhes administrativos. Preencher `backend.hcl` com outputs do bootstrap, incluindo ARN exato da chave KMS, `encrypt=true` e `use_lockfile=true`. Headers SSE-KMS são obrigatórios no bucket; confiar apenas na criptografia padrão impede escrever estado e lock.

```sh
cp infra/bootstrap/backend.hcl.example infra/bootstrap/backend.hcl
# Preencher bucket, conta, região e ARN KMS; manter key bootstrap/terraform.tfstate.
cp infra/bootstrap/backend.s3.tf.example infra/bootstrap/backend_override.tf
terraform -chdir=infra/bootstrap init -migrate-state -backend-config=backend.hcl
# Confirmar migração somente se o destino estiver correto e vazio/esperado.
cp infra/environments/dev/terraform.tfvars.example infra/environments/dev/terraform.tfvars
cp infra/environments/dev/backend.hcl.example infra/environments/dev/backend.hcl
# Preencher valores aprovados; manter key dev/terraform.tfstate, distinta do bootstrap.
terraform -chdir=infra/environments/dev init -backend-config=backend.hcl
terraform -chdir=infra/environments/dev validate
terraform -chdir=infra/environments/dev plan -out=dev.tfplan
# Revisar plano privado e obter autorização antes de aplicar.
terraform -chdir=infra/environments/dev apply dev.tfplan
```

Se dev já tiver estado local, usar `init -migrate-state`; `-reconfigure` não copia estado. Usar workspace `default`: workspaces adicionais exigem revisar prefixos/permissões. Conferir criptografia, versionamento e lock no destino com acesso autorizado; restaurar backup em ambiente isolado antes de confiar nele. Nunca sobrescrever estado inesperado, executar force-unlock sem comprovar término do escritor, remover `prevent_destroy` do bootstrap para contornar erro ou excluir chave enquanto houver dados dependentes. [Recuperação e permissões separadas estado/lock](bootstrap/README.md#permissões-do-backend).

## Composição e ganchos futuros

A raiz calcula ARNs de roles/buckets/log groups de forma determinística, evitando ciclos. KMS usa a conta em Principal e `aws:PrincipalArn` exato para delegar a roles presentes/futuras, exigindo também policy IAM; não dá Allow direto a uma sessão STS. A identidade externa inicial é preservada no perímetro. Logs/SNS têm chave própria, objetos têm outra, e bootstrap tem chave exclusiva; outra região acrescenta uma chave billing. O bucket de logs S3 usa SSE-S3 por exigência do serviço de server access logging.

`enable_api_role=false`: informar tabela futura `<prefix>-data` em `api_table_arn` e habilitar a flag somente junto à implantação aprovada. Não cria tabela/função. `api_s3_prefixes=[]` mantém runtime sem S3; autorizar prefixos só quando existir consumidor. Objetos têm estrutura preparada, sem funcionalidade HTTP de upload/exportação. IAM compartilhado não isola usuários HTTP: `sub` e chaves derivadas do proprietário continuam no backend.

HTTP API tem ApiId gerado: `api_id=null` prepara alarmes por logs; fornecer o ID depois ativa as três métricas nativas. Access logs futuros devem ser JSON com `status` e `responseLatency` numéricos, conforme README de observabilidade, sem corpo/token/identidade; Lambda deve usar `LOG_FORMAT=json`. Nomes de função/tabela/grupos devem coincidir com os outputs. Alarmes têm ações SNS ativas e `notBreaching` para dados ausentes; antes dos recursos/telemetria podem ficar em INSUFFICIENT_DATA/OK, sem provar que a aplicação está saudável.

Request metrics S3 e seus alarmes compartilham a flag `enable_s3_request_metrics` e FilterId `EntireBucket`. CloudTrail completo não é criado; `enable_cloudtrail_alarms` só habilita filtros/alarmes e exige uma trilha externa entregando eventos de gerenciamento no grupo de auditoria. `enable_cost_anomaly_detection=false` evita conflito com monitor dimensional existente; revisar antes de ativar. OIDC está desligado e, mesmo ativado, cria só confiança exata sem permissões de deploy.

## Estimativa de custo — proposta em us-east-1

Sem créditos/free tier garantidos, impostos ou tráfego de saída. Rever preços/volumes/região antes de qualquer aprovação:

| Item | Premissa e estimativa mensal |
|---|---|
| KMS | Três chaves contando bootstrap: cerca de US$ 3 antes de chamadas; outra região acrescenta US$ 1 para billing. As duas primeiras rotações acrescentam até US$ 2/chave no preço do material. |
| Alarmes | 23 simples padrão × US$ 0,10 + um composto × US$ 0,50 ≈ US$ 2,80. API nativa +3, S3 +2 e CloudTrail +2 se ativados. |
| Métricas customizadas | Cinco filtros de logs, aproximadamente US$ 0,30/métrica/mês fora das franquias: até US$ 1,50; segurança adiciona duas. S3 request metrics têm custo adicional. |
| Dashboard | Um, até US$ 3/mês fora da franquia de três; franquias dependem do uso total da conta. |
| Logs CloudWatch | Ingestão aproximadamente US$ 0,50/GB e armazenamento aproximadamente US$ 0,03/GB/mês; retenção e volume determinam consumo. |
| S3 app/logs/estado | Como exemplo, 1 GB STANDARD total ≈ US$ 0,023/mês, mais versões, requests, transições/recuperação Glacier e transferência. Não há carga aprovada ou dados migrados. |
| SNS | Publicações/entrega de e-mail variam por volume e franquia; reservar margem para alertas. Nenhuma entrega foi testada. |
| Budgets | Monitoramento/notificações gratuitos; os dois primeiros budgets gratuitos referem-se à opção com ações, que não usamos. |
| CloudTrail | Primeira cópia de gerenciamento gratuita no serviço; S3/logs custam. Trilha completa e eventos de dados não foram habilitados. |
| Cost Anomaly Detection | Opção de monitoramento sem tarifa adicional do serviço; notificações/serviços associados podem cobrar; desligada. |

Piso ilustrativo sem franquias: chaves+alarmes+métricas+dashboard ≈ US$ 10,30/mês, antes de ingestão/S3/SNS e futuras Lambda/API/DynamoDB; pode ultrapassar a proposta de orçamento de US$ 10. Com dashboard na franquia, esses itens seriam cerca de US$ 7,30. Aprovar orçamento/escopo após revisar o uso total da conta. [KMS](https://aws.amazon.com/kms/pricing/), [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [SNS](https://aws.amazon.com/sns/pricing/), [Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), [CloudTrail](https://aws.amazon.com/cloudtrail/pricing/). Alertas financeiros atrasam horas e **não impõem teto rígido**.

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

`terraform test` em dev, IAM e KMS usa apenas `mock_provider`: seus comandos `plan` são avaliação sintética sem conta. Não substitui teste de autorização efetiva, assinatura SNS, billing, migração, lifecycle, concorrência do lock ou restauração. Nenhum acesso real está autorizado por estes comandos de documentação. Publicação futura somente após revisão do proprietário: `git push -u origin feat/infra-aws`, seguido de PR para develop; não executado aqui.
