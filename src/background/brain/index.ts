import { createBus } from "../../common/bus/bus";
import type { Browser } from "../../common/browser";
import { DIAGNOSTIC_REQUEST_TYPES } from "../../common/bus/contracts/index";
import { POPUP_STATE_EVENT_TYPES, POPUP_STATE_REQUEST_TYPES } from "../../common/bus/contracts/popup-state";
import {
  PROPERTY_LOCK_REPORT_TYPES,
  type PropertyLockSnapshot,
  type PropertyLockSnapshotLockState,
  type PropertyLockSnapshotReportedPayload,
} from "../../common/bus/contracts/property-lock-state";
import {
  AI_RUN_DEFAULT_TIMEOUT_MS,
  AI_RUN_EVENT_REASONS,
  AI_RUN_EVENT_TYPES,
  type AiRunEventPayload,
  type AiRunEventType
} from "../../common/bus/contracts/ai-run";
import {
  AI_RUN_PHASES,
  SESSION_REPORT_TYPES,
  type SessionFactsPatch,
  type SessionFactsReportedPayload
} from "../../common/bus/contracts/session-state";
import { SPINNER_EVENT_TYPES, type SpinnerSurface } from "../../common/bus/contracts/spinner";
import { REALMS } from "../../common/bus/realms";
import { createBackgroundTransport } from "../../common/bus/transport/background-transport";
import type { PopupSpinnerEntry } from "../../common/bus/contracts/popup-state";
import type { PopupBrokerState } from "../popup-state-broker";
import {
  SPINNER_KEYS,
  isCurtainBearingLifecycleKind,
  isLifecycleTerminalPhase,
} from "../../common/world-messaging-contract";
import {
  SPINNER_OPERATION_KINDS,
  SPINNER_OPERATION_PHASES,
  getSpinnerPhaseDefinition,
} from "../../common/spinner-contract";
import {
  PROPERTY_LOCK_CONNECTION_CONNECTING,
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
  PROPERTY_LOCK_STATE_EXPIRY_WARNING,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
  PROPERTY_LOCK_STATE_TRANSFER,
  PROPERTY_LOCK_STATE_UNLOCKED,
  createInactiveLockState,
} from "../../common/property-lock";
import { propertyLockText } from "../../common/text";
import {
  getActivationSnapshot as getActivationSnapshotValue,
  mirrorActivationLifecycle as mirrorActivationLifecycleState,
  updateActivationBootstrapState as updateActivationBootstrapStateValue,
} from "./deciders/activation-decider";
import { derivePropertyLockViewState } from "./deciders/property-lock-decider";
import { getPopupView, updatePopupViewFromBrokerState } from "./deciders/popup-state-decider";
import {
  getRenderModeSnapshot as getRenderModeSnapshotValue,
  recordInspectionResult as recordRenderModeInspectionValue,
  recordNoJsHoldState as recordRenderModeNoJsHoldValue,
} from "./deciders/render-mode-decider";
import { deriveSecondaryGatesViewState } from "./deciders/secondary-gates-decider";
import { updateSpinnerSelectionsFromQueue } from "./deciders/spinner-state-decider";
import { applySessionFactsPatch, buildSessionDictation } from "./deciders/session-phase-decider";
import { createStateStore, type SpinnerSelection, type TabLayerState } from "./state-store";
import { createBrainHeartbeat } from "./heartbeat";
import { projectSpinners, type SpinnerState } from "./spinner-authority";
import { projectViews } from "./view-projector";

const propertyLockDeciderDeps = {
  propertyLockText,
  PROPERTY_LOCK_CONNECTION_CONNECTING,
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
  PROPERTY_LOCK_STATE_UNLOCKED,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_EXPIRY_WARNING,
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
  PROPERTY_LOCK_STATE_TRANSFER
} as const;

function isNavigationInspectionSelection(selection: SpinnerSelection | null | undefined): boolean {
  return Boolean(
    selection &&
      (selection.spinnerKey === SPINNER_KEYS.NAV_INSPECT ||
        (selection.kind === SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP &&
          selection.phase === SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION))
  );
}

