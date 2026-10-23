import { GoogleTasksApiError, GoogleTasksClient, type GoogleTask, type GoogleTaskBody, type GoogleTasksErrorKind } from "./google-tasks.client.js";

/** Google Tasks falso para testes: guarda as tarefas por lista e registra as chamadas. */
export class FakeGoogleTasksClient extends GoogleTasksClient {
  readonly tasks = new Map<string, GoogleTask>();
  readonly calls: string[] = [];
  /** Próxima chamada falha com este tipo (uma vez). */
  nextError: GoogleTasksErrorKind | null = null;
  private seq = 0;

  private gate(call: string) {
    this.calls.push(call);
    if (this.nextError) { const kind = this.nextError; this.nextError = null; throw new GoogleTasksApiError(kind); }
  }
  private key(taskListId: string, taskId: string) { return `${taskListId}/${taskId}`; }

  async insertTask(_ownerId: string, taskListId: string, body: GoogleTaskBody): Promise<GoogleTask> {
    this.gate("insert");
    const task: GoogleTask = { id: `fake-task-${++this.seq}`, etag: "1", title: body.title, notes: body.notes, status: body.status, due: body.due ?? undefined, completed: body.completed ?? undefined };
    this.tasks.set(this.key(taskListId, task.id), task);
    return task;
  }
  async updateTask(_ownerId: string, taskListId: string, taskId: string, body: GoogleTaskBody): Promise<GoogleTask> {
    this.gate("update");
    const current = this.tasks.get(this.key(taskListId, taskId));
    if (!current) throw new GoogleTasksApiError("not_found");
    const task: GoogleTask = { ...current, title: body.title, notes: body.notes, status: body.status, due: body.due ?? undefined, completed: body.completed ?? undefined };
    this.tasks.set(this.key(taskListId, taskId), task);
    return task;
  }
  async deleteTask(_ownerId: string, taskListId: string, taskId: string): Promise<void> {
    this.gate("delete");
    if (!this.tasks.delete(this.key(taskListId, taskId))) throw new GoogleTasksApiError("not_found");
  }
}
