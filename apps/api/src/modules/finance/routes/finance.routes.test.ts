import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Router } from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { createApp } from '../../../app.js';
import { authenticate, bearerTokenClaims } from '../../../core/http/authenticate.js';
import { createDynamoClient } from '../../../core/dynamo/client.js';
import { FinanceRecord, type RecordKind } from '../domain/finance-record.js';
import { FinanceRepository } from '../repository/finance.repository.js';
import { DynamoFinanceRepository } from '../repository/dynamo-finance.repository.js';
import { FinanceServiceImpl, csvCell } from '../services/finance.service.impl.js';
import { FinanceController } from '../controllers/finance.controller.js';
import { createFinanceRouter } from './finance.routes.js';
import type { Transaction, Bank, TransactionInput } from '../contract.js';

class MemoryRepository extends FinanceRepository {
  readonly items = new Map<string, FinanceRecord>();
  key(owner: string, id: string, kind: RecordKind) { return `${owner}:${kind}:${id}`; }
  async create(record: FinanceRecord) { this.items.set(this.key(record.ownerId, record.id, record.data.kind), record); return record; }
  async findById(owner: string, id: string, kind: RecordKind = 'transaction') { return this.items.get(this.key(owner,id,kind)) ?? null; }
  async list(owner: string, kind: RecordKind, limit: number, cursor?: string) {
    const id = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()).id : '';
    const rest = [...this.items.values()].filter(r => r.ownerId === owner && r.data.kind === kind && r.id > id).sort((a,b) => a.id.localeCompare(b.id));
    const items = rest.slice(0,limit);
    return { items, nextCursor: rest.length > limit ? Buffer.from(JSON.stringify({ id: items.at(-1)!.id })).toString('base64url') : null };
  }
  async update(record: FinanceRecord, version: number) {
    if ((await this.findById(record.ownerId,record.id,record.data.kind))?.version !== version) return false;
    await this.create(record); return true;
  }
  async delete(owner: string, id: string, kind: RecordKind, version: number) {
    if ((await this.findById(owner,id,kind))?.version !== version) return false;
    return this.items.delete(this.key(owner,id,kind));
  }
}
const endpoint = process.env.DYNAMODB_FINANCE_TEST_ENDPOINT;
if (endpoint && !['127.0.0.1','localhost','[::1]'].includes(new URL(endpoint).hostname)) throw new Error('Teste exige DynamoDB Local.');
const client = endpoint ? createDynamoClient(endpoint) : undefined;
const tableName = `miupy-finance-test-${randomUUID()}`;
const repository = client ? new DynamoFinanceRepository(client, tableName) : new MemoryRepository();
const service = new FinanceServiceImpl(repository);
const server = createServer();
const tokens = new Map<string,string>();
let base = '';
before(async () => {
  if (client) await client.send(new CreateTableCommand({ TableName: tableName, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' },{ AttributeName: 'sk', AttributeType: 'S' }], KeySchema: [{ AttributeName:'pk',KeyType:'HASH' },{ AttributeName:'sk',KeyType:'RANGE' }] }));
  const keys = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid:'synthetic', alg:'RS256' }] });
  for (const owner of ['alice','bob','blocked']) tokens.set(owner, await new SignJWT({}).setProtectedHeader({ alg:'RS256',kid:'synthetic' }).setSubject(owner).setIssuer('https://accounts.google.com').setAudience('synthetic').setExpirationTime('1h').sign(keys.privateKey));
  server.on('request',createApp({ authenticate: authenticate(bearerTokenClaims(jwks,'synthetic'),new Set(['alice','bob'])), notesRouter: Router(), financeRouter: createFinanceRouter(new FinanceController(service)) }));
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Sem porta.');
  base = `http://127.0.0.1:${address.port}/v1/finance`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (client) { await client.send(new DeleteTableCommand({ TableName: tableName })); client.destroy(); }
});
const input: TransactionInput = { title:'Sintético',amountCents:12345,currency:'BRL',direction:'expense',date:'2026-10-19',category:'Casa',tags:['teste'],bankId:null,source:'Manual',link:'monthlyBills',linkedMonth:'2026-10',paymentMethod:'pix' };
function call(owner: string, path: string, method = 'GET', body?: unknown) {
  return fetch(base+path,{ method,headers:{ authorization: owner === 'invalid' ? 'Bearer inválido' : `Bearer ${tokens.get(owner) ?? ''}`, 'content-type':'application/json' },body: body === undefined ? undefined : JSON.stringify(body) });
}
async function create(body = input, owner = 'alice') { const res = await call(owner,'/transactions','POST',body); assert.equal(res.status,201,await (res.status !== 201 ? res.text() : Promise.resolve(''))); return await res.json() as Transaction; }
async function status(owner: string,path: string,method: string,body: unknown,expected: number) {
  const res = await call(owner,path,method,body); assert.equal(res.status,expected,await res.text());
}
test('finanças autenticadas: 401 sem token/inválido e 403 para sub fora da lista',async () => {
  for (const path of ['/transactions','/banks','/summary','/export.csv']) {
    await status('',path,'GET',undefined,401); await status('invalid',path,'GET',undefined,401); await status('blocked',path,'GET',undefined,403);
  }
});
test('CRUD, owner derivado do JWT e concorrência atômica',async () => {
  const t = await create(); assert.equal('ownerId' in t,false);
  for (const method of ['GET','PATCH','DELETE']) await status('bob',`/transactions/${t.id}`,method,method === 'PATCH' ? {...input,version:1} : method === 'DELETE' ? {version:1} : undefined,404);
  const results = await Promise.all([call('alice',`/transactions/${t.id}`,'PATCH',{...input,title:'A',version:1}),call('alice',`/transactions/${t.id}`,'PATCH',{...input,title:'B',version:1})]);
  assert.deepEqual(results.map(r => r.status).sort(),[200,409]);
  await status('alice',`/transactions/${t.id}`,'DELETE',{version:1},409);
  await status('alice',`/transactions/${t.id}`,'DELETE',{version:2},204);
  await status('alice',`/transactions/${t.id}`,'GET',undefined,404);
});
test('validação estrita, centavos, datas, método, mês, limite e referência do banco',async () => {
  for (const patch of [{ownerId:'bob'},{amountCents:1.2},{amountCents:0},{amountCents:Number.MAX_SAFE_INTEGER},{date:'2026-02-30'},{currency:'XYZ'},{paymentMethod:null},{link:'salary',linkedMonth:null},{linkedMonth:'2026-13'},{bankId:randomUUID()},{tags:Array(21).fill('x')}]) {
    await status('alice','/transactions','POST',{...input,...patch},'bankId' in patch ? 404 : 400);
  }
  for (const path of ['/transactions?limit=51','/transactions?limit=0','/transactions?ownerId=bob','/banks?limit=51','/summary?ownerId=bob','/transactions/not-uuid']) await status('alice',path,'GET',undefined,400);
});
test('bancos CRUD com upload real, isolamento, URL segura e fotografia histórica',async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
  const body = { title:'Banco sintético',logo:{kind:'upload',mime:'image/png',base64:png} };
  const res = await call('alice','/banks','POST',body); assert.equal(res.status,201); const bank = await res.json() as Bank;
  assert.equal(bank.logo?.kind,'upload'); assert.deepEqual((await (await call('alice',`/banks/${bank.id}`)).json() as Bank).logo,body.logo);
  for (const method of ['GET','PATCH','DELETE']) await status('bob',`/banks/${bank.id}`,method,method === 'PATCH' ? {...body,version:1} : method === 'DELETE' ? {version:1} : undefined,404);
  await status('bob','/transactions','POST',{...input,bankId:bank.id},404);
  const t = await create({...input,bankId:bank.id}); assert.equal(t.bankTitle,body.title);
  await status('alice',`/banks/${bank.id}`,'PATCH',{title:'Atualizado',logo:{kind:'url',url:'https://example.test/logo.png'},version:1},200);
  await status('alice',`/banks/${bank.id}`,'DELETE',{version:1},409);
  await status('alice',`/banks/${bank.id}`,'DELETE',{version:2},204);
  await status('alice',`/transactions/${t.id}`,'PATCH',{...input,bankId:bank.id,version:1},200);
  assert.equal((await (await call('alice',`/transactions/${t.id}`)).json() as Transaction).bankTitle,body.title);
  await status('alice',`/transactions/${t.id}`,'DELETE',{version:2},204);
  for (const logo of [{kind:'url',url:'javascript:alert(1)'},{kind:'url',url:'https://example.test/logo.svg'},{kind:'url',url:'https://user:pass@example.test/logo.png'},{kind:'upload',mime:'image/svg+xml',base64:png},{kind:'upload',mime:'image/png',base64:Buffer.from('<svg/>').toString('base64')},{kind:'upload',mime:'image/png',base64:Buffer.alloc(65537).toString('base64')}]) await status('alice','/banks','POST',{title:'Inválido',logo},400);
});
test('paginação 50, totais globais por moeda e CSV de todas as páginas sem vazamento',async () => {
  const ids = new Set<string>();
  for (let i=0;i<53;i++) ids.add((await create({...input,title:i === 0 ? '=SUM(1,2) "teste"\nlinha' : `Item ${i}`,amountCents:100})).id);
  const usd = await create({...input,currency:'USD',direction:'income',paymentMethod:null,amountCents:200}); ids.add(usd.id);
  const other = await create({...input,title:'SEGREDO-SINTETICO'},'bob');
  const collected: Transaction[] = []; let cursor: string | null = null;
  do { const page = await (await call('alice',`/transactions?limit=50${cursor ? '&cursor='+cursor : ''}`)).json() as {items:Transaction[];nextCursor:string|null}; assert.ok(page.items.length <= 50); collected.push(...page.items); cursor=page.nextCursor; } while(cursor);
  assert.deepEqual(new Set(collected.map(t => t.id)),ids);
  const totals = await (await call('alice','/summary')).json() as { currencies: Array<{currency:string;incomeCents:number;expenseCents:number;balanceCents:number;count:number}> };
  assert.deepEqual(totals.currencies.find(t => t.currency === 'BRL'),{currency:'BRL',incomeCents:0,expenseCents:5300,balanceCents:-5300,count:53});
  assert.deepEqual(totals.currencies.find(t => t.currency === 'USD'),{currency:'USD',incomeCents:200,expenseCents:0,balanceCents:200,count:1});
  const response = await call('alice','/export.csv'); assert.match(response.headers.get('content-type') ?? '',/text\/csv/); const csv = await response.text();
  for (const id of ids) assert.ok(csv.includes(id)); assert.ok(!csv.includes(other.id)); assert.ok(!csv.includes('SEGREDO-SINTETICO'));
  assert.ok(csv.includes('"\'=SUM(1,2) ""teste""\nlinha"'));
});
test('CSV neutraliza fórmulas e escapa aspas, vírgulas e controles iniciais',() => {
  for (const text of ['=1+1',' +1','-2','@SUM(A1)','\ttexto','\ntexto','\u0000=cmd']) assert.ok(csvCell(text).startsWith('"\''));
  assert.equal(csvCell('a,"b"'),'"a,""b"""');
});
test('repositório aplica condição de versão e cursor deriva partição do principal',async () => {
  const t = await service.create('repo','transaction',input);
  assert.equal(await repository.update(new FinanceRecord('repo',{...t.data,version:2}),9),false);
  assert.equal(await repository.delete('repo',t.id,'transaction',9),false);
  assert.equal(await repository.findById('outro',t.id,'transaction'),null);
  if (client) {
    await assert.rejects(repository.list('repo','transaction',50,'inválido'),{status:400});
    const forged = Buffer.from(JSON.stringify({id:t.id,ownerId:'repo'})).toString('base64url');
    await assert.rejects(repository.list('alice','transaction',50,forged),{status:400});
  }
});
test('logos grandes respeitam 400 KiB e paginação continua no limite de 1 MiB do DynamoDB',async () => {
  const bytes = Buffer.alloc(65_536); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const ids = new Set<string>();
  for (let i=0;i<14;i++) {
    const bank = await service.create('large-banks','bank',{title:`Banco ${i}`,logo:{kind:'upload',mime:'image/png',base64:bytes.toString('base64')}});
    assert.ok(Buffer.byteLength(JSON.stringify(bank.data)) < 100_000); ids.add(bank.id);
  }
  const first = await repository.list('large-banks','bank',50);
  if (client) { assert.ok(first.nextCursor); assert.ok(first.items.length < 14); }
  const collected = [...first.items]; let cursor = first.nextCursor;
  while (cursor) { const page = await repository.list('large-banks','bank',50,cursor); collected.push(...page.items); cursor=page.nextCursor; }
  assert.deepEqual(new Set(collected.map(record=>record.id)),ids);
  assert.deepEqual((await repository.list('alice','bank',50)).items,[]);
});
