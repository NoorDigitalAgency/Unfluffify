import {
  arraysEqual,
  idbGet,
  idbSet,
  normalizeBaseUrl,
  normalizeCanonicalBaseUrl
} from "./utilities.js";

/** Fallback timestamp for pages with no recorded data */
export const PAGE_TIMESTAMP_FALLBACK = "1970-01-01T00:00:00Z";
const SERVER_SYNC_VERSION = 1;
/** Render mode for static HTML content */
export const RENDER_MODE_STATIC = "static";
/** Render mode for rendered/JavaScript content */
export const RENDER_MODE_RENDERED = "rendered";
/** Default render mode is static */
export const DEFAULT_RENDER_MODE = RENDER_MODE_STATIC;
const SELECTOR_SET_TIMESTAMP_FIELDS = {
  latestComputedSelectors: "latestComputedSelectorsUpdatedAt",
  lastSavedSelectors: "lastSavedSelectorsUpdatedAt",
  domainAiSelectorSet: "domainAiSelectorSetUpdatedAt"
};

/**
 * Normalizes a render mode value to either 'static' or 'rendered'.
 * @param {string} value - The render mode value to normalize
 * @returns {string} Either RENDER_MODE_STATIC or RENDER_MODE_RENDERED
 */
export function normalizeRenderMode(value) {
  if (typeof value !== "string") {
    return DEFAULT_RENDER_MODE;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed === RENDER_MODE_RENDERED
    ? RENDER_MODE_RENDERED
    : DEFAULT_RENDER_MODE;
}

/**
 * Gets the render mode from a source config object.
 * @param {Object} sourceConfig - The configuration object
 * @returns {string} The render mode from the config or DEFAULT_RENDER_MODE
 */
export function getConfigRenderMode(sourceConfig) {
  if (!sourceConfig || typeof sourceConfig !== "object") {
    return DEFAULT_RENDER_MODE;
  }
  return normalizeRenderMode(sourceConfig.renderMode);
}

function normalizeSiteIdValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function parseTimestampMillis(value) {
  if (typeof value !== "string") {
    return Number.NaN;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return Number.NaN;
  }
  const hasExplicitTimezone = /(?:z|[+\-]\d{2}:?\d{2})$/i.test(trimmed);
  const parseValue = hasExplicitTimezone ? trimmed : `${trimmed}Z`;
  const parsed = Date.parse(parseValue);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }
  return parsed;
}

function toTimestampMillis(value) {
  const parsed = parseTimestampMillis(value);
  if (!Number.isFinite(parsed)) {
    return Number.NEGATIVE_INFINITY;
  }
  return parsed;
}

function toUtcTimestampString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * Creates a timestamp string for the current time in UTC format (YYYY-MM-DDTHH:mm:ssZ).
 * @returns {string} Current timestamp in UTC format
 */
export function createTimestampNow() {
  return toUtcTimestampString(new Date());
}

/**
 * Normalizes an entry timestamp to a standard UTC format.
 * If the timestamp is invalid, returns the fallback timestamp.
 * @param {string|Date|number} value - The timestamp value to normalize
 * @returns {string} Normalized timestamp in UTC format (YYYY-MM-DDTHH:mm:ssZ)
 */
export function normalizeEntryTimestamp(value) {
  const parsed = parseTimestampMillis(value);
  if (!Number.isFinite(parsed)) {
    return PAGE_TIMESTAMP_FALLBACK;
  }
  return toUtcTimestampString(parsed);
}

/**
 * Checks if an incoming timestamp is newer than a local timestamp.
 * @param {string|Date|number} incomingTimestamp - The incoming timestamp
 * @param {string|Date|number} localTimestamp - The local timestamp to compare
 * @returns {boolean} True if incomingTimestamp is newer than localTimestamp
 */
export function isIncomingTimestampNewer(incomingTimestamp, localTimestamp) {
  return toTimestampMillis(incomingTimestamp) > toTimestampMillis(localTimestamp);
}

