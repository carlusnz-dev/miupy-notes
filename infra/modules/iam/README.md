# IAM do ambiente

Código preparado para RF-02/RF-03 e RNF-02/RNF-04. Nenhum recurso foi implantado. O módulo não cria senha de console, access key, seed MFA ou provider OIDC; não contém segredo e não altera o contrato HTTP.

## Modelo e fronteiras

| Identidade | Entrada | Permissões |
|---|---|---|
| `<prefix>-admin` → grupo admin → role provisioner | Somente esse usuário, com MFA | Recursos nomeados do ambiente e ARNs explícitos; `PassRole` apenas da API para Lambda. Backend opcional e separado. |
| `<prefix>-operator` → grupo operator → role operator | Somente esse usuário, com MFA | Logs/métricas, inspeção da Lambda/tabela, pausa/retomada por concorrência Lambda e objetos dos prefixos aprovados. KMS apenas uso via S3; sem administração KMS/IAM/billing ou alteração de código. |
| `<prefix>-monitor` → grupo monitor → role monitor | Somente esse usuário, com MFA | Logs/métricas/alarmes e custos/orçamentos em leitura. Cost Explorer usa endpoint `us-east-1` e pode gerar cobrança por consulta. |
| Role api, desligada por padrão | `lambda.amazonaws.com` | Quando habilitada: cinco ações de itens DynamoDB, streams do log group informado e, somente com prefixos aprovados, objetos/KMS via S3. Sem Scan, IAM, CreateLogGroup ou acesso ao backend. |
| Role github-deploy, desligada por padrão | Provider GitHub existente; audience e subject exatos | Somente esqueleto de confiança: nenhuma policy de deploy anexada, mesmo quando habilitada. |

Os grupos concedem exclusivamente `sts:AssumeRole` da função atribuída e autogestão mínima de senha/MFA. Não concedem acesso direto à aplicação. Sessões humanas duram no máximo uma hora. Não se concede listagem global de usuários ou dispositivos MFA; algumas telas do console poderão exigir o acesso direto à página do próprio usuário.

**Instalação inicial:** uma identidade externa autorizada deve criar este módulo e as chaves dedicadas. O provisionador não pode alterar usuários/grupos, sua própria role, as outras roles humanas, o provider OIDC ou a boundary. Portanto, mudanças nesses recursos, nos limites do runtime e criação/substituição de chaves continuam com o administrador externo. Não conceder AdministratorAccess para contornar isso. O provisionador pode administrar políticas dos buckets/chaves explicitamente indicados; pode afetar a disponibilidade e a confidencialidade desses recursos. Essa é uma função administrativa, a ser usada só em revisão de infraestrutura.

O provisionador só pode criar a role com nome/path exatos da API, exigindo `iam:PermissionsBoundary` igual à boundary protegida. Pode ajustar a policy inline/trust da API, mas não remover a boundary nem anexar managed policies. A boundary limita o runtime aos mesmos recursos/ações da policy inicial. Não existe permissão para criar outros usuários, grupos, roles ou policies. A primeira criação de Lambda/tabela futura pode usar essa role; API Gateway, CloudTrail e serviços adicionais exigirão revisão própria antes de acrescentar permissões. Operações com limitações de escopo do serviço (por exemplo, criação de alarmes compostos que exige escopo global) podem demandar a identidade externa; não se amplia o provisionador a `Resource = "*"` para escritas sem uma decisão explícita.

IAM Identity Center/SSO é a alternativa recomendada para pessoas, por reduzir credenciais de longa duração e centralizar sessões. O modelo usuário/grupo/role foi mantido para corresponder à matriz desta primeira entrega, sem configurar uma organização ou provedor de identidade adicional. Migração para SSO continua possível, substituindo usuários e trusts, sem entregar permissões de runtime aos clientes.

IAM compartilhado não isola usuários HTTP: `sub`, autorização no backend e chaves `USER#<ownerId>` continuam obrigatórios. Acesso S3 por prefixo é um limite por papel; o backend precisa derivar o caminho do proprietário autenticado. Policies de recurso futuras devem conceder a roles e respeitar a boundary, sem grants diretos a ARNs de sessões STS que poderiam contornar negações implícitas.

## Interface de integração

Obrigatórias, sem defaults: `name_prefix` (3–32 caracteres), `account_id`, `aws_region`, `tags`, `app_bucket_arn` e `app_kms_key_arn`. Somente partição comercial `aws`; chave KMS da própria conta/região, ARN de chave exato, sem alias.

