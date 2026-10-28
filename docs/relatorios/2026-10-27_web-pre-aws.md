# Frontend antes da AWS — 2026-10-27

Veredito local: **APROVADO COM RESSALVAS**. Sem deploy, push ou chamada a AWS. Branch `fix/web-pre-aws`.

## Alterações

- Logout central conta pendências de notas e eventos, exige confirmação para descarte, espera gravações da Agenda em andamento e limpa seus eventos/metadados/outbox, cache auxiliar, query cache e chaves locais da aplicação. Preferências do editor em memória voltam ao padrão. Falhas de limpeza são retornadas e informadas ao usuário.
- 401 normalizado no Axios para todas as áreas, inclusive sem envelope de erro; sessão expira e filas param conservando rascunhos. Respostas 401 atrasadas de outra sessão não encerram o login novo. `useCalendar.flush` trata `stopped: unauthorized`. 403 não tem retry; ORIGIN_NOT_ALLOWED explica IP público/lista permitida.
- Orçamento global por WebView: espaçamento de 300 ms, sem rajada; cooldown respeita Retry-After. GET tem até duas novas tentativas em 429/5xx, com jitter e atraso exponencial. Escritas não são repetidas pelo Axios; filas próprias continuam sujeitas ao orçamento.
- Finanças usa queries compartilhadas de cinco minutos e invalidação após escritas. Metadados da Agenda reutilizam a query da árvore; `loadNotes` recebe AbortSignal.
- Início lê somente uma página de 100 metadados. Se há cursor, informa indisponibilidade da nota recente: a API ordena por ID, sem endpoint cronológico. Pendência registrada, sem alteração da API.
- Decisão: [sessão e rede](../decisoes/2026-10-27_web-sessao-e-rede.md). `arquitetura.json` atualizado com o estado local verificado.

## Requisições por fluxo

Antes: relatório externo `resultado-web-infra.md`. Depois: Chromium/Playwright headless, build de produção, web 5300/API 4300; uma nota sintética, nenhum evento/tarefa no início. Autenticação Tauri simulada; API real em memória para notas/pastas/Agenda e leituras vazias sintéticas para Finanças/Biblioteca. Sem OPTIONS por proxy local de mesma origem. Pico em janela móvel de um segundo.

| Fluxo | Antes HTTP / pico | Depois HTTP / pico |
|---|---:|---:|
| Abrir Início | 4 / 4 | 4 / 4 |
| Início → Notas | 1 / 1 | 2 / 2 |
| Abrir nota | 1 / 1 | 1 / 1 |
| Editar título e aguardar autosave | 1 / 1 | 1 / 1 |
| Voltar e reabrir nota | 0 / 0 | 0 / 0 |
| Abrir Agenda | 5 / 5 | 4 / 4 |
| Mudar para Mês | 1 / 1 | 1 / 1 |
| Próximo mês | 1 / 1 | 1 / 1 |
| Mês anterior fresco | 0 / 0 | 0 / 0 |
| Retornar ao Início após autosave | 1 / 1 | 2 / 2 |
| Reabrir Agenda fresca | 1 / 1 | 1 / 1 |
| Agenda ociosa 17 s | 0 / 0 | 0 / 0 |
| Abrir Finanças | 4 / 4 | 4 / 4 |
| Reabrir Finanças | 4 / 4 | 0 / 0 |
| Alternar Finanças/Notas quatro vezes, dados quentes | 16 / 16 | 0 / 0 |
| Abrir Biblioteca | 1 / 1 | 1 / 1 |
| Reabrir Biblioteca | 1 / 1 | 1 / 1 |

A primeira ida a Notas agora carrega a árvore separadamente da página limitada do Início. Após editar, o Início atualiza os candidatos a nota recente além do resumo. Não há afirmação de queda global de todas as leituras: a correção principal é impedir paginação integral no Início e rajadas acima do orçamento. Todos os fluxos medidos ficaram abaixo de 5/s.

## Verificação real

- `npm ci`: exit 0; npm informou uma vulnerabilidade alta da árvore existente, sem atualização de dependências nesta frente.
- `npm run build`: exit 0, web/API; aviso de chunk acima de 500 kB.
- `npm run test:web`: **217 aprovados, zero falhas/ignorados** (207 anteriores + 10 novos).
- `env -u DYNAMODB_TEST_ENDPOINT npm run test:api`: **215 aprovados, 10 ignorados**, zero falhas; integração DynamoDB Local não executada.
- `npm run check:modules`: exit 0, cinco módulos válidos. `git diff --check`: sem problemas.
- Graphify local `explain signOut` com log desativado: relações de saída/guard confirmadas na fonte; sem indexação ou provedor externo.
- Playwright: 401 em Biblioteca/Agenda/Notas levou à tela de login com uma tentativa por alvo; 403 de autosave fez uma tentativa e exibiu diagnóstico de IP; 429 de autosave respeitou 2 s e sincronizou.
- Playwright GET: 403 fez uma chamada, sem expirar sessão; 429 fez duas chamadas com intervalo mínimo de 2 s. Cursor sintético no Início causou somente uma leitura de metadados e aviso explícito sobre acervo maior.
- Logout no navegador: `miupy-calendar` events/meta/outbox e `miupy-notes-drafts` drafts/cleanups ficaram em zero. Cenário adicional com outbox pendente exigiu confirmar descarte e removeu todas as chaves `miupy-calendar.*` sintéticas.
- Testes dirigidos: limpeza por proprietário preserva outro usuário; espera escrita em voo; falhas de armazenamento são informadas; 401 preserva pendência; orçamento/retry/403/401 atrasado e cancelamento de sessão cobertos.
- Uma repetição dos cenários de erro foi interrompida ao encerrar o servidor antes do término (`ECONNREFUSED`); servidor reiniciado e cenários repetidos antes da entrega.
- Chromium: sem erros JS no fluxo normal; móvel 390 px sem overflow horizontal; rota 404 e reduced-motion exercitados. Sem nova auditoria visual completa.

## Ressalvas e não verificado

- **Média:** `apps/web/src/lib/notes-queries.ts:50` / `HomeToday.tsx:108`: para coleções que não cabem em 100 metadados, nota recente depende de endpoint por updatedAt, registrado na decisão. Não se usa o primeiro ID como se fosse o mais recente. O summary existente continua percorrendo o acervo no backend.
- **Baixa:** `apps/web/src/components/LiveMarkdownEditor.tsx:2` / `NoteEditorPage.tsx:25`: chunk de **582,83 kB**, gzip **200,78 kB**, já lazy. Composição: wrapper UIW/CodeMirror, linguagem Markdown, extensões live-preview, tema e atalhos. Separar exige rever o setup do editor ou só distribuir dependências entre arquivos sem reduzir seu custo de abertura; não foi feito particionamento artificial. Perfil 364,52 kB; entrada 423,07 kB (antes 364,49 kB), efeito da composição dos módulos compartilhados, sem medição de CPU nessa frente.
- Limite global só coordena uma instância; várias janelas/dispositivos, CORS/OPTIONS, gateway real, faturamento, OAuth/chaveiro/Tauri/WebKit, criptografia local, DynamoDB Local e contas reais não foram verificados. Falha física de armazenamento impede garantir exclusão; a interface informa isso.
- Evidências e scripts externos: `.briefs-validacao-2026-10-27/evidencias-web-fix/` ao lado do checkout. Builds/testes também copiados para essa pasta. Processos da frente encerrados ao concluir.
