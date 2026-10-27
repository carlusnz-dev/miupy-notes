import type { Habit, HabitLog } from "../domain/habit.js";
import { xpEventKey, type XpEvent } from "../domain/xp.js";
import { HabitsRepository } from "./habits.repository.js";

export class MemoryHabitsRepository extends HabitsRepository {
  private readonly habits = new Map<string, Habit>();
  private readonly logs = new Map<string, HabitLog>();
  private readonly events = new Map<string, XpEvent & { ownerId: string }>();
  async create(habit: Habit) { this.habits.set(`${habit.ownerId}:${habit.id}`, habit); return habit; }
  async findById(ownerId: string, id: string) { return this.habits.get(`${ownerId}:${id}`) ?? null; }
  async list(ownerId: string) { return [...this.habits.values()].filter(habit => habit.ownerId === ownerId); }
  async update(habit: Habit, expectedVersion: number) {
    const key = `${habit.ownerId}:${habit.id}`;
    if (this.habits.get(key)?.version !== expectedVersion) return null;
    this.habits.set(key, habit); return habit;
  }
  async deleteHabit(ownerId: string, id: string) { this.habits.delete(`${ownerId}:${id}`); }
  async listLogs(ownerId: string, from: string, to: string) {
    return [...this.logs.values()].filter(log => log.ownerId === ownerId && log.date >= from && log.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.habitId.localeCompare(b.habitId));
  }
  /** Os dois mapas mudam sem `await` no meio: atômico para quem chama, como a transação do DynamoDB. */
  async completeOccurrence(log: HabitLog, event: XpEvent) {
    this.logs.set(`${log.ownerId}:${log.date}:${log.habitId}`, log);
    const key = `${log.ownerId}:${xpEventKey(event.habitId, event.date, event.type)}`;
    this.events.set(key, { ...(this.events.get(key) ?? event), ownerId: log.ownerId, revokedAt: null });
  }
  async reopenOccurrence(ownerId: string, habitId: string, date: string, type: XpEvent["type"], revokedAt: string) {
    this.logs.delete(`${ownerId}:${date}:${habitId}`);
    const key = `${ownerId}:${xpEventKey(habitId, date, type)}`;
    const existing = this.events.get(key);
    if (existing) this.events.set(key, { ...existing, revokedAt });
  }
  async listXpEvents(ownerId: string) { return [...this.events.values()].filter(event => event.ownerId === ownerId); }
}
