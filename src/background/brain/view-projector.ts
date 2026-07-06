import type { ActivationSnapshot } from "../../common/bus/contracts/activation";
import type {
  RenderModeDirectiveState,
  RenderModeViewState,
} from "../../common/bus/contracts/render-mode";
import type { SecondaryGatesViewState } from "../../common/bus/contracts/secondary-gates-state";
import { LIFECYCLE_KINDS } from "../../common/world-messaging-contract";
import type { PopupViewEnvelope } from "../../common/bus/contracts/popup-state";
import { PAGE_SAVE_RECONCILIATION_REASONS } from "../../common/bus/contracts/session-state";
import type { TabLayerState } from "./state-store";

export type PopupView = PopupViewEnvelope;

export type ContentDirective = Readonly<{
  version: number;
  activation: ActivationSnapshot;
  renderMode: RenderModeDirectiveState;
  markingEditsBlocked: boolean;
  markingEditsBlockedReason: string;
  silentHighlightActive: boolean;
  pageRevealFreezeActive: boolean;
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
  // P4 step 4.2: dictation is a phase pointer only.
  return value ? { phase: value.phase } : null;
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
  // Editor-activation gate: silent highlighting renders only after the real
  // activation (popup bootstrap / post-render-mode-view), never on the passive
  // page-load content activation. At plain load a property page hides consent only;
  // deferring silent + reveal keeps the one-per-visit reveal for the real activation
  // so it does not render blank. See TabLayerState.editorActivated.
  if (!state.editorActivated) {
    return false;
  }
  const facts = state.sessionFacts;
  // The silent-highlight editor preparation IS a page inspection: while it runs
  // it sets navigationInspectionPending, pageInspectionBusy, and an
  // editor_preparing page-save reconciliation. This directive is the stable
  // intent ("silent highlighting should be active for this page"), so it must
  // NOT be gated off by the activation's own transient signals — doing so makes
  // the directive flip false while preparing and true again once it settles,
  // which re-triggers the activation forever (a perpetual "Preparing page
  // content…/Working…" curtain). Only a NON-editor_preparing reconciliation
  // (saving/syncing) should suppress silent highlighting.
  const blockingReconciliationPending =
    facts.pageSaveReconciliationPending &&
    facts.pageSaveReconciliationReason !== PAGE_SAVE_RECONCILIATION_REASONS.EDITOR_PREPARING;
  // An active AI preview inherently means the session has unsaved AI results, but
  // the user still wants the stored-selector silent highlightings rendered next to
  // the yellow AI-detected content for comparison. So while a preview is displaying
  // the "clean session" gates are waived; otherwise silent highlighting only runs
  // for a settled, clean session. NOTE: previewBlocked stays coupled to
  // previewActive in the real reporters (both flip together), so it is NOT a
  // transient sub-state — previewRestorePending is what marks the exit/restore
  // transition during which silent highlighting must stay suppressed.
  const previewComparisonActive =
    facts.previewActive && !facts.previewRestorePending;
  const sessionSettledClean =
    !facts.previewActive &&
    !facts.previewRestorePending &&
    !facts.sessionHasPendingChanges &&
    !facts.currentPageHasPendingChanges &&
    !facts.currentDraftDirty &&
    !facts.sessionRequiresAiRun;
  // While a preview is displaying, silent highlighting must render alongside the
  // yellow AI-detected content REGARDLESS of the marking-off base condition
  // (silentModeActive + !isEnabled): a marking-mode AI preview keeps the session
  // enabled (silentModeActive=false, isEnabled=true) but the contract still wants
  // the stored-selector highlights shown for saved-vs-detected comparison (#8). So
  // silentModeActive + !isEnabled only gate the non-preview settled-clean path;
  // during previewComparisonActive they are waived.
  return Boolean(
    facts.hasStoredSelectors &&
      !facts.pageScopedUiDisabled &&
      facts.baseUrlReady &&
      facts.siteIdReady &&
      facts.renderModeReady &&
      !facts.pageTypeUiBlocked &&
      !blockingReconciliationPending &&
      !facts.aiBusy &&
      !facts.aiComputing &&
      !facts.saving &&
      !facts.discarding &&
      (previewComparisonActive ||
        (facts.silentModeActive && !facts.isEnabled && sessionSettledClean))
  );
}

// Page-prep reveal/freeze should run for any render-mode-confirmed candidate page
// the editor is viewing (marking off), EVEN when there are no stored selectors yet
// (a fresh candidate). This is the brain-dictated activation gate for the content
// reveal/freeze mechanics; it is a superset of shouldActivateSilentHighlighting,
// which additionally requires silent mode + stored selectors to render the overlay.
// Content still gates the actual reveal on the resolved candidate page type, so a
// broad directive here is safe (non-candidate pages bail before freezing).
function shouldRevealFreezePage(state: TabLayerState): boolean {
  if (!state.sessionFactsReported) {
    return false;
  }
  // Editor-activation gate (see shouldActivateSilentHighlighting): the reveal/freeze
  // ritual runs only for the real activation (popup / post-render-mode-view), not the
  // passive page-load activation — so it does not consume the one-per-visit reveal at
  // load and leave the real activation blank.
  if (!state.editorActivated) {
    return false;
  }
  const facts = state.sessionFacts;
  const blockingReconciliationPending =
    facts.pageSaveReconciliationPending &&
    facts.pageSaveReconciliationReason !== PAGE_SAVE_RECONCILIATION_REASONS.EDITOR_PREPARING;
  return Boolean(
    !facts.isEnabled &&
      !facts.pageScopedUiDisabled &&
      facts.baseUrlReady &&
      facts.siteIdReady &&
      facts.renderModeReady &&
      !facts.pageTypeUiBlocked &&
      !facts.sessionHasPendingChanges &&
      !facts.currentPageHasPendingChanges &&
      !facts.currentDraftDirty &&
      !blockingReconciliationPending &&
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
  // composes both causes (active AI run and save reconciliation) into one
  // directive reason so content only reflects it. The silent-highlight editor
  // preparation reconciliation is exempt and must never raise the overlay.
  // The marking page is locked ONLY while an AI run is in flight (computing) or
  // its preview is open; once the run settles into POST_AI the page is editable
  // again so the user can revise markings and re-run (or Save/Discard).
  const aiRunMarkingBlocked = Boolean(
    state.sessionFactsReported &&
      (state.sessionFacts.aiComputing ||
        state.sessionFacts.previewActive ||
        state.sessionFacts.previewBlocked)
  );
  const reconciliationMarkingBlocked = Boolean(
    state.sessionFactsReported &&
      state.sessionFacts.pageSaveReconciliationPending &&
      state.sessionFacts.pageSaveReconciliationReason !== PAGE_SAVE_RECONCILIATION_REASONS.EDITOR_PREPARING
  );
  const markingEditsBlocked = aiRunMarkingBlocked || reconciliationMarkingBlocked;
  const markingEditsBlockedReason = aiRunMarkingBlocked
    ? "ai_run"
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
      pageRevealFreezeActive: shouldRevealFreezePage(state),
    },
  };
}
