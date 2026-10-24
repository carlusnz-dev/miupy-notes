import assert from "node:assert/strict";
import test from "node:test";
import { firstInvalid, validateLibraryForm, type LibraryFormValues } from "./form";
import { countLabel, emptyContent } from "./view";

const valid: LibraryFormValues = { title: "Atlas", creator: "", year: "", rating: "", tags: "", comment: "", externalUrl: "", coverUrl: "", startedOn: "", finishedOn: "" };

test("countLabel concorda com o plural de pt-BR (zero e muitos no plural)", () => {
  assert.equal(countLabel(0), "0 obras");
  assert.equal(countLabel(1), "1 obra");
  assert.equal(countLabel(2), "2 obras");
  assert.equal(countLabel(28), "28 obras");
});

test("emptyContent separa busca sem resultado (limpar filtros) de acervo vazio (adicionar obra)", () => {
  const filtered = emptyContent(true, false);
  assert.equal(filtered.kind, "no-results");
  assert.equal(filtered.title, "Nenhuma obra encontrada");
  assert.equal(filtered.action, "Limpar filtros");
  const empty = emptyContent(false, false);
  assert.equal(empty.kind, "empty-library");
  assert.equal(empty.title, "Sua próxima descoberta começa aqui");
  assert.equal(empty.action, "Adicionar obra");
  const paged = emptyContent(true, true);
  assert.equal(paged.title, "Nenhuma obra nesta página");
  assert.match(paged.text, /próxima página/);
  assert.equal(paged.kind, "no-results");
});

test("validateLibraryForm aceita o mínimo e valores no limite", () => {
  assert.deepEqual(validateLibraryForm(valid), {});
  assert.deepEqual(validateLibraryForm({ ...valid, year: "9999", rating: "0", tags: Array.from({ length: 20 }, (_, i) => `t${i}`).join(","), externalUrl: "https://exemplo.com/a", startedOn: "2026-01-01", finishedOn: "2026-01-01" }), {});
});

test("validateLibraryForm devolve uma mensagem por campo inválido", () => {
  const errors = validateLibraryForm({ ...valid, title: "   ", year: "1.5", rating: "6", tags: "a,".repeat(21), externalUrl: "ftp://x.com", coverUrl: "sem url", startedOn: "2026-02-01", finishedOn: "2026-01-01" });
  assert.equal(errors.title, "Informe o título da obra.");
  assert.match(errors.year!, /entre 1 e 9999/);
  assert.match(errors.rating!, /0 a 5/);
  assert.match(errors.tags!, /20 tags/);
  assert.match(errors.externalUrl!, /http/);
  assert.match(errors.coverUrl!, /http/);
  assert.match(errors.dates!, /igual ou posterior/);
  assert.equal(errors.creator, undefined);
});

test("firstInvalid segue a ordem do formulário, não a ordem das chaves", () => {
  assert.equal(firstInvalid({ coverUrl: "x", rating: "y", dates: "z" }), "rating");
  assert.equal(firstInvalid({ coverUrl: "x", title: "y" }), "title");
  assert.equal(firstInvalid({}), undefined);
});
