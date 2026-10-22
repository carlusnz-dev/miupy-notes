# Prompt de continuidade — AWS, Terraform e IAM

Retome o miupy-notes pelas sessões [13](2026-10-22_sessao-13.md) e [15](2026-10-22_sessao-15.md), além dos relatórios Calendar/design. A entrega Calendar foi publicada e integrada em develop pelo PR #18; confira no remoto o resultado da promoção para main antes de começar. Confira status/log/diff e preserve os stashes históricos. Leia AGENTS.md, fontes obrigatórias, `docs/arquitetura/seguranca.md`, `dados.md`, `infra/README.md` e decisões pendentes. Use código enxuto, revisão de contrato e Graphify local code-only apenas nos diretórios de código, com consultas pequenas. Não use investigação de alta profundidade nem indexe documentos/dados pessoais. Para novas edições de código, use workers supervisionados em worktrees Orca (Codex Sol 6.1 Low/Medium ou Sonnet Medium/High conforme disponibilidade); a tentativa Sonnet da sessão 13 teve login expirado.

Objetivo: implementar a primeira infraestrutura AWS em Terraform e preparar a API para implantação, com fronteiras IAM explícitas. A estrutura atual em `infra/environments/dev` contém provider/variável de região, mas nenhum recurso. Não existe AWS implantada. A conexão Calendar local não comprova que o cofre funcione na Lambda.

## Antes de acessar a conta

Confirme com o proprietário conta, região, perfil/role de acesso, orçamento, ambiente, destinatário dos alarmes e retenção. Não leia `.env*`, arquivos de credenciais, tfvars reais ou estado. Não faça chamadas AWS, plan contra a conta, deploy, apply ou destroy sem autorização específica. É possível implementar e validar a estrutura local primeiro. Proponha valores de retenção/custos para decisão, sem apresentá-los como já aprovados.

Verifique a ferramenta Terraform antes de começar: `command -v terraform` não encontrou executável nesta sessão. A implementação de `.tf` e sua validação ainda não foram feitas.

## Estrutura inicial a implementar

- Conservar `infra/environments/dev` como raiz da aplicação; criar bootstrap separado para estado somente se necessário. Estado remoto em S3 privado, versionado, criptografado e com lock nativo `use_lockfile`; escolher versão Terraform compatível (a restrição atual `>= 1.7.0` precisa ser revista). Não misturar bucket de estado e objetos do app.
- DynamoDB on-demand com `pk`/`sk` existentes, PITR e proteção de exclusão conforme ambiente. Sem migração dos dados pessoais locais nesta entrega. Não criar GSI sem padrão de consulta demonstrado.
- S3 privado para anexos/exportações, bloqueio público, TLS obrigatório, criptografia, versionamento e lifecycle documentado. A API atual ainda não oferece upload/exportação completa: bucket não equivale a feature implementada.
- Artefato Lambda reproduzível e testado a partir de `apps/api/src/lambda.ts`, runtime suportado confirmado na documentação vigente, variáveis não secretas e logs JSON. Ajustar composição para AWS sem endpoint DynamoDB Local e sem cofre baseado em disco efêmero.
- API Gateway HTTP com integração Lambda, authorizer JWT Google (issuer/audience explícitos), `/health` público e `/v1/*` protegido. Aplicar `ALLOWED_SUBS` no backend e CORS limitado às origens necessárias. Verificar claims no formato esperado por `lambdaAuthorizerClaims`; sem Function URL pública ou outro caminho que contorne o authorizer.
- O comando OAuth Calendar no Rust aceita somente API loopback neste recorte local. Para AWS, definir configuração confiável de endpoint HTTPS no desktop e alinhá-la ao Axios; não aceitar URL arbitrária vinda do React nem enviar ID token a host sem validação. O redirect OAuth continua loopback do desktop, embora a troca de código ocorra no backend remoto.
- Para Calendar, definir e implementar CredentialStore persistente no backend com criptografia KMS e isolamento de proprietário; distinguir segredo do cliente OAuth e refresh tokens por conexão. Não colocar valores secretos em Terraform/state, outputs ou bundle web; provisionar apenas referências e contêineres de segredos. Escolher Secrets Manager ou registros cifrados em DynamoDB conforme granularidade, custo e rotação; documentar a decisão.
- Antes de habilitar Calendar em Lambda, substituir a serialização local de connect/disconnect por geração de tentativa/lease persistente com escrita condicional, incluindo o cofre. Um lock em memória só protege o processo local; não impede que outra instância conclua um consentimento antigo após desconexão. Cobrir a corrida e o descarte do grant tardio antes de ativar o adaptador AWS.
- CloudWatch: log groups criados pelo Terraform com retenção definida, métricas/alarmes de erro/latência/throttling, destino de alerta configurável e orçamento explícito. Não criar scheduler/fila de sync sem necessidade comprovada; preservar primeiro a sincronização acionada pelo usuário.

