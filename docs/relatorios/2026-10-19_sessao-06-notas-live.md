# Sessão 06 — frente notas: árvore de pastas, editor Live Preview e tags

- **Data:** 2026-10-19
- **Escopo (worker supervisionado):** notas em árvore com pastas persistidas no backend, criação de nota sem input prévio, editor renderizado e editável como o Live Preview do Obsidian, toolbar suspensa, tags com selos, autosave/409/exclusão preservados.
- **Branch:** `feat/s06-notes-live` (renomeada de `carlusnz-dev/feat-s06-notes-live` antes do primeiro commit), a partir de `dcc3639`. PR draft para `develop` (instrução do coordenador, msg `e953d74cab04`, substitui a base transitória). Sem merge, rebase, deploy, AWS real; `.env.local` não lido; só dados sintéticos.

## Alterações

**API (`apps/api`)**
- Novo módulo `modules/folders` (domain, DTOs, repository DynamoDB e memória, service, controller, rotas, `module.ts`, `index.ts`, `contract.ts`): `GET/POST /v1/folders`, `PATCH /v1/folders/{id}` (**só renomeia**). Item `pk = USER#<owner>`, `sk = FOLDER#<id>`, `version`, escrita condicional. Limites: 500 pastas por proprietário, 8 níveis.
- Notas ganham `folderId` (`null` = raiz): `POST` e `PATCH` (mover incrementa `version`); pasta inexistente ou alheia → `400 "Pasta inválida."`. Notas antigas sem o atributo leem como `folderId: null`.
- `src/compose.ts` liga notas e pastas sem importação cruzada (porta `FolderDirectory` do módulo notes, satisfeita por `FoldersService`); `app.ts`, `server.ts`, `lambda.ts` montam `/v1/folders`. Notas e pastas dividem a tabela (`NOTES_TABLE_NAME`).
- **Mover e excluir pastas foram removidos** (achados do coordenador, msg `b759541ace10`): sem `DELETE`, `PATCH` rejeita `parentId`. O pai fixado na criação elimina ciclo, pai removido, off-by-one de `heightOf` e órfãos por corrida. Estratégia transacional (item de versão da árvore + contador por pasta + `TransactWriteItems`) descrita em `api.md`, não implementada.
- `docs/arquitetura/api.md`: seção Notas (campo `folderId`, corpo devolvido byte a byte) e nova seção Pastas.

**Web (`apps/web/src`)**
- `NotesPage.tsx`: árvore de pastas e notas na raiz (`components/NoteTree.tsx`), botões "Nova nota" e "Nova pasta" sem input prévio. Nota nasce como "Sem título" (aceito pelo contrato), abre o editor e foca/seleciona o título (`location.state.focusTitle`, limpo após o uso). Nova pasta entra direto em renomear. Mover nota: arrastar ou `<select>` "Mover a nota … para" (alternativa de teclado). Recolher/expandir com GSAP e `prefers-reduced-motion`.
- `NoteEditorPage.tsx` + `components/LiveMarkdownEditor.tsx` + `components/live-markdown.ts`: CodeMirror 6 (já era dependência) com decorações Live Preview; o documento é sempre o Markdown cru. Sem os modos Editar/Dividir/Prévia; código-fonte só pelo botão-ícone da toolbar (`aria-pressed`). Toolbar suspensa com `backdrop-filter: blur`, borda fina e cantos arredondados, com todas as ações antigas (negrito, itálico, riscado, título, listas, tarefa, citação, código, bloco, link), agora com alternância (segundo clique desfaz).
- Renderizados editáveis: títulos, negrito/itálico/riscado/código, links (Ctrl/Cmd+clique abre fora), listas, tarefas com checkbox clicável (e Ctrl+Enter), citações, régua, **imagens http(s)** e **tabelas** (widget de bloco com alinhamento e inline básico). Clicar na imagem ou tabela revela o Markdown com o cursor no ponto clicado.
- `components/TagInput.tsx` e `Badge.tsx`: espaço, vírgula ou Enter confirmam; blur descarta o rascunho; selo com X removível (`aria-label` "Remover tag …"); duplicadas ignoradas sem diferenciar caixa; limite 20/40 do contrato; região `aria-live` com o resultado; Backspace no campo vazio remove a última.
- `lib/`: `notes-markdown.ts` (comandos da toolbar sobre estado puro + preservação do fim de linha), `notes-autosave.ts` (regra de gravação testável), `notes-tags.ts`, `notes-tree.ts`, `notes-workspace.ts` (backend real ou, só em DEV, dados sintéticos em memória), `notes-folders-api.ts`/`-queries.ts`, `notes-motion.ts`; `notes-api.ts` aceita `folderId`.
- Autosave: fila de gravação por nota fora do React (`createAutosaveQueue` em `lib/notes-autosave.ts`, instância `notesSaver` em `lib/notes-saver.ts`); ver "Follow-up da revisão do PR #6". A primeira versão (`saveNote`, que devolvia `busy` e descartava o texto mais novo ao sair) foi substituída.

