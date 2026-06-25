import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C3 popup entrypoint", () => {
  it("boots the popup runtime from the native WXT import graph and preserves popup asset order", () => {
    const entrypointSource = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "popup", "main.ts"),
      "utf8",
    );
    const popupSource = readFileSync(resolve(REPO_ROOT, "src", "popup.ts"), "utf8");
    const popupHtml = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "popup", "index.html"),
      "utf8",
    );

    expect(entrypointSource).toContain('import "../../popup.js";');
    expect(entrypointSource).not.toContain("legacy/popup.js");
    expect(popupSource).toContain("__UNFLUFFIFY_POPUP_DEBUG__");
    expect(popupSource).toContain("getViewState: uiModule.getViewState");
    expect(popupSource).toContain("async function init()");
    expect(popupSource).toContain("init();");
    expect([...popupHtml.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "../../assets/fonts/fonts.css",
      "../../theme-color.css",
      "../../theme-components.css",
      "../../popup.css",
      "../../theme-utilities.css",
      "../../assets/materialdesignicons.min.css",
    ]);
    expect(popupHtml).toContain('<script type="module" src="./main.ts"></script>');
  });
});
