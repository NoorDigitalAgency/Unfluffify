import * as stateModule from "./state";
import { derivePropertyLockViewState } from "../background/brain/deciders/property-lock-decider";
import {
  PROPERTY_LOCK_TIMER_SOURCES,
  type PropertyLockViewState,
} from "../common/bus/contracts/property-lock-state";

const { state } = stateModule;

type NormalizedLockState = ReturnType<typeof import("../common/property-lock").createInactiveLockState>;

interface PropertyLockFetchResult {
  state?: unknown;
  connectionStatus?: string;
  error?: string;
  identity?: string;
  name?: string;
  clientId?: string;
  [key: string]: unknown;
}

interface PropertyLockUiDeps {
  isFeatureEnabled: typeof import("../common/feature-flags").isFeatureEnabled;
  FEATURE_DISABLED_REASON: string;
  propertyLockText: typeof import("../common/text").propertyLockText;
  createInactiveLockState: typeof import("../common/property-lock").createInactiveLockState;
  normalizeLockStateMessage: typeof import("../common/property-lock").normalizeLockStateMessage;
  normalizeSiteIdValue: typeof import("../common/lynx-live-pages").normalizeSiteIdValue;
  PROPERTY_LOCK_BACKGROUND_GET_STATE: string;
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS: string;
  PROPERTY_LOCK_CONNECTION_INACTIVE: string;
  PROPERTY_LOCK_CONNECTION_CONNECTING: string;
  PROPERTY_LOCK_CONNECTION_CONNECTED: string;
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE: string;
  PROPERTY_LOCK_WS_LOCK_STATE: string;
  PROPERTY_LOCK_WS_DISCONNECT_WARNING: string;
  PROPERTY_LOCK_WS_INACTIVITY_WARNING: string;
  PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION: string;
  PROPERTY_LOCK_WS_SUGGESTION_PENDING: string;
  PROPERTY_LOCK_WS_SUGGESTION_RESPONSE: string;
  PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED: string;
  PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN: string;
  PROPERTY_LOCK_WS_ERROR: string;
  PROPERTY_LOCK_STATE_UNLOCKED: string;
  PROPERTY_LOCK_STATE_LOCKED: string;
  PROPERTY_LOCK_STATE_EXPIRY_WARNING: string;
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE: string;
  PROPERTY_LOCK_STATE_TRANSFER: string;
  windowRef: Window;
  refreshUi(...args: unknown[]): Promise<unknown>;
  setTabState(...args: unknown[]): Promise<unknown>;
  sendRuntimeMessage(message: Record<string, unknown>): Promise<unknown>;
  showToast(message: string): void;
  setViewState(viewState: PropertyLockViewState): void;
  refreshCurrentPageRuntimeStatus(...args: unknown[]): Promise<unknown>;
  isPropertyLockCollaborationEnabled(): boolean;
  resetPropertyLockState(): void;
  clearPropertyLockTransientState(): void;
  clearPropertyLockOffCandidateRefreshTimer(): void;
  resetDisabledPropertyLockState(): void;
  applyPropertyLockState(lockStateLike: unknown): void;
  queueEditorBootstrapOnLockTransition(
    previousLockState: NormalizedLockState | null,
    nextLockState: NormalizedLockState | null
  ): void;
  applyPropertyLockConnectionStatus(status: string | null | undefined, error?: string | null | undefined): void;
  fetchPropertyLockState(siteId: number | string | null): Promise<unknown>;
  refreshPropertyLockSnapshot(siteId: number | string | null, options?: Record<string, unknown>): Promise<unknown>;
  buildPropertyLockViewState(): PropertyLockViewState;
}

export function isPropertyLockCollaborationEnabled(deps: PropertyLockUiDeps) {
  return deps.isFeatureEnabled("propertyLockCollaboration");
}

export function resetDisabledPropertyLockState(deps: PropertyLockUiDeps) {
  deps.clearPropertyLockOffCandidateRefreshTimer();
  deps.resetPropertyLockState();
  state.propertyLockState = deps.createInactiveLockState();
  state.propertyLockEditorBootstrapPending = false;
}

