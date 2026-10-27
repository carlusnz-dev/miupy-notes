import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Habit } from "../domain/habit.js";
import { createHabitInputSchema } from "../dto/input.js";
import { DynamoHabitsRepository } from "./dynamo-habits.repository.js";

type Command = { constructor: { name: string }; input: Record<string, unknown> };
function fake(reply: (command: Command, calls: number) => unknown) {
  const sent: Command[] = [];
  return { sent, client: { send: async (command: Command) => { sent.push(command); return reply(command, sent.length); } } as unknown as DynamoDBDocumentClient };
}
const id = "00000000-0000-4000-8000-000000000001", now = "2026-10-26T12:00:00.000Z";
const habit = new Habit("alice", { ...createHabitInputSchema.parse({ title: "Ler", recurrence: { type: "daily" }, startDate: "2026-10-01" }), id, pauses: [], deletedAt: null, purgeAfter: null, createdAt: now, updatedAt: now, version: 1 });
const failed = () => new ConditionalCheckFailedException({ message: "test", $metadata: {} });
const event = { habitId: id, date: "2026-10-26", type: "completion" as const, points: 10, createdAt: now, revokedAt: null };

test("DynamoDB: cadastro com chaves por proprietário, criação e CAS condicionais, sem Scan", async () => {
  const { client, sent } = fake(command => command.constructor.name === "GetCommand" ? { Item: { pk: "USER#alice", sk: `HABIT#${id}`, ownerId: "alice", ...habit } } : {});
  const repo = new DynamoHabitsRepository(client, "t");
  await repo.create(habit); assert.match(String(sent[0].input.ConditionExpression), /attribute_not_exists/);
  assert.equal((await repo.findById("alice", id))?.title, "Ler"); assert.equal(sent[1].input.ConsistentRead, true);
  await repo.findById("bob", id); assert.deepEqual(sent[2].input.Key, { pk: "USER#bob", sk: `HABIT#${id}` });
  await repo.update(habit, 1); assert.equal(sent[3].input.ConditionExpression, "#version = :expected");
  assert.equal(sent.some(c => c.constructor.name === "ScanCommand"), false);
  assert.equal(await new DynamoHabitsRepository(fake(() => { throw failed(); }).client, "t").update(habit, 1), null);
});

test("DynamoDB: listagens paginam por prefixo e intervalo do proprietário", async () => {
  const log = { ownerId: "alice", habitId: id, date: "2026-10-26", completedAt: now, title: "Ler", kind: "other", priority: "medium" };
  const { client, sent } = fake((_c, calls) => calls === 1 ? { Items: [{ ...log, pk: "x", sk: "y" }], LastEvaluatedKey: { pk: "USER#bob", sk: "k" } } : { Items: [] });
  const repo = new DynamoHabitsRepository(client, "t");
  assert.equal((await repo.listLogs("bob", "2026-10-01", "2026-10-31")).length, 1);
  assert.equal(sent.length, 2); assert.deepEqual(sent[1].input.ExclusiveStartKey, { pk: "USER#bob", sk: "k" });
  assert.deepEqual(sent[0].input.ExpressionAttributeValues, { ":pk": "USER#bob", ":from": "HLOG#2026-10-01", ":to": "HLOG#2026-10-31#g" });
  await repo.list("bob"); assert.deepEqual(sent[2].input.ExpressionAttributeValues, { ":pk": "USER#bob", ":p": "HABIT#" });
});

test("DynamoDB: XP idempotente por chave determinística; compensação só atualiza o que existe", async () => {
  const stored = { ...event, pk: "USER#alice", sk: `HXP#${id}#2026-10-26#completion`, revokedAt: now };
  const { client, sent } = fake((command, calls) => { if (calls === 1) throw failed(); return command.constructor.name === "GetCommand" ? { Item: stored } : {}; });
  const repo = new DynamoHabitsRepository(client, "t");
  const granted = await repo.grantXp("alice", event);
  assert.equal(sent[0].input.ConditionExpression, "attribute_not_exists(pk)"); assert.equal(granted.revokedAt, now);
  assert.equal((sent[0].input.Item as { sk: string }).sk, `HXP#${id}#2026-10-26#completion`);
  await repo.setXpRevoked("alice", id, "2026-10-26", "completion", null);
  assert.equal(sent[2].input.ConditionExpression, "attribute_exists(pk)");
  await new DynamoHabitsRepository(fake(() => { throw failed(); }).client, "t").setXpRevoked("alice", id, "2026-10-26", "completion", now);
});
