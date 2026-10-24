import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEventOutput, TaskOutput } from "./lib/calendar-api";
import type { NoteMetadataOutput } from "./lib/notes-api";
import { overdueLabel, pickToday } from "./home-today";

const now = new Date(2026, 9, 24, 10, 0); // 24/10/2026 10:00 local
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const event = (title: string, start: string, end: string, extra: Partial<CalendarEventOutput> = {}) => ({ id: id(), title, start, end, allDay: false, ...extra }) as CalendarEventOutput;
const task = (title: string, extra: Partial<TaskOutput>) => ({ id: id(), title, description: "", dueDate: null, dueTime: null, status: "pending", ...extra }) as TaskOutput;
const note = (title: string, updatedAt: string) => ({ id: id(), title, updatedAt }) as NoteMetadataOutput;

test("eventos: só os que ainda não terminaram, em ordem de início e no máximo 3", () => {
  const events = [
    event("passou", at(24, 8), at(24, 9)),
    event("e", at(26, 9), at(26, 10)),
    event("b", at(24, 14), at(24, 15)),
    event("a", at(24, 11), at(24, 12)),
    event("c", at(25, 9), at(25, 10)),
  ];
  assert.deepEqual(pickToday({ events, tasks: [], notes: [] }, now).events.map((item) => item.title), ["a", "b", "c"]);
});

test("evento em andamento e de dia inteiro de hoje ainda contam", () => {
  const events = [event("agora", at(24, 9), at(24, 11)), event("dia", "2026-10-24", "2026-10-24", { allDay: true })];
  assert.deepEqual(pickToday({ events, tasks: [], notes: [] }, now).events.map((item) => item.title), ["dia", "agora"]);
});

test("tarefas atrasadas: critério de isTaskOverdue, mais antigas primeiro, limite 3 e total completo", () => {
  const tasks = [
    task("hoje mais tarde", { dueDate: "2026-10-24", dueTime: "18:00" }),
    task("hoje já passou", { dueDate: "2026-10-24", dueTime: "08:00" }),
    task("hoje sem hora", { dueDate: "2026-10-24" }),
    task("ontem", { dueDate: "2026-10-23" }),
    task("semana passada", { dueDate: "2026-10-17" }),
    task("concluída", { dueDate: "2026-10-01", status: "completed" }),
    task("sem prazo", {}),
    task("anteontem", { dueDate: "2026-10-22", dueTime: "09:00" }),
  ];
  const result = pickToday({ events: [], tasks, notes: [] }, now);
  assert.deepEqual(result.overdue.map((item) => item.title), ["semana passada", "anteontem", "ontem"]);
  assert.equal(result.overdueTotal, 4);
});

test("nota recente é a editada por último; sem notas, nulo", () => {
  const notes = [note("velha", "2026-10-01T10:00:00.000Z"), note("nova", "2026-10-23T10:00:00.000Z"), note("meio", "2026-10-10T10:00:00.000Z")];
  assert.equal(pickToday({ events: [], tasks: [], notes }, now).note?.title, "nova");
  assert.equal(pickToday({ events: [], tasks: [], notes: [] }, now).note, null);
});

test("overdueLabel mostra dia e, se houver, hora", () => {
  assert.equal(overdueLabel({ dueDate: "2026-10-22", dueTime: "09:00" }), "venceu 22/10, 09:00");
  assert.equal(overdueLabel({ dueDate: "2026-10-22", dueTime: null }), "venceu 22/10");
});
