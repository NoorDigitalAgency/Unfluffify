import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import {
  completeRenderModeInspectionReloadFollowUp,
  detectRenderModeViaEndpoint,
  maybeAutoDetectRenderMode,
  normalizeRenderModeDetectionResult,
  waitForTabLoadComplete,
  waitForTabLoadStart
} from "../popup/render-mode-inspection.js";

function createBrowserHarness(initialStatus = "complete") {
  const listeners = new Set();
  return {
    browserRef: {
      tabs: {
        onUpdated: {
          addListener: (listener) => listeners.add(listener),
          removeListener: (listener) => listeners.delete(listener)
        },
        get: async () => ({ status: initialStatus })
      }
    },
    emit(tabId, changeInfo) {
      for (const listener of listeners) {
        listener(tabId, changeInfo);
      }
    }
  };
}

function createBaseDeps(overrides = {}) {
  const state = {
    currentBaseUrl: "https://example.com",
    currentConfig: {},
    renderModeSuggestedKey: "",
    renderModeSuggestedValue: "",
    renderModeDetectionUnsure: false,
    renderModeDetectionAccuracy: Number.NaN,
    renderModeUndeterminedNoticeKey: "",
    renderModeDetectionInFlight: false,
    renderModeDetectionKey: ""
  };
  const base = {
    state,
    config: {
      getConfigRenderMode: () => "static",
      normalizeRenderMode: (value) => value
    },
    PopupText: {
      overlay: {
        detectingRenderMode: "Detecting"
      }
    },
    RENDER_MODE_DETECTION_MAX_ATTEMPTS: 3,
    RENDER_MODE_DETECTION_MIN_ENDPOINT_ACCURACY: 0.65,
    RENDER_MODE_INSPECTION_START_TIMEOUT_MS: 20,
    RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS: 20,
    RENDER_MODE_UNDETERMINED: "undetermined",
    windowRef: {
      setTimeout,
      clearTimeout
    },
    browserRef: createBrowserHarness().browserRef,
    messages: {
      // deno-lint-ignore require-await -- preserves existing promise/callback contract.
      sendRuntimeMessage: async () => ({ ok: true, rendered: true, accuracy: 0.9 })
    },
    shouldAutoDetectRenderMode: () => true,
    getCurrentRenderModeInspectionSnapshot: () => ({ rawHtml: "<html>", renderedHtml: "<body>" }),
    getSuggestedRenderModeForPage: () => "static",
    markRenderModeUndetermined() {},
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadGlobalAiSettings: async () => ({ tokenValue: "token", endpointValue: "endpoint" }),
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    runWithSpinner: async (_key, _message, work) => work(),
    normalizeUiRenderModeValue: (value) => value,
    buildTransferPayloadKey: () => "payload-key",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    putTransferPayload: async () => ({ ok: true }),
    waitForRetryDelay: async () => {},
    getRetryDelayMs: () => 1,
    isRetryableHttpStatus: () => true,
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    ensureContentReadyForRenderModeInspection: async () => true,
    rememberRenderModeInspectionSnapshot() {},
    hideConsentForRenderModeInspection: async () => {},
    reconcilePropertyLockAfterRenderModeReload: async () => {},
    scheduleStaleInspectionBusyClear() {}
  };
  return { ...base, ...overrides };
}

test("popup render-mode inspection normalizes endpoint payload confidence", () => {
  const deps = createBaseDeps();

  assert.deepEqual(normalizeRenderModeDetectionResult(deps, null), { result: "", accuracy: Number.NaN });
  assert.deepEqual(normalizeRenderModeDetectionResult(deps, { accuracy: 0.5, rendered: true }), { result: "unsure", accuracy: 0.5 });
  assert.deepEqual(normalizeRenderModeDetectionResult(deps, { accuracy: 0.91, rendered: false }), { result: "static", accuracy: 0.91 });
});

