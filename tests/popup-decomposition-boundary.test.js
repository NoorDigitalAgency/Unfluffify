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

function assertPopupDoesNotDefine(functionName) {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionPattern = new RegExp(`(?:async\\s+)?function\\s+${escapedFunctionName}\\s*\\(`);
  assert.doesNotMatch(
    popupSource,
    functionPattern,
    `expected popup.js to not define ${functionName}`
  );
}

test("popup decomposition guard: baseline popup modules are imported", () => {
  assertImportsPopupModule("chrome-helpers");
  assertImportsPopupModule("emulation");
  assertImportsPopupModule("ui");
  assertImportsPopupModule("messages");
  assertImportsPopupModule("helpers");
  assertImportsPopupModule("spinner");
  assertImportsPopupModule("site-resolution");
  assertImportsPopupModule("remote-config");
  assertImportsPopupModule("ai-run");
  assertImportsPopupModule("render-mode");
  assertImportsPopupModule("state");
  assertImportsPopupModule("telemetry");

  assertPopupDoesNotDefine("currentSpinnerMessage");
  assertPopupDoesNotDefine("currentSpinnerSnapshot");
  assertPopupDoesNotDefine("normalizeSpinnerReason");
  assertPopupDoesNotDefine("clearSpinnerWatchdog");
  assertPopupDoesNotDefine("armSpinnerWatchdog");
  assertPopupDoesNotDefine("pushSpinner");
  assertPopupDoesNotDefine("setSpinnerMessage");
  assertPopupDoesNotDefine("popSpinner");
  assertPopupDoesNotDefine("runWithSpinner");
  assertPopupDoesNotDefine("fetchPropertyPageTypesFromGraphql");
  assertPopupDoesNotDefine("ensurePropertyPageTypes");
  assertPopupDoesNotDefine("resolveSiteIdFromGraphql");
  assertPopupDoesNotDefine("mergeConfigEntriesForResolvedBaseUrl");
  assertPopupDoesNotDefine("ensureBaseUrlSiteId");
  assertPopupDoesNotDefine("scheduleRemoteConfigRetry");
  assertPopupDoesNotDefine("loadRemoteConfigForCurrentPage");
  assertPopupDoesNotDefine("syncBaseConfigToServer");
});
