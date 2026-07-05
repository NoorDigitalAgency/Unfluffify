/**
 * @fileoverview Main popup interface for the Unfluffify extension.
 * 
 * This is the entry point for the popup UI. It handles:
 * - Rendering the popup interface with Preact
 * - Managing tab state (enabled/disabled status, base URLs, etc.)
 * - Sending and receiving messages from the content script
 * - Managing AI selector configuration and computation
 * - Handling device emulation/simulation settings
 * - Syncing page markings and exclusions
 * - Caching and persistence of user preferences
 * - API interactions for remote configuration
 * 
 * The UI is built using Preact and manages view states for:
 * - Marking: Main content exclusion/inclusion interface
 * - Configuration: AI selector and rendering mode settings
 * - Consent: Cookie/consent banner detection settings
 * - Silent Highlight: Visual overlay and highlighting modes
 */

import * as chromeHelpers from "./popup/chrome-helpers";
import { browser } from "./common/browser";
import * as config from "./common/config";
import { initPageTypeTaxonomy } from "./common/page-type-taxonomy";
import * as constants from "./common/constants";
import { tracePopupApplyView } from "./common/layer-trace";
import {
  FEATURE_DISABLED_REASON,
  getFeatureFlags,
  isDebugBuild,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "./common/feature-flags";
import * as emulation from "./popup/emulation";
import {
  MARKING_SESSION_OVERLAY_FAIL_OPEN_MS,
  adoptMarkingSessionState,
  resolveMarkingSessionSurfaceMemory,
  stepMarkingSession,
  type MarkingSessionMachineState,
  type MarkingSessionSignal
} from "./popup/marking-session-machine";
import * as uiModule from "./popup/ui";
import {
  buildLynxChecklistPromptState,
  buildLynxChecklistViewModel,
  createInitialLynxChecklistState,
  lynxAlreadyHasSelectorSet,
  normalizeCandidatePageUrl,
  normalizePageTypeKey
} from "./common/lynx-checklist";
import {
  buildPageSaveUiState
} from "./common/page-save-state";
import {
  buildGraphqlEndpointFromStageBase,
  getCurrentPageCandidateState,
  normalizeSiteIdValue,
  normalizeStageBase
} from "./common/lynx-live-pages";
import {
  clearGlobalToken,
  getGlobalToken,
  getThemeSettings,
  saveGlobalConfigEndpoint,
  saveGlobalEndpoint,
  saveGlobalStageBase,
  saveLoginSettings,
  setThemeSettings
} from "./common/settings-store";
import {
  buildTransferPayloadKey,
  putTransferPayload
} from "./background/transfer-payload-store";
import {
  PopupText,
  ViewText,
  formatClearDomainCacheConfirm,
  formatConfigLoadStatusLabel,
  formatLoginFailedStatus,
  formatScalePercent,
  formatTimestampedStatus,
  propertyLockText
} from "./common/text";
import * as utils from "./common/utilities";
import * as messages from "./popup/messages";
import * as helpers from "./popup/helpers";
import {
  AI_RUN_TIMEOUT_MS,
  formatAiRunCountdown,
  getAiRunRemainingMs,
  normalizePersistedAiRunRecord,
  shouldResumePersistedAiRun
} from "./popup/ai-run";
import { resolveRenderModeInspectionReloadOutcome } from "./popup/render-mode";
import {
  isRenderModeNoJsHeld,
  renderModeNoJsHeldStorageKey
} from "./common/render-mode-js-state";
import * as stateModule from "./popup/state";
import {
  logPopupReady
} from "./popup/telemetry";
import type { ActivationSnapshot } from "./common/bus/contracts/activation";
import type {
  PopupStateGetReply
} from "./common/bus/contracts/popup-state";
import {
  PROPERTY_LOCK_TIMER_SOURCES,
  type PropertyLockSnapshot
} from "./common/bus/contracts/property-lock-state";
import { SECONDARY_GATES_BLOCK_REASONS } from "./common/bus/contracts/secondary-gates-state";
import {
  AI_RUN_EVENT_TYPES,
  type AiRunEventPayload,
  type AiRunEventType
} from "./common/bus/contracts/ai-run";
import {
  AI_RUN_PHASES,
  SESSION_PHASES,
  type SessionAiRunPhase,
  type SessionDictation,
  type SessionFactsPatch
} from "./common/bus/contracts/session-state";
import {
  isRenderModeRunInspectionOperationReply,
  isRenderModeRunInspectionResult,
} from "./common/bus/contracts/render-mode";
import { SPINNER_REQUEST_TYPES } from "./common/bus/contracts/spinner";
import { SPINNER_KEYS } from "./common/world-messaging-contract";
import {
  getSpinnerPhaseDefinition,
  SPINNER_OPERATION_KINDS,
  SPINNER_OPERATION_PHASES,
} from "./common/spinner-contract";
import {
  publishPopupPropertyLockSnapshot,
  publishPopupAiRunEvent,
  publishPopupSessionFacts,
  requestPopupSessionFactsApply,
  requestPopupRenderModeCaptureHtml,
  emitPopupSignal,
  pullPopupSignals,
  requestPopupRenderModeHideConsent,
  requestPopupSpinnerClear,
  requestPopupSpinnerRemove,
  requestPopupSpinnerSet,
  requestPopupView,
  runPopupBusSelfTest,
  startPopupBusClient
} from "./popup/layers/popup-bus-client";
import { SIGNAL_NAMES, type SignalFrame } from "./common/bus/contracts/signals";
import {
  requestPopupRenderModeInspection,
  requestPopupRenderModeInspectionEnd,
} from "./popup/layers/modes/render-mode-inspection";
import {
  clearPopupSpinnerSurface,
  getLatestPopupSpinnerState
} from "./popup/layers/spinner-layer";
import {
  buildCentralSessionDictationViewStatePatch,
  deriveCentralSessionDictationSnapshotEffect,
  hasProjectedCentralSessionDictationForTab as hasProjectedCentralSessionDictationForTabOperation
} from "./popup/central-state-dictation";
import {
  deriveProjectedPropertyLockSnapshotEffect,
  hasProjectedPropertyLockViewForTab as hasProjectedPropertyLockViewForTabOperation
} from "./popup/property-lock-state-dictation";
import {
  deriveProjectedSecondaryGatesSnapshotEffect,
  NEUTRAL_SECONDARY_GATES_VIEW_PATCH,
  resolveSecondaryGatesViewStatePatch
} from "./popup/secondary-gates-state-dictation";
import {
  ensureBaseUrlSiteId as ensureBaseUrlSiteIdOperation,
  ensurePropertyPageTypes as ensurePropertyPageTypesOperation,
  resolveSiteIdFromGraphql as resolveSiteIdFromGraphqlOperation
} from "./popup/site-resolution";
import {
  loadRemoteConfigForCurrentPage as loadRemoteConfigForCurrentPageOperation,
  scheduleRemoteConfigRetry as scheduleRemoteConfigRetryOperation,
  syncBaseConfigToServer as syncBaseConfigToServerOperation
} from "./popup/remote-config";
import {
  detectRenderModeViaEndpoint as detectRenderModeViaEndpointOperation,
  maybeAutoDetectRenderMode as maybeAutoDetectRenderModeOperation
} from "./popup/render-mode-inspection";
import {
  handlePageRevert as handlePageRevertOperation,
  handlePageSave as handlePageSaveOperation,
  hasCurrentPagePendingChanges as hasCurrentPagePendingChangesOperation
} from "./popup/page-reconciliation";
import {
  applyPropertyLockConnectionStatus as applyPropertyLockConnectionStatusOperation,
  applyPropertyLockServerMessage as applyPropertyLockServerMessageOperation,
  applyPropertyLockState as applyPropertyLockStateOperation,
  buildPropertyLockViewState as buildPropertyLockViewStateOperation,
  clearPropertyLockOffCandidateRefreshTimer as clearPropertyLockOffCandidateRefreshTimerOperation,
  clearPropertyLockTransientState as clearPropertyLockTransientStateOperation,
  fetchPropertyLockState as fetchPropertyLockStateOperation,
  isPropertyLockBlockingEditing as isPropertyLockBlockingEditingOperation,
  isPropertyLockCollaborationEnabled as isPropertyLockCollaborationEnabledOperation,
  persistPropertyLockRecoveryMetadata as persistPropertyLockRecoveryMetadataOperation,
  queueEditorBootstrapOnLockTransition as queueEditorBootstrapOnLockTransitionOperation,
  reconcilePropertyLockAfterCommand as reconcilePropertyLockAfterCommandOperation,
  refreshPropertyLockSnapshot as refreshPropertyLockSnapshotOperation,
  resetDisabledPropertyLockState as resetDisabledPropertyLockStateOperation,
  resetPropertyLockState as resetPropertyLockStateOperation,
  sendPropertyLockCommand as sendPropertyLockCommandOperation,
  syncPropertyLockOffCandidateRefreshTimer as syncPropertyLockOffCandidateRefreshTimerOperation
} from "./popup/property-lock-ui";


import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  aiSelectorSetsEqual
} from "./common/selector-set";
import {
  PROPERTY_LOCK_BACKGROUND_GET_STATE,
  PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
  PROPERTY_LOCK_CONTENT_TAKE_LOCK,
  PROPERTY_LOCK_CONTENT_SUGGEST,
  PROPERTY_LOCK_CONTENT_RESPOND,
  PROPERTY_LOCK_CONTENT_CONTINUE,
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
  PROPERTY_LOCK_CONNECTION_CONNECTING,
  PROPERTY_LOCK_CONNECTION_CONNECTED,
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
  PROPERTY_LOCK_CONNECTION_INACTIVE,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_STATE_UNLOCKED,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_EXPIRY_WARNING,
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
  PROPERTY_LOCK_STATE_TRANSFER,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_WS_DISCONNECT_WARNING,
  PROPERTY_LOCK_WS_INACTIVITY_WARNING,
  PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
  PROPERTY_LOCK_WS_SUGGESTION_PENDING,
  PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
  PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
  PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN,
  PROPERTY_LOCK_WS_ERROR,
  createInactiveLockState,
  normalizeLockStateMessage
} from "./common/property-lock";
import type {
  PopupTone,
  PopupPreviewMarkingSessionSnapshot,
  RenderModeInspectionSnapshot,
  RemoteConfigLoadResult,
  TodoExpansionState
} from "./types/popup-state.ts";
import type {
  Config,
  PageMarkingEntry,
  PageMarkings,
  PageSaveReconciliation,
  SelectorSet
} from "./types/config.ts";

type PopupViewState = ReturnType<typeof uiModule.getViewState>;
type PopupViewStatePatch = Partial<PopupViewState>;
type PopupCommandSuccess<T extends object> = {
  ok: true;
  result: T;
};
type PreviewViewState = Pick<
  PopupViewState,
  | "previewActive"
  | "previewItemsPending"
  | "previewWillRestoreMarking"
  | "previewItems"
  | "previewFocusedXpath"
  | "previewShowAllCategories"
>;
type PreviewItemInput = Partial<PreviewViewState["previewItems"][number]> & Record<string, unknown>;
type ResolvedPreviewItems = { items: PreviewViewState["previewItems"]; pending: boolean };
type PreviewRestoreMessage = {
  previewRestoreToken?: unknown;
  pageUrl?: unknown;
};
type PreviewStateLike = {
  baseUrl?: string;
  active?: boolean;
  mode?: string;
  previousEnabled?: boolean;
  restoreMarkingOnExit?: boolean;
  items?: PreviewItemInput[];
  itemsPending?: boolean;
  focusedXpath?: string;
  showAllCategories?: boolean;
};
type PreviewCommandResult = PreviewStateLike & {
  previewState?: PreviewStateLike | null;
};
type PropertyLockUiDeps = Parameters<typeof isPropertyLockCollaborationEnabledOperation>[0];
type PopupSpinnerSnapshot = {
  key: string;
  entry: {
    blockSurfaces?: { page?: boolean; popup?: boolean };
    deadlineAt?: number;
    maxDurationMs?: number;
    message?: string;
    operationId?: string;
    operationKind?: string;
    operationPhase?: string;
    reason?: string;
    source?: string;
    startedAt?: number;
    timerMode?: string;
  };
} | null;
type PopupSpinnerState = NonNullable<ReturnType<typeof getLatestPopupSpinnerState>>;
type PendingPropertyPageTypesRequest =
  ReturnType<Parameters<typeof ensurePropertyPageTypesOperation>[0]["getPropertyPageTypesRequest"]>;
type SiteResolutionDeps = Parameters<typeof ensurePropertyPageTypesOperation>[0];
type RemoteConfigDeps = Parameters<typeof scheduleRemoteConfigRetryOperation>[0];
type RenderModeInspectionDeps = Parameters<typeof detectRenderModeViaEndpointOperation>[0];
type PageReconciliationDeps = Parameters<typeof handlePageSaveOperation>[0];
type PopupBusClient = Parameters<typeof runPopupBusSelfTest>[0];
type PopupSpinnerBrokerResponse = Awaited<ReturnType<typeof requestPopupSpinnerSet>>;
type PopupSpinnerSurface = "popup" | "page";
type SpinnerBrokerMessage = {
  type?: string;
  key?: string;
  message?: string;
  persistent?: boolean;
  reason?: string;
  source?: string;
  startedAt?: number;
  operationId?: string;
  operationKind?: string;
  operationPhase?: string;
  deadlineAt?: number;
  maxDurationMs?: number;
  blockSurfaces?: { page?: boolean; popup?: boolean };
  timerMode?: string;
};
type SpinnerBrokerMessageOptions = {
  shouldApplySnapshot?: (response: NonNullable<PopupSpinnerBrokerResponse>) => boolean;
};
type PopupBackgroundStateSnapshot = {
  ok?: boolean;
  version?: number;
  tabId?: number | null;
  lifecycle?: PopupStateGetReply["lifecycle"] | null;
  activation?: PopupStateGetReply["activation"] | null;
  sessionPhase?: PopupStateGetReply["sessionPhase"] | null;
  sessionDictation?: PopupStateGetReply["sessionDictation"] | null;
  propertyLockView?: PopupStateGetReply["propertyLockView"] | null;
  propertyLockTimer?: PopupStateGetReply["propertyLockTimer"] | null;
  secondaryGates?: PopupStateGetReply["secondaryGates"] | null;
  traceEnabled?: boolean;
  traceEvents?: PopupStateGetReply["traceEvents"] | null;
};
type TraceModeToggleEvent = Event & {
  currentTarget?: (EventTarget & { checked?: boolean }) | null;
};
type MobileSimulationState = {
  enabled?: boolean;
  mode?: string;
};
type PropertyPageTypesRefreshOptions = {
  siteId?: number | string | null;
  stageBase?: string;
};
type SessionChangeOptions = {
  currentDraftDirty?: boolean;
  aiRunUpToDate?: boolean;
  reconciliationPending?: boolean;
  selectorsPendingConfigSync?: boolean;
};
type StopAiRunOptions = {
  unlockPage?: boolean;
};
type RemotePageMarkingRemovalOptions = {
  siteId?: number | string | null;
  url?: string;
};
type RemoteInvalidPagePruneOptions = {
  siteId?: number | string | null;
  invalidUrls?: string[] | null;
};
type LocalInvalidPagePruneOptions = {
  baseUrl?: string;
  invalidUrls?: string[] | null;
};
type RepairedMarkedPage = {
  url?: unknown;
  pageType?: string;
};
type LocalPageTypeRepairOptions = {
  baseUrl?: string;
  repairedMarkedPages?: RepairedMarkedPage[];
};
type PopupEnabledContext = {
  tabId: number | null;
  pageUrl: string;
  baseUrl: string;
};
type PageMarkingListItem = {
  url: string;
  title: string;
  pageType: string;
  count: number;
};
type ConfigSyncResult = {
  ok?: boolean;
  skipped?: boolean;
};
type PopupEventLike<TTarget extends object = object> = {
  target?: (EventTarget & TTarget) | TTarget | null;
  currentTarget?: (EventTarget & TTarget) | TTarget | null;
  key?: unknown;
  stopPropagation?: () => void;
  preventDefault?: () => void;
};
type PopupValueEvent = PopupEventLike<{ value?: unknown }>;
type PopupCheckedEvent = PopupEventLike<{ checked?: unknown }>;
type PopupOpenEvent = PopupEventLike<{ open?: unknown }>;
type PopupRefreshOptions = {
  useBusyOverlay?: boolean;
  skipPropertyLockFetch?: boolean;
  propertyPageTypesRefreshChanged?: boolean;
  preserveCurrentDraftStatus?: boolean;
};
type InspectionSettleResult = {
  inspectionObserved: boolean;
  responseObserved: boolean;
  settled: boolean;
  attempts: number;
};
type ValidateStoredTokenOptions = {
  force?: boolean;
  showToastOnInvalid?: boolean;
};
type EditableFieldStateOptions = {
  inputRef?: Element | null;
  currentValue?: string;
  value?: string;
  isSet?: boolean;
  editMode?: boolean;
  suggestedValue?: string;
  preserveCurrentValueWhileEditing?: boolean;
  noticeUnset?: string;
  noticeEdit?: string;
};
type EditableFieldState = {
  isEditing: boolean;
  isReady: boolean;
  value: string;
  noticeText: string;
  noticeVisible: boolean;
};
type AiRunActiveStateOptions = {
  sessionId?: string;
  siteId?: string | number | null;
  deadlineAt?: number;
  resumed?: boolean;
  phase?: string;
};
type ComputedSelectorSetApplyOptions = {
  currentPageUrl?: string;
  tokenValue?: string;
};
type PageTypeAssignmentsSubmitOptions = {
  baseUrl?: string;
  checklistPageTypes?: Array<Record<string, unknown>>;
  pageMarkings?: PageMarkings;
};
type SelectorSetSubmitOptions = {
  baseUrl?: string;
  selectorSet?: SelectorSet;
  tokenValue?: string;
};
type RenderModeDebuggerLifecycleOptions = {
  wasVisible: boolean;
  isVisible: boolean;
  currentTabId: number | null;
};
type TodoExpansionViewState = {
  todoControlsMenuOpen: false;
  todoSectionExpanded: boolean;
  todoSubsectionsExpanded: Record<string, boolean>;
};
type SelectorSetTransferPayload = {
  exclusionSelectors: unknown[];
  inclusionSelectors: unknown[];
};
type AiRunCommandFailureDetails = {
  reconciliationPending?: unknown;
  locked?: unknown;
  reason?: unknown;
};
type PopupFailureLike = Record<string, unknown> | null | undefined;
type FailedPopupOperationResponse = {
  ok: false;
  error?: string;
  locked?: boolean;
  details?: Record<string, unknown> | null;
};
type StorageChangeLike = {
  oldValue?: unknown;
  newValue?: unknown;
};
type StorageChangeMap = Record<string, StorageChangeLike | undefined>;

const { state } = stateModule;

// Debug-only "direct mode": lets marking activate on ANY page (bypassing the
// configured-property / confirmed-render-mode / page-type gates) for test
// scenarios such as an unconfigured shadow-DOM page (cramo). Gated on BOTH a
// debug build (`isDebugBuild()`) AND the explicit `?directMode=1` popup query
// param, so a plain production build never honors it. Scope: marking +
// enumeration + overlay only — save / AI-run stay gated as usual.
const DIRECT_MODE_ACTIVE = (() => {
  try {
    if (!isDebugBuild() || typeof location === "undefined") {
      return false;
    }
    return new URLSearchParams(location.search || "").get("directMode") === "1";
  } catch {
    return false;
  }
})();

const popupDebugTarget = globalThis as typeof globalThis & {
  __UNFLUFFIFY_POPUP_DEBUG__?: {
    getViewState: typeof uiModule.getViewState;
    directModeActive?: boolean;
    activateDirectMode?: () => void;
  };
};

popupDebugTarget.__UNFLUFFIFY_POPUP_DEBUG__ = {
  getViewState: uiModule.getViewState,
  directModeActive: DIRECT_MODE_ACTIVE,
  // Programmatic activation for automated tests (more reliable than a synthetic
  // click). No-op unless direct mode is active.
  activateDirectMode: DIRECT_MODE_ACTIVE
    ? () => {
        void handleEnableToggle({ target: { checked: true } } as PopupCheckedEvent);
      }
    : undefined,
};

function getPopupEventSource<TTarget extends object>(
  event: PopupEventLike<TTarget> | null | undefined
): ((EventTarget & TTarget) | TTarget | null) {
  return event?.currentTarget ?? event?.target ?? null;
}

function getPopupEventValue(
  event: PopupValueEvent | null | undefined,
  fallback = ""
): string {
  const source = getPopupEventSource(event);
  return typeof source?.value === "string" ? source.value : fallback;
}

function getPopupEventChecked(
  event: PopupCheckedEvent | null | undefined,
  fallback = false
): boolean {
  const source = getPopupEventSource(event);
  return typeof source?.checked === "boolean" ? source.checked : fallback;
}

function getPopupEventOpen(
  event: PopupOpenEvent | null | undefined,
  fallback = false
): boolean {
  const source = getPopupEventSource(event);
  return typeof source?.open === "boolean" ? source.open : fallback;
}

function isSelectorSetTransferPayload(value: unknown): value is SelectorSetTransferPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as SelectorSetTransferPayload).exclusionSelectors) &&
      Array.isArray((value as SelectorSetTransferPayload).inclusionSelectors)
  );
}

function isFailedPopupOperationResponse(response: unknown): response is FailedPopupOperationResponse {
  return Boolean(
    response &&
      typeof response === "object" &&
      "ok" in response &&
      response.ok === false
  );
}

function getPropertyLockEditorName(): string {
  return state.propertyLockState &&
    typeof state.propertyLockState.editorName === "string" &&
    state.propertyLockState.editorName
    ? state.propertyLockState.editorName
    : "Someone";
}

function getStorageChangeMap(changes: unknown): StorageChangeMap {
  return changes && typeof changes === "object"
    ? changes as StorageChangeMap
    : {};
}

function asPopupHandler<TArgs extends unknown[]>(handler: (...args: TArgs) => unknown) {
  return (...args: unknown[]) => handler(...args as TArgs);
}

const PAGE_SAVE_SYNC_MAX_ATTEMPTS = 5;
const PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS = 1500;
const PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS = 10000;
const AI_PREVIEW_RESTORE_FALLBACK_MS = 1000;

// Marks a popup-initiated marking-session transition (preview exit settle,
// enable/disable toggle, AI-run start, popup force-disable, first post-exit
// observation of content marking re-enabled). Interleaved refreshUi passes
// whose reads predate the bump must not publish marking facts or sync an
// enabled flip from those reads (#5/#14 post-exit collapse); see
// state.markingSessionEpoch in src/popup/state.ts.
function bumpMarkingSessionEpoch(): number {
  state.markingSessionEpoch += 1;
  return state.markingSessionEpoch;
}

function getPropertyLockUiDeps(): PropertyLockUiDeps {
  return {
    isFeatureEnabled,
    FEATURE_DISABLED_REASON,
    propertyLockText,
    createInactiveLockState,
    normalizeLockStateMessage,
    normalizeSiteIdValue,
    PROPERTY_LOCK_BACKGROUND_GET_STATE,
    PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
    PROPERTY_LOCK_CONNECTION_INACTIVE,
    PROPERTY_LOCK_CONNECTION_CONNECTING,
    PROPERTY_LOCK_CONNECTION_CONNECTED,
    PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
    PROPERTY_LOCK_WS_LOCK_STATE,
    PROPERTY_LOCK_WS_DISCONNECT_WARNING,
    PROPERTY_LOCK_WS_INACTIVITY_WARNING,
    PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
    PROPERTY_LOCK_WS_SUGGESTION_PENDING,
    PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
    PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
    PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN,
    PROPERTY_LOCK_WS_ERROR,
    PROPERTY_LOCK_STATE_UNLOCKED,
    PROPERTY_LOCK_STATE_LOCKED,
    PROPERTY_LOCK_STATE_EXPIRY_WARNING,
    PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
    PROPERTY_LOCK_STATE_TRANSFER,
    windowRef: window,
    refreshUi: (options) => refreshUi(typeof options === "object" && options ? options : {}),
    setTabState: (
      tabId: Parameters<typeof messages.setTabState>[0],
      tabState: Parameters<typeof messages.setTabState>[1],
      scope: Parameters<typeof messages.setTabState>[2] = null
    ) => messages.setTabState(tabId, tabState, scope),
    sendRuntimeMessage: (payload) => messages.sendRuntimeMessage(payload),
    showToast: (message) => {
      uiModule.showToast(message);
    },
    setViewState: (viewState) => {
      uiModule.setViewState(viewState);
    },
    refreshCurrentPageRuntimeStatus: (options) =>
      refreshCurrentPageRuntimeStatus(typeof options === "object" && options ? options : {}),
    isPropertyLockCollaborationEnabled: () => isPropertyLockCollaborationEnabled(),
    resetPropertyLockState: () => resetPropertyLockState(),
    clearPropertyLockTransientState: () => clearPropertyLockTransientState(),
    clearPropertyLockOffCandidateRefreshTimer: () => clearPropertyLockOffCandidateRefreshTimer(),
    resetDisabledPropertyLockState: () => resetDisabledPropertyLockState(),
    applyPropertyLockState: (lockStateLike) => applyPropertyLockState(lockStateLike),
    queueEditorBootstrapOnLockTransition: (previousLockState, nextLockState) =>
      queueEditorBootstrapOnLockTransition(previousLockState, nextLockState),
    applyPropertyLockConnectionStatus: (status, error) =>
      applyPropertyLockConnectionStatus(status, error),
    fetchPropertyLockState: (siteId) => fetchPropertyLockState(siteId),
    refreshPropertyLockSnapshot: (siteId, options) => refreshPropertyLockSnapshot(siteId, options),
    buildPropertyLockViewState: () => buildPropertyLockViewState()
  };
}

const isPropertyLockCollaborationEnabled = () =>
  isPropertyLockCollaborationEnabledOperation(getPropertyLockUiDeps());
const resetDisabledPropertyLockState = () =>
  resetDisabledPropertyLockStateOperation(getPropertyLockUiDeps());
const resetPropertyLockState = () =>
  resetPropertyLockStateOperation(getPropertyLockUiDeps());
const clearPropertyLockTransientState = () =>
  clearPropertyLockTransientStateOperation();
const clearPropertyLockOffCandidateRefreshTimer = () =>
  clearPropertyLockOffCandidateRefreshTimerOperation(getPropertyLockUiDeps());
const syncPropertyLockOffCandidateRefreshTimer = (
  active: Parameters<typeof syncPropertyLockOffCandidateRefreshTimerOperation>[1]
) =>
  syncPropertyLockOffCandidateRefreshTimerOperation(getPropertyLockUiDeps(), active);
const persistPropertyLockRecoveryMetadata = (
  tabId: Parameters<typeof persistPropertyLockRecoveryMetadataOperation>[1],
  recoveryState: Parameters<typeof persistPropertyLockRecoveryMetadataOperation>[2] = {}
) =>
  persistPropertyLockRecoveryMetadataOperation(getPropertyLockUiDeps(), tabId, recoveryState);
const applyPropertyLockState = (
  lockStateLike: Parameters<typeof applyPropertyLockStateOperation>[1]
) =>
  applyPropertyLockStateOperation(getPropertyLockUiDeps(), lockStateLike);
const queueEditorBootstrapOnLockTransition = (
  previousLockState: Parameters<typeof queueEditorBootstrapOnLockTransitionOperation>[1],
  nextLockState: Parameters<typeof queueEditorBootstrapOnLockTransitionOperation>[2]
) =>
  queueEditorBootstrapOnLockTransitionOperation(getPropertyLockUiDeps(), previousLockState, nextLockState);
const applyPropertyLockConnectionStatus = (
  status: Parameters<typeof applyPropertyLockConnectionStatusOperation>[1],
  error: Parameters<typeof applyPropertyLockConnectionStatusOperation>[2] = ""
) =>
  applyPropertyLockConnectionStatusOperation(getPropertyLockUiDeps(), status, error);
const applyPropertyLockServerMessage = (
  serverMessage: Parameters<typeof applyPropertyLockServerMessageOperation>[1],
  siteId: Parameters<typeof applyPropertyLockServerMessageOperation>[2] = null
) =>
  applyPropertyLockServerMessageOperation(getPropertyLockUiDeps(), serverMessage, siteId);
const isPropertyLockBlockingEditing = () =>
  isPropertyLockBlockingEditingOperation(getPropertyLockUiDeps());
const buildPropertyLockViewState = () =>
  buildPropertyLockViewStateOperation(getPropertyLockUiDeps());
const fetchPropertyLockState = (
  siteId: Parameters<typeof fetchPropertyLockStateOperation>[1]
) =>
  fetchPropertyLockStateOperation(getPropertyLockUiDeps(), siteId);
const refreshPropertyLockSnapshot = (
  siteId: Parameters<typeof refreshPropertyLockSnapshotOperation>[1],
  options: Parameters<typeof refreshPropertyLockSnapshotOperation>[2] = {}
) =>
  refreshPropertyLockSnapshotOperation(getPropertyLockUiDeps(), siteId, options);
const sendPropertyLockCommand = (
  type: Parameters<typeof sendPropertyLockCommandOperation>[1],
  payload: Parameters<typeof sendPropertyLockCommandOperation>[2] = {}
) =>
  sendPropertyLockCommandOperation(getPropertyLockUiDeps(), type, payload);
const reconcilePropertyLockAfterCommand = (
  options: Parameters<typeof reconcilePropertyLockAfterCommandOperation>[1] = {}
) =>
  reconcilePropertyLockAfterCommandOperation(getPropertyLockUiDeps(), options);

const TOKEN_VALIDATION_INTERVAL_MS = 600 * 1000;
const POPUP_BUSY_OVERLAY_DELAY_MS = 180;
const REMOTE_CONFIG_RETRY_DELAY_MS = 2500;
const SILENT_HIGHLIGHTING_PREPARATION_REASON = "editor_preparing";
const RENDER_MODE_DETECTION_MAX_ATTEMPTS = 3;
const RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY = 0.65;
const RENDER_MODE_DETECTION_REVIEW_ACCURACY = 0.95;
const RENDER_MODE_INSPECTION_START_TIMEOUT_MS = 2000;
const RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS = 8000;
const RENDER_MODE_SET_NAV_GUARD_MAX_MS = 20000;
const RENDER_MODE_UNDETERMINED = "undetermined";
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS = 120 * 1000;
const TODO_EXPANSION_CONTEXT_LIMIT = 200;
const GLOBAL_THEME_KEY = "globalTheme";
const GLOBAL_THEME_MODE_KEY = "globalThemeMode";
const GLOBAL_AUTH_CONTEXT_VERSION_KEY = "globalAuthContextVersion";
const GLOBAL_STAGE_BASE_KEY = "globalStageBase";
const GLOBAL_CONFIG_ENDPOINT_KEY = "globalConfigEndpoint";
const THEME_DEFAULT = "nordic";
const THEME_MODE_DEFAULT = "system";
const THEME_MODE_SYSTEM = "system";
const THEME_MODE_LIGHT = "light";
const THEME_MODE_DARK = "dark";
const THEME_ACCENT_CLUSTER_ORDER = Object.freeze({
  blue: 0,
  cyan: 1,
  green: 2,
  warm: 3,
  violet: 4
});
type ThemeAccentCluster = keyof typeof THEME_ACCENT_CLUSTER_ORDER;
type ThemeCatalogEntry = {
  value: string;
  label: string;
  cluster: ThemeAccentCluster;
};
const THEME_CATALOG: readonly ThemeCatalogEntry[] = Object.freeze([
  { value: "blueprint", label: "Blueprint", cluster: "blue" },
  { value: "swedish-minimal", label: "Swedish Minimal", cluster: "blue" },
  { value: "cool", label: "Cool", cluster: "blue" },
  { value: "nordic", label: "Nordic", cluster: "blue" },
  { value: "neutral", label: "Neutral", cluster: "violet" },
  { value: "tidepool", label: "Tidepool", cluster: "cyan" },
  { value: "mint", label: "Mint", cluster: "cyan" },
  { value: "ocean", label: "Ocean", cluster: "cyan" },
  { value: "graphite", label: "Graphite", cluster: "cyan" },
  { value: "earthy", label: "Earthy", cluster: "green" },
  { value: "olive", label: "Olive", cluster: "green" },
  { value: "sunset", label: "Sunset", cluster: "warm" },
  { value: "clay-rose", label: "Clay Rose", cluster: "warm" },
  { value: "plum-steel", label: "Plum Steel", cluster: "violet" },
  { value: "plum", label: "Plum", cluster: "violet" },
  { value: "lavender", label: "Lavender", cluster: "violet" }
]);
const THEME_IDS = new Set(THEME_CATALOG.map((theme) => theme.value));
const THEME_OPTIONS = Object.freeze(
  [...THEME_CATALOG]
    .sort((left, right) => {
      const leftOrder = THEME_ACCENT_CLUSTER_ORDER[left.cluster] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = THEME_ACCENT_CLUSTER_ORDER[right.cluster] ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.label.localeCompare(right.label);
    })
    .map((theme) => ({ value: theme.value, label: theme.label }))
);
let popupNavigationInspectionOverlayStarted = false;
let popupNavigationInspectionOverlayTabId: number | null = null;
const popupNavigationInspectionSettlePollByTabId = new Map<number, ReturnType<Window["setTimeout"]>>();
const popupRenderModeSetNavGuardByTabId = new Map<number, RenderModeSetNavGuardState>();
let popupStaleInspectionBusyClearTimer = 0;
let popupBackgroundLifecycle: PopupStateGetReply["lifecycle"] = null;
let popupBackgroundStateTabId: number | null = null;
let popupBackgroundActivation: ActivationSnapshot | null = null;
let popupBackgroundSessionPhase: PopupStateGetReply["sessionPhase"] = null;
let popupBackgroundSessionDictation: SessionDictation | null = null;
let popupBackgroundPropertyLockView: PopupStateGetReply["propertyLockView"] = null;
let popupBackgroundPropertyLockTimer: PopupStateGetReply["propertyLockTimer"] = null;
let popupBackgroundSecondaryGates: PopupStateGetReply["secondaryGates"] = null;
let activePopupBusClient: PopupBusClient | null = null;
let latestSessionFactsPatch: SessionFactsPatch = {};
let pendingAiPreviewConfigSync: { tabId: number; baseUrl: string } | null = null;
let propertyPageTypesRequest: PendingPropertyPageTypesRequest = null;
let pageTypesRefreshRunner: (() => void) | null = null;
let viewPushedRefreshInFlight = false;
let clearedReloadRestoreForTabId: number | null = null;
let projectedTabState: { enabled: boolean; baseUrl: string; pageType: string } | null = null;
let projectedSiteId: number | null = null;
// Monotonic per-popup-session sequence stamped on each full refreshUiInner facts
// report. refreshUi does not serialize, so overlapping runs can publish
// SessionFacts out of order; the brain uses this to drop stale/duplicate popup
// reports so a stale run cannot be the last writer. Resets to 0 each popup load,
// so the brain resets its per-tab high-water mark when the popup (re)connects.
let popupSessionFactsSeq = 0;
function nextPopupSessionFactsSeq(): number {
  popupSessionFactsSeq += 1;
  return popupSessionFactsSeq;
}


function isEditableTarget(el: EventTarget | null | undefined): boolean {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

function normalizeSpinnerReason(reason?: string, key?: string | null, message?: string): string {
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  if (typeof key === "string" && key.trim()) {
    return `spinner:${key.trim()}`;
  }
  if (typeof message === "string" && message.trim()) {
    return `message:${message.trim()}`;
  }
  return "popup-spinner";
}

// P4 step 4.3: the popup holds NO local spinner state. The brain's broadcast
// (rendered via the projected snapshot + machine memories) is the popup's
// sole spinner surface; the navigation-inspection engagement is observed from
// it with the same vocabulary the brain uses to select it.
function hasProjectedNavigationInspectionSpinner(): boolean {
  const spinnerState = getLatestPopupSpinnerState("popup");
  return Boolean(
    spinnerState &&
      (spinnerState.spinnerKey === SPINNER_KEYS.NAV_INSPECT ||
        (spinnerState.kind === SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP &&
          spinnerState.phase === SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION))
  );
}

type PopupSpinnerLeaseOptions = {
  delayMs?: number;
  persistent?: boolean;
  source?: string;
  reason?: string;
  suppressIfActive?: boolean;
};

// P4 step 4.3: popup operations request a spinner LEASE from the background
// broker (brain store -> broadcast) and release it when the task settles; the
// old popup-local entry map, watchdogs, and direct-render plumbing are gone.
// A lease whose reason resolves no phase definition in the shared contract
// never renders (the projection admission drops it) but still traces through
// the broker.
async function runWithBrainSpinnerLease<T>(
  key: string | null,
  message: string,
  task: (spinnerKey: string | null) => Promise<T>,
  options: PopupSpinnerLeaseOptions = {}
): Promise<T> {
  const tabId = getCurrentPopupTabId();
  const suppressed = Boolean(options.suppressIfActive && getLatestPopupSpinnerState("popup"));
  if (!tabId || suppressed) {
    return await task(null);
  }
  const leaseKey = key || `${options.reason || "popup-operation"}:${Date.now()}`;
  let leaseRequested = false;
  let delayTimer = 0;
  const requestLease = () => {
    leaseRequested = true;
    void sendSpinnerBrokerMessage({
      type: SPINNER_REQUEST_TYPES.SET,
      key: leaseKey,
      message,
      persistent: Boolean(options.persistent),
      reason: normalizeSpinnerReason(options.reason, leaseKey, message),
      source: typeof options.source === "string" && options.source.trim()
        ? options.source.trim()
        : "popup-spinner",
      startedAt: Date.now()
    });
  };
  const delayMs = Math.max(0, Math.trunc(Number(options.delayMs) || 0));
  if (delayMs > 0) {
    delayTimer = window.setTimeout(requestLease, delayMs);
  } else {
    requestLease();
  }
  try {
    return await task(leaseKey);
  } finally {
    if (delayTimer) {
      window.clearTimeout(delayTimer);
    }
    if (leaseRequested) {
      void removeSpinnerEntryFromBackground(leaseKey, tabId);
    }
  }
}

function getSiteResolutionDeps(): SiteResolutionDeps {
  return {
    PopupText,
    ViewText,
    showToast: (message) => {
      uiModule.showToast(message);
    },
    propertyPageTypesRefreshIntervalMs: PROPERTY_PAGE_TYPES_REFRESH_INTERVAL_MS,
    getPropertyPageTypesRequest: () => propertyPageTypesRequest,
    setPropertyPageTypesRequest: (nextRequest) => {
      propertyPageTypesRequest = nextRequest;
    }
  };
}

const ensurePropertyPageTypes = (options = {}) =>
  ensurePropertyPageTypesOperation(getSiteResolutionDeps(), options);
const resolveSiteIdFromGraphql = (options = {}) =>
  resolveSiteIdFromGraphqlOperation(getSiteResolutionDeps(), options);
const ensureBaseUrlSiteId = (options = {}) =>
  ensureBaseUrlSiteIdOperation(getSiteResolutionDeps(), options);

function getRemoteConfigDeps(): RemoteConfigDeps {
  return {
    PopupText,
    remoteConfigRetryDelayMs: REMOTE_CONFIG_RETRY_DELAY_MS,
    windowRef: window,
    ensureActiveTab: () => helpers.ensureActiveTab(),
    refreshUi: (options) => refreshUi(typeof options === "object" && options ? options : {}),
    resolveRelativeEndpoint,
    updateLastConfigLoadStatus,
    invalidateTokenAndLockConfiguration,
    showToast: (message) => {
      uiModule.showToast(message);
    },
    ensureBaseUrlSiteId: (options) => ensureBaseUrlSiteId(options),
    getStoredGlobalToken: (options) => getStoredGlobalToken(options),
    ensurePropertyPageTypes: (options) => ensurePropertyPageTypes(options),
    collectStoredPageMarkingItems,
    buildLynxChecklistViewModel,
    buildPageMarkingKey,
    buildTransferPayloadKey,
    putTransferPayload,
    waitForRetryDelay,
    isRetryableHttpStatus,
    pruneRemoteInvalidPageMarkings
  };
}

const scheduleRemoteConfigRetry = () =>
  scheduleRemoteConfigRetryOperation(getRemoteConfigDeps());
const loadRemoteConfigForCurrentPage = (
  options: Parameters<typeof loadRemoteConfigForCurrentPageOperation>[1] = {}
) =>
  loadRemoteConfigForCurrentPageOperation(getRemoteConfigDeps(), options);
const syncBaseConfigToServer = (
  options: Parameters<typeof syncBaseConfigToServerOperation>[1] = {}
) =>
  syncBaseConfigToServerOperation(getRemoteConfigDeps(), options);

function getRenderModeInspectionDeps(): RenderModeInspectionDeps {
  return {
    state,
    config,
    PopupText,
    RENDER_MODE_DETECTION_MAX_ATTEMPTS,
    RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY,
    RENDER_MODE_INSPECTION_START_TIMEOUT_MS,
    RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS,
    RENDER_MODE_UNDETERMINED,
    windowRef: window,
    browserRef: browser,
    messages,
    shouldAutoDetectRenderMode,
    getCurrentRenderModeInspectionSnapshot,
    getSuggestedRenderModeForPage,
    markRenderModeUndetermined,
    loadGlobalAiSettings: () => helpers.loadGlobalAiSettings(),
    runWithSpinner: runWithBrainSpinnerLease,
    buildTransferPayloadKey,
    putTransferPayload,
    waitForRetryDelay,
    getRetryDelayMs,
    isRetryableHttpStatus,
    ensureContentReadyForRenderModeInspection,
    rememberRenderModeInspectionSnapshot,
    hideConsentForRenderModeInspection,
    captureRenderModeInspectionHtml: (tabId: number, baseUrl: string, operationId: string) =>
      requestPopupRenderModeCaptureHtml(tabId, { baseUrl, operationId }),
    reconcilePropertyLockAfterRenderModeReload,
    scheduleStaleInspectionBusyClear
  };
}

const maybeAutoDetectRenderMode = (
  pageUrl: Parameters<typeof maybeAutoDetectRenderModeOperation>[1]
) =>
  maybeAutoDetectRenderModeOperation(getRenderModeInspectionDeps(), pageUrl);

function getPageReconciliationDeps(): PageReconciliationDeps {
  return {
    PopupText,
    PAGE_SAVE_SYNC_MAX_ATTEMPTS,
    PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS,
    PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS,
    windowRef: window,
    hasCurrentPageMarkingChanges,
    ensureActiveTab: (options) => helpers.ensureActiveTab(options),
    ensureBaseUrl: () => helpers.ensureBaseUrl(),
    refreshCurrentPageRuntimeStatus: (options) => refreshCurrentPageRuntimeStatus(options),
    showToast: (message) => {
      uiModule.showToast(message);
    },
    getViewState: () => uiModule.getViewState(),
    updateLastConfigSaveStatus,
    validateStoredToken,
    runWithSpinner: runWithBrainSpinnerLease,
    getCurrentPageUrl,
    loadGlobalAiSettings: () => helpers.loadGlobalAiSettings(),
    syncBaseConfigToServer: (options) => syncBaseConfigToServer(options),
    clearCurrentPageSaveReconciliation,
    clearSelectorsPendingConfigSync,
    resetAiRunMarkingsFingerprint,
    applyPostSaveSilentTransition,
    refreshUi: (options) => refreshUi(options),
    setUiBusy: (busy, message, details) => {
      uiModule.setUiBusy(busy, message, details);
    },
    waitForRetryDelay,
    applyLocalPageDiscard
  };
}

const hasCurrentPagePendingChanges = (
  localPageMarkings: Parameters<typeof hasCurrentPagePendingChangesOperation>[1],
  backendSavedPageMarkings: Parameters<typeof hasCurrentPagePendingChangesOperation>[2],
  options: Parameters<typeof hasCurrentPagePendingChangesOperation>[3] = {}
) =>
  hasCurrentPagePendingChangesOperation(
    getPageReconciliationDeps(),
    localPageMarkings,
    backendSavedPageMarkings,
    options
  );

const handlePageSave = () => handlePageSaveOperation(getPageReconciliationDeps());
const handlePageRevert = () => handlePageRevertOperation(getPageReconciliationDeps());

// P4 step 4.2: the brain broadcast carries {kind, phase} + timing only; the
// popup resolves presentation from the shared phase-definition table here.
// Machine-owned states keep overriding the resolved content downstream (the
// P2 curtain/surface memory apply), so the definition is the fallback layer.
function resolveProjectedSpinnerDefinition(spinnerState: PopupSpinnerState | null) {
  if (!spinnerState || typeof spinnerState !== "object") {
    return null;
  }
  return getSpinnerPhaseDefinition(spinnerState.kind, spinnerState.phase);
}

function projectedSpinnerStateBlocksSurface(
  spinnerState: PopupSpinnerState | null,
  surface: PopupSpinnerSurface
) {
  const definition = resolveProjectedSpinnerDefinition(spinnerState);
  return Boolean(definition && definition.blockSurfaces[surface] === true);
}

function projectedSpinnerStateToSnapshot(spinnerState: PopupSpinnerState | null): PopupSpinnerSnapshot {
  if (!spinnerState || typeof spinnerState !== "object") {
    return null;
  }
  const definition = resolveProjectedSpinnerDefinition(spinnerState);
  if (!definition) {
    return null;
  }
  return {
    key: typeof spinnerState.spinnerKey === "string" ? spinnerState.spinnerKey : "",
    entry: {
      blockSurfaces: {
        page: definition.blockSurfaces.page === true,
        popup: definition.blockSurfaces.popup === true
      },
      deadlineAt: Number.isFinite(spinnerState.deadlineAt) ? Number(spinnerState.deadlineAt) : 0,
      message: definition.title,
      maxDurationMs: definition.maxDurationMs,
      operationId: typeof spinnerState.operationId === "string" ? spinnerState.operationId : "",
      operationKind: definition.kind,
      operationPhase: definition.phase,
      reason: typeof spinnerState.reason === "string" ? spinnerState.reason : "",
      source: "brain-broadcast",
      startedAt: Number.isFinite(spinnerState.startedAt) ? Number(spinnerState.startedAt) : 0,
      timerMode: definition.timerMode
    }
  };
}

// P5 (refresh reduction): the SINGLE builder for the busy-overlay view
// fields (spinner broadcast + background lifecycle + retry/inspection aux
// flags + the popup-local run countdown). refreshUiInner assigns it during a
// full pass; the spinner SET/CLEAR handler applies it as a TARGETED patch —
// spinner churn no longer re-runs the whole refresh.
type ProjectedBusyAuxFlags = {
  pageInspectionBusy: boolean;
  remoteConfigRetryBlocked: boolean;
};
let lastProjectedBusyAuxFlags: ProjectedBusyAuxFlags = {
  pageInspectionBusy: false,
  remoteConfigRetryBlocked: false
};

function buildProjectedBusyViewState(): PopupViewStatePatch {
  const { pageInspectionBusy, remoteConfigRetryBlocked } = lastProjectedBusyAuxFlags;
  const popupSpinnerSnapshot = getActiveSpinnerSnapshotForSurface("popup");
  const popupBusyActive = Boolean(popupSpinnerSnapshot);
  const backgroundLifecycleBusy = Boolean(popupBackgroundLifecycle && popupBackgroundLifecycle.busy);
  const projectedAiRunCountdownVisible = Boolean(
    popupBusyActive &&
      popupSpinnerSnapshot?.entry?.operationKind === "ai-run" &&
      popupSpinnerSnapshot?.entry?.timerMode === "countdown"
  );
  const projectedAiRunDeadlineAt = projectedAiRunCountdownVisible &&
      Number.isFinite(popupSpinnerSnapshot?.entry?.deadlineAt)
    ? Number(popupSpinnerSnapshot?.entry?.deadlineAt)
    : 0;
  const aiRunCountdownDeadlineAt = projectedAiRunDeadlineAt > 0
    ? projectedAiRunDeadlineAt
    : state.aiRequestInFlight === "compute"
      ? state.aiRunDeadlineAt
      : 0;
  const aiRunCountdownVisible =
    projectedAiRunCountdownVisible ||
    (state.aiRequestInFlight === "compute" && state.aiRunDeadlineAt > 0);
  return {
    saveExcludesButtonLoading: state.aiRequestInFlight === "save",
    aiRunSpinnerNote: state.aiRequestInFlight === "compute"
      ? PopupText.overlay.computingSelectorsNote
      : "",
    aiRunCountdownVisible,
    aiRunCountdownText: aiRunCountdownVisible
      ? formatAiRunCountdown(getAiRunRemainingMs(aiRunCountdownDeadlineAt))
      : "0:00",
    aiRunDeadlineAt: aiRunCountdownDeadlineAt,
    aiRunPhase: state.aiRequestInFlight === "compute" ? state.aiRunPhase : "",
    isBusy: popupBusyActive || backgroundLifecycleBusy || remoteConfigRetryBlocked || pageInspectionBusy,
    busyMessage: popupBusyActive
      ? (popupSpinnerSnapshot?.entry?.message || "")
      : backgroundLifecycleBusy
        ? (popupBackgroundLifecycle?.message || PopupText.overlay.pleaseWait)
        : remoteConfigRetryBlocked
          ? PopupText.status.remoteServerRetryNotice
          : pageInspectionBusy
            ? PopupText.overlay.pageInspection
            : "",
    busyReason: popupBusyActive
      ? normalizeSpinnerReason(popupSpinnerSnapshot?.entry?.reason, popupSpinnerSnapshot?.key, popupSpinnerSnapshot?.entry?.message)
      : backgroundLifecycleBusy
        ? normalizeSpinnerReason(
            popupBackgroundLifecycle?.reason,
            popupBackgroundLifecycle?.kind || "lifecycle",
            popupBackgroundLifecycle?.message
          )
        : remoteConfigRetryBlocked
          ? "page-save-remote-config-retry"
          : pageInspectionBusy
            ? "page-inspection-pending"
            : "",
    busySource: popupBusyActive
      ? (popupSpinnerSnapshot?.entry?.source || "popup-spinner")
      : backgroundLifecycleBusy
        ? "background-lifecycle"
        : remoteConfigRetryBlocked
          ? "popup-page-save"
          : pageInspectionBusy
            ? "popup-runtime-status"
            : "",
    busySpinnerKey: popupBusyActive ? (popupSpinnerSnapshot?.key || "") : "",
    busyOperationKind: popupBusyActive
      ? (popupSpinnerSnapshot?.entry?.operationKind || "")
      : backgroundLifecycleBusy
        ? (popupBackgroundLifecycle?.operationKind || popupBackgroundLifecycle?.kind || "")
        : "",
    busyOperationPhase: popupBusyActive
      ? (popupSpinnerSnapshot?.entry?.operationPhase || "")
      : backgroundLifecycleBusy
        ? (popupBackgroundLifecycle?.operationPhase || popupBackgroundLifecycle?.phase || "")
        : "",
    busyStartedAt: popupBusyActive
      ? (Number.isFinite(popupSpinnerSnapshot?.entry?.startedAt) ? Number(popupSpinnerSnapshot?.entry?.startedAt) : 0)
      : backgroundLifecycleBusy
        ? (Number.isFinite(popupBackgroundLifecycle?.startedAt) ? Number(popupBackgroundLifecycle?.startedAt) : 0)
        : 0,
    busyDeadlineAt: popupBusyActive
      ? (Number.isFinite(popupSpinnerSnapshot?.entry?.deadlineAt) ? Number(popupSpinnerSnapshot?.entry?.deadlineAt) : 0)
      : backgroundLifecycleBusy
        ? (Number.isFinite(popupBackgroundLifecycle?.deadlineAt) ? Number(popupBackgroundLifecycle?.deadlineAt) : 0)
        : 0,
    busyTimerMode: popupBusyActive
      ? (popupSpinnerSnapshot?.entry?.timerMode || "")
      : backgroundLifecycleBusy
        ? (popupBackgroundLifecycle?.timerMode || "")
        : ""
  };
}

function getProjectedPopupBlockingSpinnerState() {
  const popupSpinnerState = getLatestPopupSpinnerState("popup");
  return projectedSpinnerStateBlocksSurface(popupSpinnerState, "popup")
    ? popupSpinnerState
    : null;
}

function getActiveSpinnerSnapshotForSurface(surface: "popup" | "page") {
  if (surface === "page") {
    const pageCurtainSpinnerState = getLatestPopupSpinnerState("pageCurtain");
    if (projectedSpinnerStateBlocksSurface(pageCurtainSpinnerState, "page")) {
      return projectedSpinnerStateToSnapshot(pageCurtainSpinnerState);
    }
    return null;
  }
  return projectedSpinnerStateToSnapshot(getProjectedPopupBlockingSpinnerState());
}

function clearProjectedPopupSpinnerSurfaces(): void {
  clearPopupSpinnerSurface("popup");
  clearPopupSpinnerSurface("pageCurtain");
  clearPopupSpinnerSurface("banner");
}

function isPopupSpinnerDebugEnabled() {
  if (isDebugFlagEnabled("ufDebugSpinnerQueue")) {
    return true;
  }
  try {
    return Boolean(window && window.localStorage && window.localStorage.getItem("ufDebugSpinnerQueue") === "1");
  } catch {
    return false;
  }
}

function logPopupSpinnerDebug(eventName: string, details: Record<string, unknown> = {}) {
  if (!isPopupSpinnerDebugEnabled()) {
    return;
  }
  try {
    console.debug("[popup-spinner]", eventName, {
      navOverlayStarted: popupNavigationInspectionOverlayStarted,
      navOverlayTabId: popupNavigationInspectionOverlayTabId,
      ...details
    });
  } catch {
    // Debug logging must never break popup behavior.
  }
}

function getCurrentPopupTabId(): number | null {
  return state.currentTab && Number.isFinite(state.currentTab.id)
    ? Math.trunc(Number(state.currentTab.id))
    : null;
}

function isWorldTraceEnabled() {
  return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
}

function logWorldTrace(eventName: string, details: Record<string, unknown> = {}) {
  if (!isWorldTraceEnabled()) {
    return;
  }
  try {
    console.debug("[world-trace][popup]", eventName, details);
  } catch {
    // Trace logging must never break popup behavior.
  }
}

const popupBusSelfTestedTabIds = new Set<number>();

function maybeRunPopupBusSelfTest(tabId: number | null, bus: PopupBusClient | null) {
  if (!isWorldTraceEnabled() || !tabId || !bus || popupBusSelfTestedTabIds.has(tabId)) {
    return;
  }
  popupBusSelfTestedTabIds.add(tabId);
  void runPopupBusSelfTest(bus, tabId, logWorldTrace);
}

function applyBackgroundStateSnapshot(snapshot: PopupBackgroundStateSnapshot | null | undefined): void {
  if (!snapshot || !snapshot.ok) {
    return;
  }
  const tabId = getCurrentPopupTabId();
  if (tabId && snapshot.tabId && Math.trunc(snapshot.tabId) !== tabId) {
    return;
  }
  popupBackgroundLifecycle = snapshot.lifecycle || null;
  popupBackgroundStateTabId = tabId;
  popupBackgroundActivation = snapshot.activation || null;
  popupBackgroundSessionPhase = snapshot.sessionPhase || null;
  popupBackgroundSessionDictation = snapshot.sessionDictation || null;
  popupBackgroundPropertyLockView = snapshot.propertyLockView || null;
  popupBackgroundPropertyLockTimer = snapshot.propertyLockTimer || null;
  popupBackgroundSecondaryGates = snapshot.secondaryGates || null;
  const traceDiagnosticsEnabled = isFeatureEnabled("traceDiagnostics");
  state.traceModeEnabled = traceDiagnosticsEnabled && Boolean(snapshot.traceEnabled);
  state.traceEvents = traceDiagnosticsEnabled && Array.isArray(snapshot.traceEvents) ? [...snapshot.traceEvents] : [];
  const activationBootstrapPending = Boolean(
    snapshot.activation &&
      snapshot.activation.bootstrapStatus === "bootstrapping"
  );
  popupNavigationInspectionOverlayStarted =
    hasProjectedNavigationInspectionSpinner() || activationBootstrapPending;
  popupNavigationInspectionOverlayTabId = popupNavigationInspectionOverlayStarted ? tabId : null;
  logWorldTrace("background-state", {
    tabId,
    traceEnabled: Boolean(snapshot.traceEnabled),
    lifecycleKind: popupBackgroundLifecycle && popupBackgroundLifecycle.kind,
    lifecyclePhase: popupBackgroundLifecycle && popupBackgroundLifecycle.phase,
    activationBootstrapStatus: popupBackgroundActivation && popupBackgroundActivation.bootstrapStatus,
    sessionPhase: popupBackgroundSessionPhase,
    traceEvents: Array.isArray(snapshot.traceEvents) ? snapshot.traceEvents.length : 0
  });
}

function applyPopupViewSnapshot(snapshot: PopupStateGetReply | null) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const currentTabId = getCurrentPopupTabId();
  // REFLEX-ARC Phase 1: piggyback the throttled signal-cursor pull on brain
  // projections (the correctness path behind the best-effort push).
  maybePullSignals(currentTabId);
  const hadProjectedSessionDictation = hasProjectedCentralSessionDictationForTab(currentTabId);
  const hadProjectedPropertyLockView = hasProjectedPropertyLockViewForTab(currentTabId);
  const hadProjectedSecondaryGates = Boolean(
    currentTabId &&
      popupBackgroundStateTabId === currentTabId &&
      popupBackgroundSecondaryGates
  );
  applyBackgroundStateSnapshot({
    ok: true,
    tabId: snapshot.tabId,
    lifecycle: snapshot.lifecycle || null,
    activation: snapshot.activation || null,
    sessionPhase: snapshot.sessionPhase || null,
    sessionDictation: snapshot.sessionDictation || null,
    propertyLockView: snapshot.propertyLockView || null,
    propertyLockTimer: snapshot.propertyLockTimer || null,
    secondaryGates: snapshot.secondaryGates || null,
    traceEnabled: Boolean(snapshot.traceEnabled),
    traceEvents: Array.isArray(snapshot.traceEvents) ? snapshot.traceEvents : []
  });
  projectedTabState = snapshot.tabState || null;
  projectedSiteId = typeof snapshot.siteId === "number" ? snapshot.siteId : null;
  tracePopupApplyView(snapshot.tabId, Boolean(projectedTabState), Boolean(projectedSiteId));
  const nextCentralSessionDictationEffect = deriveCentralSessionDictationSnapshotEffect({
    currentTabId,
    projectedTabId: popupBackgroundStateTabId,
    sessionPhase: popupBackgroundSessionPhase || null,
    sessionDictation: popupBackgroundSessionDictation,
    hadProjectedSessionDictation
  });
  const nextProjectedPropertyLockEffect = deriveProjectedPropertyLockSnapshotEffect({
    featureEnabled: isPropertyLockCollaborationEnabled(),
    currentTabId,
    projectedTabId: popupBackgroundStateTabId,
    propertyLockView: popupBackgroundPropertyLockView || null,
    hadProjectedPropertyLockView
  });
  const nextProjectedSecondaryGatesEffect = deriveProjectedSecondaryGatesSnapshotEffect({
    currentTabId,
    projectedTabId: popupBackgroundStateTabId,
    secondaryGates: popupBackgroundSecondaryGates || null,
    hadProjectedSecondaryGates: Boolean(hadProjectedSecondaryGates)
  });
  if (
    nextCentralSessionDictationEffect.patch ||
    nextProjectedPropertyLockEffect.patch ||
    nextProjectedSecondaryGatesEffect.patch
  ) {
    const snapshotPatch: PopupViewStatePatch = {
      ...(nextCentralSessionDictationEffect.patch || {}),
      ...(nextProjectedPropertyLockEffect.patch || {}),
      ...(nextProjectedSecondaryGatesEffect.patch || {})
    };
    overrideDictatedPreviewVisibility(snapshotPatch);
    overrideDictatedMarkingButtons(snapshotPatch);
    uiModule.setViewState(snapshotPatch);
  }
  if (
    nextCentralSessionDictationEffect.refreshRequired ||
    nextProjectedPropertyLockEffect.refreshRequired ||
    nextProjectedSecondaryGatesEffect.refreshRequired
  ) {
    // Re-entry guard only: prevent concurrent view-pushed refreshes.
    // The cooldown was removed because refreshUi now reads tabState/siteId
    // from the brain projection instead of querying the background, so the
    // feedback loop (VIEW_UPDATED → refreshUi → messages → VIEW_UPDATED)
    // no longer exists.
    if (viewPushedRefreshInFlight) {
      return;
    }
    viewPushedRefreshInFlight = true;
    void refreshUi({
      useBusyOverlay: false,
      skipPropertyLockFetch: true,
      preserveCurrentDraftStatus: true
    }).catch(() => null).finally(() => {
      viewPushedRefreshInFlight = false;
    });
    return;
  }
}

function publishCurrentSessionFacts(tabId: number, facts: SessionFactsPatch, seq?: number): void {
  latestSessionFactsPatch = { ...latestSessionFactsPatch, ...facts };
  publishPopupSessionFacts(tabId, facts, seq).catch(() => null);
}

function buildCurrentPropertyLockSnapshot(): PropertyLockSnapshot {
  const propertyLockState = state.propertyLockState;
  return {
    siteId: Number.isFinite(state.propertyLockSiteId) ? Math.trunc(Number(state.propertyLockSiteId)) : null,
    connectionStatus: typeof state.propertyLockConnectionStatus === "string"
      ? state.propertyLockConnectionStatus
      : "",
    secondsRemaining: Number.isFinite(state.propertyLockSecondsRemaining)
      ? Math.max(0, Math.trunc(Number(state.propertyLockSecondsRemaining)))
      : null,
    suggestionFromName: typeof state.propertyLockSuggestionFromName === "string"
      ? state.propertyLockSuggestionFromName
      : "",
    suggestionVisible: state.propertyLockSuggestionVisible === true,
    suggestionPending: state.propertyLockSuggestionPending === true,
    suggestionRejected: state.propertyLockSuggestionRejected === true,
    inactivityWarningVisible: state.propertyLockInactivityWarningVisible === true,
    disconnectCountdown: Number.isFinite(state.propertyLockDisconnectCountdown)
      ? Math.max(0, Math.trunc(Number(state.propertyLockDisconnectCountdown)))
      : null,
    transferCountdown: Number.isFinite(state.propertyLockTransferCountdown)
      ? Math.max(0, Math.trunc(Number(state.propertyLockTransferCountdown)))
      : null,
    offCandidateDeadlineAt: Number.isFinite(state.propertyLockOffCandidateDeadlineAt)
      ? Math.max(0, Math.trunc(Number(state.propertyLockOffCandidateDeadlineAt)))
      : 0,
    recoveryDeadlineAt: Number.isFinite(state.propertyLockRecoveryDeadlineAt)
      ? Math.max(0, Math.trunc(Number(state.propertyLockRecoveryDeadlineAt)))
      : 0,
    renderModeInspectionActive: state.renderModeInspectionActive === true,
    lockState: propertyLockState && typeof propertyLockState === "object"
      ? {
        state: typeof propertyLockState.state === "string" ? propertyLockState.state : "",
        editorName: typeof propertyLockState.editorName === "string" ? propertyLockState.editorName : "",
        isEditor: propertyLockState.isEditor === true,
        isRecentEditor: propertyLockState.isRecentEditor === true,
        isSameUserEditor: propertyLockState.isSameUserEditor === true,
        otherTabHasUnsavedChanges: propertyLockState.otherTabHasUnsavedChanges === true,
        transferFromName: typeof propertyLockState.transferFromName === "string" ? propertyLockState.transferFromName : "",
        transferToName: typeof propertyLockState.transferToName === "string" ? propertyLockState.transferToName : "",
      }
      : null
  };
}

function publishCurrentPropertyLockSnapshot(tabId: number): void {
  publishPopupPropertyLockSnapshot(tabId, buildCurrentPropertyLockSnapshot()).catch(() => null);
}

function publishCurrentTabPropertyLockSnapshot(): void {
  const currentTabId = getCurrentPopupTabId();
  if (!currentTabId) {
    return;
  }
  publishCurrentPropertyLockSnapshot(currentTabId);
}

function publishCurrentTabSessionFacts(facts: SessionFactsPatch): void {
  const currentTabId = getCurrentPopupTabId();
  if (!currentTabId) {
    return;
  }
  publishCurrentSessionFacts(currentTabId, facts);
}

function publishCurrentTabAiRunEvent(
  eventType: AiRunEventType,
  payload: AiRunEventPayload = {},
): void {
  const currentTabId = getCurrentPopupTabId();
  if (!currentTabId) {
    return;
  }
  publishPopupAiRunEvent(currentTabId, eventType, payload).catch(() => null);
}

function shouldReportManualAiPreviewEvent(): boolean {
  return Boolean(
    state.sessionAiRunPhase === AI_RUN_PHASES.POST_AI ||
      popupBackgroundSessionPhase === SESSION_PHASES.READY_TO_SAVE ||
      popupBackgroundSessionPhase === SESSION_PHASES.PREVIEW_OPEN
  );
}

function publishManualAiPreviewEvent(eventType: AiRunEventType, payload: AiRunEventPayload = {}): void {
  if (!shouldReportManualAiPreviewEvent()) {
    return;
  }
  publishCurrentTabAiRunEvent(eventType, payload);
}

function hasProjectedCentralSessionDictationForTab(tabId: number | null): boolean {
  return hasProjectedCentralSessionDictationForTabOperation({
    currentTabId: tabId,
    projectedTabId: popupBackgroundStateTabId,
    sessionPhase: popupBackgroundSessionPhase || null,
    sessionDictation: popupBackgroundSessionDictation
  });
}

function hasProjectedPropertyLockViewForTab(tabId: number | null): boolean {
  return hasProjectedPropertyLockViewForTabOperation({
    featureEnabled: isPropertyLockCollaborationEnabled(),
    currentTabId: tabId,
    projectedTabId: popupBackgroundStateTabId,
    propertyLockView: popupBackgroundPropertyLockView || null
  });
}

function hasProjectedPropertyLockDeadlineTimerForTab(tabId: number | null): boolean {
  return Boolean(
    hasProjectedPropertyLockViewForTab(tabId) &&
      popupBackgroundPropertyLockTimer &&
      popupBackgroundPropertyLockTimer.source === PROPERTY_LOCK_TIMER_SOURCES.DEADLINE &&
      Number.isFinite(popupBackgroundPropertyLockTimer.deadlineAt) &&
      popupBackgroundPropertyLockTimer.deadlineAt > Date.now()
  );
}

function setPropertyLockViewStateFromLocalProjection(): void {
  uiModule.setViewState(buildPropertyLockViewState());
  publishCurrentTabPropertyLockSnapshot();
}

async function refreshUiForActionGates(): Promise<PopupViewState> {
  await refreshUi({
    useBusyOverlay: false,
    skipPropertyLockFetch: true,
    preserveCurrentDraftStatus: true
  });
  const currentTabId = getCurrentPopupTabId();
  if (currentTabId && activePopupBusClient) {
    const appliedFacts = await requestPopupSessionFactsApply(
      activePopupBusClient,
      currentTabId,
      latestSessionFactsPatch,
    );
    if (appliedFacts && appliedFacts.ok && appliedFacts.tabId === currentTabId && appliedFacts.secondaryGates) {
      popupBackgroundStateTabId = currentTabId;
      popupBackgroundSecondaryGates = appliedFacts.secondaryGates;
      uiModule.setViewState(resolveSecondaryGatesViewStatePatch({
        currentTabId,
        projectedTabId: popupBackgroundStateTabId,
        secondaryGates: popupBackgroundSecondaryGates,
      }));
      return uiModule.getViewState();
    }
  }
  uiModule.setViewState(NEUTRAL_SECONDARY_GATES_VIEW_PATCH);
  return uiModule.getViewState();
}

function clearProjectedComputingAiState(): boolean {
  if (popupBackgroundSessionPhase !== "computing_ai") {
    return false;
  }
  popupBackgroundSessionPhase = null;
  popupBackgroundSessionDictation = null;
  return true;
}

async function clearStaleProjectedComputingAiState(): Promise<void> {
  if (!clearProjectedComputingAiState()) {
    return;
  }
  publishCurrentTabSessionFacts({
    aiBusy: false,
    aiComputing: false,
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: ""
  });
  await refreshUi({
    useBusyOverlay: false,
    preserveCurrentDraftStatus: true
  }).catch(() => null);
}

// The popup owns its own preview-sidebar visibility via previewOpenIntent (see
// src/popup/state.ts). The brain also projects previewActive/previewBlocked into
// the central-session dictation, folded from popup+content reports that race
// during hydration — applying it verbatim flaps the sidebar open/closed. When
// the popup has a standing opinion (intent set, or an exit in flight) its value
// wins; otherwise (closed / reconnect) the brain-projected value is kept.
function overrideDictatedPreviewVisibility(patch: PopupViewStatePatch): void {
  if (!Object.prototype.hasOwnProperty.call(patch, "previewActive")) {
    return;
  }
  let active: boolean | null = null;
  if (state.previewRestorePending) {
    active = false;
  } else if (state.previewOpenIntent) {
    active = true;
  } else if (state.previewSuppressReopen) {
    // Closed by the popup with no new open intent: the brain's folded
    // projection can still carry stale previewActive:true (content's async
    // exit + heartbeat refolds lag for seconds on heavy pages). Applying it
    // verbatim reopened the sidebar after Exit (#5/#14). Hold closed until the
    // popup itself opens the next preview.
    active = false;
  }
  if (active === null) {
    return;
  }
  patch.previewActive = active;
  patch.previewBlocked = active;
  patch.previewBlockedMessage = active ? PopupText.preview.blockedActive : ViewText.previewBlockedDefault;
}

// REFLEX-ARC session machine (see src/popup/marking-session-machine.ts): the
// popup holds ONE current marking-session state; DISCRETE signals (run
// started, post-AI preview opened, exit clicked/settled, markings changed,
// saved, discarded, toggle, navigation) move it through a predefined
// transition table, and each state's complete button matrix is applied FROM
// MEMORY. Facts, heartbeats, and dictation churn are not signals — they can
// never move the machine, so they can never flicker the surface or strand it
// in a wrong end state.
function signalMarkingSession(signal: MarkingSessionSignal): void {
  const from: { state: MarkingSessionMachineState; priorState: MarkingSessionMachineState | null } = {
    state: state.markingSessionMachineState as MarkingSessionMachineState,
    priorState: (state.markingSessionPriorState || null) as MarkingSessionMachineState | null
  };
  const step = stepMarkingSession(from, signal);
  if (step.moved) {
    state.markingSessionMachineState = step.machine.state;
    state.markingSessionPriorState = step.machine.priorState ?? "";
    logWorldTrace("marking-session:transition", {
      from: from.state,
      signal,
      to: step.machine.state,
      prior: step.machine.priorState ?? ""
    });
    syncMarkingSessionOverlayFailOpen();
  } else {
    logWorldTrace("marking-session:signal-held", { state: from.state, signal });
  }
}

// Overlay fail-open (see MARKING_SESSION_OVERLAY_FAIL_OPEN_MS): the timer arms
// when the machine ENTERS an overlay (inspecting/reconciling) and disarms when
// it leaves. If the deadline fires while still overlaid, the machine steps
// itself with "overlay-timeout" (return to prior) and repaints — an upstream
// wedge that never delivers the matching -ended cannot strand the popup
// behind the overlay curtain. Switching overlays does NOT re-arm: the
// deadline bounds total continuous curtain time.
let markingSessionOverlayFailOpenTimer: ReturnType<typeof setTimeout> | null = null;
let markingSessionOverlayFailOpenToken = 0;

function isMarkingSessionOverlaid(): boolean {
  return (
    state.markingSessionMachineState === "inspecting" ||
    state.markingSessionMachineState === "reconciling"
  );
}

function syncMarkingSessionOverlayFailOpen(): void {
  if (!isMarkingSessionOverlaid()) {
    markingSessionOverlayFailOpenToken += 1;
    if (markingSessionOverlayFailOpenTimer) {
      clearTimeout(markingSessionOverlayFailOpenTimer);
      markingSessionOverlayFailOpenTimer = null;
    }
    return;
  }
  if (markingSessionOverlayFailOpenTimer) {
    return;
  }
  const token = ++markingSessionOverlayFailOpenToken;
  markingSessionOverlayFailOpenTimer = setTimeout(() => {
    markingSessionOverlayFailOpenTimer = null;
    if (token !== markingSessionOverlayFailOpenToken || !isMarkingSessionOverlaid()) {
      return;
    }
    logWorldTrace("marking-session:overlay-fail-open", {
      state: state.markingSessionMachineState
    });
    signalMarkingSession("overlay-timeout");
    void refreshUi();
  }, MARKING_SESSION_OVERLAY_FAIL_OPEN_MS);
}

// REFLEX-ARC Phase 1: consumed signal frames map to machine signals. The
// popup-local call sites remain during P1 (the transition table is idempotent
// for duplicates) and the per-tab seq cursor makes each frame apply at most
// once, in order.
const SIGNAL_FRAME_TO_MACHINE_SIGNAL: Readonly<Record<string, MarkingSessionSignal | null>> = Object.freeze({
  [SIGNAL_NAMES.MARKING_ENABLED]: "marking-enabled",
  [SIGNAL_NAMES.MARKING_DISABLED]: "marking-disabled",
  [SIGNAL_NAMES.MARKINGS_CHANGED]: "markings-changed",
  [SIGNAL_NAMES.RUN_STARTED]: "run-started",
  // run.completed carries no transition of its own: preview.opened{post_ai}
  // is the movement (the preview IS the completion surface).
  [SIGNAL_NAMES.RUN_COMPLETED]: null,
  [SIGNAL_NAMES.RUN_FAILED]: "run-failed",
  [SIGNAL_NAMES.PREVIEW_OPENED]: "preview-opened",
  [SIGNAL_NAMES.PREVIEW_EXIT_REQUESTED]: "exit-clicked",
  [SIGNAL_NAMES.PREVIEW_EXITED]: "exit-settled",
  [SIGNAL_NAMES.SESSION_SAVED]: "saved",
  [SIGNAL_NAMES.SESSION_DISCARDED]: "discarded",
  [SIGNAL_NAMES.SESSION_NAVIGATED]: "navigated",
  [SIGNAL_NAMES.INSPECTION_STARTED]: "inspection-started",
  [SIGNAL_NAMES.INSPECTION_ENDED]: "inspection-ended",
  [SIGNAL_NAMES.RECONCILIATION_STARTED]: "reconciliation-started",
  [SIGNAL_NAMES.RECONCILIATION_ENDED]: "reconciliation-ended"
});

function consumeSignalFrame(frame: SignalFrame): void {
  if (!frame || !Number.isFinite(frame.seq) || frame.seq <= state.lastConsumedSignalSeq) {
    return;
  }
  state.lastConsumedSignalSeq = frame.seq;
  logWorldTrace("signal:consume", { seq: frame.seq, name: frame.name, cause: frame.cause });
  const mapped = frame.name === SIGNAL_NAMES.PREVIEW_OPENED && frame.payload.origin === "post_ai"
    ? "post-ai-preview-opened"
    : SIGNAL_FRAME_TO_MACHINE_SIGNAL[frame.name] ?? null;
  if (mapped) {
    signalMarkingSession(mapped as MarkingSessionSignal);
  }
}

let lastSignalPullAt = 0;
function maybePullSignals(tabId: number | null): void {
  if (!tabId) {
    return;
  }
  const now = Date.now();
  if (now - lastSignalPullAt < 1000) {
    return;
  }
  lastSignalPullAt = now;
  void pullPopupSignals(tabId, state.lastConsumedSignalSeq).then((reply) => {
    if (!reply || !reply.ok) {
      return;
    }
    for (const frame of reply.frames) {
      consumeSignalFrame(frame);
    }
  });
}

function onPushedSignalFrame(frame: SignalFrame): void {
  if (!frame || !Number.isFinite(frame.seq) || frame.seq <= state.lastConsumedSignalSeq) {
    return;
  }
  if (frame.seq === state.lastConsumedSignalSeq + 1) {
    consumeSignalFrame(frame);
    return;
  }
  // Gap ahead of the cursor: recover through the ordered pull path so no
  // frame is skipped (push delivery is best-effort latency only).
  lastSignalPullAt = 0;
  maybePullSignals(getCurrentPopupTabId());
}

function overrideDictatedMarkingButtons(patch: PopupViewStatePatch): void {
  // Every central-dictation patch (projected AND neutral) carries the phase
  // field — it is the marker that a brain projection is being applied, so the
  // machine's surface memory must render on top (P4 4.2: the dictated
  // buttons/curtain content itself no longer exists).
  if (!Object.prototype.hasOwnProperty.call(patch, "sessionCurtainPhase")) {
    return;
  }
  if (state.markingSessionMachineState === "boot") {
    // One-time adoption for a fresh popup: derive the starting state from the
    // projected snapshot being applied, then move only on signals.
    const currentView = uiModule.getViewState();
    const markingActive =
      (Object.prototype.hasOwnProperty.call(patch, "mainUiHidden")
        ? !patch.mainUiHidden
        : !currentView.mainUiHidden) &&
      (Object.prototype.hasOwnProperty.call(patch, "silentModeActive")
        ? !patch.silentModeActive
        : !currentView.silentModeActive);
    const adopted = adoptMarkingSessionState({
      markingActive,
      previewOpen: Boolean(state.previewOpenIntent),
      restorePending: Boolean(state.previewRestorePending),
      runInFlight: Boolean(state.aiRequestInFlight || state.aiComputeStartPending),
      postAi: state.sessionAiRunPhase === AI_RUN_PHASES.POST_AI ||
        state.sessionAiRunPhase === AI_RUN_PHASES.AI_PREVIEW,
      dirty: Boolean(state.currentDraftDirty)
    });
    const dictatedPhase = typeof patch.sessionCurtainPhase === "string"
      ? patch.sessionCurtainPhase
      : "";
    if (dictatedPhase === SESSION_PHASES.RENDER_MODE_INSPECTION) {
      // Adopt into the overlay with the derived session state as the prior.
      state.markingSessionMachineState = "inspecting";
      state.markingSessionPriorState = adopted;
    } else {
      state.markingSessionMachineState = adopted;
      state.markingSessionPriorState = "";
    }
    logWorldTrace("marking-session:adopted", {
      state: state.markingSessionMachineState,
      prior: state.markingSessionPriorState
    });
    // Adoption can land directly in the inspecting overlay — arm the
    // fail-open deadline exactly as a signal-driven entry would.
    syncMarkingSessionOverlayFailOpen();
  }
  // REFLEX-ARC Phase 2: the machine state renders its COMPLETE memorized
  // surface — buttons (incl. toggle lock + visibility), mode, save reason,
  // and session-curtain content. The brain-dictated values for these fields
  // are superseded; null memory fields (boot, overlay mode) pass through.
  const memory = resolveMarkingSessionSurfaceMemory(
    state.markingSessionMachineState as MarkingSessionMachineState
  );
  if (memory.buttons) {
    Object.assign(patch, memory.buttons);
  }
  if (memory.mode) {
    patch.mainUiHidden = memory.mode.mainUiHidden;
    patch.silentModeActive = memory.mode.silentModeActive;
    // The silent-highlighting section (Preview list + Send to Lynx) is a
    // DERIVED surface of the mode. Passes compute cssSelectorsVisible from
    // their own pre-override silentModeActive, so a transient silent flap
    // post-exit leaked the silent section into the marking surface with
    // unstable enablement (architect report, 2026-07-03). When the machine
    // owns the mode, it owns the section too.
    patch.cssSelectorsVisible = memory.mode.silentModeActive;
  }
  if (memory.toggleChecked !== null) {
    patch.toggleEnabled = memory.toggleChecked;
  }
  if (memory.pageSaveBlockedReason !== null) {
    (patch as Record<string, unknown>).pageSaveBlockedReason = memory.pageSaveBlockedReason;
  }
  if (memory.curtain) {
    if (!memory.curtain.visible) {
      patch.sessionCurtainVisible = false;
      patch.sessionCurtainMessage = "";
      patch.sessionCurtainNote = "";
      patch.sessionCurtainTimerText = "";
      patch.sessionCurtainOperation = "";
    } else {
      patch.sessionCurtainVisible = true;
      patch.sessionCurtainMessage = memory.curtain.message;
      patch.sessionCurtainNote = memory.curtain.note;
      patch.sessionCurtainOperation = memory.curtain.operation;
      patch.sessionCurtainPhase = memory.curtain.phase;
      patch.sessionCurtainTimerText = memory.curtain.timer === "run-countdown"
        ? formatRunCountdownForCurtain()
        : "";
    }
  }
}

// The running-curtain countdown is machine memory fed by the run deadline the
// run.started signal carried (mirrored in state.aiRunDeadlineAt): re-derived
// at every patch application (~1s cadence from brain projections).
function formatRunCountdownForCurtain(): string {
  const remainingMs = Math.max(0, (state.aiRunDeadlineAt || 0) - Date.now());
  if (!remainingMs) {
    return "";
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Bounded retry for the initial siteId (domainId) resolution: 3 attempts at
// 2s/4s/8s per base URL, reset when the base changes (and naturally on every
// popup open — this is popup-instance state). refreshUi re-runs the whole
// resolution; a success simply stops scheduling.
let siteIdRetryTimer = 0;
let siteIdRetryKey = "";
let siteIdRetryCount = 0;

function scheduleSiteIdResolutionRetry(): void {
  const key = state.currentBaseUrl || "";
  if (!key) {
    return;
  }
  if (siteIdRetryKey !== key) {
    siteIdRetryKey = key;
    siteIdRetryCount = 0;
  }
  if (siteIdRetryTimer || siteIdRetryCount >= 3) {
    return;
  }
  const delayMs = 2000 * Math.pow(2, siteIdRetryCount);
  siteIdRetryCount += 1;
  siteIdRetryTimer = window.setTimeout(() => {
    siteIdRetryTimer = 0;
    if ((state.currentBaseUrl || "") !== key) {
      return;
    }
    void refreshUi({ useBusyOverlay: false });
  }, delayMs);
}

function applyCentralSessionDictation(nextViewState: PopupViewStatePatch, currentTabId: number | null): void {
  const nextCentralSessionDictationViewState = buildCentralSessionDictationViewStatePatch({
    currentTabId,
    projectedTabId: popupBackgroundStateTabId,
    sessionPhase: popupBackgroundSessionPhase || null,
    sessionDictation: popupBackgroundSessionDictation
  });
  if (!nextCentralSessionDictationViewState) {
    nextViewState.sessionCurtainVisible = false;
    nextViewState.sessionCurtainMessage = "";
    nextViewState.sessionCurtainNote = "";
    nextViewState.sessionCurtainTimerText = "";
    nextViewState.sessionCurtainOperation = "";
    nextViewState.sessionCurtainPhase = "";
    return;
  }
  Object.assign(nextViewState, nextCentralSessionDictationViewState);
  overrideDictatedPreviewVisibility(nextViewState);
  overrideDictatedMarkingButtons(nextViewState);
}

function sendSpinnerBrokerMessage(
  message: SpinnerBrokerMessage | null | undefined,
  options: SpinnerBrokerMessageOptions = {}
): Promise<PopupSpinnerBrokerResponse> {
  const tabId = getCurrentPopupTabId();
  if (!tabId || !message || typeof message !== "object") {
    return Promise.resolve(null);
  }
  const shouldApplySnapshot = typeof options.shouldApplySnapshot === "function"
    ? options.shouldApplySnapshot
    : () => true;
  const request = message.type === SPINNER_REQUEST_TYPES.SET
    ? requestPopupSpinnerSet(tabId, {
      key: typeof message.key === "string" ? message.key : "",
      message: typeof message.message === "string" ? message.message : "",
      persistent: Boolean(message.persistent),
      reason: typeof message.reason === "string" ? message.reason : "",
      source: typeof message.source === "string" ? message.source : "",
      startedAt: Number.isFinite(message.startedAt) ? Number(message.startedAt) : Date.now(),
      operationId: typeof message.operationId === "string" ? message.operationId : "",
      operationKind: typeof message.operationKind === "string" ? message.operationKind : "",
      operationPhase: typeof message.operationPhase === "string" ? message.operationPhase : "",
      deadlineAt: Number.isFinite(message.deadlineAt) ? Number(message.deadlineAt) : undefined,
      maxDurationMs: Number.isFinite(message.maxDurationMs) ? Number(message.maxDurationMs) : undefined,
      blockSurfaces: message.blockSurfaces && typeof message.blockSurfaces === "object"
        ? {
          page: message.blockSurfaces.page === true,
          popup: message.blockSurfaces.popup === true
        }
        : undefined,
      timerMode: typeof message.timerMode === "string" ? message.timerMode : ""
    })
    : Promise.resolve(null);
  logWorldTrace("bus-send", { tabId, type: message.type || "" });
  return request
    .then((response) => {
      if (response && shouldApplySnapshot(response)) {
        applyPopupViewSnapshot(response);
      }
      logWorldTrace("bus-response", {
        tabId,
        type: message.type || "",
        ok: Boolean(response)
      });
      return response;
    })
    .catch(() => null);
}

function removeSpinnerEntryFromBackground(
  key: string,
  tabId: number | null = getCurrentPopupTabId()
) {
  if (!tabId || !key) {
    return Promise.resolve(null);
  }
  return requestPopupSpinnerRemove(tabId, {
    key
  }).then((response) => {
    if (response) {
      applyPopupViewSnapshot(response);
    }
    return response;
  }).catch(() => null);
}

function clearSpinnerQueueInBackground(
  tabId = getCurrentPopupTabId(),
  options: { transientOnly?: boolean } = {}
) {
  if (!tabId) {
    return Promise.resolve(null);
  }
  return requestPopupSpinnerClear(tabId, {
    transientOnly: Boolean(options.transientOnly)
  }).then((response) => {
    if (response) {
      applyPopupViewSnapshot(response);
    }
    return response;
  }).catch(() => null);
}

async function restoreSpinnerQueueFromBackground(tabId: number | null, popupBus: PopupBusClient | null): Promise<void> {
  if (!tabId || !popupBus) {
    return;
  }
  const viewState = await requestPopupView(popupBus, tabId).catch(() => null);
  if (viewState) {
    applyPopupViewSnapshot(viewState);
  }
}

async function handleTraceModeToggle(event: unknown): Promise<void> {
  const toggleEvent = event as TraceModeToggleEvent | null;
  if (toggleEvent && toggleEvent.currentTarget) {
    toggleEvent.currentTarget.checked = Boolean(state.traceModeEnabled);
  }
}

function clearStaleInspectionBusyClearTimer() {
  if (!popupStaleInspectionBusyClearTimer) {
    return;
  }
  window.clearTimeout(popupStaleInspectionBusyClearTimer);
  popupStaleInspectionBusyClearTimer = 0;
}

function reportNavigationInspectionSettledToBrain(
  tabId: number | null = popupNavigationInspectionOverlayTabId,
  reason = "navigation-inspection-settled"
): void {
  if (tabId) {
    clearRenderModeSetNavGuard(tabId);
    clearNavigationInspectionSettlePoll(tabId);
    publishCurrentSessionFacts(tabId, {
      navigationInspectionPending: false,
      pageInspectionBusy: false,
      busyVisible: false,
      busyMessage: "",
      busyNote: "",
      busyTimerText: ""
    });
  }
  logPopupSpinnerDebug(reason, { tabId });
  popupNavigationInspectionOverlayStarted = false;
  popupNavigationInspectionOverlayTabId = null;
}

function isNavigationInspectionBusyView(view: PopupViewState | null | undefined): boolean {
  if (!view) {
    return false;
  }
  const sessionCurtainMatches = Boolean(
    view.sessionCurtainVisible &&
      view.sessionCurtainPhase === SESSION_PHASES.RENDER_MODE_INSPECTION
  );
  const spinnerMatches = Boolean(
    view.isBusy &&
      (view.busySpinnerKey === SPINNER_KEYS.NAV_INSPECT ||
        view.busyReason === "page-inspection-pending" ||
        (view.busyOperationKind === SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP &&
          view.busyOperationPhase === SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION))
  );
  return sessionCurtainMatches || spinnerMatches;
}

// Bounded last-resort fail-open windows. The deterministic clear now comes from
// the content `inspectionSettled` event; these single one-shot timers only force
// a clear if that settle signal never arrives. They do NOT poll content status.
const NAV_INSPECTION_SETTLE_FAILOPEN_MS = 15_000;
const STALE_INSPECTION_FAILOPEN_MS = 15_000;

function scheduleStaleInspectionBusyClear(
  tabId = state.currentTab && state.currentTab.id,
  baseUrl = state.currentBaseUrl,
  { reconcileSilentNavSpinner = false, reconcileRenderModeNavSpinner = false } = {}
) {
  if (!tabId) {
    return;
  }
  clearStaleInspectionBusyClearTimer();
  let attempt = 0;
  // Reconcile against the authoritative content inspection status until it is
  // actually no longer pending, rather than abandoning after a fixed budget.
  // The old 12-attempt (~5s) cap gave up while the editor reveal/freeze warmup
  // was still pending and then NOTHING re-triggered the clear, leaving the
  // "Inspecting page..." curtain (uiBusy) stuck permanently with an empty
  // spinner queue. The high cap below is a safety net only; the curtain clears
  // as soon as content reports not-pending.
  const maxAttempts = 75;
  const failOpenClear = () => {
    const view = uiModule.getViewState();
    const stillInspectionCurtain = isNavigationInspectionBusyView(view);
    if (!stillInspectionCurtain) {
      return;
    }
    // Last resort: report the expired inspection fact upward. The brain decides
    // and broadcasts the actual curtain clear for popup + page.
    reportNavigationInspectionSettledToBrain(tabId, "stale-inspection-busy-failopen");
    logPopupSpinnerDebug("stale-inspection-busy-failopen", { tabId, attempt });
  };
  const run = async () => {
    popupStaleInspectionBusyClearTimer = 0;
    attempt += 1;
    const view = uiModule.getViewState();
    const curtainShowing = isNavigationInspectionBusyView(view);
    // A popup-origin navigation-inspection lease can outlive the silent
    // reveal/freeze warmup. Reconcile that case directly once content settles.
    const silentNavSpinnerStuck =
      reconcileSilentNavSpinner &&
      !view.toggleEnabled &&
      hasProjectedNavigationInspectionSpinner();
    const renderModeNavSpinnerStuck = Boolean(
      reconcileRenderModeNavSpinner &&
      hasProjectedNavigationInspectionSpinner()
    );
    const queueClearGate = !getActiveSpinnerSnapshotForSurface("popup");
    if (curtainShowing && (silentNavSpinnerStuck || renderModeNavSpinnerStuck || queueClearGate)) {
      const runtimeStatus = await refreshCurrentPageRuntimeStatus({
        tabId,
        baseUrl
      }).catch(() => null);
      const draftStatus = runtimeStatus && runtimeStatus.draftStatus;
      const editorPreparationPending = Boolean(
        draftStatus &&
          draftStatus.ok &&
          draftStatus.reconciliationPending &&
          draftStatus.reconciliation &&
          draftStatus.reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
      );
      const inspectionPending = Boolean(
        runtimeStatus &&
          (runtimeStatus.inspectionPending || editorPreparationPending)
      );
      const holdForRenderModeSet = shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId);
      if (!inspectionPending && !holdForRenderModeSet) {
        if (silentNavSpinnerStuck || renderModeNavSpinnerStuck) {
          logPopupSpinnerDebug(
            renderModeNavSpinnerStuck ? "render-mode-nav-curtain-clear" : "silent-nav-curtain-clear",
            { tabId, attempt }
          );
          reportNavigationInspectionSettledToBrain(
            tabId,
            renderModeNavSpinnerStuck ? "render-mode-nav-curtain-clear" : "silent-nav-curtain-clear"
          );
        } else {
          logPopupSpinnerDebug("stale-inspection-busy-clear", { tabId, attempt });
          reportNavigationInspectionSettledToBrain(tabId, "stale-inspection-busy-clear");
        }
        return;
      }
    }
    if (attempt >= maxAttempts) {
      failOpenClear();
      return;
    }
    // No re-polling: the content `inspectionSettled` event drives the
    // deterministic clear. Arm a single bounded fail-open as last resort only.
    popupStaleInspectionBusyClearTimer = window.setTimeout(() => {
      popupStaleInspectionBusyClearTimer = 0;
      failOpenClear();
    }, STALE_INSPECTION_FAILOPEN_MS);
  };
  popupStaleInspectionBusyClearTimer = window.setTimeout(() => {
    void run();
  }, 150);
}

function isValidEmail(value: string) {
  return EMAIL_REGEX.test(value);
}

function isMobileSimulationActive(deviceState: MobileSimulationState | null | undefined) {
  if (!deviceState || typeof deviceState !== "object") {
    return false;
  }
  return Boolean(deviceState.enabled) && deviceState.mode === "mobile";
}

function ensureMobileSimulationForSave() {
  if (isMobileSimulationActive({
    enabled: state.currentDeviceEmulationEnabled,
    mode: state.currentDeviceMode
  })) {
    return true;
  }
  uiModule.showToast(PopupText.page.mobileSimulationRequired);
  return false;
}

async function persistDesktopPreviewEnabled(tabId: number | null | undefined, enabled: boolean) {
  if (!tabId) {
    return;
  }
  const normalizedEnabled = isFeatureEnabled("desktopPreview") && Boolean(enabled);
  await messages.setTabState(tabId, {
    active: true,
    desktopPreviewEnabled: normalizedEnabled
  }, "initial");
  state.currentDesktopPreviewEnabled = normalizedEnabled;
}

function resolveRelativeEndpoint(baseUrl: string, path: string) {
  try {
    return new URL(path, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function normalizeThemeValue(value: unknown) {
  if (typeof value !== "string") {
    return THEME_DEFAULT;
  }
  const normalized = value.trim().toLowerCase();
  return THEME_IDS.has(normalized) ? normalized : THEME_DEFAULT;
}

function normalizeThemeModeValue(value: unknown) {
  if (value === THEME_MODE_LIGHT || value === THEME_MODE_DARK || value === THEME_MODE_SYSTEM) {
    return value;
  }
  return THEME_MODE_DEFAULT;
}

function applyPopupTheme(themeValue: unknown, modeValue: unknown) {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  const normalizedTheme = normalizeThemeValue(themeValue);
  const normalizedMode = normalizeThemeModeValue(modeValue);
  root.setAttribute("data-theme", normalizedTheme);
  root.setAttribute("data-theme-mode", normalizedMode);
  root.style.colorScheme =
    normalizedMode === THEME_MODE_SYSTEM ? "light dark" : normalizedMode;
}

function resetDisabledAppearanceCustomization() {
  state.currentTheme = THEME_DEFAULT;
  state.currentThemeMode = THEME_MODE_DEFAULT;
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: state.currentTheme,
    themeModeValue: state.currentThemeMode,
    themeMenuOpen: false
  });
}

async function loadThemeSettings() {
  return getThemeSettings({
    normalizeThemeValue,
    normalizeThemeModeValue
  });
}

async function persistThemeSettings(themeValue: string, themeModeValue: string) {
  await setThemeSettings(themeValue, themeModeValue, {
    normalizeThemeValue,
    normalizeThemeModeValue
  });
}

async function ensureThemeSettings() {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const { themeValue, themeModeValue } = await loadThemeSettings();
  state.currentTheme = themeValue;
  state.currentThemeMode = themeModeValue;
  applyPopupTheme(themeValue, themeModeValue);
  await persistThemeSettings(themeValue, themeModeValue);
}

async function loadTraceModeSetting() {
  return isFeatureEnabled("traceDiagnostics") && isDebugFlagEnabled("worldTraceEnabled");
}

async function applyTraceModePreferenceToTab(tabId: number | null, enabled: boolean, popupBus: PopupBusClient) {
  void enabled;
  if (!isFeatureEnabled("traceDiagnostics")) {
    state.traceModeEnabled = false;
    state.traceEvents = [];
    uiModule.setViewState({ traceModeEnabled: false, traceEvents: [], traceEventCount: 0 });
    return null;
  }
  if (!tabId) {
    return null;
  }
  const viewState = await requestPopupView(popupBus, tabId).catch(() => null);
  if (viewState) {
    applyPopupViewSnapshot(viewState);
    return viewState;
  }
  return null;
}

function buildPageMarkingKey(url: unknown, pageType: unknown) {
  const normalizedUrl = normalizeCandidatePageUrl(url);
  const normalizedPageType = normalizePageTypeKey(pageType);
  if (!normalizedUrl || !normalizedPageType) {
    return "";
  }
  return `${normalizedPageType}|${normalizedUrl}`;
}

function resetPropertyPageTypesState() {
  state.propertyPageTypes = [];
  state.propertyPageTypesDuplicateUrls = [];
  state.propertyPageTypesSiteId = null;
  state.propertyPageTypesStageBase = "";
  state.propertyPageTypesSignature = "";
  state.propertyPageTypesFetchedAt = 0;
  state.propertyPageTypesLastError = "";
  state.propertyPageTypesChangeNoticeVisible = false;
  state.propertyPageTypesInvalidAlertPending = false;
  state.propertyPageTypesChangeForceTodoOpen = false;
}

function clearPropertyPageTypesRefreshTimer() {
  pageTypesRefreshRunner = null;
  state.propertyPageTypesRefreshTimer = 0;
  state.propertyPageTypesRefreshKey = "";
}

function schedulePropertyPageTypesRefresh(options: PropertyPageTypesRefreshOptions = {}) {
  const {
    siteId = null,
    stageBase = ""
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  const normalizedStageBase = normalizeStageBase(stageBase);
  const refreshKey = normalizedSiteId && normalizedStageBase
    ? `${normalizedStageBase}|${normalizedSiteId}`
    : "";
  if (!refreshKey) {
    clearPropertyPageTypesRefreshTimer();
    return;
  }
  if (
    state.propertyPageTypesRefreshTimer &&
    state.propertyPageTypesRefreshKey === refreshKey
  ) {
    return;
  }
  clearPropertyPageTypesRefreshTimer();
  state.propertyPageTypesRefreshKey = refreshKey;
  state.propertyPageTypesRefreshTimer = 1;
  pageTypesRefreshRunner = () => {
    helpers.loadGlobalAiSettings().then(({ tokenValue: nextTokenValue, stageBaseValue }) => {
      return ensurePropertyPageTypes({
        siteId: normalizedSiteId,
        stageBase: stageBaseValue || normalizedStageBase,
        tokenValue: nextTokenValue || "",
        force: true,
        notifyOnChange: false
      });
    }).then((result) => {
      if (!result || !result.changed) {
        return;
      }
      // The 2-minute candidate poll keeps propertyPageTypes fresh (quiet data
      // refresh), but its change-detection side effects — the "candidates
      // changed" notice, the "marking has been stopped" invalidation alert, the
      // forced Todo-list expansion, and the refreshUi churn — fired
      // UNCONDITIONALLY, including mid AI-run/preview/exit, which corrupted
      // in-flight sessions. Gate that disruptive path behind an off-by-default
      // feature flag so the periodic poll can never interrupt an active session
      // unless the detection is explicitly enabled.
      if (!isFeatureEnabled("pageTypesChangeDetection")) {
        return;
      }
      state.propertyPageTypesChangeNoticeVisible = true;
      state.propertyPageTypesInvalidAlertPending = true;
      state.propertyPageTypesChangeForceTodoOpen = true;
      refreshUi({
        useBusyOverlay: false,
        skipPropertyLockFetch: true,
        propertyPageTypesRefreshChanged: true
      }).then();
    }).catch(() => {});
  };
}

function formatPageTypeCandidateLabel(url: unknown) {
  if (typeof url !== "string" || !url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search || ""}` || "/";
  } catch (_error) {
    return url;
  }
}

function collectStoredPageMarkingItems(pageMarkings: PageMarkings | Record<string, unknown> | null | undefined, baseUrl = "") {
  const items: PageMarkingListItem[] = [];
  Object.entries(pageMarkings && typeof pageMarkings === "object" ? pageMarkings : {}).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      return;
    }
    if (baseUrl && !utils.isPageWithinBaseUrl(url, baseUrl)) {
      return;
    }
    const pageMarkingEntry = entry as PageMarkingEntry;
    const excludedCount = Array.isArray(pageMarkingEntry.xpaths)
      ? pageMarkingEntry.xpaths.filter((item) => item && item.excluded && item.xpath).length
      : 0;
    const includedCount = Array.isArray(pageMarkingEntry.includeXpaths)
      ? pageMarkingEntry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath).length
      : 0;
    items.push({
      url,
      title: pageMarkingEntry.title || url,
      pageType: pageMarkingEntry.pageType || "",
      count: excludedCount + includedCount
    });
  });
  return items;
}

function createNormalizedPageMarkingsSnapshot(pageMarkings: unknown) {
  return config.createBackendSavedPageMarkingsSnapshot(pageMarkings);
}

function arePageMarkingSnapshotsEqual(left: unknown, right: unknown) {
  return JSON.stringify(createNormalizedPageMarkingsSnapshot(left)) ===
    JSON.stringify(createNormalizedPageMarkingsSnapshot(right));
}

function hasSessionPageMarkingChanges(localPageMarkings: unknown, backendSavedPageMarkings: unknown) {
  return !arePageMarkingSnapshotsEqual(localPageMarkings, backendSavedPageMarkings);
}

function getNormalizedPageMarkingSnapshotEntry(pageMarkings: unknown, pageUrl: unknown) {
  const normalizedTargetUrl = normalizeCandidatePageUrl(pageUrl);
  if (!normalizedTargetUrl) {
    return null;
  }
  const entry = findBackendSavedPageMarkingEntry(pageMarkings, normalizedTargetUrl);
  if (!entry) {
    return null;
  }
  const snapshot = createNormalizedPageMarkingsSnapshot({
    [normalizedTargetUrl]: entry
  });
  return snapshot[normalizedTargetUrl] || null;
}

function hasCurrentPageMarkingChanges(localPageMarkings: unknown, backendSavedPageMarkings: unknown, pageUrl: unknown) {
  return JSON.stringify(getNormalizedPageMarkingSnapshotEntry(localPageMarkings, pageUrl)) !==
    JSON.stringify(getNormalizedPageMarkingSnapshotEntry(backendSavedPageMarkings, pageUrl));
}

function getLatestPageMarkingTimestamp(pageMarkings: unknown) {
  let latestTimestamp = config.PAGE_TIMESTAMP_FALLBACK;
  Object.values(createNormalizedPageMarkingsSnapshot(pageMarkings)).forEach((entry) => {
    const timestamp = config.normalizeEntryTimestamp(entry && entry.timestamp);
    if (config.isIncomingTimestampNewer(timestamp, latestTimestamp)) {
      latestTimestamp = timestamp;
    }
  });
  return latestTimestamp;
}

function doesSessionRequireAiRun(
  sourceConfig: Config | null | undefined,
  localPageMarkings: unknown,
  backendSavedPageMarkings: unknown,
  options: SessionChangeOptions = {}
) {
  // A dirty current-page draft normally means the markings changed and the
  // selectors are stale, so an AI run is required before Save. But once a
  // successful AI run already matches the live current-page markings
  // (aiRunUpToDate), the draft is dirty only because it has not been
  // backend-saved yet - it does NOT need another run. Skipping the early
  // return in that case lets Save enable right after a clean run (State C)
  // while still demanding a run after any new mark/unmark change (State B).
  if (options.currentDraftDirty && !options.aiRunUpToDate) {
    return true;
  }
  if (!hasSessionPageMarkingChanges(localPageMarkings, backendSavedPageMarkings)) {
    return false;
  }
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return true;
  }
  if (!hasCalculatedSelectorsFromConfig(sourceConfig)) {
    return true;
  }
  return config.isIncomingTimestampNewer(
    getLatestPageMarkingTimestamp(localPageMarkings),
    config.normalizeEntryTimestamp(sourceConfig && sourceConfig.selectorsUpdatedAt)
  );
}

function hasSessionPendingChanges(
  sourceConfig: Config | null | undefined,
  localPageMarkings: unknown,
  backendSavedPageMarkings: unknown,
  options: SessionChangeOptions = {}
) {
  return Boolean(
    options.currentDraftDirty ||
      options.reconciliationPending ||
      options.selectorsPendingConfigSync ||
      hasSessionPageMarkingChanges(localPageMarkings, backendSavedPageMarkings)
  );
}

async function getCurrentSessionActionGateState(sourceConfig: Config | null | undefined = state.currentConfig) {
  const localPageMarkings = (sourceConfig && sourceConfig.pageMarkings) || {};
  const backendSavedPageMarkings = state.currentBaseUrl
    ? await config.getBackendSavedPageMarkings(state.currentBaseUrl)
    : {};
  const aiRunUpToDate = isAiRunUpToDateForCurrentMarkings();
  const sessionRequiresAiRun = aiRunUpToDate
    ? false
    : doesSessionRequireAiRun(
        sourceConfig,
        localPageMarkings,
        backendSavedPageMarkings,
        {
          currentDraftDirty: state.currentDraftDirty,
          aiRunUpToDate
        }
      );

  return {
    aiRunUpToDate,
    sessionRequiresAiRun
  };
}

function findBackendSavedPageMarkingEntry(pageMarkings: unknown, pageUrl: unknown): PageMarkingEntry | null {
  const normalizedTargetUrl = normalizeCandidatePageUrl(pageUrl);
  if (!normalizedTargetUrl || !pageMarkings || typeof pageMarkings !== "object") {
    return null;
  }
  const savedPageMarkings = pageMarkings as Record<string, PageMarkingEntry | null | undefined>;
  const matchingUrl = Object.keys(savedPageMarkings).find(
    (url) => normalizeCandidatePageUrl(url) === normalizedTargetUrl
  );
  return matchingUrl ? savedPageMarkings[matchingUrl] || null : null;
}

function clonePageMarkingEntry(entry: PageMarkingEntry | null): PageMarkingEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(entry));
}

function clonePageSaveReconciliation(
  reconciliation: PageSaveReconciliation | null
): PageSaveReconciliation | null {
  if (!reconciliation || typeof reconciliation !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(reconciliation));
}

function captureMarkingSessionSnapshot() {
  const snapshot: PopupPreviewMarkingSessionSnapshot = {
    currentDraftEntry: clonePageMarkingEntry(state.currentDraftEntry),
    currentSavedEntry: clonePageMarkingEntry(state.currentSavedEntry),
    currentDraftDirty: state.currentDraftDirty,
    currentDraftAvailable: state.currentDraftAvailable,
    currentPageSaveReconciliation: clonePageSaveReconciliation(state.currentPageSaveReconciliation),
    currentPageSaveReconciliationPending: state.currentPageSaveReconciliationPending,
    sessionAiRunPhase: state.sessionAiRunPhase,
    aiRunMarkingsFingerprint: state.aiRunMarkingsFingerprint,
    aiSelectorsComputedSinceLastSubmit: state.aiSelectorsComputedSinceLastSubmit,
    aiSelectorsComputedBaseUrl: state.aiSelectorsComputedBaseUrl,
    selectorsPendingConfigSync: state.selectorsPendingConfigSync,
    selectorsPendingConfigSyncBaseUrl: state.selectorsPendingConfigSyncBaseUrl
  };
  state.previewMarkingSessionSnapshot = snapshot;
}

function restoreMarkingSessionSnapshot() {
  const snapshot = state.previewMarkingSessionSnapshot;
  if (!snapshot) {
    return false;
  }
  state.currentDraftEntry = clonePageMarkingEntry(snapshot.currentDraftEntry);
  state.currentSavedEntry = clonePageMarkingEntry(snapshot.currentSavedEntry);
  state.currentDraftDirty = snapshot.currentDraftDirty;
  state.currentDraftAvailable = snapshot.currentDraftAvailable;
  state.currentPageSaveReconciliation = clonePageSaveReconciliation(snapshot.currentPageSaveReconciliation);
  state.currentPageSaveReconciliationPending = snapshot.currentPageSaveReconciliationPending;
  state.sessionAiRunPhase = snapshot.sessionAiRunPhase;
  state.aiRunMarkingsFingerprint = snapshot.aiRunMarkingsFingerprint;
  state.aiSelectorsComputedSinceLastSubmit = snapshot.aiSelectorsComputedSinceLastSubmit;
  state.aiSelectorsComputedBaseUrl = snapshot.aiSelectorsComputedBaseUrl;
  state.selectorsPendingConfigSync = snapshot.selectorsPendingConfigSync;
  state.selectorsPendingConfigSyncBaseUrl = snapshot.selectorsPendingConfigSyncBaseUrl;
  return true;
}

function clearMarkingSessionSnapshot() {
  state.previewMarkingSessionSnapshot = null;
}

function fingerprintPageMarkingEntry(entry: PageMarkingEntry | null | undefined) {
  // Stable signature of the element-level markings only (exclude + include
  // xpaths). CSS-selector edits intentionally do not affect this fingerprint,
  // so only mark/unmark actions re-enable Run AI. Normalize to marking-identity
  // strings (xpath + excluded flag) so incidental entry-object shape/order
  // differences across the AI-run snapshot + preview-exit refresh cycle do not
  // spuriously invalidate the fingerprint (which would wrongly re-enable Run AI
  // and disable Show Content List/Save right after a clean run).
  const excludeXpaths = entry && Array.isArray(entry.xpaths)
    ? entry.xpaths
        .map((item) => {
          if (typeof item === "string") {
            return item ? `${item}|0` : "";
          }
          if (item && typeof item === "object" && typeof item.xpath === "string") {
            return `${item.xpath}|${item.excluded ? "1" : "0"}`;
          }
          return "";
        })
        .filter((value) => value)
    : [];
  const includeXpaths = entry && Array.isArray(entry.includeXpaths)
    ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
  excludeXpaths.sort();
  includeXpaths.sort();
  return JSON.stringify({ exclude: excludeXpaths, include: includeXpaths });
}

function getCurrentPageMarkingsFingerprint() {
  return fingerprintPageMarkingEntry(state.currentDraftEntry);
}

function setSessionAiRunPhase(phase: SessionAiRunPhase) {
  state.sessionAiRunPhase = phase === AI_RUN_PHASES.POST_AI
    ? AI_RUN_PHASES.POST_AI
    : AI_RUN_PHASES.PRE_AI;
}

function isAiRunUpToDateForCurrentMarkings() {
  // Deterministic + brain-deferring: the AI run is up to date when the popup's
  // own POST_AI phase says so, OR when the brain (the session-phase authority)
  // has reached READY_TO_SAVE. READY_TO_SAVE only holds when the brain sees a
  // completed run with no deterministic marking edit since, so trusting it keeps
  // the popup's Save/status copy consistent with the brain and robust to page
  // shifts (scroll/cursor/re-sync never move the brain out of READY_TO_SAVE).
  return (
    state.sessionAiRunPhase === AI_RUN_PHASES.POST_AI ||
    popupBackgroundSessionPhase === SESSION_PHASES.READY_TO_SAVE
  );
}

function captureAiRunMarkingsFingerprint() {
  state.aiRunMarkingsFingerprint = getCurrentPageMarkingsFingerprint();
  // A captured fingerprint means an AI run just completed for the current
  // markings, so the popup session is POST_AI until an explicit reset
  // (resetAiRunMarkingsFingerprint). Without this the popup keeps publishing
  // aiRunPhase:PRE_AI, and any post-exit report that looks like a clean reset
  // hands AI-run authority back to the popup and wedges the brain at PRE_AI
  // (Save stuck on requires_ai_run). It also drives the POST_AI leg of
  // shouldReportManualAiPreviewEvent so preview exit reliably emits EXITED.
  setSessionAiRunPhase(AI_RUN_PHASES.POST_AI);
}

function resetAiRunMarkingsFingerprint() {
  state.aiRunMarkingsFingerprint = null;
  setSessionAiRunPhase(AI_RUN_PHASES.PRE_AI);
}

function clearSelectorsPendingConfigSync() {
  state.selectorsPendingConfigSync = false;
  state.selectorsPendingConfigSyncBaseUrl = "";
}

function getSelectorSetFingerprint(selectorSet: SelectorSet | null | undefined) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return combineAiSelectorSet(normalized).length ? JSON.stringify(normalized) : "";
}

function buildSelectorSetForGraphqlSubmit(selectorSet: SelectorSet | null | undefined) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return normalizeAiSelectorSet({
    exclusionSelectors: [
      ...normalized.exclusionSelectors,
      ...constants.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS
    ],
    inclusionSelectors: normalized.inclusionSelectors
  });
}

function buildGraphqlRenderModeValue(renderMode: unknown) {
  return config.normalizeRenderMode(renderMode) === config.RENDER_MODE_RENDERED
    ? "RENDERED"
    : "STATIC";
}

function isUndeterminedRenderMode(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === RENDER_MODE_UNDETERMINED;
}

function normalizeUiRenderModeValue(value: unknown, fallback = config.DEFAULT_RENDER_MODE) {
  if (isUndeterminedRenderMode(value)) {
    return RENDER_MODE_UNDETERMINED;
  }
  return config.normalizeRenderMode(typeof value === "string" ? value : fallback);
}

function markRenderModeUndetermined(detectionKey: string) {
  state.renderModeSuggestedValue = RENDER_MODE_UNDETERMINED;
  state.renderModeDetectionUnsure = true;
  state.renderModeDetectionAccuracy = Number.NaN;
  if (state.renderModeUndeterminedNoticeKey === detectionKey) {
    return;
  }
  state.renderModeUndeterminedNoticeKey = detectionKey;
  uiModule.showToast(PopupText.renderMode.toastUndeterminedManual);
}

function isRenderModeDetectionLowConfidence(accuracy: unknown) {
  const numericAccuracy = Number(accuracy);
  return Number.isFinite(numericAccuracy) &&
    numericAccuracy >= RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY &&
    numericAccuracy < RENDER_MODE_DETECTION_REVIEW_ACCURACY;
}

function hasConfirmedRenderModeForBaseUrl(configs: Record<string, Config>, baseUrl: unknown) {
  const normalizedBaseUrl =
    utils.normalizeCanonicalBaseUrl(baseUrl) ||
    utils.normalizeBaseUrl(baseUrl) ||
    (typeof baseUrl === "string" ? baseUrl : "");
  if (
    !normalizedBaseUrl ||
    !configs ||
    !Object.prototype.hasOwnProperty.call(configs, normalizedBaseUrl)
  ) {
    return false;
  }
  const normalizedConfig = config.normalizeConfig(
    normalizedBaseUrl,
    configs[normalizedBaseUrl]
  ).config;
  return config.isRenderModeConfirmed(normalizedConfig);
}

function getSuggestedRenderModeForPage(pageUrl: string | null | undefined, sourceConfig: Config | null = state.currentConfig) {
  const suggestionKey = `${state.currentBaseUrl || ""}|${pageUrl || ""}`;
  if (!state.currentBaseUrlHasConfirmedRenderMode) {
    return RENDER_MODE_UNDETERMINED;
  }
  if (
    state.renderModeSuggestedKey === suggestionKey &&
    state.renderModeSuggestedValue
  ) {
    return normalizeUiRenderModeValue(state.renderModeSuggestedValue);
  }
  if (shouldAutoDetectRenderMode(sourceConfig)) {
    return RENDER_MODE_UNDETERMINED;
  }
  return config.getConfigRenderMode(sourceConfig);
}

function shouldAutoDetectRenderMode(sourceConfig: Config | null | undefined) {
  if (!isFeatureEnabled("renderModeAutoDetection")) {
    return false;
  }
  if (!sourceConfig || typeof sourceConfig !== "object") {
    return false;
  }
  if (state.currentBaseUrlHasConfirmedRenderMode) {
    return false;
  }
  return (
    config.getConfigRenderMode(sourceConfig) === config.DEFAULT_RENDER_MODE &&
    config.normalizeEntryTimestamp(sourceConfig.renderModeUpdatedAt) === config.PAGE_TIMESTAMP_FALLBACK
  );
}

function getRenderModeInspectionSnapshotKey(baseUrl: unknown, pageUrl: unknown) {
  return baseUrl && pageUrl ? `${baseUrl}|${pageUrl}` : "";
}

function getCurrentRenderModeInspectionSnapshot(detectionKey: string): RenderModeInspectionSnapshot | null {
  const snapshot = state.renderModeInspectionSnapshot;
  if (
    !detectionKey ||
    state.renderModeInspectionSnapshotKey !== detectionKey ||
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.renderedHtml !== "string" ||
    !snapshot.renderedHtml ||
    typeof snapshot.rawHtml !== "string"
  ) {
    return null;
  }
  return snapshot;
}

function rememberRenderModeInspectionSnapshot(
  baseUrl: unknown,
  pageUrl: unknown,
  snapshot: RenderModeInspectionSnapshot | null
) {
  const snapshotKey = getRenderModeInspectionSnapshotKey(baseUrl, pageUrl);
  if (
    !snapshotKey ||
    !snapshot ||
    typeof snapshot.renderedHtml !== "string" ||
    !snapshot.renderedHtml ||
    typeof snapshot.rawHtml !== "string"
  ) {
    return false;
  }
  state.renderModeInspectionSnapshotKey = snapshotKey;
  state.renderModeInspectionSnapshot = {
    renderedHtml: snapshot.renderedHtml,
    rawHtml: snapshot.rawHtml,
    renderMode: typeof snapshot.renderMode === "string" ? snapshot.renderMode : "",
    pageUrl
  };
  state.renderModeDetectionInFlight = false;
  state.renderModeDetectionKey = "";
  return true;
}

async function getStoredGlobalToken(options = {}) {
  return getGlobalToken(options);
}

function formatSyncStatusTimestamp(value = Date.now()) {
  try {
    return new Date(value).toLocaleTimeString();
  } catch (_error) {
    return "";
  }
}

function clearAiRunPollTimer() {
  if (state.aiRunPollTimer) {
    window.clearTimeout(state.aiRunPollTimer);
    state.aiRunPollTimer = 0;
  }
}

function clearAiRunCountdownTimer() {
  if (state.aiRunCountdownTimer) {
    window.clearInterval(state.aiRunCountdownTimer);
    state.aiRunCountdownTimer = 0;
  }
}

function clearAiRunTimers() {
  clearAiRunPollTimer();
  clearAiRunCountdownTimer();
}

function updateAiRunCountdownState() {
  if (state.aiRequestInFlight !== "compute") {
    return;
  }
  state.aiRunRemainingMs = getAiRunRemainingMs(state.aiRunDeadlineAt);
  const aiRunCountdownText = formatAiRunCountdown(state.aiRunRemainingMs);
  uiModule.setViewState({
    computeButtonText: ViewText.computeButtonBusy,
    aiRunSpinnerNote: PopupText.overlay.computingSelectorsNote,
    aiRunCountdownVisible: true,
    aiRunCountdownText,
    aiRunDeadlineAt: state.aiRunDeadlineAt,
    aiRunPhase: state.aiRunPhase
  });
  if (state.aiRunResumed) {
    publishCurrentTabSessionFacts({
      aiBusy: true,
      aiComputing: true,
      busyVisible: true,
      busyMessage: "",
      busyNote: PopupText.overlay.computingSelectorsNote
    });
  }
}

function startAiRunCountdownTimer() {
  clearAiRunCountdownTimer();
  updateAiRunCountdownState();
}

function resetAiRunState() {
  clearAiRunTimers();
  state.aiRequestInFlight = null;
  state.aiComputeStartPending = false;
  state.aiRunPhase = "";
  state.aiRunSessionId = "";
  state.aiRunSiteId = "";
  state.aiRunDeadlineAt = 0;
  state.aiRunRemainingMs = 0;
  state.aiRunResumeExpiresAt = 0;
  state.aiRunResumed = false;
}

function queueAiPreviewConfigSync(tabId: number | null | undefined, baseUrl: string) {
  if (!tabId || !baseUrl) {
    return;
  }
  pendingAiPreviewConfigSync = {
    tabId,
    baseUrl
  };
}

function flushPendingAiPreviewConfigSync() {
  if (!pendingAiPreviewConfigSync) {
    return;
  }
  const pending = pendingAiPreviewConfigSync;
  pendingAiPreviewConfigSync = null;
  void messages.sendTabMessageToTab(pending.tabId, {
    type: "configUpdated",
    baseUrl: pending.baseUrl
  }, {
    timeoutMs: 30000
  });
}

function setAiRunActiveState({
  sessionId = "",
  siteId = "",
  deadlineAt = Date.now() + AI_RUN_TIMEOUT_MS,
  resumed = false,
  phase = "starting"
}: AiRunActiveStateOptions = {}) {
  state.aiComputeStartPending = false;
  state.aiRequestInFlight = "compute";
  state.aiRunPhase = phase;
  state.aiRunSessionId = sessionId;
  state.aiRunSiteId = siteId ?? "";
  state.aiRunDeadlineAt = deadlineAt;
  state.aiRunRemainingMs = getAiRunRemainingMs(deadlineAt);
  state.aiRunResumed = Boolean(resumed);
  // A starting/resuming run has no preview sidebar; clear the popup-owned preview
  // latches so a missed prior close cannot keep a stale sidebar shown.
  state.previewOpenIntent = false;
  state.previewSuppressReopen = false;
  state.previewCloseMarkingRestoreUnconfirmed = false;
  // A fresh run is a marking-session transition: in-flight refreshUi passes
  // still holding pre-run reads must not publish/sync marking facts over it.
  bumpMarkingSessionEpoch();
  signalMarkingSession("run-started");
  startAiRunCountdownTimer();
}

async function loadPersistedAiRunRecord() {
  const response = await messages.sendRuntimeMessage({ type: "getPersistedAiRunRecord" });
  return normalizePersistedAiRunRecord(response && response.record);
}

async function clearPersistedAiRunRecord() {
  await messages.sendRuntimeMessage({ type: "clearPersistedAiRunRecord" });
}

async function syncAiComputeLock(active: boolean, expiresAt = 0) {
  const response = await messages.sendRuntimeMessage({
    type: "setAiComputeLockForTab",
    tabId: getCurrentPopupTabId(),
    active: Boolean(active),
    expiresAt,
    baseUrl: state.currentBaseUrl || ""
  });
  return Boolean(response && response.ok);
}

async function stopAiRun(options: StopAiRunOptions = {}) {
  const { unlockPage = true } = options;
  resetAiRunState();
  clearProjectedComputingAiState();
  await clearPersistedAiRunRecord();
  if (unlockPage) {
    await syncAiComputeLock(false);
  }
  // When the AI run just opened the Detected Content preview, the popup already
  // shows the preview sidebar. Refresh quietly so the generic "Refreshing popup
  // data..." busy curtain does not mask the freshly shown preview for the
  // duration of the (sometimes slow) post-run refresh.
  const currentView = uiModule.getViewState();
  const previewShowing = Boolean(currentView.previewBlocked || currentView.previewActive);
  const preserveCurrentDraftStatus = Boolean(previewShowing);
  await refreshUi({
    useBusyOverlay: false,
    preserveCurrentDraftStatus
  });
}

async function removePageMarkingFromRemote(options: RemotePageMarkingRemovalOptions = {}) {
  const {
    siteId = null,
    url = ""
  } = options;
  const pageUrl = typeof url === "string" ? url.trim() : "";
  if (!normalizeSiteIdValue(siteId) || !pageUrl) {
    return { ok: false, skipped: true };
  }
  const response = await messages.sendRuntimeMessage({
    type: "removeRemotePageMarking",
    siteId,
    url: pageUrl
  });
  return response && typeof response === "object" ? response : { ok: false };
}

async function pruneRemoteInvalidPageMarkings(options: RemoteInvalidPagePruneOptions = {}) {
  const {
    siteId = null,
    invalidUrls = []
  } = options;
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  if (!normalizedSiteId || !Array.isArray(invalidUrls) || !invalidUrls.length) {
    return;
  }
  for (const value of invalidUrls) {
    const pageUrl = typeof value === "string" ? value.trim() : "";
    if (!pageUrl) {
      continue;
    }
    const removalKey = `${normalizedSiteId}|${pageUrl}`;
    if (state.removedRemotePageKeys.has(removalKey)) {
      continue;
    }
    try {
      const result = await removePageMarkingFromRemote({
        siteId: normalizedSiteId,
        url: pageUrl
      });
      if (result.ok) {
        state.removedRemotePageKeys.add(removalKey);
      }
    } catch {
      // Ignore remote cleanup failures. Sync filtering still prevents re-uploading invalid pages.
    }
  }
}

async function pruneLocalInvalidPageMarkings(options: LocalInvalidPagePruneOptions = {}) {
  const {
    baseUrl = "",
    invalidUrls = []
  } = options;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !Array.isArray(invalidUrls) || !invalidUrls.length) {
    return [];
  }
  const exactInvalidUrls = new Set(
    invalidUrls
      .filter((url) => typeof url === "string" && url.trim())
      .map((url) => url.trim())
  );
  const normalizedInvalidUrls = new Set(
    Array.from(exactInvalidUrls)
      .map((url) => normalizeCandidatePageUrl(url))
      .filter(Boolean)
  );
  if (!exactInvalidUrls.size && !normalizedInvalidUrls.size) {
    return [];
  }
  const configs = await config.getConfigs();
  const sourceConfig = configs[normalizedBaseUrl];
  if (!sourceConfig || !sourceConfig.pageMarkings || typeof sourceConfig.pageMarkings !== "object") {
    return [];
  }
  const nextConfig = config.normalizeConfig(normalizedBaseUrl, sourceConfig).config;
  const removedUrls: string[] = [];
  Object.keys(nextConfig.pageMarkings || {}).forEach((url) => {
    const normalizedUrl = normalizeCandidatePageUrl(url);
    if (exactInvalidUrls.has(url) || (normalizedUrl && normalizedInvalidUrls.has(normalizedUrl))) {
      delete nextConfig.pageMarkings[url];
      removedUrls.push(url);
    }
  });
  if (removedUrls.length) {
    configs[normalizedBaseUrl] = nextConfig;
    await config.saveConfigs(configs);
  }
  return removedUrls;
}

async function repairLocalPageMarkingPageTypes(options: LocalPageTypeRepairOptions = {}) {
  const {
    baseUrl = "",
    repairedMarkedPages = []
  } = options;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !Array.isArray(repairedMarkedPages) || !repairedMarkedPages.length) {
    return [];
  }
  const repairsByUrl = new Map<string, string>(
    repairedMarkedPages
      .map((item) => {
        const url = normalizeCandidatePageUrl(item && item.url);
        const pageType = item && typeof item.pageType === "string"
          ? item.pageType.trim()
          : "";
        return url && pageType ? [url, pageType] as const : null;
      })
      .filter((item): item is readonly [string, string] => Boolean(item))
  );
  if (!repairsByUrl.size) {
    return [];
  }
  const configs = await config.getConfigs();
  const sourceConfig = configs[normalizedBaseUrl];
  if (!sourceConfig || !sourceConfig.pageMarkings || typeof sourceConfig.pageMarkings !== "object") {
    return [];
  }
  const nextConfig = config.normalizeConfig(normalizedBaseUrl, sourceConfig).config;
  const repairedUrls: string[] = [];
  Object.entries(nextConfig.pageMarkings || {}).forEach(([url, entry]) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const normalizedUrl = normalizeCandidatePageUrl(url);
    const repairedPageType = normalizedUrl ? repairsByUrl.get(normalizedUrl) : "";
    if (!repairedPageType || entry.pageType === repairedPageType) {
      return;
    }
    entry.pageType = repairedPageType;
    repairedUrls.push(url);
  });
  if (repairedUrls.length) {
    configs[normalizedBaseUrl] = nextConfig;
    await config.saveConfigs(configs);
  }
  return repairedUrls;
}

function getConfigLoadStatusTone(status: string): PopupTone {
  switch (status) {
    case "ok":
      return "success";
    case "not_found":
    case "auth_error":
      return "warning";
    case "error":
      return "danger";
    case "skipped":
    case "skipped_editor":
    case "skipped_missing_config":
    default:
      return "muted";
  }
}

function getConfigSaveStatusTone(label: string): PopupTone {
  switch (label) {
    case PopupText.page.savedAndSynced:
    case PopupText.page.revertedAndSynced:
    case PopupText.ai.selectorsUpdatedAndSynced:
    case PopupText.ai.submittedSelectors:
    case PopupText.ai.submittedSelectorsAndSynced:
      return "success";
    case PopupText.page.savedLocallySyncSkipped:
    case PopupText.page.savedLocallySyncPending:
    case PopupText.page.revertedLocallySyncSkipped:
    case PopupText.ai.selectorsUpdatedLocallySyncSkipped:
    case PopupText.ai.submittedSelectorsSyncSkipped:
      return "warning";
    case PopupText.page.saveFailed:
    case PopupText.page.revertFailed:
    case PopupText.page.savedLocallySyncFailed:
    case PopupText.page.savedAndSyncedRefreshFailed:
    case PopupText.page.revertedLocallySyncFailed:
    case PopupText.ai.selectorsUpdatedLocallySyncFailed:
    case PopupText.ai.submittedSelectorsSyncFailed:
      return "danger";
    case PopupText.page.noLocalChangesToSave:
    case PopupText.sync.unknown:
    default:
      return "muted";
  }
}

function updateLastConfigLoadStatus(
  result: { status?: string; baseUrl?: string } | null | undefined
) {
  const status = result && typeof result.status === "string" ? result.status : "";
  const baseUrl = result && typeof result.baseUrl === "string" ? result.baseUrl : "";
  const label = formatConfigLoadStatusLabel(status, baseUrl);
  state.lastConfigLoadStatusTone = getConfigLoadStatusTone(status);
  if (status === "skipped") {
    state.lastConfigLoadStatusText = label;
    return;
  }
  const at = formatSyncStatusTimestamp();
  state.lastConfigLoadStatusText = formatTimestampedStatus(label, at);
}

function updateLastConfigSaveStatus(label: string) {
  const safeLabel = typeof label === "string" && label ? label : PopupText.sync.unknown;
  state.lastConfigSaveStatusTone = getConfigSaveStatusTone(safeLabel);
  const at = formatSyncStatusTimestamp();
  state.lastConfigSaveStatusText = formatTimestampedStatus(safeLabel, at);
}

function isSuccessfulConfigSyncResult(syncResult: ConfigSyncResult | null | undefined) {
  return Boolean(syncResult && (syncResult.ok || syncResult.skipped));
}

function getCurrentPageUrl() {
  return (state.currentTab && state.currentTab.url) || "";
}

function buildPopupEnabledContext(tab: typeof state.currentTab = state.currentTab, baseUrl = state.currentBaseUrl): PopupEnabledContext {
  return {
    tabId: tab && typeof tab.id === "number" && Number.isFinite(tab.id) ? Math.trunc(tab.id) : null,
    pageUrl: tab && typeof tab.url === "string" ? tab.url : "",
    baseUrl: typeof baseUrl === "string" ? baseUrl : ""
  };
}

function isPopupEnabledContextCurrent(
  context: PopupEnabledContext | Record<string, unknown> | null,
  currentContext = buildPopupEnabledContext()
) {
  if (!context || typeof context !== "object") {
    return false;
  }
  return context.tabId === currentContext.tabId &&
    context.pageUrl === currentContext.pageUrl &&
    utils.sameBaseUrl(context.baseUrl || "", currentContext.baseUrl || "");
}

function setLastPopupEnabled(value: boolean | null, context = buildPopupEnabledContext()) {
  if (value === null) {
    state.lastPopupEnabled = null;
    state.lastPopupEnabledContext = null;
    return;
  }
  state.lastPopupEnabled = Boolean(value);
  state.lastPopupEnabledContext = { ...context };
}

function clearLastPopupEnabled() {
  setLastPopupEnabled(null);
}

interface InspectionStatusResponse {
  ok?: unknown;
  active?: unknown;
  pending?: unknown;
  markingEnabled?: unknown;
  lockClaimPending?: unknown;
  renderModeInspectionActive?: unknown;
  [key: string]: unknown;
}

interface PreviewRestoreRuntimeOptions {
  token?: unknown;
}

interface CurrentPageRuntimeStatus {
  inspectionStatus: InspectionStatusResponse | null;
  draftStatus: TabDraftStatusResponse | null;
  inspectionPending: boolean;
  reconciliationPending: boolean;
}

interface RuntimeStatusRefreshOptions {
  tabId?: unknown;
  baseUrl?: unknown;
  preserveDraft?: unknown;
}

interface RenderModeSetNavGuardState {
  startedAt: number;
  inspectionSeen: boolean;
}

async function clearCurrentPageSaveReconciliation(baseUrl = state.currentBaseUrl) {
  const pageUrl = getCurrentPageUrl();
  if (!baseUrl || !pageUrl) {
    return;
  }
  await config.clearPageSaveReconciliation(baseUrl, pageUrl);
  if (baseUrl !== state.currentBaseUrl && state.currentBaseUrl) {
    await config.clearPageSaveReconciliation(state.currentBaseUrl, pageUrl);
  }
  state.currentPageSaveReconciliation = null;
  state.currentPageSaveReconciliationPending = false;
  const contentBaseUrl = state.currentBaseUrl || baseUrl;
  // Notify content best-effort: the popup-local reconciliation state is already
  // cleared, so do not block the save/discard spinner on a slow tab roundtrip.
  // Content re-reports its own pending fact, so a missed clear self-heals.
  void messages.sendTabMessageWithRetry({
    type: "clearPageSaveReconciliation",
    baseUrl: contentBaseUrl,
    pageUrl
  }, 2);
}

interface TabDraftStatusResponse {
  ok?: unknown;
  entry?: PageMarkingEntry | null;
  savedEntry?: PageMarkingEntry | null;
  dirty?: unknown;
  reconciliation?: PageSaveReconciliation | null;
  reconciliationPending?: unknown;
  [key: string]: unknown;
}

interface PreviewCloseState extends PreviewRestoreMessage {
  active?: unknown;
  markingEnabled?: unknown;
  baseUrl?: unknown;
  pageType?: unknown;
  draftStatus?: unknown;
}

type PreviewCloseCommandResult = PreviewCloseState & {
  previewState?: PreviewCloseState | null;
};

function applyDraftStatusToPopupState(draftStatus: TabDraftStatusResponse | null) {
  if (!draftStatus || !draftStatus.ok) {
    return false;
  }
  state.currentDraftEntry = draftStatus.entry || null;
  state.currentSavedEntry = draftStatus.savedEntry || null;
  state.currentDraftDirty = Boolean(draftStatus.dirty);
  state.currentDraftAvailable = true;
  state.currentPageSaveReconciliation = draftStatus.reconciliation || null;
  state.currentPageSaveReconciliationPending = Boolean(draftStatus.reconciliationPending);
  return true;
}

function clearPreviewRestoreFallbackTimer() {
  if (!state.previewRestoreFallbackTimer) {
    return;
  }
  window.clearTimeout(state.previewRestoreFallbackTimer);
  state.previewRestoreFallbackTimer = 0;
}

function clearPreviewRestorePending() {
  state.previewRestorePending = false;
  clearPreviewRestoreFallbackTimer();
}

function settlePreviewRestoreClosed(token: number | null = null, markApplied = true) {
  clearPreviewRestorePending();
  if (markApplied && token !== null) {
    state.previewRestoreAppliedToken = Math.max(state.previewRestoreAppliedToken, token);
  }
  // The preview is closed from the popup's perspective. Drop the open-intent and
  // raise the reopen guard so a lagging getAiPreviewState probe (content's async
  // exit can still report the preview active for seconds on a heavy page) cannot
  // resurrect the sidebar in any later refreshUi; the guard stays up until the
  // popup opens the next preview.
  state.previewOpenIntent = false;
  state.previewSuppressReopen = true;
  // Read BEFORE clearMarkingSessionSnapshot below: a present snapshot marks this
  // close as a marking-restored exit whose content-side re-enable is still
  // unobserved (see previewCloseMarkingRestoreUnconfirmed in src/popup/state.ts).
  // Only ever RAISE the latch here: the same close settles twice (the popup's
  // runtime settle first, then content's token-less aiPreviewClosed push a few
  // seconds later, after the snapshot is already cleared) and the duplicate
  // must not disarm a latch still awaiting content's re-enable confirmation —
  // that disarm re-exposed the #5/#14 collapse (round-4 trace, epoch bump 11).
  state.previewCloseMarkingRestoreUnconfirmed =
    state.previewCloseMarkingRestoreUnconfirmed || Boolean(state.previewMarkingSessionSnapshot);
  // The settle is a marking-session transition: passes reading pre-exit state
  // must not publish/sync marking facts over the restored session.
  bumpMarkingSessionEpoch();
  signalMarkingSession("exit-settled");
  resetPreviewItemsLatch();
  clearMarkingSessionSnapshot();
  uiModule.setViewState(buildPreviewViewState(null));
  publishCurrentTabSessionFacts({
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false
  });
}

function getPreviewRestoreToken(message?: PreviewRestoreMessage): number | null;
function getPreviewRestoreToken(message = {}) {
  const previewMessage = (message && typeof message === "object" ? message : {}) as PreviewRestoreMessage;
  return Number.isFinite(previewMessage.previewRestoreToken)
    ? Math.trunc(Number(previewMessage.previewRestoreToken))
    : null;
}

function isPreviewRestoreMessageCurrent(message?: PreviewRestoreMessage): boolean;
function isPreviewRestoreMessageCurrent(message = {}) {
  const previewMessage = (message && typeof message === "object" ? message : {}) as PreviewRestoreMessage;
  const messageToken = getPreviewRestoreToken(previewMessage);
  if (
    messageToken !== null &&
    messageToken <= state.previewRestoreAppliedToken
  ) {
    return false;
  }
  if (
    state.previewRestorePending &&
    messageToken !== null &&
    messageToken !== state.previewRestoreToken
  ) {
    return false;
  }
  const messagePageUrl = typeof previewMessage.pageUrl === "string" ? previewMessage.pageUrl : "";
  const currentPageUrl = state.currentTab && typeof state.currentTab.url === "string"
    ? state.currentTab.url
    : state.lastPopupPageUrl;
  return !messagePageUrl || !currentPageUrl || messagePageUrl === currentPageUrl;
}

async function finalizePreviewRestoreFromRuntime(options: PreviewRestoreRuntimeOptions = {}): Promise<void> {
  const token = Number.isFinite(options.token)
    ? Math.trunc(Number(options.token))
    : state.previewRestoreToken;
  if (!state.previewRestorePending || token !== state.previewRestoreToken) {
    return;
  }
  if (restoreMarkingSessionSnapshot()) {
    settlePreviewRestoreClosed(token);
    await refreshUi({
      useBusyOverlay: false,
      skipPropertyLockFetch: true,
      preserveCurrentDraftStatus: true
    }).catch(() => null);
    return;
  }
  await helpers.ensureActiveTab({ requireId: true }).catch(() => null);
  const currentTabId = state.currentTab ? state.currentTab.id : null;
  const tabId = Number.isFinite(currentTabId)
    ? Math.trunc(Number(currentTabId))
    : null;
  const baseUrl = state.currentBaseUrl || "";
  if (!tabId || !baseUrl) {
    settlePreviewRestoreClosed(token);
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true }).catch(() => null);
    return;
  }
  const [inspectionStatus, draftStatus] = await Promise.all([
    messages.sendTabMessageWithRetry({ type: "getInspectionStatus" }, 3).catch(() => null),
    messages.sendTabMessageWithRetry({ type: "getPageDraftStatus", baseUrl }, 3).catch(() => null)
  ]) as [InspectionStatusResponse | null, TabDraftStatusResponse | null];
  if (!state.previewRestorePending || token !== state.previewRestoreToken) {
    return;
  }
  const hasDraftStatus = applyDraftStatusToPopupState(draftStatus);
  const markingEnabled = Boolean(
    inspectionStatus &&
      inspectionStatus.ok &&
      inspectionStatus.markingEnabled
  );
  settlePreviewRestoreClosed(token);
  await refreshUi({
    useBusyOverlay: false,
    skipPropertyLockFetch: true,
    preserveCurrentDraftStatus: Boolean(markingEnabled && hasDraftStatus)
  }).catch(() => null);
}

async function finalizePreviewRestoreHard(options: PreviewRestoreRuntimeOptions = {}): Promise<void> {
  const token = Number.isFinite(options.token)
    ? Math.trunc(Number(options.token))
    : state.previewRestoreToken;
  if (!state.previewRestorePending || token !== state.previewRestoreToken) {
    return;
  }
  // Force-clear the wedge locally, but keep the token reappliable so a slow
  // authoritative close payload for the same restore can still land afterward.
  settlePreviewRestoreClosed(token, false);
  await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true }).catch(() => null);
}

function schedulePreviewRestoreFallback(token: number, delayMs = AI_PREVIEW_RESTORE_FALLBACK_MS) {
  clearPreviewRestoreFallbackTimer();
  state.previewRestoreFallbackTimer = window.setTimeout(() => {
    state.previewRestoreFallbackTimer = 0;
    finalizePreviewRestoreHard({ token }).then().catch(() => null);
  }, Math.max(50, delayMs));
}

function beginPreviewRestorePending() {
  state.previewRestoreToken += 1;
  state.previewRestorePending = true;
  schedulePreviewRestoreFallback(state.previewRestoreToken);
  clearLastPopupEnabled();
  publishCurrentTabSessionFacts({
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: true
  });
  uiModule.setViewState({
    previewWillRestoreMarking: false
  });
  return state.previewRestoreToken;
}

async function applyPreviewClosedState(closeState?: PreviewCloseState): Promise<void>;
async function applyPreviewClosedState(closeState = {}) {
  const normalizedCloseState = (closeState && typeof closeState === "object"
    ? closeState
    : {}) as PreviewCloseState;
  const messageToken = getPreviewRestoreToken(normalizedCloseState);
  if (!isPreviewRestoreMessageCurrent(normalizedCloseState)) {
    return;
  }
  const draftStatus = normalizedCloseState.draftStatus && typeof normalizedCloseState.draftStatus === "object"
    ? normalizedCloseState.draftStatus as TabDraftStatusResponse
    : null;
  const nextBaseUrl = typeof normalizedCloseState.baseUrl === "string"
    ? normalizedCloseState.baseUrl
    : "";
  const markingEnabled = Boolean(normalizedCloseState.markingEnabled);
  if (nextBaseUrl) {
    state.currentBaseUrl = nextBaseUrl;
  }
  const hasDraftStatus = markingEnabled && applyDraftStatusToPopupState(draftStatus);
  settlePreviewRestoreClosed(messageToken);
  await refreshUi({
    useBusyOverlay: false,
    skipPropertyLockFetch: true,
    preserveCurrentDraftStatus: Boolean(hasDraftStatus)
  }).catch(() => null);
}

function previewCloseIndicatesNavigation(closeState?: PreviewCloseState | null): boolean;
function previewCloseIndicatesNavigation(closeState: PreviewCloseState | null | undefined = {}) {
  const normalizedCloseState = (closeState && typeof closeState === "object"
    ? closeState
    : {}) as PreviewCloseState;
  const nextBaseUrl = typeof normalizedCloseState.baseUrl === "string"
    ? normalizedCloseState.baseUrl
    : "";
  return Boolean(
    state.currentBaseUrl &&
      nextBaseUrl &&
      !utils.sameBaseUrl(nextBaseUrl, state.currentBaseUrl)
  );
}

async function refreshCurrentPageRuntimeStatus(
  options: RuntimeStatusRefreshOptions = {}
): Promise<CurrentPageRuntimeStatus> {
  const tabId = Number.isFinite(options.tabId)
    ? Math.trunc(Number(options.tabId))
    : state.currentTab && Number.isFinite(state.currentTab.id)
      ? Math.trunc(Number(state.currentTab.id))
      : null;
  const baseUrl = typeof options.baseUrl === "string" && options.baseUrl
    ? options.baseUrl
    : state.currentBaseUrl;
  const preserveDraft = Boolean(options.preserveDraft);
  if (!tabId) {
    return {
      inspectionStatus: null,
      draftStatus: null,
      inspectionPending: false,
      reconciliationPending: false
    };
  }

  const [inspectionStatus, draftStatus] = await Promise.all([
    messages.sendTabMessageToTab(tabId, { type: "getInspectionStatus" }).catch(() => null),
    baseUrl
      ? messages.sendTabMessageToTab(tabId, {
        type: "getPageDraftStatus",
        baseUrl
      }).catch(() => null)
      : Promise.resolve(null)
  ]) as [InspectionStatusResponse | null, TabDraftStatusResponse | null];

  // After an authoritative preview close, the caller has already applied the
  // restored draft snapshot from the close payload. Re-probing getPageDraftStatus
  // here can transiently return a re-derived entry (the content script is still
  // finishing its restore) whose fingerprint differs, which would flip
  // aiRunUpToDate false and blanket-disable the marking buttons. preserveDraft
  // keeps the authoritative draft while still refreshing inspection/reconciliation.
  if (!preserveDraft) {
    applyDraftStatusToPopupState(draftStatus);
  }

  const inspectionPending = Boolean(
    inspectionStatus &&
      inspectionStatus.ok &&
      (inspectionStatus.active || inspectionStatus.pending)
  );
  const reconciliationPending = Boolean(
    draftStatus &&
      draftStatus.ok &&
      draftStatus.reconciliationPending
  );

  return {
    inspectionStatus,
    draftStatus,
    inspectionPending,
    reconciliationPending
  };
}

function waitForRetryDelay(delayMs?: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

async function waitForEnableMarkingInspectionToSettle(
  tabId: number,
  baseUrl: string | null
): Promise<InspectionSettleResult> {
  let inspectionObserved = false;
  let responseObserved = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [inspectionStatus, draftStatus] = await Promise.all([
      messages.sendTabMessageToTab(tabId, { type: "getInspectionStatus" }),
      baseUrl
        ? messages.sendTabMessageToTab(tabId, {
          type: "getPageDraftStatus",
          baseUrl
        })
        : Promise.resolve(null)
    ]) as [InspectionStatusResponse | null, TabDraftStatusResponse | null];
    if (
      (inspectionStatus && inspectionStatus.ok) ||
      (draftStatus && draftStatus.ok)
    ) {
      responseObserved = true;
    }
    const inspectionPending = Boolean(
      inspectionStatus &&
        inspectionStatus.ok &&
        (inspectionStatus.active || inspectionStatus.pending)
    );
    const reconciliationPending = Boolean(
      draftStatus &&
        draftStatus.ok &&
        draftStatus.reconciliationPending &&
        draftStatus.reconciliation &&
        draftStatus.reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
    );
    if (inspectionPending || reconciliationPending) {
      inspectionObserved = true;
      noteRenderModeSetNavGuardInspection(tabId);
    } else if (inspectionObserved || (responseObserved && attempt >= 2) || attempt >= 6) {
      return {
        inspectionObserved,
        responseObserved,
        settled: true,
        attempts: attempt + 1
      };
    }
    await waitForRetryDelay(getRetryDelayMs(attempt, 150, 900));
  }
  return {
    inspectionObserved,
    responseObserved,
    settled: false,
    attempts: 12
  };
}

function clearNavigationInspectionSettlePoll(tabId: number | null): void {
  if (tabId === null) {
    return;
  }
  const timer = popupNavigationInspectionSettlePollByTabId.get(tabId) as ReturnType<typeof window.setTimeout> | undefined;
  if (!timer) {
    return;
  }
  window.clearTimeout(timer);
  popupNavigationInspectionSettlePollByTabId.delete(tabId);
}

function clearNavigationInspectionSettlePollsExcept(tabIdToKeep: number | null = null) {
  popupNavigationInspectionSettlePollByTabId.forEach((timer, tabId) => {
    if (tabIdToKeep !== null && tabId === tabIdToKeep) {
      return;
    }
    window.clearTimeout(timer);
    popupNavigationInspectionSettlePollByTabId.delete(tabId);
  });
}

function startRenderModeSetNavGuard(tabId: number | null): void {
  if (!tabId) {
    return;
  }
  popupRenderModeSetNavGuardByTabId.set(tabId, {
    startedAt: Date.now(),
    inspectionSeen: false
  });
  logPopupSpinnerDebug("render-mode-set-nav-guard-start", { tabId });
}

function clearRenderModeSetNavGuard(tabId: number | null): void {
  if (!tabId) {
    return;
  }
  if (popupRenderModeSetNavGuardByTabId.delete(tabId)) {
    logPopupSpinnerDebug("render-mode-set-nav-guard-clear", { tabId });
  }
}

function noteRenderModeSetNavGuardInspection(tabId: number | null): void {
  if (!tabId) {
    return;
  }
  const guard = popupRenderModeSetNavGuardByTabId.get(tabId) as RenderModeSetNavGuardState | undefined;
  if (!guard || guard.inspectionSeen) {
    return;
  }
  guard.inspectionSeen = true;
  popupRenderModeSetNavGuardByTabId.set(tabId, guard);
  logPopupSpinnerDebug("render-mode-set-nav-guard-observed", { tabId });
}

function shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId: number | null): boolean {
  if (!tabId) {
    return false;
  }
  const guard = popupRenderModeSetNavGuardByTabId.get(tabId) as RenderModeSetNavGuardState | undefined;
  if (!guard) {
    return false;
  }
  if (guard.inspectionSeen) {
    clearRenderModeSetNavGuard(tabId);
    return false;
  }
  if (Date.now() - guard.startedAt >= RENDER_MODE_SET_NAV_GUARD_MAX_MS) {
    logPopupSpinnerDebug("render-mode-set-nav-guard-timeout", { tabId });
    clearRenderModeSetNavGuard(tabId);
    return false;
  }
  return true;
}

// True while a render-mode Set reload is still in flight (guard armed and not yet
// expired). Used by the tab onUpdated listener so it keeps the navInspect overlay
// alive across the post-Set reload even in silent mode, where the tab is not
// marking-enabled and the listener would otherwise tear the overlay down.
function isRenderModeSetNavGuardActive(tabId: number | null): boolean {
  if (!tabId) {
    return false;
  }
  const guard = popupRenderModeSetNavGuardByTabId.get(tabId) as RenderModeSetNavGuardState | undefined;
  if (!guard) {
    return false;
  }
  if (Date.now() - guard.startedAt >= RENDER_MODE_SET_NAV_GUARD_MAX_MS) {
    logPopupSpinnerDebug("render-mode-set-nav-guard-timeout", { tabId });
    clearRenderModeSetNavGuard(tabId);
    return false;
  }
  return true;
}

function scheduleNavigationInspectionSettlePoll(tabId: number | null, baseUrl: string | null): void {
  if (!tabId) {
    return;
  }
  clearNavigationInspectionSettlePoll(tabId);

  let attempt = 0;
  const maxAttempts = 30;
  const run = async () => {
    if (popupNavigationInspectionOverlayTabId !== tabId) {
      clearNavigationInspectionSettlePoll(tabId);
      return;
    }
    attempt += 1;
    const [inspectionStatus, draftStatus] = await Promise.all([
      messages.sendTabMessageToTab(tabId, { type: "getInspectionStatus" }).catch(() => null),
      baseUrl
        ? messages.sendTabMessageToTab(tabId, { type: "getPageDraftStatus", baseUrl }).catch(() => null)
        : Promise.resolve(null)
    ]) as [Record<string, unknown> | null, TabDraftStatusResponse | null];
    const inspectionPending = Boolean(
      inspectionStatus &&
      inspectionStatus.ok &&
      (inspectionStatus.active || inspectionStatus.pending)
    );
    const reconciliationPending = Boolean(
      draftStatus &&
      draftStatus.ok &&
      draftStatus.reconciliationPending &&
      draftStatus.reconciliation &&
      draftStatus.reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
    );
    if (inspectionPending || reconciliationPending) {
      noteRenderModeSetNavGuardInspection(tabId);
    }
    logPopupSpinnerDebug("nav-settle-poll", {
      tabId,
      attempt,
      inspectionPending,
      reconciliationPending,
      inspectionStatusOk: Boolean(inspectionStatus && inspectionStatus.ok),
      draftStatusOk: Boolean(draftStatus && draftStatus.ok)
    });
    if (!inspectionPending && !reconciliationPending) {
      if (shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId)) {
        logPopupSpinnerDebug("nav-settle-poll-hold-for-render-mode-set", { tabId, attempt });
      } else {
        reportNavigationInspectionSettledToBrain(tabId, "nav-settle-poll-clear");
        clearNavigationInspectionSettlePoll(tabId);
        void refreshUi({ useBusyOverlay: false });
        return;
      }
    }
    if (attempt >= maxAttempts) {
      logPopupSpinnerDebug("nav-settle-poll-timeout", { tabId, attempt });
      reportNavigationInspectionSettledToBrain(tabId, "nav-settle-poll-timeout");
      clearNavigationInspectionSettlePoll(tabId);
      void refreshUi({ useBusyOverlay: false });
      return;
    }
    // No re-polling: the content `inspectionSettled` event ends this overlay
    // deterministically. Arm a single bounded fail-open as last resort only.
    const timer = window.setTimeout(() => {
      popupNavigationInspectionSettlePollByTabId.delete(tabId);
      if (popupNavigationInspectionOverlayTabId !== tabId) {
        return;
      }
      logPopupSpinnerDebug("nav-settle-failopen", { tabId });
      reportNavigationInspectionSettledToBrain(tabId, "nav-settle-failopen");
      void refreshUi({ useBusyOverlay: false });
    }, NAV_INSPECTION_SETTLE_FAILOPEN_MS);
    popupNavigationInspectionSettlePollByTabId.set(tabId, timer);
  };
  const timer = window.setTimeout(() => {
    void run();
  }, 350);
  popupNavigationInspectionSettlePollByTabId.set(tabId, timer);
  logPopupSpinnerDebug("nav-settle-poll-scheduled", { tabId, baseUrl });
}

function beginNavigationInspectionOverlay(tabId: number | null): boolean {
  if (!tabId) {
    return false;
  }
  clearNavigationInspectionSettlePollsExcept(tabId);
  popupNavigationInspectionOverlayTabId = tabId;
  clearNavigationInspectionSettlePoll(tabId);
  // P4 step 4.3: the BRAIN engages the navigation-inspection spinner from the
  // operation lifecycle (both surfaces); the popup only tracks that it
  // initiated the overlay so its settle reporting stays scoped to this tab.
  popupNavigationInspectionOverlayStarted = true;
  return true;
}

function endNavigationInspectionOverlay(tabId = popupNavigationInspectionOverlayTabId) {
  if (
    popupNavigationInspectionOverlayTabId !== null &&
    tabId !== null &&
    popupNavigationInspectionOverlayTabId !== tabId
  ) {
    return;
  }
  reportNavigationInspectionSettledToBrain(tabId, "nav-overlay-end");
}

function waitForPopupUiPaint() {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    window.setTimeout(finish, 75);
    if (typeof window.requestAnimationFrame !== "function") {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(finish);
    });
  });
}

function isRetryableHttpStatus(status: number | null | undefined): boolean {
  const normalizedStatus = Number(status);
  if (!Number.isFinite(normalizedStatus) || normalizedStatus <= 0) {
    return true;
  }
  return RETRYABLE_HTTP_STATUSES.has(normalizedStatus);
}

function getRetryDelayMs(attempt: number, baseDelayMs = 450, maxDelayMs = 10000): number {
  const boundedAttempt = Math.max(0, Number(attempt) || 0);
  const exponentialDelay = Math.min(baseDelayMs * (2 ** boundedAttempt), maxDelayMs);
  const jitter = Math.round(exponentialDelay * (0.1 + (Math.random() * 0.2)));
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function clearRemoteConfigRetryTimer() {
  if (!state.remoteConfigConnectionRetryTimer) {
    return;
  }
  window.clearTimeout(state.remoteConfigConnectionRetryTimer);
  state.remoteConfigConnectionRetryTimer = 0;
}

function clearRemoteConfigLoadCacheForTab(tabId: unknown) {
  const normalizedTabId = Number.isFinite(tabId) ? Math.trunc(tabId as number) : 0;
  if (!normalizedTabId) {
    return;
  }
  const fenceRequestId = state.remoteConfigLoadRequestCounter + 1;
  state.remoteConfigLoadRequestCounter = fenceRequestId;
  state.remoteConfigTabFenceByTabId.set(normalizedTabId, fenceRequestId);
  for (const key of state.remoteConfigLoadResultByKey.keys()) {
    if (key.startsWith(`${normalizedTabId}|`)) {
      state.remoteConfigLoadResultByKey.delete(key);
    }
  }
  for (const key of state.remoteConfigLatestRequestIdByPageLoadKey.keys()) {
    if (key.startsWith(`${normalizedTabId}|`)) {
      state.remoteConfigLatestRequestIdByPageLoadKey.delete(key);
    }
  }
}

function clearRemoteConfigLoadCache() {
  const fenceRequestId = state.remoteConfigLoadRequestCounter + 1;
  state.remoteConfigLoadRequestCounter = fenceRequestId;
  state.remoteConfigGlobalFenceRequestId = fenceRequestId;
  state.remoteConfigLoadResultByKey.clear();
  state.remoteConfigLatestRequestIdByPageLoadKey.clear();
}

function setRemoteConfigConnectionIssue(active: boolean): void {
  const nextActive = Boolean(active);
  state.remoteConfigConnectionIssue = nextActive;
  if (!nextActive) {
    clearRemoteConfigRetryTimer();
    // A clean (ok/not_found) load recovered the connection, so restart the
    // exponential backoff ladder — otherwise a later re-failure would wait at
    // the 30s cap instead of the 2.5s base delay.
    state.remoteConfigRetryAttempt = 0;
  }
}

function isPopupCommandSuccess<T extends object>(
  response: unknown
): response is PopupCommandSuccess<T> {
  return Boolean(
    response &&
      typeof response === "object" &&
      "ok" in response &&
      response.ok &&
      "result" in response &&
      response.result &&
      typeof response.result === "object"
  );
}

function getPreviewStatePayload<T extends object>(
  result: (T & { previewState?: T | null }) | null
): T | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  return result.previewState && typeof result.previewState === "object"
    ? result.previewState
    : result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function shouldSkipRemoteConfigLoadForPropertyEditor(siteId: unknown): boolean {
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  return Boolean(
    normalizedSiteId &&
      state.propertyLockSiteId === normalizedSiteId &&
      state.propertyLockState &&
      state.propertyLockState.isEditor
  );
}

function updateLoginActionState(patch = {}) {
  const view = { ...uiModule.getViewState(), ...patch };
  const emailValue = (view.loginEmailValue || "").trim();
  const passwordValue = view.loginPasswordValue || "";
  const aiBusy = Boolean(view.aiControlsBusy || view.isBusy);
  const loginCredentialsEnabled =
    view.stageBaseReadOnly && Boolean(normalizeStageBase(view.stageBaseValue || ""));

  uiModule.setViewState({
    ...patch,
    loginActionDisabled:
      aiBusy ||
      !loginCredentialsEnabled ||
      !isValidEmail(emailValue) ||
      !passwordValue.trim()
  });
}

async function invalidateTokenAndLockConfiguration(showToast = true) {
  await clearGlobalToken();
  clearRemoteConfigLoadCache();
  state.currentView = uiModule.View.Configuration;
  state.configViewLocked = true;
  uiModule.setViewState({
    currentView: state.currentView,
    loginStatusText: PopupText.authentication.statusLoginRequired,
    loginStatusTone: "warning"
  });
  if (showToast) {
    uiModule.showToast(PopupText.authentication.toastExpired);
  }
}

async function validateStoredToken(options: ValidateStoredTokenOptions = {}) {
  const { force = false, showToastOnInvalid = true } = options;
  if (state.tokenValidationInFlight) {
    return true;
  }
  const { tokenValue, stageBaseValue } = await helpers.loadGlobalAiSettings();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  if (!tokenValue || !normalizedStageBaseValue) {
    return Boolean(tokenValue);
  }
  const now = Date.now();
  if (!force && now - state.lastTokenValidationAt < TOKEN_VALIDATION_INTERVAL_MS) {
    return true;
  }
  state.lastTokenValidationAt = now;
  state.tokenValidationInFlight = true;
  try {
    const response = await messages.sendRuntimeMessage({
      type: "validateAuthToken",
      stageBase: normalizedStageBaseValue
    });
    if (response && response.ok && response.valid === false) {
      await invalidateTokenAndLockConfiguration(showToastOnInvalid);
      return false;
    }
    return true;
  } catch {
    return true;
  } finally {
    state.tokenValidationInFlight = false;
  }
}

async function clearFocusedElement() {
  await messages.sendTabMessage({ type: "clearFocus" });
}

function getEditableFieldState(options: EditableFieldStateOptions): EditableFieldState {
  const {
    inputRef,
    currentValue,
    value,
    isSet = false,
    editMode = false,
    suggestedValue,
    preserveCurrentValueWhileEditing = false,
    noticeUnset = "",
    noticeEdit = ""
  } = options;
  const isEditing = !isSet || editMode;
  const isFocused = inputRef && document.activeElement === inputRef;
  let nextValue = typeof currentValue === "string" ? currentValue : "";

  if (!isEditing) {
    nextValue = value || "";
  } else if (!preserveCurrentValueWhileEditing && !isFocused) {
    nextValue = isSet ? value || "" : suggestedValue || "";
  }

  let noticeText = "";
  let noticeVisible = false;
  if (!isSet) {
    noticeText = noticeUnset;
    noticeVisible = true;
  } else if (editMode) {
    noticeText = noticeEdit;
    noticeVisible = true;
  }

  return { isEditing, isReady: isSet && !editMode, value: nextValue, noticeText, noticeVisible };
}

function isCurrentRenderModeReady() {
  return Boolean(
    state.currentBaseUrl &&
    state.currentBaseUrlHasConfirmedRenderMode &&
    !state.renderModeEditMode
  );
}

function getCurrentSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return normalizeAiSelectorSet(null);
  }
  return normalizeAiSelectorSet(sourceConfig && sourceConfig.selectors);
}

function getLastSubmittedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return normalizeAiSelectorSet(null);
  }
  return config.areCurrentSelectorsSubmitted(sourceConfig)
    ? normalizeAiSelectorSet(sourceConfig && sourceConfig.selectors)
    : normalizeAiSelectorSet(null);
}

function getLatestAvailableSelectorsFromConfig(sourceConfig = state.currentConfig) {
  return config.getNewestConfigSelectorSet(sourceConfig).selectorSet;
}

function hasCalculatedSelectorsFromConfig(sourceConfig = state.currentConfig) {
  if (!config.isSelectorSetCurrentForRenderMode(sourceConfig, "selectors")) {
    return false;
  }
  const updatedAt = config.normalizeEntryTimestamp(
    sourceConfig && sourceConfig.selectorsUpdatedAt
  );
  if (updatedAt === config.PAGE_TIMESTAMP_FALLBACK) {
    return false;
  }
  return combineAiSelectorSet(sourceConfig && sourceConfig.selectors).length > 0;
}

async function hideConsentForRenderModeInspection(
  targetTabId: number | null | undefined = state.currentTab && state.currentTab.id
) {
  const tabId = typeof targetTabId === "number" && Number.isFinite(targetTabId)
    ? Math.trunc(targetTabId)
    : null;
  if (!tabId) {
    return false;
  }

  const sendHideMessageWithRetry = async (attempts: number) => {
    for (let index = 0; index < attempts; index += 1) {
      const response = await requestPopupRenderModeHideConsent(tabId).catch(() => null);
      if (response) {
        return response;
      }
      await messages.delay(250);
    }
    return null;
  };

  let hideResponse = await sendHideMessageWithRetry(2);
  if (!hideResponse || !hideResponse.ok) {
    await messages.requestTabBootstrapContent(tabId);
    hideResponse = await sendHideMessageWithRetry(3);
  }
  return Boolean(hideResponse && hideResponse.ok);
}

async function ensureContentReadyForRenderModeInspection(tabId: number | null) {
  if (!tabId) {
    return false;
  }
  // Keep the ready wait bounded so the render-mode popup spinner does not sit
  // for too long on slow reloads (notably the Without JavaScript path), while
  // still giving content-main a fair chance to come up post-navigation.
  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await messages.requestTabBootstrapContent(tabId);
    const status = await messages.sendTabMessageToTab(tabId, {
      type: "getInspectionStatus"
    }).catch(() => null);
    if (status && status.ok) {
      return true;
    }
    if (attempt + 1 < maxAttempts) {
      await messages.delay(250);
    }
  }
  return false;
}

async function reconcilePropertyLockAfterRenderModeReload() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    return;
  }
  const siteId = normalizeSiteIdValue(state.propertyLockSiteId);
  if (!siteId) {
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_TAKE_LOCK, {
    renderModeInspectionReconnect: true
  }).catch(() => null);
  // Poll the snapshot until the content re-establishes the lock connection (or
  // attempts run out). INACTIVE means no active lock (nothing to reconnect), so
  // treat it as settled alongside CONNECTED; keep polling while CONNECTING or
  // UNAVAILABLE so a transient post-reload disconnect resolves on its own.
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await refreshPropertyLockSnapshot(siteId).catch(() => null);
    setPropertyLockViewStateFromLocalProjection();
    const status = state.propertyLockConnectionStatus;
    if (
      status === PROPERTY_LOCK_CONNECTION_CONNECTED ||
      status === PROPERTY_LOCK_CONNECTION_INACTIVE
    ) {
      break;
    }
    if (attempt + 1 < maxAttempts) {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  }
  await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
}

function buildTodoExpansionContextKey(tabId: number | null = null, baseUrl: string = "") {
  const normalizedTabId = tabId || (state.currentTab && state.currentTab.id) || null;
  const normalizedBaseUrl = typeof baseUrl === "string" && baseUrl
    ? baseUrl
    : state.currentBaseUrl;
  return normalizedTabId && normalizedBaseUrl
    ? JSON.stringify([normalizedTabId, normalizedBaseUrl])
    : "";
}

function getTodoExpansionStateFromView() {
  const view = uiModule.getViewState();
  return {
    todoSectionExpanded: Boolean(view.todoSectionExpanded),
    todoSubsectionsExpanded: {
      ...(view.todoSubsectionsExpanded && typeof view.todoSubsectionsExpanded === "object"
        ? view.todoSubsectionsExpanded
        : {})
    }
  };
}

function saveCurrentTodoExpansionState() {
  const key = state.currentTodoExpansionKey || buildTodoExpansionContextKey();
  if (!key) {
    return;
  }
  if (!(state.todoExpansionStateByContext instanceof Map)) {
    state.todoExpansionStateByContext = new Map();
  }
  if (state.todoExpansionStateByContext.has(key)) {
    state.todoExpansionStateByContext.delete(key);
  }
  state.todoExpansionStateByContext.set(key, getTodoExpansionStateFromView());
  const overflowCount = state.todoExpansionStateByContext.size - TODO_EXPANSION_CONTEXT_LIMIT;
  if (overflowCount > 0) {
    const keyIterator = state.todoExpansionStateByContext.keys();
    for (let index = 0; index < overflowCount; index += 1) {
      const oldestKey = keyIterator.next().value;
      if (oldestKey !== undefined) {
        state.todoExpansionStateByContext.delete(oldestKey);
      }
    }
  }
}

function getCollapsedTodoExpansionState() {
  return {
    todoControlsMenuOpen: false,
    todoSectionExpanded: false,
    todoSubsectionsExpanded: {}
  };
}

function getSavedTodoExpansionState(key: string): TodoExpansionViewState | null {
  if (!key || !(state.todoExpansionStateByContext instanceof Map)) {
    return null;
  }
  const saved = state.todoExpansionStateByContext.get(key) as TodoExpansionState | undefined;
  if (!saved || typeof saved !== "object") {
    return null;
  }
  // Refresh insertion order so recently restored contexts are evicted last.
  state.todoExpansionStateByContext.delete(key);
  state.todoExpansionStateByContext.set(key, saved);
  return {
    todoControlsMenuOpen: false,
    todoSectionExpanded: Boolean(saved.todoSectionExpanded),
    todoSubsectionsExpanded: {
      ...(saved.todoSubsectionsExpanded && typeof saved.todoSubsectionsExpanded === "object"
        ? saved.todoSubsectionsExpanded
        : {})
    }
  };
}

function collapseTodoListForAutoCollapse() {
  if (uiModule.getViewState().todoAutoCollapse) {
    uiModule.collapseTodoList();
  }
}

async function refreshUiInner(options: PopupRefreshOptions = {}) {
  const skipPropertyLockFetch = Boolean(options.skipPropertyLockFetch);
  const propertyPageTypesRefreshChanged = Boolean(options.propertyPageTypesRefreshChanged);
  const preserveCurrentDraftStatus = Boolean(options.preserveCurrentDraftStatus);
  if (!state.currentTab) {
    return;
  }
  // Marking-session pass epoch (#5/#14): this pass's tab reads are only
  // trustworthy for marking-state EFFECTS (publishing isEnabled/
  // silentModeActive, syncing/forcing an enabled flip) while no popup-initiated
  // marking transition supersedes them. Sites below that perform such a
  // transition themselves re-adopt the bumped epoch (their writes ARE the
  // freshest state); every other pass checks markingPassIsStale() at the
  // moment of effect and skips — the transition site always runs a fresh pass
  // that redoes the effect from fresh reads.
  let markingEpochAtPassStart = state.markingSessionEpoch;
  const markingPassIsStale = () => state.markingSessionEpoch !== markingEpochAtPassStart;
  const refreshSessionFactsSeq = nextPopupSessionFactsSeq();
  const previousBaseUrl = state.currentBaseUrl;
  await validateStoredToken({ force: false, showToastOnInvalid: true });
  const currentTabId = state.currentTab.id || null;
  const tabChanged = Boolean(currentTabId && state.lastTabId !== currentTabId);
  saveCurrentTodoExpansionState();
  if (tabChanged) {
    clearPreviewRestorePending();
    state.stageBaseEditMode = false;
    state.endpointEditMode = false;
    state.configEndpointEditMode = false;
    state.remoteConfigLoadKey = "";
    state.remoteConfigLoadResult = null;
    clearLastPopupEnabled();
    clearedReloadRestoreForTabId = null;
  }
  const pageUrl = state.currentTab.url || "";
  if (!tabChanged && pageUrl !== state.lastPopupPageUrl) {
    clearPreviewRestorePending();
    clearLastPopupEnabled();
    // A real navigation abandons the page-scoped marking session: drop the
    // popup's AI-run mirror back to PRE_AI, or its sticky published
    // aiRunPhase keeps the brain in POST_AI for a page the run never belonged
    // to (POST_AI locks the enable toggle -> combined with silent mode that
    // state was unrecoverable). Hash-only changes keep the session.
    if (
      state.lastPopupPageUrl &&
      pageUrl.split("#")[0] !== state.lastPopupPageUrl.split("#")[0]
    ) {
      resetAiRunMarkingsFingerprint();
      signalMarkingSession("navigated");
    }
    if (currentTabId) {
      clearRemoteConfigLoadCacheForTab(currentTabId);
    }
    state.remoteConfigLoadKey = "";
    state.remoteConfigLoadResult = null;
    state.renderModeDetectionInFlight = false;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
    state.renderModeManualStepsVisible = false;
  }
  state.lastPopupPageUrl = pageUrl;
  state.lastTabId = currentTabId;
  // Whether this tab is currently held in "Without JavaScript" render mode. Drives
  // which inspect button is disabled so the user cannot click the same mode twice.
  state.renderModeTabJsDisabled = currentTabId
    ? await isRenderModeNoJsHeld(currentTabId)
    : false;
  const {
    tokenValue,
    endpointValue,
    configEndpointValue,
    stageBaseValue
  } = await helpers.loadGlobalAiSettings();
  const normalizedStageBaseValue = normalizeStageBase(stageBaseValue);
  let configs = await config.getConfigs();
  const persistedTabState = projectedTabState
    ? { enabled: projectedTabState.enabled, baseUrl: projectedTabState.baseUrl }
    : await messages.getTabState(state.currentTab.id);
  if (currentTabId && clearedReloadRestoreForTabId !== currentTabId) {
    clearedReloadRestoreForTabId = currentTabId;
    await messages.sendRuntimeMessage({
      type: "clearReloadRestoreTabState",
      tabId: currentTabId
    }).catch(() => null);
  }
  const tabState = persistedTabState || { enabled: false, baseUrl: "" };
  let initialTabState = currentTabId
    ? (await messages.getTabState(currentTabId, "initial")) || { active: false }
    : { active: false };
  if (
    currentTabId &&
    !(initialTabState && initialTabState.active) &&
    utils.getOriginFromUrl(pageUrl)
  ) {
    const activationResponse = await messages.requestTabBootstrapContent(currentTabId);
    if (!activationResponse || activationResponse.ok === false) {
      await messages.setTabState(currentTabId, { active: true }, "initial");
    }
    initialTabState = { active: true };
  }
  const tabInScope = Boolean(
    (initialTabState && initialTabState.active) ||
      utils.getOriginFromUrl(pageUrl)
  );
  const aiComputeRunActive =
    state.aiRequestInFlight === "compute" || state.aiComputeStartPending;
  const desktopPreviewFeatureEnabled = isFeatureEnabled("desktopPreview");
  state.currentDesktopPreviewEnabled = Boolean(
    desktopPreviewFeatureEnabled && initialTabState && initialTabState.desktopPreviewEnabled
  );
  if (isPropertyLockCollaborationEnabled()) {
    state.propertyLockOffCandidateDeadlineAt =
      initialTabState && Number.isFinite(initialTabState.propertyLockOffCandidateDeadlineAt)
        ? Number(initialTabState.propertyLockOffCandidateDeadlineAt)
        : 0;
    state.propertyLockRecoverySiteId =
      initialTabState && Number.isFinite(initialTabState.propertyLockRecoverySiteId)
        ? Number(initialTabState.propertyLockRecoverySiteId)
        : null;
    state.propertyLockRecoveryBaseUrl =
      initialTabState && typeof initialTabState.propertyLockRecoveryBaseUrl === "string"
        ? initialTabState.propertyLockRecoveryBaseUrl
        : "";
    state.propertyLockRecoveryClientId =
      initialTabState && typeof initialTabState.propertyLockRecoveryClientId === "string"
        ? initialTabState.propertyLockRecoveryClientId
        : "";
    state.propertyLockRecoveryDeadlineAt =
      initialTabState && Number.isFinite(initialTabState.propertyLockRecoveryDeadlineAt)
        ? Number(initialTabState.propertyLockRecoveryDeadlineAt)
        : 0;
  } else {
    resetDisabledPropertyLockState();
  }
  const persistedRecoveryState = {
    siteId: state.propertyLockRecoverySiteId,
    baseUrl: state.propertyLockRecoveryBaseUrl,
    clientId: state.propertyLockRecoveryClientId,
    deadlineAt: state.propertyLockRecoveryDeadlineAt
  };
  const previewState = tabInScope
    ? await messages.sendTabMessage({ type: "getAiPreviewState" })
    : null;
  let previewViewState = buildPreviewViewState(previewState);
  if (tabInScope) {
    // The getAiPreviewState probe is only a refresh source for the item LIST, not
    // the authority for whether the sidebar is open. On heavy pages the probe has
    // long transient states — request timeout (null), mid-hydration (active but
    // items:[] + itemsPending while collectPreviewItems walks the DOM for seconds),
    // and the still-closing-async window after Exit — and trusting any single
    // snapshot for open/closed flapped the sidebar (empty "no content detected",
    // preview reopening itself after Exit). Visibility is popup-owned
    // (previewOpenIntent / previewSuppressReopen); the authoritative close is the
    // aiPreviewClosed push / Exit Preview settle. See src/popup/state.ts.
    const currentView = uiModule.getViewState();
    const probeOk = Boolean(previewState);
    const probeActive = Boolean(previewViewState.previewActive);
    const probeItems = Array.isArray(previewViewState.previewItems) ? previewViewState.previewItems : [];

    let showPreview: boolean;
    if (state.previewRestorePending) {
      // Exit is in flight (popup-initiated). Its settle/fallback path owns the
      // teardown; a probe still reporting the preview active must not reopen it.
      showPreview = false;
    } else if (state.previewOpenIntent) {
      // The popup opened this preview and has not closed it. Keep it shown and
      // only refresh items from the probe; never let a transient close it.
      showPreview = true;
    } else if (state.previewSuppressReopen) {
      // Closed by the popup. Content's exit is async on heavy pages and probe
      // responses arrive out of order across interleaved passes, so an ACTIVE
      // read after the close is stale no matter how late it lands (clearing
      // this guard on one confirmed-closed probe let the next stale-active
      // probe reopen the sidebar after Exit — #5/#14). Every in-popup open
      // path sets a fresh intent, so the guard stays up until the next open;
      // a reconnecting popup starts with it down and adopts below.
      showPreview = false;
    } else {
      // No standing intent (e.g. popup reconnected while a preview is live):
      // adopt the probe's open state as the fresh observation.
      showPreview = probeActive;
      state.previewOpenIntent = showPreview;
    }

    if (showPreview) {
      // Items go through the session latch: a settled probe can update or
      // genuinely-empty the list; a probe miss or a pending snapshot never
      // blinks an established list to empty. "Settled" additionally requires
      // the snapshot to actually SHOW the open preview: a stale response from
      // a pre-open/compute_lock-era probe consumed after the open intent
      // latched has previewActive:false and mode-zeroed itemsPending, and
      // treating it as settled armed the settled-empty memory — the popup
      // rendered "No content detected" for seconds while content was still
      // collecting (pressure run on bonliva.se/lediga-jobb: content had 776
      // items; the view flipped settled-empty 100ms after open).
      const settled = probeOk && previewViewState.previewActive && !previewViewState.previewItemsPending;
      const resolved = resolveOpenPreviewItems(settled ? probeItems : [], settled);
      previewViewState = {
        previewActive: true,
        previewItems: resolved.items,
        previewItemsPending: resolved.pending,
        previewFocusedXpath: (probeOk && previewViewState.previewFocusedXpath)
          || (typeof currentView.previewFocusedXpath === "string" ? currentView.previewFocusedXpath : ""),
        previewShowAllCategories: probeOk
          ? previewViewState.previewShowAllCategories
          : Boolean(currentView.previewShowAllCategories),
        previewWillRestoreMarking: probeOk
          ? previewViewState.previewWillRestoreMarking
          : Boolean(currentView.previewWillRestoreMarking)
      };
    } else {
      previewViewState = buildPreviewViewState(null);
    }
  }
  // NOTE: intent is intentionally NOT cleared here on a transient tabInScope=false.
  // refreshUi's tabInScope can flicker false during a heavy-page preview (content
  // churn), and clearing the intent there collapsed the open sidebar. The intent
  // latch is cleared only by the authoritative close paths (settlePreviewRestoreClosed
  // via Exit / aiPreviewClosed) and on a fresh AI run start.
  if (!tabInScope && state.previewOpenIntent) {
    // The same transient out-of-scope flicker skips the whole preview block
    // above, leaving previewViewState at the empty no-probe default — writing
    // that stomps the latched item list straight past the session latch (the
    // round-7 per-frame capture showed the open list oscillating 130<->0,
    // rendering as a permanent "No content detected"). Keep the popup-owned
    // open state + latched items; the next in-scope pass refreshes from the
    // probe as usual.
    const outOfScopeView = uiModule.getViewState();
    const resolved = resolveOpenPreviewItems([], false);
    previewViewState = {
      previewActive: true,
      previewItems: resolved.items,
      previewItemsPending: resolved.pending,
      previewFocusedXpath: typeof outOfScopeView.previewFocusedXpath === "string"
        ? outOfScopeView.previewFocusedXpath
        : "",
      previewShowAllCategories: Boolean(outOfScopeView.previewShowAllCategories),
      previewWillRestoreMarking: Boolean(outOfScopeView.previewWillRestoreMarking)
    };
  }
  const {
    previewActive,
    previewItems,
    previewItemsPending,
    previewFocusedXpath,
    previewShowAllCategories
  } = previewViewState;
  const aiPreviewSessionActive = Boolean(previewActive);
  // A preview is marking-backed only when it snapshotted a marking session to
  // restore on exit (AI-run/marking previews). The Silent Preview keeps the
  // session in silent mode: forcing toggleEnabled true for it published
  // isEnabled:true over a silent session and wedged a popup/page split (the
  // preserve guard also blocked the content-wins sync from ever adopting
  // content's silent truth back) — live-traced 2026-07-03 00:03.
  const aiPreviewMarkingSessionActive = Boolean(
    previewActive && state.previewMarkingSessionSnapshot
  );
  let localMatchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  let hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
  let currentSiteId = null;
  let siteIdBlockedReason = "";
  let unsupportedByGraphql = false;
  let remoteLoadResult: RemoteConfigLoadResult = { status: "skipped", baseUrl: "" };
  let effectiveTabState = tabState;
  if ((aiComputeRunActive || aiPreviewSessionActive) && tabInScope) {
    const preservedBaseUrl = tabState.baseUrl || state.currentBaseUrl || "";
    effectiveTabState = {
      ...tabState,
      enabled: preservedBaseUrl ? true : Boolean(tabState.enabled),
      baseUrl: preservedBaseUrl
    };
  }
  let propertyPageTypes: Array<Record<string, unknown>> = [];
  let propertyPageTypesFetchError = "";
  if (
    !aiComputeRunActive &&
    !aiPreviewSessionActive &&
    tabInScope &&
    tabState.baseUrl &&
    pageUrl &&
    !utils.isPageWithinBaseUrl(pageUrl, tabState.baseUrl) &&
    !markingPassIsStale()
  ) {
    effectiveTabState = { enabled: false, baseUrl: "" };
    await messages.setTabState(state.currentTab.id, effectiveTabState);
    state.previewCloseMarkingRestoreUnconfirmed = false;
    markingEpochAtPassStart = bumpMarkingSessionEpoch();
  }
  if (
    tabInScope &&
    !localMatchingBaseUrl &&
    !effectiveTabState.baseUrl &&
    currentTabId &&
    pageUrl &&
    normalizedStageBaseValue
  ) {
    const discoveryResult = await resolveSiteIdFromGraphql({
      stageBase: normalizedStageBaseValue,
      lookupUrl: pageUrl,
      tokenValue
    });
    if (
      discoveryResult &&
      discoveryResult.ok &&
      discoveryResult.siteId &&
      discoveryResult.baseUrl
    ) {
      const discoveredBaseUrl = discoveryResult.baseUrl;
      const discoveredSiteId = normalizeSiteIdValue(discoveryResult.siteId);
      if (discoveredSiteId) {
        state.siteIdLookupByBaseUrl.set(discoveredBaseUrl, discoveredSiteId);
        localMatchingBaseUrl = discoveredBaseUrl;
        hasLocalConfigForWebsite = Boolean(localMatchingBaseUrl);
      }
    } else if (discoveryResult && discoveryResult.ok && discoveryResult.notFound) {
      unsupportedByGraphql = true;
      siteIdBlockedReason = PopupText.status.noMappedBaseUrlFound;
    }
  }
  const fallbackBaseUrl = tabInScope ? localMatchingBaseUrl : "";
  state.currentBaseUrl = tabInScope
    ? (effectiveTabState.baseUrl || fallbackBaseUrl || "")
    : "";
  if (DIRECT_MODE_ACTIVE && tabInScope && !state.currentBaseUrl) {
    // Direct mode: synthesize an ad-hoc property from the page origin so the
    // unconfigured page is treated as in-scope. Not persisted; save/AI stay
    // gated. The content side (enableForBaseUrl) only requires the page to be
    // within this baseUrl, which the page origin satisfies.
    const origin = utils.getOriginFromUrl(pageUrl) || "";
    const synthesizedBaseUrl = origin ? (utils.normalizeBaseUrl(origin) || origin) : "";
    if (synthesizedBaseUrl) {
      state.currentBaseUrl = synthesizedBaseUrl;
      unsupportedByGraphql = false;
      siteIdBlockedReason = "";
    }
  }
  if (state.currentBaseUrl) {
    const normalized = config.normalizeConfig(state.currentBaseUrl, configs[state.currentBaseUrl]);
    if (configs[state.currentBaseUrl] && normalized.changed) {
      configs[state.currentBaseUrl] = normalized.config;
      await config.saveConfigs(configs);
    }
    state.currentConfig = configs[state.currentBaseUrl] || normalized.config;
    if (projectedSiteId) {
      // #sw-sole-authority: the popup uses the brain's resolved siteId directly but
      // must NEVER persist it. The SW page-data-lifecycle (complete-replace on 200)
      // is the sole config/siteId authority. Persisting projectedSiteId here fought
      // the SW's complete-replace and churned the once-per-session load guard
      // (re-load every refresh), and previously leaked a stale/other-property siteId
      // into the current property's config (cross-property contamination).
      currentSiteId = projectedSiteId;
    } else {
      // Brain hasn't pushed a siteId yet. Read from config (which the brain
      // may have already persisted via page-data-lifecycle). Do NOT send a
      // resolveLivePageSiteId message — that creates a feedback loop when the
      // brain hasn't resolved yet (e.g., onCommitted hasn't fired).
      const configSiteId = normalizeSiteIdValue(
        configs[state.currentBaseUrl] && configs[state.currentBaseUrl].siteId
      );
      currentSiteId = configSiteId;
    }
    if (
      tabInScope &&
      state.currentBaseUrl &&
      currentSiteId &&
      normalizedStageBaseValue &&
      tokenValue
    ) {
      const propertyPageTypesResult = await ensurePropertyPageTypes({
        siteId: currentSiteId,
        stageBase: normalizedStageBaseValue,
        tokenValue,
        force: false,
        notifyOnChange: false
      });
      if (propertyPageTypesResult && propertyPageTypesResult.ok) {
        propertyPageTypes = propertyPageTypesResult.pageTypes || [];
        propertyPageTypesFetchError = propertyPageTypesResult.error || "";
      } else if (propertyPageTypesResult) {
        propertyPageTypesFetchError = propertyPageTypesResult.error || "";
      }
    }
    const bootstrapCandidateSiteId = getCurrentPageCandidateState(pageUrl, propertyPageTypes).status === "candidate"
      ? currentSiteId
      : null;
    if (bootstrapCandidateSiteId && isPropertyLockCollaborationEnabled()) {
      await refreshPropertyLockSnapshot(bootstrapCandidateSiteId, {
        skipFetch: skipPropertyLockFetch
      });
    } else {
      resetDisabledPropertyLockState();
    }
    const editorOwnsCurrentProperty = Boolean(
      bootstrapCandidateSiteId &&
        shouldSkipRemoteConfigLoadForPropertyEditor(bootstrapCandidateSiteId)
    );
    const shouldBootstrapEditorConfig = Boolean(
      editorOwnsCurrentProperty &&
        state.propertyLockEditorBootstrapPending
    );
    if (configEndpointValue && tokenValue && (!editorOwnsCurrentProperty || shouldBootstrapEditorConfig)) {
      // #load-once: the config /load fires ONCE per page session (tab|page|site|endpoint),
      // at page load, and is never re-triggered by the recurring popup refresh. On later
      // refreshes we reuse the settled result instead of re-loading. Re-triggering the
      // load on every refresh caused a self-sustaining /load loop (each "changed" load
      // fired configUpdated -> content re-processed -> facts -> re-projection -> refresh
      // -> load ...). Errors are not recorded so the load retries until it settles.
      const pageDataLoadSessionKey = currentSiteId
        ? `${currentTabId}|${pageUrl}|${currentSiteId}|${configEndpointValue}`
        : "";
      const reusableLoadResult =
        !shouldBootstrapEditorConfig &&
        pageDataLoadSessionKey &&
        state.pageDataLoadSessionKey === pageDataLoadSessionKey
          ? state.remoteConfigLoadResult
          : null;
      if (reusableLoadResult) {
        remoteLoadResult = reusableLoadResult;
      } else {
        remoteLoadResult = await loadRemoteConfigForCurrentPage({
          tabId: currentTabId,
          pageUrl,
          baseUrl: state.currentBaseUrl,
          siteId: currentSiteId,
          endpointValue: configEndpointValue,
          tokenValue,
          force: shouldBootstrapEditorConfig
        });
        if (
          pageDataLoadSessionKey &&
          remoteLoadResult &&
          (remoteLoadResult.status === "ok" || remoteLoadResult.status === "not_found")
        ) {
          state.pageDataLoadSessionKey = pageDataLoadSessionKey;
        }
        if (shouldBootstrapEditorConfig) {
          state.propertyLockEditorBootstrapPending = false;
        }
      }
    } else if (editorOwnsCurrentProperty) {
      remoteLoadResult = { status: "skipped_editor", baseUrl: state.currentBaseUrl };
      state.propertyLockEditorBootstrapPending = false;
    } else {
      remoteLoadResult = { status: "skipped_missing_config", baseUrl: state.currentBaseUrl };
    }
    if (
      remoteLoadResult &&
      (
        remoteLoadResult.status === "ok" ||
        remoteLoadResult.status === "not_found"
      )
    ) {
      configs = await config.getConfigs();
      if (state.currentBaseUrl && configs[state.currentBaseUrl]) {
        const normalizedCurrent = config.normalizeConfig(
          state.currentBaseUrl,
          configs[state.currentBaseUrl]
        );
        if (normalizedCurrent.changed) {
          configs[state.currentBaseUrl] = normalizedCurrent.config;
          await config.saveConfigs(configs);
        }
        state.currentConfig = configs[state.currentBaseUrl];
      }
    }
    if (!currentSiteId) {
      siteIdBlockedReason = PopupText.status.unableToResolveDomainId;
      remoteLoadResult = { status: "skipped", baseUrl: "" };
      updateLastConfigLoadStatus(remoteLoadResult);
      // The lookup failing right after the user lands the configuration
      // used to LATCH: nothing re-attempted the resolution and the popup sat
      // on "Unable to resolve domainId right now" until a manual reload
      // (fresh-install ship-blocker, architect 2026-07-03). Retry with
      // bounded backoff; success or a base-URL change resets the budget.
      scheduleSiteIdResolutionRetry();
    }
  } else {
    state.currentConfig = null;
  }
  const remoteConfigConnectionIssue = Boolean(
    configEndpointValue &&
      state.currentBaseUrl &&
      remoteLoadResult &&
      remoteLoadResult.status === "error"
  );
  setRemoteConfigConnectionIssue(remoteConfigConnectionIssue);
  if (
    remoteLoadResult &&
    remoteLoadResult.status === "not_found" &&
    !aiComputeRunActive &&
    !aiPreviewSessionActive &&
    effectiveTabState.baseUrl &&
    !hasLocalConfigForWebsite &&
    !currentSiteId &&
    !markingPassIsStale()
  ) {
    const wasEnabled = Boolean(effectiveTabState.enabled);
    effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
    await messages.setTabState(state.currentTab.id, effectiveTabState);
    if (wasEnabled) {
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    }
    state.currentBaseUrl = "";
    state.currentConfig = null;
    currentSiteId = null;
    siteIdBlockedReason = "";
    state.previewCloseMarkingRestoreUnconfirmed = false;
    markingEpochAtPassStart = bumpMarkingSessionEpoch();
  }
  if (unsupportedByGraphql && !aiComputeRunActive && !aiPreviewSessionActive) {
    if (effectiveTabState.enabled && !markingPassIsStale()) {
      effectiveTabState = { ...effectiveTabState, enabled: false, baseUrl: "" };
      await messages.setTabState(state.currentTab.id, effectiveTabState);
      await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
      state.previewCloseMarkingRestoreUnconfirmed = false;
      markingEpochAtPassStart = bumpMarkingSessionEpoch();
    }
    state.currentBaseUrl = "";
    state.currentConfig = null;
    currentSiteId = null;
  }
  if (
    !unsupportedByGraphql &&
    !state.currentBaseUrl &&
    tabInScope &&
    currentTabId &&
    pageUrl &&
    normalizedStageBaseValue
  ) {
    const fallbackDiscoveryResult = await resolveSiteIdFromGraphql({
      stageBase: normalizedStageBaseValue,
      lookupUrl: pageUrl,
      tokenValue
    });
    if (
      fallbackDiscoveryResult &&
      fallbackDiscoveryResult.ok &&
      fallbackDiscoveryResult.siteId &&
      fallbackDiscoveryResult.baseUrl
    ) {
      const fallbackBaseUrl =
        utils.normalizeCanonicalBaseUrl(fallbackDiscoveryResult.baseUrl) ||
        utils.normalizeBaseUrl(fallbackDiscoveryResult.baseUrl) ||
        fallbackDiscoveryResult.baseUrl;
      const fallbackSiteId = normalizeSiteIdValue(fallbackDiscoveryResult.siteId);
      if (fallbackBaseUrl && fallbackSiteId) {
        state.siteIdLookupByBaseUrl.set(fallbackBaseUrl, fallbackSiteId);
        state.currentBaseUrl = fallbackBaseUrl;
        currentSiteId = fallbackSiteId;
        state.currentConfig = config.normalizeConfig(
          fallbackBaseUrl,
          configs[fallbackBaseUrl]
        ).config;
      }
    } else if (fallbackDiscoveryResult && fallbackDiscoveryResult.ok && fallbackDiscoveryResult.notFound) {
      unsupportedByGraphql = true;
      siteIdBlockedReason = PopupText.status.noMappedBaseUrlFound;
    }
  }
  if (state.currentBaseUrl !== previousBaseUrl) {
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
    clearSelectorsPendingConfigSync();
    state.renderModeEditMode = false;
    state.renderModeSummaryOpen = false;
    state.renderModeDetectionInFlight = false;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
    state.renderModeManualStepsVisible = false;
  }
  const persistedConfigs = await config.getConfigs();
  state.currentBaseUrlHasConfirmedRenderMode = hasConfirmedRenderModeForBaseUrl(
    persistedConfigs,
    state.currentBaseUrl
  );
  let suggestedRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (tabInScope && state.currentBaseUrl && state.currentConfig && pageUrl) {
    suggestedRenderMode = await maybeAutoDetectRenderMode(pageUrl);
    configs = await config.getConfigs();
    state.currentBaseUrlHasConfirmedRenderMode = hasConfirmedRenderModeForBaseUrl(
      configs,
      state.currentBaseUrl
    );
  } else {
    state.currentBaseUrlHasConfirmedRenderMode = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = config.DEFAULT_RENDER_MODE;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeUndeterminedNoticeKey = "";
    state.renderModeWarningDismissedKey = "";
  }
  if (DIRECT_MODE_ACTIVE && state.currentBaseUrl) {
    // Direct mode skips the render-mode inspection/confirmation step so the
    // marking editor (and the enable toggle) are reachable on any page.
    state.currentBaseUrlHasConfirmedRenderMode = true;
  }

  const view = uiModule.getViewState();
  const refs = uiModule.getRefs();
  const nextViewState: PopupViewStatePatch = {
    currentPageUrl: pageUrl || ViewText.unavailable,
    currentBaseUrl: state.currentBaseUrl,
    featureFlags: getFeatureFlags(),
    configMenuOpen: state.configMenuOpen,
    previewActive,
    previewItems,
    previewItemsPending,
    previewFocusedXpath,
    previewShowAllCategories: isFeatureEnabled("previewExpandedStates") && previewShowAllCategories,
    previewBlocked: previewActive,
    previewBlockedMessage: previewActive
      ? PopupText.preview.blockedActive
      : ViewText.previewBlockedDefault
  };
  const baseUrlReady = Boolean(state.currentBaseUrl);
  const baseField = {
    value: state.currentBaseUrl || "",
    isEditing: false,
    noticeText: baseUrlReady
      ? ""
      : ViewText.baseUrlAutoResolvedNotice,
    noticeVisible: !baseUrlReady
  };
  if (!tabInScope) {
    baseField.noticeText = ViewText.openOnCurrentTabNotice;
    baseField.noticeVisible = true;
  }
  const extensionEnabledForTab = Boolean(
    tabInScope &&
    effectiveTabState.enabled &&
      effectiveTabState.baseUrl &&
      pageUrl &&
      utils.isPageWithinBaseUrl(pageUrl, effectiveTabState.baseUrl)
  );
  let toggleEnabled = extensionEnabledForTab;
  if (state.lastPopupEnabled !== null) {
    const popupEnabledContext = buildPopupEnabledContext(state.currentTab, state.currentBaseUrl || effectiveTabState.baseUrl || "");
    if (!isPopupEnabledContextCurrent(state.lastPopupEnabledContext, popupEnabledContext)) {
      clearLastPopupEnabled();
    } else {
      toggleEnabled = state.lastPopupEnabled;
      if (toggleEnabled === Boolean(effectiveTabState.enabled)) {
        clearLastPopupEnabled();
      }
    }
  }
  let contentModeStatus = null;
  const previewRestorePending = Boolean(state.previewRestorePending);
  if (currentTabId && tabInScope && state.currentBaseUrl) {
    contentModeStatus = await messages.sendTabMessageToTab(currentTabId, {
      type: "getInspectionStatus"
    }).catch(() => null);
  }
  const contentModeKnown = Boolean(
    contentModeStatus &&
      contentModeStatus.ok &&
      typeof contentModeStatus.markingEnabled === "boolean"
  );
  if (contentModeKnown && contentModeStatus) {
    const contentMarkingEnabled = Boolean(contentModeStatus.markingEnabled);
    if (state.previewCloseMarkingRestoreUnconfirmed && contentMarkingEnabled) {
      // Content's post-exit marking re-enable is now observed: the restore is
      // confirmed, and a later markingEnabled:false is a genuine disable
      // again. Bump the epoch so in-flight passes still holding pre-restore
      // reads cannot publish/sync their stale marking facts over this
      // observation; this pass IS the observation, so it adopts the new epoch.
      state.previewCloseMarkingRestoreUnconfirmed = false;
      markingEpochAtPassStart = bumpMarkingSessionEpoch();
    }
    const preserveEnabledDuringPreviewCloseRestore = Boolean(
      previewRestorePending &&
      tabInScope &&
      !contentMarkingEnabled
    );
    // Post-exit restore hold (#5/#14): the popup settled the exit and restored
    // the marking session, but content's own marking re-enable is async and
    // slow on heavy pages, so it keeps reporting markingEnabled:false for a
    // while — longer than any fixed grace window. Folding that transient false
    // into toggleEnabled and tabState published isEnabled:false -> the brain
    // dictated SILENT and the whole session collapsed (marks lost, Save
    // unreachable). Keep the popup's enabled authority until content is first
    // observed re-enabled (cleared above); a false read after that is a
    // genuine disable and syncs normally.
    const preserveEnabledDuringUnconfirmedRestore = Boolean(
      tabInScope &&
      effectiveTabState.enabled &&
      !contentMarkingEnabled &&
      state.previewCloseMarkingRestoreUnconfirmed
    );
    const preserveEnabledDuringAiComputeRun = Boolean(
      (aiComputeRunActive || aiPreviewMarkingSessionActive) &&
      tabInScope &&
      Boolean(state.currentBaseUrl || effectiveTabState.baseUrl) &&
      !contentMarkingEnabled
    );
    const shouldPreserveEnabledDuringReactivation = Boolean(
      effectiveTabState.enabled &&
        !contentMarkingEnabled &&
        (contentModeStatus.lockClaimPending ||
          contentModeStatus.pending ||
          contentModeStatus.renderModeInspectionActive)
    );
    if (contentMarkingEnabled !== Boolean(effectiveTabState.enabled) && currentTabId) {
      if (
        !shouldPreserveEnabledDuringReactivation &&
        !preserveEnabledDuringPreviewCloseRestore &&
        !preserveEnabledDuringAiComputeRun &&
        !preserveEnabledDuringUnconfirmedRestore &&
        !markingPassIsStale()
      ) {
        effectiveTabState = {
          ...effectiveTabState,
          enabled: contentMarkingEnabled,
          baseUrl: contentMarkingEnabled
            ? state.currentBaseUrl || effectiveTabState.baseUrl || ""
            : effectiveTabState.baseUrl || state.currentBaseUrl || ""
        };
        await messages.setTabState(currentTabId, effectiveTabState);
        clearLastPopupEnabled();
        // This pass performed the enabled sync; it adopts the bumped epoch and
        // invalidates other in-flight passes' marking effects.
        markingEpochAtPassStart = bumpMarkingSessionEpoch();
      }
    }
    if (
      preserveEnabledDuringPreviewCloseRestore ||
      preserveEnabledDuringAiComputeRun ||
      preserveEnabledDuringUnconfirmedRestore
    ) {
      toggleEnabled = true;
    } else {
      toggleEnabled = shouldPreserveEnabledDuringReactivation
        ? Boolean(effectiveTabState.enabled)
        : contentMarkingEnabled;
    }
  }
  if (
    tabInScope &&
    (previewRestorePending || aiComputeRunActive || aiPreviewMarkingSessionActive) &&
    (!contentModeKnown || !toggleEnabled)
  ) {
    toggleEnabled = true;
  }
  const contentMarkingModeActive = Boolean(
    contentModeKnown &&
      contentModeStatus &&
      contentModeStatus.markingEnabled
  );
  let isEnabled = toggleEnabled;
  void isEnabled;
  const storedDeviceState = currentTabId
    ? await emulation.reconcileDeviceEmulationState(currentTabId)
    : {
        enabled: state.currentDeviceEmulationEnabled,
        mode: state.currentDeviceMode,
        scale: state.currentDeviceScale
      };
  const normalizedDeviceState = emulation.syncDeviceEmulationState(storedDeviceState);
  const loginEmailValue = view.loginEmailValue || "";
  const loginPasswordValue = view.loginPasswordValue || "";
  if (!configEndpointValue) {
    state.configEndpointEditMode = false;
  }
  if (!endpointValue) {
    state.endpointEditMode = false;
  }
  if (!normalizedStageBaseValue) {
    state.stageBaseEditMode = false;
  }
  const configEndpointSet = Boolean(configEndpointValue);
  const configEndpointField = getEditableFieldState({
    inputRef: refs.configEndpointUrlInput,
    currentValue: view.configEndpointUrlValue,
    value: configEndpointValue,
    isSet: configEndpointSet,
    editMode: state.configEndpointEditMode,
    suggestedValue: configEndpointValue,
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.endpointNoticeUnset,
    noticeEdit: PopupText.configuration.endpointNoticeEdit
  });
  const configEndpointReady = configEndpointField.isReady;
  const endpointSet = Boolean(endpointValue);
  const endpointField = getEditableFieldState({
    inputRef: refs.endpointUrlInput,
    currentValue: view.endpointUrlValue,
    value: endpointValue,
    isSet: endpointSet,
    editMode: state.endpointEditMode,
    suggestedValue: endpointValue,
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.aiEndpointNoticeUnset,
    noticeEdit: PopupText.configuration.aiEndpointNoticeEdit
  });
  const endpointReady = endpointField.isReady;
  const stageBaseSet = Boolean(normalizedStageBaseValue);
  const stageBaseField = getEditableFieldState({
    inputRef: refs.stageBaseInput,
    currentValue: view.stageBaseValue,
    value: normalizedStageBaseValue,
    isSet: stageBaseSet,
    editMode: state.stageBaseEditMode,
    suggestedValue: normalizedStageBaseValue,
    preserveCurrentValueWhileEditing: true,
    noticeUnset: PopupText.configuration.stageBaseNoticeUnset,
    noticeEdit: PopupText.configuration.stageBaseNoticeEdit
  });
  const stageBaseReady = stageBaseField.isReady;
  const loginCredentialsEnabled = stageBaseReady;
  const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
  if (!state.currentBaseUrlHasConfirmedRenderMode) {
    state.renderModeEditMode = false;
  }
  const siteIdReady = Boolean(
    currentSiteId || normalizeSiteIdValue(state.currentConfig && state.currentConfig.siteId)
  ) || DIRECT_MODE_ACTIVE;
  const effectiveSiteIdBlockedReason = unsupportedByGraphql
    ? siteIdBlockedReason || PopupText.status.noMappedBaseUrlFound
    : !tabInScope
      ? ViewText.openOnCurrentTabNotice
    : baseUrlReady && !siteIdReady
      ? siteIdBlockedReason || ViewText.noDomainIdForBaseUrl
      : "";
  const liveSiteId = normalizeSiteIdValue(
    currentSiteId ||
      (state.currentConfig && state.currentConfig.siteId) ||
      (state.currentBaseUrl ? state.siteIdLookupByBaseUrl.get(state.currentBaseUrl) : null)
  );
  state.currentSiteId = liveSiteId || "";
  if (
    tabInScope &&
    state.currentBaseUrl &&
    liveSiteId &&
    normalizedStageBaseValue &&
    tokenValue
  ) {
    const propertyPageTypesResult = await ensurePropertyPageTypes({
      siteId: liveSiteId,
      stageBase: normalizedStageBaseValue,
      tokenValue,
      force: false,
      notifyOnChange: false
    });
    if (propertyPageTypesResult && propertyPageTypesResult.ok) {
      propertyPageTypes = propertyPageTypesResult.pageTypes || [];
      propertyPageTypesFetchError = propertyPageTypesResult.error || "";
    } else if (propertyPageTypesResult) {
      propertyPageTypesFetchError = propertyPageTypesResult.error || "";
    }
  }
  if (
    tabInScope &&
    state.currentBaseUrl &&
    liveSiteId &&
    normalizedStageBaseValue &&
    tokenValue
  ) {
    schedulePropertyPageTypesRefresh({
      siteId: liveSiteId,
      stageBase: normalizedStageBaseValue
    });
  } else {
    clearPropertyPageTypesRefreshTimer();
    if (!tabInScope || !state.currentBaseUrl || !liveSiteId) {
      resetPropertyPageTypesState();
    }
  }
  let pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
  const backendSavedPageMarkings = state.currentBaseUrl
    ? await config.getBackendSavedPageMarkings(state.currentBaseUrl)
    : {};
  const normalizedCurrentPageUrl = normalizeCandidatePageUrl(pageUrl);
  let currentPageEntryMarkedInvalid = false;
  let repairedStoredPageUrls: string[] = [];
  let didReconcileStoredPageMarkings = false;
  let backendSavedPageMarkingItems = collectStoredPageMarkingItems(
    backendSavedPageMarkings,
    state.currentBaseUrl
  );
  const currentPageCandidateState = getCurrentPageCandidateState(
    pageUrl,
    propertyPageTypes
  );
  const propertyLockScopeSiteId = isPropertyLockCollaborationEnabled()
    ? (
      state.propertyLockRecoveryDeadlineAt > Date.now() && state.propertyLockRecoverySiteId
        ? state.propertyLockRecoverySiteId
        : liveSiteId
    )
    : null;
  if (propertyLockScopeSiteId && state.currentBaseUrl && tokenValue) {
    await refreshPropertyLockSnapshot(propertyLockScopeSiteId, {
      skipFetch: skipPropertyLockFetch
    });
  } else if (propertyLockScopeSiteId && state.propertyLockRecoveryDeadlineAt > Date.now()) {
    await refreshPropertyLockSnapshot(propertyLockScopeSiteId, {
      skipFetch: skipPropertyLockFetch
    });
  } else {
    resetDisabledPropertyLockState();
  }
  if (currentTabId && isPropertyLockCollaborationEnabled()) {
    const activeEditorSiteId = normalizeSiteIdValue(liveSiteId || state.propertyLockSiteId);
    const recoverySiteId = normalizeSiteIdValue(
      state.propertyLockRecoverySiteId || persistedRecoveryState.siteId
    );
    const recoveryBaseUrl =
      state.propertyLockRecoveryBaseUrl || persistedRecoveryState.baseUrl || "";
    const recoveryClientId =
      state.propertyLockRecoveryClientId || persistedRecoveryState.clientId || "";
    const recoveryDeadlineAt = Number.isFinite(state.propertyLockRecoveryDeadlineAt) &&
      state.propertyLockRecoveryDeadlineAt > 0
      ? state.propertyLockRecoveryDeadlineAt
      : (
        Number.isFinite(persistedRecoveryState.deadlineAt) && persistedRecoveryState.deadlineAt > 0
          ? persistedRecoveryState.deadlineAt
          : 0
      );
    const hasPersistedRecoverySession = Boolean(
      recoverySiteId &&
      recoveryBaseUrl &&
      recoveryClientId
    );
    const isOutsideRecoveryBaseUrl = Boolean(
      hasPersistedRecoverySession &&
      pageUrl &&
      !utils.isPageWithinBaseUrl(pageUrl, recoveryBaseUrl)
    );
    if (hasPersistedRecoverySession && isOutsideRecoveryBaseUrl) {
      const nextRecoveryDeadlineAt = recoveryDeadlineAt > Date.now()
        ? recoveryDeadlineAt
        : Date.now() + PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS;
      state.propertyLockRecoverySiteId = recoverySiteId;
      state.propertyLockRecoveryBaseUrl = recoveryBaseUrl;
      state.propertyLockRecoveryClientId = recoveryClientId;
      state.propertyLockRecoveryDeadlineAt = nextRecoveryDeadlineAt;
      await persistPropertyLockRecoveryMetadata(currentTabId, {
        siteId: recoverySiteId,
        baseUrl: recoveryBaseUrl,
        clientId: recoveryClientId,
        deadlineAt: nextRecoveryDeadlineAt
      });
    } else if (
      state.propertyLockState &&
      state.propertyLockState.isEditor &&
      activeEditorSiteId &&
      state.currentBaseUrl &&
      state.propertyLockClientId
    ) {
      await persistPropertyLockRecoveryMetadata(currentTabId, {
        siteId: activeEditorSiteId,
        baseUrl: state.currentBaseUrl,
        clientId: state.propertyLockClientId,
        deadlineAt: 0
      });
    } else if (!state.propertyLockRecoveryDeadlineAt || state.propertyLockRecoveryDeadlineAt <= Date.now()) {
      await persistPropertyLockRecoveryMetadata(currentTabId, {
        siteId: null,
        baseUrl: "",
        clientId: "",
        deadlineAt: 0
      });
    }
  }
  if (propertyPageTypes.length && state.currentBaseUrl) {
    // A freshly-marked page is not in backendSavedPageMarkings yet, so the
    // backend-saved repair below never resolves its pageType. Stamp the
    // candidate-resolved pageType onto LOCAL draft markings first: the backend
    // requires a valid pageType per page marking, so a blank-pageType page would
    // be filtered out of the save payload (or rejected) and never persist. That
    // leaves coverage empty and keeps the page dirty (current markings never
    // match the empty backend-saved snapshot), which suppresses silent
    // highlighting even after a "successful" save.
    const localPageMarkingRepairItems = collectStoredPageMarkingItems(
      pageMarkings,
      state.currentBaseUrl
    );
    const localPageTypeRepairModel = buildLynxChecklistViewModel({
      pageTypes: propertyPageTypes,
      markedPages: localPageMarkingRepairItems
    });
    if (localPageTypeRepairModel.repairedMarkedPages.length) {
      const localRepairedStoredPageUrls = await repairLocalPageMarkingPageTypes({
        baseUrl: state.currentBaseUrl,
        repairedMarkedPages: localPageTypeRepairModel.repairedMarkedPages
      });
      if (localRepairedStoredPageUrls.length) {
        repairedStoredPageUrls = Array.from(
          new Set([...repairedStoredPageUrls, ...localRepairedStoredPageUrls])
        );
        didReconcileStoredPageMarkings = true;
        configs = await config.getConfigs();
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
          configs[state.currentBaseUrl]
        ).config;
        pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
      }
    }
    let coverageModel = buildLynxChecklistViewModel({
      pageTypes: propertyPageTypes,
      markedPages: backendSavedPageMarkingItems
    });
    if (coverageModel.repairedMarkedPages.length) {
      repairedStoredPageUrls = Array.from(new Set([
        ...repairedStoredPageUrls,
        ...await repairLocalPageMarkingPageTypes({
          baseUrl: state.currentBaseUrl,
          repairedMarkedPages: coverageModel.repairedMarkedPages
        })
      ]));
      if (repairedStoredPageUrls.length) {
        didReconcileStoredPageMarkings = true;
        configs = await config.getConfigs();
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
          configs[state.currentBaseUrl]
        ).config;
        pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
        coverageModel = buildLynxChecklistViewModel({
          pageTypes: propertyPageTypes,
          markedPages: backendSavedPageMarkingItems
        });
      }
    }
    const invalidStoredPageUrlsForRemote = Array.from(
      new Set(
        coverageModel.invalidMarkedPages
          .map((item) => (item && typeof item.url === "string" ? item.url.trim() : ""))
          .filter(Boolean)
      )
    );
    currentPageEntryMarkedInvalid = invalidStoredPageUrlsForRemote.some(
      (url) => normalizeCandidatePageUrl(url) === normalizedCurrentPageUrl
    );
    if (invalidStoredPageUrlsForRemote.length) {
      const removedInvalidUrls = await pruneLocalInvalidPageMarkings({
        baseUrl: state.currentBaseUrl,
        invalidUrls: invalidStoredPageUrlsForRemote
      });
      if (removedInvalidUrls.length) {
        didReconcileStoredPageMarkings = true;
        configs = await config.getConfigs();
        state.currentConfig = config.normalizeConfig(
          state.currentBaseUrl,
          configs[state.currentBaseUrl]
        ).config;
        pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
      }
    }
    const shouldReloadCurrentPageEntry =
      repairedStoredPageUrls.some((url) => normalizeCandidatePageUrl(url) === normalizedCurrentPageUrl) ||
      currentPageEntryMarkedInvalid;
    if (currentTabId && didReconcileStoredPageMarkings) {
      await messages.sendTabMessageWithRetry({
        type: "configUpdated",
        baseUrl: state.currentBaseUrl,
        forceReloadPageEntry: shouldReloadCurrentPageEntry
      }, 2);
    }
  }
  const localStoredPageMarkingItems = collectStoredPageMarkingItems(
    pageMarkings,
    state.currentBaseUrl
  );
  backendSavedPageMarkingItems = collectStoredPageMarkingItems(
    backendSavedPageMarkings,
    state.currentBaseUrl
  );
  // Todo completion must reflect persisted save results, not temporary local drafts.
  const coverageMarkedPageItems = backendSavedPageMarkingItems;
  const pageTypeCoverageModel = buildLynxChecklistViewModel({
    pageTypes: propertyPageTypes,
    markedPages: coverageMarkedPageItems
  });
  const activeMarkedPageKeys = new Set(
    pageTypeCoverageModel.activeMarkedPages
      .map((item) => buildPageMarkingKey(item.url, item.pageType))
      .filter(Boolean)
  );
  const pageMarkingItemByKey = new Map(
    coverageMarkedPageItems.map((item) => [buildPageMarkingKey(item.url, item.pageType), item])
  );
  const hasStoredCurrentPageEntry = localStoredPageMarkingItems.some(
    (item) => normalizeCandidatePageUrl(item.url) === normalizedCurrentPageUrl
  );
  syncPropertyLockOffCandidateRefreshTimer(
    hasProjectedPropertyLockDeadlineTimerForTab(currentTabId) ||
    Boolean(
      (state.propertyLockOffCandidateDeadlineAt && state.propertyLockOffCandidateDeadlineAt > Date.now()) ||
      (state.propertyLockRecoveryDeadlineAt && state.propertyLockRecoveryDeadlineAt > Date.now())
    )
  );
  Object.assign(
    nextViewState,
    buildPropertyLockViewState()
  );
  publishCurrentTabPropertyLockSnapshot();
  const currentPageMarkingAllowed = currentPageCandidateState.status === "candidate";
  const pageTypeUiBlocked = Boolean(
    tabInScope &&
    state.currentBaseUrl &&
    siteIdReady &&
    !unsupportedByGraphql &&
    (currentPageCandidateState.status === "missing" ||
      currentPageCandidateState.status === "duplicate" ||
      currentPageCandidateState.status === "empty")
  );
  state.currentPageTypeKey = currentPageCandidateState.pageTypeKey || "";
  state.currentPageTypeTitle = currentPageCandidateState.pageTypeTitle || "";
  state.lynxChecklistPageTypes = propertyPageTypes;
  const renderModeSet = state.currentBaseUrlHasConfirmedRenderMode;
  const renderModeField = getEditableFieldState({
    inputRef: refs.renderModeSelect,
    currentValue: view.renderModeValue,
    value: currentRenderMode,
    isSet: renderModeSet,
    editMode: state.renderModeEditMode,
    suggestedValue: suggestedRenderMode,
    noticeUnset: PopupText.renderMode.noticeUnset,
    noticeEdit: PopupText.renderMode.noticeEdit
  });
  const renderModeRequired =
    tabInScope &&
    !unsupportedByGraphql &&
    baseUrlReady &&
    siteIdReady;
  const renderModeLowConfidence =
    renderModeRequired &&
    !state.currentBaseUrlHasConfirmedRenderMode &&
    isRenderModeDetectionLowConfidence(state.renderModeDetectionAccuracy);
  const renderModeValueUndetermined = isUndeterminedRenderMode(renderModeField.value);
  const renderModeReady = !renderModeRequired || renderModeField.isReady;
  let renderModeNoticeText = renderModeField.noticeText;
  let renderModeNoticeVisible = renderModeField.noticeVisible;
  if (!renderModeRequired) {
    renderModeNoticeText = !tabInScope
      ? PopupText.renderMode.noticeOpenOnCurrentTab
      : unsupportedByGraphql
        ? PopupText.renderMode.noticeUnmappedPage
        : !baseUrlReady || !siteIdReady
          ? PopupText.renderMode.noticeRequiresSiteMapping
          : "";
    renderModeNoticeVisible = Boolean(renderModeNoticeText);
  } else if (state.renderModeDetectionInFlight) {
    renderModeNoticeText = PopupText.renderMode.noticeDetecting;
    renderModeNoticeVisible = true;
  } else if (state.renderModeDetectionUnsure) {
    renderModeNoticeText = PopupText.renderMode.noticeAutoDetectFailed;
    renderModeNoticeVisible = true;
  } else if (renderModeLowConfidence) {
    renderModeNoticeText = PopupText.renderMode.noticeLowConfidence;
    renderModeNoticeVisible = true;
  }

  const configurationComplete =
    configEndpointReady &&
    endpointReady &&
    stageBaseReady &&
    Boolean(tokenValue);
  const themeModeOptions = [
    { value: THEME_MODE_SYSTEM, label: PopupText.configuration.themeModeSystem },
    { value: THEME_MODE_LIGHT, label: PopupText.configuration.themeModeLight },
    { value: THEME_MODE_DARK, label: PopupText.configuration.themeModeDark }
  ];
  const aiReady =
    tabInScope &&
    !unsupportedByGraphql &&
    baseUrlReady &&
    siteIdReady &&
    endpointReady &&
    currentPageMarkingAllowed &&
    Boolean(tokenValue) &&
    renderModeReady;
  const markingInspectionInScope = Boolean(
    currentTabId &&
    toggleEnabled &&
    effectiveTabState.enabled &&
    effectiveTabState.baseUrl
  );
  // Silent highlighting runs the editor reveal/freeze warmup, which also reports
  // an inspection-pending status. Poll it in silent mode (in-scope page) so the
  // "Inspecting page..." curtain can track silent reveal/freeze, not just marking.
  const silentInspectionInScope = Boolean(
    currentTabId &&
    !markingInspectionInScope &&
    tabInScope &&
    baseUrlReady
  );
  let inspectionStatus =
    contentModeStatus ||
    (markingInspectionInScope || silentInspectionInScope
      ? await messages.sendTabMessageToTab(currentTabId, { type: "getInspectionStatus" })
      : null);
  let contentInspectionPending = Boolean(
    inspectionStatus &&
      inspectionStatus.ok &&
      (inspectionStatus.active || inspectionStatus.pending)
  );
  const backgroundActivationInspectionPending = Boolean(
    currentTabId &&
      popupBackgroundStateTabId === currentTabId &&
      popupBackgroundActivation &&
      popupBackgroundActivation.bootstrapStatus === "bootstrapping" &&
      toggleEnabled &&
      effectiveTabState.enabled &&
      effectiveTabState.baseUrl
  );
  const navigationInspectionPending = Boolean(
    backgroundActivationInspectionPending ||
    (currentTabId &&
      popupNavigationInspectionOverlayStarted &&
      popupNavigationInspectionOverlayTabId === currentTabId &&
      toggleEnabled &&
      effectiveTabState.enabled &&
      effectiveTabState.baseUrl) ||
    contentInspectionPending
  );
  isEnabled = toggleEnabled && (
    contentMarkingModeActive ||
    previewRestorePending ||
    navigationInspectionPending ||
    (siteIdReady && renderModeReady && currentPageMarkingAllowed)
  );
  if (
    tabInScope &&
    toggleEnabled &&
    !aiComputeRunActive &&
    !aiPreviewSessionActive &&
    !previewRestorePending &&
    // An unconfirmed post-exit restore behaves like the pending window above:
    // readiness states can still be reloading right after the exit settle, and
    // hard-disabling here would tear down the just-restored session (#5/#14).
    !state.previewCloseMarkingRestoreUnconfirmed &&
    !navigationInspectionPending &&
    (!siteIdReady || !renderModeReady || pageTypeUiBlocked) &&
    currentTabId &&
    !markingPassIsStale()
  ) {
    toggleEnabled = false;
    isEnabled = false;
    clearLastPopupEnabled();
    effectiveTabState = { ...effectiveTabState, enabled: false };
    await messages.setTabState(currentTabId, {
      enabled: false,
      baseUrl: state.currentBaseUrl || effectiveTabState.baseUrl || ""
    });
    await messages.sendTabMessageWithRetry({ type: "setEnabled", enabled: false });
    markingEpochAtPassStart = bumpMarkingSessionEpoch();
  }
  if (state.propertyPageTypesInvalidAlertPending) {
    state.propertyPageTypesInvalidAlertPending = false;
    if (pageTypeUiBlocked) {
      window.alert(PopupText.pageTypes.currentPageInvalidAfterRefreshAlert);
    }
  }
  const currentSelectors = getCurrentSelectorsFromConfig();
  const lastSaved = getLastSubmittedSelectorsFromConfig();
  const selectorCount = combineAiSelectorSet(currentSelectors).length;
  const hasNewSelectors =
    selectorCount > 0 &&
    !aiSelectorSetsEqual(currentSelectors, lastSaved);
  if (!hasNewSelectors && state.aiSelectorsComputedBaseUrl === state.currentBaseUrl) {
    state.aiSelectorsComputedSinceLastSubmit = false;
    state.aiSelectorsComputedBaseUrl = "";
  }
  const aiBusy = Boolean(state.aiRequestInFlight);
  const hasStoredSelectors = hasCalculatedSelectorsFromConfig();
  const selectorsPendingConfigSync =
    state.selectorsPendingConfigSync &&
    utils.sameBaseUrl(state.selectorsPendingConfigSyncBaseUrl, state.currentBaseUrl);

  if (!preserveCurrentDraftStatus) {
    state.currentDraftEntry = null;
    state.currentSavedEntry = null;
    state.currentDraftDirty = false;
    state.currentDraftAvailable = false;
    state.currentPageSaveReconciliation = null;
    state.currentPageSaveReconciliationPending = false;
  }
  let latestRuntimeStatus = null;
  const runtimeStatusBaseUrl = state.currentBaseUrl || effectiveTabState.baseUrl || "";
  if (
    runtimeStatusBaseUrl &&
    currentTabId &&
    (isEnabled || toggleEnabled || effectiveTabState.enabled || navigationInspectionPending || silentInspectionInScope)
  ) {
    latestRuntimeStatus = await refreshCurrentPageRuntimeStatus({
      tabId: currentTabId,
      baseUrl: runtimeStatusBaseUrl,
      preserveDraft: preserveCurrentDraftStatus
    });
  }
  if (
    latestRuntimeStatus &&
    latestRuntimeStatus.inspectionStatus &&
    latestRuntimeStatus.inspectionStatus.ok
  ) {
    inspectionStatus = latestRuntimeStatus.inspectionStatus;
    void inspectionStatus;
    contentInspectionPending = Boolean(latestRuntimeStatus.inspectionPending);
    if (latestRuntimeStatus.inspectionStatus.markingEnabled) {
      isEnabled = true;
    }
  }
  const pageSaveReconciliationPending = Boolean(state.currentPageSaveReconciliationPending);
  const pageInspectionBusy =
    contentInspectionPending ||
    (pageSaveReconciliationPending &&
      Boolean(
        state.currentPageSaveReconciliation &&
        state.currentPageSaveReconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON
      ));
  // In silent mode no spinner key drives the curtain, so keep polling until the
  // editor reveal/freeze warmup clears and then drop the "Inspecting page..."
  // curtain. Reconcile a popup-origin navigation-inspection lease as soon as the
  // warmup settles.
  const silentNavSpinnerStuck = Boolean(
    silentInspectionInScope &&
    currentTabId &&
    hasProjectedNavigationInspectionSpinner()
  );
  if (((pageInspectionBusy && silentInspectionInScope) || silentNavSpinnerStuck) && currentTabId) {
    scheduleStaleInspectionBusyClear(currentTabId, runtimeStatusBaseUrl, {
      reconcileSilentNavSpinner: silentNavSpinnerStuck
    });
  }
  const sessionHasPendingChanges = hasSessionPendingChanges(
    state.currentConfig,
    pageMarkings,
    backendSavedPageMarkings,
    {
      currentDraftDirty: state.currentDraftDirty,
      reconciliationPending: pageSaveReconciliationPending,
      selectorsPendingConfigSync
    }
  );
  const currentPageHasPendingChanges = hasCurrentPagePendingChanges(
    pageMarkings,
    backendSavedPageMarkings,
    {
      pageUrl,
      currentDraftDirty: state.currentDraftDirty,
      reconciliationPending: pageSaveReconciliationPending
    }
  );
  // Explicit popup-owned marking session phase. Fingerprints remain captured for
  // dirty/discard bookkeeping, but button gating no longer depends on their shape.
  const aiRunUpToDate = isAiRunUpToDateForCurrentMarkings();
  const sessionRequiresAiRun = aiRunUpToDate
    ? false
    : doesSessionRequireAiRun(
        state.currentConfig,
        pageMarkings,
        backendSavedPageMarkings,
        { currentDraftDirty: state.currentDraftDirty, aiRunUpToDate }
      );

  let resolvedView =
    state.currentView ||
    uiModule.getViewState().currentView ||
    uiModule.View.Marking;
  if (!configurationComplete) {
    resolvedView = uiModule.View.Configuration;
    state.configViewLocked = true;
  } else if (state.configViewLocked) {
    resolvedView = uiModule.View.Marking;
    state.configViewLocked = false;
  }
  state.currentView = resolvedView;

  const remoteConfigRetryBlocked =
    state.remoteConfigConnectionIssue && resolvedView !== uiModule.View.Configuration;
  if (remoteConfigRetryBlocked) {
    scheduleRemoteConfigRetry();
  } else {
    clearRemoteConfigRetryTimer();
  }
  // P5: remember the pass-computed busy aux flags so the TARGETED spinner
  // repaint (buildProjectedBusyViewState outside a full pass) reuses them —
  // they only change with data refreshes, never with spinner broadcasts.
  lastProjectedBusyAuxFlags = { pageInspectionBusy, remoteConfigRetryBlocked };

  nextViewState.currentView = resolvedView;
  nextViewState.configurationContinueDisabled = !configurationComplete;
  nextViewState.configurationBackDisabled = !configurationComplete;
  nextViewState.configurationNoticeVisible =
    !configurationComplete ||
    remoteConfigRetryBlocked;
  nextViewState.configurationNoticeText = remoteConfigRetryBlocked
    ? PopupText.configuration.remoteConfigRetryNotice
    : configurationComplete
      ? ""
      : PopupText.configuration.continueSetupNotice;
  const traceDiagnosticsEnabled = isFeatureEnabled("traceDiagnostics");
  nextViewState.traceModeEnabled = traceDiagnosticsEnabled && Boolean(state.traceModeEnabled);
  const traceEvents: PopupViewState["traceEvents"] =
    traceDiagnosticsEnabled && Array.isArray(state.traceEvents)
      ? state.traceEvents
      : [];
  nextViewState.traceEvents = traceEvents;
  nextViewState.traceEventCount = traceEvents.length;

  const pageScopedUiDisabled =
    unsupportedByGraphql ||
    !tabInScope ||
    remoteConfigRetryBlocked ||
    isPropertyLockBlockingEditing();
  if (pageScopedUiDisabled) {
    clearLastPopupEnabled();
  }
  const configurationUiDisabled = aiBusy;
  const silentModeActive =
    !pageScopedUiDisabled &&
    resolvedView === uiModule.View.Marking &&
    renderModeReady &&
    !isEnabled;
  // The brain-published silent-mode fact must reflect the actual PAGE state, not
  // which popup view is open. Gating it on the Marking view made the popup report
  // silentModeActive=false while the config view was open, conflicting with the
  // content script (which still reports silentModeActive=true for the same page).
  // The brain merges both sources into one fact, so the conflict made it oscillate
  // -> the silent-highlight directive flickered -> the page-inspection curtain
  // flickered and the config inputs were overwritten on every re-render. Keep the
  // popup-local view gate for the Marking-only UI sections, but publish the
  // view-independent page state.
  const silentModeActivePageState =
    !pageScopedUiDisabled &&
    renderModeReady &&
    !isEnabled;
  const desktopPreviewVisible = Boolean(
    desktopPreviewFeatureEnabled &&
    silentModeActive &&
    currentTabId &&
    tabInScope &&
    state.currentConfig &&
    hasStoredSelectors
  );
  const desktopPreviewActive = Boolean(
    desktopPreviewVisible && state.currentDesktopPreviewEnabled
  );
  const mainUiHidden =
    pageScopedUiDisabled ||
    !isEnabled ||
    (!navigationInspectionPending && (!siteIdReady || !renderModeReady));
  nextViewState.toggleEnabled = pageScopedUiDisabled ? false : isEnabled;
  nextViewState.renderModeReady = renderModeReady;
  const todoListVisible = siteIdReady && renderModeReady;
  nextViewState.todoListVisible = todoListVisible;
  nextViewState.renderModeValue = renderModeField.value;
  nextViewState.renderModeReadOnly = !renderModeField.isEditing;
  nextViewState.renderModeSetVisible = renderModeRequired && renderModeField.isEditing;
  nextViewState.renderModeEditVisible = renderModeSet && renderModeRequired;
  nextViewState.renderModeEditText = state.renderModeEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.renderModeNoticeText = renderModeNoticeText;
  nextViewState.renderModeNoticeVisible = renderModeNoticeVisible;
  nextViewState.renderModeUndeterminedVisible =
    renderModeValueUndetermined || state.renderModeDetectionUnsure;
  nextViewState.renderModeWarningVisible = false;
  nextViewState.renderModeWarningAcknowledgeChecked = false;
  nextViewState.renderModeWarningOkDisabled = true;
  nextViewState.lynxChecklistVisible = Boolean(state.lynxChecklistVisible);
  nextViewState.lynxChecklistAiAnswer = state.lynxChecklistAiAnswer || "";
  nextViewState.lynxChecklistPageTypes = Array.isArray(state.lynxChecklistPageTypes)
    ? state.lynxChecklistPageTypes
    : [];
  nextViewState.lynxChecklistAiQuestionDisabled = Boolean(state.lynxChecklistAiQuestionDisabled);
  nextViewState.lynxChecklistAiQuestionHidden = Boolean(state.lynxChecklistAiQuestionHidden);
  nextViewState.lynxChecklistNoticeText = state.lynxChecklistNoticeText || "";
  // 'markings-changed' is CONTENT-BORN with provenance since P3 (core's sole
  // user marking-edit commit path emits it); the popup no longer synthesizes
  // it from level edges — internal draft reshapes can never move the machine.
  nextViewState.sessionHasPendingChanges = sessionHasPendingChanges;
  nextViewState.currentPageHasPendingChanges = currentPageHasPendingChanges;
  nextViewState.sessionRequiresAiRun = sessionRequiresAiRun;
  nextViewState.renderModeInputDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !state.currentConfig;
  const renderModeInspectButtonsDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !(state.currentTab && state.currentTab.id);
  nextViewState.renderModeInspectButtonsDisabled = renderModeInspectButtonsDisabled;
  // Alternate the two inspect buttons by the tab's current JavaScript mode so the
  // same mode cannot be triggered twice: while the page runs JavaScript only
  // "Without JavaScript" is enabled, and once it is held in no-JS mode only "With
  // JavaScript" is enabled.
  nextViewState.renderModeInspectWithoutJavaScriptDisabled =
    renderModeInspectButtonsDisabled || Boolean(state.renderModeTabJsDisabled);
  nextViewState.renderModeInspectWithJavaScriptDisabled =
    renderModeInspectButtonsDisabled || !state.renderModeTabJsDisabled;
  nextViewState.renderModeSetDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    renderModeValueUndetermined ||
    !state.currentConfig;
  nextViewState.renderModeEditDisabled =
    aiBusy ||
    pageScopedUiDisabled ||
    !renderModeRequired ||
    !state.currentConfig;
  nextViewState.renderModeSummaryTitle = PopupText.renderMode.title;
  nextViewState.renderModeSummaryOpen =
    !renderModeSet || state.renderModeEditMode || state.renderModeSummaryOpen;
  const renderModeSectionVisible =
    renderModeRequired && (!renderModeSet || state.renderModeEditMode);
  nextViewState.renderModeSectionVisible = renderModeSectionVisible;
  // Suppress page-prep curtains until the render mode is KNOWN-SET —
  // auto-content-detection is disabled, so no initial spinner belongs over
  // the manual detection posture (architect, 2026-07-03), and gating on
  // "required" alone still flashed the curtain for the first ~2s while the
  // base/site resolution was in flight. Confirmed sites simply get their
  // prep curtain once the config resolves; edit mode over a set value keeps
  // normal curtains.
  nextViewState.renderModeDetectionViewActive = !renderModeSet;
  nextViewState.renderModeChangeMenuVisible =
    resolvedView === uiModule.View.Marking &&
    renderModeRequired &&
    renderModeSet &&
    !pageScopedUiDisabled &&
    currentPageMarkingAllowed;
  nextViewState.stageBaseValue = stageBaseField.value;
  nextViewState.stageBaseReadOnly = !stageBaseField.isEditing;
  nextViewState.stageBaseSetVisible = stageBaseField.isEditing;
  nextViewState.stageBaseEditVisible = stageBaseSet;
  nextViewState.stageBaseEditText = state.stageBaseEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.stageBaseNoticeText = stageBaseField.noticeText;
  nextViewState.stageBaseNoticeVisible = stageBaseField.noticeVisible;
  nextViewState.stageBaseInputDisabled = configurationUiDisabled;
  nextViewState.stageBaseSetDisabled = configurationUiDisabled;
  nextViewState.stageBaseEditDisabled = configurationUiDisabled;
  nextViewState.themeValue = normalizeThemeValue(state.currentTheme);
  nextViewState.themeModeValue = normalizeThemeModeValue(state.currentThemeMode);
  nextViewState.themeOptions = [...THEME_OPTIONS];
  nextViewState.themeModeOptions = themeModeOptions;
  nextViewState.themeControlsDisabled = configurationUiDisabled;
  nextViewState.loginEmailValue = loginEmailValue;
  nextViewState.loginPasswordValue = loginPasswordValue;
  nextViewState.loginCredentialsDisabled =
    configurationUiDisabled || !loginCredentialsEnabled;
  nextViewState.loginStatusText = tokenValue
    ? PopupText.authentication.statusTokenSaved
    : PopupText.authentication.statusLoginRequired;
  nextViewState.loginStatusTone = tokenValue ? "success" : "warning";
  nextViewState.loginActionDisabled =
    configurationUiDisabled ||
    !loginCredentialsEnabled ||
    !isValidEmail(loginEmailValue.trim()) ||
    !loginPasswordValue.trim();
  nextViewState.configEndpointUrlValue = configEndpointField.value;
  nextViewState.configEndpointUrlReadOnly = !configEndpointField.isEditing;
  nextViewState.configEndpointSetVisible = configEndpointField.isEditing;
  nextViewState.configEndpointEditVisible = configEndpointSet;
  nextViewState.configEndpointEditText = state.configEndpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.configEndpointNoticeText = configEndpointField.noticeText;
  nextViewState.configEndpointNoticeVisible = configEndpointField.noticeVisible;
  nextViewState.configEndpointInputDisabled = configurationUiDisabled;
  nextViewState.configEndpointSetDisabled = configurationUiDisabled;
  nextViewState.configEndpointEditDisabled = configurationUiDisabled;

  nextViewState.endpointUrlValue = endpointField.value;
  nextViewState.endpointUrlReadOnly = !endpointField.isEditing;
  nextViewState.endpointSetVisible = endpointField.isEditing;
  nextViewState.endpointEditVisible = endpointSet;
  nextViewState.endpointEditText = state.endpointEditMode
    ? ViewText.cancelAction
    : ViewText.changeAction;
  nextViewState.endpointNoticeText = endpointField.noticeText;
  nextViewState.endpointNoticeVisible = endpointField.noticeVisible;
  nextViewState.endpointInputDisabled = configurationUiDisabled;
  nextViewState.endpointSetDisabled = configurationUiDisabled;
  nextViewState.endpointEditDisabled = configurationUiDisabled;
  nextViewState.clearDomainCacheDisabled =
    !isFeatureEnabled("cacheAndUnregisterTools") || state.clearDomainCacheDisabled;
  nextViewState.unregisterCurrentTabDisabled =
    !isFeatureEnabled("cacheAndUnregisterTools") ||
    state.unregisterCurrentTabDisabled || !state.currentTab || !state.currentTab.id;
  nextViewState.computeButtonText =
    state.aiRequestInFlight === "compute"
      ? ViewText.computeButtonBusy
      : ViewText.computeButtonIdle;
  nextViewState.saveExcludesButtonText =
    state.aiRequestInFlight === "save"
      ? ViewText.saveExcludesBusy
      : ViewText.saveExcludesIdle;
  Object.assign(nextViewState, buildProjectedBusyViewState());
  nextViewState.aiDirtyNoticeVisible = pageSaveReconciliationPending;
  nextViewState.aiDirtyNoticeText = pageSaveReconciliationPending
    ? PopupText.page.statusServerSyncPending
    : PopupText.ai.dirtyNotice;
  nextViewState.cssSelectorsVisible = silentModeActive;
  nextViewState.baseUrlInputValue = baseField.value;
  nextViewState.baseUrlNoticeText =
    state.remoteConfigConnectionIssue
      ? PopupText.status.remoteConfigRetryNotice
      : effectiveSiteIdBlockedReason || baseField.noticeText;
  nextViewState.baseUrlNoticeVisible =
    state.remoteConfigConnectionIssue ||
    Boolean(effectiveSiteIdBlockedReason) ||
    baseField.noticeVisible;
  const pageControlsVisible = !mainUiHidden && renderModeReady;
  const pageSaveUiState = buildPageSaveUiState({
    pageControlsVisible,
    sessionHasPendingChanges,
    sessionRequiresAiRun,
    currentDraftDirty: state.currentDraftDirty,
    reconciliation: state.currentPageSaveReconciliation
  });
  nextViewState.pageSaveMobileSimulationRequiredVisible =
    pageSaveUiState.pageSaveMobileSimulationRequiredVisible;
  nextViewState.pageSaveMobileSimulationRequiredText =
    PopupText.page.mobileSimulationRequired;
  const secondaryGatesViewState = resolveSecondaryGatesViewStatePatch({
    currentTabId,
    projectedTabId: popupBackgroundStateTabId,
    secondaryGates: popupBackgroundSecondaryGates || null
  });
  Object.assign(nextViewState, secondaryGatesViewState);
  nextViewState.pageDraftStatusText = pageSaveUiState.pageDraftStatusText;
  nextViewState.pageDraftStatusTone = pageSaveUiState.pageDraftStatusTone;
  nextViewState.pageSessionNoticeVisible = pageSaveUiState.pageSessionNoticeVisible;
  nextViewState.pageSessionNoticeText = pageSaveUiState.pageSessionNoticeText;
  nextViewState.aiDirtyNoticeText = pageSaveUiState.aiDirtyNoticeText;
  nextViewState.syncLoadStatusText = state.lastConfigLoadStatusText || ViewText.syncLoadIdle;
  nextViewState.syncLoadStatusTone = state.lastConfigLoadStatusTone || "muted";
  nextViewState.syncSaveStatusText = state.lastConfigSaveStatusText || ViewText.syncSaveIdle;
  nextViewState.syncSaveStatusTone = state.lastConfigSaveStatusTone || "muted";
  nextViewState.pageDataNewNoticeHidden = pageSaveUiState.pageDataNewNoticeHidden;
  nextViewState.deviceEmulationEnabled = normalizedDeviceState.enabled;
  nextViewState.deviceMode = normalizedDeviceState.mode;
  nextViewState.deviceScale = normalizedDeviceState.scale.toFixed(2);
  nextViewState.deviceScaleValue = formatScalePercent(normalizedDeviceState.scale);
  nextViewState.deviceControlsDisabled = Boolean(state.deviceControlsDisabled || isEnabled);
  nextViewState.desktopPreviewNoticeVisible = secondaryGatesViewState.desktopPreviewEnabled;
  nextViewState.desktopPreviewNoticeText = PopupText.device.desktopPreviewNotice;
  nextViewState.pageTypeGroups = pageTypeCoverageModel.pageTypes.map((pageType) => {
    const groupCurrent =
      currentPageMarkingAllowed &&
      currentPageCandidateState.pageTypeKey === pageType.key;
    return {
      key: pageType.key,
      title: pageType.title,
      markedCount: pageType.markedCount,
      missing: pageType.missing,
      current: groupCurrent,
      candidates: pageType.candidates.map((candidate) => {
        const candidateKey = buildPageMarkingKey(candidate.url, pageType.key);
        const isCurrent = groupCurrent && currentPageCandidateState.url === candidate.url;
        return {
          url: candidate.url,
          label: formatPageTypeCandidateLabel(candidate.url),
          wordsCount: candidate.wordsCount,
          marked: activeMarkedPageKeys.has(candidateKey),
          current: isCurrent,
          duplicate: Boolean(candidate.duplicate),
          navigationDisabled: Boolean(candidate.duplicate) || isCurrent,
          duplicateNotice:
            candidate.duplicate && Array.isArray(candidate.duplicatePageTypes) && candidate.duplicatePageTypes.length
              ? `Also listed under ${candidate.duplicatePageTypes.join(", ")}.`
              : ""
        };
      })
    };
  });
  nextViewState.pageTypeGroupsEmptyText = propertyPageTypesFetchError && !pageTypeCoverageModel.pageTypes.length
    ? propertyPageTypesFetchError
    : baseUrlReady
      ? PopupText.pageTypes.emptyState
      : effectiveSiteIdBlockedReason || ViewText.noMappedBaseUrlOrSiteId;
  const pageTypeCandidateNoticeText = currentPageCandidateState.status === "duplicate"
    ? PopupText.pageTypes.duplicateCurrentPage
    : currentPageCandidateState.status === "missing"
      ? (hasStoredCurrentPageEntry || currentPageEntryMarkedInvalid)
        ? PopupText.pageTypes.removedCurrentPage
        : PopupText.pageTypes.blockedCurrentPage
      : currentPageCandidateState.status === "empty"
        ? (propertyPageTypesFetchError || PopupText.pageTypes.emptyState)
        : pageTypeCoverageModel.invalidMarkedPages.length
          ? PopupText.pageTypes.invalidStoredNotice
          : "";
  nextViewState.pageTypeNoticeText = state.propertyPageTypesChangeNoticeVisible
    ? PopupText.pageTypes.changedNotice
    : pageTypeCandidateNoticeText;
  nextViewState.pageTypeNoticeVisible = Boolean(nextViewState.pageTypeNoticeText);
  nextViewState.lynxChecklistPageTypes = propertyPageTypes;
  nextViewState.markedPages = pageTypeCoverageModel.activeMarkedPages
    .map((item) => {
      const key = buildPageMarkingKey(item.url, item.pageType);
      const sourceItem = pageMarkingItemByKey.get(key);
      return {
        url: item.url,
        title: sourceItem && sourceItem.title ? sourceItem.title : item.title,
        pageType: item.pageType,
        count: sourceItem && Number.isFinite(sourceItem.count) ? sourceItem.count : 0
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
  nextViewState.markedPagesEmptyText = baseUrlReady
    ? PopupText.pageTypes.markRequirement
    : effectiveSiteIdBlockedReason || ViewText.noMappedBaseUrlOrSiteId;
  const nextTodoExpansionKey = buildTodoExpansionContextKey(currentTabId, state.currentBaseUrl);
  const currentTodoExpansionKey = state.currentTodoExpansionKey;
  const todoExpansionContextChanged = nextTodoExpansionKey !== currentTodoExpansionKey;
  const hasNoTodoExpansionContext = !nextTodoExpansionKey;
  const movedToDifferentProperty = state.currentBaseUrl !== previousBaseUrl;
  const shouldAutoCollapseOnContextChange =
    todoExpansionContextChanged && Boolean(view.todoAutoCollapse);
  const todoExpansionShouldCollapse =
    hasNoTodoExpansionContext ||
    movedToDifferentProperty ||
    shouldAutoCollapseOnContextChange;
  if (todoExpansionShouldCollapse) {
    Object.assign(nextViewState, getCollapsedTodoExpansionState());
  } else if (todoExpansionContextChanged) {
    Object.assign(
      nextViewState,
      getSavedTodoExpansionState(nextTodoExpansionKey) || getCollapsedTodoExpansionState()
    );
  }
  if (
    propertyPageTypesRefreshChanged &&
    state.propertyPageTypesChangeForceTodoOpen &&
    todoListVisible
  ) {
    nextViewState.todoControlsMenuOpen = false;
    nextViewState.todoSectionExpanded = true;
    state.propertyPageTypesChangeForceTodoOpen = false;
  }
  state.currentTodoExpansionKey = nextTodoExpansionKey;

  await syncRenderModeDebuggerLifecycle({
    wasVisible: Boolean(view.renderModeSectionVisible),
    isVisible: renderModeSectionVisible,
    currentTabId
  });

  // Reflect the brain's session dictation as the LAST mutation before the
  // synchronous setViewState. refreshUiInner has multiple awaits above (token
  // validation, config/tab fetches, syncRenderModeDebuggerLifecycle), so a run
  // that started while the dictation curtain was visible can finish after the
  // brain cleared it. Deriving the dictation-owned fields here (not earlier)
  // keeps overlapping/late-completing refreshes from writing a stale visible
  // curtain over an already-cleared one (e.g. after a render-mode inspection).
  //
  // Preview fields are re-resolved the same way, from the routine's CURRENT
  // state: this pass captured its preview snapshot seconds ago and passes
  // interleave — carrying the pass-start snapshot here let a pre-hydration
  // pass finishing late stomp the hydrated list (reflex-arc single-writer).
  Object.assign(nextViewState, resolvePreviewRoutineViewState());
  applyCentralSessionDictation(nextViewState, currentTabId);
  uiModule.setViewState(nextViewState);
  if (currentTabId) {
    const projectedComputingAiActive =
      popupBackgroundStateTabId === currentTabId &&
      popupBackgroundSessionPhase === "computing_ai";
    const aiBusyForSessionFacts =
      Boolean(state.aiRequestInFlight) || state.aiComputeStartPending || projectedComputingAiActive;
    const aiComputingForSessionFacts =
      state.aiRequestInFlight === "compute" || state.aiComputeStartPending || projectedComputingAiActive;
    const busyVisibleForSessionFacts =
      projectedComputingAiActive || Boolean(nextViewState.isBusy || nextViewState.aiControlsBusy);
    const busyMessageForSessionFacts =
      projectedComputingAiActive &&
        typeof nextViewState.sessionCurtainMessage === "string" &&
        nextViewState.sessionCurtainMessage
        ? nextViewState.sessionCurtainMessage
        : typeof nextViewState.busyMessage === "string"
          ? nextViewState.busyMessage
          : "";
    const busyNoteForSessionFacts =
      projectedComputingAiActive &&
        typeof nextViewState.sessionCurtainNote === "string" &&
        nextViewState.sessionCurtainNote
        ? nextViewState.sessionCurtainNote
        : typeof nextViewState.aiRunSpinnerNote === "string"
          ? nextViewState.aiRunSpinnerNote
          : "";
    const popupOwnsAiRunFacts = state.aiRunResumed;
    // Post-exit publish protection (#5/#14): refreshUi passes interleave, so a
    // pass whose reads predate the latest marking transition can compute
    // isEnabled:false (stale contentMarkingModeActive/toggleEnabled) AFTER the
    // exit restore already landed. One such publish makes the brain dictate
    // SILENT, which directs content out of marking and collapses the session
    // for real. Two exact guards, no time windows:
    // - a STALE pass (epoch moved since this pass started) publishes no
    //   marking facts at all; the transition site always runs a fresh pass
    //   that republishes them, and the sticky popup session facts keep serving
    //   the last good values to the brain heartbeat meanwhile;
    // - a CURRENT pass inside an unconfirmed post-exit restore clamps the
    //   published marking facts to the restore target (enabled) — content's
    //   async re-enable can outlive any fixed window, so the hold ends only
    //   when content is first observed re-enabled (or a popup-initiated
    //   marking transition supersedes the restore).
    const skipMarkingFactsFromStalePass = markingPassIsStale();
    const clampMarkingFactsToRestoreTarget = Boolean(
      !isEnabled &&
        state.previewCloseMarkingRestoreUnconfirmed &&
        !state.previewRestorePending
    );
    const publishedIsEnabled = clampMarkingFactsToRestoreTarget ? true : isEnabled;
    const publishedSilentModeActive = clampMarkingFactsToRestoreTarget
      ? false
      : silentModeActivePageState;
    publishCurrentSessionFacts(currentTabId, {
      baseUrlReady,
      pageScopedUiDisabled,
      navigationInspectionPending,
      siteIdReady,
      renderModeReady,
      pageTypeUiBlocked,
      currentPageHasPendingChanges,
      pageInspectionBusy,
      desktopPreviewVisible,
      desktopPreviewActive,
      deviceControlsDisabled: Boolean(state.deviceControlsDisabled || isEnabled),
      ...(skipMarkingFactsFromStalePass
        ? {}
        : { isEnabled: publishedIsEnabled, silentModeActive: publishedSilentModeActive }),
      aiReady,
      ...(popupOwnsAiRunFacts
        ? { aiBusy: aiBusyForSessionFacts, aiComputing: aiComputingForSessionFacts }
        : {}),
      aiRunPhase: state.sessionAiRunPhase,
      aiRunUpToDate,
      previewActive,
      // The popup owns whether IT has a preview session. nextViewState's
      // previewBlocked is brain-DICTATED; republishing it verbatim echoes the
      // brain's projection back as a popup fact, so a stale blocked:true from
      // a torn-down session self-sustains forever (fact<->dictation loop that
      // survives popup restarts and full navigations — live-traced 2026-07-03
      // 04:12, view stuck on "Preview mode is active" with previewActive
      // false). Publish blocked only while the popup actually has a standing
      // preview session; the dictated nuance (e.g. popover minimized) still
      // flows through while the session exists.
      previewBlocked: Boolean(
        (state.previewOpenIntent || state.previewRestorePending) &&
          nextViewState.previewBlocked
      ),
      previewItemsPending,
      previewRestorePending,
      sessionHasPendingChanges,
      sessionRequiresAiRun,
      currentDraftDirty: state.currentDraftDirty,
      // Reconciliation-pending is now brain-owned, fed by content save-lifecycle
      // events (core.setPageSaveReconciliationFactReporter). The popup no longer
      // reports the boolean fact; it only consumes brain dictation for it.
      propertyLockBlocked: isPropertyLockBlockingEditing(),
      saving: state.aiRequestInFlight === "save",
      discarding: false,
      hasStoredSelectors,
      lynxChecklistCanSend: pageTypeCoverageModel.canSend,
      lynxChecklistBlockingReason: pageTypeCoverageModel.canSend
        ? { code: "", pageTypeKeys: [] }
        : {
          code: typeof pageTypeCoverageModel.blockingReason.code === "string"
            ? pageTypeCoverageModel.blockingReason.code
            : "",
          pageTypeKeys: Array.isArray(pageTypeCoverageModel.blockingReason.pageTypeKeys)
            ? pageTypeCoverageModel.blockingReason.pageTypeKeys.filter(
              (value): value is string => typeof value === "string"
            )
            : []
        },
      busyVisible: busyVisibleForSessionFacts,
      busyMessage: busyMessageForSessionFacts,
      busyNote: busyNoteForSessionFacts,
      busyTimerText: ""
    }, refreshSessionFactsSeq);
  }
}

async function maybeResumePersistedAiRun() {
  if (state.aiRequestInFlight || state.aiRunResumeInFlight) {
    return;
  }
  const currentTabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const siteId = normalizeSiteIdValue(state.currentSiteId);
  if (!currentTabId || !siteId) {
    return;
  }
  const resumeCheckKey = `${currentTabId}|${siteId}`;
  if (state.aiRunResumeCheckKey === resumeCheckKey) {
    return;
  }
  state.aiRunResumeCheckKey = resumeCheckKey;
  state.aiRunResumeInFlight = true;
  try {
    const persistedRun = await loadPersistedAiRunRecord();
    if (!persistedRun) {
      await clearStaleProjectedComputingAiState();
      return;
    }
    if (!shouldResumePersistedAiRun(persistedRun, siteId)) {
      if (persistedRun.siteId === siteId) {
        await clearPersistedAiRunRecord();
        await syncAiComputeLock(false);
      }
      await clearStaleProjectedComputingAiState();
      return;
    }
    const { endpointValue, tokenValue } = await helpers.loadGlobalAiSettings();
    if (!endpointValue || !tokenValue) {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      await clearStaleProjectedComputingAiState();
      return;
    }
    let statusResult;
    try {
      statusResult = await requestAiRunStatus({
        sessionId: persistedRun.sessionId
      });
    } catch {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      await clearStaleProjectedComputingAiState();
      uiModule.showToast(PopupText.ai.runFailed);
      return;
    }
    if (statusResult.notFound) {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      await clearStaleProjectedComputingAiState();
      uiModule.showToast(PopupText.ai.runUnavailable);
      return;
    }
    if (!statusResult.ok || statusResult.status === "error") {
      await clearPersistedAiRunRecord();
      await syncAiComputeLock(false);
      await clearStaleProjectedComputingAiState();
      uiModule.showToast(PopupText.ai.runFailed);
      return;
    }
    const currentPageUrl = getCurrentPageUrl();
    setAiRunActiveState({
      sessionId: persistedRun.sessionId,
      siteId,
      deadlineAt: persistedRun.deadlineAt,
      resumed: true,
      phase: statusResult.status
    });
    await refreshUi();
    const tabId = state.currentTab && state.currentTab.id;
    const aiRunResponse = await messages.requestTabResumeAi(tabId, {
      baseUrl: state.currentBaseUrl,
      sessionId: persistedRun.sessionId,
      siteId,
      deadlineAt: persistedRun.deadlineAt
    });
    if (!isPopupCommandSuccess<Record<string, unknown>>(aiRunResponse)) {
      await failAiRun(getAiRunCommandFailureMessage(aiRunResponse));
      return;
    }
    const runResult = aiRunResponse.result;
    if (!isSelectorSetTransferPayload(runResult.selectorSet)) {
      await failAiRun(PopupText.ai.runFailed);
      return;
    }
    state.aiRunPhase = "done";
    const { previewOpened } = await applyComputedSelectorSet(normalizeAiSelectorSet(runResult.selectorSet), {
      currentPageUrl,
      tokenValue
    });
    await stopAiRun({ unlockPage: !previewOpened });
    return;
  } finally {
    state.aiRunResumeInFlight = false;
  }
}

async function refreshUi(options: PopupRefreshOptions = {}) {
  const useBusyOverlay = options.useBusyOverlay !== false;
  const refreshOptions = {
    skipPropertyLockFetch: Boolean(options.skipPropertyLockFetch),
    propertyPageTypesRefreshChanged: Boolean(options.propertyPageTypesRefreshChanged),
    preserveCurrentDraftStatus: Boolean(options.preserveCurrentDraftStatus)
  };
  const response = useBusyOverlay
    ? await runWithBrainSpinnerLease(
      null,
      PopupText.overlay.loadingPopupAndPreparing,
      () => refreshUiInner(refreshOptions),
      {
        delayMs: POPUP_BUSY_OVERLAY_DELAY_MS,
        suppressIfActive: true,
        reason: "popup-refresh",
        source: "popup-refresh"
      }
    )
    : await refreshUiInner(refreshOptions);
  maybeResumePersistedAiRun().catch(() => {});
  return response;
}

function handleConfigEndpointInput(event: PopupValueEvent) {
  uiModule.setViewState({ configEndpointUrlValue: getPopupEventValue(event) });
}

function handleEndpointInput(event: PopupValueEvent) {
  uiModule.setViewState({ endpointUrlValue: getPopupEventValue(event) });
}

function handleStageBaseInput(event: PopupValueEvent) {
  uiModule.setViewState({ stageBaseValue: getPopupEventValue(event) });
}

async function handleThemeInput(event: PopupValueEvent) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const nextThemeValue = normalizeThemeValue(
    getPopupEventValue(event, state.currentTheme)
  );
  await applyThemeValue(nextThemeValue);
}

async function applyThemeValue(nextThemeValue: string) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  state.currentTheme = nextThemeValue;
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: state.currentTheme,
    themeModeValue: normalizeThemeModeValue(state.currentThemeMode),
    themeMenuOpen: false
  });
  await persistThemeSettings(state.currentTheme, state.currentThemeMode);
}

function getThemeMenuPlacement() {
  const refs = uiModule.getRefs();
  const button = refs.themeDropdownButton;
  if (!button || typeof button.getBoundingClientRect !== "function") {
    return "bottom";
  }
  const rect = button.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  return spaceBelow < 220 && spaceAbove > spaceBelow ? "top" : "bottom";
}

function handleThemeMenuToggle(event: PopupEventLike) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  event.stopPropagation?.();
  const view = uiModule.getViewState();
  uiModule.setThemeMenuOpen(!view.themeMenuOpen, getThemeMenuPlacement());
}

function handleThemeMenuKeyDown(event: PopupEventLike) {
  const key = typeof event?.key === "string" ? event.key : "";
  let indexDelta = null;
  if (key === "ArrowDown") {
    indexDelta = 1;
  } else if (key === "ArrowUp") {
    indexDelta = -1;
  }
  const options = Array.isArray(THEME_OPTIONS) ? THEME_OPTIONS : [];
  if (
    indexDelta === null ||
    !options.length ||
    !isFeatureEnabled("appearanceCustomization") ||
    uiModule.getViewState().themeControlsDisabled
  ) {
    return;
  }
  event.preventDefault?.();
  event.stopPropagation?.();
  const currentTheme = normalizeThemeValue(state.currentTheme);
  const currentIndex = options.findIndex((item) => item && item.value === currentTheme);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + indexDelta + options.length) % options.length;
  const nextOption = options[nextIndex];
  if (!nextOption) {
    return;
  }
  if (!uiModule.getViewState().themeMenuOpen) {
    uiModule.setThemeMenuOpen(true, getThemeMenuPlacement());
  }
  void handleThemeOptionSelect(nextOption.value).catch(() => {
    uiModule.showToast(PopupText.page.saveFailed);
  });
}

async function handleThemeOptionSelect(value: string) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  await applyThemeValue(normalizeThemeValue(value));
}

async function cycleTheme(direction: number) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const options = Array.isArray(THEME_OPTIONS) ? THEME_OPTIONS : [];
  if (!options.length) {
    return;
  }
  const currentTheme = normalizeThemeValue(state.currentTheme);
  const currentIndex = options.findIndex((item) => item && item.value === currentTheme);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const delta = direction < 0 ? -1 : 1;
  const nextIndex = (safeIndex + delta + options.length) % options.length;
  const nextOption = options[nextIndex];
  if (!nextOption) {
    return;
  }
  state.currentTheme = normalizeThemeValue(nextOption.value);
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: state.currentTheme,
    themeModeValue: normalizeThemeModeValue(state.currentThemeMode),
    themeMenuOpen: false
  });
  await persistThemeSettings(state.currentTheme, state.currentThemeMode);
}

async function handleThemePrevious() {
  await cycleTheme(-1);
}

async function handleThemeNext() {
  await cycleTheme(1);
}

async function handleThemeModeInput(event: PopupValueEvent) {
  if (!isFeatureEnabled("appearanceCustomization")) {
    resetDisabledAppearanceCustomization();
    return;
  }
  const nextThemeModeValue = normalizeThemeModeValue(
    getPopupEventValue(event, state.currentThemeMode)
  );
  state.currentThemeMode = nextThemeModeValue;
  applyPopupTheme(state.currentTheme, state.currentThemeMode);
  uiModule.setViewState({
    themeValue: normalizeThemeValue(state.currentTheme),
    themeModeValue: state.currentThemeMode
  });
  await persistThemeSettings(state.currentTheme, state.currentThemeMode);
}

function handleRenderModeInput(event: PopupValueEvent) {
  const nextRenderMode = normalizeUiRenderModeValue(
    getPopupEventValue(event, uiModule.getViewState().renderModeValue)
  );
  const view = uiModule.getViewState();
  const renderModeSetDisabled = Boolean(
    view.renderModeInputDisabled ||
      !view.renderModeSetVisible ||
      isUndeterminedRenderMode(nextRenderMode)
  );
  uiModule.setViewState({
    renderModeValue: nextRenderMode,
    renderModeSetDisabled
  });
}

async function runRenderModeInspectionReload(javaScriptDisabled: boolean) {
  const tabId = state.currentTab && state.currentTab.id;
  if (!tabId) {
    uiModule.showToast(PopupText.renderMode.toastUnavailable);
    return;
  }
  const operationId = `render-mode-inspection:${tabId}:${Date.now()}`;

  try {
    await runWithBrainSpinnerLease(null, PopupText.overlay.preparingRenderModeInspection, async () => {
      state.renderModeInspectionActive = true;
      try {
        const inspectionResponse = await requestPopupRenderModeInspection(tabId, {
          baseUrl: state.currentBaseUrl,
          javaScriptDisabled,
          operationId
        });
        const operationResult = inspectionResponse && inspectionResponse.ok && inspectionResponse.result &&
          typeof inspectionResponse.result === "object"
          ? inspectionResponse.result
          : null;
        const inspectionResult = isRenderModeRunInspectionOperationReply(operationResult)
          ? operationResult.result
          : (isRenderModeRunInspectionResult(operationResult) ? operationResult : null);
        const inspectionFailureError = inspectionResult && inspectionResult.followUpError
          ? inspectionResult.followUpError
          : (
          (isRenderModeRunInspectionOperationReply(operationResult) && operationResult.error
            ? operationResult.error
            : "")
          || (inspectionResponse && typeof inspectionResponse === "object" && "error" in inspectionResponse &&
              typeof inspectionResponse.error === "string"
            ? inspectionResponse.error
            : "")
          );
        const reloadResult = inspectionResult && inspectionResult.reloadResult && typeof inspectionResult.reloadResult === "object"
          ? inspectionResult.reloadResult
          : {
            ok: false,
            error: inspectionFailureError || PopupText.renderMode.toastInspectReloadFailed
          };
        const loadStarted = Boolean(inspectionResult && inspectionResult.loadStarted);
        const outcome = resolveRenderModeInspectionReloadOutcome(reloadResult, loadStarted, javaScriptDisabled);
        if (!outcome.ok) {
          uiModule.showToast(outcome.toast);
          return;
        }

        const followUpCompleted = Boolean(inspectionResult && inspectionResult.followUpCompleted);
        if (followUpCompleted) {
          const snapshot = inspectionResult && inspectionResult.inspectionSnapshot && typeof inspectionResult.inspectionSnapshot === "object"
            ? inspectionResult.inspectionSnapshot
            : null;
          if (snapshot) {
            rememberRenderModeInspectionSnapshot(
              state.currentBaseUrl,
              snapshot.pageUrl || (state.currentTab && state.currentTab.url) || "",
              snapshot
            );
          }
          await reconcilePropertyLockAfterRenderModeReload();
          await refreshUi({ useBusyOverlay: false });
        } else {
          // Inspection reload finished but never confirmed a render mode (e.g. a
          // site with no render mode set). Auto-clear the curtain to a usable
          // chooser and tell the user to try again instead of spinning forever.
          uiModule.showToast(PopupText.renderMode.toastInspectModeNotConfirmed);
          return;
        }
        uiModule.showToast(outcome.toast);
      } finally {
        state.renderModeInspectionActive = false;
        setPropertyLockViewStateFromLocalProjection();
      }
    }, {
      reason: "render-mode-inspection-start",
      source: "popup-render-mode"
    });
  } finally {
    scheduleStaleInspectionBusyClear(tabId, state.currentBaseUrl, {
      reconcileRenderModeNavSpinner: true
    });
  }
}

async function normalizeRenderModeDebuggerPage(tabId: number | null) {
  if (!tabId) {
    return;
  }

  const deviceState = await emulation.getDeviceEmulationState(tabId);
  if (deviceState && deviceState.enabled) {
    const reloadResult = await utils.reloadPageWithJavaScriptControl(tabId, false);
    if (!reloadResult.ok) {
      console.warn(
        "Unable to reload tab after re-enabling JavaScript:",
        reloadResult.error || "Unknown error"
      );
    }
    return;
  }

  const detachResult = await utils.detachDebugger(tabId);
  if (!detachResult.ok) {
    console.warn("Unable to detach debugger:", detachResult.error || "Unknown error");
  }

  const reloadResult = await chromeHelpers.reloadTab(tabId);
  if (!reloadResult.ok) {
    console.warn("Unable to reload tab after debugger detach:", reloadResult.error || "Unknown error");
  }
}

async function syncRenderModeDebuggerLifecycle({
  wasVisible,
  isVisible,
  currentTabId
}: RenderModeDebuggerLifecycleOptions) {
  const managedTabId = state.renderModeDebuggerTabId;

  if (isVisible) {
    if (!currentTabId) {
      return;
    }

    if (managedTabId && managedTabId !== currentTabId) {
      await normalizeRenderModeDebuggerPage(managedTabId);
      state.renderModeDebuggerTabId = null;
    }

    if (managedTabId === currentTabId) {
      await hideConsentForRenderModeInspection();
      return;
    }

    const attachResult = await utils.attachDebugger(currentTabId);
    if (attachResult.ok || attachResult.alreadyAttached) {
      state.renderModeDebuggerTabId = currentTabId;
      await hideConsentForRenderModeInspection();
      return;
    }

    console.warn("Unable to attach debugger for render mode section:", attachResult.error || "Unknown error");
    return;
  }

  if ((wasVisible || managedTabId) && managedTabId) {
    await normalizeRenderModeDebuggerPage(managedTabId);
    state.renderModeDebuggerTabId = null;
  }
}

async function handleRenderModeInspectWithJavaScript() {
  await runRenderModeInspectionReload(false);
}

async function handleRenderModeInspectWithoutJavaScript() {
  await runRenderModeInspectionReload(true);
}

function setLynxChecklistViewState() {
  uiModule.setViewState({
    lynxChecklistVisible: Boolean(state.lynxChecklistVisible),
    lynxChecklistAiAnswer: state.lynxChecklistAiAnswer || "",
    lynxChecklistPageTypes: Array.isArray(state.lynxChecklistPageTypes)
      ? state.lynxChecklistPageTypes
      : [],
    lynxChecklistAiQuestionDisabled: Boolean(state.lynxChecklistAiQuestionDisabled),
    lynxChecklistAiQuestionHidden: Boolean(state.lynxChecklistAiQuestionHidden),
    lynxChecklistNoticeText: state.lynxChecklistNoticeText || "",
    lynxChecklistCssInfoStatus: state.lynxChecklistCssInfoStatus || "pending"
  });
  ensureLynxCssInfoGateStarted();
}

// S7 harden (debug round): the cssInfo check used to fire ONLY at popover open
// and ONLY when page-type coverage was already complete at that instant. When
// coverage hydrated a moment later (marked pages/page types arriving async),
// the renderer showed the "Checking Lynx selector status…" spinner for a
// pending check that nothing had started — an eternal fail-closed wedge. Any
// checklist re-render now starts the missing check once coverage is ready.
function ensureLynxCssInfoGateStarted() {
  if (!state.lynxChecklistVisible || lynxCssInfoCheckInFlight) {
    return;
  }
  if (state.lynxChecklistCssInfoStatus !== "pending") {
    return;
  }
  const view = uiModule.getViewState();
  const coverage = buildLynxChecklistViewModel({
    pageTypes: view.lynxChecklistPageTypes,
    markedPages: view.markedPages
  });
  if (!coverage.canSend) {
    return;
  }
  void refreshLynxCssInfoGate();
}

function resetLynxChecklistState() {
  const initial = createInitialLynxChecklistState();
  const promptState = buildLynxChecklistPromptState();
  state.lynxChecklistAiAnswer = promptState.aiAnswer || initial.aiAnswer;
  state.lynxChecklistPageTypes = Array.isArray(state.propertyPageTypes)
    ? state.propertyPageTypes
    : initial.pageTypes;
  state.lynxChecklistAiQuestionDisabled = promptState.aiQuestionDisabled;
  state.lynxChecklistAiQuestionHidden = Boolean(promptState.aiQuestionHidden);
  state.lynxChecklistNoticeText = "";
  // Fail-closed: every fresh popover open re-runs the cssInfo check before
  // the send can enable.
  state.lynxChecklistCssInfoStatus = "pending";
}

function openLynxChecklistPopover() {
  resetLynxChecklistState();
  state.lynxChecklistVisible = true;
  setLynxChecklistViewState();
  // The cssInfo check is REDUNDANT while page-type coverage is incomplete
  // (the todo guard blocks the send anyway) — trigger it only once every
  // page type is covered; the popover spinner narrates the in-flight check.
  const view = uiModule.getViewState();
  const coverage = buildLynxChecklistViewModel({
    pageTypes: view.lynxChecklistPageTypes,
    markedPages: view.markedPages
  });
  if (coverage.canSend) {
    void refreshLynxCssInfoGate();
  }
}

// The pending payload EXACTLY as the submit would send it (same composition
// as submitSelectorSetToServer), so the backend comparison is same-vocabulary.
function buildPendingLynxSelectorCss(): { includeCss: string; excludeCss: string } | null {
  const normalizedSelectorSet = normalizeAiSelectorSet(getCurrentSelectorsFromConfig());
  if (!combineAiSelectorSet(normalizedSelectorSet).length) {
    return null;
  }
  return {
    includeCss: normalizedSelectorSet.inclusionSelectors.join(", "),
    excludeCss: buildSelectorSetForGraphqlSubmit(normalizedSelectorSet).exclusionSelectors.join(", ")
  };
}

// Send-to-Lynx staleness guard (architect design, 2026-07-03): on every
// popover open, ask the backend what it already holds (cssInfo) and compare
// SANITIZED selector sets. The send is FAIL-CLOSED: disabled while the check
// is pending, when the backend already has a matching set, and when the
// check cannot be completed (reopen retries).
let lynxCssInfoCheckSeq = 0;
let lynxCssInfoCheckInFlight = false;

async function refreshLynxCssInfoGate(): Promise<void> {
  const seq = ++lynxCssInfoCheckSeq;
  lynxCssInfoCheckInFlight = true;
  state.lynxChecklistCssInfoStatus = "pending";
  setLynxChecklistViewState();
  const pageUrl = (state.currentTab && state.currentTab.url) || "";
  const response = pageUrl
    ? await messages.sendRuntimeMessage({
      type: "fetchLynxCssInfo",
      url: pageUrl
    }).catch(() => null)
    : null;
  if (seq === lynxCssInfoCheckSeq) {
    lynxCssInfoCheckInFlight = false;
  }
  if (seq !== lynxCssInfoCheckSeq || !state.lynxChecklistVisible) {
    return;
  }
  if (!response || response.ok !== true || !response.cssInfo || typeof response.cssInfo !== "object") {
    state.lynxChecklistCssInfoStatus = "error";
  } else {
    const pending = buildPendingLynxSelectorCss();
    state.lynxChecklistCssInfoStatus = lynxAlreadyHasSelectorSet(response.cssInfo, pending)
      ? "match"
      : "clear";
  }
  setLynxChecklistViewState();
}

function closeLynxChecklistPopover() {
  state.lynxChecklistVisible = false;
  resetLynxChecklistState();
  setLynxChecklistViewState();
}

function handleLynxChecklistPageTypeDecisionChange(pageTypeKey: string, event: Event) {
  void pageTypeKey;
  void event;
}

function handleLynxChecklistPageTypePageChange(pageTypeKey: string, event: Event) {
  void pageTypeKey;
  void event;
}

function handleLynxChecklistCancel() {
  closeLynxChecklistPopover();
}

async function handleRenderModeSet() {
  await runWithBrainSpinnerLease(null, PopupText.overlay.savingRenderMode, async () => {
    const tabId = state.currentTab && state.currentTab.id;
    const wasNoJsHeld = tabId ? await isRenderModeNoJsHeld(tabId) : false;
    const nextRenderMode = normalizeUiRenderModeValue(uiModule.getViewState().renderModeValue);
    if (isUndeterminedRenderMode(nextRenderMode)) {
      uiModule.showToast(PopupText.renderMode.toastUndeterminedCannotSet);
      return;
    }
    if (!state.currentBaseUrl) {
      uiModule.showToast(PopupText.renderMode.toastUnavailable);
      return;
    }
    const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
    if (
      state.currentBaseUrlHasConfirmedRenderMode &&
      nextRenderMode === currentRenderMode
    ) {
      state.renderModeEditMode = false;
      state.renderModeDetectionUnsure = false;
      state.renderModeDetectionAccuracy = Number.NaN;
      state.renderModeWarningDismissedKey = "";
      state.renderModeManualStepsVisible = false;
      await refreshUi();
      return;
    }
    const renderModeUpdatedAt = config.createTimestampNow();
    state.currentConfig = await config.updateConfig(state.currentBaseUrl, (targetConfig) => {
      targetConfig.renderMode = nextRenderMode;
      targetConfig.renderModeUpdatedAt = renderModeUpdatedAt;
    });
    if (tabId) {
      const tabState = await messages.getTabState(tabId);
      const candidateUrl =
        (state.currentTab && typeof state.currentTab.url === "string"
          ? state.currentTab.url
          : "");
      const settleBaseUrl =
        (tabState && tabState.baseUrl) || state.currentBaseUrl || "";
      // The post-Set reload always runs the editor reveal/freeze warmup for an
      // in-scope page, even in silent mode (marking not enabled). Gate the
      // overlay on in-scope, not on tabState.enabled, otherwise the spinner
      // never shows for the common fresh-property Set flow.
      const inspectionExpected = Boolean(
        settleBaseUrl &&
          (!candidateUrl || utils.isPageWithinBaseUrl(candidateUrl, settleBaseUrl))
      );
      if (inspectionExpected) {
        startRenderModeSetNavGuard(tabId);
        beginNavigationInspectionOverlay(tabId);
      }
      // If the page is currently held in "Without JavaScript", normalize the
      // page execution state before exiting render-mode edit.
      if (wasNoJsHeld) {
        await normalizeRenderModeDebuggerPage(tabId);
      }
      // Set EXITS the render-mode detection: end the content-side inspection
      // UNCONDITIONALLY (content no-ops when none is active). Ending it only
      // on the NoJs path left the sessionStorage inspection flag set after a
      // "With JavaScript" inspect + Set — and the silent/editor activation is
      // gated on that flag, so the reveal/freeze never started until a manual
      // refresh let the boot watchdog heal it (architect backlog item,
      // 2026-07-03). The contract: the reveal/freeze runs immediately after
      // exiting the render-mode detection.
      const endInspectionResult = await requestPopupRenderModeInspectionEnd(tabId, {
        operationId: `render-mode-set-exit:${tabId}:${Date.now()}`
      });
      if (!endInspectionResult || !endInspectionResult.ok) {
        const endInspectionError =
          endInspectionResult &&
          typeof endInspectionResult === "object" &&
          "error" in endInspectionResult &&
          typeof endInspectionResult.error === "string"
            ? endInspectionResult.error
            : "Unknown error";
        console.warn(
          "Unable to end render mode inspection after render mode set:",
          endInspectionError
        );
      }
      if (state.renderModeDebuggerTabId === tabId) {
        state.renderModeDebuggerTabId = null;
      }
    }
    state.currentBaseUrlHasConfirmedRenderMode = true;
    state.renderModeEditMode = false;
    state.renderModeSummaryOpen = false;
    state.renderModeSuggestedKey = "";
    state.renderModeSuggestedValue = nextRenderMode;
    state.renderModeDetectionKey = "";
    state.renderModeDetectionUnsure = false;
    state.renderModeDetectionAccuracy = Number.NaN;
    state.renderModeWarningDismissedKey = "";
    state.renderModeManualStepsVisible = false;
    if (tabId && wasNoJsHeld) {
      await messages.sendTabMessageWithRetry({
        type: "configUpdated",
        baseUrl: state.currentBaseUrl
      }, 8);
    } else {
      await messages.sendTabMessage({
        type: "configUpdated",
        baseUrl: state.currentBaseUrl
      });
    }
    // Normalize page execution state after Set regardless of the last
    // inspection path (with/without JavaScript) so post-Set behavior is
    // deterministic.
    if (tabId && !wasNoJsHeld) {
      await normalizeRenderModeDebuggerPage(tabId);
      if (state.renderModeDebuggerTabId === tabId) {
        state.renderModeDebuggerTabId = null;
      }
    }
    await maybeSwitchToMarkingView();
    await refreshUi();
    uiModule.showToast(
      nextRenderMode === config.RENDER_MODE_RENDERED
        ? PopupText.renderMode.toastSetRendered
        : PopupText.renderMode.toastSetStatic
    );
  }, {
    reason: "render-mode-save",
    source: "popup-render-mode"
  });
}

async function handleRenderModeEditToggle() {
  state.renderModeEditMode = !state.renderModeEditMode;
  if (state.renderModeEditMode) {
    state.renderModeSummaryOpen = true;
  }
  await refreshUi({ useBusyOverlay: false });
}

async function handleOpenRenderModeSection() {
  uiModule.setConfigMenuOpen(false);
  state.renderModeEditMode = true;
  state.renderModeSummaryOpen = true;
  await refreshUi({ useBusyOverlay: false });
}

function handleRenderModeSummaryToggle(event: PopupOpenEvent) {
  const nextOpen = getPopupEventOpen(event);
  const resolvedOpen =
    !state.currentBaseUrlHasConfirmedRenderMode || state.renderModeEditMode
      ? true
      : nextOpen;
  state.renderModeSummaryOpen = resolvedOpen;
  uiModule.setViewState({ renderModeSummaryOpen: resolvedOpen });
}

function handleLoginEmailInput(event: PopupValueEvent) {
  updateLoginActionState({ loginEmailValue: getPopupEventValue(event) });
}

function handleLoginPasswordInput(event: PopupValueEvent) {
  updateLoginActionState({ loginPasswordValue: getPopupEventValue(event) });
}

function handleEnterKeyDown(
  event: PopupEventLike,
  shouldHandle: () => boolean,
  handler: () => void
) {
  if (event.key !== "Enter") {
    return;
  }
  if (!shouldHandle()) {
    return;
  }
  handler();
}

function handleConfigEndpointKeyDown(event: PopupEventLike) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().configEndpointUrlReadOnly,
    handleConfigEndpointSet
  );
}

function handleEndpointKeyDown(event: PopupEventLike) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().endpointUrlReadOnly,
    handleEndpointSet
  );
}

function handleStageBaseKeyDown(event: PopupEventLike) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().stageBaseReadOnly,
    handleStageBaseSet
  );
}

function handleLoginPasswordKeyDown(event: PopupEventLike) {
  handleEnterKeyDown(
    event,
    () => !uiModule.getViewState().loginActionDisabled,
    handleLoginAction
  );
}

async function handlePropertyLockTake() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockSuggest() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_SUGGEST);
  state.propertyLockSuggestionPending = true;
  state.propertyLockSuggestionRejected = false;
  setPropertyLockViewStateFromLocalProjection();
}

async function handlePropertyLockContinue() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_CONTINUE);
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockSecondsRemaining = null;
  setPropertyLockViewStateFromLocalProjection();
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockForceContinue() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_CONTINUE, {
    force: true,
    discardPrevious: true
  });
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockSecondsRemaining = null;
  setPropertyLockViewStateFromLocalProjection();
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockAcceptSuggestion() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  const suggestionId = state.propertyLockSuggestionId;
  if (!suggestionId) {
    return;
  }
  let discardUnsaved = false;
  if (state.currentDraftDirty || state.currentPageSaveReconciliationPending) {
    const shouldSave = window.confirm(propertyLockText.transferSaveBeforeAcceptConfirm);
    if (shouldSave) {
      await handlePageSave();
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
      if (state.currentDraftDirty || state.currentPageSaveReconciliationPending) {
        uiModule.showToast(PopupText.page.pageSavedAndSyncedRefreshFailed);
        return;
      }
    } else {
      const shouldDiscard = window.confirm(propertyLockText.transferDiscardBeforeAcceptConfirm);
      if (!shouldDiscard) {
        return;
      }
      discardUnsaved = true;
    }
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_RESPOND, {
    suggestionId,
    accept: true,
    discardUnsaved
  });
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  setPropertyLockViewStateFromLocalProjection();
  await reconcilePropertyLockAfterCommand();
}

async function handlePropertyLockRejectSuggestion() {
  if (!isPropertyLockCollaborationEnabled()) {
    resetDisabledPropertyLockState();
    return;
  }
  const suggestionId = state.propertyLockSuggestionId;
  if (!suggestionId) {
    return;
  }
  await sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_RESPOND, {
    suggestionId,
    accept: false
  });
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  setPropertyLockViewStateFromLocalProjection();
  await reconcilePropertyLockAfterCommand();
}

function handleConfigToggle(event: PopupEventLike) {
  event.stopPropagation?.();
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setConfigMenuOpen(!state.configMenuOpen);
}

function handleConfigMenuClick(event: PopupEventLike) {
  event.stopPropagation?.();
}

function handleTodoControlsMenuToggle(event: PopupEventLike) {
  event.stopPropagation?.();
  const view = uiModule.getViewState();
  uiModule.setConfigMenuOpen(false);
  uiModule.setTodoControlsMenuOpen(!view.todoControlsMenuOpen);
}

function handleTodoControlsMenuClick(event: PopupEventLike) {
  event.stopPropagation?.();
}

function handleTodoSectionToggle() {
  const view = uiModule.getViewState();
  uiModule.setTodoSectionExpanded(!view.todoSectionExpanded);
  saveCurrentTodoExpansionState();
}

function handleTodoSubsectionToggle(key: string) {
  const view = uiModule.getViewState();
  const expanded = Boolean(view.todoSubsectionsExpanded && view.todoSubsectionsExpanded[key]);
  uiModule.setTodoSubsectionExpanded(key, !expanded);
  saveCurrentTodoExpansionState();
}

function handleTodoExpandAll() {
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setTodoAllSubsectionsExpanded(true);
  saveCurrentTodoExpansionState();
}

function handleTodoCollapseAll() {
  uiModule.setTodoControlsMenuOpen(false);
  uiModule.setTodoAllSubsectionsExpanded(false);
  saveCurrentTodoExpansionState();
}

function handleTodoAutoCollapseToggle() {
  const view = uiModule.getViewState();
  uiModule.setTodoAutoCollapse(!view.todoAutoCollapse);
}

function handleConfigurationExtrasToggle() {
  uiModule.toggleConfigurationExtrasExpanded();
}

async function handleOpenConfigurationView() {
  uiModule.setConfigMenuOpen(false);
  clearRemoteConfigRetryTimer();
  state.currentView = uiModule.View.Configuration;
  collapseTodoListForAutoCollapse();
  uiModule.setViewState({ currentView: state.currentView });
  await refreshUi();
}

async function maybeSwitchToMarkingView() {
  const tokenIsValid = await validateStoredToken({
    force: true,
    showToastOnInvalid: false
  });
  const { tokenValue, endpointValue, configEndpointValue, stageBaseValue } =
    await helpers.loadGlobalAiSettings();
  if (
    tokenIsValid &&
    tokenValue &&
    endpointValue &&
    configEndpointValue &&
    normalizeStageBase(stageBaseValue)
  ) {
    state.currentView = uiModule.View.Marking;
    state.configViewLocked = false;
    collapseTodoListForAutoCollapse();
    uiModule.setViewState({ currentView: state.currentView });
  }
}

async function handleConfigurationContinue() {
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleExplicitExcludeView(xpath: string) {
  await runWithBrainSpinnerLease(null, PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, {
    delayMs: POPUP_BUSY_OVERLAY_DELAY_MS,
    reason: "locate-explicit-exclusion",
    source: "popup-explicit-selection"
  });
}

async function handleExplicitExcludeRemove(xpath: string) {
  if (!state.currentBaseUrl) {
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitExclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    excluded: false
  });
  if (!response || !response.ok) {
    uiModule.showToast(PopupText.explicitSelection.excludeUpdateFailed);
    return;
  }
  await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
}

async function handleExplicitIncludeView(xpath: string) {
  await runWithBrainSpinnerLease(null, PopupText.overlay.locatingElement, async () => {
    const response = await messages.sendTabMessage({
      type: "focusElement",
      xpath
    });
    if (!response || !response.ok) {
      uiModule.showToast(PopupText.explicitSelection.focusFailed);
    }
  }, {
    delayMs: POPUP_BUSY_OVERLAY_DELAY_MS,
    reason: "locate-explicit-inclusion",
    source: "popup-explicit-selection"
  });
}

async function handleExplicitIncludeRemove(xpath: string) {
  if (!state.currentBaseUrl) {
    return;
  }
  await refreshCurrentPageRuntimeStatus();
  if (state.currentPageSaveReconciliationPending) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  await clearFocusedElement();
  const response = await messages.sendTabMessage({
    type: "setExplicitInclude",
    baseUrl: state.currentBaseUrl,
    xpath,
    included: false
  });
  if (!response || !response.ok) {
    uiModule.showToast(PopupText.explicitSelection.includeUpdateFailed);
    return;
  }
  await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
}

async function navigateActiveTabToUrl(url: string): Promise<boolean> {
  const tab = await helpers.ensureActiveTab({ requireId: true });
  if (!tab) {
    return false;
  }
  const response = await messages.sendRuntimeMessage({
    type: "navigateTabToUrl",
    tabId: tab.id,
    url
  });
  return Boolean(response && response.ok);
}

async function confirmNavigationAwayFromMarking() {
  let view = uiModule.getViewState();
  // Only marking mode with an unsaved session needs the discard gate; silent
  // highlighting (and a clean marking session) navigates freely.
  if (!view.toggleEnabled) {
    return true;
  }
  const pendingKnownFromCurrentView = Boolean(view.sessionHasPendingChanges);
  if (
    (await helpers.ensureActiveTab({ requireId: true })) &&
    state.currentBaseUrl &&
    !pendingKnownFromCurrentView
  ) {
    // If pending changes are already known, show confirm immediately. Only
    // refresh when pending state is not yet known to avoid false negatives.
    await refreshCurrentPageRuntimeStatus();
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    view = uiModule.getViewState();
  }
  if (!view.sessionHasPendingChanges) {
    // Clean marking session navigating away: the destination loads in silent
    // highlighting, so align the popup + tab state to silent too.
    await alignPopupToSilentMode();
    return true;
  }
  uiModule.showToast(
    view.sessionRequiresAiRun
      ? PopupText.page.exitRequiresAiResolution
      : PopupText.page.exitRequiresResolution
  );
  const confirmedDiscard = window.confirm(PopupText.page.navigateDiscardConfirm);
  if (!confirmedDiscard) {
    // Cancel: navigation stopped, stay in marking mode with the session intact.
    return false;
  }
  // OK: discard the pending session locally before navigating; the destination
  // page loads in silent highlighting mode, so align the popup + tab state to
  // silent (#6/#7) so re-enabling marking runs the full enable path again.
  await applyLocalPageDiscard();
  await alignPopupToSilentMode();
  return true;
}

async function navigateActiveTabToUrlWithTodoCollapse(url: string): Promise<boolean> {
  if (!(await confirmNavigationAwayFromMarking())) {
    return false;
  }
  const navigated = await navigateActiveTabToUrl(url);
  if (navigated) {
    collapseTodoListForAutoCollapse();
  }
  return navigated;
}

async function handleMarkedPageNavigate(url: string) {
  await navigateActiveTabToUrlWithTodoCollapse(url);
}

async function handleLynxChecklistCandidateNavigate(url: string) {
  if (!url) {
    return;
  }
  closeLynxChecklistPopover();
  await navigateActiveTabToUrlWithTodoCollapse(url);
}

async function handleEnableToggle(event: PopupCheckedEvent) {
  const currentViewState = uiModule.getViewState();
  const desiredEnabled = getPopupEventChecked(event, currentViewState.toggleEnabled);
  if (desiredEnabled !== currentViewState.toggleEnabled) {
    collapseTodoListForAutoCollapse();
  }
  let latestViewState = currentViewState;
  const pendingKnownFromCurrentView = Boolean(
    !desiredEnabled && currentViewState.sessionHasPendingChanges
  );
  let immediateDisableSpinnerKey: string | null = null;
  const showImmediateDisableSpinner = () => {
    if (desiredEnabled || immediateDisableSpinnerKey) {
      return immediateDisableSpinnerKey;
    }
    immediateDisableSpinnerKey = `marking-disable:${Date.now()}`;
    void sendSpinnerBrokerMessage({
      type: SPINNER_REQUEST_TYPES.SET,
      key: immediateDisableSpinnerKey,
      message: PopupText.overlay.disablingMarking,
      persistent: false,
      reason: "marking-disable",
      source: "popup-marking-toggle",
      startedAt: Date.now()
    });
    return immediateDisableSpinnerKey;
  };
  const clearImmediateDisableSpinner = () => {
    if (!immediateDisableSpinnerKey) {
      return;
    }
    void removeSpinnerEntryFromBackground(immediateDisableSpinnerKey);
    immediateDisableSpinnerKey = null;
  };

  if (!desiredEnabled) {
    showImmediateDisableSpinner();
  }

  let tab = null;
  try {
    tab = await helpers.ensureActiveTab({ requireId: true, requireUrl: true });
  } catch (error) {
    clearImmediateDisableSpinner();
    throw error;
  }
  if (!tab) {
    clearImmediateDisableSpinner();
    return;
  }
  if (!desiredEnabled) {
    uiModule.setViewState({ toggleEnabled: false });
  }
  if (!helpers.ensureBaseUrl(ViewText.noMappedBaseUrlOrSiteId)) {
    uiModule.setViewState({ toggleEnabled: false });
    clearLastPopupEnabled();
    clearImmediateDisableSpinner();
    return;
  }
  if (desiredEnabled && !isCurrentRenderModeReady() && !DIRECT_MODE_ACTIVE) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeEnabling);
    uiModule.setViewState({ toggleEnabled: false });
    clearLastPopupEnabled();
    await refreshUi();
    return;
  }
  if (desiredEnabled && !state.currentPageTypeKey && !DIRECT_MODE_ACTIVE) {
    uiModule.showToast(
      uiModule.getViewState().pageTypeNoticeText || PopupText.pageTypes.blockedCurrentPage
    );
    uiModule.setViewState({ toggleEnabled: false });
    clearLastPopupEnabled();
    await refreshUi();
    return;
  }

  try {
    if (!desiredEnabled && !pendingKnownFromCurrentView) {
      // If pending changes are already known in the current view state, show the
      // discard confirm immediately. Otherwise refresh first to avoid false
      // negatives when the pending state has not been computed yet.
      showImmediateDisableSpinner();
      await refreshCurrentPageRuntimeStatus({
        tabId: tab.id,
        baseUrl: state.currentBaseUrl
      });
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
      latestViewState = uiModule.getViewState();
    }

    if (!desiredEnabled && latestViewState.sessionHasPendingChanges) {
      clearImmediateDisableSpinner();
      uiModule.showToast(
        latestViewState.sessionRequiresAiRun
          ? PopupText.page.exitRequiresAiResolution
          : PopupText.page.exitRequiresResolution
      );
      const confirmedDiscard = window.confirm(PopupText.page.disableDiscardConfirm);
      if (!confirmedDiscard) {
        // Cancel: stay in marking mode with the pending session intact.
        uiModule.setViewState({ toggleEnabled: true });
        setLastPopupEnabled(true, buildPopupEnabledContext(tab, state.currentBaseUrl));
        await refreshUi();
        return;
      }
      // OK: discard the pending CSS selectors/markings locally, then fall through
      // to disable marking (which drops to silent highlighting mode).
      showImmediateDisableSpinner();
      await applyLocalPageDiscard();
    }
    if (!desiredEnabled) {
      setLastPopupEnabled(false, buildPopupEnabledContext(tab, state.currentBaseUrl));
    }
    const baseUrlValue = state.currentBaseUrl;
    const currentPageTypeKey = desiredEnabled ? state.currentPageTypeKey || "" : "";
    await runWithBrainSpinnerLease(
      desiredEnabled ? null : immediateDisableSpinnerKey,
      desiredEnabled ? PopupText.overlay.enablingMarking : PopupText.overlay.disablingMarking,
      async () => {
        if (desiredEnabled) {
          const parsed = utils.parseBaseUrl(baseUrlValue);
          if (!parsed) {
            uiModule.showToast(PopupText.baseUrl.toastInvalid);
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            await refreshUi();
            return;
          }
          if (!utils.isPageWithinBaseUrl(tab.url, baseUrlValue)) {
            uiModule.showToast(PopupText.baseUrl.toastOutsideCurrentPage);
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            await refreshUi();
            return;
          }
          {
            const currentConfigs = await config.getConfigs();
            const normalizedCurrent = config.normalizeConfig(baseUrlValue, currentConfigs[baseUrlValue]);
            state.currentConfig = normalizedCurrent.config;
          }
          let effectiveBaseUrl = baseUrlValue;
          if (DIRECT_MODE_ACTIVE) {
            // Direct mode: skip the backend siteId resolution — the page is not a
            // configured property. Marking / enumeration / overlay do not need a
            // siteId; save and AI-run remain gated and unavailable here.
            state.currentBaseUrl = effectiveBaseUrl;
          } else {
            const { stageBaseValue, tokenValue } = await helpers.loadGlobalAiSettings();
            const siteIdResult = await ensureBaseUrlSiteId({
              baseUrl: baseUrlValue,
              pageUrl: tab.url,
              stageBase: stageBaseValue,
              tokenValue,
              persist: false
            });
            if (!siteIdResult.ok || !siteIdResult.siteId) {
              uiModule.showToast(siteIdResult.reason || ViewText.noDomainIdForBaseUrl);
              uiModule.setViewState({ toggleEnabled: false });
              clearLastPopupEnabled();
              await refreshUi();
              return;
            }
            effectiveBaseUrl = siteIdResult.baseUrl || baseUrlValue;
            state.currentBaseUrl = effectiveBaseUrl;
            state.currentConfig = siteIdResult.config || state.currentConfig;
          }
          if (uiModule.getViewState().desktopPreviewEnabled) {
            uiModule.showToast(PopupText.device.desktopPreviewDisableMarkingToast);
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            await refreshUi();
            return;
          }
          const enableResponse = await messages.requestTabActivateMarking(tab.id, {
            baseUrl: effectiveBaseUrl,
            pageType: currentPageTypeKey,
            desktopPreviewEnabled: Boolean(uiModule.getViewState().desktopPreviewEnabled)
          });
          if (!enableResponse || !enableResponse.ok) {
            uiModule.setViewState({ toggleEnabled: false });
            clearLastPopupEnabled();
            if (isFailedPopupOperationResponse(enableResponse) && enableResponse.locked) {
              uiModule.showToast(
                propertyLockText.lockedInteractionBlockedToast(getPropertyLockEditorName())
              );
            } else {
              uiModule.showToast(
                (isFailedPopupOperationResponse(enableResponse) && enableResponse.error) ||
                  PopupText.helper.activateFailedOnPage
              );
            }
            await refreshUi();
            return;
          }
          // Fresh entry into marking mode: Run AI starts enabled (no successful
          // run yet for the current markings), Save/Preview start disabled.
          resetAiRunMarkingsFingerprint();
          setLastPopupEnabled(true, buildPopupEnabledContext(tab, state.currentBaseUrl));
          // Marking was (re)enabled on the page — a popup-initiated marking
          // transition: stale in-flight passes must not publish/sync over it.
          state.previewCloseMarkingRestoreUnconfirmed = false;
          bumpMarkingSessionEpoch();
          signalMarkingSession("marking-enabled");
        } else {
          const disableResponse = await messages.requestTabDeactivateMarking(tab.id, {
            baseUrl: baseUrlValue,
            pageType: ""
          });
          if (!disableResponse || !disableResponse.ok) {
            uiModule.setViewState({ toggleEnabled: true });
            setLastPopupEnabled(true, buildPopupEnabledContext(tab, state.currentBaseUrl));
            uiModule.showToast(
              (isFailedPopupOperationResponse(disableResponse) && disableResponse.error) ||
                "Unable to disable marking"
            );
            await refreshUi();
            return;
          }
          // Marking was disabled on the page — a popup-initiated marking
          // transition. Clearing the restore latch here also makes a genuine
          // user disable during an unconfirmed post-exit restore publish
          // immediately (the latch must never clamp a user-chosen disable).
          state.previewCloseMarkingRestoreUnconfirmed = false;
          bumpMarkingSessionEpoch();
          signalMarkingSession("marking-disabled");
        }
        await refreshUi();
      },
      {
        delayMs: desiredEnabled ? POPUP_BUSY_OVERLAY_DELAY_MS : 0,
        reason: desiredEnabled ? "marking-enable" : "marking-disable",
        source: "popup-marking-toggle"
      }
    );
    immediateDisableSpinnerKey = null;
  } finally {
    clearImmediateDisableSpinner();
  }
}

async function handleDeviceEmulationEnabledToggle(event: PopupCheckedEvent) {
  if (!isFeatureEnabled("deviceEmulationToggle")) {
    return;
  }
  if (uiModule.getViewState().toggleEnabled) {
    return;
  }
  const desiredEnabled = getPopupEventChecked(
    event,
    uiModule.getViewState().deviceEmulationEnabled
  );
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ deviceEmulationEnabled: desiredEnabled });
  if (desiredEnabled === state.currentDeviceEmulationEnabled) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: desiredEnabled,
    mode: "mobile",
    scale: state.currentDeviceScale
  });
}

async function handleDesktopPreviewEnabledToggle(event: PopupCheckedEvent) {
  if (!isFeatureEnabled("desktopPreview")) {
    return;
  }
  const currentView = uiModule.getViewState();
  const desiredEnabled = getPopupEventChecked(
    event,
    currentView.desktopPreviewEnabled
  );
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const tab = state.currentTab;
  if (!tab || !tab.id) {
    return;
  }
  if (desiredEnabled === state.currentDesktopPreviewEnabled) {
    return;
  }
  if (
    desiredEnabled &&
    (
      !currentView.desktopPreviewVisible ||
      currentView.desktopPreviewDisabled ||
      currentView.desktopPreviewBlockedReason !== SECONDARY_GATES_BLOCK_REASONS.NONE
    )
  ) {
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    return;
  }
  if (desiredEnabled && currentView.toggleEnabled) {
    await handleEnableToggle({ currentTarget: { checked: false } });
    if (uiModule.getViewState().toggleEnabled) {
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
      return;
    }
  }
  await runWithBrainSpinnerLease(
    null,
    PopupText.overlay.applyingDeviceEmulation,
    async () => {
      const targetMode = desiredEnabled ? "desktop" : "mobile";
      const normalized = await helpers.updateDeviceEmulation({
        enabled: true,
        mode: targetMode,
        scale: state.currentDeviceScale,
        recalculateScale:
          !state.currentDeviceEmulationEnabled ||
          state.currentDeviceMode !== targetMode
      });
      if (!normalized || !normalized.enabled || normalized.mode !== targetMode) {
        await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
        return;
      }
      await persistDesktopPreviewEnabled(tab.id, desiredEnabled);
      await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    },
    {
      delayMs: POPUP_BUSY_OVERLAY_DELAY_MS,
      reason: "desktop-preview-toggle",
      source: "popup-device-emulation"
    }
  );
}


function handleDeviceScaleInput(event: PopupValueEvent) {
  const value = getPopupEventValue(event, String(uiModule.getViewState().deviceScale ?? ""));
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: formatScalePercent(scale)
  });
}

async function handleDeviceScaleChange(event: PopupValueEvent) {
  const value = getPopupEventValue(event, String(uiModule.getViewState().deviceScale ?? ""));
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  const scale = Number.parseFloat(value);
  if (!Number.isFinite(scale)) {
    return;
  }
  if (!state.currentDeviceEmulationEnabled) {
    uiModule.setViewState({
      deviceEmulationEnabled: state.currentDeviceEmulationEnabled,
      deviceMode: state.currentDeviceMode,
      deviceScale: state.currentDeviceScale.toFixed(2),
      deviceScaleValue: formatScalePercent(state.currentDeviceScale)
    });
    return;
  }
  uiModule.setViewState({
    deviceScale: value,
    deviceScaleValue: formatScalePercent(scale)
  });
  if (scale === state.currentDeviceScale) {
    return;
  }
  await helpers.updateDeviceEmulation({
    enabled: true,
    mode: "mobile",
    scale
  });
}

async function handleClearDomainCache() {
  uiModule.setConfigMenuOpen(false);
  if (!isFeatureEnabled("cacheAndUnregisterTools")) {
    return;
  }
  const tab = await helpers.ensureActiveTab({
    requireUrl: true,
    toastOnMissing: PopupText.cache.toastNoActiveTab
  });
  if (!tab) {
    return;
  }
  const origin = utils.getOriginFromUrl(tab.url);
  if (!origin) {
    uiModule.showToast(PopupText.cache.toastUnsupportedPage);
    return;
  }
  const tabUrl = typeof tab.url === "string" ? tab.url : "";
  if (!tabUrl) {
    uiModule.showToast(PopupText.cache.toastUnsupportedPage);
    return;
  }
  const hostname = (() => {
    try {
      return new URL(tabUrl).hostname;
    } catch (_error) {
      return origin;
    }
  })();
  const confirmed = window.confirm(formatClearDomainCacheConfirm(hostname));
  if (!confirmed) {
    return;
  }
  const clearCacheSpinnerKey = `clear-cache:${Date.now()}`;
  void sendSpinnerBrokerMessage({
    type: SPINNER_REQUEST_TYPES.SET,
    key: clearCacheSpinnerKey,
    message: PopupText.overlay.clearingCacheAndReloading,
    persistent: false,
    reason: "clear-cache",
    source: "popup-cache-tools",
    startedAt: Date.now()
  });
  state.clearDomainCacheDisabled = true;
  uiModule.setViewState({ clearDomainCacheDisabled: true });
  try {
    const result = await chromeHelpers.clearBrowsingDataForOrigin(origin);
    if (!result.ok) {
      uiModule.showToast(result.error || PopupText.cache.toastClearFailed);
      return;
    }
    uiModule.showToast(PopupText.cache.toastCleared);
    const reloadResult = await chromeHelpers.reloadTab(tab.id);
    if (!reloadResult.ok) {
      uiModule.showToast(reloadResult.error || PopupText.cache.toastReloadFailed);
    }
  } catch (error) {
    uiModule.showToast(
      getErrorMessage(error) || PopupText.cache.toastClearFailed
    );
  } finally {
    state.clearDomainCacheDisabled = false;
    uiModule.setViewState({ clearDomainCacheDisabled: false });
    void removeSpinnerEntryFromBackground(clearCacheSpinnerKey);
  }
}

async function handleUnregisterCurrentTab() {
  uiModule.setConfigMenuOpen(false);
  if (!isFeatureEnabled("cacheAndUnregisterTools")) {
    return;
  }
  const tab = await helpers.ensureActiveTab({
    requireId: true,
    toastOnMissing: PopupText.unregister.toastNoActiveTab
  });
  if (!tab) {
    return;
  }
  const confirmed = window.confirm(PopupText.unregister.confirm);
  if (!confirmed) {
    return;
  }
  const unregisterSpinnerKey = `unregister-tab:${Date.now()}`;
  void sendSpinnerBrokerMessage({
    type: SPINNER_REQUEST_TYPES.SET,
    key: unregisterSpinnerKey,
    message: PopupText.overlay.unregisteringTabAndReloading,
    persistent: false,
    reason: "unregister-tab",
    source: "popup-cache-tools",
    startedAt: Date.now()
  });
  state.unregisterCurrentTabDisabled = true;
  uiModule.setViewState({ unregisterCurrentTabDisabled: true });
  try {
    const result = await messages.sendRuntimeMessage({
      type: "unregisterTabAndReload",
      tabId: tab.id
    });
    if (!result || !result.ok) {
      uiModule.showToast(
        (result && result.error) || PopupText.unregister.toastFailed
      );
      return;
    }
    window.close();
  } finally {
    state.unregisterCurrentTabDisabled = false;
    uiModule.setViewState({ unregisterCurrentTabDisabled: false });
    void removeSpinnerEntryFromBackground(unregisterSpinnerKey);
  }
}

async function handleConfigEndpointSet() {
  const endpointValue = uiModule.getViewState().configEndpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast(PopupText.configuration.endpointEnter);
    return;
  }
  try {
    new URL(endpointValue);
  } catch (_error) {
    uiModule.showToast(PopupText.configuration.endpointEnterValid);
    return;
  }
  const saveResult = await saveGlobalConfigEndpoint(endpointValue);
  if (saveResult.tokenCleared) {
    state.lastTokenValidationAt = 0;
    state.siteIdLookupByBaseUrl.clear();
    clearRemoteConfigLoadCache();
    setRemoteConfigConnectionIssue(false);
    uiModule.showToast(PopupText.configuration.endpointChangedLoginRequired);
  }
  state.configEndpointEditMode = false;
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleConfigEndpointEditToggle() {
  state.configEndpointEditMode = !state.configEndpointEditMode;
  await refreshUi();
}

async function handleEndpointSet() {
  const endpointValue = uiModule.getViewState().endpointUrlValue.trim();
  if (!endpointValue) {
    uiModule.showToast(PopupText.configuration.aiEndpointEnter);
    return;
  }
  try {
    new URL(endpointValue);
  } catch (_error) {
    uiModule.showToast(PopupText.configuration.aiEndpointEnterValid);
    return;
  }
  const saveResult = await saveGlobalEndpoint(endpointValue);
  if (saveResult.tokenCleared) {
    state.lastTokenValidationAt = 0;
    clearRemoteConfigLoadCache();
    setRemoteConfigConnectionIssue(false);
    uiModule.showToast(PopupText.configuration.aiEndpointChangedLoginRequired);
  }
  state.endpointEditMode = false;
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleEndpointEditToggle() {
  state.endpointEditMode = !state.endpointEditMode;
  await refreshUi();
}

async function handleStageBaseSet() {
  const inputValue = uiModule.getViewState().stageBaseValue.trim();
  const normalized = normalizeStageBase(inputValue);
  if (!normalized) {
    uiModule.showToast(PopupText.configuration.stageBaseEnterValid);
    return;
  }
  const saveResult = await saveGlobalStageBase(normalized);
  state.stageBaseEditMode = false;
  state.siteIdLookupByBaseUrl.clear();
  if (saveResult.tokenCleared) {
    clearRemoteConfigLoadCache();
    uiModule.showToast(PopupText.configuration.stageBaseChangedLoginRequired);
  }
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function handleStageBaseEditToggle() {
  state.stageBaseEditMode = !state.stageBaseEditMode;
  await refreshUi();
}

async function handleLoginAction() {
  const view = uiModule.getViewState();
  const stageBase = normalizeStageBase(view.stageBaseValue || "");
  const email = view.loginEmailValue.trim();
  const password = view.loginPasswordValue;

  if (!stageBase) {
    uiModule.showToast(PopupText.authentication.toastSetStageBaseFirst);
    return;
  }
  if (!isValidEmail(email)) {
    uiModule.showToast(PopupText.authentication.toastEnterValidEmail);
    return;
  }
  if (!password.trim()) {
    uiModule.showToast(PopupText.authentication.toastEnterPassword);
    return;
  }

  state.aiRequestInFlight = "login";
  await refreshUi();
  let loginSucceeded = false;
  let loginFailureMessage = "";
  try {
    const response = await messages.sendRuntimeMessage({
      type: "requestAuthLogin",
      stageBase,
      email,
      password
    });
    const payload = response && response.payload && typeof response.payload === "object"
      ? response.payload
      : null;

    if (!response || response.ok !== true) {
      const status = response && Number.isFinite(response.status) ? response.status : 0;
      loginFailureMessage =
        (payload && typeof payload.error === "string" && payload.error) ||
        (payload && typeof payload.message === "string" && payload.message) ||
        formatLoginFailedStatus(status);
    } else {
      const token = payload && typeof payload.token === "string" ? payload.token.trim() : "";
      if (!token) {
        loginFailureMessage = PopupText.authentication.toastResponseMissingToken;
      } else {
        await saveLoginSettings({ stageBase, token });
        clearRemoteConfigLoadCache();
        uiModule.setViewState({ loginPasswordValue: "" });
        loginSucceeded = true;
      }
    }
  } catch (_error) {
    loginFailureMessage = PopupText.authentication.toastRequestFailed;
  } finally {
    state.aiRequestInFlight = null;
    await refreshUi();
  }
  if (!loginSucceeded) {
    uiModule.showToast(loginFailureMessage || PopupText.authentication.toastFailed);
    return;
  }
  uiModule.showToast(PopupText.authentication.toastSuccess);
  await maybeSwitchToMarkingView();
  await refreshUi();
}

async function alignPopupToSilentMode() {
  // Aligns the popup + tab state to silent (highlighting) mode WITHOUT touching
  // the content script: clears the popup enable toggle and marks the tab disabled
  // so the next refresh renders silent controls. Used by the post-save transition
  // and when navigating away from marking mode.
  const baseUrl = state.currentBaseUrl;
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  if (tabId !== null) {
    await messages.setTabState(tabId, { enabled: false, baseUrl, pageType: "" });
  }
  clearLastPopupEnabled();
  uiModule.setViewState({ toggleEnabled: false });
  // Dropping to silent is a popup-initiated marking transition: in-flight
  // refreshUi passes still holding pre-drop reads must not republish the
  // marking-enabled facts over it (#5/#14 family — live-traced 2026-07-03).
  state.previewCloseMarkingRestoreUnconfirmed = false;
  bumpMarkingSessionEpoch();
  signalMarkingSession("marking-disabled");
}

async function applyPostSaveSilentTransition() {
  // Post-save contract: the current page render resets from
  // scratch to the defaults -> CSS/AI selector baseline (the just-saved session
  // explicit deltas are dropped from the overlay), the mode switches marking ->
  // silent highlighting, and the user stays in silent until Enable Marking
  // re-enters marking from scratch.
  const baseUrl = state.currentBaseUrl;
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  // Reset local PRE_AI/silent state first so a slow/locked tab roundtrip cannot
  // wedge the popup, then drop the tab to silent best-effort (content re-reports).
  state.currentDraftEntry = null;
  state.currentSavedEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
  state.currentPageSaveReconciliation = null;
  state.currentPageSaveReconciliationPending = false;
  resetAiRunMarkingsFingerprint();
  // Reset + mode drop are owned by background command authority for this tab.
  if (tabId !== null) {
    void messages.requestTabApplyPostSaveTransition(tabId, { baseUrl });
  }
  signalMarkingSession("saved");
  if (typeof tabId === "number") {
    // P1: popup-borne (the popup owns the confirmed-save transition today);
    // moves brain-side with the save lifecycle in Phase 4.
    void emitPopupSignal(tabId, {
      name: SIGNAL_NAMES.SESSION_SAVED,
      source: "popup",
      cause: "post-save-transition",
      payload: {}
    });
  }
  await alignPopupToSilentMode();
}

async function applyLocalPageDiscard() {
  const pageUrl = getCurrentPageUrl();
  const baseUrl = state.currentBaseUrl;
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  // #5 (debug round): reset the local session to PRE_AI and fire the content
  // discard IMMEDIATELY — before any backend round-trip — so the discard is
  // acknowledged and the spinner clears fast (obs 5). Discard is unconditionally
  // PRE_AI (it never depended on the backend load), so a failed or slow tab
  // discard can never leave the popup wedged in POST_AI with the markings locked.
  // The backend config reconciliation runs best-effort + non-blocking below.
  state.currentDraftEntry = null;
  state.currentSavedEntry = null;
  state.currentDraftDirty = false;
  state.currentDraftAvailable = false;
  state.aiSelectorsComputedSinceLastSubmit = false;
  state.aiSelectorsComputedBaseUrl = "";
  clearSelectorsPendingConfigSync();
  resetAiRunMarkingsFingerprint();
  await clearCurrentPageSaveReconciliation();
  if (tabId !== null) {
    // Best-effort: the popup is already PRE_AI-clean above, so apply the content
    // discard without blocking the spinner on a slow/locked tab roundtrip.
    void messages.requestTabApplyLocalDiscard(tabId, { baseUrl });
  }
  // A discard is a popup-initiated marking-session transition: passes reading
  // the pre-discard session must not republish its marking facts over the
  // reset (#5/#14 family — a same-epoch pass republished isEnabled:true 30s
  // after a user silent-drop in the 2026-07-03 00:03 live trace).
  state.previewCloseMarkingRestoreUnconfirmed = false;
  bumpMarkingSessionEpoch();
  signalMarkingSession("discarded");
  if (typeof tabId === "number") {
    void emitPopupSignal(tabId, {
      name: SIGNAL_NAMES.SESSION_DISCARDED,
      source: "popup",
      cause: "user-discard",
      payload: {}
    });
  }
  // Best-effort, non-blocking backend reconciliation: freshen the popup's config
  // to the last-saved backend state so a later view matches the server. It no
  // longer holds the discard spinner (obs 5).
  void reconcilePopupConfigAfterDiscard(pageUrl, baseUrl, tabId).catch(() => {});
}

// #5 (debug round): the popup-side backend config reconciliation that used to run
// BEFORE the local reset inside applyLocalPageDiscard, blocking the discard
// spinner on a forced remote config reload. It is now best-effort and non-blocking
// (the local session is already PRE_AI-clean), and only freshens state.currentConfig
// / currentBaseUrl to the last-saved backend state.
async function reconcilePopupConfigAfterDiscard(
  pageUrl: string,
  baseUrl: string,
  tabId: number | null | undefined
): Promise<void> {
  const { tokenValue, configEndpointValue, stageBaseValue } = await helpers.loadGlobalAiSettings();
  let siteId = normalizeSiteIdValue(
    state.currentSiteId || (state.currentConfig && state.currentConfig.siteId)
  );
  let resolvedBaseUrl = baseUrl;
  if (!siteId && resolvedBaseUrl && pageUrl && stageBaseValue && tokenValue) {
    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl: resolvedBaseUrl,
      pageUrl,
      stageBase: stageBaseValue,
      tokenValue,
      persist: false
    });
    if (siteIdResult.ok && siteIdResult.siteId) {
      siteId = normalizeSiteIdValue(siteIdResult.siteId);
      resolvedBaseUrl = siteIdResult.baseUrl || resolvedBaseUrl;
      state.currentBaseUrl = resolvedBaseUrl;
      state.currentConfig = siteIdResult.config || state.currentConfig;
    }
  }
  if (tabId !== null && pageUrl && resolvedBaseUrl && siteId && configEndpointValue && tokenValue) {
    const remoteLoadResult = await loadRemoteConfigForCurrentPage({
      tabId,
      pageUrl,
      baseUrl: resolvedBaseUrl,
      siteId,
      endpointValue: configEndpointValue,
      tokenValue,
      force: true
    });
    if (
      remoteLoadResult &&
      (remoteLoadResult.status === "ok" || remoteLoadResult.status === "not_found")
    ) {
      resolvedBaseUrl = remoteLoadResult.baseUrl || resolvedBaseUrl;
      state.currentBaseUrl = resolvedBaseUrl;
      const configs = await config.getConfigs();
      state.currentConfig = config.normalizeConfig(resolvedBaseUrl, configs[resolvedBaseUrl]).config;
    }
  }
}

async function requestAiRunStart({
  endpointValue: _endpointValue = "",
  payload = null,
  payloadKey = ""
} = {}) {
  const requestPayloadKey =
    typeof payloadKey === "string" && payloadKey.trim()
      ? payloadKey.trim()
      : buildTransferPayloadKey("ai-run-start-request");
  if (!payloadKey) {
    const stored = await putTransferPayload("ai-run-start-request", payload || {}, {
      payloadKey: requestPayloadKey
    });
    if (!stored.ok) {
      return { ok: false };
    }
  }
  const response = await messages.sendRuntimeMessage({
    type: "requestAiRunStartSnapshot",
    payloadKey: requestPayloadKey
  });
  if (!response || response.ok !== true || response.status !== "ok") {
    return { ok: false };
  }
  if (typeof response.sessionId !== "string" || !response.sessionId.trim()) {
    return { ok: false };
  }
  return { ok: true, sessionId: response.sessionId.trim() };
}

void requestAiRunStart;

async function requestAiRunStatus({ sessionId = "" } = {}) {
  const response = await messages.sendRuntimeMessage({
    type: "requestAiRunStatus",
    sessionId
  });
  return response && typeof response === "object" ? response : { ok: false };
}

async function applyComputedSelectorSet(
  selectorSet: SelectorSet,
  { currentPageUrl: _currentPageUrl = "", tokenValue: _tokenValue = "" }: ComputedSelectorSetApplyOptions = {}
) {
  const selectorsChanged =
    !config.isSelectorSetCurrentForRenderMode(state.currentConfig, "selectors") ||
    !aiSelectorSetsEqual(
      selectorSet,
      state.currentConfig && state.currentConfig.selectors
    );
  const selectorSetUpdatedAt = selectorsChanged
    ? config.createTimestampNow()
    : config.normalizeEntryTimestamp(
        state.currentConfig && state.currentConfig.selectorsUpdatedAt
      );
  state.currentConfig = await config.updateConfig(state.currentBaseUrl, (targetConfig) => {
    targetConfig.selectors = normalizeAiSelectorSet(selectorSet);
    targetConfig.selectorsUpdatedAt = selectorSetUpdatedAt;
  });
  const hasComputedNewSelectors =
    !aiSelectorSetsEqual(selectorSet, getLastSubmittedSelectorsFromConfig(state.currentConfig));
  state.aiSelectorsComputedSinceLastSubmit = hasComputedNewSelectors;
  state.aiSelectorsComputedBaseUrl = hasComputedNewSelectors ? state.currentBaseUrl : "";
  state.selectorsPendingConfigSync = hasComputedNewSelectors;
  state.selectorsPendingConfigSyncBaseUrl = hasComputedNewSelectors ? state.currentBaseUrl : "";
  // The AI run is scoped to the current element markings. Capture that stable
  // state before the preview starts slower content-side reconciliation.
  captureAiRunMarkingsFingerprint();
  // P4 step 4.5: carry the session id — the bare publish had dedupeKey ""
  // and the brain admitted run.completed twice (the background publisher
  // and this one race >250ms apart; the session-keyed dedupe needs the id).
  publishCurrentTabAiRunEvent(AI_RUN_EVENT_TYPES.RESULTS_APPLIED, {
    sessionId: state.aiRunSessionId || ""
  });

  // #4/N3 (debug round): the AI run is DONE the instant results are applied.
  // Tear down the run curtain + countdown HERE — before the slow
  // requestTabShowAiPreview content roundtrip (up to 30s on heavy pages) — so
  // the marking-session FSM leaves "running" immediately instead of holding the
  // full-page curtain and a frozen countdown until the preview finishes
  // rendering. The preview-open below advances the FSM the rest of the way
  // (post_ai_clean -> preview_open). resetAiRunState() must run AFTER the
  // RESULTS_APPLIED publish above (it clears state.aiRunSessionId).
  resetAiRunState();
  signalMarkingSession("run-completed");
  uiModule.setViewState({
    computeButtonText: ViewText.computeButtonIdle,
    aiRunSpinnerNote: "",
    aiRunCountdownVisible: false,
    aiRunDeadlineAt: 0,
    aiRunPhase: ""
  });

  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const previewResponse = await messages.requestTabShowAiPreview(tabId, {
    selectorSet
  });
  const previewResult = isPopupCommandSuccess<PreviewCommandResult>(previewResponse)
    ? previewResponse.result
    : null;
  const previewStatePayload = getPreviewStatePayload(previewResult);
  if (previewResult) {
    queueAiPreviewConfigSync(tabId, state.currentBaseUrl);
    if (!(previewStatePayload && previewStatePayload.itemsPending)) {
      flushPendingAiPreviewConfigSync();
    }
  } else {
    await messages.sendTabMessageToTab(tabId, {
      type: "configUpdated",
      baseUrl: state.currentBaseUrl
    }, {
      timeoutMs: 30000
    });
    await refreshCurrentPageRuntimeStatus();
    captureAiRunMarkingsFingerprint();
  }
  const previewOpened = Boolean(previewResult);
  if (previewOpened) {
    publishManualAiPreviewEvent(AI_RUN_EVENT_TYPES.PREVIEW_READY, { origin: "post_ai" });
    // Show the Detected Content sidebar immediately from the items the content
    // script just rendered. Waiting for the next full refreshUi() to rediscover
    // the preview via the timeout-prone getAiPreviewState probe is what made the
    // preview appear only after minutes (or not at all) on heavy pages. The
    // content handler response is nested under result.previewState by the
    // background TAB_SHOW_AI_PREVIEW command.
    const immediatePreviewItems = normalizePreviewItems(
      previewStatePayload && Array.isArray(previewStatePayload.items)
        ? previewStatePayload.items
        : []
    );
    // The AI-run curtain + countdown were already torn down above (before the
    // slow preview roundtrip). Snapshot the marking session and advance the FSM
    // from post_ai_clean to preview_open now that the sidebar is open.
    captureMarkingSessionSnapshot();
    state.previewOpenIntent = true;
    state.previewSuppressReopen = false;
    state.previewCloseMarkingRestoreUnconfirmed = false;
    signalMarkingSession("preview-opened");
    // Fresh preview session: seed the item latch with the immediately-rendered
    // items so a later empty probe/push cannot blink the sidebar to empty.
    resetPreviewItemsLatch();
    if (immediatePreviewItems.length > 0) {
      state.previewSessionHadItems = true;
      state.previewItemsLatched = immediatePreviewItems;
    }
    publishCurrentTabSessionFacts({
      aiBusy: false,
      aiComputing: false,
      busyVisible: false,
      busyMessage: "",
      busyNote: "",
      busyTimerText: "",
      previewActive: true,
      previewBlocked: true,
      previewRestorePending: false
    });
    uiModule.setViewState({
      // Preview fields come from the routine resolver (single writer): the
      // latch was seeded above, so this renders the seed or the loading state.
      ...resolvePreviewRoutineViewState(),
      previewWillRestoreMarking: Boolean(
        previewStatePayload &&
          (previewStatePayload.previousEnabled || previewStatePayload.restoreMarkingOnExit)
      ),
      previewFocusedXpath: "",
      previewShowAllCategories: false,
      computeButtonText: ViewText.computeButtonIdle,
      aiRunSpinnerNote: "",
      aiRunCountdownVisible: false,
      aiRunDeadlineAt: 0,
      aiRunPhase: ""
    });
  }
  updateLastConfigSaveStatus(PopupText.ai.selectorsComputedLocally);
  // This state is intentionally unsynced; keep the tone non-muted until Save runs.
  state.lastConfigSaveStatusTone = "warning";
  uiModule.showToast(PopupText.ai.selectorsComputedLocallyToast);
  return { previewOpened };
}

function applyAiPreviewStateUpdate(message: PreviewStateLike): void;
function applyAiPreviewStateUpdate(message: PreviewStateLike) {
  const messageBaseUrl = typeof message.baseUrl === "string" ? message.baseUrl : "";
  if (state.currentBaseUrl && messageBaseUrl && !utils.sameBaseUrl(messageBaseUrl, state.currentBaseUrl)) {
    return;
  }
  const currentView = uiModule.getViewState();
  const nextPreviewState = buildPreviewViewState(message);
  // The aiPreviewStateChanged push is a best-effort, latency-reducing item feed —
  // content emits it at preview OPEN (items:[] + pending) and again after
  // hydration (full items). On a heavy/busy page the open-time push can be
  // delivered seconds late, arriving AFTER the list already hydrated and would
  // clobber it back to empty ("No content detected"). Route it through the same
  // session item latch as the probe: a non-empty push updates the list; an empty
  // push while the session already produced items keeps the latched list.
  const incomingItems = Array.isArray(nextPreviewState.previewItems) ? nextPreviewState.previewItems : [];
  // Same open-snapshot rule as the probe feed: only a push that shows the OPEN
  // preview may claim "settled" (an inactive/stale push must not arm the
  // settled-empty memory or genuinely-empty a list).
  const settled = Boolean(nextPreviewState.previewActive) && !nextPreviewState.previewItemsPending;
  const previewItems = state.previewOpenIntent
    ? resolveOpenPreviewItems(settled ? incomingItems : [], settled).items
    : (Array.isArray(currentView.previewItems) ? currentView.previewItems : []);
  // P5: the latch re-resolves to fresh arrays, so identical pushes are skipped
  // by CONTENT equality (the deleted stabilize-signature bookkeeping used to
  // fake this via reference reuse); an unchanged list also keeps its current
  // array reference so the sidebar list does not re-render. Field order is
  // canonicalized — normalized items and view items serialize differently.
  const currentPreviewItems = Array.isArray(currentView.previewItems) ? currentView.previewItems : [];
  const serializePreviewItems = (items: typeof previewItems) =>
    JSON.stringify(items.map((item) => [item.xpath, item.text, item.title, item.kind]));
  const previewItemsChanged = serializePreviewItems(previewItems) !== serializePreviewItems(currentPreviewItems);
  if (
    nextPreviewState.previewWillRestoreMarking === Boolean(currentView.previewWillRestoreMarking) &&
    !previewItemsChanged &&
    nextPreviewState.previewFocusedXpath === currentView.previewFocusedXpath &&
    nextPreviewState.previewShowAllCategories === Boolean(currentView.previewShowAllCategories)
  ) {
    if (!nextPreviewState.previewItemsPending) {
      flushPendingAiPreviewConfigSync();
    }
    return;
  }
  uiModule.setViewState({
    previewWillRestoreMarking: nextPreviewState.previewWillRestoreMarking,
    previewItems: previewItemsChanged ? previewItems : currentPreviewItems,
    previewFocusedXpath: nextPreviewState.previewFocusedXpath,
    previewShowAllCategories: nextPreviewState.previewShowAllCategories
  });
  if (!nextPreviewState.previewItemsPending) {
    flushPendingAiPreviewConfigSync();
  }
}

async function failAiRun(message: string = PopupText.ai.runFailed) {
  resetAiRunMarkingsFingerprint();
  signalMarkingSession("run-failed");
  publishCurrentTabAiRunEvent(AI_RUN_EVENT_TYPES.FAILED);
  await stopAiRun({ unlockPage: true });
  uiModule.showToast(message);
}

function getAiRunCommandFailureMessage(response: PopupFailureLike) {
  const details = response && response.details && typeof response.details === "object"
    ? response.details as AiRunCommandFailureDetails
    : null;
  if (details && details.reconciliationPending) {
    return PopupText.page.statusServerSyncPending;
  }
  if (details && details.locked) {
    return propertyLockText.lockedInteractionBlockedToast(getPropertyLockEditorName());
  }
  if (details && details.reason === "missing_current_page") {
    return PopupText.ai.saveCurrentPageBeforeComputing;
  }
  if (details && details.reason === "missing_saved_pages") {
    return PopupText.ai.savePagesBeforeComputing;
  }
  if (details && details.reason === "timed_out") {
    return PopupText.ai.runTimedOut;
  }
  if (response && typeof response.error === "string" && response.error) {
    return response.error;
  }
  return PopupText.ai.saveCurrentPageBeforeComputing;
}

async function handleComputeSelectors() {
  if (state.aiRequestInFlight || state.aiComputeStartPending) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeUsingAi);
    return;
  }
  state.aiComputeStartPending = true;
  try {
    await refreshCurrentPageRuntimeStatus();
    if (state.currentPageSaveReconciliationPending) {
      uiModule.showToast(PopupText.page.statusServerSyncPending);
      return;
    }
    const credentials = await helpers.requireAiCredentials();
    if (!credentials) {
      return;
    }
    const { tokenValue } = credentials;

    state.currentConfig = await config.ensureConfig(state.currentBaseUrl);
    const { aiRunUpToDate, sessionRequiresAiRun } = await getCurrentSessionActionGateState(state.currentConfig);
    if (aiRunUpToDate && !sessionRequiresAiRun) {
      return;
    }
    const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
    if (!currentPageUrl) {
      uiModule.showToast(PopupText.ai.currentPageUnavailable);
      return;
    }
    const pageMarkings = (state.currentConfig && state.currentConfig.pageMarkings) || {};
    const currentPageEntry = pageMarkings[currentPageUrl];
    const currentRenderMode = config.getConfigRenderMode(state.currentConfig);
    const hasCurrentSubmissionXpaths =
      Array.isArray(currentPageEntry && currentPageEntry.submissionXpaths) &&
      currentPageEntry.submissionXpaths.length > 0;
    const currentPageHtml =
      currentPageEntry && typeof currentPageEntry.renderedHtml === "string"
        ? currentPageEntry.renderedHtml
        : "";
    const currentPageNeedsSnapshot =
      state.currentDraftDirty ||
      !currentPageEntry ||
      typeof currentPageEntry !== "object" ||
      !currentPageHtml ||
      !hasCurrentSubmissionXpaths;
    if (currentPageNeedsSnapshot && !ensureMobileSimulationForSave()) {
      return;
    }

    const siteId = normalizeSiteIdValue(state.currentSiteId || (state.currentConfig && state.currentConfig.siteId));
    setAiRunActiveState({
      siteId,
      resumed: false,
      phase: "starting"
    });
    await waitForPopupUiPaint();
    try {
      const tabId = state.currentTab && state.currentTab.id;
      const aiRunResponse = await messages.requestTabRunAi(tabId, {
        baseUrl: state.currentBaseUrl,
        currentPageUrl,
        pageType: state.currentPageTypeKey || "",
        currentRenderMode,
        siteId
      });
      if (!isPopupCommandSuccess<Record<string, unknown>>(aiRunResponse)) {
        await failAiRun(getAiRunCommandFailureMessage(aiRunResponse));
        return;
      }

      const runResult = aiRunResponse.result;
      if (!isSelectorSetTransferPayload(runResult.selectorSet)) {
        await failAiRun(PopupText.ai.runFailed);
        return;
      }

      state.aiRunSessionId = typeof runResult.sessionId === "string" ? runResult.sessionId : "";
      state.aiRunPhase = "done";
      await applyComputedSelectorSet(normalizeAiSelectorSet(runResult.selectorSet), {
        currentPageUrl,
        tokenValue
      });
      await stopAiRun({ unlockPage: false });
    } catch {
      await failAiRun(PopupText.ai.runFailed);
    }
  } finally {
    state.aiComputeStartPending = false;
  }
}

async function postPageTypeAssignmentsToAiServer(options: PageTypeAssignmentsSubmitOptions = {}) {
  if (!isFeatureEnabled("pageTypeAssignments")) {
    // The backend endpoint is not live yet — submitting raised a 404 on
    // every Send to Lynx. Behind the flag until the backend ships.
    return;
  }
  const {
    baseUrl = state.currentBaseUrl,
    checklistPageTypes = state.lynxChecklistPageTypes
  } = options;
  try {
    const preparedPayload = await messages.sendRuntimeMessage({
      type: "preparePageTypeAssignmentsSnapshot",
      baseUrl,
      checklistPageTypes
    });
    if (!preparedPayload || preparedPayload.ok !== true) {
      throw new Error("Unable to prepare page-type assignment payload.");
    }
    const requestPayloadKey = typeof preparedPayload.payloadKey === "string"
      ? preparedPayload.payloadKey
      : "";
    if (!requestPayloadKey) {
      return;
    }
    const response = await messages.sendRuntimeMessage({
      type: "submitPageTypeAssignments",
      payloadKey: requestPayloadKey
    });
    if (!response || response.ok !== true || response.status !== "ok") {
      throw new Error(`Request failed with status ${Number(response && response.httpStatus) || 0}`);
    }
  } catch (error) {
    console.warn("Unable to assign page types to AI server.", error);
  }
}

async function submitSelectorSetToServer(options: SelectorSetSubmitOptions = {}) {
  const {
    baseUrl = state.currentBaseUrl,
    selectorSet = getCurrentSelectorsFromConfig(),
    tokenValue = ""
  } = options;

  state.aiRequestInFlight = "save";
  uiModule.setViewState({
    saveExcludesButtonText: ViewText.saveExcludesBusy,
    saveExcludesButtonLoading: true,
    saveExcludesButtonDisabled: true,
    stageBaseInputDisabled: true,
    stageBaseSetDisabled: true,
    stageBaseEditDisabled: true,
    themeControlsDisabled: true,
    loginCredentialsDisabled: true,
    loginActionDisabled: true,
    configEndpointInputDisabled: true,
    configEndpointSetDisabled: true,
    configEndpointEditDisabled: true,
    endpointInputDisabled: true,
    endpointSetDisabled: true,
    endpointEditDisabled: true,
    renderModeInputDisabled: true,
    renderModeInspectButtonsDisabled: true,
    renderModeInspectWithoutJavaScriptDisabled: true,
    renderModeInspectWithJavaScriptDisabled: true,
    renderModeSetDisabled: true,
    renderModeEditDisabled: true
  });
  publishCurrentTabSessionFacts({
    saving: true
  });
  try {
    await waitForPopupUiPaint();

    await refreshCurrentPageRuntimeStatus({ baseUrl });
    if (state.currentPageSaveReconciliationPending) {
      return { ok: false, skipped: true, reason: PopupText.page.statusServerSyncPending };
    }
    if (state.currentDraftDirty) {
      return { ok: false, skipped: true, reason: PopupText.ai.dirtyNotice };
    }

    const normalizedSelectorSet = normalizeAiSelectorSet(selectorSet);
    if (!combineAiSelectorSet(normalizedSelectorSet).length) {
      return { ok: false, skipped: true, reason: PopupText.ai.noSelectorsToSubmit };
    }

    const { stageBaseValue, configEndpointValue, endpointValue: _endpointValue } = await helpers.loadGlobalAiSettings();
    const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBaseValue);
    if (!graphqlEndpoint) {
      return { ok: false, skipped: true, reason: PopupText.authentication.toastSetStageBaseFirst };
    }

    const siteIdResult = await ensureBaseUrlSiteId({
      baseUrl,
      stageBase: stageBaseValue,
      tokenValue
    });
    if (!siteIdResult.ok || !siteIdResult.siteId) {
      return {
        ok: false,
        skipped: true,
        reason: siteIdResult.reason || ViewText.noDomainIdForBaseUrl
      };
    }

    const effectiveBaseUrl = siteIdResult.baseUrl || baseUrl;
    state.currentBaseUrl = effectiveBaseUrl;
    state.currentConfig = siteIdResult.config || state.currentConfig;

    // Staleness is guarded at the CHECKLIST POPOVER (the cssInfo gate:
    // backend-equality on sanitized selector sets, fail-closed) — the old
    // local last-submitted-fingerprint guard is gone.
    const includeCss = normalizedSelectorSet.inclusionSelectors.join(", ");
    const selectorSetForSubmit = buildSelectorSetForGraphqlSubmit(normalizedSelectorSet);
    const excludeCss = selectorSetForSubmit.exclusionSelectors.join(", ");
    const renderMode = buildGraphqlRenderModeValue(
      config.getConfigRenderMode(state.currentConfig)
    );
    let submitTokenValue = (await getStoredGlobalToken()) || tokenValue;

    try {
      await postPageTypeAssignmentsToAiServer({
        baseUrl: effectiveBaseUrl,
        pageMarkings: (state.currentConfig && state.currentConfig.pageMarkings) || {},
        checklistPageTypes: state.lynxChecklistPageTypes
      });
      submitTokenValue = (await getStoredGlobalToken()) || submitTokenValue;
      const response = await messages.sendRuntimeMessage({
        type: "submitSelectorSetGraphqlUpdate",
        stageBase: stageBaseValue,
        siteId: siteIdResult.siteId,
        includeCss,
        excludeCss,
        renderMode
      });
      let payload = null;
      if (response && response.payload && typeof response.payload === "object") {
        payload = response.payload;
      }
      if (!response || response.ok !== true) {
        return { ok: false, reason: PopupText.ai.submitResponseError };
      }
      if (!payload || typeof payload !== "object") {
        return { ok: false, reason: PopupText.ai.submitResponseFormatError };
      }
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        return {
          ok: false,
          reason:
            payload.errors[0] && typeof payload.errors[0].message === "string"
              ? payload.errors[0].message
              : PopupText.ai.submitResponseError
        };
      }
      const mutationResult =
        payload.data && Object.prototype.hasOwnProperty.call(payload.data, "updateScrapingConditions")
          ? payload.data.updateScrapingConditions
          : undefined;
      if (
        mutationResult === undefined ||
        mutationResult === null ||
        mutationResult === false
      ) {
        return { ok: false, reason: PopupText.ai.submitResponseError };
      }

      const selectorsNeedRefresh =
        !config.isSelectorSetCurrentForRenderMode(state.currentConfig, "selectors") ||
        !aiSelectorSetsEqual(
          normalizedSelectorSet,
          state.currentConfig && state.currentConfig.selectors
        );
      const selectorSetUpdatedAt = selectorsNeedRefresh
        ? config.createTimestampNow()
        : config.normalizeEntryTimestamp(
            state.currentConfig && state.currentConfig.selectorsUpdatedAt
          );
      const submittedSelectorsFingerprint = getSelectorSetFingerprint(normalizedSelectorSet);
      state.currentConfig = await config.updateConfig(effectiveBaseUrl, (targetConfig) => {
        targetConfig.selectors = normalizeAiSelectorSet(normalizedSelectorSet);
        targetConfig.selectorsUpdatedAt = selectorSetUpdatedAt;
        targetConfig.submittedSelectorsFingerprint = submittedSelectorsFingerprint;
      });
      state.aiSelectorsComputedSinceLastSubmit = false;
      state.aiSelectorsComputedBaseUrl = "";
      clearSelectorsPendingConfigSync();
      const currentPageUrl = (state.currentTab && state.currentTab.url) || "";
      const configSyncResult = await syncBaseConfigToServer({
        baseUrl: effectiveBaseUrl,
        pageUrl: currentPageUrl,
        endpointValue: configEndpointValue,
        tokenValue: submitTokenValue,
        stageBase: stageBaseValue,
        alertOnCurrentReplacement: false
      });
      return { ok: true, baseUrl: effectiveBaseUrl, configSyncResult };
    } catch (_error) {
      return { ok: false, reason: PopupText.ai.submitRequestFailed };
    }
  } finally {
    state.aiRequestInFlight = null;
    publishCurrentTabSessionFacts({
      saving: false
    });
    await refreshUi();
  }
}

async function handleLynxChecklistSend() {
  const view = await refreshUiForActionGates();
  if (view.lynxChecklistSendBlockedReason) {
    setLynxChecklistViewState();
    return;
  }
  // cssInfo staleness gate (fail-closed): only a confirmed non-match sends.
  // S7 harden (debug round): a pending/errored check retries on the user's
  // click instead of returning silently — the fail-closed posture stays, but
  // it can no longer wedge without a recovery path.
  if (state.lynxChecklistCssInfoStatus !== "clear") {
    if (state.lynxChecklistCssInfoStatus !== "match" && !lynxCssInfoCheckInFlight) {
      void refreshLynxCssInfoGate();
    }
    setLynxChecklistViewState();
    return;
  }
  const credentials = await helpers.requireAiCredentials();
  if (!credentials) {
    return;
  }
  closeLynxChecklistPopover();
  const submitResult = await submitSelectorSetToServer({
    baseUrl: state.currentBaseUrl,
    selectorSet: getCurrentSelectorsFromConfig(),
    tokenValue: credentials.tokenValue
  });
  if (submitResult.ok) {
    const syncResult = submitResult.configSyncResult || null;
    const syncSkipped = Boolean(syncResult && syncResult.skipped);
    const syncFailed = Boolean(syncResult) && !syncSkipped && !isSuccessfulConfigSyncResult(syncResult);
    updateLastConfigSaveStatus(
      !syncResult
        ? PopupText.ai.submittedSelectors
        : syncSkipped
          ? PopupText.ai.submittedSelectorsSyncSkipped
          : syncFailed
            ? PopupText.ai.submittedSelectorsSyncFailed
            : PopupText.ai.submittedSelectorsAndSynced
    );
    uiModule.showToast(PopupText.ai.submittedToServer);
    return;
  }
  uiModule.showToast(submitResult.reason || PopupText.ai.submitRequestFailed);
}

async function handleSaveExcludes() {
  if (state.aiRequestInFlight) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!isCurrentRenderModeReady()) {
    uiModule.showToast(PopupText.renderMode.toastConfirmBeforeSubmitting);
    return;
  }
  const view = await refreshUiForActionGates();
  if (view.saveExcludesBlockedReason === SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  if (view.saveExcludesBlockedReason !== SECONDARY_GATES_BLOCK_REASONS.NONE) {
    // S7 harden (debug round): never no-op a Save click invisibly — the user
    // read the silent return as "save failed with no request". Name the gate.
    uiModule.showToast(
      view.saveExcludesBlockedReason === SECONDARY_GATES_BLOCK_REASONS.REQUIRES_AI_RUN
        ? PopupText.page.statusRunAiBeforeSaving
        : view.saveExcludesBlockedReason === SECONDARY_GATES_BLOCK_REASONS.NO_SESSION_CHANGES
          ? PopupText.page.toastSaveBlockedNoSessionChanges
          : view.saveExcludesBlockedReason === SECONDARY_GATES_BLOCK_REASONS.BUSY
            ? PopupText.page.toastSaveBlockedBusy
            : PopupText.page.toastSaveBlockedUnavailable
    );
    return;
  }
  openLynxChecklistPopover();
}

async function handlePreviewLatest() {
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!state.currentConfig) {
    uiModule.showToast(ViewText.noMappedBaseUrlOrSiteId);
    return;
  }
  if (!hasCalculatedSelectorsFromConfig(state.currentConfig)) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  const view = await refreshUiForActionGates();
  if (view.previewLatestBlockedReason === SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  if (view.previewLatestBlockedReason === SECONDARY_GATES_BLOCK_REASONS.NO_STORED_SELECTORS) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  if (view.previewLatestBlockedReason !== SECONDARY_GATES_BLOCK_REASONS.NONE) {
    return;
  }
  const selectorSet = getLatestAvailableSelectorsFromConfig();
  if (!combineAiSelectorSet(selectorSet).length) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  const latestView = uiModule.getViewState();
  if (latestView.previewBlocked) {
    return;
  }
  clearLastPopupEnabled();
  collapseTodoListForAutoCollapse();
  try {
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabShowAiPreview(tabId, {
      selectorSet
    });
    if (!isPopupCommandSuccess(response)) {
      throw new Error(PopupText.preview.openFailed);
    }
    // Silent Preview opens a preview session from stored selectors; mark it
    // popup-owned so the item latch + visibility override engage (this path
    // hydrates items asynchronously like the other open paths).
    state.previewOpenIntent = true;
    state.previewSuppressReopen = false;
    state.previewCloseMarkingRestoreUnconfirmed = false;
    signalMarkingSession("preview-opened");
    resetPreviewItemsLatch();
    publishManualAiPreviewEvent(AI_RUN_EVENT_TYPES.PREVIEW_READY, { origin: "silent" });
    await refreshUi();
  } catch (error) {
    clearMarkingSessionSnapshot();
    uiModule.showToast(getErrorMessage(error) || PopupText.preview.openFailed);
    await refreshUi();
  }
}

async function handleMarkingPreview() {
  const view = uiModule.getViewState();
  if (!view.markingPreviewVisible || view.markingPreviewDisabled) {
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  if (!helpers.ensureBaseUrl()) {
    return;
  }
  if (!state.currentConfig) {
    uiModule.showToast(ViewText.noMappedBaseUrlOrSiteId);
    return;
  }
  const latestView = await refreshUiForActionGates();
  if (latestView.markingPreviewBlockedReason === SECONDARY_GATES_BLOCK_REASONS.SERVER_SYNC_PENDING) {
    uiModule.showToast(PopupText.page.statusServerSyncPending);
    return;
  }
  if (latestView.markingPreviewBlockedReason !== SECONDARY_GATES_BLOCK_REASONS.NONE) {
    return;
  }
  captureMarkingSessionSnapshot();
  const selectorSet = getLatestAvailableSelectorsFromConfig();
  if (!combineAiSelectorSet(selectorSet).length) {
    uiModule.showToast(PopupText.preview.noStoredSelectors);
    return;
  }
  if (uiModule.getViewState().previewBlocked) {
    return;
  }
  collapseTodoListForAutoCollapse();
  try {
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabShowAiPreview(tabId, {
      selectorSet
    });
    if (!isPopupCommandSuccess(response)) {
      throw new Error(PopupText.preview.openFailed);
    }
    state.previewOpenIntent = true;
    state.previewSuppressReopen = false;
    state.previewCloseMarkingRestoreUnconfirmed = false;
    signalMarkingSession("preview-opened");
    // Fresh preview session opening empty; it hydrates asynchronously.
    resetPreviewItemsLatch();
    publishCurrentTabAiRunEvent(AI_RUN_EVENT_TYPES.PREVIEW_READY, { origin: "marking" });
    await refreshUi();
  } catch (error) {
    clearMarkingSessionSnapshot();
    uiModule.showToast(getErrorMessage(error) || PopupText.preview.openFailed);
    await refreshUi();
  }
}

async function handleExitPreviewMode() {
  if (state.previewRestorePending) {
    schedulePreviewRestoreFallback(state.previewRestoreToken);
    return;
  }
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  signalMarkingSession("exit-clicked");
  const currentView = uiModule.getViewState();
  const shouldRestoreMarking = Boolean(currentView.previewWillRestoreMarking);
  {
    // REFLEX-ARC Phase 1: popup-borne signal (user intent), admitted by the
    // brain for provenance + sequencing.
    const signalTabId = getCurrentPopupTabId();
    if (signalTabId) {
      void emitPopupSignal(signalTabId, {
        name: SIGNAL_NAMES.PREVIEW_EXIT_REQUESTED,
        source: "popup",
        cause: "user-exit-click",
        payload: { restore: shouldRestoreMarking }
      });
    }
  }
  const previewRestoreToken = shouldRestoreMarking
    ? beginPreviewRestorePending()
    : null;
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  // Heavy-page exits legitimately run long (full marking restore + config
  // persistence on the frozen page): give the command a generous budget.
  const response = await messages.requestTabCloseAiPreview(tabId, {
    previewRestoreToken
  }, { timeoutMs: 20000 });
  if (!isPopupCommandSuccess<PreviewCloseCommandResult>(response)) {
    const timedOut = Boolean(response && (response as { code?: string }).code === "timeout");
    if (timedOut && previewRestoreToken !== null) {
      // A timed-out response is NOT a failure verdict: content keeps exiting
      // and the settle (aiPreviewClosed) or the hard finalize recovers the
      // surface — se7's film showed "Unable to exit preview" toasting over a
      // perfectly settled post-exit surface. The restore-latch machinery owns
      // the outcome from here; a genuinely stuck exit surfaces through the
      // fallback finalize instead of a premature toast.
      schedulePreviewRestoreFallback(previewRestoreToken);
      return;
    }
    clearPreviewRestorePending();
    clearMarkingSessionSnapshot();
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
    uiModule.showToast(PopupText.preview.exitFailed);
    return;
  }
  const closeResult = getPreviewStatePayload<PreviewCloseState>(response.result);
  if (shouldRestoreMarking || shouldReportManualAiPreviewEvent()) {
    publishCurrentTabAiRunEvent(AI_RUN_EVENT_TYPES.EXITED);
  }
  if (!previewCloseIndicatesNavigation(closeResult) && restoreMarkingSessionSnapshot()) {
    const closeDraftStatus = closeResult && closeResult.draftStatus && typeof closeResult.draftStatus === "object"
      ? closeResult.draftStatus as TabDraftStatusResponse
      : null;
    if (closeResult && closeResult.markingEnabled) {
      applyDraftStatusToPopupState(closeDraftStatus);
    }
    settlePreviewRestoreClosed(previewRestoreToken);
    await refreshUi({
      useBusyOverlay: false,
      skipPropertyLockFetch: true,
      preserveCurrentDraftStatus: true
    }).catch(() => null);
    return;
  }
  if (
    previewRestoreToken !== null &&
    !previewCloseIndicatesNavigation(closeResult) &&
    !(closeResult && (typeof closeResult.markingEnabled === "boolean" || closeResult.draftStatus))
  ) {
    void finalizePreviewRestoreFromRuntime({ token: previewRestoreToken }).catch(() => null);
  }
  if (closeResult && (typeof closeResult.markingEnabled === "boolean" || closeResult.draftStatus)) {
    await applyPreviewClosedState(closeResult);
  }
}

function normalizePreviewItems(items: PreviewStateLike["items"] | null | undefined) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item === "object" && typeof item.xpath === "string")
    .map((item) => {
      const xpath = typeof item.xpath === "string" ? item.xpath : "";
      return {
        xpath,
        text: typeof item.text === "string" ? item.text : "",
        title: typeof item.title === "string" && item.title ? item.title : xpath,
        kind: typeof item.kind === "string" ? item.kind : ""
      };
    });
}

function resetPreviewItemsLatch(): void {
  state.previewSessionHadItems = false;
  state.previewItemsLatched = [];
  state.previewSessionSettledEmpty = false;
  state.previewSettledEmptyCandidateAt = 0;
}

// "No content detected" is a destructive presentation verdict from a single
// observation — and the .se acceptance caught a feed claiming settled-empty
// +911ms after open while content was still hydrating 1709 items (the list
// then held the false verdict; FINDING-3's popup-side variant). Like every
// destructive latch in this file, the verdict now needs CONFIRMATION: the
// first qualifying observation only arms a candidate (the surface keeps
// loading); the latch arms when qualifying observations still hold after
// this window; any items / pending / uncertain feed clears the candidate.
const PREVIEW_SETTLED_EMPTY_CONFIRM_MS = 3000;

// Single source of truth for the preview item list while a preview session is
// open. Content owns the items; the popup only mirrors them. Both the
// getAiPreviewState probe (refreshUi) and the aiPreviewStateChanged push feed
// this — each has transient/stale empty snapshots (mid-hydration, late-delivered
// open-time push) that must never blink an established list back to empty
// ("No content detected"). Rule: the first hydrated non-empty result latches;
// after that, an empty snapshot keeps the latched list. Empty is shown only when
// the session has genuinely never produced items (still loading -> pending, or a
// settled no-detections result -> not pending).
// REFLEX-ARC RENDERER (architect direction, 2026-07-03): the preview is a
// popup-local mechanical routine — the brain signals open/close and observes
// reported facts, but the routine's view is orchestrated locally. This is the
// SINGLE authority for the preview view fields, and it derives them from the
// routine's CURRENT state (open intent + restore pending + item latch) at the
// moment of the write. Interleaved refreshUi passes previously carried their
// pass-start preview snapshots to their pass-end full-view writes, so a
// pre-hydration pass finishing late stomped the hydrated list (the open list
// oscillated hydrated<->empty; per-frame round-7/8 captures). Every writer now
// re-resolves here at write time, so a stale pass re-renders the fresh truth.
type PreviewRoutineViewState = PreviewViewState & {
  previewBlocked: boolean;
  previewBlockedMessage: string;
};

function resolvePreviewRoutineViewState(): PreviewRoutineViewState {
  const currentView = uiModule.getViewState();
  const open = Boolean(!state.previewRestorePending && state.previewOpenIntent);
  if (!open) {
    return {
      previewActive: false,
      previewItems: [],
      previewItemsPending: false,
      previewFocusedXpath: "",
      previewShowAllCategories: false,
      previewWillRestoreMarking: Boolean(currentView.previewWillRestoreMarking),
      previewBlocked: false,
      previewBlockedMessage: ViewText.previewBlockedDefault
    };
  }
  // No new data here: read the standing latch (a feed with fresh probe/push
  // data updates the latch first, then renders through this same resolver).
  // previewSessionSettledEmpty remembers a CONFIRMED settled no-detections
  // verdict so the re-render shows "No content detected" instead of
  // re-entering the loading state. This is a latch READ, not an observation:
  // it must not step the confirmation window.
  const resolved = resolveOpenPreviewItems([], state.previewSessionSettledEmpty, false);
  return {
    previewActive: true,
    previewItems: resolved.items,
    previewItemsPending: resolved.pending,
    previewFocusedXpath: typeof currentView.previewFocusedXpath === "string"
      ? currentView.previewFocusedXpath
      : "",
    previewShowAllCategories: Boolean(currentView.previewShowAllCategories),
    previewWillRestoreMarking: Boolean(currentView.previewWillRestoreMarking),
    previewBlocked: true,
    previewBlockedMessage: PopupText.preview.blockedActive
  };
}

function resolveOpenPreviewItems(
  incomingItems: PreviewViewState["previewItems"],
  settled: boolean,
  // false = latch READ (snapshot re-render): renders the current memory
  // without stepping the settled-empty confirmation.
  isFeedObservation = true
): ResolvedPreviewItems {
  const items = Array.isArray(incomingItems) ? incomingItems : [];
  if (items.length > 0) {
    state.previewSessionHadItems = true;
    state.previewItemsLatched = items;
    state.previewSessionSettledEmpty = false;
    state.previewSettledEmptyCandidateAt = 0;
    return { items, pending: false };
  }
  if (state.previewSessionHadItems) {
    const latched = Array.isArray(state.previewItemsLatched) ? state.previewItemsLatched : [];
    return { items: latched, pending: false };
  }
  if (isFeedObservation) {
    if (settled && !state.previewSessionSettledEmpty) {
      const now = Date.now();
      if (!state.previewSettledEmptyCandidateAt) {
        // First sighting arms the candidate only; the surface keeps loading.
        state.previewSettledEmptyCandidateAt = now;
        console.debug("[preview] settled-empty candidate armed");
      } else if (now - state.previewSettledEmptyCandidateAt >= PREVIEW_SETTLED_EMPTY_CONFIRM_MS) {
        // Confirmed settled no-detections: remember it so re-renders keep
        // showing "No content detected" instead of flapping back to loading.
        state.previewSessionSettledEmpty = true;
        console.debug("[preview] settled-empty CONFIRMED", {
          candidateAgeMs: now - state.previewSettledEmptyCandidateAt
        });
      }
    } else if (!settled) {
      // Pending / uncertain observation contradicts the candidate.
      if (state.previewSettledEmptyCandidateAt) {
        console.debug("[preview] settled-empty candidate cleared");
      }
      state.previewSettledEmptyCandidateAt = 0;
    }
  }
  return { items: [], pending: !state.previewSessionSettledEmpty };
}

function buildPreviewViewState(previewState: PreviewStateLike | null | undefined): PreviewViewState {
  const previewStateMode = previewState?.mode;
  const previewMode = typeof previewStateMode === "string" ? previewStateMode : "";
  const previewFocusedXpath = typeof previewState?.focusedXpath === "string"
    ? previewState.focusedXpath
    : "";
  const previewExpandedStatesEnabled = isFeatureEnabled("previewExpandedStates");
  return {
    previewActive: Boolean(previewState && previewState.active && previewMode === "preview"),
    previewItemsPending: Boolean(
      previewState &&
      previewState.active &&
      previewMode === "preview" &&
      previewState.itemsPending
    ),
    previewWillRestoreMarking: Boolean(
      previewState &&
        previewState.active &&
        previewMode === "preview" &&
        (previewState.previousEnabled || previewState.restoreMarkingOnExit)
    ),
    previewItems: normalizePreviewItems(previewState && previewState.items),
    previewFocusedXpath,
    previewShowAllCategories: Boolean(
      previewExpandedStatesEnabled &&
      previewState &&
      previewState.active &&
      previewMode === "preview" &&
      previewState.showAllCategories
    )
  };
}

async function handlePreviewShowAllCategoriesChange(event: PopupCheckedEvent) {
  if (!isFeatureEnabled("previewExpandedStates")) {
    uiModule.setViewState({ previewShowAllCategories: false });
    return;
  }
  const nextChecked = getPopupEventChecked(event);
  const previousChecked = Boolean(uiModule.getViewState().previewShowAllCategories);
  uiModule.setViewState({ previewShowAllCategories: nextChecked });
  if (!await helpers.ensureActiveTab({ requireId: true })) {
    uiModule.setViewState({ previewShowAllCategories: previousChecked });
    return;
  }
  try {
    const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
      ? state.currentTab.id
      : null;
    const response = await messages.requestTabSetAiPreviewExpandedMode(tabId, {
      active: nextChecked
    });
    if (!isPopupCommandSuccess<PreviewCommandResult>(response)) {
      throw new Error(PopupText.preview.updateFailed);
    }
    uiModule.setViewState(buildPreviewViewState(response.result.previewState || null));
  } catch (error) {
    uiModule.setViewState({ previewShowAllCategories: previousChecked });
    uiModule.showToast(getErrorMessage(error) || PopupText.preview.updateFailed);
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
  }
}

async function handlePreviewItemFocus(xpath: unknown) {
  if (typeof xpath !== "string" || !xpath || !await helpers.ensureActiveTab({ requireId: true })) {
    return;
  }
  uiModule.setViewState({ previewFocusedXpath: xpath });
  const tabId = state.currentTab && Number.isFinite(state.currentTab.id)
    ? state.currentTab.id
    : null;
  const response = await messages.requestTabFocusPreviewElement(tabId, {
    xpath
  });
  if (!isPopupCommandSuccess(response)) {
    uiModule.showToast(PopupText.explicitSelection.focusFailed);
    await refreshUi();
  }
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    return;
  }
  state.refreshTimer = window.setTimeout(async () => {
    state.refreshTimer = 0;
    await helpers.ensureActiveTab();
    await refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true });
  }, 120);
}

function handleSpinnerSurfaceChangedFromBrain(surface: "popup" | "pageCurtain" | "banner") {
  if (surface !== "popup" && surface !== "pageCurtain") {
    return;
  }
  // P5 (refresh reduction): a spinner broadcast repaints ONLY the busy
  // surface. Machine memories own the session surfaces and data fields have
  // no spinner dependency, so the old full refreshUi here — the popup's main
  // re-derivation cadence during operations — is gone.
  uiModule.setViewState(buildProjectedBusyViewState());
}

// P6 follow-up (fail-open + retry): the page-type taxonomy is the ALLOWLIST
// the todo list filters property page types against — normalizePropertyPageTypes
// drops any slug not present in it (`!getPageTypeLabel(key)`). It is now served
// dynamically from the config backend (names + types), so a fresh install whose
// FIRST taxonomy fetch fails would silently drop backend-only page types (the
// stale bundled default lacks them) until the next popup open. The fetch stays
// FAIL-OPEN — the cache/default render meanwhile and nothing blocks — but this
// adds a bounded backoff retry so a transient failure self-heals and populates
// the persisted cache, after which every future session is covered. Only a
// network/HTTP failure retries; applied-ok, no-endpoint (skipped), and
// auth_error (re-login is the recovery) are terminal.
let pageTypeTaxonomyRetryTimer = 0;
let pageTypeTaxonomyRetryCount = 0;
const PAGE_TYPE_TAXONOMY_MAX_RETRIES = 5;

function loadPageTypeTaxonomyWithRetry(): void {
  void messages.sendRuntimeMessage({ type: "loadPageTypeTaxonomy" })
    .then((response) => {
      const result = response && typeof response === "object"
        ? (response as { ok?: unknown; status?: unknown; skipped?: unknown })
        : null;
      const terminal =
        Boolean(result && result.ok === true && result.status === "ok") ||
        Boolean(result && result.skipped === true) ||
        Boolean(result && result.status === "auth_error");
      if (terminal) {
        pageTypeTaxonomyRetryCount = 0;
        return;
      }
      schedulePageTypeTaxonomyRetry();
    })
    .catch(() => {
      schedulePageTypeTaxonomyRetry();
    });
}

function schedulePageTypeTaxonomyRetry(): void {
  if (pageTypeTaxonomyRetryTimer || pageTypeTaxonomyRetryCount >= PAGE_TYPE_TAXONOMY_MAX_RETRIES) {
    return;
  }
  const delayMs = Math.min(30000, 2000 * Math.pow(2, pageTypeTaxonomyRetryCount));
  pageTypeTaxonomyRetryCount += 1;
  pageTypeTaxonomyRetryTimer = window.setTimeout(() => {
    pageTypeTaxonomyRetryTimer = 0;
    loadPageTypeTaxonomyWithRetry();
  }, delayMs);
}

async function init() {
  state.traceEvents = [];
  void initPageTypeTaxonomy();
  if (pageTypeTaxonomyRetryTimer) {
    window.clearTimeout(pageTypeTaxonomyRetryTimer);
    pageTypeTaxonomyRetryTimer = 0;
  }
  pageTypeTaxonomyRetryCount = 0;
  loadPageTypeTaxonomyWithRetry();
  state.traceModeEnabled = await loadTraceModeSetting().catch(() => false);
  await helpers.ensureActiveTab();
  const initTabId = state.currentTab && state.currentTab.id;
  if (initTabId) {
    const popupBus = startPopupBusClient(initTabId, {
      applyPopupView: applyPopupViewSnapshot,
      onSpinnerSurfaceChanged: handleSpinnerSurfaceChangedFromBrain,
      onSignal: onPushedSignalFrame
    });
    activePopupBusClient = popupBus;
    maybePullSignals(initTabId);
    await restoreSpinnerQueueFromBackground(initTabId, popupBus);
    await applyTraceModePreferenceToTab(initTabId, state.traceModeEnabled, popupBus).catch(() => null);
    maybeRunPopupBusSelfTest(initTabId, popupBus);
    if (hasProjectedNavigationInspectionSpinner()) {
      popupNavigationInspectionOverlayStarted = true;
      popupNavigationInspectionOverlayTabId = initTabId;
    }
  }
  logPopupReady(console, state);
  await ensureThemeSettings();

  uiModule.initUi({
    onToggleEnabled: asPopupHandler(handleEnableToggle),
    onDeviceEmulationEnabledChange: asPopupHandler(handleDeviceEmulationEnabledToggle),
    onDesktopPreviewEnabledChange: asPopupHandler(handleDesktopPreviewEnabledToggle),
    onDeviceScaleInput: asPopupHandler(handleDeviceScaleInput),
    onDeviceScaleChange: asPopupHandler(handleDeviceScaleChange),
    onConfigToggle: asPopupHandler(handleConfigToggle),
    onConfigMenuClick: asPopupHandler(handleConfigMenuClick),
    onTodoControlsMenuToggle: asPopupHandler(handleTodoControlsMenuToggle),
    onTodoControlsMenuClick: asPopupHandler(handleTodoControlsMenuClick),
    onTodoSectionToggle: handleTodoSectionToggle,
    onTodoSubsectionToggle: handleTodoSubsectionToggle,
    onTodoExpandAll: handleTodoExpandAll,
    onTodoCollapseAll: handleTodoCollapseAll,
    onTodoAutoCollapseToggle: handleTodoAutoCollapseToggle,
    onTraceModeToggle: handleTraceModeToggle,
    onConfigurationExtrasToggle: handleConfigurationExtrasToggle,
    onOpenConfiguration: handleOpenConfigurationView,
    onConfigurationContinue: handleConfigurationContinue,
    onClearDomainCache: handleClearDomainCache,
    onUnregisterCurrentTab: handleUnregisterCurrentTab,
    onPageSave: handlePageSave,
    onPageRevert: handlePageRevert,
    onMarkingPreview: handleMarkingPreview,
    onConfigEndpointInput: asPopupHandler(handleConfigEndpointInput),
    onConfigEndpointKeyDown: asPopupHandler(handleConfigEndpointKeyDown),
    onConfigEndpointSet: handleConfigEndpointSet,
    onConfigEndpointEditToggle: handleConfigEndpointEditToggle,
    onEndpointInput: asPopupHandler(handleEndpointInput),
    onEndpointKeyDown: asPopupHandler(handleEndpointKeyDown),
    onEndpointSet: handleEndpointSet,
    onEndpointEditToggle: handleEndpointEditToggle,
    onStageBaseInput: asPopupHandler(handleStageBaseInput),
    onThemeInput: asPopupHandler(handleThemeInput),
    onThemePrevious: handleThemePrevious,
    onThemeNext: handleThemeNext,
    onThemeMenuToggle: asPopupHandler(handleThemeMenuToggle),
    onThemeMenuKeyDown: asPopupHandler(handleThemeMenuKeyDown),
    onThemeOptionSelect: asPopupHandler(handleThemeOptionSelect),
    onThemeModeInput: asPopupHandler(handleThemeModeInput),
    onRenderModeInput: asPopupHandler(handleRenderModeInput),
    onRenderModeChoiceInput: asPopupHandler(handleRenderModeInput),
    onRenderModeSummaryToggle: asPopupHandler(handleRenderModeSummaryToggle),
    onRenderModeInspectWithJavaScript: handleRenderModeInspectWithJavaScript,
    onRenderModeInspectWithoutJavaScript: handleRenderModeInspectWithoutJavaScript,
    onLynxChecklistPageTypeDecisionChange: asPopupHandler(handleLynxChecklistPageTypeDecisionChange),
    onLynxChecklistPageTypePageChange: asPopupHandler(handleLynxChecklistPageTypePageChange),
    onLynxChecklistCandidateNavigate: asPopupHandler(handleLynxChecklistCandidateNavigate),
    onLynxChecklistCancel: handleLynxChecklistCancel,
    onLynxChecklistSend: handleLynxChecklistSend,
    onRenderModeSet: handleRenderModeSet,
    onRenderModeEditToggle: handleRenderModeEditToggle,
    onOpenRenderModeSection: handleOpenRenderModeSection,
    onStageBaseKeyDown: asPopupHandler(handleStageBaseKeyDown),
    onStageBaseSet: handleStageBaseSet,
    onStageBaseEditToggle: handleStageBaseEditToggle,
    onLoginEmailInput: asPopupHandler(handleLoginEmailInput),
    onLoginPasswordInput: asPopupHandler(handleLoginPasswordInput),
    onLoginPasswordKeyDown: asPopupHandler(handleLoginPasswordKeyDown),
    onLoginAction: handleLoginAction,
    onPropertyLockTake: handlePropertyLockTake,
    onPropertyLockSuggest: handlePropertyLockSuggest,
    onPropertyLockContinue: handlePropertyLockContinue,
    onPropertyLockForceContinue: handlePropertyLockForceContinue,
    onPropertyLockAcceptSuggestion: handlePropertyLockAcceptSuggestion,
    onPropertyLockRejectSuggestion: handlePropertyLockRejectSuggestion,
    onCompute: handleComputeSelectors,
    onSaveExcludes: handleSaveExcludes,
    onPreviewLatest: handlePreviewLatest,
    onPreviewItemFocus: handlePreviewItemFocus,
    onPreviewShowAllCategoriesChange: asPopupHandler(handlePreviewShowAllCategoriesChange),
    onExitPreviewMode: handleExitPreviewMode,
    onExplicitExcludeView: asPopupHandler(handleExplicitExcludeView),
    onExplicitExcludeRemove: asPopupHandler(handleExplicitExcludeRemove),
    onExplicitIncludeView: asPopupHandler(handleExplicitIncludeView),
    onExplicitIncludeRemove: asPopupHandler(handleExplicitIncludeRemove),
    onMarkedPageNavigate: asPopupHandler(handleMarkedPageNavigate)
  });

  document.addEventListener("click", () => {
    uiModule.setConfigMenuOpen(false);
    uiModule.setTodoControlsMenuOpen(false);
    uiModule.setThemeMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      uiModule.setConfigMenuOpen(false);
      uiModule.setTodoControlsMenuOpen(false);
      uiModule.setThemeMenuOpen(false);
    }
    const primaryModifier = event.ctrlKey || event.metaKey;
    if (!primaryModifier || event.altKey || event.shiftKey || event.repeat) {
      return;
    }
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key !== "e" && key !== "s" && key !== "m") {
      return;
    }
    if (key === "m" && !isFeatureEnabled("desktopPreview")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (isEditableTarget(event.target)) {
      return;
    }
    const view = uiModule.getViewState();
    if (key === "e") {
      if (view.toggleEnabledDisabled) {
        return;
      }
      handleEnableToggle({ target: { checked: !view.toggleEnabled } }).then();
      return;
    }
    if (key === "m") {
      if (view.desktopPreviewVisible && !view.desktopPreviewDisabled) {
        handleDesktopPreviewEnabledToggle({
          currentTarget: { checked: !view.desktopPreviewEnabled }
        }).then();
      }
      return;
    }
    if (!view.toggleEnabled || view.pageSaveDisabled) {
      return;
    }
    handlePageSave().then();
  });

  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    if (!tabId) {
      return;
    }
    const tab = await browser.tabs.get(tabId);
    if (state.currentTab && tab.windowId !== state.currentTab.windowId) {
      return;
    }
    // Remove old-tab transient leases when switching tabs; popup-local state only
    // tracks outstanding mutation requests for the active tab.
    const oldTabId = state.currentTab && state.currentTab.id;
    if (oldTabId) {
      clearSpinnerQueueInBackground(oldTabId, { transientOnly: true }).catch(() => {});
    }
    clearNavigationInspectionSettlePollsExcept();
    clearProjectedPopupSpinnerSurfaces();
    uiModule.setUiBusy(false);
    popupNavigationInspectionOverlayStarted = false;
    popupNavigationInspectionOverlayTabId = null;
    popupBackgroundLifecycle = null;
    popupBackgroundStateTabId = null;
    popupBackgroundActivation = null;
    popupBackgroundSessionPhase = null;
    popupBackgroundSessionDictation = null;
    popupBackgroundPropertyLockView = null;
    popupBackgroundPropertyLockTimer = null;
    popupBackgroundSecondaryGates = null;
    activePopupBusClient = null;
    await helpers.ensureActiveTab();
    // Restore brain-projected view state for the newly active tab.
    const newTabId = state.currentTab && state.currentTab.id;
    if (newTabId) {
      try {
        const popupBus = startPopupBusClient(newTabId, {
          applyPopupView: applyPopupViewSnapshot,
          onSpinnerSurfaceChanged: handleSpinnerSurfaceChangedFromBrain,
          onSignal: onPushedSignalFrame
        });
        maybePullSignals(newTabId);
        activePopupBusClient = popupBus;
        await restoreSpinnerQueueFromBackground(newTabId, popupBus);
        maybeRunPopupBusSelfTest(newTabId, popupBus);
      } catch {
        // Restoration failure is non-fatal; projected state will arrive on the next event.
      }
      if (hasProjectedNavigationInspectionSpinner()) {
        popupNavigationInspectionOverlayStarted = true;
        popupNavigationInspectionOverlayTabId = newTabId;
      }
    }
    // Refresh quietly on tab switch: the newly active tab's genuine busy state
    // (restored brain projection above) still surfaces through refreshUiInner, but
    // the refresh itself no longer raises a "Refreshing popup data..." curtain
    // that, on heavy pages, blocked the popup for many seconds per switch.
    await refreshUi({ useBusyOverlay: false });
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!(changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete")) {
      return;
    }
    if (changeInfo.url || changeInfo.status === "loading") {
      clearRemoteConfigLoadCacheForTab(tabId);
    }
    if (!state.currentTab || tabId !== state.currentTab.id) {
      return;
    }
    state.currentTab = tab;
    if (changeInfo.url || changeInfo.status === "loading") {
      state.remoteConfigLoadKey = "";
      state.remoteConfigLoadResult = null;
    }
    await messages.sendRuntimeMessage({
      type: "clearReloadRestoreTabState",
      tabId
    }).catch(() => null);
    const tabState = await messages.getTabState(tabId);
    const candidateUrl = typeof changeInfo.url === "string" && changeInfo.url
      ? changeInfo.url
      : ((tab && typeof tab.url === "string") ? tab.url : "");
    // While a render-mode Set reload is in flight, the tab may not be
    // marking-enabled (silent mode). Resolve a base URL from tab state or the
    // current property so the settle checks and scope test still work, and treat
    // the reload as inspection so the navInspect overlay is not torn down here.
    const renderModeSetGuardActive = isRenderModeSetNavGuardActive(tabId);
    const settleBaseUrl =
      (tabState && tabState.baseUrl) || state.currentBaseUrl || "";
    const inspectionExpected = Boolean(
      (tabState &&
        tabState.enabled &&
        tabState.baseUrl &&
        (!candidateUrl || utils.isPageWithinBaseUrl(candidateUrl, tabState.baseUrl))) ||
      (renderModeSetGuardActive &&
        settleBaseUrl &&
        (!candidateUrl || utils.isPageWithinBaseUrl(candidateUrl, settleBaseUrl)))
    );
    if (!inspectionExpected) {
      if (popupNavigationInspectionOverlayTabId === tabId) {
        endNavigationInspectionOverlay(tabId);
      }
      if (changeInfo.url || changeInfo.status === "complete") {
        await refreshUi();
      }
      return;
    }
    beginNavigationInspectionOverlay(tabId);
    if (changeInfo.status === "loading") {
      return;
    }
    try {
      await refreshUi({ useBusyOverlay: false });
      if (changeInfo.status === "complete") {
        const settleResult = await waitForEnableMarkingInspectionToSettle(tabId, settleBaseUrl);
        logPopupSpinnerDebug("nav-complete-settle", {
          tabId,
          settleResult,
          url: tab && typeof tab.url === "string" ? tab.url : ""
        });
        if (settleResult.responseObserved || settleResult.inspectionObserved) {
          if (shouldHoldNavInspectUntilRenderModeInspectionSeen(tabId)) {
            scheduleNavigationInspectionSettlePoll(tabId, settleBaseUrl);
          } else {
            endNavigationInspectionOverlay(tabId);
            await refreshUi({ useBusyOverlay: false });
          }
        } else {
          // Communication can briefly fail on some pages. Keep the brain lease active
          // until we can explicitly confirm inspection settled.
          scheduleNavigationInspectionSettlePoll(tabId, settleBaseUrl);
        }
      }
    } finally {
      // Completion cleanup is handled after explicit settle checks above.
    }
  });
  window.addEventListener("beforeunload", () => {
    clearPropertyLockOffCandidateRefreshTimer();
    const tabId = state.currentTab && state.currentTab.id;
    if (tabId) {
      clearSpinnerQueueInBackground(tabId, { transientOnly: true }).catch(() => {});
    }
    clearNavigationInspectionSettlePollsExcept();
  });

  utils.addStorageChangeListener((changes, areaName) => {
    const storageChanges = getStorageChangeMap(changes);
    if (areaName === "sync") {
      const authContextChange = storageChanges[GLOBAL_AUTH_CONTEXT_VERSION_KEY];
      const stageBaseChange = storageChanges[GLOBAL_STAGE_BASE_KEY];
      const configEndpointChange = storageChanges[GLOBAL_CONFIG_ENDPOINT_KEY];
      if (authContextChange || stageBaseChange || configEndpointChange) {
        state.lastTokenValidationAt = 0;
        state.siteIdLookupByBaseUrl.clear();
        clearRemoteConfigLoadCache();
        setRemoteConfigConnectionIssue(false);
        scheduleRefresh();
      }
      const themeChange = storageChanges[GLOBAL_THEME_KEY];
      const themeModeChange = storageChanges[GLOBAL_THEME_MODE_KEY];
      if (themeChange || themeModeChange) {
        const appearanceCustomizationEnabled = isFeatureEnabled("appearanceCustomization");
        if (!appearanceCustomizationEnabled && (themeChange || themeModeChange)) {
          resetDisabledAppearanceCustomization();
        }
        if (appearanceCustomizationEnabled && themeChange) {
          state.currentTheme = normalizeThemeValue(
            themeChange.newValue
          );
        }
        if (appearanceCustomizationEnabled && themeModeChange) {
          state.currentThemeMode = normalizeThemeModeValue(
            themeModeChange.newValue
          );
        }
        if (appearanceCustomizationEnabled) {
          applyPopupTheme(state.currentTheme, state.currentThemeMode);
        }
        scheduleRefresh();
      }
      return;
    }
    if (areaName !== "local" && areaName !== "session") {
      return;
    }
    const currentTabIdValue = state.currentTab?.id;
    const currentTabId = typeof currentTabIdValue === "number" && Number.isFinite(currentTabIdValue)
      ? Math.trunc(currentTabIdValue)
      : null;
    if (
      (areaName === "local" && storageChanges.configs) ||
      (areaName === "session" &&
        currentTabId !== null &&
        (storageChanges[`${constants.TAB_STATE_PREFIX}${currentTabId}`] ||
          storageChanges[`${constants.DEVICE_EMULATION_PREFIX}${currentTabId}`] ||
          storageChanges[renderModeNoJsHeldStorageKey(currentTabId)]))
    ) {
      scheduleRefresh();
    }
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    if (
      state.currentTab &&
      sender &&
      sender.tab &&
      sender.tab.id &&
      sender.tab.id !== state.currentTab.id
    ) {
      return;
    }
    if (message && message.type === PROPERTY_LOCK_BACKGROUND_STATE_UPDATE) {
      if (!isPropertyLockCollaborationEnabled()) {
        resetDisabledPropertyLockState();
        setPropertyLockViewStateFromLocalProjection();
        return;
      }
      const messageSiteId = normalizeSiteIdValue(message.siteId);
      const messageTabId = Number.isFinite(message.tabId) ? Math.trunc(message.tabId) : null;
      const currentTabIdValue = state.currentTab?.id;
      const currentTabId = typeof currentTabIdValue === "number" && Number.isFinite(currentTabIdValue)
        ? Math.trunc(currentTabIdValue)
        : null;
      if (
        messageTabId !== null &&
        currentTabId !== null &&
        messageTabId !== currentTabId
      ) {
        return;
      }
      if (
        messageSiteId &&
        state.propertyLockSiteId &&
        messageSiteId !== state.propertyLockSiteId
      ) {
        return;
      }
      if (typeof message.clientId === "string" && message.clientId) {
        state.propertyLockClientId = message.clientId;
      }
      const applied = applyPropertyLockServerMessage(message.message || null, messageSiteId);
      if (applied) {
        setPropertyLockViewStateFromLocalProjection();
        if (message.message && message.message.type === PROPERTY_LOCK_WS_LOCK_STATE) {
          scheduleRefresh();
        }
      }
      return;
    }
    if (message && message.type === "aiPreviewClosed") {
      flushPendingAiPreviewConfigSync();
      applyPreviewClosedState(message).catch(() => {
        clearPreviewRestorePending();
        clearMarkingSessionSnapshot();
      });
      return;
    }
    if (message && message.type === "aiPreviewFocusChanged") {
      uiModule.setViewState({
        previewFocusedXpath: typeof message.xpath === "string" ? message.xpath : ""
      });
      return;
    }
    if (message && message.type === "aiPreviewStateChanged") {
      applyAiPreviewStateUpdate(message);
      return;
    }
    if (message && message.type === "inspectionSettled") {
      if (
        !state.currentBaseUrl ||
        typeof message.baseUrl !== "string" ||
        !message.baseUrl ||
        utils.sameBaseUrl(message.baseUrl, state.currentBaseUrl)
      ) {
        endNavigationInspectionOverlay();
        scheduleRefresh();
      }
      return;
    }
    if (message && message.type === "tokenInvalid") {
      void invalidateTokenAndLockConfiguration(true);
      return;
    }
    if (message && message.type === "pageTypesRefreshDue") {
      if (pageTypesRefreshRunner) {
        pageTypesRefreshRunner();
      }
      return;
    }
    if (!message || message.type !== "pageDraftChanged") {
      return;
    }
    if (state.currentBaseUrl && utils.sameBaseUrl(message.baseUrl, state.currentBaseUrl)) {
      scheduleRefresh();
    }
  });

  // Token validation cadence now lives in the background browser-alarms monitor
  // (suspension-safe, runs even when the popup is closed). The popup reacts to a
  // pushed `tokenInvalid` event via the runtime message handler above; on-demand
  // `validateStoredToken` calls remain for explicit user actions.

  await refreshUi({ useBusyOverlay: false });
}

init();
