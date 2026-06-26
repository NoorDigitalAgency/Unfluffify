import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import { handleRuntimeMessage } from "../src/content/runtime-message-handler.js";

const contentMainSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
const runtimeMessageHandlerSource = readFileSync(
  new URL("../src/content/runtime-message-handler.ts", import.meta.url),
  "utf8",
);
const ACTIVE_RAW_RUNTIME_MESSAGE_TYPES = [
  "activateContentMain",
  "setEnabled",
  "getInspectionStatus",
  "setPopupBusyOnPage",
  "runRenderModeRevealOnce",
  "getAiPreviewState",
  "setAiPreviewExpandedMode",
  "setAiComputeLock",
  "closeAiPreview",
  "configUpdated",
  "forceRefresh",
  "getDefaultExclusions",
  "collectPageData",
  "filterXPathsOnPage",
  "collectAiSubmissionXpaths",
  "filterInvisibleXpathsOnPage",
  "describeXPathsOnPage",
  "focusElement",
  "clearFocus",
  "capturePageSnapshot",
  "getPageDraftStatus",
  "setPageSaveReconciliationPending",
  "clearPageSaveReconciliation",
  "setExplicitExclude",
  "setExplicitInclude",
  "savePageDraft",
  "revertPageDraft",
  "showAiPreview",
];

function createDeps(overrides = {}) {
  const deps = {
    handleSetEnabledCommand: async () => ({ ok: true }),
    handleGetInspectionStatusCommand: () => ({ ok: true }),
    handleSetPopupBusyOnPageCommand: () => ({ ok: true, active: true }),
    handleRenderModeInspectionBeginCommand: () => ({ ok: true }),
    handleRunRenderModeRevealOnceCommand: async () => ({ ok: true }),
    handleCaptureRenderModeInspectionHtmlCommand: async () => ({ ok: true }),
    handleRenderModeInspectionEndCommand: () => ({ ok: true }),
    handleHideConsentForInspectionCommand: () => ({ ok: true }),
    getAiPreviewGetStateHandler: () => ({ handleMessage: () => ({ ok: true }) }),
    getAiPreviewExpandedModeHandler: () => ({ handleMessage: () => ({ ok: true }) }),
    getAiPreviewComputeLockHandler: () => ({ handleMessage: async () => ({ ok: true }) }),
    getAiPreviewCloseHandler: () => ({ handleMessage: async () => ({ ok: true }) }),
    getConfigUpdatedHandler: () => ({ handleMessage: () => ({ ok: true }) }),
    getForceRefreshHandler: () => ({ handleMessage: async () => ({ ok: true }) }),
    getDefaultExclusionsHandler: () => ({ handleMessage: () => ({ ok: true, selectors: [] }) }),
    getCollectPageDataHandler: () => ({ handleMessage: async () => ({ ok: true }) }),
    getVisibleXpathsHandler: () => ({ handleMessage: () => ({ ok: true }) }),
    getAiSubmissionXpathsHandler: () => ({ handleMessage: () => ({ ok: true }) }),
    getInvisibleXpathsHandler: () => ({ handleMessage: () => ({ ok: true }) }),
    getDescribeXpathsHandler: () => ({ handleMessage: () => ({ ok: true }) }),
    getFocusHandler: () => ({
      handleFocusMessage: () => ({ ok: true }),
      handleClearFocusMessage: () => ({ ok: true })
    }),
    getCapturePageSnapshotHandler: () => ({ capture: async () => ({ ok: true }) }),
    getPageDraftStatusHandler: () => ({ getStatus: async () => ({ ok: true }) }),
    getPageSaveReconciliationPendingHandler: () => ({ setPending: async () => ({ ok: true }) }),
    getPageSaveReconciliationClearHandler: () => ({ clear: async () => ({ ok: true }) }),
    getExplicitMarkingHandler: () => ({
      setExplicitExclude: () => ({ ok: true }),
      setExplicitInclude: () => ({ ok: true })
    }),
    getPageDraftSaveHandler: () => ({ saveCurrentPageDraft: async () => ({ ok: true }) }),
    getPageDraftRevertHandler: () => ({ revert: async () => ({ ok: true }) }),
    getAiPreviewShowHandler: () => ({ handleMessage: async () => ({ ok: true }) }),
    state: { baseUrl: "https://example.com", config: {} },
    matchesActiveBaseUrl: () => true,
    checkPropertyLockBlocksMarking: () => true,
    sendPropertyLockActivity: () => {},
    locationHref: () => "https://example.com/path",
    isPageSaveReconciliationPending: () => false,
    ...overrides
  };
  return deps;
}

test("unknown message returns undefined and does not call sendResponse", () => {
  const deps = createDeps();
  let called = false;

  const result = handleRuntimeMessage({ type: "unknownMessage" }, {}, () => {
    called = true;
  }, deps);

  assert.equal(result, undefined);
  assert.equal(called, false);
});

test("getDefaultExclusions responds synchronously", () => {
  const deps = createDeps({
    getDefaultExclusionsHandler: () => ({ handleMessage: () => ({ ok: true, selectors: ["body"] }) })
  });
  const responses = [];

  const result = handleRuntimeMessage({ type: "getDefaultExclusions" }, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, undefined);
  assert.deepEqual(responses, [{ ok: true, selectors: ["body"] }]);
});

