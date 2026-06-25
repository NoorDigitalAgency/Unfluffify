import type { PopupViewEnvelope } from "../../common/bus/contracts/popup-state.js";
import type { TabLayerState } from "./state-store.js";

export type PopupView = PopupViewEnvelope;

export type ContentDirective = Readonly<{
  version: number;
}>;

export function projectViews(state: TabLayerState): {
  popupView: PopupView;
  contentDirective: ContentDirective;
} {
  return {
    popupView: {
      version: state.version,
      tabId: state.tabId,
      traceEnabled: state.popupView.traceEnabled,
      traceEvents: state.popupView.traceEvents.map((event) => ({
        ...event,
        payload: event.payload ? { ...event.payload } : null,
      })),
      lifecycle: state.popupView.lifecycle ? { ...state.popupView.lifecycle } : null,
      legacySpinnerQueue: state.popupView.legacySpinnerQueue.map((entry) => ({
        ...entry,
        blockSurfaces: entry.blockSurfaces ? { ...entry.blockSurfaces } : undefined,
      })),
      legacyActiveSpinnerLease: state.popupView.legacyActiveSpinnerLease
        ? {
          ...state.popupView.legacyActiveSpinnerLease,
          blockSurfaces: state.popupView.legacyActiveSpinnerLease.blockSurfaces
            ? { ...state.popupView.legacyActiveSpinnerLease.blockSurfaces }
            : undefined,
        }
        : null,
    },
    contentDirective: { version: state.version },
  };
}
