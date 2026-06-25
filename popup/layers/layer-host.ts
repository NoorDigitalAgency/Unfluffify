import type { Bus } from "../../common/bus/bus.js";
import { POPUP_STATE_EVENT_TYPES, type PopupStateGetReply } from "../../common/bus/contracts/popup-state.js";
import { clearPopupSpinner, renderPopupSpinner } from "./spinner-layer.js";

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
      renderPopupSpinner(null);
    }),
    bus.subscribe("spinner.set", (payload) => {
      if (!payload || typeof payload !== "object" || (payload as { surface?: unknown }).surface !== "popup") {
        return;
      }
      renderPopupSpinner((payload as { state?: unknown }).state ?? null);
    }),
    bus.subscribe("spinner.clear", (payload) => {
      if (!payload || typeof payload !== "object" || (payload as { surface?: unknown }).surface !== "popup") {
        return;
      }
      clearPopupSpinner();
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
