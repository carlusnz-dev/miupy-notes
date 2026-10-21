import { daysInMonth, toIso, todayLocal, weekday, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { monthTitle } from "./format";
import { occursOn, sameDay } from "./layout";

export default function YearView({ anchor, events, onPickMonth, onPickDay }: {
  anchor: CalendarDate;
  events: CalendarEventOutput[];
  onPickMonth: (month: number) => void;
  onPickDay: (day: CalendarDate) => void;
}) {
  const today = todayLocal();
  return (
    <div className="calendar-year">
      {Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const first: CalendarDate = { year: anchor.year, month, day: 1 };
        const cells = [...Array(weekday(first)).fill(null), ...Array.from({ length: daysInMonth(anchor.year, month) }, (_, day) => ({ ...first, day: day + 1 }))] as Array<CalendarDate | null>;
        const total = events.filter((event) => Array.from({ length: daysInMonth(anchor.year, month) }, (_, day) => ({ ...first, day: day + 1 })).some((day) => occursOn(event, day))).length;
        return (
          <section key={month} className="calendar-year-month" aria-label={`${monthTitle(month)} de ${anchor.year}`}>
            <button type="button" className="calendar-year-title" onClick={() => onPickMonth(month)}>{monthTitle(month)}<small>{total === 0 ? "sem eventos" : `${total} evento${total > 1 ? "s" : ""}`}</small></button>
            <div className="calendar-year-grid" role="grid">
              {weekdayNames.map((name) => <span key={name} className="calendar-year-weekday" aria-hidden="true">{name[0]}</span>)}
              {cells.map((day, position) => day === null
                ? <span key={`e${position}`} />
                : <button key={toIso(day)} type="button" className="calendar-year-day" data-today={sameDay(day, today) || undefined} data-busy={events.some((event) => occursOn(event, day)) || undefined} onClick={() => onPickDay(day)} aria-label={`${day.day} de ${monthTitle(month).toLowerCase()}${events.some((event) => occursOn(event, day)) ? ", com eventos" : ""}`}>{day.day}</button>)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
