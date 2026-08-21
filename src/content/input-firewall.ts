import type { ContentPresentation } from "./organ";

/** Every user-input event whose page-world handling can change a frozen page.
 * Keep the hover and cancellation families explicit: a physical shield prevents
 * page elements from becoming the target, while the capture firewall prevents
 * page-global listeners from treating the shield's events as page input. */
export const CONTENT_INPUT_EVENTS = Object.freeze([
  "click",
  "auxclick",
  "dblclick",
  "contextmenu",
  "mousedown",
  "mouseup",
  "mousemove",
  "mouseover",
  "mouseout",
  "mouseenter",
  "mouseleave",
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointerover",
  "pointerout",
  "pointerenter",
  "pointerleave",
  "pointercancel",
  "gotpointercapture",
  "lostpointercapture",
  "keydown",
  "keyup",
  "keypress",
  "beforeinput",
  "input",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
  "dragstart",
  "dragover",
  "drop",
  "selectstart",
  "submit",
] as const);

export type ContentInputEventType = typeof CONTENT_INPUT_EVENTS[number];

export const NATIVE_SCROLL_INPUT_EVENTS = Object.freeze([
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
] as const satisfies readonly ContentInputEventType[]);

/** Non-bubbling enter/leave and scroll events cannot escape an extension root.
 * Every other event is stopped at that root after its controls have handled it. */
export const EXTENSION_BOUNDARY_INPUT_EVENTS = Object.freeze(CONTENT_INPUT_EVENTS.filter((type) =>
  type !== "mouseenter" &&
  type !== "mouseleave" &&
  type !== "pointerenter" &&
  type !== "pointerleave"
));

const NATIVE_SCROLL_EVENTS = new Set<string>(NATIVE_SCROLL_INPUT_EVENTS);
const TOUCH_POINTER_SCROLL_EVENTS = new Set<string>([
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
]);

export type ContentInputDisposition = "extension" | "native-scroll" | "blocked";
export type ContentInputTarget = "page" | "shield" | "extension";

export type ContentInputPolicy = Readonly<{
  disposition: ContentInputDisposition;
  preventDefault: boolean;
  stopPropagation: boolean;
  stopImmediatePropagation: boolean;
}>;

export function contentInputPolicy(
  type: string,
  target: ContentInputTarget,
  cancelable = true,
  pointerType?: string,
): ContentInputPolicy {
  if (target === "extension") {
    return {
      disposition: "extension",
      preventDefault: false,
      stopPropagation: false,
      stopImmediatePropagation: false,
    };
  }
  if (
    NATIVE_SCROLL_EVENTS.has(type) ||
    (pointerType === "touch" && TOUCH_POINTER_SCROLL_EVENTS.has(type))
  ) {
    return {
      disposition: "native-scroll",
      preventDefault: false,
      stopPropagation: true,
      stopImmediatePropagation: true,
    };
  }
  return {
    disposition: "blocked",
    preventDefault: cancelable,
    stopPropagation: true,
    stopImmediatePropagation: true,
  };
}

/** Blocks page listeners at capture time. For wheel/touch gestures it deliberately
 * does not prevent the browser default, so the document still scrolls without
 * letting page-owned carousels, drawers, or gesture handlers react. */
export function filterContentInput(
  event: Pick<Event, "type" | "cancelable" | "preventDefault" | "stopPropagation"> &
    Readonly<{
      pointerType?: string;
      stopImmediatePropagation?: () => void;
    }>,
  target: boolean | ContentInputTarget,
): ContentInputDisposition {
  const targetKind = typeof target === "boolean"
    ? target ? "extension" : "page"
    : target;
  const policy = contentInputPolicy(
    event.type,
    targetKind,
    event.cancelable !== false,
    event.pointerType,
  );
  if (policy.preventDefault) {
    event.preventDefault();
  }
  if (policy.stopPropagation) {
    event.stopPropagation();
  }
  if (policy.stopImmediatePropagation) {
    event.stopImmediatePropagation?.();
  }
  return policy.disposition;
}

/** Install at an extension surface's bubble boundary. Target handlers and
 * delegated handlers on that surface still run; page-owned ancestors do not. */
export function isolateExtensionInput(
  event: Pick<Event, "stopPropagation">,
): ContentInputDisposition {
  event.stopPropagation();
  return "extension";
}

export function shouldBlockPageInput(
  presentation: Pick<ContentPresentation, "pageInputBlocked">,
  silentHighlightsActive: boolean,
): boolean {
  return presentation.pageInputBlocked || silentHighlightsActive;
}