## Revisão do baseline `dcc3639` vs `c0dc3b2` (skill revisar-pr, leitura do diff)

Escopo: `NoteEditorPage`, `editor-preferences`, `SettingsPage`, `App.tsx`. Achados (leitura de código; o runtime não foi reproduzido porque exige sessão Google):
1. **Média — resposta tardia instala a nota errada.** (o conserto inicial desta sessão tinha, ele próprio, o defeito descrito no follow-up abaixo) `persist()` fazia `setNote(updated)` e `latest.current = …` sem checar o `id` aberto; trocar de `/notes/A` para `/notes/B` (mesmo componente, só muda o parâmetro) durante o PATCH colocava a nota A no estado de B. Corrigido pela fila por nota; testes e fluxo no navegador abaixo.
2. **Média — rascunho perdido ao navegar.** O efeito de `[id]` zerava `note/draft` e a navegação pela barra lateral ou "Configurações" cancelava o debounce de 1,2 s: até 1,2 s de digitação sumia sem aviso (`beforeunload` só cobre fechar a janela). Corrigido: ao sair o texto vai para a fila; se a gravação falhar o texto fica guardado em memória e volta ao reabrir a nota. `HashRouter` não oferece bloqueio de navegação, por isso não há confirmação ao sair.
3. **Baixa — preferência órfã.** "Formatação expandida por padrão" (`toolbarExpanded`, `SettingsPage`) não tem efeito com a toolbar sempre visível. `Home.tsx`/`ProfilePage.tsx` montam `NoteOutput` de amostra sem `folderId` (ver limitações). No baseline, recolher "Formatação e tags" também escondia as tags.
4. Sem achado: validação com `trim`, limites 100 000/20/40 iguais ao contrato, `409` bloqueia o autosave, `editorStyle` com valores fechados, `localStorage` com try/catch e fallback.

## Achados do coordenador tratados

- `b759541ace10` (pastas): off-by-one, ciclo concorrente, exclusão não transacional → mover/excluir removidos, com testes de profundidade (8 níveis aceitos, 9º recusado) e de recusa (`PATCH` com `parentId` → 400, `DELETE` → 404).
- `a6468374196a` (Live Preview): imagens http(s) e tabelas renderizadas; ver limites abaixo.
- `3f5d93b6787c` (autosave A→B): ver acima.
- Bug meu, encontrado na validação e corrigido: o fallback de imagem trocava o elemento raiz do widget; o CodeMirror leu isso como edição e **reescreveu o Markdown da nota** (a imagem virou `[imagem não carregada: …]`). Agora só o conteúdo interno do widget muda; verificado no navegador (documento idêntico antes e depois de a imagem falhar).

## Follow-up da revisão do PR #6 — perda de texto ao sair durante um PATCH

**Falha anterior (bloqueante, achada pelo coordenador e reproduzida aqui):** `saveNote` devolvia `busy` quando já havia PATCH da nota em andamento. Cenário: PATCH com `snapshot1` em voo → usuário digita `snapshot2` → sai antes de o PATCH terminar → o `persist(true)` do cleanup recebia `busy` e descartava `snapshot2`; o resultado de `snapshot1` chegava como obsoleto e ia só para o cache. O teste da época *esperava* `busy` e não cobria a saída com rascunho mais novo; testava a função, não o fluxo React. Reproduzido no navegador contra o commit `d17cdfe` (worktree temporária, porta 1432, harness sintético): servidor ficou em `A v2 "base A snapshot1"`, `snapshot2` perdido, um único PATCH. Em `A → B` pela mesma tela o `"!"` digitado durante o PATCH também se perdeu (`A v2 "base A A-novo"`).

**Correção:** `createAutosaveQueue` (`lib/notes-autosave.ts`) mantém, por nota e fora do React: `base` (última versão confirmada), `sending` (texto do PATCH em voo) e `pending` (texto mais novo). Terminado o PATCH, a nova `version` vira a base e o `pending` é enviado em seguida — mesmo com o usuário já em outra nota. Falha de rede deixa `pending` guardado e sem repetição automática; 409 marca `blocked`, guarda também o que for digitado depois e não reenvia; só "Recarregar a versão salva" (`reset`) descarta. `NoteEditorPage` entrega o texto à fila (autosave com debounce, Ctrl+S e cleanup ao sair), assina só a entrada da nota aberta e, ao reabrir uma nota com texto não gravado, restaura-o com o aviso **"Rascunho recuperado"** (e os avisos de erro/conflito). Nada vai para `localStorage`; `notes-saver.ts` limpa a fila ao sair da conta e guarda a do 401 (sessão expirada), e `beforeunload` avisa enquanto houver texto sem confirmação.

