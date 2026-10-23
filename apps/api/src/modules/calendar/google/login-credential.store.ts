import { spawn } from "node:child_process";
import { AppError } from "../../../core/domain/app-error.js";
import { CredentialStore } from "./google-oauth.js";

type Run = (args: string[]) => Promise<{ code: number; output: string }>;
/** Linux desktop: Secret Service da sessão. Segredo só no stdout de pipe privado; nunca argv, disco ou logs. */
const runSecretTool: Run = (args) => new Promise((resolve, reject) => {
  const child = spawn("secret-tool", args, { stdio: ["ignore", "pipe", "ignore"] });
  let output = "";
  const timer = setTimeout(() => { child.kill(); reject(new Error("credential-store")); }, 15_000);
  child.on("error", () => { clearTimeout(timer); reject(new Error("credential-store")); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; if (output.length > 16_384) child.kill(); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, output }); });
});

/** Entrada do chaveiro gravada pelo login do Tauri (`KEYRING_SERVICE`/`KEYRING_USER` em src-tauri/src/auth.rs). */
const LOGIN_ENTRY = ["service", "com.miupy.notes", "username", "google-refresh-token"];

/**
 * Lê o refresh token do login, que é o único consentimento Google do app. Somente leitura: apagar ou trocar o token é
 * do login/logout do Tauri. A entrada é única por usuário do sistema, então `ownerId` não a seleciona; quem confere
 * que o token é do proprietário autenticado é `AccessTokenSource` (via `sub`).
 */
export class LoginCredentialStore extends CredentialStore {
  constructor(private readonly run: Run = runSecretTool) { super(); }
  async get(_ownerId: string): Promise<string | null> {
    let result;
    try { result = await this.run(["lookup", ...LOGIN_ENTRY]); }
    catch { throw new AppError(503, "CREDENTIAL_STORE_UNAVAILABLE", "Desbloqueie o cofre da sessão para usar o Google Calendar."); }
    if (result.code === 1 && !result.output) return null;
    if (result.code !== 0) throw new AppError(503, "CREDENTIAL_STORE_UNAVAILABLE", "O cofre de credenciais não está disponível.");
    return result.output.replace(/\n$/, "") || null;
  }
}
