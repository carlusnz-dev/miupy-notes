# Armazenamento de objetos S3

Código de infraestrutura preparado em 2026-10-24 para RF-02, RF-03, RF-04 e RF-09 e requisitos de segurança/privacidade. Nada implantado. A API não ganhou uploads, exportação/restauração ou backups por existir este módulo. O corpo das notas continua no DynamoDB; este documento não muda o contrato HTTP.

## Recursos e fronteiras

`infra/modules/s3` define dois buckets determinísticos na mesma conta/região: `${name_prefix}-${account_id}-app` e `${name_prefix}-${account_id}-access-logs`. O ID da conta é variável local, nunca literal versionado. Nomes globais podem colidir com buckets já existentes; resolver antes de uma implantação autorizada, sem import automático. O nome não inclui região: usar prefixos diferentes para ambientes/regiões distintos.

Ambos têm quatro bloqueios de acesso público, `BucketOwnerEnforced` (sem ACL), versionamento e `force_destroy = false`. Não há CORS, website, objetos vazios de diretório ou replicação. Prefixos nascem com os primeiros objetos: marcadores vazios não acrescentam autorização nem capacidade de armazenamento. Futuras URLs pré-assinadas serão temporárias, emitidas após autorização; uploads via navegador podem exigir decisão adicional sobre CORS.

O bucket do app usa SSE-S3 (`AES256`), sem chave própria nem custo por request (decisão de 2026-10-27, [kms-gerenciado-aws](../decisoes/2026-10-27_kms-gerenciado-aws.md); o dev aplicado ainda está em SSE-KMS até o próximo apply). A raiz monta o ARN determinístico do bucket para as policies IAM, evitando ciclo entre módulos. TLS >= 1.2 é exigido e HTTP é negado. Serviços AWS têm exceção somente nos denies de contexto de rede, porque a AWS pode omitir esses atributos; o app ainda nega qualquer principal de serviço fora da allowlist de ARNs IAM. Não foi aberto acesso de exportação DynamoDB ao bucket: exige desenho e revisão futuros.

`PutObject` não precisa de header SSE: a criptografia padrão aplica `AES256`. A policy nega apenas quem pede explicitamente outro modo (`aws:kms`, `aws:kms:dsse`); o cliente de upload/multipart/cópia deve omitir o header ou enviar `AES256`, e isso deve ser testado em integração antes de habilitar a feature. Sem KMS, a bucket policy e o IAM são o único controle de acesso aos objetos (não há segunda barreira por key policy).

## Logs de acesso

O destino usa SSE-S3 (`AES256`), como o bucket do app: a [documentação S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html) exige SSE-S3 no destino de server access logging. A policy permite apenas `logging.s3.amazonaws.com` gravar `logs/*`, com `aws:SourceAccount` e `aws:SourceArn` do bucket do app. A entrega não precisa enviar header SSE; a criptografia padrão é aplicada, e header explícito divergente é negado. ACL não é necessária.

Não há logging recursivo do próprio destino, para evitar ciclo e custo. A exceção de principal de serviço no deny do destino não concede permissões por si; o único Allow de serviço é o de entrega restrita. [Server access logging](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerLogs.html) é best effort e pode atrasar/omitir registros; não equivale a auditoria completa CloudTrail. Logs contêm metadados identificáveis e URLs/chaves: futuros uploads devem evitar dados pessoais nas chaves e futuras URLs pré-assinadas exigem revisão de exposição de metadados.

## Acesso, lockout e recuperação

Bucket policy usa `Deny` com `ArnNotEquals` sobre `aws:PrincipalArn`, nunca `NotPrincipal`. Inclui sempre raiz da conta e `provisioner_arn`, além dos ARNs IAM explícitos. Para uma sessão STS de role, usar ARN IAM da role; ARN STS de sessão é rejeitado. Roles/usuários de outra conta e curingas são rejeitados pelo contrato atual.

Antes de aplicar, conferir que o principal efetivo do Terraform corresponde ao `provisioner_arn` estável nas duas allowlists. Teste mental: provisionador listado administra os recursos; operador listado só faz o que IAM permite; role não listada recebe Deny mesmo com Allow IAM; raiz permanece dentro do perímetro; serviço de logging grava somente no destino autorizado. `validate` não testa essas autorizações.

Se houver lockout após alteração manual: entrar como raiz da conta com MFA em sessão emergencial; conferir SCPs/conta e obter os ARNs corretos; editar a bucket policy para restaurar provisionador e administradores, preservando a raiz; reconciliar o código e revisar o plano somente quando autorizado. A raiz não é credencial de uso diário. SCP que nega recuperação exige atuação da organização. Objetos antigos cifrados com a CMK extinta só são legíveis enquanto a chave existir: não a exclua antes de recopiá-los ou deixá-los expirar (ver a decisão de migração).

## Custos e pendências

Sem KMS não há custo fixo de criptografia. Há custos S3 de armazenamento de todas as versões e logs, PUT/GET/listagem, transição, recuperação Glacier e transferência. Logging aumenta requests e armazenamento. Request metrics é opção desligada por padrão (`enable_request_metrics`); ao ligar, a configuração chama-se `EntireBucket` e os alarmes devem usar esse `FilterId`. Consultar [preços S3](https://aws.amazon.com/s3/pricing/) por região antes de aprovar. Não há teto de custo nem economia garantida.

Retenções, região, backup/restauração, orçamento e papéis continuam sujeitos à aprovação do proprietário. Resta testar políticas reais, lifecycle/multipart/URLs pré-assinadas, entrega de logs e recuperação em ambiente autorizado. Nenhum recurso, objeto ou dado pessoal foi criado na AWS nesta frente.
