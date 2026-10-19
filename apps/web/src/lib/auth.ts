import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ApiError, setAccessTokenProvider } from "./api-client";

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
};

function messageFor(code: unknown): string {
  return errorMessages[String(code)] ?? errorMessages.AUTH_FAILED;
}

let state: AuthState = { status: isTauri() ? "checking" : "unsupported", signingIn: false, error: null };
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

export async function signOut() {
  update({ status: "signed-out", error: null });
  try {
    await invoke("auth_sign_out");
  } catch (code) {
    update({ error: messageFor(code) });
  }
}

/** Volta para "signed-out" quando a API ou o Rust recusam a sessão (401 ou NOT_SIGNED_IN). */
export function expireSession() {
  if (state.status === "signed-in") update({ status: "signed-out", error: errorMessages.NOT_SIGNED_IN });
}

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
