import type { ActivationSnapshot } from "../../common/bus/contracts/activation.js";
import type {
  RenderModeDirectiveState,
  RenderModeViewState,
} from "../../common/bus/contracts/render-mode.js";
import { LIFECYCLE_KINDS } from "../../common/world-messaging-contract.js";
import type { PopupViewEnvelope } from "../../common/bus/contracts/popup-state.js";
import type { TabLayerState } from "./state-store.js";

export type PopupView = PopupViewEnvelope;

export type ContentDirective = Readonly<{
  version: number;
  activation: ActivationSnapshot;
  renderMode: RenderModeDirectiveState;
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

export function projectViews(state: TabLayerState): {
  popupView: PopupView;
  contentDirective: ContentDirective;
} {
  const activation = cloneActivationSnapshot(state.activation);
  const renderMode = cloneRenderModeViewState(state.renderMode);
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
      spinnerQueue: state.popupView.spinnerQueue.map((entry) => {
        const clone = { ...entry };
        if (entry.blockSurfaces) {
          clone.blockSurfaces = { ...entry.blockSurfaces };
        }
        return clone;
      }),
      activeSpinnerLease: state.popupView.activeSpinnerLease
        ? (() => {
          const clone = { ...state.popupView.activeSpinnerLease };
          if (state.popupView.activeSpinnerLease.blockSurfaces) {
            clone.blockSurfaces = {
              ...state.popupView.activeSpinnerLease.blockSurfaces,
            };
          }
          return clone;
        })()
        : null,
    },
    contentDirective: {
      version: state.version,
      activation,
      renderMode: cloneRenderModeDirectiveState(state.renderMode),
    },
  };
}
