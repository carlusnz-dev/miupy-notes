import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeTags, normalizeTag, splitDraft } from "./notes-tags";

test("normaliza # inicial, espaços e tamanho", () => {
  assert.equal(normalizeTag("  #ideia ", 40), "ideia");
  assert.equal(normalizeTag("##", 40), "");
  assert.equal(normalizeTag("a".repeat(50), 40).length, 40);
});

test("espaço, vírgula e quebra de linha confirmam; o último pedaço sem separador fica como rascunho", () => {
  assert.deepEqual(splitDraft("ideia "), { complete: ["ideia"], rest: "" });
  assert.deepEqual(splitDraft("a b,c"), { complete: ["a", "b"], rest: "c" });
  assert.deepEqual(splitDraft("a\nb\n"), { complete: ["a", "b"], rest: "" });
  assert.deepEqual(splitDraft("so"), { complete: [], rest: "so" });
  assert.deepEqual(splitDraft("  "), { complete: [], rest: "" });
});

test("mantém ordem, ignora duplicadas sem diferenciar caixa e respeita o limite", () => {
  assert.deepEqual(mergeTags(["Ideia"], ["ideia", "#nova", "", "x"], 3, 40), { next: ["Ideia", "nova", "x"], added: ["nova", "x"], skipped: ["ideia"] });
  assert.deepEqual(mergeTags(["a", "b"], ["c", "d"], 3, 40), { next: ["a", "b", "c"], added: ["c"], skipped: ["d"] });
  assert.deepEqual(mergeTags([], ["x", "x"], 20, 40).next, ["x"]);
});
