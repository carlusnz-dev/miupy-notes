import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import express from "express";
import { createApp } from "../../../app.js";
import { errorHandler } from "../../../core/http/error-handler.js";
import { LibraryController } from "../controllers/library.controller.js";
import { MemoryLibraryRepository } from "../repository/memory-library.repository.js";
import { LibraryServiceImpl } from "../services/library.service.impl.js";
import { createLibraryRouter } from "./library.routes.js";
import type { LibraryItemOutput, LibraryListOutput } from "../dto/output.js";

const app = express();
app.use(express.json());
app.use((req, res, next) => { res.locals.requestId = randomUUID(); const ownerId = req.header("x-test-owner"); if (ownerId) res.locals.principal = { ownerId }; next(); });
app.use("/v1/library", createLibraryRouter(new LibraryController(new LibraryServiceImpl(new MemoryLibraryRepository()))));
app.use(errorHandler);
const server = createServer(app);
let base = "";
before(async () => { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw Error("Porta indisponível"); base = `http://127.0.0.1:${address.port}/v1/library`; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
function call(owner: string, path = "", method = "GET", body?: unknown) {
  return fetch(base + path, { method, headers: { "content-type": "application/json", ...(owner ? { "x-test-owner": owner } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status); const body = await response.json() as { error: { code: string; requestId: string } };
  assert.equal(body.error.code, code); assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
}
async function create(owner: string, input: Record<string, unknown> = {}) {
  const response = await call(owner, "", "POST", { kind: "book", title: "Uma obra", ...input });
  assert.equal(response.status, 201); return await response.json() as LibraryItemOutput;
}

test("Biblioteca exige identidade em todas as operações e não é montada sem autenticação", async () => {
  for (const [path, method, body] of [["", "GET"], ["", "POST", { kind: "book", title: "x" }], [`/${randomUUID()}`, "GET"], [`/${randomUUID()}`, "PATCH", { title: "x", version: 1 }], [`/${randomUUID()}`, "DELETE"]] as const) {
    await expectError(await call("", path, method, body), 401, "UNAUTHORIZED");
  }
  const publicServer = createServer(createApp());
  await new Promise<void>(resolve => publicServer.listen(0, "127.0.0.1", resolve));
  try { const address = publicServer.address(); if (!address || typeof address === "string") throw Error(); assert.equal((await fetch(`http://127.0.0.1:${address.port}/v1/library`)).status, 404); }
  finally { await new Promise<void>(resolve => publicServer.close(() => resolve())); }
});

test("CRUD preserva campos, limpa opcionais e aplica CAS concorrente", async () => {
  const item = await create("crud", { creator: "Autora", year: 2020, rating: 0, tags: ["ficção"], startedOn: "2026-01-01", finishedOn: "2026-02-01", comment: "Memória", externalUrl: "https://example.com/obra", coverUrl: "http://localhost/capa.png" });
  assert.equal("ownerId" in item, false); assert.equal(item.version, 1); assert.equal(item.rating, 0);
  assert.deepEqual(await (await call("crud", `/${item.id}`)).json(), item);
  const responses = await Promise.all(["A", "B"].map(title => call("crud", `/${item.id}`, "PATCH", { version: 1, title, rating: null, startedOn: null, finishedOn: null, coverUrl: null, externalUrl: null, year: null })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const saved = await (await call("crud", `/${item.id}`)).json() as LibraryItemOutput;
  assert.equal(saved.version, 2); assert.equal(saved.creator, "Autora"); assert.equal(saved.rating, null); assert.equal(saved.startedOn, null);
  assert.equal((await call("crud", `/${item.id}`, "DELETE")).status, 204);
  await expectError(await call("crud", `/${item.id}`), 404, "NOT_FOUND");
});

test("outro proprietário recebe 404 em leitura/edição/exclusão e nunca lista a obra", async () => {
  const item = await create("alice");
  for (const [method, body] of [["GET"], ["PATCH", { version: 1, title: "Roubo" }], ["DELETE"]] as const) await expectError(await call("bob", `/${item.id}`, method, body), 404, "NOT_FOUND");
  assert.deepEqual(await (await call("bob")).json(), { items: [], nextCursor: null });
  assert.equal((await call("alice", `/${item.id}`)).status, 200);
});

test("valida payload, limites, URLs, datas e queries estritas", async () => {
  for (const input of [
    { ownerId: "bob" }, { kind: "series" }, { title: " " }, { title: "a".repeat(201) }, { creator: "a".repeat(201) },
    { rating: -1 }, { rating: 5.1 }, { year: 0 }, { year: 2020.5 }, { status: "unknown" }, { comment: "a".repeat(1001) },
    { tags: Array(21).fill("a") }, { tags: ["a".repeat(41)] }, { tags: [""] },
    { externalUrl: "javascript:alert(1)" }, { coverUrl: "data:image/png;base64,AAAA" }, { coverUrl: "ftp://example.com/x" },
    { startedOn: "2026-02-30" }, { startedOn: "2026-03-01", finishedOn: "2026-02-01" },
  ]) await expectError(await call("validation", "", "POST", { kind: "book", title: "x", ...input }), 400, "VALIDATION_ERROR");
  for (const query of ["limit=0", "limit=101", "kind=series", "status=other", "tag=", "q=", "ownerId=bob", "cursor=invalid", "kind=book&kind=film"]) await expectError(await call("validation", `?${query}`), 400, "VALIDATION_ERROR");
  const item = await create("validation", { startedOn: "2026-03-01", finishedOn: "2026-04-01" });
  for (const body of [{ version: 1 }, { title: "x" }, { version: 0, title: "x" }, { version: 1, finishedOn: "2026-02-01" }, { version: 1, startedOn: "2026-05-01" }]) await expectError(await call("validation", `/${item.id}`, "PATCH", body), 400, "VALIDATION_ERROR");
  await expectError(await call("validation", "/bad-id"), 400, "VALIDATION_ERROR");
});

test("filtros combinam tipo/status/tag e busca por título sem diferenciar caixa; percorre páginas vazias", async () => {
  const owner = "filters";
  const expected = await create(owner, { title: "Uma MEMÓRIA", kind: "film", status: "completed", tags: ["favoritos"] });
  await create(owner, { title: "Outro livro" }); await create(owner, { kind: "music", title: "Outro álbum" });
  const found: string[] = []; let cursor: string | null = null; let pages = 0;
  do {
    const response = await call(owner, `?limit=1&kind=film&status=completed&tag=favoritos&q=memória${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(response.status, 200); const page = await response.json() as LibraryListOutput;
    found.push(...page.items.map(i => i.id)); cursor = page.nextCursor; pages++;
  } while (cursor);
  assert.deepEqual(found, [expected.id]); assert.equal(pages, 3);
});

test("montagem autenticada aplica lista de sub e logs guardam apenas templates", async () => {
  const { authenticate } = await import("../../../core/http/authenticate.js");
  const { Logger } = await import("../../../core/logging/logger.js");
  const lines: string[] = [];
  const log = new Logger("debug", line => { lines.push(line); }, { format: "json", color: false });
  const repository = new MemoryLibraryRepository();
  const router = createLibraryRouter(new LibraryController(new LibraryServiceImpl(repository)));
  const mounted = createServer(createApp({
    // Fonte de claims sintética apenas no teste; JWT/jose tem suíte própria.
    authenticate: authenticate(async req => ({ sub: req.header("x-test-sub") }), new Set(["private-owner"])),
    notesRouter: express.Router(), libraryRouter: router,
  }, log));
  await new Promise<void>(resolve => mounted.listen(0, "127.0.0.1", resolve));
  try {
    const address = mounted.address(); if (!address || typeof address === "string") throw Error("Porta indisponível");
    const url = `http://127.0.0.1:${address.port}/v1/library`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { "x-test-sub": "forbidden-owner" } })).status, 403);
    const created = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-test-sub": "private-owner" }, body: JSON.stringify({ kind: "book", title: "Private title" }) });
    assert.equal(created.status, 201); const item = await created.json() as LibraryItemOutput;
    const detail = await fetch(`${url}/${item.id}?q=Private-search`, { headers: { "x-test-sub": "private-owner" } });
    assert.equal(detail.status, 200); assert.ok(detail.headers.get("x-request-id"));
    const missing = await fetch(`${url}/${randomUUID()}?q=Private-search`, { headers: { "x-test-sub": "private-owner" } });
    assert.equal(missing.status, 404);
    const entries = lines.map(line => JSON.parse(line) as { route?: string });
    assert.ok(entries.some(entry => entry.route === "/v1/library/:id"));
    assert.doesNotMatch(lines.join("\n"), /Private title|Private-search|private-owner|forbidden-owner/);
    assert.ok(!lines.join("\n").includes(item.id));
  } finally { await new Promise<void>(resolve => mounted.close(() => resolve())); }
});
