# Design — revisão visual de develop (2026-10-24)

Revisão feita por um agente Claude Sonnet High, só leitura, sobre `develop` em `2399198`, com as skills `validar-design`, `web-design-guidelines`, `frontend-design` e `bencium-controlled-ux-designer`. O coordenador conferiu no código o que dava para conferir; o restante vem das medições do agente e não foi reproduzido.

## Método e limites

- **Navegador:** o Playwright MCP do projeto é headless (`HeadlessChrome/155`). As primeiras rodadas do agente usaram Chromium com janela visível, antes de o proprietário pedir headless (as janelas roubavam o foco). As rodadas finais foram headless. A janela visível rodou com escala do sistema fracionária (~1,2), o que explica bordas de 0,83 px e `scrollWidth` 1441 no desktop; no mobile o fator era 2.
- **Servidores:** Vite sintético (`configFile:false`, `envDir` vazio, porta 5191) com proxy para o harness da API da Biblioteca (3183). Ambos foram encerrados. Nenhum arquivo rastreado foi alterado.
- **Harnesses:** `calendar-harness`, `demo-harness` (todas as rotas), `library-harness`. Não abertos: `modal-harness`, `profile-finance-harness`, `finance-*-harness`.
- **Viewports:** 1440×900, 1024×768 e 390×844 (DPR 2, toque emulado, gestos por `Input.dispatchTouchEvent`).
- **Capturas:** `/tmp/claude-1000/-home-cabeto-Documentos-Projetos-miupy-notes/c77fb955-80af-4083-9b9c-bbf18ede5196/scratchpad/design-review/shots/` (`-d` desktop, `-m` mobile, `-1024`). São arquivos temporários, fora do Git.

## Conferido no código pelo coordenador

| Achado | O que o código mostra |
|---|---|
| A-20 | `components/primitives.css:1` define `--color-danger: #ef9696`; `components/overdue-beacon.css:2` redefine `#ff5c4d` em `.overdue-beacon, .calendar-page` |
| A-04 | só `library/library.css:51` tem `touch-action: manipulation`; nenhuma regra `pointer: coarse` em `apps/web/src` |
| A-24 | `NotesPage.tsx:77` renderiza `SignOutButton` na lista de notas (e `ProfilePage.tsx:55`) |
| A-17 | `noValidate` só em `calendar/TaskForm.tsx`, `EventForm.tsx` e `QuickCreate.tsx`; a Biblioteca não o usa (conclusão do `rg`, formulário não aberto) |
| A-26 | nenhum link "Pular para o conteúdo" |
| A-08 | 10–11 px em `calendar.css` (10 ocorrências), `App.css` (8), `editor.css` (2), `date-picker.css` e `note-tree.css` (1 cada) |
| A-05 | `.ui-button` definido em `primitives.css`; a classe `.button` ainda é usada em `CalendarPage`, `TaskForm`, `NotesPage`, `EventForm`, `ProfilePage`, `GooglePanel`, `UpcomingList` e `QuickCreate` |

## Achados

Severidade do agente; o veredicto do coordenador está na última coluna. Prioridade 1 = corrigir primeiro.

### Prioridade 1

