import assert from "node:assert/strict";
import { test } from "node:test";
import { NoteDtoAdapter } from "../dto/adapter.js";
import { MemoryNotesRepository } from "../repository/memory-notes.repository.js";
import { NotesServiceImpl } from "./notes.service.impl.js";

test("service mantém isolamento por proprietário e DTO não expõe ownerId", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository());
  const created = await service.create("alice", { title: "Primeira nota", body: "texto", tags: [] });
  assert.equal((await service.findById("alice", created.id)).id, created.id);
  await assert.rejects(service.findById("bob", created.id), { code: "NOT_FOUND" });
  assert.equal("ownerId" in NoteDtoAdapter.toOutput(created), false);
});

test("update incrementa versão, preserva campos omitidos e rejeita versão antiga", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository());
  const created = await service.create("alice", { title: "Rascunho", body: "corpo", tags: ["a"] });
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
  const service = new NotesServiceImpl(repository);
  const created = await service.create("alice", { title: "Nota", body: "", tags: [] });
  repository.update = async () => null;
  await assert.rejects(service.update("alice", created.id, { body: "novo", version: 1 }), { code: "CONFLICT" });
});

test("delete remove apenas a nota do proprietário", async () => {
  const service = new NotesServiceImpl(new MemoryNotesRepository());
  const created = await service.create("alice", { title: "Nota", body: "", tags: [] });
  await assert.rejects(service.delete("bob", created.id), { code: "NOT_FOUND" });
  await service.delete("alice", created.id);
  await assert.rejects(service.findById("alice", created.id), { code: "NOT_FOUND" });
});
