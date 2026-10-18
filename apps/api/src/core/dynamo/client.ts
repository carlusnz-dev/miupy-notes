import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Com `endpoint` (DynamoDB Local), usa credenciais falsas para nunca carregar credenciais AWS reais. */
export function createDynamoClient(endpoint?: string): DynamoDBDocumentClient {
  const client = new DynamoDBClient(endpoint ? { endpoint, region: "local", credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {});
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}
