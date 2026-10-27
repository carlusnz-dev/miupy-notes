import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toIso, type CalendarDate } from "../lib/calendar-date";
import { dayView, toggleRequest, type DayData } from "../habits/day-data";
import { listOccurrences, setOccurrenceStatus, type Occurrence } from "../lib/habits-api";

/** Ocorrências de hábitos do dia em foco na agenda; criar e editar hábitos fica na página Hábitos. */
export default function HabitsAgendaPanel({ day }: { day: CalendarDate }) {
  const iso = toIso(day);
  // Os itens ficam ligados ao dia lido: ao trocar de dia, ou se a leitura falhar, o painel não oferece ações sobre o dia anterior.
  const [loaded, setLoaded] = useState<DayData | null>(null), [readFailed, setReadFailed] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setError("");
    listOccurrences(iso, iso, abort.signal).then((items) => { setLoaded({ day: iso, items }); setReadFailed(false); }).catch((e) => {
      if (abort.signal.aborted) return;
      setReadFailed(true); setError(e instanceof Error ? e.message : "Não foi possível carregar os hábitos.");
    });
    return () => abort.abort();
  }, [iso, revision]);
  const view = dayView(loaded, iso, readFailed);
  const items = view?.items ?? [];
  const toggle = useCallback(async (item: Occurrence) => {
    const request = toggleRequest(view, iso, item);
    if (!request) return;
    setError("");
    try { await setOccurrenceStatus(request.habitId, request.date, request.status); setRevision((value) => value + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar o hábito."); }
  }, [view, iso]);
  if (items.length === 0 && !error) return null;
  return (
    <section className="calendar-tasks calendar-habits" aria-label="Hábitos do dia">
      <div className="calendar-tasks-head"><span>Hábitos do dia: <strong>{items.filter((item) => item.status === "completed").length}/{items.length}</strong></span><Link className="calendar-link-button" to="/habits">Abrir hábitos</Link></div>
      {error && <p className="calendar-error" role="alert">{error}</p>}
      <div className="calendar-tasks-list"><ul>{items.map((item) => (
        <li key={item.habitId} data-done={item.status === "completed" || undefined}>
          <input type="checkbox" checked={item.status === "completed"} disabled={!view?.actionable} onChange={() => void toggle(item)} aria-label={`${item.status === "completed" ? "Marcar como pendente" : "Concluir"} hábito: ${item.title}`} />
          <span>{item.time && <small>{item.time} </small>}{item.title}</span>
        </li>
      ))}</ul></div>
    </section>
  );
}
