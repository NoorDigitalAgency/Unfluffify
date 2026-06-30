import type { ActivationSnapshot } from "../../common/bus/contracts/activation";
import type {
  RenderModeDirectiveState,
  RenderModeViewState,
} from "../../common/bus/contracts/render-mode";
import type { SecondaryGatesViewState } from "../../common/bus/contracts/secondary-gates-state";
import { LIFECYCLE_KINDS } from "../../common/world-messaging-contract";
import type { PopupViewEnvelope } from "../../common/bus/contracts/popup-state";
import { AI_RUN_PHASES, PAGE_SAVE_RECONCILIATION_REASONS } from "../../common/bus/contracts/session-state";
import type { TabLayerState } from "./state-store";

export type PopupView = PopupViewEnvelope;

export type ContentDirective = Readonly<{
  version: number;
  activation: ActivationSnapshot;
  renderMode: RenderModeDirectiveState;
  markingEditsBlocked: boolean;
  markingEditsBlockedReason: string;
  silentHighlightActive: boolean;
}>;

function cloneActivationSnapshot(value: TabLayerState["activation"]): ActivationSnapshot {
  if (!value) {
    return {
      contentReady: false,
      bootstrapStatus: "idle",
      restorePending: false,
      lastError: "",
      lastLifecycle: null,
      lastContentPageUrl: "",
    };
  }
  return {
    contentReady: value.contentReady,
    bootstrapStatus: value.bootstrapStatus,
    restorePending: value.restorePending,
    lastError: value.lastError,
    lastLifecycle: value.lastLifecycle
      ? { ...value.lastLifecycle }
      : null,
    lastContentPageUrl: value.lastContentPageUrl,
  };
}

function cloneProjectedPopupLifecycle(state: TabLayerState): PopupViewEnvelope["lifecycle"] {
  const activationLifecycle = state.activation?.lastLifecycle;
  const popupLifecycle = state.popupView.lifecycle;
  const activationLifecycleProjectable = Boolean(
    activationLifecycle &&
      (activationLifecycle.kind === LIFECYCLE_KINDS.ACTIVATION ||
        activationLifecycle.kind === LIFECYCLE_KINDS.CONTENT_READY)
  );
  if (popupLifecycle) {
    return { ...popupLifecycle };
  }

  if (activationLifecycleProjectable) {
    return {
      operationId: activationLifecycle?.operationId,
      kind: activationLifecycle?.kind,
      phase: activationLifecycle?.phase,
      message: activationLifecycle?.message,
      reason: activationLifecycle?.reason,
      source: activationLifecycle?.source,
      busy: activationLifecycle?.busy,
      contentMode: activationLifecycle?.contentMode,
      markingEnabled: activationLifecycle?.markingEnabled,
      pageUrl: activationLifecycle?.pageUrl,
    };
  }

  return null;
}

function cloneRenderModeViewState(value: TabLayerState["renderMode"]): RenderModeViewState {
  return {
    inspecting: value.inspecting,
    javaScriptDisabled: value.javaScriptDisabled,
    noJsHeld: value.noJsHeld,
    operationId: value.operationId,
    baseUrl: value.baseUrl,
    lastSnapshotPageUrl: value.lastSnapshotPageUrl,
    followUpCompleted: value.followUpCompleted,
    lastError: value.lastError,
  };
}

function cloneRenderModeDirectiveState(value: TabLayerState["renderMode"]): RenderModeDirectiveState {
  return {
    inspecting: value.inspecting,
    operationId: value.operationId,
    noJsHeld: value.noJsHeld,
    javaScriptDisabled: value.javaScriptDisabled,
  };
}

function cloneSessionDictation(value: TabLayerState["sessionDictation"]): PopupViewEnvelope["sessionDictation"] {
  if (!value) {
    return null;
  }
  return {
    ...value,
    buttons: {
      "toggle-enabled": { ...value.buttons["toggle-enabled"] },
      compute: { ...value.buttons.compute },
      "marking-preview": { ...value.buttons["marking-preview"] },
      "page-save": { ...value.buttons["page-save"] },
      "page-revert": { ...value.buttons["page-revert"] },
    },
    curtain: { ...value.curtain },
    preview: { ...value.preview },
  };
}

function clonePropertyLockView(
  value: TabLayerState["propertyLockView"]
): PopupViewEnvelope["propertyLockView"] {
  if (!value) {
    return null;
  }
  return { ...value };
}

