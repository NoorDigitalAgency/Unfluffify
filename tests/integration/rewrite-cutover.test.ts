import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
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
  normalize("src/common"),
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
  const specifiers = [
    ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\s+["']([^"']+)["']/g),
    ...source.matchAll(/export\s+[^"']*from\s+["']([^"']+)["']/g),
  ].map((match) => match[1]);
  return specifiers.some((specifier) => {
    const resolved = resolveImportPath(file, specifier);
    if (!resolved) {
      return false;
    }
    return [...LEGACY_TARGETS].some((target) => resolved === target || resolved.startsWith(`${target}/`));
  });
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

  it("boots at least one new-tree entrypoint in the generated extension", async () => {
    await ensureBuildOutput({ force: true });
    const manifestPath = ".output/chrome-mv3/manifest.json";
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const scripts = (manifest.content_scripts ?? []).flatMap((entry: { js?: string[] }) => entry.js ?? []);
    expect(scripts).toContain("content-scripts/page-world.js");
    expect(existsSync(".output/chrome-mv3/content-scripts/page-world.js")).toBe(true);
  });

  it("detects nested legacy import specifiers", () => {
    expect(hasForbiddenLegacyImport('import x from "../../common/foo";')).toBe(true);
    expect(hasForbiddenLegacyImport('import "../../common/foo";')).toBe(true);
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
