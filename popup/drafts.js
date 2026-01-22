import * as patterns from "../common/patterns.js";
import * as utils from "../common/utilities.js";
import * as stateModule from "./state.js";

const { PAGE_PATTERN_DRAFT_PREFIX } = stateModule;

export async function getPagePatternDraft(tabId) {
  if (!tabId) {
    return {};
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const result = await utils.storageGet(chrome.storage.session, key);
  return result[key] || {};
}

export async function setPagePatternDraft(tabId, pageUrl, pattern) {
  if (!tabId || !pageUrl) {
    return;
  }
  const normalized = patterns.normalizePatternValue(pattern);
  if (!normalized) {
    return;
  }
  const key = `${PAGE_PATTERN_DRAFT_PREFIX}${tabId}`;
  const current = await getPagePatternDraft(tabId);
  current[pageUrl] = normalized;
  await utils.storageSet(chrome.storage.session, { [key]: current });
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
  await utils.storageSet(chrome.storage.session, { [key]: current });
}
