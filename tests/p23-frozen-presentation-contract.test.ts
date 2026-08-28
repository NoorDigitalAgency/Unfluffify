import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";
import {
  ACCEPTANCE_ID,
  ARTIFACT_SCHEMA_VERSION,
  HOVER_BUDGET_MS,
  PLAYWRIGHT_CLI_VERSION,
  REQUIRED_CHECK_IDS,
  SILENT_BUDGET_MS,
  VIEWPORT,
  validateCheckCatalog,
} from "../scripts/performance/p23/contract.mjs";

describe("P23 frozen-surface browser gate contract", () => {
  it("exposes the pinned production-shaped gate through the package scripts", () => {
    expect(packageJson.scripts["performance:p23"]).toBe(
      "node ./scripts/performance/p23-frozen-presentation-browser-gate.mjs",
    );
    expect(packageJson.scripts["performance:p23:smoke"]).toBe(
      "node ./scripts/performance/p23-frozen-presentation-browser-gate.mjs --smoke",
    );
    expect(ACCEPTANCE_ID).toBe("ACCEPT-P23-FROZEN-PRESENTATION");
    expect(ARTIFACT_SCHEMA_VERSION).toBe("p23-frozen-presentation-browser-gate/v1");
    expect(PLAYWRIGHT_CLI_VERSION).toBe("0.1.17");
    expect(VIEWPORT).toEqual({ width: 1000, height: 900 });
    expect(HOVER_BUDGET_MS).toBe(40);
    expect(SILENT_BUDGET_MS).toBe(50);
  });

  it("pins and strictly validates the complete browser check catalog", () => {
    expect(REQUIRED_CHECK_IDS).toHaveLength(25);
    expect(new Set(REQUIRED_CHECK_IDS).size).toBe(REQUIRED_CHECK_IDS.length);
    expect(REQUIRED_CHECK_IDS).toContain("silent-scroll-fades-before-reposition-and-restores");
    const passing = REQUIRED_CHECK_IDS.map((id) => ({ id, pass: true }));
    expect(validateCheckCatalog(passing)).toEqual({
      pass: true,
      missing: [],
      duplicates: [],
      unexpected: [],
    });
    expect(validateCheckCatalog(passing.slice(1)).pass).toBe(false);
    expect(validateCheckCatalog([...passing, passing[0]!]).pass).toBe(false);
    expect(validateCheckCatalog([...passing, { id: "unexpected", pass: true }])).toMatchObject({
      pass: false,
      unexpected: ["unexpected"],
    });
    expect(validateCheckCatalog(passing.map((entry, index) => ({
      ...entry,
      pass: index !== 2,
    }))).pass).toBe(false);
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
    expect(gate).toContain('"starved-raf-exercised"');
    expect(gate).toContain('"canonical-rows-unchanged"');
    expect(gate).toContain('"silent-scroll-fades-before-reposition-and-restores"');
    expect(controller).toContain("page.mouse.move");
    expect(controller).toContain("page.mouse.wheel");
    expect(controller).toContain("state.allRetainedLayersTransparent");
    expect(controller).toContain("state.allRetainedLayersVisible");
    expect(controller).toContain("{ polling: 5, timeout: 500 }");
    expect(runtime).toContain("presentationClockFor(window)");
    expect(runtime).toContain("createMarkingEngine(document.documentElement");
    expect(runtime).toContain("current === initialSilentBox");
  });
});
