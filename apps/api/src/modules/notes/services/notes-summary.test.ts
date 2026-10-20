import assert from "node:assert/strict";
import { test } from "node:test";
import { Note } from "../domain/note.js";
import { MemoryNotesRepository } from "../repository/memory-notes.repository.js";
import { summarizeNotes } from "./notes-summary.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("API-SUM-01 resumo lê todas páginas, isola dono e conta Markdown/dias sem corpos na saída", async () => {
  const repository = new MemoryNotesRepository();
  for (let n = 0; n < 105; n++) await repository.create(new Note(id(n), "alice", `Nota ${n}`, "# guarda-chuva d'água 42", ["a"], null, "2026-10-20T01:00:00.000Z", "2026-10-20T01:00:00.000Z", 1));
  await repository.create(new Note(id(200), "bob", "Privada", "segredo", ["segredo"], null, "2026-10-20T01:00:00.000Z", "2026-10-20T01:00:00.000Z", 1));
  const list = repository.list.bind(repository);
  let reads = 0;
  repository.list = (...args) => { reads++; return list(...args); };
  const result = await summarizeNotes(repository, "alice", { days: 7, offsetMinutes: -180 }, new Date("2026-10-20T12:00:00Z"));
  assert.equal(reads, 2);
  assert.equal(result.total, 105);
  assert.equal(result.words, 315);
  assert.equal(result.averageWords, 3);
  assert.equal(result.characters, 105 * "# guarda-chuva d'água 42".length);
  assert.equal(result.createdInWindow, 105);
  assert.deepEqual(result.createdPerDay.at(-2), { date: "2026-10-19", count: 105 });
  assert.deepEqual(result.tags, [{ tag: "a", count: 105 }]);
  assert.equal(result.topNotes.length, 10);
  assert.equal(JSON.stringify(result).includes('"body"'), false);
  assert.equal(result.first, "2026-10-20T01:00:00.000Z");
  assert.equal(result.last, result.first);
});

test("API-SUM-02 resumo vazio retorna janela zerada sem truncamento", async () => {
  const result = await summarizeNotes(new MemoryNotesRepository(), "alice", { days: 30, offsetMinutes: 0 });
  assert.equal(result.total, 0);
  assert.equal(result.first, null);
  assert.equal(result.last, null);
  assert.equal(result.createdPerDay.length, 30);
  assert.ok(result.createdPerDay.every((day) => day.count === 0));
  assert.equal(result.topNotes.length, 0);
});

test("API-SUM-03 resumo continua além de cinquenta páginas e cinco mil notas", async () => {
  const repository = new MemoryNotesRepository();
  let reads = 0;
  repository.list = async (owner, limit, cursor) => {
    assert.equal(owner, "alice");
    assert.equal(limit, 100);
    const page = Number(cursor ?? 0);
    reads++;
    return { items: Array.from({ length: 100 }, (_, index) => new Note(id(page * 100 + index), owner, "t", "uma", [], null, "2026-10-20T12:00:00.000Z", "2026-10-20T12:00:00.000Z", 1)), nextCursor: page < 50 ? String(page + 1) : null };
  };
  const result = await summarizeNotes(repository, "alice", { days: 90, offsetMinutes: 0 });
  assert.equal(reads, 51);
  assert.equal(result.total, 5100);
  assert.equal(result.words, 5100);
  assert.equal(result.topNotes.length, 10);
});