**Evidência real** (Playwright MCP, Chromium, Vite em 1431 com `StrictMode` ativo; harness sintético em `.playwright-mcp/` (ignorado pelo Git, não versionado): Tauri falso que se declara logado e `page.route` em `/v1/**` com notas A e B em memória, atraso e falha controláveis; nenhuma sessão Google, nenhum dado real):
1. *Brief:* PATCH atrasado de `snapshot1` → digita `snapshot2` → sai para Agenda → log do servidor `A@1:200 "base A snapshot1"`, `A@2:200 "base A snapshot1 snapshot2"`, A em v3, B intacta (v1); reaberta, A mostra `snapshot2` e "Salvo".
2. *A→B na mesma tela:* PATCH de A em voo, `!` digitado, hash para B → B mostra só o conteúdo de B (antes, durante e depois de os PATCHes de A terminarem); log `A@1`, `A@2` (com o `!`), depois `B@1` só quando B foi editada; servidor A v3 `"base A A-novo!"`, B v2.
3. *Rede falha na saída:* `A@1` abortado, servidor continua em v1; ao reabrir, editor com o texto, status "Não foi salvo: Não foi possível alcançar o servidor." e banner "Rascunho recuperado … o envio falhou"; o autosave reenviou sozinho 1,2 s após a reabertura (`A@1:200`), A em v2 e o banner some.
4. *409:* servidor avançado para v5 → `A@1:409` → banner de conflito; texto digitado depois e saída → nenhum PATCH novo; reaberta, editor com `"base A xy"` e os dois banners; "Recarregar" traz o texto do servidor; nova edição grava `A@5:200` → v6.
Contraprova: os cenários 1 e 2 rodados no código antigo falham como descrito acima.

**Testes unitários da fila (`notes-autosave.test.ts`, 9):** saída com texto novo durante o PATCH (v1→v2→v3, B intacta, ouvintes de B não acionados), voltar para A com PATCH em voo (restaura `sending` e depois `pending`; base mais nova vence cache velho), falha de rede (guarda, restaura, reenvia com a mesma `version`), 409 (bloqueia, guarda texto digitado depois, `reset` descarta), reverter durante o envio, título em branco ao sair (título fora do PATCH) e inválido guardado, `clear`/`unknown`.

**Limites desta verificação:** o harness substitui o backend e o Tauri; `StrictMode` e o React real estão ativos, mas não foi usada API, DynamoDB nem sessão reais. Não testado: dois PATCH de notas diferentes realmente simultâneos no navegador (só no teste da fila), falha 5xx/403 na saída (mesmo caminho de erro da rede), logout durante um PATCH. Conflito com edição em outro aparelho continua exigindo escolha manual do usuário.

## Verificação (comandos e resultado real)

- `npm run build`: exit 0 (`tsc` web + node, `vite build`, `tsc --noEmit` API). Chunk do editor 645,16 kB (220,90 kB gzip; antes 672 kB); bundle inicial 540,19 kB (175,12 kB gzip; antes 530 kB — a tela de notas e a árvore estão no bundle inicial). Aviso de chunk > 500 kB persiste.
- `npm run test:api`: **41 aprovados, 3 ignorados** (os 3 de integração, que exigem `DYNAMODB_TEST_ENDPOINT`). Com DynamoDB Local descartável (`amazon/dynamodb-local:3.3.1 -inMemory`, porta 8011, container `miupy-dynamodb-s06-notes`, removido depois; o `miupy-dynamodb` do proprietário, porta 8000, não foi tocado): **44/44**, incluindo persistência de pastas e notas, mover nota com `version`/409, isolamento entre proprietários, nota legada sem `folderId` e corpo CRLF/emoji/tabela byte a byte.
- `npm run test:web`: **37/37** (roundtrip Markdown e comandos da toolbar, fim de linha, decorações do Live Preview — só marcadores somem, nunca texto —, imagens seguras, tabelas, tags, árvore, fila de autosave: A→B, rede falha, 409, saída com título em branco, `clear`).
- `npm run check:modules`: 2 módulos válidos.
- **validar-design** (Playwright MCP de `.mcp.json`, Chromium headless, Vite em 1431 porque a 1420 estava ocupada por outro worker; dados sintéticos de `?estado=`): editor e árvore em 1440×900 e 390×844 sem overflow horizontal; `?estado=vazio|erro|carregando|deslogado|lista|arvore` renderizam; 404 com título correto; console sem erros além da requisição da imagem de teste propositalmente inválida. Interações exercitadas por script: tags (espaço, Enter, `#`, blur descarta, duplicada, vírgula, remover, Backspace), criar nota (título focado e selecionado, Enter leva ao texto, lista continua), nova pasta com renomear (Enter/Esc), mover nota por `<select>` e arrastando, recolher/expandir, checkbox e Ctrl+Enter, negrito aplicar/desfazer, modo código-fonte, clique em tabela/imagem. Com `prefers-reduced-motion: reduce` o recolher/expandir é imediato e sem estilo inline de GSAP. Tab percorre os botões com outline de 3 px.
- Foi usada a documentação do Obsidian `obsidian.md/help/edit-and-read` (Live Preview mostra a sintaxe só onde está o cursor; Source mode mostra tudo). `help.obsidian.md/Live+preview+update` redireciona para uma página "Not Found".

