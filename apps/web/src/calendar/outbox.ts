import type { CalendarEventOutput, EventDraft } from "../lib/calendar-api";
import type { CalendarStore, OutboxOp } from "./store";

/** Porta HTTP usada pelo motor; em produção são as funções de `lib/calendar-api.ts`. */
export interface CalendarRemote {
  create(id: string, draft: EventDraft): Promise<CalendarEventOutput>;
  update(id: string, version: number, draft: EventDraft): Promise<CalendarEventOutput>;
  remove(id: string, version: number): Promise<void>;
  get(id: string): Promise<CalendarEventOutput>;
}

/** Forma de `ApiError` (lib/api-client.ts) usada aqui; checada por estrutura para este módulo não depender do cliente Axios. */
type ApiErrorLike = Error & { code: string; status?: number; retryAfterMs?: number };
const isApiError = (error: unknown): error is ApiErrorLike => error instanceof Error && typeof (error as { code?: unknown }).code === "string";

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

export const draftOf = (event: CalendarEventOutput): EventDraft => ({
  title: event.title, description: event.description, location: event.location, allDay: event.allDay,
  start: event.start, end: event.end, timeZone: event.timeZone, links: event.links.map((link) => ({ ...link })),
});

const linkKeys = (draft: Pick<EventDraft, "links">) => draft.links.map((link) => `${link.kind}:${link.id}`).sort().join(",");
/** Mesmo conteúdo editável (ignora versão e datas de gravação): decide se um envio já aconteceu. */
export function sameContent(event: CalendarEventOutput, draft: EventDraft): boolean {
  return event.title === draft.title && event.description === draft.description && event.location === draft.location && event.allDay === draft.allDay
    && event.start === draft.start && event.end === draft.end && event.timeZone === draft.timeZone && linkKeys(event) === linkKeys(draft);
}

export type DisplayStatus = "synced" | "pending" | "conflict" | "rejected";
export type DisplayEvent = { event: CalendarEventOutput; status: DisplayStatus; op: OutboxOp | null };

/** Estado exibido: cache + envios pendentes sobrepostos. Exclusões pendentes ficam de fora; criações e edições aparecem como "pendente". */
export function withOutbox(cache: readonly CalendarEventOutput[], ops: readonly OutboxOp[]): DisplayEvent[] {
  const byId = new Map(ops.map((op) => [op.eventId, op]));
  const shown: DisplayEvent[] = [];
  for (const event of cache) {
    const op = byId.get(event.id) ?? null;
    if (!op) { shown.push({ event, status: "synced", op: null }); continue; }
    if (op.kind === "delete") { if (op.state !== "pending") shown.push({ event, status: op.state, op }); continue; }
    shown.push({ event: { ...event, ...op.draft! }, status: op.state, op });
  }
  for (const op of ops) {
    if (op.kind !== "create" || !op.draft || cache.some((event) => event.id === op.eventId)) continue;
    const stamp = new Date(op.createdAt).toISOString();
    shown.push({ status: op.state, op, event: { ...op.draft, id: op.eventId, source: "local", readOnly: false, external: null, reflection: null, createdAt: stamp, updatedAt: stamp, version: 1 } });
  }
  return shown;
}

/**
 * Grava a intenção do usuário NO DISPOSITIVO antes de qualquer HTTP e devolve o envio gravado. Mudanças seguidas no
 * mesmo evento se fundem: editar um evento ainda não enviado continua sendo uma criação; excluí-lo cancela tudo sem rede.
 * Se a gravação local falhar, lança: quem chama mantém o formulário aberto (o rascunho nunca é descartado por erro).
 */
