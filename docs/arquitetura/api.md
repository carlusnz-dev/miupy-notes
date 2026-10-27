# Contrato HTTP

**Estado em 2026-10-18 (sessão 05):** `/v1/notes` está **montado atrás de autenticação** na API local (`apps/api/src/server.ts`, Express em `127.0.0.1:4000`, DynamoDB Local) e no handler Lambda (`src/lambda.ts`, não implantado). Sem configuração de identidade, `createApp()` não monta `/v1` (responde `404`). Verificado em testes (`notes.auth.test.ts`, chaves geradas no teste) e com o login Google real do proprietário pela janela Tauri: a nota foi criada pela API local. Não há tabela, Lambda nem API Gateway na AWS. Base: `/v1`. JSON UTF-8. Cliente: `apps/web/src/lib/api-client.ts` (só envia com provedor de token) e `apps/web/src/lib/notes-api.ts` (`listNotes`, `listNotesMetadata`, `getNotesSummary`, `createNote`, `getNote`, `updateNote`, `deleteNote`), tipado pelos schemas de `apps/api/src/modules/notes/contract.ts`.

## Identidade

Toda rota de `/v1` exige `Authorization: Bearer <ID token do Google>`. A API local valida com `jose` contra o JWKS do Google (`https://www.googleapis.com/oauth2/v3/certs`): assinatura RS256, `iss` em `https://accounts.google.com` ou `accounts.google.com`, `aud` = `GOOGLE_CLIENT_ID` e `exp`. Em produção, a Lambda lê `requestContext.authorizer.jwt.claims` (ponto de troca: `ClaimsSource` em `apps/api/src/core/http/authenticate.ts`). Nos dois casos, `ownerId` = `sub`, e só os `sub` de `ALLOWED_SUBS` (lista separada por vírgula, fora do Git) passam; lista vazia nega todos. O login real emitiu `iss` = `https://accounts.google.com`.

`ownerId` vem somente do principal autenticado; o cliente nunca envia `ownerId` — corpos com campos desconhecidos são rejeitados com `400`. Notas de outro proprietário respondem `404`, sem revelar que existem.

## Notas

| Método | Caminho | Corpo / query | Sucesso | Erros |
|---|---|---|---|---|
| `GET` | `/notes` | `?limit=1..100` (padrão 20) `&cursor=` | `200` lista | `400`, `401`, `403` |
| `GET` | `/notes/metadata` | `?limit=1..100` (padrão 20) `&cursor=` | `200` lista sem corpo | `400`, `401`, `403` |
| `GET` | `/notes/summary` | `?days=7\|30\|90` (padrão 30) `&offsetMinutes=-840..840` (padrão 0) | `200` resumo | `400`, `401`, `403` |
| `POST` | `/notes` | `{ title, body?, tags?, folderId? }` | `201` nota | `400`, `401`, `403`, `413` |
| `GET` | `/notes/{id}` | — | `200` nota | `400` ID não-UUID, `401`, `403`, `404` |
| `PATCH` | `/notes/{id}` | `{ version, title?, body?, tags?, folderId? }` (pelo menos um campo além de `version`) | `200` nota com `version + 1` | `400`, `401`, `403`, `404`, `409`, `413` |
| `DELETE` | `/notes/{id}` | — | `204` sem corpo | `400`, `401`, `403`, `404` |

