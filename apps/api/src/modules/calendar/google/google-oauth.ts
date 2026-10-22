import { GoogleApiError } from "./google-calendar.client.js";

export const SCOPE_MIRROR = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
export const SCOPE_REFLECT = "https://www.googleapis.com/auth/calendar.events.owned";

export type TokenGrant = { refreshToken: string; scopes: string[] };
export type AccessToken = { accessToken: string; expiresInSec: number };

/** Fluxo OAuth do Calendar, separado do login (que só usa ID token). Escopos mínimos, sem `openid`/perfil. */
export abstract class GoogleOAuth {
  abstract authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string; scopes: readonly string[] }): string;
  abstract exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenGrant>;
  abstract refreshAccessToken(refreshToken: string): Promise<AccessToken>;
  abstract revoke(refreshToken: string): Promise<void>;
}

/** Cofre do refresh token; adaptador local Secret Service, adaptador AWS ainda pendente. */
export abstract class CredentialStore {
  abstract get(ownerId: string): Promise<string | null>;
  abstract put(ownerId: string, refreshToken: string): Promise<void>;
  abstract delete(ownerId: string): Promise<void>;
}

export class MemoryCredentialStore extends CredentialStore {
  private readonly tokens = new Map<string, string>();
  async get(ownerId: string) { return this.tokens.get(ownerId) ?? null; }
  async put(ownerId: string, refreshToken: string) { this.tokens.set(ownerId, refreshToken); }
  async delete(ownerId: string) { this.tokens.delete(ownerId); }
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Implementação HTTP. O segredo do cliente vem do ambiente do servidor e nunca sai dele. */
export class HttpGoogleOAuth extends GoogleOAuth {
  constructor(private readonly config: { clientId: string; clientSecret: string }, private readonly doFetch: FetchLike = fetch) { super(); }

  authorizationUrl({ state, codeChallenge, redirectUri, scopes }: { state: string; codeChallenge: string; redirectUri: string; scopes: readonly string[] }): string {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.config.clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(" "),
      state, code_challenge: codeChallenge, code_challenge_method: "S256",
      // Consentimento próprio e offline; não herda os escopos do login.
      access_type: "offline", prompt: "consent", include_granted_scopes: "false",
    }).toString();
    return url.href;
  }

  async exchangeCode({ code, codeVerifier, redirectUri }: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenGrant> {
    const body = await this.token({ grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: redirectUri });
    if (typeof body.refresh_token !== "string" || typeof body.scope !== "string") throw new GoogleApiError("invalid");
    return { refreshToken: body.refresh_token, scopes: body.scope.split(" ") };
  }

  async refreshAccessToken(refreshToken: string): Promise<AccessToken> {
    const body = await this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (typeof body.access_token !== "string") throw new GoogleApiError("invalid");
    return { accessToken: body.access_token, expiresInSec: typeof body.expires_in === "number" ? body.expires_in : 300 };
  }

  async revoke(refreshToken: string): Promise<void> {
    // Melhor esforço: falhar em revogar não impede desconectar localmente.
    await this.doFetch(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }

  private async token(params: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.doFetch(TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...params }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new GoogleApiError("unavailable"); }
    if (response.ok) return await response.json() as Record<string, unknown>;
    // `invalid_grant` (código vencido/revogado) e 400/401 exigem nova autorização; 5xx é transitório.
    throw new GoogleApiError(response.status >= 500 ? "unavailable" : response.status === 429 ? "rate_limited" : "unauthorized");
  }
}

/** Access token em memória por proprietário, renovado pelo refresh token do cofre; nada vai a disco. */
export class AccessTokenSource {
  private readonly cache = new Map<string, { token: string; expiresAt: number; refreshToken: string }>();
  constructor(private readonly oauth: GoogleOAuth, private readonly credentials: CredentialStore, private readonly now: () => number = Date.now) {}

  async get(ownerId: string): Promise<string> {
    const refreshToken = await this.credentials.get(ownerId);
    if (!refreshToken) throw new GoogleApiError("unauthorized");
    const cached = this.cache.get(ownerId);
    if (cached?.refreshToken === refreshToken && cached.expiresAt - 30_000 > this.now()) return cached.token;
    const { accessToken, expiresInSec } = await this.oauth.refreshAccessToken(refreshToken);
    this.cache.set(ownerId, { token: accessToken, expiresAt: this.now() + expiresInSec * 1000, refreshToken });
    return accessToken;
  }

  invalidate(ownerId: string) { this.cache.delete(ownerId); }
}
