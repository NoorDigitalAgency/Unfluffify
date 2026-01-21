import { storageGet, storageSet } from "./storage.js";
import { PAGE_PATTERN_DRAFT_PREFIX } from "./constants.js";
import { normalizePatternValue } from "./patterns.js";

export async function getPagePatternDraft(tabId) {
  if (!tabId) {
    return {};
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const result = await storageGet(chrome.storage.session, key);
  return result[key] || {};
}

export async function setPagePatternDraft(tabId, pageUrl, pattern) {
  if (!tabId || !pageUrl) {
    return;
  }
  const normalized = normalizePatternValue(pattern);
  if (!normalized) {
    return;
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const current = await getPagePatternDraft(tabId);
  current[pageUrl] = normalized;
  await storageSet(chrome.storage.session, { [key]: current });
}

export async function clearPagePatternDraft(tabId, pageUrl) {
  if (!tabId || !pageUrl) {
    return;
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const current = await getPagePatternDraft(tabId);
  if (!current[pageUrl]) {
    return;
  }
  delete current[pageUrl];
  await storageSet(chrome.storage.session, { [key]: current });
}
