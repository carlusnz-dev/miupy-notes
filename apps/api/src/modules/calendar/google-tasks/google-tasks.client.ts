/** Recorte do recurso `Task` da Google Tasks API v1 usado aqui; campos além destes são ignorados. */
export type GoogleTask = {
  id: string;
  etag?: string;
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  /** RFC 3339; a API só considera a data (a hora é descartada). */
  due?: string;
  completed?: string;
};
/** `completed: null` limpa a conclusão ao voltar para pendente. */
export type GoogleTaskBody = { title: string; notes: string; status: "needsAction" | "completed"; due?: string | null; completed?: string | null };

export type GoogleTasksErrorKind = "not_found" | "rate_limited" | "unauthorized" | "unavailable" | "invalid";

/** Erro do provedor reduzido a uma classificação e ao status HTTP, quando houve resposta; nunca carrega corpo, token ou texto do Google. */
export class GoogleTasksApiError extends Error {
  constructor(public readonly kind: GoogleTasksErrorKind, public readonly status?: number) { super(`google-tasks:${kind}`); }
}

/**
 * Fronteira com a Tasks API. `ownerId` escolhe as credenciais. Exige o escopo `https://www.googleapis.com/auth/tasks` e a
 * Tasks API habilitada no projeto: nenhum dos dois foi pedido ou ativado; só os testes com fake exercitam esta porta.
 */
export abstract class GoogleTasksClient {
  abstract insertTask(ownerId: string, taskListId: string, body: GoogleTaskBody): Promise<GoogleTask>;
  abstract updateTask(ownerId: string, taskListId: string, taskId: string, body: GoogleTaskBody): Promise<GoogleTask>;
  abstract deleteTask(ownerId: string, taskListId: string, taskId: string): Promise<void>;
}
