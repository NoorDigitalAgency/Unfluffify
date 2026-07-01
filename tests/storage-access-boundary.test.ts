import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readdirSync, readFileSync } from "./file-kit.ts";
import { path } from "./file-kit.ts";
import { fileURLToPath } from "./file-kit.ts";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");

const EXCLUDED_PATH_PREFIXES = [
  ".scratch-blink-test/",
  ".tmp/",
  ".output/",
  ".wxt/",
  "dist/",
  "node_modules/",
  "tests/",
  "orchestration/",
  "scripts/"
];

const SOURCE_FILE_PATTERN = /\.(?:c|m)?(?:js|ts)x?$/i;
const STORAGE_ACCESS_PATTERN =
  /(chrome\.storage\.|wxt\/utils\/storage|utils\.storage(?:Get|Set|Remove|Clear)\(|\bstorage(?:Get|Set|Remove|Clear)\()/;
const PAGE_LOCAL_STORAGE_PATTERN = /\bwindow\.(?:localStorage|sessionStorage)\b/;

function toRepoPath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replace(/\\/g, "/");
}

function shouldSkipPath(repoPath) {
  return EXCLUDED_PATH_PREFIXES.some((prefix) => repoPath.startsWith(prefix));
}

function collectSourceFiles(startDir) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const repoPath = toRepoPath(absolutePath);

      if (entry.isDirectory()) {
        if (shouldSkipPath(`${repoPath}/`)) {
          continue;
        }
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkipPath(repoPath)) {
        continue;
      }
      if (SOURCE_FILE_PATTERN.test(repoPath)) {
        files.push({ absolutePath, repoPath });
      }
    }
  }

  walk(startDir);
  return files;
}

function collectMatches(files, pattern) {
  const findings = [];
  for (const file of files) {
    const source = readFileSync(file.absolutePath, "utf8");
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!pattern.test(line)) {
        continue;
      }
      findings.push({
        file: file.repoPath,
        line: index + 1,
        snippet: line.trim()
      });
    }
  }
  return findings;
}

function describeFinding(finding) {
  return `${finding.file}:${finding.line} -> ${finding.snippet}`;
}

function sortFindings(findings) {
  return findings.slice().sort((a, b) => {
    if (a.file === b.file) {
      return a.line - b.line;
    }
    return a.file.localeCompare(b.file);
  });
}

// Bucket: approved wrapper modules. These are the current generic adapter files
// that are expected to contain direct storage access before Phase 4 extraction.
const APPROVED_WRAPPER_FILES = new Set([
  "src/common/storage-core.ts",
  "src/background/transfer-payload-store.ts",
  "src/background/ai-run-record-store.ts",
  "src/common/settings-store.ts",
  "src/common/page-type-taxonomy.ts",
  "src/background/tab-session-store.ts",
  "src/common/emulation.ts",
  "src/common/render-mode-js-state.ts",
  "src/background/brain/state-store-persistence.ts"
]);

// Bucket: current migration debt. Phase 12 keeps this empty so any new raw
// Chrome storage access in real source files fails until it is routed through
// an approved storage/domain module.
const CURRENT_MIGRATION_DEBT_FILES = new Set();

// Bucket: smoke/orchestration access. This track intentionally excludes
// orchestration/scripts from scanning in Phase 3, so this bucket should remain empty
// until those directories are brought into scope.
const SMOKE_ORCHESTRATION_FILES = new Set();

// Page-local storage flags are tracked separately from chrome.storage migration.
const PAGE_LOCAL_STORAGE_FILES = new Set([
  "src/content-main.ts",
  "src/content/core.ts",
  "src/popup.ts",
  "src/popup/ui.tsx"
]);

test("storage boundary inventory buckets every raw storage access", () => {
  const files = collectSourceFiles(REPO_ROOT);
  const findings = sortFindings(collectMatches(files, STORAGE_ACCESS_PATTERN));

  assert.ok(findings.length > 0, "expected at least one storage access finding");

  const unmanaged = [];
  const multiBucket = [];
  const bucketCounts = {
    approvedWrapperModules: 0,
    currentMigrationDebt: 0,
    smokeOrchestrationAccess: 0
  };

  for (const finding of findings) {
    const matchedBuckets = [];

    if (APPROVED_WRAPPER_FILES.has(finding.file)) {
      matchedBuckets.push("approvedWrapperModules");
    }
    if (CURRENT_MIGRATION_DEBT_FILES.has(finding.file)) {
      matchedBuckets.push("currentMigrationDebt");
    }
    if (SMOKE_ORCHESTRATION_FILES.has(finding.file)) {
      matchedBuckets.push("smokeOrchestrationAccess");
    }

    if (matchedBuckets.length === 0) {
      unmanaged.push(describeFinding(finding));
      continue;
    }
    if (matchedBuckets.length > 1) {
      multiBucket.push(`${describeFinding(finding)} | buckets=${matchedBuckets.join(",")}`);
      continue;
    }

    bucketCounts[matchedBuckets[0]] += 1;
  }

  assert.deepEqual(
    multiBucket,
    [],
    `every raw storage finding must map to exactly one bucket; overlaps:\n${multiBucket.join("\n")}`
  );
  assert.deepEqual(
    unmanaged,
    [],
    `new unmanaged raw storage access detected:\n${unmanaged.join("\n")}`
  );

  assert.ok(bucketCounts.approvedWrapperModules > 0, "approved wrapper bucket should not be empty");
  assert.equal(bucketCounts.currentMigrationDebt, 0, "current migration debt bucket must stay empty");
});

test("page-local localStorage/sessionStorage usage stays in tracked files", () => {
  const files = collectSourceFiles(REPO_ROOT);
  const findings = sortFindings(collectMatches(files, PAGE_LOCAL_STORAGE_PATTERN));

  assert.ok(findings.length > 0, "expected at least one page-local storage finding");

  const unmanaged = findings
    .filter((finding) => !PAGE_LOCAL_STORAGE_FILES.has(finding.file))
    .map(describeFinding);

  assert.deepEqual(
    unmanaged,
    [],
    `new unmanaged page-local storage usage detected:\n${unmanaged.join("\n")}`
  );
});