export function mergeRenderModeByTimestamp(
  existingMode,
  existingUpdatedAt,
  incomingMode,
  incomingUpdatedAt
) {
  const normalizedExistingMode = normalizeRenderMode(existingMode);
  const normalizedIncomingMode = normalizeRenderMode(incomingMode);
  const normalizedExistingUpdatedAt = normalizeEntryTimestamp(existingUpdatedAt);
  const normalizedIncomingUpdatedAt = normalizeEntryTimestamp(incomingUpdatedAt);

  if (isIncomingTimestampNewer(normalizedIncomingUpdatedAt, normalizedExistingUpdatedAt)) {
    return {
      renderMode: normalizedIncomingMode,
      updatedAt: normalizedIncomingUpdatedAt
    };
  }
  if (isIncomingTimestampNewer(normalizedExistingUpdatedAt, normalizedIncomingUpdatedAt)) {
    return {
      renderMode: normalizedExistingMode,
      updatedAt: normalizedExistingUpdatedAt
    };
  }
  if (normalizedExistingMode !== normalizedIncomingMode) {
    return {
      renderMode: normalizedIncomingMode,
      updatedAt: normalizedIncomingUpdatedAt
    };
  }
  return {
    renderMode: normalizedExistingMode,
    updatedAt: normalizedExistingUpdatedAt
  };
}

function normalizeUniqueXpathList(list) {
  const values = [];
  const seen = new Set();
  let changed = false;
  for (const value of Array.isArray(list) ? list : []) {
    if (typeof value !== "string") {
      changed = true;
      continue;
    }
    const xpath = value.trim();
    if (!xpath) {
      changed = true;
      continue;
    }
    if (xpath !== value) {
      changed = true;
    }
    if (seen.has(xpath)) {
      changed = true;
      continue;
    }
    seen.add(xpath);
    values.push(xpath);
  }
  return { values, changed };
}

function normalizeXpathItems(rawXpaths) {
  const parsed = [];
  let changed = false;
  for (const item of Array.isArray(rawXpaths) ? rawXpaths : []) {
    if (item && typeof item.xpath === "string") {
      const xpath = item.xpath.trim();
      if (!xpath) {
        changed = true;
        continue;
      }
      const excluded = Boolean(item.excluded);
      if (xpath !== item.xpath || item.excluded !== excluded) {
        changed = true;
      }
      parsed.push({ xpath, excluded });
      continue;
    }
    changed = true;
  }
  const seen = new Set();
  const values = [];
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    const item = parsed[i];
    if (seen.has(item.xpath)) {
      changed = true;
      continue;
    }
    seen.add(item.xpath);
    values.unshift(item);
  }
  return { values, changed };
}

function normalizeSelectorList(list) {
  const values = [];
  const seen = new Set();
  let changed = false;
  if (!Array.isArray(list)) {
    return { values, changed: true };
  }
  for (const value of list) {
    if (typeof value !== "string") {
      changed = true;
      continue;
    }
    const selector = value.trim();
    if (!selector) {
      changed = true;
      continue;
    }
    if (selector !== value) {
      changed = true;
    }
    if (seen.has(selector)) {
      changed = true;
      continue;
    }
    seen.add(selector);
    values.push(selector);
  }
  return { values, changed };
}

export function createEmptyAiSelectorSet() {
  return { exclusionSelectors: [], inclusionSelectors: [] };
}

function cloneAiSelectorSet(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet).normalized;
  return {
    exclusionSelectors: normalized.exclusionSelectors.slice(),
    inclusionSelectors: normalized.inclusionSelectors.slice()
  };
}

function hasAnySelectors(selectorSet) {
  return Boolean(
    selectorSet &&
      (
        (Array.isArray(selectorSet.exclusionSelectors) &&
          selectorSet.exclusionSelectors.length > 0) ||
        (Array.isArray(selectorSet.inclusionSelectors) &&
          selectorSet.inclusionSelectors.length > 0)
      )
  );
}

function selectorSetsEqual(left, right) {
  const normalizedLeft = normalizeAiSelectorSet(left).normalized;
  const normalizedRight = normalizeAiSelectorSet(right).normalized;
  return (
    arraysEqual(normalizedLeft.exclusionSelectors, normalizedRight.exclusionSelectors) &&
    arraysEqual(normalizedLeft.inclusionSelectors, normalizedRight.inclusionSelectors)
  );
}

export function getSelectorSetTimestampFieldName(fieldName) {
  return SELECTOR_SET_TIMESTAMP_FIELDS[fieldName] || "";
}

