import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GetCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { transactionOutputSchema, type TransactionInput } from '../contract.js';
import { DynamoFinanceRepository } from './dynamo-finance.repository.js';

const input: TransactionInput = {title:'Legado',amountCents:100,currency:'BRL',direction:'expense',date:'2026-10-19',category:'Casa',tags:[],bankId:null,source:'Manual',link:'none',linkedMonth:null,paymentMethod:'card'};
const legacy = {...input,id:randomUUID(),bankTitle:null,createdAt:'2026-10-19T00:00:00.000Z',updatedAt:'2026-10-19T00:00:00.000Z',version:1};
test('schema de saída normaliza parcela ausente de payload antigo para null',() => {
  assert.equal('installmentCount' in legacy,false);
  assert.equal(transactionOutputSchema.parse(legacy).installmentCount,null);
});
test('leitura e lista Dynamo normalizam item legado sem migrar nem mudar a partição',async () => {
  const stored = {...legacy,pk:'USER#alice',sk:`FINANCE#transaction#${legacy.id}`,ownerId:'alice',kind:'transaction'};
  const client = {send:async (command: GetCommand | QueryCommand) => {
    if (command instanceof GetCommand) { assert.equal(command.input.Key?.pk,'USER#alice'); return {Item:stored}; }
    assert.equal(command.input.ExpressionAttributeValues?.[':pk'],'USER#alice'); return {Items:[stored]};
  }} as unknown as DynamoDBDocumentClient;
  const repository = new DynamoFinanceRepository(client,'synthetic');
  const record = await repository.findById('alice',legacy.id);
  assert.equal(record?.data.kind,'transaction');
  if (record?.data.kind !== 'transaction') throw new Error('Lançamento esperado.');
  assert.equal(record.data.installmentCount,null);
  const listed = (await repository.list('alice','transaction',50)).items[0];
  if (listed.data.kind !== 'transaction') throw new Error('Lançamento esperado.');
  assert.equal(listed.data.installmentCount,null);
});
