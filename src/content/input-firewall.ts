import type { ContentPresentation } from "./organ";

const NATIVE_SCROLL_EVENTS = new Set(["wheel", "touchstart", "touchmove", "touchend"]);

export type ContentInputDisposition = "extension" | "native-scroll" | "blocked";

/** Blocks page listeners at capture time. For wheel/touch gestures it deliberately
 * does not prevent the browser default, so the document still scrolls without
 * letting page-owned carousels, drawers, or gesture handlers react. */
export function filterContentInput(
  event: Pick<Event, "type" | "cancelable" | "preventDefault" | "stopPropagation"> &
    Readonly<{ stopImmediatePropagation?: () => void }>,
  extensionOwnedTarget: boolean,
): ContentInputDisposition {
  if (extensionOwnedTarget) {
    return "extension";
  }
  if (NATIVE_SCROLL_EVENTS.has(event.type)) {
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    return "native-scroll";
  }
  if (event.cancelable !== false) {
    event.preventDefault();
  }
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return "blocked";
}

export function shouldBlockPageInput(
  presentation: Pick<ContentPresentation, "pageInputBlocked">,
  silentHighlightsActive: boolean,
): boolean {
  return presentation.pageInputBlocked || silentHighlightsActive;
}
