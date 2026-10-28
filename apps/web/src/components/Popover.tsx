import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useAnchoredPosition, useDismiss, usePresence } from "./popover-behavior";
import "./primitives.css";

type Props = { open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement | null>; label: string; children: ReactNode; width?: number | "anchor"; id?: string };
export default function Popover({ open, onClose, anchorRef, label, children, width = 280, id }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const mounted = usePresence(open, root);
  const style = useAnchoredPosition(mounted, anchorRef, root, width);
  useDismiss(open, root, onClose, anchorRef);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    root.current?.focus();
    return () => {
      if (root.current?.contains(document.activeElement) || document.activeElement === document.body) {
        if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      }
    };
  }, [open, anchorRef]);
  if (!mounted) return null;
  return <div ref={root} id={id} className="ui-popover" style={style} role="dialog" aria-label={label} tabIndex={-1} inert={!open} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); onClose(); anchorRef.current?.focus(); }
  }}>{children}</div>;
}
