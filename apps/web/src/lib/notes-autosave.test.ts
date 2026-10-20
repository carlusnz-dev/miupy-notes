import assert from "node:assert/strict";
import { test } from "node:test";
import { changes, classifyFailure, isLocalReadFailure, toDraft, validate, type EntryView } from "./notes-autosave";
import { describeSave } from "./notes-autosave-status";
import { createMemoryDraftStore, createUnavailableDraftStore } from "./notes-draft-store";
import { apiError, deferred, harness, note, settle, text } from "./notes-test-kit";
import type { NoteOutput } from "./notes-api";

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


const view = (h: ReturnType<typeof harness>, id = "a") => h.queue.view(id)!;
const record = (h: ReturnType<typeof harness>, id = "a", owner = "u1") => h.memory.records.get(`${owner}\u0000${id}`);

test("100 alterações rápidas: o último texto é gravado localmente e há um único PATCH, sem envio por tecla", async () => {
  const h = harness();
  await h.open();
  for (let i = 1; i <= 100; i++) {
    h.queue.edit("a", text("Nota a", `texto ${i}`), "\n");
    await h.clock.advance(20);
  }
  assert.equal(h.calls.length, 0, "enquanto digita (2 s no total) nada é enviado");
  assert.equal(record(h)?.draft.body, "texto 100", "o último texto já está no armazenamento local");
  assert.equal(view(h).status, "local");
  await h.clock.advance(1800);
  assert.equal(h.calls.length, 1);
  assert.equal(h.server.get("a")!.body, "texto 100");
  assert.equal(view(h).status, "synced");
  assert.equal(record(h), undefined, "confirmado: o registro local some");
});

test("o texto é gravado localmente antes do PATCH que depende dele", async () => {
  const h = harness();
  let storedAtSend = "";
  h.script.push(async (input, id) => { storedAtSend = record(h)?.draft.body ?? "(nada)"; return h.apply(id, input); });
  await h.open();
  h.queue.edit("a", text("Nota a", "oi"), "\n");
  await h.clock.advance(1800);
  assert.equal(storedAtSend, "oi");
});

test("digitação contínua: o teto de espera força o envio (sem chamada por tecla)", async () => {
  const h = harness();
  await h.open();
  for (let t = 0; t < 60_000; t += 500) {
    h.queue.edit("a", text("Nota a", `t${t}`), "\n");
    await h.clock.advance(500);
  }
  assert.ok(h.calls.length >= 2 && h.calls.length <= 4, `PATCHes: ${h.calls.length}`);
  assert.ok(h.calls[0].at <= 20_500, `primeiro envio em ${h.calls[0].at} ms`);
});

test("alterações durante o PATCH: só o texto mais novo vai depois, sobre a version confirmada", async () => {
  const h = harness();
  const gate = deferred<void>();
  h.script.push(async (input, id) => { await gate.promise; return h.apply(id, input); });
  await h.open();
  h.queue.edit("a", text("Nota a", "um"), "\n");
  await h.clock.advance(1800);
  assert.equal(view(h).status, "saving");
  h.queue.edit("a", text("Nota a", "dois"), "\n");
  h.queue.edit("a", text("Nota a", "três"), "\n");
  gate.resolve();
  await h.clock.advance(1800);
  assert.deepEqual(h.calls.map((c) => [c.version, c.body]), [[1, "um"], [2, "três"]]);
  assert.equal(h.server.get("a")!.version, 3);
  assert.equal(record(h), undefined);
});

test("a confirmação de um texto antigo não apaga o registro local do texto novo", async () => {
  const h = harness();
  const gate = deferred<void>();
  h.script.push(async (input, id) => { await gate.promise; return h.apply(id, input); });
  await h.open();
  h.queue.edit("a", text("Nota a", "um"), "\n");
  await h.clock.advance(1800);
  h.queue.edit("a", text("Nota a", "dois"), "\n");
  gate.resolve();
  await settle();
  assert.equal(record(h)?.draft.body, "dois");
  assert.equal(record(h)?.base.version, 2, "a base do registro já é a versão confirmada");
  assert.equal(view(h).base.version, 2);
});

