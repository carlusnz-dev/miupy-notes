import type { ReactNode } from "react";
import Modal from "./Modal";

export default function ConfirmDialog({ title, children, confirmLabel, busy, error, onClose, onConfirm }: {
  title: string; children: ReactNode; confirmLabel: string; busy: boolean; error?: string;
  onClose: () => void; onConfirm: () => void;
}) {
  return <Modal open title={title} onClose={onClose} busy={busy}>
    {children}
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="button button-secondary" data-autofocus onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="button button-secondary" onClick={onConfirm} disabled={busy}>{busy ? "Excluindo…" : confirmLabel}</button></div>
  </Modal>;
}
