import { toIso, todayLocal, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { eventsOnDay, monthGrid, sameDay } from "./layout";
import type { DisplayEvent } from "./outbox";

const MAX_CHIPS = 3;

export default function MonthView({ anchor, events, statusOf, onOpen, onPickDay }: {
  anchor: CalendarDate;
  events: CalendarEventOutput[];
  statusOf: Map<string, DisplayEvent>;
  onOpen: (event: CalendarEventOutput) => void;
  onPickDay: (day: CalendarDate) => void;
}) {
  const today = todayLocal();
  return (
    <div className="calendar-month" role="grid" aria-label="Mês">
      <div className="calendar-month-weekdays" role="row">{weekdayNames.map((name) => <span key={name} role="columnheader">{name.slice(0, 3)}</span>)}</div>
      {monthGrid(anchor).map((week, index) => (
        <div key={index} className="calendar-month-week" role="row">
          {week.map((day) => {
            const { allDay, timed } = eventsOnDay(events, day);
            const all = [...allDay, ...timed];
            return (
              <div key={toIso(day)} role="gridcell" className="calendar-month-cell" data-outside={day.month !== anchor.month || undefined} data-today={sameDay(day, today) || undefined}>
                <button type="button" className="calendar-month-number" onClick={() => onPickDay(day)} aria-label={`Abrir ${day.day}/${day.month}`}>{day.day}</button>
                {all.slice(0, MAX_CHIPS).map((event) => (
                  <button key={event.id} type="button" className="calendar-chip" data-source={event.source} data-status={statusOf.get(event.id)?.status} onClick={() => onOpen(event)} title={event.title}>{event.title}</button>
                ))}
                {all.length > MAX_CHIPS && <button type="button" className="calendar-more" onClick={() => onPickDay(day)}>+{all.length - MAX_CHIPS} mais</button>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
