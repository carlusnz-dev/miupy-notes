import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryDraftStore } from "./notes-draft-store";
import { describeSave } from "./notes-autosave-status";
import { createSessionBinding } from "./notes-session";
import { apiError, deferred, harness, note, settle, text } from "./notes-test-kit";

test("REV-07: attach aguardando restauração rejeita troca de conta antes de aplicar loaded", async () => {
  const records = deferred<[]>();
  const store = createMemoryDraftStore();
  const h = harness({ store: { ...store, listByOwner: (owner) => owner === "u1" ? records.promise : Promise.resolve([]) } });
  const opening = h.queue.openSession("u1");
  await settle();
  const attaching = h.queue.attach(note("a", { body: "Texto privado da primeira conta" }));
  // Observa a rejeição desde o início, inclusive se a troca invalidar a operação imediatamente.
  const rejected = assert.rejects(attaching, { code: "UNAUTHORIZED" });
  await settle();
  await h.queue.openSession("u2");
  records.resolve([]);
  await Promise.all([opening, rejected]);
  assert.equal(h.queue.ownerId(), "u2");
  assert.equal(h.queue.view("a"), undefined);
  await h.clock.advance(2000);
  assert.equal(h.calls.length, 0);
});

test("REV-08: login duplicado durante leitura do dono mantém a única abertura e permite salvar", async () => {
  const h = harness();
  const owner = deferred<string | null>();
  let reads = 0;
  const binding = createSessionBinding(h.queue, () => { reads++; return owner.promise; });
  const signedIn = { status: "signed-in", error: null } as const;
  const login = binding.onAuthState(signedIn);
  await settle();
  const duplicate = binding.onAuthState(signedIn);
  owner.resolve("u1");
  await Promise.all([login, duplicate, binding.whenIdle()]);
  assert.equal(reads, 1);
  assert.equal(h.queue.ownerId(), "u1");
  await h.queue.attach(h.server.get("a")!);
  h.queue.edit("a", text("Nota a", "Edição depois do login"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.calls.length, 1);
  assert.equal(h.server.get("a")!.body, "Edição depois do login");
});

test("REV-06: retry da proteção local não antecipa Retry-After de 429", async () => {
  const memory = createMemoryDraftStore();
  let fail = false;
  const h = harness({ store: { ...memory, put: async (record) => {
    if (fail) throw new Error("Armazenamento temporariamente indisponível.");
    await memory.put(record);
  } } });
  await h.open();
  h.script.push(async () => { throw apiError("RATE_LIMITED", 429, 600_000); });
  h.queue.edit("a", text("Nota a", "Primeiro texto"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.calls.length, 1);
  const floor = h.calls[0].at + 600_000;

  fail = true;
  h.queue.edit("a", text("Nota a", "Texto mais recente"), "\n");
  await settle();
  fail = false;
  await h.clock.advance(2100);
  assert.equal((await memory.get("u1", "a"))?.draft.body, "Texto mais recente", "retry local protege sem aguardar o cooldown remoto");
  assert.equal(await h.queue.protect("a"), true);
  assert.equal(h.calls.length, 1, "nenhum PATCH durante Retry-After, mesmo depois de recuperar a escrita local");
  assert.deepEqual(h.reads, [], "429 também não pede reconciliação antes do piso");

  await h.clock.advance(floor - h.clock.now() - 1);
  assert.equal(h.calls.length, 1);
  await h.clock.advance(1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].at, floor);
  assert.equal(h.server.get("a")!.body, "Texto mais recente");
});

test("duas filas: revisão 1 da segunda não substitui a primeira nem permite PATCH sem proteção", async () => {
  const store = createMemoryDraftStore();
  const first = harness({ store });
  let secondCalls = 0;
  const second = harness({ store, deps: {
    read: async (id) => first.server.get(id)!,
    update: async (id, input) => { secondCalls++; return first.apply(id, input); },
  } });
  await first.open();
  await second.open();
  first.queue.edit("a", text("Nota a", "primeira janela"), "\n");
  assert.equal(await first.queue.protect("a"), true);
  second.queue.edit("a", text("Nota a", "segunda janela"), "\n");
  assert.equal(await second.queue.protect("a"), false);
  assert.equal(second.queue.view("a")?.error?.code, "LOCAL_DRAFT_CONFLICT");
  assert.equal(second.queue.view("a")?.snapshot?.draft.body, "segunda janela");
  assert.equal((await store.get("u1", "a"))?.draft.body, "primeira janela");
  await second.clock.advance(2000);
  assert.equal(secondCalls, 0);
  assert.match(describeSave(second.queue.view("a"), "").text, /Outro editor/);
  await first.clock.advance(1800);
  assert.equal(await store.get("u1", "a"), null);
  // Depois do ACK da primeira, retry consegue proteger a segunda, sem perda de memória.
  await second.clock.advance(5000);
  assert.equal(secondCalls, 1);
  assert.equal(second.queue.view("a")?.status, "conflict", "PATCH continua condicional contra o mesmo servidor");
  assert.equal((await store.get("u1", "a"))?.draft.body, "segunda janela");
});

test("ACK de fila restaurada não remove uma escrita posterior de outra fila", async () => {
  const store = createMemoryDraftStore();
  const seed = harness({ store });
  await seed.open();
  seed.queue.edit("a", text("Nota a", "snapshot inicial"), "\n");
  await seed.queue.protect("a");
  seed.queue.suspend();
  const first = harness({ store });
  const second = harness({ store });
  await first.open();
  await second.open();
  const gate = deferred<ReturnType<typeof note>>();
  first.script.push(() => gate.promise);
  await first.clock.advance(1800);
  second.queue.edit("a", text("Nota a", "edição posterior"), "\n");
  assert.equal(await second.queue.protect("a"), true);
  gate.resolve(note("a", { body: "snapshot inicial", version: 2 }));
  await settle();
  assert.equal((await store.get("u1", "a"))?.draft.body, "edição posterior");
  assert.equal(first.queue.view("a")?.status, "local-failed");
  assert.equal(await first.queue.protect("a"), false);
  second.queue.suspend();
});
