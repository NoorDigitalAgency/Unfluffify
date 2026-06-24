import type { Bus } from "../../common/bus/bus.js";
import { clearContentSpinner, renderContentSpinner } from "./spinner-layer.js";

type ContentDirectiveLike = {
  version?: unknown;
};

let contentLayerHostStarted = false;
let latestContentDirective: ContentDirectiveLike | null = null;

export function startContentLayerHost(bus: Bus): () => void {
  if (contentLayerHostStarted) {
    return () => {};
  }
  contentLayerHostStarted = true;
  const unsubscribes = [
    bus.subscribe("directive.content", (payload) => {
      latestContentDirective = payload && typeof payload === "object" ? payload as ContentDirectiveLike : null;
    }),
    bus.subscribe("spinner.set", (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const surface = (payload as { surface?: unknown }).surface;
      if (surface !== "pageCurtain" && surface !== "banner") {
        return;
      }
      renderContentSpinner(surface, (payload as { state?: unknown }).state ?? null);
    }),
    bus.subscribe("spinner.clear", (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const surface = (payload as { surface?: unknown }).surface;
      if (surface !== "pageCurtain" && surface !== "banner") {
        return;
      }
      clearContentSpinner(surface);
    }),
  ];

  return () => {
    contentLayerHostStarted = false;
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}

export function getLatestContentDirective(): ContentDirectiveLike | null {
  return latestContentDirective;
}
