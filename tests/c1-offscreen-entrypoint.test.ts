import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C1 offscreen entrypoint", () => {
  it("boots from the shared offscreen module instead of the legacy runtime shim", () => {
    const entrypointSource = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "offscreen", "main.ts"),
      "utf8",
    );
    const bootstrapSource = readFileSync(resolve(REPO_ROOT, "src", "offscreen", "bootstrap.ts"), "utf8");

    expect(entrypointSource).not.toContain('legacy/offscreen.js');
    expect(entrypointSource).toContain('../../offscreen/bootstrap.js');
    expect(entrypointSource).toContain("startOffscreen();");
    expect(existsSync(resolve(REPO_ROOT, "src", "offscreen.ts"))).toBe(false);
    expect(bootstrapSource).toContain("export function startOffscreen");
    expect(bootstrapSource).toContain("browser.runtime.onMessage.addListener");
  });
});
