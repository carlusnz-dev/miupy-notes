# Design — polimento visual (A-01 a A-28)

Data: 2026-10-24. Coordenador: Claude Opus 5.5 no checkout principal. Base: `develop` em `2399198`. Origem: os achados de [2026-10-24_design-revisao.md](2026-10-24_design-revisao.md), que entra em `develop` pelo PR #28. Entrega: branch `fix/ui-polimento`, com PR para `develop` e sem merge. Contrato de API e regras de domínio não mudaram; `apps/api/` não foi tocado.

## Decisões do proprietário (perguntadas no início)

| Pergunta | Resposta |
|---|---|
| (a) Mobile é prioridade? | Sim |
| (b) A-08 | Piso de 12 px e topbar sem eyebrow repetido; numerais 01–04 e caixa-alta mantidos |
| (c) A-11/A-14 | Próximos em linha de ~72 px; criação rápida com título + horário + "Mais opções" |
| (d) A-10 | **Incluído**: faixa "Hoje" no Início |

## Orquestração

As worktrees do Orca seguem a regra de [worktrees e workers](../decisoes/2026-10-24_worktrees-orca.md), escrita nesta sessão no PR #28. A pai é `ui-polimento` (`fix/ui-polimento`, top-level a partir de `develop`). As cinco filhas foram criadas pelo coordenador com `--base-branch fix/ui-polimento` e tiveram a branch renomeada antes do primeiro commit. Todos os workers foram Claude Sonnet 5.5 com esforço high, com arquivos exclusivos por frente e briefs fora do Git.

| Fase | Frente | Branch | Commits |
|---|---|---|---|
| 1 | Sistema de design | `fix/ui-polimento-design-system` | `7f21565` |
| 1 | Shell e toque | `fix/ui-polimento-mobile` | `64eaebc` |
| 2 | Agenda | `fix/ui-polimento-agenda` | `74c31c1` |
| 2 | Biblioteca | `fix/ui-polimento-biblioteca` | `037a8fc` |
| 2 | Notas, Perfil, Início, modais | `fix/ui-polimento-notas-inicio` | `d764051`, `1514fde`, `5f7fd49`, `e3b75f6` |

Os cinco merges locais na pai não tiveram conflito. O coordenador acrescentou três commits:
- `e76ce7d`: o worker da Biblioteca tinha trocado as portas padrão do harness (5183/3183) pelas portas da sessão; voltaram ao padrão.
- `d9bf716`: `viewport-fit=cover`, para `env(safe-area-inset-*)` valer, e alvo do aviso de atrasadas com `--hit-min`.
- `fa501b4`: piso de 12 px no `<small>` (o padrão do navegador dava 11,2 px em Finanças, Bancos e Perfil) e alvos de toque de `.ui-button-sm`, `.tree-main`, `.date-toggle` e `.calendar-link-button`.

Incidentes:
- O primeiro `worker-start` foi recusado com `consumer_fenced`. O orquestrador de infra tinha feito `run-use`, com autorização minha, e assumido o Run de infra. O polimento passou para um Run próprio (`run_d90b5f00716e`).
- `git fetch` por SSH falha nesta máquina; o fetch foi feito por HTTPS com o helper do `gh`.

## O que mudou, por achado

As medidas abaixo são dos workers (Chromium headless, harness sintético), salvo quando o texto diz "coordenador".

