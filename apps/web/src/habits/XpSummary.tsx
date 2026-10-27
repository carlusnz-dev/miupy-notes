import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import type { HabitsXp } from "../lib/habits-api";

/** Nível, XP e conquistas vêm da API; aqui só se anima a barra (sem animação com movimento reduzido). */
export default function XpSummary({ xp }: { xp: HabitsXp }) {
  const bar = useRef<HTMLSpanElement>(null);
  const percent = Math.min(100, Math.round(xp.levelXp / xp.nextLevelXp * 100));
  useLayoutEffect(() => {
    const context = gsap.context(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      gsap.to(bar.current, { width: `${percent}%`, duration: reduced ? 0 : .5, ease: "power2.out" });
    });
    return () => context.revert();
  }, [percent]);
  const unlocked = xp.achievements.filter(item => item.unlocked);
  return <section className="habits-xp" aria-label="Progresso">
    <div><strong>Nível {xp.level}</strong><span>{xp.totalXp} XP · {xp.completions} {xp.completions === 1 ? "conclusão" : "conclusões"}</span></div>
    <div className="habits-xp-bar" role="progressbar" aria-label={`Progresso para o nível ${xp.level + 1}`} aria-valuemin={0} aria-valuemax={xp.nextLevelXp} aria-valuenow={xp.levelXp}><span ref={bar} /></div>
    <small>{xp.levelXp} de {xp.nextLevelXp} XP para o próximo nível{unlocked.length ? ` · Conquistas: ${unlocked.map(item => item.title).join(", ")}` : ""}</small>
  </section>;
}
