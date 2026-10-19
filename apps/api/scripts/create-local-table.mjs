// Cria a tabela de notas no DynamoDB Local. Recusa qualquer endpoint que não seja loopback.
import { CreateTableCommand, DynamoDBClient, ResourceInUseException } from "@aws-sdk/client-dynamodb";

const endpoint = new URL(process.env.DYNAMODB_ENDPOINT ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) throw new Error("DYNAMODB_ENDPOINT deve apontar para o DynamoDB Local.");
const TableName = process.env.NOTES_TABLE_NAME;
if (!TableName) throw new Error("Defina NOTES_TABLE_NAME.");

const client = new DynamoDBClient({ endpoint: endpoint.href, region: "local", credentials: { accessKeyId: "local", secretAccessKey: "local" } });
try {
  await client.send(new CreateTableCommand({
    TableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
  }));
  process.stdout.write(`Tabela ${TableName} criada em ${endpoint.href}\n`);
} catch (error) {
  if (!(error instanceof ResourceInUseException)) throw error;
  process.stdout.write(`Tabela ${TableName} já existe.\n`);
}
