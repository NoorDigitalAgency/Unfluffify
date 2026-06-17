import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createContentMainServiceRegistry } from "../content/content-main-service-registry.js";

const getterFactoryPairs = [
  ["getPageToastClient", "createPageToastClient"],
  ["getPageSaveReconciliationClearHandler", "createPageSaveReconciliationClearHandler"],
  ["getPageSaveReconciliationPendingHandler", "createPageSaveReconciliationPendingHandler"],
  ["getRenderModeInspectionClient", "createRenderModeInspectionClient"],
  ["getRenderModeInspectionHandlers", "createRenderModeInspectionHandlers"],
  ["getInspectionStatusResolver", "createInspectionStatusResolver"],
  ["getPageDraftRevertHandler", "createPageDraftRevertHandler"],
  ["getPageDraftSaveHandler", "createPageDraftSaveHandler"],
  ["getExplicitMarkingHandler", "createExplicitMarkingHandler"],
  ["getPageDraftStatusHandler", "createPageDraftStatusHandler"],
  ["getAiPreviewStateResponseBuilder", "createAiPreviewStateResponseBuilder"],
  ["getAiPreviewCloseHandler", "createAiPreviewCloseHandler"],
  ["getAiPreviewComputeLockHandler", "createAiPreviewComputeLockHandler"],
  ["getAiPreviewExpandedModeHandler", "createAiPreviewExpandedModeHandler"],
  ["getAiPreviewGetStateHandler", "createAiPreviewGetStateHandler"],
  ["getAiPreviewShowHandler", "createAiPreviewShowHandler"],
  ["getAiSubmissionXpathsHandler", "createAiSubmissionXpathsHandler"],
  ["getCapturePageSnapshotHandler", "createCapturePageSnapshotHandler"],
  ["getConfigUpdatedHandler", "createConfigUpdatedHandler"],
  ["getCollectPageDataHandler", "createCollectPageDataHandler"],
  ["getDefaultExclusionsHandler", "createDefaultExclusionsHandler"],
  ["getDescribeXpathsHandler", "createDescribeXpathsHandler"],
  ["getFocusHandler", "createFocusHandler"],
  ["getForceRefreshHandler", "createForceRefreshHandler"],
  ["getInvisibleXpathsHandler", "createInvisibleXpathsHandler"],
  ["getVisibleXpathsHandler", "createVisibleXpathsHandler"],
  ["getPropertyLockPortClient", "createPropertyLockPortClient"],
  ["getPropertyLockStateMachine", "createPropertyLockStateMachine"]
];

test("content-main service registry lazily creates and caches each getter independently", () => {
  const counters = new Map();
  const factories = {};
  for (const [, factoryName] of getterFactoryPairs) {
    counters.set(factoryName, 0);
    factories[factoryName] = () => {
      counters.set(factoryName, counters.get(factoryName) + 1);
      return { factoryName, createdAt: counters.get(factoryName) };
    };
  }

  const registry = createContentMainServiceRegistry(factories);
  for (const factoryName of counters.keys()) {
    assert.equal(counters.get(factoryName), 0, `${factoryName} should be lazy`);
  }

  const firstResults = new Map();
  for (const [getterName, factoryName] of getterFactoryPairs) {
    const first = registry[getterName]();
    firstResults.set(getterName, first);
    assert.equal(counters.get(factoryName), 1, `${getterName} should create exactly once on first call`);
  }

  for (const [getterName, factoryName] of getterFactoryPairs) {
    const second = registry[getterName]();
    assert.equal(second, firstResults.get(getterName), `${getterName} should return cached instance`);
    assert.equal(counters.get(factoryName), 1, `${getterName} should not recreate after caching`);
  }

  const uniqueInstances = new Set(firstResults.values());
  assert.equal(uniqueInstances.size, getterFactoryPairs.length, "different getters should not share instances");
});

test("content-main sources the registry and keeps mutable truth clusters inline", () => {
  const source = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");

  assert.match(source, /from "\.\/content\/content-main-service-registry\.js"/);
  assert.doesNotMatch(source, /let pageToastClient = null;/);
  assert.doesNotMatch(source, /let configUpdatedHandler = null;/);

  assert.match(source, /let aiPreviewState = createAiPreviewState\(\);/);
  assert.match(source, /let propertyLockConnectedSiteId = null;/);
  assert.match(source, /let silentHighlightEditorActivationPromise = null;/);
});
