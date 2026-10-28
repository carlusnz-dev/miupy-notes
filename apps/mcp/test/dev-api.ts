// API real com repositórios em memória para tentar o servidor MCP à mão (ex.: com o MCP Inspector).
// Uso: npx tsx test/dev-api.ts [porta]   — o token `token-<dono>` autentica como <dono>. Nada é persistido.
import { startTestApi } from "./support.js";

const api = await startTestApi(Number(process.argv[2] ?? 3112));
process.stderr.write(`API de teste em ${api.url} (token: token-dev)\n`);
