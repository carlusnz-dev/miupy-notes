// Página só para teste via MCP (vite dev em /tests/finance-harness.html); não entra no build.
// A API é interceptada pelo teste; o token abaixo é sintético e nunca sai do navegador de teste.
import { useState, type CSSProperties } from "react";
import ReactDOM from "react-dom/client";
import tokens from "../../../styles/tokens.json";
import { setAccessTokenProvider } from "../src/lib/api-client";
import { TransactionForm } from "../src/finance/TransactionForm";
import { BanksModal } from "../src/finance/BanksModal";
import "../src/App.css";
import "../src/finance/finance.css";

setAccessTokenProvider(async () => "synthetic-test-token");
const theme = {
  "--color-background": tokens.colors.background, "--color-surface": tokens.colors.surface, "--color-surface-raised": tokens.colors.surfaceRaised,
  "--color-text": tokens.colors.text, "--color-muted": tokens.colors.textMuted, "--color-border": tokens.colors.border,
  "--color-border-strong": tokens.colors.borderStrong, "--color-accent": tokens.colors.accent, "--color-accent-text": tokens.colors.accentText, "--color-focus": tokens.colors.focus,
  "--radius-small": `${tokens.radiusPx.small}px`, "--radius-medium": `${tokens.radiusPx.medium}px`, "--duration": `${tokens.motion.defaultDurationMs}ms`,
} as CSSProperties;
const banks = [{ id: "11111111-1111-4111-8111-111111111111", title: "Banco Sintético", logo: null, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", version: 1 }];
const existing = { id: "22222222-2222-4222-8222-222222222222", title: "Existente", amountCents: 123456, currency: "EUR" as const, direction: "income" as const, date: "2024-02-29", category: "Teste", tags: ["a", "b"], bankId: banks[0].id, bankTitle: "Banco Sintético", source: "Manual", link: "salary" as const, linkedMonth: "2026-09", paymentMethod: null, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", version: 3 };

function Harness() {
  const [mode, setMode] = useState<"new" | "edit" | "banks" | null>(null);
  const [saved, setSaved] = useState("");
  return <div className="app-shell finance-page" style={theme}>
    <main style={{ padding: 24, display: "flex", gap: 12, alignContent: "start" }}>
      <button id="new" onClick={() => setMode("new")}>Novo</button>
      <button id="edit" onClick={() => setMode("edit")}>Editar</button>
      <button id="banks" onClick={() => setMode("banks")}>Bancos</button>
      <output id="saved">{saved}</output>
    </main>
    {(mode === "new" || mode === "edit") && <TransactionForm existing={mode === "edit" ? existing : undefined} banks={banks} onClose={() => setMode(null)} onSaved={(transaction) => { setSaved(JSON.stringify(transaction)); setMode(null); }} />}
    {mode === "banks" && <BanksModal banks={banks} onClose={() => setMode(null)} onChanged={() => undefined} />}
  </div>;
}
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
