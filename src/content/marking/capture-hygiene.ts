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
