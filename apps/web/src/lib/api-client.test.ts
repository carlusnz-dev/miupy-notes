import test from "node:test";
import assert from "node:assert/strict";
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { apiClient, ApiError, setAccessTokenProvider, setUnauthorizedHandler } from "./api-client";

function failure(config: InternalAxiosRequestConfig, status: number, code?: string, retryAfter?: string) {
  const response = { status, data: code ? { error: { code, message: "Erro sintético" } } : {}, headers: { 'retry-after': retryAfter }, config, statusText: "error" } as AxiosResponse;
  return new AxiosError("failure", undefined, config, undefined, response);
}

test("401 de Calendar/biblioteca sem envelope expira a sessão uma vez; 403 por IP não repete", async () => {
  setAccessTokenProvider(async () => "synthetic");
  let expired = 0;
  setUnauthorizedHandler(() => { expired++; });
  let calls = 0;
  const adapter = async (config: InternalAxiosRequestConfig) => { calls++; throw failure(config, 401); };
  for (const url of ['/v1/calendar/events', '/v1/library']) {
    await assert.rejects(apiClient.get(url, { adapter }), (e: ApiError) => e.code === 'UNAUTHORIZED');
  }
  assert.equal(expired, 2);
  assert.equal(calls, 2);
  await assert.rejects(apiClient.get('/v1/library', { adapter: async config => { calls++; throw failure(config, 403, 'ORIGIN_NOT_ALLOWED'); } }), (e: ApiError) => e.message.includes('IP'));
  assert.equal(calls, 3);
});

test("GET respeita Retry-After em 429 e tem teto em 5xx; POST nunca repete", async () => {
  setAccessTokenProvider(async () => "synthetic");
  let calls = 0;
  const starts: number[] = [];
  await apiClient.get('/v1/library', { adapter: async config => {
    calls++; starts.push(Date.now());
    if (calls === 1) throw failure(config, 429, 'RATE_LIMITED', '1');
    return { status: 200, data: {}, headers: new AxiosHeaders(), statusText: 'OK', config };
  } });
  assert.equal(calls, 2);
  assert.ok(starts[1] - starts[0] >= 1000);
  calls = 0;
  await assert.rejects(apiClient.get('/v1/calendar/events', { adapter: async config => { calls++; throw failure(config, 503); } }));
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(apiClient.post('/v1/library', {}, { adapter: async config => { calls++; throw failure(config, 503); } }));
  assert.equal(calls, 1);
});

test("sessão encerrada durante a espera não envia com token antigo", async () => {
  setAccessTokenProvider(async () => "synthetic");
  let calls = 0;
  const waiting = apiClient.get('/v1/library', { adapter: async config => { calls++; return { status: 200, data: {}, headers: {}, statusText: 'OK', config }; } });
  setAccessTokenProvider(null);
  await assert.rejects(waiting);
  assert.equal(calls, 0);
});


test("401 atrasado de outra sessão não expira o login atual", async () => {
  setAccessTokenProvider(async () => "old-synthetic");
  let expired = 0;
  let rejectOld!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  setUnauthorizedHandler(() => { expired++; });
  const old = apiClient.get('/v1/library', { adapter: config => new Promise((_resolve, reject) => {
    rejectOld = () => reject(failure(config, 401)); started();
  }) });
  await ready;
  setAccessTokenProvider(async () => "new-synthetic");
  rejectOld();
  await assert.rejects(old);
  assert.equal(expired, 0);
});
