# Contrato HTTP

**Estado em 2026-10-18 (sessão 05):** `/v1/notes` está **montado atrás de autenticação** na API local (`apps/api/src/server.ts`, Express em `127.0.0.1:4000`, DynamoDB Local) e no handler Lambda (`src/lambda.ts`, não implantado). Sem configuração de identidade, `createApp()` não monta `/v1` (responde `404`). Verificado em testes (`notes.auth.test.ts`, chaves geradas no teste) e com o login Google real do proprietário pela janela Tauri: a nota foi criada pela API local. Não há tabela, Lambda nem API Gateway na AWS. Base: `/v1`. JSON UTF-8. Cliente: `apps/web/src/lib/api-client.ts` (só envia com provedor de token) e `apps/web/src/lib/notes-api.ts` (`listNotes`, `createNote`, `getNote`, `updateNote`, `deleteNote`), tipado pelos schemas de `apps/api/src/modules/notes/contract.ts`.

## Identidade

Toda rota de `/v1` exige `Authorization: Bearer <ID token do Google>`. A API local valida com `jose` contra o JWKS do Google (`https://www.googleapis.com/oauth2/v3/certs`): assinatura RS256, `iss` em `https://accounts.google.com` ou `accounts.google.com`, `aud` = `GOOGLE_CLIENT_ID` e `exp`. Em produção, a Lambda lê `requestContext.authorizer.jwt.claims` (ponto de troca: `ClaimsSource` em `apps/api/src/core/http/authenticate.ts`). Nos dois casos, `ownerId` = `sub`, e só os `sub` de `ALLOWED_SUBS` (lista separada por vírgula, fora do Git) passam; lista vazia nega todos. O login real emitiu `iss` = `https://accounts.google.com`.

`ownerId` vem somente do principal autenticado; o cliente nunca envia `ownerId` — corpos com campos desconhecidos são rejeitados com `400`. Notas de outro proprietário respondem `404`, sem revelar que existem.

## Notas

| Método | Caminho | Corpo / query | Sucesso | Erros |
|---|---|---|---|---|
| `GET` | `/notes` | `?limit=1..100` (padrão 20) `&cursor=` | `200` lista | `400`, `401`, `403` |
| `POST` | `/notes` | `{ title, body?, tags? }` | `201` nota | `400`, `401`, `403`, `413` |
| `GET` | `/notes/{id}` | — | `200` nota | `400` ID não-UUID, `401`, `403`, `404` |
| `PATCH` | `/notes/{id}` | `{ version, title?, body?, tags? }` (pelo menos um campo além de `version`) | `200` nota com `version + 1` | `400`, `401`, `403`, `404`, `409`, `413` |
| `DELETE` | `/notes/{id}` | — | `204` sem corpo | `400`, `401`, `403`, `404` |

- **Campos:** `title` 1–200 caracteres após `trim`; `body` Markdown até 100 000 caracteres (padrão `""`); `tags` até 20 itens de 1–40 caracteres (padrão `[]`). Corpo HTTP até 256 kB.
- **Nota:** `{ id, title, body, tags, createdAt, updatedAt, version }`. `id` UUID; datas ISO 8601 UTC; `version` inteiro ≥ 1. `ownerId` nunca aparece na resposta.
- **Lista:** `{ "items": [...], "nextCursor": "..." | null }`. O cursor é opaco; repita a chamada com ele até `nextCursor` ser `null`. A ordem é estável por ID, **não cronológica** (sem índice por data ainda). A última página pode vir vazia.
- **Concorrência:** `PATCH` envia a `version` lida. Se outra gravação ocorreu, responde `409 CONFLICT`; o cliente deve recarregar a nota. A verificação é atômica no DynamoDB (escrita condicional).
- **Exclusão:** física. Ainda não há lixeira nem política de retenção em backup.
- **Ainda não suportado:** links entre notas (parte do RF-01), idempotência de `POST` (repetir a requisição cria outra nota), busca e filtro por tag.

## Erros

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
