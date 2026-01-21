import { getTabState } from "./tabState.js";

export async function updateActionForTab(tabId) {
  if (!chrome.action || !tabId) {
    return;
  }
  const state = await getTabState(tabId);
  const enabled = state && state.enabled;
  const path = enabled
    ? {
        16: "active/icon16.png",
        32: "active/icon32.png",
        48: "active/icon48.png",
        128: "active/icon128.png"
      }
    : {
        16: "icons/icon16.png",
        32: "icons/icon32.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png"
      };
  chrome.action.setIcon({ tabId, path }, () => {
    void chrome.runtime.lastError;
  });
}
