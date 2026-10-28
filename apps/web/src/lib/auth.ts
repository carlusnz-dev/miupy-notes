import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ApiError, setAccessTokenProvider, setUnauthorizedHandler } from "./api-client";
import { z } from "zod";
import { decodeIdTokenPayload, ownerIdFromToken } from "./id-token";
import { signOutNeedsConfirmation } from "./notes-session";

export type AuthStatus = "checking" | "signed-out" | "signed-in" | "unsupported";
export type AuthState = { status: AuthStatus; signingIn: boolean; error: string | null };

// Códigos de rejeição dos comandos Tauri `auth_*`.
const errorMessages: Record<string, string> = {
  AUTH_NOT_CONFIGURED: "O login com Google não está configurado neste app.",
  AUTH_TIMEOUT: "O login não foi concluído a tempo. Tente de novo.",
  AUTH_DENIED: "O acesso foi negado no Google.",
  AUTH_FAILED: "Não foi possível concluir o login. Tente de novo.",
  KEYRING_ERROR: "Não foi possível acessar o chaveiro do sistema.",
  NOT_SIGNED_IN: "Sua sessão terminou. Entre de novo.",
  ACCOUNT_CHANGED: "Escolha a mesma conta Google desta sessão. Para usar outra conta, saia e entre de novo.",
};

function messageFor(code: unknown): string {
  return errorMessages[String(code)] ?? errorMessages.AUTH_FAILED;
}

let state: AuthState = { status: isTauri() ? "checking" : "unsupported", signingIn: false, error: null };
let sessionVersion = 0;
/** Identifica a sessão da operação; respostas de uma sessão encerrada não podem repovoar o cache. */
export function getAuthSessionVersion() { return sessionVersion; }
export function isCurrentAuthSession(version: number) { return state.status === "signed-in" && version === sessionVersion; }
const listeners = new Set<() => void>();

// O token só existe dentro desta chamada: o Rust o guarda no chaveiro e faz o refresh.
async function idTokenProvider(): Promise<string> {
  try {
    return await invoke<string>("auth_id_token");
  } catch (code) {
    if (code === "NOT_SIGNED_IN") {
      expireSession();
      throw new ApiError("UNAUTHORIZED", messageFor(code));
    }
    throw new ApiError(String(code), messageFor(code));
  }
}

function update(next: Partial<AuthState>) {
  if (next.status !== undefined && next.status !== state.status) sessionVersion++;
  state = { ...state, ...next };
  setAccessTokenProvider(state.status === "signed-in" ? idTokenProvider : null);
  listeners.forEach((listener) => listener());
}

export async function initAuth() {
  if (state.status !== "checking") return;
  try {
    const { signedIn } = await invoke<{ signedIn: boolean }>("auth_status");
    update({ status: signedIn ? "signed-in" : "signed-out" });
  } catch (code) {
    update({ status: "signed-out", error: messageFor(code) });
  }
}

export async function signIn() {
  if (state.status !== "signed-out" || state.signingIn) return;
  update({ signingIn: true, error: null });
  try {
    await invoke("auth_sign_in");
    update({ status: "signed-in", signingIn: false });
  } catch (code) {
    update({ signingIn: false, error: messageFor(code) });
  }
}

/**
 * Refaz o login do Google pedindo o Calendar (`mirror` leitura, `reflect` escrita). É o mesmo consentimento do login,
 * não um segundo OAuth: o refresh token do cofre é substituído. O Rust recusa outra conta (`ACCOUNT_CHANGED`) sem gravar nada.
 */
export async function grantCalendar(mode: "mirror" | "reflect") {
  if (state.status !== "signed-in" || state.signingIn) throw new Error(errorMessages.NOT_SIGNED_IN);
  update({ signingIn: true, error: null });
  try {
    await invoke("auth_sign_in", { calendar: mode });
  } catch (code) {
    throw new Error(messageFor(code));
  } finally {
    update({ signingIn: false });
  }
}