test("várias notas: no máximo um PATCH no app; quem edita sem parar não adia outra nota", async () => {
  const h = harness();
  await h.queue.openSession("u1");
  await h.queue.attach(h.server.get("a")!);
  await h.queue.attach(h.server.get("b")!);
  await h.queue.attach(h.server.get("c")!);
  h.queue.edit("b", text("Nota b", "b"), "\n");
  h.queue.edit("c", text("Nota c", "c"), "\n");
  for (let t = 0; t < 30_000; t += 500) {
    h.queue.edit("a", text("Nota a", `a${t}`), "\n");
    await h.clock.advance(500);
  }
  assert.equal(h.maxRunning, 1);
  const firstOf = (id: string) => h.calls.find((c) => c.id === id)!.at;
  assert.ok(firstOf("b") <= 2000 && firstOf("c") <= 2000, "b e c saem logo após a pausa");
  assert.ok(firstOf("a") > firstOf("b"), "a, em edição constante, não passa na frente");
  assert.equal(h.server.get("b")!.body, "b");
});

test("concorrência global é configurável", async () => {
  const gates = [deferred<void>(), deferred<void>()];
  const h = harness({ deps: { scheduler: { maxConcurrent: 2 } } });
  for (const gate of gates) h.script.push(async (input, id) => { await gate.promise; return h.apply(id, input); });
  await h.queue.openSession("u1");
  for (const id of ["a", "b", "c"]) { await h.queue.attach(h.server.get(id)!); h.queue.edit(id, text(`Nota ${id}`, "x"), "\n"); }
  await h.clock.advance(2000);
  assert.equal(h.maxRunning, 2);
  gates.forEach((gate) => gate.resolve());
  await h.clock.advance(100);
  assert.equal(h.calls.length, 3);
});

test("reload: nova fila restaura o texto do armazenamento e o envia sobre a base correta", async () => {
  const first = harness();
  await first.open();
  first.queue.edit("a", text("Nota a", "não enviado"), "\r\n");
  await first.queue.protect("a");
  // "Crash": o processo morre sem enviar; o armazenamento e o servidor sobrevivem.
  const second = harness({ store: first.store });
  second.server.set("a", first.server.get("a")!);
  const { note: base, restored } = await second.open();
  assert.equal(restored?.draft.body, "não enviado");
  assert.equal(restored?.eol, "\r\n");
  assert.equal(base.version, 1);
  assert.equal(second.queue.unsyncedCount(), 1);
  await second.clock.advance(2000);
  assert.deepEqual(second.reads, ["a"], "resultado desconhecido: relê o servidor antes de enviar");
  assert.equal(second.server.get("a")!.body, "não enviado".replace(/\n/g, "\r\n"));
  assert.equal(second.server.get("a")!.version, 2);
});

test("reload sem a tela aberta: rascunhos da conta são enviados em segundo plano", async () => {
  const first = harness();
  await first.open("b");
  first.queue.edit("b", text("Nota b", "fundo"), "\n");
  await first.queue.protect("b");
  const second = harness({ store: first.store });
  await second.queue.openSession("u1");
  await second.clock.advance(2000);
  assert.equal(second.server.get("b")!.body, "fundo");
  assert.equal(record(second, "b"), undefined);
});

test("crash no meio do PATCH já aplicado: ao reabrir não reenvia e limpa o rascunho", async () => {
  const first = harness();
  const never = deferred<NoteOutput>();
  first.script.push(async (input, id) => { first.apply(id, input); return never.promise; });
  await first.open();
  first.queue.edit("a", text("Nota a", "aplicado"), "\n");
  await first.clock.advance(1800);
  assert.equal(first.server.get("a")!.version, 2, "o servidor aplicou, a resposta nunca chegou");
  const second = harness({ store: first.store });
  second.server.set("a", first.server.get("a")!);
  const { restored, note: current } = await second.open();
  assert.equal(restored, null);
  assert.equal(current.version, 2);
  await second.clock.advance(60_000);
  assert.equal(second.calls.length, 0);
  assert.equal(record(second), undefined);
});

