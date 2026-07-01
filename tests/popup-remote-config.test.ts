import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { PopupText } from "../src/common/text.js";
import { state } from "../src/popup/state.js";
import {
  loadRemoteConfigForCurrentPage,
  scheduleRemoteConfigRetry,
  syncBaseConfigToServer
} from "../src/popup/remote-config.js";

function resetRemoteConfigState() {
  state.remoteConfigLoadKey = "";
  state.remoteConfigLoadResult = null;
  state.remoteConfigLoadResultByKey.clear();
  state.remoteConfigLoadRequestCounter = 0;
  state.remoteConfigGlobalFenceRequestId = 0;
  state.remoteConfigLatestRequestIdByPageLoadKey.clear();
  state.remoteConfigTabFenceByTabId.clear();
  state.remoteConfigSiteFenceByKey.clear();
  state.remoteConfigConnectionRetryTimer = 0;
  state.remoteConfigRetryAttempt = 0;
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
      clearBackendSavedPageMarkings: async () => {},
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

test("popup remote config retry backs off exponentially, caps at 30s, and recovers to base at attempt 0", async () => {
  resetRemoteConfigState();
  const delays = [];
  const { deps } = createDeps({
    windowRef: {
      setTimeout: (_fn, ms) => {
        delays.push(ms);
        return 1;
      },
      alert: () => {}
    }
  });

  const scheduleOnce = () => {
    // Clear the dedupe timer so each schedule is admitted.
    state.remoteConfigConnectionRetryTimer = 0;
    scheduleRemoteConfigRetry(deps);
  };

  // base delay (deps.remoteConfigRetryDelayMs) is 100 in createDeps.
  state.remoteConfigRetryAttempt = 0;
  scheduleOnce(); // attempt 0 -> 100
  scheduleOnce(); // attempt 1 -> 200
  state.remoteConfigRetryAttempt = 12;
  scheduleOnce(); // attempt 12 -> capped at 30000
  // A clean (ok/not_found) load resets remoteConfigRetryAttempt to 0 via
  // setRemoteConfigConnectionIssue(false); the next retry must return to base.
  state.remoteConfigRetryAttempt = 0;
  scheduleOnce(); // attempt 0 -> 100 again

  assert.deepEqual(delays, [100, 200, 30000, 100]);
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
        if (message.type === "loadPageDataForNavigation") {
          return { status: "ok", baseUrl: "https://example.com", changed: false, replacedCurrentPage: false };
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
    assert.equal(runtimeCalls, 1);
    assert.equal(statusUpdates.at(-1).status, "ok");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config load ignores token rotation within the same page-load cache key", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  let runtimeCalls = 0;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        runtimeCalls += 1;
        if (message.type === "loadPageDataForNavigation") {
          return { status: "ok", baseUrl: "https://example.com", changed: false, replacedCurrentPage: false };
        }
        return { ok: false };
      }
    }
  };

  const { deps } = createDeps();

  try {
    const first = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      tokenValue: "token-1",
      pageUrl: "https://example.com/page",
      baseUrl: "https://example.com"
    });
    const second = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      tokenValue: "token-2",
      pageUrl: "https://example.com/page",
      baseUrl: "https://example.com"
    });

    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    assert.equal(runtimeCalls, 1);
    assert.equal(state.remoteConfigLoadResultByKey.size, 1);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config load clears local page markings when upstream is missing", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  const runtimeCalls = [];
  const configStore = {
    "https://example.com": {
      pageMarkings: {
        "https://example.com/page": {
          timestamp: "2026-06-10T10:00:00Z",
          pageType: "listing",
          xpaths: [{ xpath: "/html/body/main", excluded: true }]
        }
      },
      selectors: { exclusionSelectors: [".old-exclude"], inclusionSelectors: [".old-include"] },
      selectorsUpdatedAt: "2026-06-10T10:00:00Z",
      submittedSelectorsFingerprint: "{\"exclusionSelectors\":[\".old-exclude\"],\"inclusionSelectors\":[\".old-include\"]}",
      renderMode: "static",
      renderModeUpdatedAt: "2026-06-10T10:00:00Z",
      siteId: 5
    }
  };
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        runtimeCalls.push(message);
        if (message.type === "loadPageDataForNavigation") {
          return { status: "not_found", baseUrl: "https://example.com", changed: true };
        }
        return { ok: false };
      }
    }
  };

  const { deps, statusUpdates } = createDeps({
    getConfigs: async () => configStore,
    getBackendSavedPageMarkings: async () => ({
      "https://example.com/page": {
        timestamp: "2026-06-10T10:00:00Z",
        pageType: "listing",
        xpaths: [{ xpath: "/html/body/main", excluded: true }]
      }
    })
  });
  state.currentTab = { id: 1, url: "https://example.com/page" };

  try {
    const result = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page",
      baseUrl: "https://example.com"
    });

    assert.equal(result.status, "not_found");
    assert.equal(result.baseUrl, "https://example.com");
    assert.equal(result.changed, true);
    assert.deepEqual(await deps.getConfigs(), configStore);
    assert.equal(statusUpdates.at(-1).status, "not_found");
    assert.deepEqual(runtimeCalls.map((message) => message.type), ["loadPageDataForNavigation"]);
    assert.equal(runtimeCalls[0].tabId, 1);
    assert.equal(runtimeCalls[0].pageUrl, "https://example.com/page");
  } finally {
    state.currentTab = null;
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config load clears selector state on not_found even without page markings", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  const configStore = {
    "https://example.com": {
      pageMarkings: {},
      selectors: { exclusionSelectors: [".old-exclude"], inclusionSelectors: [".old-include"] },
      selectorsUpdatedAt: "2026-06-10T10:00:00Z",
      submittedSelectorsFingerprint: "{\"exclusionSelectors\":[\".old-exclude\"],\"inclusionSelectors\":[\".old-include\"]}",
      renderMode: "rendered",
      renderModeUpdatedAt: "2026-06-10T10:00:00Z",
      siteId: 5
    }
  };
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "loadPageDataForNavigation") {
          return { status: "not_found", baseUrl: "https://example.com", changed: true };
        }
        return { ok: false };
      }
    }
  };

  const { deps } = createDeps({
    getConfigs: async () => configStore,
    getBackendSavedPageMarkings: async () => ({})
  });
  state.currentTab = { id: 1, url: "https://example.com/page" };

  try {
    const result = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page",
      baseUrl: "https://example.com"
    });

    assert.equal(result.status, "not_found");
    assert.equal(result.changed, true);
    assert.deepEqual(await deps.getConfigs(), configStore);
  } finally {
    state.currentTab = null;
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config load clears cached site entries on not_found", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  let runtimeCalls = 0;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        runtimeCalls += 1;
        if (message.type === "loadPageDataForNavigation") {
          return { status: "not_found", baseUrl: "https://example.com", changed: true };
        }
        return { ok: false };
      }
    }
  };

  const { deps } = createDeps({
    getBackendSavedPageMarkings: async () => ({})
  });
  state.currentTab = { id: 1, url: "https://example.com/page-a" };
  state.remoteConfigLoadResultByKey.set("2|https://example.com/page-b|5|https://api.example.com", {
    status: "ok",
    baseUrl: "https://example.com"
  });

  try {
    const result = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page-a",
      baseUrl: "https://example.com"
    });

    assert.equal(result.status, "not_found");
    assert.equal(state.remoteConfigLoadResultByKey.size, 1);
    assert.equal(
      state.remoteConfigLoadResultByKey.get("2|https://example.com/page-b|5|https://api.example.com"),
      undefined
    );
    assert.equal(runtimeCalls, 1);
  } finally {
    state.currentTab = null;
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config load does not repopulate cache after cache epoch advances", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  let releaseLoad;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "loadPageDataForNavigation") {
          await new Promise((resolve) => {
            releaseLoad = resolve;
          });
          return { status: "ok", baseUrl: "https://example.com", changed: false, replacedCurrentPage: false };
        }
        return { ok: false };
      }
    }
  };

  const { deps } = createDeps();
  state.currentTab = { id: 1, url: "https://example.com/page-a" };

  try {
    const pendingLoad = loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page-a",
      baseUrl: "https://example.com"
    });
    state.remoteConfigLoadRequestCounter += 1;
    state.remoteConfigGlobalFenceRequestId = state.remoteConfigLoadRequestCounter;
    state.remoteConfigLoadResultByKey.clear();
    releaseLoad();
    const result = await pendingLoad;

    assert.equal(result.status, "skipped");
    assert.equal(state.remoteConfigLoadResultByKey.size, 0);
  } finally {
    state.currentTab = null;
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config load skips stale not_found resets after cache epoch advances", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  let releaseLoad;
  const configStore = {
    "https://example.com": {
      pageMarkings: {
        "https://example.com/page-a": {
          timestamp: "2026-06-10T10:00:00Z",
          pageType: "listing",
          xpaths: [{ xpath: "/html/body/main", excluded: true }]
        }
      },
      selectors: { exclusionSelectors: [".old-exclude"], inclusionSelectors: [".old-include"] },
      selectorsUpdatedAt: "2026-06-10T10:00:00Z",
      submittedSelectorsFingerprint: "{\"exclusionSelectors\":[\".old-exclude\"],\"inclusionSelectors\":[\".old-include\"]}",
      renderMode: "rendered",
      renderModeUpdatedAt: "2026-06-10T10:00:00Z",
      siteId: 5
    }
  };
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "loadPageDataForNavigation") {
          await new Promise((resolve) => {
            releaseLoad = resolve;
          });
          return { status: "not_found", baseUrl: "https://example.com", changed: true };
        }
        return { ok: false };
      }
    }
  };

  const { deps } = createDeps({
    getConfigs: async () => configStore,
    getBackendSavedPageMarkings: async () => ({})
  });
  state.currentTab = { id: 1, url: "https://example.com/page-a" };

  try {
    const pendingLoad = loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page-a",
      baseUrl: "https://example.com"
    });
    state.remoteConfigLoadRequestCounter += 1;
    state.remoteConfigGlobalFenceRequestId = state.remoteConfigLoadRequestCounter;
    releaseLoad();
    const result = await pendingLoad;

    assert.equal(result.status, "skipped");
    assert.deepEqual(configStore["https://example.com"].pageMarkings, {
      "https://example.com/page-a": {
        timestamp: "2026-06-10T10:00:00Z",
        pageType: "listing",
        xpaths: [{ xpath: "/html/body/main", excluded: true }]
      }
    });
    assert.deepEqual(configStore["https://example.com"].selectors, {
      exclusionSelectors: [".old-exclude"],
      inclusionSelectors: [".old-include"]
    });
  } finally {
    state.currentTab = null;
    globalThis.chrome = originalChrome;
  }
});

