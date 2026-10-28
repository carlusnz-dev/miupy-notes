import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import express from "express";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createErrorHandler } from "../../../core/http/error-handler.js";
import { Logger } from "../../../core/logging/logger.js";
import { HabitsController } from "../controllers/habits.controller.js";
import { DynamoHabitsRepository } from "../repository/dynamo-habits.repository.js";
import { MemoryHabitsRepository } from "../repository/memory-habits.repository.js";
import { HabitsServiceImpl } from "../services/habits.service.impl.js";
import type { HabitsRepository } from "../repository/habits.repository.js";
import { createHabitsRouter } from "./habits.routes.js";

/** Sobe a API de Hábitos sobre `repository` e devolve as linhas de log do tratador de erros. */
async function serve(repository: HabitsRepository, run: (base: string) => Promise<void>) {
  const lines: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.locals.principal = { ownerId: "alice" }; next(); });
  app.use("/v1/habits", createHabitsRouter(new HabitsController(new HabitsServiceImpl(repository, () => new Date("2026-10-26T12:00:00.000Z")), { googleCalendar: { enabled: false, available: false } })));
  app.use(createErrorHandler(new Logger("debug", line => lines.push(line), { format: "json" })));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try { const address = server.address(); if (!address || typeof address === "string") throw Error("Porta indisponível"); await run(`http://127.0.0.1:${address.port}/v1/habits`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  return lines.map(line => JSON.parse(line) as Record<string, unknown>);
}

test("item armazenado inválido: 500 INTERNAL_ERROR com serviço, operação e origem no log, sem o conteúdo", async () => {
  const stored = new DynamoHabitsRepository({ send: async () => ({ Items: [{ ownerId: "alice", title: 123, note: "conteudo-secreto" }] }) } as unknown as DynamoDBDocumentClient, "t");
  const logs = await serve(stored, async base => {
    const response = await fetch(base);
    assert.equal(response.status, 500);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "INTERNAL_ERROR");
  });
  assert.equal(logs.length, 1);
  const [entry] = logs;
  assert.equal(entry.level, "error"); assert.equal(entry.statusCode, 500); assert.equal(entry.service, "DynamoDB (hábitos)"); assert.equal(entry.operation, "ler hábito armazenado");
  assert.deepEqual(entry.errorChain, ["ServiceError", "ZodError"]); assert.match(String((entry.origin as string[])[0]), /dynamo-habits\.repository\.ts:\d+/);
  assert.equal(JSON.stringify(entry).includes("conteudo-secreto"), false);
});

test("saída que não passa no próprio schema (adapter) também é 500, não 400", async () => {
  const repository = new MemoryHabitsRepository();
  repository.list = async () => [{ ownerId: "alice", title: 123, deletedAt: null } as never];
  const logs = await serve(repository, async base => assert.equal((await fetch(base)).status, 500));
  assert.equal(logs[0].level, "error"); assert.equal(logs[0].service, "Hábitos"); assert.equal(logs[0].operation, "montar a resposta");
});

test("entrada inválida do cliente continua 400 e é registrada como rejeitada", async () => {
  const logs = await serve(new MemoryHabitsRepository(), async base => {
    assert.equal((await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "" }) })).status, 400);
    assert.equal((await fetch(`${base}/occurrences?from=x&to=y`)).status, 400);
  });
  assert.deepEqual(logs.map(entry => [entry.level, entry.classification]), [["warn", "request_rejected"], ["warn", "request_rejected"]]);
});
