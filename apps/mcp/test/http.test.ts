import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { createApiClient } from "../src/api-client.js";
import { createHttpApp, type VerifiedAuth } from "../src/http.js";
import { parse, startTestApi, tokenFor, type TestApi } from "./support.js";

const ISSUER = "https://auth.example.test";
let RESOURCE = "";

let api: TestApi;
let server: Server;
let base = "";
let key: CryptoKey;
let foreignKey: CryptoKey;
const exchanged: VerifiedAuth[] = [];

before(async () => {
  api = await startTestApi();
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  foreignKey = (await generateKeyPair("RS256")).privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Porta indisponível.");
  base = `http://127.0.0.1:${address.port}`;
  RESOURCE = `${base}/mcp`;
  server.on("request", createHttpApp({
    resource: RESOURCE,
    issuer: ISSUER,
    jwks,
    logger: () => {},
    // Troca de teste: o sub vira o dono da API de teste. A troca real é a decisão pendente (docs/arquitetura/mcp.md).
    apiClientFor: (auth) => { exchanged.push(auth); return createApiClient({ baseUrl: api.url, token: () => tokenFor(auth.subject) }); },
  }));
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await api.close();
});

type TokenOptions = { sub?: string; scope?: string; aud?: string; iss?: string; exp?: string; key?: CryptoKey };
const token = (options: TokenOptions = {}) => new SignJWT({ scope: options.scope ?? "notes:read notes:write" })
  .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(options.sub ?? "http-owner").setIssuer(options.iss ?? ISSUER)
  .setAudience(options.aud ?? RESOURCE).setIssuedAt().setExpirationTime(options.exp ?? "1h").sign(options.key ?? key);

const post = (headers: Record<string, string>, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) =>
  fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });

// O fetch não deixa trocar o Host; http.request deixa, para simular um Host forjado.
const withHost = (host: string, authorization: string) => new Promise<number>((resolve, reject) => {
  const req = httpRequest(`${base}/mcp`, { method: "POST", headers: { host, authorization, "content-type": "application/json", accept: "application/json, text/event-stream" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
  req.on("error", reject);
  req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
});

const rpc = (name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });

test("sem token: 401 com WWW-Authenticate apontando para os metadados do recurso", async () => {
  const response = await post({});
  assert.equal(response.status, 401);
  const header = response.headers.get("www-authenticate") ?? "";
  assert.match(header, /^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.match(header, /scope="notes:read notes:write"/);
  assert.ok(!(await response.text()).includes("jose"), "sem detalhes internos");
});

test("token expirado, audiência errada, emissor errado e chave de outro emissor: 401 invalid_token", async () => {
  const bad = [await token({ exp: "-1m" }), await token({ aud: "https://outro.example.test/mcp" }), await token({ iss: "https://evil.example.test" }), await token({ key: foreignKey }), "lixo.lixo.lixo"];
  for (const value of bad) {
    const response = await post({ authorization: `Bearer ${value}` });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
  }
});

test("serve os metadados RFC 9728 sem exigir token", async () => {
  for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    const document = await response.json() as Record<string, unknown>;
    assert.equal(document.resource, RESOURCE);
    assert.deepEqual(document.authorization_servers, [ISSUER]);
    assert.deepEqual(document.scopes_supported, ["notes:read", "notes:write"]);
  }
});

test("rejeita Host e Origin inesperados (DNS rebinding) e métodos que não são POST", async () => {
  const valid = `Bearer ${await token()}`;
  assert.equal(await withHost("evil.example.test", valid), 403);
  assert.equal((await post({ authorization: valid, origin: "https://evil.example.test" })).status, 403);
  const get = await fetch(`${base}/mcp`, { headers: { authorization: valid } });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  const del = await fetch(`${base}/mcp`, { method: "DELETE", headers: { authorization: valid, "mcp-session-id": "x" } });
  assert.equal(del.status, 405);
});

test("autorização por operação: escopo de leitura não executa escrita (403 insufficient_scope)", async () => {
  const readOnly = `Bearer ${await token({ scope: "notes:read" })}`;
  const denied = await post({ authorization: readOnly }, rpc("notes_create", { title: "x" }));
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get("www-authenticate") ?? "", /error="insufficient_scope", scope="notes:write"/);
  const batch = await post({ authorization: readOnly }, [rpc("notes_search", {}), rpc("notes_update", { noteId: "x", expectedVersion: 1, title: "y" })]);
  assert.equal(batch.status, 403, "lote com uma operação de escrita também é negado");
  assert.equal((await post({ authorization: readOnly }, rpc("notes_search", {}))).status, 200);
  assert.equal(api.requests.filter((request) => request.method === "POST").length, 0, "nada foi escrito");
});

test("corpo acima do limite e JSON malformado são rejeitados", async () => {
  const valid = `Bearer ${await token()}`;
  const huge = await post({ authorization: valid }, { jsonrpc: "2.0", id: 1, method: "tools/list", params: { x: "a".repeat(600_000) } });
  assert.equal(huge.status, 413);
  const malformed = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: valid, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{" });
  assert.equal(malformed.status, 400);
});

test("fluxo completo via cliente MCP: stateless, identidade vem do token validado", async () => {
  const client = new Client({ name: "teste", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await token({ sub: "alice-http" })}` } } });
  await client.connect(transport);
  assert.equal(transport.sessionId, undefined, "servidor não cria sessão");
  assert.equal((await client.listTools()).tools.length, 5);
  const created = parse(await client.callTool({ name: "notes_create", arguments: { title: "Via HTTP", body: "corpo" } }));
  assert.equal(created.isError, false);
  assert.equal(exchanged.at(-1)?.subject, "alice-http");

  const other = new Client({ name: "teste", version: "0" });
  await other.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${await token({ sub: "bob-http" })}` } } }));
  const mine = parse(await client.callTool({ name: "notes_search", arguments: {} }));
  const theirs = parse(await other.callTool({ name: "notes_search", arguments: {} }));
  assert.equal(mine.data.items.length, 1);
  assert.equal(theirs.data.items.length, 0, "isolamento entre usuários no HTTP");
  assert.equal(parse(await other.callTool({ name: "notes_get", arguments: { noteId: created.data.note.id } })).data.error.code, "NOT_FOUND");
  await client.close();
  await other.close();
});
