import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startTestApi, tokenFor, type TestApi } from "./support.js";

let api: TestApi;
let dir: string;
before(async () => {
  api = await startTestApi();
  dir = await mkdtemp(join(tmpdir(), "miupy-mcp-"));
});
after(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

const entry = new URL("../src/stdio.ts", import.meta.url).pathname;

/** Executa o processo real, envia mensagens JSON-RPC por linha e devolve stdout e stderr crus. */
function run(env: Record<string, string>, messages: object[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", entry], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", () => resolve({ stdout, stderr }));
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    // Espera as respostas e fecha o stdin: o servidor encerra sozinho.
    setTimeout(() => child.stdin.end(), 1500);
  });
}

test("stdio: stdout só tem quadros JSON-RPC; logs e erros ficam em stderr; token não vaza", async () => {
  const tokenFile = join(dir, "token");
  await writeFile(tokenFile, `${tokenFor("stdio-owner")}\n`);
  const { stdout, stderr } = await run({ MIUPY_API_BASE_URL: api.url, MIUPY_API_TOKEN_FILE: tokenFile }, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "notes_create", arguments: { title: "Via stdio" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "notes_get", arguments: { noteId: "invalido" } } },
  ]);
  const lines = stdout.split("\n").filter(Boolean);
  assert.ok(lines.length >= 4, `respostas esperadas, veio: ${stdout.slice(0, 200)}`);
  for (const line of lines) assert.equal(JSON.parse(line).jsonrpc, "2.0", `linha fora do protocolo: ${line.slice(0, 80)}`);
  const responses = new Map(lines.map((line) => JSON.parse(line)).filter((message) => message.id !== undefined).map((message) => [message.id, message]));
  assert.equal(responses.get(2).result.tools.length, 5);
  assert.equal(JSON.parse(responses.get(3).result.content[0].text).note.title, "Via stdio");
  assert.match(stderr, /tool\.completed/);
  assert.ok(!stdout.includes("tool.completed"));
  assert.ok(!stdout.includes(tokenFor("stdio-owner")) && !stderr.includes(tokenFor("stdio-owner")), "token não aparece em stdout nem em stderr");
});

test("stdio: sem token configurado a ferramenta responde UNAUTHORIZED sem derrubar o processo", async () => {
  const { stdout } = await run({ MIUPY_API_BASE_URL: api.url }, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "folders_list", arguments: {} } },
  ]);
  const reply = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((message) => message.id === 2);
  assert.equal(JSON.parse(reply.result.content[0].text).error.code, "UNAUTHORIZED");
});

test("stdio: recusa API remota em HTTP puro (token não trafega em claro)", async () => {
  const { stdout, stderr } = await run({ MIUPY_API_BASE_URL: "http://api.example.com", MIUPY_API_TOKEN: "x" }, []);
  assert.equal(stdout, "");
  assert.match(stderr, /HTTPS/);
});
