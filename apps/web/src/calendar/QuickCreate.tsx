import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ButtonGroup from "../components/ButtonGroup";
import DatePicker from "../components/DatePicker";
import TimeField from "../components/TimeField";
import { useAnchoredPosition, useDismiss, usePresence } from "../components/popover";
import { toIso, type CalendarDate } from "../lib/calendar-date";
import type { EventDraft, TaskDraft } from "../lib/calendar-api";
import { buildDraft, initialFields, type Fields } from "./draft";
import { buildTaskDraft, type TaskFields } from "./TaskForm";

export type ItemKind = "event" | "task";
/** O que o formulário completo recebe ao tocar em "Mais opções": o que já foi digitado no cartão. */
export type MoreSeed = { kind: ItemKind; event: Partial<Fields>; task: Partial<TaskFields> };

const CARD_WIDTH = 328;
const pad = (value: number) => String(value).padStart(2, "0");
const clock = (minutes: number) => minutes >= 1440 ? "23:59" : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const kinds = [{ value: "event", label: "Evento" }, { value: "task", label: "Tarefa" }] as const;

/**
 * Cartão de criação rápida, ancorado no ponto clicado: título, data e hora (já preenchidas pelo horário tocado), dia
 * inteiro e local. "Mais opções" abre o formulário completo com o que foi digitado. Esc e clique fora fecham.
 */
export default function QuickCreate({ x, y, day, startMin, endMin, onClose, onSaveEvent, onSaveTask, onMore }: {
  x: number;
  y: number;
  day: CalendarDate;
  /** Minutos desde 00:00 do horário tocado; ausente quando o toque foi numa célula do mês. */
  startMin?: number;
  endMin?: number;
  onClose: () => void;
  onSaveEvent: (draft: EventDraft) => Promise<void>;
  onSaveTask: (draft: TaskDraft) => Promise<void>;
  onMore: (seed: MoreSeed) => void;
}) {
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState<ItemKind>("event");
  const [fields, setFields] = useState<Fields>(() => {
    const base = initialFields(null, day);
    if (startMin === undefined) return base;
    return { ...base, startDate: toIso(day), endDate: toIso(day), startTime: clock(startMin), endTime: clock(endMin ?? Math.min(1440, startMin + 60)) };
  });
  const [taskDate, setTaskDate] = useState(() => toIso(day));
  const [taskTime, setTaskTime] = useState(() => startMin === undefined ? "" : clock(startMin));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLFormElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const ids = { title: useId(), location: useId() };
  const mounted = usePresence(open, card);
  const style = useAnchoredPosition(mounted, anchor, card, CARD_WIDTH, [kind, fields.allDay, error]);
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));

  const close = () => setOpen(false);
  useDismiss(open, card, () => { if (!busy) close(); });
  useEffect(() => { titleInput.current?.focus(); }, []);
  // Terminada a saída, o pai desmonta o cartão e o foco volta a quem estava ativo antes.
  useEffect(() => {
    if (mounted) return;
    onClose();
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  const taskFields = (): TaskFields => ({ title: fields.title, description: "", dueDate: taskDate, dueTime: taskTime, completed: false });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const built = kind === "event" ? buildDraft(fields) : buildTaskDraft(taskFields());
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError(null);
    try {
      if (kind === "event") await onSaveEvent((built as { draft: EventDraft }).draft);
      else await onSaveTask((built as { draft: TaskDraft }).draft);
      setBusy(false);
      close();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível salvar. Seus dados continuam no cartão.");
    }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); close(); }
  }

  return (
    <>
      <span ref={anchor} className="calendar-quick-anchor" style={{ left: x, top: y, width: CARD_WIDTH }} aria-hidden="true" />
      {mounted && (
        <form ref={card} className="calendar-quick" role="dialog" aria-label="Criação rápida" style={style} onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown} noValidate>
          <ButtonGroup label="Tipo" options={kinds} value={kind} onChange={setKind} />
          <div className="calendar-field">
            <label htmlFor={ids.title}>Título</label>
            <input ref={titleInput} id={ids.title} value={fields.title} maxLength={200} onChange={(event) => set("title", event.target.value)} />
          </div>
          {kind === "event" ? (
            <>
              <label className="calendar-check"><input type="checkbox" checked={fields.allDay} onChange={(event) => set("allDay", event.target.checked)} /> Dia inteiro</label>
              <DatePicker label="Dia" value={fields.startDate} onChange={(value) => { set("startDate", value); set("endDate", value); }} required />
              {!fields.allDay && (
                <div className="calendar-quick-times">
                  <TimeField label="Início" value={fields.startTime} onChange={(value) => set("startTime", value)} required />
                  <TimeField label="Fim" value={fields.endTime} onChange={(value) => set("endTime", value)} required />
                </div>
              )}
              <div className="calendar-field">
                <label htmlFor={ids.location}>Local (opcional)</label>
                <input id={ids.location} value={fields.location} maxLength={300} onChange={(event) => set("location", event.target.value)} />
              </div>
            </>
          ) : (
            <div className="calendar-quick-times">
              <DatePicker label="Data (opcional)" value={taskDate} onChange={(value) => { setTaskDate(value); if (!value) setTaskTime(""); }} />
              <TimeField label="Hora (opcional)" value={taskTime} onChange={setTaskTime} disabled={!taskDate} />
            </div>
          )}
          {error && <p className="calendar-error" role="alert">{error}</p>}
          <div className="calendar-quick-actions">
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => { close(); onMore({ kind, event: fields, task: taskFields() }); }}>Mais opções</button>
            <button type="submit" className="button" disabled={busy}>{busy ? "Guardando…" : "Salvar"}</button>
          </div>
        </form>
      )}
    </>
  );
}
