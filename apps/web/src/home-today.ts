import type { CalendarEventOutput, TaskOutput } from "./lib/calendar-api";
import type { NoteMetadataOutput } from "./lib/notes-api";
import { upcomingEvents } from "./calendar/layout";
import { byDue, localNow } from "./calendar/tasks";
// Pelo contrato (como em calendar/tasks.ts), sem puxar o cliente HTTP: a regra de "atrasada" vive só na API.
import { isTaskOverdue } from "../../api/src/modules/calendar/task-contract";

/** Quantos itens cada coluna da faixa "Hoje" mostra. */
export const TODAY_LIMIT = 3;
/** Janela de eventos buscada para a faixa; só os primeiros `TODAY_LIMIT` aparecem. */
export const TODAY_EVENT_DAYS = 14;

export type TodayItems = {
  events: CalendarEventOutput[];
  /** Atrasadas mais antigas primeiro (limitadas), com o total para o "+N". */
  overdue: TaskOutput[];
  overdueTotal: number;
  note: NoteMetadataOutput | null;
};

/** Seleciona o que a faixa mostra: próximos eventos, tarefas atrasadas (critério de `isTaskOverdue`) e a nota editada por último. */
export function pickToday(source: { events: readonly CalendarEventOutput[]; tasks: readonly TaskOutput[]; notes: readonly NoteMetadataOutput[] }, now = new Date()): TodayItems {
  const clock = localNow(now);
  const overdue = source.tasks.filter((task) => isTaskOverdue(task, clock)).sort(byDue);
  const note = source.notes.reduce<NoteMetadataOutput | null>((latest, item) => (!latest || item.updatedAt > latest.updatedAt ? item : latest), null);
  return { events: upcomingEvents(source.events, now, TODAY_LIMIT), overdue: overdue.slice(0, TODAY_LIMIT), overdueTotal: overdue.length, note };
}

/** Prazo da tarefa atrasada em texto curto: "venceu 22/10, 09:00" ou "venceu 22/10". */
export function overdueLabel(task: Pick<TaskOutput, "dueDate" | "dueTime">): string {
  if (!task.dueDate) return "sem prazo";
  const [, month, day] = task.dueDate.split("-");
  return `venceu ${day}/${month}${task.dueTime ? `, ${task.dueTime}` : ""}`;
}
