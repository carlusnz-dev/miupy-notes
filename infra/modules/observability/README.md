# Observabilidade preparada

Código Terraform para RNF-02/RNF-04, validado localmente em 2026-10-24; nenhum recurso implantado. Este módulo não cria Lambda, API Gateway, DynamoDB, chave KMS ou trilha CloudTrail. O ambiente pai cria as chaves e fornece os providers. Não há alteração de contrato HTTP, autorização por proprietário ou armazenamento dos dados da aplicação.

## Integração

Obrigatórios, sem default: `name_prefix: string`, `account_id: string`, `aws_region: string`, `tags: map(string)`, `alert_email: string`, `monthly_budget_usd: number` e `kms_key_arn: string`. E-mail real e orçamento aprovado entram apenas em configuração local ignorada. Conta e região devem coincidir com a chave.

| Entrada opcional | Default proposto | Uso |
|---|---|---|
| app_log_retention_days | 30 | Logs da Lambda e acesso HTTP |
| audit_log_retention_days | 90 | Log group de auditoria |
| lambda_timeout_seconds | 30 | Alarme de duração a 80% do timeout, em milissegundos |
| lambda_concurrency_threshold | 10 | Concorrência máxima da função |
| api_latency_threshold_ms | 1000 | Latência p95 |
| api_4xx_threshold | 20 | 4xx em cinco minutos; limiar estático proposto para volume anormal |
| api_id | null | ID gerado da API HTTP futura para métricas nativas |
| s3_request_metrics_enabled | false | Alarmes S3 somente com métricas de request habilitadas no bucket |
| s3_bucket_name | null | Obrigatório ao habilitar alarmes S3 |
| s3_metrics_filter_id | all-requests | Deve coincidir com o FilterId das métricas do bucket |
| enable_cloudtrail_alarms | false | Filtros e alarmes root/IAM, sem criar a trilha |
| cloudtrail_log_group_name | null | Grupo externo da trilha; null usa o grupo audit deste módulo |
| enable_cost_anomaly_detection | false | Monitor de serviços com resumo diário por e-mail |
| billing_kms_key_arn | null | Chave em us-east-1 exigida se a aplicação usar outra região |

O chamador deve mapear `providers = { aws = aws, aws.billing = aws.billing }`, com o alias `aws.billing` configurado em **us-east-1**. O módulo declara `configuration_aliases = [aws.billing]`. Billing e Budgets usam esse provider. Na mesma região, reutilizam o SNS principal; em outra região, há tópico e assinatura adicionais em us-east-1 com chave regional própria. Não se deve enviar uma chave regional de outra região para SNS.

Saídas: `alert_topic_arn`, `billing_alert_topic_arn`, `log_group_names`, `log_group_arns`, `alarm_arns`, `dashboard_name`, `budget_name` e `resource_names`. São nomes/ARNs, sem credenciais.

Nomes esperados pelas próximas entregas:

- Lambda: `<name_prefix>-api`; tabela: `<name_prefix>-data`.
- Log groups: `/aws/lambda/<name_prefix>-api`, `/aws/apigateway/<name_prefix>-api` e `/aws/cloudtrail/<name_prefix>-audit`.
- SNS: `<name_prefix>-alerts` e, quando necessário, `<name_prefix>-billing-alerts`.
- Dashboard: `<name_prefix>-overview`; orçamento: `<name_prefix>-total-monthly`.
- Alarmes: `<name_prefix>-<sinal>` e composto `<name_prefix>-application-degraded`.

HTTP API recebe um ID gerado pela AWS: nome não substitui a dimensão `ApiId`. Os sinais derivados de logs são preparados imediatamente; informar `api_id` depois habilita os três sinais nativos adicionais. A Lambda futura deve usar `LOG_FORMAT=json` para alimentar o filtro `level=error/ERROR`. O timeout também é detectado pela frase `Task timed out`.

O access log da API futura deve ser JSON com `status` e `responseLatency` numéricos:

```json
{"status":$context.status,"responseLatency":$context.responseLatency}
```

Não incluir caminho real, query, corpo, tokens, identidade ou dados pessoais. O destino deve ser `log_group_arns.api`, com permissões de entrega de logs apropriadas na entrega da API. Usar esse formato mínimo evita incompatibilidade com os filtros; ele não é o formato do middleware Express, que utiliza `statusCode` e `durationMs`.

## Chave e tópico

O pai deve autorizar na key policy da chave simétrica dedicada:

