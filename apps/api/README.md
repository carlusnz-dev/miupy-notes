# API — template

Express + TypeScript para Lambda via `serverless-http`. O servidor local responde `GET /health` e monta `/v1/notes` (listar com cursor, criar, ler, atualizar com `version` e `409`, excluir) atrás da verificação do ID token do Google (`core/http/authenticate.ts`) e da lista `ALLOWED_SUBS`. Contrato em `docs/arquitetura/api.md`. Não há tabela, Lambda ou API Gateway implantados.

```text
src/
  core/                  classes base, erro, HTTP, cliente DynamoDB
  modules/notes/
    domain/              entidade
    repository/          contrato e implementação DynamoDB
    services/            contrato abstrato e implementação
    controllers/         tradução HTTP → service
    dto/                 input, output, adapter com Zod
    routes/              Express Router
    module.ts            composição interna
    index.ts             API pública para outros módulos
  app.ts                 composição Express e rotas públicas
  lambda.ts              adaptador Lambda
  server.ts              execução local
```

## Regra dos módulos

Classes concretas herdam contratos abstratos de `core/`. Outro módulo só importa serviços pelo `index.ts` do módulo de origem; repository, controller, DTO e implementação são internos. A composição da aplicação recebe `createNotesModule` pelo mesmo índice. `npm run check:modules` verifica estrutura e fronteiras; `npm run test:api` roda todos os `src/**/*.test.ts`, incluindo as rotas de notas montadas com principal falso **apenas no teste** e o repositório DynamoDB com cliente falso. Novos módulos seguem o mesmo padrão, sem criar classes vazias apenas para preencher pastas.

## Comandos

Da raiz: `npm run dev:db` (DynamoDB Local em Docker, `127.0.0.1:8000`), `npm run db:create-table`, `npm run dev:api`, `npm run build:api`, `npm run test:api` e `npm run check:modules`. A porta local padrão é 4000 e o listener usa `127.0.0.1`. Variáveis: `apps/api/.env.development` (endpoint e tabela locais, versionado) e `.env.local` na raiz (ignorado): `GOOGLE_CLIENT_ID`, `ALLOWED_SUBS` (modelo em `.env.example`). `server.ts` recusa `DYNAMODB_ENDPOINT` fora de loopback e usa credenciais falsas.

A Lambda troca a fonte de claims por `lambdaAuthorizerClaims` (`requestContext.authorizer.jwt.claims`), mantendo a mesma lista de `sub`. Nunca aceitar `ownerId` do corpo HTTP como autoridade. Definir `NOTES_TABLE_NAME` e IAM mínimo ao compor a Lambda. O handler em `src/lambda.ts` ainda precisa de bundle para deployment; Terraform não o usa nesta etapa.

## Logs e diagnóstico local

`LOG_LEVEL=debug npm run dev:api` habilita eventos de início de requisição; o padrão `info` registra conclusão/abort, configuração e listener. `LOG_LEVEL` aceita `debug`, `info`, `warn` e `error` (valor inválido usa `info`). Cada linha é JSON com `timestamp`, `level`, `event` e metadados permitidos; erros vão ao stderr, os demais ao stdout. A classe `Logger` recebe um sink para testes, sem SDK ou dependência de observabilidade.

Toda resposta inclui `X-Request-Id`, UUID gerado internamente (o header recebido do cliente é ignorado). Nos erros, é o mesmo `error.requestId` já previsto no contrato. Procure esse UUID no console para relacionar `request.failed` e `request.completed`: método, template de rota quando reconhecido, status e `durationMs`. Início, JSON inválido, autenticação antecipada e rotas desconhecidas podem ter `route: "unmatched"`; nenhum caminho real ou query é registrado. Abort registra duração sem status de resposta concluída.

`dependency_unreachable` com `ECONNREFUSED` indica conexão recusada (verifique o DynamoDB Local em `127.0.0.1:8000`); `dependency_resource_missing` com `ResourceNotFoundException` indica recurso/tabela ausente. A classificação percorre causas e erros agregados limitados, emitindo apenas nomes/códigos conhecidos. `unknown_error` exige investigação local; mensagens, stack, objetos AWS/Axios, conteúdo, identidade, cookies e tokens nunca são registrados, inclusive em debug.

`dependencies.configured` confirma somente a composição, e `/health` confirma que o processo HTTP responde: nenhum dos dois testa conexão ou existência de tabela. `server.listening` informa a porta local sem imprimir endpoints com credenciais. Para a Lambda futura, a mesma saída JSON permite correlação por `requestId` no destino CloudWatch configurado no deployment; o ID interno é independente do ID da invocação AWS. Não há deployment, configuração CloudWatch, retenção ou alarmes implementados nesta frente.

Em falhas nas rotas montadas, o template completo é capturado antes de o Express sair do router (por exemplo, `/v1/notes/:id`), sem UUID real nem query. `request.failed` inclui método limitado aos verbos reconhecidos (demais: `OTHER`) e status público que o handler enviaria. Se os headers já foram enviados, esse status descreve a falha detectada, não altera o status já transmitido: o handler encerra a conexão sem entregar o Error bruto ao handler padrão do Express. O evento final é `request.aborted`, sem status de conclusão. Falha no sink não interrompe o processamento HTTP.
