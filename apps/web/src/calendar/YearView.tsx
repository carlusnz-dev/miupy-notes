import { memo, useMemo } from "react";
import { daysInMonth, toIso, todayLocal, weekday, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { monthTitle } from "./format";
import { occursOn, sameDay } from "./layout";

function YearView({ anchor, events, onPickMonth, onPickDay }: {
  anchor: CalendarDate;
  events: CalendarEventOutput[];
  onPickMonth: (month: number) => void;
  onPickDay: (day: CalendarDate) => void;
}) {
  const today = todayLocal();
  // Uma passada por dia do ano (antes: três por dia — total do mês, destaque e rótulo acessível).
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const first: CalendarDate = { year: anchor.year, month, day: 1 };
    const days = Array.from({ length: daysInMonth(anchor.year, month) }, (_, day) => ({ ...first, day: day + 1 }));
    const seen = new Set<string>();
    const busy = days.map((day) => { const found = events.filter((event) => occursOn(event, day)); found.forEach((event) => seen.add(event.id)); return found.length > 0; });
    return { month, first, days, busy, total: seen.size };
  }), [anchor.year, events]);
  return (
    <div className="calendar-year">
      {months.map(({ month, first, days, busy, total }) => {
        const cells = [...Array(weekday(first)).fill(null), ...days] as Array<CalendarDate | null>;
        return (
          <section key={month} className="calendar-year-month" aria-label={`${monthTitle(month)} de ${anchor.year}`}>
            <button type="button" className="calendar-year-title" onClick={() => onPickMonth(month)}>{monthTitle(month)}<small>{total === 0 ? "sem eventos" : `${total} evento${total > 1 ? "s" : ""}`}</small></button>
            <div className="calendar-year-grid">
              {weekdayNames.map((name) => <span key={name} className="calendar-year-weekday" aria-hidden="true">{name[0]}</span>)}
              {cells.map((day, position) => day === null
                ? <span key={`e${position}`} />
                : <button key={toIso(day)} type="button" className="calendar-year-day" data-today={sameDay(day, today) || undefined} data-busy={busy[day.day - 1] || undefined} onClick={() => onPickDay(day)} aria-label={`${day.day} de ${monthTitle(month).toLowerCase()}${busy[day.day - 1] ? ", com eventos" : ""}`}>{day.day}</button>)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default memo(YearView);
