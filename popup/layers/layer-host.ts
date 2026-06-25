import type { Bus } from "../../common/bus/bus.js";
import { POPUP_STATE_EVENT_TYPES, type PopupStateGetReply } from "../../common/bus/contracts/popup-state.js";
import { SPINNER_EVENT_TYPES } from "../../common/bus/contracts/spinner.js";
import { clearPopupSpinnerSurface, renderPopupSpinnerSurface } from "./spinner-layer.js";

type PopupViewLike = PopupStateGetReply;

type PopupLayerHostOptions = {
  applyPopupView?: (view: PopupViewLike) => void;
};

let popupLayerHostStarted = false;
let latestPopupView: PopupViewLike | null = null;

function normalizePopupView(value: unknown): PopupViewLike | null {
  return value && typeof value === "object" ? value as PopupViewLike : null;
}

export function startPopupLayerHost(bus: Bus): () => void {
  return startPopupLayerHostWithOptions(bus, {});
}

export function startPopupLayerHostWithOptions(bus: Bus, options: PopupLayerHostOptions): () => void {
  if (popupLayerHostStarted) {
    return () => {};
  }
  popupLayerHostStarted = true;
  const applyPopupView = typeof options.applyPopupView === "function"
    ? options.applyPopupView
    : () => {};
  const unsubscribes = [
    bus.subscribe(POPUP_STATE_EVENT_TYPES.VIEW_UPDATED, (payload) => {
      const popupView = normalizePopupView(payload);
      latestPopupView = popupView;
      if (popupView) {
        applyPopupView(popupView);
      }
    }),
    bus.subscribe(SPINNER_EVENT_TYPES.SET, (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const surface = (payload as { surface?: unknown }).surface;
      if (surface !== "popup" && surface !== "pageCurtain" && surface !== "banner") {
        return;
      }
      renderPopupSpinnerSurface(surface, (payload as { state?: unknown }).state ?? null);
    }),
    bus.subscribe(SPINNER_EVENT_TYPES.CLEAR, (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const surface = (payload as { surface?: unknown }).surface;
      if (surface !== "popup" && surface !== "pageCurtain" && surface !== "banner") {
        return;
      }
      clearPopupSpinnerSurface(surface);
    }),
  ];

  return () => {
    popupLayerHostStarted = false;
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}

export function getLatestPopupView(): PopupViewLike | null {
  return latestPopupView;
}
