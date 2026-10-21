# Agendas/planner com espelho e refletor do Google Calendar

Branch `feat/calendar-planner` (renomeada de `carlusnz-dev/feat-calendar-planner` antes do primeiro commit, pela regra de prefixo Conventional Commits). Worker do Orca, worktree isolada; coordenador integra docs centrais. Contrato: [`api-calendar.md`](../arquitetura/api-calendar.md).

## O que mudou

- **API** `apps/api/src/modules/calendar` (estrutura padrão, `check:modules` válido): eventos por proprietário com `version` condicional, criação idempotente por `id` do cliente, dia inteiro/fuso, filtro por período com paginação, relações com notas e eventos. Repositórios DynamoDB e em memória. Montado em `/v1/calendar` por `app.ts` (`calendarRouter` opcional), `compose.ts`, `server.ts`, `lambda.ts` (mudanças só aditivas). Única edição fora do escopo previsto: prefixo `/v1/calendar` na lista de rotas conhecidas de `core/http/request-logger.ts` (sem isso o log mostraria a rota sem o prefixo; ajuste autorizado pelo coordenador, com teste em `app.test.ts`).
- **Google** atrás de portas (`GoogleOAuth`, `CredentialStore`, `GoogleCalendarClient`) com implementação HTTP e fakes. Espelho: sync completa/incremental com `syncToken`, paginação, `410`, ID determinístico. Refletor: envio por ação explícita com ID derivado, `If-Match`, reconciliação de `409`/`412`. Sem configuração o status é `not_configured`.
- **Web** `apps/web/src/calendar/` + `lib/calendar-api.ts`: dia/semana/mês/ano, lista de próximos eventos, cronograma de blocos, formulário (título, descrição, local, início/fim, dia inteiro, fuso, relações) no `Modal`/`DatePicker`/`Select`/`Badge`/`ButtonGroup` compartilhados, painel Google com estado explícito. GSAP na troca de período/entrada dos blocos com `matchMedia` (sem movimento sob `prefers-reduced-motion`) e `revert()` ao desmontar. Cache + outbox em IndexedDB por conta. `App.tsx`: rota `/agendas`, `/events` redireciona.
- Harness só para validação visual: `apps/web/tests/calendar-harness.{html,tsx}` (servidor e Google falsos na página; dados sintéticos; fora do build).

## Pesquisa (documentação primária, 2026-10-21)

