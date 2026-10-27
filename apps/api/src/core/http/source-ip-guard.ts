import { BlockList, isIP } from "node:net";
import type { Request, RequestHandler } from "express";
import { ConfigurationError } from "../domain/app-error.js";
import { logger, type Logger } from "../logging/logger.js";
import { sendError } from "./error-handler.js";
import { requestMethod, requestRoute } from "./request-logger.js";

type GatewayRequest = Request & { requestContext?: { http?: { sourceIp?: unknown } } };

/**
 * Lê `ALLOWED_CIDRS` (IPv4/IPv6 separados por vírgula; IP sem prefixo vale /32 ou /128).
 * Lista vazia, entrada inválida ou prefixo /0 falham a inicialização: sem lista, nada é atendido.
 * As mensagens citam só a posição da entrada, nunca o valor.
 */
export function parseAllowedCidrs(value: string | undefined): BlockList {
  const entries = (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new ConfigurationError("ALLOWED_CIDRS", "ALLOWED_CIDRS deve conter ao menos um CIDR.");
  const list = new BlockList();
  entries.forEach((entry, index) => {
    const [address = "", prefixText, extra] = entry.split("/");
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    const prefix = prefixText === undefined ? maxPrefix : /^\d{1,3}$/.test(prefixText) ? Number(prefixText) : NaN;
    if (!family || extra !== undefined || !(prefix >= 1 && prefix <= maxPrefix)) {
      throw new ConfigurationError("ALLOWED_CIDRS", `ALLOWED_CIDRS: a entrada ${index + 1} não é um CIDR IPv4/IPv6 válido com prefixo de 1 a ${maxPrefix}.`);
    }
    list.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  });
  return list;
}

/** Mantém só a rede (IPv4: 2 octetos; IPv6: 2 grupos) para correlacionar bloqueios sem registrar o endereço completo. */
export function maskIp(ip: string): string {
  return isIP(ip) === 4 ? `${ip.split(".").slice(0, 2).join(".")}.*.*` : `${ip.split(":").slice(0, 2).join(":")}:*`;
}

/**
 * Primeiro middleware da Lambda: só `requestContext.http.sourceIp` (preenchido pelo API Gateway) conta;
 * `X-Forwarded-For` é ignorado. IP ausente, inválido ou fora da lista → 403 antes de qualquer rota, inclusive `/health`.
 */
export function sourceIpGuard(allowed: BlockList, log: Logger = logger): RequestHandler {
  return (req, res, next) => {
    const sourceIp = (req as GatewayRequest).requestContext?.http?.sourceIp;
    const family = typeof sourceIp === "string" ? isIP(sourceIp) : 0;
    if (typeof sourceIp === "string" && family && allowed.check(sourceIp, family === 4 ? "ipv4" : "ipv6")) return next();
    log.warn("request.denied", {
      requestId: res.locals.requestId as string, method: requestMethod(req), route: requestRoute(req, res), statusCode: 403, module: "source-ip-guard",
      operation: "check ALLOWED_CIDRS", reason: family ? "source_ip_not_allowed" : "source_ip_invalid", source: family ? maskIp(sourceIp as string) : undefined,
    });
    sendError(res, 403, "ORIGIN_NOT_ALLOWED", "Origem de rede não permitida.");
  };
}
