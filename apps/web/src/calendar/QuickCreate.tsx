import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ButtonGroup from "../components/ButtonGroup";
import Modal from "../components/Modal";
import { useAnchoredPosition, useDismiss, usePresence } from "../components/popover";
import { toIso, type CalendarDate } from "../lib/calendar-date";
import type { EventDraft } from "../lib/calendar-api";
import { buildDraft, initialFields, type Fields } from "./draft";
import { relativeDay } from "./format";
import { applyDuration, quickDurations, type QuickDuration } from "./quick-times";
import type { TaskFields } from "./TaskForm";
import Button from "../components/Button";

export type ItemKind = "event" | "task";
/** O que o formulário completo recebe ao tocar em "Mais opções": o que já foi digitado no cartão. */
export type MoreSeed = { kind: ItemKind; event: Partial<Fields>; task: Partial<TaskFields> };

const CARD_WIDTH = 328;
/** Meia-altura da âncora (px): o cartão abre acima ou abaixo da linha tocada, nunca sobre ela. */
const ANCHOR_REACH_PX = 12;
const SHEET_QUERY = "(max-width: 760px)";
const pad = (value: number) => String(value).padStart(2, "0");
const clock = (minutes: number) => minutes >= 1440 ? "23:59" : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Criação rápida: título e duração (chips) no horário tocado; o resto fica em "Mais opções", que abre o formulário
 * completo com o que foi digitado. No desktop é um cartão ao lado do ponto tocado (Esc e clique fora fecham); no celular
 * é uma folha de baixo (Modal compartilhado, até 50 dvh).
 */
export default function QuickCreate({ x, y, day, startMin, endMin, onClose, onSaveEvent, onMore }: {
  x: number;
  y: number;
  day: CalendarDate;
  /** Minutos desde 00:00 do horário tocado; ausente quando o toque foi numa célula do mês. */
  startMin?: number;
  endMin?: number;
  onClose: () => void;
  onSaveEvent: (draft: EventDraft) => Promise<void>;
  onMore: (seed: MoreSeed) => void;
}) {
  const [sheet] = useState(() => window.matchMedia(SHEET_QUERY).matches);
  const [open, setOpen] = useState(true);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState<QuickDuration>("60");
  const [base] = useState<Fields>(() => {
    const fields = initialFields(null, day);
    if (startMin === undefined) return fields;
    return { ...fields, startDate: toIso(day), endDate: toIso(day), startTime: clock(startMin), endTime: clock(endMin ?? Math.min(1440, startMin + 60)) };
  });
  const fields = applyDuration({ ...base, title }, duration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = useRef<HTMLFormElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const titleId = useId();
  const mounted = usePresence(open && !sheet, card);
  const style = useAnchoredPosition(mounted, anchor, card, CARD_WIDTH, [error]);

  const close = () => { if (sheet) onClose(); else setOpen(false); };
  useDismiss(open && !sheet, card, () => { if (!busy) close(); });
  useEffect(() => { if (!sheet) titleInput.current?.focus(); }, [sheet]);
  // Cartão (desktop): terminada a saída, o pai desmonta e o foco volta a quem estava ativo antes. A folha (Modal) devolve o foco sozinha.
  useEffect(() => {
    if (sheet || mounted) return;
    onClose();
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault();
    const built = buildDraft(fields);
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError(null);
    try {
      await onSaveEvent(built.draft);
      setBusy(false);
      close();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível salvar. Seus dados continuam no cartão.");
    }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && !busy && !sheet) { event.stopPropagation(); close(); }
  }

  const when = `${relativeDay(day)} · ${fields.allDay ? "dia inteiro" : `${fields.startTime}–${fields.endTime}`}`;
  const content = (
    <>
      <div className="calendar-field">
        <label htmlFor={titleId}>Título</label>
        <input ref={titleInput} id={titleId} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <p className="calendar-quick-when" aria-live="polite">{when}</p>
      <ButtonGroup label="Duração" options={quickDurations} value={duration} onChange={setDuration} />
      {error && <p className="calendar-error" role="alert">{error}</p>}
      <div className="calendar-quick-actions">
        <Button type="button" disabled={busy} onClick={() => { close(); onMore({ kind: "event", event: fields, task: {} }); }}>Mais opções</Button>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Salvar"}</Button>
      </div>
    </>
  );

  if (sheet) {
    return (
      <Modal open={open} title="Novo evento" onClose={close} busy={busy} className="calendar-sheet">
        <form className="calendar-quick-form" onSubmit={(event) => void submit(event)} noValidate>{content}</form>
      </Modal>
    );
  }
  return (
    <>
      <span ref={anchor} className="calendar-quick-anchor" style={{ left: x, top: y - ANCHOR_REACH_PX, width: CARD_WIDTH, height: ANCHOR_REACH_PX * 2 }} aria-hidden="true" />
      {mounted && (
        <form ref={card} className="calendar-quick" role="dialog" aria-label="Criação rápida" style={style} onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown} noValidate>
          {content}
        </form>
      )}
    </>
  );
}
