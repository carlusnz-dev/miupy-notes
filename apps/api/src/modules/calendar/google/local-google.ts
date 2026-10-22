import { AccessTokenSource, HttpGoogleOAuth } from "./google-oauth.js";
import { HttpGoogleCalendarClient } from "./http-google-calendar.client.js";
import { SecretServiceCredentialStore } from "./secret-service-credential.store.js";
import type { GoogleIntegrationDeps } from "../services/google-integration.service.impl.js";

/** Só a composição local chama esta factory. Lambda permanece sem cofre até haver um adaptador AWS aprovado. */
export function createLocalGoogleIntegration(env: Record<string, string | undefined>): GoogleIntegrationDeps | null {
  if (!env.GOOGLE_CALENDAR_CREDENTIAL_STORE && !env.GOOGLE_CALENDAR_CLIENT_ID) return null;
  if (env.GOOGLE_CALENDAR_CREDENTIAL_STORE !== "secret-service" || !env.GOOGLE_CALENDAR_CLIENT_ID?.trim()) {
    throw new Error("Configure GOOGLE_CALENDAR_CLIENT_ID e GOOGLE_CALENDAR_CREDENTIAL_STORE=secret-service na API local.");
  }
  const credentials = new SecretServiceCredentialStore();
  const oauth = new HttpGoogleOAuth({ clientId: env.GOOGLE_CALENDAR_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "" });
  const tokens = new AccessTokenSource(oauth, credentials);
  return { oauth, credentials, client: new HttpGoogleCalendarClient({ tokens }) };
}