export function resetPropertyLockState(deps: PropertyLockUiDeps) {
  state.propertyLockSiteId = null;
  state.propertyLockState = null;
  state.propertyLockConnectionStatus = deps.PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = "";
  state.propertyLockIdentity = "";
  state.propertyLockName = "";
  state.propertyLockClientId = "";
  state.propertyLockSecondsRemaining = null;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionPending = false;
  state.propertyLockSuggestionRejected = false;
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockDisconnectCountdown = null;
  state.propertyLockTransferCountdown = null;
  state.propertyLockOffCandidateDeadlineAt = 0;
  state.propertyLockRecoverySiteId = null;
  state.propertyLockRecoveryBaseUrl = "";
  state.propertyLockRecoveryClientId = "";
  state.propertyLockRecoveryDeadlineAt = 0;
  state.propertyLockEditorBootstrapPending = false;
}

export function clearPropertyLockTransientState() {
  state.propertyLockSecondsRemaining = null;
  state.propertyLockSuggestionId = "";
  state.propertyLockSuggestionFromName = "";
  state.propertyLockSuggestionVisible = false;
  state.propertyLockSuggestionPending = false;
  state.propertyLockSuggestionRejected = false;
  state.propertyLockInactivityWarningVisible = false;
  state.propertyLockDisconnectCountdown = null;
  state.propertyLockTransferCountdown = null;
  state.propertyLockOffCandidateDeadlineAt = 0;
}

export function clearPropertyLockOffCandidateRefreshTimer(deps: PropertyLockUiDeps) {
  if (!state.propertyLockOffCandidateRefreshTimer) {
    return;
  }
  deps.windowRef.clearInterval(state.propertyLockOffCandidateRefreshTimer);
  state.propertyLockOffCandidateRefreshTimer = 0;
}

export function syncPropertyLockOffCandidateRefreshTimer(deps: PropertyLockUiDeps, active: boolean | null | undefined) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.clearPropertyLockOffCandidateRefreshTimer();
    return;
  }
  if (!active) {
    deps.clearPropertyLockOffCandidateRefreshTimer();
    return;
  }
  if (state.propertyLockOffCandidateRefreshTimer) {
    return;
  }
  state.propertyLockOffCandidateRefreshTimer = deps.windowRef.setInterval(() => {
    const projection = buildPropertyLockViewProjection(deps);
    const hasActiveDeadlineTimer = Boolean(
      projection.timerState &&
        projection.timerState.source === PROPERTY_LOCK_TIMER_SOURCES.DEADLINE &&
        projection.timerState.deadlineAt > Date.now()
    );
    deps.setViewState(projection.viewState);
    if (!hasActiveDeadlineTimer) {
      deps.clearPropertyLockOffCandidateRefreshTimer();
      deps.refreshUi({ useBusyOverlay: false, skipPropertyLockFetch: true }).catch(() => {});
      return;
    }
  }, 1000);
}

function buildPropertyLockViewProjection(deps: PropertyLockUiDeps) {
  const propertyLockFeatureEnabled = deps.isPropertyLockCollaborationEnabled();
  const lockState: NormalizedLockState = propertyLockFeatureEnabled
    ? ((state.propertyLockState as NormalizedLockState | null) || deps.createInactiveLockState())
    : deps.createInactiveLockState();
  return derivePropertyLockViewState(
    deps,
    {
      propertyLockFeatureEnabled,
      propertyLockSiteId: state.propertyLockSiteId,
      lockState,
      propertyLockConnectionStatus: state.propertyLockConnectionStatus,
      propertyLockSecondsRemaining: state.propertyLockSecondsRemaining,
      propertyLockSuggestionFromName: state.propertyLockSuggestionFromName,
      propertyLockSuggestionVisible: state.propertyLockSuggestionVisible,
      propertyLockSuggestionPending: state.propertyLockSuggestionPending,
      propertyLockSuggestionRejected: state.propertyLockSuggestionRejected,
      propertyLockInactivityWarningVisible: state.propertyLockInactivityWarningVisible,
      propertyLockDisconnectCountdown: state.propertyLockDisconnectCountdown,
      propertyLockTransferCountdown: state.propertyLockTransferCountdown,
      propertyLockOffCandidateDeadlineAt: state.propertyLockOffCandidateDeadlineAt,
      propertyLockRecoveryDeadlineAt: state.propertyLockRecoveryDeadlineAt,
      renderModeInspectionActive: state.renderModeInspectionActive,
      now: Date.now()
    }
  );
}

