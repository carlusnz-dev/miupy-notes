import { AccessTokenSource, HttpGoogleOAuth, type CredentialStore } from "./google-oauth.js";
import { HttpGoogleCalendarClient } from "./http-google-calendar.client.js";
import { LoginCredentialStore } from "./login-credential.store.js";
import type { GoogleIntegrationDeps } from "../services/google-integration.service.impl.js";

const MISCONFIGURED = "Configure GOOGLE_CALENDAR_CREDENTIAL_STORE=login-keyring e GOOGLE_CLIENT_ID na API local. GOOGLE_CALENDAR_CLIENT_ID e GOOGLE_CALENDAR_CLIENT_SECRET não são mais usados: o Calendar reutiliza o cliente do login.";

/** Só a composição local chama esta factory. Lambda permanece sem cofre até haver um adaptador AWS aprovado. */
export function createLocalGoogleIntegration(env: Record<string, string | undefined>, credentials: CredentialStore = new LoginCredentialStore()): GoogleIntegrationDeps | null {
  const legacy = env.GOOGLE_CALENDAR_CLIENT_ID !== undefined || env.GOOGLE_CALENDAR_CLIENT_SECRET !== undefined;
  if (env.GOOGLE_CALENDAR_CREDENTIAL_STORE === undefined && !legacy) return null;
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (env.GOOGLE_CALENDAR_CREDENTIAL_STORE?.trim() !== "login-keyring" || legacy || !clientId) throw new Error(MISCONFIGURED);
  // O refresh token pertence ao cliente do login: renová-lo exige o mesmo par de credenciais.
  const oauth = new HttpGoogleOAuth({ clientId, clientSecret: env.GOOGLE_CLIENT_SECRET?.trim() ?? "" });
  const tokens = new AccessTokenSource(oauth, credentials);
  return { tokens, client: new HttpGoogleCalendarClient({ tokens }) };
}
