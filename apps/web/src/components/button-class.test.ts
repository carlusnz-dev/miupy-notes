import assert from "node:assert/strict";
import test from "node:test";
import { buttonClass } from "./button-class";

test("buttonClass gera variante e tamanho", () => {
  assert.equal(buttonClass("danger", "lg"), "ui-button ui-button-danger ui-button-lg");
  assert.equal(buttonClass("primary", "sm", "notes-new"), "ui-button ui-button-primary ui-button-sm notes-new");
});

test("buttonClass cobre as três alturas e a variante de exclusão", () => {
  for (const size of ["sm", "md", "lg"] as const) assert.match(buttonClass("secondary", size), new RegExp(`ui-button-${size}$`));
  assert.match(buttonClass("danger", "md"), /ui-button-danger/);
});
