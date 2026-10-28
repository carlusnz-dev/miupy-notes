# Decisão: criptografia gerenciada pela AWS no lugar de chaves KMS próprias (2026-10-27)

Decisão do proprietário. Substitui, para a criptografia em repouso, a escolha de chaves KMS por finalidade de [2026-10-24_infra-aws-base.md](2026-10-24_infra-aws-base.md). Prioridades: controle interno de acesso (IAM, policies de bucket/tabela, boundary), nenhum dado saindo da conta e criptografia em trânsito obrigatória; sem custo fixo de chave.

## O que muda (código; ainda não aplicado)

| Camada | Antes | Depois |
|---|---|---|
| S3 app | SSE-KMS (CMK `objects`), Bucket Key, deny de header/chave | SSE-S3 `AES256`; `DenyExplicitNonSSES3` barra só modo explícito diferente |
| S3 logs de acesso | SSE-S3 | igual |
| Estado Terraform (bootstrap) | SSE-KMS (CMK `state`) | SSE-S3; backend com `encrypt = true` e sem `kms_key_id` |
| DynamoDB | CMK `data` | chave AWS owned (`server_side_encryption { enabled = false }`), mantendo PITR, `deletion_protection_enabled` e `prevent_destroy` |
| CloudWatch Logs | CMK `observability` | criptografia padrão do serviço (sem `kms_key_id`) |
| SNS | CMK `observability` / `billing` | sem KMS (ver abaixo) |
| IAM | statements `kms:*` no runtime, operator, provisioner e backend | removidos |
| Módulo `infra/modules/kms` | 4 instâncias no dev | removido |

Escolhas que merecem atenção:

- **DynamoDB com chave AWS owned, não `aws/dynamodb`.** O provider trata `kms_key_arn` como computado: remover o argumento não troca a chave de uma tabela já cifrada com CMK, e `enabled = true` sem chave deixaria o plan sem diferença. `enabled = false` gera diff determinístico e não tem custo nem requests KMS. Contrapartida: a chave não aparece na conta (nenhum evento CloudTrail de uso). O teste só consegue afirmar a configuração (`kms_key_arn` fica desconhecido no plan simulado); o primeiro plan real precisa mostrar a mudança de `server_side_encryption`.
- **SNS sem KMS.** A chave `alias/aws/sns` não permite publicação de CloudWatch Alarms nem de Budgets (a key policy gerenciada não é editável), e uma CMK é justamente o custo que se quer evitar. O conteúdo é nome e estado de alarme, sem dado pessoal. Compensação: `DenyPublishWithoutTLS` e publicadores restritos por `SourceAccount`/`SourceArn`. Isto desvia da orientação "criptografia padrão gerenciada" e vem da documentação da AWS; não foi testado na conta.
- **S3 com SSE-S3 e sem exigir o header.** A criptografia padrão aplica `AES256`; exigir o header só complicaria o futuro código de upload. O deny remanescente impede `aws:kms` explícito (que falharia depois, quando a CMK for excluída).

## O que se perde e o que compensa

| Perda | Compensação / risco que sobra |
|---|---|
| Key policy como segunda barreira (deny fora da allowlist, `ViaService`, contexto de criptografia): um IAM mal configurado ainda precisava passar por ela. | S3: `DenyPrincipalsOutsideAllowlist` na bucket policy continua. DynamoDB: não há barreira equivalente; resta o IAM (role da API só com a ARN da tabela e boundary protegida, MFA nos humanos). Possível endurecimento futuro: resource policy da tabela. |
| Trilha por chave (cada `Decrypt` na CloudTrail) e visibilidade de quem usou a chave. | Sem trilha de uso de chave em S3/DynamoDB. Auditoria de acesso passa a depender de S3 access logs (já ligados), CloudTrail de eventos de gerenciamento e, se necessário, eventos de dados do S3 (não habilitados). |
| Revogação rápida desabilitando a chave. | Só apagando ou bloqueando o acesso por IAM/bucket policy. |
| Controle sobre a rotação e a exclusão do material. | Rotação e custódia são da AWS. O material da chave AWS owned do DynamoDB fica nas contas do serviço; os dados continuam na região e na conta, sem exportação. |
| Evidência de que o dado só é legível por quem a key policy autoriza. | A criptografia protege contra mídia, não contra IAM; o controle é IAM + policies de recurso. |
| (ganho) risco de lockout por key policy, custo de US$ 5/mês e quatro permissões a manter. | Menos superfície de IAM; menos pontos de falha no apply. |

