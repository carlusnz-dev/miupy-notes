import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import ArrowIcon from "./components/ArrowIcon";
import { SkeletonBody } from "./components/Skeleton";
import { relativeDay, startDay, timeRange } from "./calendar/format";
import { listEventsInRange, listTasks, type CalendarEventOutput, type TaskOutput } from "./lib/calendar-api";
import { useRecentNoteCandidates } from "./lib/notes-queries";
import type { NoteMetadataOutput } from "./lib/notes-api";
import { overdueLabel, pickToday, TODAY_EVENT_DAYS, TODAY_LIMIT } from "./home-today";
import "./home-today.css";

export type TodayPreview = "vazio" | "lista" | "carregando" | "erro";
type Source<T> = { status: "loading" | "error" | "ready"; data: T; retry?: () => void };

const editedFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });

function fromQuery<Q, T>(query: UseQueryResult<Q>, pick: (data: Q) => T[]): Source<T[]> {
  if (query.data !== undefined) return { status: "ready", data: pick(query.data) };
  return { status: query.isError ? "error" : "loading", data: [], retry: () => void query.refetch() };
}

/** Dados de exemplo (só em desenvolvimento, `#/?estado=`): nada sai para a rede. */
function previewSources(name: TodayPreview): { events: Source<CalendarEventOutput[]>; tasks: Source<TaskOutput[]>; notes: Source<NoteMetadataOutput[]> } {
  if (name === "carregando" || name === "erro") {
    const source = (): Source<never[]> => ({ status: name === "erro" ? "error" : "loading", data: [] });
    return { events: source(), tasks: source(), notes: source() };
  }
  const now = Date.now();
  const hour = 3_600_000;
  const events = name === "vazio" ? [] : [
    { id: "e1", title: "Planejamento semanal", allDay: false, start: new Date(now + hour).toISOString(), end: new Date(now + 2 * hour).toISOString() },
    { id: "e2", title: "Almoço com Ana", allDay: false, start: new Date(now + 4 * hour).toISOString(), end: new Date(now + 5 * hour).toISOString() },
    { id: "e3", title: "Dentista", allDay: false, start: new Date(now + 30 * hour).toISOString(), end: new Date(now + 31 * hour).toISOString() },
  ] as CalendarEventOutput[];
  const day = new Date(now - 36 * hour).toISOString().slice(0, 10);
  const tasks = name === "vazio" ? [] : [{ id: "t1", title: "Pagar a fatura do cartão", status: "pending", dueDate: day, dueTime: "09:00" }] as TaskOutput[];
  const notes = name === "vazio" ? [] : [{ id: "n1", title: "Roteiro do trimestre", updatedAt: new Date(now - 5 * hour).toISOString() }] as NoteMetadataOutput[];
  return { events: { status: "ready", data: events }, tasks: { status: "ready", data: tasks }, notes: { status: "ready", data: notes } };
}

function Column<T>({ title, source, loading, unavailable = "Indisponível agora.", children }: { title: string; source: Source<T>; loading: string; unavailable?: string; children: React.ReactNode }) {
  return (
    <article className="today-column">
      <h3>{title}</h3>
      {source.status === "loading" && <SkeletonBody label={loading} lines={3} />}
      {source.status === "error" && (
        <p className="today-note" role="status">{unavailable} {source.retry && <button type="button" className="today-retry" onClick={source.retry}>Tentar de novo</button>}</p>
      )}
      {source.status === "ready" && children}
    </article>
  );
}

/**
 * Faixa "Hoje" do Início: próximos eventos, tarefas atrasadas e a nota editada por último. Só usa os clientes
 * que a Agenda e as Notas já têm; a seleção fica em `home-today.ts` e a regra de "atrasada" vem da API.
 */
