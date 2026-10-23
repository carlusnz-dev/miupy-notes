# Design — Agenda e tarefas — 2026-10-23

Worker Claude Sonnet (High) na branch `feat/design-ux-refresh`, sessão 18. Convertido do relatório em texto do worker (`.briefs/relatorio-design-sonnet.txt`, fora do Git) sem alterar o conteúdo factual. A integração com develop e a nova validação estão na seção final.

Commits: `bc4befa` (tarefas na API com porta Google Tasks desligada), `949bcf0` (carrossel, criação rápida, tarefas e arrastar blocos) e `3ea830b` (harness sintético com séries e tarefas, capturas).

## O que foi feito

### 1. Próximos eventos em carrossel

- `components/EventCarousel.tsx` e `event-carousel.css` (novos): 1 item abaixo de 520 px e 2, 3 ou 4 conforme a largura.
  - Setas, arrasto por pointer events com limiar de 6 px e encaixe no item mais próximo; setas, Home e End no teclado.
  - Transição GSAP, instantânea com movimento reduzido. Itens fora da janela ficam `inert`; Esc cancela o arrasto; o contexto GSAP é revertido ao desmontar.
- `UpcomingList.tsx` reescrito. Em `calendar.css`, o trilho lateral do modo Dia saiu: coluna única com próximos e tarefas, grade em largura total e Google ao fim.

### 2. Agrupar séries

- `calendar/groups.ts` (+ 6 testes). A API não tem `recurringEventId` (o espelho do Google vem expandido). O critério é origem + título + horário local + local, em dias diferentes; dois eventos no mesmo dia não formam série.
- O bloco mostra "N ocorrências" e as próximas datas. Clicar no grupo abre um Modal com a lista; cada ocorrência abre a edição. Evento único abre a edição direto.
- O limite de ocorrências consideradas subiu de 8 para 60 (`use-calendar.ts`).

### 3. Criação rápida

- `calendar/QuickCreate.tsx` (novo): popover ancorado no ponto clicado, com `usePresence`, `useAnchoredPosition` e `useDismiss` de `popover.ts`, `DatePicker` e `TimeField`.
  - Título, dia, início e fim preenchidos pelo slot (passo de 15 min, duração de 1 h), dia inteiro, local, Salvar e "Mais opções" (abre o formulário completo com o que foi digitado).
  - Esc e clique fora fecham; o foco volta a quem estava ativo.
- `TimeGrid.tsx` (clique no fundo da coluna) e `MonthView.tsx` (clique no fundo da célula; sem horário usa o padrão). Clique em evento continua abrindo a edição.

### 4. Tarefas

- **API** (`apps/api/src/modules/calendar`):
  - Domínio `calendar-task.ts`, `task-schedule.ts` (`isTaskOverdue`, função pura) e `task-time.ts`; DTOs `task-input`, `task-output` e `task-adapter`.
  - Repositórios em memória e DynamoDB (chave `TASK#id` na mesma tabela, `USER#owner`); serviço, `task-google-sync.ts` e controlador.
  - `createCalendarRouter` aceita o `TaskController` opcional; fiação em `module.ts` e `calendar.test-kit.ts`. Contrato público novo em `task-contract.ts`, sem tocar `contract.ts`.
  - Rotas `GET/POST /tasks` e `GET/PATCH/DELETE /tasks/:id`, versão otimista, POST idempotente por UUID. Prazo = `dueDate` (AAAA-MM-DD) + `dueTime` (HH:MM local); status `pending`/`completed` com `completedAt`.
