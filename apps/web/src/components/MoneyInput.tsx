import { useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { completeDraft, currencyPrefix, draftFromCents, draftToCents, formatDraft, parsePasted, parseTyped, type MoneyDraft } from "../finance/money";
import "./money-input.css";

// Quantidade de caracteres "significativos" (dígitos e vírgula) antes da posição: o caret é recolocado
// pelo mesmo número depois de reformatar, mesmo que os pontos de milhar mudem.
const significant = (text: string, end: number) => text.slice(0, end).replace(/[^\d,]/g, "").length;
function caretAt(text: string, count: number) {
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (seen === count) return index;
    if (/[\d,]/.test(text[index])) seen += 1;
  }
  return text.length;
}

/** Valor monetário em centavos inteiros (nunca float). `value` null = vazio. */
export default function MoneyInput({ label, value, currency, onChange, required = false, disabled = false, name }: {
  label: string;
  value: number | null;
  currency: string;
  onChange: (cents: number | null) => void;
  required?: boolean;
  disabled?: boolean;
  name?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<MoneyDraft>(() => draftFromCents(value));
  const [error, setError] = useState("");
  const caret = useRef<number | null>(null);
  const keypadDot = useRef(false);
  const text = formatDraft(draft);
  const cents = draftToCents(draft);

  // Valor trocado pelo pai (ex.: abrir outro lançamento): o rascunho acompanha, sem reescrever o que o usuário digita.
  if (value !== cents) { setDraft(draftFromCents(value)); setError(""); }

  useLayoutEffect(() => {
    if (caret.current !== null && input.current) input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  useLayoutEffect(() => {
    input.current?.setCustomValidity(cents === 0 ? "Informe um valor maior que zero." : "");
  }, [cents]);

  function apply(next: MoneyDraft, caretCount?: number) {
    const nextText = formatDraft(next);
    caret.current = caretCount === undefined ? null : caretAt(nextText, caretCount);
    setDraft(next); setError("");
    onChange(draftToCents(next));
  }
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const result = parseTyped(raw, keypadDot.current);
    keypadDot.current = false;
    if (!result.draft) {
      // Mantém o valor anterior e o caret onde estava, em vez de descartar o caractere em silêncio.
      caret.current = Math.max(0, (event.target.selectionStart ?? 1) - 1);
      setError(result.error);
      return;
    }
    apply(result.draft, significant(raw, event.target.selectionStart ?? raw.length));
  }
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const result = parsePasted(event.clipboardData.getData("text"));
    if (!result.draft) { setError(result.error); return; }
    apply(result.draft, formatDraft(result.draft).replace(/\./g, "").length);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    keypadDot.current = event.key === ".";
    const { selectionStart, selectionEnd, value: shown } = event.currentTarget;
    if (selectionStart !== selectionEnd || selectionStart === null) return;
    // Os pontos de milhar são reinseridos pela formatação: Backspace/Delete ao lado de um ponto apaga o dígito vizinho.
    const dot = event.key === "Backspace" ? selectionStart - 1 : event.key === "Delete" ? selectionStart : -1;
    if (dot < 0 || shown[dot] !== ".") return;
    event.preventDefault();
    const digit = event.key === "Backspace" ? dot - 1 : dot + 1;
    const result = parseTyped(shown.slice(0, digit) + shown.slice(digit + 1));
    if (result.draft) apply(result.draft, significant(shown, digit));
  }
  function handleBlur() {
    const complete = completeDraft(draft);
    if (formatDraft(complete) !== text) apply(complete);
    setError("");
  }

  return (
    <div className="money-field">
      <label htmlFor={id}>{label}</label>
      <div className="money-control" data-invalid={error ? "true" : undefined}>
        <span className="money-prefix" aria-hidden="true">{currencyPrefix(currency)}</span>
        <input
          ref={input} id={id} name={name} type="text" inputMode="decimal" autoComplete="off" placeholder="0,00"
          value={text} required={required} disabled={disabled}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          onChange={handleChange} onPaste={handlePaste} onKeyDown={handleKeyDown} onBlur={handleBlur}
        />
      </div>
      {error && <p id={errorId} className="money-error" role="alert">{error}</p>}
    </div>
  );
}