export function isSelectorSetCurrentForRenderMode(sourceConfig, fieldName) {
  if (!sourceConfig || typeof sourceConfig !== "object") {
    return false;
  }
  const timestampFieldName = getSelectorSetTimestampFieldName(fieldName);
  if (!timestampFieldName) {
    return false;
  }
  const selectorUpdatedAt = normalizeEntryTimestamp(sourceConfig[timestampFieldName]);
  const renderModeUpdatedAt = normalizeEntryTimestamp(sourceConfig.renderModeUpdatedAt);
  return !isIncomingTimestampNewer(renderModeUpdatedAt, selectorUpdatedAt);
}

export function mergeSelectorSetsByTimestamp(
  existingSet,
  existingUpdatedAt,
  incomingSet,
  incomingUpdatedAt
) {
  const normalizedExistingSet = normalizeAiSelectorSet(existingSet).normalized;
  const normalizedIncomingSet = normalizeAiSelectorSet(incomingSet).normalized;
  const normalizedExistingUpdatedAt = normalizeEntryTimestamp(existingUpdatedAt);
  const normalizedIncomingUpdatedAt = normalizeEntryTimestamp(incomingUpdatedAt);

  if (isIncomingTimestampNewer(normalizedIncomingUpdatedAt, normalizedExistingUpdatedAt)) {
    return {
      selectorSet: cloneAiSelectorSet(normalizedIncomingSet),
      updatedAt: normalizedIncomingUpdatedAt
    };
  }
  if (isIncomingTimestampNewer(normalizedExistingUpdatedAt, normalizedIncomingUpdatedAt)) {
    return {
      selectorSet: cloneAiSelectorSet(normalizedExistingSet),
      updatedAt: normalizedExistingUpdatedAt
    };
  }

  const incomingHasSelectors = hasAnySelectors(normalizedIncomingSet);
  const existingHasSelectors = hasAnySelectors(normalizedExistingSet);
  if (incomingHasSelectors !== existingHasSelectors) {
    return incomingHasSelectors
      ? {
        selectorSet: cloneAiSelectorSet(normalizedIncomingSet),
        updatedAt: normalizedIncomingUpdatedAt
      }
      : {
        selectorSet: cloneAiSelectorSet(normalizedExistingSet),
        updatedAt: normalizedExistingUpdatedAt
      };
  }

  if (!selectorSetsEqual(normalizedExistingSet, normalizedIncomingSet)) {
    return {
      selectorSet: cloneAiSelectorSet(normalizedIncomingSet),
      updatedAt: normalizedIncomingUpdatedAt
    };
  }

  return {
    selectorSet: cloneAiSelectorSet(normalizedExistingSet),
    updatedAt: normalizedExistingUpdatedAt
  };
}

export function getNewestConfigSelectorSet(
  sourceConfig,
  fieldNames = ["latestComputedSelectors", "domainAiSelectorSet", "lastSavedSelectors"]
) {
  let mergedSelectorSet = createEmptyAiSelectorSet();
  let mergedUpdatedAt = PAGE_TIMESTAMP_FALLBACK;

  for (const fieldName of Array.isArray(fieldNames) ? fieldNames : []) {
    if (typeof fieldName !== "string" || !fieldName) {
      continue;
    }
    const timestampFieldName = getSelectorSetTimestampFieldName(fieldName);
    const selectorSetIsCurrent = isSelectorSetCurrentForRenderMode(sourceConfig, fieldName);
    const merged = mergeSelectorSetsByTimestamp(
      mergedSelectorSet,
      mergedUpdatedAt,
      selectorSetIsCurrent && sourceConfig && typeof sourceConfig === "object"
        ? sourceConfig[fieldName]
        : null,
      timestampFieldName &&
        selectorSetIsCurrent &&
        sourceConfig &&
        typeof sourceConfig === "object"
        ? sourceConfig[timestampFieldName]
        : null
    );
    mergedSelectorSet = merged.selectorSet;
    mergedUpdatedAt = merged.updatedAt;
  }

  return {
    selectorSet: mergedSelectorSet,
    updatedAt: mergedUpdatedAt
  };
}

