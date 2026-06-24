import type { Bus } from "../../common/bus/bus.js";
import { clearPopupSpinner, renderPopupSpinner } from "./spinner-layer.js";

type PopupViewLike = {
  version?: unknown;
};

let popupLayerHostStarted = false;
let latestPopupView: PopupViewLike | null = null;

function normalizePopupView(value: unknown): PopupViewLike | null {
  return value && typeof value === "object" ? value as PopupViewLike : null;
}

export function startPopupLayerHost(bus: Bus): () => void {
  if (popupLayerHostStarted) {
    return () => {};
  }
  popupLayerHostStarted = true;
  const unsubscribes = [
    bus.subscribe("view.popup", (payload) => {
      latestPopupView = normalizePopupView(payload);
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
