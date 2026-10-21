import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffDelay, createScheduler } from "./notes-scheduler";
import { deferred, fakeClock, settle } from "./notes-test-kit";

test("debounce empurra o horário; o teto de espera limita a digitação contínua", async () => {
  const clock = fakeClock();
  const runs: number[] = [];
  const scheduler = createScheduler(async () => { runs.push(clock.now()); }, { clock, debounceMs: 1500, maxWaitMs: 15_000 });
  for (let t = 0; t < 14_000; t += 1000) { scheduler.edit("a"); await clock.advance(1000); }
  assert.deepEqual(runs, [], "dentro do teto, a pausa nunca chega");
  scheduler.edit("a");
  await clock.advance(1000);
  assert.deepEqual(runs, [15_000], "o teto vence");
});

test("uma chave nunca roda duas vezes ao mesmo tempo e edições durante a execução viram uma nova rodada", async () => {
  const clock = fakeClock();
  const gate = deferred<void>();
  let active = 0;
  let maxActive = 0;
  let count = 0;
  const scheduler = createScheduler(async () => {
    active++; maxActive = Math.max(maxActive, active); count++;
    if (count === 1) await gate.promise;
    active--;
  }, { clock, debounceMs: 100 });
  scheduler.edit("a");
  await clock.advance(100);
  scheduler.edit("a");
  scheduler.edit("a");
  await clock.advance(1000);
  assert.equal(count, 1);
  gate.resolve();
  await clock.advance(200);
  assert.equal(count, 2);
  assert.equal(maxActive, 1);
});

test("pause e resume; clear cancela o que estava agendado", async () => {
  const clock = fakeClock();
  const runs: string[] = [];
  const scheduler = createScheduler(async (key) => { runs.push(key); }, { clock, debounceMs: 100 });
  scheduler.pause();
  scheduler.edit("a");
  await clock.advance(1000);
  assert.deepEqual(runs, []);
  scheduler.resume();
  await settle();
  assert.deepEqual(runs, ["a"]);
  scheduler.edit("b");
  scheduler.clear();
  await clock.advance(1000);
  assert.deepEqual(runs, ["a"]);
});

test("backoff cresce com teto, usa jitter e trata Retry-After como piso", () => {
  const max = () => 1;
  const min = () => 0;
  assert.deepEqual([1, 2, 3, 4].map((n) => backoffDelay(n, 0, { random: max })), [2000, 4000, 8000, 16_000]);
  assert.equal(backoffDelay(20, 0, { random: max }), 300_000);
  assert.equal(backoffDelay(1, 0, { random: min }), 1000);
  assert.equal(backoffDelay(1, 45_000, { random: max }), 45_000);
  assert.equal(backoffDelay(1, 10 * 60_000, { random: max }), 600_000, "Retry-After do servidor é piso, mesmo acima do teto do backoff");
});
