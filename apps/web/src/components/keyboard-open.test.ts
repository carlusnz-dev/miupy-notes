import assert from "node:assert/strict";
import { test } from "node:test";
import { isKeyboardOpen, isTextEntry } from "./keyboard-open";

test("teclado aberto: viewport encolheu muito e um campo de texto está focado", () => {
  assert.equal(isKeyboardOpen({ baseline: 844, viewportHeight: 520, textFocused: true }), true);
});

test("sem campo de texto focado a redução não conta (zoom ou barra de endereço)", () => {
  assert.equal(isKeyboardOpen({ baseline: 844, viewportHeight: 520, textFocused: false }), false);
});

test("redução pequena não conta como teclado", () => {
  assert.equal(isKeyboardOpen({ baseline: 844, viewportHeight: 760, textFocused: true }), false);
  assert.equal(isKeyboardOpen({ baseline: 844, viewportHeight: 844, textFocused: true }), false);
});

test("isTextEntry reconhece campos que abrem o teclado", () => {
  assert.equal(isTextEntry({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntry({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTextEntry({ tagName: "INPUT" }), true);
  assert.equal(isTextEntry({ tagName: "DIV", isContentEditable: true }), true);
});

test("isTextEntry ignora controles sem digitação", () => {
  assert.equal(isTextEntry(null), false);
  assert.equal(isTextEntry({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTextEntry({ tagName: "BUTTON" }), false);
  assert.equal(isTextEntry({ tagName: "BODY" }), false);
});
