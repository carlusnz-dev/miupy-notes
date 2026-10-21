import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { GoogleStatusOutput, GoogleSyncOutput } from "../lib/calendar-api";

const stateText: Record<GoogleStatusOutput["state"], string> = {
  not_configured: "Não configurado neste servidor",
  not_connected: "Não conectado",
  connected: "Conectado",
  needs_reauth: "Reautorização necessária",
};
const stateHelp: Record<GoogleStatusOutput["state"], string> = {
  not_configured: "O servidor não tem credenciais do Google protegidas. Nada é lido do Google nem enviado a ele.",
  not_connected: "A conexão é um consentimento separado do login e só pede o acesso mínimo. O fluxo de consentimento ainda não existe no app desktop; por isso não há botão de conectar.",
  connected: "",
  needs_reauth: "O Google recusou o acesso. É preciso conceder o consentimento de novo.",
};
const errorText: Record<string, string> = {
  RATE_LIMITED: "O Google limitou as requisições; a próxima tentativa tenta de novo.",
  REAUTH_REQUIRED: "O Google recusou o acesso.",
  UPSTREAM_UNAVAILABLE: "O Google estava indisponível.",
  SYNC_TOO_LARGE: "Eventos demais para uma sincronização.",
};

export default function GooglePanel({ status, error, onSync }: { status: GoogleStatusOutput | null; error: string | null; onSync: () => Promise<GoogleSyncOutput> }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  async function sync() {
    setSyncing(true); setFailure(null); setResult(null);
    try {
      const done = await onSync();
      setResult(`${done.kind === "full" ? "Sincronização completa" : "Sincronização incremental"}: ${done.upserted} atualizado(s), ${done.deleted} removido(s)${done.resynced ? " (o Google invalidou o cursor e o espelho foi refeito)" : ""}.`);
    } catch (e) { setFailure(e instanceof Error ? e.message : "Falha ao sincronizar."); } finally { setSyncing(false); }
  }
  return (
    <section className="calendar-google" aria-labelledby="calendar-google-title">
      <div>
        <h2 id="calendar-google-title">Google Calendar</h2>
        <p className="calendar-google-state">{status ? stateText[status.state] : error ?? "Verificando…"}</p>
        {status && status.state === "connected" && <p className="calendar-note">{status.mode === "reflect" ? "Espelho (leitura) e refletor (escrita consentida, evento a evento)." : "Espelho somente leitura."} {status.lastSyncAt ? `Última sincronização: ${new Date(status.lastSyncAt).toLocaleString("pt-BR")}.` : "Ainda não sincronizado."}</p>}
        {status && stateHelp[status.state] && <p className="calendar-note">{stateHelp[status.state]}</p>}
        {status?.lastError && <p className="calendar-note">Último erro: {errorText[status.lastError] ?? status.lastError}</p>}
        {result && <p className="calendar-note" role="status">{result}</p>}
        {failure && <p className="calendar-error" role="alert">{failure}</p>}
      </div>
      {status?.state === "connected" && <button type="button" className="button button-secondary" onClick={() => void sync()} disabled={syncing}><RefreshCw size={14} aria-hidden="true" />&nbsp;{syncing ? "Sincronizando…" : "Sincronizar agora"}</button>}
    </section>
  );
}
