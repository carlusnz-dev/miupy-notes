import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import ButtonGroup from "../components/ButtonGroup";
import { addDays, todayLocal, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput, EventDraft, GoogleStatusOutput, GoogleSyncOutput, TaskOutput } from "../lib/calendar-api";
import type { Fields } from "./draft";
import EventForm, { type NoteChoice } from "./EventForm";
import { calendarFetchCache } from "./fetch-cache";
import GooglePanel from "./GooglePanel";
import MonthView from "./MonthView";
import QuickCreate, { type ItemKind, type MoreSeed } from "./QuickCreate";
import TaskForm, { TaskFormBody, type TaskFields } from "./TaskForm";
import HabitsAgendaPanel from "./HabitsAgendaPanel";
import TasksPanel from "./TasksPanel";
import TimeGrid, { type NewTimes, type Slot } from "./TimeGrid";
import UpcomingList from "./UpcomingList";
import YearView from "./YearView";
import { periodLabel } from "./format";
import { shift, visibleDays, type ViewMode } from "./layout";
import { draftOf, type DisplayEvent } from "./outbox";
import type { CalendarStore } from "./store";
import { useTasks, type TasksApi } from "./tasks";
import { centeredScrollLeft } from "./touch-gesture";
import { useCalendar, type RangeRemote } from "./use-calendar";
import "./calendar.css";
import Button from "../components/Button";
import PageHeader from "../components/PageHeader";

export type GoogleApi = {
  /** Ativa com os escopos que o login já concedeu. */
  connect?: () => Promise<GoogleStatusOutput>;
  /** Refaz o login do Google com o Calendar no modo escolhido (consentimento único, sem OAuth separado). */
  grant?: (mode: "mirror" | "reflect") => Promise<void>;
  disconnect?: () => Promise<GoogleStatusOutput>;
  getStatus: (signal?: AbortSignal) => Promise<GoogleStatusOutput>;
  sync: () => Promise<GoogleSyncOutput>;
  reflect: (id: string) => Promise<unknown>;
  unreflect: (id: string, keepRemote: boolean) => Promise<unknown>;
};

const modes = [
  { value: "day", label: "Dia" }, { value: "week", label: "Semana" }, { value: "month", label: "Mês" }, { value: "year", label: "Ano" },
] as const;

type Editing = { key: number; entry: DisplayEvent | null; day: CalendarDate; seed?: Partial<Fields> };

