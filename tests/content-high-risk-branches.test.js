import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentMainSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const manifestResources = new Set(
  manifest.web_accessible_resources.flatMap((entry) => entry.resources || [])
);

const remainingHighRiskBranches = new Map([
  ["configUpdated", "config-updated-handler"],
  ["showAiPreview", "ai-preview-show-handler"],
  ["revertPageDraft", "page-draft-revert-handler"],
  ["savePageDraft", "page-draft-save-handler"],
  ["setExplicitExclude", "explicit-marking-handler"],
  ["setExplicitInclude", "explicit-marking-handler"]
]);

const plannedHandlerAccessors = new Map([
  ["configUpdated", /getConfigUpdatedHandler\(\)\.handleMessage\(message\)/],
  ["revertPageDraft", /getPageDraftRevertHandler\(\)\.revert\(\{ targetBaseUrl \}\)/],
  ["savePageDraft", /getPageDraftSaveHandler\(\)\.saveCurrentPageDraft\(\{/],
  ["setExplicitExclude", /getExplicitMarkingHandler\(\)\.setExplicitExclude\(\{/],
  ["setExplicitInclude", /getExplicitMarkingHandler\(\)\.setExplicitInclude\(\{/],
  ["showAiPreview", /getAiPreviewShowHandler\(\)\.handleMessage\(message\)/]
]);

const fullyDelegatedBranches = new Set(["configUpdated", "showAiPreview"]);

const completedTrackFHandlers = [
  "force-refresh-handler",
  "page-save-reconciliation-pending-handler",
  "page-save-reconciliation-clear-handler",
  "page-draft-status-handler",
  "capture-page-snapshot-handler"
];

const guardMatrix = {
  configUpdated: {
    activeBaseUrlScope: "enabled-same-base-only",
    requiresConfig: false,
    propertyLockBlock: false,
    reconciliationPendingBlock: false,
    catchFallback: true
  },
  showAiPreview: {
    activeBaseUrlScope: false,
    requiresConfig: false,
    propertyLockBlock: false,
    reconciliationPendingBlock: false,
    catchFallback: true
  },
  revertPageDraft: {
    activeBaseUrlScope: true,
    requiresConfig: true,
    propertyLockBlock: true,
    reconciliationPendingBlock: false,
    catchFallback: true
  },
  savePageDraft: {
    activeBaseUrlScope: true,
    requiresConfig: true,
    propertyLockBlock: true,
    reconciliationPendingBlock: false,
    catchFallback: true
  },
  setExplicitExclude: {
    activeBaseUrlScope: true,
    requiresConfig: true,
    propertyLockBlock: true,
    reconciliationPendingBlock: true,
    catchFallback: false
  },
  setExplicitInclude: {
    activeBaseUrlScope: true,
    requiresConfig: true,
    propertyLockBlock: true,
    reconciliationPendingBlock: true,
    catchFallback: false
  }
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertImportsContentModule(moduleName) {
  const importPattern = new RegExp(`from\\s+"\\./content/${escapeRegExp(moduleName)}\\.js"`);
  assert.match(contentMainSource, importPattern, `expected content-main.js to import ${moduleName}`);
}

function assertManifestExposesContentModule(moduleName) {
  assert.ok(
    manifestResources.has(`content/${moduleName}.js`),
    `expected manifest.json to expose content/${moduleName}.js`
  );
}

function getMessageBranch(messageType) {
  const needle = `if (message.type === "${messageType}") {`;
  const start = contentMainSource.indexOf(needle);
  if (start < 0) {
    return "";
  }
  const blockStart = contentMainSource.indexOf("{", start);
  let depth = 0;
  for (let index = blockStart; index < contentMainSource.length; index += 1) {
    const char = contentMainSource[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return contentMainSource.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unterminated branch for ${messageType}`);
}

function branchOrPlannedHandler(messageType) {
  const branch = getMessageBranch(messageType);
  if (branch) {
    const handlerDelegation = plannedHandlerAccessors.get(messageType);
    if (handlerDelegation && handlerDelegation.test(branch)) {
      const moduleName = remainingHighRiskBranches.get(messageType);
      assertImportsContentModule(moduleName);
      assertManifestExposesContentModule(moduleName);
      return fullyDelegatedBranches.has(messageType) ? "" : branch;
    }
    return branch;
  }
  const moduleName = remainingHighRiskBranches.get(messageType);
  assert.ok(moduleName, `missing planned module for ${messageType}`);
  assertImportsContentModule(moduleName);
  assertManifestExposesContentModule(moduleName);
  return "";
}

function assertBranchHasBaseUrlGuard(messageType, branch, policy) {
  if (policy.activeBaseUrlScope === "enabled-same-base-only") {
    assert.match(branch, /state\.enabled\s*&&\s*utils\.sameBaseUrl\(message\.baseUrl,\s*state\.baseUrl\)/);
    return;
  }
  if (!policy.activeBaseUrlScope) {
    assert.doesNotMatch(branch, /matchesActiveBaseUrl\(/);
    return;
  }
  assert.match(branch, /const targetBaseUrl = message\.baseUrl \|\| state\.baseUrl;/);
  assert.match(branch, /!targetBaseUrl \|\| !matchesActiveBaseUrl\(targetBaseUrl\)/);
}

function assertBranchHasConfigGuard(messageType, branch, required) {
  if (!required) {
    assert.doesNotMatch(branch, /!state\.config/);
    return;
  }
  assert.match(branch, /!state\.config/, `${messageType} should guard missing state.config`);
}

function assertBranchHasPropertyLockGuard(messageType, branch, required) {
  if (!required) {
    assert.doesNotMatch(branch, /checkPropertyLockBlocksMarking\(\)/);
    return;
  }
  assert.match(branch, /if \(!checkPropertyLockBlocksMarking\(\)\) \{\s*sendResponse\(\{ ok: false, locked: true \}\);/);
}

function assertBranchHasReconciliationGuard(messageType, branch, required) {
  if (!required) {
    assert.doesNotMatch(branch, /isPageSaveReconciliationPending\(/);
    return;
  }
  assert.match(
    branch,
    /core\.isPageSaveReconciliationPending\(location\.href\)[\s\S]*?sendResponse\(\{ ok: false, reconciliationPending: true \}\);/
  );
}

function assertBranchHasCatchFallback(messageType, branch, required) {
  if (!required) {
    assert.doesNotMatch(branch, /\.catch\(\(\) => \{[\s\S]*?sendResponse\(\{ ok: false \}\);/);
    return;
  }
  assert.match(
    branch,
    /\.catch\(\(\) => \{[\s\S]*?sendResponse\(\{/,
    `${messageType} should send an explicit response when async work fails`
  );
}

test("revertPageDraft load failures answer ok false", () => {
  const branch = getMessageBranch("revertPageDraft");
  const handlerSource = readFileSync(
    new URL("../content/page-draft-revert-handler.js", import.meta.url),
    "utf8"
  );

  assert.match(branch, /getPageDraftRevertHandler\(\)\.revert\(\{ targetBaseUrl \}\)/);
  assert.match(
    branch,
    /\.catch\(\(\) => \{\s*sendResponse\(\{ ok: false \}\);\s*\}\);/
  );
  assert.match(handlerSource, /const config = await deps\.loadConfig\(targetBaseUrl\);/);
});

test("high-risk branch inventory remains inline until planned handlers are exposed", () => {
  for (const messageType of remainingHighRiskBranches.keys()) {
    branchOrPlannedHandler(messageType);
  }
});

test("Track F handler modules stay imported and manifest-exposed", () => {
  for (const moduleName of completedTrackFHandlers) {
    assertImportsContentModule(moduleName);
    assertManifestExposesContentModule(moduleName);
  }
});

test("remaining high-risk branches match the documented G0 guard matrix", () => {
  for (const [messageType, policy] of Object.entries(guardMatrix)) {
    const branch = branchOrPlannedHandler(messageType);
    if (!branch) {
      continue;
    }
    assertBranchHasBaseUrlGuard(messageType, branch, policy);
    assertBranchHasConfigGuard(messageType, branch, policy.requiresConfig);
    assertBranchHasPropertyLockGuard(messageType, branch, policy.propertyLockBlock);
    assertBranchHasReconciliationGuard(messageType, branch, policy.reconciliationPendingBlock);
    assertBranchHasCatchFallback(messageType, branch, policy.catchFallback);
  }
});
