import assert from "node:assert/strict";
import { test } from "node:test";
import { NoteDtoAdapter } from "../dto/adapter.js";
import { MemoryNotesRepository } from "../repository/memory-notes.repository.js";
import { NotesServiceImpl } from "./notes.service.impl.js";

// Pastas existentes por proprietário: o serviço só consulta a porta, sem importar o módulo de pastas.
function directory(...known: Array<[owner: string, folderId: string]>) {
  return { exists: async (owner: string, folderId: string) => known.some(([o, f]) => o === owner && f === folderId) };
}

test("service mantém isolamento por proprietário e DTO não expõe ownerId", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository(), directory());
  const created = await service.create("alice", { title: "Primeira nota", body: "texto", tags: [], folderId: null });
  assert.equal((await service.findById("alice", created.id)).id, created.id);
  await assert.rejects(service.findById("bob", created.id), { code: "NOT_FOUND" });
  assert.equal("ownerId" in NoteDtoAdapter.toOutput(created), false);
});

test("update incrementa versão, preserva campos omitidos e rejeita versão antiga", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository(), directory());
  const created = await service.create("alice", { title: "Rascunho", body: "corpo", tags: ["a"], folderId: null });
  const updated = await service.update("alice", created.id, { title: "Final", version: 1 });
  assert.equal(updated.version, 2);
  assert.equal(updated.body, "corpo");
  assert.deepEqual(updated.tags, ["a"]);
  assert.equal(updated.createdAt, created.createdAt);
  await assert.rejects(service.update("alice", created.id, { title: "Outra", version: 1 }), { status: 409, code: "CONFLICT" });
  await assert.rejects(service.update("bob", created.id, { title: "Invasão", version: 2 }), { code: "NOT_FOUND" });
});

test("conflito detectado na gravação vira 409 mesmo quando a leitura vê a versão certa", async () => {
  const repository = new MemoryNotesRepository();
  const service = new NotesServiceImpl(repository, directory());
  const created = await service.create("alice", { title: "Nota", body: "", tags: [], folderId: null });
  repository.update = async () => null;
  await assert.rejects(service.update("alice", created.id, { body: "novo", version: 1 }), { code: "CONFLICT" });
});

test("delete remove apenas a nota do proprietário", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository(), directory());
  const created = await service.create("alice", { title: "Nota", body: "", tags: [], folderId: null });
  await assert.rejects(service.delete("bob", created.id), { code: "NOT_FOUND" });
  await service.delete("alice", created.id);
  await assert.rejects(service.findById("alice", created.id), { code: "NOT_FOUND" });
});

const folderA = "0b5d6f7e-1c2a-4b3d-8e9f-a0b1c2d3e4f5";
const folderB = "1c6e7a8f-2d3b-4c4e-9fa0-b1c2d3e4f506";

test("nota nasce na raiz ou numa pasta do proprietário e pode ser movida com nova versão", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository(), directory(["alice", folderA], ["alice", folderB]));
  const root = await service.create("alice", { title: "Raiz", body: "", tags: [], folderId: null });
  assert.equal(root.folderId, null);
  const inFolder = await service.create("alice", { title: "Dentro", body: "", tags: [], folderId: folderA });
  assert.equal(inFolder.folderId, folderA);

  const moved = await service.update("alice", inFolder.id, { folderId: folderB, version: 1 });
  assert.equal(moved.folderId, folderB);
  assert.equal(moved.version, 2);
  assert.equal(moved.title, "Dentro");
  assert.equal((await service.update("alice", inFolder.id, { title: "Renomeada", version: 2 })).folderId, folderB, "omitir folderId mantém a pasta");
  assert.equal((await service.update("alice", inFolder.id, { folderId: null, version: 3 })).folderId, null);
  await assert.rejects(service.update("alice", inFolder.id, { folderId: folderA, version: 3 }), { code: "CONFLICT" });
});

test("pasta inexistente ou de outro proprietário é rejeitada sem revelar a diferença", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository(), directory(["bob", folderA]));
  await assert.rejects(service.create("alice", { title: "x", body: "", tags: [], folderId: folderA }), { status: 400, code: "VALIDATION_ERROR", message: "Pasta inválida." });
  await assert.rejects(service.create("alice", { title: "x", body: "", tags: [], folderId: folderB }), { status: 400, message: "Pasta inválida." });
  const note = await service.create("alice", { title: "x", body: "", tags: [], folderId: null });
  await assert.rejects(service.update("alice", note.id, { folderId: folderA, version: 1 }), { status: 400, message: "Pasta inválida." });
  assert.equal((await service.findById("alice", note.id)).version, 1, "movimento rejeitado não altera a nota");
});

test("corpo Markdown volta byte a byte, sem normalizar quebras de linha nem espaços", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository(), directory());
  const body = "# Título  \r\n\r\n**negrito** _it_ ~~r~~ `c`\r\n- [ ] a\r\n- [x] b\r\n\r\n```ts\nconst a = 1;\n```\n| a | b |\n|---|---|\n\ttab e emoji 🙂 e ação\u00a0\n\n";
  const created = await service.create("alice", { title: "Fiel", body, tags: [], folderId: null });
  assert.equal((await service.findById("alice", created.id)).body, body);
  assert.equal((await service.update("alice", created.id, { body: body + "x", version: 1 })).body, body + "x");
});
