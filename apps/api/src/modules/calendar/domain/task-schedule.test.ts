import assert from "node:assert/strict";
import { test } from "node:test";
import { isTaskOverdue } from "./task-schedule.js";

const now = { date: "2026-10-23", time: "14:30" };
const task = (extra: object) => ({ dueDate: "2026-10-23", dueTime: null, status: "pending" as const, ...extra });

test("atrasada: dia anterior, ou hoje com hora já passada", () => {
  assert.equal(isTaskOverdue(task({ dueDate: "2026-10-22" }), now), true);
  assert.equal(isTaskOverdue(task({ dueTime: "14:29" }), now), true);
});

test("não atrasada: hoje sem hora, hora futura ou igual, dia futuro e sem prazo", () => {
  assert.equal(isTaskOverdue(task({}), now), false);
  assert.equal(isTaskOverdue(task({ dueTime: "14:30" }), now), false);
  assert.equal(isTaskOverdue(task({ dueTime: "18:00" }), now), false);
  assert.equal(isTaskOverdue(task({ dueDate: "2026-10-24" }), now), false);
  assert.equal(isTaskOverdue(task({ dueDate: null }), now), false);
});

test("concluída nunca é atrasada", () => {
  assert.equal(isTaskOverdue(task({ dueDate: "2026-01-01", status: "completed" }), now), false);
});
