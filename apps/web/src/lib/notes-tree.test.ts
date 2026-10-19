import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoteOutput } from "./notes-api";
import type { FolderOutput } from "./notes-folders-api";
import { buildNotesTree, folderChoices } from "./notes-tree";

const now = "2026-10-19T12:00:00.000Z";
const folder = (id: string, name: string, parentId: string | null = null): FolderOutput => ({ id, name, parentId, createdAt: now, updatedAt: now, version: 1 });
const note = (id: string, title: string, folderId: string | null = null): NoteOutput => ({ id, title, body: "", tags: [], folderId, createdAt: now, updatedAt: now, version: 1 });

test("agrupa pastas e notas em árvore ordenada com contagem recursiva", () => {
  const tree = buildNotesTree(
    [folder("b", "Zeta"), folder("a", "Ação"), folder("c", "2026", "a"), folder("d", "10", "a"), folder("e", "9", "a")],
    [note("1", "banana", "c"), note("2", "Abacate", "c"), note("3", "raiz"), note("4", "Outra", "a")],
  );
  assert.deepEqual(tree.folders.map((node) => node.folder.name), ["Ação", "Zeta"]);
  const acao = tree.folders[0];
  assert.deepEqual(acao.folders.map((node) => node.folder.name), ["9", "10", "2026"], "ordem numérica");
  assert.deepEqual(acao.folders[2].notes.map((item) => item.title), ["Abacate", "banana"]);
  assert.equal(acao.noteCount, 3);
  assert.equal(tree.folders[1].noteCount, 0);
  assert.deepEqual(tree.notes.map((item) => item.title), ["raiz"]);
});

test("notas e pastas órfãs ou em ciclo vão para a raiz em vez de sumir", () => {
  const tree = buildNotesTree(
    [folder("x", "Ciclo X", "y"), folder("y", "Ciclo Y", "x"), folder("z", "Solta", "inexistente")],
    [note("1", "órfã", "inexistente"), note("2", "legada")],
  );
  assert.deepEqual(tree.folders.map((node) => node.folder.name).sort(), ["Ciclo X", "Ciclo Y", "Solta"]);
  assert.deepEqual(tree.notes.map((item) => item.title).sort(), ["legada", "órfã"]);
  const sem = buildNotesTree([], [{ ...note("3", "sem campo"), folderId: undefined }]);
  assert.equal(sem.notes.length, 1, "nota sem folderId fica na raiz");
});

test("escolhas de destino listam as pastas em ordem de árvore com o caminho", () => {
  const tree = buildNotesTree([folder("a", "A"), folder("b", "B", "a"), folder("c", "C", "b"), folder("d", "D")], []);
  assert.deepEqual(folderChoices(tree).map((choice) => [choice.label, choice.depth]), [["A", 0], ["A / B", 1], ["A / B / C", 2], ["D", 0]]);
});
