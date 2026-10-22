import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWall, wallClock, wallDate, wallTimeInZone, wallTimeToInstant, wallTimeToInstantStrict, zoneChoices } from "./time.js";

test("instante UTC vira horário de parede em cada fuso", () => {
  assert.deepEqual(wallTimeInZone("2026-10-21T12:00:00.000Z", "America/Sao_Paulo"), { year: 2026, month: 10, day: 21, hour: 9, minute: 0 });
  assert.deepEqual(wallTimeInZone("2026-10-21T12:00:00.000Z", "Asia/Tokyo"), { year: 2026, month: 10, day: 21, hour: 21, minute: 0 });
  assert.deepEqual(wallTimeInZone("2026-10-21T23:30:00.000Z", "Asia/Tokyo"), { year: 2026, month: 10, day: 22, hour: 8, minute: 30 });
});

test("horário de parede volta ao mesmo instante (ida e volta)", () => {
  for (const zone of ["America/Sao_Paulo", "Europe/Lisbon", "Asia/Kolkata", "UTC", "America/New_York"]) {
    const instant = "2026-07-01T15:45:00.000Z";
    assert.equal(wallTimeToInstant(wallTimeInZone(instant, zone), zone), instant, zone);
  }
});

test("horário de verão: mesmo relógio, deslocamentos diferentes", () => {
  // Lisboa: UTC+0 no inverno, UTC+1 no verão.
  assert.equal(wallTimeToInstant({ year: 2026, month: 1, day: 15, hour: 9, minute: 0 }, "Europe/Lisbon"), "2026-01-15T09:00:00.000Z");
  assert.equal(wallTimeToInstant({ year: 2026, month: 7, day: 15, hour: 9, minute: 0 }, "Europe/Lisbon"), "2026-07-15T08:00:00.000Z");
  // Nova York, salto de 2026-03-08 (02:30 não existe): resolve para um instante que ainda é "o mesmo dia".
  const gap = wallTimeToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York");
  assert.equal(wallTimeInZone(gap, "America/New_York").day, 8);
  // Repetido em 2026-11-01 01:30: primeira ocorrência (EDT, UTC-4).
  assert.equal(wallTimeToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York"), "2026-11-01T05:30:00.000Z");
});

test("parseWall valida data e hora reais", () => {
  assert.deepEqual(parseWall("2026-10-21", "09:05"), { year: 2026, month: 10, day: 21, hour: 9, minute: 5 });
  assert.equal(parseWall("2026-02-30", "09:00"), null);
  assert.equal(parseWall("2026-10-21", "24:00"), null);
  assert.equal(parseWall("2026-10-21", "9:00"), null);
});

test("formatação e opções de fuso sem repetição nem fuso inválido", () => {
  assert.equal(wallDate({ year: 2026, month: 3, day: 4 }), "2026-03-04");
  assert.equal(wallClock({ hour: 7, minute: 5 }), "07:05");
  const choices = zoneChoices("Asia/Tokyo", "Nada/Nada", "UTC", null);
  assert.equal(choices[0], "Asia/Tokyo");
  assert.equal(choices.filter((zone) => zone === "UTC").length, 1);
  assert.equal(choices.includes("Nada/Nada"), false);
});

test("regressão: horário inexistente no salto do horário de verão é detectado (sem ajuste silencioso)", () => {
  assert.equal(wallTimeToInstantStrict({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York"), null);
  assert.equal(wallTimeToInstantStrict({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, "America/New_York"), "2026-03-08T07:30:00.000Z");
  assert.equal(wallTimeToInstantStrict({ year: 2026, month: 7, day: 1, hour: 2, minute: 30 }, "America/New_York"), "2026-07-01T06:30:00.000Z");
  // Horário repetido (fim do horário de verão) existe: usa a primeira ocorrência.
  assert.equal(wallTimeToInstantStrict({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York"), "2026-11-01T05:30:00.000Z");
});
