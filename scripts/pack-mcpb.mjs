// Claude Desktop 用の拡張機能(.mcpb)を作る。
// ビルド済みの dist と本番の依存だけを mcpb-build/ に集め、公式の mcpb で固める。
// 実行: npm run pack:mcpb(先に npm run build が走る)
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, readFileSync } from "node:fs";

const STAGE = "mcpb-build";
const { version } = JSON.parse(readFileSync("package.json", "utf-8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
if (manifest.version !== version) {
  throw new Error(`manifest.json の version(${manifest.version})が package.json(${version})と違う`);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE);
cpSync("dist", `${STAGE}/dist`, {
  recursive: true,
  filter: (src) => !src.endsWith(".test.js"),
});
for (const file of ["package.json", "package-lock.json", "manifest.json", "icon.png", "LICENSE", "README.md"]) {
  cpSync(file, `${STAGE}/${file}`);
}
execSync("npm ci --omit=dev --ignore-scripts", { cwd: STAGE, stdio: "inherit" });
execSync(`npx -y @anthropic-ai/mcpb@2.1.2 pack ${STAGE} mmm-mcp-server.mcpb`, {
  stdio: "inherit",
});
