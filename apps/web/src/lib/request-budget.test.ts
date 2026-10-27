import test from "node:test";
import assert from "node:assert/strict";
import { createRequestBudget } from "./request-budget";

test("orçamento compartilhado limita uma rajada e respeita cooldown estendido durante a espera", async () => {
  let now = 0;
  const budget = createRequestBudget(() => now, async ms => { now += ms; });
  const sent: number[] = [];
  await Promise.all(Array.from({ length: 16 }, async () => { await budget.acquire(); sent.push(now); }));
  for (const at of sent) assert.ok(sent.filter(t => t >= at && t < at + 1000).length <= 4);
  budget.defer(2500);
  const start = now;
  await budget.acquire();
  assert.ok(now >= start + 2500);
});

test("uma requisição cancelada não bloqueia as próximas", async () => {
  let now = 0;
  const budget = createRequestBudget(() => now, async ms => { now += ms; });
  await assert.rejects(budget.acquire({ aborted: true }), { name: "AbortError" });
  await budget.acquire();
});
