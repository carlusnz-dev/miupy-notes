# Observabilidade

Código Terraform para RNF-02/RNF-04. Aplicado no dev em 2026-10-27 (versão anterior, com chaves KMS e 23 alarmes); a versão deste texto está **só no código**, ainda sem apply (ver [decisão](../../../docs/decisoes/2026-10-27_kms-gerenciado-aws.md)). O módulo não cria Lambda, API Gateway, DynamoDB, chave KMS ou trilha CloudTrail, e não altera contrato HTTP nem armazenamento de dados.

## Integração

Obrigatórios: `name_prefix`, `account_id`, `aws_region`, `tags`, `alert_email`, `monthly_budget_usd` e `api_id` (ID gerado do HTTP API, dimensão dos alarmes nativos). E-mail real e orçamento aprovado entram só em configuração local ignorada.

| Entrada opcional | Default proposto | Uso |
|---|---|---|
| app_log_retention_days | 30 | Logs da Lambda e acesso HTTP |
| audit_log_retention_days | 90 | Log group de auditoria |
| api_4xx_threshold | 20 | 4xx em cinco minutos; limiar estático proposto para volume anormal |
| s3_request_metrics_enabled | false | Alarmes S3 somente com métricas de request habilitadas no bucket |
| s3_bucket_name | null | Obrigatório ao habilitar alarmes S3 |
| s3_metrics_filter_id | all-requests | Deve coincidir com o FilterId das métricas do bucket |
| enable_cloudtrail_alarms | false | Filtros e alarmes root/IAM, sem criar a trilha |
| cloudtrail_log_group_name | null | Grupo externo da trilha; null usa o grupo audit deste módulo |
| enable_cost_anomaly_detection | false | Monitor de serviços com resumo diário por e-mail |

O chamador mapeia `providers = { aws = aws, aws.billing = aws.billing }`, com o alias `aws.billing` em **us-east-1** (`configuration_aliases = [aws.billing]`). Billing e Budgets usam esse provider. Na mesma região reutilizam o SNS principal; em outra região há tópico e assinatura adicionais em us-east-1.

Saídas: `alert_topic_arn`, `billing_alert_topic_arn`, `log_group_names`, `log_group_arns`, `alarm_arns`, `dashboard_name`, `budget_name` e `resource_names`. São nomes/ARNs, sem credenciais.

Nomes: Lambda `<name_prefix>-api`; tabela `<name_prefix>-data`; log groups `/aws/lambda/<name_prefix>-api`, `/aws/apigateway/<name_prefix>-api` e `/aws/cloudtrail/<name_prefix>-audit`; SNS `<name_prefix>-alerts` (e `-billing-alerts` fora de us-east-1); dashboard `<name_prefix>-overview`; orçamento `<name_prefix>-total-monthly`; alarmes `<name_prefix>-<sinal>`.

O access log da API é JSON com `status` e `responseLatency` numéricos (a raiz dev acrescenta `requestId`, `route`, `integrationStatus`, `integrationLatency`, `integrationError`, `authorizerError`, `gatewayError` e `gatewayErrorType`, como texto, pois valem `-` quando não se aplicam), sem caminho real, query, corpo, token, identidade ou IP. A Lambda usa `LOG_FORMAT=json`.

## Criptografia e transporte

- **Log groups**: sem `kms_key_id`; o CloudWatch Logs cifra em repouso com chave própria do serviço. Dados já ingeridos com a CMK antiga continuam cifrados por ela até a retenção expirar (30/30/90 dias): mantenha a chave até lá.
- **SNS**: sem `kms_master_key_id`. A chave gerenciada `alias/aws/sns` não serve, porque sua key policy não é editável e CloudWatch Alarms e Budgets não conseguem publicar num tópico cifrado por ela (limitação da AWS, não verificada na conta). Uma CMK custaria US$ 1/mês por região. O conteúdo é nome e estado de alarme, sem dado pessoal.
- **TLS**: a policy do tópico começa com `DenyPublishWithoutTLS` (`sns:Publish` negado quando `aws:SecureTransport = false`). Depois, só `cloudwatch.amazonaws.com` (alarmes `<prefix>-*` da conta) e `budgets.amazonaws.com` (orçamento exato) podem publicar. Administração e assinatura dependem do IAM do provisionador.

