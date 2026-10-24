import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PageHeader from "./PageHeader";

test("PageHeader renderiza h1 com ponto final, descrição, eyebrow e ações", () => {
  const html = renderToStaticMarkup(createElement(PageHeader, { title: "Notas", eyebrow: "ACERVO", description: "Ideias.", actions: createElement("button", null, "Nova"), id: "t" }));
  assert.match(html, /<h1 id="t">Notas<em>\.<\/em><\/h1>/);
  assert.match(html, /class="eyebrow">ACERVO</);
  assert.match(html, /class="lead">Ideias\.</);
  assert.match(html, /page-header-actions"><button>Nova/);
  assert.match(html, /page-header-hub/);
});

test("PageHeader omite eyebrow, descrição e ações quando não vêm, e respeita size e dot", () => {
  const html = renderToStaticMarkup(createElement(PageHeader, { title: "Mercado", size: "utility", dot: false }));
  assert.doesNotMatch(html, /eyebrow|lead|page-header-actions/);
  assert.match(html, /page-header-utility/);
  assert.match(html, /<h1>Mercado<\/h1>/);
});