| ID | Sev. | Tela | Evidência | Recomendação | Veredicto |
|---|---|---|---|---|---|
| A-01 | alta | Mobile 390 | Navegação fixa de 178 px, 7 links em 3 linhas, alvos de 32–36 px; sobram ~385 px no editor sem teclado (`demo-m-home-scrolled.png`, `note-m-editor.png`) | Barra inferior com 4 destinos + "Mais", itens de 48 px, `safe-area-inset-bottom`, esconder com teclado aberto | Concorda; vale se mobile/janela estreita for alvo. Estimativa com teclado não testada |
| A-02 | alta | Agenda mobile | Semana (`scrollWidth` 698) e Mês (638) em 357 px abrem em `scrollLeft` 0; hoje (sábado) fora da tela (`cal-m-view2-Mês.png`) | `scrollIntoView({inline:'center'})` no dia atual; Semana de 3 dias; Mês compacto com pontos | Concorda; correção barata |
| A-04 | média | Todas | Alvos: abas Dia/Semana/Mês/Ano 28 px; setas do carrossel 28×28; checkbox de tarefa 14×14; células do mês 26×22; ações da árvore 30; toolbar do editor 32; remover tag 24; segmentos 7/30/90 28; "Voltar às finanças" 28 | `--hit-min: 44px` em `@media (pointer: coarse)`; checkbox com `::after{inset:-15px}`; `touch-action: manipulation` no `body` | Confirmado no código; 14×14 e 22 px falham até a WCAG 2.5.8 |
| A-16 | média | Biblioteca | Busca "zzzzz": "Nenhuma obra por aqui — Continue para a próxima página…" e CTA "Adicionar obra"; "0 obra(s) nesta página" (`lib-d-empty.png`) | Separar sem resultados (CTA "Limpar filtros") de acervo vazio; `Intl.PluralRules` | Concorda; mensagem errada |
| A-17 | média | Biblioteca | Bolha nativa "Preencha este campo." laranja/clara, fora do tema (`lib-d-add-invalid.png`) | `noValidate` + `Field error` + `aria-describedby` + foco no primeiro inválido | Confirmado pelo `rg` |
| A-20 | média | Tokens | `#ff5c4d` 6,45:1 sobre `#0B0B0C` (5,99 em `#151516`, 5,34 em `#202022`); `#ef9696` 8,87:1; todos passam AA. Modal "Excluir esta nota?" usa botão neutro (`note-d-delete-modal.png`) | Promover `#ff5c4d` a `tokens.json` (`danger`), fundo suave por `color-mix(…14%)`, `ui-button-danger` nas exclusões | O problema real é o botão destrutivo neutro, não o contraste; resolve também a pendência do `#ff5c4d` da sessão 19 |

### Prioridade 2

