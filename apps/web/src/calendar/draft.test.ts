import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDraft, type Fields } from "./draft.js";

const fields = (extra: Partial<Fields> = {}): Fields => ({ title: "Reunião", description: "", location: "", allDay: false, startDate: "2026-10-21", startTime: "09:00", endDate: "2026-10-21", endTime: "10:00", timeZone: "America/Sao_Paulo", links: [], ...extra });

test("converte horário de parede do fuso escolhido em instantes UTC", () => {
  const result = buildDraft(fields());
  assert.ok("draft" in result);
  assert.deepEqual([result.draft.start, result.draft.end, result.draft.timeZone], ["2026-10-21T12:00:00.000Z", "2026-10-21T13:00:00.000Z", "America/Sao_Paulo"]);
});

test("regressão: hora inexistente no salto do horário de verão vira erro visível, não ajuste silencioso", () => {
  const result = buildDraft(fields({ timeZone: "America/New_York", startDate: "2026-03-08", endDate: "2026-03-08", startTime: "02:30", endTime: "03:30" }));
  assert.ok("error" in result);
  assert.match(result.error, /não existe em America\/New_York/);
  assert.ok("draft" in buildDraft(fields({ timeZone: "America/New_York", startDate: "2026-03-08", endDate: "2026-03-08", startTime: "03:30", endTime: "04:30" })));
});

test("valida título, ordem e dia inteiro", () => {
  assert.deepEqual(buildDraft(fields({ title: "  " })), { error: "Informe um título." });
  assert.ok("error" in buildDraft(fields({ endTime: "09:00" })));
  assert.ok("error" in buildDraft(fields({ startTime: "" })));
  const allDay = buildDraft(fields({ allDay: true, startDate: "2026-11-02", endDate: "2026-11-03" }));
  assert.ok("draft" in allDay);
  assert.deepEqual([allDay.draft.start, allDay.draft.end, allDay.draft.timeZone], ["2026-11-02", "2026-11-03", null]);
  assert.ok("error" in buildDraft(fields({ allDay: true, startDate: "2026-11-03", endDate: "2026-11-02" })));
});
