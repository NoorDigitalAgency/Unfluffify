import {
  arraysEqual,
  idbGet,
  idbSet,
  normalizeBaseUrl,
  normalizeCanonicalBaseUrl
} from "./utilities.js";
import { normalizeSiteIdValue } from "./lynx-live-pages.js";

/** Fallback timestamp for pages with no recorded data */
export const PAGE_TIMESTAMP_FALLBACK = "1970-01-01T00:00:00Z";
const SERVER_SYNC_VERSION = 5;
/** Render mode for static HTML content */
export const RENDER_MODE_STATIC = "static";
/** Render mode for rendered/JavaScript content */
export const RENDER_MODE_RENDERED = "rendered";
/** Default render mode is static */
export const DEFAULT_RENDER_MODE = RENDER_MODE_STATIC;
const SUPPORTED_PAGE_TYPE_KEYS = Object.freeze(new Set([
  "homepage",
  "article",
  "listing",
  "category",
  "product",
  "service_page",
  "company",
  "landing_page",
  "utility"
]));
const SELECTOR_SET_FIELD = "selectors";
const SELECTOR_SET_UPDATED_AT_FIELD = "selectorsUpdatedAt";
const SUBMITTED_SELECTORS_FINGERPRINT_FIELD = "submittedSelectorsFingerprint";
const PAGE_SAVE_RECONCILIATIONS_KEY = "pageSaveReconciliations";
const BACKEND_SAVED_PAGE_MARKINGS_KEY = "backendSavedPageMarkings";
const configWriteQueueByBaseUrl = new Map<string, Promise<void>>();
let configPersistenceQueue: Promise<void> = Promise.resolve();
export const PAGE_SAVE_RECONCILIATION_STATUS_PENDING = "pending";
export const NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS = new Set([
  "",
  "pending",
  "saving",
  "preparing",
  "loading",
  "calculating",
  "sync_failed",
  "sync_skipped",
  "load_failed"
]);

type UnknownRecord = Record<string, unknown>;
type RenderMode = string;
type SelectorTimestampFieldName = typeof SELECTOR_SET_UPDATED_AT_FIELD;
type SiteId = ReturnType<typeof normalizeSiteIdValue>;

interface PageSaveReconciliation {
  status: typeof PAGE_SAVE_RECONCILIATION_STATUS_PENDING;
  baseUrl: string;
  pageUrl: string;
  reason: string;
  updatedAt: string;
}

interface XpathItem {
  xpath: string;
  excluded: boolean;
  explicit?: boolean;
}

interface PageMarkingInput extends UnknownRecord {
  timestamp?: unknown;
  xpaths?: unknown;
  includeXpaths?: unknown;
  selectorSuppressedXpaths?: unknown;
  submissionXpaths?: unknown;
  silentWhitespaceExcludedXpaths?: unknown;
  renderedHtml?: unknown;
  rawHtml?: unknown;
  title?: unknown;
  pageType?: unknown;
  consentXpaths?: unknown;
  renderMode?: unknown;
  url?: unknown;
}

interface NormalizedPageMarkingEntry extends UnknownRecord {
  timestamp: string;
  xpaths: XpathItem[];
  includeXpaths: string[];
  selectorSuppressedXpaths: string[];
  submissionXpaths: XpathItem[];
  silentWhitespaceExcludedXpaths: string[];
  renderedHtml: string;
  rawHtml: string;
  title?: string;
  pageType?: string;
}

type PageMarkingsRecord = Record<string, NormalizedPageMarkingEntry>;
type BackendSavedPageMarkingSnapshotEntry = Omit<
  NormalizedPageMarkingEntry,
  "silentWhitespaceExcludedXpaths"
>;

interface AiSelectorSet extends UnknownRecord {
  exclusionSelectors: string[];
  inclusionSelectors: string[];
}

interface ConfigInput extends UnknownRecord {
  domain?: unknown;
  renderMode?: unknown;
  renderModeUpdatedAt?: unknown;
  siteId?: unknown;
  pageMarkings?: unknown;
  selectors?: unknown;
  selectorsUpdatedAt?: unknown;
  submittedSelectorsFingerprint?: unknown;
  aiSelectorModifiers?: unknown;
}

interface NormalizedConfig extends UnknownRecord {
  baseUrl: string;
  domain: string;
  siteId: SiteId;
  renderMode: RenderMode;
  renderModeUpdatedAt: string;
  pageMarkings: Record<string, Record<string, unknown>>;
  selectors: Record<string, unknown>;
  selectorsUpdatedAt: string;
  submittedSelectorsFingerprint: string;
}

interface NormalizeStringListResult {
  values: string[];
  changed: boolean;
}

interface NormalizeXpathItemsResult {
  values: XpathItem[];
  changed: boolean;
}

interface NormalizePageMarkingsResult {
  normalized: PageMarkingsRecord;
  changed: boolean;
  removedUrls: string[];
}

interface NormalizeAiSelectorSetResult {
  normalized: AiSelectorSet;
  changed: boolean;
}

interface MergeSelectorSetResult {
  selectorSet: AiSelectorSet;
  updatedAt: string;
}

interface MergeConfigSelectorStateResult extends MergeSelectorSetResult {
  submittedFingerprint: string;
}

interface MergePageMarkingsOptions {
  preferIncomingOnTimestampTie?: unknown;
}

