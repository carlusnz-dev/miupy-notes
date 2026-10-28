import { createIndexedDbCalendarStore } from "./store";
import { calendarFetchCache } from "./fetch-cache";

export const calendarStore = createIndexedDbCalendarStore();
const pending = new Set<Promise<unknown>>();

/** A saída espera as gravações já iniciadas antes de apagar os dados. */
export function trackCalendarWork<T>(work: Promise<T>): Promise<T> {
  pending.add(work);
  void work.finally(() => pending.delete(work)).catch(() => undefined);
  return work;
}
export async function clearCalendarOwner(ownerId: string) {
  while (pending.size) await Promise.allSettled([...pending]);
  calendarFetchCache.clearOwner(ownerId);
  await calendarStore.clearOwner(ownerId);
}
