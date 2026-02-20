import { idbGet, idbSet } from "./utilities.js";

const PAGE_TIMESTAMP_FALLBACK = "1970-01-01T00:00:00Z";
const SERVER_SYNC_VERSION = 1;

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

export function createTimestampNow() {
  return toUtcTimestampString(new Date());
}

export function normalizeEntryTimestamp(value) {
  const parsed = parseTimestampMillis(value);
  if (!Number.isFinite(parsed)) {
    return PAGE_TIMESTAMP_FALLBACK;
  }
  return toUtcTimestampString(parsed);
}

export function isIncomingTimestampNewer(incomingTimestamp, localTimestamp) {
  return toTimestampMillis(incomingTimestamp) > toTimestampMillis(localTimestamp);
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

export function createDefaultConfig(baseUrl) {
  let domain = "";
  try {
    domain = new URL(baseUrl).hostname;
  } catch (error) {
    domain = "";
  }
  return {
    baseUrl,
    domain,
    siteId: null,
    pageMarkings: {},
    latestComputedSelectors: createEmptyAiSelectorSet(),
    lastSavedSelectors: createEmptyAiSelectorSet(),
    domainAiSelectorSet: createEmptyAiSelectorSet()
  };
}

export function normalizePageMarkings(pageMarkings) {
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
    const hasFullHtml = typeof entry.fullHtml === "string";
    const hasFullHTML = typeof entry.fullHTML === "string";
    const fullHTML = hasFullHtml
      ? entry.fullHtml
      : hasFullHTML
        ? entry.fullHTML
        : "";
    if (
      (entry.fullHTML !== undefined && typeof entry.fullHTML !== "string") ||
      (entry.fullHtml !== undefined && typeof entry.fullHtml !== "string") ||
      (hasFullHtml && hasFullHTML && entry.fullHtml !== entry.fullHTML)
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
    normalized[url] = {
      url: entry.url || url,
      title: entry.title || url,
      timestamp,
      xpaths,
      consentXpaths,
      includeXpaths,
      submissionXpaths,
      fullHTML
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
  let changed = false;
  const defaultConfig = createDefaultConfig(baseUrl);
  let normalized = { ...defaultConfig };

  if (!incoming) {
    return { config: normalized, changed: true };
  }

  if (typeof incoming.domain === "string") {
    normalized.domain = incoming.domain;
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
  const lastSaved = normalizeAiSelectorSet(incoming.lastSavedSelectors);
  normalized.lastSavedSelectors = lastSaved.normalized;
  if (lastSaved.changed) {
    changed = true;
  }
  const aiSelectors = normalizeAiSelectorSet(incoming.domainAiSelectorSet);
  normalized.domainAiSelectorSet = aiSelectors.normalized;
  if (aiSelectors.changed) {
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "aiSelectorModifiers")) {
    changed = true;
  }

  return { config: normalized, changed };
}

function cloneNormalizedPageEntry(entry, fallbackUrl = "") {
  const normalized = normalizePageMarkings({
    [fallbackUrl || (entry && entry.url) || ""]: entry || {}
  }).normalized;
  const key = Object.keys(normalized)[0];
  return key ? normalized[key] : {
    url: fallbackUrl || "",
    title: fallbackUrl || "",
    timestamp: PAGE_TIMESTAMP_FALLBACK,
    xpaths: [],
    consentXpaths: [],
    includeXpaths: [],
    submissionXpaths: [],
    fullHTML: ""
  };
}

export function normalizeConfigSyncPayload(payload, fallbackBaseUrl = "") {
  if (!payload || typeof payload !== "object") {
    return {
      version: SERVER_SYNC_VERSION,
      baseUrl: fallbackBaseUrl || "",
      siteId: null,
      pageMarkings: {}
    };
  }
  const baseUrl =
    typeof payload.baseUrl === "string" && payload.baseUrl
      ? payload.baseUrl
      : fallbackBaseUrl || "";
  const normalizedMarkings = normalizePageMarkings(payload.pageMarkings);
  return {
    version:
      typeof payload.version === "number" && Number.isFinite(payload.version)
        ? payload.version
        : SERVER_SYNC_VERSION,
    baseUrl,
    siteId: normalizeSiteIdValue(payload.siteId),
    pageMarkings: normalizedMarkings.normalized
  };
}

export function createConfigSyncPayload(baseUrl, sourceConfig) {
  const normalized = normalizeConfig(baseUrl, sourceConfig).config;
  const pageMarkings = normalized.pageMarkings || {};
  const payloadMarkings = {};
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    const safeEntry = cloneNormalizedPageEntry(entry, url);
    payloadMarkings[url] = {
      timestamp: normalizeEntryTimestamp(safeEntry.timestamp),
      url: safeEntry.url || url,
      title: safeEntry.title || url,
      fullHtml: typeof safeEntry.fullHTML === "string" ? safeEntry.fullHTML : "",
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
        : []
    };
  });
  return {
    version: SERVER_SYNC_VERSION,
    baseUrl,
    siteId: normalizeSiteIdValue(normalized.siteId),
    pageMarkings: payloadMarkings
  };
}

export function mergePageMarkingsByTimestamp(localPageMarkings, incomingPageMarkings) {
  const localNormalized = normalizePageMarkings(localPageMarkings).normalized;
  const incomingNormalized = normalizePageMarkings(incomingPageMarkings).normalized;
  const merged = { ...localNormalized };
  const replacedUrls = [];
  const replacedExistingUrls = [];

  Object.entries(incomingNormalized).forEach(([url, incomingEntry]) => {
    const localEntry = merged[url];
    if (!localEntry) {
      merged[url] = cloneNormalizedPageEntry(incomingEntry, url);
      replacedUrls.push(url);
      return;
    }
    if (!isIncomingTimestampNewer(incomingEntry.timestamp, localEntry.timestamp)) {
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
  return result.configs || {};
}

export async function saveConfigs(configs) {
  await idbSet({ configs });
}

export async function ensureConfig(baseUrl) {
  const configs = await getConfigs();
  if (!configs[baseUrl]) {
    const defaultConfig = createDefaultConfig(baseUrl);
    configs[baseUrl] = defaultConfig;
    await saveConfigs(configs);
    return defaultConfig;
  }
  const { config, changed } = normalizeConfig(baseUrl, configs[baseUrl]);
  if (changed) {
    configs[baseUrl] = config;
    await saveConfigs(configs);
  }
  return config;
}

export async function updateConfig(baseUrl, updater) {
  const configs = await getConfigs();
  const { config } = normalizeConfig(baseUrl, configs[baseUrl]);
  updater(config);
  configs[baseUrl] = config;
  await saveConfigs(configs);
  return config;
}
