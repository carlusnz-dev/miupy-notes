import { AccessTokenSource, HttpGoogleOAuth } from "./google-oauth.js";
import { HttpGoogleCalendarClient } from "./http-google-calendar.client.js";
import { SecretServiceCredentialStore } from "./secret-service-credential.store.js";
import type { GoogleIntegrationDeps } from "../services/google-integration.service.impl.js";

/** Só a composição local chama esta factory. Lambda permanece sem cofre até haver um adaptador AWS aprovado. */
export function createLocalGoogleIntegration(env: Record<string, string | undefined>): GoogleIntegrationDeps | null {
  if (env.GOOGLE_CALENDAR_CREDENTIAL_STORE === undefined && env.GOOGLE_CALENDAR_CLIENT_ID === undefined && env.GOOGLE_CALENDAR_CLIENT_SECRET === undefined) return null;
  const loginClientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientId = (env.GOOGLE_CALENDAR_CLIENT_ID ?? loginClientId)?.trim();
  if (env.GOOGLE_CALENDAR_CREDENTIAL_STORE?.trim() !== "secret-service" || !clientId) {
    throw new Error("Configure GOOGLE_CALENDAR_CREDENTIAL_STORE=secret-service e GOOGLE_CALENDAR_CLIENT_ID ou GOOGLE_CLIENT_ID na API local.");
  }
  // Um override de cliente nunca usa o segredo de outra identidade OAuth.
  const clientSecret = (env.GOOGLE_CALENDAR_CLIENT_SECRET ?? (clientId === loginClientId ? env.GOOGLE_CLIENT_SECRET : undefined))?.trim() ?? "";
  const credentials = new SecretServiceCredentialStore();
  const oauth = new HttpGoogleOAuth({ clientId, clientSecret });
  const tokens = new AccessTokenSource(oauth, credentials);
  return { oauth, credentials, client: new HttpGoogleCalendarClient({ tokens }) };
}
