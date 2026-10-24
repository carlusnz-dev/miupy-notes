import assert from "node:assert/strict";
import test from "node:test";
import { centeredScrollLeft, initialScrollMin, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, touchPhase } from "./touch-gesture";

test("antes do limiar, parado ou com tremor segue pendente", () => {
  assert.equal(touchPhase(0, 0), "pending");
  assert.equal(touchPhase(LONG_PRESS_MS - 1, LONG_PRESS_SLOP_PX), "pending");
});

test("antes do limiar, movimento além da tolerância é rolagem (o toque é abandonado)", () => {
  assert.equal(touchPhase(100, LONG_PRESS_SLOP_PX + 1), "scroll");
  assert.equal(touchPhase(LONG_PRESS_MS - 1, 40), "scroll");
});

test("no limiar de tempo o bloco entra no modo mover, mesmo com movimento depois", () => {
  assert.equal(touchPhase(LONG_PRESS_MS, 0), "armed");
  assert.equal(touchPhase(LONG_PRESS_MS + 500, 120), "armed");
});

test("a grade abre uma hora antes de agora quando hoje está visível", () => {
  assert.equal(initialScrollMin(9 * 60, 15 * 60 + 20), 14 * 60 + 20);
  assert.equal(initialScrollMin(null, 30), 0);
});

test("sem hoje, abre perto do primeiro evento, no máximo às 7h", () => {
  assert.equal(initialScrollMin(null, null), 6 * 60 + 30);
  assert.equal(initialScrollMin(9 * 60, null), 6 * 60 + 30);
  assert.equal(initialScrollMin(5 * 60, null), 4 * 60 + 30);
  assert.equal(initialScrollMin(0, null), 0);
});

test("centraliza o dia de hoje e respeita as pontas", () => {
  const box = { left: 0, width: 390, scrollLeft: 0, scrollWidth: 700 };
  assert.equal(centeredScrollLeft(box, { left: 400, width: 100 }), 255);
  assert.equal(centeredScrollLeft(box, { left: 50, width: 100 }), 0);
  assert.equal(centeredScrollLeft(box, { left: 640, width: 100 }), 310);
  assert.equal(centeredScrollLeft({ ...box, scrollLeft: 100 }, { left: 100, width: 100 }), 55);
});
