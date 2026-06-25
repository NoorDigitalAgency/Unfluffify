import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createPageDraftRevertHandler } from "../src/content/page-draft-revert-handler.js";

function createDeps(overrides = {}) {
  const calls = [];
  const storedEntry = { pageType: "detail", xpaths: [{ xpath: "/stored" }] };
  const config = {
    pageMarkings: {
      "https://example.com/base/page": storedEntry
    }
  };
  const deps = {
    calls,
    collectImmutableElements: () => {
      calls.push(["collectImmutableElements"]);
      return ["/immutable"];
    },
    getPageUrl: () => "https://example.com/base/page",
    getSavedPageEntry: (pageUrl) => {
      calls.push(["getSavedPageEntry", pageUrl]);
      return storedEntry;
    },
    isPageDraftDirty: (pageUrl) => {
      calls.push(["isPageDraftDirty", pageUrl]);
      return false;
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async (baseUrl) => {
      calls.push(["loadConfig", baseUrl]);
      return config;
    },
    notifyDraftStatus: (pageUrl) => calls.push(["notifyDraftStatus", pageUrl]),
    scheduleRender: () => calls.push(["scheduleRender"]),
    setBaseUrl: (baseUrl) => calls.push(["setBaseUrl", baseUrl]),
    setConfig: (nextConfig) => calls.push(["setConfig", nextConfig]),
    setSavedPageEntry: (pageUrl, entry) => calls.push(["setSavedPageEntry", pageUrl, entry]),
    syncPageMarkings: (nextConfig, pageUrl, immutableExcluded, options) => {
      calls.push(["syncPageMarkings", nextConfig, pageUrl, immutableExcluded, options]);
    },
    ...overrides
  };
  return deps;
}

test("page draft revert reloads config, syncs stored entry, and reports status", async () => {
  const deps = createDeps();
  const handler = createPageDraftRevertHandler(deps);

  const response = await handler.revert({ targetBaseUrl: "https://example.com/base" });

  assert.deepEqual(response, {
    ok: true,
    dirty: false,
    entry: { pageType: "detail", xpaths: [{ xpath: "/stored" }] }
  });
  assert.deepEqual(deps.calls.map((call) => call[0]), [
    "loadConfig",
    "setSavedPageEntry",
    "collectImmutableElements",
    "syncPageMarkings",
    "setBaseUrl",
    "setConfig",
    "scheduleRender",
    "notifyDraftStatus",
    "isPageDraftDirty",
    "getSavedPageEntry"
  ]);
  assert.deepEqual(deps.calls[3][4], { allowCreate: true, persist: true });
});

test("page draft revert clears saved entry when config has no current page entry", async () => {
  const deps = createDeps({
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async () => ({ pageMarkings: {} }),
    getSavedPageEntry: (pageUrl) => {
      deps.calls.push(["getSavedPageEntry", pageUrl]);
      return null;
    }
  });
  const handler = createPageDraftRevertHandler(deps);

  const response = await handler.revert({ targetBaseUrl: "https://example.com/base" });

  assert.deepEqual(response, { ok: true, dirty: false, entry: null });
  assert.deepEqual(deps.calls[0], [
    "setSavedPageEntry",
    "https://example.com/base/page",
    null
  ]);
  assert.ok(!deps.calls.some((call) => call[0] === "syncPageMarkings"));
});

test("page draft revert propagates load failures to the runtime catch", async () => {
  const deps = createDeps({
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async () => {
      throw new Error("load failed");
    }
  });
  const handler = createPageDraftRevertHandler(deps);

  await assert.rejects(
    () => handler.revert({ targetBaseUrl: "https://example.com/base" }),
    /load failed/
  );
  assert.deepEqual(deps.calls, []);
});
