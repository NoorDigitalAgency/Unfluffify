import * as utils from "../common/utilities.js";
import * as stateModule from "./state.js";

const { state } = stateModule;

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getSidePanelBoundTab() {
  if (
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.getContexts !== "function" ||
    !chrome.tabs ||
    typeof chrome.tabs.get !== "function"
  ) {
    return null;
  }
  try {
    const contextQuery = {
      contextTypes: ["SIDE_PANEL"],
      documentUrls: [chrome.runtime.getURL("popup.html")]
    };
    if (chrome.windows && typeof chrome.windows.getCurrent === "function") {
      try {
        const currentWindow = await chrome.windows.getCurrent();
        if (currentWindow && Number.isFinite(currentWindow.id)) {
          contextQuery.windowIds = [Math.trunc(currentWindow.id)];
        }
      } catch {
        // Fall back to an unscoped context query.
      }
    }
    const contexts = await chrome.runtime.getContexts(contextQuery);
    if (!Array.isArray(contexts)) {
      return null;
    }
    const boundContext = contexts.find((context) => Number.isFinite(context && context.tabId));
    if (!boundContext) {
      return null;
    }
    return await chrome.tabs.get(Math.trunc(boundContext.tabId));
  } catch {
    return null;
  }
}

export function sendRuntimeMessage(message) {
  return utils.sendRuntimeMessage(message);
}

export function sendTabMessage(message) {
  return new Promise((resolve) => {
    if (!state.currentTab || !state.currentTab.id) {
      resolve(null);
      return;
    }
    chrome.tabs.sendMessage(state.currentTab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

export function sendTabMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve(null);
      return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

export async function sendTabMessageWithRetry(message, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await sendTabMessage(message);
    if (response) {
      return response;
    }
    await delay(250);
  }
  return null;
}

export async function loadActiveTab() {
  try {
    const sidePanelBoundTab = await getSidePanelBoundTab();
    if (sidePanelBoundTab && sidePanelBoundTab.id) {
      state.currentTab = sidePanelBoundTab;
      return;
    }
    let tabs = await utils.tabsQuery({ active: true, currentWindow: true });
    if (!tabs.length) {
      tabs = await utils.tabsQuery({ active: true, lastFocusedWindow: true });
    }
    state.currentTab = tabs[0] || null;
  } catch (error) {
    state.currentTab = null;
  }
}
