import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import ButtonGroup from "../components/ButtonGroup";
import { addDays, todayLocal, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput, EventDraft, GoogleStatusOutput, GoogleSyncOutput } from "../lib/calendar-api";
import EventForm, { type NoteChoice } from "./EventForm";
import GooglePanel from "./GooglePanel";
import MonthView from "./MonthView";
import TimeGrid from "./TimeGrid";
import UpcomingList from "./UpcomingList";
import YearView from "./YearView";
import { periodLabel } from "./format";
import { shift, visibleDays, type ViewMode } from "./layout";
import type { DisplayEvent } from "./outbox";
import type { CalendarStore } from "./store";
import { useCalendar, type RangeRemote } from "./use-calendar";
import "./calendar.css";

export type GoogleApi = {
  getStatus: (signal?: AbortSignal) => Promise<GoogleStatusOutput>;
  sync: () => Promise<GoogleSyncOutput>;
  reflect: (id: string) => Promise<unknown>;
  unreflect: (id: string, keepRemote: boolean) => Promise<unknown>;
};

const modes = [
  { value: "day", label: "Dia" }, { value: "week", label: "Semana" }, { value: "month", label: "Mês" }, { value: "year", label: "Ano" },
] as const;

type Editing = { key: number; entry: DisplayEvent | null; day: CalendarDate };

