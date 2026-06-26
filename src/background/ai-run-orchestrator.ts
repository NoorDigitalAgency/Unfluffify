import type { Config, PageMarkingEntry } from "../types/config.ts";

type TabLike = number | string | null | undefined;
type SiteIdLike = number | string | null | undefined;
type DeadlineLike = number | string | null | undefined;
type PersistedAiRunRecord = {
  sessionId: string;
  siteId: number;
  expiresAt: number;
  deadlineAt: number;
};
type AiSelectorSet = ReturnType<typeof import("../common/selector-set").normalizeAiSelectorSet>;
type AiRunSubmissionEntry = Parameters<typeof import("../popup/ai-run").buildAiSubmissionXpaths>[0];
type AiRunSubmissionXpath = ReturnType<typeof import("../popup/ai-run").buildAiSubmissionXpaths>[number];
type AiRunPayloadPage = {
  url: string;
  renderedHtml: string;
  rawHtml?: string;
  renderedXPaths: AiRunSubmissionXpath[];
};
type AiRunPayloadSnapshot = {
  baseUrl: string;
  renderMode: string;
  defaultExclusionSelectors: string[];
  pages: AiRunPayloadPage[];
};
type AiRunStoredXpath = string | { xpath?: string | null; excluded?: boolean; explicit?: boolean | null };
type AiRunSelectorSetPayload = {
  exclusionSelectors?: string[] | null;
  inclusionSelectors?: string[] | null;
};
type TabState = {
  enabled?: boolean;
  baseUrl?: string;
  [key: string]: string | number | boolean | null | undefined;
};
type ContentMessage = {
  type: string;
  [key: string]: string | number | boolean | null | undefined;
};
type TransferPayloadOptions = {
  expectedType?: unknown;
  removeInvalid?: boolean;
};

interface AiRunHeartbeatOptions {
  tabId?: TabLike;
  sessionId?: string | null;
  siteId?: SiteIdLike;
  deadlineAt?: DeadlineLike;
  baseUrl?: string | null;
}

interface AiRunPrepareOptions {
  baseUrl?: string | null;
  currentPageUrl?: string | null;
  currentRenderMode?: string | null;
}

interface TransferPayloadResult {
  ok: boolean;
  payload?: unknown;
  payloadKey?: string;
}

interface AiRunManagedTimeoutGroup {
  set(fn: (value?: unknown) => void, ms: number): ReturnType<typeof setTimeout>;
  clear(handle: ReturnType<typeof setTimeout>): void;
  clearAll(): void;
}

interface AiRunConfigStore {
  ensureConfig(baseUrl: string): Promise<Config>;
  updateConfig(baseUrl: string, mutate: (config: Config) => void): Promise<Config>;
}

type AiRunProgressUpdate = (
  value: Record<string, string | number | boolean | null | undefined>
) => unknown;
type AiRunCommandPayload = {
  baseUrl?: string;
  currentPageUrl?: string;
  pageType?: string;
  currentRenderMode?: string;
  endpointValue?: string;
  tokenValue?: string;
  siteId?: SiteIdLike;
  deadlineAt?: DeadlineLike;
};

