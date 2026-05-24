/**
 * @fileoverview Background service worker for the Unfluffify extension.
 * 
 * This service worker manages:
 * - Tab state persistence and retrieval
 * - Device emulation configuration and updates
 * - Content script injection
 * - IndexedDB operations for data storage
 * - Tab lifecycle events and cleanup
 * - Extension action icon updates
 * - Silent highlight synchronization across pages
 * 
 * Messages handled:
 * - getTabState: Retrieve extension state for a tab
 * - setTabState: Save extension state for a tab
 * - setSilentHighlightOptions: Update silent highlight options
 * - setDeviceEmulation: Enable/disable device emulation for a tab
 * - updateDeviceEmulation: Modify device emulation parameters
 * - getDeviceEmulationState: Get current device emulation state
 * - clearTabState: Clear all state for a tab
 * - unregisterTabAndReload: Disable extension and reload tab
 * - injectContentScript: Inject content script into a tab
 * - isScriptInjected: Check if content script is loaded
 * - idbGet/idbSet/idbRemove: IndexedDB operations
 * - fetchStaticPageHtml: Fetch HTML from external URLs
 */

import * as utils from "./common/utilities.js";
import {
  clearDeviceEmulationAfterNavigation,
  getDeviceEmulationState,
  reconcileDeviceEmulationState,
  updateDeviceEmulation
} from "./common/emulation.js";
import {DEVICE_EMULATION_PREFIX, SCRIPT_INJECTED_PREFIX, TAB_STATE_PREFIX} from "./common/constants.js";
import { normalizeSilentHighlightOptions } from "./common/silent-highlight-options.js";
import {
  handleRemoteSupportBackgroundMessage,
  handleRemoteSupportTabRemoved,
  initRemoteSupportBackground
} from "./common/remote-support-background.js";