## Migração segura (não executada)

Ordem que o proprietário deve seguir, sempre com identidade administrativa inicial (a boundary de runtime é protegida) e revisão do plan antes de cada apply:

0. **Preparar.** Anote em arquivo privado os IDs das cinco chaves (`terraform output kms_key_arns` do dev antes do apply, que remove o output; `aws kms list-aliases` para a do bootstrap). Confira se o bucket do app tem objetos (`aws s3api list-object-versions --bucket <app>`). Se houver, recopie-os no lugar (`--sse AES256`) ou adie a exclusão da chave `objects`; o operator perde `kms:Decrypt` neste apply e não leria objetos antigos.
1. **Bootstrap** (`infra/bootstrap`, estado local): `plan` deve mostrar update de `aws_s3_bucket_server_side_encryption_configuration.state` e `aws_s3_bucket_policy.state`, mais `aws_kms_key.state` e `aws_kms_alias.state` como "no longer managed, will not be destroyed" (blocos `removed` com `destroy = false`). O `terraform.tfvars.json` local ainda traz `kms_deletion_window_days`: o Terraform avisa e ignora.
2. **Backend do dev.** Logo após o passo 1, remova `kms_key_id` do `backend.hcl` local do dev e rode `terraform init -reconfigure -backend-config=backend.hcl`. Antes disso a policy nova nega a escrita do estado feita com `aws:kms`.
3. **Dev, em duas etapas.** `npm run bundle:lambda --workspace @miupy-notes/api`; depois `terraform apply -target=aws_dynamodb_table.data`, esperando `describe-table` voltar a `ACTIVE` sem `SSEDescription` (a troca da chave é assíncrona). Só então o `plan`/`apply` completo. Sem a etapa em separado, a role da API perde a permissão na CMK antes de a tabela terminar a troca e a API pode responder 5xx por alguns minutos.
4. **Efeitos esperados (estimativa a partir do código; o plan real manda):**
   - Esquecidos sem destruir (8 no dev + 2 no bootstrap): `aws_kms_key.this` e `aws_kms_alias.this` de `module.objects_key`, `data_key`, `observability_key`, `billing_key[0]`; `aws_kms_key.state` e `aws_kms_alias.state`.
   - Destruídos (24): `aws_cloudwatch_composite_alarm.degraded`; 18 alarmes (`lambda-duration`, `lambda-concurrency`, 10 `dynamodb-<operação>-{throttledrequests,systemerrors}`, 5 `logs-*`, `api-latency`); 5 `aws_cloudwatch_log_metric_filter` (application_errors, lambda_timeouts, api_5xx, api_4xx, api_latency).
   - Criados (2): `dynamodb-read-throttles`, `dynamodb-write-throttles`.
   - Alterados no lugar (cerca de 18): `aws_dynamodb_table.data` (SSE), 2 `aws_s3_bucket_server_side_encryption_configuration` (movidos com `moved` de `.app`/`.access_logs` para `.this[...]`, sem recriar), 2 `aws_s3_bucket_policy`, 4 policies IAM (`provisioner`, `operator`, `api`, `aws_iam_policy.runtime_boundary`), 2 `aws_sns_topic` e 2 `aws_sns_topic_policy` (o de billing só se a região difere de us-east-1; no dev sa-east-1 existe), 3 `aws_cloudwatch_log_group`, `aws_cloudwatch_dashboard`, `aws_apigatewayv2_api.this` (CORS `expose_headers`).
   - Objetos S3 antigos permanecem na CMK até serem recopiados; dados já ingeridos nos log groups também (30/30/90 dias); itens do DynamoDB são reencriptados pelo serviço.
   - O operator e o monitor deixam de ler logs antigos cifrados com a CMK (sem `kms:Decrypt`) até eles expirarem.
