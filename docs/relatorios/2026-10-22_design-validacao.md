# Validação de interface — 2026-10-22

Escopo: validação, sem edição de código. Skills `validar-design`, `graphify`, `codigo-enxuto` e `relatorio` lidas; fontes obrigatórias e tokens/referências consultados. Graphify local existente consultado com `explain calendar/CalendarPage.tsx::CalendarPage`, sem extração nova nem envio de código.

## Ambiente e comandos

Vite programático local em `127.0.0.1:1430`, `configFile:false`, plugins React/Tailwind explícitos e `envDir:/tmp/miupy-design-empty-env`, sem carregar configuração privada. Calendar usa exclusivamente `tests/calendar-harness.html?owner=design-mcp-synthetic`, API/Google falsos e dados sintéticos.

Ferramentas MCP não estavam expostas diretamente, mas o servidor Playwright MCP configurado pôde ser iniciado por stdio com `--isolated`, seguindo o runner existente. `timeout 90s python3 apps/web/tests/finance-balances.mcp.py http://127.0.0.1:1430` passou: formulário em duas etapas, parcelas preservadas, X acessível, saída GSAP com limpeza da cópia inerte, retorno de foco, Sidebar recolhida/expandida, referência negativa, saldo calculado e Home/404 em 1440/390 px; entrada/saída modal com movimento reduzido também passou.

Runner temporário `/tmp/miupy-design-check.py` e `.js`, derivado do mesmo cliente MCP, passou em 1440×900 e 390×900:

- `/#/`: título “Seu espaço.” e ausência de overflow horizontal global.
- `/#/design-404`: 404 com link de retorno, sem overflow horizontal global.
- `/tests/calendar-harness.html?owner=design-mcp-synthetic`: título “Agendas.”, eventos sintéticos e ausência de overflow horizontal global.
- Modal “Novo evento”: foco inicial em INPUT; Escape fecha e devolve foco ao botão, nas duas larguras; sem overflow global com modal aberto.
- Emulação `prefers-reduced-motion: reduce` confirmada e troca para Semana executada.

Capturas reais inspecionadas: `/tmp/design-1440-calendar.png`, `/tmp/design-390-calendar.png` e `/tmp/design-390-home.png`. Capturas adicionais Home/404 desktop/mobile permanecem em `/tmp/design-{1440,390}-{home,404}.png`. São artefatos temporários fora do Git.

## Resultado e pendências

Hierarquia serif nos títulos e sans no corpo observada nas capturas e no estilo computado: `Silvex Editorial, Instrument Serif, Georgia, serif` e `Inter, system-ui, sans-serif`. Isso confirma a pilha, não prova qual arquivo serif venceu o fallback. Cores computadas do shell/título correspondem a `#0B0B0C`/`#F5F5F2`; aparência monocromática e hierarquia compatíveis com referências locais. Contraste perceptível adequado nas capturas examinadas; não constitui auditoria WCAG completa.

P2: na agenda a 390 px, a lista de próximos eventos antecede a grade e ocupa quase toda a primeira tela (grade começa aproximadamente em y=812). Avaliar lista recolhível ou atalho à grade para consulta do dia. Não houve conteúdo cortado nem overflow global nesse cenário.

Leitura dirigida confirma GSAP com `matchMedia` e limpeza por `revert` em CalendarWorkspace/PageTransition; ButtonGroup usa duração zero com redução de movimento e encerra tweens; Modal verifica redução de movimento e limpa contexto. A fluidez subjetiva das animações não foi medida; as verificações executadas cobrem comportamento final, limpeza e foco. Não foi feita auditoria completa de sequência de tabulação, leitores de tela, todos os modos da grade, extremos de textos/eventos ou janela Tauri/WebKit.

Tentativa alternativa inicial com skill `orca-cli`: DOM/snapshot funcionaram, mas screenshots falharam com `CDP error (Page.captureScreenshot): Screenshot timed out — the browser page did not draw a frame.` A inspeção visual válida acima foi feita posteriormente pelo Playwright MCP, não inferida de CSS. Um dist anterior foi apenas sondado inicialmente e não fundamenta o aceite atual.

Sem chamadas a contas reais, AWS ou deploy. Sem alterações de arquitetura/contrato. Índice do relatório fica a cargo da coordenação. Servidores/aba criados para esta validação encerrados ao concluir.