test("rascunho sobre versão que mudou em outro lugar vira conflito, sem envio", async () => {
  const first = harness();
  await first.open();
  first.queue.edit("a", text("Nota a", "meu"), "\n");
  await first.queue.protect("a");
  const second = harness({ store: first.store });
  second.server.set("a", note("a", { body: "de outro lugar", version: 2 }));
  const { restored } = await second.open();
  assert.equal(restored?.draft.body, "meu");
  assert.equal(view(second).status, "conflict");
  await second.clock.advance(60_000);
  assert.equal(second.calls.length, 0);
});

test("falha da escrita local impede o PATCH; quando o disco volta, grava e só então envia", async () => {
  const memory = createMemoryDraftStore();
  let failing = true;
  const h = harness({ store: { ...memory, put: async (r) => { if (failing) throw new Error("disco cheio"); await memory.put(r); } } });
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 0, "sem gravação local confirmada, nada é enviado");
  assert.equal(view(h).status, "local-failed");
  assert.equal(h.queue.hasUnprotected(), true);
  assert.equal(await h.queue.protect("a"), false);
  assert.match(describeSave(view(h), "ok").text, /proteger localmente/);
  failing = false;
  await h.clock.advance(400_000);
  assert.equal(memory.records.size, 0, "confirmado e limpo");
  assert.equal(h.server.get("a")!.body, "x");
  assert.equal(view(h).status, "synced");
  assert.equal(h.queue.hasUnprotected(), false);
});

test("só é `local` depois de a escrita confirmar; antes disso é `protecting` e nada é enviado", async () => {
  const memory = createMemoryDraftStore();
  const gate = deferred<void>();
  const h = harness({ store: { ...memory, put: async (r) => { await gate.promise; await memory.put(r); } } });
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  assert.equal(view(h).status, "protecting");
  assert.match(describeSave(view(h), "ok").text, /Gravando/);
  await h.clock.advance(5000);
  assert.equal(h.calls.length, 0, "PATCH espera a gravação local");
  gate.resolve();
  await h.clock.advance(10);
  assert.equal(h.calls.length, 1);
  assert.equal(h.server.get("a")!.body, "x");
});

