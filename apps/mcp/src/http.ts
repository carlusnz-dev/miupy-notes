import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import { errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { ApiClient } from "./api-client.js";
import { log, type Logger } from "./log.js";
import { createMcpServer } from "./server.js";
import { toolScopes } from "./tools.js";

/** Identidade validada de uma requisição. Não carrega o token recebido: ele nunca deve seguir para a API (sem token passthrough). */
export type VerifiedAuth = { subject: string; scopes: ReadonlySet<string> };

export type HttpAppOptions = {
  /** URL canônica do recurso MCP, ex.: `https://mcp.exemplo.com/mcp`. É a `aud` esperada nos tokens. */
  resource: string;
  /** Emissor do servidor de autorização que assina os tokens do MCP (não é o Google da API). */
  issuer: string;
  jwks: JWTVerifyGetKey;
  scopesSupported?: readonly string[];
  /**
   * Troca a identidade validada pelo cliente da API do próprio usuário. É a decisão de arquitetura pendente
   * (ver docs/arquitetura/mcp.md): o ID token do Google da API não tem o MCP como audiência e repassar o token
   * recebido é proibido pela spec MCP. Sem implementação aqui por definição.
   */
  apiClientFor: (auth: VerifiedAuth) => ApiClient | Promise<ApiClient>;
  /** Origens de navegador aceitas. Padrão: nenhuma (clientes de servidor não enviam `Origin`). */
  allowedOrigins?: readonly string[];
  /** Teto do corpo JSON-RPC. Uma nota de 100 000 caracteres chega a ~400 kB em UTF-8. */
  bodyLimit?: string;
  logger?: Logger;
};

const SCOPES = ["notes:read", "notes:write"];

const jsonRpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

export function createHttpApp(options: HttpAppOptions) {
  const resource = new URL(options.resource);
  const scopesSupported = [...(options.scopesSupported ?? SCOPES)];
  const logger = options.logger ?? log;
  const mcpPath = resource.pathname;
  const metadataPath = `/.well-known/oauth-protected-resource${mcpPath === "/" ? "" : mcpPath}`;
  const metadataUrl = new URL(metadataPath, resource).href;

  const challenge = (params: string) => `Bearer resource_metadata="${metadataUrl}"${params}`;
  const unauthorized = (res: Response, invalid: boolean) => {
    res.set("WWW-Authenticate", challenge(`, scope="${scopesSupported.join(" ")}"${invalid ? ', error="invalid_token"' : ""}`));
    res.status(401).json(jsonRpcError(-32001, "Autenticação necessária."));
  };

  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  // Metadados RFC 9728: o cliente descobre aqui qual servidor de autorização emite os tokens deste recurso.
  const metadata: RequestHandler = (_req, res) => {
    res.json({ resource: options.resource, authorization_servers: [options.issuer], scopes_supported: scopesSupported, bearer_methods_supported: ["header"], resource_name: "Miupy Notes" });
  };
  app.get(metadataPath, metadata);
  if (metadataPath !== "/.well-known/oauth-protected-resource") app.get("/.well-known/oauth-protected-resource", metadata);

  // DNS rebinding: Host precisa ser o do recurso e `Origin`, quando presente, precisa estar na lista.
  const origin: RequestHandler = (req, res, next) => {
    const value = req.header("origin");
    if (value !== undefined && !options.allowedOrigins?.includes(value)) {
      res.status(403).json(jsonRpcError(-32000, "Origem não permitida."));
      return;
    }
    next();
  };

  const authenticate: RequestHandler = async (req, res, next) => {
    const [scheme, token] = (req.header("authorization") ?? "").split(" ");
    if (scheme !== "Bearer" || !token) return unauthorized(res, false);
    try {
      const { payload } = await jwtVerify(token, options.jwks, { issuer: options.issuer, audience: options.resource, algorithms: ["RS256", "ES256"] });
      if (typeof payload.sub !== "string" || payload.sub === "") return unauthorized(res, true);
      const claim = payload.scope ?? payload.scp;
      const scopes = new Set(Array.isArray(claim) ? claim.map(String) : typeof claim === "string" ? claim.split(" ").filter(Boolean) : []);
      res.locals.auth = { subject: payload.sub, scopes } satisfies VerifiedAuth;
      next();
    } catch (error) {
      // Falha ao obter as chaves é indisponibilidade nossa; qualquer outra falha de verificação é token inválido.
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout) && !(error instanceof errors.JWKSInvalid)) return unauthorized(res, true);
      throw error;
    }
  };

  // Autorização por operação: confere o escopo da ferramenta antes de despachar, respondendo 403 + insufficient_scope.
  const authorize: RequestHandler = (req, res, next) => {
    const auth = res.locals.auth as VerifiedAuth;
    const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
    for (const message of messages) {
      const call = message as { method?: unknown; params?: { name?: unknown } } | null;
      const required = call?.method === "tools/call" && typeof call.params?.name === "string" ? toolScopes.get(call.params.name) : undefined;
      if (required && !auth.scopes.has(required)) {
        res.set("WWW-Authenticate", challenge(`, error="insufficient_scope", scope="${required}"`));
        res.status(403).json(jsonRpcError(-32003, "Escopo insuficiente."));
        return;
      }
    }
    next();
  };

  const handle = async (req: Request, res: Response) => {
    const auth = res.locals.auth as VerifiedAuth;
    // Stateless: servidor e transporte novos por requisição, sem `Mcp-Session-Id` nem estado em memória.
    const server = createMcpServer({ api: await options.apiClientFor(auth), scopes: auth.scopes, logger });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  app.all(mcpPath, hostHeaderValidation([resource.hostname]), origin, (req, res, next) => {
    if (req.method !== "POST") { res.set("Allow", "POST").status(405).json(jsonRpcError(-32000, "Método não permitido.")); return; }
    next();
  }, authenticate, express.json({ limit: options.bodyLimit ?? "512kb" }), authorize, handle);

  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const name = error instanceof Error ? error.name : "unknown";
    logger("http.failed", { reason: name });
    if (res.headersSent) return;
    const tooLarge = typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
    if (tooLarge) res.status(413).json(jsonRpcError(-32000, "Corpo maior que o permitido."));
    else if (error instanceof SyntaxError) res.status(400).json(jsonRpcError(-32700, "JSON inválido."));
    else res.status(500).json(jsonRpcError(-32603, "Erro interno."));
  };
  app.use(onError);
  return app;
}
