import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerIdFromToken } from "./id-token";
import { createSessionBinding } from "./notes-session";
import { harness, text } from "./notes-test-kit";

const token = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

test("o dono da conta vem do `sub` do ID token", () => {
  assert.equal(ownerIdFromToken(token({ sub: "123", email: "a@b.c" })), "123");
  assert.equal(ownerIdFromToken(token({ email: "a@b.c" })), null);
  assert.throws(() => ownerIdFromToken("sem-pontos"));
});

function setup() {
  const h = harness();
  let owner = "u1";
  const binding = createSessionBinding(h.queue, async () => owner);
  return { h, binding, setOwner: (next: string) => { owner = next; } };
}
const signedIn = { status: "signed-in", error: null } as const;

test("entrar restaura os rascunhos da conta; sessão expirada pausa; a mesma conta retoma", async () => {
  const { h, binding } = setup();
  await h.store.put({ ownerId: "u1", noteId: "b", draft: text("Nota b", "guardado"), eol: "\n", base: h.server.get("b")!, revision: 3, savedAt: 0 });
  await binding.onAuthState(signedIn);
  assert.equal(h.queue.unsyncedCount(), 1);
  h.queue.suspend();
  await binding.onAuthState({ status: "signed-out", error: "Sua sessão terminou." });
  assert.equal(h.queue.isPaused(), true);
  assert.equal(h.queue.unsyncedCount(), 1, "sessão expirada não apaga nada");
  await binding.onAuthState(signedIn);
  await h.clock.advance(2000);
  assert.equal(h.server.get("b")!.body, "guardado");
  assert.equal(h.memory.records.size, 0);
});

test("sair por escolha apaga os rascunhos da conta; transições que não são saída não mexem na fila", async () => {
  const { h, binding } = setup();
  await h.store.put({ ownerId: "u1", noteId: "b", draft: text("Nota b", "x"), eol: "\n", base: h.server.get("b")!, revision: 1, savedAt: 0 });
  await h.store.put({ ownerId: "u2", noteId: "b", draft: text("Nota b", "de u2"), eol: "\n", base: h.server.get("b")!, revision: 1, savedAt: 0 });
  await binding.onAuthState({ status: "signed-out", error: null });
  assert.equal(h.memory.records.size, 2, "deslogado desde o início: nada acontece");
  await binding.onAuthState(signedIn);
  await binding.onAuthState({ status: "signed-out", error: null });
  assert.equal(h.queue.ownerId(), null);
  assert.deepEqual([...h.memory.records.values()].map((r) => r.ownerId), ["u2"], "só a conta que saiu é limpa");
});

test("outra conta depois de uma sessão expirada nunca vê nem envia o rascunho da primeira", async () => {
  const { h, binding, setOwner } = setup();
  await binding.onAuthState(signedIn);
  await h.queue.attach(h.server.get("a")!);
  h.queue.edit("a", text("Nota a", "privado"), "\n");
  await h.queue.protect("a");
  await binding.onAuthState({ status: "signed-out", error: "Sua sessão terminou." });
  setOwner("u2");
  await binding.onAuthState(signedIn);
  assert.equal(h.queue.unsyncedCount(), 0);
  assert.equal((await h.queue.attach(h.server.get("a")!)).restored, null);
  await h.clock.advance(120_000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.server.get("a")!.body, "");
});

import { deferred, settle } from "./notes-test-kit";
import { signOutNeedsConfirmation } from "./notes-session";
import { createMemoryDraftStore } from "./notes-draft-store";

test("logout que chega enquanto o dono ainda é lido: a sessão antiga nunca abre", async () => {
  const owner = deferred<string | null>();
  const events: string[] = [];
  const fake = { openSession: async (o: string) => { events.push(`open:${o}`); }, closeSession: async () => { events.push("close"); return { purged: true }; }, suspend: () => { events.push("suspend"); } };
  const binding = createSessionBinding(fake as never, () => owner.promise);
  const login = binding.onAuthState(signedIn);
  await settle();
  const logout = binding.onAuthState({ status: "signed-out", error: null });
  assert.deepEqual(events, ["close"], "a fila é fechada assim que o estado chega, antes de qualquer await");
  owner.resolve("old-owner");
  await Promise.all([login, logout]);
  assert.deepEqual(events, ["close"]);
});

test("expiração durante a leitura do dono suspende na hora e não abre sessão", async () => {
  const owner = deferred<string | null>();
  const events: string[] = [];
  const fake = { openSession: async (o: string) => { events.push(`open:${o}`); }, closeSession: async () => ({ purged: true }), suspend: () => { events.push("suspend"); } };
  const binding = createSessionBinding(fake as never, () => owner.promise);
  const login = binding.onAuthState(signedIn);
  await settle();
  void binding.onAuthState({ status: "signed-out", error: "Sua sessão terminou." });
  assert.deepEqual(events, ["suspend"]);
  owner.resolve("u1");
  await login;
  assert.deepEqual(events, ["suspend"]);
});

test("eventos repetidos de login não reabrem a sessão (respostas em voo não são descartadas)", async () => {
  const events: string[] = [];
  const fake = { openSession: async (o: string) => { events.push(`open:${o}`); }, closeSession: async () => ({ purged: true }), suspend: () => undefined };
  const binding = createSessionBinding(fake as never, async () => "u1");
  await binding.onAuthState(signedIn);
  await binding.onAuthState(signedIn);
  assert.deepEqual(events, ["open:u1"]);
});

test("attach depois de whenIdle encontra a sessão pronta, mesmo com o dono lido devagar", async () => {
  const h = harness();
  const owner = deferred<string | null>();
  const binding = createSessionBinding(h.queue, () => owner.promise);
  void binding.onAuthState(signedIn);
  await settle();
  await assert.rejects(h.queue.attach(h.server.get("a")!), { code: "UNAUTHORIZED" }, "sem esperar o binding, a sessão ainda não existe");
  const idle = binding.whenIdle();
  owner.resolve("u1");
  await idle;
  assert.equal((await h.queue.attach(h.server.get("a")!)).note.id, "a");
});

test("logout explícito: o resultado da limpeza fica disponível e uma falha não vira sucesso", async () => {
  const h = harness({ store: { ...createMemoryDraftStore(), clearOwner: async () => { throw new Error("falha"); } } });
  const binding = createSessionBinding(h.queue, async () => "u1");
  await binding.onAuthState(signedIn);
  await binding.onAuthState({ status: "signed-out", error: null });
  assert.equal(binding.lastClose().purged, false);
});

test("guard central de logout: confirma com rascunhos ou sem poder verificar; só `discardDrafts` dispensa", () => {
  assert.equal(signOutNeedsConfirmation({ unsynced: 0, unknown: false }, false), false);
  assert.equal(signOutNeedsConfirmation({ unsynced: 2, unknown: false }, false), true);
  assert.equal(signOutNeedsConfirmation({ unsynced: 0, unknown: true }, false), true);
  assert.equal(signOutNeedsConfirmation(null, false), true);
  assert.equal(signOutNeedsConfirmation({ unsynced: 2, unknown: false }, true), false);
});
