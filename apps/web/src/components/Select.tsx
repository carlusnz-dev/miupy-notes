import { useId } from "react";
import "./select.css";

type Option<T extends string> = { value: T; label: string };

// Wrapper de <select> nativo: teclado, leitor de tela e lista no celular vêm do navegador;
// o CSS só remove a aparência do sistema (que ignorava cores no WebKitGTK/Tauri).
export default function Select<T extends string>({ label, value, options, onChange, disabled = false, hideLabel = false, name }: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Mantém o rótulo para leitores de tela, sem exibi-lo (ex.: selects de mês/ano no calendário). */
  hideLabel?: boolean;
  name?: string;
}) {
  const id = useId();
  return (
    <div className="select-field">
      <label htmlFor={id} className={hideLabel ? "visually-hidden" : undefined}>{label}</label>
      <div className="select-control">
        <select id={id} name={name} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <svg className="select-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    </div>
  );
}
