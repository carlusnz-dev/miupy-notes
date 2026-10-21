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
| `429` | — | previsto, no API Gateway |
| `500` | `INTERNAL_ERROR` | falha não tratada |

## Planejado

| Método | Caminho | Objetivo |
|---|---|---|
| `POST` | `/exports` | Iniciar exportação de dados próprios. |
| `GET` | `/exports/{id}` | Consultar estado e obter acesso temporário ao arquivo. |
| `GET` | `/integrations` | Listar integrações e estado, sem credenciais. |

Pendente: idempotência de criação; política de exclusão; upload de anexos; falha ao obter o JWKS hoje responde `500 INTERNAL_ERROR` (sem código próprio).