interface MergePageMarkingsResult {
  pageMarkings: PageMarkingsRecord;
  replacedUrls: string[];
  replacedExistingUrls: string[];
}

interface NormalizedConfigSyncPayload {
  version: number;
  baseUrl: string;
  siteId: SiteId;
  renderMode: RenderMode;
  renderModeUpdatedAt: string;
  pageMarkings: Record<string, unknown>;
  selectors: AiSelectorSet;
  selectorsUpdatedAt: string;
  submittedSelectorsFingerprint: string;
}

interface ConfigSyncPayloadOptions {
  filterPageMarking?: (url: string, entry: NormalizedPageMarkingEntry) => boolean;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}

export function buildPageSaveReconciliationKey(
  baseUrl: unknown,
  pageUrl: unknown
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || baseUrl;
  const normalizedPageUrl = typeof pageUrl === "string" ? pageUrl.trim() : "";
  if (!normalizedBaseUrl || !normalizedPageUrl) {
    return "";
  }
  return JSON.stringify([normalizedBaseUrl, normalizedPageUrl]);
}

export function normalizePageSaveReconciliation(value: unknown): PageSaveReconciliation | null {
  if (!isRecord(value)) {
    return null;
  }
  const baseUrl = normalizeBaseUrl(value.baseUrl) || (typeof value.baseUrl === "string" ? value.baseUrl : "");
  const pageUrl = typeof value.pageUrl === "string" ? value.pageUrl.trim() : "";
  if (!baseUrl || !pageUrl) {
    return null;
  }
  const status =
    value.status === PAGE_SAVE_RECONCILIATION_STATUS_PENDING
      ? PAGE_SAVE_RECONCILIATION_STATUS_PENDING
      : "";
  if (!status) {
    return null;
  }
  return {
    status,
    baseUrl,
    pageUrl,
    reason: typeof value.reason === "string" ? value.reason.trim() : "",
    updatedAt: normalizeEntryTimestamp(value.updatedAt) || createTimestampNow()
  };
}

export function isPageSaveReconciliationPending(value: unknown): boolean {
  const normalized = normalizePageSaveReconciliation(value);
  if (!normalized || normalized.status !== PAGE_SAVE_RECONCILIATION_STATUS_PENDING) {
    return false;
  }
  return !NON_BLOCKING_PAGE_SAVE_RECONCILIATION_REASONS.has(normalized.reason);
}

async function getPageSaveReconciliations(): Promise<Record<string, unknown>> {
  const result = await idbGet({ [PAGE_SAVE_RECONCILIATIONS_KEY]: {} });
  const raw = result[PAGE_SAVE_RECONCILIATIONS_KEY];
  return isRecord(raw) ? raw : {};
}

export async function getPageSaveReconciliation(
  baseUrl: string | null | undefined,
  pageUrl: string | null | undefined
): Promise<PageSaveReconciliation | null> {
  const key = buildPageSaveReconciliationKey(baseUrl, pageUrl);
  if (!key) {
    return null;
  }
  const reconciliations = await getPageSaveReconciliations();
  return normalizePageSaveReconciliation(reconciliations[key]);
}

export async function setPageSaveReconciliation(
  baseUrl: string | null | undefined,
  pageUrl: string | null | undefined,
  value: Partial<PageSaveReconciliation> = {}
): Promise<PageSaveReconciliation | null> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || baseUrl;
  const normalizedPageUrl = typeof pageUrl === "string" ? pageUrl.trim() : "";
  const key = buildPageSaveReconciliationKey(normalizedBaseUrl, normalizedPageUrl);
  if (!key) {
    return null;
  }
  const nextValue = normalizePageSaveReconciliation({
    ...value,
    status: PAGE_SAVE_RECONCILIATION_STATUS_PENDING,
    baseUrl: normalizedBaseUrl,
    pageUrl: normalizedPageUrl,
    updatedAt: value && value.updatedAt ? value.updatedAt : createTimestampNow()
  });
  if (!nextValue) {
    return null;
  }
  const reconciliations = await getPageSaveReconciliations();
  reconciliations[key] = nextValue;
  await idbSet({ [PAGE_SAVE_RECONCILIATIONS_KEY]: reconciliations });
  return nextValue;
}

export async function clearPageSaveReconciliation(
  baseUrl: string | null | undefined,
  pageUrl: string | null | undefined
): Promise<void> {
  const key = buildPageSaveReconciliationKey(baseUrl, pageUrl);
  if (!key) {
    return;
  }
  const reconciliations = await getPageSaveReconciliations();
  if (!Object.prototype.hasOwnProperty.call(reconciliations, key)) {
    return;
  }
  delete reconciliations[key];
  await idbSet({ [PAGE_SAVE_RECONCILIATIONS_KEY]: reconciliations });
}

