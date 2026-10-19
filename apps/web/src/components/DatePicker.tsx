import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import gsap from "gsap";
import { addDays, addMonths, compare, daysInMonth, fromDisplay, fromIso, maskDisplay, monthNames, toDisplay, toIso, todayLocal, weekday, weekdayNames, type CalendarDate } from "../lib/calendar-date";
import Select from "./Select";
import "./date-picker.css";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1);
const monthOptions = monthNames.map((name, index) => ({ value: String(index + 1), label: capitalize(name) }));

/** Data de calendário: exibe dd/mm/aaaa, entrega AAAA-MM-DD ("" enquanto vazia/incompleta/inválida). */
export default function DatePicker({ label, value, onChange, required = false, disabled = false, name }: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  const popoverId = `${id}-calendar`;
  const wrapper = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => { const date = fromIso(value); return date ? toDisplay(date) : ""; });
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties>({ top: 0, left: 0 });
  const [cursor, setCursor] = useState<CalendarDate>(() => fromIso(value) ?? todayLocal());
  const focusDay = useRef(false);
  const selected = fromDisplay(text);
  const today = todayLocal();
  const invalid = text.length === 10 && !selected;

  // Valor trocado pelo pai: o texto acompanha, a menos que já represente essa mesma data.
  if ((fromIso(value) ? value : "") !== (selected ? toIso(selected) : "")) {
    const date = fromIso(value);
    setText(date ? toDisplay(date) : "");
    if (date) setCursor(date);
  }
  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    input.current?.setCustomValidity(text && !selected ? "Informe uma data válida (dd/mm/aaaa)." : "");
  }, [text, selected]);

  // O popover é `position: fixed` (não é cortado pelo overflow do painel do modal) e escolhe o lado com mais espaço.
  useLayoutEffect(() => {
    if (!mounted) return;
    function place() {
      const field = wrapper.current?.querySelector(".date-control")?.getBoundingClientRect();
      const element = popover.current;
      if (!field || !element) return;
      const width = Math.min(304, window.innerWidth - 16);
      const left = Math.min(Math.max(8, field.right - width), window.innerWidth - width - 8);
      const below = window.innerHeight - field.bottom - 14;
      const above = field.top - 14;
      const natural = element.scrollHeight;
      const useBelow = natural <= below || below >= above;
      const maxHeight = Math.max(160, useBelow ? below : above);
      const height = Math.min(natural, maxHeight);
      setPlacement({ left, width, maxHeight, top: useBelow ? field.bottom + 6 : field.top - 6 - height });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [mounted, cursor.year, cursor.month]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) input.current?.focus();
  }, []);

  function commit(date: CalendarDate | null, display: string) {
    setText(display);
    onChange(date ? toIso(date) : "");
    if (date) setCursor(date);
  }
  function openCalendar() {
    if (disabled) return;
    setCursor(selected ?? today);
    focusDay.current = true;
    setOpen(true);
  }

  // Entrada e saída do popover (GSAP); movimento reduzido: instantâneo.
  useEffect(() => {
    const element = popover.current;
    if (!mounted || !element) return;
    if (open) {
      if (reducedMotion()) return;
      const context = gsap.context(() => { gsap.fromTo(element, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: .18, ease: "power2.out", clearProps: "opacity,transform" }); }, element);
      return () => context.revert();
    }
    if (reducedMotion()) { setMounted(false); return; }
    const context = gsap.context(() => { gsap.to(element, { opacity: 0, y: -4, duration: .12, ease: "power1.in", onComplete: () => setMounted(false) }); }, element);
    return () => context.revert();
  }, [open, mounted]);

  // Foco no dia do cursor ao abrir e a cada movimento por teclado.
  useLayoutEffect(() => {
    if (!open || !focusDay.current) return;
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
    focusDay.current = false;
  });

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, close]);

  function moveCursor(next: CalendarDate) { focusDay.current = true; setCursor(next); }
  function gridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, () => CalendarDate> = {
      ArrowLeft: () => addDays(cursor, -1), ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7), ArrowDown: () => addDays(cursor, 7),
      Home: () => addDays(cursor, -weekday(cursor)), End: () => addDays(cursor, 6 - weekday(cursor)),
      PageUp: () => addMonths(cursor, event.shiftKey ? -12 : -1), PageDown: () => addMonths(cursor, event.shiftKey ? 12 : 1),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    moveCursor(step());
  }
  function wrapperKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Esc fecha só o calendário: sem isso o <dialog> do modal também fecharia.
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }

  const leading = weekday({ ...cursor, day: 1 });
  const days = Array.from({ length: daysInMonth(cursor.year, cursor.month) }, (_, index) => index + 1);
  const cells: (number | null)[] = [...Array(leading).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  const yearOptions = Array.from({ length: 101 }, (_, index) => String(Math.max(1, cursor.year - 60) + index)).map((year) => ({ value: year, label: year }));

  return (
    <div className="date-picker" ref={wrapper} onKeyDown={wrapperKeyDown}>
      <label htmlFor={id}>{label}</label>
      <div className="date-control" data-invalid={invalid ? "true" : undefined}>
        <input
          ref={input} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" maxLength={10}
          value={text} required={required} disabled={disabled} aria-invalid={invalid ? true : undefined}
          onChange={(event) => { const masked = maskDisplay(event.target.value); const date = fromDisplay(masked); commit(date, masked); }}
        />
        {name && <input type="hidden" name={name} value={selected ? toIso(selected) : ""} />}
        <button ref={toggle} type="button" className="date-toggle" disabled={disabled} aria-label={`Abrir calendário de ${label.toLowerCase()}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={mounted ? popoverId : undefined} onClick={() => (open ? close(true) : openCalendar())}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 6.5h12M5.5 1.8v2.6M10.5 1.8v2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
      </div>
      {invalid && <p className="date-error" role="alert">Informe uma data válida (dd/mm/aaaa).</p>}
      {mounted && (
        <div ref={popover} id={popoverId} className="date-popover" style={placement} role="dialog" aria-label={`Escolher ${label.toLowerCase()}`}>
          <div className="date-header">
            <button type="button" className="date-nav" aria-label="Mês anterior" onClick={() => setCursor(addMonths(cursor, -1))}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            <Select label="Mês" hideLabel value={String(cursor.month)} options={monthOptions} onChange={(month) => setCursor(addMonths({ ...cursor, day: 1 }, Number(month) - cursor.month))} />
            <Select label="Ano" hideLabel value={String(cursor.year)} options={yearOptions} onChange={(year) => setCursor(addMonths({ ...cursor, day: 1 }, (Number(year) - cursor.year) * 12))} />
            <button type="button" className="date-nav" aria-label="Próximo mês" onClick={() => setCursor(addMonths(cursor, 1))}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6 4.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          </div>
          <div ref={grid} role="grid" aria-label={`${capitalize(monthNames[cursor.month - 1])} de ${cursor.year}`} onKeyDown={gridKeyDown}>
            <div role="row" className="date-row">{weekdayNames.map((weekdayName) => <span key={weekdayName} role="columnheader" aria-label={weekdayName} className="date-weekday">{weekdayName.slice(0, 3)}</span>)}</div>
            {rows.map((row, index) => (
              <div role="row" className="date-row" key={index}>
                {row.map((day, column) => {
                  if (!day) return <span role="gridcell" key={column} />;
                  const date = { ...cursor, day };
                  const isSelected = !!selected && compare(date, selected) === 0;
                  return (
                    <span role="gridcell" key={column} aria-selected={isSelected}>
                      <button type="button" className="date-day" tabIndex={day === cursor.day ? 0 : -1} aria-current={compare(date, today) === 0 ? "date" : undefined} aria-label={`${day} de ${monthNames[cursor.month - 1]} de ${cursor.year}`} data-selected={isSelected || undefined}
                        onClick={() => { commit(date, toDisplay(date)); close(true); }}>{day}</button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="date-footer"><button type="button" className="date-today" onClick={() => { commit(today, toDisplay(today)); close(true); }}>Hoje</button></div>
        </div>
      )}
    </div>
  );
}