export default function CalendarWorkspace({ ownerId, store, remote, loadNotes, google, tasksApi, habits, isCurrent }: {
  ownerId: string;
  store: CalendarStore;
  remote: RangeRemote;
  loadNotes: () => Promise<NoteChoice[]>;
  google: GoogleApi;
  /** Ausente = sem tarefas (o formulário não oferece "Tarefa"). */
  tasksApi?: TasksApi;
  /** Mostra as ocorrências de hábitos do dia em foco; ausente = sem painel. */
  habits?: boolean;
  isCurrent?: () => boolean;
}) {
  const calendar = useCalendar({ ownerId, store, remote, isCurrent });
  const tasks = useTasks(tasksApi, ownerId, calendar.connectivity);
  const overdueIds = useMemo(() => new Set(tasks.overdue.map((task) => task.id)), [tasks.overdue]);
  const { mode, anchor, setAnchor, setMode } = calendar;
  const [editing, setEditing] = useState<Editing | null>(null);
  // O formulário fica montado com `open` controlado: o Modal compartilhado faz a saída animada e devolve o foco ao botão que o abriu.
  const [formOpen, setFormOpen] = useState(false);
  // Criação: evento ou tarefa no mesmo Modal; tarefa existente abre o próprio formulário; o cartão rápido nasce do toque na grade.
  const [createKind, setCreateKind] = useState<ItemKind>("event");
  const [taskSeed, setTaskSeed] = useState<Partial<TaskFields>>({});
  const [taskEditing, setTaskEditing] = useState<{ key: number; task: TaskOutput } | null>(null);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [quick, setQuick] = useState<{ key: number; slot: Slot } | null>(null);
  const [notes, setNotes] = useState<NoteChoice[]>(() => calendarFetchCache.recall<NoteChoice[]>(ownerId, "notes") ?? []);
  const [notesState, setNotesState] = useState<"loading" | "ready" | "unavailable">(() => (calendarFetchCache.recall(ownerId, "notes") ? "ready" : "loading"));
  const [status, setStatusState] = useState<GoogleStatusOutput | null>(() => calendarFetchCache.recall<GoogleStatusOutput>(ownerId, "googleStatus") ?? null);
  const setStatus = useCallback((value: GoogleStatusOutput) => { calendarFetchCache.remember(ownerId, "googleStatus", value); setStatusState(value); }, [ownerId]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  // Notas e status vêm da memória da Agenda se frescos (voltar à página não busca de novo); a volta da rede força o status.
  const wasOffline = useRef(calendar.connectivity === "offline");
  useEffect(() => {
    const reconnected = wasOffline.current && calendar.connectivity === "online";
    wasOffline.current = calendar.connectivity === "offline";
    if (calendar.connectivity === "offline") return;
    const abort = new AbortController();
    if (!calendarFetchCache.recall(ownerId, "notes")) {
      setNotesState("loading");
      loadNotes().then((items) => { if (!abort.signal.aborted) { calendarFetchCache.remember(ownerId, "notes", items); setNotes(items); setNotesState("ready"); } }).catch(() => { if (!abort.signal.aborted) setNotesState("unavailable"); });
    }
    if (reconnected || !calendarFetchCache.recall(ownerId, "googleStatus")) {
      google.getStatus(abort.signal).then((value) => { if (!abort.signal.aborted) { setStatus(value); setStatusError(null); } }).catch(() => { if (!abort.signal.aborted) setStatusError("Status indisponível agora (sem conexão ou sem acesso)."); });
    }
    return () => abort.abort();
  }, [loadNotes, google, ownerId, calendar.connectivity, setStatus]);

  // Troca de período/modo (ease-in-out): anterior/próximo desliza no sentido da navegação; troca de modo ou
  // "Hoje" só funde. Sem movimento quando o sistema pede movimento reduzido; o contexto é revertido a cada troca.
  const viewKey = `${mode}:${anchor.year}-${anchor.month}-${anchor.day}`;
  const direction = useRef(0);
  const periodRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = viewRef.current;
    if (!element) return;
    const offset = direction.current * 28;
    direction.current = 0;
    // Semana e mês passam de 100% da largura no celular: abrem com o dia de hoje (se visível) no centro.
    const mark = element.querySelector<HTMLElement>("[data-today]");
    if (mark && element.scrollWidth > element.clientWidth) {
      const box = element.getBoundingClientRect();
      element.scrollLeft = centeredScrollLeft({ left: box.left, width: box.width, scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth }, mark.getBoundingClientRect());
    } else element.scrollLeft = 0;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(element, { opacity: 0, x: offset, y: offset ? 0 : 6 }, { opacity: 1, x: 0, y: 0, duration: .32, ease: "power2.inOut", clearProps: "opacity,transform" });
      if (periodRef.current) gsap.fromTo(periodRef.current, { opacity: 0, x: offset / 2 }, { opacity: 1, x: 0, duration: .28, ease: "power2.inOut", clearProps: "opacity,transform" });
    });
    return () => media.revert();
  }, [viewKey]);
  const go = (step: -1 | 1) => { direction.current = step; setAnchor(shift(mode, anchor, step)); };

  const events = useMemo(() => calendar.events.map((item) => item.event), [calendar.events]);
  const open = useCallback((event: CalendarEventOutput) => { setEditing({ key: ++counter.current, entry: calendar.statusOf.get(event.id) ?? null, day: anchor }); setFormOpen(true); }, [calendar.statusOf, anchor]);
  const openNew = (day: CalendarDate = anchor, seed?: Partial<Fields>, kind: ItemKind = "event", task: Partial<TaskFields> = {}) => {
    setEditing({ key: ++counter.current, entry: null, day, seed }); setCreateKind(kind); setTaskSeed(task); setFormOpen(true);
  };
  const openTask = useCallback((task: TaskOutput) => { setTaskEditing({ key: ++counter.current, task }); setTaskFormOpen(true); }, []);
  const pickSlot = useCallback((slot: Slot) => setQuick({ key: ++counter.current, slot }), []);
  const moreOptions = (slot: Slot, seed: MoreSeed) => { setQuick(null); openNew(slot.day, seed.event, seed.kind, seed.task); };
  // Uma gravação por gesto (a mesma fila de edição do formulário); o bloco volta ao lugar se ela falhar.
  const reschedule = useCallback(async (event: CalendarEventOutput, times: NewTimes) => {
    const shown = calendar.statusOf.get(event.id)?.event ?? event;
    await calendar.submit({ kind: "update", event: shown, draft: { ...draftOf(shown), ...times } });
  }, [calendar.statusOf, calendar.submit]); // eslint-disable-line react-hooks/exhaustive-deps
  // Callbacks estáveis: as vistas são memo e não re-renderizam quando só o modal ou o status do Google mudam.
  const pickDay = useCallback((day: CalendarDate) => { setAnchor(day); setMode("day"); }, [setAnchor, setMode]);
  const pickMonth = useCallback((month: number) => { setAnchor((current) => ({ ...current, month, day: 1 })); setMode("month"); }, [setAnchor, setMode]);

  const submit = async (draft: EventDraft) => {
    const entry = editing?.entry;
    if (entry) await calendar.submit({ kind: "update", event: entry.event, draft });
    else await calendar.submit({ kind: "create", eventId: crypto.randomUUID(), draft });
  };

  const { pending, conflicts, rejected } = useMemo(() => calendar.ops.reduce((count, op) => ({ ...count, pending: count.pending + Number(op.state === "pending"), conflicts: count.conflicts + Number(op.state === "conflict"), rejected: count.rejected + Number(op.state === "rejected") }), { pending: 0, conflicts: 0, rejected: 0 }), [calendar.ops]);
  const offline = calendar.connectivity === "offline";
  // Piso do servidor (Retry-After): "Tentar agora" não o antecipa, então a tela diz até quando ele vale.
  const waitUntil = Math.max(0, ...calendar.ops.filter((op) => op.state === "pending").map((op) => op.notBefore));

  const days = useMemo(() => mode === "day" ? [anchor] : Array.from({ length: 7 }, (_, index) => addDays(visibleDays("week", anchor).first, index)), [mode, anchor]);
  const today = todayLocal();
  const isToday = anchor.year === today.year && anchor.month === today.month && anchor.day === today.day;

  return (
    <section className="calendar-page" aria-labelledby="calendar-title">
      <PageHeader id="calendar-title" eyebrow="TEMPO COM CONTEXTO" title="Agendas" actions={
        <p className="calendar-sync" role="status" data-tone={conflicts || rejected ? "alert" : pending || offline ? "pending" : "ok"}>
          {conflicts > 0 ? `${conflicts} conflito(s) para resolver. ` : ""}
          {rejected > 0 ? `${rejected} envio(s) recusado(s) pelo servidor. ` : ""}
          {offline && (pending > 0 || calendar.fetchState.status !== "stale") ? "Sem conexão. " : ""}
          {pending > 0 ? `${pending} alteração(ões) salva(s) só neste dispositivo, aguardando envio.${waitUntil > Date.now() ? ` O servidor pediu para aguardar até ${new Date(waitUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : ""}` : calendar.fetchState.status === "ok" && !conflicts && !rejected ? `Em dia com o servidor desde ${new Date(calendar.fetchState.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : calendar.fetchState.status === "stale" ? calendar.fetchState.reason : calendar.fetchState.status === "loading" ? "Atualizando…" : ""}
          {(pending > 0 || offline || calendar.fetchState.status === "stale") && <> <button type="button" className="calendar-link-button" onClick={calendar.retryNow}>Tentar agora</button></>}
        </p>
      } />
      {calendar.localError && <p className="calendar-error" role="alert">{calendar.localError}</p>}

      <div className="calendar-toolbar">
        <ButtonGroup label="Visualização" options={modes} value={mode} onChange={setMode as (value: ViewMode) => void} />
        <div className="calendar-nav" role="group" aria-label="Período">
          <button type="button" className="calendar-icon-button" aria-label="Período anterior" onClick={() => go(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" className="calendar-today" onClick={() => setAnchor(today)} disabled={isToday && mode === "day"}>Hoje</button>
          <button type="button" className="calendar-icon-button" aria-label="Próximo período" onClick={() => go(1)}><ChevronRight size={16} aria-hidden="true" /></button>
          <strong className="calendar-period" ref={periodRef} aria-live="polite">{periodLabel(mode, anchor)}</strong>
        </div>
        <Button variant="primary" className="calendar-new" type="button" onClick={() => openNew()}><Plus size={14} aria-hidden="true" />&nbsp;Novo evento</Button>
      </div>

      <div className="calendar-layout" data-mode={mode}>
        <div className="calendar-top">
          <UpcomingList events={calendar.upcoming} statusOf={calendar.statusOf} onOpen={open} onCreate={() => openNew()} />
          {habits && <HabitsAgendaPanel day={anchor} />}
          {tasksApi && tasks.state === "ready" && <TasksPanel pending={tasks.pending} overdue={tasks.overdue} onToggle={tasks.toggle} onOpen={openTask} error={tasks.error} onDismissError={tasks.dismissError} />}
        </div>
        <div className="calendar-view" ref={viewRef} aria-label={`Visualização por ${modes.find((item) => item.value === mode)?.label.toLowerCase()}`}>
          {(mode === "day" || mode === "week") && <TimeGrid days={days} events={events} tasks={tasks.tasks} overdueIds={overdueIds} statusOf={calendar.statusOf} onOpen={open} onPickDay={mode === "week" ? pickDay : undefined} onPickSlot={pickSlot} onReschedule={reschedule} onToggleTask={tasks.toggle} onOpenTask={openTask} />}
          {mode === "month" && <MonthView anchor={anchor} events={events} tasks={tasks.tasks} overdueIds={overdueIds} statusOf={calendar.statusOf} onOpen={open} onPickDay={pickDay} onPickSlot={pickSlot} onToggleTask={tasks.toggle} onOpenTask={openTask} />}
          {mode === "year" && <YearView anchor={anchor} events={events} onPickMonth={pickMonth} onPickDay={pickDay} />}
        </div>

      <GooglePanel status={status} error={statusError}
        onConnect={google.connect ? async (mode) => { if (mode) await google.grant!(mode); const connected = await google.connect!(); if (isCurrent?.() === false) return; setStatus(connected); const result = await google.sync(); if (isCurrent?.() === false) return; setStatus(await google.getStatus()); calendar.refreshNow(); return result; } : undefined}
        onDisconnect={google.disconnect ? async () => { const disconnected = await google.disconnect!(); if (isCurrent?.() === false) return; setStatus(disconnected); calendar.refreshNow(); } : undefined}
        onSync={async () => { const result = await google.sync(); const next = await google.getStatus().catch(() => null); if (next) setStatus(next); calendar.refreshNow(); return result; }} />
      </div>

      {editing && (
        <EventForm
          key={editing.key} open={formOpen} entry={editing.entry} day={editing.day} seed={editing.seed} notes={notes} notesState={notesState} events={events} google={status}
          reflector={editing.entry ? {
            reflect: async (id) => { await google.reflect(id); setFormOpen(false); calendar.refreshNow(); },
            unreflect: async (id, keepRemote) => { await google.unreflect(id, keepRemote); setFormOpen(false); calendar.refreshNow(); },
          } : null}
          kind={!editing.entry && tasksApi ? { value: createKind, onChange: setCreateKind, task: <TaskFormBody open={formOpen} task={null} seed={taskSeed} onSubmit={tasks.create} onClose={() => setFormOpen(false)} /> } : undefined}
          onClose={() => setFormOpen(false)} onSubmit={submit}
          onDelete={async () => { if (editing.entry) await calendar.submit({ kind: "delete", event: editing.entry.event }); }}
          onResolve={async (choice) => { if (editing.entry) await calendar.resolve(editing.entry.event.id, choice); }}
          onDiscard={async () => { if (editing.entry) await calendar.discard(editing.entry.event.id); }}
        />
      )}
      {taskEditing && <TaskForm key={taskEditing.key} open={taskFormOpen} task={taskEditing.task} onClose={() => setTaskFormOpen(false)} onSubmit={(draft) => tasks.update(taskEditing.task.id, draft)} onDelete={() => tasks.remove(taskEditing.task.id)} />}
      {quick && (
        <QuickCreate key={quick.key} x={quick.slot.x} y={quick.slot.y} day={quick.slot.day} startMin={quick.slot.startMin} endMin={quick.slot.endMin}
          onClose={() => setQuick(null)}
          onSaveEvent={(draft) => calendar.submit({ kind: "create", eventId: crypto.randomUUID(), draft })}
          onMore={(seed) => moreOptions(quick.slot, seed)} />
      )}
    </section>
  );
}