interface AiRunOrchestratorOptions {
  aiComputeLockExpiresAtByTabId?: Map<number, number>;
  normalizeTabId?(value: TabLike): number | null;
  normalizeActivationBaseUrl?(value: string | null | undefined): string;
  normalizeSiteIdValue?(value: SiteIdLike): number | null;
  normalizeAiSelectorSet?(
    value: Parameters<typeof import("../common/selector-set").normalizeAiSelectorSet>[0]
  ): AiSelectorSet;
  buildAiSubmissionXpaths?(
    entry: AiRunSubmissionEntry
  ): AiRunSubmissionXpath[];
  isPageWithinBaseUrl?(pageUrl: string, baseUrl: string): boolean;
  resolveBackgroundNetworkCredentials?(
    args: { endpointValue?: string; tokenValue?: string; endpointPreference?: string }
  ): Promise<{ endpointValue: string; tokenValue: string }>;
  requestAiRunStartSnapshot?(args: {
    endpointValue: string;
    tokenValue: string;
    payloadKey: string;
    onBeforeRequest?: (details: { url: string; payloadKey: string }) => unknown;
  }): Promise<{ ok: boolean; sessionId?: string; reason?: string; skipped?: boolean; httpStatus?: number }>;
  requestAiRunStatus?(
    args: {
      endpointValue: string;
      tokenValue: string;
      sessionId: string;
    }
  ): Promise<{ ok: boolean; notFound?: boolean; status?: string }>;
  requestAiRunResultSnapshot?(
    args: {
      endpointValue: string;
      tokenValue: string;
      sessionId: string;
    }
  ): Promise<{ ok: boolean; notFound?: boolean; payloadKey?: string }>;
  fetchStaticPageHtmlForBackground?(url: string): Promise<{ ok: boolean; html?: string }>;
  getTransferPayload?(key: unknown, options?: TransferPayloadOptions): Promise<TransferPayloadResult>;
  putTransferPayload?(kind: unknown, payload: unknown): Promise<TransferPayloadResult>;
  removeTransferPayload?(key: unknown): Promise<unknown>;
  consumeTransferPayload?(key: unknown, options?: TransferPayloadOptions): Promise<TransferPayloadResult>;
  clearPersistedAiRunRecord?(): Promise<void>;
  savePersistedAiRunRecord?(record: PersistedAiRunRecord): Promise<unknown>;
  sendContentMessageToTab?(
    tabId: number,
    message: ContentMessage
  ): Promise<{ ok: boolean; error?: string; reconciliationPending?: boolean; locked?: boolean }>;
  ensureContentMainForTab?(tabId: number): Promise<{ ok: boolean; error?: string }>;
  getTabState?(tabId: number): Promise<Record<string, unknown> | null>;
  setTabState?(tabId: number, tabState: Record<string, unknown>): Promise<void>;
  updateActionForTab?(tabId: number): Promise<void>;
  refineXPathEntries?(renderedHtml: string, rawHtml: string, renderedXPaths: unknown): unknown | Promise<unknown>;
  refineXPathEntriesTimeoutMs?: number;
  createManagedTimeoutGroup?(): AiRunManagedTimeoutGroup;
  getAiRunResumeExpiresAt?(): number;
  configStore?: AiRunConfigStore;
  defaultExcludedImmutableSelectors?: string[];
  aiRunTimeoutMs?: number;
  aiRunPollIntervalMs?: number;
}

function defaultNormalizeTabId(value: TabLike) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function defaultNormalizeActivationBaseUrl(value: string | null | undefined) {
  return typeof value === "string" ? value : "";
}

function defaultNormalizeSiteIdValue() {
  return null;
}

function defaultNormalizeAiSelectorSet() {
  return null;
}

function defaultBuildAiSubmissionXpaths() {
  return [];
}

function defaultIsPageWithinBaseUrl() {
  return false;
}

function defaultCreateManagedTimeoutGroup(): AiRunManagedTimeoutGroup {
  return {
    set(fn: (value?: unknown) => void, ms: number) {
      return setTimeout(fn, ms);
    },
    clear(handle: ReturnType<typeof setTimeout>) {
      clearTimeout(handle);
    },
    clearAll() {}
  };
}

