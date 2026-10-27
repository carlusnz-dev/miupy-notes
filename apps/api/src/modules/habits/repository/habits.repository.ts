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

  /** Execuções no intervalo inclusivo de datas, em ordem de data. */
  abstract listLogs(ownerId: string, from: string, to: string): Promise<HabitLog[]>;

  /**
   * Conclui a ocorrência numa única escrita atômica: grava a execução e cria o evento de XP ou o reativa
   * (`revokedAt` nulo). Idempotente: o evento existente conserva `points` e `createdAt`.
   */
  abstract completeOccurrence(log: HabitLog, event: XpEvent): Promise<void>;
  /**
   * Desfaz a conclusão numa única escrita atômica: apaga a execução e compensa o evento de XP (`revokedAt`), se ele existe.
   * Idempotente. `409` se outra escrita da mesma ocorrência está em andamento.
   */
  abstract reopenOccurrence(ownerId: string, habitId: string, date: string, type: XpEvent["type"], revokedAt: string): Promise<void>;
  abstract listXpEvents(ownerId: string): Promise<XpEvent[]>;
}
