import assert from "node:assert/strict";
import { test } from "node:test";
import { computeNoteStats, countWords, localDay } from "./note-stats";
import type { NoteOutput } from "./notes-api";

function note(createdAt: Date, body: string, tags: string[] = []): NoteOutput {
  const iso = createdAt.toISOString();
  return { id: crypto.randomUUID(), title: "t", body, tags, createdAt: iso, updatedAt: iso, version: 1 };
}

test("countWords ignora marcação Markdown e conta palavras acentuadas e com hífen", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("# Título\n\n**Texto em negrito** e _itálico_"), 6);
  assert.equal(countWords("- [ ] guarda-chuva d'água 42"), 3);
});

test("computeNoteStats conta janela, palavras e tags em ordem de frequência", () => {
  const now = new Date(2026, 9, 18, 15, 0);
  const stats = computeNoteStats([
    note(new Date(2026, 9, 18, 9, 0), "um dois", ["b", "a"]),
    note(new Date(2026, 9, 12, 23, 30), "três", ["a"]),
    note(new Date(2026, 8, 1), "fora da janela", ["c"]),
  ], 7, now);

  assert.equal(stats.total, 3);
  assert.equal(stats.createdInWindow, 2);
  assert.equal(stats.words, 6);
  assert.deepEqual(stats.tags, [{ tag: "a", count: 2 }, { tag: "b", count: 1 }, { tag: "c", count: 1 }]);
  assert.equal(stats.createdPerDay.length, 7);
  assert.deepEqual(stats.createdPerDay[0], { date: "2026-10-12", count: 1 });
  assert.deepEqual(stats.createdPerDay.at(-1), { date: localDay(now), count: 1 });
  assert.equal(stats.createdPerDay.reduce((sum, day) => sum + day.count, 0), 2);
});

test("computeNoteStats sem notas devolve zeros em todos os dias", () => {
  const stats = computeNoteStats([], 30, new Date(2026, 2, 31));
  assert.equal(stats.createdPerDay.length, 30);
  assert.ok(stats.createdPerDay.every((day) => day.count === 0));
  assert.equal(new Set(stats.createdPerDay.map((day) => day.date)).size, 30);
});
