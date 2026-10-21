import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCents, formatMoney, parseTyped, parsePasted, formatDraft, draftFromCents, draftToCents, completeDraft, currencyPrefix } from './money';
test('entrada monetária vira centavos sem arredondamento implícito', () => {
  for (const [text,cents] of [['0,01',1],['12.34',1234],['10',1000],['1,2',120],['10000000000',1_000_000_000_000]] as const) assert.equal(parseCents(text),cents);
  for (const text of ['0','-1','1.234','1e3','Infinity','1.000,00','','10000000000.01']) assert.equal(parseCents(text),null);
  assert.match(formatMoney(1234,'BRL'),/12,34/);
});

const shown = (result: ReturnType<typeof parsePasted>) => result.draft ? formatDraft(result.draft) : result.error;
test('digitação formata milhar e decimais ao vivo', () => {
  assert.equal(shown(parseTyped('1234')), '1.234');
  assert.equal(shown(parseTyped('1.234,5')), '1.234,5');
  assert.equal(shown(parseTyped('0,')), '0,');
  assert.equal(shown(parseTyped(',5')), '0,5');
  assert.equal(shown(parseTyped('007')), '7');
  assert.equal(shown(parseTyped('12.', true)), '12,');
  assert.equal(shown(parseTyped('')), '');
});
test('digitação rejeita letras, sinal, excesso de casas e de dígitos', () => {
  for (const text of ['-5', '12a', '1e3', '1,234', '12345678901', '1,2,3x']) assert.ok(parseTyped(text).error, text);
});
test('colagem aceita formatos pt-BR e en-US', () => {
  for (const [text, shownValue] of [['R$ 1.234,56', '1.234,56'], ['1234.56', '1.234,56'], ['1,234.56', '1.234,56'], ['12,5', '12,5'], ['1.234', '1.234'], ['1.234.567,89', '1.234.567,89'], ['0,01', '0,01']] as const) assert.equal(shown(parsePasted(text)), shownValue, text);
  for (const text of ['-1,00', 'abc', '', '1,2,3,4x', '12.345,678']) assert.ok(parsePasted(text).error, text);
});
test('rascunho preserva centavos exatos e completa casas ao sair', () => {
  for (const cents of [1, 99, 100, 123456, 1_000_000_000_000]) assert.equal(draftToCents(draftFromCents(cents)), cents);
  assert.equal(formatDraft(draftFromCents(5)), '0,05');
  assert.equal(draftToCents(completeDraft(parseTyped('67').draft!)), 6700);
  assert.equal(formatDraft(completeDraft(parseTyped('67,1').draft!)), '67,10');
  assert.equal(draftToCents(parseTyped('').draft!), null);
});
test('prefixo da moeda', () => {
  assert.equal(currencyPrefix('BRL'), 'R$');
  assert.equal(currencyPrefix('EUR'), '€');
  assert.match(currencyPrefix('USD'), /\$/);
});
