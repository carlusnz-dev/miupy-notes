# Design/UX — refresh da Agenda e controles próprios — 2026-10-22

Branch `feat/design-ux-refresh`. Escopo: validar e melhorar a apresentação de Agenda, Home, Notas, Finanças e navegação com dados fictícios; trocar controles nativos por componentes próprios; completar animações GSAP; otimizar renderização. OAuth, API e Rust não foram tocados; no `GooglePanel` mudou só a apresentação (JSX/CSS), com os mesmos handlers.

## Dados fictícios

`apps/web/tests/demo-harness.html` + `.tsx` (só dev, fora do `dist`: conferido após o build) renderiza o `App` real. Login simulado por `mockIPC` (token sintético), API em memória no adapter do Axios (nenhuma requisição sai do navegador). Dados: 4 pastas com hierarquia, 8 notas com Markdown (listas, tabela, citação, tarefas), 19 eventos (locais, Google somente leitura, dia inteiro, sobrepostos, fuso de Lisboa, passado e futuro), 2 instituições, 2 contas e 8 lançamentos (parcelado, sem conta, vínculos). `?google=not_connected` muda o estado do Google; `window.__profile` soma commits/tempo de render (React `Profiler`). Vite servido em `127.0.0.1:1430` com `configFile:false` e `envDir` vazio (sem `.env`).

## Achados (antes), por prioridade

P1 — Agenda
- `TimeGrid`: evento de 30 min mostrava só a hora (título cortado); na semana, títulos sobrepostos quebravam e sumiam ("P.. s..").
- Lista de próximos fixa em 300 px à esquerda em todos os modos: grade semanal com ~100 px por dia; a 390 px a lista ocupava a primeira tela inteira (a grade ficava abaixo de y=900).
- Controles do SO no formulário: `<select>`, `input type="time"`, checkbox; `DatePicker` dentro do formulário com borda dupla (regra `.calendar-form input` vazava para o input interno).
- Exclusão de evento com confirmação inline (botões trocando de lugar), sem diálogo.

P2
- Região rolável das horas não focável por teclado (accesslint `scrollable-region`).
- Cabeçalhos de dia dos próximos eventos `aria-hidden`: o leitor de tela ouvia só a hora, sem o dia.
- `YearView` com `role="grid"` sem linhas.
- Home: botões "30d" com `aria-label` "30 dias" (WCAG 2.5.3, `label-content-mismatch`).
- Finanças: recuo extra (padding próprio), título sem a escala/ponto final das outras páginas, eyebrow em outro estilo; botões quebravam em 2 linhas a 390 px.
- Título do modal em sans 20 px, fora da hierarquia serif.

P3 / React (vercel-react-best-practices)
- Vistas (`TimeGrid`, `MonthView`, `YearView`, `UpcomingList`) sem `memo`: abrir o modal ou digitar re-renderizava a grade.
- `YearView` chamava `occursOn` três vezes por dia do ano (total, destaque e rótulo).
- `TimeGrid` calculava `dayBlocks` duas vezes (efeito e JSX); `days` recriado a cada render invalidava qualquer memo.
- `EventForm` refazia as listas de notas/eventos a cada tecla; três `filter` sobre a fila de envio.

## Mudanças

Componentes (`apps/web/src/components/`)
- `popover.ts`: hooks `usePresence` (entrada/saída GSAP, movimento reduzido instantâneo, `gsap.context().revert()`), `useAnchoredPosition` (popover `fixed`, lado com mais espaço), `useDismiss`, `useListNavigation` (setas, Home/End, PageUp/Down, busca por digitação).
- `Select.tsx`: combobox só de seleção (padrão APG) com listbox em popover, `aria-activedescendant`, Esc fecha só a lista, Tab/Enter/Espaço escolhem, input oculto para `FormData`, `autoFocus`/`defaultOpen`/`onDismiss` para o "Mover" da árvore. API anterior mantida.
- `TimeField.tsx`: hh:mm com máscara + lista de 15 em 15 min. `DatePicker` passou a usar os hooks compartilhados.
- `controls.css`: checkbox e range sem aparência do SO (o input nativo continua no DOM).
- `ConfirmDialog.tsx` sobre o `Modal`; `Modal` ignora Esc/Tab vindos de diálogo aninhado; título do modal em serif.
- Usos: `EventForm` (horas, exclusão), `GooglePanel` (desconectar), `NoteEditorPage` (excluir nota), `NoteTree` (mover), `AccountsPanel` (data de referência via `DatePicker`).

