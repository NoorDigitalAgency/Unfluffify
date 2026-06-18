import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { handleRuntimeMessage } from "../content/runtime-message-handler.js";

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