## Matriz IAM definida para orientar as políticas

| Identidade | Confiança | Permissões máximas da primeira entrega |
|---|---|---|
| Role de execução da API | `lambda.amazonaws.com` | DynamoDB `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query` apenas na tabela do app; logs `CreateLogStream`/`PutLogEvents` apenas no log group da função. Acrescentar `TransactWriteItems` somente se o código realmente usar. Sem `Scan`, administração de tabela ou IAM. |
| Acesso a objetos pela API | Role da API | Só acrescentar `GetObject`/`PutObject`/`DeleteObject` nos prefixos necessários quando houver código de anexos/exportação; `ListBucket` condicionado ao prefixo se indispensável. Nenhum acesso ao bucket de estado. |
| Acesso ao cofre Calendar | Role da API ou role de conector separada se houver execução separada | Ações de leitura/escrita necessárias somente nos segredos/itens de conexão do app; KMS `Encrypt`/`Decrypt`/`GenerateDataKey` apenas conforme implementação, na chave dedicada, com contexto/serviço quando aplicável. Sem listar segredos globais. |
| Invocação API Gateway → Lambda | Policy de recurso da função | `lambda:InvokeFunction` para `apigateway.amazonaws.com`, limitado ao ARN de execução da API/stage/rotas correspondentes. Não é permissão da role de execução. |
| Provisionador Terraform | Sessão humana temporária ou role de automação expressamente autorizada | Administração somente dos recursos deste ambiente; `iam:PassRole` restrito à role de execução com `iam:PassedToService=lambda.amazonaws.com`; criação/alteração de roles limitada por nomes/path e permissions boundary se disponível. Sem `AdministratorAccess` como solução padrão. |
| Backend Terraform | Provisionador/backend dedicado | `ListBucket` no bucket de estado com prefixo; `GetObject`/`PutObject` na chave do estado; `GetObject`/`PutObject`/`DeleteObject` somente no `.tflock`. KMS da chave de estado se usada. Separado das permissões do runtime. |
| CI de testes existente | GitHub Actions, sem identidade AWS | Continua sem permissões AWS. Deploy futuro em workflow separado com OIDC e trust limitada a repositório/environment/ref aprovados; sem chaves estáticas. |

IAM da role compartilhada não isola automaticamente cada usuário HTTP. A autorização por `sub`, as chaves `USER#<ownerId>` e as condições de versão continuam obrigatórias no backend; não alegar isolamento IAM por usuário sem STS/session tags e desenho específico. Evitar curingas de ação; onde a AWS exigir recurso `*`, justificar a ação e limitar com condições suportadas. Política de implantação deve ser revisada separadamente da política de execução.

## Verificação e entrega

1. Conferir os resultados remotos do PR #18 (Calendar, já mergeado em develop), do PR #12 (reconciliação documental) e da promoção develop→main conduzida na sessão 15. Não presumir pendência ou igualdade de branches com base no relatório anterior à integração. Não fazer reset/rebase de branches protegidas.
2. Fixar versões de provider/runtime e gerar lockfile de provider sem credenciais. Rodar `terraform fmt -check -recursive`, `terraform init -backend=false` e `terraform validate` em cada raiz nova; verificar IAM com testes de política locais quando possível. Não confundir validate com prova de autorização efetiva.
3. Testar empacotamento/handler, 401/403/isolamento e falha fechada de configuração, além de build e check de módulos. Testes contra AWS e smoke tests ficam condicionados à autorização de implantação.
4. Entregar diff revisável, custos estimados com premissas, matriz IAM final com ARNs parametrizados, estratégia de estado/backup/rollback e passos exatos de bootstrap/plan/apply. Pedir aprovação para conta real somente com esse material pronto.
5. Atualizar arquitetura/contratos/decisão/relatório com fatos e verificações reais; `deployedResources` permanece vazio até implantação comprovada. Não prometer integração já ativa por existir Terraform.

Referências primárias consultadas em 2026-10-22: [backend S3 e permissões de lock](https://developer.hashicorp.com/terraform/language/backend/s3), [JWT authorizer HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html), [permissões Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-permissions.html). Revalidar versões e detalhes de serviço na execução.
