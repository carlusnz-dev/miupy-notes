import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, formatDateTime } from './dates';

test('data do calendário não escorrega de dia por fuso', () => {
  assert.equal(formatDate('2026-08-25'), '25/08/2026');
  assert.equal(formatDate('2026-01-01'), '01/01/2026');
});
test('instante sai em pt-BR sem segundos', () => {
  assert.match(formatDateTime('2026-08-25T18:46:00'), /^25\/08\/2026,? 18:46$/);
});
