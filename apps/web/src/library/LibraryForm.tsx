import { useRef, useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import Select from "../components/Select";
import DatePicker from "../components/DatePicker";
import { saveLibraryItem, type LibraryInput, type LibraryItem } from "../lib/library-api";
import { kindLabel, statuses } from "./labels";

export default function LibraryForm({ existing, onClose, onSaved }: { existing?: LibraryItem; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<LibraryInput["kind"]>(existing?.kind ?? "book");
  const [status, setStatus] = useState<LibraryInput["status"]>(existing?.status ?? "wanted");
  const [startedOn, setStartedOn] = useState(existing?.startedOn ?? "");
  const [finishedOn, setFinishedOn] = useState(existing?.finishedOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const creatorLabel = kind === "book" ? "Autor(a)" : kind === "film" ? "Diretor(a)" : "Artista";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    if (startedOn && finishedOn && startedOn > finishedOn) { setError("A data de fim deve ser igual ou posterior ao início."); queueMicrotask(() => errorRef.current?.focus()); return; }
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
    <form className="library-form" onSubmit={submit} autoComplete="off">
      <fieldset disabled={busy}>
        <div className="library-form-grid"><Select label="Tipo de obra" name="kind" value={kind} options={Object.entries(kindLabel).map(([value, label]) => ({ value: value as LibraryInput["kind"], label }))} onChange={setKind} /><Select label="Status" name="status" value={status} options={statuses} onChange={setStatus} /></div>
        <label>Título<input data-autofocus name="title" required maxLength={200} defaultValue={existing?.title} /></label>
        <label>{creatorLabel}<input name="creator" maxLength={200} defaultValue={existing?.creator} /></label>
        <div className="library-form-grid"><label>Ano<input name="year" type="number" inputMode="numeric" min={1} max={9999} step={1} defaultValue={existing?.year ?? ""} /></label><label>Nota de 0 a 5<input name="rating" type="number" inputMode="decimal" min={0} max={5} step="any" defaultValue={existing?.rating ?? ""} /></label></div>
        <div className="library-form-grid"><DatePicker label="Início (opcional)" name="startedOn" value={startedOn} onChange={setStartedOn} /><DatePicker label="Fim (opcional)" name="finishedOn" value={finishedOn} onChange={setFinishedOn} /></div>
        <label>Tags (separadas por vírgula)<input name="tags" maxLength={819} defaultValue={existing?.tags.join(", ")} /><small>Até 20 tags, com até 40 caracteres cada.</small></label>
        <label>Comentário<textarea name="comment" rows={3} maxLength={1000} defaultValue={existing?.comment} /></label>
        <label>Link externo<input name="externalUrl" type="url" maxLength={2048} pattern="https?://.*" defaultValue={existing?.externalUrl ?? ""} placeholder="https://exemplo.com/obra…" /></label>
        <label>URL da capa<input name="coverUrl" type="url" maxLength={2048} pattern="https?://.*" defaultValue={existing?.coverUrl ?? ""} placeholder="https://exemplo.com/capa.jpg…" /><small>A imagem será carregada desse endereço ao exibir a obra.</small></label>
      </fieldset>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="library-error">{error}</p>}
      <footer><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar obra"}</button></footer>
    </form>
  </Modal>;
}
