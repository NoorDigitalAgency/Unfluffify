import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C2 background entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("boots the shared background startup path", async () => {
    const startRewriteBackground = vi.fn();
    const defineBackground = vi.fn((callback: () => void) => callback);

    vi.doMock("wxt/utils/define-background", () => ({
      defineBackground,
    }));
    vi.doMock("../src/background/index.ts", () => ({ startRewriteBackground }));

    const entrypoint = await import("../src/entrypoints/background.ts");

    expect(defineBackground).toHaveBeenCalledTimes(1);
    expect(startRewriteBackground).not.toHaveBeenCalled();
    const callback = defineBackground.mock.calls[0]?.[0];
    expect(entrypoint.default).toBe(callback);
    expect(typeof callback).toBe("function");

    callback();

    expect(startRewriteBackground).toHaveBeenCalledTimes(1);
  });

  it("keeps rewrite background startup exported and callback-driven", () => {
    const entrypointSource = readFileSync(resolve(REPO_ROOT, "src", "entrypoints", "background.ts"), "utf8");
    const backgroundSource = readFileSync(resolve(REPO_ROOT, "src", "background", "index.ts"), "utf8");

    expect(entrypointSource).toContain('import { startRewriteBackground } from "../background/index";');
    expect(backgroundSource).toContain("export function startRewriteBackground(): void {");
    expect(backgroundSource).not.toContain("\nstartRewriteBackground();");
  });
});
