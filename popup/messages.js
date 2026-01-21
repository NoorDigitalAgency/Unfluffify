import { tabsQuery } from "./storage.js";
import { state } from "./state.js";

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
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
    const tabs = await tabsQuery({ active: true, lastFocusedWindow: true });
    state.currentTab = tabs[0] || null;
  } catch (error) {
    state.currentTab = null;
  }
}
