/** Decodifica o payload de um JWT só para leitura local (nome, e-mail, `sub`); a assinatura é validada pela API. */
export function decodeIdTokenPayload(token: string): unknown {
  const segment = token.split(".")[1];
  if (!segment) throw new Error("Perfil indisponível.");
  const binary = atob(segment.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Identificador estável da conta Google (`sub`); separa os rascunhos locais de cada conta. */
export function ownerIdFromToken(token: string): string | null {
  const payload = decodeIdTokenPayload(token) as { sub?: unknown };
  return typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : null;
}