export function createDefaultConfig(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
  let domain = "";
  try {
    domain = new URL(normalizedBaseUrl).hostname;
  } catch (error) {
    domain = "";
  }
  return {
    baseUrl: normalizedBaseUrl,
    domain,
    siteId: null,
    renderMode: DEFAULT_RENDER_MODE,
    renderModeUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
    pageMarkings: {},
    latestComputedSelectors: createEmptyAiSelectorSet(),
    latestComputedSelectorsUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
    lastSavedSelectors: createEmptyAiSelectorSet(),
    lastSavedSelectorsUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
    domainAiSelectorSet: createEmptyAiSelectorSet(),
    domainAiSelectorSetUpdatedAt: PAGE_TIMESTAMP_FALLBACK
  };
}

export function normalizePageMarkings(
  pageMarkings,
  fallbackRenderMode = DEFAULT_RENDER_MODE
) {
  const normalized = {};
  let changed = false;
  if (!pageMarkings || typeof pageMarkings !== "object") {
    return { normalized, changed };
  }
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    if (!url || !entry || typeof entry !== "object") {
      changed = true;
      return;
    }
    if (!Array.isArray(entry.xpaths) && entry.xpaths !== undefined) {
      changed = true;
    }
    const rawXpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const normalizedXpaths = normalizeXpathItems(rawXpaths);
    const xpaths = normalizedXpaths.values;
    if (normalizedXpaths.changed) {
      changed = true;
    }
    const timestamp = normalizeEntryTimestamp(entry.timestamp);
    if (entry.timestamp !== timestamp) {
      changed = true;
    }
    const hasRenderedHtml = typeof entry.renderedHtml === "string";
    const hasLegacyFullHtml = typeof entry.fullHtml === "string";
    const hasLegacyFullHTML = typeof entry.fullHTML === "string";
    const renderedHtml = hasRenderedHtml
      ? entry.renderedHtml
      : hasLegacyFullHtml
          ? entry.fullHtml
          : hasLegacyFullHTML
            ? entry.fullHTML
            : "";
    const renderedHtmlValues = [];
    if (hasRenderedHtml) {
      renderedHtmlValues.push(entry.renderedHtml);
    }
    if (hasLegacyFullHtml) {
      renderedHtmlValues.push(entry.fullHtml);
    }
    if (hasLegacyFullHTML) {
      renderedHtmlValues.push(entry.fullHTML);
    }
    const hasRawHtml = typeof entry.rawHtml === "string";
    const hasLegacyRawHTML = typeof entry.rawHTML === "string";
    const rawHtml = hasRawHtml
      ? entry.rawHtml
      : hasLegacyRawHTML
        ? entry.rawHTML
        : "";
    if (
      (entry.renderedHtml !== undefined && typeof entry.renderedHtml !== "string") ||
      entry.fullHtml !== undefined ||
      entry.fullHTML !== undefined ||
      (entry.fullHTML !== undefined && typeof entry.fullHTML !== "string") ||
      (entry.fullHtml !== undefined && typeof entry.fullHtml !== "string") ||
      new Set(renderedHtmlValues).size > 1
    ) {
      changed = true;
    }
    if (
      entry.rawHTML !== undefined ||
      (entry.rawHTML !== undefined && typeof entry.rawHTML !== "string") ||
      (entry.rawHtml !== undefined && typeof entry.rawHtml !== "string") ||
      (hasRawHtml && hasLegacyRawHTML && entry.rawHtml !== entry.rawHTML)
    ) {
      changed = true;
    }
    if (!Array.isArray(entry.consentXpaths) && entry.consentXpaths !== undefined) {
      changed = true;
    }
    const rawConsent = Array.isArray(entry.consentXpaths) ? entry.consentXpaths : [];
    const consentResult = normalizeUniqueXpathList(rawConsent);
    const consentXpaths = consentResult.values;
    if (consentResult.changed) {
      changed = true;
    }
    if (!Array.isArray(entry.includeXpaths) && entry.includeXpaths !== undefined) {
      changed = true;
    }
    const rawInclude = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
    const includeResult = normalizeUniqueXpathList(rawInclude);
    const includeXpaths = includeResult.values;
    if (includeResult.changed) {
      changed = true;
    }
    if (!Array.isArray(entry.submissionXpaths) && entry.submissionXpaths !== undefined) {
      changed = true;
    }
    const rawSubmission = Array.isArray(entry.submissionXpaths)
      ? entry.submissionXpaths
      : [];
    const normalizedSubmission = normalizeXpathItems(rawSubmission);
    const submissionXpaths = normalizedSubmission.values;
    if (normalizedSubmission.changed) {
      changed = true;
    }
    if (entry.renderMode !== undefined) {
      changed = true;
    }
    normalized[url] = {
      url: entry.url || url,
      title: entry.title || url,
      timestamp,
      xpaths,
      consentXpaths,
      includeXpaths,
      submissionXpaths,
      renderedHtml,
      rawHtml
    };
  });
  return { normalized, changed };
}

