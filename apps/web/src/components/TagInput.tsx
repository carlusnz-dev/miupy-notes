import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { mergeTags, splitDraft, TAG_SEPARATOR } from "../lib/notes-tags";
import Badge from "./Badge";
import "./badge.css";

type TagInputProps = {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Limites iguais aos do contrato da API (20 tags de até 40 caracteres). */
  maxTags?: number;
  maxLength?: number;
  label?: string;
};

/**
 * Espaço, vírgula ou Enter confirmam o rascunho como tag. Sair do campo (blur) descarta o que não foi
 * confirmado: nada é salvo sem o usuário pedir.
 */
export default function TagInput({ value, onChange, maxTags = 20, maxLength = 40, label = "Tags" }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const full = value.length >= maxTags;

  function commit(tokens: string[]) {
    const { next, added, skipped } = mergeTags(value, tokens, maxTags, maxLength);
    if (added.length) {
      onChange(next);
      setMessage(`Tag ${added.join(", ")} adicionada.`);
    } else if (skipped.length) {
      setMessage(next.length >= maxTags ? `Limite de ${maxTags} tags atingido.` : `Tag ${skipped[0]} já existe.`);
    }
  }

  function change(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    // Durante a composição (IME) o espaço faz parte da palavra em construção.
    if ((event.nativeEvent as InputEvent).isComposing || !TAG_SEPARATOR.test(text)) return setDraft(text);
    const { complete, rest } = splitDraft(text);
    commit(complete);
    setDraft(rest);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (draft.trim()) commit([draft]);
      setDraft("");
    } else if (event.key === "Backspace" && !draft && value.length) {
      setMessage(`Tag ${value[value.length - 1]} removida.`);
      onChange(value.slice(0, -1));
    } else if (event.key === "Escape" && draft) {
      event.stopPropagation();
      setDraft("");
    }
  }

  return (
    <div className="tag-input" role="group" aria-label={label} onClick={(event) => { if (event.target === event.currentTarget) inputRef.current?.focus(); }}>
      <span className="tag-input-label" aria-hidden="true">{label}</span>
      <div className="tag-input-control">
      {value.map((tag) => (
        <Badge key={tag} animate onRemove={() => { setMessage(`Tag ${tag} removida.`); onChange(value.filter((item) => item !== tag)); }}>{tag}</Badge>
      ))}
      <input
        ref={inputRef}
        className="tag-input-field"
        aria-label="Adicionar tag"
        aria-describedby={hintId}
        value={draft}
        maxLength={maxLength}
        placeholder={full ? `Limite de ${maxTags} tags` : "Adicionar tag…"}
        autoComplete="off"
        onChange={change}
        onKeyDown={keyDown}
        onBlur={() => setDraft("")}
      />
      </div>
      <span id={hintId} className="visually-hidden">Digite e pressione espaço ou Enter para confirmar. Ao sair do campo, o rascunho é descartado.</span>
      <span className="visually-hidden" role="status" aria-live="polite">{message}</span>
    </div>
  );
}
