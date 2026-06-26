import type { PopupStateGetReply, PopupViewEnvelope } from "../../../common/bus/contracts/popup-state.js";
import type { PopupBrokerState } from "../../popup-state-broker.js";
import { projectViews } from "../view-projector.js";
import type { TabLayerState } from "../state-store.js";

type PopupStateStore = {
  getOrInit(tabId: number): TabLayerState;
  mutate(tabId: number, reason: string, fn: (state: TabLayerState) => void): TabLayerState;
};

function clonePopupBrokerState(state: PopupBrokerState): Omit<PopupViewEnvelope, "version"> {
  if (!state.ok || !state.tabId) {
    throw new Error("Popup broker state requires a valid tab id");
  }
  return {
    tabId: state.tabId,
    traceEnabled: state.traceEnabled,
    traceEvents: state.traceEvents.map((event) => ({
      ...event,
      payload: event.payload ? { ...event.payload } : null,
    })),
    lifecycle: state.lifecycle ? { ...state.lifecycle } : null,
    spinnerQueue: state.spinnerQueue.map((entry) => {
      const clone = { ...entry };
      if (entry.blockSurfaces) {
        clone.blockSurfaces = { ...entry.blockSurfaces };
      }
      return clone;
    }),
    activeSpinnerLease: state.activeSpinnerLease
      ? (() => {
        const clone = { ...state.activeSpinnerLease };
        if (state.activeSpinnerLease.blockSurfaces) {
          clone.blockSurfaces = { ...state.activeSpinnerLease.blockSurfaces };
        }
        return clone;
      })()
      : null,
  };
}

export function buildPopupViewFromBrokerState(
  brokerState: PopupBrokerState,
  version: number,
): PopupViewEnvelope {
  return {
    version,
    ...clonePopupBrokerState(brokerState),
  };
}

export function updatePopupViewFromBrokerState(
  store: PopupStateStore,
  tabId: number,
  brokerState: PopupBrokerState,
  reason: string,
): PopupStateGetReply {
  const nextState = clonePopupBrokerState(brokerState);
  const state = store.mutate(tabId, reason, (draft) => {
    draft.popupView.traceEnabled = nextState.traceEnabled;
    draft.popupView.traceEvents = nextState.traceEvents;
    draft.popupView.lifecycle = nextState.lifecycle;
    draft.popupView.spinnerQueue = nextState.spinnerQueue;
    draft.popupView.activeSpinnerLease = nextState.activeSpinnerLease;
  });
  return buildPopupViewFromBrokerState(brokerState, state.version);
}

export function getPopupView(
  store: Pick<PopupStateStore, "getOrInit">,
  tabId: number,
): PopupStateGetReply {
  const state = store.getOrInit(tabId);
  return projectViews(state).popupView;
}
