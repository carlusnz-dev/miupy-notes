# Biblioteca — API e interface

Data: 2026-10-23. Branch `feat/library-module`, criada sobre `develop` (`fcaf49c`), conferida antes de editar. Nenhum merge, recurso AWS, Terraform ou conta Google real nesta frente.

## Mudanças e decisões

Módulo `library` segue as classes e fronteiras de notas: domínio, DTOs estritos, repository memória/DynamoDB, service, controller, routes, composição pública e schemas compartilhados com a web. CRUD de livros/filmes/músicas por proprietário, versão condicional, filtros combinados, busca por trecho do título e cursor opaco. Outro proprietário recebe 404 em detalhe/edição/exclusão. Validação cobre nota 0–5, datas reais/ordem também em PATCH parcial, limites e URLs HTTP/HTTPS. Logs preservam templates e não registram conteúdo, proprietário ou query.

Página `/library` substitui o placeholder, com carregamento sob demanda. Axios central, filtros na URL, grade de capas ou placeholders tipográficos, nota/status, criação/edição via Modal compartilhado e exclusão via novo ConfirmDialog sobre o mesmo Modal. ButtonGroup compartilhado usa GSAP com movimento reduzido/cleanup. Capas externas não usam referrer; formulário informa a requisição à origem. Perfil oferece “Ver acervo” em vez de zero fictício; contagem global continua pendente.

Paleta, serif principal e Inter seguem tokens existentes. Capas tipográficas diferenciam livros, filmes e músicas sem decoração extra; quatro colunas em desktop amplo, duas em mobile. Busca/tag se agrupam em tela pequena. Decisão, alternativas e limites em [Biblioteca](../decisoes/2026-10-23_biblioteca.md); contrato em [api-library.md](../arquitetura/api-library.md). RF-13/RF-14 foram acrescentados sem renumerar os anteriores; RF-09 permanece parcial pela exportação/restauração.

Skills codigo-enxuto, revisar-contrato, graphify, validar-design, relatorio e revisar-pr consultadas. O coordenador localizou as cinco skills adicionais de frontend no checkout principal (`/home/cabeto/Documentos/Projetos/miupy-notes/.agents/skills/`), ausentes nesta worktree; foram lidas dali sem copiar/commitar. A autorização do briefing para decidir sem perguntar prevaleceu sobre o protocolo da bencium. Aplicados seus princípios visuais e os padrões React/composição, preservando componentes, CSS e GSAP do projeto. As Web Interface Guidelines foram recuperadas da fonte indicada pela skill. Graphify local foi consultado com log desativado, sem extração ou envio de dados.

## Verificação executada

| Comando / prova | Resultado |
|---|---|
| `npm run build` | Web e API aprovados; aviso preexistente de chunk do editor acima de 500 kB. Biblioteca carregada sob demanda. |
| `env -u DYNAMODB_TEST_ENDPOINT -u DYNAMODB_FINANCE_TEST_ENDPOINT -u DYNAMODB_CALENDAR_TEST_ENDPOINT npm run test:api` | 193 testes: 183 aprovados, 10 integrações ignoradas, nenhuma falha. Inclui 9 novos testes da Biblioteca sem rede externa. |
| `DYNAMODB_TEST_ENDPOINT=http://127.0.0.1:8000 node_modules/.bin/tsx --test apps/api/src/modules/library/repository/library.local.test.ts` | 1/1 aprovado em DynamoDB Local já disponível. Tabela sintética própria criada/excluída; persistência, isolamento, cursor/filtro vazio e CAS 200/409. Nenhuma tabela pessoal foi consultada. |
| `npm run test:web` | 160/160 aprovados. |
| `npm run check:modules` | 5 módulos com estrutura/fronteiras válidas. |
| `git diff --check` / `git diff --cached --check` | Sem erros de whitespace. |
| `timeout 150s python apps/web/tests/library.mcp.py http://127.0.0.1:5183` | Playwright MCP Chromium isolado aprovado em 1440×900 e 390×844, sem erros JavaScript. |

