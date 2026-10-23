import { useEffect, useRef, type ButtonHTMLAttributes, type Ref } from "react";
import gsap from "gsap";
import { reducedMotion } from "./popover";
import "./primitives.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export default function Button({ variant = "secondary", size = "md", loading = false, disabled, className = "", children, onClick, ref, type = "button", ...props }: Props) {
  const context = useRef<gsap.Context | null>(null);
  useEffect(() => {
    context.current = gsap.context(() => {});
    return () => { context.current?.revert(); };
  }, []);
  return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
    className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} onClick={event => {
      if (!reducedMotion()) {
        const button = event.currentTarget;
        const bounds = button.getBoundingClientRect();
        const diameter = Math.hypot(bounds.width, bounds.height) * 2;
        const ripple = document.createElement("span");
        ripple.className = "ui-ripple";
        ripple.setAttribute("aria-hidden", "true");
        Object.assign(ripple.style, { width: `${diameter}px`, height: `${diameter}px`, left: `${(event.detail ? event.clientX - bounds.left : bounds.width / 2) - diameter / 2}px`, top: `${(event.detail ? event.clientY - bounds.top : bounds.height / 2) - diameter / 2}px` });
        button.append(ripple);
        context.current?.add(() => gsap.fromTo(ripple, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: .55, ease: "power2.out", onComplete: () => ripple.remove() }));
      }
      onClick?.(event);
    }}><span className="ui-button-content">{children}{loading && <span aria-hidden="true">…</span>}</span></button>;
}