test("setPopupBusyOnPage responds synchronously", () => {
  const calls = [];
  const deps = createDeps({
    handleSetPopupBusyOnPageCommand: (message) => {
      calls.push(message);
      return { ok: true, active: Boolean(message.active) };
    }
  });
  const responses = [];

  const message = { type: "setPopupBusyOnPage", active: true, message: "Saving session..." };
  const result = handleRuntimeMessage(message, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, undefined);
  assert.deepEqual(calls, [message]);
  assert.deepEqual(responses, [{ ok: true, active: true }]);
});

test("content-main keeps the raw runtime listener bridge", () => {
  assert.match(contentMainSource, /browser\.runtime\.onMessage\.addListener\(/);
});

test("runtime message handler keeps the active raw router inventory", () => {
  for (const messageType of ACTIVE_RAW_RUNTIME_MESSAGE_TYPES) {
    assert.match(
      runtimeMessageHandlerSource,
      new RegExp(`if \\(message\\.type === "${messageType}"\\) \\{`),
      `expected raw runtime route for ${messageType}`,
    );
  }
});

test("activateContentMain responds synchronously", () => {
  const deps = createDeps();
  const responses = [];

  const result = handleRuntimeMessage({ type: "activateContentMain" }, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, undefined);
  assert.deepEqual(responses, [{ ok: true, initialized: true }]);
});

test("setEnabled delegates asynchronously", async () => {
  const calls = [];
  const deps = createDeps({
    handleSetEnabledCommand: async (message) => {
      calls.push(message);
      return { ok: true, enabled: Boolean(message.enabled) };
    },
  });
  const responses = [];
  const message = { type: "setEnabled", enabled: true };

  const result = handleRuntimeMessage(message, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [message]);
  assert.deepEqual(responses, [{ ok: true, enabled: true }]);
});

test("getInspectionStatus responds synchronously", () => {
  const deps = createDeps({
    handleGetInspectionStatusCommand: () => ({ ok: true, mode: "marking" }),
  });
  const responses = [];

  const result = handleRuntimeMessage({ type: "getInspectionStatus" }, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, undefined);
  assert.deepEqual(responses, [{ ok: true, mode: "marking" }]);
});

test("getAiPreviewState responds synchronously", () => {
  const deps = createDeps({
    getAiPreviewGetStateHandler: () => ({ handleMessage: () => ({ ok: true, active: true }) }),
  });
  const responses = [];

  const result = handleRuntimeMessage({ type: "getAiPreviewState" }, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, undefined);
  assert.deepEqual(responses, [{ ok: true, active: true }]);
});

test("focusElement responds synchronously", () => {
  const calls = [];
  const deps = createDeps({
    getFocusHandler: () => ({
      handleFocusMessage: (message) => {
        calls.push(message);
        return { ok: true, focused: true };
      },
      handleClearFocusMessage: () => ({ ok: true }),
    }),
  });
  const responses = [];
  const message = { type: "focusElement", xpath: "//main" };

  const result = handleRuntimeMessage(message, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, undefined);
  assert.deepEqual(calls, [message]);
  assert.deepEqual(responses, [{ ok: true, focused: true }]);
});

test("clearFocus responds synchronously", () => {
  const deps = createDeps({
    getFocusHandler: () => ({
      handleFocusMessage: () => ({ ok: true }),
      handleClearFocusMessage: () => ({ ok: true, cleared: true }),
    }),
  });
  const responses = [];

  const result = handleRuntimeMessage({ type: "clearFocus" }, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, undefined);
  assert.deepEqual(responses, [{ ok: true, cleared: true }]);
});

test("setPageSaveReconciliationPending delegates asynchronously", async () => {
  const calls = [];
  const deps = createDeps({
    locationHref: () => "https://example.com/article",
    getPageSaveReconciliationPendingHandler: () => ({
      setPending: async (options) => {
        calls.push(options);
        return { ok: true, pending: true };
      },
    }),
  });
  const responses = [];
  const message = {
    type: "setPageSaveReconciliationPending",
    baseUrl: "https://example.com",
    pageUrl: "https://example.com/article",
    reason: "popup-save",
  };

  const result = handleRuntimeMessage(message, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [{
    targetBaseUrl: "https://example.com",
    pageUrl: "https://example.com/article",
    reason: "popup-save",
  }]);
  assert.deepEqual(responses, [{ ok: true, pending: true }]);
});

test("runRenderModeRevealOnce delegates asynchronously", async () => {
  const calls = [];
  const deps = createDeps({
    handleRunRenderModeRevealOnceCommand: async (message) => {
      calls.push(message);
      return { ok: true, revealed: true };
    },
  });
  const responses = [];
  const message = { type: "runRenderModeRevealOnce", keepCurrentSelection: true };

  const result = handleRuntimeMessage(message, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [message]);
  assert.deepEqual(responses, [{ ok: true, revealed: true }]);
});

test("setAiComputeLock returns true and responds on success", async () => {
  const deps = createDeps({
    getAiPreviewComputeLockHandler: () => ({ handleMessage: async () => ({ ok: true, locked: true }) })
  });
  const responses = [];

  const result = handleRuntimeMessage({ type: "setAiComputeLock" }, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(responses, [{ ok: true, locked: true }]);
});

test("setAiComputeLock responds with ok false when delegated promise rejects", async () => {
  const deps = createDeps({
    getAiPreviewComputeLockHandler: () => ({ handleMessage: async () => Promise.reject(new Error("boom")) })
  });
  const responses = [];

  const result = handleRuntimeMessage({ type: "setAiComputeLock" }, {}, (response) => {
    responses.push(response);
  }, deps);

  assert.equal(result, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(responses, [{ ok: false }]);
});