export function createBackendSavedPageMarkingsSnapshot(
  pageMarkings: unknown
): Record<string, BackendSavedPageMarkingSnapshotEntry> {
  const normalized = normalizePageMarkings(pageMarkings).normalized as Record<
    string,
    NormalizedPageMarkingEntry
  >;
  const snapshot: Record<string, BackendSavedPageMarkingSnapshotEntry> = {};
  Object.entries(normalized).forEach(([url, entry]) => {
    const snapshotEntry: BackendSavedPageMarkingSnapshotEntry = {
      timestamp: normalizeEntryTimestamp(entry.timestamp),
      xpaths: Array.isArray(entry.xpaths) ? entry.xpaths : [],
      includeXpaths: Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [],
      selectorSuppressedXpaths: Array.isArray(entry.selectorSuppressedXpaths)
        ? entry.selectorSuppressedXpaths
        : [],
      submissionXpaths: Array.isArray(entry.submissionXpaths) ? entry.submissionXpaths : [],
      renderedHtml: typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
      rawHtml: typeof entry.rawHtml === "string" ? entry.rawHtml : ""
    };
    if (entry.title) {
      snapshotEntry.title = entry.title;
    }
    if (entry.pageType) {
      snapshotEntry.pageType = entry.pageType;
    }
    snapshot[url] = snapshotEntry;
  });
  return snapshot;
}

async function getBackendSavedPageMarkingsStore(): Promise<Record<string, unknown>> {
  const result = await idbGet({ [BACKEND_SAVED_PAGE_MARKINGS_KEY]: {} });
  const store = result[BACKEND_SAVED_PAGE_MARKINGS_KEY];
  return isRecord(store) ? store : {};
}

export async function getBackendSavedPageMarkings(
  baseUrl: string | null | undefined
): Promise<Record<string, BackendSavedPageMarkingSnapshotEntry>> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
  if (!normalizedBaseUrl) {
    return {};
  }
  const store = await getBackendSavedPageMarkingsStore();
  return createBackendSavedPageMarkingsSnapshot(store[normalizedBaseUrl]);
}

export async function setBackendSavedPageMarkings(
  baseUrl: string | null | undefined,
  pageMarkings: unknown
): Promise<Record<string, BackendSavedPageMarkingSnapshotEntry>> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
  if (!normalizedBaseUrl) {
    return {};
  }
  const store = await getBackendSavedPageMarkingsStore();
  const snapshot = createBackendSavedPageMarkingsSnapshot(pageMarkings);
  store[normalizedBaseUrl] = snapshot;
  await idbSet({ [BACKEND_SAVED_PAGE_MARKINGS_KEY]: store });
  return snapshot;
}

export async function clearBackendSavedPageMarkings(
  baseUrl: string | null | undefined
): Promise<void> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
  if (!normalizedBaseUrl) {
    return;
  }
  const store = await getBackendSavedPageMarkingsStore();
  if (!Object.prototype.hasOwnProperty.call(store, normalizedBaseUrl)) {
    return;
  }
  delete store[normalizedBaseUrl];
  await idbSet({ [BACKEND_SAVED_PAGE_MARKINGS_KEY]: store });
}

/**
 * Normalizes a render mode value to either 'static' or 'rendered'.
 * @param {string} value - The render mode value to normalize
 * @returns {string} Either RENDER_MODE_STATIC or RENDER_MODE_RENDERED
 */
