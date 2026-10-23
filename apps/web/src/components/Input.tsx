import { useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import gsap from "gsap";
import { reducedMotion } from "./popover";
import "./primitives.css";

export function Field({ id, label, hint, error, children }: { id: string; label?: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className={`ui-field ${error ? "has-error" : ""}`}>
    {label && <label htmlFor={id}>{label}</label>}{children}
    {(hint || error) && <small id={`${id}-description`} role={error ? "alert" : undefined}>{error || hint}</small>}
  </div>;
}

type Props = InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string; ref?: Ref<HTMLInputElement> };
export default function Input({ label, hint, error, id, ref, className = "", onFocus, onBlur, ...props }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const root = useRef<HTMLDivElement>(null);
  const context = useRef<gsap.Context | null>(null);
  useLayoutEffect(() => {
    context.current = gsap.context(() => {
      if (error && !reducedMotion()) gsap.fromTo(root.current, { x: -3 }, { x: 0, duration: .2, ease: "elastic.out(1,.4)", clearProps: "transform" });
    }, root);
    return () => { context.current?.revert(); };
  }, [error]);
  function focusRing(focused: boolean) {
    context.current?.add(() => gsap.to(root.current, { "--input-ring": focused ? 1 : 0, duration: reducedMotion() ? 0 : .18, overwrite: "auto" }));
  }
  return <Field id={inputId} label={label} hint={hint} error={error}>
    <div ref={root} className="ui-input-ring"><input {...props} ref={ref} id={inputId} className={`ui-input ${className}`} aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={[props["aria-describedby"], hint || error ? descriptionId : ""].filter(Boolean).join(" ") || undefined}
      onFocus={event => { focusRing(true); onFocus?.(event); }} onBlur={event => { focusRing(false); onBlur?.(event); }} /></div>
  </Field>;
}
