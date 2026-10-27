import { randomUUID } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { Habit, type HabitLog } from "../domain/habit.js";
import { addDays, occurrenceDates, occursOn } from "../domain/recurrence.js";
import { achievementsOf, balanceOf, pointsFor } from "../domain/xp.js";
import { HabitDtoAdapter } from "../dto/adapter.js";
import { validRange, type CreateHabitInput, type DateRangeQuery, type PauseInput, type ResumeInput, type UpdateHabitInput } from "../dto/input.js";
import type { OccurrenceOutput, XpOutput } from "../dto/output.js";
import { HabitsRepository } from "../repository/habits.repository.js";
import { HabitsService } from "./habits.service.js";

export const TRASH_DAYS = 30;
export const MAX_HABITS = 300;
const MAX_PAUSES = 50;

const notFound = () => new AppError(404, "NOT_FOUND", "Hábito não encontrado.");
const conflict = () => new AppError(409, "CONFLICT", "Este hábito foi alterado por outra operação. Feche e abra novamente para recarregar.");
const inTrash = () => new AppError(409, "CONFLICT", "O hábito está na lixeira; restaure-o antes de alterar.");
const invalid = (message: string) => new AppError(400, "VALIDATION_ERROR", message);

export class HabitsServiceImpl extends HabitsService {
  constructor(repository: HabitsRepository, private readonly clock: () => Date = () => new Date()) { super(repository); }

  private get now() { return this.clock().toISOString(); }
  /** Na lixeira vencida o hábito já não existe para a API, mesmo antes do expurgo físico. */
  private visible(habit: Habit) { return habit.deletedAt === null || (habit.purgeAfter !== null && habit.purgeAfter > this.now); }

  async create(ownerId: string, input: CreateHabitInput) {
    if ((await this.repository.list(ownerId)).filter(h => this.visible(h)).length >= MAX_HABITS) throw invalid(`Limite de ${MAX_HABITS} hábitos atingido.`);
    const now = this.now;
    return this.repository.create(new Habit(ownerId, { ...input, id: randomUUID(), pauses: [], deletedAt: null, purgeAfter: null, createdAt: now, updatedAt: now, version: 1 }));
  }
  async findById(ownerId: string, id: string) {
    const habit = await this.repository.findById(ownerId, id);
    if (!habit || !this.visible(habit)) throw notFound();
    return habit;
  }
  async list(ownerId: string, trash: boolean) {
    return (await this.repository.list(ownerId)).filter(h => this.visible(h) && (h.deletedAt !== null) === trash)
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id));
  }

  /** Aplica a mudança sobre a versão lida; a escrita condicional detecta a corrida (409). */
  private async save(current: Habit, expectedVersion: number, change: Partial<Habit>) {
    if (current.version !== expectedVersion) throw conflict();
    const next = new Habit(current.ownerId, { ...current, ...change, version: current.version + 1, updatedAt: this.now });
    const saved = await this.repository.update(next, current.version);
    if (!saved) throw conflict();
    return saved;
  }
  private async editable(ownerId: string, id: string) {
    const habit = await this.findById(ownerId, id);
    if (habit.deletedAt !== null) throw inTrash();
    return habit;
  }

  async update(ownerId: string, id: string, { version, ...fields }: UpdateHabitInput) {
    const current = await this.editable(ownerId, id);
    if (!validRange({ ...current, ...fields })) throw invalid("A data final deve ser igual ou posterior ao início.");
    return this.save(current, version, fields);
  }
  async pause(ownerId: string, id: string, input: PauseInput) {
    const current = await this.editable(ownerId, id);
    if (current.pauses.length >= MAX_PAUSES) throw invalid("Muitas pausas registradas neste hábito.");
    return this.save(current, input.version, { pauses: [...current.pauses, { from: input.from, until: input.until }] });
  }
  /** Fecha em `on` as pausas que continuam valendo nessa data; as que ainda não começaram são descartadas. */
  async resume(ownerId: string, id: string, input: ResumeInput) {
    const current = await this.editable(ownerId, id);
    const active = (p: Habit["pauses"][number]) => p.until === null || p.until > input.on;
    if (!current.pauses.some(active)) throw new AppError(409, "CONFLICT", "O hábito não está pausado.");
    const pauses = current.pauses.flatMap(p => !active(p) ? [p] : p.from >= input.on ? [] : [{ from: p.from, until: input.on }]);
    return this.save(current, input.version, { pauses });
  }
  async remove(ownerId: string, id: string) {
    const current = await this.findById(ownerId, id);
    if (current.deletedAt !== null) return current;
    const now = this.clock();
    return this.save(current, current.version, { deletedAt: now.toISOString(), purgeAfter: new Date(now.getTime() + TRASH_DAYS * 86_400_000).toISOString() });
  }
  async restore(ownerId: string, id: string) {
    const current = await this.findById(ownerId, id);
    if (current.deletedAt === null) return current;
    return this.save(current, current.version, { deletedAt: null, purgeAfter: null });
  }
  async purgeExpired(ownerId: string) {
    const expired = (await this.repository.list(ownerId)).filter(h => !this.visible(h));
    for (const habit of expired) await this.repository.deleteHabit(ownerId, habit.id);
    return expired.length;
  }

  async occurrences(ownerId: string, { from, to }: DateRangeQuery) {
    const [habits, logs] = await Promise.all([this.repository.list(ownerId), this.repository.listLogs(ownerId, from, to)]);
    const done = new Map(logs.map(log => [`${log.habitId}:${log.date}`, log]));
    return habits.filter(h => h.deletedAt === null).flatMap(habit =>
      occurrenceDates(habit, from, to).map(date => HabitDtoAdapter.occurrence(habit, date, done.get(`${habit.id}:${date}`))))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.title.localeCompare(b.title, "pt-BR") || a.habitId.localeCompare(b.habitId));
  }

  async setOccurrence(ownerId: string, habitId: string, date: string, status: "completed" | "pending"): Promise<OccurrenceOutput> {
    const habit = await this.editable(ownerId, habitId);
    // O servidor não conhece o dia local do usuário; o fuso mais adiantado (+14 h) está no máximo um dia à frente de UTC.
    if (date > addDays(this.now.slice(0, 10), 1)) throw invalid("Não é possível concluir uma ocorrência futura.");
    if (!occursOn(habit, date)) throw invalid("O hábito não tem ocorrência nesta data.");
    const type = "completion" as const;
    if (status === "completed") {
      const now = this.now;
      const log: HabitLog = { ownerId, habitId, date, completedAt: now, title: habit.title, kind: habit.kind, priority: habit.priority };
      const existing = (await this.repository.listLogs(ownerId, date, date)).find(l => l.habitId === habitId);
      const saved = existing ?? log;
      if (!existing) await this.repository.putLog(log);
      const event = await this.repository.grantXp(ownerId, { habitId, date, type, points: pointsFor(type, habit.priority), createdAt: now, revokedAt: null });
      if (event.revokedAt !== null) await this.repository.setXpRevoked(ownerId, habitId, date, type, null);
      return HabitDtoAdapter.occurrence(habit, date, saved);
    }
    await this.repository.deleteLog(ownerId, habitId, date);
    await this.repository.setXpRevoked(ownerId, habitId, date, type, this.now);
    return HabitDtoAdapter.occurrence(habit, date, undefined);
  }

  history(ownerId: string, { from, to }: DateRangeQuery) { return this.repository.listLogs(ownerId, from, to); }

  async xp(ownerId: string): Promise<XpOutput> {
    const balance = balanceOf(await this.repository.listXpEvents(ownerId));
    return { ...balance, achievements: achievementsOf(balance) };
  }
}