test("falha ao limpar o registro local após o PATCH: não fica `synced`, não reenvia e repete a limpeza", async () => {
  const memory = createMemoryDraftStore();
  let failing = true;
  const h = harness({ store: { ...memory, remove: async (o, n, r) => { if (failing) throw new Error("ack failure"); await memory.remove(o, n, r); } } });
  await h.open();
  h.queue.edit("a", text("Nota a", "confirmado"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.server.get("a")!.body, "confirmado");
  assert.equal(view(h).status, "local-failed");
  assert.equal(view(h).localIssue, "cleanup");
  assert.equal(await h.queue.protect("a"), false);
  assert.match(describeSave(view(h), "ok").text, /Sincronizado, mas/);
  assert.equal(memory.records.get("u1\u0000a")?.draft.body, "confirmado", "o registro antigo continua no disco");
  await h.clock.advance(30_000);
  assert.equal(h.calls.length, 1, "a confirmação remota não é reenviada");
  failing = false;
  await h.clock.advance(400_000);
  assert.equal(view(h).status, "synced");
  assert.equal(memory.records.size, 0);
  assert.equal(h.calls.length, 1);
});

test("restart depois de limpeza que falhou: o registro velho é reconhecido como já aplicado e some", async () => {
  const memory = createMemoryDraftStore();
  const h = harness({ store: { ...memory, remove: async () => { throw new Error("falha"); } } });
  await h.open();
  h.queue.edit("a", text("Nota a", "aplicado"), "\n");
  await h.clock.advance(1800);
  const second = harness({ store: memory });
  second.server.set("a", h.server.get("a")!);
  const { restored } = await second.open();
  assert.equal(restored, null);
  await second.clock.advance(60_000);
  assert.equal(second.calls.length, 0);
  assert.equal(second.memory.records.size, 0);
});

test("leitura local com erro: attach rejeita, o rascunho existente não é sobrescrito e há retry e decisão explícita", async () => {
  const old = createMemoryDraftStore();
  await old.put({ ownerId: "u1", noteId: "a", base: note("a"), draft: text("Nota a", "recuperavel"), eol: "\n", revision: 7, savedAt: 0 });
  let failing = true;
  const flaky = { ...old, listByOwner: async (o: string) => { if (failing) throw new Error("leitura"); return old.listByOwner(o); }, get: async (o: string, n: string) => { if (failing) throw new Error("leitura"); return old.get(o, n); } };
  const h = harness({ store: flaky });
  await h.queue.openSession("u1");
  assert.ok(h.queue.restoreError());
  await assert.rejects(h.queue.attach(h.server.get("a")!), (error: { code?: string }) => isLocalReadFailure(error));
  assert.equal(h.queue.edit("a", text("Nota a", "novo"), "\n").status, "unknown", "sem attach não há edição");
  assert.equal((await old.get("u1", "a"))?.draft.body, "recuperavel");
  failing = false;
  await h.queue.retryRestore();
  assert.equal(h.queue.restoreError(), null);
  assert.equal((await h.queue.attach(h.server.get("a")!)).restored?.draft.body, "recuperavel");
});

test("abrir sem o rascunho local é decisão explícita (ignoreLocal)", async () => {
  const bad = { ...createMemoryDraftStore(), get: async () => { throw new Error("leitura"); } };
  const h = harness({ store: bad });
  await h.queue.openSession("u1");
  await assert.rejects(h.queue.attach(h.server.get("a")!));
  const opened = await h.queue.attach(h.server.get("a")!, { ignoreLocal: true });
  assert.equal(opened.restored, null);
});

test("attach em andamento quando a conta sai e a mesma conta volta: resultado antigo não é restaurado nem enviado", async () => {
  const memory = createMemoryDraftStore();
  const gate = deferred<unknown>();
  const h = harness({ store: { ...memory, get: () => gate.promise as never } });
  await h.queue.openSession("u1");
  const pending = h.queue.attach(h.server.get("a")!);
  await settle();
  await h.queue.closeSession({ purge: true });
  await h.queue.openSession("u1");
  gate.resolve({ ownerId: "u1", noteId: "a", base: note("a"), draft: text("Nota a", "explicitly-purged"), eol: "\n", revision: 7, savedAt: 0 });
  await assert.rejects(pending);
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.server.get("a")!.body, "");
});

test("limpeza do logout que falha não é sucesso: avisa, mantém bloqueio e repete antes de restaurar", async () => {
  const memory = createMemoryDraftStore();
  let failing = true;
  const h = harness({ store: { ...memory, clearOwner: async (o) => { if (failing) throw new Error("falha"); await memory.clearOwner(o); } } });
  await h.open();
  h.queue.edit("a", text("Nota a", "para-apagar"), "\n");
  await h.queue.protect("a");
  const result = await h.queue.closeSession({ purge: true });
  assert.equal(result.purged, false);
  assert.equal(memory.records.size, 1);
  await h.queue.openSession("u1");
  await assert.rejects(h.queue.attach(h.server.get("a")!), (e: { code?: string }) => isLocalReadFailure(e), "rascunho que deveria ter sido apagado não volta");
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 0);
  failing = false;
  await h.queue.retryRestore();
  assert.equal(memory.records.size, 0);
  assert.equal((await h.queue.attach(h.server.get("a")!)).restored, null);
});

test("exclusão: falha ao remover o registro local é informada e repetida na próxima sessão", async () => {
  const memory = createMemoryDraftStore();
  let failing = true;
  const h = harness({ store: { ...memory, remove: async (o, n, r) => { if (failing) throw new Error("falha"); await memory.remove(o, n, r); } } });
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await h.queue.protect("a");
  assert.equal(await h.queue.discard("a"), false);
  assert.equal(memory.records.size, 1);
  failing = false;
  await h.queue.openSession("u1");
  assert.equal(memory.records.size, 0);
});

