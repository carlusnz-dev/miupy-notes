# Armazenamento de objetos S3

Código de infraestrutura preparado em 2026-10-24 para RF-02, RF-03, RF-04 e RF-09 e requisitos de segurança/privacidade. Nada implantado. A API não ganhou uploads, exportação/restauração ou backups por existir este módulo. O corpo das notas continua no DynamoDB; este documento não muda o contrato HTTP.

## Recursos e fronteiras

`infra/modules/s3` define dois buckets determinísticos na mesma conta/região: `${name_prefix}-${account_id}-app` e `${name_prefix}-${account_id}-access-logs`. O ID da conta é variável local, nunca literal versionado. Nomes globais podem colidir com buckets já existentes; resolver antes de uma implantação autorizada, sem import automático. O nome não inclui região: usar prefixos diferentes para ambientes/regiões distintos.

Ambos têm quatro bloqueios de acesso público, `BucketOwnerEnforced` (sem ACL), versionamento e `force_destroy = false`. Não há CORS, website, objetos vazios de diretório ou replicação. Prefixos nascem com os primeiros objetos: marcadores vazios não acrescentam autorização nem capacidade de armazenamento. Futuras URLs pré-assinadas serão temporárias, emitidas após autorização; uploads via navegador podem exigir decisão adicional sobre CORS.

O bucket do app usa chave KMS dedicada, rotação de 365 dias e S3 Bucket Key. A raiz instancia `kms` por finalidade e informa `kms_key_arn` ao S3; monta o ARN determinístico do bucket para `s3_bucket_arns` antes de criar o bucket, evitando ciclo entre módulos. TLS >= 1.2 é exigido e HTTP é negado. Serviços AWS têm exceção somente nos denies de contexto de rede, porque a AWS pode omitir esses atributos; o app ainda nega qualquer principal de serviço fora da allowlist de ARNs IAM. Não foi aberto acesso de exportação DynamoDB ao bucket: exige desenho e revisão futuros.

`PutObject` exige headers `x-amz-server-side-encryption: aws:kms` e `x-amz-server-side-encryption-aws-kms-key-id` com ARN exato da chave. Omitir headers, usar alias, outra chave, SSE-S3 ou DSSE-KMS é negado, mesmo com criptografia padrão configurada. Futuro cliente de multipart/cópia deve respeitar as condições de S3 e ser testado em integração antes de habilitar a feature. Bucket Key reduz chamadas KMS; o contexto pode ser o ARN do bucket, portanto a policy KMS aceita esse ARN e ARNs dos objetos. KMS não serve aqui como isolamento por prefixo.

## Prefixos propostos

Todas as versões são cifradas e todos os prefixos do app são versionados. Os números abaixo são propostas configuráveis, não retenções aprovadas. `ownerId` deve ser derivado do `sub` validado; não incorporar nomes, e-mails ou títulos às chaves.

| Prefixo | Conteúdo e proprietário | Leitura/escrita futura por role | Classe / ciclo corrente | Versões antigas / sensibilidade |
|---|---|---|---|---|
| `attachments/<ownerId>/<noteId>/` | Anexos pertencentes ao dono da nota | API e operador somente nos prefixos IAM autorizados; provisionador para manutenção | STANDARD, sem expiração corrente | 90 dias após tornar-se não corrente; notas e arquivos potencialmente sensíveis |
| `exports/<ownerId>/` | Pacotes/manifestos do próprio usuário | API e operador autorizado | STANDARD, expira em 30 dias | Expira em 30 dias após tornar-se não corrente; pode conter todo o acervo/finanças |
| `imports/<ownerId>/` | CSV bancário e arquivos de entrada | API e operador autorizado | STANDARD, expira em 7 dias | Expira em 7 dias após tornar-se não corrente; dados financeiros brutos |
| `library/covers/<ownerId>/` | Capas enviadas pelo dono da obra | API e operador autorizado | STANDARD, sem expiração corrente | 90 dias após tornar-se não corrente; preferências pessoais, validar direitos/tipo futuramente |
| `backups/dynamodb/` | Exportações futuras da tabela, conta proprietária | Provisionador/role de backup futura; API sem acesso por padrão | STANDARD; GLACIER aos 90 dias; expira aos 365 | Regra geral de 90 dias não correntes; snapshot pode conter dados de vários usuários |
| `tmp/uploads/` | Temporários; futura chave deve acrescentar `<ownerId>/<uploadId>` | API e operador autorizado | STANDARD, expira em 1 dia | Expira em 1 dia após tornar-se não corrente; mesma sensibilidade do original |
| `logs/` **no bucket separado** | Logs de acesso da infraestrutura | Serviço S3 grava; leitura apenas por IAM de auditoria/provisionador autorizado | STANDARD, expira em 90 dias | Expira em 90 dias após tornar-se não corrente; contém chaves, IPs e metadados sensíveis |

As policies IAM determinam as ações concretas por role; a allowlist do bucket apenas impõe o perímetro e não concede acesso. Incluir a API na allowlist não habilita S3 na role: permissões e implementação são etapas separadas. O operador não deve ter leitura dos backups nem logs apenas por operar objetos do app.

S3 não tem diretórios reais. IAM de role compartilhada não conhece o usuário HTTP: o backend precisa conferir dono da nota/obra e construir a chave a partir da identidade autenticada, como faz com `USER#<ownerId>` no DynamoDB. Prefixo não substitui autorização, validação de tipo/tamanho, checksum, manifesto versionado, prévia de restauração ou controle de concorrência.

## Lifecycle e descarte

