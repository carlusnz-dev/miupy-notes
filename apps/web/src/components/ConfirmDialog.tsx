import { useRef, type ReactNode } from "react";
import Modal from "./Modal";
import Button from "./Button";

/**
 * Confirmação de ação destrutiva sobre o Modal compartilhado (foco preso, Esc, retorno de foco, GSAP).
 * A ação de confirmar usa a variante danger. O foco inicial fica em "cancelar": Enter por engano não apaga nada.
 */
export default function ConfirmDialog({ open, title, children, confirmLabel, busyLabel, cancelLabel = "Cancelar", busy = false, error, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Texto do botão enquanto a ação roda (ex.: "Excluindo…"). */
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Modal open={open} title={title} onClose={onCancel} busy={busy} initialFocusRef={cancel} className="confirm-dialog">
      {children}
      {error && <p className="confirm-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button ref={cancel} type="button" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
        <Button variant="danger" type="button" onClick={onConfirm} disabled={busy}>{busy && busyLabel ? busyLabel : confirmLabel}</Button>
      </div>
    </Modal>
  );
}
