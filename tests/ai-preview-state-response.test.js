import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiPreviewStateResponseBuilder } from "../src/content/ai-preview-state-response.js";

function createState(overrides = {}) {
  return {
    active: true,
    mode: "compute_lock",
    previousEnabled: true,
    restoreMarkingOnExit: true,
    previousBaseUrl: "https://example.test",
    showAllCategories: true,
    itemsPending: true,
    focusedXpath: "/html/body/main",
    items: [
      {
        xpath: "/html/body/main",
        text: "Main",
        title: "Main section",
        kind: "implicit_included"
      }
    ],
    ...overrides
  };
}

test("ai preview response builder returns get-state payload with gated showAllCategories", () => {
  const builder = createAiPreviewStateResponseBuilder({
    FEATURE_DISABLED_REASON: "feature_disabled",
    getAiPreviewState: () => createState(),
    isPreviewExpandedStatesEnabled: () => false
  });

  const response = builder.buildGetStateResponse();
  assert.equal(response.ok, true);
  assert.equal(response.showAllCategories, false);
  assert.equal(response.itemsPending, true);
  assert.equal(response.items.length, 1);
  assert.deepEqual(response.items[0], {
    xpath: "/html/body/main",
    text: "Main",
    title: "Main section",
    kind: "implicit_included"
  });
});

test("ai preview response builder returns disabled expanded-mode payload", () => {
  const builder = createAiPreviewStateResponseBuilder({
    FEATURE_DISABLED_REASON: "feature_disabled",
    getAiPreviewState: () => createState({ showAllCategories: true }),
    isPreviewExpandedStatesEnabled: () => true
  });

  const response = builder.buildExpandedModeDisabledResponse();
  assert.equal(response.ok, false);
  assert.equal(response.reason, "feature_disabled");
  assert.equal(response.feature, "previewExpandedStates");
  assert.equal(response.showAllCategories, false);
});

test("ai preview response builder returns expanded-mode update payload", () => {
  const builder = createAiPreviewStateResponseBuilder({
    FEATURE_DISABLED_REASON: "feature_disabled",
    getAiPreviewState: () => createState({ showAllCategories: false, mode: "" }),
    isPreviewExpandedStatesEnabled: () => true
  });

  const response = builder.buildExpandedModeResponse(true);
  assert.equal(response.ok, true);
  assert.equal(response.mode, "");
  assert.equal(response.showAllCategories, false);
  assert.equal(response.previousEnabled, true);
});
