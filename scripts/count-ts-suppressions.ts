import { extname, join, relative } from "@std/path";
// Tracks runtime @ts-ignore AND @ts-expect-error suppressions (migration in progress)

const REPO_ROOT = Deno.cwd();
const FIXTURE_PATH = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "ts-suppression-budget.json",
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
const DEFAULT_EXEMPT = [
  "common/page-motion-freeze-bridge.ts",
  "common/page-motion-freeze-control.ts",
];

type BudgetFixture = {
  budgets: Record<string, number>;
  exempt?: string[];
};

async function collectTsIgnoreCounts(): Promise<Record<string, number>> {
  const counts = new Map<string, number>();

  async function scanDirectory(absPath: string): Promise<void> {
    for await (const entry of Deno.readDir(absPath)) {
      const child = join(absPath, entry.name);
      if (entry.isDirectory) {
        await scanDirectory(child);
        continue;
      }
      if (!entry.isFile || !child.endsWith(".ts") || child.endsWith(".d.ts")) {
        continue;
      }
      await scanFile(child);
    }
  }

  async function scanFile(absPath: string): Promise<void> {
    const source = await Deno.readTextFile(absPath);
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

function summarize(perFile: Record<string, number>) {
  const total = Object.values(perFile).reduce((sum, value) => sum + value, 0);
  return { total, perFile };
}

async function readExistingFixture(): Promise<BudgetFixture | null> {
  try {
    const source = await Deno.readTextFile(FIXTURE_PATH);
    return JSON.parse(source) as BudgetFixture;
  } catch {
    return null;
  }
}

async function reseedFixture(perFile: Record<string, number>): Promise<void> {
  const existing = await readExistingFixture();
  const fixture: BudgetFixture = {
    budgets: perFile,
    exempt: existing?.exempt ?? DEFAULT_EXEMPT,
  };
  const output = `${JSON.stringify(fixture, null, 2)}\n`;
  await Deno.writeTextFile(FIXTURE_PATH, output);
}

const perFile = await collectTsIgnoreCounts();
if (Deno.args.includes("--reseed")) {
  await reseedFixture(perFile);
}
console.log(JSON.stringify(summarize(perFile), null, 2));