test("reset informa se não conseguiu remover o rascunho antigo", async () => {
  const memory = createMemoryDraftStore();
  let failing = false;
  const h = harness({ store: { ...memory, remove: async (o, n, r) => { if (failing) throw new Error("falha"); await memory.remove(o, n, r); } } });
  await h.open();
  h.server.set("a", note("a", { body: "alheio", version: 2 }));
  h.queue.edit("a", text("Nota a", "meu"), "\n");
  await h.clock.advance(1800);
  assert.equal(view(h).status, "conflict");
  failing = true;
  assert.equal(await h.queue.reset(h.server.get("a")!), false);
  assert.equal(view(h).status, "local-failed");
});

test("voltar ao texto da base durante uma gravação antiga não deixa o rascunho velho nem apaga o futuro", async () => {
  const memory = createMemoryDraftStore();
  const gate = deferred<void>();
  let first = true;
  const h = harness({ store: { ...memory, put: async (r) => { if (first) { first = false; await gate.promise; } await memory.put(r); } } });
  await h.open();
  h.queue.edit("a", text("Nota a", "desfazer"), "\n");
  assert.equal(h.queue.edit("a", text("Nota a", ""), "\n").status, "clean");
  gate.resolve();
  await settle();
  assert.equal(record(h), undefined, "o registro da revisão 1 foi removido");
  assert.equal(view(h).status, "synced");

  const gate2 = deferred<void>();
  const h2 = harness({ store: { ...memory, remove: async (o, n, r) => { await gate2.promise; await memory.remove(o, n, r); } } });
  await h2.open();
  h2.queue.edit("a", text("Nota a", ""), "\n");
  h2.queue.edit("a", text("Nota a", "futuro"), "\n");
  gate2.resolve();
  await h2.clock.advance(10);
  assert.equal(memory.records.get("u1\u0000a")?.draft.body, "futuro", "limpeza antiga não apaga a revisão nova");
});

test("Retry-After de 10 min vale inteiro: nem voltar a conexão nem salvar à mão o antecipam", async () => {
  const h = harness();
  h.script.push(async () => { throw apiError("RATE_LIMITED", 429, 600_000); });
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.calls.length, 1);
  h.queue.retryNow();
  void h.queue.flush("a");
  await h.clock.advance(300_000);
  assert.equal(h.calls.length, 1, "aos 5 min ainda não");
  await h.clock.advance(300_100);
  assert.equal(h.calls.length, 2);
  assert.equal(h.server.get("a")!.body, "x");
});

test("sem armazenamento durável disponível, cada edição aparece como não protegida", async () => {
  const h = harness({ store: createUnavailableDraftStore() });
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await settle();
  assert.equal(view(h).status, "local-failed");
});

