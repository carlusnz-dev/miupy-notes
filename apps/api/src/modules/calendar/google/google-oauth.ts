import { GoogleApiError } from "./google-calendar.client.js";

export const SCOPE_MIRROR = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
export const SCOPE_REFLECT = "https://www.googleapis.com/auth/calendar.events.owned";

export type AccessToken = { accessToken: string; expiresInSec: number; scopes: string[]; subject: string };

/** Renovação do access token com o refresh token do login. Não há fluxo OAuth próprio do Calendar: o consentimento é o do login. */
export abstract class GoogleOAuth {
  abstract refreshAccessToken(refreshToken: string): Promise<AccessToken>;
}

/** Cofre do refresh token do login (adaptador local: chaveiro do Tauri, somente leitura). Adaptador AWS ainda pendente. */
export abstract class CredentialStore {
  abstract get(ownerId: string): Promise<string | null>;
}

export class MemoryCredentialStore extends CredentialStore {
  private readonly tokens = new Map<string, string>();
  async get(ownerId: string) { return this.tokens.get(ownerId) ?? null; }
  async put(ownerId: string, refreshToken: string) { this.tokens.set(ownerId, refreshToken); }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** `sub` do ID token recebido direto do token endpoint por TLS: a OIDC dispensa verificar a assinatura nesse caso. */
function idTokenSubject(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub !== "" ? claims.sub : null;
  } catch { return null; }
}

/** Implementação HTTP. O segredo do cliente do login vem do ambiente do servidor e nunca sai dele. */
export class HttpGoogleOAuth extends GoogleOAuth {
  constructor(private readonly config: { clientId: string; clientSecret: string }, private readonly doFetch: FetchLike = fetch) { super(); }

  async refreshAccessToken(refreshToken: string): Promise<AccessToken> {
    let response: Response;
    try {
      response = await this.doFetch(TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) { throw new GoogleApiError("unavailable", undefined, { cause: error }); }
    // `invalid_grant` (revogado ou expirado) e 400/401 exigem novo login; 5xx é transitório.
    if (!response.ok) throw new GoogleApiError(response.status >= 500 ? "unavailable" : response.status === 429 ? "rate_limited" : "unauthorized", undefined, { status: response.status });
    const body = await response.json() as Record<string, unknown>;
    const subject = idTokenSubject(body.id_token);
    if (typeof body.access_token !== "string" || typeof body.scope !== "string" || !subject) throw new GoogleApiError("invalid");
    return { accessToken: body.access_token, expiresInSec: typeof body.expires_in === "number" ? body.expires_in : 300, scopes: body.scope.split(" "), subject };
  }
}

export type TokenGrantInfo = { accessToken: string; scopes: readonly string[] };

/** Access token em memória por proprietário, renovado pelo refresh token do cofre; nada vai a disco. */
export class AccessTokenSource {
  private readonly cache = new Map<string, { token: string; expiresAt: number; refreshToken: string; scopes: readonly string[] }>();
  constructor(private readonly oauth: GoogleOAuth, private readonly credentials: CredentialStore, private readonly now: () => number = Date.now) {}

  async get(ownerId: string): Promise<string> {
    return (await this.grant(ownerId)).accessToken;
  }

  /** Access token e escopos concedidos ao refresh token do login. */
  async grant(ownerId: string): Promise<TokenGrantInfo> {
    const refreshToken = await this.credentials.get(ownerId);
    if (!refreshToken) throw new GoogleApiError("unauthorized");
    const cached = this.cache.get(ownerId);
    if (cached?.refreshToken === refreshToken && cached.expiresAt - 30_000 > this.now()) return { accessToken: cached.token, scopes: cached.scopes };
    const refreshed = await this.oauth.refreshAccessToken(refreshToken);
    // O chaveiro do login guarda um único token; só vale para o proprietário autenticado que o emitiu.
    if (refreshed.subject !== ownerId) throw new GoogleApiError("unauthorized");
    this.cache.set(ownerId, { token: refreshed.accessToken, expiresAt: this.now() + refreshed.expiresInSec * 1000, refreshToken, scopes: refreshed.scopes });
    return { accessToken: refreshed.accessToken, scopes: refreshed.scopes };
  }

  invalidate(ownerId: string) { this.cache.delete(ownerId); }
}