export function createAiRunOrchestrator(options: AiRunOrchestratorOptions = {}) {
  const aiComputeLockExpiresAtByTabId: Map<number, number> = options.aiComputeLockExpiresAtByTabId instanceof Map
    ? options.aiComputeLockExpiresAtByTabId
    : new Map<number, number>();
  const normalizeTabId = typeof options.normalizeTabId === "function"
    ? options.normalizeTabId
    : defaultNormalizeTabId;
  const normalizeActivationBaseUrl = typeof options.normalizeActivationBaseUrl === "function"
    ? options.normalizeActivationBaseUrl
    : defaultNormalizeActivationBaseUrl;
  const normalizeSiteIdValue = typeof options.normalizeSiteIdValue === "function"
    ? options.normalizeSiteIdValue
    : defaultNormalizeSiteIdValue;
  const normalizeAiSelectorSet = typeof options.normalizeAiSelectorSet === "function"
    ? options.normalizeAiSelectorSet
    : defaultNormalizeAiSelectorSet;
  const buildAiSubmissionXpaths = typeof options.buildAiSubmissionXpaths === "function"
    ? options.buildAiSubmissionXpaths
    : defaultBuildAiSubmissionXpaths;
  const isPageWithinBaseUrl = typeof options.isPageWithinBaseUrl === "function"
    ? options.isPageWithinBaseUrl
    : defaultIsPageWithinBaseUrl;

  const resolveBackgroundNetworkCredentials: NonNullable<AiRunOrchestratorOptions["resolveBackgroundNetworkCredentials"]> = typeof options.resolveBackgroundNetworkCredentials === "function"
    ? options.resolveBackgroundNetworkCredentials
    : async () => ({ endpointValue: "", tokenValue: "" });
  const requestAiRunStartSnapshot: NonNullable<AiRunOrchestratorOptions["requestAiRunStartSnapshot"]> = typeof options.requestAiRunStartSnapshot === "function"
    ? options.requestAiRunStartSnapshot
    : async () => ({ ok: false });
  const requestAiRunStatus: NonNullable<AiRunOrchestratorOptions["requestAiRunStatus"]> = typeof options.requestAiRunStatus === "function"
    ? options.requestAiRunStatus
    : async () => ({ ok: false });
  const requestAiRunResultSnapshot: NonNullable<AiRunOrchestratorOptions["requestAiRunResultSnapshot"]> = typeof options.requestAiRunResultSnapshot === "function"
    ? options.requestAiRunResultSnapshot
    : async () => ({ ok: false });
  const fetchStaticPageHtmlForBackground: NonNullable<AiRunOrchestratorOptions["fetchStaticPageHtmlForBackground"]> = typeof options.fetchStaticPageHtmlForBackground === "function"
    ? options.fetchStaticPageHtmlForBackground
    : async () => ({ ok: false });

  const getTransferPayload: NonNullable<AiRunOrchestratorOptions["getTransferPayload"]> = typeof options.getTransferPayload === "function"
    ? options.getTransferPayload
    : async () => ({ ok: false });
  const putTransferPayload: NonNullable<AiRunOrchestratorOptions["putTransferPayload"]> = typeof options.putTransferPayload === "function"
    ? options.putTransferPayload
    : async () => ({ ok: false });
  const removeTransferPayload: NonNullable<AiRunOrchestratorOptions["removeTransferPayload"]> = typeof options.removeTransferPayload === "function"
    ? options.removeTransferPayload
    : async () => {};
  const consumeTransferPayload: NonNullable<AiRunOrchestratorOptions["consumeTransferPayload"]> = typeof options.consumeTransferPayload === "function"
    ? options.consumeTransferPayload
    : async () => ({ ok: false });

  const clearPersistedAiRunRecord: NonNullable<AiRunOrchestratorOptions["clearPersistedAiRunRecord"]> = typeof options.clearPersistedAiRunRecord === "function"
    ? options.clearPersistedAiRunRecord
    : async () => {};
  const savePersistedAiRunRecord: NonNullable<AiRunOrchestratorOptions["savePersistedAiRunRecord"]> = typeof options.savePersistedAiRunRecord === "function"
    ? options.savePersistedAiRunRecord
    : async () => null;

  const sendContentMessageToTab: NonNullable<AiRunOrchestratorOptions["sendContentMessageToTab"]> = typeof options.sendContentMessageToTab === "function"
    ? options.sendContentMessageToTab
    : async () => ({ ok: false });
  const ensureContentMainForTab: NonNullable<AiRunOrchestratorOptions["ensureContentMainForTab"]> = typeof options.ensureContentMainForTab === "function"
    ? options.ensureContentMainForTab
    : async () => ({ ok: false, error: "Content activation failed" });
  const getTabState: NonNullable<AiRunOrchestratorOptions["getTabState"]> = typeof options.getTabState === "function"
    ? options.getTabState
    : async () => null;
  const setTabState: NonNullable<AiRunOrchestratorOptions["setTabState"]> = typeof options.setTabState === "function"
    ? options.setTabState
    : async () => {};
  const updateActionForTab: NonNullable<AiRunOrchestratorOptions["updateActionForTab"]> = typeof options.updateActionForTab === "function"
    ? options.updateActionForTab
    : () => Promise.resolve();

  const refineXPathEntries: NonNullable<AiRunOrchestratorOptions["refineXPathEntries"]> = typeof options.refineXPathEntries === "function"
    ? options.refineXPathEntries
    : (_renderedHtml: string, _rawHtml: string, renderedXPaths: unknown) => renderedXPaths;
  const createManagedTimeoutGroup: NonNullable<AiRunOrchestratorOptions["createManagedTimeoutGroup"]> = typeof options.createManagedTimeoutGroup === "function"
    ? options.createManagedTimeoutGroup
    : defaultCreateManagedTimeoutGroup;
  const getAiRunResumeExpiresAt: NonNullable<AiRunOrchestratorOptions["getAiRunResumeExpiresAt"]> = typeof options.getAiRunResumeExpiresAt === "function"
    ? options.getAiRunResumeExpiresAt
    : () => Date.now() + 30_000;

  const configStore: AiRunConfigStore = options.configStore && typeof options.configStore === "object"
    ? options.configStore
    : {
      ensureConfig: async () => ({ pageMarkings: {} }),
      updateConfig: async () => ({ pageMarkings: {} })
    };

  const defaultExcludedImmutableSelectors = Array.isArray(options.defaultExcludedImmutableSelectors)
    ? options.defaultExcludedImmutableSelectors
    : [];
  const aiRunTimeoutMsOption = options.aiRunTimeoutMs;
  const aiRunTimeoutMs = typeof aiRunTimeoutMsOption === "number" && Number.isFinite(aiRunTimeoutMsOption) && aiRunTimeoutMsOption > 0
    ? Math.trunc(aiRunTimeoutMsOption)
    : 300_000;
  const aiRunPollIntervalMsOption = options.aiRunPollIntervalMs;
  const aiRunPollIntervalMs = typeof aiRunPollIntervalMsOption === "number" && Number.isFinite(aiRunPollIntervalMsOption) && aiRunPollIntervalMsOption > 0
    ? Math.trunc(aiRunPollIntervalMsOption)
    : 5_000;
  const refineXPathEntriesTimeoutMsOption = options.refineXPathEntriesTimeoutMs;
  const refineXPathEntriesTimeoutMs = typeof refineXPathEntriesTimeoutMsOption === "number" &&
      Number.isFinite(refineXPathEntriesTimeoutMsOption) &&
      refineXPathEntriesTimeoutMsOption > 0
    ? Math.trunc(refineXPathEntriesTimeoutMsOption)
    : 2_500;

  function getAiRunCurrentPageEntry(currentConfig: Config, currentPageUrl: string) {
    if (!currentPageUrl) {
      return null;
    }
    const pageMarkings = currentConfig.pageMarkings;
    if (!pageMarkings || typeof pageMarkings !== "object") {
      return null;
    }
    const entry = pageMarkings[currentPageUrl];
    return entry && typeof entry === "object" ? entry : null;
  }

  function isAiRunCurrentPageSnapshotMissing(currentConfig: Config, currentPageUrl: string) {
    const entry = getAiRunCurrentPageEntry(currentConfig, currentPageUrl);
    if (!entry) {
      return true;
    }
    if (typeof entry.renderedHtml !== "string" || !entry.renderedHtml) {
      return true;
    }
    if (!Array.isArray(entry.submissionXpaths) || entry.submissionXpaths.length === 0) {
      return true;
    }
    return false;
  }

  async function refineXPathEntriesWithBudget(
    renderedHtml: string,
    rawHtml: string,
    renderedXPaths: AiRunSubmissionXpath[],
    timeoutMs: number
  ) {
    if (!renderedXPaths.length) {
      return renderedXPaths;
    }
    const normalizedTimeoutMs = Math.max(0, Math.trunc(timeoutMs));
    if (!normalizedTimeoutMs) {
      return renderedXPaths;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fallback = renderedXPaths;
    const refinePromise = Promise.resolve()
      .then(() => refineXPathEntries(renderedHtml, rawHtml, renderedXPaths))
      .then((maybeRefined) => (Array.isArray(maybeRefined) ? maybeRefined as AiRunSubmissionXpath[] : fallback))
      .catch(() => fallback);
    const timeoutPromise = new Promise<AiRunSubmissionXpath[]>((resolve) => {
      timer = setTimeout(() => resolve(fallback), normalizedTimeoutMs);
    });
    try {
      return await Promise.race([refinePromise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function refineAiRunPayloadXpathsInBackground(payloadKey: string | null | undefined) {
    const sourcePayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
    if (!sourcePayloadKey) {
      return { ok: false, error: "Missing AI run payload" };
    }
    const loaded = await getTransferPayload(sourcePayloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    const payload = loaded && loaded.ok && loaded.payload && typeof loaded.payload === "object"
      ? (loaded.payload as { pages?: AiRunPayloadPage[] })
      : null;
    if (!payload || !Array.isArray(payload.pages)) {
      await removeTransferPayload(sourcePayloadKey);
      return { ok: false, error: "Unable to prepare AI payload" };
    }
    const refinedPages: AiRunPayloadPage[] = [];
    const refinementDeadlineAt = Date.now() + refineXPathEntriesTimeoutMs;
    for (const page of payload.pages) {
      const renderedHtml = page && typeof page.renderedHtml === "string" ? page.renderedHtml : "";
      const rawHtml = page && typeof page.rawHtml === "string" ? page.rawHtml : "";
      const renderedXPaths = Array.isArray(page && page.renderedXPaths)
        ? (page.renderedXPaths as AiRunSubmissionXpath[])
        : [];
      let refinedXPaths: AiRunSubmissionXpath[] = renderedXPaths;
      try {
        refinedXPaths = await refineXPathEntriesWithBudget(
          renderedHtml,
          rawHtml,
          renderedXPaths,
          refinementDeadlineAt - Date.now()
        );
      } catch {
        // Fall back to unrefined XPaths for this page.
      }
      refinedPages.push({ ...page, renderedXPaths: refinedXPaths });
    }
    const refinedPayload = { ...payload, pages: refinedPages };
    const stored = await putTransferPayload("ai-run-start-refined", refinedPayload);
    if (!stored.ok) {
      await removeTransferPayload(sourcePayloadKey);
      return { ok: false, error: "Unable to prepare AI payload" };
    }
    await removeTransferPayload(sourcePayloadKey);
    return {
      ok: true,
      payloadKey: stored.payloadKey
    };
  }

  async function loadAiRunSelectorSetFromPayloadKey(payloadKey: string | null | undefined) {
    const resultPayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
    if (!resultPayloadKey) {
      return null;
    }
    const loaded = await consumeTransferPayload(resultPayloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    const payload = loaded && loaded.ok && loaded.payload && typeof loaded.payload === "object"
      ? (loaded.payload as AiRunSelectorSetPayload)
      : null;
    if (
      !payload ||
      !Array.isArray(payload.exclusionSelectors) ||
      !Array.isArray(payload.inclusionSelectors)
    ) {
      return null;
    }
    return normalizeAiSelectorSet(payload);
  }

  async function setAiComputeLockForTab(tabId: TabLike, active: boolean, expiresAt: DeadlineLike = 0, baseUrl: string | null | undefined = "", lockOptions: { skipActivation?: boolean } = {}) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return { ok: false, active: Boolean(active), error: "Missing tab" };
    }
    const skipActivation = Boolean(lockOptions && lockOptions.skipActivation);
    const normalizedExpiresAt = Number(expiresAt);
    if (active) {
      const nextExpiresAt =
        Number.isFinite(normalizedExpiresAt) && normalizedExpiresAt > Date.now()
          ? normalizedExpiresAt
          : Date.now() + 30_000;
      aiComputeLockExpiresAtByTabId.set(normalizedTabId, nextExpiresAt);
    } else {
      aiComputeLockExpiresAtByTabId.delete(normalizedTabId);
    }
    const normalizedBaseUrl = typeof baseUrl === "string" ? baseUrl : "";
    if (active && normalizedBaseUrl && !skipActivation) {
      const existingTabState = await getTabState(normalizedTabId);
      const nextTabState: TabState = {
        ...(existingTabState && typeof existingTabState === "object" ? existingTabState : {}),
        enabled: true,
        baseUrl: normalizedBaseUrl
      };
      await setTabState(normalizedTabId, nextTabState);
      updateActionForTab(normalizedTabId).then();
    }
    if (active && !skipActivation) {
      const activationResult = await ensureContentMainForTab(normalizedTabId);
      if (!activationResult.ok) {
        return {
          ok: false,
          active: true,
          tabId: normalizedTabId,
          error: activationResult.error || "Content activation failed"
        };
      }
    }
    const response = await sendContentMessageToTab(normalizedTabId, {
      type: "setAiComputeLock",
      active: Boolean(active),
      expiresAt: Number(expiresAt) || 0
    });
    if (!active && (!response || !response.ok)) {
      return { ok: true, active: false, tabId: normalizedTabId };
    }
    return response && response.ok
      ? { ok: true, active: Boolean(active), tabId: normalizedTabId }
      : {
        ok: false,
        active: Boolean(active),
        tabId: normalizedTabId,
        error: (response && response.error) || "AI compute lock failed"
      };
  }

  function isAiComputeLockActiveForTab(tabId: TabLike) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return false;
    }
    const expiresAt = aiComputeLockExpiresAtByTabId.get(normalizedTabId);
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      aiComputeLockExpiresAtByTabId.delete(normalizedTabId);
      return false;
    }
    return true;
  }

  async function refreshAiRunHeartbeat(options: AiRunHeartbeatOptions = {}) {
    const tabId = normalizeTabId(options.tabId);
    const sessionId = typeof options.sessionId === "string" ? options.sessionId.trim() : "";
    const siteId = normalizeSiteIdValue(options.siteId);
    const deadlineAt = Number(options.deadlineAt);
    const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : "";
    if (!tabId || !sessionId || !siteId || !Number.isFinite(deadlineAt) || deadlineAt <= 0) {
      return { ok: false, record: null, expiresAt: 0, lockApplied: false };
    }
    const expiresAt = getAiRunResumeExpiresAt();
    const record = await savePersistedAiRunRecord({
      sessionId,
      siteId,
      expiresAt,
      deadlineAt
    });
    if (!record) {
      return { ok: false, record: null, expiresAt: 0, lockApplied: false };
    }
    const lockResult = await setAiComputeLockForTab(tabId, true, expiresAt, baseUrl, { skipActivation: true });
    if (!lockResult.ok) {
      await clearPersistedAiRunRecord();
      return {
        ok: false,
        record: null,
        expiresAt: 0,
        lockApplied: false,
        error: lockResult.error || "AI compute lock failed"
      };
    }
    return { ok: true, record, expiresAt, lockApplied: true };
  }

  async function prepareAiRunPayloadSnapshot(options: AiRunPrepareOptions = {}) {
    const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
    const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
    const currentRenderMode = typeof options.currentRenderMode === "string" ? options.currentRenderMode.trim() : "";
    if (!baseUrl || !currentPageUrl) {
      return { ok: false };
    }
    try {
      const currentConfig = await configStore.ensureConfig(baseUrl);
      const pageMarkings = currentConfig && currentConfig.pageMarkings && typeof currentConfig.pageMarkings === "object"
        ? currentConfig.pageMarkings
        : {};
      const storedPageEntries = Object.entries(pageMarkings)
        .filter(([url, entry]) => {
          if (!url || !entry || typeof entry !== "object") {
            return false;
          }
          if (baseUrl && !isPageWithinBaseUrl(url, baseUrl)) {
            return false;
          }
          if (typeof entry.renderedHtml !== "string" || !entry.renderedHtml) {
            return false;
          }
          if (!Array.isArray(entry.submissionXpaths) || entry.submissionXpaths.length === 0) {
            return false;
          }
          return true;
        });
      if (!storedPageEntries.some(([url]) => url === currentPageUrl)) {
        return { ok: false, reason: "missing_current_page" };
      }
      if (!storedPageEntries.length) {
        return { ok: false, reason: "missing_saved_pages" };
      }
      const urlsMissingRawHtml = storedPageEntries
        .map(([url, entry]) => ({ url, entry }))
        .filter(({ entry }) => {
          return typeof entry.rawHtml !== "string" || !entry.rawHtml;
        });
      const backfillResults = await Promise.all(
        urlsMissingRawHtml.map(async ({ url }) => {
          const response = await fetchStaticPageHtmlForBackground(url);
          if (!response.ok || typeof response.html !== "string" || !response.html) {
            return null;
          }
          return { url, rawHtml: response.html };
        })
      );
      const successfulBackfills = backfillResults.filter(Boolean) as Array<{ url: string; rawHtml: string }>;
      if (successfulBackfills.length) {
        await configStore.updateConfig(baseUrl, (targetConfig: Config) => {
          if (!targetConfig.pageMarkings || typeof targetConfig.pageMarkings !== "object") {
            return;
          }
          const targetPageMarkings = targetConfig.pageMarkings;
          successfulBackfills.forEach((item) => {
            const targetEntry = targetPageMarkings[item.url];
            if (!targetEntry || typeof targetEntry !== "object") {
              return;
            }
            targetEntry.rawHtml = item.rawHtml;
          });
        });
      }
      const rawHtmlBackfills = new Map();
      successfulBackfills.forEach((item) => {
        rawHtmlBackfills.set(item.url, item.rawHtml);
      });
      const toAiRunSubmissionEntry = (
        entry: { includeXpaths?: string[]; submissionXpaths?: AiRunStoredXpath[] }
      ): AiRunSubmissionEntry => {
        const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
        const includeSet = new Set(includeXpaths);
        const normalizedSubmissionXpaths = Array.isArray(entry.submissionXpaths)
          ? entry.submissionXpaths
            .map((item) => {
              if (typeof item === "string") {
                const xpath = item.trim();
                if (!xpath) {
                  return null;
                }
                return {
                  xpath,
                  excluded: false,
                  explicit: includeSet.has(xpath)
                };
              }
              if (!item || typeof item !== "object" || typeof item.xpath !== "string") {
                return null;
              }
              const xpath = item.xpath.trim();
              if (!xpath) {
                return null;
              }
              const excluded = item.excluded === true;
              const explicit = item.explicit === true;
              return explicit ? { xpath, excluded, explicit: true } : { xpath, excluded };
            })
            .filter((item): item is { xpath: string; excluded: boolean; explicit?: boolean } => Boolean(item))
          : [];
        return {
          includeXpaths,
          submissionXpaths: normalizedSubmissionXpaths
        };
      };

      const pages: AiRunPayloadPage[] = storedPageEntries.map(([url, entryValue]) => {
        const entry = toAiRunSubmissionEntry({
          includeXpaths: Array.isArray(entryValue.includeXpaths) ? entryValue.includeXpaths : [],
          submissionXpaths: Array.isArray(
            (entryValue as { submissionXpaths?: unknown }).submissionXpaths
          )
            ? ((entryValue as { submissionXpaths?: unknown }).submissionXpaths as AiRunStoredXpath[])
            : []
        });
        const rawHtml =
          entryValue && typeof entryValue.rawHtml === "string" && entryValue.rawHtml
            ? entryValue.rawHtml
            : rawHtmlBackfills.get(url) || "";
        return {
          url,
          renderedHtml: typeof entryValue.renderedHtml === "string" ? entryValue.renderedHtml : "",
          rawHtml: currentRenderMode === "static" ? rawHtml : undefined,
          renderedXPaths: buildAiSubmissionXpaths(entry)
        };
      });
      const payload: AiRunPayloadSnapshot = {
        baseUrl,
        renderMode: currentRenderMode,
        defaultExclusionSelectors: defaultExcludedImmutableSelectors,
        pages
      };
      const stored = await putTransferPayload("ai-run-prepare", payload);
      if (!stored.ok) {
        return { ok: false };
      }
      return {
        ok: true,
        payloadKey: stored.payloadKey,
        requiresRawXPathRefinement: currentRenderMode === "static"
      };
    } catch {
      return { ok: false };
    }
  }

  async function runAiCommandForTab(tabId: TabLike, payload: AiRunCommandPayload, update: AiRunProgressUpdate) {
    const timeoutGroup = createManagedTimeoutGroup();
    const normalizedTabId = normalizeTabId(tabId);
    const baseUrl = normalizeActivationBaseUrl(payload.baseUrl);
    const currentPageUrl = typeof payload.currentPageUrl === "string"
      ? payload.currentPageUrl.trim()
      : "";
    const pageType = typeof payload.pageType === "string" ? payload.pageType : "";
    const currentRenderMode = typeof payload.currentRenderMode === "string"
      ? payload.currentRenderMode.trim()
      : "";
    const credentials = await resolveBackgroundNetworkCredentials({
      endpointValue: payload && payload.endpointValue,
      tokenValue: payload && payload.tokenValue,
      endpointPreference: "ai"
    });
    const endpointValue = credentials.endpointValue;
    const tokenValue = credentials.tokenValue;
    const requestedSiteId = normalizeSiteIdValue(payload.siteId);
    const requestedDeadlineAt = Number(payload.deadlineAt);
    const deadlineAt = Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > Date.now()
      ? requestedDeadlineAt
      : Date.now() + aiRunTimeoutMs;

    if (!normalizedTabId || !baseUrl || !currentPageUrl || !endpointValue || !tokenValue) {
      return {
        ok: false,
        reason: "invalid_request",
        error: "Missing AI run parameters"
      };
    }

    let initialLockSet = false;
    try {
      const initialLock = await setAiComputeLockForTab(
        normalizedTabId,
        true,
        getAiRunResumeExpiresAt(),
        baseUrl
      );
      if (!initialLock || !initialLock.ok) {
        return {
          ok: false,
          reason: "compute_lock_failed",
          error: (initialLock && initialLock.error) || "AI compute lock failed"
        };
      }
      initialLockSet = true;

      await update({
        message: "Computing selectors...",
        reason: "tab-run-ai-snapshot",
        source: "background-command-router"
      });

      let currentConfig = await configStore.ensureConfig(baseUrl);
      const needsSnapshot = isAiRunCurrentPageSnapshotMissing(currentConfig, currentPageUrl);
      if (needsSnapshot) {
        const snapshotResponse = await sendContentMessageToTab(normalizedTabId, {
          type: "capturePageSnapshot",
          baseUrl,
          pageType,
          persist: true
        });
        if (!snapshotResponse || !snapshotResponse.ok) {
          return {
            ok: false,
            reason: "snapshot_capture_failed",
            error: (snapshotResponse && snapshotResponse.error) || "Unable to capture page snapshot",
            reconciliationPending: Boolean(snapshotResponse && snapshotResponse.reconciliationPending),
            locked: Boolean(snapshotResponse && snapshotResponse.locked)
          };
        }
        currentConfig = await configStore.ensureConfig(baseUrl);
        if (isAiRunCurrentPageSnapshotMissing(currentConfig, currentPageUrl)) {
          return {
            ok: false,
            reason: "missing_current_page",
            error: "Current page snapshot is unavailable"
          };
        }
      }

      await update({
        message: "Computing selectors...",
        reason: "tab-run-ai-prepare",
        source: "background-command-router"
      });

      const preparedPayload = await prepareAiRunPayloadSnapshot({
        baseUrl,
        currentPageUrl,
        currentRenderMode
      });
      if (!preparedPayload || preparedPayload.ok !== true || !preparedPayload.payloadKey) {
        return {
          ok: false,
          reason: (preparedPayload && preparedPayload.reason) || "prepare_failed",
          error: "Unable to prepare AI payload"
        };
      }

      let startPayloadKey = preparedPayload.payloadKey;
      if (preparedPayload.requiresRawXPathRefinement) {
        const refined = await refineAiRunPayloadXpathsInBackground(startPayloadKey);
        if (!refined || !refined.ok || !refined.payloadKey) {
          return {
            ok: false,
            reason: "refine_failed",
            error: (refined && refined.error) || "Unable to prepare AI payload"
          };
        }
        startPayloadKey = refined.payloadKey;
      }

      const startResult = await requestAiRunStartSnapshot({
        endpointValue,
        tokenValue,
        payloadKey: startPayloadKey,
        onBeforeRequest: async () => {
          await update({
            message: "Analyzing page content with AI...",
            reason: "tab-run-ai-running",
            source: "background-command-router"
          });
        }
      });
      if (!startResult || !startResult.ok || !startResult.sessionId) {
        return {
          ok: false,
          reason: (startResult && startResult.reason) || "start_failed",
          error: "Unable to start AI run"
        };
      }

      const sessionId = String(startResult.sessionId || "").trim();
      if (!sessionId) {
        return {
          ok: false,
          reason: "start_failed",
          error: "Unable to start AI run"
        };
      }

      const siteId = requestedSiteId || normalizeSiteIdValue(currentConfig && currentConfig.siteId);

      while (Date.now() < deadlineAt) {
        const remainingMs = Math.max(0, deadlineAt - Date.now());
        const pollDelayMs = Math.min(aiRunPollIntervalMs, remainingMs || aiRunPollIntervalMs);
        await new Promise((resolve) => {
          timeoutGroup.set(resolve, pollDelayMs);
        });
        if (siteId) {
          await refreshAiRunHeartbeat({
            tabId: normalizedTabId,
            sessionId,
            siteId,
            deadlineAt,
            baseUrl
          }).catch(() => null);
        }

        let statusResult = null;
        try {
          statusResult = await requestAiRunStatus({
            endpointValue,
            tokenValue,
            sessionId
          });
        } catch {
          statusResult = { ok: false };
        }
        if (!statusResult || statusResult.notFound) {
          return {
            ok: false,
            reason: "not_found",
            error: "AI run no longer exists"
          };
        }
        if (!statusResult.ok) {
          return {
            ok: false,
            reason: "status_failed",
            error: "Unable to read AI run status"
          };
        }
        if (statusResult.status === "running") {
          continue;
        }
        if (statusResult.status === "error") {
          return {
            ok: false,
            reason: "run_error",
            error: "AI run failed"
          };
        }

        const resultSnapshot = await requestAiRunResultSnapshot({
          endpointValue,
          tokenValue,
          sessionId
        });
        if (!resultSnapshot || resultSnapshot.notFound) {
          return {
            ok: false,
            reason: "not_found",
            error: "AI run no longer exists"
          };
        }
        if (!resultSnapshot.ok || !resultSnapshot.payloadKey) {
          return {
            ok: false,
            reason: "result_failed",
            error: "Unable to fetch AI run result"
          };
        }

        const selectorSet = await loadAiRunSelectorSetFromPayloadKey(resultSnapshot.payloadKey);
        if (!selectorSet) {
          return {
            ok: false,
            reason: "result_invalid",
            error: "AI run result is invalid"
          };
        }

        return {
          ok: true,
          sessionId,
          selectorSet,
          siteId,
          deadlineAt
        };
      }

      return {
        ok: false,
        reason: "timed_out",
        error: "AI run timed out"
      };
    } finally {
      timeoutGroup.clearAll();
      await clearPersistedAiRunRecord().catch(() => null);
      if (initialLockSet) {
        await setAiComputeLockForTab(normalizedTabId, false, 0, baseUrl).catch(() => null);
      }
    }
  }

  return {
    getAiRunCurrentPageEntry,
    isAiRunCurrentPageSnapshotMissing,
    refineAiRunPayloadXpathsInBackground,
    loadAiRunSelectorSetFromPayloadKey,
    runAiCommandForTab,
    setAiComputeLockForTab,
    isAiComputeLockActiveForTab,
    refreshAiRunHeartbeat,
    prepareAiRunPayloadSnapshot
  };
}