- Principal `logs.<aws_region>.amazonaws.com`: `kms:Encrypt`, `kms:Decrypt`, `kms:ReEncryptFrom`, `kms:ReEncryptTo`, `kms:GenerateDataKey`, `kms:GenerateDataKeyWithoutPlaintext` e `kms:DescribeKey`. Restringir por `kms:EncryptionContext:aws:logs:arn` aos três ARNs determinísticos dos grupos, sem `:*` no valor do contexto. O principal de provisionamento também precisa das permissões KMS/Logs necessárias.
- Principais `cloudwatch.amazonaws.com` e `budgets.amazonaws.com`: `kms:GenerateDataKey` e `kms:Decrypt` para publicação no tópico cifrado. Na chave de billing, autorizar os mesmos serviços. Aplicar as condições de contexto/origem suportadas por cada serviço; não presumir que condições da policy SNS sejam transmitidas igualmente ao KMS.
- Manter administração/recuperação da chave fora deste módulo. Desativar/excluir a chave impede leitura de logs retidos e entrega de alertas.

A policy SNS permite apenas `sns:Publish` aos serviços CloudWatch e Budgets, com `aws:SourceAccount` e `aws:SourceArn` restritos aos alarmes do prefixo e ao orçamento exato. Administração e assinatura dependem do IAM do provisionador. O módulo não permite publicação pública e não altera key policies.

