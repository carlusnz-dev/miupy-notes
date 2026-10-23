import assert from "node:assert/strict";
import { test } from "node:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { buildLivePreview, buildTableBlocks, splitTableRow } from "./live-markdown";

const SAMPLE = [
  "# Título com **negrito**", "", "Setext", "======", "",
  "Texto com **negrito**, _itálico_, ~~riscado~~, `código` e [um link](https://example.com \"título\") <https://a.example> https://b.example.",
  "![imagem](https://example.com/i.png)", "",
  "- item", "* outro", "1. ordenado", "- [ ] pendente", "- [x] feita **forte**", "",
  "> citação", "> > aninhada", "", "---", "", "```ts", "const a = **não é negrito**;", "```", "", "    indentado", "",
  "| a | b |", "|---|---|", "| 1 | 2 |", "", "Fim com acentuação, emoji 🙂 e \\* escape.",
].join("\n");

function stateAt(doc: string, ...cursor: [number, number?]) {
  return EditorState.create({ doc, selection: EditorSelection.single(cursor[0] ?? 0, cursor[1] ?? cursor[0] ?? 0), extensions: [markdown({ base: markdownLanguage })] });
}

function hidden(state: EditorState) {
  const found: Array<{ from: number; to: number; text: string; widget: boolean }> = [];
  buildLivePreview(state).between(0, state.doc.length, (from, to, value) => {
    // Decoration.replace é a única com `point` e extensão: linhas são pontuais e marcas não são `point`.
    if (to > from && (value as unknown as { point: boolean }).point) found.push({ from, to, text: state.sliceDoc(from, to), widget: !!value.spec.widget });
  });
  return found;
}

test("só marcadores de sintaxe são escondidos; texto do usuário nunca some", () => {
  const marker = /^[#*_~`>\-\s]+$|^\]\(.*\)$|^[[<>]$/;
  for (let pos = 0; pos <= SAMPLE.length; pos += 3) {
    for (const range of hidden(stateAt(SAMPLE, pos))) {
      if (range.widget) continue;
      assert.match(range.text, marker, `cursor ${pos}: escondeu ${JSON.stringify(range.text)}`);
    }
  }
});

test("marcadores aparecem quando o cursor toca o trecho e somem quando sai", () => {
  const doc = "Olá **mundo** fim";
  assert.deepEqual(hidden(stateAt(doc, 0)).map((range) => range.text), ["**", "**"]);
  assert.deepEqual(hidden(stateAt(doc, 8)), []);
  assert.deepEqual(hidden(stateAt(doc, 4)).map((range) => range.text), [], "encostar na borda revela");
  assert.deepEqual(hidden(stateAt(doc, 17)).map((range) => range.text), ["**", "**"]);
});

test("títulos escondem # e espaço fora da linha ativa", () => {
  const doc = "## Título\n\ntexto";
  assert.deepEqual(hidden(stateAt(doc, 12)).map((range) => range.text), ["## "]);
  assert.deepEqual(hidden(stateAt(doc, 3)), []);
});

test("links escondem colchetes e destino, mas só quando inativos", () => {
  const doc = "ver [site](https://example.com \"t\") hoje";
  assert.deepEqual(hidden(stateAt(doc, 0)).map((range) => range.text), ["[", "](https://example.com \"t\")"]);
  assert.deepEqual(hidden(stateAt(doc, 7)), []);
});

test("citações, listas e tarefas trocam marcador por widget fora da linha ativa", () => {
  const doc = "> citação\n\n- item\n- [ ] tarefa\n\ntexto";
  const outside = hidden(stateAt(doc, doc.length));
  assert.deepEqual(outside.map((range) => [range.text, range.widget]), [["> ", false], ["-", true], ["- ", false], ["[ ]", true]]);
  const inItem = hidden(stateAt(doc, 14));
  assert.deepEqual(inItem.map((range) => range.text), ["> ", "- ", "[ ]"], "a linha ativa ('- item') mostra o '-' cru; o '- ' da tarefa inativa some e o checkbox permanece");
});

test("blocos de código não recebem estilo inline e mantêm a cerca visível", () => {
  const doc = "```\n**x** _y_\n```\n\nfim";
  assert.deepEqual(hidden(stateAt(doc, doc.length)), []);
});

test("decorações não alteram o documento e aceitam seleção que atravessa blocos", () => {
  const state = stateAt(SAMPLE, 5, SAMPLE.length - 5);
  buildLivePreview(state);
  assert.equal(state.doc.toString(), SAMPLE);
  for (const range of hidden(state)) assert.ok(range.from >= 0 && range.to <= SAMPLE.length && range.to > range.from);
});

test("documento vazio e só com espaços não geram decorações", () => {
  for (const doc of ["", "   ", "\n\n"]) assert.deepEqual(hidden(stateAt(doc, 0)), []);
});

function blocks(state: EditorState) {
  const found: Array<{ from: number; to: number }> = [];
  buildTableBlocks(state).between(0, state.doc.length, (from, to) => { found.push({ from, to }); });
  return found;
}

test("imagem http(s) vira widget fora da seleção; outros esquemas e imagem ativa ficam como texto", () => {
  const safe = "antes ![alt](https://example.com/a.png) depois";
  assert.deepEqual(hidden(stateAt(safe, 0)).map((range) => [range.text, range.widget]), [["![alt](https://example.com/a.png)", true]]);
  assert.deepEqual(hidden(stateAt(safe, 12)), [], "cursor dentro revela o Markdown");
  for (const url of ["data:image/png;base64,AAAA", "javascript:alert(1)", "file:///etc/passwd", "relativa/a.png", "//example.com/a.png"]) {
    const doc = `![x](${url}) fim`;
    assert.deepEqual(hidden(stateAt(doc, doc.length)), [], url);
  }
});

test("tabela vira bloco quando a seleção está fora e volta a texto quando o cursor entra", () => {
  const doc = "texto\n\n| a | b |\n|:--|--:|\n| 1 | **2** |\n\nfim";
  const table = { from: 7, to: doc.indexOf("\n\nfim") };
  assert.deepEqual(blocks(stateAt(doc, 0)), [table]);
  assert.deepEqual(blocks(stateAt(doc, doc.length)), [table]);
  assert.deepEqual(blocks(stateAt(doc, 10)), [], "cursor numa célula");
  assert.deepEqual(blocks(stateAt(doc, table.from)), [], "tocar a borda revela");
  assert.deepEqual(blocks(stateAt("> | a | b |\n> |---|---|\n> | 1 | 2 |", 0)), [], "tabela dentro de citação permanece texto");
  assert.deepEqual(blocks(stateAt("- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |", 0)), [], "tabela dentro de lista permanece texto");
  const two = "| a |\n|---|\n| 1 |\n\nmeio\n\n| b |\n|---|\n| 2 |";
  assert.equal(blocks(stateAt(two, two.indexOf("meio"))).length, 2, "várias tabelas no nível do documento");
});

test("células: pipes opcionais nas bordas, escape e deslocamentos", () => {
  assert.deepEqual(splitTableRow("| a | b |"), [{ text: "a", from: 2 }, { text: "b", from: 6 }]);
  assert.deepEqual(splitTableRow("a | b"), [{ text: "a", from: 0 }, { text: "b", from: 4 }]);
  assert.deepEqual(splitTableRow("| x \\| y |  |").map((cell) => cell.text), ["x | y", ""]);
  assert.deepEqual(splitTableRow("|---|:-:|").map((cell) => cell.text), ["---", ":-:"]);
});
