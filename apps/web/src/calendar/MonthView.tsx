import { memo, useMemo, type MouseEvent } from "react";
import { toIso, todayLocal, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput, TaskOutput } from "../lib/calendar-api";
import { eventsOnDay, monthGrid, sameDay } from "./layout";
import type { DisplayEvent } from "./outbox";
import TaskMarker from "./TaskMarker";
import { tasksOnDay } from "./tasks";
import type { Slot } from "./TimeGrid";

const MAX_CHIPS = 3;

function MonthView({ anchor, events, tasks, overdueIds, statusOf, onOpen, onPickDay, onPickSlot, onToggleTask, onOpenTask }: {
  anchor: CalendarDate;
  events: CalendarEventOutput[];
  tasks: TaskOutput[];
  overdueIds: ReadonlySet<string>;
  statusOf: Map<string, DisplayEvent>;
  onOpen: (event: CalendarEventOutput) => void;
  onPickDay: (day: CalendarDate) => void;
  onPickSlot: (slot: Slot) => void;
  onToggleTask: (task: TaskOutput) => void;
  onOpenTask: (task: TaskOutput) => void;
}) {
  const today = todayLocal();
  type Item = { kind: "event"; event: CalendarEventOutput } | { kind: "task"; task: TaskOutput };
  const weeks = useMemo(() => monthGrid(anchor).map((week) => week.map((day) => {
    const { allDay, timed } = eventsOnDay(events, day);
    const { untimed, timed: timedTasks } = tasksOnDay(tasks, day);
    const all: Item[] = [...allDay, ...timed].map((event) => ({ kind: "event", event }));
    return { day, all: [...all, ...[...untimed, ...timedTasks].map((task): Item => ({ kind: "task", task }))] };
  })), [anchor, events, tasks]);
  // Só o fundo da célula (não os botões) abre o cartão de criação; sem horário tocado, vale o horário padrão.
  const pickSlot = (event: MouseEvent<HTMLDivElement>, day: CalendarDate) => {
    if (event.target === event.currentTarget) onPickSlot({ day, x: event.clientX, y: event.clientY });
  };
  return (
    <div className="calendar-month" role="grid" aria-label="Mês">
      <div className="calendar-month-weekdays" role="row">{weekdayNames.map((name) => <span key={name} role="columnheader">{name.slice(0, 3)}</span>)}</div>
      {weeks.map((week, index) => (
        <div key={index} className="calendar-month-week" role="row">
          {week.map(({ day, all }) => {
            return (
              <div key={toIso(day)} role="gridcell" className="calendar-month-cell" data-outside={day.month !== anchor.month || undefined} data-today={sameDay(day, today) || undefined} onClick={(event) => pickSlot(event, day)}>
                <button type="button" className="calendar-month-number" onClick={() => onPickDay(day)} aria-label={`Abrir ${day.day}/${day.month}`}>{day.day}</button>
                {all.slice(0, MAX_CHIPS).map((item) => item.kind === "event" ? (
                  <button key={item.event.id} type="button" className="calendar-chip" data-source={item.event.source} data-status={statusOf.get(item.event.id)?.status} onClick={() => onOpen(item.event)} title={item.event.title}>{item.event.title}</button>
                ) : <TaskMarker key={item.task.id} task={item.task} overdue={overdueIds.has(item.task.id)} onToggle={onToggleTask} onOpen={onOpenTask} />)}
                {all.length > MAX_CHIPS && <button type="button" className="calendar-more" onClick={() => onPickDay(day)}>+{all.length - MAX_CHIPS} mais</button>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default memo(MonthView);
