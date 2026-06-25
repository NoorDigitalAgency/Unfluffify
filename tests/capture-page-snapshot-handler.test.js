import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createCapturePageSnapshotHandler } from "../src/content/capture-page-snapshot-handler.js";

function createDeps(overrides = {}) {
  const calls = [];
  let activeConfig = { pageMarkings: {} };
  const existingEntry = { pageType: "existing", rawHtml: "existing-raw" };

  const deps = {
    collectAiSubmissionXpathsForCurrentPage: (config) => {
      calls.push(["collectAiSubmissionXpathsForCurrentPage", config]);
      return ["/submission"];
    },
    collectImmutableElements: () => {
      calls.push(["collectImmutableElements"]);
      return ["immutable"];
    },
    createCurrentPageSnapshot: () => {
      calls.push(["createCurrentPageSnapshot"]);
      return { renderedHtml: "<main>snapshot</main>" };
    },
    fetchCurrentPageRawHtml: async (pageUrl) => {
      calls.push(["fetchCurrentPageRawHtml", pageUrl]);
      return "<html>raw</html>";
    },
    getActiveConfig: () => activeConfig,
    getCurrentPageType: () => "current-type",
    getDocumentTitle: () => "Page title",
    getPageMarkingEntry: (config, pageUrl) => {
      calls.push(["getPageMarkingEntry", config, pageUrl]);
      return existingEntry;
    },
    getPageUrl: () => "https://example.com/page",
    hasPageMarkingEntry: (config, pageUrl) => {
      calls.push(["hasPageMarkingEntry", config, pageUrl]);
      return true;
    },
    loadConfig: async (baseUrl) => {
      calls.push(["loadConfig", baseUrl]);
      return { pageMarkings: {} };
    },
    matchesActiveBaseUrl: (baseUrl) => baseUrl === "https://example.com",
    refreshSavedPageEntryFromBackendCache: async (baseUrl, pageUrl) => {
      calls.push(["refreshSavedPageEntryFromBackendCache", baseUrl, pageUrl]);
    },
    saveConfig: async (baseUrl, config) => {
      calls.push(["saveConfig", baseUrl, config]);
    },
    sendPropertyLockActivity: () => {
      calls.push(["sendPropertyLockActivity"]);
    },
    setConfig: (config) => {
      calls.push(["setConfig", config]);
      activeConfig = config;
    },
    syncPageMarkings: (config, pageUrl, immutableExcluded, options) => {
      calls.push(["syncPageMarkings", config, pageUrl, immutableExcluded, options]);
      return { changed: false, entry: existingEntry };
    },
    touchPageEntryTimestamp: (entry) => {
      calls.push(["touchPageEntryTimestamp", entry]);
      entry.touched = true;
    },
    ...overrides
  };

  return {
    calls,
    deps,
    existingEntry,
    getActiveConfig: () => activeConfig
  };
}

test("capture page snapshot handler returns false when non-persisting request has no existing entry", async () => {
  const { deps } = createDeps({
    hasPageMarkingEntry: () => false
  });
  const handler = createCapturePageSnapshotHandler(deps);

  const response = await handler.capture({
    targetBaseUrl: "https://example.com",
    shouldPersist: false,
    pageType: ""
  });

  assert.deepEqual(response, { ok: false });
});

test("capture page snapshot handler captures rendered html, raw html, title, and submission xpaths for an existing entry", async () => {
  const { deps, existingEntry, getActiveConfig } = createDeps();
  const handler = createCapturePageSnapshotHandler(deps);

  const response = await handler.capture({
    targetBaseUrl: "https://example.com",
    shouldPersist: false,
    pageType: ""
  });

  assert.deepEqual(response, { ok: true });
  assert.equal(existingEntry.renderedHtml, "<main>snapshot</main>");
  assert.equal(existingEntry.rawHtml, "<html>raw</html>");
  assert.equal(existingEntry.title, "Page title");
  assert.deepEqual(existingEntry.submissionXpaths, ["/submission"]);
  assert.equal(existingEntry.touched, true);
  assert.equal(getActiveConfig().pageMarkings["https://example.com/page"], existingEntry);
});

test("capture page snapshot handler persists and refreshes backend cache for active base urls", async () => {
  const { calls, deps } = createDeps();
  const handler = createCapturePageSnapshotHandler(deps);

  const response = await handler.capture({
    targetBaseUrl: "https://example.com",
    shouldPersist: true,
    pageType: ""
  });

  assert.deepEqual(response, { ok: true });
  assert.match(JSON.stringify(calls), /saveConfig/);
  assert.match(JSON.stringify(calls), /refreshSavedPageEntryFromBackendCache/);
  assert.match(JSON.stringify(calls), /sendPropertyLockActivity/);
});

test("capture page snapshot handler skips persistence and property-lock activity for non-persisted snapshots", async () => {
  const { calls, deps } = createDeps();
  const handler = createCapturePageSnapshotHandler(deps);

  await handler.capture({
    targetBaseUrl: "https://example.com",
    shouldPersist: false,
    pageType: ""
  });

  assert.doesNotMatch(JSON.stringify(calls), /saveConfig/);
  assert.doesNotMatch(JSON.stringify(calls), /sendPropertyLockActivity/);
});

test("capture page snapshot handler applies pageType precedence as message, then current, then existing", async () => {
  const messageTypeDeps = createDeps();
  const messageTypeHandler = createCapturePageSnapshotHandler(messageTypeDeps.deps);
  await messageTypeHandler.capture({
    targetBaseUrl: "https://example.com",
    shouldPersist: false,
    pageType: "message-type"
  });
  assert.equal(messageTypeDeps.existingEntry.pageType, "message-type");

  const currentTypeDeps = createDeps({
    getCurrentPageType: () => "current-type"
  });
  currentTypeDeps.existingEntry.pageType = "existing";
  const currentTypeHandler = createCapturePageSnapshotHandler(currentTypeDeps.deps);
  await currentTypeHandler.capture({
    targetBaseUrl: "https://example.com",
    shouldPersist: false,
    pageType: ""
  });
  assert.equal(currentTypeDeps.existingEntry.pageType, "current-type");

  const existingTypeDeps = createDeps({
    getCurrentPageType: () => ""
  });
  existingTypeDeps.existingEntry.pageType = "existing";
  const existingTypeHandler = createCapturePageSnapshotHandler(existingTypeDeps.deps);
  await existingTypeHandler.capture({
    targetBaseUrl: "https://example.com",
    shouldPersist: false,
    pageType: ""
  });
  assert.equal(existingTypeDeps.existingEntry.pageType, "existing");
});
