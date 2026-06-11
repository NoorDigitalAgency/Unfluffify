import test from "node:test";
import assert from "node:assert/strict";

import { createRemoteSupportSupportPage } from "../content/remote-support-support-page.js";

function installSupportPageGlobals({ hasMeta = false, hasBody = true } = {}) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousChrome = globalThis.chrome;

  const listeners = [];

  globalThis.document = {
    body: hasBody ? {} : null,
    querySelector(selector) {
      if (
        selector === "meta[name=\"unfluffify-remote-support-page\"][content=\"support\"]" &&
        hasMeta
      ) {
        return {};
      }
      return null;
    },
    addEventListener() {}
  };

  globalThis.window = {
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, options });
    }
  };

  globalThis.chrome = {
    runtime: {
      sendMessage: () => Promise.resolve({ ok: true, state: null })
    }
  };

  return {
    listeners,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
      globalThis.chrome = previousChrome;
    }
  };
}

function createSupportPageDeps({ featureEnabled = false } = {}) {
  const viewerRequests = [];
  return {
    deps: {
      isRemoteSupportFeatureEnabled: () => featureEnabled,
      getViewerClient: () => ({
        syncVisibility() {},
        updateVideoState() {},
        initializeViewer() {},
        sendRequest(type, payload) {
          viewerRequests.push({ type, payload });
          return Promise.resolve({ ok: true });
        },
        isVideoActive: () => false,
        getIntrinsicWidth: () => 0,
        getIntrinsicHeight: () => 0
      }),
      sendRuntimeMessageSafely: () => Promise.resolve({ ok: true }),
      formatRemoteSupportCountdown: (seconds) => `${seconds}s`,
      normalizeRemoteSupportDockState: (dockState) => dockState || "embedded_minimized",
      REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED: "embedded_minimized",
      REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE: "fullscreen_active",
      EXTENSION_UI_FONT_STACK: "system-ui",
      REMOTE_SUPPORT_SUPPORT_PAGE_META_SELECTOR: "meta[name=\"unfluffify-remote-support-page\"][content=\"support\"]",
      REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID: "unfluffify-support-page-app",
      REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID: "unfluffify-remote-support-page-root",
      REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID: "unfluffify-remote-support-page-style",
      REMOTE_SUPPORT_SUPPORT_PAGE_FALLBACK_ID: "unfluffify-support-page-fallback",
      REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_FRAME_ID: "uf-support-page-viewer"
    },
    viewerRequests
  };
}

test("remote support support-page reports inactive when feature is disabled", () => {
  const harness = installSupportPageGlobals({ hasMeta: true, hasBody: true });
  try {
    const { deps } = createSupportPageDeps({ featureEnabled: false });
    const supportPage = createRemoteSupportSupportPage(deps);

    assert.equal(supportPage.isSupportPage(), false);
  } finally {
    harness.restore();
  }
});

test("remote support support-page initializes DOMContentLoaded listener when body is not ready", () => {
  const harness = installSupportPageGlobals({ hasMeta: true, hasBody: false });
  try {
    const { deps } = createSupportPageDeps({ featureEnabled: true });
    const supportPage = createRemoteSupportSupportPage(deps);

    supportPage.initialize();

    assert.equal(harness.listeners.length, 1);
    assert.equal(harness.listeners[0].type, "DOMContentLoaded");
    assert.deepEqual(harness.listeners[0].options, { once: true });
  } finally {
    harness.restore();
  }
});

test("remote support support-page frame handler ignores tab mismatches", () => {
  const harness = installSupportPageGlobals({ hasMeta: false, hasBody: true });
  try {
    const { deps } = createSupportPageDeps({ featureEnabled: false });
    const supportPage = createRemoteSupportSupportPage(deps);

    supportPage.applyState({ active: true, tabId: 77, dockState: "embedded_minimized" });

    assert.equal(
      supportPage.handleFrameMessage({ tabId: 42, frame: "data:image/png;base64,abc" }),
      false
    );
  } finally {
    harness.restore();
  }
});