Referências oficiais: [CloudWatch Logs/KMS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/encrypt-log-data-kms.html), [CloudWatch para SNS cifrado](https://repost.aws/knowledge-center/cloudwatch-configure-alarm-sns), [origem das notificações CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html) e [Budgets/SNS/KMS](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html).

## Sinais e operação

Todos os alarmes simples têm ações ativas para SNS e `treat_missing_data = "notBreaching"`. Janela operacional de cinco minutos, um período acima do limiar:

| Sinal | Estatística/limiar proposto | Dimensões |
|---|---|---|
| Lambda Errors / Throttles | Sum >= 1 | FunctionName |
| Lambda Duration | p95 >= 80% do timeout | FunctionName |
| Lambda ConcurrentExecutions | Maximum >= 10 | FunctionName |
| Logs ERROR / timeout / API 5xx | Sum >= 1 | Namespace próprio, sem dimensões |
| API 4xx anormal | Sum >= 20 | Logs e, com api_id, ApiId |
| API Latency | p95 >= 1000 ms | Logs e, com api_id, ApiId |
| API 5xx nativo | Sum >= 1 | Somente quando api_id informado |
| DynamoDB ThrottledRequests / SystemErrors | Sum >= 1 por operação | TableName + Operation |
| DynamoDB UserErrors | Sum >= 1 | Conta/região inteira, sem dimensão |
| S3 4xxErrors / 5xxErrors | Sum >= 1; opt-in | BucketName + FilterId |
| Root / mudanças IAM | Sum >= 1; opt-in | Filtros do CloudTrail |
| EstimatedCharges | Maximum >= 50/80/100% do orçamento | Currency=USD, us-east-1, seis horas |

DynamoDB cobre GetItem, PutItem, UpdateItem, DeleteItem e Query. Ampliar junto de operações futuras; não há Scan. `SystemErrors` e `ThrottledRequests` precisam do par TableName/Operation; `UserErrors` é global da conta/região e pode refletir outros sistemas. [Dimensões oficiais DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html).

O composto usa OR dos sinais da aplicação, excluindo segurança e UserErrors global; avisa degradação e recuperação. Alarmes individuais também avisam: mensagens duplicadas são possíveis. O dashboard mostra todos os sinais operacionais e custo estimado. Sem recursos produtores, os alarmes inicialmente podem ficar em INSUFFICIENT_DATA e depois OK pela política de dados ausentes. **OK não comprova funcionamento da aplicação nem entrega de logs/alertas.** Filtros só processam novos eventos, não reprocessam histórico. [Métricas HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html).

## Financeiro e passos manuais

O orçamento é mensal, COST, USD e total da conta, sem filtro de tags/serviços. Inclui impostos/suporte, créditos/descontos/reembolsos e assinaturas; não é teto de gasto bruto antes de créditos. Notifica custo real acima de 50/80/100% e previsto acima de 100%, cada um por e-mail direto **e** SNS. O e-mail pode chegar duplicado por esses canais.

Antes de depender dos alertas, o proprietário deve:

1. Aprovar região, orçamento, retenções e limites operacionais; os defaults são propostas.
2. Em Billing and Cost Management → Billing Preferences → Alert preferences, habilitar **Receive CloudWatch Billing Alerts**. Contas consolidadas exigem configuração apropriada na pagadora. A coleta não pode ser desabilitada depois; alarmes podem ser removidos.
3. Confirmar cada assinatura SNS no link recebido por e-mail. Até clicar, a assinatura permanece pendente; Terraform não confirma e-mail pelo destinatário.
4. Após implantação autorizada, verificar permissões KMS/SNS, sinais reais, entrega dos alertas e a coerência entre timeout configurado e `lambda_timeout_seconds`.

[Billing oficial](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html): EstimatedCharges cobre custo mundial em us-east-1; não faz previsão. Budgets e Cost Anomaly Detection têm atraso de horas. Nenhum deles bloqueia consumo ou garante limite rígido.

Anomalia é opcional: monitor por SERVICE, resumo DAILY por e-mail, impacto absoluto >= 50% do orçamento. Mantém SNS limitado a CloudWatch/Budgets. A conta pode já ter monitor de serviços criado pela AWS; revisar existência/quotas antes de habilitar para evitar conflito. Habilitar Cost Explorer conforme pré-requisitos do serviço. O monitor precisa de histórico, com detecção atrasada em até 24 horas; não substitui o orçamento. [Cost Anomaly Detection](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html).

## Custos e decisões

Estimativa ilustrativa para us-east-1, sem créditos/free tier, não aprovada: 23 alarmes simples a US$ 0,10/mês = US$ 2,30; um composto a US$ 0,50; cinco métricas customizadas a US$ 0,30 = US$ 1,50; um dashboard a US$ 3 = US$ 3. Subtotal US$ 7,30/mês, antes de KMS, ingestão/retenção de logs, SNS e impostos. A chave criada pelo pai pode somar cerca de US$ 1/mês, além de chamadas KMS. Free tier pode reduzir custos; não foi verificada elegibilidade da conta. A observabilidade pode consumir grande parte de um orçamento proposto de US$ 10.

API nativa acrescenta três alarmes; S3 dois, além das métricas de requests cobradas; segurança acrescenta dois alarmes e duas métricas customizadas, mais ingestão/retenção e custos da trilha externa. Sem eventos, grupos vazios não geram ingestão, mas os alarmes continuam provisionados. O orçamento apenas notifica (sem Budget Actions); monitoramento e notificações Budgets são gratuitos segundo a tabela consultada. Cost Anomaly Detection é anunciado sem custo adicional; SNS e recursos associados podem cobrar. Conferir preços/volume por região antes de implantar: [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/) e [anomalias](https://aws.amazon.com/aws-cost-management/aws-cost-anomaly-detection/).

CloudTrail fica desligado: ativar filtros sem trilha e entrega de eventos dá falsa sensação de cobertura. O flag não cria trilha/bucket/role de entrega. A entrega futura deve habilitar eventos de gerenciamento, incluir eventos globais IAM/root, entregar ao grupo selecionado, cifrar e revisar acesso/retenção. Se o grupo for externo, sua retenção/cifra pertence à frente que o cria. Confirmar custo e escopo com o proprietário antes de ligar.

## Verificação local desta frente

Base confirmada: e54987d, descendente de 2399198. Branch renomeada para feat/infra-aws-observabilidade antes das edições. Terraform 1.17.0 no binário oficial previamente verificado pelo coordenador; provider AWS 6.70.0 instalado e assinado pela HashiCorp, lock gerado por init.

Comandos executados, removendo variáveis AWS_* do ambiente nos comandos Terraform:

```sh
/tmp/miupy-infra-terraform/terraform fmt -recursive infra/modules/observability
/tmp/miupy-infra-terraform/terraform -chdir=infra/modules/observability init -backend=false -input=false -no-color
```

Resultado: formatação aplicada e `Terraform has been successfully initialized!`. Para validar um módulo com alias, foi criada uma raiz sintética em `/tmp/miupy-observability-validate-1tb4attu`, com os dois providers e valores fictícios, sem backend ou credenciais:

```sh
/tmp/miupy-infra-terraform/terraform -chdir=/tmp/miupy-observability-validate-1tb4attu init -backend=false -input=false -lockfile=readonly -no-color
/tmp/miupy-infra-terraform/terraform -chdir=/tmp/miupy-observability-validate-1tb4attu validate -no-color
```

Resultado: init concluído; `Success! The configuration is valid.`. Validação estática não comprova key policies, filtros no serviço, dimensões emitidas, cobrança, entrega SNS, autorização efetiva ou implantação.

`docker version` falhou: `dial unix /var/run/docker.sock: connect: no such file or directory`. Validação na imagem fixa `hashicorp/terraform:1.17.0` não foi executada; foi usado o binário oficial. Não houve AWS CLI, chamadas a contas AWS, plan/apply/destroy/import, deploy, credenciais, dados reais, push ou PR. Nenhum código em apps/ ou src-tauri/ foi alterado; testes web/API não se aplicam a este diff.

Checagens finais: `terraform fmt -check -recursive infra/modules/observability` e `git diff --check` retornaram código 0. O diff foi revisado localmente quanto a dimensões, regiões e políticas; a revisão cruzada e integração com IAM/KMS/S3 ficam a cargo do coordenador. As fontes oficiais acima foram consultadas em 2026-10-24.