function clonePropertyLockTimer(
  value: TabLayerState["propertyLockTimer"]
): PopupViewEnvelope["propertyLockTimer"] {
  if (!value) {
    return null;
  }
  return { ...value };
}

function cloneSecondaryGates(
  value: TabLayerState["secondaryGates"]
): SecondaryGatesViewState | null {
  if (!value) {
    return null;
  }
  return {
    ...value,
    lynxChecklistSendBlockedReason: {
      code: value.lynxChecklistSendBlockedReason.code,
      pageTypeKeys: [...value.lynxChecklistSendBlockedReason.pageTypeKeys],
    },
  };
}

function shouldActivateSilentHighlighting(state: TabLayerState): boolean {
  if (!state.sessionFactsReported) {
    return false;
  }
  const facts = state.sessionFacts;
  return Boolean(
    facts.silentModeActive &&
      facts.hasStoredSelectors &&
      !facts.isEnabled &&
      !facts.pageScopedUiDisabled &&
      !facts.navigationInspectionPending &&
      facts.baseUrlReady &&
      facts.siteIdReady &&
      facts.renderModeReady &&
      !facts.pageTypeUiBlocked &&
      !facts.pageInspectionBusy &&
      !facts.sessionHasPendingChanges &&
      !facts.currentPageHasPendingChanges &&
      !facts.currentDraftDirty &&
      !facts.pageSaveReconciliationPending &&
      !facts.sessionRequiresAiRun &&
      !facts.aiBusy &&
      !facts.aiComputing &&
      !facts.saving &&
      !facts.discarding &&
      !facts.previewActive &&
      !facts.previewBlocked &&
      !facts.previewRestorePending
  );
}

export function projectViews(state: TabLayerState): {
  popupView: PopupView;
  contentDirective: ContentDirective;
} {
  const activation = cloneActivationSnapshot(state.activation);
  const renderMode = cloneRenderModeViewState(state.renderMode);
  // The brain is the sole authority for the marking-edits-blocked overlay: it
  // composes both causes (post-AI lock and save reconciliation) into one
  // directive reason so content only reflects it. The silent-highlight editor
  // preparation reconciliation is exempt and must never raise the overlay.
  const aiRunMarkingBlocked = Boolean(
    state.sessionFactsReported &&
      (state.sessionFacts.aiRunPhase === AI_RUN_PHASES.POST_AI ||
        state.sessionFacts.aiRunPhase === AI_RUN_PHASES.AI_PREVIEW)
  );
  const reconciliationMarkingBlocked = Boolean(
    state.sessionFactsReported &&
      state.sessionFacts.pageSaveReconciliationPending &&
      state.sessionFacts.pageSaveReconciliationReason !== PAGE_SAVE_RECONCILIATION_REASONS.EDITOR_PREPARING
  );
  const markingEditsBlocked = aiRunMarkingBlocked || reconciliationMarkingBlocked;
  const markingEditsBlockedReason = aiRunMarkingBlocked
    ? "post_ai"
    : reconciliationMarkingBlocked
      ? (state.sessionFacts.pageSaveReconciliationReason === PAGE_SAVE_RECONCILIATION_REASONS.SAVING
        ? "saving"
        : "syncing")
      : "";
  return {
    popupView: {
      version: state.version,
      tabId: state.tabId,
      traceEnabled: state.popupView.traceEnabled,
      traceEvents: state.popupView.traceEvents.map((event) => ({
        ...event,
        payload: event.payload ? { ...event.payload } : null,
      })),
      lifecycle: cloneProjectedPopupLifecycle(state),
      activation,
      renderMode,
      sessionPhase: state.sessionFactsReported && state.sessionDictation ? state.sessionDictation.phase : null,
      sessionDictation: state.sessionFactsReported ? cloneSessionDictation(state.sessionDictation) : null,
      propertyLockView: clonePropertyLockView(state.propertyLockView),
      propertyLockTimer: clonePropertyLockTimer(state.propertyLockTimer),
      secondaryGates: state.sessionFactsReported ? cloneSecondaryGates(state.secondaryGates) : null,
      spinnerQueue: [],
      activeSpinnerLease: null,
      tabState: { ...state.tabState },
      siteId: state.siteId,
      pageDataLoadStatus: state.pageDataLoadStatus,
    },
    contentDirective: {
      version: state.version,
      activation,
      renderMode: cloneRenderModeDirectiveState(state.renderMode),
      markingEditsBlocked,
      markingEditsBlockedReason,
      silentHighlightActive: shouldActivateSilentHighlighting(state),
    },
  };
}