initRemoteSupportBackground();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  handleRemoteSupportBackgroundMessage(message, sender)
    .then((result) => {
      if (!result) {
        return;
      }
      sendResponse(result);
    })
    .catch(() => {
      sendResponse({ ok: false, error: "Remote support request failed" });
    });
  if (
    message.type === "getRemoteSupportState" ||
    message.type === "remoteSupportRequestCode" ||
    message.type === "remoteSupportJoin" ||
    message.type === "remoteSupportEnd" ||
    message.type === "remoteSupportSendCommand" ||
    message.type === "remoteSupportTelemetryFromContent" ||
    message.type === "remoteSupportTransportEvent"
  ) {
    return true;
  }

  if (message.type === "getTabState") {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ enabled: false, baseUrl: "" });
      return;
    }
    utils.getTabState(tabId)
      .then((state) => {
        sendResponse(state || { enabled: false, baseUrl: "" });
      })
      .catch(() => {
        sendResponse({ enabled: false, baseUrl: "" });
      });
    return true;
  }

  if (message.type === "setTabState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }
    utils.getTabState(tabId)
      .then((existingState) => {
        const existing = existingState && typeof existingState === "object"
          ? existingState
          : {};
        const nextState = {
          ...existing,
          enabled: Boolean(message.enabled),
          baseUrl: message.baseUrl || ""
        };
        if (Object.prototype.hasOwnProperty.call(message, "pageType")) {
          nextState.pageType = typeof message.pageType === "string" ? message.pageType : "";
        }
        if (existing.silentHighlightOptions) {
          nextState.silentHighlightOptions = normalizeSilentHighlightOptions(
            existing.silentHighlightOptions
          );
        }
        if (
          message.silentHighlightOptions &&
          typeof message.silentHighlightOptions === "object"
        ) {
          nextState.silentHighlightOptions = normalizeSilentHighlightOptions({
            ...(existing.silentHighlightOptions || {}),
            ...message.silentHighlightOptions
          });
        }
        return utils.setTabState(tabId, nextState);
      })
      .then(() => {
        utils.updateActionForTab(tabId).then();
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "setSilentHighlightOptions") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }
    utils.getTabState(tabId)
      .then((existingState) => {
        const existing = existingState && typeof existingState === "object"
          ? existingState
          : {};
        const nextState = {
          enabled: Boolean(existing.enabled),
          baseUrl: typeof existing.baseUrl === "string" ? existing.baseUrl : "",
          ...existing,
          silentHighlightOptions: normalizeSilentHighlightOptions({
            ...(existing.silentHighlightOptions || {}),
            ...(message.silentHighlightOptions || {})
          })
        };
        return utils.setTabState(tabId, nextState);
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "setDeviceEmulation") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    const mode = message.mode === "mobile" ? "mobile" : "desktop";
    updateDeviceEmulation(tabId, {
      enabled: true,
      mode
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error || "Device emulation failed" });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "updateDeviceEmulation") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    updateDeviceEmulation(tabId, {
      enabled: typeof message.enabled === "boolean" ? message.enabled : undefined,
      mode: message.mode,
      scale: message.scale,
      recalculateScale: Boolean(message.recalculateScale)
    })
      .then((result) => {
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error || "Device emulation failed" });
          return;
        }
        sendResponse({ ok: true, state: result.state });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation failed" });
      });
    return true;
  }

  if (message.type === "getDeviceEmulationState") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    reconcileDeviceEmulationState(tabId)
      .then((deviceState) => {
        sendResponse({ ok: true, state: deviceState });
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Device emulation state unavailable" });
      });
    return true;
  }

  if (message.type === "clearTabState") {
    if (!message.tabId) {
      sendResponse({ ok: false });
      return;
    }
    utils.clearTabState(message.tabId)
      .then(() => {
        utils.updateActionForTab(message.tabId).then();
        sendResponse({ ok: true });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "unregisterTabAndReload") {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    (async () => {
      const tabKey = `${TAB_STATE_PREFIX}${tabId}`;
      const initialKey = `${TAB_STATE_PREFIX}initial:${tabId}`;
      const deviceKey = `${DEVICE_EMULATION_PREFIX}${tabId}`;
      const scriptKey = `${SCRIPT_INJECTED_PREFIX}${tabId}`;

      try {
        await updateDeviceEmulation(tabId, { enabled: false });
      } catch (error) {
        // Ignore teardown failures caused by transient tab state changes.
      }
      try {
        await utils.disableExtensionForTab(tabId);
      } catch (error) {
        // Continue with hard state cleanup below.
      }
      await utils.storageRemove(chrome.storage.session, [
        tabKey,
        initialKey,
        deviceKey,
        scriptKey
      ]);
      await utils.updateActionForTab(tabId);
      try {
        await chrome.sidePanel.setOptions({
          tabId,
          path: "popup.html",
          enabled: false
        });
      } catch (error) {
        // Side panel may already be disabled for this tab.
      }
      await new Promise((resolve, reject) => {
        chrome.tabs.reload(tabId, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || "Unable to reload tab"));
            return;
          }
          resolve();
        });
      });
      sendResponse({ ok: true });
    })().catch((error) => {
      sendResponse({
        ok: false,
        error: (error && error.message) || "Unable to unregister current tab"
      });
    });
    return true;
  }

  if (message.type === "injectContentScript") {
    if (!message.tabId) {
      sendResponse({ ok: false, error: "Missing tab" });
      return;
    }
    utils.injectContentScript(message.tabId)
      .then((result) => {
        sendResponse(result);
      })
      .catch(() => {
        sendResponse({ ok: false, error: "Script injection failed" });
      });
    return true;
  }

  if (message.type === "isScriptInjected") {
    if (!message.tabId) {
      sendResponse({ injected: false });
      return;
    }
    utils.isScriptInjected(message.tabId)
      .then((injected) => {
        sendResponse({ injected });
      })
      .catch(() => {
        sendResponse({ injected: false });
      });
    return true;
  }

  if (message.type === "idbGet") {
    utils.idbGet(message.keys)
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB get failed" });
      });
    return true;
  }

  if (message.type === "idbSet") {
    utils.idbSet(message.items)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB set failed" });
      });
    return true;
  }

  if (message.type === "idbRemove") {
    utils.idbRemove(message.keys)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "IndexedDB remove failed" });
      });
    return true;
  }

  if (message.type === "fetchStaticPageHtml") {
    const targetUrl = typeof message.url === "string" ? message.url.trim() : "";
    let parsedUrl = null;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (error) {
      sendResponse({ ok: false, error: "Invalid URL" });
      return;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      sendResponse({ ok: false, error: "Unsupported URL" });
      return;
    }
    (async () => {
      try {
        const response = await fetch(parsedUrl.toString(), {
          method: "GET",
          credentials: "include",
          redirect: "follow",
          cache: "no-store"
        });
        if (!response.ok) {
          sendResponse({
            ok: false,
            status: response.status || 0,
            error: "Static HTML request failed"
          });
          return;
        }
        const html = await response.text();
        sendResponse({
          ok: true,
          status: response.status || 200,
          url: response.url || parsedUrl.toString(),
          html
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: (error && error.message) || "Static HTML request failed"
        });
      }
    })();
    return true;
  }

});

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `${TAB_STATE_PREFIX}${tabId}`;
  const initialKey = `${TAB_STATE_PREFIX}initial:${tabId}`;
  const deviceKey = `${DEVICE_EMULATION_PREFIX}${tabId}`;
  const scriptKey = `${SCRIPT_INJECTED_PREFIX}${tabId}`;
  utils.storageRemove(chrome.storage.session, [key, initialKey, deviceKey, scriptKey]).then();
  handleRemoteSupportTabRemoved(tabId).then();
});

