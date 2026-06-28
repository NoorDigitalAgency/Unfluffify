import { describe, expect, it } from "vitest";

import {
  buildProjectedSecondaryGatesViewStatePatch,
  deriveProjectedSecondaryGatesSnapshotEffect,
} from "../src/popup/secondary-gates-state-dictation.js";

describe("popup secondary gates state dictation", () => {
  it("maps projected background gates into popup view-state fields", () => {
    const patch = buildProjectedSecondaryGatesViewStatePatch({
      currentTabId: 12,
      projectedTabId: 12,
      secondaryGates: {
        pageSaveBlockedReason: "",
        pageRevertBlockedReason: "",
        markingPreviewBlockedReason: "requires_ai_run",
        saveExcludesButtonDisabled: true,
        saveExcludesBlockedReason: "server_sync_pending",
        previewLatestButtonDisabled: true,
        previewLatestBlockedReason: "requires_ai_run",
        desktopPreviewVisible: true,
        desktopPreviewEnabled: false,
        desktopPreviewDisabled: true,
        desktopPreviewBlockedReason: "page_inspection",
        lynxChecklistSendBlockedReason: {
          code: "missing_page_types",
          pageTypeKeys: ["product"],
        },
        navigationInspectionActive: true,
      },
    });

    expect(patch).toEqual({
      pageSaveBlockedReason: "",
      pageRevertBlockedReason: "",
      markingPreviewBlockedReason: "requires_ai_run",
      saveExcludesButtonDisabled: true,
      saveExcludesBlockedReason: "server_sync_pending",
      previewLatestButtonDisabled: true,
      previewLatestBlockedReason: "requires_ai_run",
      desktopPreviewVisible: true,
      desktopPreviewEnabled: false,
      desktopPreviewDisabled: true,
      desktopPreviewBlockedReason: "page_inspection",
      lynxChecklistSendBlockedReason: "missing_page_types",
      lynxChecklistSendBlockedPageTypeKeys: ["product"],
      navigationInspectionActive: true,
    });
  });

  it("requests a local refresh when a previously projected snapshot disappears", () => {
    expect(deriveProjectedSecondaryGatesSnapshotEffect({
      currentTabId: 12,
      projectedTabId: 99,
      secondaryGates: null,
      hadProjectedSecondaryGates: true,
    })).toEqual({
      patch: null,
      refreshRequired: true,
    });
  });
});