export async function persistPropertyLockRecoveryMetadata(deps: PropertyLockUiDeps, tabId: number | null | undefined, recoveryState: Record<string, unknown> = {}) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return;
  }
  if (!Number.isFinite(tabId)) {
    return;
  }
  await deps.setTabState(tabId, {
    active: true,
    propertyLockRecoverySiteId: Number.isFinite(recoveryState.siteId)
      ? Number(recoveryState.siteId)
      : null,
    propertyLockRecoveryBaseUrl: typeof recoveryState.baseUrl === "string"
      ? recoveryState.baseUrl
      : "",
    propertyLockRecoveryClientId: typeof recoveryState.clientId === "string"
      ? recoveryState.clientId
      : "",
    propertyLockRecoveryDeadlineAt: Number.isFinite(recoveryState.deadlineAt)
      ? Number(recoveryState.deadlineAt)
      : 0
  }, "initial");
}

export function applyPropertyLockState(deps: PropertyLockUiDeps, lockStateLike: unknown) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    return;
  }
  state.propertyLockState = deps.normalizeLockStateMessage(
    lockStateLike || deps.createInactiveLockState(),
    {
      ownIdentity: state.propertyLockIdentity,
      clientId: state.propertyLockClientId
    }
  );
  deps.clearPropertyLockTransientState();
}

export function queueEditorBootstrapOnLockTransition(deps: PropertyLockUiDeps, previousLockState: NormalizedLockState | null, nextLockState: NormalizedLockState | null) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return;
  }
  if (
    previousLockState &&
    !previousLockState.isEditor &&
    nextLockState &&
    nextLockState.isEditor
  ) {
    state.propertyLockEditorBootstrapPending = true;
  }
}

export function applyPropertyLockConnectionStatus(deps: PropertyLockUiDeps, status: string | null | undefined, error: string | null | undefined = "") {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    state.propertyLockConnectionStatus = deps.PROPERTY_LOCK_CONNECTION_INACTIVE;
    state.propertyLockConnectionError = "";
    return;
  }
  state.propertyLockConnectionStatus = typeof status === "string" && status
    ? status
    : deps.PROPERTY_LOCK_CONNECTION_INACTIVE;
  state.propertyLockConnectionError = typeof error === "string" ? error : "";
}

