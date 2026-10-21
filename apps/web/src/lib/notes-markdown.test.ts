import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { detectEol, fromEditorText, insertCodeBlock, insertLink, taskMarkerOnLine, taskToggleChange, toEditorText, toggleBlock, wrapSelection, type EditorTarget } from "./notes-markdown";

function editor(doc: string, from = 0, to = from) {
  const target: EditorTarget & { state: EditorState } = {
    state: EditorState.create({ doc, selection: EditorSelection.single(from, to) }),
    dispatch(spec) { target.state = target.state.update(spec).state; },
  };
  return target;
}

test("fim de linha: detecta o dominante e o roundtrip de arquivos consistentes é exato", () => {
  for (const [eol, text] of [["\r\n", "a\r\n\r\nb\r\n"], ["\n", "a\n\nb\n"], ["\r", "a\r\rb\r"]] as const) {
    assert.equal(detectEol(text), eol);
    assert.equal(fromEditorText(toEditorText(text), detectEol(text)), text);
  }
  assert.equal(detectEol(""), "\n");
  assert.equal(toEditorText("a\r\nb\rc\nd"), "a\nb\nc\nd");
});

test("negrito, itálico e código envolvem e o segundo clique desfaz", () => {
  const cases: Array<[string, string, string]> = [["**", "**", "texto"], ["_", "_", "texto"], ["~~", "~~", "texto"], ["`", "`", "código"]];
  for (const [before, after, placeholder] of cases) {
    const e = editor("uma palavra aqui", 4, 11);
    wrapSelection(e, before, after, placeholder);
    assert.equal(e.state.doc.toString(), `uma ${before}palavra${after} aqui`);
    assert.equal(e.state.sliceDoc(e.state.selection.main.from, e.state.selection.main.to), "palavra", "seleção continua no texto");
    wrapSelection(e, before, after, placeholder);
    assert.equal(e.state.doc.toString(), "uma palavra aqui");
  }
});

test("sem seleção insere marcadores com o texto de exemplo selecionado", () => {
  const e = editor("", 0);
  wrapSelection(e, "**", "**", "texto");
  assert.equal(e.state.doc.toString(), "**texto**");
  assert.equal(e.state.sliceDoc(e.state.selection.main.from, e.state.selection.main.to), "texto");
});

test("desfazer funciona quando a seleção inclui os marcadores", () => {
  const e = editor("a **b** c", 2, 7);
  wrapSelection(e, "**", "**", "texto");
  assert.equal(e.state.doc.toString(), "a b c");
});

test("link e bloco de código preservam o texto selecionado", () => {
  const link = editor("ver aqui", 4, 8);
  insertLink(link);
  assert.equal(link.state.doc.toString(), "ver [aqui](https://)");
  const code = editor("x = 1", 0, 5);
  insertCodeBlock(code);
  assert.equal(code.state.doc.toString(), "```\nx = 1\n```");
  insertCodeBlock(code);
  assert.equal(code.state.doc.toString(), "x = 1");
});

test("blocos alternam por linha, trocam o prefixo anterior e preservam o recuo", () => {
  const e = editor("um\ndois\n  três", 0, 14);
  toggleBlock(e, "bullet");
  assert.equal(e.state.doc.toString(), "- um\n- dois\n  - três");
  toggleBlock(e, "ordered");
  assert.equal(e.state.doc.toString(), "1. um\n2. dois\n  3. três");
  toggleBlock(e, "task");
  assert.equal(e.state.doc.toString(), "- [ ] um\n- [ ] dois\n  - [ ] três");
  toggleBlock(e, "task");
  assert.equal(e.state.doc.toString(), "um\ndois\n  três");
  toggleBlock(e, "quote");
  assert.equal(e.state.doc.toString(), "> um\n> dois\n  > três");
  toggleBlock(e, "quote");
  const heading = editor("# velho\ntexto", 0, 3);
  toggleBlock(heading, "heading");
  assert.equal(heading.state.doc.toString(), "## velho\ntexto");
  toggleBlock(heading, "heading");
  assert.equal(heading.state.doc.toString(), "velho\ntexto");
});

test("alternar tarefa muda só o caractere do marcador", () => {
  const state = EditorState.create({ doc: "- [ ] a\n  * [x] b\ntexto" });
  assert.equal(taskMarkerOnLine(state, 0), 2);
  assert.equal(taskMarkerOnLine(state, 9), 12);
  assert.equal(taskMarkerOnLine(state, 20), null);
  assert.deepEqual(taskToggleChange(state, 2), { from: 3, to: 4, insert: "x" });
  assert.deepEqual(taskToggleChange(state, 12), { from: 13, to: 14, insert: " " });
  assert.equal(taskToggleChange(state, 0), null);
});