test("popup remote config not_found fences off older same-site ok loads", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  let releaseFirstLoad;
  let loadCallCount = 0;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "loadPageDataForNavigation") {
          loadCallCount += 1;
          if (loadCallCount === 1) {
            await new Promise((resolve) => {
              releaseFirstLoad = resolve;
            });
            return { status: "ok", baseUrl: "https://example.com", changed: false };
          }
          return { status: "not_found", baseUrl: "https://example.com", changed: true };
        }
        return { ok: false };
      }
    }
  };

  const { deps } = createDeps({
    getBackendSavedPageMarkings: async () => ({})
  });

  try {
    state.currentTab = { id: 1, url: "https://example.com/page-a" };
    const pendingFirstLoad = loadRemoteConfigForCurrentPage(deps, {
      tabId: 1,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page-a",
      baseUrl: "https://example.com"
    });

    state.currentTab = { id: 2, url: "https://example.com/page-b" };
    const secondResult = await loadRemoteConfigForCurrentPage(deps, {
      tabId: 2,
      siteId: 5,
      endpointValue: "https://api.example.com",
      pageUrl: "https://example.com/page-b",
      baseUrl: "https://example.com"
    });

    releaseFirstLoad();
    const firstResult = await pendingFirstLoad;

    assert.equal(secondResult.status, "not_found");
    assert.equal(firstResult.status, "skipped");
    assert.equal(loadCallCount, 2);
    assert.deepEqual(Array.from(state.remoteConfigLoadResultByKey.keys()), [
      "2|https://example.com/page-b|5|https://api.example.com"
    ]);
  } finally {
    state.currentTab = null;
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

test("popup remote config save replaces local from server response when flagged", async () => {
  resetRemoteConfigState();
  const originalChrome = globalThis.chrome;
  const sentMessageTypes = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        sentMessageTypes.push(message.type);
        if (message.type === "saveRemoteConfigSnapshot") {
          return { ok: true, status: "ok", payloadKey: "response-key" };
        }
        if (message.type === "replaceServerConfigIntoLocalSnapshot") {
          return {
            ok: true,
            changed: false,
            baseUrl: "https://example.com",
            replacedCurrentPage: false
          };
        }
        return { ok: false };
      }
    }
  };

  const { deps, prunedInvalidUrls } = createDeps({
    ensurePropertyPageTypes: async () => ({ ok: true, pageTypes: [] })
  });
  state.currentTab = { id: 1, url: "https://example.com/page" };

  try {
    const result = await syncBaseConfigToServer(deps, {
      baseUrl: "https://example.com",
      pageUrl: "https://example.com/page",
      endpointValue: "https://api.example.com",
      stageBase: "stage.example.com",
      tokenValue: "token",
      includeAllLocalPageMarkings: true,
      replaceLocalFromServerResponse: true
    });

    assert.equal(result.ok, true);
    assert.deepEqual(sentMessageTypes, [
      "saveRemoteConfigSnapshot",
      "replaceServerConfigIntoLocalSnapshot"
    ]);
    assert.equal(prunedInvalidUrls.length, 1);
    assert.deepEqual(prunedInvalidUrls[0].invalidUrls, []);
  } finally {
    state.currentTab = null;
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
