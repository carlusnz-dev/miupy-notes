import { accountOutputSchema, accountPageSchema, balancesSchema, bankOutputSchema, bankPageSchema, transactionOutputSchema, transactionPageSchema, summarySchema, type AccountInput, type BankInput, type TransactionInput } from '../../../api/src/modules/finance/contract';
import { queryClient } from './query-client';
import { apiClient, toApiError } from './api-client';
export type { Account, AccountInput, Balances, Bank, Transaction, BankInput, TransactionInput } from '../../../api/src/modules/finance/contract';

async function request<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw toApiError(error); }
}
async function write<T>(operation: () => Promise<T>): Promise<T> {
  const value = await request(operation);
  void queryClient.invalidateQueries({ queryKey: ['finance'] });
  return value;
}
export function listTransactions(cursor?: string, signal?: AbortSignal) {
  return request(async () => transactionPageSchema.parse((await apiClient.get('/v1/finance/transactions', { params: { limit: 50, cursor }, signal })).data));
}
export function getFinanceSummary(signal?: AbortSignal) {
  return request(async () => summarySchema.parse((await apiClient.get('/v1/finance/summary', { signal })).data));
}
export function saveTransaction(input: TransactionInput, existing?: { id: string; version: number }) {
  return write(async () => transactionOutputSchema.parse((await (existing ? apiClient.patch(`/v1/finance/transactions/${encodeURIComponent(existing.id)}`, { ...input, version: existing.version }) : apiClient.post('/v1/finance/transactions', input))).data));
}
export function deleteTransaction(id: string, version: number) {
  return write(async () => { await apiClient.delete(`/v1/finance/transactions/${encodeURIComponent(id)}`, { data: { version } }); });
}
export function listAllBanks(signal?: AbortSignal) {
  return request(async () => {
    const items = [];
    let cursor: string | undefined;
    do {
      const page = bankPageSchema.parse((await apiClient.get('/v1/finance/banks', { params: { limit: 50, cursor }, signal })).data);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  });
}
export function saveBank(input: BankInput, existing?: { id: string; version: number }) {
  return write(async () => bankOutputSchema.parse((await (existing ? apiClient.patch(`/v1/finance/banks/${encodeURIComponent(existing.id)}`, { ...input, version: existing.version }) : apiClient.post('/v1/finance/banks', input))).data));
}
export function deleteBank(id: string, version: number) {
  return write(async () => { await apiClient.delete(`/v1/finance/banks/${encodeURIComponent(id)}`, { data: { version } }); });
}
export function exportFinanceCsv() {
  return request(async () => (await apiClient.get<Blob>('/v1/finance/export.csv', { responseType: 'blob', timeout: 60_000 })).data);
}

export function getTransaction(id: string, signal?: AbortSignal) {
  return request(async () => transactionOutputSchema.parse((await apiClient.get(`/v1/finance/transactions/${encodeURIComponent(id)}`, { signal })).data));
}

export function getFinanceBalances(signal?: AbortSignal) {
  return request(async () => balancesSchema.parse((await apiClient.get('/v1/finance/balances', { signal })).data));
}
export function listAllAccounts(signal?: AbortSignal) {
  return request(async () => {
    const items = [];
    let cursor: string | undefined;
    do {
      const page = accountPageSchema.parse((await apiClient.get('/v1/finance/accounts', { params: { limit: 50, cursor }, signal })).data);
      items.push(...page.items); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  });
}
export function saveAccount(input: AccountInput, existing?: { id: string; version: number }) {
  return write(async () => accountOutputSchema.parse((await (existing ? apiClient.patch(`/v1/finance/accounts/${encodeURIComponent(existing.id)}`, { ...input, version: existing.version }) : apiClient.post('/v1/finance/accounts', input))).data));
}
