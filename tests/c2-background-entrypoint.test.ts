import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C2 background entrypoint", () => {
  it("boots the shared background startup path instead of an empty WXT wrapper", () => {
    const entrypointSource = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "background.ts"),
      "utf8",
    );
    const backgroundSource = readFileSync(resolve(REPO_ROOT, "src", "background.ts"), "utf8");

    expect(entrypointSource).toContain('import { startBackground } from "../background.js";');
    expect(entrypointSource).toContain("startBackground();");
    expect(entrypointSource).not.toContain("defineBackground(() => {});");
    expect(backgroundSource).toContain("export function startBackground(): void {");
    expect(backgroundSource).toContain("if (backgroundStarted) {");
    expect(backgroundSource).toContain("startBackground();");
  });
});