| ID | Sev. | Tela | Evidência | Recomendação | Veredicto |
|---|---|---|---|---|---|
| A-03 | média | Agenda mobile | Swipe no bloco rola a grade (`scrollTop` 380→299), sem PATCH; segurar 600/800 ms só abre a edição; alça de redimensionar de 10 px funciona com mira precisa (`cal-m-resize-after.png`) | Long-press de 350 ms para modo mover (ou botão "Mover" no modal); alça ≥24 px com zona de toque de 44 px | Pendência conhecida, reconfirmada |
| A-05 | média | Todas | `.button` 40 px (44 na Biblioteca), raio 6, 13 px, sem ripple; `.ui-button` 41 px (`sm` 32), 14 px, ripple GSAP; `.calendar-new` 0 ripples a 60 ms | Migrar `.button` para `.ui-button`; três tamanhos (`sm` 32, `md` 40/44 coarse, `lg` 48), fonte 14 px | Concorda |
| A-06 | média | Finanças | "Bancos / Exportar CSV / Novo lançamento" com o mesmo estilo; no mobile rótulos em 2 linhas (40 e 62 px) | "Novo lançamento" primário; os demais `ghost`; no mobile só o primário visível | Concorda |
| A-07 | média | Todas | h1 de 60 px em todas; eyebrow ausente em Biblioteca e Bancos; x do título 297/292; y de 84 a 154; "Notas." com ponto, "Biblioteca" sem | `PageHeader` único; 60 px em hubs e ~40 px em utilitárias (Configurações, Bancos) | Concorda |
| A-08 | média | Todas | 21 nós de 10 px no Início; 59 de 11 px na Agenda; eyebrow repetido na topbar; rodapé "SEU ACERVO, SEU TEMPO."; "01 — 04" em conteúdo sem sequência | Piso de 12 px; tirar a numeração e o rodapé; topbar só com breadcrumb | Dividido: piso de 12 px e topbar sem repetição são razoáveis; numerais e caixa-alta são estilo editorial do proprietário — decisão dele |
| A-10 | média | Início | Subtítulo "Um panorama das suas notas"; só 3 estatísticas de notas; ~210 px vazios | Faixa "Hoje" (próximos 3 eventos, atrasadas, nota recente) | Decisão de produto; referências citadas são páginas de marketing |
| A-11 | média | Agenda | Grade começa em y≈545 (1440×900) e y=507 (1024×768); mobile com carrossel de ~400 px e vazio de ~45 px; "1–1 de 6" | Carrossel em linha de 72 px ou só na vista Dia; grade `calc(100dvh - topo)`; toolbar sticky; pontos no mobile | Problema real; a solução é decisão do proprietário |
| A-12 | média | Agenda mobile | Grade com 523 px de altura e `overflow-y:auto`: o dedo rola a grade, não a página | Altura natural no mobile + `scrollTo` para a hora atual, ou `overscroll-behavior: contain` | Concorda |
| A-13 | média | Agenda | Marcador da tarefa das 16:30 cobre o horário do evento 16:00–17:00 (`cal-d-google-panel.png`, `cal-m-grid.png`) | Faixa própria de tarefas ou encolher o evento 28 px | Concorda |
| A-14 | média | Agenda | Criação rápida de ~330×460 (desktop) e 328×461 (mobile) com abas, título, dia inteiro, data, início, fim, local e botões; cobre o slot clicado | Título + horário em chips + "Mais opções"; bottom sheet de ≤50 dvh no mobile | Concorda |
| A-18 | média | Biblioteca mobile | Navegação (178) + título + CTA + abas + status + busca + tag empurram a primeira capa para y≈770 de 844 (`lib-shell-m.png`) | Filtros em popover/bottom sheet; busca numa linha de 48 px; CTA flutuante de 56 px | Concorda |
| A-21 | média | Configurações | Prévia "Uma nota" em sans de ~98 px com "Serif" selecionado; listas sem marcadores | Escopar a prévia (`all: revert-layer`), h1 de `clamp(24px,3vw,32px)` herdando `--font-serif` | Concorda; a sessão 18 já admitia |
| A-22 | média | Finanças/Bancos | Títulos de seção de 14–16 px iguais à descrição; "BRL" como título; "Contas e saldos" colada à lista; ~100 px em branco; linhas de banco sem cartão; "2026-08-25" ISO junto de "25/08/2026, 18:06:26"; "Calculado:" | `h2` de 20 px serif, descrição 13 px muted, `margin-top: 32px`, `Intl.DateTimeFormat('pt-BR')`, "Saldo calculado", cartões | Concorda; espaçamento já notado na sessão 19 |

### Prioridade 3

| ID | Tela | Evidência | Recomendação |
|---|---|---|---|
| A-09 | Início | `.dashboard-link` é `display:block` (53×36): a seta cai na segunda linha | `inline-flex; gap:6px; white-space:nowrap` |
| A-15 | Agenda | Offline: "Sem conexão. Sem conexão: mostrando…"; vazio "Nada marcado nos próximos 30 dias." sem ação | Remover a repetição; botão "Criar evento" |
| A-19 | Biblioteca | Input 48, botão 44, select 40; capa tipográfica e legenda repetem título e autor | Altura única de 44; legenda sem título quando a capa é tipográfica |
| A-23 | Perfil | "Tags mais usadas": só 4 de 8 rótulos; "Palavras por nota" com rótulos em 3 linhas; "Última nota" órfã no mobile. "Pessoa Fict�cia" é artefato do harness (`btoa` com acento) | `interval=0`, 12 px, datas com `nowrap` |
| A-24 | Notas | "Sair" na lista de notas, fora de contexto | Manter só no Perfil |
| A-25 | Editor | Linha de tags some na leitura (+~40 px); sublinhado do título para em x≈1056; checkbox cinza na leitura e branco na edição; foco vai ao `body` após Ctrl+E; hint de atalhos no mobile; toolbar mobile com `scrollWidth` 429/337 corta o último ícone; "T" sem estado | Manter tags na leitura; título com linha completa; devolver o foco ao botão; esconder atalhos em `(hover: none)`; `aria-pressed` |
| A-26 | Teclado | Primeira parada do Tab é a marca, sem "Pular para o conteúdo"; o handle de resize da sidebar (8×900) é parada de Tab | Skip link; tirar o handle do Tab ou rotulá-lo |
| A-27 | Modais | X de 44 px flutuando fora do painel; modal de evento com ~790 px de 900 e rolagem interna; só a Biblioteca tem `overscroll-behavior: contain` | Bottom sheet no mobile com cabeçalho fixo e rodapé sticky |
| A-28 | Agenda | Vista Ano desalinhada (cabeçalho y=333 vs 347); "sem eventos" 11 vezes; eventos do Google distinguidos só por borda pontilhada | `align-content:start`; mostrar "sem eventos" só quando couber; ícone nos blocos somente leitura |

