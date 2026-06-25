import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

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
  assertImportsPopupModule("render-mode-inspection");
  assertImportsPopupModule("page-reconciliation");
  assertImportsPopupModule("property-lock-ui");
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
  assertPopupDoesNotDefine("maybeAutoDetectRenderMode");
  assertPopupDoesNotDefine("detectRenderModeViaEndpoint");
  assertPopupDoesNotDefine("waitForTabLoadStart");
  assertPopupDoesNotDefine("waitForTabLoadComplete");
  assertPopupDoesNotDefine("completeRenderModeInspectionReloadFollowUp");
  assertPopupDoesNotDefine("hasCurrentPagePendingChanges");
  assertPopupDoesNotDefine("handlePageSave");
  assertPopupDoesNotDefine("handlePageRevert");
  assertPopupDoesNotDefine("isPropertyLockCollaborationEnabled");
  assertPopupDoesNotDefine("resetDisabledPropertyLockState");
  assertPopupDoesNotDefine("resetPropertyLockState");
  assertPopupDoesNotDefine("clearPropertyLockTransientState");
  assertPopupDoesNotDefine("clearPropertyLockOffCandidateRefreshTimer");
  assertPopupDoesNotDefine("syncPropertyLockOffCandidateRefreshTimer");
  assertPopupDoesNotDefine("persistPropertyLockRecoveryMetadata");
  assertPopupDoesNotDefine("applyPropertyLockState");
  assertPopupDoesNotDefine("queueEditorBootstrapOnLockTransition");
  assertPopupDoesNotDefine("applyPropertyLockConnectionStatus");
  assertPopupDoesNotDefine("applyPropertyLockServerMessage");
  assertPopupDoesNotDefine("isPropertyLockBlockingEditing");
  assertPopupDoesNotDefine("buildPropertyLockViewState");
  assertPopupDoesNotDefine("fetchPropertyLockState");
  assertPopupDoesNotDefine("refreshPropertyLockSnapshot");
  assertPopupDoesNotDefine("sendPropertyLockCommand");
  assertPopupDoesNotDefine("reconcilePropertyLockAfterCommand");
});
