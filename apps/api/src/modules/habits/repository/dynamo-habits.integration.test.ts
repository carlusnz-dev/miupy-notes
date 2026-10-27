import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createDynamoClient } from "../../../core/dynamo/client.js";
import { AppError } from "../../../core/domain/app-error.js";
import { createHabitInputSchema } from "../dto/input.js";
import { HabitsServiceImpl } from "../services/habits.service.impl.js";
import { DynamoHabitsRepository } from "./dynamo-habits.repository.js";

// Integração com DynamoDB Local: roda só com DYNAMODB_TEST_ENDPOINT e usa tabela própria, criada e removida aqui.
const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
const skip = endpoint ? false : "defina DYNAMODB_TEST_ENDPOINT (DynamoDB Local) para rodar";
if (endpoint && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)) throw new Error("DYNAMODB_TEST_ENDPOINT deve apontar para o DynamoDB Local.");

const tableName = `miupy-habits-test-${randomUUID()}`;
const admin = endpoint ? new DynamoDBClient({ endpoint, region: "local", credentials: { accessKeyId: "local", secretAccessKey: "local" } }) : null;
const repository = endpoint ? new DynamoHabitsRepository(createDynamoClient(endpoint), tableName) : null;
const service = repository ? new HabitsServiceImpl(repository, () => new Date("2026-10-26T12:00:00.000Z")) : null;

before(async () => {
  if (!admin) return;
  await admin.send(new CreateTableCommand({
    TableName: tableName, BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
  }));
});
after(async () => { await admin?.send(new DeleteTableCommand({ TableName: tableName })); });

const date = "2026-10-26";
const newHabit = (owner: string, priority = "medium") => service!.create(owner, createHabitInputSchema.parse({ title: "Ler", priority, recurrence: { type: "daily" }, startDate: "2026-10-01" }));
const xp = async (owner: string) => (await service!.xp(owner)).totalXp;
const status = async (owner: string, id: string) => (await service!.occurrences(owner, { from: date, to: date })).find(o => o.habitId === id)?.status;

test("DynamoDB: concluir duas vezes soma 10 XP uma vez; desmarcar revoga; remarcar reativa o mesmo evento", { skip }, async () => {
  const habit = await newHabit("idem");
  await service!.setOccurrence("idem", habit.id, date, "completed");
  await service!.setOccurrence("idem", habit.id, date, "completed");
  assert.equal(await xp("idem"), 10);
  assert.equal((await repository!.listXpEvents("idem")).length, 1);
  assert.equal(await status("idem", habit.id), "completed");

  await service!.setOccurrence("idem", habit.id, date, "pending");
  assert.equal(await xp("idem"), 0);
  assert.equal(await status("idem", habit.id), "pending");
  const [revoked] = await repository!.listXpEvents("idem");
  assert.equal(revoked.revokedAt, "2026-10-26T12:00:00.000Z");
  await service!.setOccurrence("idem", habit.id, date, "pending"); // desmarcar de novo é idempotente
  assert.equal(await xp("idem"), 0);

  await service!.setOccurrence("idem", habit.id, date, "completed");
  assert.equal(await xp("idem"), 10);
  const events = await repository!.listXpEvents("idem");
  assert.equal(events.length, 1); assert.equal(events[0].revokedAt, null); assert.equal(events[0].points, 10);
});

test("DynamoDB: desmarcar ocorrência nunca concluída não cria evento nem falha", { skip }, async () => {
  const habit = await newHabit("never");
  await service!.setOccurrence("never", habit.id, date, "pending");
  assert.equal(await xp("never"), 0);
  assert.deepEqual(await repository!.listXpEvents("never"), []);
});

test("DynamoDB: pontos do primeiro evento sobrevivem a nova conclusão e há isolamento por proprietário", { skip }, async () => {
  const habit = await newHabit("iso", "high");
  await service!.setOccurrence("iso", habit.id, date, "completed");
  assert.equal(await xp("iso"), 15);
  assert.equal(await xp("other"), 0);
  assert.deepEqual(await repository!.listLogs("other", date, date), []);
});

test("DynamoDB: concluir e desmarcar em concorrência deixam ocorrência e XP coerentes", { skip }, async () => {
  const habit = await newHabit("race");
  let conflicts = 0;
  for (let round = 0; round < 30; round++) {
    const results = await Promise.allSettled([
      service!.setOccurrence("race", habit.id, date, "completed"),
      service!.setOccurrence("race", habit.id, date, "pending"),
      service!.setOccurrence("race", habit.id, date, round % 2 ? "completed" : "pending"),
    ]);
    for (const result of results) {
      if (result.status === "rejected") { assert.ok(result.reason instanceof AppError && result.reason.status === 409, String(result.reason)); conflicts++; }
    }
    const completed = (await status("race", habit.id)) === "completed";
    const events = await repository!.listXpEvents("race");
    const active = events.filter(e => e.revokedAt === null).length;
    assert.equal(await xp("race"), completed ? 10 : 0, `rodada ${round}`);
    assert.equal(active, completed ? 1 : 0, `rodada ${round}`);
    assert.ok(events.length <= 1);
  }
  console.log(`concorrência: ${conflicts} respostas 409 em 90 operações`);
});
