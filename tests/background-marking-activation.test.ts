import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { vi } from "vitest";

import { readFileSync } from "./file-kit.ts";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

async function loadPopupMessages() {
  vi.resetModules();
  return await import("../src/popup/messages.js");
}

function withBrowser(value, callback) {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;
  delete globalThis.chrome;
  globalThis.browser = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (typeof originalBrowser === "undefined") {
        delete globalThis.browser;
      } else {
        globalThis.browser = originalBrowser;
      }
      if (typeof originalChrome === "undefined") {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = originalChrome;
      }
    });
}

test("popup tab-command helpers fail fast when the active tab is missing", async () => {
  await withBrowser({ runtime: { id: "test-runtime" } }, async () => {
    const {
      requestTabActivateMarking,
      requestTabApplyPostSaveTransition,
      requestTabCloseAiPreview,
      requestTabDeactivateMarking,
      requestTabFocusPreviewElement,
      requestTabSetAiPreviewExpandedMode,
      requestTabShowAiPreview
    } = await loadPopupMessages();

    const commands = await Promise.all([
      requestTabActivateMarking(null),
      requestTabDeactivateMarking(0),
      requestTabApplyPostSaveTransition(undefined),
      requestTabShowAiPreview(null),
      requestTabCloseAiPreview(undefined),
      requestTabSetAiPreviewExpandedMode(0),
      requestTabFocusPreviewElement(null)
    ]);

    for (const result of commands) {
      assert.deepEqual(result, { ok: false, error: "Missing tab" });
    }
  });
});

test("requestTabActivateMarking forwards payloads and preserves locked background failures", async () => {
  let sentMessage = null;

  await withBrowser({
    runtime: {
      id: "test-runtime",
      sendMessage(message) {
        sentMessage = message;
        return Promise.resolve({
          id: message.id,
          ok: false,
          code: "property_locked",
          error: "Locked",
          details: {
            locked: true,
            reason: "property-lock"
          }
        });
      }
    }
  }, async () => {
    const { requestTabActivateMarking } = await loadPopupMessages();
    const response = await requestTabActivateMarking(17, {
      baseUrl: "https://example.test/article",
      trigger: "popup-toggle"
    });

    assert.equal(sentMessage.type, "TAB_ACTIVATE_MARKING");
    assert.equal(sentMessage.tabId, 17);
    assert.deepEqual(sentMessage.payload, {
      baseUrl: "https://example.test/article",
      trigger: "popup-toggle"
    });
    assert.deepEqual(response, {
      ok: false,
      code: "property_locked",
      error: "Locked",
      locked: true,
      details: {
        locked: true,
        reason: "property-lock"
      }
    });
  });
});

