// Página só para teste manual/MCP (vite dev em /tests/modal-harness.html); não entra no build.
import { useRef, useState, type CSSProperties } from "react";
import ReactDOM from "react-dom/client";
import tokens from "../../../styles/tokens.json";
import Modal from "../src/components/Modal";
import "../src/App.css";

const theme = {
  "--color-background": tokens.colors.background, "--color-surface": tokens.colors.surface, "--color-surface-raised": tokens.colors.surfaceRaised,
  "--color-text": tokens.colors.text, "--color-muted": tokens.colors.textMuted, "--color-border": tokens.colors.border,
  "--color-border-strong": tokens.colors.borderStrong, "--color-accent": tokens.colors.accent, "--color-accent-text": tokens.colors.accentText, "--color-focus": tokens.colors.focus,
  "--radius-small": `${tokens.radiusPx.small}px`, "--radius-medium": `${tokens.radiusPx.medium}px`, "--duration": `${tokens.motion.defaultDurationMs}ms`,
} as CSSProperties;

function Harness() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  return <div className="app-shell" style={theme}>
    <main style={{ padding: 24, display: "grid", gap: 12, alignContent: "start" }}>
      <button id="opener" className="button" onClick={() => setOpen(true)}>Abrir janela</button>
      <button id="busy-toggle" className="button button-secondary" onClick={() => setBusy((value) => !value)}>Alternar ocupado ({String(busy)})</button>
      <output id="closed-count">{closed}</output>
    </main>
    <Modal open={open} title="Excluir esta nota?" busy={busy} initialFocusRef={field} onClose={() => { setClosed((value) => value + 1); setOpen(false); }}>
      <p>A exclusão é definitiva: ainda não há lixeira.</p>
      <input ref={field} aria-label="Confirmação" />
      <div className="modal-actions"><button className="button button-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button><button id="confirm" className="button">Excluir definitivamente</button></div>
    </Modal>
  </div>;
}
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
