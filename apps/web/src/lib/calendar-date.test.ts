import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, addMonths, daysInMonth, fromDisplay, fromIso, isValidDate, maskDisplay, toDisplay, toIso, todayLocal, weekday } from "./calendar-date";

test("anos bissextos e datas inexistentes", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(fromDisplay("29/02/2024")?.day, 29);
  for (const text of ["29/02/2026", "31/04/2026", "00/10/2026", "10/13/2026", "1/1/2026", "10/10/26", ""]) assert.equal(fromDisplay(text), null, text);
  assert.equal(isValidDate({ year: 2026, month: 2, day: 29 }), false);
});
test("conversão ISO e exibição sem desvio de fuso", () => {
  assert.equal(toIso({ year: 2026, month: 10, day: 19 }), "2026-10-19");
  assert.equal(toDisplay(fromIso("2026-01-05")!), "05/01/2026");
  assert.equal(fromIso("2026-02-30"), null);
  assert.equal(toIso(todayLocal(new Date(2026, 11, 31, 23, 59))), "2026-12-31");
  assert.equal(toIso(todayLocal(new Date(2027, 0, 1, 0, 1))), "2027-01-01");
});
test("dia da semana e navegação", () => {
  assert.equal(weekday({ year: 2026, month: 10, day: 19 }), 1); // segunda-feira
  assert.equal(weekday({ year: 2024, month: 2, day: 29 }), 4);
  assert.equal(toIso(addDays({ year: 2024, month: 2, day: 28 }, 2)), "2024-03-01");
  assert.equal(toIso(addDays({ year: 2026, month: 1, day: 1 }, -1)), "2025-12-31");
  assert.equal(toIso(addDays({ year: 2026, month: 10, day: 19 }, 7)), "2026-10-26");
  assert.equal(toIso(addMonths({ year: 2026, month: 1, day: 31 }, 1)), "2026-02-28");
  assert.equal(toIso(addMonths({ year: 2024, month: 1, day: 31 }, 1)), "2024-02-29");
  assert.equal(toIso(addMonths({ year: 2026, month: 1, day: 15 }, -1)), "2025-12-15");
  assert.equal(toIso(addMonths({ year: 2026, month: 12, day: 15 }, 13)), "2028-01-15");
});
test("máscara dd/mm/aaaa ao vivo", () => {
  assert.equal(maskDisplay("1"), "1");
  assert.equal(maskDisplay("1910"), "19/10");
  assert.equal(maskDisplay("19102026"), "19/10/2026");
  assert.equal(maskDisplay("19/10/2026999"), "19/10/2026");
  assert.equal(maskDisplay("ab"), "");
});
