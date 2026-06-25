import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createConfigUpdatedHandler } from "../src/content/config-updated-handler.js";

function createDeps(overrides = {}) {
  const calls = [];
  const deps = {
    calls,
    clearAiPreviewState: () => calls.push(["clearAiPreviewState"]),
    clearPageDraftBaseline: (pageUrl) => calls.push(["clearPageDraftBaseline", pageUrl]),
    disable: () => calls.push(["disable"]),
    findPageMarkingEntry: () => null,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    getBackendSavedPageMarkings: async () => [],
    getBaseUrl: () => "https://example.com/base",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    clearPageSaveReconciliation: async (baseUrl, pageUrl) =>
      calls.push(["clearPageSaveReconciliation", baseUrl, pageUrl]),
    getCurrentPageType: () => "listing",
    getDraftPageEntry: (pageUrl) => {
      calls.push(["getDraftPageEntry", pageUrl]);
      return { xpaths: [{ xpath: "/draft" }] };
    },
    getPageUrl: () => "https://example.com/base/page",
    getSavedPageEntry: (pageUrl) => {
      calls.push(["getSavedPageEntry", pageUrl]);
      return { xpaths: [{ xpath: "/saved" }] };
    },
    isAiPreviewActive: () => false,
    isEnabled: () => false,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async (baseUrl) => {
      calls.push(["loadConfig", baseUrl]);
      return { pageMarkings: {} };
    },
    mergeDraftEntry: (...args) => calls.push(["mergeDraftEntry", ...args]),
    notifyDraftStatus: (pageUrl) => calls.push(["notifyDraftStatus", pageUrl]),
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    refreshPageSaveReconciliation: async (baseUrl, pageUrl) =>
      calls.push(["refreshPageSaveReconciliation", baseUrl, pageUrl]),
    refreshEnabledAiHighlights: () => calls.push(["refreshEnabledAiHighlights"]),
    refreshSilentHighlightings: () => {
      calls.push(["refreshSilentHighlightings"]);
      return Promise.resolve();
    },
    runPropertyLockSync: (options) => calls.push(["runPropertyLockSync", options]),
    sameBaseUrl: (left, right) => left === right,
    scheduleRender: () => calls.push(["scheduleRender"]),
    setConfig: (config) => calls.push(["setConfig", config]),
    setCurrentPageType: (pageType) => calls.push(["setCurrentPageType", pageType]),
    setSavedPageEntry: (pageUrl, entry) => calls.push(["setSavedPageEntry", pageUrl, entry]),
    ...overrides
  };
  return deps;
}

test("configUpdated returns synchronously during AI preview when no base URL is provided", () => {
  const deps = createDeps({ isAiPreviewActive: () => true });
  const handler = createConfigUpdatedHandler(deps);

  const response = handler.handleMessage({});

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(deps.calls, []);
});

