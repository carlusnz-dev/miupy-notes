# Finanças: contas, balanço e formulário

RF-02, RF-03, RF-04, RF-08 e RF-10. Trabalho isolado, sem AWS, contas bancárias reais ou integração Pluggy executável.

## Entrega e decisões

- Instituições continuam em `banks`; contas separadas em `accounts`, com moeda imutável, referência manual no início de uma data e versão condicional. Lançamentos legados permanecem compatíveis; `accountId` ausente lê como null. Balanço soma referência e movimentos posteriores da conta uma vez, adicionando movimentos sem conta separadamente e nunca misturando moedas.
- `GET /balances` agrega todas as páginas do proprietário; `/summary` anterior permanece como movimentação global e alimenta as métricas do Perfil. Contas não são excluídas nesta etapa; instituição com conta conhecida não pode ser excluída. Contratos próprios atualizados em `api-finance.md` e `dados-finance.md`; documentos centrais/índice são responsabilidade do coordenador.
- Formulário financeiro em duas etapas com GSAP, preservação de valores/parcelas e validação. Modal compartilhado conserva saída visual na desmontagem direta por cópia temporária inerte/aria-hidden, restaura foco, usa X externo de 44px e cantos de 32px (28px móvel). A cópia conserva tema e scroll, é removida após a animação e não aparece em movimento reduzido.
- Sidebar usa opacity e letras com GSAP, mantendo nomes acessíveis dos links, cleanup e movimento reduzido. Agenda conserva `/events`.
- Pesquisa Pluggy somente em documentação primária pública: proposta de identidade por item/conta/transação, autenticação backend/Connect Token efêmero, deduplicação por eventId, reconciliação de delete/create e snapshots separados da referência manual. Nenhum segredo ou dado financeiro real usado.

## Verificação observada

| Comando/ação | Resultado |
|---|---|
| `npm ci --ignore-scripts` | 346 pacotes instalados; auditoria informou zero vulnerabilidades. Build inicial sem dependências havia falhado por `tsc` ausente. |
| `npm run test:api` | 79 aprovados, quatro testes de integração não financeiros ignorados por ausência de endpoint configurado; zero falhas no último percurso. |
| `DYNAMODB_FINANCE_TEST_ENDPOINT=http://127.0.0.1:8000 npx tsx --test apps/api/src/modules/finance/routes/finance.routes.test.ts` | 16 aprovados; tabela sintética UUID criada e excluída pelo teste. Legado, débitos/créditos, moeda, mudança de instituição, owner, concorrência, paginação e overflow. |
| `npm run test:web` | 106 aprovados. |
| `npm run build` | Web/API aprovados; aviso existente de chunk do editor acima de 500 kB. |
| `npm run check:modules` | Três módulos com estrutura/fronteiras válidas. |
| `timeout 90s python apps/web/tests/finance-balances.mcp.py http://127.0.0.1:5202` | Playwright MCP Chromium isolado: 1440x900 e 390x900, etapas/parcelas/payload exato, X externo, saída após desmontagem/cleanup, Sidebar com nome acessível, StrictMode, reduced-motion, referência negativa/saldo calculado, Home e 404. |
| Trecho modal de `settings-modal.mcp.py`, executado por cópia temporária isolada | Aprovou foco inicial/trap/restauração, Esc, backdrop, bloqueio busy, entrada/saída, reduced-motion e móvel. Script completo antigo parou antes desse trecho em espera de fonte de Configurações (timeout de 30s); não se declara Configurações validada por ele. |
| Graphify `explain FinanceServiceImpl`, depois `extract apps/{api,web}/src --code-only --no-cluster` | Navegação e atualização AST local; caches externos em `~/.cache/miupy-notes/graphify`, sem LLM e sem artefatos no Git. |
| `git diff --check` | Sem erros. |

Vite de validação foi iniciado programaticamente com `configFile:false`, `envDir:/tmp/miupy-empty-env` e dados sintéticos. Uma primeira tentativa curta com CLI Vite foi interrompida ao receber a orientação de `envDir` vazio; não houve leitura manual de `.env`, login nem conexão real. Capturas inspecionadas em `/tmp/finance-step2-1440.png` e `/tmp/finance-step2-390.png`: painel legível, foco visível, X externo e conteúdo com rolagem interna, sem overflow horizontal. O primeiro harness temporário não aplicava o tema; corrigido antes da inspeção final. O harness reproduzível fica em `apps/web/tests/finance-balances-*`.

Uma asserção antiga do CSV detectou a posição final de Parcelas após alteração experimental; o CSV foi conservado integralmente e voltou a passar. Um novo teste concorrente revelou que o repositório em memória do teste tinha um await entre comparação e escrita; foi tornado atômico na própria memória, e a mesma concorrência passou em DynamoDB Local real.

## Limites e próximo passo

Sem snapshot transacional entre páginas/entidades. Criar conta e excluir instituição simultaneamente ainda pode deixar vínculo órfão; o balanço conserva seu valor sob instituição removida. Não há exclusão de contas, backup restaurável das referências, retenção, materialização ou importação bancária. A referência manual pode ser alterada explicitamente; datas futuras de lançamentos gravados também entram depois do corte. Tauri/WebKit e métricas do Perfil com login real não foram verificados nesta execução. Nenhum teste atesta IAM/criptografia/retenção AWS.

Fetch por SSH falhou por chave indisponível; HTTPS com helper autenticado do gh foi usado sem mudar configuração global nem expor credenciais. PR para develop será revisado por outro agente antes de qualquer integração; nenhum merge do PR foi autorizado nesta frente. Coordenador deve atualizar fontes centrais com os novos endpoints/estado comprovado e indexar este relatório.
