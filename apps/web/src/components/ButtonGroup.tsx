import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import "./button-group.css";

type Option<T extends string | number> = { value: T; label: string; accessibleLabel?: string };

export default function ButtonGroup<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const initialized = useRef(false);
  const updateIndicator = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !indicator.current) return;
    const media = gsap.matchMedia();
    media.add({ reduced: "(prefers-reduced-motion: reduce)", motion: "(prefers-reduced-motion: no-preference)" }, (context) => {
      const move = () => {
        const selected = element.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
        if (!selected) return;
        gsap.to(indicator.current, {
          x: selected.offsetLeft, y: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight,
          duration: !initialized.current || context.conditions?.reduced ? 0 : .5,
          ease: "elastic.out(1, 0.65)", overwrite: true,
        });
        initialized.current = true;
      };
      updateIndicator.current = move;
      move();
      const observer = new ResizeObserver(move);
      observer.observe(element);
      return () => {
        updateIndicator.current = null;
        observer.disconnect();
      };
    });
    return () => media.revert();
  }, []);

  useLayoutEffect(() => {
    updateIndicator.current?.();
    const target = indicator.current;
    return () => { if (target) gsap.killTweensOf(target); };
  }, [value]);

  return (
    <div ref={root} className="button-group" role="group" aria-label={label}>
      <span ref={indicator} className="button-group-indicator" aria-hidden="true" />
      {options.map((option) => (
        <button key={option.value} type="button" aria-label={option.accessibleLabel ?? option.label} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}