export default function HomeToday({ enabled, preview }: { enabled: boolean; preview?: TodayPreview | null }) {
  const live = enabled && !preview;
  const today = new Date().toDateString();
  const eventsQuery = useQuery({
    queryKey: ["home", "today-events", today],
    queryFn: ({ signal }) => {
      const now = new Date();
      return listEventsInRange({ from: now.toISOString(), to: new Date(now.getTime() + TODAY_EVENT_DAYS * 86_400_000).toISOString() }, signal);
    },
    enabled: live,
  });
  const tasksQuery = useQuery({ queryKey: ["home", "today-tasks"], queryFn: ({ signal }) => listTasks(signal), enabled: live });
  const notesQuery = useRecentNoteCandidates(live);

  const events = useMemo(() => (preview ? previewSources(preview).events : fromQuery(eventsQuery, (items) => items)), [preview, eventsQuery]);
  const tasks = useMemo(() => (preview ? previewSources(preview).tasks : fromQuery(tasksQuery, (items) => items)), [preview, tasksQuery]);
  const notes = useMemo(() => (preview ? previewSources(preview).notes : notesQuery.data?.nextCursor ? { status: "error" as const, data: [] } : fromQuery(notesQuery, ({ items }) => items)), [preview, notesQuery]);
  const picked = useMemo(() => pickToday({ events: events.data, tasks: tasks.data, notes: notes.data }), [events.data, tasks.data, notes.data]);
  const settled = [events, tasks, notes].every((source) => source.status === "ready");
  const nothing = settled && picked.events.length === 0 && picked.overdueTotal === 0 && !picked.note;

  return (
    <section className="home-today" aria-labelledby="today-title">
      <div className="dashboard-heading">
        <h2 id="today-title">Hoje</h2>
        <Link className="dashboard-link" to="/agendas">Abrir agenda <ArrowIcon direction="right" size={16} /></Link>
      </div>
      {nothing ? (
        <div className="today-empty">
          <strong>Nada para hoje</strong>
          <p>Sem eventos próximos nem tarefas atrasadas. <Link className="today-link" to="/agendas">Ver a Agenda</Link></p>
        </div>
      ) : (
        <div className="today-grid">
          <Column title="Próximos eventos" source={events} loading="Carregando eventos…">
            {picked.events.length === 0 ? <p className="today-note">Nada marcado nos próximos {TODAY_EVENT_DAYS} dias.</p> : (
              <ul>{picked.events.map((event) => (
                <li key={event.id}><Link className="today-item" to="/agendas"><strong>{event.title}</strong><span>{relativeDay(startDay(event))} · {timeRange(event)}</span></Link></li>
              ))}</ul>
            )}
          </Column>
          <Column title="Tarefas atrasadas" source={tasks} loading="Carregando tarefas…">
            {picked.overdueTotal === 0 ? <p className="today-note">Nenhuma tarefa atrasada.</p> : (
              <ul>
                {picked.overdue.map((task) => <li key={task.id}><Link className="today-item" to="/agendas"><strong>{task.title}</strong><span>{overdueLabel(task)}</span></Link></li>)}
                {picked.overdueTotal > TODAY_LIMIT && <li><Link className="today-more" to="/agendas">+{picked.overdueTotal - TODAY_LIMIT} {picked.overdueTotal - TODAY_LIMIT === 1 ? "atrasada" : "atrasadas"}</Link></li>}
              </ul>
            )}
          </Column>
          <Column title="Nota recente" source={notes} loading="Carregando notas…" unavailable={notesQuery.data?.nextCursor ? "A consulta de nota recente ainda não está disponível para acervos maiores." : undefined}>
            {picked.note === null ? <p className="today-note">Nenhuma nota ainda.</p> : (
              <ul><li><Link className="today-item" to={`/notes/${picked.note.id}`}><strong>{picked.note.title || "Sem título"}</strong><span>Editada em {editedFormat.format(new Date(picked.note.updatedAt))}</span></Link></li></ul>
            )}
          </Column>
        </div>
      )}
    </section>
  );
}
