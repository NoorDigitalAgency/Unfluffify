import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { PopupText } from "../common/text.js";
import { state } from "../popup/state.js";
import {
  handlePageRevert,
  handlePageSave,
  hasCurrentPagePendingChanges
} from "../popup/page-reconciliation.js";

function resetState() {
  state.currentBaseUrl = "https://example.com";
  state.currentPageSaveReconciliationPending = false;
}

function createDeps(overrides = {}) {
  const calls = {
    saveStatus: [],
    toast: [],
    retries: [],
    sync: 0,
    clear: 0,
    resetFingerprint: 0,
    postSave: 0,
    refresh: 0,
    discard: 0
  };

  const deps = {
    PopupText,
    PAGE_SAVE_SYNC_MAX_ATTEMPTS: 3,
    PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS: 10,
    PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS: 40,
    windowRef: {
      confirm: () => true
    },
    hasCurrentPageMarkingChanges: () => false,
    ensureActiveTab: async () => ({ id: 1 }),
    ensureBaseUrl: () => true,
    refreshCurrentPageRuntimeStatus: async () => {},
    showToast: (message) => {
      calls.toast.push(message);
    },
    getViewState: () => ({
      sessionHasPendingChanges: true,
      sessionRequiresAiRun: false,
      currentPageHasPendingChanges: true
    }),
    updateLastConfigSaveStatus: (message) => {
      calls.saveStatus.push(message);
    },
    validateStoredToken: async () => true,
    runWithSpinner: async (_key, _message, task) => task(),
    getCurrentPageUrl: () => "https://example.com/page",
    loadGlobalAiSettings: async () => ({
      tokenValue: "token",
      configEndpointValue: "https://api.example.com/config",
      stageBaseValue: "https://stage.example.com"
    }),
    syncBaseConfigToServer: async () => {
      calls.sync += 1;
      return { ok: true };
    },
    clearCurrentPageSaveReconciliation: async () => {
      calls.clear += 1;
    },
    resetAiRunMarkingsFingerprint: () => {
      calls.resetFingerprint += 1;
    },
    applyPostSaveSilentTransition: async () => {
      calls.postSave += 1;
    },
    refreshUi: async () => {
      calls.refresh += 1;
    },
    setUiBusy: () => {},
    waitForRetryDelay: async (ms) => {
      calls.retries.push(ms);
    },
    applyLocalPageDiscard: async () => {
      calls.discard += 1;
    },
    ...overrides
  };

  return { deps, calls };
}

test("popup page reconciliation current-page pending detection checks dirty and reconciliation flags", () => {
  const { deps } = createDeps({
    hasCurrentPageMarkingChanges: () => true
  });

  assert.equal(
    hasCurrentPagePendingChanges(deps, {}, {}, {
      currentDraftDirty: false,
      reconciliationPending: false,
      pageUrl: "https://example.com/page"
    }),
    true
  );
  assert.equal(
    hasCurrentPagePendingChanges(deps, {}, {}, {
      currentDraftDirty: true,
      reconciliationPending: false,
      pageUrl: "https://example.com/page"
    }),
    true
  );
  assert.equal(
    hasCurrentPagePendingChanges(deps, {}, {}, {
      currentDraftDirty: false,
      reconciliationPending: true,
      pageUrl: "https://example.com/page"
    }),
    true
  );
});

test("popup page reconciliation save exits early when session has no pending changes", async () => {
  resetState();
  const { deps, calls } = createDeps({
    getViewState: () => ({
      sessionHasPendingChanges: false,
      sessionRequiresAiRun: false,
      currentPageHasPendingChanges: false
    })
  });

  await handlePageSave(deps);

  assert.equal(calls.sync, 0);
  assert.equal(calls.saveStatus.at(-1), PopupText.page.noLocalChangesToSave);
  assert.equal(calls.toast.at(-1), PopupText.page.noChangesToSave);
});

test("popup page reconciliation save retries retryable failures then succeeds", async () => {
  resetState();
  let saveAttempts = 0;
  const { deps, calls } = createDeps({
    syncBaseConfigToServer: async () => {
      saveAttempts += 1;
      if (saveAttempts === 1) {
        return { ok: false };
      }
      return { ok: true };
    }
  });

  await handlePageSave(deps);

  assert.equal(saveAttempts, 2);
  assert.equal(calls.retries.length, 1);
  assert.equal(calls.clear, 1);
  assert.equal(calls.resetFingerprint, 1);
  assert.equal(calls.postSave, 1);
  assert.equal(calls.toast.at(-1), PopupText.page.sessionSaved);
});

test("popup page reconciliation revert respects current-page pending gate", async () => {
  resetState();
  const { deps, calls } = createDeps({
    getViewState: () => ({
      sessionHasPendingChanges: false,
      sessionRequiresAiRun: false,
      currentPageHasPendingChanges: false
    })
  });

  await handlePageRevert(deps);

  assert.equal(calls.discard, 0);
  assert.equal(calls.toast.at(-1), PopupText.page.noChangesToSave);
});
