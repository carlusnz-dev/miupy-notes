import { useSyncExternalStore } from "react";

/** Mesmo ponto de corte da barra inferior do shell. */
export const COMPACT_QUERY = "(max-width: 760px)";

const plural = new Intl.PluralRules("pt-BR");

/** "1 obra", "0 obras", "12 obras". Em pt-BR o zero cai na categoria "one", então só o 1 exato fica no singular. */
export function countLabel(count: number) {
  return `${count} ${count === 1 && plural.select(count) === "one" ? "obra" : "obras"}`;
}

export type EmptyKind = "empty-library" | "no-results";

/** Busca ou filtro sem correspondência é diferente de acervo vazio: o CTA muda de "Adicionar obra" para "Limpar filtros". */
export function emptyContent(filtered: boolean, hasMore: boolean) {
  const kind: EmptyKind = filtered ? "no-results" : "empty-library";
  const title = hasMore ? "Nenhuma obra nesta página" : filtered ? "Nenhuma obra encontrada" : "Sua próxima descoberta começa aqui";
  const text = hasMore ? "Continue para a próxima página para ver mais resultados."
    : filtered ? "Nada combina com a busca ou com os filtros atuais. Experimente outro título ou limpe os filtros."
    : "Guarde o que quer conhecer e o que merece ficar na memória.";
  return { kind, title, text, action: filtered ? "Limpar filtros" : "Adicionar obra" };
}

export function useCompact() {
  return useSyncExternalStore(
    notify => { const media = window.matchMedia(COMPACT_QUERY); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); },
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  );
}
