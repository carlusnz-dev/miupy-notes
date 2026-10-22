import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { AppError } from "../../../core/domain/app-error.js";
import { CredentialStore } from "./google-oauth.js";

type Run = (args: string[], input?: string) => Promise<{ code: number; output: string }>;
/** Linux desktop: Secret Service da sessão. Segredo só no stdin/stdout de pipe privado; nunca argv, disco ou logs. */
const runSecretTool: Run = (args, input) => new Promise((resolve, reject) => {
  const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "ignore"] });
  let output = "";
  const timer = setTimeout(() => { child.kill(); reject(new Error("credential-store")); }, 15_000);
  child.on("error", () => { clearTimeout(timer); reject(new Error("credential-store")); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; if (output.length > 16_384) child.kill(); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, output }); });
  child.stdin.on("error", () => undefined);
  child.stdin.end(input);
});

export class SecretServiceCredentialStore extends CredentialStore {
  constructor(private readonly run: Run = runSecretTool) { super(); }
  private attributes(ownerId: string) {
    return ["application", "com.miupy.notes.calendar", "owner", createHash("sha256").update(ownerId).digest("hex")];
  }
  private async call(args: string[], input?: string) {
    try { return await this.run(args, input); }
    catch { throw new AppError(503, "CREDENTIAL_STORE_UNAVAILABLE", "Desbloqueie o cofre da sessão para conectar o Google Calendar."); }
  }
  async get(ownerId: string): Promise<string | null> {
    const result = await this.call(["lookup", ...this.attributes(ownerId)]);
    if (result.code === 1 && !result.output) return null;
    if (result.code !== 0) throw new AppError(503, "CREDENTIAL_STORE_UNAVAILABLE", "O cofre de credenciais não está disponível.");
    return result.output.replace(/\n$/, "") || null;
  }
  async put(ownerId: string, refreshToken: string): Promise<void> {
    const result = await this.call(["store", "--label=miupy-notes Google Calendar", ...this.attributes(ownerId)], refreshToken);
    if (result.code !== 0) throw new AppError(503, "CREDENTIAL_STORE_UNAVAILABLE", "Não foi possível guardar a autorização no cofre.");
  }
  async delete(ownerId: string): Promise<void> {
    const result = await this.call(["clear", ...this.attributes(ownerId)]);
    if (result.code !== 0 && result.code !== 1) throw new AppError(503, "CREDENTIAL_STORE_UNAVAILABLE", "Não foi possível apagar a autorização do cofre.");
  }
}
