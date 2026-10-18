import { AppError } from "../domain/app-error.js";

export type Principal = { readonly ownerId: string };

export function requirePrincipal(value: unknown): Principal {
  if (typeof value !== "object" || value === null || !("ownerId" in value) || typeof value.ownerId !== "string" || value.ownerId.trim() === "") {
    throw new AppError(401, "UNAUTHORIZED", "Autenticação necessária.");
  }
  return { ownerId: value.ownerId };
}
