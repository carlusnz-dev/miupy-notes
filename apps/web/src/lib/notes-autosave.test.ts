import assert from "node:assert/strict";
import { test } from "node:test";
import { changes, createAutosaveQueue, toDraft, validate, type QueueDeps } from "./notes-autosave";
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

const conflictError = () => Object.assign(new Error("conflito"), { code: "CONFLICT", status: 409 }); // ApiError real exige import.meta.env (Vite)
const networkError = () => Object.assign(new Error("rede"), { code: "NETWORK_ERROR" });
const text = (title: string, body = "") => ({ title, body, tags: [] as string[] });

/** Servidor falso: versão por nota, PATCH controlado por `gate` (resolve/rejeita quando o teste manda). */
function harness(extra: Partial<QueueDeps> = {}) {
  const server = new Map<string, NoteOutput>([["a", note("a")], ["b", note("b")]]);
  const calls: string[] = [];
  const saved: string[] = [];
  const gates: Array<ReturnType<typeof deferred<void>>> = [];
  let mode: "gated" | "instant" | "network" | "conflict" = "gated";
  const queue = createAutosaveQueue({
    update: async (id, input) => {
      calls.push(`${id}@${input.version}:${JSON.stringify({ ...input, version: undefined })}`);
      if (mode === "network") throw networkError();
      if (mode === "conflict") throw conflictError();
      if (mode === "gated") { const gate = deferred<void>(); gates.push(gate); await gate.promise; }
      const current = server.get(id)!;
      if (current.version !== input.version) throw conflictError();
      const next = { ...current, ...input, version: current.version + 1 } as NoteOutput;
      server.set(id, next);
      return next;
    },
    onSaved: (n) => saved.push(`${n.id}v${n.version}`),
    ...extra,
  });
  return { queue, server, calls, saved, gates, setMode: (m: typeof mode) => { mode = m; } };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("saída com texto novo durante o PATCH: o texto mais novo é enviado depois, v1→v2→v3, e B não é tocada", async () => {
  const h = harness();
  h.queue.attach(note("a")); h.queue.attach(note("b"));
  assert.equal(h.queue.submit("a", text("snapshot1"), "\n").status, "queued");
  await tick();
  assert.equal(h.queue.view("a")?.sending?.draft.title, "snapshot1");

  // digita snapshot2 durante o PATCH atrasado e sai da nota (cleanup do React → submit com leaving)
  assert.equal(h.queue.submit("a", text("snapshot2"), "\n", { leaving: true }).status, "queued");
  assert.equal(h.calls.length, 1, "um PATCH por nota por vez");
  assert.equal(h.queue.hasUnsaved(), true);

  // o usuário já está em B e salva B: não espera por A
  assert.equal(h.queue.submit("b", text("B editada"), "\n").status, "queued");
  await tick();
  assert.equal(h.calls.length, 2);
  h.gates[1].resolve();

  h.gates[0].resolve(); // termina o PATCH de snapshot1
  await tick(); await tick();
  assert.equal(h.calls[2], 'a@2:{"title":"snapshot2"}', "snapshot2 enviado com a version devolvida pelo PATCH anterior");
  h.gates[2].resolve();
  assert.equal(await h.queue.flush("a"), true);
  assert.equal(await h.queue.flush("b"), true);
  assert.equal(h.server.get("a")?.title, "snapshot2");
  assert.equal(h.server.get("a")?.version, 3);
  assert.equal(h.server.get("b")?.title, "B editada");
  assert.equal(h.server.get("b")?.version, 2);
  assert.deepEqual(h.saved.filter((s) => s.startsWith("a")), ["av2", "av3"]);
  assert.equal(h.queue.hasUnsaved(), false);
  assert.equal(h.queue.view("b")?.base.title, "B editada", "cada nota só vê a própria versão");
});

test("voltar para A com PATCH em andamento devolve o texto enviado e depois o mais novo, sem texto do servidor velho", async () => {
  const h = harness();
  h.queue.attach(note("a"));
  h.queue.submit("a", text("snapshot1"), "\n");
  await tick();
  assert.equal(h.queue.attach(note("a")).restored?.draft.title, "snapshot1", "a tela reaberta mostra o que está sendo enviado");
  h.queue.submit("a", text("snapshot2"), "\n");
  assert.equal(h.queue.attach(note("a")).restored?.draft.title, "snapshot2");
  h.gates[0].resolve(); await tick(); await tick(); h.gates[1].resolve();
  await h.queue.flush("a");
  const again = h.queue.attach(note("a")); // dados velhos do cache de consultas
  assert.equal(again.restored, null);
  assert.equal(again.note.version, 3, "a base é a versão salva mais nova, não a do cache velho");
  assert.equal(again.note.title, "snapshot2");
});

test("rede falha: o texto fica guardado, volta ao reabrir e é enviado numa nova tentativa com a mesma version", async () => {
  const h = harness();
  h.setMode("network");
  h.queue.attach(note("a"));
  h.queue.submit("a", text("perdível?"), "\n", { leaving: true });
  assert.equal(await h.queue.flush("a"), false);
  assert.equal(h.queue.view("a")?.error?.code, "NETWORK_ERROR");
  assert.equal(h.queue.hasUnsaved(), true);
  assert.equal(h.calls.length, 1, "sem repetição automática");

  const reopened = h.queue.attach(note("a"));
  assert.equal(reopened.restored?.draft.title, "perdível?");
  assert.equal(reopened.note.version, 1);

  h.setMode("instant");
  assert.equal(h.queue.submit("a", reopened.restored!.draft, "\n").status, "queued");
  assert.equal(await h.queue.flush("a"), true);
  assert.equal(h.server.get("a")?.title, "perdível?");
  assert.equal(h.server.get("a")?.version, 2);
  assert.equal(h.queue.view("a")?.error, null);
});

test("409 bloqueia reenvio automático e preserva o texto, inclusive o digitado depois; só reset descarta", async () => {
  const h = harness();
  h.setMode("conflict");
  h.queue.attach(note("a"));
  h.queue.submit("a", text("meu texto"), "\n");
  assert.equal(await h.queue.flush("a"), false);
  assert.equal(h.queue.view("a")?.blocked, true);
  assert.equal(h.queue.submit("a", text("meu texto 2"), "\n", { leaving: true }).status, "blocked");
  await tick();
  assert.equal(h.calls.length, 1, "nenhum PATCH extra");
  assert.equal(h.queue.attach(note("a", { version: 5 })).restored?.draft.title, "meu texto 2", "o servidor mais novo não apaga o rascunho");
  assert.equal(h.queue.hasUnsaved(), true);

  h.setMode("instant");
  h.queue.reset(note("a", { version: 5, title: "do servidor" }));
  const view = h.queue.view("a")!;
  assert.deepEqual([view.blocked, view.pending, view.base.title], [false, null, "do servidor"]);
  assert.equal(h.queue.attach(note("a")).restored, null);
});

test("sem alteração não há PATCH; reverter durante o envio envia a reversão", async () => {
  const h = harness();
  h.queue.attach(note("a", { title: "T" }));
  assert.equal(h.queue.submit("a", text("T"), "\n").status, "clean");
  assert.equal(h.calls.length, 0);
  h.queue.submit("a", text("X"), "\n"); await tick();
  h.queue.submit("a", text("T"), "\n"); // voltou ao título original com "X" em voo
  h.gates[0].resolve(); await tick(); await tick();
  h.gates[1].resolve();
  assert.equal(await h.queue.flush("a"), true);
  assert.equal(h.server.get("a")?.title, "T");
  assert.equal(h.server.get("a")?.version, 3);
});

test("ao sair, título em branco grava o resto; inválido mesmo assim fica guardado para a reabertura", async () => {
  const h = harness();
  h.setMode("instant");
  h.queue.attach(note("a", { title: "Título salvo" }));
  assert.equal(h.queue.submit("a", text("  ", "corpo novo"), "\n").status, "invalid");
  assert.equal(h.calls.length, 0);
  assert.equal(h.queue.view("a")?.pending, null, "fora da saída, inválido não é guardado (fica na tela)");
  h.queue.submit("a", text("  ", "corpo novo"), "\n", { leaving: true });
  await h.queue.flush("a");
  assert.deepEqual(h.calls, ['a@1:{"body":"corpo novo"}'], "o título em branco não vai no PATCH");
  assert.equal(h.server.get("a")?.body, "corpo novo");

  const tooLong = text("t", "x".repeat(100_001));
  assert.equal(h.queue.submit("a", tooLong, "\n", { leaving: true }).status, "invalid");
  assert.equal(h.queue.attach(note("a")).restored?.draft.body.length, 100_001);
  assert.equal(await h.queue.flush("a"), false);
});

test("outra nota nunca recebe o resultado, e clear (sair da conta) esquece tudo", async () => {
  const h = harness();
  h.queue.attach(note("a")); h.queue.attach(note("b"));
  const seenB: string[] = [];
  h.queue.subscribe("b", () => seenB.push(h.queue.view("b")!.base.title));
  h.queue.submit("a", text("só A"), "\n"); await tick();
  h.gates[0].resolve(); await h.queue.flush("a");
  assert.deepEqual(seenB, [], "ouvintes de B não são acionados por A");
  h.queue.submit("b", text("rascunho B"), "\n", { leaving: true }); await tick();
  assert.equal(h.queue.hasUnsaved(), true);
  h.queue.clear();
  assert.equal(h.queue.hasUnsaved(), false);
  assert.equal(h.queue.view("b"), undefined);
  assert.equal(h.queue.submit("b", text("x"), "\n").status, "unknown");
});

test("sessão encerrada durante o PATCH: resposta ignorada (sem cache nem base), texto guardado e sem envio automático", async () => {
  for (const end of ["clear", "endSession"] as const) {
    const h = harness();
    h.queue.attach(note("a"));
    h.queue.submit("a", text("da conta antiga"), "\n"); await tick();
    h.queue.submit("a", text("da conta antiga 2"), "\n"); // digitado em voo
    h.queue[end]();
    h.gates[0].resolve(); await tick(); await tick();
    assert.deepEqual(h.saved, [], `${end}: o cache não é repovoado pela sessão antiga`);
    assert.equal(h.calls.length, 1, `${end}: nenhum PATCH novo com o token da sessão seguinte`);
    if (end === "clear") { assert.equal(h.queue.view("a"), undefined); assert.equal(h.queue.hasUnsaved(), false); continue; }
    const view = h.queue.view("a")!;
    assert.equal(view.base.version, 1, "base não avança com resposta de outra sessão");
    assert.equal(view.pending?.draft.title, "da conta antiga 2");
    assert.equal(view.error?.code, "UNAUTHORIZED");
    assert.equal(h.queue.attach(note("a")).restored?.draft.title, "da conta antiga 2", "recuperável após entrar de novo");
  }
});

test("depois de endSession só um novo submit do usuário envia o texto, e a resposta velha não o atrapalha", async () => {
  const h = harness();
  h.queue.attach(note("a"));
  h.queue.submit("a", text("antes"), "\n"); await tick();
  h.queue.endSession();                               // 401: sessão expirou; PATCH velho ainda em voo
  h.queue.submit("a", text("depois do login"), "\n"); // usuário entrou de novo e editou
  assert.equal(h.calls.length, 1, "espera o PATCH velho terminar (uma gravação por nota)");
  h.setMode("instant");
  h.gates[0].reject(networkError());
  await tick(); await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1], 'a@1:{"title":"depois do login"}', "texto da sessão nova enviado com a base ainda válida");
  assert.equal(await h.queue.flush("a"), true);
  assert.equal(h.server.get("a")?.title, "depois do login");
  assert.deepEqual(h.saved, ["av2"]);
  assert.equal(h.queue.view("a")?.error, null);
});
