import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createApiClient } from "../src/api-client.js";
import { createMcpServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parse } from "./support.js";

// Opt-in: roda só com MIUPY_API_URL (e MIUPY_ID_TOKEN para os testes autenticados) no ambiente.
const apiUrl = process.env.MIUPY_API_URL?.trim().replace(/\/$/, "");
const idToken = process.env.MIUPY_ID_TOKEN?.trim();
const skipRemote = apiUrl ? false : "defina MIUPY_API_URL para testar a API remota";
const skipAuth = !apiUrl ? skipRemote : idToken ? false : "defina MIUPY_ID_TOKEN para o CRUD autenticado";

async function mcpClient(token: string) {
  const server = createMcpServer({ api: createApiClient({ baseUrl: apiUrl!, token: () => token }), scopes: null, logger: () => {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "teste-remoto", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const createdIds: string[] = [];
// O MCP não tem exclusão: a limpeza usa a própria API, com o mesmo token, só para notas criadas aqui.
after(async () => {
  for (const id of createdIds) await fetch(`${apiUrl}/v1/notes/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${idToken}` } }).catch(() => undefined);
});

test("API remota: /health responde ok sem token", { skip: skipRemote }, async () => {
  const response = await fetch(`${apiUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("API remota: sem token válido, a ferramenta devolve UNAUTHORIZED (401)", { skip: skipRemote }, async () => {
  const raw = await fetch(`${apiUrl}/v1/notes/metadata`);
  assert.equal(raw.status, 401);
  const client = await mcpClient("invalid-token");
  const result = parse(await client.callTool({ name: "folders_list", arguments: {} }));
  assert.equal(result.isError, true);
  assert.equal(result.data.error.code, "UNAUTHORIZED");
  assert.doesNotMatch(JSON.stringify(result.data), /invalid-token/);
});

test("API remota: cria, lê, atualiza e busca uma nota", { skip: skipAuth }, async () => {
  const client = await mcpClient(idToken!);
  const marker = `mcp-integracao-${Date.now()}`;
  const created = parse(await client.callTool({ name: "notes_create", arguments: { title: marker, body: "# teste", tags: ["mcp-teste"] } }));
  assert.equal(created.isError, false);
  const id = created.data.note.id as string;
  createdIds.push(id);

  const read = parse(await client.callTool({ name: "notes_get", arguments: { noteId: id } }));
  assert.equal(read.data.note.body, "# teste");

  const updated = parse(await client.callTool({ name: "notes_update", arguments: { noteId: id, expectedVersion: read.data.note.version, body: "# revisado" } }));
  assert.equal(updated.isError, false);

  const stale = parse(await client.callTool({ name: "notes_update", arguments: { noteId: id, expectedVersion: read.data.note.version, body: "# velho" } }));
  assert.equal(stale.data.error.code, "CONFLICT");

  const found = parse(await client.callTool({ name: "notes_search", arguments: { query: marker } }));
  assert.ok(found.data.items.some((note: { id: string }) => note.id === id));
});
