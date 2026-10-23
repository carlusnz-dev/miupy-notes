import assert from "node:assert/strict";
import { test } from "node:test";
import { createFetchCache, rangeKey } from "./fetch-cache";

const range = rangeKey({ from: "2026-10-23T03:00:00.000Z", to: "2026-10-24T03:00:00.000Z" });

test("período reconciliado fica fresco até o prazo e é separado por conta", () => {
  const cache = createFetchCache(1000);
  assert.equal(cache.freshAt("alice", range, 0), null);
  cache.mark("alice", range, 100);
  assert.equal(cache.freshAt("alice", range, 1099), 100);
  assert.equal(cache.freshAt("alice", range, 1100), null);
  assert.equal(cache.freshAt("bob", range, 500), null);
});

test("invalidar descarta só os períodos da conta; respostas auxiliares e vista continuam", () => {
  const cache = createFetchCache(1000);
  cache.mark("alice", range, 0);
  cache.mark("bob", range, 0);
  cache.remember("alice", "notes", ["n1"], 0);
  cache.saveView("alice", "week", { year: 2026, month: 10, day: 23 });
  cache.invalidate("alice");
  assert.equal(cache.freshAt("alice", range, 10), null);
  assert.equal(cache.freshAt("bob", range, 10), 0);
  assert.deepEqual(cache.recall("alice", "notes", 10), ["n1"]);
  assert.equal(cache.recall("alice", "notes", 1000), undefined);
  assert.equal(cache.recall("bob", "notes", 10), undefined);
  assert.equal(cache.lastView("alice")?.mode, "week");
  assert.equal(cache.lastView("bob"), null);
});
