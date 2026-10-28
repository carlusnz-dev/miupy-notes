// Regra do prazo da tarefa. Sem dependências: o cliente web importa esta função pelo contrato, então a regra vive só aqui.

/** Relógio local do usuário no momento da checagem: data AAAA-MM-DD e hora HH:MM. O servidor não adivinha fuso. */
export type LocalNow = { readonly date: string; readonly time: string };
export type TaskSchedule = { readonly dueDate: string | null; readonly dueTime: string | null };

/** Atrasada = pendente com prazo passado. Sem hora, o prazo vale até o fim do dia. */
export function isTaskOverdue(task: TaskSchedule & { readonly status: "pending" | "completed" }, now: LocalNow): boolean {
  if (task.status !== "pending" || task.dueDate === null) return false;
  if (task.dueDate !== now.date) return task.dueDate < now.date;
  return task.dueTime !== null && task.dueTime < now.time;
}
