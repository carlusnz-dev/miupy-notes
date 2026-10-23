# Calendar — OAuth unificado no login

Branch `fix/calendar-single-oauth`, base `fcaf49c`. Decisão: [login Google único](../decisoes/2026-10-22_calendar-login-unico.md). Escopo: login do Tauri, módulo Calendar da API, GooglePanel e documentação. Sem design/CSS além do GooglePanel.

## Diagnóstico (antes da mudança)

- **Login das notas:** Tauri (`auth.rs`) usa authorization code + PKCE S256 + loopback com escopos `openid email profile`. O refresh token vai ao keyring (`com.miupy.notes` / `google-refresh-token`); o ID token fica em memória e é devolvido por `auth_id_token` (com refresh). A API valida o ID token com `jose` (JWKS do Google, RS256, `iss`, `aud`, `exp`), usa `sub` como `ownerId` e confere `ALLOWED_SUBS`.
- **Calendar:** segundo OAuth. `calendar_google_connect` (Rust) pedia `POST /google/authorization`, abria o navegador com escopo Calendar, `prompt=consent`, `include_granted_scopes=false`, e mandava `code`/`verifier` a `POST /google/connection`. A API trocava o código, conferia o `scope` e guardava **outro** refresh token no Secret Service (`application=com.miupy.notes.calendar` + hash do dono). Refresh e revogação próprios na API; o cliente OAuth podia ser o do login (sessão 16), mas o consentimento e o token continuavam separados.
- **Pontos que forçavam o segundo OAuth:** (1) botão "Conectar Google Calendar" → navegador; (2) "Alterar permissão" → novo consentimento; (3) `needs_reauth` → novo consentimento; (4) o login nunca pedia escopo Calendar, então nenhum token do login servia (sessão 16: nenhum token migrado).
- **Linha de base:** `tsx --test` do Calendar 94 aprovados/5 ignorados; `npm run test:api` (sem `DYNAMODB_*`) 174 aprovados/9 ignorados/0 falhas; `build:api` e `check:modules` ok.

## O que mudou

- **Rust:** `auth_sign_in(calendar?)`; `login_scopes` soma o escopo Calendar (leitura por padrão com `GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring`, ou o modo escolhido na tela, com `prompt=consent`). `calendar_oauth.rs` e seus dois comandos removidos.
- **API:** `LoginCredentialStore` (leitura do keyring do login via `secret-tool lookup`, sem escrita) no lugar do cofre Calendar; `HttpGoogleOAuth` só renova e devolve `scope` e `sub`; `AccessTokenSource` recusa token de outra conta; `POST /google/connection` virou `{}` e confere escopos (`SCOPE_NOT_GRANTED`); `POST /google/authorization`, `state` pendente (repositórios memória/Dynamo) e revogação em disconnect removidos. Factory exige `login-keyring` e rejeita `GOOGLE_CALENDAR_CLIENT_ID/SECRET` e `secret-service`.
- **Web:** GooglePanel mostra "Conectado via sua conta Google", "Ativar Google Calendar" sem navegador, e só oferece refazer o login (`grantCalendar` → `auth_sign_in`) se faltarem escopos, em `needs_reauth` ou ao alterar permissão; Cancelar/Finalizando removidos; texto do modal de desconexão corrigido (não revoga).
- **Docs:** `api-calendar.md`, `api.md`, `backend.json`, `arquitetura.json`/`.md`, `seguranca.md`, `stacks.md`, `requisitos.md`, `apps/api/README.md`, decisão nova e as duas anteriores marcadas como superadas.

## Verificação executada (comandos e resultados reais)

| Comando | Resultado |
|---|---|
| `tsx --test` dos arquivos de teste do Calendar (google/, services/, routes/) | 72/72 aprovados |
| `env -u DYNAMODB_TEST_ENDPOINT -u DYNAMODB_FINANCE_TEST_ENDPOINT npm run test:api` | 179 testes: 170 aprovados, 9 ignorados (DynamoDB Local), 0 falhas |
| `npm run build:api` / `npm run check:modules` | aprovados / 4 módulos válidos |
| `npm run build:web` / `npm run test:web` | `tsc` + Vite ok / 160 de 160 |
| `cargo test --offline` em `src-tauri` (target no scratchpad) | 9 aprovados, 0 avisos no `cargo check` |
| `python3 -m json.tool` em `arquitetura.json` e `backend.json`; `git diff --check` | aprovados |

