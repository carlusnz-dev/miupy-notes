# Contrato HTTP proposto

**Estado:** rascunho para o primeiro fluxo vertical. Apenas `GET /health` existe no template Express (verificado em servidor local em 2026-10-18: `200 {"status":"ok"}`); as rotas abaixo ainda não são montadas e respondem `404 NOT_FOUND`. Base planejada: `/v1`. JSON UTF-8. O cliente Axios está centralizado em `apps/web/src/lib/api-client.ts`; autenticação, cancelamento e tratamento de erro ainda serão implementados antes de usar dados reais.

| Método | Caminho | Objetivo |
|---|---|---|
| `GET` | `/notes?cursor=&limit=` | Listar notas do usuário, com paginação. |
| `POST` | `/notes` | Criar nota (`title`, `body`, `tags`). |
| `GET` | `/notes/{id}` | Ler nota. |
| `PATCH` | `/notes/{id}` | Atualizar nota, com controle de versão. |
| `DELETE` | `/notes/{id}` | Excluir ou marcar exclusão conforme política definida. |
| `POST` | `/exports` | Iniciar exportação de dados próprios. |
| `GET` | `/exports/{id}` | Consultar estado e obter acesso temporário ao arquivo. |
| `GET` | `/integrations` | Listar integrações e estado, sem credenciais. |

Resposta de recurso: `id`, `createdAt`, `updatedAt`, `version`, campos do recurso. Listas: `{ "items": [], "nextCursor": null }`. Datas ISO 8601 UTC; IDs opacos. Erros: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "requestId": "..." } }`; mensagem pública sem dados sensíveis. Códigos previstos: `400` validação, `401` sem autenticação, `403` sem permissão, `404` ausente, `409` conflito, `429` limite e `5xx` falha do serviço.

Antes de implementar, definir mecanismo de identidade, contrato de token, modelo de concorrência, limite de payload, idempotência e upload de anexos. Não criar rota que aceite `userId` do cliente como autoridade.