- **Campos:** `title` 1–200 caracteres após `trim`; `body` Markdown até 100 000 caracteres (padrão `""`); `tags` até 20 itens de 1–40 caracteres (padrão `[]`). Corpo HTTP até 256 kB.
- **Pasta da nota:** `folderId` é o UUID de uma pasta do próprio proprietário ou `null` (raiz, padrão). No `PATCH`, `null` move para a raiz e omitir mantém a pasta; mover incrementa `version`. Pasta inexistente ou de outro proprietário responde `400 VALIDATION_ERROR` ("Pasta inválida."), sem revelar a diferença. Notas gravadas antes das pastas não têm o atributo e leem como `folderId: null`.
- **Nota:** `{ id, title, body, tags, folderId, createdAt, updatedAt, version }`. `id` UUID; datas ISO 8601 UTC; `version` inteiro ≥ 1. `ownerId` nunca aparece na resposta.
- **Lista:** `{ "items": [...], "nextCursor": "..." | null }`. O cursor é opaco; repita a chamada com ele até `nextCursor` ser `null`. A ordem é estável por ID, **não cronológica** (sem índice por data ainda). A última página pode vir vazia.
- **Concorrência:** `PATCH` envia a `version` lida. Se outra gravação ocorreu, responde `409 CONFLICT`; o cliente deve recarregar a nota. A verificação é atômica no DynamoDB (escrita condicional).
- **Corpo:** devolvido exatamente como gravado (sem `trim`, sem normalizar quebras de linha). O editor web converte `\r\n` para `\n` ao editar e restaura o estilo original ao gravar.
- **Exclusão:** física. Ainda não há lixeira nem política de retenção em backup.
- **Ainda não suportado:** links entre notas (parte do RF-01), idempotência de `POST` (repetir a requisição cria outra nota), busca e filtro por tag.

### Metadados e resumo (sessão 07)

`GET /notes` conserva a resposta completa para compatibilidade. Árvore/lista web usam `GET /notes/metadata`: `{ items: [{ id, title, tags, folderId, createdAt, updatedAt, version }], nextCursor }`, sem `body` ou `ownerId`. Mesmo limite, cursor opaco, ordem crescente por ID e isolamento da listagem completa; nenhum filtro novo. `GET /notes/{id}` continua trazendo o corpo exato e usa leitura consistente no DynamoDB para reconciliar uma gravação ambígua. Leitura consistente não impede uma gravação concorrente posterior; `PATCH` continua condicional e pode responder `409`.

Home e Perfil usam `GET /notes/summary`. A query é estrita: parâmetros desconhecidos (inclusive `ownerId`), período diferente de 7/30/90 e offset fora do intervalo retornam `400 VALIDATION_ERROR`. `offsetMinutes` é inteiro, minutos **a leste de UTC** (`-new Date().getTimezoneOffset()` no cliente). O período inclui o dia atual do servidor nesse offset e os dias anteriores. É um offset fixo para toda a janela, sem histórico de horário de verão.

```json
{
  "total": 1, "words": 3, "characters": 13, "averageWords": 3,
  "first": "2026-10-20T12:00:00.000Z", "last": "2026-10-20T12:00:00.000Z",
  "windowDays": 7, "createdInWindow": 1,
  "createdPerDay": [{ "date": "2026-10-14", "count": 0 }, { "date": "2026-10-15", "count": 0 }, { "date": "2026-10-16", "count": 0 }, { "date": "2026-10-17", "count": 0 }, { "date": "2026-10-18", "count": 0 }, { "date": "2026-10-19", "count": 0 }, { "date": "2026-10-20", "count": 1 }],
  "tags": [{ "tag": "ideias", "count": 1 }],
  "topNotes": [{ "title": "Exemplo", "words": 3 }]
}
```

Os totais de notas, palavras, caracteres, tags e datas são globais do proprietário; `days` restringe somente `createdInWindow`/`createdPerDay`. Dias vazios vêm zerados. Palavras são sequências Unicode de letras/números, admitindo apóstrofo/hífen internos; Markdown não é renderizado para contar. Caracteres seguem `String.length` (unidades UTF-16), como o Perfil anterior; média arredondada para inteiro. Tags contam ocorrências exatas (duplicatas de uma mesma nota continuam contando, por compatibilidade), ordenadas por frequência decrescente e nome pt-BR. `topNotes` traz até dez títulos por palavras decrescentes e título pt-BR; não inclui corpo. `first`/`last` são as datas de criação extremas, `null` no acervo vazio.

O resumo percorre todas as páginas de 100 itens no backend, sem o teto de 5.000 do antigo cliente e sem reter todos os corpos em memória. **Não há totais materializados, índice novo ou redução garantida de leituras/RCUs**: a agregação ainda lê os corpos no DynamoDB, com custo e latência proporcionais ao acervo, e pode falhar por limites operacionais em coleções grandes em vez de devolver total parcial. Listagem e resumo mantêm consistência eventual e não são um snapshot transacional entre páginas. Metadados usam `ProjectionExpression` para reduzir tráfego, sem diminuir por si só capacidade consumida, conforme a [documentação DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ProjectionExpressions.html). O detalhe consistente usa mais capacidade que a leitura eventual equivalente; justificativa e semântica na [documentação de consistência](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html).

