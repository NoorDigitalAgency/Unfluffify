import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..");

describe("C3 popup contract", () => {
  it("keeps the popup entrypoint bound to the rewrite React runtime", () => {
    const entrypointSource = readFileSync(resolve(REPO_ROOT, "src", "entrypoints", "popup", "main.tsx"), "utf8");
    const popupHtml = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "popup", "index.html"),
      "utf8",
    );

    expect(entrypointSource).toContain('import { App, resolvePopupActionButtons } from "../../popup/App";');
    expect(entrypointSource).toContain("createRoot(rootElement)");
    expect(entrypointSource).not.toContain("../../popup.js");
    expect(popupHtml).toContain('<script type="module" src="./main.tsx"></script>');
  });

  it("keeps the live popup debug view-state hook", () => {
    const popupSource = readFileSync(resolve(REPO_ROOT, "src", "entrypoints", "popup", "main.tsx"), "utf8");

    expect(popupSource).toContain("__UNFLUFFIFY_POPUP_DEBUG__");
    expect(popupSource).toMatch(/__UNFLUFFIFY_POPUP_DEBUG__\s*=\s*\{\s*getViewState:\s*getDebugViewState\s*\}/);
  });
});
