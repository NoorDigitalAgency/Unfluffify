import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

describe("P23 frozen-surface browser gate contract", () => {
  it("exposes the pinned production-shaped gate through the package scripts", () => {
    expect(packageJson.scripts["performance:p23"]).toBe(
      "node ./scripts/performance/p23-frozen-presentation-browser-gate.mjs",
    );
  });

  it("requires physical hover and scroll under a permanently starved page rAF", () => {
    const gate = readFileSync(
      "scripts/performance/p23-frozen-presentation-browser-gate.mjs",
      "utf8",
    );
    const controller = readFileSync(
      "scripts/performance/p23/playwright-controller.js",
      "utf8",
    );
    const runtime = readFileSync("scripts/performance/p23/runtime.ts", "utf8");

    expect(gate).toContain("window.requestAnimationFrame=function()");
    expect(gate).toContain("const HOVER_BUDGET_MS = 40");
    expect(gate).toContain("const SILENT_BUDGET_MS = 50");
    expect(gate).toContain('"starved-raf-exercised"');
    expect(gate).toContain('"canonical-rows-unchanged"');
    expect(controller).toContain("page.mouse.move");
    expect(controller).toContain("page.mouse.wheel");
    expect(controller).toContain("{ polling: 5, timeout: 500 }");
    expect(runtime).toContain("presentationClockFor(window)");
    expect(runtime).toContain("createMarkingEngine(document.documentElement");
    expect(runtime).toContain("current === initialSilentBox");
  });
});
