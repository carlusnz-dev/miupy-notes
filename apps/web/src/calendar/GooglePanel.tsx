import { useState } from "react";
import Select from "../components/Select";
import Modal from "../components/Modal";
import { RefreshCw } from "lucide-react";
import type { GoogleStatusOutput, GoogleSyncOutput } from "../lib/calendar-api";

const stateText: Record<GoogleStatusOutput["state"], string> = {
  not_configured: "Não configurado neste servidor",
  not_connected: "Não ativado",
  connected: "Conectado via sua conta Google",
  needs_reauth: "Reautorização necessária",
};
const stateHelp: Record<GoogleStatusOutput["state"], string> = {
  not_configured: "O servidor não está configurado para usar o login do Google no Calendar. Nada é lido do Google nem enviado a ele.",
  not_connected: "O Calendar usa o mesmo login do Google do app: ativar não abre outra tela de login.",
  connected: "",
  needs_reauth: "O Google recusou o acesso. Entre de novo no Google, concedendo o Calendar.",
};
const errorText: Record<string, string> = {
  RATE_LIMITED: "O Google limitou as requisições; a próxima tentativa tenta de novo.",
  REAUTH_REQUIRED: "O Google recusou o acesso.",
  UPSTREAM_UNAVAILABLE: "O Google estava indisponível.",
  SYNC_TOO_LARGE: "Eventos demais para uma sincronização.",
};

export default function GooglePanel({ status, error, onSync, onConnect, onDisconnect }: {
  status: GoogleStatusOutput | null; error: string | null; onSync: () => Promise<GoogleSyncOutput>;
  /** Sem `mode`, ativa com o que o login já concedeu; com `mode`, refaz o login do Google com essa permissão (consentimento único). */
  onConnect?: (mode?: "mirror" | "reflect") => Promise<GoogleSyncOutput | void>;
  onDisconnect?: () => Promise<void>;
}) {
  const [chosen, setMode] = useState<"mirror" | "reflect" | null>(null);
  const mode = chosen ?? status?.mode ?? "mirror";
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // O login não trouxe o Calendar (consentimento granular ou login anterior): só então a tela oferece refazer o login.
  const [scopesMissing, setScopesMissing] = useState(false);
  async function connect(chosen?: "mirror" | "reflect") {
    setConnecting(true); setFailure(null); setResult(null);
    try { await onConnect?.(chosen); setScopesMissing(false); setResult("Google Calendar conectado e sincronizado."); }
    catch (e) {
      setScopesMissing((e as { code?: string }).code === "SCOPE_NOT_GRANTED");
      setFailure(e instanceof Error ? e.message : "Falha ao conectar.");
    }
    finally { setConnecting(false); }
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
  return (
    <section className="calendar-google" aria-labelledby="calendar-google-title">
      <div>
        <h2 id="calendar-google-title">Google Calendar</h2>
        <p className="calendar-google-state">{status ? stateText[status.state] : error ?? "Verificando…"}</p>
        {status && status.state === "connected" && <p className="calendar-note">{status.mode === "reflect" ? "Leitura e escrita. Eventos do Google podem ser editados e excluídos; novos envios dependem da sua escolha." : "Espelho somente leitura."} {status.lastSyncAt ? `Última sincronização: ${new Date(status.lastSyncAt).toLocaleString("pt-BR")}.` : "Ainda não sincronizado."}</p>}
        {status && stateHelp[status.state] && <p className="calendar-note">{stateHelp[status.state]}</p>}
        {status?.lastError && <p className="calendar-note">Último erro: {errorText[status.lastError] ?? status.lastError}</p>}
        {status?.state === "connected" && <p className="calendar-note">A carga inicial traz de 30 dias atrás até um ano à frente. Sincronize para receber novas mudanças; não há atualização automática do Google.</p>}
        {result && <p className="calendar-note" role="status">{result}</p>}
        {failure && <p className="calendar-error" role="alert">{failure}</p>}
      </div>
      <div className="calendar-google-actions">
      {status && status.state !== "not_configured" && onConnect && <>
        {status.state === "not_connected" && !scopesMissing && <button type="button" className="button button-secondary" onClick={() => void connect()} disabled={connecting || syncing || disconnecting}>{connecting ? "Ativando…" : "Ativar Google Calendar"}</button>}
        {(status.state !== "not_connected" || scopesMissing) && <>
          <Select label="Permissão do Google" value={mode} options={[{ value: "mirror", label: "Somente leitura" }, { value: "reflect", label: "Leitura e escrita" }]} onChange={(value) => setMode(value as "mirror" | "reflect")} disabled={connecting || syncing || disconnecting} />
          <button type="button" className="button button-secondary" onClick={() => void connect(mode)} disabled={connecting || syncing || disconnecting}>{connecting ? "Aguardando o login do Google…" : status.state === "connected" ? "Alterar permissão" : "Conceder Calendar no login do Google"}</button>
          <p className="calendar-note">{status.state === "connected" ? "Alterar a permissão refaz o login do Google uma vez, com a nova escolha." : "O Calendar não veio no seu login. Entre de novo no Google uma vez, concedendo o Calendar."}</p>
        </>}
      </>}
      {status?.state === "connected" && <button type="button" className="button button-secondary" onClick={() => void sync()} disabled={syncing || connecting || disconnecting}><RefreshCw size={14} aria-hidden="true" />&nbsp;{syncing ? "Sincronizando…" : "Sincronizar agora"}</button>}
      {onDisconnect && (status?.state === "connected" || status?.state === "needs_reauth") && <button type="button" className="button button-secondary" disabled={connecting || syncing || disconnecting} onClick={() => setConfirmDisconnect(true)}>Desconectar</button>}
      </div>
      <Modal open={confirmDisconnect} title="Desconectar Google Calendar?" onClose={() => setConfirmDisconnect(false)} busy={disconnecting}>
        <p>O app deixa de usar o Calendar e os espelhos serão removidos. Eventos locais e cópias enviadas ao Google permanecem. O acesso do login do Google não é revogado: para isso, saia da conta ou revogue o app na sua conta Google. Envie ou descarte as alterações pendentes antes de desconectar.</p>
        <div className="modal-actions"><button type="button" className="button button-secondary" disabled={disconnecting} onClick={() => setConfirmDisconnect(false)}>Manter conexão</button><button type="button" className="button" disabled={disconnecting} onClick={() => void disconnect()}>{disconnecting ? "Desconectando…" : "Desconectar"}</button></div>
      </Modal>
    </section>
  );
}