export function normalizeRenderMode(value: unknown): RenderMode {
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
export function getConfigRenderMode(sourceConfig: ConfigInput | null | undefined): RenderMode {
  if (!sourceConfig) {
    return DEFAULT_RENDER_MODE;
  }
  return normalizeRenderMode(sourceConfig.renderMode);
}

function parseTimestampMillis(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  }
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

function toTimestampMillis(value: unknown): number {
  const parsed = parseTimestampMillis(value);
  if (!Number.isFinite(parsed)) {
    return Number.NEGATIVE_INFINITY;
  }
  return parsed;
}

function toUtcTimestampString(value: string | number | Date): string {
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
export function normalizeEntryTimestamp(value: unknown): string {
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
export function isIncomingTimestampNewer(incomingTimestamp: unknown, localTimestamp: unknown): boolean {
  return toTimestampMillis(incomingTimestamp) > toTimestampMillis(localTimestamp);
}

export function mergeRenderModeByTimestamp(
  existingMode: unknown,
  existingUpdatedAt: unknown,
  incomingMode: unknown,
  incomingUpdatedAt: unknown
): { renderMode: RenderMode; updatedAt: string } {
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

function normalizeUniqueXpathList(list: unknown): NormalizeStringListResult {
  const values: string[] = [];
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

function normalizeStoredPageTitle(value: unknown, fallbackUrl = ""): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === fallbackUrl) {
    return "";
  }
  return trimmed;
}

function normalizePageTypeValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function isSupportedPageTypeValue(value: unknown): boolean {
  const normalized = normalizePageTypeValue(value);
  return Boolean(normalized && SUPPORTED_PAGE_TYPE_KEYS.has(normalized));
}

export function collectInvalidPageMarkingUrls(pageMarkings: unknown): string[] {
  const invalidUrls: string[] = [];
  if (!isRecord(pageMarkings)) {
    return invalidUrls;
  }
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    if (!url || !isRecord(entry)) {
      return;
    }
    const pageType = normalizePageTypeValue(entry.pageType);
    if (!pageType || !SUPPORTED_PAGE_TYPE_KEYS.has(pageType)) {
      invalidUrls.push(url);
    }
  });
  return invalidUrls;
}

function normalizeXpathItems(rawXpaths: unknown): NormalizeXpathItemsResult {
  const parsed: XpathItem[] = [];
  let changed = false;
  for (const item of Array.isArray(rawXpaths) ? rawXpaths : []) {
    if (isRecord(item) && typeof item.xpath === "string") {
      const xpath = item.xpath.trim();
      if (!xpath) {
        changed = true;
        continue;
      }
      const excluded = Boolean(item.excluded);
      const explicit = item.explicit === true;
      const hasExplicit = Object.prototype.hasOwnProperty.call(item, "explicit");
      if (
        xpath !== item.xpath ||
        item.excluded !== excluded ||
        (hasExplicit && item.explicit !== true)
      ) {
        changed = true;
      }
      parsed.push(explicit ? { xpath, excluded, explicit: true } : { xpath, excluded });
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

function extractExplicitIncludeXpaths(xpathItems: XpathItem[] | unknown): string[] {
  return (Array.isArray(xpathItems) ? xpathItems : [])
    .filter((item) =>
      item &&
      item.explicit === true &&
      item.excluded === false &&
      typeof item.xpath === "string" &&
      item.xpath
    )
    .map((item) => item.xpath);
}

function removeExplicitIncludeXpathItems(xpathItems: XpathItem[] | unknown): XpathItem[] {
  return (Array.isArray(xpathItems) ? xpathItems : [])
    .filter((item) => !(item && item.explicit === true && item.excluded === false));
}

function appendUniqueXpath(values: string[], xpath: unknown): void {
  if (typeof xpath !== "string" || !xpath) {
    return;
  }
  const existingIndex = values.indexOf(xpath);
  if (existingIndex >= 0) {
    values.splice(existingIndex, 1);
  }
  values.push(xpath);
}

function buildConfigSyncXpathItems(
  entry: Pick<PageMarkingInput, "xpaths" | "includeXpaths" | "selectorSuppressedXpaths"> | null | undefined
): XpathItem[] {
  const items: XpathItem[] = [];
  const upsertItem = (item: Partial<XpathItem> | null | undefined) => {
    if (!item || typeof item.xpath !== "string" || !item.xpath) {
      return;
    }
    const normalizedItem: XpathItem = {
      xpath: item.xpath,
      excluded: Boolean(item.excluded),
      ...(item.explicit === true ? { explicit: true } : {})
    };
    const existingIndex = items.findIndex((existing) => existing.xpath === normalizedItem.xpath);
    if (existingIndex >= 0) {
      items.splice(existingIndex, 1);
    }
    items.push(normalizedItem);
  };

  const xpathItems = entry && Array.isArray(entry.xpaths) ? entry.xpaths : [];
  for (const item of xpathItems) {
    upsertItem(item);
  }
  const includeXpaths = entry && Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
  for (const xpath of includeXpaths) {
    upsertItem({ xpath, excluded: false, explicit: true });
  }
  const selectorSuppressedXpaths =
    entry && Array.isArray(entry.selectorSuppressedXpaths)
      ? entry.selectorSuppressedXpaths
      : [];
  for (const xpath of selectorSuppressedXpaths) {
    upsertItem({ xpath, excluded: false, explicit: true });
  }
  return items;
}

function normalizeSelectorList(list: unknown): NormalizeStringListResult {
  const values: string[] = [];
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

export function createEmptyAiSelectorSet(): AiSelectorSet {
  return { exclusionSelectors: [], inclusionSelectors: [] };
}

function cloneAiSelectorSet(selectorSet: unknown): AiSelectorSet {
  const normalized = normalizeAiSelectorSet(selectorSet).normalized;
  return {
    exclusionSelectors: normalized.exclusionSelectors.slice(),
    inclusionSelectors: normalized.inclusionSelectors.slice()
  };
}

function hasAnySelectors(selectorSet: unknown): boolean {
  const normalized = normalizeAiSelectorSet(selectorSet).normalized;
  return Boolean(
    normalized.exclusionSelectors.length > 0 ||
      normalized.inclusionSelectors.length > 0
  );
}

function selectorSetsEqual(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeAiSelectorSet(left).normalized;
  const normalizedRight = normalizeAiSelectorSet(right).normalized;
  return (
    arraysEqual(normalizedLeft.exclusionSelectors, normalizedRight.exclusionSelectors) &&
    arraysEqual(normalizedLeft.inclusionSelectors, normalizedRight.inclusionSelectors)
  );
}

function createAiSelectorSetFingerprint(selectorSet: unknown): string {
  const normalized = normalizeAiSelectorSet(selectorSet).normalized;
  return hasAnySelectors(normalized) ? JSON.stringify(normalized) : "";
}

function normalizeSubmittedSelectorsFingerprint(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSelectorTimestampCurrent(selectorUpdatedAt: unknown, renderModeUpdatedAt: unknown): boolean {
  const normalizedSelectorUpdatedAt = normalizeEntryTimestamp(selectorUpdatedAt);
  const normalizedRenderModeUpdatedAt = normalizeEntryTimestamp(renderModeUpdatedAt);
  return !isIncomingTimestampNewer(normalizedRenderModeUpdatedAt, normalizedSelectorUpdatedAt);
}

export function getSelectorSetTimestampFieldName(fieldName: unknown): SelectorTimestampFieldName | "" {
  return fieldName === SELECTOR_SET_FIELD ? SELECTOR_SET_UPDATED_AT_FIELD : "";
}

export function isSelectorSetCurrentForRenderMode(sourceConfig: unknown, fieldName: unknown): boolean {
  if (!isRecord(sourceConfig)) {
    return false;
  }
  const timestampFieldName = getSelectorSetTimestampFieldName(fieldName);
  if (!timestampFieldName) {
    return false;
  }
  return isSelectorTimestampCurrent(
    sourceConfig[timestampFieldName],
    sourceConfig.renderModeUpdatedAt
  );
}

export function mergeSelectorSetsByTimestamp(
  existingSet: unknown,
  existingUpdatedAt: unknown,
  incomingSet: unknown,
  incomingUpdatedAt: unknown
): MergeSelectorSetResult {
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

export function mergeConfigSelectorStateByTimestamp(
  existingSelectors: unknown,
  existingUpdatedAt: unknown,
  existingSubmittedFingerprint: unknown,
  incomingSelectors: unknown,
  incomingUpdatedAt: unknown,
  incomingSubmittedFingerprint: unknown
): MergeConfigSelectorStateResult {
  const mergedSelectors = mergeSelectorSetsByTimestamp(
    existingSelectors,
    existingUpdatedAt,
    incomingSelectors,
    incomingUpdatedAt
  );
  const mergedFingerprint = createAiSelectorSetFingerprint(mergedSelectors.selectorSet);
  const normalizedExistingSubmitted = normalizeSubmittedSelectorsFingerprint(
    existingSubmittedFingerprint
  );
  const normalizedIncomingSubmitted = normalizeSubmittedSelectorsFingerprint(
    incomingSubmittedFingerprint
  );
  const submittedFingerprint =
    normalizedExistingSubmitted === mergedFingerprint ||
    normalizedIncomingSubmitted === mergedFingerprint
      ? mergedFingerprint
      : "";

  return {
    selectorSet: mergedSelectors.selectorSet,
    updatedAt: mergedSelectors.updatedAt,
    submittedFingerprint
  };
}

export function areCurrentSelectorsSubmitted(sourceConfig: unknown): boolean {
  if (!isRecord(sourceConfig)) {
    return true;
  }
  const currentFingerprint = createAiSelectorSetFingerprint(sourceConfig[SELECTOR_SET_FIELD]);
  if (!currentFingerprint) {
    return true;
  }
  return currentFingerprint === normalizeSubmittedSelectorsFingerprint(
    sourceConfig[SUBMITTED_SELECTORS_FINGERPRINT_FIELD]
  );
}

export function getNewestConfigSelectorSet(
  sourceConfig: unknown,
  fieldNames: unknown = [SELECTOR_SET_FIELD]
): MergeSelectorSetResult {
  let mergedSelectorSet = createEmptyAiSelectorSet();
  let mergedUpdatedAt = PAGE_TIMESTAMP_FALLBACK;
  const sourceConfigRecord = isRecord(sourceConfig) ? sourceConfig : null;

  for (const fieldName of Array.isArray(fieldNames) ? fieldNames : []) {
    if (typeof fieldName !== "string" || !fieldName) {
      continue;
    }
    const timestampFieldName = getSelectorSetTimestampFieldName(fieldName);
    const selectorSetIsCurrent = isSelectorSetCurrentForRenderMode(sourceConfig, fieldName);
    const merged = mergeSelectorSetsByTimestamp(
      mergedSelectorSet,
      mergedUpdatedAt,
      selectorSetIsCurrent && sourceConfigRecord
        ? sourceConfigRecord[fieldName]
        : null,
      timestampFieldName &&
        selectorSetIsCurrent &&
        sourceConfigRecord
        ? sourceConfigRecord[timestampFieldName]
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

export function createDefaultConfig(baseUrl: unknown): NormalizedConfig {
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
    selectors: createEmptyAiSelectorSet(),
    selectorsUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
    submittedSelectorsFingerprint: ""
  };
}

export function normalizePageMarkings(pageMarkings: unknown): {
  normalized: Record<string, Record<string, unknown>>;
  changed: boolean;
  removedUrls: string[];
} {
  const normalized: PageMarkingsRecord = {};
  const removedUrls: string[] = [];
  let changed = false;
  if (!isRecord(pageMarkings)) {
    return { normalized, changed, removedUrls };
  }
  Object.entries(pageMarkings).forEach(([url, rawEntry]) => {
    if (!url || !isRecord(rawEntry)) {
      changed = true;
      return;
    }
    const entry = rawEntry as PageMarkingInput;
    if (!Array.isArray(entry.xpaths) && entry.xpaths !== undefined) {
      changed = true;
    }
    const rawXpaths = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    const normalizedXpaths = normalizeXpathItems(rawXpaths);
    const explicitIncludeXpaths = extractExplicitIncludeXpaths(normalizedXpaths.values);
    const xpaths = removeExplicitIncludeXpathItems(normalizedXpaths.values);
    if (normalizedXpaths.changed) {
      changed = true;
    }
    if (explicitIncludeXpaths.length > 0) {
      changed = true;
    }
    const timestamp = normalizeEntryTimestamp(entry.timestamp);
    if (entry.timestamp !== timestamp) {
      changed = true;
    }
    const renderedHtml = typeof entry.renderedHtml === "string" ? entry.renderedHtml : "";
    if (entry.renderedHtml !== undefined && typeof entry.renderedHtml !== "string") {
      changed = true;
    }
    const rawHtml = typeof entry.rawHtml === "string" ? entry.rawHtml : "";
    if (entry.rawHtml !== undefined && typeof entry.rawHtml !== "string") {
      changed = true;
    }
    if (entry.consentXpaths !== undefined) {
      changed = true;
    }
    if (!Array.isArray(entry.includeXpaths) && entry.includeXpaths !== undefined) {
      changed = true;
    }
    const rawInclude = Array.isArray(entry.includeXpaths) ? [...entry.includeXpaths] : [];
    explicitIncludeXpaths.forEach((xpath) => appendUniqueXpath(rawInclude, xpath));
    const includeResult = normalizeUniqueXpathList(rawInclude);
    const includeXpaths = includeResult.values;
    if (includeResult.changed) {
      changed = true;
    }
    if (!Array.isArray(entry.selectorSuppressedXpaths) && entry.selectorSuppressedXpaths !== undefined) {
      changed = true;
    }
    const rawSelectorSuppressed = Array.isArray(entry.selectorSuppressedXpaths)
      ? [...entry.selectorSuppressedXpaths]
      : [];
    explicitIncludeXpaths.forEach((xpath) => appendUniqueXpath(rawSelectorSuppressed, xpath));
    const selectorSuppressedResult = normalizeUniqueXpathList(rawSelectorSuppressed);
    const selectorSuppressedXpaths = selectorSuppressedResult.values;
    if (selectorSuppressedResult.changed) {
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
    if (!Array.isArray(entry.silentWhitespaceExcludedXpaths) && entry.silentWhitespaceExcludedXpaths !== undefined) {
      changed = true;
    }
    const rawSilentWhitespaceExcluded = Array.isArray(entry.silentWhitespaceExcludedXpaths)
      ? [...entry.silentWhitespaceExcludedXpaths]
      : [];
    const silentWhitespaceExcludedResult = normalizeUniqueXpathList(rawSilentWhitespaceExcluded);
    const silentWhitespaceExcludedXpaths = silentWhitespaceExcludedResult.values;
    if (silentWhitespaceExcludedResult.changed) {
      changed = true;
    }
    const title = normalizeStoredPageTitle(entry.title, url);
    const pageType = normalizePageTypeValue(entry.pageType);
    if (Object.prototype.hasOwnProperty.call(entry, "url")) {
      changed = true;
    }
    if (
      entry.title !== undefined &&
      title !== entry.title
    ) {
      changed = true;
    }
    if (entry.pageType !== undefined && pageType !== entry.pageType) {
      changed = true;
    }
    if (entry.renderMode !== undefined) {
      changed = true;
    }
    const normalizedEntry: NormalizedPageMarkingEntry = {
      timestamp,
      xpaths,
      includeXpaths,
      selectorSuppressedXpaths,
      submissionXpaths,
      silentWhitespaceExcludedXpaths,
      renderedHtml,
      rawHtml
    };
    if (title) {
      normalizedEntry.title = title;
    }
    if (pageType) {
      normalizedEntry.pageType = pageType;
    }
    normalized[url] = normalizedEntry;
  });
  return { normalized, changed, removedUrls };
}

export function normalizeAiSelectorSet(value: unknown): NormalizeAiSelectorSetResult {
  const normalized = createEmptyAiSelectorSet();
  let changed = true;
  if (!isRecord(value)) {
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

export function normalizeConfig(baseUrl: unknown, incoming: unknown): { config: NormalizedConfig; changed: boolean } {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
  let changed = false;
  const defaultConfig = createDefaultConfig(normalizedBaseUrl);
  const normalized = { ...defaultConfig };

  if (!isRecord(incoming)) {
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
  const selectors = normalizeAiSelectorSet(incoming[SELECTOR_SET_FIELD]);
  normalized.selectors = selectors.normalized;
  if (selectors.changed) {
    changed = true;
  }
  normalized.selectorsUpdatedAt = normalizeEntryTimestamp(
    incoming[SELECTOR_SET_UPDATED_AT_FIELD]
  );
  if (
    incoming[SELECTOR_SET_UPDATED_AT_FIELD] !== undefined &&
    normalized.selectorsUpdatedAt !== incoming[SELECTOR_SET_UPDATED_AT_FIELD]
  ) {
    changed = true;
  }
  normalized.submittedSelectorsFingerprint = normalizeSubmittedSelectorsFingerprint(
    incoming[SUBMITTED_SELECTORS_FINGERPRINT_FIELD]
  );
  if (
    incoming[SUBMITTED_SELECTORS_FINGERPRINT_FIELD] !== undefined &&
    normalized.submittedSelectorsFingerprint !==
      incoming[SUBMITTED_SELECTORS_FINGERPRINT_FIELD]
  ) {
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "aiSelectorModifiers")) {
    changed = true;
  }

  return { config: normalized, changed };
}

export function isRenderModeConfirmed(sourceConfig: unknown): boolean {
  if (!isRecord(sourceConfig)) {
    return false;
  }
  return normalizeEntryTimestamp(sourceConfig.renderModeUpdatedAt) !== PAGE_TIMESTAMP_FALLBACK;
}

function cloneNormalizedPageEntry(entry: unknown, fallbackUrl = ""): NormalizedPageMarkingEntry {
  const normalized = normalizePageMarkings({
    [fallbackUrl || ""]: entry || {}
  }).normalized as PageMarkingsRecord;
  const key = Object.keys(normalized)[0];
  return key ? normalized[key] : {
    title: "",
    timestamp: PAGE_TIMESTAMP_FALLBACK,
    pageType: "",
    xpaths: [],
    includeXpaths: [],
    selectorSuppressedXpaths: [],
    submissionXpaths: [],
    silentWhitespaceExcludedXpaths: [],
    renderedHtml: "",
    rawHtml: ""
  };
}

export function normalizeConfigSyncPayload(payload: unknown, fallbackBaseUrl = ""): NormalizedConfigSyncPayload {
  const normalizedFallbackBaseUrl =
    normalizeCanonicalBaseUrl(fallbackBaseUrl) ||
    normalizeBaseUrl(fallbackBaseUrl) ||
    fallbackBaseUrl ||
    "";
  if (!isRecord(payload)) {
    return {
      version: SERVER_SYNC_VERSION,
      baseUrl: normalizedFallbackBaseUrl,
      siteId: null,
      renderMode: DEFAULT_RENDER_MODE,
      renderModeUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
      pageMarkings: {},
      selectors: createEmptyAiSelectorSet(),
      selectorsUpdatedAt: PAGE_TIMESTAMP_FALLBACK,
      submittedSelectorsFingerprint: ""
    };
  }
  const baseUrl =
    normalizeCanonicalBaseUrl(typeof payload.baseUrl === "string" ? payload.baseUrl : "") ||
    normalizeBaseUrl(typeof payload.baseUrl === "string" ? payload.baseUrl : "") ||
    normalizedFallbackBaseUrl;
  const normalizedConfig = normalizeConfig(baseUrl, payload).config;
  return {
    version:
      typeof payload.version === "number" && Number.isFinite(payload.version)
        ? payload.version
        : SERVER_SYNC_VERSION,
    baseUrl,
    siteId: normalizeSiteIdValue(normalizedConfig.siteId),
    renderMode: getConfigRenderMode(normalizedConfig),
    renderModeUpdatedAt: normalizeEntryTimestamp(normalizedConfig.renderModeUpdatedAt),
    pageMarkings: normalizedConfig.pageMarkings || {},
    selectors: cloneAiSelectorSet(normalizedConfig.selectors),
    selectorsUpdatedAt: normalizeEntryTimestamp(normalizedConfig.selectorsUpdatedAt),
    submittedSelectorsFingerprint: normalizeSubmittedSelectorsFingerprint(
      normalizedConfig.submittedSelectorsFingerprint
    )
  };
}

export function createConfigSyncPayload(
  baseUrl: unknown,
  sourceConfig: unknown,
  options: ConfigSyncPayloadOptions = {}
): NormalizedConfigSyncPayload {
  const normalizedBaseUrl =
    normalizeCanonicalBaseUrl(baseUrl) ||
    normalizeBaseUrl(baseUrl) ||
    (typeof baseUrl === "string" ? baseUrl : "");
  const normalized = normalizeConfig(normalizedBaseUrl, sourceConfig).config;
  const pageMarkings = normalized.pageMarkings || {};
  const payloadMarkings: Record<string, unknown> = {};
  const filterPageMarking =
    options && typeof options.filterPageMarking === "function"
      ? options.filterPageMarking
      : null;
  Object.entries(pageMarkings).forEach(([url, entry]) => {
    const safeEntry = cloneNormalizedPageEntry(entry, url);
    if (typeof filterPageMarking === "function" && !filterPageMarking(url, safeEntry)) {
      return;
    }
    payloadMarkings[url] = {
      timestamp: normalizeEntryTimestamp(safeEntry.timestamp),
      title: safeEntry.title || undefined,
      pageType: safeEntry.pageType || undefined,
      renderedHtml:
        typeof safeEntry.renderedHtml === "string" ? safeEntry.renderedHtml : "",
      rawHtml: typeof safeEntry.rawHtml === "string" ? safeEntry.rawHtml : "",
      xpaths: buildConfigSyncXpathItems(safeEntry),
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
    selectors: cloneAiSelectorSet(normalized.selectors),
    selectorsUpdatedAt: normalizeEntryTimestamp(normalized.selectorsUpdatedAt),
    submittedSelectorsFingerprint: normalizeSubmittedSelectorsFingerprint(
      normalized.submittedSelectorsFingerprint
    )
  };
}

export function mergePageMarkingsByTimestamp(
  localPageMarkings: unknown,
  incomingPageMarkings: unknown,
  options: MergePageMarkingsOptions = {}
): MergePageMarkingsResult {
  const localNormalized = normalizePageMarkings(localPageMarkings).normalized as PageMarkingsRecord;
  const incomingNormalized = normalizePageMarkings(incomingPageMarkings).normalized as PageMarkingsRecord;
  const merged: PageMarkingsRecord = { ...localNormalized };
  const replacedUrls: string[] = [];
  const replacedExistingUrls: string[] = [];
  const preferIncomingOnTimestampTie = Boolean(options.preferIncomingOnTimestampTie);

  const hasSnapshotData = (entry: NormalizedPageMarkingEntry | undefined) =>
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
    const incomingWinsTimestampTie =
      preferIncomingOnTimestampTie &&
      timestampsMatch &&
      JSON.stringify(cloneNormalizedPageEntry(incomingEntry, url)) !==
        JSON.stringify(cloneNormalizedPageEntry(localEntry, url));
    if (
      !isIncomingTimestampNewer(incomingEntry.timestamp, localEntry.timestamp) &&
      !incomingHasRicherSnapshot &&
      !incomingWinsTimestampTie
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
  let changed = false;
  Object.entries(rawConfigs).forEach(([key, value]) => {
    const normalizedKey = normalizeBaseUrl(key) || key;
    if (normalizedKey !== key) {
      changed = true;
    }
// @ts-expect-error
    if (!normalizedConfigs[normalizedKey]) {
      const normalizedValue = normalizeConfig(normalizedKey, value);
// @ts-expect-error
      normalizedConfigs[normalizedKey] = normalizedValue.config;
      if (normalizedValue.changed) {
        changed = true;
      }
      return;
    }
    changed = true;
// @ts-expect-error
    const existing = normalizeConfig(normalizedKey, normalizedConfigs[normalizedKey]).config;
    const incoming = normalizeConfig(normalizedKey, value).config;
    const mergedPageMarkings = mergePageMarkingsByTimestamp(
      existing.pageMarkings,
      incoming.pageMarkings
    ).pageMarkings;
    const selectors = mergeConfigSelectorStateByTimestamp(
      existing.selectors,
      existing.selectorsUpdatedAt,
      existing.submittedSelectorsFingerprint,
      incoming.selectors,
      incoming.selectorsUpdatedAt,
      incoming.submittedSelectorsFingerprint
    );
    const renderMode = mergeRenderModeByTimestamp(
      existing.renderMode,
      existing.renderModeUpdatedAt,
      incoming.renderMode,
      incoming.renderModeUpdatedAt
    );
// @ts-expect-error
    normalizedConfigs[normalizedKey] = {
      ...existing,
      siteId: existing.siteId || incoming.siteId || null,
      renderMode: renderMode.renderMode,
      renderModeUpdatedAt: renderMode.updatedAt,
      pageMarkings: mergedPageMarkings,
      selectors: selectors.selectorSet,
      selectorsUpdatedAt: selectors.updatedAt,
      submittedSelectorsFingerprint: selectors.submittedFingerprint
    };
  });
  if (changed) {
    await idbSet({ configs: normalizedConfigs });
  }
  return normalizedConfigs;
}

// @ts-expect-error
function normalizeConfigsForStorage(configs) {
  const normalizedConfigs = {};
  Object.entries(configs || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeBaseUrl(key) || key;
// @ts-expect-error
    normalizedConfigs[normalizedKey] = normalizeConfig(normalizedKey, value).config;
  });
  return normalizedConfigs;
}

// @ts-expect-error
async function saveConfigsDirect(configs) {
  const normalizedConfigs = normalizeConfigsForStorage(configs);
  await idbSet({ configs: normalizedConfigs });
}

// @ts-expect-error
async function queueConfigPersistence(work) {
  const next = configPersistenceQueue
    .catch(() => {})
    .then(work);
  configPersistenceQueue = next;
  return next;
}

// @ts-expect-error
export async function saveConfigs(configs) {
  await queueConfigPersistence(() => saveConfigsDirect(configs));
}

// @ts-expect-error
async function saveConfigEntry(baseUrl, config) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || baseUrl;
  return queueConfigPersistence(async () => {
    const configs = await getConfigs();
    const normalizedConfig = normalizeConfig(normalizedBaseUrl, config).config;
// @ts-expect-error
    configs[normalizedBaseUrl] = normalizedConfig;
    await saveConfigsDirect(configs);
    return normalizedConfig;
  });
}

// @ts-expect-error
function getConfigQueueKey(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
  return typeof normalizedBaseUrl === "string" ? normalizedBaseUrl : "";
}

// @ts-expect-error
async function queueConfigWrite(baseUrl, work) {
  const queueKey = getConfigQueueKey(baseUrl);
  if (!queueKey) {
    return work();
  }
  const previous = configWriteQueueByBaseUrl.get(queueKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(work);
  configWriteQueueByBaseUrl.set(queueKey, next);
  try {
    return await next;
  } finally {
    if (configWriteQueueByBaseUrl.get(queueKey) === next) {
      configWriteQueueByBaseUrl.delete(queueKey);
    }
  }
}

// @ts-expect-error
export async function ensureConfig(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || baseUrl;
  return queueConfigWrite(normalizedBaseUrl, async () => {
    const configs = await getConfigs();
// @ts-expect-error
    if (!configs[normalizedBaseUrl]) {
      const defaultConfig = createDefaultConfig(normalizedBaseUrl);
      return saveConfigEntry(normalizedBaseUrl, defaultConfig);
    }
// @ts-expect-error
    const { config, changed } = normalizeConfig(normalizedBaseUrl, configs[normalizedBaseUrl]);
    if (changed) {
      return saveConfigEntry(normalizedBaseUrl, config);
    }
    return config;
  });
}

// @ts-expect-error
export async function updateConfig(baseUrl, updater) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || baseUrl;
  return queueConfigWrite(normalizedBaseUrl, async () => {
    const configs = await getConfigs();
// @ts-expect-error
    const { config } = normalizeConfig(normalizedBaseUrl, configs[normalizedBaseUrl]);
    updater(config);
    return saveConfigEntry(normalizedBaseUrl, config);
  });
}
