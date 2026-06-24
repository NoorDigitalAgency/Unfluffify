import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createRenderModeInspector } from "../background/render-mode-inspector.js";

test("render-mode inspector runs begin, consent hide, capture, and end through injected messaging", async () => {
  const messageTypes = [];
  const runtimeUpdates = [];
  const inspector = createRenderModeInspector({
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    ensureContentMainForTab: async () => ({ ok: true }),
    waitForBackgroundRetryDelay: async () => {},
    updateTabRuntime: (tabId, patch) => {
      runtimeUpdates.push({ tabId, patch });
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    sendContentMessageToTab: async (_tabId, message) => {
      messageTypes.push(message.type);
      if (message.type === "getInspectionStatus") {
        return { ok: true };
      }
      if (message.type === "renderModeInspectionBegin") {
        return { ok: true };
      }
      if (message.type === "captureRenderModeInspectionHtml") {
        return {
          ok: true,
          pageUrl: "https://example.test/page",
          renderedHtml: "<html>rendered</html>",
          rawHtml: "<html>raw</html>",
          renderMode: "dynamic"
        };
      }
      if (message.type === "hideConsentForInspection") {
        return { ok: true, hiddenCount: 2 };
      }
      if (message.type === "renderModeInspectionEnd") {
        return { ok: true };
      }
      return { ok: false };
    }
  });

  const begin = await inspector.runRenderModeInspectionBeginStep(5, "op-1");
  const hideConsent = await inspector.runRenderModeHideConsentStep(5);
  const capture = await inspector.runRenderModeCaptureHtmlStep(5, "https://example.test", "op-1");
  const ended = await inspector.sendRenderModeInspectionEndWithRetry(5, "op-1");

  assert.equal(begin.ok, true);
  assert.equal(hideConsent.ok, true);
  assert.equal(hideConsent.hiddenCount, 2);
  assert.equal(capture.ok, true);
  assert.equal(ended, true);
  assert.equal(runtimeUpdates.length, 1);
  assert.deepEqual(runtimeUpdates[0], { tabId: 5, patch: { mode: "inspection" } });
  assert.equal(messageTypes.includes("renderModeInspectionBegin"), true);
  assert.equal(messageTypes.includes("runRenderModeRevealOnce"), false);
  assert.equal(messageTypes.includes("captureRenderModeInspectionHtml"), true);
  assert.equal(messageTypes.includes("hideConsentForInspection"), true);
  assert.equal(messageTypes.includes("renderModeInspectionEnd"), true);
});

test("render-mode end step retries up to three attempts", async () => {
  let endAttempts = 0;
  let retryDelayCalls = 0;
  const inspector = createRenderModeInspector({
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    ensureContentMainForTab: async () => ({ ok: true }),
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    waitForBackgroundRetryDelay: async () => {
      retryDelayCalls += 1;
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    sendContentMessageToTab: async (_tabId, message) => {
      if (message.type !== "renderModeInspectionEnd") {
        return { ok: true };
      }
      endAttempts += 1;
      return { ok: endAttempts >= 3 };
    }
  });

  const ended = await inspector.sendRenderModeInspectionEndWithRetry(7, "op-2");

  assert.equal(ended, true);
  assert.equal(endAttempts, 3);
  assert.equal(retryDelayCalls, 2);
});

test("render-mode load wait helpers time out when tab updates never arrive", async (t) => {
  const listeners = new Set();
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener)
      },
      // deno-lint-ignore require-await -- preserves existing promise/callback contract.
      get: async () => ({ status: "complete" })
    }
  };
  t.after(() => {
    globalThis.chrome = previousChrome;
  });

  const inspector = createRenderModeInspector({
    startTimeoutMs: 10,
    loadTimeoutMs: 10
  });

  const started = await inspector.waitForTabLoadStartInBackground(9, 10);
  const completed = await inspector.waitForTabLoadCompleteInBackground(9, 10, { awaitNextLoad: true });

  assert.equal(started, false);
  assert.equal(completed, false);
});
