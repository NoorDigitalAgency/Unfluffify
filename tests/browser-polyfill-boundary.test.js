import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readdirSync, readFileSync } from "./file-kit.ts";
import { path } from "./file-kit.ts";
import { fileURLToPath } from "./file-kit.ts";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");

const EXCLUDED_PATH_PREFIXES = [
  ".tmp/",
  ".wxt/",
  ".output/",
  "dist/",
  "node_modules/",
  "orchestration/",
  "scripts/",
  "tests/",
  "vitest-tests/"
];

const SOURCE_FILE_PATTERN = /\.(?:c|m)?(?:js|ts)$/i;
const RAW_CHROME_PATTERN = /\bchrome\./;

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

      if (!entry.isFile() || shouldSkipPath(repoPath) || !SOURCE_FILE_PATTERN.test(repoPath)) {
        continue;
      }
      files.push({ absolutePath, repoPath });
    }
  }

  walk(startDir);
  return files;
}

function collectMatches(files) {
  const findings = [];
  for (const file of files) {
    const source = readFileSync(file.absolutePath, "utf8");
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!RAW_CHROME_PATTERN.test(line)) {
        continue;
      }
      findings.push({
        file: file.repoPath,
        line: index + 1,
        snippet: line.trim()
      });
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function describeFinding(finding) {
  return `${finding.file}:${finding.line} -> ${finding.snippet}`;
}

const BROWSER_SEAM_FILES = new Set([
  "common/browser.ts"
]);

const CURRENT_MIGRATION_DEBT_FILES = new Set([
  "background.ts",
  "background/ai-run-record-store.ts",
  "background/brain/index.ts",
  "background/popup-state-broker.ts",
  "background/render-mode-inspector.ts",
  "background/tab-inactivity-observer.ts",
  "background/tab-session-store.ts",
  "background/transfer-payload-store.ts",
  "common/emulation.ts",
  "common/page-motion-freeze-bridge.ts",
  "common/render-mode-js-state.ts",
  "common/settings-store.ts",
  "common/storage-core.ts",
  "common/utilities.ts",
  "content/core.ts"
]);

test("browser polyfill boundary buckets every remaining raw chrome usage", () => {
  const files = collectSourceFiles(REPO_ROOT);
  const findings = collectMatches(files);

  assert.ok(findings.length > 0, "expected at least one raw chrome finding");

  const unmanaged = [];
  const multiBucket = [];
  const bucketCounts = {
    browserSeam: 0,
    currentMigrationDebt: 0
  };

  for (const finding of findings) {
    const matchedBuckets = [];
    if (BROWSER_SEAM_FILES.has(finding.file)) {
      matchedBuckets.push("browserSeam");
    }
    if (CURRENT_MIGRATION_DEBT_FILES.has(finding.file)) {
      matchedBuckets.push("currentMigrationDebt");
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
    `every raw chrome finding must map to exactly one bucket; overlaps:\n${multiBucket.join("\n")}`
  );
  assert.deepEqual(
    unmanaged,
    [],
    `new unmanaged raw chrome usage detected:\n${unmanaged.join("\n")}`
  );
});
