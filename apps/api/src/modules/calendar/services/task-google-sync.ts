import { logger, type Logger } from "../../../core/logging/logger.js";
import { CalendarTask } from "../domain/calendar-task.js";
import { toGoogleTaskBody } from "../google-tasks/google-tasks-mapping.js";
import { GoogleTasksApiError, GoogleTasksClient } from "../google-tasks/google-tasks.client.js";
import type { TaskRepository } from "../repository/task.repository.js";

export type TaskSyncOutcome = "disabled" | "synced" | "failed";
export type TaskSyncOptions = { readonly enabled: boolean; readonly taskListId?: string; readonly now?: () => Date; readonly log?: Logger };

/**
 * Envia tarefas ao Google Tasks (concluída aqui = `completed` lá). Desligada por configuração: sem `enabled` nenhuma
 * chamada acontece. Falha do Google nunca desfaz a gravação local; a tarefa só fica sem cópia remota.
 */
export class TaskGoogleSync {
  private readonly taskListId: string;
  private readonly now: () => Date;
  private readonly log: Logger;
  constructor(private readonly repository: TaskRepository, private readonly client: GoogleTasksClient | null, private readonly options: TaskSyncOptions) {
    this.taskListId = options.taskListId ?? "@default";
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? logger;
  }

  /** Só operação, tipo e status HTTP: nunca o título da tarefa, o corpo enviado, a resposta ou o token. */
  private logFailure(operation: string, error: GoogleTasksApiError) {
    this.log.warn("request.failed", { service: "Google Tasks", operation, detail: error.kind, providerStatus: error.status });
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
      if (error instanceof GoogleTasksApiError) { this.logFailure(task.external ? "atualizar tarefa" : "criar tarefa", error); return { task, outcome: "failed" }; }
      throw error;
    }
  }

  async afterDelete(task: CalendarTask): Promise<TaskSyncOutcome> {
    if (!this.enabled || !task.external) return "disabled";
    try { await this.client!.deleteTask(task.ownerId, task.external.taskListId, task.external.taskId); return "synced"; }
    catch (error) {
      if (error instanceof GoogleTasksApiError) {
        if (error.kind === "not_found") return "synced";
        this.logFailure("excluir tarefa", error);
        return "failed";
      }
      throw error;
    }
  }
}
