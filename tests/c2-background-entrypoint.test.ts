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
    const startBackground = vi.fn();
    const defineBackground = vi.fn((callback: () => void) => callback);

    vi.doMock("wxt/utils/define-background", () => ({
      defineBackground,
    }));
    vi.doMock("../src/background.js", () => ({ startBackground }));

    const entrypoint = await import("../src/entrypoints/background.ts");

    expect(defineBackground).toHaveBeenCalledTimes(1);
    expect(startBackground).not.toHaveBeenCalled();
    const callback = defineBackground.mock.calls[0]?.[0];
    expect(entrypoint.default).toBe(callback);
    expect(typeof callback).toBe("function");

    callback();

    expect(startBackground).toHaveBeenCalledTimes(1);
  });

  it("keeps background startup exported and callback-driven", () => {
    const backgroundSource = readFileSync(resolve(REPO_ROOT, "src", "background.ts"), "utf8");

    expect(backgroundSource).toContain("export function startBackground(): void {");
    expect(backgroundSource).not.toContain("\nstartBackground();");
  });
});
