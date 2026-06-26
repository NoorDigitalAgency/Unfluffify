import { test } from "./test-kit.ts";
// Tracks the documented runtime suppression floor for intentional exemptions.
import { assert } from "./test-kit.ts";
import { readdirSync, readFileSync } from "./file-kit.ts";
import { path } from "./file-kit.ts";
import { fileURLToPath } from "./file-kit.ts";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const BUDGET_PATH = path.join(
  REPO_ROOT,
  "tests/fixtures/ts-suppression-budget.json",
);

const RUNTIME_SCAN_TARGETS = ["src"];

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

test("runtime suppression directives stay within the documented floor", () => {
  const { budgets, exempt } = readBudgetFixture();
  const actual = collectTsIgnoreCounts();
  const actualPaths = Object.keys(actual).sort((a, b) => a.localeCompare(b));
  const budgetPaths = Object.keys(budgets).sort((a, b) => a.localeCompare(b));
  const exemptPaths = [...exempt].sort((a, b) => a.localeCompare(b));
  const staleExemptPaths = exempt.filter((filePath) => !(filePath in budgets));
  const staleBudgetPaths = budgetPaths.filter((filePath) => !exempt.includes(filePath));

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

  assert.deepEqual(
    staleExemptPaths,
    [],
    `exempt runtime suppression paths must stay aligned with budget keys:\n${staleExemptPaths.join("\n")}`,
  );

  assert.deepEqual(
    staleBudgetPaths,
    [],
    `runtime suppression budgets must only track exempt paths:\n${staleBudgetPaths.join("\n")}`,
  );

  assert.deepEqual(
    budgetPaths,
    exemptPaths,
    `runtime suppression budget keys must exactly match the exempt set:\nexpected ${exemptPaths.join(", ")}\nactual ${budgetPaths.join(", ")}`,
  );

  assert.deepEqual(
    actualPaths,
    budgetPaths,
    `runtime suppression budget keys must exactly match the live suppression files:\nexpected ${actualPaths.join(", ")}\nactual ${budgetPaths.join(", ")}`,
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
