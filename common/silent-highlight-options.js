export const SILENT_HIGHLIGHT_OPTIONS_DEFAULTS = Object.freeze({
  markedPages: true,
  includedContent: true,
  excludedContent: false,
  visibleConsent: false,
  hideDuringScrollRedraw: false,
  preferShallowestExclusions: false
});

export function normalizeSilentHighlightOptions(value) {
  if (!value || typeof value !== "object") {
    return { ...SILENT_HIGHLIGHT_OPTIONS_DEFAULTS };
  }
  return {
    markedPages:
      typeof value.markedPages === "boolean"
        ? value.markedPages
        : SILENT_HIGHLIGHT_OPTIONS_DEFAULTS.markedPages,
    includedContent:
      typeof value.includedContent === "boolean"
        ? value.includedContent
        : SILENT_HIGHLIGHT_OPTIONS_DEFAULTS.includedContent,
    excludedContent:
      typeof value.excludedContent === "boolean"
        ? value.excludedContent
        : SILENT_HIGHLIGHT_OPTIONS_DEFAULTS.excludedContent,
    visibleConsent:
      typeof value.visibleConsent === "boolean"
        ? value.visibleConsent
        : SILENT_HIGHLIGHT_OPTIONS_DEFAULTS.visibleConsent,
    hideDuringScrollRedraw:
      typeof value.hideDuringScrollRedraw === "boolean"
        ? value.hideDuringScrollRedraw
        : SILENT_HIGHLIGHT_OPTIONS_DEFAULTS.hideDuringScrollRedraw,
    preferShallowestExclusions:
      typeof value.preferShallowestExclusions === "boolean"
        ? value.preferShallowestExclusions
        : SILENT_HIGHLIGHT_OPTIONS_DEFAULTS.preferShallowestExclusions
  };
}
