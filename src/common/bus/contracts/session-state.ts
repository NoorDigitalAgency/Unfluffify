import type { SecondaryGatesChecklistBlockingState } from "./secondary-gates-state";

export const SESSION_PHASES = Object.freeze({
  LOADING: "loading",
  OUT_OF_SCOPE: "out_of_scope",
  RENDER_MODE_INSPECTION: "render_mode_inspection",
  SILENT: "silent",
  MARKING_FRESH: "marking_fresh",
  MARKING_DIRTY: "marking_dirty",
  COMPUTING_AI: "computing_ai",
  PREVIEW_OPEN: "preview_open",
  PREVIEW_RESTORING: "preview_restoring",
  READY_TO_SAVE: "ready_to_save",
  SAVING: "saving",
  SAVED: "saved",
  DISCARDING: "discarding",
  RECONCILIATION_PENDING: "reconciliation_pending",
  PROPERTY_LOCK_BLOCKED: "property_lock_blocked",
} as const);

export type SessionPhase = (typeof SESSION_PHASES)[keyof typeof SESSION_PHASES];

export const AI_RUN_PHASES = Object.freeze({
  PRE_AI: "pre_ai",
  AI_PREVIEW: "ai_preview",
  POST_AI: "post_ai",
} as const);

export type SessionAiRunPhase = (typeof AI_RUN_PHASES)[keyof typeof AI_RUN_PHASES];

export const BUTTON_IDS = Object.freeze({
  TOGGLE_ENABLED: "toggle-enabled",
  COMPUTE: "compute",
  MARKING_PREVIEW: "marking-preview",
  PAGE_SAVE: "page-save",
  PAGE_REVERT: "page-revert",
} as const);

export type ButtonId = (typeof BUTTON_IDS)[keyof typeof BUTTON_IDS];

export type ButtonDictation = Readonly<{
  id: ButtonId;
  visible: boolean;
  enabled: boolean;
  loading: boolean;
}>;

export type ButtonDictationMap = Readonly<Record<ButtonId, ButtonDictation>>;

export const CURTAIN_OPERATIONS = Object.freeze({
  IDLE: "idle",
  BUSY: "busy",
  COMPUTING_AI: "computing_ai",
  SAVING: "saving",
  DISCARDING: "discarding",
} as const);

export type CurtainOperation = (typeof CURTAIN_OPERATIONS)[keyof typeof CURTAIN_OPERATIONS];

export type CurtainDictation = Readonly<{
  visible: boolean;
  operation: CurtainOperation;
  message: string;
  note: string;
  timerText: string;
}>;

export type SessionFacts = Readonly<{
  baseUrlReady: boolean;
  pageScopedUiDisabled: boolean;
  navigationInspectionPending: boolean;
  siteIdReady: boolean;
  renderModeReady: boolean;
  pageTypeUiBlocked: boolean;
  currentPageHasPendingChanges: boolean;
  pageInspectionBusy: boolean;
  desktopPreviewVisible: boolean;
  desktopPreviewActive: boolean;
  deviceControlsDisabled: boolean;
  isEnabled: boolean;
  silentModeActive: boolean;
  aiReady: boolean;
  aiBusy: boolean;
  aiComputing: boolean;
  aiRunPhase: SessionAiRunPhase;
  aiRunUpToDate: boolean;
  previewActive: boolean;
  previewBlocked: boolean;
  previewRestorePending: boolean;
  sessionHasPendingChanges: boolean;
  sessionRequiresAiRun: boolean;
  currentDraftDirty: boolean;
  pageSaveReconciliationPending: boolean;
  propertyLockBlocked: boolean;
  saving: boolean;
  discarding: boolean;
  hasStoredSelectors: boolean;
  lynxChecklistCanSend: boolean;
  lynxChecklistBlockingReason: SecondaryGatesChecklistBlockingState;
  busyVisible: boolean;
  busyMessage: string;
  busyNote: string;
  busyTimerText: string;
}>;

export type SessionFactsPatch = Readonly<Partial<SessionFacts>>;

export type SessionDictation = Readonly<{
  phase: SessionPhase;
  mainUiHidden: boolean;
  pageControlsVisible: boolean;
  silentModeActive: boolean;
  buttons: ButtonDictationMap;
  curtain: CurtainDictation;
}>;

export const SESSION_REPORT_TYPES = Object.freeze({
  FACTS_REPORTED: "session.factsReported",
} as const);

export const SESSION_REQUEST_TYPES = Object.freeze({
  STATE_GET: "session.state.get",
} as const);

export const SESSION_EVENT_TYPES = Object.freeze({
  DICTATION_UPDATED: "session.dictationUpdated",
} as const);

export type SessionFactsReportedPayload = Readonly<{
  source: "popup" | "content";
  facts: SessionFactsPatch;
}>;

export type SessionStateGetPayload = Readonly<Record<never, never>>;

export type SessionStateReply = Readonly<{
  source: "popup" | "content";
  facts: SessionFactsPatch;
}>;

export type SessionDictationUpdatedPayload = SessionDictation;
