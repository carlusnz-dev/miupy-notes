# Hábitos — correções da validação

Data: 2026-10-27. Branch `feat/habits-mvp` (worktree `habits-mvp`), Claude Sonnet 5.5. Sem AWS, sem Google real, sem push. Corrige os achados H1–H6 da validação de 2026-10-27.

## O que foi feito

- **H1 — conclusão e XP atômicos.** `HabitsRepository` perdeu `putLog`/`deleteLog`/`grantXp`/`setXpRevoked` e ganhou `completeOccurrence(log, event)` e `reopenOccurrence(...)`. No DynamoDB, cada uma é uma `TransactWriteItems`: concluir regrava a execução e faz upsert do evento (`if_not_exists` em `points`/`createdAt`, `revokedAt = null`); desmarcar apaga a execução e atualiza o evento sob `attribute_exists(pk)`; se o evento não existe, uma segunda transação apaga a execução com `ConditionCheck attribute_not_exists(pk)` (evento criado no meio vira `409`). `TransactionConflict` vira `409`. O repositório em memória muda os dois mapas sem `await` entre eles.
- **H2 — dados ligados ao dia.** Novo `habits/day-data.ts` (`dayView`, `toggleRequest`): a lista só vale para o dia com que foi lida; leitura falha desabilita as ações; o PUT sai apenas se o item pertence ao dia visível. Usado em `HabitsPage.tsx` e `calendar/HabitsAgendaPanel.tsx`. A lista agora permanece durante a releitura do mesmo dia (antes virava esqueleto a cada marcação).
- **H3 — corrupção é 500.** `parseInternal` (`core/domain/app-error.ts`) converte `ZodError` de dado lido/saída em `ServiceError` (500, log com serviço, operação, origem e `ZodError` na cadeia, sem conteúdo). Usado no repositório Dynamo de hábitos e em `dto/adapter.ts`. Entrada do cliente continua `schema.parse` (400). `error-handler.ts` não precisou mudar: `classifyError` já tratava `ServiceError`.
- **H4 — Google Tasks.** `TaskGoogleSync` registra (`warn`, serviço "Google Tasks", operação, tipo, status HTTP) antes de devolver `failed`; `GoogleTasksApiError` ganhou `status` opcional, preenchido pelo cliente HTTP. `not_found` na exclusão continua sucesso, sem log.
- **H5 — troca de dia com GSAP.** Corpo da lista e rótulo deslizam no sentido da navegação (28 px / 14 px, `power2.inOut`), via `gsap.matchMedia` com `prefers-reduced-motion: no-preference` e `revert()` na limpeza, como em `CalendarWorkspace`. O cabeçalho do dia deixou de sumir durante o carregamento.
- **H6 — limite de 300.** Conta só hábitos fora da lixeira (`deletedAt === null`); `restore` acima do limite responde `409`. Escolha registrada em `api.md`.

## Testes de regressão

- H1: `habits.service.test.ts` (conclusão × desmarcar entrelaçados com a escrita retida; 6 chamadas alternadas; falha injetada ao concluir e ao desmarcar; idempotência) e `dynamo-habits.repository.test.ts` (uma única `TransactWriteCommand`, condições, fallback, `409`). Antes da mudança, o entrelaçamento deixou `pending` com 10 XP e a falha injetada deixou `completed` com 0 XP (reprodução em teste temporário, descartado).
- H2: `habits.test.ts` (troca de dia + erro + clique não gera pedido; leitura falha desabilita).
- H3: `habits.errors.test.ts` (500 com log por rota para item inválido e saída inválida; entrada inválida segue 400) e teste do repositório.
- H4: `google-tasks.test.ts`. H6: teste do limite em `habits.service.test.ts`.

## Verificação (resultado real)

| Comando | Resultado |
|---|---|
| `npm run build` | ok (aviso de chunk > 500 kB do editor, preexistente) |
| `npm run test:web` | 212 aprovados, 0 falhas |
| `env -u DYNAMODB_TEST_ENDPOINT npm run test:api` | 256 aprovados, 0 falhas, 10 ignorados (integração DynamoDB Local) |
| `npm run check:modules` | 6 módulos válidos |
| Playwright headless (web 5400, API 4400, repositório em memória, dados sintéticos) | cenário H2 em 1440 e 390: após 503 ao avançar de 26/10 para 27/10, 0 checkboxes e 0 PUT; recuperação envia `PUT .../occurrences/2026-10-27`; releitura falha do mesmo dia deixa os 3 checkboxes desabilitados; transição direcional medida (x: +28→0 ao avançar, −28→0 ao voltar) e sem movimento com `reduce`. Capturas em `../.briefs-validacao-2026-10-27/habits-shots/fix/` |

## Não executado / pendente

- Transações no DynamoDB da AWS: não exercitadas (só DynamoDB Local; veja a seção abaixo).
- Limite de 300 sem serialização entre `POST`/`restore` simultâneos.
- Ocorrências de eventos de XP sem a execução (estado legado deixado pela falha antiga) não são reconciliadas por migração; desmarcar e marcar de novo a ocorrência corrige.
- `arquitetura.json` não alterado (sem estado novo comprovado em AWS).

## Validação com DynamoDB Local

Container próprio `miupy-dynamo-habits` (`amazon/dynamodb-local`, `-inMemory -sharedDb`, `127.0.0.1:8100`), parado ao final. Nenhuma chamada à AWS.

- **Suíte completa com `DYNAMODB_TEST_ENDPOINT=http://127.0.0.1:8100`:** 270 aprovados, 0 falhas, 0 ignorados (os 10 testes de integração antes ignorados rodaram, mais 4 novos). Sem a variável: 256 aprovados, 14 ignorados.
- **Novo `dynamo-habits.integration.test.ts`** (tabela sintética própria, criada e removida): concluir duas vezes = 10 XP e um só evento; desmarcar revoga (`revokedAt`) e é idempotente; remarcar reativa o mesmo evento; desmarcar sem conclusão prévia não cria evento; pontos preservados e isolamento por proprietário; 30 rodadas de concluir/desmarcar concorrentes (90 operações, 2 respostas 409) terminam sempre com execução e XP coerentes. Nomes, aliases e condições da transação funcionam no DynamoDB real; uma mutação deliberada da expressão (alias não definido) faz os testes falharem com `ValidationException`. Nenhum bug novo apareceu no repositório.
- **Agenda (Playwright headless, 1440 e 390, API local sobre DynamoDB Local, auth e Tauri simulados no navegador, Google desligado):** o painel aparece; marcar/desmarcar atualiza o contador (0/3 → 1/3 → 0/3) e o XP (+5/−5 por hábito de prioridade baixa); com 503 ao avançar de dia, 0 checkboxes e 0 PUT; após voltar e avançar, o PUT vai para o dia visível (`2026-10-28`); erro de leitura inicial mostra o alerta e nenhum checkbox. Capturas em `../.briefs-validacao-2026-10-27/habits-shots/agenda/`.
- **Observações de baixa severidade (não corrigidas):** o painel não mostra XP (só contador n/m); estados vazio e carregando não têm indicação (o painel não é renderizado); no erro de leitura aparece "0/0" e a mensagem, sem botão para tentar de novo.
