import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "../../api/src/core/domain/app-error.js";
import { createApp } from "../../api/src/app.js";
import { Logger } from "../../api/src/core/logging/logger.js";
import { FoldersController } from "../../api/src/modules/folders/controllers/folders.controller.js";
import { MemoryFoldersRepository } from "../../api/src/modules/folders/repository/memory-folders.repository.js";
import { createFoldersRouter } from "../../api/src/modules/folders/routes/folders.routes.js";
import { FoldersServiceImpl } from "../../api/src/modules/folders/services/folders.service.impl.js";
import { NotesController } from "../../api/src/modules/notes/controllers/notes.controller.js";
import { MemoryNotesRepository } from "../../api/src/modules/notes/repository/memory-notes.repository.js";
import { createNotesRouter } from "../../api/src/modules/notes/routes/notes.routes.js";
import { NotesServiceImpl } from "../../api/src/modules/notes/services/notes.service.impl.js";
import { createApiClient } from "../src/api-client.js";
import { createMcpServer } from "../src/server.js";

/** Tokens de teste: `token-<dono>` autentica como `<dono>`. Substitui só a verificação do ID token do Google. */
export const tokenFor = (owner: string) => `token-${owner}`;

export type TestApi = { url: string; folders: FoldersServiceImpl; notes: NotesServiceImpl; requests: { method: string; path: string; authorization?: string }[]; close: () => Promise<void> };

/** API REAL (rotas, validação, versão e isolamento por dono) com repositórios em memória; sem rede externa nem DynamoDB. */
export async function startTestApi(port = 0): Promise<TestApi> {
  const folders = new FoldersServiceImpl(new MemoryFoldersRepository());
  const notes = new NotesServiceImpl(new MemoryNotesRepository(), folders);
  const requests: TestApi["requests"] = [];
  const app = createApp({
    authenticate: (req, res, next) => {
      const token = (req.header("authorization") ?? "").replace(/^Bearer token-/, "");
      if (!token || token === req.header("authorization")) throw new AppError(401, "UNAUTHORIZED", "Autenticação necessária.");
      res.locals.principal = { ownerId: token };
      next();
    },
    notesRouter: createNotesRouter(new NotesController(notes)),
    foldersRouter: createFoldersRouter(new FoldersController(folders)),
  }, new Logger("info", () => {}));
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", path: req.url ?? "", authorization: req.headers.authorization });
    app(req, res);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta de teste indisponível.");
  return { url: `http://127.0.0.1:${address.port}`, folders, notes, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Cliente MCP ligado em memória a um servidor que fala com a API de teste usando o token dado. */
export async function connect(api: TestApi, token: string, scopes: ReadonlySet<string> | null = null) {
  const server = createMcpServer({ api: createApiClient({ baseUrl: api.url, token: () => token }), scopes, logger: () => {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "teste", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

export function parse(result: unknown): { isError: boolean; data: any } {
  const { content, isError } = result as CallToolResult;
  const first = content[0];
  if (first?.type !== "text") throw new Error("Resposta sem texto.");
  return { isError: isError === true, data: JSON.parse(first.text) };
}
