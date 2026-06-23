import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiRunOrchestrator } from "../background/ai-run-orchestrator.js";

test("ai-run orchestrator computes selectors through lock, prepare, start, poll, and result", async () => {
  const aiComputeLockExpiresAtByTabId = new Map();
  const sentMessages = [];
  const progressUpdates = [];
  const events = [];
  const orchestrator = createAiRunOrchestrator({
    aiComputeLockExpiresAtByTabId,
    normalizeTabId: (value) => Number(value),
    normalizeActivationBaseUrl: (value) => value,
    normalizeSiteIdValue: (value) => Number(value) || null,
    normalizeAiSelectorSet: (payload) => payload,
    buildAiSubmissionXpaths: (entry) => entry.submissionXpaths || [],
    isPageWithinBaseUrl: () => true,
    resolveBackgroundNetworkCredentials: async () => ({ endpointValue: "https://api.test", tokenValue: "token" }),
    requestAiRunStartSnapshot: async (options) => {
      await options.onBeforeRequest?.({
        url: "https://api.test/get_selectors",
        payloadKey: options.payloadKey
      });
      events.push("start-request");
      return { ok: true, sessionId: "session-1" };
    },
    requestAiRunStatus: async () => ({ ok: true, status: "done" }),
    requestAiRunResultSnapshot: async () => ({ ok: true, payloadKey: "result-key" }),
    fetchStaticPageHtmlForBackground: async () => ({ ok: true, html: "<html/>" }),
    getTransferPayload: async () => ({ ok: true, payload: { pages: [] } }),
    putTransferPayload: async (label, payload) => {
      if (label === "ai-run-start-refined") {
        return { ok: true, payloadKey: "refined-key" };
      }
      if (label === "ai-run-prepare") {
        return { ok: true, payloadKey: "prepared-key", payload };
      }
      return { ok: true, payloadKey: `${label}-key` };
    },
    removeTransferPayload: async () => {},
    consumeTransferPayload: async () => ({
      ok: true,
      payload: {
        exclusionSelectors: [".exclude"],
        inclusionSelectors: [".include"]
      }
    }),
    clearPersistedAiRunRecord: async () => {},
    savePersistedAiRunRecord: async (record) => record,
    sendContentMessageToTab: async (_tabId, message) => {
      sentMessages.push(message.type);
      if (message.type === "capturePageSnapshot") {
        return { ok: true };
      }
      if (message.type === "setAiComputeLock") {
        return { ok: true };
      }
      return { ok: true };
    },
    ensureContentMainForTab: async () => ({ ok: true }),
    getTabState: async () => ({ enabled: true }),
    setTabState: async () => {},
    updateActionForTab: async () => {},
    refineXPathEntries: (_renderedHtml, _rawHtml, renderedXpaths) => renderedXpaths,
    waitForBackgroundRetryDelay: async () => {},
    getAiRunResumeExpiresAt: () => Date.now() + 20_000,
    configStore: {
      ensureConfig: async () => ({
        siteId: 7,
        pageMarkings: {
          "https://example.test/page": {
            renderedHtml: "<html/>",
            rawHtml: "<html/>",
            submissionXpaths: ["//body"],
            renderedXpaths: ["//body"]
          }
        }
      }),
      updateConfig: async () => {}
    },
    defaultExcludedImmutableSelectors: ["#fixed"],
    aiRunTimeoutMs: 60_000,
    aiRunPollIntervalMs: 1
  });

  const result = await orchestrator.runAiCommandForTab(
    5,
    {
      baseUrl: "https://example.test",
      currentPageUrl: "https://example.test/page",
      pageType: "detail",
      currentRenderMode: "static",
      siteId: 7,
      deadlineAt: Date.now() + 5000
    },
    async (update) => {
      if (update.reason) {
        events.push(update.reason);
      }
      progressUpdates.push(update);
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "session-1");
  assert.equal(aiComputeLockExpiresAtByTabId.has(5), false);
  assert.equal(sentMessages.includes("setAiComputeLock"), true);
  assert.equal(
    progressUpdates.some((update) => update.reason === "tab-run-ai-running"),
    true
  );
  assert.ok(
    events.indexOf("tab-run-ai-running") > -1 &&
      events.indexOf("tab-run-ai-running") < events.indexOf("start-request"),
    "running spinner phase should start before the /get_selectors request"
  );
});

test("ai-run orchestrator treats static XPath refinement as best-effort", async () => {
  let refineStarted = false;
  let startRequested = false;
  const payloads = new Map();
  const orchestrator = createAiRunOrchestrator({
    aiComputeLockExpiresAtByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    normalizeActivationBaseUrl: (value) => value,
    normalizeSiteIdValue: (value) => Number(value) || null,
    normalizeAiSelectorSet: (payload) => payload,
    buildAiSubmissionXpaths: (entry) => entry.submissionXpaths || [],
    isPageWithinBaseUrl: () => true,
    resolveBackgroundNetworkCredentials: async () => ({ endpointValue: "https://api.test", tokenValue: "token" }),
    requestAiRunStartSnapshot: async () => {
      startRequested = true;
      return { ok: true, sessionId: "session-1" };
    },
    requestAiRunStatus: async () => ({ ok: true, status: "done" }),
    requestAiRunResultSnapshot: async () => ({ ok: true, payloadKey: "result-key" }),
    fetchStaticPageHtmlForBackground: async () => ({ ok: true, html: "<html/>" }),
    getTransferPayload: async (key) => ({ ok: true, payload: payloads.get(key) || { pages: [] } }),
    putTransferPayload: async (label, payload) => {
      if (label === "ai-run-prepare") {
        payloads.set("prepared-key", payload);
        return { ok: true, payloadKey: "prepared-key", payload };
      }
      payloads.set(`${label}-key`, payload);
      return { ok: true, payloadKey: `${label}-key` };
    },
    removeTransferPayload: async () => {},
    consumeTransferPayload: async () => ({
      ok: true,
      payload: {
        exclusionSelectors: [".exclude"],
        inclusionSelectors: [".include"]
      }
    }),
    clearPersistedAiRunRecord: async () => {},
    savePersistedAiRunRecord: async (record) => record,
    sendContentMessageToTab: async () => ({ ok: true }),
    ensureContentMainForTab: async () => ({ ok: true }),
    getTabState: async () => ({ enabled: true }),
    setTabState: async () => {},
    updateActionForTab: async () => {},
    refineXPathEntries: () => {
      refineStarted = true;
      return new Promise(() => {});
    },
    getAiRunResumeExpiresAt: () => Date.now() + 20_000,
    configStore: {
      ensureConfig: async () => ({
        siteId: 7,
        pageMarkings: {
          "https://example.test/page": {
            renderedHtml: "<html/>",
            rawHtml: "<html/>",
            submissionXpaths: ["//body"],
            renderedXpaths: ["//body"]
          }
        }
      }),
      updateConfig: async () => {}
    },
    defaultExcludedImmutableSelectors: ["#fixed"],
    aiRunTimeoutMs: 60_000,
    aiRunPollIntervalMs: 1,
    refineXPathEntriesTimeoutMs: 1
  });

  const result = await orchestrator.runAiCommandForTab(
    5,
    {
      baseUrl: "https://example.test",
      currentPageUrl: "https://example.test/page",
      pageType: "detail",
      currentRenderMode: "static",
      siteId: 7,
      deadlineAt: Date.now() + 5000
    },
    async () => {}
  );

  assert.equal(refineStarted, true);
  assert.equal(startRequested, true);
  assert.equal(result.ok, true);
});

test("ai-run orchestrator keeps polling when the in-loop heartbeat lock fails", async () => {
  const events = [];
  let activeLockCalls = 0;
  let statusCalls = 0;
  const orchestrator = createAiRunOrchestrator({
    aiComputeLockExpiresAtByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    normalizeActivationBaseUrl: (value) => value,
    normalizeSiteIdValue: (value) => Number(value) || null,
    normalizeAiSelectorSet: (payload) => payload,
    buildAiSubmissionXpaths: (entry) => entry.submissionXpaths || [],
    isPageWithinBaseUrl: () => true,
    resolveBackgroundNetworkCredentials: async () => ({ endpointValue: "https://api.test", tokenValue: "token" }),
    requestAiRunStartSnapshot: async () => ({ ok: true, sessionId: "session-1" }),
    requestAiRunStatus: async () => {
      statusCalls += 1;
      events.push("status");
      return statusCalls < 2 ? { ok: true, status: "running" } : { ok: true, status: "done" };
    },
    requestAiRunResultSnapshot: async () => ({ ok: true, payloadKey: "result-key" }),
    fetchStaticPageHtmlForBackground: async () => ({ ok: true, html: "<html/>" }),
    getTransferPayload: async () => ({ ok: true, payload: { pages: [] } }),
    putTransferPayload: async (label, payload) => {
      if (label === "ai-run-prepare") {
        return { ok: true, payloadKey: "prepared-key", payload };
      }
      return { ok: true, payloadKey: `${label}-key` };
    },
    removeTransferPayload: async () => {},
    consumeTransferPayload: async () => ({
      ok: true,
      payload: {
        exclusionSelectors: [".exclude"],
        inclusionSelectors: [".include"]
      }
    }),
    clearPersistedAiRunRecord: async () => {},
    savePersistedAiRunRecord: async (record) => record,
    sendContentMessageToTab: async (_tabId, message) => {
      if (message.type === "setAiComputeLock" && message.active) {
        activeLockCalls += 1;
        events.push("lock");
        return activeLockCalls <= 1 ? { ok: true } : { ok: false, error: "lock failed" };
      }
      return { ok: true };
    },
    ensureContentMainForTab: async () => ({ ok: true }),
    getTabState: async () => ({ enabled: true }),
    setTabState: async () => {},
    updateActionForTab: async () => {},
    refineXPathEntries: (_renderedHtml, _rawHtml, renderedXpaths) => renderedXpaths,
    waitForBackgroundRetryDelay: async () => {},
    getAiRunResumeExpiresAt: () => Date.now() + 20_000,
    configStore: {
      ensureConfig: async () => ({
        siteId: 7,
        pageMarkings: {
          "https://example.test/page": {
            renderedHtml: "<html/>",
            rawHtml: "<html/>",
            submissionXpaths: ["//body"],
            renderedXpaths: ["//body"]
          }
        }
      }),
      updateConfig: async () => {}
    },
    defaultExcludedImmutableSelectors: ["#fixed"],
    aiRunTimeoutMs: 60_000,
    aiRunPollIntervalMs: 1
  });

  const result = await orchestrator.runAiCommandForTab(
    5,
    {
      baseUrl: "https://example.test",
      currentPageUrl: "https://example.test/page",
      pageType: "detail",
      currentRenderMode: "static",
      siteId: 7,
      deadlineAt: Date.now() + 5000
    },
    async () => {}
  );

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, "session-1");
  assert.ok(activeLockCalls >= 2, "heartbeat should attempt to refresh the page lock");
  assert.ok(statusCalls >= 2, "status polling should continue after a heartbeat lock failure");
});

test("ai-run orchestrator reports heartbeat lock failures", async () => {
  const orchestrator = createAiRunOrchestrator({
    aiComputeLockExpiresAtByTabId: new Map(),
    normalizeTabId: (value) => Number(value),
    normalizeSiteIdValue: (value) => Number(value) || null,
    savePersistedAiRunRecord: async (record) => record,
    clearPersistedAiRunRecord: async () => {},
    getAiRunResumeExpiresAt: () => Date.now() + 20_000,
    sendContentMessageToTab: async () => ({ ok: false, error: "lock failed" }),
    ensureContentMainForTab: async () => ({ ok: true }),
    getTabState: async () => ({}),
    setTabState: async () => {},
    updateActionForTab: async () => {}
  });

  const result = await orchestrator.refreshAiRunHeartbeat({
    tabId: 1,
    sessionId: "session",
    siteId: 2,
    deadlineAt: Date.now() + 10000,
    baseUrl: "https://example.test"
  });

  assert.equal(result.ok, false);
  assert.equal(result.lockApplied, false);
});
