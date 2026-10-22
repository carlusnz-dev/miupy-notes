import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import gsap from "gsap";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Montagem com entrada/saída GSAP: `mounted` continua verdadeiro até a saída terminar.
 * Movimento reduzido: instantâneo. O contexto é revertido ao trocar de estado ou desmontar.
 */
export function usePresence(open: boolean, element: RefObject<HTMLElement | null>) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    const node = element.current;
    if (!mounted || !node) return;
    if (open) {
      if (reducedMotion()) return;
      const context = gsap.context(() => { gsap.fromTo(node, { opacity: 0, y: -6, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .18, ease: "power2.out", clearProps: "opacity,transform" }); }, node);
      return () => context.revert();
    }
    if (reducedMotion()) { setMounted(false); return; }
    const context = gsap.context(() => { gsap.to(node, { opacity: 0, y: -4, duration: .12, ease: "power1.in", onComplete: () => setMounted(false) }); }, node);
    return () => context.revert();
  }, [open, mounted, element]);
  return mounted;
}

/**
 * Posição `fixed` junto ao campo (não é cortada pelo overflow do painel do modal), no lado com mais espaço.
 * `width: "anchor"` acompanha a largura do campo; um número fixa a largura e alinha à direita do campo.
 */
export function useAnchoredPosition(mounted: boolean, anchor: RefObject<HTMLElement | null>, popover: RefObject<HTMLElement | null>, width: number | "anchor", deps: readonly unknown[] = []) {
  const [style, setStyle] = useState<CSSProperties>({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!mounted) return;
    function place() {
      const field = anchor.current?.getBoundingClientRect();
      const element = popover.current;
      if (!field || !element) return;
      const size = Math.min(width === "anchor" ? Math.max(field.width, 160) : width, window.innerWidth - 16);
      const left = Math.min(Math.max(8, width === "anchor" ? field.left : field.right - size), window.innerWidth - size - 8);
      const below = window.innerHeight - field.bottom - 14;
      const above = field.top - 14;
      const natural = element.scrollHeight;
      const useBelow = natural <= below || below >= above;
      const maxHeight = Math.max(120, useBelow ? below : above);
      const height = Math.min(natural, maxHeight);
      setStyle({ left, width: size, maxHeight, top: useBelow ? field.bottom + 6 : field.top - 6 - height });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [mounted, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return style;
}

/** Fecha ao tocar fora do contêiner (campo + popover). */
export function useDismiss(open: boolean, container: RefObject<HTMLElement | null>, onDismiss: () => void) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!container.current?.contains(event.target as Node)) latest.current(); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, container]);
}

/**
 * Navegação de lista (listbox) com foco no campo e `aria-activedescendant`:
 * setas, Home/End, PageUp/PageDown e busca por digitação. Devolve true quando tratou a tecla.
 */
export function useListNavigation(labels: readonly string[]) {
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: "", at: 0 });
  function navigate(event: KeyboardEvent): boolean {
    const last = labels.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1), ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0, End: () => last,
      PageDown: () => Math.min(last, active + 10), PageUp: () => Math.max(0, active - 10),
    };
    const move = moves[event.key];
    if (move) { event.preventDefault(); setActive(move()); return true; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 600 ? "" : typed.current.text) + event.key.toLocaleLowerCase("pt-BR"), at: now };
      const match = labels.findIndex((label) => label.toLocaleLowerCase("pt-BR").startsWith(typed.current.text));
      if (match >= 0) setActive(match);
      return match >= 0;
    }
    return false;
  }
  return { active, setActive, navigate };
}
