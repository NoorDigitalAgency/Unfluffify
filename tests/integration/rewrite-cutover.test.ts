import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureBuildOutput } from "../build-output-kit";

const NEW_TREE_DIRS = [
  "src/domain",
  "src/messaging",
  "src/storage",
  "src/lynx",
  "src/content/stabilization",
  "src/content/marking",
  "src/lock",
];

const ENTRYPOINT_DIRS = [
  "src/entrypoints",
];

const WXT_ENTRYPOINTS = [
  "src/entrypoints/background.ts",
  "src/entrypoints/content-loader.content.ts",
  "src/entrypoints/offscreen/main.ts",
  "src/entrypoints/popup/main.tsx",
];

const REQUIRED_REACHABLE_FEATURES = [
  {
    label: "typed bus",
    paths: ["src/messaging"],
  },
  {
    label: "storage repositories",
    paths: ["src/storage", "src/storage/repositories"],
  },
  {
    label: "lynx REST/AI/GraphQL clients",
    paths: ["src/lynx/rest.ts", "src/lynx/ai.ts", "src/lynx/graphql.ts"],
  },
  {
    label: "property lock client",
    paths: ["src/lock/client.ts"],
  },
  {
    label: "content stabilization",
    paths: ["src/content/stabilization"],
  },
  {
    label: "MV3 persistence",
    paths: ["src/background/persistence.ts"],
  },
];

const NEW_TREE_FEATURE_DIRS = [
  "src/background",
  "src/common",
  "src/content",
  "src/domain",
  "src/lock",
  "src/lynx",
  "src/messaging",
  "src/offscreen",
  "src/page-world",
  "src/popup",
  "src/storage",
];

const PENDING_DELETION_PATHS = new Set<string>();
const BUILD_AUTHORED_SOURCES = new Set([
  normalize("src/page-world/program.ts"),
  normalize("src/page-world/program.generated.js"),
]);
const RETIRED_BRAIN_SIGNAL_NAMES = new Set([
  "inspection.started",
  "inspection.ended",
]);

const LEGACY_GOD_FILES = [
  "src/background.ts",
  "src/content-main.ts",
  "src/content/core.ts",
  "src/popup.ts",
  "src/common/config.ts",
];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

const LEGACY_TARGETS = new Set([
  normalize("src/common/config.ts"),
  normalize("src/popup.ts"),
  normalize("src/background.ts"),
  normalize("src/content-main.ts"),
  normalize("src/content/core.ts"),
]);

function resolveImportPath(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return normalize(specifier);
  }
  const withExtension = normalize(join(dirname(file), specifier));
  if (withExtension.endsWith(".js") && LEGACY_TARGETS.has(withExtension.replace(/\.js$/, ".ts"))) {
    return withExtension.replace(/\.js$/, ".ts");
  }
  if (LEGACY_TARGETS.has(`${withExtension}.ts`)) {
    return `${withExtension}.ts`;
  }
  return withExtension;
}

function hasForbiddenLegacyImport(source: string, file = "src/content/marking/example.ts"): boolean {
  return getImportSpecifiers(source).some((specifier) => {
    const resolved = resolveImportPath(file, specifier);
    if (!resolved) {
      return false;
    }
    return [...LEGACY_TARGETS].some((target) => resolved === target || resolved.startsWith(`${target}/`));
  });
}

