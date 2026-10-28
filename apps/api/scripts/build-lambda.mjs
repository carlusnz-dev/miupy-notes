import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist");
await mkdir(output, { recursive: true });
await build({
  entryPoints: [join(root, "src/lambda.ts")],
  outfile: join(output, "lambda.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "bundle",
  minify: false,
  sourcemap: false,
  logLevel: "info",
});
// O ZIP inclui só lambda.js; este arquivo permite testar o bundle neste workspace ESM.
await writeFile(join(output, "package.json"), '{"type":"commonjs"}\n');
