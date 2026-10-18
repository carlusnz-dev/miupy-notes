---
name: revisar-contrato
description: Conferir impacto de mudanças na API, armazenamento, sincronização externa ou MCP do miupy-notes.
---

# Revisar contrato

1. Identifique os requisitos em `docs/requisitos/requisitos.md` e o fluxo em `docs/arquitetura/arquitetura.md`.
2. Para HTTP, confira método, caminho, payload, paginação, erros e versão em `docs/arquitetura/api.md` e no cliente Axios.
3. Para dados, confira proprietário derivado da identidade, consultas, proveniência, versão, exportação e restauração em `docs/arquitetura/dados.md`.
4. Para integração, confira consentimento, escopos, segredo, cursor, idempotência, rate limit, desconexão e política de retenção.
5. Para MCP, confira autorização, limite de resultados, confirmação de escrita e auditoria.
6. Atualize `arquitetura.json` somente com status comprovado. Registre decisão e riscos restantes.
