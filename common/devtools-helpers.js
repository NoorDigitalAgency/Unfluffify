/**
 * Formats a source label for display in DevTools panels.
 * @param {string} source - The source identifier
 * @returns {string} The formatted source label
 */
export function formatSourceLabel(source) {
  const normalized = typeof source === "string" ? source.trim() : "";
  if (normalized === "popup") return "popup.html";
  if (normalized === "worker") return "background worker";
  if (normalized === "content") return "page content script";
  return normalized || "extension";
}
