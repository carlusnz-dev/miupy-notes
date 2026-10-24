import assert from "node:assert/strict";
import test from "node:test";
import { initialFields } from "./draft";
import { applyDuration, endClock } from "./quick-times";

test("fim = início + duração, e passar da meia-noite fecha às 23:59", () => {
  assert.equal(endClock("09:00", 60), "10:00");
  assert.equal(endClock("22:30", 30), "23:00");
  assert.equal(endClock("23:00", 60), "23:59");
  assert.equal(endClock("23:45", 120), "23:59");
});

test("duração em minutos mantém o dia e o início", () => {
  const base = { ...initialFields(null, { year: 2026, month: 10, day: 24 }), startTime: "14:00" };
  const next = applyDuration(base, "120");
  assert.equal(next.allDay, false);
  assert.equal(next.startTime, "14:00");
  assert.equal(next.endTime, "16:00");
  assert.equal(next.endDate, base.startDate);
});

test("dia inteiro liga allDay e usa só a data de início; voltar a uma duração desliga", () => {
  const base = { ...initialFields(null, { year: 2026, month: 10, day: 24 }), startTime: "14:00" };
  const day = applyDuration(base, "day");
  assert.equal(day.allDay, true);
  assert.equal(day.endDate, base.startDate);
  assert.equal(applyDuration(day, "30").allDay, false);
});
