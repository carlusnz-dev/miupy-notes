import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { LibraryItem } from "../domain/library-item.js";
import { createLibraryInputSchema } from "../dto/input.js";
import { DynamoLibraryRepository } from "./dynamo-library.repository.js";
import { decodeCursor, encodeCursor } from "./pagination.js";

type Command = { constructor: { name: string }; input: Record<string, unknown> };
function fake(reply: (command: Command) => unknown) {
  const sent: Command[] = [];
  return { sent, client: { send: async (command: Command) => { sent.push(command); return reply(command); } } as unknown as DynamoDBDocumentClient };
}
const id = "00000000-0000-4000-8000-000000000001", now = "2026-10-23T12:00:00.000Z";
const item = new LibraryItem("alice", { ...createLibraryInputSchema.parse({ kind: "book", title: "Livro" }), id, createdAt: now, updatedAt: now, version: 1 });
const stored = { ...item, pk: "USER#alice", sk: `LIBRARY#${id}` };
const failed = () => new ConditionalCheckFailedException({ message: "test", $metadata: {} });

test("DynamoDB: criação condicional, detalhe consistente e chaves sempre por proprietário", async () => {
  const { client, sent } = fake(command => command.constructor.name === "GetCommand" ? { Item: stored } : {});
  const repo = new DynamoLibraryRepository(client, "test");
  await repo.create(item); assert.match(String(sent[0].input.ConditionExpression), /attribute_not_exists/);
  assert.equal((await repo.findById("alice", id))?.title, "Livro");
  assert.equal(sent[1].input.ConsistentRead, true);
  await repo.findById("bob", id); assert.deepEqual(sent[2].input.Key, { pk: "USER#bob", sk: `LIBRARY#${id}` });
});

test("DynamoDB: filtro pode esvaziar página sem perder cursor; cursor não injeta owner", async () => {
  const { client, sent } = fake(() => ({ Items: [stored], LastEvaluatedKey: { pk: "USER#alice", sk: stored.sk } }));
  const repo = new DynamoLibraryRepository(client, "test");
  const page = await repo.list("alice", { limit: 1, kind: "film" });
  assert.deepEqual(page.items, []); assert.equal(decodeCursor(page.nextCursor!), id);
  await repo.list("bob", { limit: 1, cursor: page.nextCursor! });
  assert.deepEqual(sent[1].input.ExclusiveStartKey, { pk: "USER#bob", sk: stored.sk });
  assert.deepEqual(sent[1].input.ExpressionAttributeValues, { ":pk": "USER#bob", ":prefix": "LIBRARY#" });
  await assert.rejects(repo.list("alice", { limit: 1, cursor: Buffer.from(JSON.stringify({ id, ownerId: "bob" })).toString("base64url") }), { status: 400 });
  assert.equal(decodeCursor(encodeCursor(id)), id);
});

test("DynamoDB: CAS e exclusão condicionais, falhas de infraestrutura propagam", async () => {
  const ok = fake(() => ({})), repo = new DynamoLibraryRepository(ok.client, "test");
  assert.equal(await repo.update(item, 1), item);
  assert.equal(ok.sent[0].input.ConditionExpression, "#version = :expected");
  assert.deepEqual(ok.sent[0].input.ExpressionAttributeValues, { ":expected": 1 });
  assert.equal(await repo.delete("alice", id), true);
  assert.deepEqual(ok.sent[1].input.Key, { pk: "USER#alice", sk: stored.sk });
  assert.equal(ok.sent[1].input.ConditionExpression, "attribute_exists(pk)");
  const missing = new DynamoLibraryRepository(fake(() => { throw failed(); }).client, "test");
  assert.equal(await missing.update(item, 1), null); assert.equal(await missing.delete("alice", id), false);
  const unavailable = new DynamoLibraryRepository(fake(() => { throw Error("offline"); }).client, "test");
  await assert.rejects(unavailable.update(item, 1), /offline/); await assert.rejects(unavailable.delete("alice", id), /offline/);
});
