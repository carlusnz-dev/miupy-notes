// Harness sintético fora do build: usa o cliente Axios e API em memória na porta 3204.
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import type { CSSProperties } from "react";
import tokens from "../../../styles/tokens.json";
import { apiClient, setAccessTokenProvider } from "../src/lib/api-client";
import { LibraryWorkspace } from "../src/library/LibraryPage";
import "../src/fonts.css";
import "../src/typography.css";
import "../src/App.css";
apiClient.defaults.baseURL = "/";
setAccessTokenProvider(async () => "synthetic-library-token");
const theme = {
  "--color-background": tokens.colors.background, "--color-surface": tokens.colors.surface, "--color-surface-raised": tokens.colors.surfaceRaised,
  "--color-text": tokens.colors.text, "--color-muted": tokens.colors.textMuted, "--color-border": tokens.colors.border,
  "--color-border-strong": tokens.colors.borderStrong, "--color-accent": tokens.colors.accent, "--color-accent-text": tokens.colors.accentText, "--color-focus": tokens.colors.focus,
  "--radius-small": `${tokens.radiusPx.small}px`, "--radius-medium": `${tokens.radiusPx.medium}px`, "--duration": `${tokens.motion.defaultDurationMs}ms`,
} as CSSProperties;
ReactDOM.createRoot(document.getElementById("root")!).render(<HashRouter><div className="app-shell" style={{ ...theme, gridTemplateColumns: "minmax(0, 1fr)" }}><main className="main-content"><div className="page-scroll"><div className="page-content"><LibraryWorkspace /></div></div></main></div></HashRouter>);
