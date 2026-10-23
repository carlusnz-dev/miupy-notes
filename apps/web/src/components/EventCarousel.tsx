import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import gsap from "gsap";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { reducedMotion } from "./popover";
import "./event-carousel.css";

const GAP_PX = 12;
/** Itens visíveis por largura do carrossel: 1 no celular, mais no desktop. */
const perPageFor = (width: number) => (width < 520 ? 1 : width < 820 ? 2 : width < 1120 ? 3 : 4);
/** Deslocamento mínimo (px) para o gesto virar arrasto: abaixo disso é um clique no cartão. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Carrossel de cartões: `perPage` itens por vez (conforme a largura), setas, arrastar com o ponteiro (encaixa no item
 * mais próximo), setas do teclado e transição GSAP (instantânea com movimento reduzido). Itens fora da janela ficam inertes.
 */
export default function EventCarousel({ label, children }: { label: string; children: ReactNode }) {
  const items = Children.toArray(children);
  const count = items.length;
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const context = useRef<gsap.Context | null>(null);
  const [perPage, setPerPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [itemWidth, setItemWidth] = useState(0);
  const maxIndex = Math.max(0, count - perPage);
  const first = Math.min(index, maxIndex);
  const stride = itemWidth + GAP_PX;
  const drag = useRef<{ pointerId: number; startX: number; startOffset: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  // O contexto vive enquanto o carrossel estiver montado: trocar de página anima sem reverter o estado anterior.
  useLayoutEffect(() => {
    context.current = gsap.context(() => undefined, viewport);
    return () => { context.current?.revert(); context.current = null; };
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const next = perPageFor(width);
      setPerPage(next);
      setItemWidth(Math.max(0, (width - GAP_PX * (next - 1)) / next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const slideTo = useCallback((target: number, animate: boolean) => {
    const node = track.current;
    if (!node) return;
    context.current?.add(() => {
      if (!animate || reducedMotion()) gsap.set(node, { x: -target * stride });
      else gsap.to(node, { x: -target * stride, duration: .42, ease: "power3.out", overwrite: true });
    });
  }, [stride]);

  // Sem animar na medição inicial e ao redimensionar; animado quando a página muda.
  const lastIndex = useRef(first);
  useLayoutEffect(() => {
    slideTo(first, lastIndex.current !== first);
    lastIndex.current = first;
  }, [first, slideTo]);

  const go = (target: number) => setIndex(Math.min(maxIndex, Math.max(0, target)));

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || count <= perPage) return;
    suppressClick.current = false;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: -first * stride, active: false };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const delta = event.clientX - state.startX;
    if (!state.active) {
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
      state.active = true;
      // Só depois do limiar: um clique simples continua chegando ao cartão.
      event.currentTarget.setPointerCapture(event.pointerId);
      if (track.current) gsap.killTweensOf(track.current);
    }
    // Resistência nas pontas.
    const raw = state.startOffset + delta;
    const min = -maxIndex * stride;
    const clamped = raw > 0 ? raw / 3 : raw < min ? min + (raw - min) / 3 : raw;
    if (track.current) gsap.set(track.current, { x: clamped });
  }
  function endDrag(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    drag.current = null;
    if (!state.active) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 60);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = cancelled ? first : Math.min(maxIndex, Math.max(0, Math.round(-(state.startOffset + event.clientX - state.startX) / stride)));
    if (target === first) slideTo(first, true);
    else setIndex(target);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); go(first + perPage); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(first - perPage); }
    else if (event.key === "Home") { event.preventDefault(); go(0); }
    else if (event.key === "End") { event.preventDefault(); go(maxIndex); }
  }

  // Esc durante o arrasto cancela e devolve ao encaixe anterior.
  useEffect(() => {
    function cancel(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || !drag.current?.active) return;
      drag.current = null;
      suppressClick.current = true;
      slideTo(first, true);
    }
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [first, slideTo]);

  if (count === 0) return null;
  const last = Math.min(count, first + perPage);
  return (
    <div className="event-carousel" style={{ "--carousel-item": `${itemWidth}px`, "--carousel-gap": `${GAP_PX}px` } as React.CSSProperties}>
      <div className="event-carousel-controls">
        <span className="event-carousel-count" aria-live="polite">{count > perPage ? `${first + 1}–${last} de ${count}` : `${count} ${count === 1 ? "item" : "itens"}`}</span>
        {count > perPage && (
          <div className="event-carousel-arrows">
            <button type="button" className="event-carousel-arrow" aria-label="Itens anteriores" disabled={first === 0} onClick={() => go(first - perPage)}><ChevronLeft size={16} aria-hidden="true" /></button>
            <button type="button" className="event-carousel-arrow" aria-label="Próximos itens" disabled={first >= maxIndex} onClick={() => go(first + perPage)}><ChevronRight size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>
      <div ref={viewport} className="event-carousel-viewport" role="region" aria-roledescription="carrossel" aria-label={label} data-draggable={count > perPage || undefined}
        onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => endDrag(event, false)} onPointerCancel={(event) => endDrag(event, true)}
        onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
        <ul ref={track} className="event-carousel-track">
          {items.map((item, position) => {
            const visible = position >= first && position < first + perPage;
            return <li key={(item as { key?: string }).key ?? position} className="event-carousel-item" inert={!visible} aria-hidden={!visible || undefined}>{item}</li>;
          })}
        </ul>
      </div>
    </div>
  );
}
