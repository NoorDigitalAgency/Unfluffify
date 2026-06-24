import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createPageDraftStatusHandler } from "../content/page-draft-status-handler.js";

function createDeps(overrides = {}) {
  let savedEntry = { saved: true };
  const calls = [];

  const deps = {
    areEntriesEquivalent: (left, right) => {
      calls.push(["areEntriesEquivalent", left, right]);
      return left === right;
    },
    clonePageEntry: (entry) => {
      calls.push(["clonePageEntry", entry]);
      return { ...entry, cloned: true };
    },
    collectAiSubmissionXpathsForCurrentPage: () => {
      calls.push(["collectAiSubmissionXpathsForCurrentPage"]);
      return ["/live"];
    },
    collectImmutableElements: () => {
      calls.push(["collectImmutableElements"]);
      return ["immutable"];
    },
    getConfig: () => {
      calls.push(["getConfig"]);
      return { pageMarkings: {} };
    },
    getDraftPageEntry: (pageUrl) => {
      calls.push(["getDraftPageEntry", pageUrl]);
      return savedEntry;
    },
    getPageDraftDirty: (pageUrl) => {
      calls.push(["getPageDraftDirty", pageUrl]);
      return false;
    },
    getPageSaveReconciliationPending: (pageUrl) => {
      calls.push(["getPageSaveReconciliationPending", pageUrl]);
      return false;
    },
    getPageSaveReconciliationState: (pageUrl) => {
      calls.push(["getPageSaveReconciliationState", pageUrl]);
      return { reason: "pending" };
    },
    getPageUrl: () => "https://example.com/page",
    getSavedPageEntry: (pageUrl) => {
      calls.push(["getSavedPageEntry", pageUrl]);
      return savedEntry;
    },
    hasPageMarkingEntry: (config, pageUrl) => {
      calls.push(["hasPageMarkingEntry", config, pageUrl]);
      return true;
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    refreshSavedPageEntryFromBackendCache: async (baseUrl, pageUrl) => {
      calls.push(["refreshSavedPageEntryFromBackendCache", baseUrl, pageUrl]);
    },
    setSavedPageEntry: (pageUrl, entry) => {
      calls.push(["setSavedPageEntry", pageUrl, entry]);
      savedEntry = entry;
    },
    submissionXpathsEqual: (left, right) => {
      calls.push(["submissionXpathsEqual", left, right]);
      return JSON.stringify(left) === JSON.stringify(right);
    },
    syncPageMarkings: (config, pageUrl, immutableExcluded, options) => {
      calls.push(["syncPageMarkings", config, pageUrl, immutableExcluded, options]);
      return { changed: false, entry: { xpath: "/draft", submissionXpaths: ["/live"] } };
    },
    ...overrides
  };

  return {
    calls,
    deps,
    getSavedEntry: () => savedEntry
  };
}

test("page draft status handler returns null entry when no page entry exists", async () => {
  const savedEntry = { saved: true };
  const reconciliation = { reason: "pending" };
  const { calls, deps } = createDeps({
    getSavedPageEntry: (pageUrl) => {
      calls.push(["getSavedPageEntry", pageUrl]);
      return savedEntry;
    },
    getPageDraftDirty: (pageUrl) => {
      calls.push(["getPageDraftDirty", pageUrl]);
      return true;
    },
    getPageSaveReconciliationPending: (pageUrl) => {
      calls.push(["getPageSaveReconciliationPending", pageUrl]);
      return true;
    },
    getPageSaveReconciliationState: (pageUrl) => {
      calls.push(["getPageSaveReconciliationState", pageUrl]);
      return reconciliation;
    },
    hasPageMarkingEntry: (config, pageUrl) => {
      calls.push(["hasPageMarkingEntry", config, pageUrl]);
      return false;
    },
    syncPageMarkings: (config, pageUrl, immutableExcluded, options) => {
      calls.push(["syncPageMarkings", config, pageUrl, immutableExcluded, options]);
      return { changed: false, entry: null };
    }
  });
  const handler = createPageDraftStatusHandler(deps);

  const response = await handler.getStatus({ targetBaseUrl: "https://example.com" });

  assert.deepEqual(response, {
    ok: true,
    entry: null,
    savedEntry,
    dirty: true,
    reconciliation,
    reconciliationPending: true
  });
});

test("page draft status handler refreshes saved entry when a clean entry changes during sync", async () => {
  const originalEntry = { xpath: "/old", submissionXpaths: ["/live"] };
  const updatedEntry = { xpath: "/new", submissionXpaths: ["/live"] };
  const { calls, deps, getSavedEntry } = createDeps({
    areEntriesEquivalent: (left, right) => {
      calls.push(["areEntriesEquivalent", left, right]);
      return true;
    },
    getDraftPageEntry: (pageUrl) => {
      calls.push(["getDraftPageEntry", pageUrl]);
      return originalEntry;
    },
    getSavedPageEntry: (pageUrl) => {
      calls.push(["getSavedPageEntry", pageUrl]);
      return getSavedEntry();
    },
    syncPageMarkings: (config, pageUrl, immutableExcluded, options) => {
      calls.push(["syncPageMarkings", config, pageUrl, immutableExcluded, options]);
      return { changed: true, entry: updatedEntry };
    }
  });
  const handler = createPageDraftStatusHandler(deps);

  const response = await handler.getStatus({ targetBaseUrl: "https://example.com" });

  assert.match(
    JSON.stringify(calls),
    /setSavedPageEntry/
  );
  assert.deepEqual(getSavedEntry(), updatedEntry);
  assert.deepEqual(response.entry, { xpath: "/new", submissionXpaths: ["/live"], cloned: true });
});

test("page draft status handler does not mark dirty from submission drift when entry lacks prior submission xpaths", async () => {
  const { deps } = createDeps({
    getPageDraftDirty: () => false,
    syncPageMarkings: () => ({
      changed: false,
      entry: { xpath: "/draft", submissionXpaths: [] }
    }),
    submissionXpathsEqual: () => false
  });
  const handler = createPageDraftStatusHandler(deps);

  const response = await handler.getStatus({ targetBaseUrl: "https://example.com" });

  assert.equal(response.dirty, false);
});

test("page draft status handler marks dirty from submission drift when entry already has prior submission xpaths", async () => {
  const { deps } = createDeps({
    getPageDraftDirty: () => false,
    syncPageMarkings: () => ({
      changed: false,
      entry: { xpath: "/draft", submissionXpaths: ["/saved"] }
    }),
    submissionXpathsEqual: () => false
  });
  const handler = createPageDraftStatusHandler(deps);

  const response = await handler.getStatus({ targetBaseUrl: "https://example.com" });

  assert.equal(response.dirty, true);
});
