import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAnchoredPosition, useDismiss, useListNavigation, usePresence } from "./popover";
import "./select.css";

type Option<T extends string> = { value: T; label: string };

// Combobox só de seleção (padrão WAI-ARIA APG "select-only combobox"): o foco fica no campo e a opção
// ativa é anunciada por aria-activedescendant. Substitui o <select> nativo, cuja lista o WebKitGTK/Tauri
// desenhava com cores do sistema. A lista abre em popover `fixed` com entrada GSAP.
export default function Select<T extends string>({ label, value, options, onChange, disabled = false, hideLabel = false, name, autoFocus = false, defaultOpen = false, onDismiss }: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Mantém o rótulo para leitores de tela, sem exibi-lo (ex.: selects de mês/ano no calendário). */
  hideLabel?: boolean;
  /** Gera um <input type="hidden"> para formulários lidos por FormData. */
  name?: string;
  autoFocus?: boolean;
  defaultOpen?: boolean;
  /** Lista fechada sem escolha (Esc, toque fora ou saída do campo). */
  onDismiss?: () => void;
}) {
  const id = useId();
  const labelId = `${id}-label`, listId = `${id}-list`;
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(defaultOpen && !disabled);
  const mounted = usePresence(open, list);
  const labels = useMemo(() => options.map((option) => option.label), [options]);
  const { active, setActive, navigate } = useListNavigation(labels);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const style = useAnchoredPosition(mounted, trigger, list, "anchor", [options.length]);

  useEffect(() => { if (autoFocus) trigger.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (defaultOpen) setActive(Math.max(0, selectedIndex)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (open && active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, mounted, style.maxHeight]);

  function show() { if (disabled) return; setActive(Math.max(0, selectedIndex)); setOpen(true); }
  function dismiss() { if (!open) return; setOpen(false); onDismiss?.(); }
  function pick(index: number) {
    const option = options[index];
    setOpen(false);
    if (option && option.value !== value) onChange(option.value);
    else onDismiss?.();
  }
  useDismiss(open, field, dismiss);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); show(); return; }
      if (event.key === "Home" || event.key === "End" || event.key.length === 1) { if (navigate(event)) setOpen(true); }
      return;
    }
    // Esc fecha só a lista: sem isso o <dialog> do modal (ou o calendário do DatePicker) também fecharia.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(active); return; }
    if (event.key === "Tab") { pick(active); return; }
    navigate(event);
  }

  return (
    <div className="select-field" ref={field}>
      <label id={labelId} className={hideLabel ? "visually-hidden" : undefined} onClick={() => trigger.current?.focus()}>{label}</label>
      <div
        ref={trigger} className="select-trigger" role="combobox" tabIndex={disabled ? -1 : 0}
        aria-labelledby={labelId} aria-controls={listId} aria-expanded={open} aria-haspopup="listbox" aria-disabled={disabled || undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
        onClick={() => (open ? dismiss() : show())} onKeyDown={keyDown}
      >
        <span className="select-value">{options[selectedIndex]?.label ?? ""}</span>
        <svg className="select-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      {name && <input type="hidden" name={name} value={value} />}
      {mounted && (
        // pointerdown sem default: o foco continua no campo enquanto a opção é escolhida com o mouse.
        <ul ref={list} id={listId} className="select-list" role="listbox" aria-labelledby={labelId} style={style} onPointerDown={(event) => event.preventDefault()}>
          {options.map((option, index) => (
            <li key={option.value} id={`${id}-option-${index}`} data-index={index} role="option" className="select-option" aria-selected={index === selectedIndex} data-active={index === active || undefined}
              onPointerMove={() => { if (index !== active) setActive(index); }} onClick={() => pick(index)}>
              <span>{option.label}</span>
              {index === selectedIndex && <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