export function normalizeAiSelectorSet(value) {
  const normalized = createEmptyAiSelectorSet();
  let changed = true;
  if (!value || typeof value !== "object") {
    return { normalized, changed };
  }
  changed = false;

  const exclusionResult = normalizeSelectorList(value.exclusionSelectors);
  normalized.exclusionSelectors = exclusionResult.values;
  if (exclusionResult.changed) {
    changed = true;
  }

  const inclusionResult = normalizeSelectorList(value.inclusionSelectors);
  normalized.inclusionSelectors = inclusionResult.values;
  if (inclusionResult.changed) {
    changed = true;
  }

  if (!Array.isArray(value.exclusionSelectors) || !Array.isArray(value.inclusionSelectors)) {
    changed = true;
  }

  return { normalized, changed };
}

export function normalizeConfig(baseUrl, incoming) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
  let changed = false;
  const defaultConfig = createDefaultConfig(normalizedBaseUrl);
  let normalized = { ...defaultConfig };

  if (!incoming) {
    return { config: normalized, changed: true };
  }

  if (typeof incoming.domain === "string") {
    normalized.domain = incoming.domain;
  }
  normalized.renderMode = normalizeRenderMode(incoming.renderMode);
  if (incoming.renderMode !== undefined && normalized.renderMode !== incoming.renderMode) {
    changed = true;
  }
  normalized.renderModeUpdatedAt = normalizeEntryTimestamp(incoming.renderModeUpdatedAt);
  if (
    incoming.renderModeUpdatedAt !== undefined &&
    normalized.renderModeUpdatedAt !== incoming.renderModeUpdatedAt
  ) {
    changed = true;
  }
  const siteId = normalizeSiteIdValue(incoming.siteId);
  normalized.siteId = siteId;
  if (incoming.siteId !== undefined && siteId !== incoming.siteId) {
    changed = true;
  }
  if (incoming.siteId === undefined && normalized.siteId !== defaultConfig.siteId) {
    changed = true;
  }
  if (typeof incoming.pageMarkings === "object" && incoming.pageMarkings !== null) {
    const result = normalizePageMarkings(incoming.pageMarkings);
    normalized.pageMarkings = result.normalized;
    if (result.changed) {
      changed = true;
    }
  } else if (incoming.pageMarkings !== undefined) {
    changed = true;
  }
  const latestComputed = normalizeAiSelectorSet(incoming.latestComputedSelectors);
  normalized.latestComputedSelectors = latestComputed.normalized;
  if (latestComputed.changed) {
    changed = true;
  }
  normalized.latestComputedSelectorsUpdatedAt = normalizeEntryTimestamp(
    incoming.latestComputedSelectorsUpdatedAt
  );
  if (
    incoming.latestComputedSelectorsUpdatedAt !== undefined &&
    normalized.latestComputedSelectorsUpdatedAt !== incoming.latestComputedSelectorsUpdatedAt
  ) {
    changed = true;
  }
  const lastSaved = normalizeAiSelectorSet(incoming.lastSavedSelectors);
  normalized.lastSavedSelectors = lastSaved.normalized;
  if (lastSaved.changed) {
    changed = true;
  }
  normalized.lastSavedSelectorsUpdatedAt = normalizeEntryTimestamp(
    incoming.lastSavedSelectorsUpdatedAt
  );
  if (
    incoming.lastSavedSelectorsUpdatedAt !== undefined &&
    normalized.lastSavedSelectorsUpdatedAt !== incoming.lastSavedSelectorsUpdatedAt
  ) {
    changed = true;
  }
  const aiSelectors = normalizeAiSelectorSet(incoming.domainAiSelectorSet);
  normalized.domainAiSelectorSet = aiSelectors.normalized;
  if (aiSelectors.changed) {
    changed = true;
  }
  normalized.domainAiSelectorSetUpdatedAt = normalizeEntryTimestamp(
    incoming.domainAiSelectorSetUpdatedAt
  );
  if (
    incoming.domainAiSelectorSetUpdatedAt !== undefined &&
    normalized.domainAiSelectorSetUpdatedAt !== incoming.domainAiSelectorSetUpdatedAt
  ) {
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "aiSelectorModifiers")) {
    changed = true;
  }

  return { config: normalized, changed };
}

