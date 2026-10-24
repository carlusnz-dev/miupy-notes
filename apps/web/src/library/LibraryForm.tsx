import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Modal from "../components/Modal";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import { saveLibraryItem, type LibraryInput, type LibraryItem } from "../lib/library-api";
import { kindLabel, statuses } from "./labels";
import Button from "../components/Button";
import { firstInvalid, validateLibraryForm, type LibraryField, type LibraryFormErrors } from "./form";

/** 20 tags de 40 caracteres unidas por ", " (como na edição): o campo nunca corta um conjunto que a API aceita. */
const TAGS_TEXT_MAX = 20 * 40 + 19 * ", ".length;

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return <div className="library-field"><label htmlFor={id}>{label}</label>{children}
    {hint && <small id={`${id}-hint`}>{hint}</small>}
    {error && <small id={`${id}-error`} className="library-field-error">{error}</small>}</div>;
}

export default function LibraryForm({ existing, onClose, onSaved }: { existing?: LibraryItem; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<LibraryInput["kind"]>(existing?.kind ?? "book");
  const [status, setStatus] = useState<LibraryInput["status"]>(existing?.status ?? "wanted");
  const [startedOn, setStartedOn] = useState(existing?.startedOn ?? "");
  const [finishedOn, setFinishedOn] = useState(existing?.finishedOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<LibraryFormErrors>({});
  const errorRef = useRef<HTMLParagraphElement>(null);
  const uid = useId();
  const clearError = (field: LibraryField) => setErrors(({ [field]: _, ...rest }) => rest);
  // Props de acessibilidade de cada campo: aria-invalid e aria-describedby (dica e erro).
  const control = (field: LibraryField, hint = false) => {
    const id = `${uid}-${field}`;
    return { id, name: field, "aria-invalid": errors[field] ? true : undefined,
      "aria-describedby": [hint && `${id}-hint`, errors[field] && `${id}-error`].filter(Boolean).join(" ") || undefined };
  };
  const creatorLabel = kind === "book" ? "Autor(a)" : kind === "film" ? "Diretor(a)" : "Artista";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const found = validateLibraryForm({ title: text("title"), creator: text("creator"), year: text("year"), rating: text("rating"), tags: text("tags"),
      comment: text("comment"), externalUrl: text("externalUrl"), coverUrl: text("coverUrl"), startedOn, finishedOn });
    setErrors(found);
    const first = firstInvalid(found);
    if (first) {
      setError("");
      const target = first === "dates" ? event.currentTarget.querySelector<HTMLElement>("[data-field='dates'] input") : event.currentTarget.elements.namedItem(first);
      (target as HTMLElement | null)?.focus();
      return;
    }
    setBusy(true); setError("");
    try {
      await saveLibraryItem({ kind, title: text("title"), creator: text("creator"), year: text("year") ? Number(text("year")) : null,
        status, rating: text("rating") ? Number(text("rating")) : null, tags: text("tags").split(",").map(tag => tag.trim()).filter(Boolean),
        startedOn: startedOn || null, finishedOn: finishedOn || null, comment: text("comment"), externalUrl: text("externalUrl") || null, coverUrl: text("coverUrl") || null }, existing);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar. Tente de novo."); queueMicrotask(() => errorRef.current?.focus()); }
    finally { setBusy(false); }
  }
  return <Modal open title={existing ? "Editar obra" : "Adicionar à biblioteca"} onClose={onClose} busy={busy} className="library-modal">
    <form className="library-form" onSubmit={submit} onInput={event => { const name = (event.target as HTMLInputElement).name as LibraryField; if (errors[name]) clearError(name); }} autoComplete="off" noValidate>
      <fieldset disabled={busy}>
        <div className="library-form-grid"><Select label="Tipo de obra" name="kind" value={kind} options={Object.entries(kindLabel).map(([value, label]) => ({ value: value as LibraryInput["kind"], label }))} onChange={setKind} /><Select label="Status" name="status" value={status} options={statuses} onChange={setStatus} /></div>
        <Field id={`${uid}-title`} label="Título" error={errors.title}><input data-autofocus maxLength={200} defaultValue={existing?.title} {...control("title")} /></Field>
        <Field id={`${uid}-creator`} label={creatorLabel} error={errors.creator}><input maxLength={200} defaultValue={existing?.creator} {...control("creator")} /></Field>
        <div className="library-form-grid">
          <Field id={`${uid}-year`} label="Ano" error={errors.year}><input type="number" inputMode="numeric" min={1} max={9999} step={1} defaultValue={existing?.year ?? ""} {...control("year")} /></Field>
          <Field id={`${uid}-rating`} label="Nota de 0 a 5" error={errors.rating}><input type="number" inputMode="decimal" min={0} max={5} step="any" defaultValue={existing?.rating ?? ""} {...control("rating")} /></Field>
        </div>
        <div data-field="dates" className="library-field">
          <div className="library-form-grid"><DatePicker label="Início (opcional)" name="startedOn" value={startedOn} onChange={value => { setStartedOn(value); clearError("dates"); }} /><DatePicker label="Fim (opcional)" name="finishedOn" value={finishedOn} onChange={value => { setFinishedOn(value); clearError("dates"); }} /></div>
          {errors.dates && <small className="library-field-error" role="alert">{errors.dates}</small>}
        </div>
        <Field id={`${uid}-tags`} label="Tags (separadas por vírgula)" hint="Até 20 tags, com até 40 caracteres cada." error={errors.tags}><input maxLength={TAGS_TEXT_MAX} defaultValue={existing?.tags.join(", ")} {...control("tags", true)} /></Field>
        <Field id={`${uid}-comment`} label="Comentário" error={errors.comment}><textarea rows={3} maxLength={1000} defaultValue={existing?.comment} {...control("comment")} /></Field>
        <Field id={`${uid}-externalUrl`} label="Link externo" error={errors.externalUrl}><input type="url" maxLength={2048} defaultValue={existing?.externalUrl ?? ""} placeholder="https://exemplo.com/obra…" {...control("externalUrl")} /></Field>
        <Field id={`${uid}-coverUrl`} label="URL da capa" hint="A imagem será carregada desse endereço ao exibir a obra." error={errors.coverUrl}><input type="url" maxLength={2048} defaultValue={existing?.coverUrl ?? ""} placeholder="https://exemplo.com/capa.jpg…" {...control("coverUrl", true)} /></Field>
      </fieldset>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="library-error">{error}</p>}
      <footer><Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar obra"}</Button></footer>
    </form>
  </Modal>;
}
