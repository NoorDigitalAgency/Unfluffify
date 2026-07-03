import { DEVICE_SCALE_DEFAULTS } from "../common/constants";
import { createInitialLynxChecklistState } from "../common/lynx-checklist";
import { AI_RUN_PHASES } from "../common/bus/contracts/session-state";
import type { PopupState } from "../types/popup-state.ts";

const initialLynxChecklistState = createInitialLynxChecklistState();

export const state: PopupState = {
  currentView: "Marking",
  currentTheme: "nordic",
  currentThemeMode: "system",
  currentTab: null,
  currentBaseUrl: "",
  currentSiteId: "",
  currentConfig: null,
  toastTimer: 0,
  refreshTimer: 0,
  lastTabId: null,
  stageBaseEditMode: false,
  endpointEditMode: false,
  configEndpointEditMode: false,
  renderModeEditMode: false,
  aiRequestInFlight: null,
  aiComputeStartPending: false,
  aiRunPhase: "",
  aiRunSessionId: "",
  aiRunSiteId: "",
  aiRunDeadlineAt: 0,
  aiRunRemainingMs: 0,
  aiRunResumeExpiresAt: 0,
  aiRunResumed: false,
  aiRunPollTimer: 0,
  aiRunCountdownTimer: 0,
  aiRunResumeCheckKey: "",
  aiRunResumeInFlight: false,
  sessionAiRunPhase: AI_RUN_PHASES.PRE_AI,
  aiSelectorsComputedSinceLastSubmit: false,
  aiSelectorsComputedBaseUrl: "",
  selectorsPendingConfigSync: false,
  selectorsPendingConfigSyncBaseUrl: "",
  // Fingerprint of the page markings (exclude + include xpaths) captured at the
  // moment the last successful AI run completed for the current page. Used to
  // gate Run AI / Save / Preview: while this equals the live markings, the AI
  // output is up to date (Run AI disabled, Save/Preview enabled); any
  // mark/unmark change makes it differ (Run AI re-enabled, Save/Preview off).
  // null means no successful run for the current page since enabling marking.
  aiRunMarkingsFingerprint: null,
  configMenuOpen: false,
  currentTodoExpansionKey: "",
  todoExpansionStateByContext: new Map(),
  renderModeSummaryOpen: false,
  currentDeviceMode: "mobile",
  currentDeviceScale: DEVICE_SCALE_DEFAULTS.mobile,
  currentDeviceEmulationEnabled: false,
  currentDesktopPreviewEnabled: false,
  deviceControlsDisabled: false,
  currentDraftEntry: null,
  currentSavedEntry: null,
  currentDraftDirty: false,
  currentDraftAvailable: false,
  currentPageSaveReconciliation: null,
  currentPageSaveReconciliationPending: false,
  currentPageTypeKey: "",
  currentPageTypeTitle: "",
  clearDomainCacheDisabled: false,
  unregisterCurrentTabDisabled: false,
  lastPopupPageUrl: "",
  lastPopupEnabled: null,
  lastPopupEnabledContext: null,
  previewRestorePending: false,
  previewRestoreToken: 0,
  previewRestoreAppliedToken: 0,
  previewRestoreFallbackTimer: 0,
  lastPreviewItemsSignature: "",
  // Popup-owned authority for "a preview sidebar is open". The getAiPreviewState
  // content probe is only a refresh source for the item list, never the source
  // of truth for open/closed: on heavy pages it has long transient states
  // (mid-hydration empty+pending, still-closing-async after Exit, request
  // timeouts) that otherwise flap the sidebar. previewOpenIntent is set when the
  // popup opens a preview and cleared when it closes; previewSuppressReopen is
  // raised on close and stays up until the popup itself opens the next preview.
  // Probe responses can arrive out of order across interleaved refreshUi
  // passes, so an ACTIVE read after a popup-initiated close is stale no matter
  // how late it lands — a confirmed-closed probe must NOT drop the guard
  // (doing so let the next stale-active probe reopen the sidebar after Exit,
  // #5/#14). Every in-popup open path sets a fresh intent, and a reconnecting
  // popup starts with the guard down, so live previews are still adopted.
  previewOpenIntent: false,
  previewSuppressReopen: false,
  // Monotonic counter of popup-initiated marking-session transitions: preview
  // exit settle, enable/disable toggle, AI-run start, the popup's own force
  // disables, and the first post-exit observation of content marking being
  // re-enabled. refreshUi is a long async pipeline (seconds on heavy pages)
  // and passes interleave, so a pass whose tab-probe reads predate the latest
  // transition computes marking facts from a world that no longer exists —
  // one such stale isEnabled:false publish made the brain dictate SILENT and
  // collapse a successfully restored session (#5/#14 post-exit wedge). Every
  // refreshUi pass captures the epoch at start; publishing marking facts and
  // syncing/forcing an enabled flip are skipped when the epoch has moved
  // since. Each transition site runs/schedules a fresh pass, so a skipped
  // effect is always redone from fresh reads.
  markingSessionEpoch: 0,
  // A popup-initiated preview close restored a marking session (the snapshot
  // was present at settle) and content's own async marking re-enable has not
  // been observed yet. Content keeps answering markingEnabled:false for
  // seconds after the popup settles the exit on heavy pages — longer than any
  // fixed grace window. While this latch is up, the "content wins" toggle sync
  // must not adopt that transient false and the publish path clamps
  // isEnabled/silentModeActive to the restore target (enabled). The latch
  // clears on the first content probe reporting marking enabled (which also
  // bumps markingSessionEpoch so older in-flight passes cannot override the
  // observation) or on any popup-initiated marking transition.
  previewCloseMarkingRestoreUnconfirmed: false,
  // Current state of the marking-session machine (reflex-arc model): the
  // popup's muscle memory. Discrete signals move it through a predefined
  // transition table and each state's complete presentation applies from
  // memory; fact/dictation churn cannot move it. "boot" adopts once from the
  // brain snapshot. See src/popup/marking-session-machine.ts.
  markingSessionMachineState: "boot",
  // REFLEX-ARC Phase 1: per-popup signal-frame consumption cursor. Frames at
  // or below this seq are already applied; pulls resume after it.
  lastConsumedSignalSeq: 0,
  // Session-scoped item latch: once content reports a hydrated non-empty preview
  // list, the popup must never blink it back to empty mid-session, no matter
  // which racy source (getAiPreviewState probe or aiPreviewStateChanged push)
  // delivers a transient/stale empty snapshot. previewSessionHadItems flips true
  // on the first non-empty hydration; previewItemsLatched holds the last
  // non-empty list. Both reset on open and on close.
  previewSessionHadItems: false,
  // A settled no-detections feed arrived for this session (never-hydrated):
  // re-renders keep showing the genuine empty state instead of "loading".
  previewSessionSettledEmpty: false,
  previewItemsLatched: [],
  // Snapshot of marking-session state captured before opening Preview Content.
  // Exit Preview restores this snapshot to keep button gating state-neutral.
  previewMarkingSessionSnapshot: null,
  configViewLocked: false,
  tokenValidationInFlight: false,
  lastTokenValidationAt: 0,
  tokenValidationTimer: 0,
  renderModeDetectionInFlight: false,
  renderModeDetectionKey: "",
  renderModeDetectionUnsure: false,
  renderModeDetectionAccuracy: Number.NaN,
  renderModeSuggestedKey: "",
  renderModeSuggestedValue: "undetermined",
  renderModeInspectionSnapshotKey: "",
  renderModeInspectionSnapshot: null,
  renderModeInspectionActive: false,
  renderModeTabJsDisabled: false,
  renderModeUndeterminedNoticeKey: "",
  renderModeWarningDismissedKey: "",
  renderModeManualStepsVisible: false,
  renderModeDebuggerTabId: null,
  currentBaseUrlHasConfirmedRenderMode: false,
  remoteConfigLoadKey: "",
  pageDataLoadSessionKey: "",
  remoteConfigRetryAttempt: 0,
  remoteConfigLoadResult: null,
  remoteConfigLoadResultByKey: new Map(),
  remoteConfigLoadRequestCounter: 0,
  remoteConfigGlobalFenceRequestId: 0,
  remoteConfigLatestRequestIdByPageLoadKey: new Map(),
  remoteConfigTabFenceByTabId: new Map(),
  remoteConfigSiteFenceByKey: new Map(),
  remoteConfigConnectionIssue: false,
  remoteConfigConnectionRetryTimer: 0,
  lastConfigLoadStatusText: "Not loaded yet",
  lastConfigLoadStatusTone: "muted",
  lastConfigSaveStatusText: "No save sent yet",
  lastConfigSaveStatusTone: "muted",
  siteIdLookupByBaseUrl: new Map(),
  propertyPageTypes: [],
  propertyPageTypesDuplicateUrls: [],
  propertyPageTypesSiteId: null,
  propertyPageTypesStageBase: "",
  propertyPageTypesSignature: "",
  propertyPageTypesFetchedAt: 0,
  propertyPageTypesRefreshTimer: 0,
  propertyPageTypesRefreshKey: "",
  propertyPageTypesLastError: "",
  propertyPageTypesChangeNoticeVisible: false,
  propertyPageTypesInvalidAlertPending: false,
  propertyPageTypesChangeForceTodoOpen: false,
  traceModeEnabled: false,
  traceEvents: [],
  removedRemotePageKeys: new Set(),
  propertyLockSiteId: null,
  propertyLockState: null,
  propertyLockConnectionStatus: "inactive",
  propertyLockConnectionError: "",
  propertyLockIdentity: "",
  propertyLockName: "",
  propertyLockClientId: "",
  propertyLockSecondsRemaining: null,
  propertyLockSuggestionId: "",
  propertyLockSuggestionFromName: "",
  propertyLockSuggestionVisible: false,
  propertyLockSuggestionPending: false,
  propertyLockSuggestionRejected: false,
  propertyLockInactivityWarningVisible: false,
  propertyLockDisconnectCountdown: null,
  propertyLockTransferCountdown: null,
  propertyLockOffCandidateDeadlineAt: 0,
  propertyLockRecoverySiteId: null,
  propertyLockRecoveryBaseUrl: "",
  propertyLockRecoveryClientId: "",
  propertyLockRecoveryDeadlineAt: 0,
  propertyLockOffCandidateRefreshTimer: 0,
  propertyLockEditorBootstrapPending: false,
  lynxChecklistVisible: false,
  lynxChecklistAiAnswer: initialLynxChecklistState.aiAnswer,
  lynxChecklistPageTypes: initialLynxChecklistState.pageTypes,
  lynxChecklistAiQuestionDisabled: true,
  lynxChecklistAiQuestionHidden: true,
  lynxChecklistNoticeText: ""
};