| Achado | Mudança | Antes → depois |
|---|---|---|
| A-01 | `BottomNav` com Início, Notas, Agenda, Biblioteca e "Mais" (abre o `Modal` com Finanças, Perfil e Configurações). Indicador em GSAP. A barra some com o teclado aberto (`keyboard-open.ts`, 5 testes) e respeita a safe area | Navegação de 180 px no topo → barra de 57 px; área útil 664 → 787 px; editor 400 → 480 px |
| A-02 | Semana e Mês centralizam o dia de hoje; Mês compacto com pontos em ≤ 520 px | Semana `scrollLeft` 0 → 342; Mês sem rolagem lateral (358 = 358) |
| A-03 | Long-press de 350 ms arma o modo mover (tolerância de 8 px; Esc cancela) e usa o mesmo PATCH do mouse; alça de 28×4 px com zona de 44 px | Arrastar por toque: sem suporte → 12:30 → 14:30 com 1 gravação; swipe antes do limiar rola a página sem gravar |
| A-04 | `components/touch.css` com `--hit-min` (32 px; 44 px em `pointer: coarse`), `touch-action: manipulation` e zonas invisíveis em checkbox, remover tag e links | Abas 28 → 44, setas 28 → 44, toolbar 32 → 44, árvore 30 → 44, checkbox: zona de 44 px |
| A-05 | 45 usos de `.button` migrados para `Button` (`sm` 32, `md` 40/44 no toque, `lg` 48, 14 px) | Regras `.button*` removidas |
| A-06 | Finanças: "Novo lançamento" primário; "Bancos" e "Exportar CSV" como `ghost`, só ícone no mobile | 390: 111×63 com rótulo em duas linhas → 44×44 / 254×44 |
| A-07 | `PageHeader` (`hub` 60 px, `utility` 40 px) em todas as páginas; título com ponto final | Configurações e Bancos 60 → 40 px; x do título 297 em todas |
| A-08 | Piso de 12 px em `App.css`, `calendar.css`, `editor.css`, date-picker, árvore e `<small>`; topbar só com breadcrumb | Coordenador: 0 textos < 12 px nas 8 telas × 3 viewports |
| A-09 | `.dashboard-link` em `inline-flex` | 53×36 com quebra → 75×20 |
| A-10 | `HomeToday`: próximos 3 eventos, tarefas atrasadas (`isTaskOverdue`) e nota recente, com estados de carregando, vazio e erro; `home-today.test.ts` | Sem endpoint novo |
| A-11 | Próximos em linha de 72 px; toolbar sticky; grade `clamp(360px, 100dvh − 240px, 900px)` | 1440: bloco 261 → 110 px; grade começa em y 541 → 411 |
| A-12 | Grade com altura natural no mobile, abrindo na hora atual | Swipe na grade rola a página (400 → 625) |
| A-13 | Tarefas com hora vão para o cabeçalho do dia; na coluna fica um traço de 10 px | Nenhum marcador cobre o evento |
| A-14 | Criação rápida com título, resumo, chips (30 min / 1 h / 2 h / dia inteiro) e "Mais opções"; folha de ≤ 50 dvh no mobile; não cobre o horário clicado | ~9 campos → 2 controles; folha de 293 px |
| A-15 | Sem o "Sem conexão." repetido; o vazio ganha "Criar evento" | — |
| A-16 | Estados vazios separados ("Limpar filtros" e "Adicionar obra"); plural correto ("0 obras") | — |
| A-17 | `noValidate` e validação própria por campo, que espelha o DTO; foco no primeiro inválido | Sem a bolha nativa |
| A-18 | Filtros em folha inferior, busca de 48 px, botão flutuante de 56 px | Primeira capa y 608 → 314 (harness sem barra) |
| A-19 | Altura única de 44 px na barra; legenda sem repetir título e autor na capa tipográfica | Input 49 / botão 40 / select 40 → 44 |
| A-20 | `danger` em `styles/tokens.json`; `--color-danger` e `--color-danger-soft` globais; escopo duplicado do beacon removido; `danger` em todas as exclusões | Texto `#ff5c4d` 6,45:1 (fundo), 5,34:1 (raised); hover de 10% para manter 4,71:1 |
| A-21 | Prévia de Configurações escopada, h1 em `clamp(24px, 3vw, 32px)` com serifa, listas com marcador | — |
| A-22 | `h2` em serifa de 20 px, cartões, datas `dd/mm/aaaa` (`finance/dates.ts` + teste), "Saldo calculado" | Sem data em ISO cru |
| A-23 | Perfil: todas as tags no gráfico, rótulos de uma linha, datas sem quebra | 8 → 9 rótulos |
| A-24 | "Sair" removido da lista de notas | 1 → 0 |
| A-25 | Tags visíveis na leitura, sublinhado em largura total, checkbox igual nos dois modos, foco volta ao botão após Ctrl+E, atalhos ocultos em `(hover: none)`, toolbar mobile rolável com fade, `aria-pressed` | Sublinhado 760 → 1075 px |
| A-26 | Skip link "Pular para o conteúdo" como primeira parada de Tab | O handle de resize já era `separator` operável por teclado e foi mantido (padrão WAI-ARIA) |
| A-27 | `Modal` como bottom sheet em ≤ 700 px, com cabeçalho fixo, rodapé sticky, X dentro do painel e animação GSAP (instantânea com movimento reduzido) | Desktop sem mudança |
| A-28 | Vista Ano alinhada; "sem eventos" por container query; cadeado com texto acessível nos blocos do Google | — |

As capturas antes e depois estão em [`assets/ui-polimento/`](assets/ui-polimento/): 94 PNGs, 7,3 MB, só dados sintéticos. Os resultados detalhados de cada frente ficaram fora do Git.

## Verificação (executada pelo coordenador na pai integrada)

| Comando | Resultado |
|---|---|
| `npm ci` | ok |
| `npm run build` | ok (web + api), repetido depois de cada commit do coordenador |
| `npm run test:web` | 206/206 na integração (24 testes novos nas frentes); 207/207 depois das correções da revisão |
| `env -u DYNAMODB_TEST_ENDPOINT -u DYNAMODB_FINANCE_TEST_ENDPOINT -u DYNAMODB_CALENDAR_TEST_ENDPOINT npm run test:api` | 225 testes: 215 passaram, 10 pulados (DynamoDB Local ausente), 0 falhas |
| `npm run check:modules` | 5 módulos válidos |
| Varredura headless do coordenador (Vite sintético na 5210, `envDir` vazio; Chromium headless; 7 rotas do `demo-harness` + `calendar-harness` em 1440, 1024 e 390 com toque) | Overflow horizontal: nenhum. Texto < 12 px: 0 (antes do `fa501b4`: 5 nós `<small>`). Alvos restantes: ver Pendências |

