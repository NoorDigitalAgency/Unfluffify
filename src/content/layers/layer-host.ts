import type { Bus } from "../../common/bus/bus";
import { SPINNER_EVENT_TYPES } from "../../common/bus/contracts/spinner";
import { clearContentSpinner, renderContentSpinner } from "./spinner-layer";

type ContentDirectiveLike = {
  version?: unknown;
  markingEditsBlocked?: unknown;
};

let contentLayerHostStarted = false;
let latestContentDirective: ContentDirectiveLike | null = null;
const contentDirectiveListeners = new Set<(directive: ContentDirectiveLike | null) => void>();

function notifyContentDirectiveListeners(): void {
  for (const listener of contentDirectiveListeners) {
    listener(latestContentDirective);
  }
}

export function startContentLayerHost(bus: Bus): () => void {
  if (contentLayerHostStarted) {
    return () => {};
  }
  contentLayerHostStarted = true;
  const unsubscribes = [
    bus.subscribe("directive.content", (payload) => {
      latestContentDirective = payload && typeof payload === "object" ? payload as ContentDirectiveLike : null;
      notifyContentDirectiveListeners();
    }),
    bus.subscribe(SPINNER_EVENT_TYPES.SET, (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const surface = (payload as { surface?: unknown }).surface;
      if (surface !== "pageCurtain" && surface !== "banner") {
        return;
      }
      renderContentSpinner(surface, (payload as { state?: unknown }).state ?? null);
    }),
    bus.subscribe(SPINNER_EVENT_TYPES.CLEAR, (payload) => {
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
    latestContentDirective = null;
    notifyContentDirectiveListeners();
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
}

export function getLatestContentDirective(): ContentDirectiveLike | null {
  return latestContentDirective;
}

export function isMarkingEditsBlockedByDirective(): boolean {
  return latestContentDirective?.markingEditsBlocked === true;
}

export function addContentDirectiveListener(
  listener: (directive: ContentDirectiveLike | null) => void
): () => void {
  contentDirectiveListeners.add(listener);
  return () => {
    contentDirectiveListeners.delete(listener);
  };
}
