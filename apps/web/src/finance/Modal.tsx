import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="finance-modal" aria-labelledby="finance-modal-title" aria-busy={busy} onCancel={event => { event.preventDefault(); if (!busy) close.current(); }}>
    <header><h2 id="finance-modal-title">{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar janela">×</button></header>
    {children}
  </dialog>;
}
