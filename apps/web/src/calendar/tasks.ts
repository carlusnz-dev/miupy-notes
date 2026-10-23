import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toIso, todayLocal, type CalendarDate } from "../lib/calendar-date";
import type { TaskDraft, TaskOutput } from "../lib/calendar-api";
import { isTaskOverdue } from "../../../api/src/modules/calendar/task-contract";

/** Porta HTTP das tarefas; em produção são as funções de `lib/calendar-api.ts`. */
export type TasksApi = {
  list(signal?: AbortSignal): Promise<TaskOutput[]>;
  create(id: string, draft: TaskDraft): Promise<TaskOutput>;
  update(id: string, version: number, changes: Partial<TaskDraft>): Promise<TaskOutput>;
  remove(id: string, version: number): Promise<void>;
};

const pad = (value: number) => String(value).padStart(2, "0");
export const localNow = (now = new Date()) => ({ date: toIso(todayLocal(now)), time: `${pad(now.getHours())}:${pad(now.getMinutes())}` });

/** Tarefas com prazo neste dia, separadas entre com hora (marcadores na grade) e sem hora (faixa do dia). */
export function tasksOnDay(tasks: readonly TaskOutput[], day: CalendarDate): { timed: TaskOutput[]; untimed: TaskOutput[] } {
  const iso = toIso(day);
  const matching = tasks.filter((task) => task.dueDate === iso);
  return {
    timed: matching.filter((task) => task.dueTime !== null).sort((a, b) => a.dueTime!.localeCompare(b.dueTime!)),
    untimed: matching.filter((task) => task.dueTime === null),
  };
}

/** Ordem de prazo: com data primeiro (data, hora), sem data por último. */
export const byDue = (a: TaskOutput, b: TaskOutput) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "").localeCompare(b.dueTime ?? "") || a.title.localeCompare(b.title, "pt-BR");

/** Relógio que avança a cada minuto, para o aviso de atraso aparecer sem recarregar a tela. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Tarefas da agenda. Diferente dos eventos, não têm fila offline: cada ação vai direto à API, com a marcação de
 * concluída aplicada de imediato e desfeita se falhar. Ações na mesma tarefa são serializadas para usar sempre a versão mais recente.
 */
export function useTasks(api: TasksApi | undefined, ownerId: string, refreshKey: unknown) {
  const [tasks, setTasks] = useState<TaskOutput[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(api ? "loading" : "unavailable");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(tasks);
  latest.current = tasks;
  const chains = useRef(new Map<string, Promise<unknown>>());
  const now = useNow(60_000);

  useEffect(() => {
    if (!api) return;
    const abort = new AbortController();
    api.list(abort.signal).then((items) => { if (!abort.signal.aborted) { setTasks(items); setState("ready"); } }).catch(() => { if (!abort.signal.aborted) setState((current) => (current === "ready" ? current : "unavailable")); });
    return () => abort.abort();
  }, [api, ownerId, refreshKey]);

  const replace = useCallback((task: TaskOutput) => setTasks((current) => current.some((item) => item.id === task.id) ? current.map((item) => item.id === task.id ? task : item) : [...current, task]), []);
  const chain = useCallback(<T,>(id: string, run: () => Promise<T>): Promise<T> => {
    const next = (chains.current.get(id) ?? Promise.resolve()).then(run, run);
    chains.current.set(id, next.catch(() => undefined));
    return next;
  }, []);
  const fail = (message: string) => setError(message);

  const create = useCallback(async (draft: TaskDraft) => {
    if (!api) throw new Error("Tarefas indisponíveis agora.");
    replace(await api.create(crypto.randomUUID(), draft));
  }, [api, replace]);

  const update = useCallback(async (id: string, changes: Partial<TaskDraft>) => {
    if (!api) throw new Error("Tarefas indisponíveis agora.");
    replace(await chain(id, async () => {
      const current = latest.current.find((task) => task.id === id);
      if (!current) throw new Error("Tarefa não encontrada.");
      return api.update(id, current.version, changes);
    }));
  }, [api, chain, replace]);

  const toggle = useCallback((task: TaskOutput) => {
    const status = task.status === "completed" ? "pending" : "completed";
    setError(null);
    const before = latest.current.find((item) => item.id === task.id) ?? task;
    // Aplicado já; a resposta do servidor (versão nova, `completedAt`) substitui depois.
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status, completedAt: status === "completed" ? new Date().toISOString() : null } : item));
    update(task.id, { status }).catch(() => { replace(before); fail("Não foi possível atualizar a tarefa. Tente de novo."); });
  }, [update, replace]);

  const remove = useCallback(async (id: string) => {
    if (!api) throw new Error("Tarefas indisponíveis agora.");
    await chain(id, async () => {
      const current = latest.current.find((task) => task.id === id);
      if (current) await api.remove(id, current.version);
    });
    setTasks((current) => current.filter((task) => task.id !== id));
  }, [api, chain]);

  const clock = useMemo(() => localNow(now), [now]);
  const pending = useMemo(() => tasks.filter((task) => task.status === "pending").sort(byDue), [tasks]);
  const overdue = useMemo(() => pending.filter((task) => isTaskOverdue(task, clock)), [pending, clock]);
  return { tasks, state, error, dismissError: () => setError(null), create, update, toggle, remove, pending, overdue };
}
