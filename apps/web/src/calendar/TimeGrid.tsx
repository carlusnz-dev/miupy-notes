import { memo, useLayoutEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import { monthNames, toIso, todayLocal, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";
import EventStatus from "./EventStatus";
import { timeRange } from "./format";
import { dayBlocks, eventsOnDay, sameDay } from "./layout";
import type { DisplayEvent } from "./outbox";

const HOUR_PX = 48;
/** Abaixo desta altura o bloco vira uma linha só (título · hora), para o título nunca sumir. */
const COMPACT_PX = 40;
const hours = Array.from({ length: 24 }, (_, hour) => hour);

/** Cronograma por blocos (dia e semana): uma coluna por dia, eventos posicionados pelo horário local. */
function TimeGrid({ days, events, statusOf, onOpen, onPickDay }: {
  days: CalendarDate[];
  events: CalendarEventOutput[];
  statusOf: Map<string, DisplayEvent>;
  onOpen: (event: CalendarEventOutput) => void;
  onPickDay?: (day: CalendarDate) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const today = todayLocal();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Um cálculo de layout por dia e por mudança de eventos (antes: duas vezes por render, no efeito e no JSX).
  const perDay = useMemo(() => days.map((day) => ({ day, blocks: dayBlocks(events, day), allDay: eventsOnDay(events, day).allDay })), [days, events]);

  // Abre perto do primeiro evento (ou das 7h); a entrada dos blocos é suave e some com movimento reduzido.
  useLayoutEffect(() => {
    const first = perDay.flatMap((entry) => entry.blocks).reduce((min, block) => Math.min(min, block.startMin), 7 * 60);
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (Math.min(first, 7 * 60) - 30) / 60 * HOUR_PX);
    const element = body.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const blocks = element.querySelectorAll(".calendar-block");
      if (blocks.length > 0) gsap.fromTo(blocks, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .22, stagger: .02, ease: "power2.out", clearProps: "opacity,transform" });
    });
    return () => media.revert();
    // Só ao trocar de período: eventos novos de um envio não devem rolar nem reanimar a grade.
  }, [days[0] && toIso(days[0]), days.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };
  return (
    <div className="calendar-grid" data-columns={days.length}>
      <div className="calendar-grid-head">
        <span className="calendar-grid-corner" />
        <div className="calendar-grid-days" style={columns}>
          {perDay.map(({ day, allDay }) => {
            const isToday = sameDay(day, today);
            return (
              <div key={toIso(day)} className="calendar-grid-day" data-today={isToday || undefined}>
                {onPickDay ? <button type="button" className="calendar-day-link" onClick={() => onPickDay(day)} aria-label={`Abrir ${day.day} de ${monthNames[day.month - 1]}`}><small>{weekdayNames[new Date(day.year, day.month - 1, day.day).getDay()].slice(0, 3)}</small><strong>{day.day}</strong></button>
                  : <div className="calendar-day-link"><small>{weekdayNames[new Date(day.year, day.month - 1, day.day).getDay()].slice(0, 3)}</small><strong>{day.day}</strong></div>}
                {allDay.map((event) => (
                  <button key={event.id} type="button" className="calendar-allday" data-source={event.source} data-status={statusOf.get(event.id)?.status} onClick={() => onOpen(event)} title={event.title}>{event.title}</button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="calendar-grid-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Horários do dia">
        <div className="calendar-grid-body" ref={body} style={{ height: HOUR_PX * 24 }}>
          <div className="calendar-hours" aria-hidden="true">
            {hours.map((hour) => <span key={hour} style={{ top: hour * HOUR_PX }}>{String(hour).padStart(2, "0")}:00</span>)}
          </div>
          <div className="calendar-grid-columns" style={columns}>
            {perDay.map(({ day, blocks }) => (
              <div key={toIso(day)} className="calendar-column" data-today={sameDay(day, today) || undefined}>
                {hours.map((hour) => <i key={hour} className="calendar-hour-line" style={{ top: hour * HOUR_PX }} aria-hidden="true" />)}
                {sameDay(day, today) && <i className="calendar-now" style={{ top: nowMin / 60 * HOUR_PX }} aria-hidden="true" />}
                {blocks.map((block) => {
                  const status = statusOf.get(block.event.id)?.status ?? "synced";
                  const height = Math.max(20, (block.endMin - block.startMin) / 60 * HOUR_PX - 2);
                  return (
                    <button key={block.event.id} type="button" className="calendar-block" data-source={block.event.source} data-status={status} data-compact={height < COMPACT_PX || undefined}
                      style={{ top: block.startMin / 60 * HOUR_PX, height, left: `calc(${block.column / block.columns * 100}% + 2px)`, width: `calc(${100 / block.columns}% - 4px)` }}
                      onClick={() => onOpen(block.event)} title={`${block.event.title} · ${timeRange(block.event)}`} aria-label={`${block.event.title}, ${timeRange(block.event)}`}>
                      <strong>{block.event.title}</strong>
                      <span>{timeRange(block.event)}</span>
                      <EventStatus status={status} />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(TimeGrid);
