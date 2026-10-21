import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { apiRange, dayBlocks, eventsOnDay, monthGrid, occursOn, shift, upcomingEvents, visibleDays } from "./layout.js";

const iso = "2026-10-21T00:00:00.000Z";
let counter = 0;
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
function ev(extra: Partial<CalendarEventOutput>): CalendarEventOutput {
  counter++;
  return { id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`, title: `E${counter}`, description: "", location: "", allDay: false, start: iso, end: iso, timeZone: "UTC", links: [], source: "local", readOnly: false, external: null, reflection: null, createdAt: iso, updatedAt: iso, version: 1, ...extra };
}
const day = { year: 2026, month: 10, day: 21 };

test("evento com hora ocorre no dia local, com fim exclusivo à meia-noite", () => {
  const night = ev({ start: local(2026, 10, 21, 22), end: local(2026, 10, 22, 0) });
  assert.equal(occursOn(night, day), true);
  assert.equal(occursOn(night, { ...day, day: 22 }), false);
  const overnight = ev({ start: local(2026, 10, 21, 22), end: local(2026, 10, 22, 2) });
  assert.equal(occursOn(overnight, { ...day, day: 22 }), true);
});

test("dia inteiro cobre do primeiro ao último dia, inclusive", () => {
  const trip = ev({ allDay: true, start: "2026-10-20", end: "2026-10-22", timeZone: null });
  assert.deepEqual([20, 21, 22, 23].map((d) => occursOn(trip, { ...day, day: d })), [true, true, true, false]);
  assert.equal(eventsOnDay([trip], day).allDay.length, 1);
  assert.equal(eventsOnDay([trip], day).timed.length, 0);
});

test("blocos sobrepostos ganham colunas; encadeados não dividem a largura", () => {
  const a = ev({ start: local(2026, 10, 21, 9), end: local(2026, 10, 21, 11) });
  const b = ev({ start: local(2026, 10, 21, 10), end: local(2026, 10, 21, 12) });
  const c = ev({ start: local(2026, 10, 21, 11), end: local(2026, 10, 21, 12) });
  const d = ev({ start: local(2026, 10, 21, 15), end: local(2026, 10, 21, 16) });
  const blocks = dayBlocks([d, c, b, a], day);
  const byId = Object.fromEntries(blocks.map((block) => [block.event.id, block]));
  assert.deepEqual([byId[a.id].column, byId[a.id].columns, byId[b.id].column, byId[b.id].columns], [0, 2, 1, 2]);
  assert.equal(byId[c.id].column, 0);
  assert.equal(byId[d.id].columns, 1);
  assert.equal(byId[a.id].startMin, 540);
  assert.equal(byId[a.id].endMin, 660);
});

test("evento que cruza a meia-noite é recortado em cada dia e evento curto tem altura mínima", () => {
  const overnight = ev({ start: local(2026, 10, 21, 23), end: local(2026, 10, 22, 1) });
  assert.equal(dayBlocks([overnight], day)[0].endMin, 1440);
  assert.equal(dayBlocks([overnight], { ...day, day: 22 })[0].startMin, 0);
  const short = ev({ start: local(2026, 10, 21, 9), end: local(2026, 10, 21, 9, 5) });
  assert.equal(dayBlocks([short], day)[0].endMin - 540, 20);
});

test("períodos visíveis: semana começa no domingo, mês cobre 42 dias, ano é o ano civil", () => {
  assert.deepEqual(visibleDays("week", day).first, { year: 2026, month: 10, day: 18 });
  const grid = monthGrid(day);
  assert.equal(grid.length, 6);
  assert.equal(grid[0][0].day, 27);
  assert.deepEqual(grid[0][0], { year: 2026, month: 9, day: 27 });
  assert.deepEqual(visibleDays("year", day), { first: { year: 2026, month: 1, day: 1 }, endExclusive: { year: 2027, month: 1, day: 1 } });
});

test("intervalo da API é ampliado em um dia de cada lado", () => {
  const range = apiRange("day", day);
  assert.equal(range.from, new Date(2026, 9, 20).toISOString());
  assert.equal(range.to, new Date(2026, 9, 23).toISOString());
});

test("navegação por modo", () => {
  assert.deepEqual(shift("day", day, 1), { year: 2026, month: 10, day: 22 });
  assert.deepEqual(shift("week", day, -1), { year: 2026, month: 10, day: 14 });
  assert.deepEqual(shift("month", { year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(shift("year", day, 1), { year: 2027, month: 10, day: 21 });
});

test("próximos eventos: ignora passados, mantém em andamento, ordena e limita", () => {
  const now = new Date(2026, 9, 21, 12, 0);
  const past = ev({ title: "Passado", start: local(2026, 10, 21, 8), end: local(2026, 10, 21, 9) });
  const running = ev({ title: "Agora", start: local(2026, 10, 21, 11), end: local(2026, 10, 21, 13) });
  const later = ev({ title: "Depois", start: local(2026, 10, 22, 9), end: local(2026, 10, 22, 10) });
  const today = ev({ title: "Hoje todo", allDay: true, start: "2026-10-21", end: "2026-10-21", timeZone: null });
  const yesterday = ev({ title: "Ontem", allDay: true, start: "2026-10-20", end: "2026-10-20", timeZone: null });
  const upcoming = upcomingEvents([later, past, yesterday, running, today], now, 3);
  assert.deepEqual(upcoming.map((event) => event.title), ["Hoje todo", "Agora", "Depois"]);
});
