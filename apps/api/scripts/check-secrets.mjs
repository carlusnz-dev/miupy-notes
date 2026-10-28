import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const sourcePaths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps", "infra", "scripts", "package.json"], { cwd: root })
  .toString("utf8").split("\0").filter(Boolean).map((path) => resolve(root, path));
const bundle = resolve(root, "apps/web/dist");
if (!existsSync(bundle)) {
  console.error("Bundle ausente: execute npm run build:web antes da varredura.");
  process.exit(2);
}

function bundleFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? bundleFiles(path) : entry.isFile() ? [path] : [];
  });
}

const bundlePaths = bundleFiles(bundle);
const patterns = [
  ["chave privada", /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ["chave de acesso AWS", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["chave de API Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["token GitHub", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/],
  ["segredo de provedor no frontend", /\b(?:VITE_|NEXT_PUBLIC_|PUBLIC_)?(?:GOOGLE_CLIENT_SECRET|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY)\s*[:=]\s*["'][^"']{8,}["']/],
];
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".svg", ".mjs", ".tf"]);
const findings = [];
for (const path of [...new Set([...sourcePaths, ...bundlePaths])]) {
  if (!textExtensions.has(extname(path)) || path.includes("/node_modules/") || statSync(path).size > 10_000_000) continue;
  const content = readFileSync(path, "utf8");
  for (const [name, pattern] of patterns) {
    if (name === "segredo de provedor no frontend" && !path.startsWith(resolve(root, "apps/web") + "/")) continue;
    if (pattern.test(content)) findings.push(`${relative(root, path)}: ${name}`);
  }
}
if (findings.length) {
  console.error(`Possíveis segredos encontrados (${findings.length}):\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`Varredura concluída: ${sourcePaths.length} arquivos de código e ${bundlePaths.length} arquivos do bundle, sem padrões de segredo detectados.`);
