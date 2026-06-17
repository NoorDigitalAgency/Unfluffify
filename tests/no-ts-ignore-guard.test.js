import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const RUNTIME_SCAN_TARGETS = [
  "background",
  "common",
  "content",
  "popup",
  "background.ts",
  "content-loader.ts",
  "content-main.ts",
  "popup.ts",
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
