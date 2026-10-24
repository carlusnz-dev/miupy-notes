import { useEffect, useState } from "react";

/** Abaixo disso a mudança é barra de endereço ou zoom, não teclado virtual. */
const KEYBOARD_MIN_SHRINK_PX = 150;
const nonTextInputs = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

type FocusTarget = { tagName: string; type?: string; isContentEditable?: boolean } | null;

/** Elemento que abre o teclado virtual: texto, área de texto ou contenteditable (CodeMirror). */
export function isTextEntry(target: FocusTarget): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return true;
  return tag === "input" && !nonTextInputs.has((target.type ?? "text").toLowerCase());
}

/**
 * `baseline` é a maior altura de viewport vista na orientação atual. Funciona tanto quando só o viewport visual
 * encolhe (iOS, Android padrão) quanto quando o layout encolhe junto (`interactive-widget=resizes-content`).
 */
export function isKeyboardOpen({ baseline, viewportHeight, textFocused }: { baseline: number; viewportHeight: number; textFocused: boolean }): boolean {
  return textFocused && baseline - viewportHeight > KEYBOARD_MIN_SHRINK_PX;
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let baseline = 0;
    let width = window.innerWidth;
    const update = () => {
      // Girar a tela muda a largura: a altura de referência antiga deixa de valer.
      if (window.innerWidth !== width) { width = window.innerWidth; baseline = 0; }
      baseline = Math.max(baseline, window.innerHeight, viewport.height);
      setOpen(isKeyboardOpen({ baseline, viewportHeight: viewport.height, textFocused: isTextEntry(document.activeElement as HTMLElement | null) }));
    };
    update();
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
    };
  }, []);
  return open;
}
