import { extname, join, relative } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";

// Tracks runtime @ts-ignore AND @ts-expect-error suppressions (migration in progress)

const REPO_ROOT = process.cwd();
const FIXTURE_PATH = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "ts-suppression-budget.json",
);
const RUNTIME_SCAN_TARGETS = [
  "src/background",
  "src/common",
  "src/content",
  "src/popup",
  "src/background.ts",
  "src/entrypoints/content-loader.content.ts",
  "src/content-main.ts",
  "src/popup.ts",
];
const DEFAULT_EXEMPT = [
  "src/common/page-motion-freeze-bridge.ts",
  "src/common/page-motion-freeze-control.ts",
];

async function collectTsIgnoreCounts() {
  const counts = new Map();

  async function scanDirectory(absPath) {
    for (const entry of await readdir(absPath, { withFileTypes: true })) {
      const child = join(absPath, entry.name);
      if (entry.isDirectory()) {
        await scanDirectory(child);
        continue;
      }
      if (!entry.isFile() || !child.endsWith(".ts") || child.endsWith(".d.ts")) {
        continue;
      }
      await scanFile(child);
    }
  }

  async function scanFile(absPath) {
    const source = await readFile(absPath, "utf8");
    const matchCount = source.match(/@ts-(?:ignore|expect-error)\b/g)?.length ?? 0;
    if (matchCount <= 0) {
      return;
    }
    const relPath = relative(REPO_ROOT, absPath).replaceAll("\\", "/");
    counts.set(relPath, matchCount);
  }

  for (const target of RUNTIME_SCAN_TARGETS) {
    const absTarget = join(REPO_ROOT, target);
    if (extname(target)) {
      if (target.endsWith(".d.ts")) {
        continue;
      }
      await scanFile(absTarget);
      continue;
    }
    await scanDirectory(absTarget);
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

function summarize(perFile) {
  const total = Object.values(perFile).reduce((sum, value) => sum + value, 0);
  return { total, perFile };
}

async function readExistingFixture() {
  try {
    const source = await readFile(FIXTURE_PATH, "utf8");
    return JSON.parse(source);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function resolveExemptPaths(existingExempt, perFile) {
  if (!Array.isArray(existingExempt)) {
    return DEFAULT_EXEMPT;
  }
  const availablePaths = new Set(Object.keys(perFile));
  return existingExempt.map((filePath) => {
    if (typeof filePath !== "string") {
      return filePath;
    }
    if (availablePaths.has(filePath)) {
      return filePath;
    }
    const prefixedPath = `src/${filePath}`;
    if (availablePaths.has(prefixedPath)) {
      return prefixedPath;
    }
    return filePath;
  });
}

async function reseedFixture(perFile) {
  const existing = await readExistingFixture();
  const fixture = {
    budgets: perFile,
    exempt: resolveExemptPaths(existing?.exempt, perFile),
  };
  const output = `${JSON.stringify(fixture, null, 2)}\n`;
  await writeFile(FIXTURE_PATH, output, "utf8");
}

const perFile = await collectTsIgnoreCounts();
if (process.argv.includes("--reseed")) {
  await reseedFixture(perFile);
}
console.log(JSON.stringify(summarize(perFile), null, 2));
