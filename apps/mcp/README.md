# @miupy-notes/mcp

Servidor MCP do miupy-notes: adaptador das ferramentas de notas sobre a API HTTP (`apps/api`). Não acessa o banco. Arquitetura, ferramentas, registro nos clientes, OAuth e pendências: [`docs/arquitetura/mcp.md`](../../docs/arquitetura/mcp.md).

## Uso

```bash
npm ci
npm run test:mcp          # 21 testes contra a API real em memória (sem DynamoDB nem rede externa)
npm run build:mcp         # tsc --noEmit
npm run start --workspace @miupy-notes/mcp   # stdio; stdout é só protocolo, logs em stderr
```

Variáveis do stdio: `MIUPY_API_BASE_URL` (padrão `http://127.0.0.1:4000`), `MIUPY_API_TOKEN_FILE` (preferido) ou `MIUPY_API_TOKEN`. `npm run dev:mcp` também lê `apps/mcp/.env.local` (ignorado pelo Git). Nunca versione tokens.

## Inspeção manual

```bash
npx tsx apps/mcp/test/dev-api.ts 3112     # API real com dados em memória; token: token-dev
MIUPY_API_BASE_URL=http://127.0.0.1:3112 MIUPY_API_TOKEN=token-dev \
  npx -y -p @modelcontextprotocol/inspector@2.10.1 mcp-inspector --cli --method tools/list \
  node --import tsx apps/mcp/src/stdio.ts
```

O Inspector grava um catálogo em `~/.mcp-inspector/mcp.json` por padrão; use `MCP_CATALOG_PATH` para outro caminho. Streamable HTTP (`src/http.ts`) está preparado e testado, mas sem executável: depende da decisão de identidade pendente.
