import { useLayoutEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";

export default function PageTransition({ pathname, children }: { pathname: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const context = gsap.context(() => {
        gsap.fromTo(element, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .4, ease: "back.out(1.6)", clearProps: "all" });
      }, element);
      return () => context.revert();
    });
    return () => media.revert();
  }, [pathname]);

  return <div className="page-transition" ref={ref}>{children}</div>;
}
