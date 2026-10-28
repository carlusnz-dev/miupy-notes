import type { Request, RequestHandler } from "express";
import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AppError, ServiceError } from "../domain/app-error.js";
import type { Principal } from "./principal.js";

// O Google documenta as duas formas de `iss` para ID tokens.
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

/** Obtém claims já verificadas da requisição. É o ponto de troca entre a API local e a Lambda. */
export type ClaimsSource = (req: Request) => Promise<JWTPayload>;

const unauthorized = () => new AppError(401, "UNAUTHORIZED", "Autenticação necessária.");

/** API local: valida o ID token no próprio Express (assinatura RS256, `iss`, `aud`, `exp`). */
export function bearerTokenClaims(keySet: JWTVerifyGetKey, audience: string): ClaimsSource {
  return async (req) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.header("authorization") ?? "");
    if (!match) throw unauthorized();
    const token = match[1];
    try {
      const { payload } = await jwtVerify(token, keySet, { issuer: GOOGLE_ISSUERS, audience, algorithms: ["RS256"] });
      return payload;
    } catch (error) {
      // Falha ao obter as chaves do Google é indisponibilidade nossa, não token inválido. Resposta não-200 ou JSON ilegível
      // do JWKS chega como `JOSEError` genérico (a classe base, sem subclasse), por isso não pode virar 401.
      if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid || !(error instanceof errors.JOSEError) || error.constructor === errors.JOSEError) {
        throw new ServiceError({ service: "Google (chaves do login)", operation: "validar o ID token" }, error);
      }
      throw unauthorized();
    }
  };
}

type AuthorizerRequest = Request & { requestContext?: { authorizer?: { jwt?: { claims?: JWTPayload } } } };

/** Lambda: o JWT authorizer do API Gateway já validou o token; `lambda.ts` copia `event.requestContext` para a requisição. */
export const lambdaAuthorizerClaims: ClaimsSource = async (req) => {
  const claims = (req as AuthorizerRequest).requestContext?.authorizer?.jwt?.claims;
  if (!claims) throw unauthorized();
  return claims;
};

/** `ownerId` = `sub`. Autenticar não basta: só os `sub` da lista configurada entram. */
export function principalFromClaims(claims: JWTPayload, allowedSubs: ReadonlySet<string>): Principal {
  if (typeof claims.sub !== "string" || claims.sub === "") throw unauthorized();
  if (!allowedSubs.has(claims.sub)) throw new AppError(403, "FORBIDDEN", "Esta conta não tem acesso.");
  return { ownerId: claims.sub };
}

export function parseAllowedSubs(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((sub) => sub.trim()).filter(Boolean));
}

export function authenticate(source: ClaimsSource, allowedSubs: ReadonlySet<string>): RequestHandler {
  return async (req, res, next) => {
    res.locals.principal = principalFromClaims(await source(req), allowedSubs);
    next();
  };
}
