import assert from "node:assert/strict";
import { test } from "node:test";
import { eventBounds, isRealDate, isValidTimeZone, normalizeTimes, overlaps } from "./event-time.js";
import { mirrorId } from "../google/google-mapping.js";

test("com hora normaliza o deslocamento para UTC e exige fuso IANA", () => {
  const times = normalizeTimes({ allDay: false, start: "2026-10-21T09:00:00-03:00", end: "2026-10-21T10:30:00-03:00", timeZone: "America/Sao_Paulo" });
  assert.deepEqual(times, { allDay: false, start: "2026-10-21T12:00:00.000Z", end: "2026-10-21T13:30:00.000Z", timeZone: "America/Sao_Paulo" });
  assert.throws(() => normalizeTimes({ allDay: false, start: "2026-10-21T09:00:00Z", end: "2026-10-21T10:00:00Z" }), { status: 400 });
  assert.throws(() => normalizeTimes({ allDay: false, start: "2026-10-21T09:00:00Z", end: "2026-10-21T10:00:00Z", timeZone: "Marte/Olimpo" }), { status: 400 });
});

test("com hora o fim deve ser posterior e datas soltas são recusadas", () => {
  const base = { allDay: false, timeZone: "UTC" };
  assert.throws(() => normalizeTimes({ ...base, start: "2026-10-21T10:00:00Z", end: "2026-10-21T10:00:00Z" }), { status: 400 });
  assert.throws(() => normalizeTimes({ ...base, start: "2026-10-21", end: "2026-10-22" }), { status: 400 });
  assert.throws(() => normalizeTimes({ ...base, start: "lixo-de-texto", end: "2026-10-22T10:00:00Z" }), { status: 400 });
});

test("dia inteiro guarda datas de calendário, ignora o fuso e aceita um dia só", () => {
  assert.deepEqual(normalizeTimes({ allDay: true, start: "2026-10-21", end: "2026-10-21", timeZone: "Asia/Tokyo" }), { allDay: true, start: "2026-10-21", end: "2026-10-21", timeZone: null });
  assert.throws(() => normalizeTimes({ allDay: true, start: "2026-10-22", end: "2026-10-21" }), { status: 400 });
  assert.throws(() => normalizeTimes({ allDay: true, start: "2026-02-30", end: "2026-03-01" }), { status: 400 });
  assert.throws(() => normalizeTimes({ allDay: true, start: "2026-10-21T00:00:00Z", end: "2026-10-21" }), { status: 400 });
});

test("dia inteiro cobre o dia final inteiro nos limites e na sobreposição", () => {
  const allDay = { allDay: true, start: "2026-02-28", end: "2026-03-01" };
  assert.deepEqual(eventBounds(allDay), { startsAt: "2026-02-28T00:00:00.000Z", endsAt: "2026-03-02T00:00:00.000Z" });
  assert.equal(overlaps(allDay, "2026-03-01T23:00:00.000Z", "2026-03-05T00:00:00.000Z"), true);
  assert.equal(overlaps(allDay, "2026-03-02T00:00:00.000Z", "2026-03-05T00:00:00.000Z"), false);
});

test("sobreposição trata fim exclusivo e limites abertos", () => {
  const timed = { allDay: false, start: "2026-10-21T12:00:00.000Z", end: "2026-10-21T13:00:00.000Z" };
  assert.equal(overlaps(timed, "2026-10-21T13:00:00.000Z"), false);
  assert.equal(overlaps(timed, undefined, "2026-10-21T12:00:00.000Z"), false);
  assert.equal(overlaps(timed, "2026-10-21T12:59:59.000Z", "2026-10-21T14:00:00.000Z"), true);
  assert.equal(overlaps(timed), true);
});

test("validadores de data e fuso", () => {
  assert.equal(isRealDate("2028-02-29"), true);
  assert.equal(isRealDate("2027-02-29"), false);
  assert.equal(isValidTimeZone("Europe/Lisbon"), true);
  assert.equal(isValidTimeZone(""), false);
});

test("mirrorId é determinístico, no formato UUID e separa proprietários", () => {
  const a = mirrorId("alice", "primary", "abc");
  assert.equal(a, mirrorId("alice", "primary", "abc"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, mirrorId("bob", "primary", "abc"));
  assert.notEqual(a, mirrorId("alice", "primary", "abd"));
});

test("regressão: com hora exige data real e deslocamento explícito (nada de normalizar 30/02 nem usar o fuso do servidor)", () => {
  const base = { allDay: false, timeZone: "UTC" };
  for (const bad of ["2026-02-30T09:00:00Z", "2026-13-01T09:00:00Z", "2026-10-21T24:00:00Z", "2026-10-21T09:60:00Z", "2026-10-21T09:00:00", "2026-10-21T09:00", "2026-10-21 09:00:00Z", "2026-10-21T09:00:00+24:00"]) {
    assert.throws(() => normalizeTimes({ ...base, start: bad, end: "2026-10-22T10:00:00Z" }), { status: 400 }, bad);
  }
  assert.equal(normalizeTimes({ ...base, start: "2026-10-21T09:00-03:00", end: "2026-10-21T15:00:00.5+00:00" }).start, "2026-10-21T12:00:00.000Z");
});
