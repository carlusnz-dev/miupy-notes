import { BaseRepository } from "../../../core/repository/base.repository.js";
import type { Habit, HabitLog } from "../domain/habit.js";
import type { XpEvent } from "../domain/xp.js";

/**
 * Um repositório para o agregado: cadastro (`HABIT#`), execuções (`HLOG#<data>#<hábito>`) e eventos de XP
 * (`HXP#<hábito>#<data>#<tipo>`). Execuções e XP independem do cadastro: sobrevivem à remoção física.
 */
export abstract class HabitsRepository extends BaseRepository<Habit> {
  abstract list(ownerId: string): Promise<Habit[]>;
  abstract update(habit: Habit, expectedVersion: number): Promise<Habit | null>;
  /** Remoção física do cadastro, só para a rotina de expurgo. */
  abstract deleteHabit(ownerId: string, id: string): Promise<void>;

  abstract putLog(log: HabitLog): Promise<void>;
  abstract deleteLog(ownerId: string, habitId: string, date: string): Promise<void>;
  /** Execuções no intervalo inclusivo de datas, em ordem de data. */
  abstract listLogs(ownerId: string, from: string, to: string): Promise<HabitLog[]>;

  /** Cria o evento se a chave ainda não existe; devolve o que está gravado (idempotente). */
  abstract grantXp(ownerId: string, event: XpEvent): Promise<XpEvent>;
  /** `revokedAt` não nulo compensa o evento; `null` o reativa. Sem efeito se o evento não existe. */
  abstract setXpRevoked(ownerId: string, habitId: string, date: string, type: XpEvent["type"], revokedAt: string | null): Promise<void>;
  abstract listXpEvents(ownerId: string): Promise<XpEvent[]>;
}
