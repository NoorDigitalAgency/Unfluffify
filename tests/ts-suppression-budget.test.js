import test from "node:test";
// Tracks runtime @ts-ignore AND @ts-expect-error suppressions (migration in progress)
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const BUDGET_PATH = path.join(
  REPO_ROOT,
  "tests/fixtures/ts-suppression-budget.json",
);

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

function collectTsIgnoreCounts() {
  const counts = new Map();

  function scanDirectory(absolutePath) {
    const entries = readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(childPath);
        continue;
      }
      if (
        !entry.isFile() || !childPath.endsWith(".ts") ||
        childPath.endsWith(".d.ts")
      ) {
        continue;
      }
      scanFile(childPath);
    }
  }

  function scanFile(absolutePath) {
    const source = readFileSync(absolutePath, "utf8");
    const count = (source.match(/@ts-(?:ignore|expect-error)\b/g) || []).length;
    if (!count) {
      return;
    }
    const relPath = path.relative(REPO_ROOT, absolutePath).replace(/\\/g, "/");
    counts.set(relPath, count);
  }

  for (const target of RUNTIME_SCAN_TARGETS) {
    const absoluteTarget = path.join(REPO_ROOT, target);
    if (path.extname(target)) {
      if (target.endsWith(".d.ts")) {
        continue;
      }
      scanFile(absoluteTarget);
      continue;
    }
    scanDirectory(absoluteTarget);
  }

  return Object.fromEntries(
    Array.from(counts.entries()).sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    }),
  );
}

function readBudgetFixture() {
  const source = readFileSync(BUDGET_PATH, "utf8");
  const parsed = JSON.parse(source);
  return {
    budgets: parsed.budgets || {},
    exempt: parsed.exempt || [],
  };
}

test("runtime suppression directives stay within the tracked budget", () => {
  const { budgets, exempt } = readBudgetFixture();
  const actual = collectTsIgnoreCounts();

  const unexpectedFiles = Object.keys(actual)
    .filter((filePath) => !(filePath in budgets))
    .sort((a, b) => a.localeCompare(b));

  const overBudget = Object.entries(actual)
    .filter(([filePath, count]) => count > (budgets[filePath] ?? 0))
    .map(([filePath, count]) => `${filePath}: ${count} > ${budgets[filePath]}`);

  const totalActual = Object.values(actual).reduce(
    (sum, value) => sum + value,
    0,
  );
  const totalBudget = Object.values(budgets).reduce(
    (sum, value) => sum + value,
    0,
  );

  assert.deepEqual(
    unexpectedFiles,
    [],
    `new runtime suppression files detected:\n${unexpectedFiles.join("\n")}`,
  );

  assert.deepEqual(
    overBudget,
    [],
    `runtime suppression budget exceeded:\n${overBudget.join("\n")}`,
  );

  assert.ok(
    totalActual <= totalBudget,
    `runtime suppression total should only decrease (${totalActual} > ${totalBudget})`,
  );

  const exemptMismatches = exempt
    .filter((filePath) => (actual[filePath] ?? 0) !== (budgets[filePath] ?? 0))
    .map(
      (filePath) =>
        `${filePath}: actual=${actual[filePath] ?? 0}, expected=${
          budgets[filePath] ?? 0
        }`,
    );

  assert.deepEqual(
    exemptMismatches,
    [],
    `exempt runtime suppression floors drifted:\n${exemptMismatches.join("\n")}`,
  );
});
