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
  SESSION_REQUEST_TYPES,
  type SessionFactsPatch,
  type SessionFactsApplyPayload,
  type SessionFactsReportedPayload
} from "../../common/bus/contracts/session-state";
import { SPINNER_EVENT_TYPES, type SpinnerSurface } from "../../common/bus/contracts/spinner";
import {
  SIGNAL_EVENT_TYPES,
  SIGNAL_NAMES,
  SIGNAL_REQUEST_TYPES,
  type SignalEmitPayload,
  type SignalEmitReply,
  type SignalFrame,
  type SignalPullPayload,
  type SignalPullReply,
} from "../../common/bus/contracts/signals";
import { createSignalLog } from "./signal-log";
import { loadPersistedSignalLog, persistSignalLog } from "./signal-log-persistence";
import { REALMS, type Realm } from "../../common/bus/realms";
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
import { wrapMutateWithSessionSignalEdges } from "./session-signal-edges";
import { persistTabStates, loadPersistedTabStates } from "./state-store-persistence";
import { traceBrainProject } from "../../common/layer-trace";
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
    origin: typeof payload.origin === "string" ? payload.origin : undefined,
  };
}

// REFLEX-ARC Phase 1: every discrete ai-run lifecycle event doubles as a
// signal-frame emission (the run/preview signals of the plan vocabulary are
// born here — the ONE choke point all run events already flow through).
function mapAiRunEventToSignalEmit(
  eventType: AiRunEventType,
  payload: AiRunEventPayload,
): SignalEmitPayload | null {
  // Run lifecycle signals are once-per-session: multiple layers republish the
  // same ai-run event (live P1 trace: RESULTS_APPLIED admitted twice, >250ms
  // apart), so the session id is the dedupe key.
  if (eventType === AI_RUN_EVENT_TYPES.STARTED) {
    return {
      name: SIGNAL_NAMES.RUN_STARTED,
      source: "brain",
      cause: "ai-run.started",
      payload: {
        sessionId: payload.sessionId ?? "",
        deadlineAt: payload.deadlineAt ?? 0,
      },
      dedupeKey: payload.sessionId ? `session:${payload.sessionId}` : "",
    };
  }
  if (eventType === AI_RUN_EVENT_TYPES.RESULTS_APPLIED) {
    return {
      name: SIGNAL_NAMES.RUN_COMPLETED,
      source: "brain",
      cause: "ai-run.resultsApplied",
      payload: { sessionId: payload.sessionId ?? "" },
      dedupeKey: payload.sessionId ? `session:${payload.sessionId}` : "",
    };
  }
  if (eventType === AI_RUN_EVENT_TYPES.FAILED || eventType === AI_RUN_EVENT_TYPES.TIMED_OUT) {
    return {
      name: SIGNAL_NAMES.RUN_FAILED,
      source: "brain",
      cause: eventType === AI_RUN_EVENT_TYPES.TIMED_OUT ? "run-timeout" : "run-failed",
      payload: { sessionId: payload.sessionId ?? "", reason: payload.reason ?? "" },
      dedupeKey: payload.sessionId ? `session:${payload.sessionId}` : "",
    };
  }
  if (eventType === AI_RUN_EVENT_TYPES.PREVIEW_READY) {
    return {
      name: SIGNAL_NAMES.PREVIEW_OPENED,
      source: "brain",
      cause: "ai-run.previewReady",
      payload: { origin: payload.origin ?? "post_ai" },
    };
  }
  if (eventType === AI_RUN_EVENT_TYPES.EXITED) {
    return {
      name: SIGNAL_NAMES.PREVIEW_EXITED,
      source: "brain",
      cause: "ai-run.exited",
      payload: { restored: true },
    };
  }
  return null;
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
      currentPageHasPendingChanges: false,
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
      currentPageHasPendingChanges: false,
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

// The popup is the integrated authority for marking session state: it folds the
// toggle, content marking mode, candidacy, and the post-AI lock into isEnabled /
// silentModeActive. Content reports the same two facts from its lower-level page
// edit-state, which legitimately diverges post-AI (marking edits are locked, so
// content reports isEnabled:false / silentModeActive:true) while the popup reports
// the ready_to_save session (isEnabled:true). Re-folded every heartbeat, the two
// disagreeing reports flip-flop mainUiHidden -> the marking UI (incl. Save/Discard)
// flickers and is intermittently unclickable. While a popup is connected the popup
// owns these two facts; with no popup connected content keeps them so silent
// highlighting still activates with the popup closed.
function omitContentMarkingSessionFacts(facts: SessionFactsPatch): SessionFactsPatch {
  const {
    isEnabled: _isEnabled,
    silentModeActive: _silentModeActive,
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
  realmsOverride?: readonly Realm[],
): void {
  const eventType = state ? SPINNER_EVENT_TYPES.SET : SPINNER_EVENT_TYPES.CLEAR;
  const payload = state
    ? { surface, state }
    : { surface };
  const targets = realmsOverride
    ? realmsOverride
    : surface === "popup"
      ? [REALMS.POPUP]
      : [REALMS.CONTENT, REALMS.POPUP];
  for (const target of targets) {
    void bus.publish(eventType, payload, { target, tab: tabId });
  }
}

// Per-tab cache of the last BROADCAST projection content. The store bumps
// `version` and schedules a projection on every mutate (including no-op folds of
// identical facts). Both the popup VIEW_UPDATED apply and the popup spinner
// SET/CLEAR handlers re-run `refreshUi`, which republishes the popup facts, so
// without deduping those POPUP-realm broadcasts the brain and popup spin in an
// unbounded loop (popup publish -> brain fold -> project -> popup apply ->
// refreshUi -> publish -> ...). We therefore dedupe the popup-realm deliveries:
// VIEW_UPDATED and the popup-realm SET/CLEAR of the three spinner surfaces.
// `popupView.version` is excluded from the comparison because the popup never
// consumes it (applyPopupViewSnapshot ignores `version`). The content-realm
// broadcasts (directive.content and the content-realm pageCurtain/banner) are
// deliberately NOT deduped (see publishProjectedState) because the content has a
// push-only subscription with no resync hook.
type ProjectionBroadcastCache = {
  view: string;
  popup: string;
  pageCurtain: string;
  banner: string;
};
const lastProjectionBroadcastByTab = new Map<number, ProjectionBroadcastCache>();

function resetProjectionBroadcastCache(tabId: number): void {
  lastProjectionBroadcastByTab.delete(tabId);
}

// Per-tab high-water mark of the latest applied popup SessionFacts sequence.
// Lets the brain drop stale/duplicate out-of-order popup reports (overlapping
// refreshUiInner runs publish facts out of order). NOT persisted: the popup's
// counter restarts at 1 on every popup load, so this is reset when the popup
// (re)connects (registerPopupPort).
const lastPopupSessionFactsSeqByTab = new Map<number, number>();

function resetPopupSessionFactsSeq(tabId: number): void {
  lastPopupSessionFactsSeqByTab.delete(tabId);
}

function publishProjectedState(
  bus: ReturnType<typeof createBus>,
  tabId: number,
  state: TabLayerState,
): void {
  const { popupView, contentDirective } = projectViews(state);
  const spinners = projectSpinners(state);

  const viewKey = JSON.stringify({ ...popupView, version: 0 });
  const popupSpinnerKey = JSON.stringify(spinners.popup ?? null);
  const pageCurtainKey = JSON.stringify(spinners.pageCurtain ?? null);
  const bannerKey = JSON.stringify(spinners.banner ?? null);
  const last = lastProjectionBroadcastByTab.get(tabId);

  if (!last || viewKey !== last.view) {
    void bus.publish(POPUP_STATE_EVENT_TYPES.VIEW_UPDATED, popupView, { target: REALMS.POPUP, tab: tabId });
  }

  // Content-realm broadcasts are NOT deduped. The content realm receives them via
  // a push subscription with no pull and best-effort delivery (transient
  // tabs.sendMessage failures are swallowed), and there is no content-side
  // resync hook like registerPopupPort. A freshly (re)injected content script
  // that reports byte-identical facts must therefore still receive the current
  // directive AND the current page curtain/banner, otherwise a dropped or missed
  // delivery would leave the page stuck under (or missing) a curtain forever.
  // Content does not re-report facts in response to these, so they do not drive
  // the popup republish loop and re-broadcasting is harmless.
  void bus.publish("directive.content", contentDirective, { target: REALMS.CONTENT, tab: tabId });
  publishSpinnerSurface(bus, tabId, "pageCurtain", spinners.pageCurtain, [REALMS.CONTENT]);
  publishSpinnerSurface(bus, tabId, "banner", spinners.banner, [REALMS.CONTENT]);

  // Popup-realm spinner deliveries DO drive the loop (handleSpinnerSurfaceChanged
  // re-runs refreshUi for the popup/pageCurtain surfaces), so dedupe them. The
  // popup always gets a fresh full projection on (re)connect via
  // registerPopupPort, so deduping cannot starve it.
  if (!last || popupSpinnerKey !== last.popup) {
    publishSpinnerSurface(bus, tabId, "popup", spinners.popup, [REALMS.POPUP]);
  }
  if (!last || pageCurtainKey !== last.pageCurtain) {
    publishSpinnerSurface(bus, tabId, "pageCurtain", spinners.pageCurtain, [REALMS.POPUP]);
  }
  if (!last || bannerKey !== last.banner) {
    publishSpinnerSurface(bus, tabId, "banner", spinners.banner, [REALMS.POPUP]);
  }

  lastProjectionBroadcastByTab.set(tabId, {
    view: viewKey,
    popup: popupSpinnerKey,
    pageCurtain: pageCurtainKey,
    banner: bannerKey,
  });
}

export function createBrain(options: { logger?: Pick<Console, "error" | "debug"> } = {}) {
  const transport = createBackgroundTransport();
  const bus = createBus({
    realm: REALMS.BACKGROUND,
    transport,
    logger: options.logger || console,
  });
  const store = createStateStore({
    persist: (states) => {
      void persistTabStates(states);
    },
  });
  // REFLEX-ARC pairing guarantee: phase/reconciliation signal edges are
  // observed at the store's mutate — the one choke point EVERY dictation
  // rewrite funnels through (folds, curtain clears, lifecycle mirrors) — so a
  // path that drops the phase without a fold pass can never strand a consumer
  // waiting for the matching -ended. See session-signal-edges.ts.
  store.mutate = wrapMutateWithSessionSignalEdges(
    store.mutate,
    (tabId, emit) => emitSignal(tabId, emit),
  );

  transport.start();
  const popupPortCounts = new Map<number, number>();
  store.onProjection((tabId, state) => {
    traceBrainProject(tabId, state.version, "projection");
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
  ) {
    return store.mutate(tabId, reason, (draft) => {
      let nextFacts: SessionFactsPatch = shouldKeepBrainAiRunAuthority(draft, source, facts)
        ? omitPopupAiRunAuthorityFacts(facts)
        : facts;
      // While a popup is connected it is the authority for marking session state;
      // drop content's isEnabled/silentModeActive so the two sources cannot
      // flip-flop mainUiHidden across heartbeats (see omitContentMarkingSessionFacts).
      if (source === "content" && popupPortCounts.has(tabId)) {
        nextFacts = omitContentMarkingSessionFacts(nextFacts);
      }
      const wasNavigationInspectionPending = draft.sessionFacts.navigationInspectionPending;
      const wasPageInspectionBusy = draft.sessionFacts.pageInspectionBusy;
      const next = applySessionFactsPatch(draft.sessionFacts, nextFacts);
      draft.sessionFactsReported = true;
      draft.sessionFacts = next.facts;
      draft.sessionDictation = next.dictation;
      draft.secondaryGates = deriveSecondaryGatesViewState(next.facts);
      // The reconciliation/inspection signal edges are emitted by the store's
      // wrapped mutate (session-signal-edges.ts), which sees this fold AND every
      // other dictation rewrite — do not emit them here.
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
    // Drop stale/duplicate out-of-order popup reports. refreshUi does not
    // serialize, so overlapping refreshUiInner runs publish full SessionFacts out
    // of order; without this a stale run (isEnabled/siteIdReady=false during the
    // enable/load window) could be the last writer and the brain would dictate
    // mainUiHidden=true (main UI stuck hidden). The seq is the popup's
    // refresh-start sequence; untagged reports (content facts, partial popup
    // publishes) carry no seq and always apply.
    if (source === "popup" && typeof typedPayload.seq === "number") {
      const lastSeq = lastPopupSessionFactsSeqByTab.get(meta.tab) ?? 0;
      if (typedPayload.seq <= lastSeq) {
        return;
      }
      lastPopupSessionFactsSeqByTab.set(meta.tab, typedPayload.seq);
    }
    const facts = typedPayload.facts && typeof typedPayload.facts === "object"
      ? typedPayload.facts
      : {};
    foldSessionFacts(meta.tab, source, facts, `session-facts:${source}`);
  });
  bus.registerHandler(SESSION_REQUEST_TYPES.FACTS_APPLY, (payload: SessionFactsApplyPayload, meta) => {
    if (!meta.tab) {
      throw new Error("session.facts.apply requires a tab id");
    }
    const typedPayload = payload && typeof payload === "object" ? payload : { source: "popup", facts: {} };
    const source = typedPayload.source === "content" ? "content" : "popup";
    const facts = typedPayload.facts && typeof typedPayload.facts === "object"
      ? typedPayload.facts
      : {};
    const state = foldSessionFacts(meta.tab, source, facts, `session-facts-apply:${source}`);
    return {
      ok: true,
      tabId: meta.tab,
      version: state.version,
      secondaryGates: state.secondaryGates,
    };
  });
  // REFLEX-ARC Phase 1: the brain-owned per-tab signal log. Admission assigns
  // the monotonic seq, pushes best-effort, and serves cursor pulls (the
  // correctness path). See .copilot/architecture/reflex-arc-plan.md §1.
  const signalLog = createSignalLog();
  let signalLogHydrated = false;
  let signalPersistTimer: ReturnType<typeof setTimeout> | null = null;
  async function ensureSignalLogHydrated(): Promise<void> {
    if (signalLogHydrated) {
      return;
    }
    signalLogHydrated = true;
    signalLog.hydrate(await loadPersistedSignalLog());
  }
  function persistSignalLogSoon(): void {
    if (signalPersistTimer) {
      return;
    }
    signalPersistTimer = setTimeout(() => {
      signalPersistTimer = null;
      void persistSignalLog(signalLog.serialize());
    }, 100);
  }
  function emitSignal(
    tabId: number,
    emit: SignalEmitPayload,
    sourceOverride?: SignalFrame["source"],
  ): SignalFrame | null {
    const admission = signalLog.admit(tabId, emit, sourceOverride);
    if (!admission.frame) {
      return null;
    }
    for (const target of [REALMS.POPUP, REALMS.CONTENT]) {
      void bus.publish(SIGNAL_EVENT_TYPES.EMITTED, admission.frame, { target, tab: tabId });
    }
    persistSignalLogSoon();
    options.logger?.debug?.("brain signal emitted", {
      tabId,
      seq: admission.frame.seq,
      name: admission.frame.name,
      cause: admission.frame.cause,
    });
    return admission.frame;
  }
  bus.registerHandler(SIGNAL_REQUEST_TYPES.EMIT, async (payload: SignalEmitPayload, meta): Promise<SignalEmitReply> => {
    if (!meta.tab) {
      throw new Error("signal.emit requires a tab id");
    }
    await ensureSignalLogHydrated();
    const source = meta.src === REALMS.CONTENT ? "content" : meta.src === REALMS.POPUP ? "popup" : "brain";
    const frame = emitSignal(meta.tab, payload, source);
    return { ok: true, frame };
  });
  bus.registerHandler(SIGNAL_REQUEST_TYPES.PULL, async (payload: SignalPullPayload, meta): Promise<SignalPullReply> => {
    if (!meta.tab) {
      throw new Error("signal.pull requires a tab id");
    }
    await ensureSignalLogHydrated();
    const afterSeq = payload && Number.isFinite(payload.afterSeq) ? Math.trunc(payload.afterSeq) : 0;
    return {
      ok: true,
      headSeq: signalLog.headSeq(meta.tab),
      frames: signalLog.listAfter(meta.tab, afterSeq),
    };
  });
  for (const eventType of Object.values(AI_RUN_EVENT_TYPES)) {
    bus.subscribe(eventType, (payload, meta) => {
      const eventPayload = normalizeAiRunEventPayload(payload);
      const tabId = meta.tab || eventPayload.tabId || null;
      if (!tabId) {
        return;
      }
      foldAiRunEvent(tabId, eventType, eventPayload, `ai-run:${eventType}`);
      const signalEmit = mapAiRunEventToSignalEmit(eventType, eventPayload);
      if (signalEmit) {
        emitSignal(tabId, signalEmit);
      }
    });
  }
  const heartbeat = createBrainHeartbeat({
    request: (type, payload, opts) => bus.request(type, payload, opts),
    foldFacts: (tabId, source, facts, reason) => foldSessionFacts(tabId, source, facts, reason),
  });
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
      // A (re)connecting popup restarts its facts sequence at 1, so clear the
      // brain's high-water mark or the reloaded popup's reports would be dropped.
      resetPopupSessionFactsSeq(tabId);
      heartbeat.start(tabId);
      const state = store.get(tabId);
      if (state) {
        // A (re)connecting popup has no prior state, so always send a fresh
        // projection even if it is identical to the last broadcast.
        resetProjectionBroadcastCache(tabId);
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
    // REFLEX-ARC Phase 1: brain-side signal emission for background command
    // choke points (marking activate/deactivate acks etc.). Assigns seq,
    // pushes, persists; dedupe rules live in the signal log.
    emitSignal(tabId: number, emit: SignalEmitPayload): SignalFrame | null {
      return emitSignal(tabId, emit, "brain");
    },
    async rehydrate() {
      const persisted = await loadPersistedTabStates();
      for (const [tabId, state] of persisted) {
        store.mutate(tabId, "brain:rehydrate", (draft) => {
          Object.assign(draft, state);
        });
      }
      await ensureSignalLogHydrated();
    },
  };
}
