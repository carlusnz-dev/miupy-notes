import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CalendarTask } from "../domain/calendar-task.js";
import { DynamoTaskRepository } from "./dynamo-task.repository.js";

type SentCommand = { constructor: { name: string }; input: Record<string, unknown> };

function fakeClient(reply: (command: SentCommand, index: number) => unknown) {
  const sent: SentCommand[] = [];
  const client = { send: async (command: SentCommand) => { sent.push(command); return reply(command, sent.length - 1); } };
  return { sent, client: client as unknown as DynamoDBDocumentClient };
}

const now = "2026-10-23T12:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const task = (n: number) => new CalendarTask(id(n), "alice", "t", "", "2026-10-25", null, "pending", null, null, now, now, 1);
const stored = (n: number) => ({ pk: "USER#alice", sk: `TASK#${id(n)}`, ...task(n) });
const conditionFailed = () => new ConditionalCheckFailedException({ message: "condição falhou", $metadata: {} });

test("create grava na partição do dono com chave TASK# e recusa ID repetido como 409", async () => {
  const ok = fakeClient(() => ({}));
  await new DynamoTaskRepository(ok.client, "t").create(task(1));
  const item = ok.sent[0].input.Item as Record<string, unknown>;
  assert.equal(item.pk, "USER#alice");
  assert.equal(item.sk, `TASK#${id(1)}`);
  assert.equal(ok.sent[0].input.ConditionExpression, "attribute_not_exists(pk) AND attribute_not_exists(sk)");
  const duplicate = fakeClient(() => { throw conditionFailed(); });
  await assert.rejects(new DynamoTaskRepository(duplicate.client, "t").create(task(1)), { status: 409, code: "CONFLICT" });
});

test("list consulta só o prefixo TASK# do dono, mesmo com cursor de outro usuário", async () => {
  const { sent, client } = fakeClient(() => ({ Items: [stored(1)], LastEvaluatedKey: { pk: "USER#alice", sk: `TASK#${id(1)}` } }));
  const repository = new DynamoTaskRepository(client, "t");
  const page = await repository.list("alice", { limit: 1 });
  assert.equal(typeof page.nextCursor, "string");
  await repository.list("bob", { limit: 1, cursor: page.nextCursor! });
  assert.deepEqual(sent[1].input.ExpressionAttributeValues, { ":pk": "USER#bob", ":prefix": "TASK#" });
  assert.deepEqual(sent[1].input.ExclusiveStartKey, { pk: "USER#bob", sk: `TASK#${id(1)}` });
  await assert.rejects(repository.list("alice", { limit: 1, cursor: "nao-e-cursor" }), { status: 400 });
});

test("list com status filtra no servidor e continua lendo até juntar a página", async () => {
  const replies = [
    { Items: [], LastEvaluatedKey: { pk: "USER#alice", sk: `TASK#${id(1)}` } },
    { Items: [stored(2)], LastEvaluatedKey: undefined },
  ];
  const { sent, client } = fakeClient((_command, index) => replies[index]);
  const page = await new DynamoTaskRepository(client, "t").list("alice", { limit: 5, status: "pending" });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].input.FilterExpression, "#status = :status");
  assert.equal(sent[0].input.Limit, 100);
  assert.deepEqual(page.items.map((item) => item.id), [id(2)]);
  assert.equal(page.nextCursor, null);
});

test("update e delete são condicionais à versão; delete distingue ausente de conflito", async () => {
  const guarded = fakeClient(() => { throw conditionFailed(); });
  assert.equal(await new DynamoTaskRepository(guarded.client, "t").update(task(1), 1), null);
  assert.equal(guarded.sent[0].input.ConditionExpression, "#version = :expected");
  const missing = fakeClient((command) => { if (command.constructor.name === "DeleteCommand") throw conditionFailed(); return {}; });
  assert.equal(await new DynamoTaskRepository(missing.client, "t").delete("alice", id(1), 1), "missing");
  const diverged = fakeClient((command) => { if (command.constructor.name === "DeleteCommand") throw conditionFailed(); return { Item: stored(1) }; });
  assert.equal(await new DynamoTaskRepository(diverged.client, "t").delete("alice", id(1), 9), "conflict");
});