test("falha temporária (503): reconcilia, espera backoff crescente e se recupera sem rajada", async () => {
  const h = harness();
  h.script.push(async () => { throw apiError("INTERNAL", 503); }, async () => { throw apiError("INTERNAL", 503); });
  await h.open();
  h.queue.edit("a", text("Nota a", "retry"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.calls.length, 1);
  assert.equal(view(h).status, "error");
  assert.equal(view(h).retrying, true);
  await h.clock.advance(1900);
  assert.equal(h.calls.length, 1, "backoff de 2 s: nada antes");
  await h.clock.advance(200);
  assert.equal(h.calls.length, 2);
  assert.ok(h.reads.length >= 1, "5xx é ambíguo: relê o servidor antes do retry");
  await h.clock.advance(3700);
  assert.equal(h.calls.length, 2, "segundo backoff de 4 s");
  await h.clock.advance(200);
  assert.equal(h.calls.length, 3);
  assert.equal(h.server.get("a")!.body, "retry");
  assert.equal(view(h).status, "synced");
});

test("429 respeita Retry-After e não relê o servidor; nova edição não encurta a espera", async () => {
  const h = harness();
  h.script.push(async () => { throw apiError("RATE_LIMITED", 429, 30_000); });
  await h.open();
  h.queue.edit("a", text("Nota a", "um"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.reads.length, 0);
  await h.clock.advance(5000);
  h.queue.edit("a", text("Nota a", "dois"), "\n");
  await h.clock.advance(20_000);
  assert.equal(h.calls.length, 1, "antes dos 30 s nada sai");
  await h.clock.advance(6000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.server.get("a")!.body, "dois");
});

test("offline: mostra sem conexão, não insiste e retoma na hora quando a conexão volta", async () => {
  const h = harness();
  h.script.push(async () => { throw apiError("NETWORK_ERROR"); });
  await h.open();
  h.queue.edit("a", text("Nota a", "offline"), "\n");
  await h.clock.advance(1800);
  assert.equal(view(h).status, "offline");
  assert.match(describeSave(view(h), "ok").text, /Sem conexão/);
  assert.equal(record(h)?.draft.body, "offline");
  h.queue.retryNow();
  await settle();
  await h.clock.advance(10);
  assert.equal(h.server.get("a")!.body, "offline");
  assert.equal(view(h).status, "synced");
});

test("timeout ambíguo: o servidor aplicou, a releitura confirma e não há segundo PATCH", async () => {
  const h = harness();
  h.script.push(async (input, id) => { h.apply(id, input); throw apiError("NETWORK_ERROR"); });
  await h.open();
  h.queue.edit("a", text("Nota a", "aplicado"), "\n");
  await h.clock.advance(1800);
  await h.clock.advance(2100);
  assert.equal(h.calls.length, 1);
  assert.equal(view(h).status, "synced");
  assert.equal(h.server.get("a")!.version, 2);
  assert.equal(record(h), undefined);
});

test("timeout ambíguo com outra gravação no servidor: conflito, sem replay", async () => {
  const h = harness();
  h.script.push(async (_input, id) => { h.server.set(id, note(id, { body: "alheio", version: 2 })); throw apiError("NETWORK_ERROR"); });
  await h.open();
  h.queue.edit("a", text("Nota a", "meu"), "\n");
  await h.clock.advance(1800);
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 1);
  assert.equal(view(h).status, "conflict");
  assert.equal(record(h)?.draft.body, "meu");
});

test("a releitura só muda metadado: o texto é reenviado sobre a versão nova", async () => {
  const h = harness();
  h.script.push(async (_input, id) => { h.server.set(id, { ...h.server.get(id)!, folderId: "pasta", version: 2 }); throw apiError("INTERNAL", 502); });
  await h.open();
  h.queue.edit("a", text("Nota a", "meu"), "\n");
  await h.clock.advance(1800);
  await h.clock.advance(2100);
  assert.deepEqual(h.calls.map((c) => c.version), [1, 2]);
  assert.equal(h.server.get("a")!.body, "meu");
});

test("409: não reenvia, preserva o texto (inclusive o digitado depois) e só reset descarta", async () => {
  const h = harness();
  await h.open();
  h.server.set("a", note("a", { body: "alheio", version: 2 }));
  h.queue.edit("a", text("Nota a", "meu"), "\n");
  await h.clock.advance(1800);
  assert.equal(view(h).status, "conflict");
  h.queue.edit("a", text("Nota a", "meu mais novo"), "\n");
  await h.clock.advance(120_000);
  assert.equal(h.calls.length, 1, "sem replay automático");
  assert.equal(record(h)?.draft.body, "meu mais novo");
  assert.equal((await h.queue.attach(h.server.get("a")!)).restored?.draft.body, "meu mais novo");
  h.queue.reset(h.server.get("a")!);
  await settle();
  assert.equal(view(h).status, "synced");
  assert.equal(record(h), undefined);
});

test("400/422: mantém o rascunho e só tenta de novo depois de o texto mudar", async () => {
  const h = harness();
  h.script.push(async () => { throw apiError("VALIDATION_ERROR", 422); });
  await h.open();
  h.queue.edit("a", text("Nota a", "ruim"), "\n");
  await h.clock.advance(1800);
  await h.clock.advance(300_000);
  assert.equal(h.calls.length, 1);
  assert.equal(view(h).status, "error");
  assert.equal(record(h)?.draft.body, "ruim");
  h.queue.edit("a", text("Nota a", "corrigido"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.server.get("a")!.body, "corrigido");
});

test("texto inválido é protegido localmente e não é enviado até corrigir", async () => {
  const h = harness();
  await h.open();
  const result = h.queue.edit("a", text("  ", "corpo"), "\n");
  assert.equal(result.status, "invalid");
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 0);
  assert.equal(record(h)?.draft.body, "corpo", "mesmo inválido, o rascunho está gravado");
  assert.match(describeSave(view(h), "ok").text, /título/);
  h.queue.edit("a", text("Título", "corpo"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.server.get("a")!.title, "Título");
});

test("sem alteração semântica não há PATCH, inclusive ao voltar ao texto da base antes do envio", async () => {
  const h = harness({}) ;
  await h.open();
  h.queue.edit("a", text("Nota a", ""), "\n");
  assert.equal(h.queue.edit("a", text("Nota a", ""), "\n").status, "clean");
  h.queue.edit("a", text("Nota a", "x"), "\n");
  assert.equal(h.queue.edit("a", text("Nota a", ""), "\n").status, "clean");
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 0);
  assert.equal(view(h).status, "synced");
  assert.equal(record(h), undefined);
});

test("401: pausa sem perder o texto; a mesma conta retoma, outra conta nunca vê nem envia", async () => {
  const h = harness();
  h.script.push(async () => { throw apiError("UNAUTHORIZED", 401); });
  await h.open();
  h.queue.edit("a", text("Nota a", "meu"), "\n");
  await h.clock.advance(1800);
  assert.equal(h.queue.isPaused(), true);
  assert.equal(view(h).status, "paused");
  h.queue.edit("a", text("Nota a", "meu 2"), "\n");
  await h.clock.advance(120_000);
  assert.equal(h.calls.length, 1, "nada é enviado sem sessão");
  assert.equal(record(h)?.draft.body, "meu 2");

  // Outra conta entra: nada da primeira aparece e nada é enviado.
  await h.queue.openSession("u2");
  assert.equal(h.queue.view("a"), undefined);
  assert.equal(h.queue.unsyncedCount(), 0);
  const other = await h.queue.attach(h.server.get("a")!);
  assert.equal(other.restored, null);
  await h.clock.advance(120_000);
  assert.equal(h.calls.length, 1);
  assert.equal(record(h, "a", "u1")?.draft.body, "meu 2", "o rascunho de u1 continua guardado para u1");

  // u1 volta: retoma sozinho.
  await h.queue.openSession("u1");
  await h.clock.advance(2000);
  assert.equal(h.server.get("a")!.body, "meu 2");
  assert.equal(record(h, "a", "u1"), undefined);
});

test("401 com resposta em voo de sessão antiga: ignorada, e o texto é reconciliado ao voltar", async () => {
  const h = harness();
  const gate = deferred<void>();
  h.script.push(async (input, id) => { await gate.promise; return h.apply(id, input); });
  await h.open();
  h.queue.edit("a", text("Nota a", "voo"), "\n");
  await h.clock.advance(1800);
  h.queue.suspend();
  gate.resolve();
  await settle();
  assert.deepEqual(h.saved, [], "resposta tardia não atualiza o cache");
  assert.equal(record(h)?.draft.body, "voo", "e não apaga o rascunho");
  await h.queue.openSession("u1");
  await h.clock.advance(2000);
  assert.equal(h.calls.length, 1, "o servidor já aplicou: a releitura evita reenviar");
  assert.equal(record(h), undefined);
});

test("logout explícito apaga os rascunhos da conta; resposta tardia não repovoa nada", async () => {
  const h = harness();
  const gate = deferred<void>();
  h.script.push(async (input, id) => { await gate.promise; return h.apply(id, input); });
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await h.clock.advance(1800);
  h.queue.edit("a", text("Nota a", "y"), "\n");
  await h.queue.closeSession({ purge: true });
  gate.resolve();
  await h.clock.advance(60_000);
  assert.equal(h.memory.records.size, 0);
  assert.deepEqual(h.saved, []);
  assert.equal(h.queue.view("a"), undefined);
  assert.equal(h.calls.length, 1);
});

test("nota excluída durante o envio: não ressuscita e a resposta tardia é ignorada", async () => {
  const h = harness();
  const gate = deferred<void>();
  h.script.push(async (input, id) => { await gate.promise; return h.apply(id, input); });
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await h.clock.advance(1800);
  const held = h.queue.hold("a");
  h.queue.edit("a", text("Nota a", "y"), "\n");
  gate.resolve();
  await held;
  await h.queue.discard("a");
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 1, "nenhum PATCH depois da exclusão");
  assert.equal(h.memory.records.size, 0);
  assert.equal(h.queue.view("a"), undefined);
  assert.deepEqual(h.saved, ["av2"], "só a resposta anterior ao hold chegou ao cache");
});

