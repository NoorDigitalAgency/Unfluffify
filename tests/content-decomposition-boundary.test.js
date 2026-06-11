import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentMainSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

function assertImportsContentModule(moduleName) {
  const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(`from\\s+"\\./content/${escapedModuleName}\\.js"`);
  assert.match(
    contentMainSource,
    importPattern,
    `expected content-main.js to import ./content/${moduleName}.js`
  );
}

function assertContentDoesNotDefine(functionName) {
  const escapedFunctionName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionPattern = new RegExp(`(?:async\\s+)?function\\s+${escapedFunctionName}\\s*\\(`);
  assert.doesNotMatch(
    contentMainSource,
    functionPattern,
    `expected content-main.js to not define ${functionName}`
  );
}

test("content decomposition guard: baseline content modules are imported", () => {
  assertImportsContentModule("core");
  assertImportsContentModule("shared-inclusion");
  assertImportsContentModule("silent-highlight-rules");
  assertImportsContentModule("shared-selector-cache");
  assertImportsContentModule("submission-rules");
  assertImportsContentModule("content-command-router");
  assertImportsContentModule("page-world-relay");
  assertImportsContentModule("page-telemetry-bridge");
  assertImportsContentModule("property-lock-banner");
  assertImportsContentModule("remote-support-client");
  assertImportsContentModule("remote-support-viewer-client");
  assertImportsContentModule("remote-support-support-page");

  assertContentDoesNotDefine("handlePageTelemetryWindowMessage");
  assertContentDoesNotDefine("syncPageTelemetryControl");
  assertContentDoesNotDefine("ensurePageTelemetryBridge");
  assertContentDoesNotDefine("restoreRemoteSupportQuietedVideo");
  assertContentDoesNotDefine("quietRemoteSupportVideo");
  assertContentDoesNotDefine("startRemoteSupportMediaQuieting");
  assertContentDoesNotDefine("stopRemoteSupportMediaQuieting");
  assertContentDoesNotDefine("createPropertyLockBannerButton");
  assertContentDoesNotDefine("createPropertyLockBannerLabel");
  assertContentDoesNotDefine("getRemoteSupportSupportPageViewerOrigin");
  assertContentDoesNotDefine("resolveRemoteSupportSupportPageViewerWaiters");
  assertContentDoesNotDefine("clearRemoteSupportSupportPageViewerPendingRequests");
  assertContentDoesNotDefine("handleRemoteSupportSupportPageViewerPortMessage");
  assertContentDoesNotDefine("waitForRemoteSupportSupportPageViewerReady");
  assertContentDoesNotDefine("createRemoteSupportSupportPageState");
  assertContentDoesNotDefine("ensureRemoteSupportSupportPageUi");
  assertContentDoesNotDefine("initializeRemoteSupportSupportPage");
});