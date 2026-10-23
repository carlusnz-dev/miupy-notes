import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAnchoredPosition, useDismiss, useListNavigation, usePresence } from "./popover";
import "./select.css";
import "./time-field.css";

const STEP_MINUTES = 15;
const slots = Array.from({ length: 24 * 60 / STEP_MINUTES }, (_, index) => {
  const minutes = index * STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
const listKeys = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp"]);

function mask(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** Hora local hh:mm (24 h): digitação com máscara ou lista de 15 em 15 minutos. Substitui o input nativo `type="time"`. */
export default function TimeField({ label, value, onChange, required = false, disabled = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const field = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const mounted = usePresence(open, list);
  const style = useAnchoredPosition(mounted, control, list, "anchor");
  const { active, setActive, navigate } = useListNavigation(slots);
  const valid = validTime.test(value);
  const invalid = value.length === 5 && !valid;

  useLayoutEffect(() => { input.current?.setCustomValidity(value && !valid ? "Informe um horário válido (hh:mm)." : ""); }, [value, valid]);
  useLayoutEffect(() => {
    if (open && active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, mounted, style.maxHeight]);
  useDismiss(open, field, () => setOpen(false));

  function show() {
    if (disabled) return;
    const [hour, minute] = valid ? value.split(":").map(Number) : [9, 0];
    setActive(Math.min(slots.length - 1, Math.round((hour * 60 + minute) / STEP_MINUTES)));
    setOpen(true);
  }
  function pick(index: number) {
    if (slots[index]) onChange(slots[index]);
    setOpen(false);
    input.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === "Enter") { event.preventDefault(); pick(active); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (listKeys.has(event.key)) navigate(event);
  }

  return (
    <div className="time-field" ref={field}>
      <label htmlFor={id}>{label}</label>
      <div ref={control} className="time-control" data-invalid={invalid || undefined}>
        <input
          ref={input} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="hh:mm" maxLength={5}
          value={value} required={required} disabled={disabled} aria-invalid={invalid || undefined}
          role="combobox" aria-autocomplete="none" aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${id}-slot-${active}` : undefined}
          onChange={(event) => onChange(mask(event.target.value))} onKeyDown={keyDown}
        />
        <button type="button" className="time-toggle" tabIndex={-1} disabled={disabled} aria-label={`Escolher ${label.toLowerCase()}`} onClick={() => (open ? setOpen(false) : show())}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {mounted && (
        <ul ref={list} id={listId} className="select-list time-list" role="listbox" aria-label={label} style={style} onPointerDown={(event) => event.preventDefault()}>
          {slots.map((slot, index) => (
            <li key={slot} id={`${id}-slot-${index}`} data-index={index} role="option" className="select-option" aria-selected={slot === value} data-active={index === active || undefined}
              onPointerMove={() => { if (index !== active) setActive(index); }} onClick={() => pick(index)}>{slot}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
