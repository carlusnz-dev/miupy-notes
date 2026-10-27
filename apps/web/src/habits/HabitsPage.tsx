import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import gsap from "gsap";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Button from "../components/Button";
import ButtonGroup from "../components/ButtonGroup";
import ConfirmDialog from "../components/ConfirmDialog";
import PageHeader from "../components/PageHeader";
import { SkeletonBody } from "../components/Skeleton";
import { addDays, fromIso, toDisplay, toIso, todayLocal } from "../lib/calendar-date";
import { signIn, useAuth } from "../lib/auth";
import { deleteHabit, getHabitsXp, listHabits, listOccurrences, restoreHabit, resumeHabit, setOccurrenceStatus, type Habit, type HabitsXp, type Occurrence } from "../lib/habits-api";
import { usePageTitle } from "../lib/use-page-title";
import { dayView, toggleRequest, type DayData } from "./day-data";
import HabitForm from "./HabitForm";
import { currentPause, kindLabel, priorityLabel, recurrenceLabel } from "./labels";
import PauseDialog from "./PauseDialog";
import XpSummary from "./XpSummary";
import "./habits.css";

const views = [{ value: "today", label: "Hoje" }, { value: "habits", label: "Hábitos" }, { value: "trash", label: "Lixeira" }] as const;
type View = typeof views[number]["value"];
const message = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
const shown = (iso: string) => { const date = fromIso(iso); return date ? toDisplay(date) : iso; };

export default function HabitsPage() {
  usePageTitle("Hábitos");
  const auth = useAuth();
  if (auth.status === "signed-in") return <HabitsWorkspace />;
  return <section className="habits-page"><PageHeader eyebrow="ROTINA" title="Hábitos" description="Pequenas repetições que sustentam o resto." />
    {auth.status === "checking" ? <p role="status">Verificando sua conta…</p> : auth.status === "unsupported" ? <p>Abra o aplicativo desktop para conectar sua conta e acessar seus hábitos.</p>
      : <Button variant="primary" onClick={() => void signIn()} disabled={auth.signingIn}>{auth.signingIn ? "Conectando…" : "Entrar com Google"}</Button>}
    {auth.error && <p role="alert">{auth.error}</p>}</section>;
}

