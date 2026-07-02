import type {
  Config,
  PageMarkingEntry,
  PageSaveReconciliation,
  PropertyLockState
} from "./config.ts";
import type { Browser } from "../common/browser";
import type { PopupTraceEvent } from "../common/bus/contracts/popup-state";
import type { SessionAiRunPhase } from "../common/bus/contracts/session-state";

export type PopupTone = "muted" | "success" | "warning" | "danger";
export type PopupView = "Loading" | "Configuration" | "Marking";

export type AiRunPhase = "" | "idle" | "starting" | "running" | "completed" | "failed";

export interface LynxChecklistPageType {
  key: string;
  title: string;
  candidates: Array<{
    url: string;
    wordsCount: number;
    duplicate: boolean;
    duplicatePageTypes: string[];
  }>;
}

export interface RemoteConfigLoadResult {
  status: string;
  baseUrl: string;
  [key: string]: unknown;
}

export interface RenderModeInspectionSnapshot {
  renderedHtml?: string;
  rawHtml?: string;
  withJavaScript?: Record<string, unknown>;
  withoutJavaScript?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TodoExpansionState {
  todoSectionExpanded: boolean;
  todoSubsectionsExpanded: Record<string, boolean>;
}

export interface PopupPreviewMarkingSessionSnapshot {
  currentDraftEntry: PageMarkingEntry | null;
  currentSavedEntry: PageMarkingEntry | null;
  currentDraftDirty: boolean;
  currentDraftAvailable: boolean;
  currentPageSaveReconciliation: PageSaveReconciliation | null;
  currentPageSaveReconciliationPending: boolean;
  sessionAiRunPhase: SessionAiRunPhase;
  aiRunMarkingsFingerprint: string | null;
  aiSelectorsComputedSinceLastSubmit: boolean;
  aiSelectorsComputedBaseUrl: string;
  selectorsPendingConfigSync: boolean;
  selectorsPendingConfigSyncBaseUrl: string;
}

export interface PopupState {
  currentView: PopupView;
  currentTheme: string;
  currentThemeMode: string;
  currentTab: Browser.tabs.Tab | null;
  currentBaseUrl: string;
  currentSiteId: string | number;
  currentConfig: Config | null;
  toastTimer: number;
  refreshTimer: number;
  lastTabId: number | null;
  stageBaseEditMode: boolean;
  endpointEditMode: boolean;
  configEndpointEditMode: boolean;
  renderModeEditMode: boolean;
  aiRequestInFlight: string | Promise<unknown> | null;
  aiComputeStartPending: boolean;
  aiRunPhase: AiRunPhase | string;
  aiRunSessionId: string;
  aiRunSiteId: string | number;
  aiRunDeadlineAt: number;
  aiRunRemainingMs: number;
  aiRunResumeExpiresAt: number;
  aiRunResumed: boolean;
  aiRunPollTimer: number;
  aiRunCountdownTimer: number;
  aiRunResumeCheckKey: string;
  aiRunResumeInFlight: boolean;
  sessionAiRunPhase: SessionAiRunPhase;
  aiSelectorsComputedSinceLastSubmit: boolean;
  aiSelectorsComputedBaseUrl: string;
  selectorsPendingConfigSync: boolean;
  selectorsPendingConfigSyncBaseUrl: string;
  aiRunMarkingsFingerprint: string | null;
  configMenuOpen: boolean;
  currentTodoExpansionKey: string;
  todoExpansionStateByContext: Map<string, TodoExpansionState>;
  renderModeSummaryOpen: boolean;
  currentDeviceMode: string;
  currentDeviceScale: number;
  currentDeviceEmulationEnabled: boolean;
  currentDesktopPreviewEnabled: boolean;
  deviceControlsDisabled: boolean;
  currentDraftEntry: PageMarkingEntry | null;
  currentSavedEntry: PageMarkingEntry | null;
  currentDraftDirty: boolean;
  currentDraftAvailable: boolean;
  currentPageSaveReconciliation: PageSaveReconciliation | null;
  currentPageSaveReconciliationPending: boolean;
  currentPageTypeKey: string;
  currentPageTypeTitle: string;
  clearDomainCacheDisabled: boolean;
  unregisterCurrentTabDisabled: boolean;
  lastPopupPageUrl: string;
  lastPopupEnabled: boolean | null;
  lastPopupEnabledContext: Record<string, unknown> | null;
  previewRestorePending: boolean;
  previewRestoreToken: number;
  previewRestoreAppliedToken: number;
  previewRestoreFallbackTimer: number;
  lastPreviewItemsSignature: string;
  previewOpenIntent: boolean;
  previewSuppressReopen: boolean;
  previewSessionHadItems: boolean;
  previewItemsLatched: Array<{ xpath: string; text: string; title: string; kind: string }>;
  previewMarkingSessionSnapshot: PopupPreviewMarkingSessionSnapshot | null;
  configViewLocked: boolean;
  tokenValidationInFlight: boolean;
  lastTokenValidationAt: number;
  tokenValidationTimer: number;
  renderModeDetectionInFlight: boolean;
  renderModeDetectionKey: string;
  renderModeDetectionUnsure: boolean;
  renderModeDetectionAccuracy: number;
  renderModeSuggestedKey: string;
  renderModeSuggestedValue: string;
  renderModeInspectionSnapshotKey: string;
  renderModeInspectionSnapshot: RenderModeInspectionSnapshot | null;
  renderModeInspectionActive: boolean;
  renderModeTabJsDisabled: boolean;
  renderModeUndeterminedNoticeKey: string;
  renderModeWarningDismissedKey: string;
  renderModeManualStepsVisible: boolean;
  renderModeDebuggerTabId: number | null;
  currentBaseUrlHasConfirmedRenderMode: boolean;
  remoteConfigLoadKey: string;
  // #load-once: identity of the page session (tab|page|site|endpoint) for which the
  // config /load has already fired. The load runs ONCE per page session and is never
  // re-triggered by the recurring popup refresh.
  pageDataLoadSessionKey: string;
  // Exponential-backoff attempt counter for the remote-config /load retry: bumped
  // on each errored retry, reset to 0 on a clean (ok/not_found) load. Stops the
  // 2.5s retry-on-error storm when the backend is failing.
  remoteConfigRetryAttempt: number;
  remoteConfigLoadResult: RemoteConfigLoadResult | null;
  remoteConfigLoadResultByKey: Map<string, RemoteConfigLoadResult>;
  remoteConfigLoadRequestCounter: number;
  remoteConfigGlobalFenceRequestId: number;
  remoteConfigLatestRequestIdByPageLoadKey: Map<string, number>;
  remoteConfigTabFenceByTabId: Map<number, number>;
  remoteConfigSiteFenceByKey: Map<string, number>;
  remoteConfigConnectionIssue: boolean;
  remoteConfigConnectionRetryTimer: number;
  lastConfigLoadStatusText: string;
  lastConfigLoadStatusTone: PopupTone;
  lastConfigSaveStatusText: string;
  lastConfigSaveStatusTone: PopupTone;
  siteIdLookupByBaseUrl: Map<string, string | number>;
  propertyPageTypes: Array<Record<string, unknown>>;
  propertyPageTypesDuplicateUrls: string[];
  propertyPageTypesSiteId: string | number | null;
  propertyPageTypesStageBase: string;
  propertyPageTypesSignature: string;
  propertyPageTypesFetchedAt: number;
  propertyPageTypesRefreshTimer: number;
  propertyPageTypesRefreshKey: string;
  propertyPageTypesLastError: string;
  propertyPageTypesChangeNoticeVisible: boolean;
  propertyPageTypesInvalidAlertPending: boolean;
  propertyPageTypesChangeForceTodoOpen: boolean;
  traceModeEnabled: boolean;
  traceEvents: PopupTraceEvent[];
  removedRemotePageKeys: Set<string>;
  propertyLockSiteId: number | null;
  propertyLockState: PropertyLockState | null;
  propertyLockConnectionStatus: string;
  propertyLockConnectionError: string;
  propertyLockIdentity: string;
  propertyLockName: string;
  propertyLockClientId: string;
  propertyLockSecondsRemaining: number | null;
  propertyLockSuggestionId: string;
  propertyLockSuggestionFromName: string;
  propertyLockSuggestionVisible: boolean;
  propertyLockSuggestionPending: boolean;
  propertyLockSuggestionRejected: boolean;
  propertyLockInactivityWarningVisible: boolean;
  propertyLockDisconnectCountdown: number | null;
  propertyLockTransferCountdown: number | null;
  propertyLockOffCandidateDeadlineAt: number;
  propertyLockRecoverySiteId: number | null;
  propertyLockRecoveryBaseUrl: string;
  propertyLockRecoveryClientId: string;
  propertyLockRecoveryDeadlineAt: number;
  propertyLockOffCandidateRefreshTimer: number;
  propertyLockEditorBootstrapPending: boolean;
  lynxChecklistVisible: boolean;
  lynxChecklistAiAnswer: string;
  lynxChecklistPageTypes: Array<Record<string, unknown>>;
  lynxChecklistAiQuestionDisabled: boolean;
  lynxChecklistAiQuestionHidden: boolean;
  lynxChecklistNoticeText: string;
  todoSubsectionsExpanded?: Record<string, boolean>;
  [key: string]: unknown;
}
