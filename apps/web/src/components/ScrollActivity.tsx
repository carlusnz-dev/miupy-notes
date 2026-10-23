import { useEffect } from "react";
import "./scrollbar.css";

/** Observa também áreas roláveis aninhadas sem um listener por componente. */
export default function ScrollActivity() {
  useEffect(() => {
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    function scroll(event: Event) {
      const node = event.target === document ? document.documentElement : event.target;
      if (!(node instanceof Element)) return;
      clearTimeout(timers.get(node));
      node.classList.add("is-scrolling");
      timers.set(node, setTimeout(() => { node.classList.remove("is-scrolling"); timers.delete(node); }, 800));
    }
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", scroll, true);
      timers.forEach((timer, node) => { clearTimeout(timer); node.classList.remove("is-scrolling"); });
    };
  }, []);
  return null;
}
