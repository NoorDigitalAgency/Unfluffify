const EXTENSION_CAPTURE_CLASSES = new Set([
  "uf-cursor-exclude",
  "uf-cursor-include",
  "uf-cursor-passthrough",
  "uf-cursor-disabled",
]);

/** Page-wide modal postures survive after their blocking subtree is suppressed,
 * but they are not authored content. Keep the live class for exact restoration
 * and remove it only from captured html/body attributes. */
const ROOT_BLOCKING_POSTURE_CLASSES = new Set([
  "noScroll",
  "no-scroll",
  "modal-open",
  "detect-customer-type-country--active",
]);

export const MOTION_CAPTURE_LEDGER_ATTR = "data-uf-motion-lock-ledger";

type MotionCaptureLedger = Readonly<{
  version: 1;
  hadStyleAttribute: boolean;
  properties: ReadonlyArray<Readonly<{ name: string; value: string; priority: string }>>;
}>;

/** Restores extension-owned motion locks only in the capture projection. */
export function restoreMotionStyleForCapture(
  element: Element,
  baseStyle: string | null = element.getAttribute("style"),
): string | null {
  const encoded = element.getAttribute(MOTION_CAPTURE_LEDGER_ATTR);
  if (!encoded) return baseStyle;
  let ledger: MotionCaptureLedger;
  try {
    ledger = JSON.parse(encoded) as MotionCaptureLedger;
    if (ledger.version !== 1 || !Array.isArray(ledger.properties)) return baseStyle;
  } catch {
    return baseStyle;
  }
  const scratch = element.ownerDocument?.createElement("span");
  if (!scratch?.style || typeof scratch.style.setProperty !== "function") {
    let restored = baseStyle ?? "";
    for (const property of ledger.properties) {
      const escapedName = property.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      restored = restored.replace(new RegExp(`(^|;)\\s*${escapedName}\\s*:[^;]*(?=;|$)`, "gi"), "$1");
      if (property.value) {
        restored = `${restored.replace(/;?\s*$/, "")}; ${property.name}: ${property.value}${property.priority ? ` !${property.priority}` : ""}`;
      }
    }
    restored = restored.replace(/^;\s*|;\s*$/g, "").trim();
    return restored || (ledger.hadStyleAttribute ? "" : null);
  }
  if (baseStyle !== null) scratch.setAttribute("style", baseStyle);
  for (const property of ledger.properties) {
    if (!property || typeof property.name !== "string") continue;
    if (property.value) scratch.style.setProperty(property.name, property.value, property.priority || "");
    else scratch.style.removeProperty(property.name);
  }
  const restored = scratch.getAttribute("style");
  if (restored === null || restored.trim() === "") return ledger.hadStyleAttribute ? "" : null;
  return restored;
}

export function sanitizeCaptureClassValue(value: string, tagName?: string): string {
  const rootElement = tagName?.toLowerCase() === "html" || tagName?.toLowerCase() === "body";
  return value
    .split(/\s+/)
    .filter((className) =>
      className.length > 0 &&
      !EXTENSION_CAPTURE_CLASSES.has(className) &&
      (!rootElement || !ROOT_BLOCKING_POSTURE_CLASSES.has(className)))
    .join(" ");
}
