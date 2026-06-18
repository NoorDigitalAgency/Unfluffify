import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createInspectionStatusResolver } from "../content/inspection-status.js";

test("inspection-status resolver returns pending inspection state and marking mode", () => {
  const resolver = createInspectionStatusResolver({
    getCurrentContentMode: () => "marking",
    getPageSaveReconciliationState: () => ({ reason: "editor_preparing" }),
    getPageUrl: () => "https://example.test/page",
    getPropertyLockEditorClaimPending: () => true,
    getSilentHighlightEditorActivationPromise: () => Promise.resolve(),
    isMarkingEnabled: () => true,
    isPageInspectionUiActive: () => false,
    isPageSaveReconciliationPending: () => false,
    isRenderModeInspectionActive: () => true,
    SILENT_HIGHLIGHTING_PREPARATION_REASON: "editor_preparing"
  });

  const status = resolver.resolve();
  assert.equal(status.ok, true);
  assert.equal(status.active, false);
  assert.equal(status.pending, true);
  assert.equal(status.renderModeInspectionActive, true);
  assert.equal(status.markingEnabled, true);
  assert.equal(status.mode, "marking");
  assert.equal(status.lockClaimPending, true);
  assert.equal(status.pendingReason, "editor_preparing");
});

test("inspection-status resolver clears pendingReason when nothing is pending", () => {
  const resolver = createInspectionStatusResolver({
    getCurrentContentMode: () => "silent",
    getPageSaveReconciliationState: () => ({ reason: "pending" }),
    getPageUrl: () => "https://example.test/page",
    getPropertyLockEditorClaimPending: () => false,
    getSilentHighlightEditorActivationPromise: () => null,
    isMarkingEnabled: () => false,
    isPageInspectionUiActive: () => false,
    isPageSaveReconciliationPending: () => false,
    isRenderModeInspectionActive: () => false,
    SILENT_HIGHLIGHTING_PREPARATION_REASON: "editor_preparing"
  });

  const status = resolver.resolve();
  assert.equal(status.pending, false);
  assert.equal(status.pendingReason, "");
  assert.equal(status.mode, "silent");
  assert.equal(status.markingEnabled, false);
});
