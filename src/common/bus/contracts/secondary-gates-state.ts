export const SECONDARY_GATES_BLOCK_REASONS = Object.freeze({
  NONE: "",
  BUSY: "busy",
  SERVER_SYNC_PENDING: "server_sync_pending",
  NO_SESSION_CHANGES: "no_session_changes",
  NO_PAGE_CHANGES: "no_page_changes",
  REQUIRES_AI_RUN: "requires_ai_run",
  NO_STORED_SELECTORS: "no_stored_selectors",
  NOT_READY: "not_ready",
  NOT_AVAILABLE: "not_available",
  PREVIEW_BLOCKED: "preview_blocked",
  PAGE_INSPECTION: "page_inspection",
  DEVICE_CONTROLS_LOCKED: "device_controls_locked",
} as const);

export type SecondaryGatesBlockReason =
  (typeof SECONDARY_GATES_BLOCK_REASONS)[keyof typeof SECONDARY_GATES_BLOCK_REASONS];

export type SecondaryGatesChecklistBlockingState = Readonly<{
  code: string;
  pageTypeKeys: string[];
}>;

export type SecondaryGatesViewState = Readonly<{
  pageSaveBlockedReason: SecondaryGatesBlockReason;
  pageRevertBlockedReason: SecondaryGatesBlockReason;
  markingPreviewBlockedReason: SecondaryGatesBlockReason;
  saveExcludesButtonDisabled: boolean;
  saveExcludesBlockedReason: SecondaryGatesBlockReason;
  previewLatestButtonDisabled: boolean;
  previewLatestBlockedReason: SecondaryGatesBlockReason;
  desktopPreviewVisible: boolean;
  desktopPreviewEnabled: boolean;
  desktopPreviewDisabled: boolean;
  desktopPreviewBlockedReason: SecondaryGatesBlockReason;
  lynxChecklistSendBlockedReason: SecondaryGatesChecklistBlockingState;
  navigationInspectionActive: boolean;
}>;
