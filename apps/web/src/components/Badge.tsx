import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { X } from "lucide-react";
import { animateIn, reducedMotion } from "../lib/notes-motion";
import "./badge.css";

type BadgeProps = {
  children: string;
  /** Com `onRemove`, o selo ganha o botão X acessível. */
  onRemove?: () => void;
  /** Anima a entrada (ignorado com movimento reduzido). */
  animate?: boolean;
};

export default function Badge({ children, onRemove, animate = false }: BadgeProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => (animate ? animateIn(ref.current, { opacity: 0, scale: .85 }, { duration: .16 }) : undefined), [animate]);

  function remove() {
    if (!onRemove) return;
    if (reducedMotion() || !ref.current) return onRemove();
    gsap.to(ref.current, { opacity: 0, scale: .85, duration: .12, ease: "power1.in", onComplete: onRemove });
  }

  return (
    <span className="badge" ref={ref}>
      <span className="badge-label">{children}</span>
      {onRemove && (
        <button type="button" className="badge-remove" aria-label={`Remover tag ${children}`} title={`Remover ${children}`} onClick={remove}>
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