test("configUpdated reloads config during AI preview without clearing preview state", async () => {
  const loadedConfig = { pageMarkings: { page: {} } };
  const deps = createDeps({
    isAiPreviewActive: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async (baseUrl) => {
      deps.calls.push(["loadConfig", baseUrl]);
      return loadedConfig;
    }
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = await handler.handleMessage({ baseUrl: "https://example.com/base" });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(deps.calls, [
    ["loadConfig", "https://example.com/base"],
    ["setConfig", loadedConfig]
  ]);
});

test("configUpdated AI preview reload failure answers ok false", async () => {
  const deps = createDeps({
    isAiPreviewActive: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async () => {
      throw new Error("load failed");
    }
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = await handler.handleMessage({ baseUrl: "https://example.com/base" });

  assert.deepEqual(response, { ok: false });
});

test("configUpdated same-base update merges the draft before responding", async () => {
  const loadedConfig = { pageMarkings: {} };
  const backendEntry = { pageType: "detail", xpaths: [{ xpath: "/backend" }] };
  const deps = createDeps({
    isEnabled: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async (baseUrl) => {
      deps.calls.push(["loadConfig", baseUrl]);
      return loadedConfig;
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    getBackendSavedPageMarkings: async (baseUrl) => {
      deps.calls.push(["getBackendSavedPageMarkings", baseUrl]);
      return { "https://example.com/base/page": backendEntry };
    },
    findPageMarkingEntry: (config, pageUrl, baseUrl) => {
      deps.calls.push(["findPageMarkingEntry", config, pageUrl, baseUrl]);
      return config === loadedConfig ? null : backendEntry;
    }
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = await handler.handleMessage({ baseUrl: "https://example.com/base" });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(deps.calls.map((call) => call[0]), [
    "getDraftPageEntry",
    "getSavedPageEntry",
    "loadConfig",
    "getBackendSavedPageMarkings",
    "findPageMarkingEntry",
    "findPageMarkingEntry",
    "mergeDraftEntry",
    "setSavedPageEntry",
    "setConfig",
    "refreshEnabledAiHighlights",
    "runPropertyLockSync"
  ]);
  assert.deepEqual(deps.calls.at(-1), ["runPropertyLockSync", { forceSiteIdRefresh: true }]);
});

test("configUpdated forced reload reseeds the saved entry and draft status", async () => {
  const loadedConfig = { pageMarkings: {} };
  const loadedEntry = { pageType: "loaded-detail", xpaths: [{ xpath: "/loaded" }] };
  const deps = createDeps({
    isEnabled: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async () => loadedConfig,
    findPageMarkingEntry: (config) => (config === loadedConfig ? loadedEntry : null)
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = await handler.handleMessage({
    baseUrl: "https://example.com/base",
    forceReloadPageEntry: true
  });

  assert.deepEqual(response, { ok: true });
  assert.ok(!deps.calls.some((call) => call[0] === "mergeDraftEntry"));
  assert.deepEqual(
    deps.calls.filter((call) => [
      "refreshPageSaveReconciliation",
      "setSavedPageEntry",
      "setCurrentPageType",
      "setConfig",
      "refreshEnabledAiHighlights",
      "scheduleRender",
      "notifyDraftStatus",
      "runPropertyLockSync"
    ].includes(call[0])),
    [
      ["refreshPageSaveReconciliation", "https://example.com/base", "https://example.com/base/page"],
      ["setSavedPageEntry", "https://example.com/base/page", loadedEntry],
      ["setCurrentPageType", "loaded-detail"],
      ["setConfig", loadedConfig],
      ["refreshEnabledAiHighlights"],
      ["scheduleRender"],
      ["notifyDraftStatus", "https://example.com/base/page"],
      ["runPropertyLockSync", { forceSiteIdRefresh: true }]
    ]
  );
});

test("configUpdated forced reload clears reconciliation when no page entry remains", async () => {
  const loadedConfig = { pageMarkings: {} };
  const deps = createDeps({
    isEnabled: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async () => loadedConfig,
    findPageMarkingEntry: () => null
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = await handler.handleMessage({
    baseUrl: "https://example.com/base",
    forceReloadPageEntry: true
  });

  assert.deepEqual(response, { ok: true });
  assert.ok(
    deps.calls.some((call) =>
      call[0] === "clearPageSaveReconciliation" &&
      call[1] === "https://example.com/base" &&
      call[2] === "https://example.com/base/page"
    )
  );
  assert.ok(
    deps.calls.some((call) =>
      call[0] === "clearPageDraftBaseline" &&
      call[1] === "https://example.com/base/page"
    )
  );
});

test("configUpdated same-base failure still syncs property lock and answers ok true", async () => {
  const deps = createDeps({
    isEnabled: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async () => {
      throw new Error("load failed");
    }
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = await handler.handleMessage({ baseUrl: "https://example.com/base" });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(deps.calls.at(-1), ["runPropertyLockSync", { forceSiteIdRefresh: true }]);
});

test("configUpdated out-of-scope update clears preview, disables marking, and syncs", () => {
  const deps = createDeps({
    isEnabled: () => true,
    sameBaseUrl: () => false
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = handler.handleMessage({ baseUrl: "https://other.example/base" });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(deps.calls, [
    ["clearAiPreviewState"],
    ["disable"],
    ["refreshSilentHighlightings"],
    ["runPropertyLockSync", { forceSiteIdRefresh: true }]
  ]);
});

test("configUpdated out-of-scope update does not disable an already silent page", () => {
  const deps = createDeps({
    isEnabled: () => false,
    sameBaseUrl: () => false
  });
  const handler = createConfigUpdatedHandler(deps);

  const response = handler.handleMessage({ baseUrl: "https://other.example/base" });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(deps.calls, [
    ["clearAiPreviewState"],
    ["refreshSilentHighlightings"],
    ["runPropertyLockSync", { forceSiteIdRefresh: true }]
  ]);
});