- **Google Tasks:** pasta `google-tasks/` com a porta `GoogleTasksClient`, mapeamento `completed` ↔ `completed`/`needsAction`, cliente HTTP com `fetch` injetado e fake. `TaskGoogleSync` fica desligado: `module.ts` não o instancia. Nenhuma API habilitada, escopo pedido, `gcloud` ou chamada a conta real.
- **Web:** `lib/calendar-api.ts` (`listTasks`, `createTask`, `updateTask`, `deleteTask`); `calendar/tasks.ts` (`useTasks`, otimista com rollback e ações serializadas por tarefa); `TaskForm.tsx` (Modal de edição e aba "Tarefa" no Modal de criação); `TaskMarker.tsx` (marcador com caixa de conclusão na grade, faixa do dia e mês); `EventForm.tsx` (props `kind` e `seed`).
- **Documentação:** seção Tarefas em `api-calendar.md` (Google Tasks desligado e pendências) e parágrafo em `api.md`.

### 5. Avisos de atraso

- `components/OverdueBeacon.tsx` e `overdue-beacon.css` (novos): ponto vermelho que pulsa via `gsap.matchMedia` (só com `no-preference`). O botão "N atrasadas" abre popover com a lista (concluir e abrir edição); Esc e clique fora fecham.
- `calendar/TasksPanel.tsx`: "Tarefas pendentes: N" com lista expansível.
- A cor `--color-danger: #ff5c4d` ficou em `overdue-beacon.css` (escopo `.overdue-beacon`/`.calendar-page`), pendente de aprovação para ir aos tokens.

### 6. Mover e redimensionar (Dia e Semana)

- `calendar/drag.ts` (+ 5 testes) e `TimeGrid.tsx`: pointer capture desde o `pointerdown`, preview com rAF, encaixe de 15 min, mínimo de 15 min, sem sair do dia; na Semana troca de coluna.
- Uma única gravação no `pointerup`, pela mesma fila do formulário. Esc cancela e o fantasma volta com GSAP; se a gravação rejeitar, o bloco volta e aparece aviso.
- Eventos do Google, dia inteiro, multi-dia e em conflito/recusado não arrastam.
- Teclado: Alt+↑/↓ move, Alt+Shift+↑/↓ ajusta o fim, Alt+←/→ muda o dia na Semana; anúncio em região `status`.

## Verificação do worker

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` em `apps/api` e `apps/web` | Sem erros |
| `npm run test:api` sem `DYNAMODB_TEST_ENDPOINT`/`DYNAMODB_FINANCE_TEST_ENDPOINT` | 205 testes: 196 aprovados, 9 ignorados (já existentes), 0 falhas; 22 novos de tarefas |
| `npm run check:modules` | 4 módulos válidos |
| `npm run build` | Exit 0; aviso conhecido de chunks acima de 500 kB |
| `npm --workspace @miupy-notes/web test` | 174/174 (14 novos: groups, drag, tasks) |

Playwright (Chromium) em `apps/web/tests/calendar-harness.html`, Vite na porta 5181, dados sintéticos:

- **1440×900:**
  - Carrossel acima e grade abaixo; a série "Trabalho" vira um bloco com "5 ocorrências".
  - Setas (1–3 → 4–6 → volta), arrasto muda para 2–4 sem abrir modal, Home/→ no teclado; o Modal de ocorrências lista 5 itens.
  - Cartão rápido abre com 11:15–12:15 e salva (1 create); "Mais opções" abre o formulário preenchido; a aba Tarefa cria tarefa (POST).
  - O marcador na grade conclui tarefa (PATCH); com falha simulada a caixa volta e aparece mensagem.
  - Beacon: 2 atrasadas, popup lista, concluir uma reduz para "1 atrasada"; a opacidade oscila (0,29 → 0,83) e com movimento reduzido fica 1, sem transform.
  - Arrastar: mover 1 h (1 PATCH, sem abrir edição); redimensionar 09:00–10:30 → 09:00–11:00 (1 PATCH); Esc durante o arrasto não grava nem abre cartão; Alt+setas no teclado; mover na Semana; bloco do Google sem `data-draggable`.
- **390×844:** sem overflow horizontal em Dia, Semana, Mês e com o cartão rápido aberto (x = 54..382); 1 cartão por vez no carrossel.
- Capturas em [assets/2026-10-23_design-agenda](assets/2026-10-23_design-agenda/) (12 PNG).

## Não feito ou não verificado

- **Tarefas offline:** vão direto à API e exigem conexão (eventos continuam com outbox). Sem conexão, a criação falha com mensagem e o formulário permanece.
- **Google Tasks:** só com fakes. Tasks API, escopo `https://www.googleapis.com/auth/tasks`, fonte de token e ligação do `TaskGoogleSync` em `createCalendarModule` dependem de autorização do proprietário. Sem sincronização Google → app.
- **Toque:** só o redimensionar pela borda inferior; mover por toque não existe (o dedo rola a grade). Sem auto-rolagem durante o arrasto.
- Não testado em WebKitGTK/Tauri, Firefox, dispositivo de toque real nem leitor de tela. Rollback por falha do IndexedDB não foi provocado no navegador.
- Criação rápida só por clique/toque; pelo teclado usa-se "Novo evento" (colunas da grade não são focáveis).
- `YearView` não mostra tarefas; tarefas concluídas continuam riscadas na grade.
- DynamoDB real não testado (só cliente falso); accesslint não executado.
- `demo-harness.tsx` não foi alterado: lá a API de tarefas responde `DEMO_UNSUPPORTED` e o painel de tarefas não aparece.

