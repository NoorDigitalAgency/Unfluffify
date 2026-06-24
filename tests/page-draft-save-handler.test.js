import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createPageDraftSaveHandler } from "../content/page-draft-save-handler.js";

const pageUrl = "https://example.com/base/page";
const baseUrl = "https://example.com/base";

function createDeps(overrides = {}) {
  const calls = [];
  const entry = { xpaths: [{ xpath: "/draft" }], rawHtml: "" };
  const savedEntry = {
    renderedHtml: "<main>Saved</main>",
    rawHtml: "<raw>Saved</raw>",
    submissionXpaths: ["/html/body/main"]
  };
  const config = { pageMarkings: { [pageUrl]: entry } };
  const deps = {
    calls,
    areEntriesEquivalent: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    clearPageSaveReconciliation: async (...args) => calls.push(["clearPageSaveReconciliation", ...args]),
    collectAiSubmissionXpathsForCurrentPage: () => {
      calls.push(["collectAiSubmissionXpathsForCurrentPage"]);
      return ["/html/body/main"];
    },
    collectImmutableElements: () => {
      calls.push(["collectImmutableElements"]);
      return ["/immutable"];
    },
    createCurrentPageSnapshot: () => {
      calls.push(["createCurrentPageSnapshot"]);
      return { renderedHtml: "<main>Saved</main>" };
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    fetchCurrentPageRawHtml: async (...args) => {
      calls.push(["fetchCurrentPageRawHtml", ...args]);
      return "<raw>Saved</raw>";
    },
    getBaseUrl: () => baseUrl,
    getConfig: () => config,
    getCurrentPageType: () => "listing",
    getDocumentTitle: () => "Saved Page",
    getDraftPageEntry: (...args) => {
      calls.push(["getDraftPageEntry", ...args]);
      return entry;
    },
    getPageMarkingEntry: (...args) => {
      calls.push(["getPageMarkingEntry", ...args]);
      return entry;
    },
    getPageSaveReconciliationState: () => null,
    getPageUrl: () => pageUrl,
    getSavedPageEntry: (...args) => {
      calls.push(["getSavedPageEntry", ...args]);
      return savedEntry;
    },
    hideConsentElements: () => calls.push(["hideConsentElements"]),
    logContentDiagnostic: (...args) => calls.push(["logContentDiagnostic", ...args]),
    matchesActiveBaseUrl: (value) => value === baseUrl,
    notifyDraftStatus: (...args) => calls.push(["notifyDraftStatus", ...args]),
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    refreshSavedPageEntryFromBackendCache: async (...args) => {
      calls.push(["refreshSavedPageEntryFromBackendCache", ...args]);
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    saveConfig: async (...args) => calls.push(["saveConfig", ...args]),
    scheduleRender: () => calls.push(["scheduleRender"]),
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    setPageSaveReconciliationPending: async (...args) => {
      calls.push(["setPageSaveReconciliationPending", ...args]);
    },
    setSavedPageEntry: (...args) => calls.push(["setSavedPageEntry", ...args]),
    showPageToast: (...args) => calls.push(["showPageToast", ...args]),
    submissionXpathsEqual: () => true,
    syncPageMarkings: (...args) => {
      calls.push(["syncPageMarkings", ...args]);
      return { changed: false };
    },
    touchPageEntryTimestamp: (...args) => calls.push(["touchPageEntryTimestamp", ...args]),
    ...overrides
  };
  return deps;
}

test("page draft save returns ok false and toast when target state is invalid", async () => {
  const deps = createDeps({ getConfig: () => null });
  const handler = createPageDraftSaveHandler(deps);

  const response = await handler.saveCurrentPageDraft({ baseUrl, showToast: true });

  assert.deepEqual(response, { ok: false });
  assert.deepEqual(deps.calls, [["showPageToast", "Enable marking to save this page."]]);
});

test("page draft save returns no-op when saved snapshot already matches", async () => {
  const deps = createDeps();
  const handler = createPageDraftSaveHandler(deps);

  const response = await handler.saveCurrentPageDraft({ baseUrl });

  assert.deepEqual(response, { ok: true, saved: false, dirty: false });
  assert.ok(!deps.calls.some((call) => call[0] === "saveConfig"));
  assert.ok(!deps.calls.some((call) => call[0] === "setPageSaveReconciliationPending"));
});

test("page draft save reports pending when only server reconciliation remains", async () => {
  const deps = createDeps({
    getPageSaveReconciliationState: () => ({ pending: true, reason: "pending" })
  });
  const handler = createPageDraftSaveHandler(deps);

  const response = await handler.saveCurrentPageDraft({ baseUrl, showToast: true });

  assert.deepEqual(response, { ok: true, saved: true, dirty: true, reconciliationPending: true });
  assert.deepEqual(deps.calls.at(-1), ["showPageToast", "Server sync pending"]);
  assert.ok(!deps.calls.some((call) => call[0] === "saveConfig"));
});

test("page draft save persists snapshot data and marks server sync pending", async () => {
  const deps = createDeps({
    areEntriesEquivalent: () => false,
    getSavedPageEntry: (...args) => {
      deps.calls.push(["getSavedPageEntry", ...args]);
      return null;
    },
    syncPageMarkings: (...args) => {
      deps.calls.push(["syncPageMarkings", ...args]);
      return { changed: true };
    }
  });
  const handler = createPageDraftSaveHandler(deps);

  const response = await handler.saveCurrentPageDraft({ baseUrl, pageType: "detail" });

  assert.deepEqual(response, { ok: true, saved: true, dirty: true, reconciliationPending: true });
  assert.deepEqual(
    deps.calls.filter((call) => call[0] === "setPageSaveReconciliationPending"),
    [
      ["setPageSaveReconciliationPending", baseUrl, pageUrl, { reason: "saving" }],
      ["setPageSaveReconciliationPending", baseUrl, pageUrl, { reason: "pending" }]
    ]
  );
  const savedConfig = deps.calls.find((call) => call[0] === "saveConfig")[2];
  const savedEntry = savedConfig.pageMarkings[pageUrl];
  assert.equal(savedEntry.renderedHtml, "<main>Saved</main>");
  assert.equal(savedEntry.rawHtml, "<raw>Saved</raw>");
  assert.equal(savedEntry.title, "Saved Page");
  assert.equal(savedEntry.pageType, "detail");
  assert.deepEqual(savedEntry.submissionXpaths, ["/html/body/main"]);
  assert.deepEqual(deps.calls.at(-2), ["scheduleRender"]);
  assert.deepEqual(deps.calls.at(-1), ["notifyDraftStatus", pageUrl]);
});

test("page draft save clears newly-created reconciliation after save failure", async () => {
  const deps = createDeps({
    areEntriesEquivalent: () => false,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    saveConfig: async () => {
      throw new Error("save failed");
    },
    syncPageMarkings: (...args) => {
      deps.calls.push(["syncPageMarkings", ...args]);
      return { changed: true };
    }
  });
  const handler = createPageDraftSaveHandler(deps);

  const response = await handler.saveCurrentPageDraft({ baseUrl, showToast: true });

  assert.deepEqual(response, { ok: false });
  assert.ok(deps.calls.some((call) => call[0] === "clearPageSaveReconciliation"));
  assert.deepEqual(deps.calls.at(-1), ["showPageToast", "Unable to save page"]);
});
