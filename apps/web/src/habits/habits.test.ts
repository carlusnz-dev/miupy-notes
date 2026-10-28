import assert from "node:assert/strict";
import { test } from "node:test";
import { dayView, toggleRequest } from "./day-data";
import { buildHabitInput, type HabitFormValues } from "./form";
import { currentPause, recurrenceLabel } from "./labels";
import type { Occurrence } from "../lib/habits-api";

const values = (patch: Partial<HabitFormValues> = {}): HabitFormValues => ({
  title: " Ler ", description: "", kind: "other", priority: "medium", recurrence: "daily", every: "1", days: [], startDate: "2026-10-26", endDate: "", time: "", ...patch,
});

test("monta a entrada da API com trim, nulos e dias ordenados", () => {
  assert.deepEqual(buildHabitInput(values()), { input: { title: "Ler", description: "", kind: "other", priority: "medium", recurrence: { type: "daily", every: 1 }, startDate: "2026-10-26", endDate: null, time: null } });
  const result = buildHabitInput(values({ recurrence: "weekdays", days: [5, 1], time: "07:30", endDate: "2026-12-31" }));
  assert.ok("input" in result); assert.deepEqual(result.input.recurrence, { type: "weekdays", days: [1, 5] }); assert.equal(result.input.time, "07:30");
});

test("aponta o campo inválido", () => {
  const result = buildHabitInput(values({ title: " ", every: "0", startDate: "", time: "7:30", endDate: "2026-01-01" }));
  assert.ok("errors" in result); assert.deepEqual(Object.keys(result.errors).sort(), ["every", "startDate", "time", "title"]);
  const weekdays = buildHabitInput(values({ recurrence: "weekdays" }));
  assert.ok("errors" in weekdays); assert.ok(weekdays.errors.days);
  const range = buildHabitInput(values({ endDate: "2026-10-01" }));
  assert.ok("errors" in range); assert.ok(range.errors.endDate);
});

test("rótulos de recorrência e pausa vigente", () => {
  assert.equal(recurrenceLabel({ type: "daily", every: 1 }), "Todo dia"); assert.equal(recurrenceLabel({ type: "daily", every: 3 }), "A cada 3 dias");
  assert.equal(recurrenceLabel({ type: "weekly", every: 2 }), "A cada 2 semanas"); assert.equal(recurrenceLabel({ type: "weekdays", days: [5, 1] }), "seg, sex");
  const pauses = [{ from: "2026-10-01", until: "2026-10-05" }, { from: "2026-10-27", until: null }];
  assert.deepEqual(currentPause(pauses, "2026-10-26"), pauses[1]); assert.equal(currentPause([pauses[0]], "2026-10-26"), undefined);
});

const occurrence = (date: string, patch: Partial<Occurrence> = {}): Occurrence => ({
  habitId: "00000000-0000-4000-8000-000000000001", date, time: null, title: "Ler", kind: "other", priority: "medium", status: "pending", completedAt: null, points: 10, ...patch,
});

test("dia visível sem dados próprios não mostra nem aceita ações sobre o dia anterior", () => {
  const loaded = { day: "2026-10-26", items: [occurrence("2026-10-26")] };
  // Carregou 26/10, avançou para 27/10 e a leitura falhou: nada do dia 26 fica sob o cabeçalho do dia 27.
  assert.equal(dayView(loaded, "2026-10-27", true), null);
  assert.equal(dayView(loaded, "2026-10-27", false), null);
  // Clique em item antigo que ainda esteja em memória não gera PUT.
  assert.equal(toggleRequest(dayView(loaded, "2026-10-27", true), "2026-10-27", loaded.items[0]), null);
  assert.equal(toggleRequest(dayView(loaded, "2026-10-26", false), "2026-10-27", loaded.items[0]), null);
});

test("dia carregado alterna a ocorrência; leitura falhada desabilita as ações", () => {
  const item = occurrence("2026-10-26");
  const loaded = { day: "2026-10-26", items: [item] };
  assert.deepEqual(toggleRequest(dayView(loaded, "2026-10-26", false), "2026-10-26", item), { habitId: item.habitId, date: "2026-10-26", status: "completed" });
  const done = occurrence("2026-10-26", { status: "completed" });
  assert.equal(toggleRequest(dayView({ day: "2026-10-26", items: [done] }, "2026-10-26", false), "2026-10-26", done)?.status, "pending");
  const failed = dayView(loaded, "2026-10-26", true);
  assert.deepEqual(failed, { items: [item], actionable: false });
  assert.equal(toggleRequest(failed, "2026-10-26", item), null);
  assert.equal(dayView(null, "2026-10-26", false), null);
});