Os gestos (swipe, long-press + arrastar, redimensionar, swipe no carrossel, modais, Esc) foram repetidos pelos workers com `Input.dispatchTouchEvent`. Os resultados estão na tabela acima e não foram reproduzidos pelo coordenador.

Os workers usaram `node:test` + `tsx`, o padrão do repositório; o projeto não tem Vitest nem jsdom. Foco e bottom sheet foram verificados só no Playwright.

## Revisão independente

Feita pelo subagente `pr-reviewer`, só leitura, sobre `develop..fix/ui-polimento` em `d9bf716` + `fa501b4`. Ele rodou `build` e `test:web` (206/206) e comparou `validateLibraryForm` com o schema da API em 29 casos. Resultado: nenhum item bloqueante, 5 importantes e 6 menores. O coordenador corrigiu em `fbf2a7c`:

| Item | Correção | Verificação |
|---|---|---|
| Zona de redimensionar por toque cobria a metade inferior do bloco e o vizinho, e engolia o toque de abrir | Zona com 44 px centrados no traço; toque sem arrasto abre o evento | Headless 390 com toque: toque no centro inferior abre "Editar evento"; arrasto na alça 09:00–10:30 → 09:00–12:30, sem diálogo |
| Biblioteca aceitava `https:foo` e `https:/x.com`, que a API recusa; contava emoji como 2 caracteres | Exige o prefixo `http(s)://` literal e conta pontos de código | Teste novo em `library.test.ts` |
| `Modal` virava folha em 700 px; barra, criação rápida e filtros usam 760 px | Corte único de 760 px | build |
| "Mais opções" mandava a tarefa vazia | Semeia título, dia e hora | build |
| Rótulo "Tag" da folha de filtros sem estilo | Seletor incluído | — |
| Gráfico de tags do Perfil sem teto | As 12 mais usadas, com o total no resumo | — |
| `modal-harness` com a classe `.button` removida | `ui-button` | — |
| `ui-button-sm` com 32 px no toque | Já corrigido em `fa501b4` | Varredura do coordenador |

Depois disso: `npm run build` ok e `npm run test:web` 207/207.

Não corrigidos (ficam como pendência):
- A faixa "Hoje" espera todas as notas carregarem e ignora `truncated`.
- O alvo invisível do checkbox pode cobrir a borda do título vizinho (hipótese do revisor, não medida).
- Sair da leitura com o atalho devolve o foco ao botão, não ao editor. Antes ia para o `body`, então não é regressão.
- `--calendar-chrome` é uma constante.

O revisor não verificou toque real, Safari/Firefox, contraste renderizado nem o tamanho do bundle do Início, que agora importa a Agenda.

## Pendências e fora de escopo

- **Alvos ainda abaixo de 44 px no toque** (varredura do coordenador):
  - títulos de lançamento em Finanças (links de 17 px na linha);
  - links "Ver notas" e "Ver acervo" (20–24 px);
  - blocos curtos da grade da Agenda (22 px, a altura é proporcional à duração);
  - checkbox de tarefa no cabeçalho do dia (zona cortada pela rolagem).

  O checkbox e o "Voltar às notas" de Configurações têm zona ampliada por `::after`, e a medição por caixa não a enxerga. O skip link aparece na lista só porque fica fora da tela até receber foco.
- A-02: Semana de 3 dias no mobile não foi feita, para não mudar a navegação. Na Semana mobile, o cabeçalho dos dias não fica fixo.
- A faixa "Hoje" carrega todas as notas para achar a mais recente, porque a API lista por ID. Em contas grandes, a primeira visita faz até 50 requisições. O estado "Nada para hoje" espera essa carga, e `truncated` é ignorado. Um endpoint "recentes" seria mudança de contrato e ficou fora.
- O tamanho do bundle do Início, que passou a importar a Agenda, não foi comparado com `develop`.
- `--calendar-chrome: 240px` é uma constante; se a topbar ou o cabeçalho mudarem de altura, precisa de ajuste.
- `DatePicker` não aceita `aria-invalid`/`aria-describedby`; o erro de datas da Biblioteca é um `role="alert"` abaixo do par de campos.
- O botão de ícone "Excluir nota" do editor continua neutro; `NoteEditorPage` ainda usa eyebrow nos estados de erro e carregamento; CSS morto (`.period-control`, `.home-intro h1`, `.notes-page h1`).
- Continuam fora: Google Tasks, fila offline de tarefas, aceite em WebKitGTK/Tauri, dispositivo real com teclado virtual, leitor de tela, Firefox/Safari, dados e login reais.
- Não executados: `npm run tauri dev`, `terraform`, deploy.
