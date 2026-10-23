import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createLibraryInputSchema } from "../dto/input.js";
import { LibraryServiceImpl } from "../services/library.service.impl.js";
import { DynamoLibraryRepository } from "./dynamo-library.repository.js";

const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
test("Biblioteca persiste, pagina filtros vazios e isola versões em tabela DynamoDB Local sintética", { skip: !endpoint && "defina DYNAMODB_TEST_ENDPOINT (loopback) para rodar" }, async () => {
  const url = new URL(endpoint!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Integração permitida apenas em loopback");
  const client = new DynamoDBClient({ endpoint: url.href, region: "local", credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } });
  const document = DynamoDBDocumentClient.from(client);
  const table = `library-test-${randomUUID()}`;
  await client.send(new CreateTableCommand({ TableName: table, BillingMode: "PAY_PER_REQUEST", AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }], KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }] }));
  try {
    await waitUntilTableExists({ client, maxWaitTime: 20, minDelay: 1, maxDelay: 2 }, { TableName: table });
    const service = new LibraryServiceImpl(new DynamoLibraryRepository(document, table));
    const inputs = ["Livro A", "Livro B", "Livro C"].map(title => createLibraryInputSchema.parse({ kind: "book", title, rating: 0 }));
    const items = await Promise.all(inputs.map(input => service.create("synthetic-alice", input)));
    assert.deepEqual(await service.findById("synthetic-alice", items[0].id), items[0]);
    await assert.rejects(service.findById("synthetic-bob", items[0].id), { status: 404 });
    await assert.rejects(service.update("synthetic-bob", items[0].id, { version: 1, title: "roubo" }), { status: 404 });
    await assert.rejects(service.delete("synthetic-bob", items[0].id), { status: 404 });
    const statuses = await Promise.all(["A", "B"].map(title => service.update("synthetic-alice", items[0].id, { version: 1, title }).then(() => 200, (error: { status: number }) => error.status)));
    assert.deepEqual(statuses.sort(), [200, 409]);
    const first = await service.list("synthetic-alice", { limit: 1, kind: "film" });
    assert.deepEqual(first.items, []); assert.ok(first.nextCursor);
    assert.deepEqual((await service.list("synthetic-bob", { limit: 1, cursor: first.nextCursor! })).items, []);
    const ids: string[] = []; let cursor: string | undefined;
    do { const page = await service.list("synthetic-alice", { limit: 1, cursor }); ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor ?? undefined; } while (cursor);
    assert.deepEqual(new Set(ids), new Set(items.map(item => item.id)));
    await service.delete("synthetic-alice", items[0].id);
    await assert.rejects(service.findById("synthetic-alice", items[0].id), { status: 404 });
  } finally { await client.send(new DeleteTableCommand({ TableName: table })); client.destroy(); }
});
