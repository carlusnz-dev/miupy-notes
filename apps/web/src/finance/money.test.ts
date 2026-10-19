import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCents, formatMoney } from './money';
test('entrada monetária vira centavos sem arredondamento implícito', () => {
  for (const [text,cents] of [['0,01',1],['12.34',1234],['10',1000],['1,2',120],['10000000000',1_000_000_000_000]] as const) assert.equal(parseCents(text),cents);
  for (const text of ['0','-1','1.234','1e3','Infinity','1.000,00','','10000000000.01']) assert.equal(parseCents(text),null);
  assert.match(formatMoney(1234,'BRL'),/12,34/);
});
