import assert from "node:assert/strict";
import { test } from "node:test";
import { changes, saveNote, toDraft, validate } from "./notes-autosave";
import type { NoteOutput } from "./notes-api";

const now = "2026-10-19T12:00:00.000Z";
const note = (id: string, over: Partial<NoteOutput> = {}): NoteOutput => ({ id, title: `Nota ${id}`, body: "", tags: [], folderId: null, createdAt: now, updatedAt: now, version: 1, ...over });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("só envia o que mudou e restaura o fim de linha original", () => {
  const crlf = note("a", { body: "um\r\ndois\r\n" });
  assert.equal(changes(crlf, toDraft(crlf), "\r\n"), null, "abrir sem editar não gera PATCH");
  assert.deepEqual(changes(crlf, { ...toDraft(crlf), body: "um\ndois\ntrês\n" }, "\r\n"), { body: "um\r\ndois\r\ntrês\r\n" });
  assert.deepEqual(changes(note("a"), { title: " Novo ", body: "", tags: ["x"] }, "\n"), { title: "Novo", tags: ["x"] });
});

test("valida título, corpo (no formato gravado) e tags", () => {
  const ok = { title: "t", body: "", tags: [] };
  assert.equal(validate(ok, "\n"), null);
  assert.match(validate({ ...ok, title: "  " }, "\n")!, /título/);
  assert.match(validate({ ...ok, body: "x".repeat(100_001) }, "\n")!, /texto/);
  assert.match(validate({ ...ok, body: "\n".repeat(60_000) }, "\r\n")!, /texto/, "CRLF conta dois caracteres por quebra");
  assert.equal(validate({ ...ok, body: "\n".repeat(60_000) }, "\n"), null);
  assert.match(validate({ ...ok, tags: Array(21).fill("t") }, "\n")!, /20 tags/);
});

test("trocar de A para B durante o PATCH: a resposta de A é descartada para a tela e B salva sem esperar", async () => {
  const inFlight = new Set<string>();
  const a = note("a");
  const b = note("b", { version: 3 });
  let open = "a";
  const pendingA = deferred<NoteOutput>();
  const calls: string[] = [];
  const update = (id: string, input: { version: number }) => {
    calls.push(`${id}@${input.version}`);
    return id === "a" ? pendingA.promise : Promise.resolve({ ...b, title: "B salvo", version: input.version + 1 });
  };

  const savingA = saveNote({ note: a, draft: { title: "A editada", body: "", tags: [] }, eol: "\n", inFlight, update, openNoteId: () => open });
  assert.deepEqual(await saveNote({ note: a, draft: { title: "A de novo", body: "", tags: [] }, eol: "\n", inFlight, update, openNoteId: () => open }), { status: "busy" });

  open = "b"; // usuário clicou na barra lateral
  const savedB = await saveNote({ note: b, draft: { title: "B editada", body: "", tags: [] }, eol: "\n", inFlight, update, openNoteId: () => open });
  assert.equal(savedB.status === "saved" && savedB.stale, false, "B não espera nem é bloqueada por A");

  pendingA.resolve({ ...a, title: "A editada", version: 2 });
  const resultA = await savingA;
  assert.equal(resultA.status === "saved" && resultA.stale, true);
  assert.deepEqual(calls, ["a@1", "b@3"]);
  assert.equal(inFlight.size, 0);
});

test("erro de A depois de trocar para B também é marcado como obsoleto (não mostra erro em B)", async () => {
  const pendingA = deferred<NoteOutput>();
  let open = "a";
  const saving = saveNote({ note: note("a"), draft: { title: "x", body: "", tags: [] }, eol: "\n", inFlight: new Set(), update: () => pendingA.promise, openNoteId: () => open });
  open = "b";
  pendingA.reject(Object.assign(new Error("conflito"), { code: "CONFLICT", status: 409 })); // ApiError real exige import.meta.env (Vite)
  const result = await saving;
  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" && result.stale, true);
});

test("ao sair com título em branco, grava o resto mantendo o título salvo; fora disso, recusa", async () => {
  const sent: unknown[] = [];
  const update = async (_id: string, input: { version: number; title?: string; body?: string }) => { sent.push(input); return note("a", { version: 2 }); };
  const base = { note: note("a"), inFlight: new Set<string>(), update, openNoteId: () => "a" as string | undefined, eol: "\n" as const };
  const draft = { title: "   ", body: "texto novo", tags: [] };
  assert.equal((await saveNote({ ...base, draft })).status, "invalid");
  assert.equal(sent.length, 0);
  const leaving = await saveNote({ ...base, draft, leaving: true });
  assert.equal(leaving.status, "saved");
  assert.deepEqual(sent, [{ version: 1, body: "texto novo" }]);
  assert.equal((await saveNote({ ...base, draft: { title: "   ", body: "", tags: [] }, leaving: true })).status, "clean");
  assert.equal((await saveNote({ ...base, draft: { title: "t", body: "x".repeat(100_001), tags: [] }, leaving: true })).status, "invalid");
});
