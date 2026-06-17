import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const EXPECTED_PATH = path.join(REPO_ROOT, "tests/fixtures/expected-ts-nocheck.txt");

const RUNTIME_SCAN_TARGETS = [
  "background",
  "common",
  "content",
  "popup",
  "background.ts",
  "content-loader.ts",
  "content-main.ts",
  "popup.ts"
];

function collectTsNoCheckFiles() {
  const findings = [];

  function walk(absolutePath) {
    const stats = path.extname(absolutePath)
      ? { isFile: () => true, isDirectory: () => false }
      : null;

    if (stats && stats.isFile()) {
      const source = readFileSync(absolutePath, "utf8");
      if (source.includes("@ts-nocheck")) {
        findings.push(path.relative(REPO_ROOT, absolutePath).replace(/\\/g, "/"));
      }
      return;
    }

    const entries = readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        walk(childPath);
        continue;
      }
      if (!entry.isFile() || !childPath.endsWith(".ts")) {
        continue;
      }
      const source = readFileSync(childPath, "utf8");
      if (source.includes("@ts-nocheck")) {
        findings.push(path.relative(REPO_ROOT, childPath).replace(/\\/g, "/"));
      }
    }
  }

  for (const target of RUNTIME_SCAN_TARGETS) {
    const absoluteTarget = path.join(REPO_ROOT, target);
    if (!path.extname(target)) {
      walk(absoluteTarget);
      continue;
    }

    if (!absoluteTarget.endsWith(".ts")) {
      continue;
    }
    const source = readFileSync(absoluteTarget, "utf8");
    if (source.includes("@ts-nocheck")) {
      findings.push(path.relative(REPO_ROOT, absoluteTarget).replace(/\\/g, "/"));
    }
  }

  return findings.sort((a, b) => a.localeCompare(b));
}

function readExpectedAllowlist() {
  const source = readFileSync(EXPECTED_PATH, "utf8");
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

test("runtime @ts-nocheck files stay within the tracked allowlist", () => {
  const expected = readExpectedAllowlist();
  const actual = collectTsNoCheckFiles();

  const expectedSet = new Set(expected);
  const unexpected = actual.filter((filePath) => !expectedSet.has(filePath));

  assert.deepEqual(
    unexpected,
    [],
    `new runtime @ts-nocheck files detected:\n${unexpected.join("\n")}`
  );

  assert.ok(actual.length <= expected.length, "@ts-nocheck count should only decrease");
});