function clearNavigationInspectionCurtainDraft(draft: TabLayerState, now = Date.now()): void {
  const hadNavigationInspectionSpinner = Boolean(
    isNavigationInspectionSelection(draft.spinners.popup) ||
      isNavigationInspectionSelection(draft.spinners.pageCurtain)
  );
  draft.navigationInspectionCurtainClearBefore = Math.max(
    draft.navigationInspectionCurtainClearBefore,
    now,
  );
  if (isNavigationInspectionSelection(draft.spinners.popup)) {
    draft.spinners.popup = null;
  }
  if (isNavigationInspectionSelection(draft.spinners.pageCurtain)) {
    draft.spinners.pageCurtain = null;
  }
  if (
    draft.sessionFactsReported &&
    (hadNavigationInspectionSpinner ||
      draft.sessionFacts.navigationInspectionPending ||
      draft.sessionFacts.pageInspectionBusy)
  ) {
    draft.sessionFacts = {
      ...draft.sessionFacts,
      navigationInspectionPending: false,
      pageInspectionBusy: false,
      busyVisible: false,
      busyMessage: "",
      busyNote: "",
      busyTimerText: "",
    };
    draft.sessionDictation = buildSessionDictation(draft.sessionFacts);
    draft.secondaryGates = deriveSecondaryGatesViewState(draft.sessionFacts);
  }
}

function buildNavigationInspectionSelection(
  tabId: number,
  lifecycle: NonNullable<PopupBrokerState["lifecycle"]>,
  existing: SpinnerSelection | null | undefined,
): SpinnerSelection {
  const now = Date.now();
  const definition = getSpinnerPhaseDefinition(
    SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP,
    SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION,
  );
  const operationId = typeof lifecycle.operationId === "string" && lifecycle.operationId
    ? lifecycle.operationId
    : `${SPINNER_KEYS.NAV_INSPECT}:${tabId}:${now}`;
  const startedAt = existing && existing.operationId === operationId
    ? existing.startedAt
    : now;
  return {
    kind: SPINNER_OPERATION_KINDS.CONTENT_BOOTSTRAP,
    phase: SPINNER_OPERATION_PHASES.CONTENT_BOOTSTRAP.PAGE_INSPECTION,
    startedAt,
    deadlineAt: startedAt + (definition?.maxDurationMs ?? 120_000),
    operationId,
    message: typeof lifecycle.message === "string" ? lifecycle.message : "",
    reason: typeof lifecycle.reason === "string" && lifecycle.reason
      ? lifecycle.reason
      : `lifecycle:${typeof lifecycle.kind === "string" ? lifecycle.kind : "unknown"}`,
    source: typeof lifecycle.source === "string" && lifecycle.source
      ? lifecycle.source
      : "brain-lifecycle",
    spinnerKey: SPINNER_KEYS.NAV_INSPECT,
  };
}

function syncNavigationInspectionCurtainFromLifecycle(
  store: ReturnType<typeof createStateStore>,
  tabId: number,
  lifecycle: PopupBrokerState["lifecycle"],
  reason: string,
): void {
  if (!lifecycle || !isCurtainBearingLifecycleKind(lifecycle.kind)) {
    return;
  }
  const phase = typeof lifecycle.phase === "string" ? lifecycle.phase : "";
  if (isLifecycleTerminalPhase(phase)) {
    store.mutate(tabId, `${reason}:nav-inspect-terminal`, (draft) => {
      clearNavigationInspectionCurtainDraft(draft);
    });
    return;
  }
  if (lifecycle.busy !== true) {
    return;
  }
  store.mutate(tabId, `${reason}:nav-inspect-active`, (draft) => {
    const existing = isNavigationInspectionSelection(draft.spinners.pageCurtain)
      ? draft.spinners.pageCurtain
      : isNavigationInspectionSelection(draft.spinners.popup)
        ? draft.spinners.popup
        : null;
    const selection = buildNavigationInspectionSelection(tabId, lifecycle, existing);
    draft.navigationInspectionCurtainClearBefore = 0;
    draft.spinners.popup = selection;
    draft.spinners.pageCurtain = selection;
  });
}

