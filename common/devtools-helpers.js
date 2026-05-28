export const DEVTOOLS_SOURCE_FILTER_ALL = "all";

const KNOWN_DEVTOOLS_SOURCES = ["worker", "popup", "content", "page", "extension"];

/**
 * Normalizes a source identifier used by the custom DevTools panels.
 * @param {string} source - Raw telemetry source identifier
 * @returns {string} Normalized source value
 */
export function normalizeDevtoolsSource(source) {
  const normalized = typeof source === "string" ? source.trim() : "";
  return normalized || "extension";
}

/**
 * Formats a source label for display in DevTools panels.
 * @param {string} source - The source identifier
 * @returns {string} The formatted source label
 */
export function formatSourceLabel(source) {
  const normalized = normalizeDevtoolsSource(source);
  if (normalized === "popup") return "popup.html";
  if (normalized === "worker") return "background worker";
  if (normalized === "content") return "page content script";
  if (normalized === "page") return "page scripts";
  return normalized;
}

/**
 * Builds source filter options for the custom DevTools panels.
 * @param {Array<object>} entries - Current panel entries
 * @returns {Array<{ value: string, label: string }>} Filter options
 */
export function getDevtoolsSourceFilterOptions(entries = []) {
  const dynamicSources = new Set();

  for (const entry of entries) {
    const normalizedSource = normalizeDevtoolsSource(entry && entry.source);
    if (!KNOWN_DEVTOOLS_SOURCES.includes(normalizedSource)) {
      dynamicSources.add(normalizedSource);
    }
  }

  const sortedDynamicSources = Array.from(dynamicSources).sort((left, right) =>
    formatSourceLabel(left).localeCompare(formatSourceLabel(right))
  );
  const optionValues = [
    DEVTOOLS_SOURCE_FILTER_ALL,
    ...KNOWN_DEVTOOLS_SOURCES,
    ...sortedDynamicSources
  ];

  return optionValues.map((value) => ({
    value,
    label: value === DEVTOOLS_SOURCE_FILTER_ALL ? "All sources" : formatSourceLabel(value)
  }));
}

/**
 * Determines whether an entry should be shown for the selected source filter.
 * @param {object} entry - DevTools panel entry
 * @param {string} selectedSource - Selected filter value
 * @returns {boolean} True when the entry should be displayed
 */
export function matchesDevtoolsSourceFilter(entry, selectedSource) {
  const normalizedFilter = typeof selectedSource === "string" && selectedSource.trim()
    ? selectedSource.trim()
    : DEVTOOLS_SOURCE_FILTER_ALL;

  return normalizedFilter === DEVTOOLS_SOURCE_FILTER_ALL ||
    normalizeDevtoolsSource(entry && entry.source) === normalizedFilter;
}
