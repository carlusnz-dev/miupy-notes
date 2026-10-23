import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import gsap from "gsap";
import { useAnchoredPosition, useDismiss, usePresence } from "./popover";
import "./overdue-beacon.css";

export type OverdueItem = { id: string; title: string; /** Texto do prazo, ex.: "venceu ontem, 09:00". */ when: string };

/**
 * Aviso de atraso: bolinha vermelha chapada que pisca (GSAP) e abre uma lista das tarefas atrasadas. Não renderiza nada
 * sem itens. Com movimento reduzido não pisca: só a cor. A lista é um popover ancorado, fechado por Esc ou clique fora.
 */
export default function OverdueBeacon({ items, onOpen, onComplete }: {
  items: readonly OverdueItem[];
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const mounted = usePresence(open && items.length > 0, popover);
  const style = useAnchoredPosition(mounted, button, popover, 320, [items.length]);
  useDismiss(open, root, () => setOpen(false));

  // Pulso: opacidade e escala em vai-e-volta. matchMedia reverte o tween ao ligar o movimento reduzido e ao desmontar.
  useEffect(() => {
    const element = dot.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.to(element, { opacity: .25, scale: .72, duration: .75, ease: "sine.inOut", yoyo: true, repeat: -1 });
    });
    return () => media.revert();
  }, [items.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (items.length === 0) return null;
  const close = () => { setOpen(false); button.current?.focus(); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); } };
  return (
    <div ref={root} className="overdue-beacon" onKeyDown={onKeyDown}>
      <button ref={button} type="button" className="overdue-beacon-button" aria-expanded={open} aria-controls={mounted ? popoverId : undefined} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
        <span ref={dot} className="overdue-beacon-dot" aria-hidden="true" />
        {items.length} {items.length === 1 ? "atrasada" : "atrasadas"}
      </button>
      {mounted && (
        <div ref={popover} id={popoverId} className="overdue-beacon-popover" role="dialog" aria-label="Tarefas atrasadas" style={style}>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <input type="checkbox" checked={false} onChange={() => onComplete(item.id)} aria-label={`Concluir tarefa: ${item.title}`} />
                <button type="button" className="overdue-beacon-item" onClick={() => { setOpen(false); onOpen(item.id); }}>
                  <span>{item.title}</span>
                  <small>{item.when}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
