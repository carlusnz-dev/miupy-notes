import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import gsap from "gsap";
import { monthNames, toIso, todayLocal, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput, TaskOutput } from "../lib/calendar-api";
import { reducedMotion } from "../components/popover";
import { DAY_MIN, instantAt, isDraggable, moveSpan, resizeSpan, SNAP_MIN, type Span } from "./drag";
import EventStatus from "./EventStatus";
import { timeRange } from "./format";
import { dayBlocks, eventsOnDay, sameDay, type Block } from "./layout";
import type { DisplayEvent } from "./outbox";
import TaskMarker from "./TaskMarker";
import { tasksOnDay } from "./tasks";

const HOUR_PX = 48;
/** Abaixo desta altura o bloco vira uma linha só (título · hora), para o título nunca sumir. */
const COMPACT_PX = 40;
const MIN_BLOCK_PX = 20;
/** Deslocamento (px) a partir do qual o gesto vira arrasto; antes disso é um clique no bloco. */
const DRAG_THRESHOLD_PX = 4;
const hours = Array.from({ length: 24 }, (_, hour) => hour);

/** Ponto tocado numa grade vazia; sem `startMin` (célula do mês), vale o horário padrão. `x`/`y` ancoram o cartão de criação. */
export type Slot = { day: CalendarDate; startMin?: number; endMin?: number; x: number; y: number };
export type NewTimes = { start: string; end: string };

const pad = (value: number) => String(value).padStart(2, "0");
const clockLabel = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const spanLabel = (span: Span) => `${clockLabel(span.startMin)}–${span.endMin >= DAY_MIN ? "24:00" : clockLabel(span.endMin)}`;
const heightOf = (span: Span) => Math.max(MIN_BLOCK_PX, (span.endMin - span.startMin) / 60 * HOUR_PX - 2);

/** Minutos reais do evento no dia (a altura mínima do layout só vale para desenhar, nunca para o horário). */
function realSpan(event: CalendarEventOutput, day: CalendarDate): Span {
  const dayStart = new Date(day.year, day.month - 1, day.day).getTime();
  return { startMin: Math.round((Date.parse(event.start) - dayStart) / 60_000), endMin: Math.round((Date.parse(event.end) - dayStart) / 60_000) };
}

type Gesture = { id: string; event: CalendarEventOutput; mode: "move" | "resize"; originDay: number; originSpan: Span; dayIndex: number; span: Span; settling: boolean };
type Tracking = { pointerId: number; startX: number; startY: number; started: boolean; cancelled: boolean; origin: Gesture; removeKey: (() => void) | null };

/**
 * Cronograma por blocos (dia e semana): uma coluna por dia, eventos posicionados pelo horário local.
 * Eventos locais com hora podem ser movidos (arrastar o bloco) e ter o fim ajustado (arrastar a borda inferior):
 * encaixe em 15 min, mínimo de 15 min, uma única gravação ao soltar, Esc cancela. Teclado: Alt+setas movem,
 * Alt+Shift+setas ajustam o fim. Toque: só a borda inferior (o resto rola a grade); mover também pela edição.
 */
