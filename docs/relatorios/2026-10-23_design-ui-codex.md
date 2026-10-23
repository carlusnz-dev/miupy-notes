# Design — UI, notas e finanças — 2026-10-23

Worker Codex (gpt-6.1-sol, Low) na branch `feat/design-ux-refresh`, sessão 18. Convertido do relatório em texto do worker (antes `2026-10-23_design-ui-codex.txt`) sem alterar o conteúdo factual.

Commits: `d73bdc1` (controles animados e navegação sem fade), `d71e244` (leitura das notas e bancos em página própria) e `ca29eda` (validação sintética desktop e mobile, 16 capturas).

## Implementação

- **Controles:**
  - `Button.tsx` e `primitives.css`: variantes, tamanhos, loading/disabled e ripple GSAP a partir do clique; pelo teclado o ripple parte do centro.
  - `Input.tsx`: `Input` e `Field` com label, dica e erro, `aria-invalid`/`aria-describedby` e anel/tremor GSAP.
  - `Popover.tsx` reutiliza presença, posição e dismiss de `popover.ts`; Esc e clique fora fecham e o foco volta ao acionador.
  - Configurações demonstra Button/Popover; bancos e contas usam Input/Button.
- **Rolagem e navegação:** `ScrollActivity.tsx` e `scrollbar.css` usam um listener único de scroll (captura, passive), classe por área, timeout de 800 ms e thumb transparente em repouso, com limpeza ao desmontar. `Sidebar.tsx` troca fades por translação horizontal GSAP.
- **Tags:** `TagInput.tsx`/`badge.css` põem os chips dentro de um controle de 36 px com rolagem horizontal. Remove por × ou Backspace e confirma por separador ou Enter; preserva composição IME, e Backspace funciona mesmo no limite de tags.
- **Modo leitura:** `NoteEditorPage.tsx`/`editor.css` têm botão de leitura com Markdown GFM formatado, sem edição, título fixo e rodapé conforme o modo.
  - O editor fica oculto e `inert`, preservando seleção e histórico de desfazer.
  - Atalho padrão Ctrl+E; Ctrl+Shift+E ou Alt+R configuráveis em `SettingsPage.tsx`/`editor-preferences.ts`, no esquema existente com fallback para preferências antigas. Ctrl+S funciona também na leitura.
- **Bancos:** em `FinancePage.tsx`/`App.tsx`, "Bancos" navega para `/finance/banks`.
  - `BanksPage.tsx` lista instituições e contas, com criação, edição modal e confirmação de exclusão.
  - `BanksModal.tsx` mantém upload/URL de logo e o `saveBank`/PATCH versionado existente; `AccountsPanel.tsx` usa os novos controles.
  - Nenhuma mudança de endpoint, payload, API, dependência npm, Calendar ou dados reais.

## Verificação do worker

| Comando | Resultado |
|---|---|
| `npm run build` | Exit 0, web e API; aviso conhecido de chunks acima de 500 kB |
| `npm --workspace @miupy-notes/web run build` | Exit 0, repetido após a alteração final do editor/rodapé |
| `npm --workspace @miupy-notes/web test` | 160/160 e depois 174/174 (inclui testes do outro worker) |
| `npm run check:modules` | Exit 0, 4 módulos |
| `git diff --check` e `git diff --cached --check` | Exit 0 |

Validação com Playwright/Chromium local (o MCP de navegador não estava disponível), harness sintético em 127.0.0.1:5182 com `configFile:false` e `envDir` vazio, 1440×900 e 390×844:

- Bancos e modal, com PATCH sintético de erro e de sucesso.
- Popover por teclado e retorno de foco; clique fora.
- Ripple; preferência persistida após reload.
- Chips, Backspace e altura fixa das tags.
- Leitura por botão e atalho, sem edição visível; desfazer preservado ao alternar.
- Scrollbar transparente em repouso; sidebar com transform e opacidade 1; movimento reduzido; navegação Home/404.
- Anel de foco medido em 0,478 durante o GSAP e 1 ao terminar. Sem `pageerror` na execução aprovada.

O adapter financeiro foi estendido só no JavaScript interceptado pelo Playwright para simular PATCH; o harness versionado não mudou. Os primeiros roteiros falharam por glob sem querystring e por um seletor de link em item que é botão; foram corrigidos antes da execução aprovada. Capturas em [assets/2026-10-23_design-ui](assets/2026-10-23_design-ui/).

## Limites e continuidade

- Não verificados: Tauri/WebKitGTK, Firefox, leitor de tela real e contas/API financeira reais. A API não foi editada; não houve `test:api`, Rust, Terraform ou deploy.
- O atalho configurável oferece três opções, não gravação arbitrária de teclas.
- A scrollbar usa `@property` e fallbacks WebKit; o fade nativo ainda requer aceite no WebKitGTK.
- A prévia de tipografia das Configurações usa o h1 global muito grande e listas sem marcadores; não foi redesenhada. O modo leitura das notas tem estilos próprios para evitar os dois efeitos.
- Pedido ao coordenador: registrar no módulo web de `arquitetura.json` controles, modo leitura e `/finance/banks` com prova só em Chromium, e indexar este relatório. Feito na sessão 19.