## Alarmes (padrão: 7 de métrica + 3 de billing)

Todos com ação SNS ativa, janela de 5 minutos, um período acima do limiar e `treat_missing_data = "notBreaching"`. Cada alarme extra custa US$ 0,10/mês fora da franquia de 10 alarmes padrão.

| Alarme | Métrica | Limiar |
|---|---|---|
| lambda-errors | AWS/Lambda Errors | Sum >= 1 |
| lambda-throttles | AWS/Lambda Throttles | Sum >= 1 |
| api-errors5xx | AWS/ApiGateway 5xx (ApiId) | Sum >= 1 |
| api-errors4xx | AWS/ApiGateway 4xx (ApiId) | Sum >= `api_4xx_threshold` |
| dynamodb-read-throttles / write-throttles | AWS/DynamoDB Read/WriteThrottleEvents (TableName) | Sum >= 1 |
| dynamodb-usererrors | AWS/DynamoDB UserErrors (sem TableName: conta/região) | Sum >= 1 |
| billing 50/80/100 | AWS/Billing EstimatedCharges, us-east-1 | % do orçamento |

Saíram em 2026-10-27: duração, concorrência e latência da Lambda/API, os cinco alarmes e métricas derivados de logs, os 10 alarmes por operação do DynamoDB (`ThrottledRequests`/`SystemErrors` exigem `Operation`) e o alarme composto, que apenas duplicava os e-mails. Opt-in: S3 (2 alarmes, `s3_request_metrics_enabled`) e CloudTrail (2 filtros + 2 alarmes, `enable_cloudtrail_alarms`). O dashboard mostra os sinais e o custo estimado (a franquia é de 3 dashboards).

## Orçamento e pré-requisitos

O orçamento é mensal, COST, USD e total da conta, sem filtro. Inclui impostos/suporte, créditos e assinaturas; notifica custo real acima de 50/80/100% e previsto acima de 100%, por e-mail direto **e** SNS (pode chegar duplicado). Não é teto rígido: Budgets e Cost Anomaly Detection atrasam horas.

Antes de depender dos alertas, o proprietário deve: aprovar região, orçamento e retenções; habilitar **Receive CloudWatch Billing Alerts** em Billing preferences (a coleta não pode ser desfeita; alarmes podem); confirmar cada assinatura SNS pelo link do e-mail (até lá fica `PendingConfirmation`); e, depois do apply, conferir a entrega real dos alertas.

Cost Anomaly Detection é opcional e fica desligado: monitor por SERVICE, resumo DAILY, impacto >= 50% do orçamento. A conta pode já ter monitor de serviços criado pela AWS; revise antes de ligar.

CloudTrail fica desligado: filtros sem trilha entregando eventos dão falsa sensação de cobertura. O flag não cria trilha, bucket nem role de entrega.

## Custo (ver tabela no [README da infra](../../README.md#estimativa-de-custo))

10 alarmes padrão cabem na franquia de 10 (US$ 0 com a conta limpa; US$ 1,00 sem franquia). Dashboard dentro da franquia de 3. Sem métricas customizadas no padrão.

## Verificação

`terraform fmt -check`, `init -backend=false` e `terraform test` (em `tests/alarms.tftest.hcl`, com providers simulados) cobrem: contagem de alarmes, ausência de métricas derivadas de logs, deny de TLS no SNS e ausência de chave KMS em tópicos e log groups. O módulo isolado só valida dentro de uma raiz que forneça o alias `aws.billing` (o `validate` de `environments/dev` o cobre). Não substitui teste de entrega SNS, billing ou permissões reais.
