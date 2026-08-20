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

    // Formatting-agnostic: the contract is what the entrypoint binds to, not how
    // the import statement happens to wrap.
    const appImport = entrypointSource.match(/import\s*\{([\s\S]*?)\}\s*from\s*"\.\.\/\.\.\/popup\/App";/);
    expect(appImport).not.toBeNull();
    expect(appImport?.[1]).toMatch(/\bApp\b/);
    expect(appImport?.[1]).toMatch(/\bresolvePopupActionButtons\b/);
    expect(entrypointSource).toContain("createPopupRootRecovery({");
    expect(entrypointSource).toContain("rootRecovery.render(");
    expect(entrypointSource).not.toContain("../../popup.js");
    expect(popupHtml).toContain('<script type="module" src="./main.tsx"></script>');
  });

  it("gates the popup diagnostic toolkit behind the debug build literal", () => {
    const popupSource = readFileSync(resolve(REPO_ROOT, "src", "entrypoints", "popup", "main.tsx"), "utf8");

    expect(popupSource).toContain("__UNFLUFFIFY_POPUP_DEBUG__");
    expect(popupSource).toMatch(/if\s*\(DEBUG_BUILD\s*&&\s*typeof window/);
    expect(popupSource).toContain("getBusDiagnostics: getDebugBusDiagnostics");
    expect(popupSource).toContain("getSpinnerState: getDebugSpinnerState");
    expect(popupSource).toContain("activateDirectMode");
  });
});
