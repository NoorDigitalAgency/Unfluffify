// @ts-nocheck
function defaultNormalizeTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function defaultNormalizeActivationBaseUrl(value) {
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
    set(fn, ms) {
      return setTimeout(fn, ms);
    },
    clear(handle) {
      clearTimeout(handle);
    },
    clearAll() {}
  };
}

export function createAiRunOrchestrator(options = {}) {
  const aiComputeLockExpiresAtByTabId = options.aiComputeLockExpiresAtByTabId instanceof Map
    ? options.aiComputeLockExpiresAtByTabId
    : new Map();
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

  const resolveBackgroundNetworkCredentials = typeof options.resolveBackgroundNetworkCredentials === "function"
    ? options.resolveBackgroundNetworkCredentials
    : async () => ({ endpointValue: "", tokenValue: "" });
  const requestAiRunStartSnapshot = typeof options.requestAiRunStartSnapshot === "function"
    ? options.requestAiRunStartSnapshot
    : async () => ({ ok: false });
  const requestAiRunStatus = typeof options.requestAiRunStatus === "function"
    ? options.requestAiRunStatus
    : async () => ({ ok: false });
  const requestAiRunResultSnapshot = typeof options.requestAiRunResultSnapshot === "function"
    ? options.requestAiRunResultSnapshot
    : async () => ({ ok: false });
  const fetchStaticPageHtmlForBackground = typeof options.fetchStaticPageHtmlForBackground === "function"
    ? options.fetchStaticPageHtmlForBackground
    : async () => ({ ok: false });

  const getTransferPayload = typeof options.getTransferPayload === "function"
    ? options.getTransferPayload
    : async () => ({ ok: false });
  const putTransferPayload = typeof options.putTransferPayload === "function"
    ? options.putTransferPayload
    : async () => ({ ok: false });
  const removeTransferPayload = typeof options.removeTransferPayload === "function"
    ? options.removeTransferPayload
    : async () => {};
  const consumeTransferPayload = typeof options.consumeTransferPayload === "function"
    ? options.consumeTransferPayload
    : async () => ({ ok: false });

  const clearPersistedAiRunRecord = typeof options.clearPersistedAiRunRecord === "function"
    ? options.clearPersistedAiRunRecord
    : async () => {};
  const savePersistedAiRunRecord = typeof options.savePersistedAiRunRecord === "function"
    ? options.savePersistedAiRunRecord
    : async () => null;

  const sendContentMessageToTab = typeof options.sendContentMessageToTab === "function"
    ? options.sendContentMessageToTab
    : async () => ({ ok: false });
  const ensureContentMainForTab = typeof options.ensureContentMainForTab === "function"
    ? options.ensureContentMainForTab
    : async () => ({ ok: false, error: "Content activation failed" });
  const getTabState = typeof options.getTabState === "function"
    ? options.getTabState
    : async () => null;
  const setTabState = typeof options.setTabState === "function"
    ? options.setTabState
    : async () => {};
  const updateActionForTab = typeof options.updateActionForTab === "function"
    ? options.updateActionForTab
    : () => Promise.resolve();

  const refineXPathEntries = typeof options.refineXPathEntries === "function"
    ? options.refineXPathEntries
    : (_renderedHtml, _rawHtml, renderedXPaths) => renderedXPaths;
  const createManagedTimeoutGroup = typeof options.createManagedTimeoutGroup === "function"
    ? options.createManagedTimeoutGroup
    : defaultCreateManagedTimeoutGroup;
  const getAiRunResumeExpiresAt = typeof options.getAiRunResumeExpiresAt === "function"
    ? options.getAiRunResumeExpiresAt
    : () => Date.now() + 30_000;

  const configStore = options.configStore && typeof options.configStore === "object"
    ? options.configStore
    : {
      ensureConfig: async () => ({}),
      updateConfig: async () => {}
    };

  const defaultExcludedImmutableSelectors = Array.isArray(options.defaultExcludedImmutableSelectors)
    ? options.defaultExcludedImmutableSelectors
    : [];
  const aiRunTimeoutMs = Number.isFinite(options.aiRunTimeoutMs) && options.aiRunTimeoutMs > 0
    ? Math.trunc(options.aiRunTimeoutMs)
    : 300_000;
  const aiRunPollIntervalMs = Number.isFinite(options.aiRunPollIntervalMs) && options.aiRunPollIntervalMs > 0
    ? Math.trunc(options.aiRunPollIntervalMs)
    : 5_000;

  function getAiRunCurrentPageEntry(currentConfig, currentPageUrl) {
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

  function isAiRunCurrentPageSnapshotMissing(currentConfig, currentPageUrl) {
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

  async function refineAiRunPayloadXpathsInBackground(payloadKey) {
    const sourcePayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
    if (!sourcePayloadKey) {
      return { ok: false, error: "Missing AI run payload" };
    }
    const loaded = await getTransferPayload(sourcePayloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    if (!payload || !Array.isArray(payload.pages)) {
      await removeTransferPayload(sourcePayloadKey);
      return { ok: false, error: "Unable to prepare AI payload" };
    }
    const refinedPayload = {
      ...payload,
      pages: payload.pages.map((page) => {
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

  async function loadAiRunSelectorSetFromPayloadKey(payloadKey) {
    const resultPayloadKey = typeof payloadKey === "string" ? payloadKey.trim() : "";
    if (!resultPayloadKey) {
      return null;
    }
    const loaded = await consumeTransferPayload(resultPayloadKey, {
      expectedType: "object",
      removeInvalid: true
    });
    const payload = loaded && loaded.ok ? loaded.payload : null;
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray(payload.exclusionSelectors) ||
      !Array.isArray(payload.inclusionSelectors)
    ) {
      return null;
    }
    return normalizeAiSelectorSet(payload);
  }

  async function setAiComputeLockForTab(tabId, active, expiresAt = 0, baseUrl = "") {
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

  function isAiComputeLockActiveForTab(tabId) {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return false;
    }
    const expiresAt = aiComputeLockExpiresAtByTabId.get(normalizedTabId);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      aiComputeLockExpiresAtByTabId.delete(normalizedTabId);
      return false;
    }
    return true;
  }

  async function refreshAiRunHeartbeat(options = {}) {
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

  async function prepareAiRunPayloadSnapshot(options = {}) {
    const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl.trim() : "";
    const currentPageUrl = typeof options.currentPageUrl === "string" ? options.currentPageUrl.trim() : "";
    const currentRenderMode = typeof options.currentRenderMode === "string" ? options.currentRenderMode.trim() : "";
    if (!baseUrl || !currentPageUrl) {
      return { ok: false };
    }
    try {
      const currentConfig = await configStore.ensureConfig(baseUrl);
      const pageMarkings =
        currentConfig && currentConfig.pageMarkings && typeof currentConfig.pageMarkings === "object"
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
        .filter(({ entry }) => typeof entry.rawHtml !== "string" || !entry.rawHtml);
      const backfillResults = await Promise.all(
        urlsMissingRawHtml.map(async ({ url }) => {
          const response = await fetchStaticPageHtmlForBackground(url);
          if (!response.ok || typeof response.html !== "string" || !response.html) {
            return null;
          }
          return { url, rawHtml: response.html };
        })
      );
      const successfulBackfills = backfillResults.filter(Boolean);
      if (successfulBackfills.length) {
        await configStore.updateConfig(baseUrl, (targetConfig) => {
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
      const pages = storedPageEntries.map(([url, entry]) => {
        const rawHtml =
          entry && typeof entry.rawHtml === "string" && entry.rawHtml
            ? entry.rawHtml
            : rawHtmlBackfills.get(url) || "";
        return {
          url,
          renderedHtml: typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
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

  async function runAiCommandForTab(tabId, payload, update) {
    const timeoutGroup = createManagedTimeoutGroup();
    const baseUrl = normalizeActivationBaseUrl(payload && payload.baseUrl);
    const currentPageUrl = typeof payload?.currentPageUrl === "string"
      ? payload.currentPageUrl.trim()
      : "";
    const pageType = typeof payload?.pageType === "string" ? payload.pageType : "";
    const currentRenderMode = typeof payload?.currentRenderMode === "string"
      ? payload.currentRenderMode.trim()
      : "";
    const credentials = await resolveBackgroundNetworkCredentials({
      endpointValue: payload && payload.endpointValue,
      tokenValue: payload && payload.tokenValue,
      endpointPreference: "ai"
    });
    const endpointValue = credentials.endpointValue;
    const tokenValue = credentials.tokenValue;
    const requestedSiteId = normalizeSiteIdValue(payload && payload.siteId);
    const requestedDeadlineAt = Number(payload && payload.deadlineAt);
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
