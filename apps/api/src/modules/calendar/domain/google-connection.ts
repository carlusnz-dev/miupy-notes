export type GoogleMode = "mirror" | "reflect";

/** Estado persistido da integração; nunca contém token. Credenciais ficam na porta `CredentialStore`. */
export type GoogleConnection = {
  /** Identifica esta conexão: desconectar e reconectar gera outro. Gravações de uma sincronização em voo só valem para a mesma. */
  readonly connectionId: string;
  readonly status: "connected" | "needs_reauth";
  readonly mode: GoogleMode;
  readonly scopes: readonly string[];
  readonly calendarId: string;
  readonly connectedAt: string;
  readonly syncToken: string | null;
  readonly lastSyncAt: string | null;
  /** Código público do último erro de sincronização (`RATE_LIMITED`, `UNAUTHORIZED`...), sem texto do provedor. */
  readonly lastError: string | null;
};

/** Autorização iniciada e ainda não concluída: o `state` expira e é de uso único. */
export type PendingAuthorization = { readonly state: string; readonly mode: GoogleMode; readonly redirectUri: string; readonly expiresAt: string };