function normalizeAiRunEventPayload(value: unknown): AiRunEventPayload {
  if (!value || typeof value !== "object") {
    return {};
  }
  const payload = value as Record<string, unknown>;
  return {
    tabId: Number.isFinite(payload.tabId) ? Math.trunc(Number(payload.tabId)) : undefined,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    deadlineAt: Number.isFinite(payload.deadlineAt) ? Math.max(0, Math.trunc(Number(payload.deadlineAt))) : undefined,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
  };
}

function updateAiRunStateFromEvent(
  state: TabLayerState["aiRun"],
  eventType: AiRunEventType,
  payload: AiRunEventPayload,
): void {
  const now = Date.now();
  state.lastEvent = eventType;
  state.sessionId = payload.sessionId ?? state.sessionId;
  state.reason = payload.reason ?? "";
  if (eventType === AI_RUN_EVENT_TYPES.STARTED) {
    state.active = true;
    state.phase = AI_RUN_PHASES.PRE_AI;
    state.leaseStartedAt = now;
    state.deadlineAt =
      typeof payload.deadlineAt === "number" && payload.deadlineAt > now
        ? payload.deadlineAt
        : now + AI_RUN_DEFAULT_TIMEOUT_MS;
    return;
  }
  state.active = false;
  state.deadlineAt = typeof payload.deadlineAt === "number" ? payload.deadlineAt : state.deadlineAt;
  if (
    eventType === AI_RUN_EVENT_TYPES.RESULTS_APPLIED &&
    payload.reason === AI_RUN_EVENT_REASONS.RESULTS_READY
  ) {
    state.phase = AI_RUN_PHASES.PRE_AI;
    return;
  }
  if (eventType === AI_RUN_EVENT_TYPES.PREVIEW_READY) {
    state.phase = AI_RUN_PHASES.AI_PREVIEW;
    return;
  }
  if (eventType === AI_RUN_EVENT_TYPES.RESULTS_APPLIED || eventType === AI_RUN_EVENT_TYPES.EXITED) {
    state.phase = AI_RUN_PHASES.POST_AI;
    return;
  }
  state.phase = AI_RUN_PHASES.PRE_AI;
}

function buildAiRunFactsPatch(eventType: AiRunEventType, payload: AiRunEventPayload): SessionFactsPatch {
  if (eventType === AI_RUN_EVENT_TYPES.STARTED) {
    return {
      aiBusy: true,
      aiComputing: true,
      aiRunPhase: AI_RUN_PHASES.PRE_AI,
      previewActive: false,
      previewBlocked: false,
      previewItemsPending: false,
      previewRestorePending: false,
      busyVisible: true,
      busyMessage: "Computing selectors",
      busyNote: "",
      busyTimerText: "",
    };
  }
  if (
    eventType === AI_RUN_EVENT_TYPES.RESULTS_APPLIED &&
    payload.reason === AI_RUN_EVENT_REASONS.RESULTS_READY
  ) {
    return {
      aiBusy: false,
      aiComputing: false,
      busyVisible: false,
      busyMessage: "",
      busyNote: "",
      busyTimerText: "",
    };
  }
  if (eventType === AI_RUN_EVENT_TYPES.PREVIEW_READY) {
    return {
      aiBusy: false,
      aiComputing: false,
      aiRunPhase: AI_RUN_PHASES.AI_PREVIEW,
      aiRunUpToDate: true,
      previewActive: true,
      previewBlocked: true,
      previewItemsPending: true,
      previewRestorePending: false,
      sessionRequiresAiRun: false,
      busyVisible: false,
      busyMessage: "",
      busyNote: "",
      busyTimerText: "",
    };
  }
  if (eventType === AI_RUN_EVENT_TYPES.RESULTS_APPLIED || eventType === AI_RUN_EVENT_TYPES.EXITED) {
    return {
      aiBusy: false,
      aiComputing: false,
      aiRunPhase: AI_RUN_PHASES.POST_AI,
      aiRunUpToDate: true,
      previewActive: false,
      previewBlocked: false,
      previewItemsPending: false,
      previewRestorePending: false,
      sessionRequiresAiRun: false,
      busyVisible: false,
      busyMessage: "",
      busyNote: "",
      busyTimerText: "",
    };
  }
  return {
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.PRE_AI,
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false,
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: "",
  };
}

