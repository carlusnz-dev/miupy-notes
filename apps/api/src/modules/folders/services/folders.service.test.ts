import assert from "node:assert/strict";
import { test } from "node:test";
import { FolderDtoAdapter } from "../dto/adapter.js";
import { MemoryFoldersRepository } from "../repository/memory-folders.repository.js";
import { FoldersServiceImpl, MAX_DEPTH, MAX_FOLDERS } from "./folders.service.impl.js";

function setup() {
  const repository = new MemoryFoldersRepository();
  return { repository, service: new FoldersServiceImpl(repository) };
}

test("cria pastas na raiz e aninhadas, isoladas por proprietário, sem expor ownerId", async () => {
  const { service } = setup();
  const parent = await service.create("alice", { name: "Projetos", parentId: null });
  const child = await service.create("alice", { name: "2026", parentId: parent.id });
  assert.equal(child.parentId, parent.id);
  assert.equal(child.version, 1);
  assert.equal("ownerId" in FolderDtoAdapter.toOutput(child), false);

  assert.deepEqual((await service.list("alice")).map((folder) => folder.name), ["2026", "Projetos"]);
  assert.deepEqual(await service.list("bob"), []);
  await assert.rejects(service.findById("bob", parent.id), { status: 404, code: "NOT_FOUND" });
  await assert.rejects(service.create("bob", { name: "x", parentId: parent.id }), { status: 400, message: "Pasta pai inválida." });
  assert.equal(await service.exists("alice", parent.id), true);
  assert.equal(await service.exists("bob", parent.id), false);
});

test("renomear incrementa a versão e preserva o pai; versão antiga e gravação concorrente viram 409", async () => {
  const { service, repository } = setup();
  const parent = await service.create("alice", { name: "Pai", parentId: null });
  const child = await service.create("alice", { name: "A", parentId: parent.id });
  const renamed = await service.update("alice", child.id, { name: "Arquivo", version: 1 });
  assert.equal(renamed.version, 2);
  assert.equal(renamed.name, "Arquivo");
  assert.equal(renamed.parentId, parent.id, "o pai nunca muda");
  assert.equal(renamed.createdAt, child.createdAt);
  await assert.rejects(service.update("alice", child.id, { name: "Velha", version: 1 }), { status: 409, code: "CONFLICT" });
  await assert.rejects(service.update("bob", child.id, { name: "Invasão", version: 2 }), { code: "NOT_FOUND" });

  repository.update = async () => null;
  await assert.rejects(service.update("alice", parent.id, { name: "Nova", version: 1 }), { code: "CONFLICT" });
});

test("profundidade: MAX_DEPTH níveis são aceitos e o seguinte é recusado", async () => {
  const { service } = setup();
  let last = await service.create("alice", { name: "1", parentId: null });
  for (let level = 2; level <= MAX_DEPTH; level++) last = await service.create("alice", { name: String(level), parentId: last.id });
  assert.equal((await service.list("alice")).length, MAX_DEPTH, `nível ${MAX_DEPTH} (o último permitido) existe`);
  await assert.rejects(service.create("alice", { name: "fundo", parentId: last.id }), { status: 400, message: /níveis/ });
  const other = await service.create("bob", { name: "1", parentId: null });
  assert.equal((await service.create("bob", { name: "2", parentId: other.id })).parentId, other.id, "limite é por árvore, não global");
});

test("limita a quantidade de pastas por proprietário", async () => {
  const { service, repository } = setup();
  for (let index = 0; index < MAX_FOLDERS; index++) await repository.create(await service.create("alice", { name: `p${index}`, parentId: null }));
  await assert.rejects(service.create("alice", { name: "extra", parentId: null }), { status: 400, message: /Limite/ });
  assert.equal((await service.create("bob", { name: "ok", parentId: null })).name, "ok");
});
