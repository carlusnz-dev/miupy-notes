import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient, ToolError } from "./api-client.js";
import { log } from "./log.js";
import { createMcpServer } from "./server.js";

// stdout é exclusivo do protocolo: qualquer console.log perdido (nosso ou de dependência) iria corromper o fluxo.
console.log = console.error;
console.info = console.error;

const baseUrl = process.env.MIUPY_API_BASE_URL?.trim() || "http://127.0.0.1:4000";
const tokenFile = process.env.MIUPY_API_TOKEN_FILE?.trim();
const staticToken = process.env.MIUPY_API_TOKEN?.trim();

// O ID token do Google dura cerca de 1 hora: o arquivo é relido a cada chamada para aceitar token renovado sem reiniciar.
async function token(): Promise<string> {
  const value = tokenFile ? (await readFile(tokenFile, "utf8").catch(() => "")).trim() : staticToken;
  if (!value) throw new ToolError("UNAUTHORIZED", "Token da API ausente. Defina MIUPY_API_TOKEN_FILE (preferido) ou MIUPY_API_TOKEN.");
  return value;
}

const server = createMcpServer({ api: createApiClient({ baseUrl, token }), scopes: null });
await server.connect(new StdioServerTransport());
log("server.listening", { reason: "stdio" });
