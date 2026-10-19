export function parseCents(value: string): number | null {
  if (!/^\d{1,11}([.,]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000_000_000 ? cents : null;
}
export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

// Entrada de valor com formatação ao vivo: o rascunho guarda só dígitos (inteiro + fração), sem float.
export type MoneyDraft = { int: string; frac: string | null };
const MAX_INT_DIGITS = 10; // parseCents aceita até 10.000.000.000,00
export const emptyDraft: MoneyDraft = { int: '', frac: null };
export type DraftResult = { draft: MoneyDraft; error?: undefined } | { draft?: undefined; error: string };

export function currencyPrefix(currency: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency;
}
export function draftFromCents(cents: number | null): MoneyDraft {
  if (cents === null) return emptyDraft;
  return { int: String(Math.floor(cents / 100)), frac: String(cents % 100).padStart(2, '0') };
}
export function draftToCents(draft: MoneyDraft): number | null {
  if (!draft.int && draft.frac === null) return null;
  return Number(draft.int || '0') * 100 + Number((draft.frac ?? '').padEnd(2, '0'));
}
export function formatDraft(draft: MoneyDraft) {
  const int = draft.int.replace(/\B(?=(\d{3})+$)/g, '.');
  return draft.frac === null ? int : `${int || '0'},${draft.frac}`;
}
/** Ao sair do campo: valor completo com duas casas ("67" vira "67,00"). */
export function completeDraft(draft: MoneyDraft): MoneyDraft {
  if (!draft.int && draft.frac === null) return draft;
  return { int: draft.int || '0', frac: (draft.frac ?? '').padEnd(2, '0') };
}
function build(intDigits: string, frac: string | null): DraftResult {
  const int = intDigits.replace(/^0+(?=\d)/, '');
  if (int.length > MAX_INT_DIGITS) return { error: 'O valor máximo é 10.000.000.000,00.' };
  if (frac !== null && frac.length > 2) return { error: 'Use no máximo duas casas decimais.' };
  return { draft: { int, frac } };
}
/** Texto digitado/editado (já com os pontos de milhar do formato): vírgula separa decimais; `keypadDot` trata "." digitado como vírgula. */
export function parseTyped(raw: string, keypadDot = false): DraftResult {
  const text = raw.replace(/R\$|US\$|€|\s|\u00a0/g, '');
  if (!text) return { draft: emptyDraft };
  if (/[^\d.,]/.test(text)) return { error: 'Use apenas números e vírgula; valores negativos não são aceitos.' };
  const source = keypadDot && !text.includes(',') && text.endsWith('.') ? text.slice(0, -1) + ',' : text;
  const comma = source.indexOf(',');
  const intPart = (comma < 0 ? source : source.slice(0, comma)).replace(/\./g, '');
  const fracPart = comma < 0 ? null : source.slice(comma + 1).replace(/[.,]/g, '');
  return build(intPart, fracPart);
}
/** Texto colado: aceita "R$ 1.234,56", "1234.56", "1,234.56", "12,5". Ponto seguido de 1–2 dígitos é decimal; de 3, milhar. */
export function parsePasted(raw: string): DraftResult {
  const text = raw.replace(/R\$|US\$|€|\s|\u00a0/g, '');
  if (!text || /[^\d.,]/.test(text)) return { error: 'Use apenas números e vírgula; valores negativos não são aceitos.' };
  const lastComma = text.lastIndexOf(','), lastDot = text.lastIndexOf('.');
  let decimalAt = -1;
  if (lastComma >= 0 && lastDot >= 0) decimalAt = Math.max(lastComma, lastDot);
  else if (lastComma >= 0 && text.indexOf(',') === lastComma) decimalAt = lastComma;
  else if (lastDot >= 0 && text.indexOf('.') === lastDot && text.length - lastDot - 1 <= 2) decimalAt = lastDot;
  const intPart = (decimalAt < 0 ? text : text.slice(0, decimalAt)).replace(/[.,]/g, '');
  const fracPart = decimalAt < 0 ? null : text.slice(decimalAt + 1);
  if (fracPart !== null && /[.,]/.test(fracPart)) return { error: 'Valor com formato inválido.' };
  return build(intPart, fracPart);
}