No cliente, `cacheSavedNote` atualiza detalhe e metadados das páginas já conhecidas, preservando cursores, `pageParams` e indicador de truncamento. Não insere registros em páginas desconhecidas nem escreve nos drafts. PATCH não invalida a coleção sem filtros atual: a ordem da API é por ID imutável e a árvore reordena títulos/pastas localmente. Mudança de corpo/título/tags invalida os resumos (somente resumos ativos refazem GET); mover pasta com base conhecida não altera métricas. Criar/excluir invalida listagens e resumos; versões atrasadas e respostas após exclusão confirmada são descartadas no cache. Guards de sessão da fila e das mutações continuam obrigatórios. A árvore conserva teto explícito de 5.000 metadados com aviso de truncamento; métricas não dependem dele.

## Pastas

Organizam as notas em árvore (RF-01). Mesma autenticação e isolamento das notas; ficam na mesma tabela (`sk = FOLDER#<id>`). Cliente: `apps/web/src/lib/notes-folders-api.ts`, tipado por `apps/api/src/modules/folders/contract.ts`.

| Método | Caminho | Corpo | Sucesso | Erros |
|---|---|---|---|---|
| `GET` | `/folders` | — | `200 { items: [...] }` (todas, por nome) | `401`, `403` |
| `POST` | `/folders` | `{ name, parentId? }` | `201` pasta | `400`, `401`, `403`, `413` |
| `PATCH` | `/folders/{id}` | `{ version, name }` | `200` pasta com `version + 1` | `400`, `401`, `403`, `404`, `409` |

- **Pasta:** `{ id, name, parentId, createdAt, updatedAt, version }`; `name` 1–100 caracteres após `trim`; `parentId` UUID ou `null` (raiz), fixado na criação.
- **Limites:** até 500 pastas por proprietário e 8 níveis (`400 VALIDATION_ERROR`). Pai inexistente ou de outro proprietário é `400`.
- **Sem mover nem excluir pastas (decisão desta etapa):** `PATCH` aceita só `name` (`parentId` é campo desconhecido → `400`) e não existe `DELETE`. Assim o pai nunca muda e a pasta nunca some: não há ciclo, órfã nem corrida entre "pasta vazia" e criação de nota/subpasta. Mover/excluir exigem transação (hoje o DynamoDB não garante, entre a checagem e a escrita, que ninguém criou nota ou subpasta): desenho previsto é um item de versão da árvore por proprietário mais contador de notas por pasta, gravados com `TransactWriteItems`. Até lá, pasta criada por engano só pode ser renomeada.
- **Notas entre pastas:** mover nota (`PATCH /notes/{id}` com `folderId`) é seguro porque pastas não são excluídas; ele valida a pasta do próprio proprietário e incrementa `version` da nota.
- **Concorrência:** `version` como nas notas (`409` se divergir; gravação condicional). Nomes duplicados entre irmãs são aceitos.

## Finanças e agendas

Contratos completos: [finanças](api-finance.md) e [agenda](api-calendar.md). Notas, pastas, finanças e Calendar compartilham a autenticação de `/v1`; proprietário vem exclusivamente do principal.

Finanças incluem `/finance/accounts` (listar/criar), `/finance/accounts/{id}` (ler/editar com versão) e `/finance/balances`. Referência manual, movimentos e moedas permanecem separados; sem Pluggy ou outbox financeira.