5. **Depois do apply**, remova os blocos `removed` do dev e do bootstrap em commit próprio e rode `docs/validacao/aws-dev.md` (os scripts já esperam SSE-S3, chave AWS owned e log groups sem KMS).

### Quando agendar a exclusão das chaves

Não agende nada antes de ter evidência de que nada usa a chave. Primeiro `aws kms disable-key` (reversível) e observe uma semana; só então `aws kms schedule-key-deletion --pending-window-in-days 30` (a janela de 30 dias é o último ponto de recuperação, com `cancel-key-deletion` + `enable-key`) e `aws kms delete-alias`. Pré-requisitos por chave:

| Chave | Só agende depois de |
|---|---|
| `data` (DynamoDB) | `describe-table` sem `SSEDescription` e **35 dias** do apply, pela janela de PITR (restaurar um ponto anterior à troca exige a chave) |
| `objects` (S3) | `list-object-versions` sem versão com `ServerSideEncryption = aws:kms` (`head-object`); com versões recopiadas, depois da expiração das não correntes (`noncurrent_retention_days`, 90) |
| `observability` | 90 dias (retenção do log group de auditoria; 30 dos demais) e SNS já sem `KmsMasterKeyId` |
| `billing` (us-east-1) | tópico `-billing-alerts` sem `KmsMasterKeyId` e alarmes de billing entregando |
| `state` (bootstrap) | `noncurrent_version_retention_days` (90) após o primeiro apply do dev com o backend novo: versões antigas do estado ainda estão na CMK |

Em todos os casos, confira antes se houve uso recente (`aws cloudtrail lookup-events --lookup-attributes AttributeKey=ResourceName,AttributeValue=<arn da chave>`). Chaves antigas continuam custando US$ 1/mês cada até o fim da janela.

### Reverter

- **Antes de excluir qualquer chave:** reverta o commit e aplique. As chaves esquecidas não estão no estado; o Terraform criaria **novas** CMKs (outros ARNs) e reencriptaria tabela, bucket (padrão) e log groups, ou importe as antigas (`terraform import`) se preferir os mesmos ARNs. Restaure `kms_key_id` no `backend.hcl`. Desabilitadas, reabilite com `aws kms enable-key`.
- **Chave em exclusão agendada:** `cancel-key-deletion` e `enable-key` dentro da janela de 30 dias.
- **Depois de excluída:** dados ainda cifrados com ela não são recuperáveis. Por isso o checklist acima.

## Transporte (TLS)

Detalhes e testes em [infra/README.md](../../infra/README.md#criptografia-e-tls-em-trânsito). Resumo: S3 nega HTTP e TLS < 1.2 (app, logs, estado); SNS nega `sns:Publish` sem TLS; o endpoint `execute-api` só aceita HTTPS (política TLS padrão do serviço, não configurável sem domínio customizado); a Lambda recusa iniciar com `AWS_ENDPOINT_URL*` no ambiente e `DYNAMODB_ENDPOINT` só existe na API local, limitado a loopback; o app Tauri tem CSP com `connect-src` HTTPS remoto e o cliente recusa HTTP fora de loopback. A CSP foi escrita sem teste numa janela Tauri: valide com `npm run tauri dev` e um build (por exemplo, estilos do CodeMirror e capas externas) antes de depender dela; para isso `dangerousDisableAssetCspModification` inclui `style-src`, mantendo `'unsafe-inline'` efetivo.
