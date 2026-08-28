export type InteractionShieldCaptureState = Readonly<{
  hadStyleAttribute: boolean;
  display: Readonly<{
    value: string;
    priority: string;
  }>;
  pointerEvents: Readonly<{
    value: string;
    priority: string;
  }>;
  inertAttribute: string | null;
}>;

const captureStateByElement = new WeakMap<Element, InteractionShieldCaptureState>();

/**
 * Records the page-owned values that the interaction shield is about to
 * replace. The ledger stays outside the DOM so it can never become an
 * extraction artifact itself.
 */
export function rememberInteractionShieldCaptureState(
  element: Element,
  state: InteractionShieldCaptureState,
): void {
  if (!captureStateByElement.has(element)) {
    captureStateByElement.set(element, state);
  }
}

export function forgetInteractionShieldCaptureState(element: Element): void {
  captureStateByElement.delete(element);
}

function restorePropertyWithoutCssom(
  baseStyle: string | null,
  property: string,
  value: string,
  priority: string,
): string | null {
  const escapedName = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let restored = (baseStyle ?? "").replace(
    new RegExp(`(^|;)\\s*${escapedName}\\s*:[^;]*(?=;|$)`, "gi"),
    "$1",
  );
  restored = restored
    .replace(/;\s*;+/g, ";")
    .replace(/^;\s*|;\s*$/g, "")
    .trim();
  if (value) {
    restored = `${restored}${restored ? "; " : ""}${property}: ${value}${priority ? ` !${priority}` : ""}`;
  }
  return restored || null;
}

/** Returns the inline style as it would be without the shield-owned override. */
export function restoreInteractionShieldStyleForCapture(
  element: Element,
  baseStyle: string | null = element.getAttribute("style"),
): string | null {
  const state = captureStateByElement.get(element);
  if (!state) {
    return baseStyle;
  }

  const scratch = element.ownerDocument?.createElement("span");
  if (!scratch?.style || typeof scratch.style.setProperty !== "function") {
    const displayRestored = restorePropertyWithoutCssom(
      baseStyle,
      "display",
      state.display.value,
      state.display.priority,
    );
    const restored = restorePropertyWithoutCssom(
      displayRestored,
      "pointer-events",
      state.pointerEvents.value,
      state.pointerEvents.priority,
    );
    return restored ?? (state.hadStyleAttribute ? "" : null);
  }

  if (baseStyle !== null) {
    scratch.setAttribute("style", baseStyle);
  }
  if (state.display.value) {
    scratch.style.setProperty(
      "display",
      state.display.value,
      state.display.priority,
    );
  } else {
    scratch.style.removeProperty("display");
  }
  if (state.pointerEvents.value) {
    scratch.style.setProperty(
      "pointer-events",
      state.pointerEvents.value,
      state.pointerEvents.priority,
    );
  } else {
    scratch.style.removeProperty("pointer-events");
  }
  const restored = scratch.getAttribute("style");
  if (restored === null || restored.trim() === "") {
    return state.hadStyleAttribute ? "" : null;
  }
  return restored;
}

/** Returns the page-owned inert attribute, including its exact authored value. */
export function restoreInteractionShieldInertForCapture(
  element: Element,
  baseValue: string | null = element.getAttribute("inert"),
): string | null {
  const state = captureStateByElement.get(element);
  return state ? state.inertAttribute : baseValue;
}