function getImportSpecifiers(source: string): string[] {
  const specifiers = [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\s+["']([^"']+)["']/g),
    ...source.matchAll(/export\s+[^"']*from\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  return specifiers;
}

function candidatePathsForImport(file: string, specifier: string): string[] {
  const resolved = normalize(join(dirname(file), specifier));
  if (extname(resolved)) {
    return [
      resolved,
      ...(resolved.endsWith(".js") ? [resolved.replace(/\.js$/, ".ts"), resolved.replace(/\.js$/, ".tsx")] : []),
    ];
  }
  return [
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.css`,
    join(resolved, "index.ts"),
    join(resolved, "index.tsx"),
    join(resolved, "index.js"),
  ];
}

function resolveSourceImport(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  return candidatePathsForImport(file, specifier).find((candidate) => existsSync(candidate)) ?? null;
}

function resolvesRelativeImport(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return true;
  }
  return resolveSourceImport(file, specifier) !== null;
}

function buildEntrypointReachability(): Set<string> {
  const reachable = new Set<string>();
  const queue = WXT_ENTRYPOINTS.filter((entrypoint) => existsSync(entrypoint));
  while (queue.length > 0) {
    const file = normalize(queue.shift()!);
    if (reachable.has(file) || !/\.(?:ts|tsx|js)$/.test(file) || !existsSync(file)) {
      continue;
    }
    reachable.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of getImportSpecifiers(source)) {
      const resolved = resolveSourceImport(file, specifier);
      if (resolved && !reachable.has(normalize(resolved))) {
        queue.push(normalize(resolved));
      }
    }
  }
  return reachable;
}

function pathIsReachable(reachable: ReadonlySet<string>, target: string): boolean {
  const normalizedTarget = normalize(target);
  return [...reachable].some((file) => file === normalizedTarget || file.startsWith(`${normalizedTarget}/`));
}

function listFeatureFiles(): string[] {
  return NEW_TREE_FEATURE_DIRS
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => listFiles(dir))
    .filter((file) => /\.(?:ts|tsx|js)$/.test(file))
    .map((file) => normalize(file));
}

function isPendingDeletion(file: string): boolean {
  return [...PENDING_DELETION_PATHS].some((pendingPath) => file === pendingPath || file.startsWith(`${pendingPath}/`));
}

function rawAppEnvelopeFindings(reachable: ReadonlySet<string>): string[] {
  return [...reachable].flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const findings: string[] = [];
    if (/runtime\.sendMessage\s*\(\s*\{[\s\S]*?type:\s*["']uf\./.test(source)) {
      findings.push(`${file}: runtime.sendMessage({ type: "uf.*" })`);
    }
    if (/runtime\.onMessage\.addListener[\s\S]*?(?:request|message)\.type\s*={0,2}=+\s*["']uf\./.test(source)) {
      findings.push(`${file}: runtime.onMessage app-level uf.* dispatch`);
    }
    return findings;
  });
}

function brainSignalNames(): string[] {
  const signalSource = readFileSync("src/domain/schema/signals.ts", "utf8");
  const enumBody = signalSource.match(/BrainSignalNameSchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  return [...enumBody.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function decidedSignalNames(): string[] {
  const decideSource = readFileSync("src/background/brain/decide.ts", "utf8");
  return [...decideSource.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe("P10 cutover guard", () => {
  it("keeps the fresh rewrite tree and WXT entrypoints isolated from legacy implementation imports", () => {
    const offenders = [...NEW_TREE_DIRS, ...ENTRYPOINT_DIRS].flatMap((dir) =>
      listFiles(dir)
        .filter((file) => /\.(?:ts|tsx|js)$/.test(file))
        .flatMap((file) => hasForbiddenLegacyImport(readFileSync(file, "utf8"), file) ? [file] : [])
    );

    expect(offenders).toEqual([]);
  });

  it("asserts the old god-files are deleted after cutover", () => {
    expect(LEGACY_GOD_FILES.filter((file) => existsSync(file))).toEqual([]);
  });

  it("does not leave surviving source modules with unresolved relative imports", () => {
    const offenders = listFiles("src")
      .filter((file) => /\.(?:ts|tsx|js)$/.test(file))
      .flatMap((file) =>
        getImportSpecifiers(readFileSync(file, "utf8"))
          .filter((specifier) => !resolvesRelativeImport(file, specifier))
          .map((specifier) => `${file} -> ${specifier}`)
      );

    expect(offenders).toEqual([]);
  });

  it("wires all rewrite feature subsystems into an entrypoint-reachable graph", () => {
    const reachable = buildEntrypointReachability();
    const missing = REQUIRED_REACHABLE_FEATURES.flatMap((feature) =>
      feature.paths.every((target) => pathIsReachable(reachable, target))
        ? []
        : [`${feature.label}: expected one of ${feature.paths.join(", ")} to be reachable`]
    );

    expect(missing).toEqual([]);
  });

  it("keeps the live path on the typed bus instead of raw uf.* runtime envelopes", () => {
    expect(rawAppEnvelopeFindings(buildEntrypointReachability())).toEqual([]);
  });

  it("does not leave orphaned new-tree feature files outside entrypoint reachability", () => {
    const reachable = buildEntrypointReachability();
    const generator = readFileSync("scripts/generate-page-world.mjs", "utf8");
    expect(generator).toContain("src/page-world/program.ts");
    expect(generator).toContain("src/page-world/program.generated.js");
    expect(pathIsReachable(reachable, "src/page-world/program.ts")).toBe(true);
    expect(pathIsReachable(reachable, "src/page-world/program.generated.js")).toBe(false);
    const orphaned = listFeatureFiles()
      .filter((file) => !reachable.has(file))
      .filter((file) => !BUILD_AUTHORED_SOURCES.has(file))
      .filter((file) => !isPendingDeletion(file))
      .sort((left, right) => left.localeCompare(right));

    expect(orphaned.map((file) => relative(".", file))).toEqual([]);
  });

  it("requires the reachable rewrite brain to decide every active public signal", () => {
    expect(pathIsReachable(buildEntrypointReachability(), "src/background/brain/decide.ts")).toBe(true);
    const decided = new Set(decidedSignalNames());
    const publicSignals = brainSignalNames();
    const missing = publicSignals.filter((name) =>
      !RETIRED_BRAIN_SIGNAL_NAMES.has(name) && !decided.has(name)
    );

    expect(missing).toEqual([]);
    expect([...RETIRED_BRAIN_SIGNAL_NAMES].filter((name) => !publicSignals.includes(name))).toEqual([]);
    expect([...RETIRED_BRAIN_SIGNAL_NAMES].filter((name) => decided.has(name))).toEqual([]);
  });

  it("boots at least one new-tree entrypoint in the generated extension", async () => {
    await ensureBuildOutput({ force: true });
    const manifestPath = ".output/chrome-mv3/manifest.json";
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const scripts = (manifest.content_scripts ?? []).flatMap((entry: { js?: string[] }) => entry.js ?? []);
    expect(scripts).toContain("content-scripts/content-loader.js");
    expect(scripts).not.toContain("content-scripts/page-world.js");
    expect(existsSync(".output/chrome-mv3/content-scripts/page-world.js")).toBe(false);
  }, 180_000);

  it("detects nested legacy import specifiers", () => {
    expect(hasForbiddenLegacyImport('import x from "../../common/config";')).toBe(true);
    expect(hasForbiddenLegacyImport('import "../../common/config";')).toBe(true);
    expect(hasForbiddenLegacyImport('import x from "../../../background";', "src/content/marking/deep/example.ts")).toBe(true);
    expect(hasForbiddenLegacyImport('import "../../../background";', "src/content/marking/deep/example.ts")).toBe(true);
    expect(hasForbiddenLegacyImport('import x from "../content-main";', "src/entrypoints/content-loader.content.ts")).toBe(true);
    expect(hasForbiddenLegacyImport('import "../../popup.js";', "src/entrypoints/popup/main.ts")).toBe(true);
    expect(hasForbiddenLegacyImport('import x from "../../content/core";')).toBe(true);
    expect(hasForbiddenLegacyImport('import x from "../core";', "src/content/marking/store.ts")).toBe(true);
    expect(hasForbiddenLegacyImport('export { x } from "../../popup";')).toBe(true);
    expect(hasForbiddenLegacyImport('import x from "../../domain/schema";')).toBe(false);
  });
});