test("exclusão que falha devolve a nota ao envio", async () => {
  const h = harness();
  await h.open();
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await h.queue.hold("a");
  await h.clock.advance(60_000);
  assert.equal(h.calls.length, 0);
  h.queue.release("a");
  await h.clock.advance(1800);
  assert.equal(h.server.get("a")!.body, "x");
});

test("flush envia já e informa se ficou sincronizada", async () => {
  const h = harness();
  await h.open();
  h.queue.edit("a", text("Nota a", "agora"), "\n");
  const done = h.queue.flush("a");
  await h.clock.advance(1);
  assert.equal(await done, true);
  assert.equal(h.calls[0].at, 0, "sem esperar a pausa de digitação");
});

test("classifica falhas do PATCH", () => {
  assert.equal(classifyFailure(apiError("X", 429) as never).kind, "temporary");
  assert.equal(classifyFailure(apiError("X", 429) as never).ambiguous, false);
  assert.equal(classifyFailure(apiError("NETWORK_ERROR") as never).ambiguous, true);
  assert.equal(classifyFailure(apiError("X", 504) as never).kind, "temporary");
  assert.equal(classifyFailure(apiError("VALIDATION_ERROR", 400) as never).kind, "invalid");
  assert.equal(classifyFailure(apiError("CONFLICT", 409) as never).kind, "conflict");
  assert.equal(classifyFailure(apiError("UNAUTHORIZED", 401) as never).kind, "unauthorized");
  assert.equal(classifyFailure(apiError("FORBIDDEN", 403) as never).kind, "other");
});