export type SignOutResult =
  | { status: "signed-out"; draftsPurged: boolean; cleanupErrors: string[] }
  /** Há notas/eventos não sincronizados (`unsynced`; `null` = não foi possível verificar). Repita com `discardDrafts: true` após o usuário confirmar. */
  | { status: "needs-confirmation"; unsynced: number | null };

/**
 * Único caminho de saída da conta. Se houver notas ou eventos não sincronizados, não sai sozinho: devolve
 * `needs-confirmation`, e só `discardDrafts: true` (decisão explícita) apaga esses rascunhos locais.
 */
export async function signOut(options: { discardDrafts?: boolean } = {}): Promise<SignOutResult> {
  const { calendarStore, clearCalendarOwner } = await import("../calendar/session");
  const cleanupErrors: string[] = [];
  const ownerId = await getOwnerId().catch(() => null);
  let calendarPending: number | null = null;
  try { if (ownerId) calendarPending = (await calendarStore.listOps(ownerId)).length; } catch { /* confirmação obrigatória */ }
  let saver: typeof import("./notes-saver") | null = null;
  let check: Awaited<ReturnType<typeof import("./notes-saver")["draftSignOutCheck"]>> | null = null;
  try {
    saver = await import("./notes-saver");
    check = await saver.draftSignOutCheck();
  } catch {
    check = null; // sem a fila não dá para verificar: tratado como "pode haver rascunhos"
  }
  const combined = check && calendarPending !== null ? { unsynced: check.unsynced + calendarPending, unknown: check.unknown } : null;
  if (signOutNeedsConfirmation(combined, options.discardDrafts === true)) {
    return { status: "needs-confirmation", unsynced: combined && !combined.unknown ? combined.unsynced : null };
  }
  update({ status: "signed-out", error: null });
  try {
    await invoke("auth_sign_out");
  } catch (code) {
    update({ error: messageFor(code) });
  }
  await saver?.sessionIdle();
  if (!saver?.lastSignOutClose().purged) cleanupErrors.push("Não foi possível apagar os rascunhos de notas.");
  if (ownerId) {
    try { await clearCalendarOwner(ownerId); } catch { cleanupErrors.push("Não foi possível apagar os eventos e envios pendentes da agenda deste computador."); }
  } else cleanupErrors.push("Não foi possível identificar a conta para limpar a agenda.");
  try {
    const { clearUserLocalStorage } = await import("./user-cache-cleanup");
    clearUserLocalStorage();
    const { resetEditorPreferences } = await import("./editor-preferences");
    resetEditorPreferences();
  } catch { cleanupErrors.push("Não foi possível limpar as preferências locais desta conta."); }
  if (cleanupErrors.length) update({ error: cleanupErrors.join(" ") });
  return { status: "signed-out", draftsPurged: saver?.lastSignOutClose().purged ?? false, cleanupErrors };
}

/** Volta para "signed-out" quando a API ou o Rust recusam a sessão (401 ou NOT_SIGNED_IN). */
export function expireSession() {
  if (state.status === "signed-in") update({ status: "signed-out", error: errorMessages.NOT_SIGNED_IN });
}

setUnauthorizedHandler(expireSession);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Avisa fora do React (por exemplo, para limpar o cache ao sair). */
export function subscribeAuth(listener: (state: AuthState) => void) {
  return subscribe(() => listener(state));
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => state);
}

const profileSchema = z.object({ name: z.string().optional(), email: z.email().optional(), picture: z.url().optional() });
/** O payload serve apenas para exibição; a API valida a assinatura para autorizar dados. */
export async function getProfile() {
  if (!isTauri()) return null;
  const token = await invoke<string>("auth_id_token");
  return profileSchema.parse(decodeIdTokenPayload(token));
}

/** Conta da sessão atual (`sub` do ID token), usada só para separar rascunhos locais; `null` se deslogado. */
export async function getOwnerId(): Promise<string | null> {
  if (state.status !== "signed-in") return null;
  return ownerIdFromToken(await invoke<string>("auth_id_token"));
}
