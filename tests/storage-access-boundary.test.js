import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");

const EXCLUDED_PATH_PREFIXES = [
  ".tmp/",
  "node_modules/",
  "tests/",
  "orchestration/",
  "scripts/"
];

const JS_FILE_PATTERN = /\.(?:c|m)?js$/i;
const STORAGE_ACCESS_PATTERN = /(chrome\.storage\.|utils\.storage(?:Get|Set|Remove)\(|\bstorage(?:Get|Set|Remove)\()/;
const PAGE_LOCAL_STORAGE_PATTERN = /\bwindow\.(?:localStorage|sessionStorage)\b/;

function toRepoPath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replace(/\\/g, "/");
}

function shouldSkipPath(repoPath) {
  return EXCLUDED_PATH_PREFIXES.some((prefix) => repoPath.startsWith(prefix));
}

function collectJavaScriptFiles(startDir) {
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
      if (JS_FILE_PATTERN.test(repoPath)) {
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
  "common/storage-core.js",
  "background/transfer-payload-store.js",
  "common/settings-store.js"
]);

// Bucket: current migration debt. These files are expected to be moved phase-by-phase.
const CURRENT_MIGRATION_DEBT_FILES = new Set([
  "background.js",
  "popup.js",
  "popup/helpers.js",
  "content-main.js",
  "common/emulation.js",
  "common/property-lock-background.js",
  "common/lynx-live-pages.js",
  "common/utilities.js"
]);

// Bucket: smoke/orchestration access. This track intentionally excludes
// orchestration/scripts from scanning in Phase 3, so this bucket should remain empty
// until those directories are brought into scope.
const SMOKE_ORCHESTRATION_FILES = new Set();

// Page-local storage flags are tracked separately from chrome.storage migration.
const PAGE_LOCAL_STORAGE_FILES = new Set([
  "content-loader.js",
  "content-main.js",
  "content/core.js",
  "popup.js",
  "popup/ui.js"
]);

// TODO by migration phase:
// Phase 5: remove transfer payload debt from popup.js.
// Phase 6: move remaining settings reads to settings-store boundaries.
// Phase 8: migrate background credential ownership.
// Phase 9: migrate tab session state helpers out of common/utilities.js call sites.
// Phase 10: isolate device emulation storage behind one domain boundary.
// Phase 12: remove all remaining migration debt buckets and enforce strict raw-storage boundary.

test("storage boundary inventory buckets every raw storage access", () => {
  const files = collectJavaScriptFiles(REPO_ROOT);
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
  assert.ok(bucketCounts.currentMigrationDebt > 0, "current migration debt bucket should not be empty");
});

test("page-local localStorage/sessionStorage usage stays in tracked files", () => {
  const files = collectJavaScriptFiles(REPO_ROOT);
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
