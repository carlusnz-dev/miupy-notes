// Harness local para ensaiar smoke.sh/security.sh sem AWS: sobe o app Express REAL (rotas, validação e logs)
// contra o DynamoDB Local, com um JWKS gerado na hora no lugar do JWKS do Google.
// Não substitui o API Gateway (CORS, JWT authorizer, throttling) nem a Lambda; só ensaia o contrato do app.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "../../apps/api/src/app.js";
import { createDataModules } from "../../apps/api/src/compose.js";
import { authenticate, bearerTokenClaims, parseAllowedSubs } from "../../apps/api/src/core/http/authenticate.js";
import { createDynamoClient } from "../../apps/api/src/core/dynamo/client.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Defina ${name}.`);
  return value;
}

const endpoint = new URL(required("DYNAMODB_ENDPOINT"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("DYNAMODB_ENDPOINT deve apontar para o DynamoDB Local.");
const tokenDir = required("MIUPY_LOCAL_TOKEN_DIR");
const port = Number(required("MIUPY_LOCAL_PORT"));

const audience = "local-validacao.apps.googleusercontent.com";
const subs = { main: "local-sub-principal", b: "local-sub-b", forbidden: "local-sub-fora-da-allowlist" };
const { publicKey, privateKey } = await generateKeyPair("RS256");
const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", use: "sig", kid: "local" }] });

async function mint(sub: string, options: { aud?: string; issuedAgo?: number; ttl?: number } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "local" })
    .setIssuer("https://accounts.google.com")
    .setAudience(options.aud ?? audience)
    .setSubject(sub)
    .setIssuedAt(now - (options.issuedAgo ?? 0))
    .setExpirationTime(now - (options.issuedAgo ?? 0) + (options.ttl ?? 3600))
    .sign(privateKey);
}

// Tokens em arquivos 0600; o conteúdo nunca vai para stdout.
mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
const tokens: Record<string, string> = {
  main: await mint(subs.main),
  b: await mint(subs.b),
  forbidden: await mint(subs.forbidden),
  expired: await mint(subs.main, { issuedAgo: 7200, ttl: 3600 }),
  wrongaud: await mint(subs.main, { aud: "outro-client.apps.googleusercontent.com" }),
};
for (const [name, token] of Object.entries(tokens)) writeFileSync(join(tokenDir, `${name}.jwt`), token, { mode: 0o600 });

const { notes, folders, finance, calendar, library } = createDataModules(createDynamoClient(endpoint.href), required("NOTES_TABLE_NAME"));
const app = createApp({
  authenticate: authenticate(bearerTokenClaims(keySet, audience), parseAllowedSubs(`${subs.main},${subs.b}`)),
  notesRouter: notes.router,
  foldersRouter: folders.router,
  financeRouter: finance.router,
  calendarRouter: calendar.router,
  libraryRouter: library.router,
});
app.listen(port, "127.0.0.1", () => process.stdout.write(`{"event":"harness.listening","port":${port}}\n`));