Todos os uploads multipart incompletos são abortados após 7 dias, inclusive temporários cujo objeto completo expiraria em 1 dia. Lifecycle é assíncrono: os dias indicam elegibilidade, não prazo garantido de remoção. Expirar objeto corrente em bucket versionado cria delete marker; a versão anterior é excluída somente depois do prazo não corrente. Uma exportação pode permanecer fisicamente recuperável por aproximadamente 60 dias (30 corrente + 30 não corrente), importação por 14, temporário por 2 e log por 180, mais processamento assíncrono. A regra geral de 90 dias também se aplica: se houver regras sobrepostas, prevalece a expiração elegível mais cedo.

Marcadores de exclusão expirados são removidos quando já não há versões de dados. Anexos/capas correntes não expiram; excluir pela aplicação não comprova apagar imediatamente todas as versões. Um futuro pedido de exclusão deve enumerar versões e backups aplicáveis e registrar o resultado. Este módulo não implementa esse fluxo.

Backups correntes transitam para Glacier Flexible Retrieval apenas quando elegíveis segundo o mínimo de tamanho padrão do S3 (128 KiB); pequenos objetos permanecem STANDARD. Exige-se retenção corrente >= transição + 90 dias, para respeitar a permanência mínima dessa classe. Recuperação de Glacier demora e custa; não é restauração instantânea. Alterar retenção de versões ou excluir manualmente objetos arquivados pode gerar cobrança por exclusão antecipada. Sem replicação ou Object Lock: versionamento não protege contra administrador autorizado malicioso.

## Logs de acesso

O destino usa SSE-S3 (`AES256`) em vez de KMS: a [documentação S3 sobre SSE-KMS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html) exige SSE-S3 no destino de server access logging. A policy permite apenas `logging.s3.amazonaws.com` gravar `logs/*`, com `aws:SourceAccount` e `aws:SourceArn` do bucket do app. A entrega não precisa enviar header SSE; a criptografia padrão é aplicada, e header explícito divergente é negado. ACL não é necessária.

Não há logging recursivo do próprio destino, para evitar ciclo e custo. A exceção de principal de serviço no deny do destino não concede permissões por si; o único Allow de serviço é o de entrega restrita. [Server access logging](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ServerLogs.html) é best effort e pode atrasar/omitir registros; não equivale a auditoria completa CloudTrail. Logs contêm metadados identificáveis e URLs/chaves: futuros uploads devem evitar dados pessoais nas chaves e futuras URLs pré-assinadas exigem revisão de exposição de metadados.

## Acesso, lockout e recuperação

Bucket policy usa `Deny` com `ArnNotEquals` sobre `aws:PrincipalArn`, nunca `NotPrincipal`. Inclui sempre raiz da conta e `provisioner_arn`, além dos ARNs IAM explícitos. Para uma sessão STS de role, usar ARN IAM da role; ARN STS de sessão é rejeitado. Roles/usuários de outra conta e curingas são rejeitados pelo contrato atual.

A key policy mantém o mesmo perímetro de raiz, administradores e usuários explícitos. Administradores gerenciam a chave, mas só provisionador e `key_user_arns` têm uso criptográfico normal; para S3, esse uso passa por `kms:ViaService` e contexto de bucket/objeto. A raiz preserva recuperação direta e delegação IAM administrativa, sem permitir que delegação de criptografia ignore os contextos dos usuários. As autorizações CloudWatch/Budgets/Logs só existem quando fornecidas à instância apropriada, com fontes/contextos limitados. Não se cria grant genérico. Políticas IAM, SCPs, boundaries e estado habilitado da chave continuam relevantes.

Antes de aplicar, conferir que o principal efetivo do Terraform corresponde ao `provisioner_arn` estável nas duas allowlists. Teste mental: provisionador listado administra os recursos; operador listado só faz o que IAM permite; role não listada recebe Deny mesmo com Allow IAM; raiz permanece dentro do perímetro; serviço de logging grava somente no destino autorizado. `validate` não testa essas autorizações.

Se houver lockout após alteração manual: entrar como raiz da conta com MFA em sessão emergencial; conferir SCPs/conta e obter os ARNs corretos; editar a bucket policy e a key policy para restaurar provisionador e administradores, preservando a raiz; reabilitar chave ou cancelar exclusão agendada dentro da janela; reconciliar o código e revisar o plano somente quando autorizado. A raiz não é credencial de uso diário. SCP que nega recuperação exige atuação da organização. Após exclusão definitiva da KMS, nem raiz recupera dados cifrados: manter chave enquanto houver versões, logs ou backups que dependam dela. Rotação anual preserva material anterior; trocar chave não recifra versões existentes.

## Custos e pendências

KMS por finalidade tem custo fixo por chave e chamadas, além de possíveis versões de material rotacionado; ver [preços KMS](https://aws.amazon.com/kms/pricing/). Há custos S3 de armazenamento de todas as versões e logs, PUT/GET/listagem, transição, recuperação Glacier e transferência. Logging aumenta requests e armazenamento. Request metrics é opção desligada por padrão (`enable_request_metrics`); ao ligar, a configuração chama-se `EntireBucket` e os alarmes devem usar esse `FilterId`. Consultar [preços S3](https://aws.amazon.com/s3/pricing/) por região antes de aprovar. Não há teto de custo nem economia garantida.

Retenções, região, backup/restauração, orçamento e papéis continuam sujeitos à aprovação do proprietário. Resta testar políticas reais, lifecycle/multipart/URLs pré-assinadas, entrega de logs e recuperação em ambiente autorizado. Nenhum recurso, objeto ou dado pessoal foi criado na AWS nesta frente.
