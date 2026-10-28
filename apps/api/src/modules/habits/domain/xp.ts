/** Gamificação (fundação): tudo determinístico e derivado dos eventos persistidos; nada vem do cliente. */
export type Priority = "low" | "medium" | "high";
export type XpEventType = "completion";

export const XP_PER_LEVEL = 100;
const POINTS: Record<XpEventType, Record<Priority, number>> = { completion: { low: 5, medium: 10, high: 15 } };

export const pointsFor = (type: XpEventType, priority: Priority) => POINTS[type][priority];

/** Evento estável: a chave (hábito + data + tipo) é determinística; desmarcar preenche `revokedAt` em vez de duplicar. */
export type XpEvent = {
  habitId: string; date: string; type: XpEventType; points: number; createdAt: string; revokedAt: string | null;
};
export const xpEventKey = (habitId: string, date: string, type: XpEventType) => `${habitId}#${date}#${type}`;

export type XpBalance = { totalXp: number; level: number; levelXp: number; nextLevelXp: number; completions: number };

export function balanceOf(events: readonly XpEvent[]): XpBalance {
  const active = events.filter((event) => event.revokedAt === null);
  const totalXp = active.reduce((sum, event) => sum + event.points, 0);
  return {
    totalXp, level: Math.floor(totalXp / XP_PER_LEVEL) + 1, levelXp: totalXp % XP_PER_LEVEL, nextLevelXp: XP_PER_LEVEL,
    completions: active.filter((event) => event.type === "completion").length,
  };
}

/** Registro extensível: nova conquista = nova entrada, calculada do saldo; nada é gravado. */
const ACHIEVEMENTS: readonly { id: string; title: string; unlocked: (balance: XpBalance) => boolean }[] = [
  { id: "first_completion", title: "Primeira conclusão", unlocked: (b) => b.completions >= 1 },
  { id: "ten_completions", title: "Dez conclusões", unlocked: (b) => b.completions >= 10 },
  { id: "level_5", title: "Nível 5", unlocked: (b) => b.level >= 5 },
];

export const achievementsOf = (balance: XpBalance) => ACHIEVEMENTS.map(({ id, title, unlocked }) => ({ id, title, unlocked: unlocked(balance) }));