function shouldKeepBrainAiRunAuthority(
  draft: TabLayerState,
  source: "popup" | "content",
  facts: SessionFactsReportedPayload["facts"],
): boolean {
  if (source !== "popup" || !draft.aiRun.lastEvent) {
    return false;
  }
  const reportedPreAi = facts.aiRunPhase === AI_RUN_PHASES.PRE_AI;
  const cleanReset = Boolean(
    reportedPreAi &&
      facts.sessionHasPendingChanges === false &&
      facts.currentDraftDirty === false &&
      facts.previewActive === false &&
      facts.previewBlocked === false,
  );
  return !cleanReset;
}

function omitPopupAiRunAuthorityFacts(
  facts: SessionFactsReportedPayload["facts"],
): SessionFactsPatch {
  const {
    aiBusy: _aiBusy,
    aiComputing: _aiComputing,
    aiRunPhase: _aiRunPhase,
    aiRunUpToDate: _aiRunUpToDate,
    sessionRequiresAiRun: _sessionRequiresAiRun,
    ...rest
  } = facts;
  return rest;
}

function normalizePropertyLockSnapshotLockState(
  value: PropertyLockSnapshot["lockState"]
) {
  const defaultLockState = createInactiveLockState();
  if (!value) {
    return defaultLockState;
  }
  const lockState = value as PropertyLockSnapshotLockState;
  return {
    ...defaultLockState,
    state: typeof lockState.state === "string" ? lockState.state : defaultLockState.state,
    editorName: typeof lockState.editorName === "string" ? lockState.editorName : "",
    isEditor: lockState.isEditor === true,
    isRecentEditor: lockState.isRecentEditor === true,
    isSameUserEditor: lockState.isSameUserEditor === true,
    otherTabHasUnsavedChanges: lockState.otherTabHasUnsavedChanges === true,
    transferFromName: typeof lockState.transferFromName === "string" ? lockState.transferFromName : "",
    transferToName: typeof lockState.transferToName === "string" ? lockState.transferToName : "",
  };
}