export function applyPropertyLockServerMessage(deps: PropertyLockUiDeps, serverMessage: Record<string, unknown>, siteId: number | string | null = null) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    return false;
  }
  if (!serverMessage || typeof serverMessage !== "object") {
    return false;
  }

  const resolvedSiteId = deps.normalizeSiteIdValue(siteId || state.propertyLockSiteId);
  if (resolvedSiteId) {
    state.propertyLockSiteId = resolvedSiteId;
  }

  const type = typeof serverMessage.type === "string"
    ? serverMessage.type
    : deps.PROPERTY_LOCK_WS_LOCK_STATE;
  const secondsRemaining = typeof serverMessage.secondsRemaining === "number"
    ? Math.max(0, Math.ceil(serverMessage.secondsRemaining))
    : null;

  if (type === deps.PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS) {
    deps.applyPropertyLockConnectionStatus(
      typeof serverMessage.connectionStatus === "string" ? serverMessage.connectionStatus : null,
      typeof serverMessage.error === "string" ? serverMessage.error : null
    );
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_LOCK_STATE || !serverMessage.type) {
    const previousLockState = state.propertyLockState as NormalizedLockState | null;
    deps.applyPropertyLockState(serverMessage);
    deps.queueEditorBootstrapOnLockTransition(previousLockState, state.propertyLockState as NormalizedLockState | null);
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_DISCONNECT_WARNING) {
    state.propertyLockDisconnectCountdown = secondsRemaining;
    state.propertyLockSecondsRemaining = secondsRemaining;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_INACTIVITY_WARNING) {
    state.propertyLockInactivityWarningVisible = true;
    state.propertyLockSecondsRemaining = secondsRemaining;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION) {
    state.propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    state.propertyLockSuggestionFromName = String(serverMessage.fromName || "");
    state.propertyLockSuggestionVisible = Boolean(state.propertyLockSuggestionId);
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_SUGGESTION_PENDING) {
    state.propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    state.propertyLockSuggestionPending = Boolean(state.propertyLockSuggestionId);
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_SUGGESTION_RESPONSE) {
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = serverMessage.accepted === false;
    return true;
  }

  if (
    type === deps.PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED ||
    type === deps.PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN
  ) {
    state.propertyLockState = {
      ...(state.propertyLockState || deps.createInactiveLockState()),
      transferFromName: String(
        serverMessage.transferFromName ||
        serverMessage.fromName ||
          state.propertyLockState?.transferFromName ||
        ""
      ),
      transferToName: String(
        serverMessage.transferToName ||
        serverMessage.toName ||
          state.propertyLockState?.transferToName ||
        state.propertyLockSuggestionFromName ||
        ""
      )
    };
    state.propertyLockTransferCountdown = secondsRemaining;
    state.propertyLockSecondsRemaining = secondsRemaining;
    state.propertyLockSuggestionVisible = false;
    state.propertyLockSuggestionPending = false;
    state.propertyLockSuggestionRejected = false;
    return true;
  }

  if (type === deps.PROPERTY_LOCK_WS_ERROR) {
    deps.showToast(String(serverMessage.reason || "Property lock request failed"));
    return false;
  }

  return false;
}

export function isPropertyLockBlockingEditing(deps: PropertyLockUiDeps) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return false;
  }
  const lockState: NormalizedLockState | null = state.propertyLockState as NormalizedLockState | null;
  if (
    state.propertyLockSiteId &&
    state.propertyLockConnectionStatus === deps.PROPERTY_LOCK_CONNECTION_UNAVAILABLE
  ) {
    return true;
  }
  return Boolean(
    lockState &&
      !lockState.isEditor &&
      lockState.state !== deps.PROPERTY_LOCK_STATE_UNLOCKED
  );
}

export function buildPropertyLockViewState(deps: PropertyLockUiDeps) {
  return buildPropertyLockViewProjection(deps).viewState;
}

export async function fetchPropertyLockState(deps: PropertyLockUiDeps, siteId: number | string | null) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return {
      state: deps.createInactiveLockState(),
      connectionStatus: deps.PROPERTY_LOCK_CONNECTION_INACTIVE,
      error: deps.FEATURE_DISABLED_REASON
    };
  }
  const normalizedSiteId = deps.normalizeSiteIdValue(siteId);
  if (!normalizedSiteId) {
    return null;
  }
  const clientIdHint = state.propertyLockSiteId === normalizedSiteId
    ? state.propertyLockClientId
    : (
      state.propertyLockRecoverySiteId === normalizedSiteId
        ? state.propertyLockRecoveryClientId
        : ""
    );

  const currentTab = state.currentTab;
  try {
    return await deps.sendRuntimeMessage({
      type: deps.PROPERTY_LOCK_BACKGROUND_GET_STATE,
      siteId: normalizedSiteId,
      clientId: clientIdHint || "",
      tabId: currentTab && Number.isFinite(currentTab.id)
        ? Math.trunc(currentTab.id as number)
        : null
    });
  } catch {
    return {
      state: deps.createInactiveLockState(),
      connectionStatus: deps.PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
      error: "background_unavailable"
    };
  }
}

