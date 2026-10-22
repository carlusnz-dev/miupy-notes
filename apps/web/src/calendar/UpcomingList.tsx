import { Fragment, memo } from "react";
import { MapPin } from "lucide-react";
import type { CalendarEventOutput } from "../lib/calendar-api";
import EventStatus from "./EventStatus";
import { relativeDay, startDay, timeRange, zoneNote } from "./format";
import type { DisplayEvent } from "./outbox";
import { UPCOMING_DAYS } from "./use-calendar";

/**
 * Lista de próximos eventos: é a parte principal do planner diário (vem primeiro, também no celular).
 * No modo Dia é um trilho vertical agrupado por dia; nos demais modos e em telas estreitas o CSS a
 * transforma numa faixa horizontal compacta, para não empurrar a grade para fora da primeira tela.
 */
function UpcomingList({ events, statusOf, onOpen }: {
  events: CalendarEventOutput[];
  statusOf: Map<string, DisplayEvent>;
  onOpen: (event: CalendarEventOutput) => void;
}) {
  let lastDay = "";
  return (
    <section className="calendar-upcoming" aria-labelledby="calendar-upcoming-title">
      <h2 id="calendar-upcoming-title">Próximos eventos</h2>
      {events.length === 0 ? (
        <p className="calendar-empty">Nada marcado nos próximos {UPCOMING_DAYS} dias.</p>
      ) : (
        <ol className="calendar-upcoming-list">
          {events.map((event) => {
            const label = relativeDay(startDay(event));
            const heading = label !== lastDay;
            lastDay = label;
            const note = zoneNote(event);
            return (
              <Fragment key={event.id}>
                {heading && <li className="calendar-upcoming-day" aria-hidden="true">{label}</li>}
                <li className="calendar-upcoming-entry">
                  <button type="button" className="calendar-upcoming-item" data-source={event.source} onClick={() => onOpen(event)}>
                    {/* O dia vai em cada item: o cabeçalho visual do grupo é oculto para leitores de tela. */}
                    <span className="calendar-upcoming-when">{label}</span>
                    <span className="calendar-upcoming-time">{timeRange(event)}</span>
                    <span className="calendar-upcoming-body">
                      <span className="calendar-upcoming-title">{event.title}</span>
                      {event.location && <span className="calendar-upcoming-meta"><MapPin size={12} aria-hidden="true" /> {event.location}</span>}
                      {note && <span className="calendar-upcoming-meta">{note}</span>}
                      <span className="calendar-upcoming-tags">
                        {event.source === "google" && <span className="calendar-tag">Google · leitura</span>}
                        {event.reflection && <span className="calendar-tag">{event.reflection.inSync ? "No Google" : "Google desatualizado"}</span>}
                        <EventStatus status={statusOf.get(event.id)?.status ?? "synced"} />
                      </span>
                    </span>
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default memo(UpcomingList);