[Guia de sync](https://developers.google.com/workspace/calendar/api/guides/sync) (token só na última página; incremental pode devolver `pageToken`; parâmetros restritos; `410` ⇒ limpar e refazer; cancelados sempre vêm), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) (`maxResults` ≤ 2500; lista dos parâmetros proibidos com `syncToken`), [erros](https://developers.google.com/workspace/calendar/api/guides/errors) (`403 rateLimitExceeded`/`429` mesmo tratamento, backoff exponencial; `410 fullSyncRequired`; `412 conditionNotMet` ⇒ reler e reaplicar), [ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources) (`If-Match` em update/delete; não vale em insert), [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) (ID base32hex 5–1024; colisão pode não ser detectada na criação; `end.date`/`timeZone`; `extendedProperties.private`), [autorização](https://developers.google.com/workspace/calendar/api/auth) (escopos `events.owned(.readonly)`; a página não classificou sensibilidade, então a necessidade de verificação do app **não foi confirmada** — validar no console do Google Cloud). A página de insert não afirma `409` em ID duplicado; o conector trata `409` de forma defensiva e o cliente de teste o simula — **não verificado contra o Google real**.

## Verificação real

| Comando / ação | Resultado |
|---|---|
| `npm run test:api` | 145 testes: 137 passam, 0 falham, 8 ignorados (integrações DynamoDB Local sem `DYNAMODB_TEST_ENDPOINT`), já com o teste dirigido de `/v1/calendar` no logger (autorizado pelo coordenador). |
| `DYNAMODB_TEST_ENDPOINT=http://127.0.0.1:8031 tsx --test src/modules/calendar/calendar.integration.test.ts` | 4/4 contra DynamoDB Local 3.3.1 em contêiner próprio (`-inMemory`, porta 8031, removido ao fim; tabela sintética criada/removida pelo teste). O DynamoDB da porta 8000 (dados do proprietário) **não foi tocado**. |
| `npm run test:web` | 134/134 (inclui `time`, `layout`, `outbox`). |
| `npm run build` (web: `tsc` + Vite; API: `tsc --noEmit`) | Aprovado. Aviso de chunk > 500 kB já existente (editor); chunk da agenda 45 kB. |
| `npm run check:modules` | 4 módulos válidos. `git diff --check` limpo. |
| Graphify | Extração AST `--code-only --no-cluster` em `apps/web/src` e `apps/api/src`, saída em `~/.cache/miupy-notes/graphify/` (fora do Git, sem LLM); consulta dirigida de `CalendarServiceImpl`. |
| Playwright MCP (Chromium) em `tests/calendar-harness.html` | Dia, semana, mês e ano em 1440 px; criação offline com `window.__fake.online=false`: bloco "pendente", registro no IndexedDB real (`kind create, attempts 1, NETWORK_ERROR`), banner "salva só neste dispositivo"; **recarga offline manteve o evento e o envio pendente**; ao voltar online, **uma** chamada `create` e estado "Em dia"; conflito forçado (versão 5 no servidor): bloco "conflito", servidor intacto, painel com "Manter o meu / Usar o do servidor", "Usar o do servidor" limpou a fila. Teclado: Enter no "Novo evento" abre o modal com foco no título; Tab navega; Esc fecha e devolve o foco ao botão. 390 px: layout em coluna, próximos eventos primeiro, sem rolagem horizontal da página. `prefers-reduced-motion: reduce`: sem opacidade/transform inline após troca de modo. Em `/#/events` no app real: redireciona para `#/agendas` e mostra o estado "abra o aplicativo desktop" (navegador, sem Tauri). |

Falhas observadas e corrigidas durante o trabalho: aviso GSAP "target not found" quando a grade não tinha blocos (guardado); grade do ano estourava as colunas (`minmax(0,1fr)`); teste que construía `Response` 204 com corpo; harness sem Sidebar encolhia a coluna do shell (artefato do harness, corrigido nele).

## Não verificado / pendente (ver contrato para a lista completa)

- **Nenhuma conexão real com o Google** (sem credencial, conta ou `.env`); OAuth, sync e reflexão foram exercitados só com fakes e `fetch` injetado. Não há cofre de credenciais de produção nem fluxo de consentimento no desktop; a UI não oferece "Conectar". Necessário decidir: onde guardar o refresh token (KMS/Secrets Manager), cliente OAuth separado do login e como o Tauri recebe o redirect.
- **Janela Tauri/WebKit não verificada**; login real e dados reais do proprietário não usados. Validação visual foi no harness (servidor falso), não com a API real nem com conta autenticada.
- As imagens de referência #1–#5 não estavam disponíveis: o visual segue a descrição escrita e o estilo existente; **não há comparação** com elas.
- Navegação: `Sidebar.tsx` (outro worker) ainda tem "Agenda → `/events`"; o redirect cobre, mas o item não fica ativo em `/agendas` até a Sidebar apontar para `/agendas`. `Home.tsx` também usa `/events`.
- Sair da conta não avisa sobre alterações da agenda não enviadas (limite de `auth.ts`).
- Sem acessibilidade testada com leitor de tela; foco por teclado só pelo Modal/DatePicker compartilhados (não auditado). Fuso: horário de verão ambíguo/inexistente resolve para a primeira ocorrência/deslocamento anterior ao salto (testado em `time.test.ts`).
- Lista do servidor por ID com filtro: custo proporcional ao acervo; sem índice por data.
- Não atualizados (fora do escopo desta frente): `arquitetura.json`, `backend.json`, `api.md`, `requisitos.md`, `docs/relatorios/README.md` (índice) e `apps/api/README.md`. Linha sugerida para o índice: `| 2026-10-21 | Agendas/planner e Google Calendar | [relatório](2026-10-21_calendar-planner.md) |`.
- Nenhuma ação em AWS, Terraform, deploy ou contas reais.

## Correções após revisão independente (HEAD revisado `01eb6dd`)

Três P1 reproduzidos pelo revisor, corrigidos com regressão (as regressões falham no código anterior e passam no novo):

1. **Falha em voo sobrescrevia edição mais nova:** `classify` regravava a cópia antiga do envio. Agora toda atualização pós-envio é compare-and-set pela revisão (`store.updateOp`, atômico em IndexedDB; memória idem); se `rev` mudou, nada é substituído.
2. **Excluir criação em voo ressuscitava o evento:** o envio grava `sentAt` antes de sair (cobre também queda sem ACK). Excluir uma criação com `sentAt` não remove a fila: vira lápide `delete` sem versão, que consulta o servidor (404 ⇒ nunca chegou) e exclui. Criação que nunca saiu continua sendo cancelada sem rede. O ACK de uma revisão antiga reposiciona a revisão mais nova sobre a versão confirmada (`rebaseNewer`; criação vira edição), evitando conflito consigo mesma.
3. **Sync adotava ETag remoto divergente:** `refreshOwnEtag` só adota o ETag se o conteúdo remoto for idêntico ao que o app enviaria; edição feita no Google não avança o ETag e o envio seguinte responde `GOOGLE_CONFLICT` sem sobrescrever.

Verificado: testes do módulo na web (`src/calendar`) e na API (`modules/calendar` + `app.test.ts`), `npm run build`, `check:modules`; suítes completas não repetidas. Mantém-se: sem conexão real com o Google (falta `CredentialStore` de produção e fluxo de consentimento no desktop).

### Segunda rodada da revisão (achados adicionais)

- **P1 desconexão:** `connectionId` por conexão; sincronização confere a conexão por página e grava cursor/erros com `saveConnectionIf` (condicional; DynamoDB `ConditionExpression`); se mudou, apaga só os espelhos daquela conexão (`external.connectionId`) e responde `INTEGRATION_NOT_CONNECTED`.
- **P1 ETag (complemento):** `409` no insert com conteúdo remoto divergente agora é `GOOGLE_CONFLICT` explícito; antes atualizava o remoto com o ETag recém-lido.
- **P1 cache (repro 8):** a leitura de período compara um snapshot local (eventos ID@versão + envios ID#rev) antes e depois da busca; se algo mudou (ACK, edição), descarta a resposta e busca de novo (`reconcile.ts`, testado).
- **P2 tempo:** backend exige data real e deslocamento explícito (`parseInstant`); UI faz ida e volta no fuso e recusa horário inexistente no salto do horário de verão com mensagem (`draft.ts`).
- **P2 Retry-After:** piso `notBefore` separado do backoff; "Tentar agora" não o antecipa; teto de sanidade de 6 h (não 60 s); a tela informa até quando o servidor pediu para aguardar. Observação: a API ainda não devolve o cabeçalho `Retry-After` no `429 RATE_LIMITED` (o `AppError` não carrega cabeçalhos); o piso só vale quando o cabeçalho chega.
- Regressões: web (`outbox`, `reconcile`, `draft`, `time`) e API (`google-integration`, `event-time`, integração DynamoDB Local com `connectionId`, 5/5 em contêiner próprio removido ao fim).

### Incorporação de `develop` (`9ea0026`) e validação integrada

- Merge de `origin/develop` em `feat/calendar-planner` (sem rebase): **sem conflitos**. `npm ci`, `npm run build` e `npm run check:modules` aprovados; testes do módulo (web `src/calendar` 42/42; API `modules/calendar` + `app.test.ts` 76 ok/5 integrações ignoradas) após o merge. Suítes completas e finanças não repetidas.
- Fluxo Calendar com o **Modal compartilhado atualizado** (Playwright MCP, harness + app em `/#/events`): abrir, digitar, erro de DST inexistente com o formulário preservado, salvar horário válido (gravado como `2026-03-08T07:30:00.000Z`), Esc, foco devolvido ao botão, sem cópia fantasma de saída; `/#/events` redireciona para `/#/agendas` e o app carrega. Sidebar/Home ainda apontam para `/events` (item "Agenda" não fica ativo em `/agendas`).
- **Achado de integração:** o novo `Modal` (cópia inerte na desmontagem direta) deixou de devolver o foco ao botão quando o consumidor **desmonta** o Modal no mesmo render do fechamento (foco ia para `body`). A agenda passou a usar o Modal com `open` controlado (formulário montado, `formOpen` alterna), caminho documentado do próprio componente, e o foco volta. O Modal compartilhado não foi alterado; consumidores que desmontam diretamente (ex.: finanças) devem ser conferidos por quem é dono dele.
