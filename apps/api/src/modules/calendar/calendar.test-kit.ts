import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { errorHandler } from "../../core/http/error-handler.js";
import { CalendarController } from "./controllers/calendar.controller.js";
import { FakeGoogleCalendarClient } from "./google/fake-google-calendar.client.js";
import { GoogleOAuth, MemoryCredentialStore, type AccessToken, type TokenGrant } from "./google/google-oauth.js";
import { MemoryCalendarRepository } from "./repository/memory-calendar.repository.js";
import { createCalendarRouter } from "./routes/calendar.routes.js";
import { CalendarServiceImpl } from "./services/calendar.service.impl.js";
import { GoogleIntegrationServiceImpl } from "./services/google-integration.service.impl.js";

/** OAuth falso: o "Google" concede os escopos configurados e registra revogações. */
export class FakeGoogleOAuth extends GoogleOAuth {
  grantedScopes: string[] | null = null;
  readonly revoked: string[] = [];
  nextExchangeError: Error | null = null;
  authorizationUrl({ state, scopes }: { state: string; codeChallenge: string; redirectUri: string; scopes: readonly string[] }) {
    return `https://accounts.example.test/auth?state=${state}&scope=${encodeURIComponent(scopes.join(" "))}`;
  }
  async exchangeCode(): Promise<TokenGrant> {
    if (this.nextExchangeError) throw this.nextExchangeError;
    return { refreshToken: "refresh-secret", scopes: this.grantedScopes ?? [] };
  }
  async refreshAccessToken(): Promise<AccessToken> { return { accessToken: "access", expiresInSec: 3600 }; }
  async revoke(token: string) { this.revoked.push(token); }
}

export const knownNote = "0b5d6f7e-1c2a-4b3d-8e9f-a0b1c2d3e4f5";

export function createKit(options: { configured?: boolean; now?: () => Date } = {}) {
  const repository = new MemoryCalendarRepository();
  const google = new FakeGoogleCalendarClient();
  const oauth = new FakeGoogleOAuth();
  const credentials = new MemoryCredentialStore();
  const deps = options.configured === false ? null : { oauth, credentials, client: google };
  const service = new CalendarServiceImpl(repository, { exists: async (owner, id) => owner === "alice" && id === knownNote });
  const integration = new GoogleIntegrationServiceImpl(repository, deps, options.now);
  return { repository, google, oauth, credentials, service, integration };
}

/** Principal falso só no teste, como nas rotas de notas. */
export function createTestServer(kit: ReturnType<typeof createKit>): Server {
  const app = express();
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    const owner = req.header("x-test-owner");
    if (owner) res.locals.principal = { ownerId: owner };
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use("/v1/calendar", createCalendarRouter(new CalendarController(kit.service, kit.integration)));
  app.use(errorHandler);
  return createServer(app);
}
