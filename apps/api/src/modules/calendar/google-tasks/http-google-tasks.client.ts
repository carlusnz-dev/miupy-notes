import { z } from "zod";
import { GoogleTasksApiError, GoogleTasksClient, type GoogleTask, type GoogleTaskBody, type GoogleTasksErrorKind } from "./google-tasks.client.js";

const BASE = "https://tasks.googleapis.com/tasks/v1/lists";
const taskSchema = z.object({
  id: z.string(), etag: z.string().optional(), title: z.string().optional(), notes: z.string().optional(),
  status: z.enum(["needsAction", "completed"]).optional(), due: z.string().optional(), completed: z.string().optional(),
});

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export type TasksTokenSource = { accessToken(ownerId: string): Promise<string> };

function classify(status: number): GoogleTasksErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "invalid";
}

/** Cliente HTTP da Tasks API. Ainda sem uso em produção: só os testes (com `fetch` falso) o exercitam. */
export class HttpGoogleTasksClient extends GoogleTasksClient {
  constructor(private readonly tokens: TasksTokenSource, private readonly doFetch: FetchLike = fetch as unknown as FetchLike) { super(); }

  private async request(ownerId: string, method: string, url: string, body?: GoogleTaskBody): Promise<unknown> {
    let response;
    try {
      response = await this.doFetch(url, { method, headers: { authorization: `Bearer ${await this.tokens.accessToken(ownerId)}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
    } catch { throw new GoogleTasksApiError("unavailable"); }
    if (!response.ok) throw new GoogleTasksApiError(classify(response.status), response.status);
    return method === "DELETE" ? null : response.json();
  }

  async insertTask(ownerId: string, taskListId: string, body: GoogleTaskBody): Promise<GoogleTask> {
    return taskSchema.parse(await this.request(ownerId, "POST", `${BASE}/${encodeURIComponent(taskListId)}/tasks`, body));
  }
  async updateTask(ownerId: string, taskListId: string, taskId: string, body: GoogleTaskBody): Promise<GoogleTask> {
    return taskSchema.parse(await this.request(ownerId, "PATCH", `${BASE}/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, body));
  }
  async deleteTask(ownerId: string, taskListId: string, taskId: string): Promise<void> {
    await this.request(ownerId, "DELETE", `${BASE}/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`);
  }
}