Agenda
- Distribuição: modo Dia ≥1100 px = trilho (próximos + Google) à esquerda da linha do tempo; Semana/Mês/Ano e telas estreitas = faixa horizontal compacta de próximos acima de uma grade em largura total, Google ao fim. Toolbar em 3 linhas curtas no mobile; data e hora lado a lado no formulário a 390 px.
- Blocos curtos em linha única (título · hora), títulos com reticências e `title`; hoje destacado em pílula; status de sincronização como linha sob o título com indicador (cheio/vazado/claro).
- Troca de período: anterior/próximo desliza no sentido da navegação (`power2.inOut`), troca de modo só funde; o rótulo do período acompanha.
- `memo` nas quatro vistas, callbacks estáveis, cálculos memoizados; `YearView` faz uma passada por dia.

Outras telas: Finanças alinhada (eyebrow, título com escala comum, sem recuo extra); Home com "7/30/90 dias".

Referências (`styles/referencias/`): capturas próprias de APG select-only combobox, APG date picker dialog, página do Notion Calendar e espécime da Gloock (origem, data e uso em `styles/referencias.json` → `capturedReferences`); fonte Gloock (OFL 1.1, com `OFL-Gloock.txt` e sha256) em `fontes/` como candidata semelhante a Lenora/Vogue — não aplicada aos tokens, a identidade depende do proprietário.

## Verificação (comandos e resultados reais)

- `npm run build`: exit 0 (aviso já conhecido de chunks >500 kB). `dist/tests` inexistente.
- `npm --workspace @miupy-notes/web test`: 160/160. `npm run check:modules`: 4 módulos válidos.
- Playwright MCP (Chromium) no harness, 1440×900 e 390×900: sem overflow horizontal global em Home, Agenda, Notas, Finanças e com o modal aberto (painel do modal também sem overflow a 390).
- Teclado: foco inicial no título do modal; ArrowDown abre a lista de hora e Enter escolhe (20:30); Enter abre o fuso, Esc fecha só a lista com o diálogo aberto; busca "Lis" + Enter liga a nota "Lista de leitura 2026"; "Dia inteiro" remove os campos de hora; Esc fecha o modal e devolve o foco a "Novo evento". Confirmação aninhada: 2 diálogos abertos, foco em "Cancelar"; Esc fecha só a confirmação e devolve o foco a "Excluir"; confirmar exclui e fecha os dois. "Mover" das notas abre já focado com as pastas (indentação preservada) e Esc fecha.
- Movimento: com `reducedMotion: reduce` a vista não recebe `style` após trocar de período; sem redução, `translate3d(27px…)` no início e `style=""` ao fim (limpeza do GSAP).
- Grade do modo Dia a 390 px começa em y=608 (antes: abaixo da primeira tela na captura, y≈812 no relatório anterior).
- Renderização (`__profile`, dev build, mediana de 3, abrir "Novo evento" e digitar 23 caracteres): Ano 70,8 → 41,5 ms; Semana 64,1 → 41,1 ms; Mês 56,2 → 40,9 ms; 24 commits nos dois casos. O formulário também mudou (TimeField), então o número não isola só o `memo`.
- accesslint `audit_live` antes: Agenda 3, Home 4, Notas 1, Finanças 1 violações; depois: 1 em cada tela (Sidebar `aria-valuetext` em `role="separator"`, permitido em separador focável pela ARIA 1.2 — divergência do motor, não alterado) + contraste em Home/Notas que medimos como transitório (opacidade 0,35/0,91 da animação no instante da varredura; 1,0 após 1,5 s).

Capturas antes/depois em `docs/relatorios/imagens/2026-10-22_design-ux/` (`antes-*` e `depois-*`, 1440 e 390: home, agenda dia/semana/mês/modal, notas, finanças; `depois-agenda-select-1440`).

## Não verificado / pendências

- Janela Tauri/WebKitGTK não aberta: popovers `fixed` dentro do `<dialog>` e checkbox sem `appearance` só foram vistos no Chromium. Firefox não testado.
- Leitores de tela reais (NVDA/VoiceOver) não usados; APG registra que `aria-activedescendant` tem suporte irregular no VoiceOver.
- Após excluir um evento aberto pela lista, o foco vai ao `body` (o botão que abriu deixou de existir); comportamento já existente.
- Semana com 3+ eventos sobrepostos continua estreita (algoritmo de colunas em `layout.ts` não mudou).
- Mobile: navegação principal ocupa 3 linhas (~180 px), decisão anterior "quebrar em vez de rolar" mantida.
- `TransactionForm` mantém `input type="number"` (parcelas); Finanças ainda usa cores hex em vez de tokens.
- Gloock é só candidata; adotar exige decisão do proprietário e conferência de acentos no subconjunto latin.
