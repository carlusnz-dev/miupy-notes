import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, isPaused, occurrenceDates, occursOn, weekdayOf, type Schedule } from "./recurrence.js";

const schedule = (patch: Partial<Schedule>): Schedule => ({ recurrence: { type: "daily", every: 1 }, startDate: "2026-01-01", endDate: null, pauses: [], ...patch });

test("dia da semana e aritmética de datas cruzam mês, ano e bissexto", () => {
  assert.equal(weekdayOf("1970-01-01"), 4); assert.equal(weekdayOf("2026-10-26"), 1); assert.equal(weekdayOf("1969-12-31"), 3);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01"); assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01"); assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("diária com intervalo conta a partir do início e respeita início e fim", () => {
  const s = schedule({ recurrence: { type: "daily", every: 3 }, startDate: "2026-12-30", endDate: "2027-01-08" });
  assert.deepEqual(occurrenceDates(s, "2026-12-01", "2027-02-01"), ["2026-12-30", "2027-01-02", "2027-01-05", "2027-01-08"]);
});

test("semanal repete no dia da semana do início, a cada N semanas", () => {
  const s = schedule({ recurrence: { type: "weekly", every: 2 }, startDate: "2026-10-26" }); // segunda
  assert.deepEqual(occurrenceDates(s, "2026-10-01", "2026-11-30"), ["2026-10-26", "2026-11-09", "2026-11-23"]);
  assert.equal(occursOn(s, "2026-10-19"), false);
});

test("dias da semana escolhidos (0 = domingo) atravessam a virada de ano", () => {
  const s = schedule({ recurrence: { type: "weekdays", days: [0, 3] }, startDate: "2026-12-20" });
  assert.deepEqual(occurrenceDates(s, "2026-12-20", "2027-01-04"), ["2026-12-20", "2026-12-23", "2026-12-27", "2026-12-30", "2027-01-03"]);
});

test("pausa vale em [from, until): sem data fica aberta, com data volta no dia final", () => {
  const s = schedule({ pauses: [{ from: "2026-02-27", until: "2026-03-02" }] });
  assert.deepEqual(occurrenceDates(s, "2026-02-26", "2026-03-03"), ["2026-02-26", "2026-03-02", "2026-03-03"]);
  assert.equal(isPaused([{ from: "2026-05-01", until: null }], "2030-01-01"), true);
  assert.equal(isPaused([{ from: "2026-05-01", until: null }], "2026-04-30"), false);
});

test("a data é de calendário: não muda com o fuso do servidor", () => {
  const original = process.env.TZ;
  try {
    for (const tz of ["Pacific/Kiritimati", "America/Sao_Paulo", "Pacific/Pago_Pago"]) {
      process.env.TZ = tz;
      assert.deepEqual(occurrenceDates(schedule({ startDate: "2026-03-07" }), "2026-03-07", "2026-03-09"), ["2026-03-07", "2026-03-08", "2026-03-09"]);
      assert.equal(weekdayOf("2026-03-08"), 0);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