## Limitações reais

- **Marcadores aparecem onde o cursor toca** (inline: o trecho; bloco: a linha), como no Live Preview do Obsidian. Esconder também com o cursor dentro impediria apagar ou editar um `**`. Se o proprietário quiser "nunca mostrar", é um modo novo sem edição direta da sintaxe.
- Cercas de bloco de código (```) ficam visíveis e esmaecidas; sem realce de linguagem. Tabelas dentro de citação/lista continuam texto. Células não renderizam imagens nem HTML; edição de célula é feita no Markdown revelado. Imagens só `http(s)`; `data:`, `file:`, relativas e `javascript:` ficam como texto. Imagem externa faz uma requisição de rede ao abrir a nota (`referrerPolicy: no-referrer`, `loading: lazy`); o CSP do Tauri ainda é `null`.
- Fim de linha: o editor usa `\n` e restaura o estilo dominante (`\r\n` ou `\r`) ao gravar; nota com fim de linha **misto** perde o estilo minoritário na primeira edição.
- Não verificado: criar/abrir/salvar com sessão real (Google), exclusão pela UI (o 409 e o autosave foram exercitados no navegador só com harness sintético; ver follow-up); DnD apenas no Chromium (WebKitGTK/Tauri não testado); janela Tauri não aberta; contraste medido só a olho; blur da toolbar verificado visualmente sobre código e texto.
- A árvore carrega todas as notas (`useAllNotes`, teto de 5 000) e mostra aviso se truncar. Pasta criada por engano não pode ser excluída ou movida; nomes duplicados são aceitos.
- A listagem de notas continua em ordem de ID, não cronológica; a árvore ordena por título (pt-BR, numérico).
- Texto não gravado fica só em memória: fechar o app o perde (a janela pede confirmação enquanto houver texto sem confirmar pelo servidor); sessão expirada o mantém, sair da conta o apaga. A fila guarda a versão base de cada nota aberta até o app fechar (até 100 000 caracteres por nota).

## Para o coordenador (arquivos fora do meu escopo)

- **Dependências (nenhum manifest editado):** `apps/web/src/components/live-markdown.ts` importa `@codemirror/language`, que não está em `apps/web/package.json` (o baseline já importava esse pacote e `@lezer/highlight`; este último não é mais usado). Sugiro declarar `@codemirror/language`. `remark-gfm` ficou sem uso (o editor não tem mais prévia); `react-markdown` só é usado por `SettingsPage`. `useNotesList` ficou sem uso no web.
- `SettingsPage.tsx`: remover ou renomear "Formatação expandida por padrão"; `Home.tsx` e `ProfilePage.tsx`: adicionar `folderId: null` às amostras e então apertar o tipo `NoteOutput` em `lib/notes-api.ts` (hoje `folderId` é opcional só por isso).
- `arquitetura.json`: `frontend` (árvore de pastas, Live Preview, tags; validado em Chromium com dados sintéticos; sem sessão real) e `api` (módulo `folders`, 44 testes com DynamoDB Local descartável); não marquei nada como verificado em AWS.
- `backend.json`: rotas `GET/POST /v1/folders`, `PATCH /v1/folders/:id`; `folderId` em notas; `src/compose.ts`; tabela única com `FOLDER#`.
- `api.md`: intro (menciona só `/v1/notes`) e `apps/api/README.md` (lista de módulos, `NOTES_TABLE_NAME` também guarda pastas). `dados.md`: entidade `folder`.
- Conflitos esperados com finance (`app.ts`, `server.ts`, `lambda.ts` — `createApp` agora exige `foldersRouter`; `compose.ts` é novo): resolver compondo, sem ours/theirs.
- Índice `docs/relatorios/README.md` não foi alterado.
