import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
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
// Mesmo ponto de quebra de modal.css: abaixo dele o diálogo é um bottom sheet e entra/sai deslizando.
const sheet = () => window.matchMedia("(max-width: 760px)").matches;

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
      if (sheet()) gsap.fromTo(dialog, { yPercent: 100, "--modal-fade": 0 }, { yPercent: 0, "--modal-fade": 1, duration: .34, ease: "power3.out", clearProps: "transform,--modal-fade" });
      else gsap.fromTo(dialog, { opacity: 0, y: 16, "--modal-fade": 0 }, { opacity: 1, y: 0, "--modal-fade": 1, duration: .28, ease: "power2.out", clearProps: "transform,opacity,--modal-fade" });
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
      if (sheet()) gsap.to(dialog, { yPercent: 100, "--modal-fade": 0, duration: .24, ease: "power2.in", onComplete: finish });
      else gsap.to(dialog, { opacity: 0, y: 10, "--modal-fade": 0, duration: .18, ease: "power1.in", onComplete: finish });
    }, dialog);
    return () => context.revert();
  }, [open, mounted]);

  // Consumidores antigos podem desmontar no mesmo render da ação de fechar/salvar.
  // Uma cópia inerte preserva só a saída visual; React e seus listeners desmontam normalmente.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open && !reducedMotion()) {
        const bounds = dialog.getBoundingClientRect();
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-exit-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.inert = true;
        const copy = dialog.cloneNode(true) as HTMLDialogElement;
        copy.removeAttribute('open'); copy.removeAttribute('aria-labelledby');
        copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
        const computed = getComputedStyle(dialog);
        for (const property of computed) if (property.startsWith('--')) copy.style.setProperty(property, computed.getPropertyValue(property));
        copy.style.font = computed.font;
        copy.style.color = computed.color;
        Object.assign(copy.style, { position: 'fixed', top: `${bounds.top}px`, left: `${bounds.left}px`, margin: '0', width: `${bounds.width}px`, maxHeight: `${bounds.height}px` });
        // Com o bottom sheet quem rola é o corpo; no desktop, o painel.
        const scrollers = ['.modal-panel', '.modal-body'].map(selector => dialog.querySelector(selector)?.scrollTop ?? 0);
        queueMicrotask(() => {
          // StrictMode reexecuta os efeitos mantendo o nó conectado.
          if (dialog.isConnected) return;
          backdrop.append(copy); document.body.append(backdrop); copy.show();
          ['.modal-panel', '.modal-body'].forEach((selector, index) => { const node = copy.querySelector(selector); if (node) node.scrollTop = scrollers[index]; });
          if (sheet()) gsap.to(copy, { yPercent: 100, duration: .24, ease: 'power2.in' });
          gsap.to(backdrop, { opacity: 0, duration: sheet() ? .24 : .18, ease: 'power1.in', onComplete: () => backdrop.remove() });
        });
      }
      if (dialog?.open) dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
      // Na desmontagem direta, o browser pode mover o foco ao body depois deste cleanup.
      const target = opener.current;
      queueMicrotask(() => { if (!dialog?.isConnected && target?.isConnected) target.focus(); });
    };
  }, [mounted]);

  if (!mounted) return null;
  return (
    <dialog
      ref={dialogRef}
      className={className ? `modal ${className}` : "modal"}
      aria-labelledby={titleId}
      aria-busy={busy}
      // Diálogos aninhados (ex.: confirmação sobre o formulário) não fecham nem prendem o Tab do diálogo de baixo.
      onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (!busyRef.current) onCloseRef.current(); }}
      // Navegadores diferem em para onde o Tab vai ao sair do <dialog> (barra do navegador, <body>): o ciclo é feito aqui.
      onKeyDown={(event) => {
        if (event.key !== "Tab" || (event.target as Element).closest("dialog") !== event.currentTarget) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>(focusable)].filter((item) => !item.matches(":disabled") && item.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      // O padding fica no painel interno, então um clique direto no <dialog> é um clique no backdrop.
      onClick={(event) => { if (event.target === event.currentTarget && !busyRef.current) onCloseRef.current(); }}
    >
      <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Fechar janela">×</button>
      <div className="modal-panel">
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </dialog>
  );
}
