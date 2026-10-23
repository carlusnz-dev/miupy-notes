import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { calendarEventListOutputSchema, calendarEventOutputSchema, googleStatusOutputSchema, googleSyncOutputSchema,
  type CalendarEventOutput, type GoogleStatusOutput, type GoogleSyncOutput } from "../../../api/src/modules/calendar/contract";
import { taskListOutputSchema, taskOutputSchema, type TaskOutput } from "../../../api/src/modules/calendar/task-contract";
import { apiClient, toApiError } from "./api-client";

export type { CalendarEventOutput, GoogleStatusOutput, GoogleSyncOutput };
export type { TaskOutput };
export { isTaskOverdue } from "../../../api/src/modules/calendar/task-contract";
export type EventLink = CalendarEventOutput["links"][number];

/** Campos editáveis de uma tarefa: `dueTime` é HH:MM local e exige `dueDate` (AAAA-MM-DD). */
export type TaskDraft = { title: string; description: string; dueDate: string | null; dueTime: string | null; status: "pending" | "completed" };

/** Campos editáveis de um evento, no formato da API: com hora, `start`/`end` são instantes ISO; dia inteiro, AAAA-MM-DD. */
export type EventDraft = {
  sendToGoogle?: boolean;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string;
  end: string;
  timeZone: string | null;
  links: EventLink[];
};

const base = "/v1/calendar";
const guard = async <T,>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toApiError(error); } };

export function listEventsPage(options: { from?: string; to?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {}) {
  return guard(async () => calendarEventListOutputSchema.parse((await apiClient.get(`${base}/events`, { params: { from: options.from, to: options.to, cursor: options.cursor, limit: options.limit }, signal: options.signal })).data));
}

/** Percorre todas as páginas do período (a API filtra e pagina por ID, não por data). `maxPages` evita laço sem fim. */
export async function listEventsInRange(range: { from: string; to: string }, signal?: AbortSignal, maxPages = 40): Promise<CalendarEventOutput[]> {
  const items: CalendarEventOutput[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await listEventsPage({ ...range, cursor, limit: 100, signal });
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  throw toApiError(new Error("Período com eventos demais para carregar."));
}

/** `id` gerado no cliente: repetir o envio não duplica o evento. */
export function createCalendarEvent(id: string, draft: EventDraft) {
  return guard(async () => calendarEventOutputSchema.parse((await apiClient.post(`${base}/events`, { id, ...draft })).data));
}

export function getCalendarEvent(id: string, signal?: AbortSignal) {
  return guard(async () => calendarEventOutputSchema.parse((await apiClient.get(`${base}/events/${encodeURIComponent(id)}`, { signal })).data));
}

export function updateCalendarEvent(id: string, version: number, draft: EventDraft) {
  return guard(async () => calendarEventOutputSchema.parse((await apiClient.patch(`${base}/events/${encodeURIComponent(id)}`, { version, ...draft })).data));
}

export function deleteCalendarEvent(id: string, version: number) {
  return guard(async () => { await apiClient.delete(`${base}/events/${encodeURIComponent(id)}`, { params: { version } }); });
}

/** Todas as tarefas (a lista é pequena e a API pagina por ID). `maxPages` evita laço sem fim. */
export async function listTasks(signal?: AbortSignal, maxPages = 10): Promise<TaskOutput[]> {
  const items: TaskOutput[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await guard(async () => taskListOutputSchema.parse((await apiClient.get(`${base}/tasks`, { params: { cursor, limit: 100 }, signal })).data));
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  throw toApiError(new Error("Tarefas demais para carregar."));
}

/** `id` gerado no cliente: repetir o envio não duplica a tarefa. */
export function createTask(id: string, draft: TaskDraft) {
  return guard(async () => taskOutputSchema.parse((await apiClient.post(`${base}/tasks`, { id, ...draft })).data));
}

export function updateTask(id: string, version: number, changes: Partial<TaskDraft>) {
  return guard(async () => taskOutputSchema.parse((await apiClient.patch(`${base}/tasks/${encodeURIComponent(id)}`, { version, ...changes })).data));
}

export function deleteTask(id: string, version: number) {
  return guard(async () => { await apiClient.delete(`${base}/tasks/${encodeURIComponent(id)}`, { params: { version } }); });
}

export function getGoogleStatus(signal?: AbortSignal) {
  return guard(async () => googleStatusOutputSchema.parse((await apiClient.get(`${base}/google`, { signal })).data));
}

export function syncGoogle() {
  return guard(async () => googleSyncOutputSchema.parse((await apiClient.post(`${base}/google/sync`, {})).data));
}

export function reflectEvent(id: string) {
  return guard(async () => calendarEventOutputSchema.parse((await apiClient.post(`${base}/events/${encodeURIComponent(id)}/google-reflection`, {})).data));
}

export function unreflectEvent(id: string, keepRemote: boolean) {
  return guard(async () => calendarEventOutputSchema.parse((await apiClient.delete(`${base}/events/${encodeURIComponent(id)}/google-reflection`, { params: { keepRemote } })).data));
}

const connectMessages: Record<string, string> = {
  AUTH_DENIED: "Você recusou a conexão com o Google Calendar.",
  AUTH_TIMEOUT: "O tempo para conectar expirou. Tente de novo.",
  CALENDAR_FINALIZING: "A autorização já está sendo gravada. Aguarde; depois use Desconectar para revogar o acesso.",
  CALENDAR_CANCELLED: "Conexão cancelada.",
  CALENDAR_CONNECT_BUSY: "Já existe uma conexão em andamento.",
  CALENDAR_SESSION_CHANGED: "A sessão mudou. Comece a conexão de novo.",
  CREDENTIAL_STORE_UNAVAILABLE: "Desbloqueie o cofre da sessão para guardar a autorização.",
};
export async function connectGoogle(mode: "mirror" | "reflect", onFinalizing?: () => void) {
  if (!isTauri()) throw new Error("Abra o aplicativo desktop para conectar o Google Calendar.");
  const unlisten = await listen("calendar-google-finalizing", () => onFinalizing?.());
  try { return googleStatusOutputSchema.parse(await invoke("calendar_google_connect", { mode })); }
  catch (error) { throw new Error(connectMessages[String(error)] ?? "Não foi possível conectar. Verifique a configuração da API e tente de novo."); }
  finally { unlisten(); }
}
export async function cancelGoogleConnection() {
  try { if (isTauri()) await invoke("calendar_google_cancel"); }
  catch (error) { throw new Error(connectMessages[String(error)] ?? "Não foi possível cancelar a espera."); }
}
export function disconnectGoogle() {
  return guard(async () => googleStatusOutputSchema.parse((await apiClient.delete(`${base}/google/connection`)).data));
}
