import type { CalendarEventOutput } from "../lib/calendar-api";
import type { CalendarStore } from "./store";

// Mesma sobreposição do servidor; dia inteiro como datas flutuantes lidas em UTC (o período já vem ampliado em um dia).
export const overlapsRange = (event: Pick<CalendarEventOutput, "allDay" | "start" | "end">, from: string, to: string) => {
  const startsAt = event.allDay ? `${event.start}T00:00:00.000Z` : event.start;
  const endsAt = event.allDay ? `${event.end}T23:59:59.999Z` : event.end;
  return startsAt < to && endsAt > from;
};

export type RangeLister = { listRange(range: { from: string; to: string }, signal?: AbortSignal): Promise<CalendarEventOutput[]> };

/** Assinatura do que está no dispositivo: eventos (ID@versão) e envios (ID#revisão:estado). Qualquer mudança local altera a chave. */
async function snapshot(store: CalendarStore, ownerId: string) {
  const [events, ops] = await Promise.all([store.listEvents(ownerId), store.listOps(ownerId)]);
  const key = `${events.map((event) => `${event.id}@${event.version}`).sort().join(",")}|${ops.map((op) => `${op.eventId}#${op.rev}:${op.state}`).sort().join(",")}`;
  return { events, ops, key };
}

/**
 * Busca um período no servidor e reconcilia o cache: atualiza o que veio e remove o que sumiu, exceto o que tem envio pendente.
 * Se algo mudou no dispositivo durante a busca (um ACK de envio, uma edição), a resposta pode estar velha: é descartada
 * (`"changed"`) e o chamador busca de novo. Assim uma leitura iniciada antes de um ACK nunca apaga nem desfaz o que o ACK gravou.
 */
export async function reconcileRange(store: CalendarStore, remote: RangeLister, ownerId: string, range: { from: string; to: string }, signal: AbortSignal, isCurrent: () => boolean = () => true): Promise<"ok" | "changed" | "aborted"> {
  const before = await snapshot(store, ownerId);
  const fetched = await remote.listRange(range, signal);
  if (signal.aborted || !isCurrent()) return "aborted";
  const after = await snapshot(store, ownerId);
  if (after.key !== before.key) return "changed";
  const withOps = new Set(after.ops.map((op) => op.eventId));
  const seen = new Set(fetched.map((event) => event.id));
  const gone = after.events.filter((event) => !seen.has(event.id) && !withOps.has(event.id) && overlapsRange(event, range.from, range.to)).map((event) => event.id);
  await store.putEvents(ownerId, fetched);
  if (gone.length > 0) await store.removeEvents(ownerId, gone);
  return "ok";
}
