# Contrato HTTP

**Estado em 2026-10-18:** o app público (`createApp`) expõe apenas `GET /health` (`200 {"status":"ok"}`); todo `/v1/notes` responde `404 NOT_FOUND` até existir verificação real de token ([decisão de identidade](../decisoes/2026-10-18_identidade.md), não implementada). As rotas de notas abaixo estão **implementadas no módulo e verificadas em testes** que montam o router com um principal falso (`apps/api/src/modules/notes/routes/notes.routes.test.ts`); não há tabela, Lambda nem API Gateway implantados. Base: `/v1`. JSON UTF-8. Cliente: `apps/web/src/lib/api-client.ts` (rejeita requisições enquanto não houver provedor de token) e `apps/web/src/lib/notes-api.ts`, tipado pelos schemas de `apps/api/src/modules/notes/contract.ts`.

## Identidade

Toda rota de `/v1` exigirá token. `ownerId` vem somente do principal autenticado (`sub` do token); o cliente nunca envia `ownerId` — corpos com campos desconhecidos são rejeitados com `400`. Notas de outro proprietário respondem `404`, sem revelar que existem.

## Notas

| Método | Caminho | Corpo / query | Sucesso | Erros |
|---|---|---|---|---|
| `GET` | `/notes` | `?limit=1..100` (padrão 20) `&cursor=` | `200` lista | `400`, `401` |
| `POST` | `/notes` | `{ title, body?, tags? }` | `201` nota | `400`, `401`, `413` |
| `GET` | `/notes/{id}` | — | `200` nota | `400` ID não-UUID, `401`, `404` |
| `PATCH` | `/notes/{id}` | `{ version, title?, body?, tags? }` (pelo menos um campo além de `version`) | `200` nota com `version + 1` | `400`, `401`, `404`, `409`, `413` |
| `DELETE` | `/notes/{id}` | — | `204` sem corpo | `400`, `401`, `404` |

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
| `401` | `UNAUTHORIZED` | sem principal |
| `403` | — | previsto: `sub` fora da lista permitida |
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

Antes de montar as rotas: middleware que converte as claims do JWT authorizer em `Principal` e aplica a lista de `sub`; idempotência de criação; política de exclusão; upload de anexos.