Testes novos/ajustados (todos com fakes): renovação com `scope`/`sub`; resposta inválida; token de outra conta; sem login no keyring; escopo ausente sem cadastro e sem revogar; reflect/mirror e releitura de escopos; disconnect preserva o token e os eventos locais; concorrência connect/disconnect; rota `POST /connection` com `{}`, corpo extra (400), `SCOPE_NOT_GRANTED` e `/google/authorization` inexistente (404); factory com cliente/segredo do login e variáveis legadas; leitor do keyring com executor falso; `login_scopes` em Rust. A suíte caiu de 174 para 170 aprovados porque os testes de `state`/troca de código/Dynamo pendente saíram com o fluxo.

## NÃO verificado

- Keyring real: `secret-tool lookup service … username …` lendo o item gravado pela crate `keyring` 4.2 (atributos inferidos do teste da crate, não observados). Se divergirem, a API lê `null` e o Calendar pede novo login.
- Login/consentimento reais, tela de consentimento granular, refresh e Calendar API do Google, revogação efetiva, janela Tauri/WebKit (`npm run tauri dev` não executado) e GooglePanel renderizado (só `tsc`/build Vite; sem teste de componente nem `validar-design`).
- Mantidos fora por regra: `.env*` (`.env.example`, `apps/api/.env.development`) não foram abertos e podem ainda citar `GOOGLE_CALENDAR_CLIENT_*` ou `secret-service`; o proprietário precisa definir `GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring` no ambiente da API e do Tauri. Itens `CALENDAR#GOOGLE#PENDING` antigos no DynamoDB não foram limpos. O relatório da sessão 17 citado no pedido não existe no repositório.
- Nenhuma chamada a Google/AWS/GCP, push, PR, merge ou deploy.

## Pendências e riscos

- Quem logou antes precisa refazer o login uma vez (sem autorização incremental). Reflect só por escolha explícita; o escopo é o do último login.
- Um único refresh token: Desconectar Calendar não revoga; sair da conta revoga login e Calendar. A API local passa a alcançar o refresh token do login (mitigado por leitura única, `sub` e Lambda sem adaptador).
- Quando o proprietário autorizar, validar com conta real: login com Calendar, `secret-tool` no keyring do Hyprland, escopo granular e logout.

## Adendo 2026-10-23 — correções da revisão e cache da Agenda

Revisão independente (contrato/lógica) apontou dois problemas médios, corrigidos neste PR:

- **M1, troca de conta ao refazer o login pelo Calendar:** `auth_sign_in` com `calendar` obtém o `sub` da sessão (renovando o ID token se preciso), envia `login_hint` e, se o ID token novo for de outra conta, retorna `ACCOUNT_CHANGED` sem gravar sessão nem refresh token e revoga o token recém-emitido (melhor esforço). Mensagem em `auth.ts`.
- **M2, modo `reflect` obsoleto após novo login:** `scoped()` no serviço reconfere os escopos do token atual antes de sincronizar e de cada escrita; rebaixa para `mirror`, volta a `reflect` ou marca `needs_reauth` + `SCOPE_NOT_GRANTED`. `403 insufficientPermissions` → `409 SCOPE_NOT_GRANTED` (descarta o token em cache); demais `403` → `403 UPSTREAM_FORBIDDEN`. Antes viravam `502` repetido indefinidamente pela outbox.
- Contrato: `api-calendar.md` (escopos por operação, novos erros, `login_hint`/`ACCOUNT_CHANGED`, `calendarId`/`connectedAt` em `GET /google`) e adendo na decisão de login único.

Cache da Agenda (pedido do proprietário): `calendar/fetch-cache.ts`, memória por conta no módulo, sobrevive a trocar de página. Período reconciliado há menos de 2 min não vai à rede (eventos continuam vindo do IndexedDB); os "próximos" deixam de ser buscados a cada navegação; envio, conflito, mudança durante a busca e "atualizar" invalidam. Lista de notas e status do Google também ficam em memória por 2 min; status é rebuscado quando a rede volta. A última vista (modo/data) é restaurada ao voltar à página.

Verificação (worktree, 2026-10-23): testes Calendar API 99 (94 ok, 5 ignorados); `test:api` 183 (174 ok, 9 ignorados DynamoDB, 0 falhas); `build:api`; `check:modules` (4 válidos); `tsc` web; `test:web` 162/162 (2 novos do cache); `vite build` ok (aviso de chunk do editor já existente); `cargo test --offline` 9/9. Playwright no `tests/calendar-harness.html` (vite 5184): chamadas `list` do remoto falso: inicial 2; Semana +1; Dia, Semana 0; Mês +1; Dia 0; próximo +1; anterior 0 (antes, 2 por navegação). Console: só `favicon.ico` 404. Não verificado: login/chaveiro/consentimento reais, revogação efetiva, escolha de outra conta na tela do Google, Tauri/WebKit. `cargo fmt --check` aponta diferenças já existentes no arquivo antes desta mudança (não reformatado para manter o diff pequeno).