export default function CalendarWorkspace({ ownerId, store, remote, loadNotes, google, isCurrent }: {
  ownerId: string;
  store: CalendarStore;
  remote: RangeRemote;
  loadNotes: () => Promise<NoteChoice[]>;
  google: GoogleApi;
  isCurrent?: () => boolean;
}) {
  const calendar = useCalendar({ ownerId, store, remote, isCurrent });
  const { mode, anchor, setAnchor, setMode } = calendar;
  const [editing, setEditing] = useState<Editing | null>(null);
  // O formulário fica montado com `open` controlado: o Modal compartilhado faz a saída animada e devolve o foco ao botão que o abriu.
  const [formOpen, setFormOpen] = useState(false);
  const [notes, setNotes] = useState<NoteChoice[]>([]);
  const [notesState, setNotesState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [status, setStatus] = useState<GoogleStatusOutput | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    setNotesState("loading");
    loadNotes().then((items) => { if (!abort.signal.aborted) { setNotes(items); setNotesState("ready"); } }).catch(() => { if (!abort.signal.aborted) setNotesState("unavailable"); });
    google.getStatus(abort.signal).then((value) => { if (!abort.signal.aborted) { setStatus(value); setStatusError(null); } }).catch(() => { if (!abort.signal.aborted) setStatusError("Status indisponível agora (sem conexão ou sem acesso)."); });
    return () => abort.abort();
  }, [loadNotes, google, ownerId, calendar.connectivity]);

  // Troca de período/modo: entrada curta da vista; sem movimento quando o sistema pede movimento reduzido.
  const viewKey = `${mode}:${anchor.year}-${anchor.month}-${anchor.day}`;
  useLayoutEffect(() => {
    const element = viewRef.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(element, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .2, ease: "power2.out", clearProps: "opacity,transform" });
    });
    return () => media.revert();
  }, [viewKey]);

  const events = useMemo(() => calendar.events.map((item) => item.event), [calendar.events]);
  const open = useCallback((event: CalendarEventOutput) => { setEditing({ key: ++counter.current, entry: calendar.statusOf.get(event.id) ?? null, day: anchor }); setFormOpen(true); }, [calendar.statusOf, anchor]);
  const openNew = (day: CalendarDate = anchor) => { setEditing({ key: ++counter.current, entry: null, day }); setFormOpen(true); };
  const pickDay = (day: CalendarDate) => { setAnchor(day); setMode("day"); };

  const submit = async (draft: EventDraft) => {
    const entry = editing?.entry;
    if (entry) await calendar.submit({ kind: "update", event: entry.event, draft });
    else await calendar.submit({ kind: "create", eventId: crypto.randomUUID(), draft });
  };

  const pending = calendar.ops.filter((op) => op.state === "pending").length;
  const conflicts = calendar.ops.filter((op) => op.state === "conflict").length;
  const rejected = calendar.ops.filter((op) => op.state === "rejected").length;
  const offline = calendar.connectivity === "offline";
  // Piso do servidor (Retry-After): "Tentar agora" não o antecipa, então a tela diz até quando ele vale.
  const waitUntil = Math.max(0, ...calendar.ops.filter((op) => op.state === "pending").map((op) => op.notBefore));

  const days = mode === "day" ? [anchor] : Array.from({ length: 7 }, (_, index) => addDays(visibleDays("week", anchor).first, index));
  const today = todayLocal();
  const isToday = anchor.year === today.year && anchor.month === today.month && anchor.day === today.day;

  return (
    <section className="calendar-page" aria-labelledby="calendar-title">
      <header className="calendar-head">
        <div>
          <div className="eyebrow">TEMPO COM CONTEXTO</div>
          <h1 id="calendar-title">Agendas<em>.</em></h1>
        </div>
        <p className="calendar-sync" role="status" data-tone={conflicts || rejected ? "alert" : pending || offline ? "pending" : "ok"}>
          {conflicts > 0 ? `${conflicts} conflito(s) para resolver. ` : ""}
          {rejected > 0 ? `${rejected} envio(s) recusado(s) pelo servidor. ` : ""}
          {offline ? "Sem conexão. " : ""}
          {pending > 0 ? `${pending} alteração(ões) salva(s) só neste dispositivo, aguardando envio.${waitUntil > Date.now() ? ` O servidor pediu para aguardar até ${new Date(waitUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : ""}` : calendar.fetchState.status === "ok" && !conflicts && !rejected ? `Em dia com o servidor desde ${new Date(calendar.fetchState.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : calendar.fetchState.status === "stale" ? calendar.fetchState.reason : calendar.fetchState.status === "loading" ? "Atualizando…" : ""}
          {(pending > 0 || offline || calendar.fetchState.status === "stale") && <> <button type="button" className="calendar-link-button" onClick={calendar.retryNow}>Tentar agora</button></>}
        </p>
      </header>
      {calendar.localError && <p className="calendar-error" role="alert">{calendar.localError}</p>}

      <div className="calendar-toolbar">
        <ButtonGroup label="Visualização" options={modes} value={mode} onChange={setMode as (value: ViewMode) => void} />
        <div className="calendar-nav" role="group" aria-label="Período">
          <button type="button" className="calendar-icon-button" aria-label="Período anterior" onClick={() => setAnchor(shift(mode, anchor, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" className="calendar-today" onClick={() => setAnchor(today)} disabled={isToday && mode === "day"}>Hoje</button>
          <button type="button" className="calendar-icon-button" aria-label="Próximo período" onClick={() => setAnchor(shift(mode, anchor, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
          <strong className="calendar-period" aria-live="polite">{periodLabel(mode, anchor)}</strong>
        </div>
        <button type="button" className="button calendar-new" onClick={() => openNew()}><Plus size={14} aria-hidden="true" />&nbsp;Novo evento</button>
      </div>

      <div className="calendar-layout">
        <UpcomingList events={calendar.upcoming} statusOf={calendar.statusOf} onOpen={open} />
        <div className="calendar-view" ref={viewRef} aria-label={`Visualização por ${modes.find((item) => item.value === mode)?.label.toLowerCase()}`}>
          {(mode === "day" || mode === "week") && <TimeGrid days={days} events={events} statusOf={calendar.statusOf} onOpen={open} onPickDay={mode === "week" ? pickDay : undefined} />}
          {mode === "month" && <MonthView anchor={anchor} events={events} statusOf={calendar.statusOf} onOpen={open} onPickDay={pickDay} />}
          {mode === "year" && <YearView anchor={anchor} events={events} onPickMonth={(month) => { setAnchor({ ...anchor, month, day: 1 }); setMode("month"); }} onPickDay={pickDay} />}
        </div>
      </div>

      <GooglePanel status={status} error={statusError} onSync={async () => { const result = await google.sync(); setStatus(await google.getStatus().catch(() => status)); calendar.refreshNow(); return result; }} />

      {editing && (
        <EventForm
          key={editing.key} open={formOpen} entry={editing.entry} day={editing.day} notes={notes} notesState={notesState} events={events} google={status}
          reflector={editing.entry ? {
            reflect: async (id) => { await google.reflect(id); setFormOpen(false); calendar.refreshNow(); },
            unreflect: async (id, keepRemote) => { await google.unreflect(id, keepRemote); setFormOpen(false); calendar.refreshNow(); },
          } : null}
          onClose={() => setFormOpen(false)} onSubmit={submit}
          onDelete={async () => { if (editing.entry) await calendar.submit({ kind: "delete", event: editing.entry.event }); }}
          onResolve={async (choice) => { if (editing.entry) await calendar.resolve(editing.entry.event.id, choice); }}
          onDiscard={async () => { if (editing.entry) await calendar.discard(editing.entry.event.id); }}
        />
      )}
    </section>
  );
}
