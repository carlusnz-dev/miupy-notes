// Dev server sintético sem carregar .env*. Não entra no build.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, loadConfigFromFile } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const envDir = path.join(tmpdir(), "miupy-library-empty-env");
mkdirSync(envDir, { recursive: true });
const { config } = await loadConfigFromFile({ command: "serve", mode: "development" }, path.join(root, "vite.config.ts"));
const server = await createServer({
  ...config, root, configFile: false, envDir,
  server: { ...config.server, host: "127.0.0.1", port: 5204, strictPort: true, proxy: { "/v1": "http://127.0.0.1:3204" } },
});
await server.listen();
server.printUrls();
