const EXTENSION_CAPTURE_CLASSES = new Set([
  "uf-cursor-exclude",
  "uf-cursor-include",
  "uf-cursor-passthrough",
  "uf-cursor-disabled",
]);

export function sanitizeCaptureClassValue(value: string): string {
  return value
    .split(/\s+/)
    .filter((className) => className.length > 0 && !EXTENSION_CAPTURE_CLASSES.has(className))
    .join(" ");
}
