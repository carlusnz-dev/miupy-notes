import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toIso, type CalendarDate } from "../lib/calendar-date";
import { listOccurrences, setOccurrenceStatus, type Occurrence } from "../lib/habits-api";

/** Ocorrências de hábitos do dia em foco na agenda; criar e editar hábitos fica na página Hábitos. */
export default function HabitsAgendaPanel({ day }: { day: CalendarDate }) {
  const iso = toIso(day);
  const [items, setItems] = useState<Occurrence[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError("");
    listOccurrences(iso, iso, abort.signal).then(setItems).catch((e) => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Não foi possível carregar os hábitos."); });
    return () => abort.abort();
  }, [iso, revision]);
  const toggle = useCallback(async (item: Occurrence) => {
    setError("");
    try { await setOccurrenceStatus(item.habitId, item.date, item.status === "completed" ? "pending" : "completed"); setRevision((value) => value + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar o hábito."); }
  }, []);
  if (items.length === 0 && !error) return null;
  return (
    <section className="calendar-tasks calendar-habits" aria-label="Hábitos do dia">
      <div className="calendar-tasks-head"><span>Hábitos do dia: <strong>{items.filter((item) => item.status === "completed").length}/{items.length}</strong></span><Link className="calendar-link-button" to="/habits">Abrir hábitos</Link></div>
      {error && <p className="calendar-error" role="alert">{error}</p>}
      <div className="calendar-tasks-list"><ul>{items.map((item) => (
        <li key={item.habitId} data-done={item.status === "completed" || undefined}>
          <input type="checkbox" checked={item.status === "completed"} onChange={() => void toggle(item)} aria-label={`${item.status === "completed" ? "Marcar como pendente" : "Concluir"} hábito: ${item.title}`} />
          <span>{item.time && <small>{item.time} </small>}{item.title}</span>
        </li>
      ))}</ul></div>
    </section>
  );
}