| Opcionais | Default | Uso |
|---|---|---|
| `operator_s3_prefixes` | `attachments/`, `exports/`, `imports/`, `library/covers/`, `tmp/uploads/` | Proposta de acesso operacional; definir lista vazia remove objetos/listagem/KMS do operador. Sem acesso a backups por padrão. |
| `additional_bucket_arns` | `[]` | Buckets auxiliares do prefixo do ambiente, como access logs; administração pelo provisionador, sem objetos. |
| `additional_kms_key_arns` | `[]` | Chaves auxiliares exatas de logs/alertas, excluindo chave do backend; administração pelo provisionador. |
| `enable_api_role` | `false` | Exige `api_table_arn` e `api_log_group_arn`; recurso não é criado antes disso. |
| `api_table_arn`, `api_log_group_arn` | `null` | Tabela do prefixo e log group `/aws/lambda/<prefix>-api`; ARN de logs **sem** `:*`. Query não inclui índices implicitamente. |
| `api_s3_prefixes` | `[]` | Habilitar apenas quando houver código de anexos/exportação autorizado; não inclui ListBucket. |
| `backend_bucket_arn`, `backend_state_key`, `backend_kms_key_arn` | `null` | Configurar as três juntas; bucket/chave KMS distintos do app, permissões exclusivas do provisionador. |
| `enable_github_oidc` | `false` | Não cria provider nem concede deploy. |
| `github_oidc_provider_arn`, `github_repository`, `github_subject` | `null` | Provider GitHub da própria conta; `owner/repo`; subject exato `repo:owner/repo:environment:NOME` ou `repo:owner/repo:ref:refs/heads/BRANCH`. Sem curingas/pull requests. |

Outputs: `human_user_names` e `group_names` (maps admin/operator/monitor), `runtime_boundary_arn`, `api_role_arn` e `github_deploy_role_arn` (nulos quando desligadas), `role_arns` (map determinístico com provisioner/operator/monitor/api/github_deploy, inclusive roles futuras).

O path de todas as identidades/policy é `/<name_prefix>/`. Role ARN: `arn:aws:iam::<account_id>:role/<name_prefix>/<name_prefix>-<papel>`; papéis `provisioner`, `operator`, `monitor`, `api`, `github-deploy`. A raiz deve calcular esses ARNs para condições `aws:PrincipalArn` de S3/KMS, independentemente da criação das roles, e passar bucket/chave ao IAM; não depender de uma saída da role para criar a chave que é input da mesma role. A lista de S3/KMS deve incluir provisioner/operator e a API futura, conforme os usos. Não usar `NotPrincipal` em Deny.

Backend: ListBucket só para as chaves exatas do estado e `.tflock`; Get/Put no estado e Get/Put/Delete exclusivamente no lock. Sem DeleteObject do estado, sem administração do bucket/chave de estado, sem workspaces adicionais implícitos. A condição KMS pressupõe **S3 Bucket Key habilitada**, assim como a criptografia do app: contexto `aws:s3:arn` igual ao bucket. Buckets sem Bucket Key exigem uma revisão dos contextos por objeto. A policy KMS externa também precisa autorizar a role.

## Primeiro acesso manual após autorização de implantação

1. Acessar a conta com uma identidade administrativa externa protegida por MFA. Não fazer esses passos nesta sessão de código.
2. IAM → Users → usuário criado → Security credentials → Console access → Enable. Criar senha temporária fora do Terraform, exigir troca no próximo login e entregá-la por canal seguro; nunca salvar senha/QR/seed no Git, Terraform, logs ou relatório.
3. Ainda como administrador externo, Security credentials → Assign MFA device no usuário. Usar dispositivo do proprietário e nome **exatamente igual ao nome do usuário** (`<prefix>-admin`, `<prefix>-operator` ou `<prefix>-monitor`), pois a autogestão limita o ARN virtual a esse nome. A primeira associação é externa; usuários sem sessão MFA não podem associar um novo dispositivo e assim contornar a proteção das roles.
4. Entrar como o usuário, trocar a senha quando solicitado e autenticar com MFA. Console → Switch role, informar conta, path/nome da role atribuída (`<prefix>/<prefix>-provisioner`, por exemplo). Conferir a função antes de operar.
5. Para Terraform local, preferir sessão temporária emitida por broker aprovado/Identity Center. Se for inevitável credencial IAM para obter sessão STS com MFA, o proprietário deve criá-la fora do Terraform, guardá-la em cofre externo e revogá-la ao terminar; nunca usar chave estática para deploy GitHub. Esta entrega não cria nem verifica esse caminho.
6. Substituição de MFA pelo próprio usuário exige uma sessão MFA já válida. Em perda do dispositivo, recuperar através da identidade administrativa externa, após verificar o proprietário; não retirar a condição MFA da trust.

