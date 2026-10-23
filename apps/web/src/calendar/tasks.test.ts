import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskOutput } from "../lib/calendar-api";
import { byDue, localNow, tasksOnDay } from "./tasks";

let n = 0;
const make = (extra: Partial<TaskOutput>): TaskOutput => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, title: "T", description: "", dueDate: null, dueTime: null, status: "pending", completedAt: null, inGoogle: false,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", version: 1, ...extra,
});

test("localNow devolve data e hora locais com zeros à esquerda", () => {
  assert.deepEqual(localNow(new Date(2026, 0, 5, 7, 4)), { date: "2026-01-05", time: "07:04" });
});

test("tasksOnDay separa com hora (ordenadas) e sem hora, só do dia pedido", () => {
  const tasks = [make({ title: "b", dueDate: "2026-10-23", dueTime: "15:00" }), make({ title: "a", dueDate: "2026-10-23", dueTime: "09:00" }), make({ title: "c", dueDate: "2026-10-23" }), make({ dueDate: "2026-10-24" }), make({})];
  const { timed, untimed } = tasksOnDay(tasks, { year: 2026, month: 10, day: 23 });
  assert.deepEqual(timed.map((task) => task.title), ["a", "b"]);
  assert.deepEqual(untimed.map((task) => task.title), ["c"]);
});

test("byDue ordena por data e hora, deixando as sem data por último", () => {
  const sorted = [make({ title: "sem" }), make({ title: "tarde", dueDate: "2026-10-23", dueTime: "18:00" }), make({ title: "cedo", dueDate: "2026-10-23", dueTime: "08:00" }), make({ title: "ontem", dueDate: "2026-10-22" })].sort(byDue);
  assert.deepEqual(sorted.map((task) => task.title), ["ontem", "cedo", "tarde", "sem"]);
});
