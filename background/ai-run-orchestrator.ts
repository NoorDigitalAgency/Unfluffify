interface AiRunHeartbeatOptions {
  tabId?: unknown;
  sessionId?: unknown;
  siteId?: unknown;
  deadlineAt?: unknown;
  baseUrl?: unknown;
}

interface AiRunPrepareOptions {
  baseUrl?: unknown;
  currentPageUrl?: unknown;
  currentRenderMode?: unknown;
}

interface TransferPayloadResult {
  ok: boolean;
  payload?: unknown;
  payloadKey?: string;
}

interface AiRunManagedTimeoutGroup {
  set(fn: (value?: unknown) => void, ms: number): unknown;
  clear(handle: unknown): void;
  clearAll(): void;
}

interface AiRunConfigStore {
  ensureConfig(baseUrl: string): Promise<Record<string, unknown>>;
  updateConfig(baseUrl: string, mutate: (config: any) => void): Promise<void>;
}

interface AiRunOrchestratorOptions {
  aiComputeLockExpiresAtByTabId?: Map<number, number>;
  normalizeTabId?(value: unknown): number | null;
  normalizeActivationBaseUrl?(value: unknown): string;
  normalizeSiteIdValue?(value: unknown): number | null;
  normalizeAiSelectorSet?(value: unknown): unknown;
  buildAiSubmissionXpaths?(entry: unknown): unknown[];
  isPageWithinBaseUrl?(pageUrl: unknown, baseUrl: unknown): boolean;
  resolveBackgroundNetworkCredentials?(
    args: unknown
  ): Promise<{ endpointValue: string; tokenValue: string }>;
  requestAiRunStartSnapshot?(args: unknown): Promise<{ ok: boolean; sessionId?: string }>;
  requestAiRunStatus?(
    args: unknown
  ): Promise<{ ok: boolean; notFound?: boolean; status?: string }>;
  requestAiRunResultSnapshot?(
    args: unknown
  ): Promise<{ ok: boolean; notFound?: boolean; payloadKey?: string }>;
  fetchStaticPageHtmlForBackground?(url: unknown): Promise<{ ok: boolean; html?: string }>;
  getTransferPayload?(key: unknown, options?: unknown): Promise<TransferPayloadResult>;
  putTransferPayload?(kind: unknown, payload: unknown): Promise<TransferPayloadResult>;
  removeTransferPayload?(key: unknown): Promise<unknown>;
  consumeTransferPayload?(key: unknown, options?: unknown): Promise<TransferPayloadResult>;
  clearPersistedAiRunRecord?(): Promise<unknown>;
  savePersistedAiRunRecord?(record: unknown): Promise<unknown>;
  sendContentMessageToTab?(
    tabId: unknown,
    message: unknown
  ): Promise<{ ok: boolean; error?: string; reconciliationPending?: boolean; locked?: boolean }>;
  ensureContentMainForTab?(tabId: unknown): Promise<{ ok: boolean; error?: string }>;
  getTabState?(tabId: unknown): Promise<unknown>;
  setTabState?(tabId: unknown, tabState: unknown): Promise<unknown>;
  updateActionForTab?(...args: unknown[]): Promise<unknown>;
  refineXPathEntries?(renderedHtml: unknown, rawHtml: unknown, renderedXPaths: unknown): unknown;
  createManagedTimeoutGroup?(): AiRunManagedTimeoutGroup;
  getAiRunResumeExpiresAt?(): number;
  configStore?: AiRunConfigStore;
  defaultExcludedImmutableSelectors?: unknown[];
  aiRunTimeoutMs?: number;
  aiRunPollIntervalMs?: number;
}