## Verificação local da frente

Em 2026-10-24, usando `/tmp/miupy-infra-terraform/terraform` oficial 1.17.0, com ambiente limpo (`env -i PATH=/usr/bin:/bin`), sem variáveis AWS, credenciais ou backend:

```sh
env -i PATH=/usr/bin:/bin /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/iam init -backend=false -input=false
env -i PATH=/usr/bin:/bin /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/iam fmt -check -recursive
env -i PATH=/usr/bin:/bin /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/iam validate -no-color
env -i PATH=/usr/bin:/bin /tmp/miupy-infra-terraform/terraform -chdir=infra/modules/iam test -no-color
```

`init` instalou AWS 6.70.0 assinado pela HashiCorp e gerou o lock local versionado. `validate`: `Success! The configuration is valid.` Testes: `Success! 7 passed, 0 failed.` São avaliações de configuração/policies com `mock_provider`, não provas de autorização efetiva na AWS. O Terraform/provider não consultou conta real. Os testes comparam JSON decodificado e cobrem MFA das trusts, limite de tamanho da policy, PassRole restrito, ausência de IAM/Scan no runtime, backend separado e flags/configurações incompletas recusadas.

Falhas encontradas e corrigidas: tipos heterogêneos das listas condicionais de statements, valores calculados pelo mock ainda desconhecidos no plan e uma ação inexistente `s3:DeleteBucketOwnershipControls` (a operação usa PutBucketOwnershipControls). Uma tentativa de baixar o catálogo público `servicereference...` retornou HTTP 403; o catálogo público AWS Policy Generator estava acessível e foi usado para conferir os 168 nomes enumerados de ações. A consulta pública não requer credenciais e não acessa a conta do proprietário.

`Resource = "*"` aparece somente em leitura sem suporte a ARN (política de senha IAM, listagem/leitura de métricas/log groups e Cost Explorer, além de DescribeAlarms para ler alarmes compostos; leituras regionais limitadas por `aws:RequestedRegion`) e no statement Deny fechado da boundary sem runtime configurado. Curingas em ARNs limitam nomes, streams e objetos do ambiente; não existem curingas de **ação**. Não há condição de ARN para APIs que não suportam recurso e não se inventa isolamento dessas leituras por prefixo.

Não foram executados AWS CLI, plan contra conta, apply, destroy, import, deploy ou testes reais de IAM/MFA/KMS. A validação Terraform não usou Docker: `docker --version` encontrou cliente 29.9.2, mas `docker info --format '{{json .ServerVersion}}'` falhou com `dial unix /var/run/docker.sock: connect: no such file or directory`. O coordenador autorizou o binário oficial, e não houve validação em contêiner. Builds web/API não se aplicam ao diff exclusivo deste módulo. A revisão cruzada de políticas na integração, o bootstrap de acesso, os custos e a autorização de implantação continuam sob responsabilidade da raiz/proprietário.

Referências: [boundary e políticas de recurso](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html), [autogestão de MFA](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_examples_iam_mfa-selfmanage.html), [ações Budgets](https://docs.aws.amazon.com/service-authorization/latest/reference/list_budgets.html), [catálogo público Policy Generator](https://awspolicygen.s3.amazonaws.com/js/policies.js), [backend S3/lock](https://developer.hashicorp.com/terraform/language/backend/s3). As garantias de limite acima decorrem da revisão local das policies; SCPs, resource policies e sessão efetiva precisam de validação autorizada separada.

Integração: os três log groups usam caminhos /aws/lambda, /aws/apigateway e /aws/cloudtrail exatos; a descoberta de leitura do provisionador inclui us-east-1 para billing. Assinaturas SNS têm leitura/remoção explicitamente delimitadas aos tópicos do ambiente. DescribeKey do backend é separado das ações criptográficas via S3, pois é consulta direta.