export async function refreshPropertyLockSnapshot(deps: PropertyLockUiDeps, siteId: number | string | null, options: Record<string, unknown> = {}) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    return deps.createInactiveLockState();
  }
  const { skipFetch = false } = options;
  const normalizedSiteId = deps.normalizeSiteIdValue(siteId);
  if (!normalizedSiteId) {
    deps.resetPropertyLockState();
    return deps.createInactiveLockState();
  }

  if (state.propertyLockSiteId !== normalizedSiteId) {
    deps.resetPropertyLockState();
    state.propertyLockSiteId = normalizedSiteId;
  }

  if (skipFetch && state.propertyLockState) {
    return state.propertyLockState;
  }

  const previousLockState: NormalizedLockState | null = state.propertyLockState as NormalizedLockState | null;
  const lockResponse = await deps.fetchPropertyLockState(normalizedSiteId) as PropertyLockFetchResult | null;
  state.propertyLockIdentity = (lockResponse && lockResponse.identity) || "";
  state.propertyLockName = (lockResponse && lockResponse.name) || "";
  state.propertyLockClientId = (lockResponse && lockResponse.clientId) || "";
  const nextLockState: NormalizedLockState = deps.normalizeLockStateMessage(
    lockResponse && lockResponse.state ? lockResponse.state : deps.createInactiveLockState(),
    {
      ownIdentity: state.propertyLockIdentity,
      clientId: state.propertyLockClientId
    }
  );
  deps.queueEditorBootstrapOnLockTransition(previousLockState, nextLockState);
  if (
    !previousLockState ||
    previousLockState.state !== nextLockState.state ||
    previousLockState.isEditor !== nextLockState.isEditor ||
    previousLockState.editorIdentity !== nextLockState.editorIdentity
  ) {
    deps.clearPropertyLockTransientState();
  }
  state.propertyLockState = nextLockState;
  deps.applyPropertyLockConnectionStatus(
    lockResponse && lockResponse.connectionStatus
      ? lockResponse.connectionStatus
      : deps.PROPERTY_LOCK_CONNECTION_CONNECTED,
    lockResponse && lockResponse.error ? lockResponse.error : ""
  );
  return nextLockState;
}

export async function sendPropertyLockCommand(deps: PropertyLockUiDeps, type: string, payload: Record<string, unknown> = {}) {
  if (!deps.isPropertyLockCollaborationEnabled()) {
    return {
      ok: false,
      reason: deps.FEATURE_DISABLED_REASON,
      feature: "propertyLockCollaboration"
    };
  }
  const siteId = deps.normalizeSiteIdValue(state.propertyLockSiteId);
  if (!siteId) {
    return { ok: false };
  }

  await deps.refreshCurrentPageRuntimeStatus().catch(() => null);

  const currentTab = state.currentTab;
  try {
    return await deps.sendRuntimeMessage({
      type,
      siteId,
      clientId: state.propertyLockClientId || "",
      tabId: currentTab && Number.isFinite(currentTab.id)
        ? Math.trunc(currentTab.id as number)
        : null,
      hasUnsavedChanges: Boolean(state.currentDraftDirty || state.currentPageSaveReconciliationPending),
      ...payload
    });
  } catch {
    return { ok: false };
  }
}

export async function reconcilePropertyLockAfterCommand(deps: PropertyLockUiDeps, options: Record<string, unknown> = {}) {
  const { useBusyOverlay = false } = options;
  if (!deps.isPropertyLockCollaborationEnabled()) {
    deps.resetDisabledPropertyLockState();
    await deps.refreshUi({ useBusyOverlay });
    return;
  }
  const siteId = deps.normalizeSiteIdValue(state.propertyLockSiteId);
  if (siteId) {
    await deps.refreshPropertyLockSnapshot(siteId).catch(() => null);
    deps.setViewState(deps.buildPropertyLockViewState());
  }
  await deps.refreshUi({ useBusyOverlay });
}