export function isRenderModeConfirmed(sourceConfig) {
  if (!sourceConfig || typeof sourceConfig !== "object") {
    return false;
  }
  return normalizeEntryTimestamp(sourceConfig.renderModeUpdatedAt) !== PAGE_TIMESTAMP_FALLBACK;
}

function cloneNormalizedPageEntry(
  entry,
  fallbackUrl = "",
  fallbackRenderMode = DEFAULT_RENDER_MODE
) {
  const normalized = normalizePageMarkings({
    [fallbackUrl || (entry && entry.url) || ""]: entry || {}
  }, fallbackRenderMode).normalized;
  const key = Object.keys(normalized)[0];
  return key ? normalized[key] : {
    url: fallbackUrl || "",
    title: fallbackUrl || "",
    timestamp: PAGE_TIMESTAMP_FALLBACK,
    xpaths: [],
    consentXpaths: [],
    includeXpaths: [],
    submissionXpaths: [],
    renderedHtml: "",
    rawHtml: ""
  };
}

export function normalizeConfigSyncPayload(payload, fallbackBaseUrl = "") {
  const normalizedFallbackBaseUrl =
    normalizeCanonicalBaseUrl(fallbackBaseUrl) ||
    normalizeBaseUrl(fallbackBaseUrl) ||
    fallbackBaseUrl ||
    "";
  if (!payload || typeof payload !== "object") {
    return {
      version: SERVER_SYNC_VERSION,
      baseUrl: normalizedFallbackBaseUrl,
      siteId: null,
      renderMode: DEFAULT_RENDER_MODE,
      renderModeUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
      pageMarkings: {},
      latestComputedSelectors: createEmptyAiSelectorSet(),
      latestComputedSelectorsUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
      lastSavedSelectors: createEmptyAiSelectorSet(),
      lastSavedSelectorsUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
      domainAiSelectorSet: createEmptyAiSelectorSet(),
      domainAiSelectorSetUpdatedAt: PAGE_TIMESTAMP_FALLBACK
    };
  }
  const baseUrl =
    normalizeCanonicalBaseUrl(typeof payload.baseUrl === "string" ? payload.baseUrl : "") ||
    normalizeBaseUrl(typeof payload.baseUrl === "string" ? payload.baseUrl : "") ||
    normalizedFallbackBaseUrl;
  const renderMode = normalizeRenderMode(payload.renderMode);
  const normalizedMarkings = normalizePageMarkings(payload.pageMarkings);
  const latestComputedSelectors = normalizeAiSelectorSet(payload.latestComputedSelectors).normalized;
  const lastSavedSelectors = normalizeAiSelectorSet(payload.lastSavedSelectors).normalized;
  const domainAiSelectorSet = normalizeAiSelectorSet(payload.domainAiSelectorSet).normalized;
  return {
    version:
      typeof payload.version === "number" && Number.isFinite(payload.version)
        ? payload.version
        : SERVER_SYNC_VERSION,
    baseUrl,
    siteId: normalizeSiteIdValue(payload.siteId),
    renderMode,
    renderModeUpdatedAt: normalizeEntryTimestamp(payload.renderModeUpdatedAt),
    pageMarkings: normalizedMarkings.normalized,
    latestComputedSelectors,
    latestComputedSelectorsUpdatedAt: normalizeEntryTimestamp(
      payload.latestComputedSelectorsUpdatedAt
    ),
    lastSavedSelectors,
    lastSavedSelectorsUpdatedAt: normalizeEntryTimestamp(payload.lastSavedSelectorsUpdatedAt),
    domainAiSelectorSet,
    domainAiSelectorSetUpdatedAt: normalizeEntryTimestamp(
      payload.domainAiSelectorSetUpdatedAt
    )
  };
}

