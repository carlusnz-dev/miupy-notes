import { useState, type FormEvent } from "react";
import Button from "../components/Button";
import Modal from "../components/Modal";
import Select from "../components/Select";
import { statuses } from "./labels";

/** Filtros de status e tag no mobile: folha inferior sobre o Modal compartilhado. */
export default function LibraryFilterSheet({ status: initialStatus, tag: initialTag, onApply, onClose }: {
  status: string;
  tag: string;
  onApply: (values: { status: string; tag: string }) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [tag, setTag] = useState(initialTag);
  function submit(event: FormEvent) { event.preventDefault(); onApply({ status, tag: tag.trim() }); }
  return <Modal open title="Filtros" onClose={onClose} className="library-sheet">
    <form className="library-form library-filter-form" onSubmit={submit} autoComplete="off">
      <Select label="Status" value={status} options={[{ value: "", label: "Todos os status" }, ...statuses]} onChange={setStatus} />
      <label>Tag<input name="tag" maxLength={40} value={tag} onChange={event => setTag(event.target.value)} placeholder="Ex.: favoritos…" enterKeyHint="done" /></label>
      <footer>
        <Button size="lg" onClick={() => onApply({ status: "", tag: "" })}>Limpar</Button>
        <Button size="lg" variant="primary" type="submit">Aplicar</Button>
      </footer>
    </form>
  </Modal>;
}
