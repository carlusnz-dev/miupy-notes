import gsap from "gsap";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Anima `element` só quando o usuário não pediu movimento reduzido; devolve a função que reverte. */
export function animateIn(element: Element | null, from: gsap.TweenVars, to: gsap.TweenVars = {}): () => void {
  if (!element) return () => {};
  const media = gsap.matchMedia();
  media.add("(prefers-reduced-motion: no-preference)", () => {
    gsap.fromTo(element, from, { opacity: 1, x: 0, y: 0, scale: 1, duration: .2, ease: "power2.out", clearProps: "all", ...to });
  });
  return () => media.revert();
}