export function createConfigSyncPayload(baseUrl, sourceConfig) {
  const normalizedBaseUrl =
    normalizeCanonicalBaseUrl(baseUrl) ||
    normalizeBaseUrl(baseUrl) ||
    (typeof baseUrl === "string" ? baseUrl : "");
  const normalized = normalizeConfig(normalizedBaseUrl, sourceConfig).config;
  const pageMarkings = normalized.pageMarkings || {};
  const payloadMarkings = {};
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    const safeEntry = cloneNormalizedPageEntry(entry, url);
    payloadMarkings[url] = {
      timestamp: normalizeEntryTimestamp(safeEntry.timestamp),
      url: safeEntry.url || url,
      title: safeEntry.title || url,
      renderedHtml:
        typeof safeEntry.renderedHtml === "string" ? safeEntry.renderedHtml : "",
      rawHtml: typeof safeEntry.rawHtml === "string" ? safeEntry.rawHtml : "",
      xpaths: Array.isArray(safeEntry.xpaths)
        ? safeEntry.xpaths.map((item) => ({
          xpath: item && typeof item.xpath === "string" ? item.xpath : "",
          excluded: Boolean(item && item.excluded)
        })).filter((item) => item.xpath)
        : [],
      consentXpaths: Array.isArray(safeEntry.consentXpaths)
        ? safeEntry.consentXpaths.filter((xpath) => typeof xpath === "string" && xpath)
        : [],
      includeXpaths: Array.isArray(safeEntry.includeXpaths)
        ? safeEntry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
        : [],
      submissionXpaths: Array.isArray(safeEntry.submissionXpaths)
        ? safeEntry.submissionXpaths
          .map((item) => ({
            xpath: item && typeof item.xpath === "string" ? item.xpath : "",
            excluded: Boolean(item && item.excluded)
          }))
          .filter((item) => item.xpath)
        : []
    };
  });
  return {
    version: SERVER_SYNC_VERSION,
    baseUrl: normalizedBaseUrl,
    siteId: normalizeSiteIdValue(normalized.siteId),
    renderMode: getConfigRenderMode(normalized),
    renderModeUpdatedAt: normalizeEntryTimestamp(normalized.renderModeUpdatedAt),
    pageMarkings: payloadMarkings,
    latestComputedSelectors: cloneAiSelectorSet(normalized.latestComputedSelectors),
    latestComputedSelectorsUpdatedAt: normalizeEntryTimestamp(
      normalized.latestComputedSelectorsUpdatedAt
    ),
    lastSavedSelectors: cloneAiSelectorSet(normalized.lastSavedSelectors),
    lastSavedSelectorsUpdatedAt: normalizeEntryTimestamp(normalized.lastSavedSelectorsUpdatedAt),
    domainAiSelectorSet: cloneAiSelectorSet(normalized.domainAiSelectorSet),
    domainAiSelectorSetUpdatedAt: normalizeEntryTimestamp(
      normalized.domainAiSelectorSetUpdatedAt
    )
  };
}

export function mergePageMarkingsByTimestamp(localPageMarkings, incomingPageMarkings) {
  const localNormalized = normalizePageMarkings(localPageMarkings).normalized;
  const incomingNormalized = normalizePageMarkings(incomingPageMarkings).normalized;
  const merged = { ...localNormalized };
  const replacedUrls = [];
  const replacedExistingUrls = [];

  const hasSnapshotData = (entry) =>
    Boolean(
      entry &&
        (
          (typeof entry.renderedHtml === "string" && entry.renderedHtml.length > 0) ||
          (typeof entry.rawHtml === "string" && entry.rawHtml.length > 0) ||
          (Array.isArray(entry.submissionXpaths) && entry.submissionXpaths.length > 0)
        )
    );

  Object.entries(incomingNormalized).forEach(([url, incomingEntry]) => {
    const localEntry = merged[url];
    if (!localEntry) {
      merged[url] = cloneNormalizedPageEntry(incomingEntry, url);
      replacedUrls.push(url);
      return;
    }
    const timestampsMatch =
      normalizeEntryTimestamp(incomingEntry.timestamp) === normalizeEntryTimestamp(localEntry.timestamp);
    const incomingHasRicherSnapshot =
      timestampsMatch && hasSnapshotData(incomingEntry) && !hasSnapshotData(localEntry);
    if (
      !isIncomingTimestampNewer(incomingEntry.timestamp, localEntry.timestamp) &&
      !incomingHasRicherSnapshot
    ) {
      return;
    }
    merged[url] = cloneNormalizedPageEntry(incomingEntry, url);
    replacedUrls.push(url);
    replacedExistingUrls.push(url);
  });

  return {
    pageMarkings: merged,
    replacedUrls,
    replacedExistingUrls
  };
}

