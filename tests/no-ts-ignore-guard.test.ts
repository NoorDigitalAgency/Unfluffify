import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { existsSync, readdirSync, readFileSync } from "./file-kit.ts";
import { path } from "./file-kit.ts";
import { fileURLToPath } from "./file-kit.ts";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const RUNTIME_SCAN_TARGETS = [
  "src/background",
  "src/common",
  "src/content",
  "src/entrypoints",
  "src/popup",
];

function collectRuntimeTsFiles() {
  const files = [];

  function scanDirectory(absolutePath) {
    const entries = readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(childPath);
        continue;
      }
      if (!entry.isFile() || !childPath.endsWith(".ts") || childPath.endsWith(".d.ts")) {
        continue;
      }
      files.push(childPath);
    }
  }

  for (const target of RUNTIME_SCAN_TARGETS) {
    const absoluteTarget = path.join(REPO_ROOT, target);
    if (!existsSync(absoluteTarget)) {
      continue;
    }
    if (path.extname(target)) {
      if (!target.endsWith(".d.ts")) {
        files.push(absoluteTarget);
      }
      continue;
    }
    scanDirectory(absoluteTarget);
  }

  return files;
}

test("no runtime @ts-ignore remains (use @ts-expect-error)", () => {
  const offenders = collectRuntimeTsFiles()
    .filter((absolutePath) => /@ts-ignore\b/.test(readFileSync(absolutePath, "utf8")))
    .map((absolutePath) => path.relative(REPO_ROOT, absolutePath).replace(/\\/g, "/"))
    .sort((left, right) => left.localeCompare(right));

  assert.deepEqual(
    offenders,
    [],
    `@ts-ignore found; convert to @ts-expect-error:\n${offenders.join("\n")}`,
  );
});
