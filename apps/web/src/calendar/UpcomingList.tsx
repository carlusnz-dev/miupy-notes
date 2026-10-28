import { memo, useMemo, useState } from "react";
import { MapPin, Repeat } from "lucide-react";
import EventCarousel from "../components/EventCarousel";
import Modal from "../components/Modal";
import type { CalendarEventOutput } from "../lib/calendar-api";
import EventStatus from "./EventStatus";
import { relativeDay, startDay, timeRange, zoneNote } from "./format";
import { groupEvents, type EventGroup } from "./groups";
import type { DisplayEvent } from "./outbox";
import { UPCOMING_DAYS } from "./use-calendar";
import Button from "../components/Button";

const MAX_NEXT_DATES = 3;

/** "seg., 26 out" sem o "Hoje"/"Amanhã", para a lista de próximas datas do grupo. */
const dayLabel = (event: CalendarEventOutput) => relativeDay(startDay(event));

function GroupCard({ group, statusOf, onClick }: { group: EventGroup; statusOf: Map<string, DisplayEvent>; onClick: () => void }) {
  const [event] = group.events;
  const count = group.events.length;
  const note = zoneNote(event);
  const rest = group.events.slice(1, 1 + MAX_NEXT_DATES);
  const later = count > 1 ? `${count} ocorrências · depois: ${rest.map(dayLabel).join(" · ")}${count - 1 > rest.length ? ` +${count - 1 - rest.length}` : ""}` : null;
  // Linha compacta (~72 px): dia e hora, título e uma única linha de detalhes que trunca; o texto inteiro fica no `title`.
  const full = [event.title, timeRange(event), event.location, note, later].filter(Boolean).join(" · ");
  return (
    <button type="button" className="calendar-upcoming-item" data-source={event.source} title={full} onClick={onClick}>
      <span className="calendar-upcoming-line">
        <span className="calendar-upcoming-when">{dayLabel(event)}</span>
        <span className="calendar-upcoming-time">{timeRange(event)}</span>
        {count === 1 && <EventStatus status={statusOf.get(event.id)?.status ?? "synced"} />}
      </span>
      <span className="calendar-upcoming-title">{event.title}</span>
      <span className="calendar-upcoming-line calendar-upcoming-details">
        {event.source === "google" && <span className="calendar-tag">Google · leitura</span>}
        {event.reflection && <span className="calendar-tag">{event.reflection.state === "deleted_remote" ? "Excluído no Google" : event.reflection.inSync ? "No Google" : "Google desatualizado"}</span>}
        {event.location && <span className="calendar-upcoming-meta"><MapPin size={12} aria-hidden="true" /> {event.location}</span>}
        {note && <span className="calendar-upcoming-meta">{note}</span>}
        {later && <span className="calendar-upcoming-meta"><Repeat size={12} aria-hidden="true" /> {later}</span>}
      </span>
    </button>
  );
}

/** Detalhes da série e lista das ocorrências; cada uma abre a edição já existente. */
function GroupModal({ open, group, statusOf, onClose, onPick }: {
  open: boolean;
  group: EventGroup;
  statusOf: Map<string, DisplayEvent>;
  onClose: () => void;
  onPick: (event: CalendarEventOutput) => void;
}) {
  const [event] = group.events;
  const note = zoneNote(event);
  return (
    <Modal open={open} title={event.title} onClose={onClose} className="calendar-modal">
      <div className="calendar-readonly">
        <p>{timeRange(event)}{note ? ` · ${note}` : ""}</p>
        {event.location && <p>{event.location}</p>}
        {event.description && <p className="calendar-description">{event.description}</p>}
        {event.source === "google" && <p className="calendar-note">Espelho do Google Calendar.</p>}
        <h3 className="calendar-occurrences-title">{group.events.length} {group.events.length === 1 ? "ocorrência" : "ocorrências"}</h3>
        <ol className="calendar-occurrences">
          {group.events.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onPick(item)}>
                <span>{dayLabel(item)}</span>
                <span className="calendar-occurrence-time">{timeRange(item)}</span>
                <EventStatus status={statusOf.get(item.id)?.status ?? "synced"} />
              </button>
            </li>
          ))}
        </ol>
        <div className="modal-actions"><Button type="button" onClick={onClose}>Fechar</Button></div>
      </div>
    </Modal>
  );
}

/**
 * Próximos eventos acima da grade, num carrossel. Eventos repetidos em dias diferentes (mesma série) viram um bloco só;
 * clicar abre os detalhes e as ocorrências. Evento único abre direto a edição.
 */
function UpcomingList({ events, statusOf, onOpen, onCreate }: {
  events: CalendarEventOutput[];
  statusOf: Map<string, DisplayEvent>;
  onOpen: (event: CalendarEventOutput) => void;
  onCreate: () => void;
}) {
  const groups = useMemo(() => groupEvents(events), [events]);
  // `shown` sobrevive ao fechamento para o Modal terminar a saída com o conteúdo certo.
  const [shown, setShown] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const current = groups.find((group) => group.key === shown) ?? null;
  return (
    <section className="calendar-upcoming" aria-labelledby="calendar-upcoming-title">
      {groups.length === 0 ? (
        <>
          <h2 id="calendar-upcoming-title">Próximos eventos</h2>
          <div className="calendar-upcoming-empty">
            <p className="calendar-empty">Nada marcado nos próximos {UPCOMING_DAYS} dias.</p>
            <Button size="sm" onClick={onCreate}>Criar evento</Button>
          </div>
        </>
      ) : (
        <EventCarousel label="Próximos eventos" heading={<h2 id="calendar-upcoming-title">Próximos eventos</h2>}>
          {groups.map((group) => (
            <GroupCard key={group.key} group={group} statusOf={statusOf} onClick={() => { if (group.events.length === 1) onOpen(group.events[0]); else { setShown(group.key); setOpen(true); } }} />
          ))}
        </EventCarousel>
      )}
      {current && <GroupModal open={open} group={current} statusOf={statusOf} onClose={() => setOpen(false)} onPick={(event) => { setOpen(false); onOpen(event); }} />}
    </section>
  );
}

export default memo(UpcomingList);