export async function enqueue(store: CalendarStore, ownerId: string, change:
  | { kind: "create"; eventId: string; draft: EventDraft }
  | { kind: "update"; event: CalendarEventOutput; draft: EventDraft }
  | { kind: "delete"; event: CalendarEventOutput }, now = Date.now()): Promise<OutboxOp | null> {
  const eventId = change.kind === "create" ? change.eventId : change.event.id;
  const existing = await store.getOp(ownerId, eventId);
  const base = { ownerId, eventId, state: "pending" as const, attempts: 0, nextAttemptAt: 0, notBefore: existing?.notBefore ?? 0, lastError: null, serverCopy: null as CalendarEventOutput | null, sentAt: existing?.sentAt ?? null, rev: (existing?.rev ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now };

  if (change.kind === "delete") {
    // Só cancela sem rede uma criação que nunca saiu. Se um envio já começou (`sentAt`), o servidor pode ter o evento:
    // a exclusão vira uma lápide ("delete" sem versão) que consulta o servidor antes de excluir.
    if (existing?.kind === "create" && existing.sentAt === null) { await store.removeOp(ownerId, eventId); await store.removeEvents(ownerId, [eventId]); return null; }
    const op: OutboxOp = { ...base, kind: "delete", draft: null, baseVersion: existing ? existing.baseVersion : change.event.version };
    await store.putOp(op);
    return op;
  }
  const draft = change.draft;
  // Criação ainda não aceita continua criação; edição de evento conhecido guarda a versão do servidor lida no início.
  const kind = change.kind === "create" || existing?.kind === "create" ? "create" : "update";
  const baseVersion = kind === "create" || change.kind !== "update" ? null : (existing?.baseVersion ?? change.event.version);
  const op: OutboxOp = { ...base, kind, draft, baseVersion, serverCopy: existing?.serverCopy ?? null, state: existing?.state === "conflict" ? "conflict" : "pending", lastError: existing?.state === "conflict" ? existing.lastError : null };
  await store.putOp(op);
  return op;
}

const backoff = (attempts: number) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
const errorCode = (error: unknown) => (isApiError(error) ? error.code : "UNKNOWN_ERROR");
const retryable = (error: unknown) => isApiError(error) && (error.code === "NETWORK_ERROR" || error.status === 429 || (error.status !== undefined && error.status >= 500));

export type FlushResult = { sent: number; failed: number; conflicts: number; rejected: number; stopped: "offline" | "unauthorized" | null };

/**
 * Tenta enviar os envios vencidos, um evento por vez e em ordem de criação. Falha de rede para a rodada (o resto
 * falharia igual); 401 também. O rascunho e o envio permanecem no dispositivo em qualquer falha.
 * `isCurrent` descarta o resultado se a conta mudou no meio da rodada.
 */
export async function flushOutbox(store: CalendarStore, remote: CalendarRemote, ownerId: string, options: { now?: () => number; force?: boolean; isCurrent?: () => boolean } = {}): Promise<FlushResult> {
  const now = options.now ?? Date.now;
  const isCurrent = options.isCurrent ?? (() => true);
  const result: FlushResult = { sent: 0, failed: 0, conflicts: 0, rejected: 0, stopped: null };
  for (const op of await store.listOps(ownerId)) {
    if (!isCurrent()) break;
    // `force` ("tentar agora") antecipa só o backoff do app; o piso do servidor (Retry-After) vale sempre.
    if (op.state !== "pending" || op.notBefore > now() || (!options.force && op.nextAttemptAt > now())) continue;
    try {
      // Marca "pode ter saído" ANTES do envio. Se a revisão já mudou, esta rodada pula o evento (a próxima o pega).
      if (!(await store.updateOp(ownerId, op.eventId, op.rev, { sentAt: now() }))) continue;
      const saved = await send(remote, op);
      if (!isCurrent()) break;
      if (saved === "gone") await store.removeEvents(ownerId, [op.eventId]); else await store.putEvents(ownerId, [saved]);
      await store.removeOp(ownerId, op.eventId, op.rev);
      if (saved !== "gone") await rebaseNewer(store, ownerId, op, saved);
      result.sent++;
    } catch (error) {
      if (!isCurrent()) break;
      if (isApiError(error) && error.code === "UNAUTHORIZED") { result.stopped = "unauthorized"; break; }
      const outcome = await classify(store, remote, op, error, now());
      result[{ retry: "failed", conflict: "conflicts", rejected: "rejected", done: "sent" }[outcome] as "failed" | "conflicts" | "rejected" | "sent"]++;
      if (isApiError(error) && error.code === "NETWORK_ERROR") { result.stopped = "offline"; break; }
    }
  }
  return result;
}

/**
 * O servidor confirmou a revisão `op.rev`, mas o usuário pode ter gravado uma revisão mais nova durante o envio.
 * Ela continua pendente, agora sobre a versão confirmada (e uma criação confirmada vira edição); nada é perdido nem recriado.
 */
async function rebaseNewer(store: CalendarStore, ownerId: string, sent: OutboxOp, saved: CalendarEventOutput): Promise<void> {
  const newer = await store.getOp(ownerId, sent.eventId);
  if (!newer || newer.rev <= sent.rev) return;
  await store.updateOp(ownerId, sent.eventId, newer.rev, { kind: newer.kind === "create" ? "update" : newer.kind, baseVersion: saved.version, attempts: 0, nextAttemptAt: 0, notBefore: 0 });
}

async function send(remote: CalendarRemote, op: OutboxOp): Promise<CalendarEventOutput | "gone"> {
  if (op.kind === "create") return remote.create(op.eventId, op.draft!);
  if (op.kind === "update") return remote.update(op.eventId, op.baseVersion!, op.draft!);
  try {
    // Lápide (sem versão): descobre a versão atual; 404 ⇒ o evento nunca chegou ao servidor.
    const version = op.baseVersion ?? (await remote.get(op.eventId)).version;
    await remote.remove(op.eventId, version);
  } catch (error) {
    // Já não existe: a exclusão está cumprida (reenvio de uma exclusão cuja resposta se perdeu).
    if (!(isApiError(error) && error.status === 404)) throw error;
  }
  return "gone";
}

type Outcome = "retry" | "conflict" | "rejected" | "done";

async function classify(store: CalendarStore, remote: CalendarRemote, op: OutboxOp, error: unknown, at: number): Promise<Outcome> {
  // Compare-and-set pela revisão: se o usuário editou durante o envio que falhou, a edição nova não é substituída.
  const save = (patch: Partial<OutboxOp>) => store.updateOp(op.ownerId, op.eventId, op.rev, { ...patch, updatedAt: at });
  if (retryable(error)) {
    const attempts = op.attempts + 1;
    const retryAfter = isApiError(error) ? error.retryAfterMs : undefined;
    const notBefore = retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(op.notBefore, at + retryAfter) : op.notBefore;
    await save({ attempts, lastError: errorCode(error), notBefore, nextAttemptAt: Math.max(at + backoff(attempts), notBefore) });
    // O prazo vale também para uma edição feita enquanto a revisão antiga estava em voo.
    if (notBefore > 0) await store.deferOp(op.ownerId, op.eventId, notBefore);
    return "retry";
  }
  const status = isApiError(error) ? error.status : undefined;
  if (status === 409 || status === 404) {
    // Descobre o que o servidor tem agora: o mesmo conteúdo (envio anterior chegou), outro (conflito) ou nada.
    let server: CalendarEventOutput | null;
    try { server = await remote.get(op.eventId); } catch (lookup) {
      if (isApiError(lookup) && lookup.status === 404) server = null;
      else { await save({ attempts: op.attempts + 1, lastError: errorCode(lookup), nextAttemptAt: Math.max(at + backoff(op.attempts + 1), op.notBefore) }); return "retry"; }
    }
    if (op.kind === "delete" && server === null) { await store.removeEvents(op.ownerId, [op.eventId]); await store.removeOp(op.ownerId, op.eventId, op.rev); return "done"; }
    if (op.draft && server && sameContent(server, op.draft)) { await store.putEvents(op.ownerId, [server]); await store.removeOp(op.ownerId, op.eventId, op.rev); return "done"; }
    await save({ state: "conflict", lastError: errorCode(error), serverCopy: server, nextAttemptAt: 0 });
    return "conflict";
  }
  await save({ state: "rejected", lastError: errorCode(error), nextAttemptAt: 0 });
  return "rejected";
}

/**
 * Resolve um conflito visível. `mine` reenvia o rascunho sobre a versão atual do servidor (se o evento foi removido lá,
 * vira uma nova criação com o mesmo ID); `server` descarta o rascunho e adota a cópia do servidor.
 */
export async function resolveConflict(store: CalendarStore, ownerId: string, eventId: string, choice: "mine" | "server"): Promise<void> {
  const op = await store.getOp(ownerId, eventId);
  if (!op || op.state !== "conflict") return;
  if (choice === "server") {
    if (op.serverCopy) await store.putEvents(ownerId, [op.serverCopy]); else await store.removeEvents(ownerId, [eventId]);
    await store.removeOp(ownerId, eventId, op.rev);
    return;
  }
  const server = op.serverCopy;
  const next: OutboxOp = server
    ? { ...op, kind: op.kind === "delete" ? "delete" : "update", baseVersion: server.version, state: "pending", attempts: 0, nextAttemptAt: 0, lastError: null, serverCopy: null, rev: op.rev + 1 }
    : op.kind === "delete"
      ? { ...op, state: "pending", rev: op.rev + 1 }
      : { ...op, kind: "create", baseVersion: null, state: "pending", attempts: 0, nextAttemptAt: 0, lastError: null, serverCopy: null, rev: op.rev + 1 };
  if (!server && op.kind === "delete") { await store.removeEvents(ownerId, [eventId]); await store.removeOp(ownerId, eventId, op.rev); return; }
  await store.putOp(next);
}

/** Descarta um envio recusado ou em conflito, devolvendo o evento ao que o servidor tem (cache). */
export async function discardOp(store: CalendarStore, ownerId: string, eventId: string): Promise<void> {
  const op = await store.getOp(ownerId, eventId);
  if (!op) return;
  if (op.kind === "create") await store.removeEvents(ownerId, [eventId]);
  await store.removeOp(ownerId, eventId, op.rev);
}
