import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import { createPageDataLifecycleLoader } from "../src/background/page-data-lifecycle.js";

function createDeps(overrides = {}) {
  const calls: Array<{ type: string; payload?: unknown }> = [];
  const configs = {
    "https://example.com": {
      baseUrl: "https://example.com",
      siteId: 5,
      pageMarkings: {
        "https://example.com/page": {
          timestamp: "2026-06-10T10:00:00Z",
          pageType: "listing",
          xpaths: [{ xpath: "/html/body/main", excluded: true }]
        }
      },
      selectors: { exclusionSelectors: [".old-exclude"], inclusionSelectors: [".old-include"] },
      selectorsUpdatedAt: "2026-06-10T10:00:00Z",
      submittedSelectorsFingerprint: "fingerprint",
      renderMode: "rendered",
      renderModeUpdatedAt: "2026-06-10T10:00:00Z"
    }
  };
  const deps = {
    getConfigs: async () => configs,
    saveConfigs: async () => {},
    loadRemoteConfigSnapshot: async () => {
      calls.push({ type: "load" });
      return { ok: true, status: "ok", payloadKey: "payload-1" };
    },
    replaceServerConfigIntoLocalSnapshot: async (payload) => {
      calls.push({ type: "replace", payload });
      return {
        ok: true,
        changed: true,
        replacedCurrentPage: true,
        baseUrl: "https://example.com"
      };
    },
    clearLocalPageDataForMissingRemote: async (payload) => {
      calls.push({ type: "clear-missing", payload });
      return { changed: true, baseUrl: "https://example.com" };
    },
    clearPageSaveReconciliation: async (baseUrl, pageUrl) => {
      calls.push({ type: "clear-reconciliation", payload: { baseUrl, pageUrl } });
    },
    resolveLivePageSiteId: async () => ({ ok: false, siteId: null, baseUrl: "" }),
    getTab: async () => ({ id: 7, url: "https://example.com/page" }),
    getTabState: async () => ({ baseUrl: "https://example.com" }),
    sendContentMessageToTab: async (_tabId, message) => {
      calls.push({ type: "content", payload: message });
      return { ok: true };
    },
    ...overrides
  };
  return { deps, calls, configs };
}

test("background page-data lifecycle collapses concurrent loads for one navigation into a single /load", async () => {
  const { deps, calls } = createDeps();
  let releaseLoad: (() => void) | null = null;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let loadCount = 0;
  deps.loadRemoteConfigSnapshot = async () => {
    loadCount += 1;
    calls.push({ type: "load" });
    await loadGate;
    return { ok: true, status: "ok", payloadKey: `payload-${loadCount}` };
  };
  const loader = createPageDataLifecycleLoader(deps);

  const input = {
    tabId: 7,
    pageUrl: "https://example.com/page",
    baseUrl: "https://example.com",
    siteId: 5,
    navigationKey: "nav-key-1"
  };
  // Fire three concurrent loads for the same navigation while the first /load is
  // still in flight, then let all of them reach the in-flight dedupe.
  const pending = [
    loader.loadPageDataForNavigation(input),
    loader.loadPageDataForNavigation(input),
    loader.loadPageDataForNavigation(input)
  ];
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseLoad?.();
  const results = await Promise.all(pending);

  results.forEach((result) => assert.equal(result.status, "ok"));
  // Exactly one /load fetch happened despite three concurrent navigation loads.
  assert.equal(loadCount, 1);
  assert.equal(calls.filter((call) => call.type === "load").length, 1);
});

test("background page-data lifecycle loads once per committed navigation and reuses it for popup refresh", async () => {
  const { deps, calls } = createDeps();
  const loader = createPageDataLifecycleLoader(deps);

  const first = await loader.handleTopLevelNavigationCommitted({
    frameId: 0,
    tabId: 7,
    url: "https://example.com/page",
    documentId: "doc-1"
  });
  const second = await loader.loadPageDataForNavigation({
    tabId: 7,
    pageUrl: "https://example.com/page",
    baseUrl: "https://example.com",
    siteId: 5
  });

  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  assert.deepEqual(calls.map((call) => call.type), ["load", "replace", "content"]);
});

