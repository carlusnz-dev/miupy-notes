import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { todayLocal, type CalendarDate } from "../lib/calendar-date";
import type { CalendarEventOutput } from "../lib/calendar-api";
import { apiRange, upcomingEvents, type ViewMode } from "./layout";
import { discardOp, enqueue, flushOutbox, resolveConflict, withOutbox, type CalendarRemote, type DisplayEvent, type FlushResult } from "./outbox";
import type { CalendarStore, OutboxOp } from "./store";

/** Janela dos "próximos eventos", independente do modo de visualização. */
export const UPCOMING_DAYS = 30;
const FLUSH_INTERVAL_MS = 15_000;

export type Connectivity = "online" | "offline";
export type FetchState = { status: "loading" } | { status: "ok"; at: number } | { status: "stale"; reason: string; at: number | null };

export type RangeRemote = CalendarRemote & { listRange(range: { from: string; to: string }, signal?: AbortSignal): Promise<CalendarEventOutput[]> };

// Mesma sobreposição do servidor; dia inteiro como datas flutuantes lidas em UTC (o período já vem ampliado em um dia).
const overlapsRange = (event: Pick<CalendarEventOutput, "allDay" | "start" | "end">, from: string, to: string) => {
  const startsAt = event.allDay ? `${event.start}T00:00:00.000Z` : event.start;
  const endsAt = event.allDay ? `${event.end}T23:59:59.999Z` : event.end;
  return startsAt < to && endsAt > from;
};

