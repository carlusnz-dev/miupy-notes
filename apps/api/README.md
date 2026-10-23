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

`LOG_LEVEL=debug npm run dev:api` habilita eventos de início de requisição; o padrão `info` registra conclusão/abort, configuração e listener. `LOG_LEVEL` aceita `debug`, `info`, `success`, `warn` e `error` (valor inválido usa `info`; `success` tem a mesma prioridade de `info`). A saída padrão é legível: `{timestamp UTC} {TYPE} - {method} {rota template} {motivo} [HTTP status | duração | requestId]`. Eventos do sistema omitem método, rota e detalhes da requisição. Erros vão ao stderr, os demais ao stdout. Cores automáticas em TTY: sucesso verde, aviso amarelo, erro vermelho, info ciano e debug cinza; redirecionamento, `NO_COLOR` ou `TERM=dumb` desativam cores. A classe `Logger` recebe sink e opções de formato/cor para testes, sem dependência nova.

```text
2026-10-20T22:30:00.000Z SUCCESS - GET /v1/notes/summary Requisição concluída com sucesso. [HTTP 200 | 12 ms | requestId=uuid]
2026-10-20T22:30:01.000Z ERROR - GET /v1/notes/summary Não foi possível conectar ao serviço de dados; verifique se ele está disponível. [HTTP 500 | requestId=uuid | ECONNREFUSED]
2026-10-20T22:30:02.000Z INFO - Servidor pronto na porta 4000.
```

`LOG_FORMAT=json npm run dev:api` preserva JSON por linha para coleta automatizada, com `timestamp`, `level`, `event`, `message` e os mesmos metadados permitidos; sem ANSI. O valor padrão é `pretty` (formato inválido também usa `pretty`). Conclusões HTTP 2xx/3xx usam `success`, 4xx `warn`, 5xx `error`; conexão interrompida usa `warn`. A classificação ocorre antes do filtro de nível: `LOG_LEVEL=error` ainda mostra a conclusão de um HTTP 500.

Toda resposta inclui `X-Request-Id`, UUID gerado internamente (o header recebido do cliente é ignorado). Nos erros, é o mesmo `error.requestId` já previsto no contrato. Procure esse UUID no console para relacionar `request.failed` e `request.completed`: método, template de rota quando reconhecido, status e `durationMs`. Início, JSON inválido, autenticação antecipada e rotas desconhecidas podem ter `route: "unmatched"`; nenhum caminho real ou query é registrado. Abort registra duração sem status de resposta concluída.

`dependency_unreachable` com `ECONNREFUSED` indica conexão recusada (verifique o DynamoDB Local em `127.0.0.1:8000`); `dependency_resource_missing` com `ResourceNotFoundException` indica recurso/tabela ausente. O modo legível traduz essas classificações em motivos de conexão/recurso ausente; rejeições HTTP têm motivos por status e JSON malformado tem texto específico. A classificação percorre causas e erros agregados limitados, emitindo apenas nomes/códigos conhecidos. `unknown_error` exige investigação local; mensagens, stack, objetos AWS/Axios, conteúdo, identidade, cookies e tokens nunca são registrados, inclusive em debug.

`dependencies.configured` confirma somente a composição, e `/health` confirma que o processo HTTP responde: nenhum dos dois testa conexão ou existência de tabela. `server.listening` informa a porta local sem imprimir endpoints com credenciais. Para a Lambda futura, `LOG_FORMAT=json` permite correlação por `requestId` no destino CloudWatch configurado no deployment; o ID interno é independente do ID da invocação AWS. Não há deployment, configuração CloudWatch, retenção ou alarmes implementados nesta frente.

Em falhas nas rotas montadas, o template completo é capturado antes de o Express sair do router (por exemplo, `/v1/notes/:id`), sem UUID real nem query. `request.failed` inclui método limitado aos verbos reconhecidos (demais: `OTHER`) e status público que o handler enviaria. Se os headers já foram enviados, esse status descreve a falha detectada, não altera o status já transmitido: o handler encerra a conexão sem entregar o Error bruto ao handler padrão do Express. O evento final é `request.aborted`, sem status de conclusão. Falha no sink não interrompe o processamento HTTP.

