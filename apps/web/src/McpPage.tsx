import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import Button from "./components/Button";
import PageHeader from "./components/PageHeader";
import { usePageTitle } from "./lib/use-page-title";
import "./mcp.css";

/** Espelha `apps/mcp/src/tools.ts`; mantenha em sincronia ao mudar as ferramentas do servidor. */
const tools = [
  { name: "notes_search", scope: "notes:read", description: "Busca notas por título, tag ou pasta (sem corpo)." },
  { name: "notes_get", scope: "notes:read", description: "Lê uma nota com corpo e versão." },
  { name: "notes_create", scope: "notes:write", description: "Cria uma nota; não é idempotente." },
  { name: "notes_update", scope: "notes:write", description: "Altera uma nota exigindo a versão atual." },
  { name: "folders_list", scope: "notes:read", description: "Lista as pastas para escolher o destino." },
] as const;

const claudeCommand = `claude mcp add --scope user miupy-notes \\
  --env MIUPY_API_BASE_URL=https://SUA-API \\
  --env MIUPY_API_TOKEN_FILE=$HOME/.config/miupy/mcp-token \\
  -- node --import tsx /CAMINHO/miupy-notes/apps/mcp/src/stdio.ts`;

const codexConfig = `[mcp_servers.miupy-notes]
command = "node"
args = ["--import", "tsx", "/CAMINHO/miupy-notes/apps/mcp/src/stdio.ts"]
cwd = "/CAMINHO/miupy-notes/apps/mcp"
[mcp_servers.miupy-notes.env]
MIUPY_API_BASE_URL = "https://SUA-API"
MIUPY_API_TOKEN_FILE = "/home/USUARIO/.config/miupy/mcp-token"`;

type Status = "checking" | "online" | "offline";

/** `/health` é público e fica fora de `/v1`: não passa pelo cliente Axios nem envia token. */
function useApiStatus() {
  const [status, setStatus] = useState<Status>("checking");
  const check = useCallback(() => {
    setStatus("checking");
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
    fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
      .then((response) => setStatus(response.ok ? "online" : "offline"))
      .catch(() => setStatus("offline"));
  }, []);
  useEffect(check, [check]);
  return { status, check };
}

function Snippet({ label, code }: { label: string; code: string }) {
  return <figure className="mcp-snippet"><figcaption>{label}</figcaption><pre><code>{code}</code></pre></figure>;
}

export default function McpPage() {
  usePageTitle("MCP");
  const { status, check } = useApiStatus();
  const labels: Record<Status, string> = { checking: "Verificando…", online: "API alcançável", offline: "API indisponível" };
  return <div className="mcp-page">
    <PageHeader size="utility" eyebrow="INTEGRAÇÕES" title="MCP" description="Deixe agentes como Claude Code e Codex ler e escrever notas pela API, com o seu token e permissões mínimas." actions={<Button size="sm" onClick={check} loading={status === "checking"}>Verificar de novo</Button>} />
    <section className="mcp-panel" aria-labelledby="mcp-status">
      <h2 id="mcp-status">Conexão com a API</h2>
      <p className={`mcp-status mcp-status-${status}`} role="status">
        {status === "online" ? <Check size={16} aria-hidden="true" /> : status === "offline" ? <X size={16} aria-hidden="true" /> : null}{labels[status]}
      </p>
      <p className="mcp-note">Confere apenas o endpoint público <code>/health</code>. O servidor MCP roda na sua máquina e usa o token do seu login; nenhum token aparece aqui.</p>
    </section>
    <section className="mcp-panel" aria-labelledby="mcp-tools">
      <h2 id="mcp-tools">Ferramentas expostas</h2>
      <ul className="mcp-tools">
        {tools.map((tool) => <li key={tool.name}><code>{tool.name}</code><span>{tool.description}</span><small>{tool.scope}</small></li>)}
      </ul>
      <p className="mcp-note">Não existe ferramenta de exclusão. Notas lidas são tratadas como dados, não como instruções.</p>
    </section>
    <section className="mcp-panel" aria-labelledby="mcp-register">
      <h2 id="mcp-register">Registrar o servidor stdio</h2>
      <p className="mcp-note">Grave o ID token vigente em um arquivo de modo 0600 (<code>~/.config/miupy/mcp-token</code>); nunca o versione. Troque <code>SUA-API</code> pela URL HTTPS da API e mantenha as confirmações de escrita ligadas no cliente.</p>
      <Snippet label="Claude Code" code={claudeCommand} />
      <Snippet label="Codex — ~/.codex/config.toml" code={codexConfig} />
    </section>
  </div>;
}
