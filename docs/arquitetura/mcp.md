# Servidor MCP

**Estado em 2026-10-26.** `apps/mcp` existe e foi verificado **localmente** com a API real em memória (sem DynamoDB, sem AWS): transporte **stdio funcional**; **Streamable HTTP preparado e testado, mas não executável de ponta a ponta** porque a troca de identidade MCP → API ainda é uma decisão pendente ([decisão](../decisoes/2026-10-26_mcp-identidade-e-transporte.md)). Nada foi publicado ou implantado. RF-11 está **parcialmente** atendido (ver [Lacunas](#segurança-e-lacunas-em-relação-ao-rf-11)).

## Fronteira

```text
Cliente MCP (Claude Code / Codex / Gemini CLI)  --stdio-->  apps/mcp  --HTTPS + Bearer-->  apps/api  -->  DynamoDB
Cliente MCP remoto (Claude, ChatGPT, Gemini)    --HTTPS-->  apps/mcp (HTTP) --troca de identidade--> apps/api
```

O MCP é um **adaptador**: cada ferramenta chama um endpoint real de `/v1` com o token do próprio usuário e a API continua sendo a autoridade (propriedade dos dados, versão, limites, `ownerId` derivado do token). O MCP não acessa DynamoDB, não duplica regra de domínio e não tem ferramenta genérica (shell, SQL, AWS, HTTP arbitrário). Os schemas de resposta vêm de `apps/api/src/modules/{notes,folders}/contract.ts`, os mesmos do cliente web: mudança incompatível na API quebra o build/testes do MCP em vez de passar em silêncio.

Estrutura: `src/api-client.ts` (fetch com timeout, mapa de erros, sem estado de usuário), `src/tools.ts` (schemas, escopos e handlers), `src/server.ts` (registro no SDK, erros e logs), `src/stdio.ts`, `src/http.ts` (`createHttpApp`, app Express stateless).

## Ferramentas

SDK oficial `@modelcontextprotocol/sdk` 1.32.2 (npm, publicado 2026-10-23), com schemas Zod 4 estritos (`additionalProperties: false`; `ownerId` e campos desconhecidos são rejeitados antes de chegar à API).

| Ferramenta | Escopo | Endpoint | Observação |
|---|---|---|---|
| `notes_search` | `notes:read` | `GET /v1/notes/metadata` (até 5 páginas de 100) | Filtra **título (sem acento/caixa), tag exata e pasta**; sem corpo. A API não tem busca de texto; `scanComplete: false` indica que o acervo (>500 ou limite atingido) não foi todo examinado. |
| `notes_get` | `notes:read` | `GET /v1/notes/{id}` | Devolve corpo e `version`. |
| `notes_create` | `notes:write` | `POST /v1/notes` | Não idempotente (a API ainda não tem chave de idempotência); sem retentativa. Devolve só metadados. |
| `notes_update` | `notes:write` | `PATCH /v1/notes/{id}` | Exige `expectedVersion`; `409` vira `CONFLICT` sem sobrescrever. Campos informados substituem os atuais. Marcada `destructiveHint` por sobrescrever corpo. |
| `folders_list` | `notes:read` | `GET /v1/folders` | Somente leitura de pastas. |

Limites iguais aos da API: título 1–200, corpo ≤ 100 000, até 20 tags de 1–40, `limit` de busca 1–50 (padrão 20). **Não existe ferramenta de exclusão** (nota ou pasta) nem de operação em massa; um teste confere a lista exata de ferramentas.

**Conteúdo não confiável.** Resultados que trazem texto do usuário (`notes_get`, `notes_search`, `folders_list`) incluem `contentTrust: "untrusted"` e um `notice` antes dos dados, e o servidor declara em `instructions` que notas são dados. Isso reduz, mas **não elimina** prompt injection: a defesa estrutural é a ausência de ferramenta destrutiva, o menor privilégio por escopo e o controle de versão.

**Erros** (`isError: true`, texto JSON `{ error: { code, message, requestId? } }`, mensagens fixas, sem token nem corpo): `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` (rede, timeout de 10 s, 5xx, resposta fora do contrato), `INTERNAL_ERROR`. O `requestId` é o da API, para achar o log dela.

### Ferramentas futuras (não implementadas)

Hábitos: o contrato está sendo criado em `feat/habits-mvp`; tarefas existem como `/v1/calendar/tasks` mas ficaram fora deste recorte. Quando os contratos estiverem em `develop`: `habits_list`, `habits_get`, `habits_log` (registrar um dia), `tasks_list`, `tasks_create`, `tasks_complete`, com escopos separados (`habits:*`, `tasks:*`), mesmos limites de resultado, versão/idempotência conforme a API, e **nenhuma exclusão**. Rodar a skill `revisar-contrato` antes. Finanças e Biblioteca ficam fora do MCP até haver decisão específica (dados financeiros exigem confirmação e auditoria do RF-11).

## stdio (local)

Funcional. `npm run start --workspace @miupy-notes/mcp` (ou `npm run dev:mcp`, que também lê `apps/mcp/.env.local`, ignorado pelo Git). Variáveis:

| Variável | Uso |
|---|---|
| `MIUPY_API_BASE_URL` | Padrão `http://127.0.0.1:4000`. HTTP só em loopback; fora disso exige HTTPS (token não viaja em claro). Sem redirecionamento (`redirect: "error"`). |
| `MIUPY_API_TOKEN_FILE` | **Preferido.** Arquivo (modo 0600) com o ID token vigente, relido a cada chamada. |
| `MIUPY_API_TOKEN` | Alternativa estática; fica no ambiente do processo. |

stdout é exclusivo do protocolo (`console.log` redirecionado a stderr; logs JSON só em stderr, sem token, corpo ou conteúdo de nota). O ID token do Google dura cerca de 1 hora e **ainda não existe forma automática de obtê-lo/renová-lo** fora do app Tauri: hoje é preciso gravar o token no arquivo manualmente. Este é o principal obstáculo de uso real do stdio (ver Pendências).

Registro nos clientes (substitua o caminho absoluto; nunca versione o token). Sintaxes conferidas nas documentações citadas em 2026-10-26:

```bash
# Claude Code (escopo do usuário; não toca o .mcp.json do repositório, que registra o Playwright)
claude mcp add --scope user miupy-notes \
  --env MIUPY_API_BASE_URL=http://127.0.0.1:4000 --env MIUPY_API_TOKEN_FILE=$HOME/.config/miupy/mcp-token \
  -- node --import tsx /CAMINHO/miupy-notes/apps/mcp/src/stdio.ts
```

```toml
# Codex — ~/.codex/config.toml (fonte: learn.chatgpt.com/docs/extend/mcp, 2026-10-26)
[mcp_servers.miupy-notes]
command = "node"
args = ["--import", "tsx", "/CAMINHO/miupy-notes/apps/mcp/src/stdio.ts"]
cwd = "/CAMINHO/miupy-notes/apps/mcp"
[mcp_servers.miupy-notes.env]
MIUPY_API_BASE_URL = "http://127.0.0.1:4000"
MIUPY_API_TOKEN_FILE = "/home/USUARIO/.config/miupy/mcp-token"
```

```json
// Gemini CLI — ~/.gemini/settings.json (fonte: geminicli.com/docs/tools/mcp-server, 2026-10-26)
{ "mcpServers": { "miupy-notes": {
  "command": "node", "args": ["--import", "tsx", "/CAMINHO/miupy-notes/apps/mcp/src/stdio.ts"],
  "cwd": "/CAMINHO/miupy-notes/apps/mcp",
  "env": { "MIUPY_API_BASE_URL": "http://127.0.0.1:4000", "MIUPY_API_TOKEN_FILE": "/home/USUARIO/.config/miupy/mcp-token" },
  "trust": false } } }
```

Mantenha `trust: false` (Gemini CLI) e as confirmações de ferramenta de escrita ligadas nos três clientes. `tsx` vem do `node_modules` do workspace (`--import tsx` resolve a partir do `cwd`/pacote); por isso `cwd` aponta para `apps/mcp`. Não executei os três registros reais: só o MCP Inspector CLI (ver relatório).

## Streamable HTTP (preparado, não publicado)

`createHttpApp(options)` devolve um app Express **stateless** (servidor + transporte novos por requisição, sem `Mcp-Session-Id`, GET/DELETE respondem `405`), pronto para `serverless-http` atrás de API Gateway HTTP API. Implementado e testado:

- **Auth de recurso protegido.** Bearer em toda requisição; verificação com `jose` (assinatura RS256/ES256, `iss`, `aud` = URL canônica do recurso, `exp`). Sem token/token inválido: `401` com `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` (+ `error="invalid_token"`). Metadados RFC 9728 em `/.well-known/oauth-protected-resource[/mcp]`, listando o emissor.
- **Autorização por operação.** `tools/call` (inclusive em lote) é conferida contra o escopo da ferramenta antes de despachar: `403` com `error="insufficient_scope"`. O handler repete a checagem.
- **Sem token passthrough.** O token recebido nunca é encaminhado: `VerifiedAuth` só tem `sub` e escopos, e a função injetada `apiClientFor(auth)` cria o cliente da API (decisão pendente abaixo).
- **Rebinding/abuso.** `Host` validado contra o host do recurso, `Origin` presente só passa se listado (padrão: nenhum), corpo JSON ≤ 512 kB (`413`), JSON inválido `400`, `Cache-Control: no-store`. Rate limit fica no API Gateway (throttling), não no processo.
- Testes: 401 sem token/expirado/audiência, emissor ou chave erradas; `403` de escopo; Host/Origin; fluxo completo com o cliente do SDK e isolamento entre dois usuários.

**Não existe `main` HTTP nem script `start:http`**: sem a troca de identidade ele não poderia chamar a API. Integração Lambda/API Gateway prevista (quando decidida): um handler `serverless-http(createHttpApp({...}))` como na `apps/api/src/lambda.ts`; rota `POST /mcp` e `GET /.well-known/oauth-protected-resource/*` sem authorizer do gateway (o próprio app devolve o `401` com o desafio exigido pelos clientes; Claude exige `401`, não aceita o desafio em `200`); domínio HTTPS próprio, porque `resource` precisa ser a URL exata digitada no cliente; respostas em JSON (sem SSE) para funcionar com o buffer do API Gateway; timeout de integração acima dos 10 s do cliente da API. Custo/cold start não medidos.

### Requisitos reais de OAuth (consultados em 2026-10-26)

| Fonte | O que exige |
|---|---|
| [Spec MCP, revisão 2026-07-28 — autorização](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | Servidor MCP é *resource server* OAuth 2.1: **MUST** publicar Protected Resource Metadata (RFC 9728); validar que o token foi emitido **para ele** (audiência, RFC 8707) e **não aceitar nem repassar outros tokens**; `401`/`403` com `WWW-Authenticate` (`scope`, `insufficient_scope`); token só em `Authorization`, nunca na query. Servidores de autorização: PKCE, metadados RFC 8414/OIDC; clientes **SHOULD** usar Client ID Metadata Documents (CIMD); DCR está marcado como obsoleto/compatibilidade. stdio **não** deve seguir esta spec (credenciais do ambiente). |
| [Spec MCP 2026-07-28 — Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) | Um endpoint POST; **sessões e o stream GET foram removidos** nesta revisão (servidor deve responder `405` a GET/DELETE e ignorar `Mcp-Session-Id`); cabeçalhos `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` obrigatórios; validar `Origin` (`403`). |
| [Claude — autenticação de conectores](https://claude.com/docs/connectors/building/authentication) | DCR e CIMD aceitos por padrão; callback fixo `https://claude.ai/api/mcp/auth_callback` (Claude Code usa loopback de qualquer porta); **`401` obrigatório** para iniciar login; usa só o 1º item de `authorization_servers`; `resource` igual à URL digitada; PKCE S256; `/token` aceita `application/x-www-form-urlencoded`; discovery/token em ≤ 10 s; tráfego de saída de `160.79.104.0/21`; sem `client_credentials`. Cliente OAuth próprio pode ser informado manualmente (cadastro por conector personalizado). Credencial estática por cabeçalho é beta e só para organizações liberadas. Mesma infraestrutura em claude.ai, Desktop, mobile, Claude Code. |
| [ChatGPT — Apps SDK, autenticação](https://developers.openai.com/apps-sdk/build/auth) | OAuth 2.1 com RFC 9728; AS precisa anunciar `S256`; CIMD preferido (`https://chatgpt.com/oauth/client.json`) ou DCR; redirect `https://chatgpt.com/connector_platform_oauth_redirect` (ou `…/connector/oauth/{callback_id}`); envia `resource` e espera que vire `aud`; **sem** `client_credentials` nem API key/certificado customizado; mTLS opcional para identificar o ChatGPT. |
| [Gemini Apps — apps personalizados](https://support.google.com/gemini/answer/17209137) | URL de servidor MCP; se o AS **não** tem DCR, o usuário informa credenciais manualmente em “Recursos avançados”. Sem data de publicação na página. |

Consequência prática: um MCP remoto utilizável por esses três exige um **servidor de autorização** com PRM, metadados RFC 8414/OIDC, PKCE S256, `resource`→`aud`, e DCR e/ou CIMD (ou cadastro manual do cliente, aceito por Claude e Gemini). O ID token do Google usado pela API **não serve**: seu `aud` é o client ID do app, não o MCP, e repassá-lo é proibido pela spec. Ver as opções e o que falta decidir na [decisão](../decisoes/2026-10-26_mcp-identidade-e-transporte.md).

**Compatibilidade de versão.** O SDK 1.32.2 anuncia protocolo até `2025-11-25`; a revisão `2026-07-28` (sem sessões, metadados por requisição, `Mcp-Method`) **não** está nele. A spec prevê fallback para clientes modernos, mas não testei nenhum cliente real contra o HTTP: é risco a validar antes de publicar (ou migrar quando o SDK suportar).

## Gemini no Android

Pesquisa em 2026-10-26, sem implementar ponte:

- **Fonte oficial** ([Ajuda do Gemini — conectar apps personalizados, versão Android](https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DAndroid)): o app Gemini **usa** servidores MCP personalizados já conectados, mas **não se adiciona o servidor pelo app Android**: abre-se gemini.google.com no navegador do celular, Configurações → Apps conectados → “Adicionar app personalizado” e informa-se a URL. Depois o app fica disponível no app móvel e na web. Requisitos listados: **18+ e nos EUA**, conta Google **pessoal** (não Workspace/escola), Atividade do app Gemini ligada, só em **inglês** por ora, servidor aderente à spec MCP. A página não cita transporte, nem se a chamada sai do dispositivo ou da nuvem do Google, nem data.
- Fontes secundárias (sem confirmação oficial): recurso liberado a partir de junho de 2026; servidor precisa ser remoto/HTTPS (stdio local não funciona).
- Não confundir com Gemini CLI (cliente local, aceita stdio/HTTP), Gemini API e Gemini Enterprise (admin configura, Streamable HTTP por HTTPS).

**Implicação:** com a restrição “nos EUA/inglês”, o proprietário (fuso e idioma pt-BR) provavelmente **não** conseguirá usar o caminho oficial; mesmo elegível, exigiria o MCP remoto autenticado ainda não decidido. **Alternativas viáveis**, da menor para a maior distância: (1) usar o app móvel do **Claude** ou do **ChatGPT** com o conector remoto (Claude declara a mesma infraestrutura de conectores no mobile; o ChatGPT precisa do modo de desenvolvedor e plano compatível — não verifiquei); (2) acessar as notas pelo próprio app Tauri/Web do projeto no celular, se vier a existir versão móvel; (3) Gemini CLI/Antigravity ou Claude Code no desktop com o stdio; (4) ponte própria no Android (app que chama a API com function calling) — fora do escopo e com custo de manutenção.

## Segurança e lacunas em relação ao RF-11

- Isolamento: o MCP nunca envia `ownerId`; cada requisição leva o token do contexto (stdio: arquivo relido; HTTP: cliente criado por requisição). Teste: token de B recebe `404`/lista vazia para notas de A, chamadas simultâneas não misturam tokens.
- Conteúdo de notas **sai para o provedor do LLM** escolhido pelo cliente (Anthropic, OpenAI, Google). Isso é inerente ao uso de MCP; não registre/exponha notas que não queira enviar.
- RF-11 pede “confirmação para escrita e trilha de auditoria”. **Confirmação:** o servidor não consegue impô-la no stdio; depende do cliente (que por padrão pede permissão por ferramenta; `destructiveHint` marca `notes_update`). Elicitação MCP não foi usada (suporte irregular entre clientes). **Auditoria:** só log em stderr com nome da ferramenta, código, duração e `requestId` da API; não há trilha persistente nem por usuário. Portanto RF-11 **não** está marcado como atendido.
- Sem idempotência de `POST /v1/notes` na API: um retry do agente cria nota duplicada.
- Sem rate limit próprio no processo stdio.

## Aba "MCP" no app e testes contra a API remota (2026-10-27)

- **Aba `/mcp`** (`apps/web/src/McpPage.tsx`, na Sidebar e no menu "mais" do celular): estado da conexão (consulta o `/health` público, sem token), lista estática das cinco ferramentas (espelha `apps/mcp/src/tools.ts`; atualizar junto) e comandos de registro para Claude Code e Codex com HTTPS. Nenhum token na tela nem no bundle. Em dev, o proxy do Vite passou a encaminhar `/health`. Em build Tauri/produção o `/health` é entre origens: precisa de CORS no API Gateway, ainda não verificado.
- **HTTPS remoto** é aceito pelo cliente (`assertSafeBaseUrl`, teste em `test/base-url.test.ts`); HTTP só em loopback.
- **Testes opt-in** `apps/mcp/test/remote.test.ts`: pulados sem `MIUPY_API_URL`; `/health` e 401 só precisam dela; o CRUD também exige `MIUPY_ID_TOKEN`. O CRUD cria uma nota e a apaga ao final via `DELETE /v1/notes/{id}` (o MCP não tem exclusão). Não executados contra a nuvem nesta sessão (variáveis ausentes).

## Pendências

1. Decidir servidor de autorização e a troca de identidade MCP → API (decisão pendente; muda autenticação da API: exige aprovação).
2. Provisionar/renovar o ID token do stdio sem copiar à mão (comando no app Tauri que escreva o arquivo 0600, ou fluxo próprio).
3. Validar HTTP com clientes reais (Claude, ChatGPT) em staging, depois que existir infra; medir cold start/custo.
4. Confirmação/auditoria persistentes para escrita (RF-11) e idempotência de criação na API.
5. Busca de texto na API (hoje o MCP só filtra título/tag); ferramentas de hábitos/tarefas após o contrato.
