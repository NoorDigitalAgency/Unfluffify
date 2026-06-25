import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const contentMainSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

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
  assertImportsContentModule("content-main-service-registry");
  assertImportsContentModule("ai-preview-close-handler");
  assertImportsContentModule("ai-preview-compute-lock-handler");
  assertImportsContentModule("ai-preview-expanded-mode-handler");
  assertImportsContentModule("ai-preview-get-state-handler");
  assertImportsContentModule("ai-preview-show-handler");
  assertImportsContentModule("ai-preview-state-response");
  assertImportsContentModule("ai-submission-xpaths-handler");
  assertImportsContentModule("capture-page-snapshot-handler");
  assertImportsContentModule("collect-page-data-handler");
  assertImportsContentModule("config-updated-handler");
  assertImportsContentModule("default-exclusions-handler");
  assertImportsContentModule("describe-xpaths-handler");
  assertImportsContentModule("explicit-marking-handler");
  assertImportsContentModule("focus-handler");
  assertImportsContentModule("force-refresh-handler");
  assertImportsContentModule("invisible-xpaths-handler");
  assertImportsContentModule("inspection-status");
  assertImportsContentModule("page-draft-revert-handler");
  assertImportsContentModule("page-draft-save-handler");
  assertImportsContentModule("page-draft-status-handler");
  assertImportsContentModule("page-save-reconciliation-clear-handler");
  assertImportsContentModule("page-world-relay");
  assertImportsContentModule("page-save-reconciliation-pending-handler");
  assertImportsContentModule("page-toast");
  assertImportsContentModule("render-mode-inspection-handlers");
  assertImportsContentModule("render-mode-inspection-client");
  assertImportsContentModule("property-lock-banner-mode");
  assertImportsContentModule("property-lock-banner");
  assertImportsContentModule("property-lock-port-client");
  assertImportsContentModule("property-lock-state-machine");
  assertImportsContentModule("runtime-message-handler");
  assertImportsContentModule("visible-xpaths-handler");

  assertContentDoesNotDefine("ensurePageToastStyle");
  assertContentDoesNotDefine("createPropertyLockBannerButton");
  assertContentDoesNotDefine("createPropertyLockBannerLabel");
  assertContentDoesNotDefine("consumeRuntimeLastErrorMessage");
});
