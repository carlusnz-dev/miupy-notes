import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { groupEvents, seriesKey } from "./groups";

let n = 0;
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const make = (extra: Partial<CalendarEventOutput>): CalendarEventOutput => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, title: "Trabalho", description: "", location: "Escritório", allDay: false,
  start: at(23, 13), end: at(23, 19), timeZone: "America/Sao_Paulo", links: [], source: "local", readOnly: false, external: null, reflection: null,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", version: 1, ...extra,
});

test("mesmo título, horário e local em dias diferentes viram um grupo com as ocorrências em ordem", () => {
  const events = [make({}), make({ start: at(26, 13), end: at(26, 19) }), make({ start: at(27, 13), end: at(27, 19) })];
  const groups = groupEvents(events);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].events.map((event) => event.id), events.map((event) => event.id));
});

test("horário, local, título ou origem diferentes mantêm blocos separados", () => {
  const groups = groupEvents([
    make({}), make({ start: at(26, 14), end: at(26, 19) }), make({ start: at(27, 13), end: at(27, 19), location: "Casa" }),
    make({ start: at(28, 13), end: at(28, 19), title: "Estudo" }), make({ start: at(29, 13), end: at(29, 19), source: "google", readOnly: true }),
  ]);
  assert.equal(groups.length, 5);
});

test("título e local ignoram caixa e espaços nas bordas", () => {
  assert.equal(seriesKey(make({ title: " TRABALHO ", location: "escritório " })), seriesKey(make({})));
});

test("duas ocorrências no mesmo dia não formam série", () => {
  const groups = groupEvents([make({}), make({})]);
  assert.equal(groups.length, 2);
});

test("dia inteiro agrupa por título e local, sem horário", () => {
  const allDay = (date: string) => make({ allDay: true, start: date, end: date, timeZone: null, title: "Home office", location: "" });
  const groups = groupEvents([allDay("2026-10-23"), allDay("2026-10-26"), allDay("2026-10-27")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].events.length, 3);
});

test("o grupo ocupa a posição da primeira ocorrência", () => {
  const groups = groupEvents([make({ title: "A", start: at(23, 8), end: at(23, 9) }), make({}), make({ title: "A", start: at(26, 8), end: at(26, 9) })]);
  assert.deepEqual(groups.map((group) => group.events[0].title), ["A", "Trabalho"]);
  assert.equal(groups[0].events.length, 2);
});