Calendar inclui CRUD versionado em `/calendar/events`, criação idempotente por UUID enviado pelo cliente, eventos com hora/fuso ou dia inteiro e relações com notas/eventos. `/calendar/google` informa estado e as rotas de connection/sync/reflection ficam atrás de portas autorizadas. Na composição padrão e na Lambda, Google permanece **not_configured**. A API local Linux permite opt-in `login-keyring`: o login único do Tauri já pede o Calendar e a API lê o refresh token do login, sem segundo OAuth; não há conta/chaveiro/consentimento nativo real verificado. Modo de escrita consentida permite alterar/excluir espelhos com ETag/PATCH e enviar cópias locais. A carga inicial cobre 30 dias passados e 366 futuros, com sync incremental sob demanda. A serialização conectar/desconectar é somente por processo local; não há cofre AWS ou garantia distribuída. Tarefas (`/calendar/tasks`, título, descrição, prazo, pendente/concluída, CRUD versionado e criação idempotente) vivem no mesmo módulo; a cópia no Google Tasks existe só como porta testada com fakes e está desligada (exige escopo e API que o proprietário ainda não autorizou). Detalhes, payloads e limites no contrato dedicado.

`429 RATE_LIMITED` e `502 UPSTREAM_UNAVAILABLE` podem incluir `Retry-After` em segundos (arredondamento para cima), exposto por `Access-Control-Expose-Headers`; o envelope JSON não muda. O prazo do Google não é reduzido ao teto do backoff; na outbox vale também para a revisão escrita durante o envio.

## Erros

