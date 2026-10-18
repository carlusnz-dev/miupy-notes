import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(apiRoot, "src");
const modulesRoot = path.join(sourceRoot, "modules");
const required = ["index.ts", "module.ts", "dto/input.ts", "dto/output.ts", "dto/adapter.ts"];
const folders = ["domain", "repository", "services", "controllers", "routes"];
const failures = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.name.endsWith(".ts") ? [target] : [];
  });
}

const modules = readdirSync(modulesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
for (const name of modules) {
  const root = path.join(modulesRoot, name);
  for (const item of required) if (!existsSync(path.join(root, item))) failures.push(`${name}: falta ${item}`);
  for (const item of folders) if (!existsSync(path.join(root, item))) failures.push(`${name}: falta pasta ${item}`);
}

for (const source of walk(sourceRoot)) {
  const content = readFileSync(source, "utf8");
  for (const match of content.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
    if (!match[1].startsWith(".")) continue;
    const target = path.resolve(path.dirname(source), match[1].replace(/\.js$/, ".ts"));
    const relative = path.relative(modulesRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const [moduleName, ...parts] = relative.split(path.sep);
    const sourceModule = path.relative(modulesRoot, source).split(path.sep)[0];
    if (sourceModule !== moduleName && parts.join("/") !== "index.ts") {
      failures.push(`${path.relative(apiRoot, source)}: importe ${moduleName} apenas pelo index.ts`);
    }
  }
}

if (failures.length) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`${modules.length} módulo(s) com estrutura e fronteiras válidas.\n`);
}
