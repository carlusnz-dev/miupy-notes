import { CalendarTask } from "../domain/calendar-task.js";
import { toGoogleTaskBody } from "../google-tasks/google-tasks-mapping.js";
import { GoogleTasksApiError, GoogleTasksClient } from "../google-tasks/google-tasks.client.js";
import type { TaskRepository } from "../repository/task.repository.js";

export type TaskSyncOutcome = "disabled" | "synced" | "failed";
export type TaskSyncOptions = { readonly enabled: boolean; readonly taskListId?: string; readonly now?: () => Date };

/**
 * Envia tarefas ao Google Tasks (concluída aqui = `completed` lá). Desligada por configuração: sem `enabled` nenhuma
 * chamada acontece. Falha do Google nunca desfaz a gravação local; a tarefa só fica sem cópia remota.
 */
export class TaskGoogleSync {
  private readonly taskListId: string;
  private readonly now: () => Date;
  constructor(private readonly repository: TaskRepository, private readonly client: GoogleTasksClient | null, private readonly options: TaskSyncOptions) {
    this.taskListId = options.taskListId ?? "@default";
    this.now = options.now ?? (() => new Date());
  }

  get enabled() { return this.options.enabled && this.client !== null; }

  /** Cria ou atualiza a cópia remota e guarda a referência. Devolve a tarefa mais recente. */
  async afterSave(task: CalendarTask): Promise<{ task: CalendarTask; outcome: TaskSyncOutcome }> {
    if (!this.enabled) return { task, outcome: "disabled" };
    try {
      const body = toGoogleTaskBody(task);
      const remote = task.external
        ? await this.client!.updateTask(task.ownerId, task.external.taskListId, task.external.taskId, body)
        : await this.client!.insertTask(task.ownerId, this.taskListId, body);
      if (task.external?.taskId === remote.id) return { task, outcome: "synced" };
      const linked = new CalendarTask(task.id, task.ownerId, task.title, task.description, task.dueDate, task.dueTime, task.status, task.completedAt,
        { provider: "google", taskListId: task.external?.taskListId ?? this.taskListId, taskId: remote.id, syncedAt: this.now().toISOString() }, task.createdAt, task.updatedAt, task.version);
      // Mesma versão: a referência remota não é edição do usuário. Se a tarefa mudou no meio, a condição falha e a próxima gravação refaz.
      return { task: (await this.repository.update(linked, task.version)) ?? task, outcome: "synced" };
    } catch (error) {
      if (error instanceof GoogleTasksApiError) return { task, outcome: "failed" };
      throw error;
    }
  }

  async afterDelete(task: CalendarTask): Promise<TaskSyncOutcome> {
    if (!this.enabled || !task.external) return "disabled";
    try { await this.client!.deleteTask(task.ownerId, task.external.taskListId, task.external.taskId); return "synced"; }
    catch (error) {
      if (error instanceof GoogleTasksApiError) return error.kind === "not_found" ? "synced" : "failed";
      throw error;
    }
  }
}
