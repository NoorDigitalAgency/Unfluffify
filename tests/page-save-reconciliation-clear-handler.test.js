import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createPageSaveReconciliationClearHandler } from "../content/page-save-reconciliation-clear-handler.js";

function createDeps(overrides = {}) {
  const calls = [];
  const savedEntries = [];
  const draftStatuses = [];
  const scheduled = [];
  const configs = [];

  const entry = { xpath: "/html/body/main" };
  const deps = {
    clearPageSaveReconciliation: async (baseUrl, pageUrl) => {
      calls.push(["clearPageSaveReconciliation", baseUrl, pageUrl]);
    },
    clonePageEntry: (value) => {
      calls.push(["clonePageEntry", value]);
      return { ...value, cloned: true };
    },
    findPageMarkingEntry: (configValue, pageUrl, baseUrl) => {
      calls.push(["findPageMarkingEntry", configValue, pageUrl, baseUrl]);
      return entry;
    },
    getBackendSavedPageMarkings: async (baseUrl) => {
      calls.push(["getBackendSavedPageMarkings", baseUrl]);
      return [{ pageUrl: "https://example.com/current" }];
    },
    getPageUrl: () => "https://example.com/current",
    loadConfig: async (baseUrl) => {
      calls.push(["loadConfig", baseUrl]);
      return { baseUrl };
    },
    notifyDraftStatus: (pageUrl) => {
      calls.push(["notifyDraftStatus", pageUrl]);
      draftStatuses.push(pageUrl);
    },
    refreshPageSaveReconciliation: async (baseUrl, pageUrl) => {
      calls.push(["refreshPageSaveReconciliation", baseUrl, pageUrl]);
    },
    scheduleRender: () => {
      calls.push(["scheduleRender"]);
      scheduled.push(true);
    },
    setConfig: (nextConfig) => {
      calls.push(["setConfig", nextConfig]);
      configs.push(nextConfig);
    },
    setSavedPageEntry: (pageUrl, savedEntry) => {
      calls.push(["setSavedPageEntry", pageUrl, savedEntry]);
      savedEntries.push([pageUrl, savedEntry]);
    },
    ...overrides
  };

  return {
    calls,
    configs,
    deps,
    draftStatuses,
    entry,
    savedEntries,
    scheduled
  };
}

test("reconciliation clear handler preserves clear-to-notify order and returns a cloned stored entry", async () => {
  const { calls, configs, deps, draftStatuses, entry, savedEntries, scheduled } = createDeps();
  const handler = createPageSaveReconciliationClearHandler(deps);

  const response = await handler.clear({
    targetBaseUrl: "https://example.com",
    pageUrl: "https://example.com/original"
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "clearPageSaveReconciliation",
    "refreshPageSaveReconciliation",
    "loadConfig",
    "getBackendSavedPageMarkings",
    "findPageMarkingEntry",
    "setConfig",
    "setSavedPageEntry",
    "scheduleRender",
    "notifyDraftStatus",
    "clonePageEntry"
  ]);
  assert.deepEqual(configs, [{ baseUrl: "https://example.com" }]);
  assert.deepEqual(savedEntries, [["https://example.com/current", entry]]);
  assert.deepEqual(scheduled, [true]);
  assert.deepEqual(draftStatuses, ["https://example.com/current"]);
  assert.deepEqual(response, {
    ok: true,
    entry: { xpath: "/html/body/main", cloned: true }
  });
});

test("reconciliation clear handler returns a null entry when no stored entry exists", async () => {
  const { deps, savedEntries } = createDeps({
    findPageMarkingEntry: () => null,
    clonePageEntry: () => {
      throw new Error("clonePageEntry should not run when there is no stored entry");
    }
  });
  const handler = createPageSaveReconciliationClearHandler(deps);

  const response = await handler.clear({
    targetBaseUrl: "https://example.com",
    pageUrl: "https://example.com/original"
  });

  assert.deepEqual(savedEntries, [["https://example.com/current", null]]);
  assert.deepEqual(response, { ok: true, entry: null });
});