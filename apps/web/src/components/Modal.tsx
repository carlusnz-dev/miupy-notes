import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import gsap from "gsap";
import "./modal.css";

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Operação em andamento: Esc, backdrop e botão de fechar ficam bloqueados. */
  busy?: boolean;
  /** Elemento que recebe o foco ao abrir; padrão: `[data-autofocus]`, depois o primeiro controle do conteúdo. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Classe extra no <dialog>, para ajustes de largura de quem consome. */
  className?: string;
};

const focusable = "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// <dialog> nativo com showModal(): isola o fundo (inert), prende o Tab e trata Esc.
// GSAP só anima a entrada/saída; com movimento reduzido tudo é instantâneo.
export default function Modal({ open, title, onClose, children, busy = false, initialFocusRef, className }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(open);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const initialFocus = useRef(initialFocusRef);
  initialFocus.current = initialFocusRef;
  const opener = useRef<HTMLElement | null>(null);

  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !mounted || !dialog) return;
    if (!dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    }
    const target = initialFocus.current?.current
      ?? dialog.querySelector<HTMLElement>("[data-autofocus]")
      ?? dialog.querySelector<HTMLElement>(`.modal-body :is(${focusable}):not(:disabled)`);
    (target ?? dialog.querySelector<HTMLElement>(".modal-close") ?? dialog).focus();
    if (reducedMotion()) return;
    const context = gsap.context(() => {
      gsap.fromTo(dialog, { opacity: 0, y: 16, "--modal-fade": 0 }, { opacity: 1, y: 0, "--modal-fade": 1, duration: .28, ease: "power2.out", clearProps: "transform,opacity,--modal-fade" });
    }, dialog);
    return () => context.revert();
  }, [open, mounted]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open || !mounted || !dialog) return;
    const finish = () => {
      if (dialog.open) dialog.close();
      setMounted(false);
      if (opener.current?.isConnected) opener.current.focus();
      opener.current = null;
    };
    if (reducedMotion()) { finish(); return; }
    const context = gsap.context(() => {
      gsap.to(dialog, { opacity: 0, y: 10, "--modal-fade": 0, duration: .18, ease: "power1.in", onComplete: finish });
    }, dialog);
    return () => context.revert();
  }, [open, mounted]);

  // Desmontagem direta (ex.: `{show && <Modal open …/>}`): fecha o dialog e devolve o foco sem animar.
  useEffect(() => () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    if (opener.current?.isConnected) opener.current.focus();
  }, []);

  if (!mounted) return null;
  return (
    <dialog
      ref={dialogRef}
      className={className ? `modal ${className}` : "modal"}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busyRef.current) onCloseRef.current(); }}
      // Navegadores diferem em para onde o Tab vai ao sair do <dialog> (barra do navegador, <body>): o ciclo é feito aqui.
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>(focusable)].filter((item) => !item.matches(":disabled") && item.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      // O padding fica no painel interno, então um clique direto no <dialog> é um clique no backdrop.
      onClick={(event) => { if (event.target === event.currentTarget && !busyRef.current) onCloseRef.current(); }}
    >
      <div className="modal-panel">
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Fechar janela">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </dialog>
  );
}
