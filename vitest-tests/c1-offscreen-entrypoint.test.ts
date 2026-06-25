import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C1 offscreen entrypoint", () => {
  it("boots from the shared offscreen module instead of the legacy runtime shim", () => {
    const entrypointSource = readFileSync(
      resolve(REPO_ROOT, "entrypoints", "offscreen", "main.ts"),
      "utf8",
    );
    const rootSource = readFileSync(resolve(REPO_ROOT, "offscreen.ts"), "utf8");
    const bootstrapSource = readFileSync(resolve(REPO_ROOT, "offscreen", "bootstrap.ts"), "utf8");

    expect(entrypointSource).not.toContain('legacy/offscreen.js');
    expect(entrypointSource).toContain('../../offscreen/bootstrap.js');
    expect(rootSource).toContain('./offscreen/bootstrap.js');
    expect(bootstrapSource).toContain("export function startOffscreen");
    expect(bootstrapSource).toContain("chrome.runtime.onMessage.addListener");
  });
});