test("popup render-mode inspection detection retries and succeeds", async () => {
  let calls = 0;
  const deps = createBaseDeps({
    messages: {
      // deno-lint-ignore require-await -- preserves existing promise/callback contract.
      sendRuntimeMessage: async () => {
        calls += 1;
        if (calls === 1) {
          return { ok: true, status: "error", httpStatus: 503 };
        }
        return { ok: true, status: "ok", payload: { rendered: true, accuracy: 0.9 } };
      }
    }
  });

  const result = await detectRenderModeViaEndpoint(deps, {
    rawHtml: "<html>",
    renderedHtml: "<body>"
  });

  assert.equal(result.ok, true);
  assert.equal(result.result, "rendered");
  assert.equal(calls, 2);
});

test("popup render-mode inspection auto-detect returns undetermined without snapshot", async () => {
  const deps = createBaseDeps({
    getCurrentRenderModeInspectionSnapshot: () => null
  });

  const result = await maybeAutoDetectRenderMode(deps, "https://example.com/page");

  assert.equal(result, "undetermined");
  assert.equal(deps.state.renderModeSuggestedKey, "https://example.com|https://example.com/page");
});

test("popup render-mode inspection keeps unconfirmed skipped detection undetermined", async () => {
  const deps = createBaseDeps({
    shouldAutoDetectRenderMode: () => false
  });

  const result = await maybeAutoDetectRenderMode(deps, "https://example.com/page");

  assert.equal(result, "undetermined");
  assert.equal(deps.state.renderModeSuggestedValue, "undetermined");
});

test("popup render-mode inspection preserves confirmed render mode when detection is skipped", async () => {
  const state = {
    ...createBaseDeps().state,
    currentBaseUrlHasConfirmedRenderMode: true,
    currentConfig: {
      renderMode: "rendered"
    }
  };
  const deps = createBaseDeps({
    state,
    shouldAutoDetectRenderMode: () => false,
    config: {
      getConfigRenderMode: (sourceConfig) => sourceConfig.renderMode || "static",
      normalizeRenderMode: (value) => value
    }
  });

  const result = await maybeAutoDetectRenderMode(deps, "https://example.com/page");

  assert.equal(result, "rendered");
  assert.equal(deps.state.renderModeSuggestedValue, "rendered");
});

test("popup render-mode inspection wait helpers resolve on tab lifecycle signals", async () => {
  const harness = createBrowserHarness("complete");
  const deps = createBaseDeps({
    browserRef: harness.browserRef,
    windowRef: {
      setTimeout,
      clearTimeout
    }
  });

  const startPromise = waitForTabLoadStart(deps, 7, 50);
  harness.emit(7, { status: "loading" });
  const started = await startPromise;

  const completePromise = waitForTabLoadComplete(deps, 7, 50, { awaitNextLoad: true });
  harness.emit(7, { status: "loading" });
  harness.emit(7, { status: "complete" });
  const completed = await completePromise;

  assert.equal(started, true);
  assert.equal(completed, true);
});

test("popup render-mode follow-up hides consent before capture without reveal", async () => {
  const calls = [];
  const deps = createBaseDeps({
    messages: {
      // deno-lint-ignore require-await -- preserves existing promise/callback contract.
      sendTabMessageToTab: async (_tabId, message) => {
        calls.push(message.type);
        if (message.type === "captureRenderModeInspectionHtml") {
          return {
            ok: true,
            pageUrl: "https://example.com/page",
            renderedHtml: "<html>rendered</html>",
            rawHtml: "<html>raw</html>"
          };
        }
        return { ok: true };
      }
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    hideConsentForRenderModeInspection: async () => {
      calls.push("hideConsentForRenderModeInspection");
    }
  });

  const result = await completeRenderModeInspectionReloadFollowUp(deps, 7, "op-1");

  assert.equal(result, true);
  assert.deepEqual(calls, [
    "hideConsentForRenderModeInspection",
    "captureRenderModeInspectionHtml"
  ]);
});
