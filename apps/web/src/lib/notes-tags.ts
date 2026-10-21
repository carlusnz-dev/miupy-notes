/** `#ideia` e `ideia` são a mesma tag; só o `#` inicial é descartado. */
export function normalizeTag(raw: string, maxLength: number): string {
  return raw.trim().replace(/^#+/, "").slice(0, maxLength);
}

/** Separadores que confirmam uma tag: espaço (qualquer), vírgula e quebra de linha. */
export const TAG_SEPARATOR = /[\s,]+/;

/**
 * Acrescenta `tokens` a `current` sem duplicar (sem diferenciar maiúsculas) e respeitando o limite.
 * `added` e `skipped` alimentam a mensagem anunciada ao leitor de tela.
 */
export function mergeTags(current: string[], tokens: string[], maxTags: number, maxLength: number) {
  const next = [...current];
  const added: string[] = [];
  const skipped: string[] = [];
  for (const token of tokens.map((item) => normalizeTag(item, maxLength)).filter(Boolean)) {
    if (next.some((tag) => tag.toLowerCase() === token.toLowerCase()) || next.length >= maxTags) skipped.push(token);
    else { next.push(token); added.push(token); }
  }
  return { next, added, skipped };
}

/** Divide o texto digitado em tags completas e o rascunho que ainda está sendo escrito. */
export function splitDraft(text: string): { complete: string[]; rest: string } {
  const parts = text.split(TAG_SEPARATOR);
  const rest = /[\s,]$/.test(text) ? "" : parts.pop() ?? "";
  return { complete: parts.filter(Boolean), rest };
}