function HabitsWorkspace() {
  const [view, setView] = useState<View>("today");
  const [day, setDay] = useState(() => toIso(todayLocal()));
  const [loaded, setLoaded] = useState<DayData | null>(null), [readFailed, setReadFailed] = useState(false);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [xp, setXp] = useState<HabitsXp>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const [form, setForm] = useState<{ existing?: Habit } | null>(null);
  const [pausing, setPausing] = useState<Habit | null>(null);
  const [deleting, setDeleting] = useState<Habit | null>(null);
  const [busy, setBusy] = useState(false), [deleteError, setDeleteError] = useState("");
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const today = toIso(todayLocal());

  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError("");
    const load = view === "today"
      ? listOccurrences(day, day, abort.signal).then(items => { setLoaded({ day, items }); setReadFailed(false); }, e => { if (!abort.signal.aborted) setReadFailed(true); throw e; })
      : listHabits(view === "trash", abort.signal).then(setHabits);
    Promise.all([load, getHabitsXp(abort.signal).then(setXp)])
      .catch(e => { if (!abort.signal.aborted) setError(message(e, "Não foi possível carregar os hábitos.")); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [view, day, revision]);

  // Os dados do dia ficam ligados à chave com que foram lidos: outro dia ou leitura falha não deixa ações sobre o dia errado.
  const current = view === "today" ? dayView(loaded, day, readFailed) : null;
  // Troca de dia (ease-in-out, como a troca de período da Agenda): desliza no sentido da navegação; reduzido só aparece.
  const bodyKey = current ? day : null;
  const direction = useRef(0), labelRef = useRef<HTMLElement>(null), bodyRef = useRef<HTMLDivElement>(null);
  const goTo = (next: string) => { direction.current = next > day ? 1 : -1; setDay(next); };
  const shift = (delta: number) => { const date = fromIso(day); if (date) goTo(toIso(addDays(date, delta))); };
  const slide = (element: HTMLElement | null, factor: number, duration: number) => {
    if (!element) return;
    const offset = direction.current * 28 * factor, media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => { gsap.fromTo(element, { opacity: 0, x: offset }, { opacity: 1, x: 0, duration, ease: "power2.inOut", clearProps: "opacity,transform" }); });
    return () => media.revert();
  };
  useLayoutEffect(() => (view === "today" ? slide(labelRef.current, .5, .28) : undefined), [view, day]);
  useLayoutEffect(() => (bodyKey ? slide(bodyRef.current, 1, .32) : undefined), [bodyKey]);
  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true); setError("");
    try { await action(); reload(); } catch (e) { setError(message(e, fallback)); } finally { setBusy(false); }
  }
  const toggle = (item: Occurrence) => {
    const request = toggleRequest(current, day, item);
    return request ? run(() => setOccurrenceStatus(request.habitId, request.date, request.status), "Não foi possível atualizar a ocorrência.") : undefined;
  };
  async function confirmDelete() {
    if (!deleting) return; setBusy(true); setDeleteError("");
    try { await deleteHabit(deleting.id); setDeleting(null); reload(); }
    catch (e) { setDeleteError(message(e, "Não foi possível excluir. Tente de novo.")); }
    finally { setBusy(false); }
  }
  const done = current?.items.filter(item => item.status === "completed").length ?? 0;

  return <section className="habits-page" aria-labelledby="habits-title" aria-busy={busy}>
    <PageHeader id="habits-title" eyebrow="ROTINA" title="Hábitos" description="Pequenas repetições que sustentam o resto." actions={<Button variant="primary" onClick={() => setForm({})} disabled={busy}><Plus size={16} aria-hidden="true" />&nbsp;Novo hábito</Button>} />
    {xp && <XpSummary xp={xp} />}
    <div className="habits-toolbar"><ButtonGroup label="Visão" value={view} options={views} onChange={setView} /></div>
    {error && <div className="habits-error" role="alert">{error} <Button onClick={reload}>Tentar de novo</Button></div>}
    {view === "today" ? <>
      <div className="habits-day">
        <Button size="sm" aria-label="Dia anterior" onClick={() => shift(-1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
        <strong ref={labelRef} aria-live="polite">{day === today ? "Hoje" : shown(day)}{day === today ? ` · ${shown(day)}` : ""}</strong>
        <Button size="sm" aria-label="Próximo dia" onClick={() => shift(1)}><ChevronRight size={16} aria-hidden="true" /></Button>
        {day !== today && <Button size="sm" variant="ghost" onClick={() => goTo(today)}>Voltar para hoje</Button>}
      </div>
      {current ? <div ref={bodyRef}>{current.items.length === 0 ? <p className="habits-empty">Nenhuma ocorrência neste dia.</p> : <>
        <p className="habits-count" role="status">{done} de {current.items.length} concluídas</p>
        <ul className="habits-list">{current.items.map(item => <li key={item.habitId} data-done={item.status === "completed" || undefined}>
          <input type="checkbox" checked={item.status === "completed"} disabled={busy || !current.actionable} onChange={() => void toggle(item)} aria-label={`${item.status === "completed" ? "Marcar como pendente" : "Concluir"}: ${item.title}`} />
          <div><span className="habits-title">{item.title}</span><small>{[item.time, kindLabel(item.kind), `Prioridade ${priorityLabel(item.priority).toLowerCase()}`, `${item.points} XP`].filter(Boolean).join(" · ")}</small></div>
        </li>)}</ul></>}</div>
        : loading && <SkeletonBody label="Carregando hábitos…" cards={3} columns={1} cardHeight={72} />}
    </> : loading ? <SkeletonBody label="Carregando hábitos…" cards={3} columns={1} cardHeight={72} /> : view === "habits" ? (habits.length === 0 ? <p className="habits-empty">Nenhum hábito ainda. Crie o primeiro em “Novo hábito”.</p>
      : <ul className="habits-list">{habits.map(habit => { const pause = currentPause(habit.pauses, today); return <li key={habit.id}>
        <div><span className="habits-title">{habit.title}</span><small>{[recurrenceLabel(habit.recurrence), habit.time, kindLabel(habit.kind), `Prioridade ${priorityLabel(habit.priority).toLowerCase()}`].filter(Boolean).join(" · ")}</small>
          {pause && <small className="habits-paused">Pausado desde {shown(pause.from)}{pause.until ? ` até ${shown(pause.until)}` : ""}</small>}</div>
        <div className="habits-actions">
          <Button size="sm" disabled={busy} onClick={() => setForm({ existing: habit })}>Editar</Button>
          {pause ? <Button size="sm" disabled={busy} onClick={() => void run(() => resumeHabit(habit, today > pause.from ? today : pause.from), "Não foi possível retomar.")}>Retomar</Button> : <Button size="sm" disabled={busy} onClick={() => setPausing(habit)}>Pausar</Button>}
          <Button size="sm" variant="danger" disabled={busy} onClick={() => { setDeleteError(""); setDeleting(habit); }}>Excluir</Button>
        </div></li>; })}</ul>)
    : (habits.length === 0 ? <p className="habits-empty">A lixeira está vazia.</p>
      : <><p className="habits-hint">Hábitos excluídos ficam aqui por 30 dias; o histórico de execuções é mantido.</p><ul className="habits-list">{habits.map(habit => <li key={habit.id}>
        <div><span className="habits-title">{habit.title}</span><small>{habit.purgeAfter ? `Remoção definitiva após ${shown(habit.purgeAfter.slice(0, 10))}` : ""}</small></div>
        <div className="habits-actions"><Button size="sm" disabled={busy} onClick={() => void run(() => restoreHabit(habit.id), "Não foi possível restaurar.")}>Restaurar</Button></div></li>)}</ul></>)}
    {form && <HabitForm existing={form.existing} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    {pausing && <PauseDialog habit={pausing} onClose={() => setPausing(null)} onSaved={() => { setPausing(null); reload(); }} />}
    <ConfirmDialog open={!!deleting} title="Excluir hábito?" confirmLabel="Excluir hábito" busyLabel="Excluindo…" busy={busy} error={deleteError} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()}>
      <p>“{deleting?.title}” vai para a lixeira por 30 dias e deixa de gerar ocorrências. Você pode restaurá-lo nesse prazo.</p>
    </ConfirmDialog>
  </section>;
}