async function disableExtensionAndDeviceEmulationOnTopLevelNavigation(details) {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (!tabId) {
    return;
  }
  const state = await utils.getTabState(tabId);
  if (!state || !state.enabled) {
    return;
  }
  // Navigation auto-disables the extension for the tab. Clear any active device
  // emulation first so the debugger metrics override does not persist into the
  // next page after the in-page cancel bar/UI disappears.
  try {
    await updateDeviceEmulation(tabId, { enabled: false });
  } catch (error) {
    // The tab may already be navigating away/closed; continue disabling the tab state.
  }
  await utils.disableExtensionForTab(tabId);
}

chrome.webNavigation.onBeforeNavigate.addListener(disableExtensionAndDeviceEmulationOnTopLevelNavigation);

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }
  const tabId = details.tabId;
  if (!tabId) {
    return;
  }
  try {
    await clearDeviceEmulationAfterNavigation(tabId);
  } catch (error) {
    // Ignore — the tab may have already navigated away or been closed.
  }
});
chrome.webNavigation.onHistoryStateUpdated.addListener(disableExtensionAndDeviceEmulationOnTopLevelNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(disableExtensionAndDeviceEmulationOnTopLevelNavigation);

chrome.debugger.onDetach.addListener(async (source) => {
  if (!source || !source.tabId) {
    return;
  }
  const state = await getDeviceEmulationState(source.tabId);
  if (!state.enabled) {
    return;
  }
  await chrome.storage.session.set({
    [`${DEVICE_EMULATION_PREFIX}${source.tabId}`]: { ...state, enabled: false }
  });
});

async function refreshActionIconsForWindow(windowId) {
  if (!windowId || windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch (error) {
    tabs = [];
  }
  await Promise.all(
    tabs
      .map((tab) => (tab && tab.id ? utils.updateActionForTab(tab.id) : null))
      .filter(Boolean)
  );
}

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  await refreshActionIconsForWindow(windowId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await refreshActionIconsForWindow(windowId);
});

function requestContentActivation(tabId, attempt = 0) {
  if (!tabId) {
    return;
  }
  chrome.tabs.sendMessage(tabId, { type: "activateContentMain" }, () => {
    if (chrome.runtime.lastError && attempt < 3) {
      setTimeout(() => requestContentActivation(tabId, attempt + 1), 200);
      return;
    }
    void chrome.runtime.lastError;
  });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tabId || !tab) {
    return;
  }
  if (changeInfo.status !== "complete") {
    return;
  }
  if (!((await utils.getTabState(tabId, 'initial')) || {active: false}).active)
  {
    return;
  }
  requestContentActivation(tabId);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session") {
    return;
  }
  Object.keys(changes).forEach((key) => {
    if (!key.startsWith(TAB_STATE_PREFIX)) {
      return;
    }
    const tabId = Number(key.slice(TAB_STATE_PREFIX.length));
    if (!Number.isNaN(tabId)) {
      utils.updateActionForTab(tabId).then();
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "popup.html",
      enabled: true
    }).then();
    chrome.sidePanel.open({tabId: tab.id}).then();
    requestContentActivation(tab.id);
    utils.setTabState(tab.id, { active: true }, 'initial').then(() => {
      utils.updateActionForTab(tab.id).then();
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "activateContentForTab") {
    return;
  }
  const tabId = message.tabId || (sender.tab && sender.tab.id);
  if (!tabId) {
    sendResponse({ ok: false });
    return;
  }
  (async () => {
    await utils.setTabState(tabId, { active: true }, "initial");
    await utils.updateActionForTab(tabId);
    requestContentActivation(tabId);
    sendResponse({ ok: true });
  })().catch(() => {
    requestContentActivation(tabId);
    sendResponse({ ok: true });
  });
  return true;
});
