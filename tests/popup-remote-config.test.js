import test from "node:test";
import assert from "node:assert/strict";

import { PopupText } from "../common/text.js";
import { state } from "../popup/state.js";
import {
  loadRemoteConfigForCurrentPage,
  scheduleRemoteConfigRetry,
  syncBaseConfigToServer
} from "../popup/remote-config.js";

function resetRemoteConfigState() {
  state.remoteConfigLoadKey = "";
  state.remoteConfigLoadResult = null;
  state.remoteConfigConnectionRetryTimer = 0;
}

function createDeps(overrides = {}) {
  const statusUpdates = [];
  const toasts = [];
  const waits = [];
  const savedPayloads = [];
  const prunedInvalidUrls = [];
  const configStore = {
    "https://example.com": {
      pageMarkings: {},
      selectors: { exclusionSelectors: [], inclusionSelectors: [] },
      selectorsUpdatedAt: "2026-06-10T10:00:00Z",
      submittedSelectorsFingerprint: "",
      renderMode: "static",
      renderModeUpdatedAt: "2026-06-10T10:00:00Z",
      siteId: 5
    }
  };
  const windowRef = {
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    alert: () => {}
  };

  return {
    deps: {
      PopupText,
      windowRef,
      remoteConfigRetryDelayMs: 100,
      ensureActiveTab: async () => {},
      refreshUi: async () => {},
      resolveRelativeEndpoint: () => "https://api.example.com/endpoint",
      updateLastConfigLoadStatus: (result) => {
        statusUpdates.push(result);
      },
      invalidateTokenAndLockConfiguration: async () => {},
      showToast: (message) => {
        toasts.push(message);
      },
      ensureBaseUrlSiteId: async () => ({
        ok: true,
        siteId: 5,
        baseUrl: "https://example.com",
        configs: configStore
      }),
      getConfigs: async () => configStore,
      saveConfigs: async () => {},
      normalizeConfig: (_baseUrl, value) => ({
        config: value && typeof value === "object" ? value : {
          pageMarkings: {},
          selectors: { exclusionSelectors: [], inclusionSelectors: [] },
          selectorsUpdatedAt: "2026-06-10T10:00:00Z",
          submittedSelectorsFingerprint: "",
          renderMode: "static",
          renderModeUpdatedAt: "2026-06-10T10:00:00Z",
          siteId: 5
        },
        changed: false
      }),
      getBackendSavedPageMarkings: async () => ({}),
      createConfigSyncPayload: (_baseUrl, sourceConfig) => ({
        pageMarkings: sourceConfig && sourceConfig.pageMarkings ? sourceConfig.pageMarkings : {}
      }),
      getStoredGlobalToken: async () => "",
      ensurePropertyPageTypes: async () => ({ ok: false }),
      collectStoredPageMarkingItems: () => [],
      buildLynxChecklistViewModel: () => ({ activeMarkedPages: [] }),
      buildPageMarkingKey: () => "",
      buildTransferPayloadKey: () => "payload-key",
      putTransferPayload: async (_type, payload) => {
        savedPayloads.push(payload);
        return { ok: true };
      },
      waitForRetryDelay: async (ms) => {
        waits.push(ms);
      },
      isRetryableHttpStatus: () => false,
      pruneRemoteInvalidPageMarkings: async (payload) => {
        prunedInvalidUrls.push(payload);
      },
      ...overrides
    },
    statusUpdates,
    toasts,
    waits,
    savedPayloads,
    prunedInvalidUrls
  };
}

test("popup remote config retry schedules refresh only once", async () => {
  resetRemoteConfigState();
  let refreshCount = 0;
  const queuedTimeouts = [];
  const { deps } = createDeps({
    windowRef: {
      setTimeout: (fn) => {
        queuedTimeouts.push(fn);
        return 1;
      },
      alert: () => {}
    },
    refreshUi: async () => {
      refreshCount += 1;
    }
  });

  scheduleRemoteConfigRetry(deps);
  scheduleRemoteConfigRetry(deps);
  assert.equal(queuedTimeouts.length, 1);
  await queuedTimeouts[0]();

  assert.equal(refreshCount, 1);
  assert.equal(state.remoteConfigConnectionRetryTimer, 0);
});