test("armazenamento: remoção condicional pela revisão e isolamento por conta", async () => {
  const store = createMemoryDraftStore();
  const base = note("a");
  const rec = (ownerId: string, revision: number) => ({ ownerId, noteId: "a", draft: text("t"), eol: "\n" as const, base, revision, savedAt: 0 });
  await store.put(rec("u1", 2));
  await store.put(rec("u2", 1));
  await store.remove("u1", "a", 1);
  assert.equal((await store.get("u1", "a"))?.revision, 2, "revisão diferente: mantém");
  assert.equal((await store.listByOwner("u2")).length, 1);
  await store.clearOwner("u1");
  assert.equal(await store.get("u1", "a"), null);
  assert.equal((await store.get("u2", "a"))?.revision, 1);
});

test("indicador do editor distingue local, nuvem, conflito e sessão", async () => {
  const h = harness();
  await h.open();
  assert.equal(describeSave(view(h), "Sincronizado às 10:00").text, "Sincronizado às 10:00");
  h.queue.edit("a", text("Nota a", "x"), "\n");
  await settle();
  assert.equal(describeSave(view(h), "s").text, "Alterações locais pendentes");
  const states: Array<[EntryView["status"], RegExp]> = [["saving", /nuvem/], ["conflict", /Conflito/], ["paused", /Sessão expirada/], ["offline", /Sem conexão/]];
  for (const [status, pattern] of states) assert.match(describeSave({ ...view(h), status }, "s").text, pattern);
});