## Gestos no mobile (390×844)

| Gesto | Resultado |
|---|---|
| Swipe vertical na página | Passou (0 → 497 px) |
| Swipe horizontal no carrossel | Passou ("1–1" → "2–2 de 6", sem abrir modal) |
| Tocar navegação, Semana/Mês/Ano, bloco de evento, slot vazio | Passou (editar / criação rápida 328×461) |
| Tocar X do modal (44×44) e select de Configurações | Passou |
| Swipe vertical dentro de modal (Agenda e Biblioteca) | Passou (260/261 e 660/661; a página não rolou) |
| Redimensionar pela alça de 10 px | Passou, com mira precisa |
| Segurar 800 ms no bloco | Abre edição, sem modo mover |
| Arrastar bloco por toque / segurar 600 ms e arrastar | Não suportado (sem PATCH) |
| Pinch/zoom | Inconclusivo (`visualViewport.scale` 1 → 1; o meta viewport permite zoom) |

## Preservar

- Biblioteca como tela mais madura: capas tipográficas, vazio com CTA, esqueleto de carregamento, alvos de 44 px.
- Tokens cinza, flat, sem sombras; serifa nos títulos, sans no corpo.
- Select combobox e modal `<dialog>` reutilizáveis, com foco preso.
- Movimento reduzido: ponto do beacon estático (`opacity` 1, `transform:none`), transição do botão 1e-5 s, modal fecha em 0 ms.
- Foco por teclado visível nos 16 itens testados (anel de 1,67 px `#D7D7D2`, 13,6:1).
- Contraste de texto AA nas telas medidas (mínimo 4,74:1, item desabilitado); sem overflow horizontal em 1440, 1024 e 390 px.
- Arrastar com pré-visualização e Esc cancelando; modo leitura mobile legível.

## Referências

- **Verificadas:** WCAG 2.5.5 e 2.5.8, 1.4.11; Linear (refresh de design); Geist (tipografia); NN/g (navegação mobile, modais, estados vazios); Refactoring UI; Laws of UX (Fitts); Web Interface Guidelines da Vercel.
- **Fracas:** Things e Notion Calendar (só páginas de marketing).
- **Não verificadas:** Apple HIG e Material 3 (páginas oficiais não abriram; só fontes secundárias); Stripe, Raycast, Arc, Mobbin, Dribbble e Behance não foram abertos.

## Não verificado

WebKitGTK/Tauri e Firefox; toque em dispositivo real, teclado virtual e `safe-area-inset`; leitor de tela; estado "Excluído no Google" (nenhum harness o expõe); conflito 409 e erro de rede real; `accessibility-inspect`/axe; contraste de texto em Perfil, Configurações e Biblioteca; tema claro (não existe).

## Decisões do proprietário em aberto

1. Mobile é prioridade agora (A-01, A-02, A-03, A-04, A-18)?
2. Estilo editorial (caixa-alta pequena, numeração 01–04, rodapé de slogan): manter ou aplicar piso de 12 px? (A-08)
3. Grade da Agenda mais alta e criação rápida menor? (A-11, A-14)
4. Início passa a mostrar o dia ou continua painel de notas? (A-10)
