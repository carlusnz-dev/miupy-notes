import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { instantAt, isDraggable, moveSpan, resizeSpan, snap } from "./drag";

test("encaixa em 15 minutos", () => {
  assert.equal(snap(7), 0);
  assert.equal(snap(8), 15);
  assert.equal(snap(97), 90);
});

test("mover mantém a duração, encaixa o início e respeita os limites do dia", () => {
  assert.deepEqual(moveSpan({ startMin: 780, endMin: 1140 }, 22), { startMin: 795, endMin: 1155 });
  assert.deepEqual(moveSpan({ startMin: 60, endMin: 120 }, -500), { startMin: 0, endMin: 60 });
  assert.deepEqual(moveSpan({ startMin: 1320, endMin: 1380 }, 500), { startMin: 1380, endMin: 1440 });
});

test("redimensionar encaixa o fim, mantém o mínimo de 15 min e termina até a meia-noite", () => {
  assert.deepEqual(resizeSpan({ startMin: 780, endMin: 840 }, 40), { startMin: 780, endMin: 885 });
  assert.deepEqual(resizeSpan({ startMin: 780, endMin: 840 }, -500), { startMin: 780, endMin: 795 });
  assert.deepEqual(resizeSpan({ startMin: 1380, endMin: 1410 }, 500), { startMin: 1380, endMin: 1440 });
});

test("instantAt usa o relógio local e trata 24:00 como a meia-noite seguinte", () => {
  const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
  assert.equal(instantAt({ year: 2026, month: 10, day: 23 }, 13 * 60 + 15), local(2026, 10, 23, 13, 15));
  assert.equal(instantAt({ year: 2026, month: 10, day: 31 }, 1440), local(2026, 11, 1, 0));
});

const event = (extra: Partial<CalendarEventOutput> = {}): CalendarEventOutput => ({
  id: "00000000-0000-4000-8000-000000000001", title: "x", description: "", location: "", allDay: false,
  start: new Date(2026, 9, 23, 9).toISOString(), end: new Date(2026, 9, 23, 10).toISOString(), timeZone: "UTC", links: [], source: "local", readOnly: false,
  external: null, reflection: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", version: 1, ...extra,
});

test("somente evento local, com hora, de um dia só e sem conflito é arrastável", () => {
  assert.equal(isDraggable(event(), "synced"), true);
  assert.equal(isDraggable(event(), "pending"), true);
  assert.equal(isDraggable(event({ source: "google", readOnly: true }), "synced"), false);
  assert.equal(isDraggable(event({ allDay: true, start: "2026-10-23", end: "2026-10-23" }), "synced"), false);
  assert.equal(isDraggable(event(), "conflict"), false);
  assert.equal(isDraggable(event(), "rejected"), false);
  assert.equal(isDraggable(event({ end: new Date(2026, 9, 24, 2).toISOString() }), "synced"), false);
  assert.equal(isDraggable(event({ start: new Date(2026, 9, 23, 22).toISOString(), end: new Date(2026, 9, 24, 0).toISOString() }), "synced"), true);
});