Toda resposta produzida pelo app Express inclui `X-Request-Id`, um UUID gerado pelo servidor (não aceita o valor enviado pelo cliente). Em erros, ele coincide com `error.requestId`. Use esse identificador para correlacionar a interface aos logs da API (texto legível por padrão, JSON opcional via LOG_FORMAT=json). Rotas, status e envelopes existentes permanecem compatíveis. O log de conclusão inclui método, template da rota, status e duração; falhas incluem classificação técnica sem corpo, token ou identidade. `LOG_LEVEL=debug` habilita eventos de início; o padrão é `info`. Configuração e exemplos em [apps/api/README.md](../../apps/api/README.md).

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Dados inválidos.", "requestId": "uuid" } }
```

Mensagem pública sem dados sensíveis; `requestId` presente em todos os erros, inclusive JSON malformado.

| Status | `code` | Quando |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Zod, ID não-UUID, cursor inválido, campo desconhecido, JSON malformado |
| `401` | `UNAUTHORIZED` | token ausente, malformado, de outra chave, sem assinatura, expirado, `aud` ou `iss` errados |
| `403` | `FORBIDDEN` | `sub` fora de `ALLOWED_SUBS` (todas as rotas de `/v1`) |
| `404` | `NOT_FOUND` | rota inexistente ou nota ausente/de outro proprietário |
| `409` | `CONFLICT` | `version` divergente |
| `413` | `PAYLOAD_TOO_LARGE` | corpo acima de 256 kB |
| `429` | `RATE_LIMITED` | limite do provedor Calendar; throttling do API Gateway depende de implantação |
| `500` | `INTERNAL_ERROR` | falha não tratada, inclusive falha ao obter as chaves do Google para validar o ID token (timeout, rede ou resposta não-200 do JWKS); o motivo vai ao log, não à resposta |
| `503` | `CREDENTIAL_STORE_UNAVAILABLE` | chaveiro do login indisponível para o Calendar local |

## Planejado

| Método | Caminho | Objetivo |
|---|---|---|
| `POST` | `/exports` | Iniciar exportação de dados próprios. |
| `GET` | `/exports/{id}` | Consultar estado e obter acesso temporário ao arquivo. |
| `GET` | `/integrations` | Listar integrações e estado, sem credenciais. |

Pendente: idempotência de criação; política de exclusão; upload de anexos; falha ao obter o JWKS responde `500 INTERNAL_ERROR` (sem código próprio; resposta não-200 do JWKS deixou de virar `401`).

## Biblioteca

CRUD autenticado `/v1/library`, com versão condicional, isolamento por proprietário, filtros combinados e paginação por cursor. Campos, limites, erros e páginas filtradas vazias estão em [api-library.md](api-library.md). Composto na API local e Lambda não implantada; testes sintéticos em memória e cliente DynamoDB falso, sem AWS; persistência em tabela DynamoDB Local sintética verificada.

## Hábitos

**Estado em 2026-10-26.** `/v1/habits`, mesma autenticação e isolamento de `/v1` (`ownerId` só do principal; corpos e queries com campo desconhecido → `400`; recurso de outro proprietário → `404`). Cliente: `apps/web/src/lib/habits-api.ts`, tipado por `apps/api/src/modules/habits/contract.ts`. Composto na API local e na Lambda (não implantada); testado só com repositório em memória e cliente DynamoDB falso, sem AWS.

**Hábito × ocorrência.** O *hábito* é o cadastro (gravado). A *ocorrência* é um hábito numa data e **não é gravada**: a API a deriva da recorrência. Só a conclusão é gravada (uma execução por hábito+data); concluir uma ocorrência não altera as outras nem o cadastro.

**Datas locais.** `startDate`, `endDate`, `date`, `from`, `to`, `until`, `on` são datas de calendário `AAAA-MM-DD` do usuário e `time` é relógio local `HH:MM`. O servidor não converte instantes nem usa fuso: a recorrência é aritmética de dias inteiros (vira mês, ano e bissexto corretamente; horário de verão não interfere). O cliente envia a data local que está vendo (`todayLocal()`). Ao concluir, o servidor só recusa datas além de UTC+1 dia (fuso mais adiantado, +14 h); datas passadas são aceitas.

| Método | Caminho | Corpo / query | Sucesso | Erros |
|---|---|---|---|---|
| `GET` | `/habits` | `?trash=true\|false` (padrão `false`) | `200 { items }` por título | `400`, `401`, `403` |
| `POST` | `/habits` | `{ title, recurrence, startDate, description?, kind?, priority?, endDate?, time? }` | `201` hábito | `400`, `401`, `403`, `413` |
| `GET` | `/habits/{id}` | — | `200` hábito (inclui na lixeira) | `400`, `401`, `403`, `404` |
| `PATCH` | `/habits/{id}` | `{ version, …campos }` (pelo menos um) | `200` com `version + 1` | `400`, `404`, `409` |
| `POST` | `/habits/{id}/pause` | `{ version, from, until? }` | `200` hábito | `400`, `404`, `409` |
| `POST` | `/habits/{id}/resume` | `{ version, on }` | `200` hábito | `400`, `404`, `409` |
| `DELETE` | `/habits/{id}` | — | `200` hábito com `deletedAt`/`purgeAfter` | `400`, `404`, `409` |
| `POST` | `/habits/{id}/restore` | — | `200` hábito | `400`, `404`, `409` |
| `GET` | `/habits/occurrences` | `?from=&to=` (até 62 dias) | `200 { items }` | `400`, `401`, `403` |
| `PUT` | `/habits/{id}/occurrences/{date}` | `{ status: "completed"\|"pending" }` | `200` ocorrência | `400`, `404`, `409` |
| `GET` | `/habits/history` | `?from=&to=` (até 366 dias) | `200 { items }` | `400`, `401`, `403` |
| `GET` | `/habits/xp` | — | `200` saldo | `401`, `403` |
| `GET` | `/habits/settings` | — | `200` configuração | `401`, `403` |

- **Hábito:** `{ id, title (1–200), description (≤1000, padrão ""), kind: health|study|work|personal|other (padrão other), priority: low|medium|high (padrão medium), recurrence, startDate, endDate|null, time|null, pauses, deletedAt|null, purgeAfter|null, createdAt, updatedAt, version }`. Até 300 hábitos fora da lixeira por proprietário: só eles contam, então excluir libera uma vaga; `POST` acima do limite responde `400` e `restore` que ultrapassaria o limite responde `409` (a lixeira não conta, mas restaurar consome uma vaga).
- **Recorrência** (união discriminada por `type`, extensível com novos tipos): `{type:"daily", every:1..365}` (a cada N dias desde `startDate`), `{type:"weekly", every:1..52}` (mesmo dia da semana de `startDate`, a cada N semanas), `{type:"weekdays", days:[0..6]}` (0 = domingo, sem repetição). Ocorre em `startDate ≤ data ≤ endDate` (`endDate` opcional) e fora das pausas.
- **Pausa:** `pauses` é lista de janelas `{ from, until|null }` valendo em `[from, until)`; `until: null` = até retomar. `pause` acrescenta uma janela (`until` > `from`); `resume` com `on` fecha em `on` as janelas ainda vigentes e descarta as que começariam depois (`409` se não há pausa). Datas pausadas não geram ocorrência nem aceitam conclusão; conclusões já gravadas permanecem.
- **Ocorrência:** `{ habitId, date, time, title, kind, priority, status: completed|pending, completedAt|null, points }`, ordenada por data, horário (sem horário por último) e título. `PUT` exige que o hábito tenha ocorrência naquela data (`400` caso contrário), é idempotente e `pending` desfaz a conclusão. Hábito na lixeira não aparece na listagem de ocorrências; `PUT`, `PATCH` e pausa respondem `409` (e `404` depois de vencido o prazo).
- **Exclusão lógica:** `DELETE` grava `deletedAt` e `purgeAfter = deletedAt + 30 dias` (persistidos), sem apagar nada; `restore` limpa os dois. Passado `purgeAfter` o hábito deixa de existir para a API (`404`), mesmo antes do expurgo físico. A remoção física do cadastro é `HabitsService.purgeExpired(ownerId)`, **ainda sem agendador**: a rotina periódica (SQS/EventBridge) foi adiada com a infraestrutura AWS. Ela apaga só o item `HABIT#`; execuções e XP ficam.
- **Histórico:** `GET /history` lista as execuções concluídas `{ habitId, date, completedAt, title, kind, priority }`, com retrato do hábito no momento da conclusão, e continua completo depois do expurgo do cadastro.
- **XP (fundação):** cada conclusão cria um evento `(hábito, data, "completion")` com chave determinística e escrita condicional: repetir não duplica. Pontos pela prioridade: baixa 5, média 10, alta 15. Desmarcar preenche `revokedAt` no mesmo evento (compensação); marcar de novo o reativa. A execução e o evento mudam **na mesma operação atômica** (`TransactWriteItems` no DynamoDB; o repositório em memória tem a mesma semântica): concluir regrava a execução e faz upsert do evento (conserva `points`/`createdAt`, zera `revokedAt`); desmarcar apaga a execução e compensa o evento, sob a condição de ele existir ou de continuar ausente. Uma falha deixa os dois como estavam; transação concorrente na mesma ocorrência responde `409`. Sem penalidade. `GET /xp` devolve `{ totalXp, level, levelXp, nextLevelXp, completions, achievements: [{ id, title, unlocked }] }`: nível = `⌊XP/100⌋ + 1`, conquistas (`first_completion`, `ten_completions`, `level_5`) derivadas do saldo num registro extensível, nada gravado. Tudo no backend.
- **Google Calendar:** `GET /settings` → `{ googleCalendar: { enabled, available } }`. `enabled` vem de `HABITS_GOOGLE_CALENDAR=true` (padrão desligado); `available` é sempre `false`: não existe adaptador e nenhuma chamada ao Google é feita.
- **Agenda interna:** a página Agendas mostra as ocorrências do dia em foco (painel "Hábitos do dia") lendo `GET /habits/occurrences`; os hábitos não viram eventos do módulo de agenda.
- **Armazenamento:** mesma tabela, sempre `pk = USER#<ownerId>`: `HABIT#<id>`, `HLOG#<data>#<hábito>` (intervalo por `BETWEEN`) e `HXP#<hábito>#<data>#completion`. Só `Query`, sem `Scan` nem índice novo.
- **Erros internos:** validação da entrada do cliente é `400`. Item armazenado ou resposta que não passa no próprio schema é corrupção ou bug: `500 INTERNAL_ERROR` genérico, com log de serviço, operação, origem e tipo da causa, sem o conteúdo do dado.
- **Limites conhecidos:** o limite de 300 é verificado antes de gravar, sem serialização entre `POST`/`restore` simultâneos (pode passar de 300 por corrida). Conclusões de datas passadas não têm limite. O campo `aiAssisted` das notas ficou **adiado** (tocaria entidade, repositório, DTOs e rascunho local das notas).
