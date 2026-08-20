import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("TypeScript-authored page-world artifact", () => {
  it("keeps the generated JavaScript byte-identical to the TypeScript build", () => {
    const sourcePath = resolve(REPO_ROOT, "src/page-world/program.ts");
    const generatedPath = resolve(REPO_ROOT, "src/page-world/program.js");
    expect(existsSync(sourcePath)).toBe(true);
    expect(existsSync(generatedPath)).toBe(true);

    const result = spawnSync(
      process.execPath,
      [resolve(REPO_ROOT, "scripts/generate-page-world.mjs"), "--check"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it("makes stale generated source a check/build failure", () => {
    const packageJson = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["page-world:generate"]).toBeTruthy();
    expect(packageJson.scripts?.["page-world:check"]).toBeTruthy();
    expect(packageJson.scripts?.check).toContain("page-world:check");
    expect(packageJson.scripts?.build).toContain("page-world:check");
  });
});