test("preview and save-transition helpers send the expected background commands with runtime timeouts", async () => {
  const sentMessages = [];
  const scheduledTimeouts = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (fn, ms, ...args) => {
    scheduledTimeouts.push(ms);
    return originalSetTimeout(fn, ms, ...args);
  };
  globalThis.clearTimeout = (id) => originalClearTimeout(id);

  try {
    await withBrowser({
      runtime: {
        id: "test-runtime",
        sendMessage(message) {
          sentMessages.push(message);
          return Promise.resolve({
            id: message.id,
            ok: true,
            result: {
              command: message.type,
              payload: message.payload
            }
          });
        }
      }
    }, async () => {
      const {
        requestTabApplyPostSaveTransition,
        requestTabCloseAiPreview,
        requestTabDeactivateMarking,
        requestTabFocusPreviewElement,
        requestTabSetAiPreviewExpandedMode,
        requestTabShowAiPreview
      } = await loadPopupMessages();

      const [
        saveTransition,
        showPreview,
        closePreview,
        expandedMode,
        focusPreviewElement,
        deactivateMarking
      ] = await Promise.all([
        requestTabApplyPostSaveTransition(21, { baseUrl: "https://example.test/article" }),
        requestTabShowAiPreview(21, { selectorSet: { content: ["main"] } }),
        requestTabCloseAiPreview(21, { previewRestoreToken: 7 }),
        requestTabSetAiPreviewExpandedMode(21, { active: true }),
        requestTabFocusPreviewElement(21, { xpath: "/html/body/main" }),
        requestTabDeactivateMarking(21, { reason: "save-complete" })
      ]);

      assert.deepEqual(
        sentMessages.map((message) => [message.type, message.tabId, message.payload]),
        [
          ["TAB_APPLY_POST_SAVE_TRANSITION", 21, { baseUrl: "https://example.test/article" }],
          ["TAB_SHOW_AI_PREVIEW", 21, { selectorSet: { content: ["main"] } }],
          ["TAB_CLOSE_AI_PREVIEW", 21, { previewRestoreToken: 7 }],
          ["TAB_SET_AI_PREVIEW_EXPANDED_MODE", 21, { active: true }],
          ["TAB_FOCUS_PREVIEW_ELEMENT", 21, { xpath: "/html/body/main" }],
          ["TAB_DEACTIVATE_MARKING", 21, { reason: "save-complete" }]
        ]
      );
      assert.deepEqual(
        scheduledTimeouts,
        [15000, 45000, 10000, 10000, 10000, 10000]
      );
      assert.deepEqual(saveTransition, {
        ok: true,
        result: {
          command: "TAB_APPLY_POST_SAVE_TRANSITION",
          payload: { baseUrl: "https://example.test/article" }
        }
      });
      assert.deepEqual(showPreview, {
        ok: true,
        result: {
          command: "TAB_SHOW_AI_PREVIEW",
          payload: { selectorSet: { content: ["main"] } }
        }
      });
      assert.deepEqual(closePreview, {
        ok: true,
        result: {
          command: "TAB_CLOSE_AI_PREVIEW",
          payload: { previewRestoreToken: 7 }
        }
      });
      assert.deepEqual(expandedMode, {
        ok: true,
        result: {
          command: "TAB_SET_AI_PREVIEW_EXPANDED_MODE",
          payload: { active: true }
        }
      });
      assert.deepEqual(focusPreviewElement, {
        ok: true,
        result: {
          command: "TAB_FOCUS_PREVIEW_ELEMENT",
          payload: { xpath: "/html/body/main" }
        }
      });
      assert.deepEqual(deactivateMarking, {
        ok: true,
        result: {
          command: "TAB_DEACTIVATE_MARKING",
          payload: { reason: "save-complete" }
        }
      });
    });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("background activation bootstraps content before persisting marking state and clears failures back to silent mode", () => {
  const activateHandler = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_ACTIVATE_MARKING, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);/
  )[1];

  assert.match(
    activateHandler,
    /const bootstrap = await ensureContentMainForTab\(normalizedTabId\);[\s\S]*?if \(!bootstrap \|\| !bootstrap\.ok\) \{[\s\S]*?CONTENT_UNAVAILABLE[\s\S]*?\}/
  );
  assert.match(
    activateHandler,
    /const enableResponse = await sendContentMessageToTab\(normalizedTabId, \{[\s\S]*?type: "setEnabled",[\s\S]*?enabled: true,[\s\S]*?operationId[\s\S]*?\}\);/
  );
  assert.match(
    activateHandler,
    /if \(!enableResponse \|\| !enableResponse\.ok\) \{[\s\S]*?await utils\.setTabState\(normalizedTabId, \{[\s\S]*?enabled: false,[\s\S]*?pageType: ""[\s\S]*?\}\);[\s\S]*?updateTabRuntime\(normalizedTabId, \{[\s\S]*?mode: "silent"[\s\S]*?\}\);/
  );
  assert.match(
    activateHandler,
    /await utils\.setTabState\(normalizedTabId, \{[\s\S]*?enabled: true,[\s\S]*?baseUrl,[\s\S]*?pageType[\s\S]*?\}\);[\s\S]*?updateTabRuntime\(normalizedTabId, \{[\s\S]*?contentReady: true,[\s\S]*?mode: "marking"[\s\S]*?\}\);/
  );
  assert.match(
    activateHandler,
    /if \(enableResponse && enableResponse\.locked\) \{[\s\S]*?return context\.replyFail\([\s\S]*?FEATURE_DISABLED,[\s\S]*?"Editing is currently locked",[\s\S]*?locked: true,[\s\S]*?tabId: normalizedTabId[\s\S]*?\);/
  );
});

test("background deactivation persists silent mode before the content acknowledgement and returns the acknowledgement state", () => {
  const deactivateHandler = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_DEACTIVATE_MARKING, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);/
  )[1];

  assert.match(
    deactivateHandler,
    /await utils\.setTabState\(normalizedTabId, \{[\s\S]*?enabled: false,[\s\S]*?pageType: ""[\s\S]*?\}\);[\s\S]*?updateTabRuntime\(normalizedTabId, \{[\s\S]*?mode: "silent"[\s\S]*?\}\);[\s\S]*?const disableResponse = await sendContentMessageToTab\(normalizedTabId, \{[\s\S]*?type: "setEnabled",[\s\S]*?enabled: false,[\s\S]*?operationId[\s\S]*?\}\);/
  );
  assert.match(
    deactivateHandler,
    /contentAcknowledged: Boolean\(disableResponse && disableResponse\.ok\),/
  );
});

test("background preview-open command keeps the 30s content timeout after bootstrapping content", () => {
  const previewHandler = backgroundSource.match(
    /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_SHOW_AI_PREVIEW, async \(context, payload\) => \{([\s\S]*?)\n\}, POPUP_TAB_COMMAND_POLICY\);/
  )[1];

  assert.match(
    previewHandler,
    /const contentReady = await ensureContentMainForTab\(normalizedTabId\);[\s\S]*?if \(!contentReady \|\| !contentReady\.ok\) \{[\s\S]*?CONTENT_UNAVAILABLE[\s\S]*?\}/
  );
  assert.match(
    previewHandler,
    /const response = await sendContentMessageToTab\(normalizedTabId, \{[\s\S]*?type: "showAiPreview",[\s\S]*?selectorSet[\s\S]*?\}, 30000\);/
  );
});

test("popup disable flow delegates through requestTabDeactivateMarking instead of sending content messages directly", () => {
  const toggleHandler = popupSource.match(
    /async function handleEnableToggle\([\s\S]*?\n\}\n\n/
  )[0];

  assert.match(
    toggleHandler,
    /const disableResponse = await messages\.requestTabDeactivateMarking\(tab\.id, \{[\s\S]*?baseUrl: baseUrlValue,[\s\S]*?pageType: ""[\s\S]*?\}\);/
  );
  assert.match(
    toggleHandler,
    /if \(!disableResponse \|\| !disableResponse\.ok\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?await refreshUi\(\);/
  );
  assert.doesNotMatch(toggleHandler, /sendTabMessageToTab\(tabId, \{\s*type: "setEnabled"/);
});