test("popup remote config load short-circuits when args are missing", async () => {
  resetRemoteConfigState();
  const { deps, statusUpdates } = createDeps();

  const result = await loadRemoteConfigForCurrentPage(deps, {
    tabId: null,
    siteId: null,
    endpointValue: ""
  });

  assert.equal(result.status, "skipped");
  assert.equal(statusUpdates.at(-1).status, "skipped");
});

test("popup remote config load caches successful load by key", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  let runtimeCalls = 0;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        runtimeCalls += 1;
        if (message.type === "loadRemoteConfigSnapshot") {
          return { ok: true, status: "ok", payloadKey: "payload-1" };
        }
        if (message.type === "replaceServerConfigIntoLocalSnapshot") {
          return { ok: true, changed: false, baseUrl: "https://example.com", replacedCurrentPage: false };
        }
        return { ok: false };
      }
    }
  };

  const { deps, statusUpdates } = createDeps();

  try {
    const first = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page",
      baseUrl: "https://example.com"
    });
    const second = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page",
      baseUrl: "https://example.com"
    });

    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    assert.equal(runtimeCalls, 2);
    assert.equal(statusUpdates.at(-1).status, "ok");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config save returns skipped when endpoint/base/page are missing", async () => {
  resetRemoteConfigState();
  const { deps } = createDeps();

  const result = await syncBaseConfigToServer(deps, {
    baseUrl: "",
    pageUrl: "",
    endpointValue: ""
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
});

test("popup remote config save merges server payload and prunes invalid urls", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "saveRemoteConfigSnapshot") {
          return { ok: true, status: "ok", payloadKey: "response-key" };
        }
        if (message.type === "mergeServerConfigIntoLocalSnapshot") {
          return {
            ok: true,
            changed: true,
            baseUrl: "https://example.com",
            replacedCurrentPage: false,
            invalidLoadedUrls: ["https://example.com/stale"]
          };
        }
        return { ok: false };
      }
    }
  };

  const { deps, savedPayloads, prunedInvalidUrls } = createDeps({
    ensurePropertyPageTypes: async () => ({ ok: true, pageTypes: [] })
  });

  try {
    const result = await syncBaseConfigToServer(deps, {
      baseUrl: "https://example.com",
      pageUrl: "https://example.com/page",
      endpointValue: "https://api.example.com",
      stageBase: "stage.example.com",
      tokenValue: "token"
    });

    assert.equal(result.ok, true);
    assert.equal(savedPayloads.length, 1);
    assert.equal(prunedInvalidUrls.length, 1);
    assert.deepEqual(prunedInvalidUrls[0].invalidUrls, ["https://example.com/stale"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config save retries retryable errors before succeeding", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  let saveCalls = 0;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "saveRemoteConfigSnapshot") {
          saveCalls += 1;
          if (saveCalls === 1) {
            return { ok: true, status: "error", httpStatus: 503 };
          }
          return { ok: true, status: "ok", payloadKey: "response-key" };
        }
        if (message.type === "mergeServerConfigIntoLocalSnapshot") {
          return { ok: true, changed: false, baseUrl: "https://example.com", replacedCurrentPage: false };
        }
        return { ok: false };
      }
    }
  };

  const { deps, waits } = createDeps({
    isRetryableHttpStatus: (status) => status === 503
  });

  try {
    const result = await syncBaseConfigToServer(deps, {
      baseUrl: "https://example.com",
      pageUrl: "https://example.com/page",
      endpointValue: "https://api.example.com",
      stageBase: "stage.example.com",
      tokenValue: "token",
      maxAttempts: 2
    });

    assert.equal(result.ok, true);
    assert.equal(saveCalls, 2);
    assert.equal(waits.length, 1);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
