import type { ActivationSnapshot } from "../../common/bus/contracts/activation.js";
import { LIFECYCLE_KINDS } from "../../common/world-messaging-contract.js";
import type { PopupViewEnvelope } from "../../common/bus/contracts/popup-state.js";
import type { TabLayerState } from "./state-store.js";

export type PopupView = PopupViewEnvelope;

export type ContentDirective = Readonly<{
  version: number;
  activation: ActivationSnapshot;
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

export function projectViews(state: TabLayerState): {
  popupView: PopupView;
  contentDirective: ContentDirective;
} {
  const activation = cloneActivationSnapshot(state.activation);
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
      legacySpinnerQueue: state.popupView.legacySpinnerQueue.map((entry) => {
        const clone = { ...entry };
        if (entry.blockSurfaces) {
          clone.blockSurfaces = { ...entry.blockSurfaces };
        }
        return clone;
      }),
      legacyActiveSpinnerLease: state.popupView.legacyActiveSpinnerLease
        ? (() => {
          const clone = { ...state.popupView.legacyActiveSpinnerLease };
          if (state.popupView.legacyActiveSpinnerLease.blockSurfaces) {
            clone.blockSurfaces = {
              ...state.popupView.legacyActiveSpinnerLease.blockSurfaces,
            };
          }
          return clone;
        })()
        : null,
    },
    contentDirective: {
      version: state.version,
      activation,
    },
  };
}
