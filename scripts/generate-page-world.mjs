import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_PATH = resolve(REPO_ROOT, "src/page-world/program.ts");
const GENERATED_PATH = resolve(REPO_ROOT, "src/page-world/program.js");
const CHECK_ONLY = process.argv.includes("--check");
const BANNER = "// GENERATED from src/page-world/program.ts. Run: pnpm page-world:generate\n";

const result = await build({
  entryPoints: [SOURCE_PATH],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome114"],
  legalComments: "none",
  charset: "utf8",
});
const generated = `${BANNER}${result.outputFiles[0].text}`;

if (CHECK_ONLY) {
  const current = await readFile(GENERATED_PATH, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write("src/page-world/program.js is stale; run pnpm page-world:generate\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(GENERATED_PATH, generated, "utf8");
}
