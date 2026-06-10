import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

function assertImportsPopupModule(moduleName) {
  const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(`from\\s+"\\./popup/${escapedModuleName}\\.js"`);
  assert.match(
    popupSource,
    importPattern,
    `expected popup.js to import ./popup/${moduleName}.js`
  );
}

test("popup decomposition guard: baseline popup modules are imported", () => {
  assertImportsPopupModule("chrome-helpers");
  assertImportsPopupModule("emulation");
  assertImportsPopupModule("ui");
  assertImportsPopupModule("messages");
  assertImportsPopupModule("helpers");
  assertImportsPopupModule("ai-run");
  assertImportsPopupModule("render-mode");
  assertImportsPopupModule("state");
  assertImportsPopupModule("telemetry");
});