function normalizePropertyLockSnapshot(value: unknown): PropertyLockSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const snapshot = value as Record<string, unknown>;
  return {
    siteId: Number.isFinite(snapshot.siteId) ? Math.trunc(Number(snapshot.siteId)) : null,
    connectionStatus: typeof snapshot.connectionStatus === "string" ? snapshot.connectionStatus : "",
    secondsRemaining: Number.isFinite(snapshot.secondsRemaining) ? Math.max(0, Math.trunc(Number(snapshot.secondsRemaining))) : null,
    suggestionFromName: typeof snapshot.suggestionFromName === "string" ? snapshot.suggestionFromName : "",
    suggestionVisible: snapshot.suggestionVisible === true,
    suggestionPending: snapshot.suggestionPending === true,
    suggestionRejected: snapshot.suggestionRejected === true,
    inactivityWarningVisible: snapshot.inactivityWarningVisible === true,
    disconnectCountdown: Number.isFinite(snapshot.disconnectCountdown) ? Math.max(0, Math.trunc(Number(snapshot.disconnectCountdown))) : null,
    transferCountdown: Number.isFinite(snapshot.transferCountdown) ? Math.max(0, Math.trunc(Number(snapshot.transferCountdown))) : null,
    offCandidateDeadlineAt: Number.isFinite(snapshot.offCandidateDeadlineAt) ? Math.max(0, Math.trunc(Number(snapshot.offCandidateDeadlineAt))) : 0,
    recoveryDeadlineAt: Number.isFinite(snapshot.recoveryDeadlineAt) ? Math.max(0, Math.trunc(Number(snapshot.recoveryDeadlineAt))) : 0,
    renderModeInspectionActive: snapshot.renderModeInspectionActive === true,
    lockState: snapshot.lockState && typeof snapshot.lockState === "object"
      ? {
        state: typeof (snapshot.lockState as Record<string, unknown>).state === "string"
          ? String((snapshot.lockState as Record<string, unknown>).state)
          : "",
        editorName: typeof (snapshot.lockState as Record<string, unknown>).editorName === "string"
          ? String((snapshot.lockState as Record<string, unknown>).editorName)
          : "",
        isEditor: (snapshot.lockState as Record<string, unknown>).isEditor === true,
        isRecentEditor: (snapshot.lockState as Record<string, unknown>).isRecentEditor === true,
        isSameUserEditor: (snapshot.lockState as Record<string, unknown>).isSameUserEditor === true,
        otherTabHasUnsavedChanges: (snapshot.lockState as Record<string, unknown>).otherTabHasUnsavedChanges === true,
        transferFromName: typeof (snapshot.lockState as Record<string, unknown>).transferFromName === "string"
          ? String((snapshot.lockState as Record<string, unknown>).transferFromName)
          : "",
        transferToName: typeof (snapshot.lockState as Record<string, unknown>).transferToName === "string"
          ? String((snapshot.lockState as Record<string, unknown>).transferToName)
          : ""
      }
      : null,
  };
}

function publishSpinnerSurface(
  bus: ReturnType<typeof createBus>,
  tabId: number,
  surface: SpinnerSurface,
  state: SpinnerState | null,
): void {
  const eventType = state ? SPINNER_EVENT_TYPES.SET : SPINNER_EVENT_TYPES.CLEAR;
  const payload = state
    ? { surface, state }
    : { surface };
  const targets = surface === "popup"
    ? [REALMS.POPUP]
    : [REALMS.CONTENT, REALMS.POPUP];
  for (const target of targets) {
    void bus.publish(eventType, payload, { target, tab: tabId });
  }
}

function publishProjectedState(
  bus: ReturnType<typeof createBus>,
  tabId: number,
  state: TabLayerState,
): void {
  const { popupView, contentDirective } = projectViews(state);
  const spinners = projectSpinners(state);

  void bus.publish(POPUP_STATE_EVENT_TYPES.VIEW_UPDATED, popupView, { target: REALMS.POPUP, tab: tabId });
  void bus.publish("directive.content", contentDirective, { target: REALMS.CONTENT, tab: tabId });
  publishSpinnerSurface(bus, tabId, "popup", spinners.popup);
  publishSpinnerSurface(bus, tabId, "pageCurtain", spinners.pageCurtain);
  publishSpinnerSurface(bus, tabId, "banner", spinners.banner);
}

