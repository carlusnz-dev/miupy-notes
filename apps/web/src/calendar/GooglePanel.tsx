import { useEffect, useState } from "react";
import Select from "../components/Select";
import ConfirmDialog from "../components/ConfirmDialog";
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
  not_connected: "Conecte no navegador com um consentimento separado do login. Você escolhe leitura ou leitura e escrita.",
  connected: "",
  needs_reauth: "O Google recusou o acesso. É preciso conceder o consentimento de novo.",
};
const errorText: Record<string, string> = {
  RATE_LIMITED: "O Google limitou as requisições; a próxima tentativa tenta de novo.",
  REAUTH_REQUIRED: "O Google recusou o acesso.",
  UPSTREAM_UNAVAILABLE: "O Google estava indisponível.",
  SYNC_TOO_LARGE: "Eventos demais para uma sincronização.",
};

export default function GooglePanel({ status, error, onSync, onConnect, onCancel, onDisconnect }: {
  status: GoogleStatusOutput | null; error: string | null; onSync: () => Promise<GoogleSyncOutput>;
  onConnect?: (mode: "mirror" | "reflect", onFinalizing?: () => void) => Promise<GoogleSyncOutput | void>;
  onCancel?: () => Promise<void>;
  onDisconnect?: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"mirror" | "reflect">("mirror");
  const [connecting, setConnecting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => () => { void onCancel?.().catch(() => undefined); }, [onCancel]);
  async function connect() {
    setConnecting(true); setFinalizing(false); setFailure(null); setResult(null);
    try { await onConnect?.(mode, () => setFinalizing(true)); setResult("Google Calendar conectado e sincronizado."); }
    catch (e) { setFailure(e instanceof Error ? e.message : "Falha ao conectar."); }
    finally { setConnecting(false); setFinalizing(false); }
  }
  async function disconnect() {
    setDisconnecting(true); setFailure(null);
    try { await onDisconnect?.(); setResult("Google Calendar desconectado."); setConfirmDisconnect(false); }
    catch (e) { setFailure(e instanceof Error ? e.message : "Falha ao desconectar."); }
    finally { setDisconnecting(false); }
  }
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
  const tone = status?.state === "connected" ? "ok" : status?.state === "needs_reauth" ? "alert" : "idle";
  const help = [
    status?.state === "connected" ? `${status.mode === "reflect" ? "Leitura e escrita. Eventos do Google podem ser editados e excluídos; novos envios dependem da sua escolha." : "Espelho somente leitura."}` : null,
    status && stateHelp[status.state] ? stateHelp[status.state] : null,
    status?.state === "connected" ? "A carga inicial traz de 30 dias atrás até um ano à frente. Sincronize para receber novas mudanças; não há atualização automática do Google." : null,
  ].filter(Boolean);
  return (
    <section className="calendar-google" aria-labelledby="calendar-google-title">
      <header className="calendar-google-head">
        <h2 id="calendar-google-title">Google Calendar</h2>
        <p className="calendar-google-state" data-tone={tone}>{status ? stateText[status.state] : error ?? "Verificando…"}</p>
      </header>
      {status?.state === "connected" && <p className="calendar-note">{status.lastSyncAt ? `Última sincronização: ${new Date(status.lastSyncAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.` : "Ainda não sincronizado."}</p>}
      {status?.lastError && <p className="calendar-note">Último erro: {errorText[status.lastError] ?? status.lastError}</p>}
      {help.length > 0 && <details className="calendar-google-details"><summary>Como funciona</summary>{help.map((text) => <p key={text} className="calendar-note">{text}</p>)}</details>}
      {result && <p className="calendar-note" role="status">{result}</p>}
      {failure && <p className="calendar-error" role="alert">{failure}</p>}
      <div className="calendar-google-actions">
      {status && status.state !== "not_configured" && onConnect && <>
        <Select label="Permissão do Google" value={mode} options={[{ value: "mirror", label: "Somente leitura" }, { value: "reflect", label: "Leitura e escrita" }]} onChange={(value) => setMode(value as "mirror" | "reflect")} disabled={connecting || syncing || disconnecting} />
        {connecting ? finalizing ? <p role="status" className="calendar-note">Finalizando autorização… Depois, use Desconectar para revogar o acesso.</p> : <button type="button" className="button button-secondary" onClick={() => void onCancel?.().catch((e) => setFailure(e instanceof Error ? e.message : "Não foi possível cancelar."))}>Cancelar espera</button> : <button type="button" className="button button-secondary" onClick={() => void connect()} disabled={syncing || disconnecting}>{status.state === "connected" ? "Alterar permissão" : "Conectar Google Calendar"}</button>}
        {connecting && !finalizing && <p role="status" className="calendar-note">Conclua o consentimento no navegador… Cancelar interrompe a espera; após a gravação final, use Desconectar para revogar o acesso.</p>}
      </>}
      {status?.state === "connected" && <button type="button" className="button button-secondary" onClick={() => void sync()} disabled={syncing || connecting || disconnecting}><RefreshCw size={14} aria-hidden="true" />&nbsp;{syncing ? "Sincronizando…" : "Sincronizar agora"}</button>}
      {onDisconnect && (status?.state === "connected" || status?.state === "needs_reauth") && <button type="button" className="calendar-link-button" disabled={connecting || syncing || disconnecting} onClick={() => setConfirmDisconnect(true)}>Desconectar</button>}
      </div>
      <ConfirmDialog open={confirmDisconnect} title="Desconectar Google Calendar?" confirmLabel="Desconectar" busyLabel="Desconectando…" cancelLabel="Manter conexão" busy={disconnecting} onCancel={() => setConfirmDisconnect(false)} onConfirm={() => void disconnect()}>
        <p>O acesso será revogado e os espelhos serão removidos deste app. Eventos locais e cópias enviadas ao Google permanecem. Envie ou descarte as alterações pendentes antes de desconectar.</p>
      </ConfirmDialog>
    </section>
  );
}