## Dúvidas para o proprietário

- Aprovar o vermelho de atraso (`#ff5c4d`) e movê-lo para os tokens.
- Fila offline também para tarefas?
- Ligar a sincronização com Google Tasks (habilitar API e novo escopo)? Plano no relatório da sessão 19.
- Agrupar séries por título + horário + local, ou só eventos do Google?

## Integração com develop (sessão 19, coordenador)

Merge de develop (`376d64b`) em `2be3a68`. Conflitos resolvidos preservando login único, cache e `deleted_remote`:

- `CalendarPage`/`CalendarWorkspace`: tarefas e criação rápida desta branch com `grant`/`connect` sem OAuth separado e cache de notas/status (`fetch-cache.ts`).
- `GooglePanel`: layout novo com `ConfirmDialog` e o texto de develop (desconectar não revoga o login).
- `UpcomingList`: carrossel desta branch com a tag "Excluído no Google".
- `ConfirmDialog`: API desta branch (`open`, `onCancel`, `busyLabel`); `LibraryPage` adaptada.
- `calendar.test-kit.ts`, `api.md`, `arquitetura.json` e índice: os dois lados.

| Comando (após o merge) | Resultado |
|---|---|
| `npm run build` | Aprovado; aviso de chunk (NoteEditorPage 635 kB) |
| `npm run test:api` sem variáveis `DYNAMODB_*` | 225 testes: 215 aprovados, 10 ignorados, 0 falhas |
| `npm run test:web` | 176/176 |
| `npm run check:modules` | 5 módulos válidos |

Playwright MCP (Chromium), Vite sintético na porta 5190 sem `.env`:

- `calendar-harness.html`, 1440×900 e 390×844: carrossel (1440 → "4–6 de 8"), beacon abre a lista de 2 atrasadas e Esc devolve o foco ao botão; concluir tarefa leva de 5 a 4 pendentes; criação rápida às 07:30 salva "07:30–08:30"; arrastar 09:00 → 11:00 e redimensionar +30 min (1440); em 390 também cria, arrasta e redimensiona, sem overflow horizontal. Sem `pageerror`; só 404 de favicon.
- `demo-harness.html`, nas duas larguras: chip de tag dentro do input (sem overflow) e Backspace remove o último; Ctrl+E liga e desliga a leitura (`aria-pressed`); `/finance/banks` abre "Bancos e contas", sem overflow; um ripple por clique em "Novo banco", removido ao fim.
- Observações visuais menores, não corrigidas: em 390 o carrossel com um cartão deixa ~100 px vazios abaixo (altura do cartão mais alto oculto) e o contador mostra "1–1 de 8"; em Bancos a seção "Contas e saldos" encosta na lista sem espaçamento.