export function useCalendar({ ownerId, store, remote, isCurrent }: { ownerId: string; store: CalendarStore; remote: RangeRemote; isCurrent?: () => boolean }) {
  const [mode, setMode] = useState<ViewMode>("day");
  const [anchor, setAnchor] = useState<CalendarDate>(() => todayLocal());
  const [cache, setCache] = useState<CalendarEventOutput[]>([]);
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });
  const [connectivity, setConnectivity] = useState<Connectivity>(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online");
  const [lastFlush, setLastFlush] = useState<FlushResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const flushing = useRef(false);
  const mounted = useRef(true);
  const current = useCallback(() => mounted.current && (isCurrent?.() ?? true), [isCurrent]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const reload = useCallback(async () => {
    const [events, pending] = await Promise.all([store.listEvents(ownerId), store.listOps(ownerId)]);
    if (current()) { setCache(events); setOps(pending); }
  }, [store, ownerId, current]);

  // Mostra o que está guardado no dispositivo antes de qualquer rede.
  useEffect(() => { void reload().catch(() => setLocalError("Não foi possível ler os dados guardados neste dispositivo.")); }, [reload]);

  /** Busca um período no servidor e reconcilia o cache: atualiza o que veio e remove o que sumiu, exceto o que tem envio pendente. */
  const refreshRange = useCallback(async (range: { from: string; to: string }, signal: AbortSignal) => {
    const fetched = await remote.listRange(range, signal);
    if (signal.aborted || !current()) return false;
    const [known, pending] = await Promise.all([store.listEvents(ownerId), store.listOps(ownerId)]);
    const withOps = new Set(pending.map((op) => op.eventId));
    const seen = new Set(fetched.map((event) => event.id));
    const gone = known.filter((event) => !seen.has(event.id) && !withOps.has(event.id) && overlapsRange(event, range.from, range.to)).map((event) => event.id);
    await store.putEvents(ownerId, fetched);
    if (gone.length > 0) await store.removeEvents(ownerId, gone);
    return true;
  }, [remote, store, ownerId, current]);

  const viewKey = `${mode}:${anchor.year}-${anchor.month}-${anchor.day}`;
  useEffect(() => {
    if (connectivity === "offline") { setFetchState((state) => ({ status: "stale", reason: "Sem conexão: mostrando os eventos guardados neste dispositivo.", at: state.status === "ok" ? state.at : state.status === "stale" ? state.at : null })); return; }
    const abort = new AbortController();
    const now = new Date();
    const upcomingRange = { from: now.toISOString(), to: new Date(now.getTime() + UPCOMING_DAYS * 86_400_000).toISOString() };
    setFetchState((state) => (state.status === "ok" ? state : { status: "loading" }));
    (async () => {
      try {
        const okView = await refreshRange(apiRange(mode, anchor), abort.signal);
        const okUpcoming = okView && await refreshRange(upcomingRange, abort.signal);
        if (!okUpcoming) return;
        await store.setMeta(ownerId, "lastFetchedAt", String(Date.now())).catch(() => undefined);
        await reload();
        if (current()) setFetchState({ status: "ok", at: Date.now() });
      } catch (error) {
        if (abort.signal.aborted || !current()) return;
        const code = (error as { code?: string }).code;
        if (code === "NETWORK_ERROR") setConnectivity("offline");
        const at = Number(await store.getMeta(ownerId, "lastFetchedAt").catch(() => null)) || null;
        setFetchState({ status: "stale", reason: code === "NETWORK_ERROR" ? "Sem conexão: mostrando os eventos guardados neste dispositivo." : "Não foi possível atualizar agora. Mostrando os eventos guardados neste dispositivo.", at });
      }
    })();
    return () => abort.abort();
    // `viewKey` resume modo e âncora; `tick` força nova busca após envios e ao tentar de novo.
  }, [viewKey, connectivity, tick, refreshRange, reload, store, ownerId, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async (force = false) => {
    if (flushing.current) return null;
    flushing.current = true;
    try {
      const result = await flushOutbox(store, remote, ownerId, { force, isCurrent: current });
      if (!current()) return result;
      setLastFlush(result);
      if (result.stopped === "offline") setConnectivity("offline");
      await reload();
      if (result.sent > 0) setTick((value) => value + 1);
      return result;
    } finally { flushing.current = false; }
  }, [store, remote, ownerId, current, reload]);

  // Envio: ao abrir, ao voltar a rede e periodicamente enquanto houver algo pendente.
  const hasPending = ops.some((op) => op.state === "pending");
  useEffect(() => { if (connectivity === "online" && hasPending) void flush(); }, [connectivity, hasPending, flush]);
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => { if (navigator.onLine !== false) void flush(); }, FLUSH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasPending, flush]);
  useEffect(() => {
    const online = () => setConnectivity("online");
    const offline = () => setConnectivity("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  /** Grava no dispositivo e só então tenta enviar. Lança se a gravação local falhar (o formulário continua aberto). */
  const submit = useCallback(async (change: Parameters<typeof enqueue>[2]) => {
    await enqueue(store, ownerId, change);
    // O cache otimista é a sobreposição do envio; nada é escrito como "salvo no servidor".
    await reload();
    void flush(true);
  }, [store, ownerId, reload, flush]);

  const resolve = useCallback(async (eventId: string, choice: "mine" | "server") => {
    await resolveConflict(store, ownerId, eventId, choice);
    await reload();
    void flush(true);
  }, [store, ownerId, reload, flush]);

  const discard = useCallback(async (eventId: string) => { await discardOp(store, ownerId, eventId); await reload(); }, [store, ownerId, reload]);
  const retryNow = useCallback(() => { setConnectivity(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online"); setTick((value) => value + 1); void flush(true); }, [flush]);

  const events: DisplayEvent[] = useMemo(() => withOutbox(cache, ops), [cache, ops]);
  const upcoming = useMemo(() => upcomingEvents(events.map((item) => item.event), new Date(), 8), [events]);
  const statusOf = useMemo(() => new Map(events.map((item) => [item.event.id, item])), [events]);

  return { mode, setMode, anchor, setAnchor, events, upcoming, statusOf, ops, fetchState, connectivity, lastFlush, localError, submit, resolve, discard, retryNow, refreshNow: () => setTick((value) => value + 1) };
}
