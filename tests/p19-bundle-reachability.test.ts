import { join } from "node:path";

import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

import {
  P19_REPO_ROOT,
  listP19SourceFiles,
  repositoryPath,
} from "./p19-architecture-kit";

type RealmInputs = Readonly<{
  popup: ReadonlySet<string>;
  content: ReadonlySet<string>;
}>;

function normalizeMetafileInput(input: string): string {
  const normalized = input.replaceAll("\\", "/");
  return normalized.startsWith("/") ? repositoryPath(normalized) : normalized.replace(/^\.\//, "");
}

async function buildSourceInputs(entryPoint: string): Promise<ReadonlySet<string>> {
  const result = await build({
    absWorkingDir: P19_REPO_ROOT,
    bundle: true,
    define: { __UF_DEBUG_BUILD__: "false" },
    entryPoints: [entryPoint],
    external: ["*.png", "*.svg", "*.ttf", "*.woff", "*.woff2"],
    format: "esm",
    logLevel: "silent",
    metafile: true,
    outdir: join(P19_REPO_ROOT, ".tmp/p19-bundle-reachability"),
    platform: "browser",
    target: "chrome116",
    write: false,
  });
  if (!result.metafile) {
    throw new Error(`esbuild did not return a metafile for ${entryPoint}`);
  }
  return new Set(Object.keys(result.metafile.inputs).map(normalizeMetafileInput));
}

function inputsUnder(inputs: ReadonlySet<string>, prefix: string): string[] {
  return [...inputs].filter((input) => input.startsWith(prefix)).sort();
}

function isReactRuntimeInput(input: string): boolean {
  return /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?react(?:-dom)?\//.test(input);
}

function isPopupExtractionCandidate(path: string): boolean {
  return path === "src/popup/use-transient-surfaces.ts" ||
    path.startsWith("src/popup/controllers/") ||
    path.startsWith("src/popup/sections/") ||
    /^src\/popup\/[^/]+-controller\.tsx?$/.test(path);
}

function isContentExtractionCandidate(path: string): boolean {
  return path === "src/content/preview-controller.ts" ||
    path === "src/content/render-inspection-curtain.ts" ||
    path === "src/content/transient-surfaces.ts" ||
    path.startsWith("src/content/controllers/") ||
    /^src\/content\/[^/]+-lifecycle\.tsx?$/.test(path);
}

describe("ACCEPT-P19-DECOMPOSITION bundle reachability", () => {
  let inputs: RealmInputs;

  beforeAll(async () => {
    const [popup, content] = await Promise.all([
      buildSourceInputs("src/entrypoints/popup/main.tsx"),
      buildSourceInputs("src/entrypoints/content-loader.content.ts"),
    ]);
    inputs = { popup, content };
  });

  it("keeps popup and content implementation graphs realm-local", () => {
    expect(inputsUnder(inputs.popup, "src/content/")).toEqual([]);
    expect(inputsUnder(inputs.content, "src/popup/")).toEqual([]);
  });

  it("keeps React out of the content realm", () => {
    expect([...inputs.content].filter(isReactRuntimeInput)).toEqual([]);
  });

  it("keeps background implementation modules out of page-realm bundles", () => {
    expect({
      popup: inputsUnder(inputs.popup, "src/background/"),
      content: inputsUnder(inputs.content, "src/background/"),
    }).toEqual({ popup: [], content: [] });
  });

  it("keeps shared transient and toast policy reachable in both DOM realms", () => {
    for (const sharedModule of [
      "src/ui/toast-controller.ts",
      "src/ui/transient-surface-manager.ts",
    ]) {
      expect(inputs.popup.has(sharedModule), `${sharedModule} missing from popup`).toBe(true);
      expect(inputs.content.has(sharedModule), `${sharedModule} missing from content`).toBe(true);
    }
  });

  it("requires extracted concern modules to be wired into only their owning realm", () => {
    const sourceFiles = listP19SourceFiles().map(repositoryPath);
    const popupOwned = sourceFiles.filter(isPopupExtractionCandidate).sort();
    const contentOwned = sourceFiles.filter(isContentExtractionCandidate).sort();
    const violations = [
      ...popupOwned.flatMap((path) => [
        ...(!inputs.popup.has(path) ? [`${path}: missing from popup bundle`] : []),
        ...(inputs.content.has(path) ? [`${path}: leaked into content bundle`] : []),
      ]),
      ...contentOwned.flatMap((path) => [
        ...(!inputs.content.has(path) ? [`${path}: missing from content bundle`] : []),
        ...(inputs.popup.has(path) ? [`${path}: leaked into popup bundle`] : []),
      ]),
    ];

    expect(violations).toEqual([]);
  });
});