A revisão do diff/contrato não deixou falhas concretas conhecidas neste recorte; não houve revisão por agente independente. Testes cobrem corpo/query estritos, URLs inválidas, datas, limpeza de opcionais, IDs alheios, concorrência, autenticação/lista de sub na montagem e privacidade dos logs. JWT/jose mantém sua suíte existente; o harness usa identidade sintética, sem login real.

Playwright percorreu CRUD via Axios/API em memória, filtros/URL, páginas vazias, carregando, erro/retry, capa sintética e fallback, link externo, conflito HTTP real 409 mantendo formulário, Tab/Shift+Tab, Esc e devolução de foco, foco visível, reduced-motion, overflow móvel, acesso sem sessão, Início e 404. Capturas em [assets/2026-10-23_biblioteca](assets/2026-10-23_biblioteca/): desktop, modal desktop, mobile, modal mobile, mobile reduced-motion, vazio, carregando e erro. Imagens e conteúdo são sintéticos; a imagem de capa do teste é interceptada pelo Playwright, sem consulta à origem.

Para reproduzir a prova visual, iniciar `node_modules/.bin/tsx apps/web/tests/library-api-harness.ts` (127.0.0.1:3183) e `node apps/web/tests/library-vite.mjs` (127.0.0.1:5183, strictPort, envDir temporário vazio), depois executar o comando MCP acima. Reiniciar a API sintética entre execuções para restaurar o acervo inicial. Esses harnesses estão fora do build; não servem para dados reais.

## Falhas intermediárias corrigidas

O primeiro build apontou a allowlist de templates do logger sem `/v1/library`; foi ampliada e testada. Um teste HTTP precisou aguardar o listener antes de ler a porta. O waiter da integração DynamoDB recebeu minDelay/maxDelay compatíveis com o limite local; a tabela foi removida também na tentativa falha. A automação visual precisou aguardar respostas ao trocar filtros, avançar o cursor para a obra recém-criada, aguardar o fim da cópia visual de saída do modal e gerar foco por teclado para testar `:focus-visible`. Ao ampliar a prova de carregamento/capas, o gate de rede e o seletor de label com descrição foram corrigidos. Todas essas provas passaram na execução final; não foram contadas tentativas incompletas como sucesso.

## Pendências e limites

Não executados: login Google real, Tauri/WebKit manual, release desktop, AWS, Terraform/deploy ou teste com dados pessoais. A validação visual usa Chromium e harness sintético, não garante comportamento nativo WebKit. Recursos não implementados: exportação/restauração, lixeira/retenção, sincronização offline, upload/catálogo externo e contador agregado no Perfil.

A lista ordena por UUID e filtra depois dos itens avaliados; pode vir vazia com cursor e não é snapshot. O formulário preserva a página após edição. POST não é idempotente; resultado ambíguo exige conferir o acervo antes de repetir. DELETE segue notas, sem versão, podendo excluir edição recente. Próximo passo: revisão do PR e aceite nativo; considerar resumo agregado/exportação da Biblioteca em frente própria, sem ampliar esta entrega.

## Entrega

PR [#24 — Biblioteca na API e na interface](https://github.com/carlusnz-dev/miupy-notes/pull/24), de `feat/library-module` para `develop`, aberto com `gh`, sem merge. Commits de implementação: `25281a8` (API/contrato) e `a55f33e` (interface/validação); ambos seguem Conventional Commits em pt-BR e incluem o coautor solicitado.

O push SSH padrão falhou com `Permission denied (publickey)` e ausência de `ssh_askpass`. O push foi concluído por HTTPS com opções temporárias `credential.helper=!gh auth git-credential` e `url.https://github.com/.insteadOf=git@github.com:`, sem alterar o remoto configurado nem abrir credenciais. Os servidores sintéticos de API/Vite foram encerrados após a validação; o DynamoDB Local preexistente foi preservado. O estado da CI no momento da entrega consta no relatório externo em texto puro.