function defaultNormalizeTabId(value: any) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function defaultNormalizeActivationBaseUrl(value: any) {
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

function defaultCreateManagedTimeoutGroup() {
  return {
    set(fn: any, ms: any) {
      return setTimeout(fn, ms);
    },
    clear(handle: any) {
      clearTimeout(handle);
    },
    clearAll() {}
  };
}

export function createAiRunOrchestrator(options: AiRunOrchestratorOptions = {}) {
  const optionsAny = options;
  const aiComputeLockExpiresAtByTabId: Map<number, number> = optionsAny.aiComputeLockExpiresAtByTabId instanceof Map
    ? optionsAny.aiComputeLockExpiresAtByTabId
    : new Map<number, number>();
  const normalizeTabId = typeof optionsAny.normalizeTabId === "function"
    ? optionsAny.normalizeTabId
    : defaultNormalizeTabId;
  const normalizeActivationBaseUrl = typeof optionsAny.normalizeActivationBaseUrl === "function"
    ? optionsAny.normalizeActivationBaseUrl
    : defaultNormalizeActivationBaseUrl;
  const normalizeSiteIdValue = typeof optionsAny.normalizeSiteIdValue === "function"
    ? optionsAny.normalizeSiteIdValue
    : defaultNormalizeSiteIdValue;
  const normalizeAiSelectorSet = typeof optionsAny.normalizeAiSelectorSet === "function"
    ? optionsAny.normalizeAiSelectorSet
    : defaultNormalizeAiSelectorSet;
  const buildAiSubmissionXpaths = typeof optionsAny.buildAiSubmissionXpaths === "function"
    ? optionsAny.buildAiSubmissionXpaths
    : defaultBuildAiSubmissionXpaths;
  const isPageWithinBaseUrl = typeof optionsAny.isPageWithinBaseUrl === "function"
    ? optionsAny.isPageWithinBaseUrl
    : defaultIsPageWithinBaseUrl;

  const resolveBackgroundNetworkCredentials: NonNullable<AiRunOrchestratorOptions["resolveBackgroundNetworkCredentials"]> = typeof optionsAny.resolveBackgroundNetworkCredentials === "function"
    ? optionsAny.resolveBackgroundNetworkCredentials
    : async () => ({ endpointValue: "", tokenValue: "" });
  const requestAiRunStartSnapshot: NonNullable<AiRunOrchestratorOptions["requestAiRunStartSnapshot"]> = typeof optionsAny.requestAiRunStartSnapshot === "function"
    ? optionsAny.requestAiRunStartSnapshot
    : async () => ({ ok: false });
  const requestAiRunStatus: NonNullable<AiRunOrchestratorOptions["requestAiRunStatus"]> = typeof optionsAny.requestAiRunStatus === "function"
    ? optionsAny.requestAiRunStatus
    : async () => ({ ok: false });
  const requestAiRunResultSnapshot: NonNullable<AiRunOrchestratorOptions["requestAiRunResultSnapshot"]> = typeof optionsAny.requestAiRunResultSnapshot === "function"
    ? optionsAny.requestAiRunResultSnapshot
    : async () => ({ ok: false });
  const fetchStaticPageHtmlForBackground: NonNullable<AiRunOrchestratorOptions["fetchStaticPageHtmlForBackground"]> = typeof optionsAny.fetchStaticPageHtmlForBackground === "function"
    ? optionsAny.fetchStaticPageHtmlForBackground
    : async () => ({ ok: false });

  const getTransferPayload: NonNullable<AiRunOrchestratorOptions["getTransferPayload"]> = typeof optionsAny.getTransferPayload === "function"
    ? optionsAny.getTransferPayload
    : async () => ({ ok: false });
  const putTransferPayload: NonNullable<AiRunOrchestratorOptions["putTransferPayload"]> = typeof optionsAny.putTransferPayload === "function"
    ? optionsAny.putTransferPayload
    : async () => ({ ok: false });
  const removeTransferPayload: NonNullable<AiRunOrchestratorOptions["removeTransferPayload"]> = typeof optionsAny.removeTransferPayload === "function"
    ? optionsAny.removeTransferPayload
    : async () => {};
  const consumeTransferPayload: NonNullable<AiRunOrchestratorOptions["consumeTransferPayload"]> = typeof optionsAny.consumeTransferPayload === "function"
    ? optionsAny.consumeTransferPayload
    : async () => ({ ok: false });

  const clearPersistedAiRunRecord: NonNullable<AiRunOrchestratorOptions["clearPersistedAiRunRecord"]> = typeof optionsAny.clearPersistedAiRunRecord === "function"
    ? optionsAny.clearPersistedAiRunRecord
    : async () => {};
  const savePersistedAiRunRecord: NonNullable<AiRunOrchestratorOptions["savePersistedAiRunRecord"]> = typeof optionsAny.savePersistedAiRunRecord === "function"
    ? optionsAny.savePersistedAiRunRecord
    : async () => null;

  const sendContentMessageToTab: NonNullable<AiRunOrchestratorOptions["sendContentMessageToTab"]> = typeof optionsAny.sendContentMessageToTab === "function"
    ? optionsAny.sendContentMessageToTab
    : async () => ({ ok: false });
  const ensureContentMainForTab: NonNullable<AiRunOrchestratorOptions["ensureContentMainForTab"]> = typeof optionsAny.ensureContentMainForTab === "function"
    ? optionsAny.ensureContentMainForTab
    : async () => ({ ok: false, error: "Content activation failed" });
  const getTabState: NonNullable<AiRunOrchestratorOptions["getTabState"]> = typeof optionsAny.getTabState === "function"
    ? optionsAny.getTabState
    : async () => null;
  const setTabState: NonNullable<AiRunOrchestratorOptions["setTabState"]> = typeof optionsAny.setTabState === "function"
    ? optionsAny.setTabState
    : async () => {};
  const updateActionForTab: NonNullable<AiRunOrchestratorOptions["updateActionForTab"]> = typeof optionsAny.updateActionForTab === "function"
    ? optionsAny.updateActionForTab
    : () => Promise.resolve();

  const refineXPathEntries: NonNullable<AiRunOrchestratorOptions["refineXPathEntries"]> = typeof optionsAny.refineXPathEntries === "function"
    ? optionsAny.refineXPathEntries
    : (_renderedHtml: unknown, _rawHtml: unknown, renderedXPaths: unknown) => renderedXPaths;
  const createManagedTimeoutGroup: NonNullable<AiRunOrchestratorOptions["createManagedTimeoutGroup"]> = typeof optionsAny.createManagedTimeoutGroup === "function"
    ? optionsAny.createManagedTimeoutGroup
    : defaultCreateManagedTimeoutGroup;
  const getAiRunResumeExpiresAt: NonNullable<AiRunOrchestratorOptions["getAiRunResumeExpiresAt"]> = typeof optionsAny.getAiRunResumeExpiresAt === "function"
    ? optionsAny.getAiRunResumeExpiresAt
    : () => Date.now() + 30_000;

  const configStore: AiRunConfigStore = optionsAny.configStore && typeof optionsAny.configStore === "object"
    ? optionsAny.configStore
    : {
      ensureConfig: async () => ({}),
      updateConfig: async () => {}
    };

  const defaultExcludedImmutableSelectors = Array.isArray(optionsAny.defaultExcludedImmutableSelectors)
    ? optionsAny.defaultExcludedImmutableSelectors
    : [];
  const aiRunTimeoutMsOption = optionsAny.aiRunTimeoutMs;
  const aiRunTimeoutMs = typeof aiRunTimeoutMsOption === "number" && Number.isFinite(aiRunTimeoutMsOption) && aiRunTimeoutMsOption > 0
    ? Math.trunc(aiRunTimeoutMsOption)
    : 300_000;
  const aiRunPollIntervalMsOption = optionsAny.aiRunPollIntervalMs;
  const aiRunPollIntervalMs = typeof aiRunPollIntervalMsOption === "number" && Number.isFinite(aiRunPollIntervalMsOption) && aiRunPollIntervalMsOption > 0
    ? Math.trunc(aiRunPollIntervalMsOption)
    : 5_000;

  function getAiRunCurrentPageEntry(currentConfig: any, currentPageUrl: any) {
    if (!currentConfig || typeof currentConfig !== "object") {
      return null;
    }
    const pageMarkings = currentConfig.pageMarkings;
    if (!pageMarkings || typeof pageMarkings !== "object") {
      return null;
    }
    const entry = pageMarkings[currentPageUrl];
    return entry && typeof entry === "object" ? entry : null;
  }

  function isAiRunCurrentPageSnapshotMissing(currentConfig: any, currentPageUrl: any) {
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

  async function refineAiRunPayloadXpathsInBackground(payloadKey: any) {
    const sourcePayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
    if (!sourcePayloadKey) {
      return { ok: false, error: "Missing AI run payload" };
    }
    const loaded = await getTransferPayload(sourcePayloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    const payload = loaded && loaded.ok && loaded.payload && typeof loaded.payload === "object"
      ? (loaded.payload as { pages?: unknown })
      : null;
    if (!payload || !Array.isArray(payload.pages)) {
      await removeTransferPayload(sourcePayloadKey);
      return { ok: false, error: "Unable to prepare AI payload" };
    }
    const refinedPayload = {
      ...payload,
      pages: payload.pages.map((page: any) => {
        const renderedHtml = page && typeof page.renderedHtml === "string" ? page.renderedHtml : "";
        const rawHtml = page && typeof page.rawHtml === "string" ? page.rawHtml : "";
        const renderedXPaths = Array.isArray(page && page.renderedXPaths) ? page.renderedXPaths : [];
        return {
          ...page,
          rawXPaths: refineXPathEntries(renderedHtml, rawHtml, renderedXPaths)
        };
      })
    };
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

  async function loadAiRunSelectorSetFromPayloadKey(payloadKey: any) {
    const resultPayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
    if (!resultPayloadKey) {
      return null;
    }
    const loaded = await consumeTransferPayload(resultPayloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    const payload = loaded && loaded.ok && loaded.payload && typeof loaded.payload === "object"
      ? (loaded.payload as { exclusionSelectors?: unknown; inclusionSelectors?: unknown })
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

  async function setAiComputeLockForTab(tabId: any, active: any, expiresAt: any = 0, baseUrl: any = "") {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return { ok: false, active: Boolean(active), error: "Missing tab" };
    }
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
    if (active && normalizedBaseUrl) {
      const existingTabState = await getTabState(normalizedTabId);
      const nextTabState = {
        ...(existingTabState && typeof existingTabState === "object" ? existingTabState : {}),
        enabled: true,
        baseUrl: normalizedBaseUrl
      };
      await setTabState(normalizedTabId, nextTabState);
      updateActionForTab(normalizedTabId).then();
    }
    if (active) {
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

  function isAiComputeLockActiveForTab(tabId: any) {
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
    const lockResult = await setAiComputeLockForTab(tabId, true, expiresAt, baseUrl);
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
      const pageMarkings: any =
        currentConfig && currentConfig.pageMarkings && typeof currentConfig.pageMarkings === "object"
          ? currentConfig.pageMarkings
          : {};
      const storedPageEntries = Object.entries(pageMarkings)
        .filter(([url, entry]) => {
          const entryAny = entry as any;
          if (!url || !entry || typeof entry !== "object") {
            return false;
          }
          if (baseUrl && !isPageWithinBaseUrl(url, baseUrl)) {
            return false;
          }
          if (typeof entryAny.renderedHtml !== "string" || !entryAny.renderedHtml) {
            return false;
          }
          if (!Array.isArray(entryAny.submissionXpaths) || entryAny.submissionXpaths.length === 0) {
            return false;
          }
          return true;
        });
      const storedPageEntriesAny = storedPageEntries as Array<[string, any]>;
      if (!storedPageEntries.some(([url]) => url === currentPageUrl)) {
        return { ok: false, reason: "missing_current_page" };
      }
      if (!storedPageEntries.length) {
        return { ok: false, reason: "missing_saved_pages" };
      }
      const urlsMissingRawHtml = storedPageEntriesAny
        .map(([url, entry]) => ({ url, entry }))
        .filter(({ entry }) => {
          const entryAny = entry as any;
          return typeof entryAny.rawHtml !== "string" || !entryAny.rawHtml;
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
        await configStore.updateConfig(baseUrl, (targetConfig: any) => {
          if (!targetConfig.pageMarkings || typeof targetConfig.pageMarkings !== "object") {
            return;
          }
          successfulBackfills.forEach((item) => {
            const targetEntry = targetConfig.pageMarkings[item.url];
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
      const pages = storedPageEntriesAny.map(([url, entry]) => {
        const entryAny = entry as any;
        const rawHtml =
          entryAny && typeof entryAny.rawHtml === "string" && entryAny.rawHtml
            ? entryAny.rawHtml
            : rawHtmlBackfills.get(url) || "";
        return {
          url,
          renderedHtml: typeof entryAny.renderedHtml === "string" ? entryAny.renderedHtml : "",
          rawHtml: currentRenderMode === "static" ? rawHtml : undefined,
          renderedXPaths: buildAiSubmissionXpaths(entry)
        };
      });
      const payload = {
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

  async function runAiCommandForTab(tabId: any, payload: any, update: any) {
    const payloadAny = payload as any;
    const timeoutGroup = createManagedTimeoutGroup();
    const baseUrl = normalizeActivationBaseUrl(payloadAny && payloadAny.baseUrl);
    const currentPageUrl = typeof payloadAny?.currentPageUrl === "string"
      ? payloadAny.currentPageUrl.trim()
      : "";
    const pageType = typeof payloadAny?.pageType === "string" ? payloadAny.pageType : "";
    const currentRenderMode = typeof payloadAny?.currentRenderMode === "string"
      ? payloadAny.currentRenderMode.trim()
      : "";
    const credentials = await resolveBackgroundNetworkCredentials({
      endpointValue: payload && payload.endpointValue,
      tokenValue: payload && payload.tokenValue,
      endpointPreference: "ai"
    });
    const endpointValue = credentials.endpointValue;
    const tokenValue = credentials.tokenValue;
    const requestedSiteId = normalizeSiteIdValue(payloadAny && payloadAny.siteId);
    const requestedDeadlineAt = Number(payloadAny && payloadAny.deadlineAt);
    const deadlineAt = Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > Date.now()
      ? requestedDeadlineAt
      : Date.now() + aiRunTimeoutMs;

    if (!baseUrl || !currentPageUrl || !endpointValue || !tokenValue) {
      return {
        ok: false,
        reason: "invalid_request",
        error: "Missing AI run parameters"
      };
    }

    let initialLockSet = false;
    try {
      const initialLock = await setAiComputeLockForTab(
        tabId,
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
        const snapshotResponse = await sendContentMessageToTab(tabId, {
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
        payloadKey: startPayloadKey
      });
      if (!startResult || !startResult.ok || !startResult.sessionId) {
        return {
          ok: false,
          reason: "start_failed",
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
          const heartbeat = await refreshAiRunHeartbeat({
            tabId,
            sessionId,
            siteId,
            deadlineAt,
            baseUrl
          }).catch(() => null);
          if (!heartbeat || !heartbeat.ok) {
            return {
              ok: false,
              reason: "heartbeat_failed",
              error: (heartbeat && heartbeat.error) || "AI run heartbeat failed"
            };
          }
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
        await setAiComputeLockForTab(tabId, false, 0, baseUrl).catch(() => null);
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