## Calendar

`/v1/calendar` usa o mesmo principal de notas/finanças. CRUD de eventos é local e versionado; contrato em `docs/arquitetura/api-calendar.md`. A composição padrão informa Google `not_configured`. A API local Linux aceita opt-in `login-keyring`: o login único do Tauri já pede o Calendar e a API lê o refresh token do chaveiro do login, sem segundo consentimento; Lambda permanece sem adaptador de credenciais. Não use o ID token do login como token Calendar.

Retry-After do provedor aceita segundos/HTTP-date; esperas longas retornam ao cliente com o prazo intacto em cabeçalho HTTP, sem prender o pedido nem reduzir para 60 s. Testes usam fakes e HTTP local, sem Google real.


Para configurar Calendar local, habilite a Calendar API no projeto do cliente OAuth **Desktop** já usado pelo login. Defina `GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring` no ambiente da API **e** do Tauri (o mesmo `.env.local` em dev): na API ele habilita o conector com `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` do login; no Tauri, o login padrão passa a pedir também `calendar.events.owned.readonly`. `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` e `secret-service` foram removidos e falham na inicialização (o refresh token só renova com o cliente que o emitiu). Instale `secret-tool` (libsecret) e desbloqueie o Secret Service da sessão. Mantenha valores privados fora do Git e do frontend. Não foi inspecionado o ambiente real: este procedimento descreve a configuração esperada.

Há um único consentimento Google, o do login. O Tauri guarda o refresh token no keyring e mantém o ID token em memória para autenticar a API; a API lê o refresh token (somente leitura) com `secret-tool`, renova o access token em memória e confere que o `sub` devolvido é o do proprietário. Quem fez login antes desta mudança, ou desmarcou o Calendar na tela de consentimento, vê `SCOPE_NOT_GRANTED` ao ativar e precisa refazer o login uma vez pela tela de Agendas; apps instalados não suportam autorização incremental. Veja [OAuth Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) e [parâmetros de sessão/consentimento OIDC](https://developers.google.com/identity/openid-connect/openid-connect#authenticationuriparameters).

No processo Tauri, `MIUPY_API_BASE_URL` é opcional (padrão `http://127.0.0.1:4000`); o adaptador aceita somente HTTP em `127.0.0.1`, sem userinfo/query/fragmento.

Abra Agendas → Ativar Google Calendar (sem nova tela de login). "Alterar permissão" ou "Conceder Calendar no login do Google" refazem o login do Google uma vez, com leitura ou leitura e escrita. A carga inicial cobre 30 dias passados e 366 futuros, com cursor incremental sob demanda; não representa todo o calendário nem avança a janela automaticamente. Escrita de espelhos usa PATCH/If-Match, preservando campos fora do formulário; novos eventos locais só são enviados pela escolha explícita do usuário. Cópias já enviadas acompanham salvar/excluir.

O token é um só: Desconectar o Calendar apaga cadastro e espelhos e não revoga nada; sair da conta revoga o token do login e, com a [revogação Google](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke), também o acesso ao Calendar. A revogação é de melhor esforço e pode demorar.

Esta leitura do chaveiro e a serialização conectar/desconectar atendem **um processo da API local Linux**. Não habilite várias instâncias contra o mesmo repositório sem coordenação persistida. Não há implantação AWS, conexão Google real ou consentimento nativo verificado nesta frente; veja `docs/relatorios/2026-10-22_calendar-sync.md`.

## Biblioteca

`/v1/library` oferece CRUD autenticado/versionado e filtros por tipo, status, tag e título, com cursor. Contrato em [api-library.md](../../docs/arquitetura/api-library.md). Usa `LIBRARY#<id>` na mesma tabela, sem variáveis novas nem chamadas a catálogos externos. Testes HTTP em memória, adaptador com cliente falso e integração opt-in via `DYNAMODB_TEST_ENDPOINT` restrito a loopback; a integração cria e exclui sua própria tabela sintética. Sem AWS, upload, exportação/restauração ou outbox.
