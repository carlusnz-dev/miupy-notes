import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { NavLink } from "react-router-dom";
import { BookOpen, CalendarDays, CircleDollarSign, House, NotebookPen, PanelLeftClose, PanelLeftOpen, Settings, UserRound } from "lucide-react";
import "./sidebar.css";

const minWidth = 200;
const maxWidth = 380;
const links = [
  { path: "/", label: "Visão geral", icon: House },
  { path: "/notes", label: "Notas", icon: NotebookPen },
  { path: "/events", label: "Agenda", icon: CalendarDays },
  { path: "/finance", label: "Finanças", icon: CircleDollarSign },
  { path: "/library", label: "Biblioteca", icon: BookOpen },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(228);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const resize = (value: number) => setWidth(Math.min(maxWidth, Math.max(minWidth, value)));

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowLeft") resize(width - step);
    else if (event.key === "ArrowRight") resize(width + step);
    else if (event.key === "Home") resize(minWidth);
    else if (event.key === "End") resize(maxWidth);
    else return;
    event.preventDefault();
  }

  return (
    <aside className={`sidebar shell-sidebar${collapsed ? " is-collapsed" : ""}`} style={{ "--sidebar-width": `${width}px` } as CSSProperties}>
      <div className="sidebar-heading">
        <NavLink className="brand" to="/" aria-label="miupy notes, início">
          <img src="/mark.svg" alt="" width="34" height="34" />
          <span className="sidebar-label">miupy<span className="brand-light"> / notes</span></span>
        </NavLink>
        <button type="button" className="sidebar-toggle" aria-label={collapsed ? "Expandir menu" : "Recolher menu"} aria-expanded={!collapsed} aria-controls="sidebar-navigation" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <div className="nav-caption sidebar-label">ESPAÇOS</div>
      <nav id="sidebar-navigation" aria-label="Navegação principal">
        {links.map(({ path, label, icon: Icon }) => (
          <NavLink key={path} to={path} end={path === "/"} aria-label={label} title={collapsed ? label : undefined}>
            <Icon size={18} aria-hidden="true" /><span className="sidebar-label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <NavLink to="/profile" aria-label="Perfil" title={collapsed ? "Perfil" : undefined}><UserRound size={18} aria-hidden="true" /><span className="sidebar-label">Perfil</span></NavLink>
        <NavLink to="/settings" aria-label="Configurações" title={collapsed ? "Configurações" : undefined}><Settings size={18} aria-hidden="true" /><span className="sidebar-label">Configurações</span></NavLink>
      </div>
      <div role="separator" className="sidebar-resize" tabIndex={0} aria-label="Largura do menu" aria-orientation="vertical" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={`${width} pixels`} onKeyDown={resizeWithKeyboard} onPointerDown={startResize} onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId) resize(start.width + event.clientX - start.x);
      }} onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
      }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
    </aside>
  );
}