function TimeGrid({ days, events, tasks, overdueIds, statusOf, onOpen, onPickDay, onPickSlot, onReschedule, onToggleTask, onOpenTask }: {
  days: CalendarDate[];
  events: CalendarEventOutput[];
  tasks: TaskOutput[];
  overdueIds: ReadonlySet<string>;
  statusOf: Map<string, DisplayEvent>;
  onOpen: (event: CalendarEventOutput) => void;
  onPickDay?: (day: CalendarDate) => void;
  onPickSlot: (slot: Slot) => void;
  /** Uma chamada por gesto; se rejeitar, a grade volta ao horário anterior. */
  onReschedule: (event: CalendarEventOutput, times: NewTimes) => Promise<void>;
  onToggleTask: (task: TaskOutput) => void;
  onOpenTask: (task: TaskOutput) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const columnsEl = useRef<HTMLDivElement>(null);
  const ghostEl = useRef<HTMLDivElement>(null);
  const today = todayLocal();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Um cálculo de layout por dia e por mudança de eventos (antes: duas vezes por render, no efeito e no JSX).
  const perDay = useMemo(() => days.map((day) => ({ day, blocks: dayBlocks(events, day), allDay: eventsOnDay(events, day).allDay, ...tasksOnDay(tasks, day) })), [days, events, tasks]);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [announce, setAnnounce] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const latest = useRef<Gesture | null>(null);
  latest.current = gesture;
  const tracking = useRef<Tracking | null>(null);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelAnimationFrame(frame.current); tracking.current?.removeKey?.(); }; }, []);

  // Abre perto do primeiro evento (ou das 7h); a entrada dos blocos é suave e some com movimento reduzido.
  useLayoutEffect(() => {
    const first = perDay.flatMap((entry) => entry.blocks).reduce((min, block) => Math.min(min, block.startMin), 7 * 60);
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (Math.min(first, 7 * 60) - 30) / 60 * HOUR_PX);
    const element = body.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const blocks = element.querySelectorAll(".calendar-block");
      if (blocks.length > 0) gsap.fromTo(blocks, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .22, stagger: .02, ease: "power2.out", clearProps: "opacity,transform" });
    });
    return () => media.revert();
    // Só ao trocar de período: eventos novos de um envio não devem rolar nem reanimar a grade.
  }, [days[0] && toIso(days[0]), days.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(async (state: Gesture, dayIndex: number, span: Span) => {
    const unchanged = dayIndex === state.originDay && span.startMin === state.originSpan.startMin && span.endMin === state.originSpan.endMin;
    const day = days[dayIndex];
    const start = day && instantAt(day, span.startMin), end = day && instantAt(day, span.endMin);
    if (unchanged || !start || !end) { revert(state); return; }
    setGesture({ ...state, dayIndex, span, settling: true });
    try {
      await onReschedule(state.event, { start, end });
      if (mounted.current) { setGesture(null); setAnnounce(`${state.event.title}: ${spanLabel(span)}, ${day.day} de ${monthNames[day.month - 1]}.`); }
    } catch {
      if (!mounted.current) return;
      setFailure("Não foi possível mudar o horário. O evento voltou ao horário anterior.");
      revert({ ...state, dayIndex, span });
    }
  }, [days, onReschedule]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Devolve o bloco ao lugar de origem: animado na mesma coluna (GSAP), imediato com movimento reduzido ou noutra coluna. */
  function revert(state: Gesture) {
    const node = ghostEl.current;
    if (!node || reducedMotion() || state.dayIndex !== state.originDay) { setGesture(null); return; }
    setGesture({ ...state, settling: true });
    gsap.to(node, { top: state.originSpan.startMin / 60 * HOUR_PX, height: heightOf(state.originSpan), duration: .18, ease: "power2.out", onComplete: () => { if (mounted.current) setGesture(null); } });
  }

  function onBlockPointerDown(event: PointerEvent<HTMLButtonElement>, block: Block, dayIndex: number) {
    const status = statusOf.get(block.event.id)?.status ?? "synced";
    if (event.button !== 0 || gesture || !isDraggable(block.event, status)) return;
    const handle = (event.target as HTMLElement).closest(".calendar-block-handle") !== null;
    // Toque: só a borda inferior arrasta; no resto o dedo rola a grade.
    if (event.pointerType === "touch" && !handle) return;
    const originSpan = realSpan(block.event, days[dayIndex]);
    const origin: Gesture = { id: block.event.id, event: block.event, mode: handle ? "resize" : "move", originDay: dayIndex, originSpan, dayIndex, span: originSpan, settling: false };
    tracking.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false, cancelled: false, origin, removeKey: null };
    // Captura desde o início: um arrasto rápido sai do bloco antes de atingir o limiar e não pode perder o gesto.
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onBlockPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const track = tracking.current;
    if (!track || event.pointerId !== track.pointerId || track.cancelled) return;
    const origin = track.origin;
    const dx = event.clientX - track.startX, dy = event.clientY - track.startY;
    if (!track.started) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      track.started = true;
      const element = event.currentTarget;
      const cancel = (key: globalThis.KeyboardEvent) => { if (key.key === "Escape") cancelGesture(element); };
      window.addEventListener("keydown", cancel);
      track.removeKey = () => window.removeEventListener("keydown", cancel);
    }
    const deltaMin = dy / HOUR_PX * 60;
    let dayIndex = origin.originDay;
    if (origin.mode === "move" && columnsEl.current && days.length > 1) {
      const rect = columnsEl.current.getBoundingClientRect();
      dayIndex = Math.min(days.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / (rect.width / days.length))));
    }
    const span = origin.mode === "move" ? moveSpan(origin.originSpan, deltaMin) : resizeSpan(origin.originSpan, deltaMin);
    // Um render por quadro, não por evento de ponteiro.
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setGesture((current) => (current && current.id === origin.id && current.settling ? current : { ...origin, dayIndex, span })));
  }

  function finishTracking(element: HTMLButtonElement, pointerId: number) {
    tracking.current?.removeKey?.();
    tracking.current = null;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }

  function onBlockPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const track = tracking.current;
    if (!track || event.pointerId !== track.pointerId) return;
    const origin = track.origin, started = track.started;
    cancelAnimationFrame(frame.current);
    finishTracking(event.currentTarget, event.pointerId);
    if (!started) return;
    // O clique que o navegador dispara depois de soltar não deve abrir a edição.
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 80);
    if (track.cancelled) return;
    const dy = event.clientY - track.startY;
    let dayIndex = origin.originDay;
    if (origin.mode === "move" && columnsEl.current && days.length > 1) {
      const rect = columnsEl.current.getBoundingClientRect();
      dayIndex = Math.min(days.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / (rect.width / days.length))));
    }
    const span = origin.mode === "move" ? moveSpan(origin.originSpan, dy / HOUR_PX * 60) : resizeSpan(origin.originSpan, dy / HOUR_PX * 60);
    void commit(origin, dayIndex, span);
  }

  /**
   * Esc ou cancelamento do ponteiro: nada é gravado e o bloco volta ao lugar. No Esc o ponteiro continua capturado até
   * soltar (o gesto só fica "cancelado"), para o clique final não cair na coluna e abrir o cartão de criação.
   */
  function cancelGesture(element: HTMLButtonElement, hard = false) {
    cancelAnimationFrame(frame.current);
    const track = tracking.current;
    if (!track) return;
    track.removeKey?.();
    track.removeKey = null;
    track.cancelled = true;
    if (hard) { tracking.current = null; if (element.hasPointerCapture(track.pointerId)) element.releasePointerCapture(track.pointerId); }
    if (!track.started) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 80);
    if (latest.current) revert(latest.current);
  }

  function onBlockKeyDown(event: KeyboardEvent<HTMLButtonElement>, block: Block, dayIndex: number) {
    if (!event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const status = statusOf.get(block.event.id)?.status ?? "synced";
    if (!isDraggable(block.event, status) || gesture) return;
    event.preventDefault();
    const originSpan = realSpan(block.event, days[dayIndex]);
    let nextDay = dayIndex, span = originSpan;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const step = event.key === "ArrowUp" ? -SNAP_MIN : SNAP_MIN;
      span = event.shiftKey ? resizeSpan(originSpan, step) : moveSpan(originSpan, step);
    } else if (days.length > 1 && !event.shiftKey) nextDay = Math.min(days.length - 1, Math.max(0, dayIndex + (event.key === "ArrowLeft" ? -1 : 1)));
    if (nextDay === dayIndex && span.startMin === originSpan.startMin && span.endMin === originSpan.endMin) return;
    const day = days[nextDay];
    const start = instantAt(day, span.startMin), end = instantAt(day, span.endMin);
    if (!start || !end) return;
    setFailure(null);
    onReschedule(block.event, { start, end }).then(
      () => { if (mounted.current) setAnnounce(`${block.event.title}: ${spanLabel(span)}, ${day.day} de ${monthNames[day.month - 1]}.`); },
      () => { if (mounted.current) setFailure("Não foi possível mudar o horário. O evento voltou ao horário anterior."); },
    );
  }

  function onColumnClick(event: MouseEvent<HTMLDivElement>, day: CalendarDate) {
    // Só o fundo da coluna: blocos, marcadores e linhas não criam evento.
    if (event.target !== event.currentTarget || suppressClick.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startMin = Math.min(DAY_MIN - SNAP_MIN, Math.max(0, Math.floor((event.clientY - rect.top) / HOUR_PX * 60 / SNAP_MIN) * SNAP_MIN));
    onPickSlot({ day, startMin, endMin: Math.min(DAY_MIN, startMin + 60), x: event.clientX, y: event.clientY });
  }

  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };
  return (
    <div className="calendar-grid" data-columns={days.length}>
      <div className="calendar-grid-head">
        <span className="calendar-grid-corner" />
        <div className="calendar-grid-days" style={columns}>
          {perDay.map(({ day, allDay, untimed }) => {
            const isToday = sameDay(day, today);
            return (
              <div key={toIso(day)} className="calendar-grid-day" data-today={isToday || undefined}>
                {onPickDay ? <button type="button" className="calendar-day-link" onClick={() => onPickDay(day)} aria-label={`Abrir ${day.day} de ${monthNames[day.month - 1]}`}><small>{weekdayNames[new Date(day.year, day.month - 1, day.day).getDay()].slice(0, 3)}</small><strong>{day.day}</strong></button>
                  : <div className="calendar-day-link"><small>{weekdayNames[new Date(day.year, day.month - 1, day.day).getDay()].slice(0, 3)}</small><strong>{day.day}</strong></div>}
                {allDay.map((event) => (
                  <button key={event.id} type="button" className="calendar-allday" data-source={event.source} data-status={statusOf.get(event.id)?.status} onClick={() => onOpen(event)} title={event.title}>{event.title}</button>
                ))}
                {untimed.map((task) => <TaskMarker key={task.id} task={task} overdue={overdueIds.has(task.id)} onToggle={onToggleTask} onOpen={onOpenTask} />)}
              </div>
            );
          })}
        </div>
      </div>
      {failure && <p className="calendar-grid-failure" role="alert">{failure}</p>}
      <p className="visually-hidden" role="status">{announce}</p>
      <p id="calendar-drag-help" className="visually-hidden">Alt com setas para cima ou para baixo muda o horário; Alt com Shift ajusta o horário final; na semana, Alt com setas laterais muda o dia.</p>
      <div className="calendar-grid-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Horários do dia">
        <div className="calendar-grid-body" ref={body} style={{ height: HOUR_PX * 24 }}>
          <div className="calendar-hours" aria-hidden="true">
            {hours.map((hour) => <span key={hour} style={{ top: hour * HOUR_PX }}>{String(hour).padStart(2, "0")}:00</span>)}
          </div>
          <div className="calendar-grid-columns" ref={columnsEl} style={columns}>
            {perDay.map(({ day, blocks, timed }, dayIndex) => (
              <div key={toIso(day)} className="calendar-column" data-today={sameDay(day, today) || undefined} onClick={(event) => onColumnClick(event, day)}>
                {hours.map((hour) => <i key={hour} className="calendar-hour-line" style={{ top: hour * HOUR_PX }} aria-hidden="true" />)}
                {sameDay(day, today) && <i className="calendar-now" style={{ top: nowMin / 60 * HOUR_PX }} aria-hidden="true" />}
                {blocks.map((block) => {
                  const status = statusOf.get(block.event.id)?.status ?? "synced";
                  const height = Math.max(MIN_BLOCK_PX, (block.endMin - block.startMin) / 60 * HOUR_PX - 2);
                  const draggable = isDraggable(block.event, status);
                  return (
                    <button key={block.event.id} type="button" className="calendar-block" data-source={block.event.source} data-status={status} data-compact={height < COMPACT_PX || undefined}
                      data-draggable={draggable || undefined} data-ghosted={gesture?.id === block.event.id || undefined}
                      style={{ top: block.startMin / 60 * HOUR_PX, height, left: `calc(${block.column / block.columns * 100}% + 2px)`, width: `calc(${100 / block.columns}% - 4px)` }}
                      onClick={(event) => { if (suppressClick.current) { event.preventDefault(); return; } onOpen(block.event); }}
                      onPointerDown={(event) => onBlockPointerDown(event, block, dayIndex)} onPointerMove={onBlockPointerMove} onPointerUp={onBlockPointerUp}
                      onPointerCancel={(event) => cancelGesture(event.currentTarget, true)}
                      onKeyDown={(event) => onBlockKeyDown(event, block, dayIndex)}
                      aria-describedby={draggable ? "calendar-drag-help" : undefined}
                      title={`${block.event.title} · ${timeRange(block.event)}`} aria-label={`${block.event.title}, ${timeRange(block.event)}`}>
                      <strong>{block.event.title}</strong>
                      <span>{timeRange(block.event)}</span>
                      <EventStatus status={status} />
                      {draggable && <span className="calendar-block-handle" aria-hidden="true" />}
                    </button>
                  );
                })}
                {timed.map((task) => (
                  <TaskMarker key={task.id} task={task} overdue={overdueIds.has(task.id)} onToggle={onToggleTask} onOpen={onOpenTask} style={{ top: Math.min(24 * 60 - 24, (Number(task.dueTime!.slice(0, 2)) * 60 + Number(task.dueTime!.slice(3))) ) / 60 * HOUR_PX }} />
                ))}
                {gesture && gesture.dayIndex === dayIndex && (
                  <div ref={ghostEl} className="calendar-block calendar-block-ghost" data-compact={heightOf(gesture.span) < COMPACT_PX || undefined} aria-hidden="true"
                    style={{ top: gesture.span.startMin / 60 * HOUR_PX, height: heightOf(gesture.span), left: "2px", width: "calc(100% - 4px)" }}>
                    <strong>{gesture.event.title}</strong>
                    <span>{spanLabel(gesture.span)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(TimeGrid);