export function createBrain(options: { logger?: Pick<Console, "error" | "debug"> } = {}) {
  const transport = createBackgroundTransport();
  const bus = createBus({
    realm: REALMS.BACKGROUND,
    transport,
    logger: options.logger || console,
  });
  const store = createStateStore();

  transport.start();
  store.onProjection((tabId, state) => {
    publishProjectedState(bus, tabId, state);
  });

  bus.registerHandler(DIAGNOSTIC_REQUEST_TYPES.PING, (payload: { nonce: string }) => ({
    nonce: payload.nonce,
    realm: REALMS.BACKGROUND,
  }));
  bus.registerHandler(POPUP_STATE_REQUEST_TYPES.GET, (_payload: Record<never, never>, meta) => {
    if (!meta.tab) {
      throw new Error("popup.view.get requires a tab id");
    }
    return getPopupView(store, meta.tab);
  });
  function foldSessionFacts(
    tabId: number,
    source: "popup" | "content",
    facts: SessionFactsReportedPayload["facts"],
    reason: string,
  ): void {
    store.mutate(tabId, reason, (draft) => {
      const nextFacts = shouldKeepBrainAiRunAuthority(draft, source, facts)
        ? omitPopupAiRunAuthorityFacts(facts)
        : facts;
      const wasNavigationInspectionPending = draft.sessionFacts.navigationInspectionPending;
      const wasPageInspectionBusy = draft.sessionFacts.pageInspectionBusy;
      const next = applySessionFactsPatch(draft.sessionFacts, nextFacts);
      draft.sessionFactsReported = true;
      draft.sessionFacts = next.facts;
      draft.sessionDictation = next.dictation;
      draft.secondaryGates = deriveSecondaryGatesViewState(next.facts);
      const navigationInspectionSettled =
        nextFacts.navigationInspectionPending === false &&
        wasNavigationInspectionPending;
      const pageInspectionSettled =
        nextFacts.pageInspectionBusy === false &&
        wasPageInspectionBusy;
      if (
        (navigationInspectionSettled || pageInspectionSettled) &&
        !next.facts.navigationInspectionPending &&
        !next.facts.pageInspectionBusy
      ) {
        clearNavigationInspectionCurtainDraft(draft);
      }
    });
  }
  function foldAiRunEvent(
    tabId: number,
    eventType: AiRunEventType,
    payload: AiRunEventPayload,
    reason: string,
  ): void {
    store.mutate(tabId, reason, (draft) => {
      updateAiRunStateFromEvent(draft.aiRun, eventType, payload);
      const next = applySessionFactsPatch(
        draft.sessionFacts,
        buildAiRunFactsPatch(eventType, payload),
        { aiRunState: draft.aiRun },
      );
      draft.sessionFactsReported = true;
      draft.sessionFacts = next.facts;
      draft.sessionDictation = next.dictation;
      draft.secondaryGates = deriveSecondaryGatesViewState(next.facts);
    });
  }
  bus.subscribe(SESSION_REPORT_TYPES.FACTS_REPORTED, (payload, meta) => {
    if (!meta.tab || !payload || typeof payload !== "object") {
      return;
    }
    const typedPayload = payload as SessionFactsReportedPayload;
    const source = typedPayload.source === "content" ? "content" : "popup";
    const facts = typedPayload.facts && typeof typedPayload.facts === "object"
      ? typedPayload.facts
      : {};
    foldSessionFacts(meta.tab, source, facts, `session-facts:${source}`);
  });
  for (const eventType of Object.values(AI_RUN_EVENT_TYPES)) {
    bus.subscribe(eventType, (payload, meta) => {
      const eventPayload = normalizeAiRunEventPayload(payload);
      const tabId = meta.tab || eventPayload.tabId || null;
      if (!tabId) {
        return;
      }
      foldAiRunEvent(tabId, eventType, eventPayload, `ai-run:${eventType}`);
    });
  }
  const heartbeat = createBrainHeartbeat({
    request: (type, payload, opts) => bus.request(type, payload, opts),
    foldFacts: (tabId, source, facts, reason) => foldSessionFacts(tabId, source, facts, reason),
  });
  const popupPortCounts = new Map<number, number>();
  bus.subscribe(PROPERTY_LOCK_REPORT_TYPES.SNAPSHOT_REPORTED, (payload, meta) => {
    if (!meta.tab || !payload || typeof payload !== "object") {
      return;
    }
    const typedPayload = payload as PropertyLockSnapshotReportedPayload;
    const snapshot = normalizePropertyLockSnapshot(typedPayload.snapshot);
    store.mutate(meta.tab, "property-lock-snapshot:popup", (draft) => {
      if (!snapshot) {
        draft.propertyLockView = null;
        draft.propertyLockTimer = null;
        return;
      }
      const next = derivePropertyLockViewState(
        propertyLockDeciderDeps,
        {
          propertyLockFeatureEnabled: true,
          propertyLockSiteId: snapshot.siteId,
          lockState: normalizePropertyLockSnapshotLockState(snapshot.lockState),
          propertyLockConnectionStatus: snapshot.connectionStatus,
          propertyLockSecondsRemaining: snapshot.secondsRemaining,
          propertyLockSuggestionFromName: snapshot.suggestionFromName,
          propertyLockSuggestionVisible: snapshot.suggestionVisible,
          propertyLockSuggestionPending: snapshot.suggestionPending,
          propertyLockSuggestionRejected: snapshot.suggestionRejected,
          propertyLockInactivityWarningVisible: snapshot.inactivityWarningVisible,
          propertyLockDisconnectCountdown: snapshot.disconnectCountdown,
          propertyLockTransferCountdown: snapshot.transferCountdown,
          propertyLockOffCandidateDeadlineAt: snapshot.offCandidateDeadlineAt,
          propertyLockRecoveryDeadlineAt: snapshot.recoveryDeadlineAt,
          renderModeInspectionActive: snapshot.renderModeInspectionActive,
          now: Date.now()
        }
      );
      draft.propertyLockView = next.viewState;
      draft.propertyLockTimer = next.timerState;
    });
  });

  return {
    bus,
    store,
    transport,
    getPopupView(tabId: number) {
      return getPopupView(store, tabId);
    },
    mirrorPopupState(tabId: number, brokerState: PopupBrokerState, reason: string) {
      const view = updatePopupViewFromBrokerState(store, tabId, brokerState, reason);
      syncNavigationInspectionCurtainFromLifecycle(store, tabId, brokerState.lifecycle, reason);
      return view;
    },
    mirrorActivationLifecycle(tabId: number, lifecycle: PopupBrokerState["lifecycle"], reason: string) {
      if (!lifecycle) {
        return null;
      }
      const snapshot = mirrorActivationLifecycleState(store, tabId, lifecycle, reason);
      syncNavigationInspectionCurtainFromLifecycle(store, tabId, lifecycle, reason);
      return snapshot;
    },
    updateActivationBootstrapState(
      tabId: number,
      patch: Parameters<typeof updateActivationBootstrapStateValue>[2],
      reason: string,
    ) {
      return updateActivationBootstrapStateValue(store, tabId, patch, reason);
    },
    getActivationSnapshot(tabId: number) {
      return getActivationSnapshotValue(store, tabId);
    },
    recordRenderModeInspection(
      tabId: number,
      patch: Parameters<typeof recordRenderModeInspectionValue>[2],
      reason: string,
    ) {
      return recordRenderModeInspectionValue(store, tabId, patch, reason);
    },
    recordRenderModeNoJsHold(
      tabId: number,
      patch: Parameters<typeof recordRenderModeNoJsHoldValue>[2],
      reason: string,
    ) {
      return recordRenderModeNoJsHoldValue(store, tabId, patch, reason);
    },
    getRenderModeSnapshot(tabId: number) {
      return getRenderModeSnapshotValue(store, tabId);
    },
    syncProjectedSpinnerQueue(tabId: number, queue: readonly PopupSpinnerEntry[], reason: string) {
      return updateSpinnerSelectionsFromQueue(store, tabId, queue, reason);
    },
    registerPopupPort(tabId: number, port: Browser.runtime.Port): void {
      transport.registerPopupPort(tabId, port);
      popupPortCounts.set(tabId, (popupPortCounts.get(tabId) ?? 0) + 1);
      heartbeat.start(tabId);
      const state = store.get(tabId);
      if (state) {
        publishProjectedState(bus, tabId, state);
      } else {
        publishSpinnerSurface(bus, tabId, "popup", null);
        publishSpinnerSurface(bus, tabId, "pageCurtain", null);
        publishSpinnerSurface(bus, tabId, "banner", null);
      }
      port.onDisconnect.addListener(() => {
        const remaining = (popupPortCounts.get(tabId) ?? 1) - 1;
        if (remaining <= 0) {
          popupPortCounts.delete(tabId);
          heartbeat.stop(tabId);
        } else {
          popupPortCounts.set(tabId, remaining);
        }
      });
    },
    heartbeat,
  };
}
