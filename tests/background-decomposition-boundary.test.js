import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");

function assertImportsBackgroundModule(moduleName) {
  const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(`from\\s+"\\./background/${escapedModuleName}\\.js"`);
  assert.match(
    backgroundSource,
    importPattern,
    `expected background.js to import ./background/${moduleName}.js`
  );
}

function assertBackgroundDoesNotDefine(functionName) {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionPattern = new RegExp(`(?:async\\s+)?function\\s+${escapedFunctionName}\\s*\\(`);
  assert.doesNotMatch(
    backgroundSource,
    functionPattern,
    `expected background.js to not define ${functionName}`
  );
}

function assertBackgroundDoesNotDeclareConst(constName) {
  const escapedConstName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const constPattern = new RegExp(`const\\s+${escapedConstName}\\s*=\\s*new\\s+Map\\s*\\(`);
  assert.doesNotMatch(
    backgroundSource,
    constPattern,
    `expected background.js to not declare map ${constName}`
  );
}

test("background decomposition guard: baseline background modules are imported", () => {
  assertImportsBackgroundModule("command-router");
  assertImportsBackgroundModule("command-ledger");
  assertImportsBackgroundModule("live-page-client");
  assertImportsBackgroundModule("network-core");
  assertImportsBackgroundModule("remote-network");
  assertImportsBackgroundModule("remote-config-sync");
  assertImportsBackgroundModule("world-trace");
  assertImportsBackgroundModule("popup-state-broker");
  assertImportsBackgroundModule("render-mode-inspector");
  assertImportsBackgroundModule("ai-run-orchestrator");
  assertImportsBackgroundModule("async-tasks");
  assertImportsBackgroundModule("background-tab-state");
  assertImportsBackgroundModule("managed-timeouts");
  assertImportsBackgroundModule("tab-runtime");
  assertImportsBackgroundModule("tab-session-store");
  assertImportsBackgroundModule("spinner-operations");
  assertImportsBackgroundModule("transfer-payload-store");
  assertImportsBackgroundModule("ai-run-record-store");

  assertBackgroundDoesNotDefine("looksLikeJwtToken");
  assertBackgroundDoesNotDefine("summarizeLargeString");
  assertBackgroundDoesNotDefine("redactCommandPayloadValueForLedger");
  assertBackgroundDoesNotDefine("redactCommandPayloadForLedger");
  assertBackgroundDoesNotDefine("resolveLivePageSiteId");
  assertBackgroundDoesNotDefine("normalizeBaseUrlFromDomainName");
  assertBackgroundDoesNotDefine("buildPropertyPageTypesSignature");
  assertBackgroundDoesNotDefine("fetchLivePagePropertyPageTypes");
  assertBackgroundDoesNotDefine("resolveBackgroundEndpoint");
  assertBackgroundDoesNotDefine("createBackgroundJsonHeaders");
  assertBackgroundDoesNotDefine("resolveBackgroundNetworkCredentials");
  assertBackgroundDoesNotDefine("buildValidateEndpointFromStageBase");
  assertBackgroundDoesNotDefine("buildLoginEndpointFromStageBase");
  assertBackgroundDoesNotDefine("validateAuthToken");
  assertBackgroundDoesNotDefine("requestAuthLogin");
  assertBackgroundDoesNotDefine("requestAiRunStatus");
  assertBackgroundDoesNotDefine("removeRemotePageMarking");
  assertBackgroundDoesNotDefine("submitSelectorSetGraphqlUpdate");
  assertBackgroundDoesNotDefine("loadRemoteConfigSnapshot");
  assertBackgroundDoesNotDefine("saveRemoteConfigSnapshot");
  assertBackgroundDoesNotDefine("requestRenderModeDetection");
  assertBackgroundDoesNotDefine("submitPageTypeAssignments");
  assertBackgroundDoesNotDefine("requestAiRunStartSnapshot");
  assertBackgroundDoesNotDefine("requestAiRunResultSnapshot");
  assertBackgroundDoesNotDefine("fetchStaticPageHtmlForBackground");
  assertBackgroundDoesNotDefine("collectStoredPageMarkingItems");
  assertBackgroundDoesNotDefine("mergeSelectorsIntoConfig");
  assertBackgroundDoesNotDefine("getRemoteManagedConfigSignature");
  assertBackgroundDoesNotDefine("getNormalizedPageEntrySignature");
  assertBackgroundDoesNotDefine("replaceServerConfigIntoLocalSnapshot");
  assertBackgroundDoesNotDefine("mergeServerConfigIntoLocalSnapshot");
  assertBackgroundDoesNotDefine("preparePageTypeAssignmentsSnapshot");
  assertBackgroundDoesNotDefine("ensureTraceState");
  assertBackgroundDoesNotDefine("isWorldTraceEnabled");
  assertBackgroundDoesNotDefine("appendWorldTraceEvent");
  assertBackgroundDoesNotDefine("getSpinnerQueueForTab");
  assertBackgroundDoesNotDefine("serializeSpinnerQueue");
  assertBackgroundDoesNotDefine("buildBrokerState");
  assertBackgroundDoesNotDefine("broadcastBrokerState");
  assertBackgroundDoesNotDefine("updateLifecycleState");
  assertBackgroundDoesNotDefine("clearNavInspectCurtain");
  assertBackgroundDoesNotDefine("normalizeRenderModeOperationId");
  assertBackgroundDoesNotDefine("waitForTabLoadStartInBackground");
  assertBackgroundDoesNotDefine("waitForTabLoadCompleteInBackground");
  assertBackgroundDoesNotDefine("ensureContentReadyForRenderModeInspectionInBackground");
  assertBackgroundDoesNotDefine("sendRenderModeInspectionEndWithRetry");
  assertBackgroundDoesNotDefine("runRenderModeInspectionBeginStep");
  assertBackgroundDoesNotDefine("runRenderModeRevealFreezeStep");
  assertBackgroundDoesNotDefine("runRenderModeCaptureHtmlStep");
  assertBackgroundDoesNotDefine("getAiRunCurrentPageEntry");
  assertBackgroundDoesNotDefine("isAiRunCurrentPageSnapshotMissing");
  assertBackgroundDoesNotDefine("refineAiRunPayloadXpathsInBackground");
  assertBackgroundDoesNotDefine("loadAiRunSelectorSetFromPayloadKey");
  assertBackgroundDoesNotDefine("runAiCommandForTab");
  assertBackgroundDoesNotDefine("setAiComputeLockForTab");
  assertBackgroundDoesNotDefine("isAiComputeLockActiveForTab");
  assertBackgroundDoesNotDefine("refreshAiRunHeartbeat");
  assertBackgroundDoesNotDefine("prepareAiRunPayloadSnapshot");
  assertBackgroundDoesNotDefine("runBackgroundTask");
  assertBackgroundDoesNotDefine("disposeTabState");
  assertBackgroundDoesNotDeclareConst("tabLifecycleStateByTabId");
  assertBackgroundDoesNotDeclareConst("tabSpinnerQueueByTabId");
  assertBackgroundDoesNotDeclareConst("popupStatePortsByTabId");
  assertBackgroundDoesNotDeclareConst("tabWorldTraceStateByTabId");
  assertBackgroundDoesNotDeclareConst("aiComputeLockExpiresAtByTabId");
  assertBackgroundDoesNotDeclareConst("pageMotionFreezeControlQueueByTarget");
});
