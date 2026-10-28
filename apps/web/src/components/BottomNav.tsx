import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { NavLink, useLocation } from "react-router-dom";
import { BookOpen, CalendarDays, Repeat, CircleDollarSign, Ellipsis, House, NotebookPen, PlugZap, Settings, UserRound } from "lucide-react";
import Modal from "./Modal";
import { useKeyboardOpen } from "./keyboard-open";
import "./bottom-nav.css";

const primary = [
  { path: "/", label: "Início", icon: House },
  { path: "/notes", label: "Notas", icon: NotebookPen },
  { path: "/agendas", label: "Agenda", icon: CalendarDays },
  { path: "/library", label: "Biblioteca", icon: BookOpen },
];
const more = [
  { path: "/habits", label: "Hábitos", icon: Repeat },
  { path: "/finance", label: "Finanças", icon: CircleDollarSign },
  { path: "/mcp", label: "MCP", icon: PlugZap },
  { path: "/profile", label: "Perfil", icon: UserRound },
  { path: "/settings", label: "Configurações", icon: Settings },
];

/** Barra inferior do celular (≤ 760 px); no desktop a Sidebar assume e esta fica oculta por CSS. */
export default function BottomNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const items = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const place = useRef<(() => void) | null>(null);
  const inMore = more.some(({ path }) => pathname === path || pathname.startsWith(`${path}/`));

  useLayoutEffect(() => {
    const element = items.current;
    const bar = indicator.current;
    if (!element || !bar) return;
    const media = gsap.matchMedia();
    media.add({ reduced: "(prefers-reduced-motion: reduce)", motion: "(prefers-reduced-motion: no-preference)" }, (context) => {
      const move = () => {
        const active = element.querySelector<HTMLElement>("[aria-current='page'], [data-active]");
        // Em rotas fora da barra (404) o indicador some; display:none deixa o tamanho em 0 até a barra reaparecer.
        if (!active || !element.offsetWidth) { gsap.set(bar, { opacity: 0 }); placed.current = false; return; }
        gsap.to(bar, {
          x: active.offsetLeft, width: active.offsetWidth, opacity: 1,
          duration: !placed.current || context.conditions?.reduced ? 0 : .4,
          ease: "power3.out", overwrite: true,
        });
        placed.current = true;
      };
      place.current = move;
      move();
      const observer = new ResizeObserver(move);
      observer.observe(element);
      return () => { place.current = null; observer.disconnect(); };
    });
    return () => { media.revert(); gsap.killTweensOf(bar); };
  }, []);

  useLayoutEffect(() => { place.current?.(); }, [pathname]);

  return (
    <>
      <nav className="bottom-nav" aria-label="Navegação principal" data-keyboard={keyboardOpen ? "open" : undefined}>
        <div className="bottom-nav-items" ref={items}>
          <span className="bottom-nav-indicator" ref={indicator} aria-hidden="true" />
          {primary.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === "/"}>
              <Icon size={20} aria-hidden="true" /><span>{label}</span>
            </NavLink>
          ))}
          <button type="button" aria-haspopup="dialog" data-active={inMore || undefined} onClick={() => setMoreOpen(true)}>
            <Ellipsis size={20} aria-hidden="true" /><span>Mais</span>
          </button>
        </div>
      </nav>
      <Modal open={moreOpen} title="Mais espaços" onClose={() => setMoreOpen(false)} className="bottom-nav-more">
        <nav aria-label="Outros espaços">
          {more.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} onClick={() => setMoreOpen(false)}>
              <Icon size={20} aria-hidden="true" /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </Modal>
    </>
  );
}