test("background page-data lifecycle re-validates a stale cached siteId against the backend", async () => {
  const { deps, calls, configs } = createDeps();
  let loadedSiteId: number | string | null | undefined = null;
  deps.resolveLivePageSiteId = async ({ pageUrl }: { pageUrl?: string }) => {
    calls.push({ type: "resolve", payload: { pageUrl } });
    return { ok: true, siteId: 60, baseUrl: "https://example.com" };
  };
  deps.loadRemoteConfigSnapshot = async ({ siteId }: { siteId?: number | string | null }) => {
    loadedSiteId = siteId;
    calls.push({ type: "load" });
    return { ok: true, status: "ok", payloadKey: "payload-1" };
  };
  const loader = createPageDataLifecycleLoader(deps);

  const result = await loader.handleTopLevelNavigationCommitted({
    frameId: 0,
    tabId: 7,
    url: "https://example.com/page",
    documentId: "doc-1"
  });

  // The cached siteId (5) is stale; the backend says 60. The resolver must
  // re-validate, load with the corrected siteId, and refresh the local cache.
  assert.equal(result.status, "ok");
  assert.equal(loadedSiteId, 60);
  assert.equal(configs["https://example.com"].siteId, 60);
  assert.deepEqual(calls.map((call) => call.type), ["resolve", "load", "replace", "content"]);
});

test("background page-data lifecycle keeps the cached siteId when backend re-validation is unavailable", async () => {
  const { deps, calls, configs } = createDeps();
  let loadedSiteId: number | string | null | undefined = null;
  deps.resolveLivePageSiteId = async () => ({ ok: false, siteId: null, baseUrl: "" });
  deps.loadRemoteConfigSnapshot = async ({ siteId }: { siteId?: number | string | null }) => {
    loadedSiteId = siteId;
    calls.push({ type: "load" });
    return { ok: true, status: "ok", payloadKey: "payload-1" };
  };
  const loader = createPageDataLifecycleLoader(deps);

  const result = await loader.handleTopLevelNavigationCommitted({
    frameId: 0,
    tabId: 7,
    url: "https://example.com/page",
    documentId: "doc-1"
  });

  // Backend resolution failed; the cached siteId (5) must remain in use so an
  // offline/transient backend error does not break navigation loads.
  assert.equal(result.status, "ok");
  assert.equal(loadedSiteId, 5);
  assert.equal(configs["https://example.com"].siteId, 5);
});

test("background page-data lifecycle applies backend 404 as wipe-plus-notify while preserving popup status", async () => {
  const { deps, calls } = createDeps();
  deps.loadRemoteConfigSnapshot = async () => {
    calls.push({ type: "load" });
    return { ok: true, status: "not_found", payloadKey: "" };
  };
  const loader = createPageDataLifecycleLoader(deps);

  const result = await loader.handleTopLevelNavigationCommitted({
    frameId: 0,
    tabId: 7,
    url: "https://example.com/page",
    timeStamp: 123
  });

  assert.deepEqual(result, {
    status: "not_found",
    baseUrl: "https://example.com",
    changed: true
  });
  assert.deepEqual(calls.map((call) => call.type), [
    "load",
    "clear-missing",
    "clear-reconciliation",
    "content",
    "content"
  ]);
  assert.deepEqual(calls.at(-1)?.payload, {
    type: "configUpdated",
    baseUrl: "https://example.com",
    forceReloadPageEntry: true
  });
});

test("background wires committed navigation through page-data lifecycle only for real top-level commits", () => {
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

  assert.match(backgroundSource, /createPageDataLifecycleLoader\(\{/);
  assert.match(
    backgroundSource,
    /browser\.webNavigation\.onCommitted\.addListener\(\(details(?:\s*:\s*[^)]+)?\) => \{[\s\S]*?pageDataLifecycle\.handleTopLevelNavigationCommitted\(details\)[\s\S]*?disableExtensionOnTopLevelNavigation\(details\)/
  );
  assert.match(backgroundSource, /if \(message\.type === "loadPageDataForNavigation"\) \{/);
});