export async function getConfigs() {
  const result = await idbGet("configs");
  const rawConfigs = result.configs || {};
  const normalizedConfigs = {};
  Object.entries(rawConfigs).forEach(([key, value]) => {
    const normalizedKey = normalizeBaseUrl(key) || key;
    if (!normalizedConfigs[normalizedKey]) {
      normalizedConfigs[normalizedKey] = value;
      return;
    }
    const existing = normalizeConfig(normalizedKey, normalizedConfigs[normalizedKey]).config;
    const incoming = normalizeConfig(normalizedKey, value).config;
    const mergedPageMarkings = mergePageMarkingsByTimestamp(
      existing.pageMarkings,
      incoming.pageMarkings
    ).pageMarkings;
    const latestComputedSelectors = mergeSelectorSetsByTimestamp(
      existing.latestComputedSelectors,
      existing.latestComputedSelectorsUpdatedAt,
      incoming.latestComputedSelectors,
      incoming.latestComputedSelectorsUpdatedAt
    );
    const lastSavedSelectors = mergeSelectorSetsByTimestamp(
      existing.lastSavedSelectors,
      existing.lastSavedSelectorsUpdatedAt,
      incoming.lastSavedSelectors,
      incoming.lastSavedSelectorsUpdatedAt
    );
    const domainAiSelectorSet = mergeSelectorSetsByTimestamp(
      existing.domainAiSelectorSet,
      existing.domainAiSelectorSetUpdatedAt,
      incoming.domainAiSelectorSet,
      incoming.domainAiSelectorSetUpdatedAt
    );
    const renderMode = mergeRenderModeByTimestamp(
      existing.renderMode,
      existing.renderModeUpdatedAt,
      incoming.renderMode,
      incoming.renderModeUpdatedAt
    );
    normalizedConfigs[normalizedKey] = {
      ...existing,
      siteId: existing.siteId || incoming.siteId || null,
      renderMode: renderMode.renderMode,
      renderModeUpdatedAt: renderMode.updatedAt,
      pageMarkings: mergedPageMarkings,
      latestComputedSelectors: latestComputedSelectors.selectorSet,
      latestComputedSelectorsUpdatedAt: latestComputedSelectors.updatedAt,
      lastSavedSelectors: lastSavedSelectors.selectorSet,
      lastSavedSelectorsUpdatedAt: lastSavedSelectors.updatedAt,
      domainAiSelectorSet: domainAiSelectorSet.selectorSet,
      domainAiSelectorSetUpdatedAt: domainAiSelectorSet.updatedAt
    };
  });
  return normalizedConfigs;
}

export async function saveConfigs(configs) {
  const normalizedConfigs = {};
  Object.entries(configs || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeBaseUrl(key) || key;
    normalizedConfigs[normalizedKey] = normalizeConfig(normalizedKey, value).config;
  });
  await idbSet({ configs: normalizedConfigs });
}

export async function ensureConfig(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || baseUrl;
  const configs = await getConfigs();
  if (!configs[normalizedBaseUrl]) {
    const defaultConfig = createDefaultConfig(normalizedBaseUrl);
    configs[normalizedBaseUrl] = defaultConfig;
    await saveConfigs(configs);
    return defaultConfig;
  }
  const { config, changed } = normalizeConfig(normalizedBaseUrl, configs[normalizedBaseUrl]);
  if (changed) {
    configs[normalizedBaseUrl] = config;
    await saveConfigs(configs);
  }
  return config;
}

export async function updateConfig(baseUrl, updater) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || baseUrl;
  const configs = await getConfigs();
  const { config } = normalizeConfig(normalizedBaseUrl, configs[normalizedBaseUrl]);
  updater(config);
  configs[normalizedBaseUrl] = config;
  await saveConfigs(configs);
  return config;
}
