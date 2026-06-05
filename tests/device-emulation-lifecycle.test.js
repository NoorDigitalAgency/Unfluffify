import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const emulationSource = readFileSync(new URL("../common/emulation.js", import.meta.url), "utf8");
const utilitiesSource = readFileSync(new URL("../common/utilities.js", import.meta.url), "utf8");
const popupMessagesSource = readFileSync(new URL("../popup/messages.js", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("top-level navigation preserves user-controlled device emulation", () => {
  const block = extractSourceBlock(
    backgroundSource,
    "async function disableExtensionOnTopLevelNavigation",
    "chrome.webNavigation.onBeforeNavigate"
  );

  assert.match(block, /const scriptKey = `\$\{SCRIPT_INJECTED_PREFIX\}\$\{tabId\}`;/);
  assert.match(block, /await utils\.storageRemove\(chrome\.storage\.session, \[scriptKey\]\);/);
  assert.match(block, /await chrome\.tabs\.sendMessage\(tabId, \{ type: "setEnabled", enabled: false \}\);/);
  assert.doesNotMatch(block, /await utils\.disableExtensionForTab\(tabId\);/);
  assert.doesNotMatch(block, /updateDeviceEmulation\(tabId,\s*\{\s*enabled:\s*false\s*\}\)/);
});

test("unregister-and-reload preserves user-controlled device emulation state", () => {
  const block = extractSourceBlock(
    backgroundSource,
    'if (message.type === "unregisterTabAndReload")',
    'if (message.type === "injectContentScript")'
  );

  assert.match(block, /await utils\.disableExtensionForTab\(tabId\);/);
  assert.doesNotMatch(block, /updateDeviceEmulation\(tabId,\s*\{\s*enabled:\s*false\s*\}\)/);
  assert.doesNotMatch(block, /DEVICE_EMULATION_PREFIX/);
});

test("extension activation enables default mobile emulation for fresh tab sessions", () => {
  const actionBlock = extractSourceBlock(
    backgroundSource,
    "chrome.action.onClicked.addListener",
    "chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>"
  );
  const activateHelperBlock = extractSourceBlock(
    backgroundSource,
    "async function activateExtensionForTab",
    "chrome.tabs.onUpdated.addListener"
  );
  const activateBlock = extractSourceBlock(
    backgroundSource,
    'if (!message || message.type !== "activateContentForTab")',
    "return true;"
  );
  const helperBlock = extractSourceBlock(
    backgroundSource,
    "async function ensureDefaultMobileEmulationForTab",
    "chrome.tabs.onUpdated.addListener"
  );

  assert.match(actionBlock, /chrome\.sidePanel\.open\(\{\s*tabId:\s*tab\.id\s*\}\)\.then\(\)/);
  assert.match(activateHelperBlock, /await utils\.setTabState\(tabId,\s*\{\s*active:\s*true\s*\},\s*"initial"\)/);
  assert.match(activateHelperBlock, /await ensureDefaultMobileEmulationForTab\(tabId,\s*tabUrl\)/);
  assert.match(activateHelperBlock, /requestContentActivation\(tabId\)/);
  assert.match(activateBlock, /await activateExtensionForTab\(/);
  assert.match(helperBlock, /utils\.getOriginFromUrl\(resolvedUrl\)/);
  assert.match(helperBlock, /ensureDefaultMobileDeviceEmulation\(tabId\)/);
});

test("popup delegates active tab context resolution to the background", () => {
  const backgroundResolveBlock = extractSourceBlock(
    backgroundSource,
    "async function resolvePopupTabContext(message = {}, sender = {}) {",
    "function getSpinnerQueueForTab"
  );
  const loadActiveTabBlock = popupMessagesSource.match(
    /export async function loadActiveTab\(\) \{([\s\S]*?)\n\}/
  )[0];

  assert.match(backgroundSource, /if \(message\.type === "resolvePopupTabContext"\) \{/);
  assert.match(backgroundSource, /async function resolvePopupSidePanelBoundTab\(sender = \{\}\) \{/);
  assert.match(backgroundSource, /chrome\.runtime\.getContexts/);
  assert.match(backgroundSource, /contextTypes: \["SIDE_PANEL"\]/);
  assert.match(backgroundSource, /documentUrls: \[chrome\.runtime\.getURL\("popup\.html"\)\]/);
  assert.match(backgroundSource, /const senderDocumentId = typeof sender\.documentId === "string" \? sender\.documentId : "";/);
  assert.match(backgroundSource, /context && context\.documentId === senderDocumentId/);
  assert.match(backgroundSource, /getExtensionContextWindowId\(context\) === senderWindowId/);
  assert.match(backgroundResolveBlock, /const debugTabId = normalizeBrokerTabId\(message\.debugTabId\);/);
  assert.match(backgroundResolveBlock, /const tab = await chrome\.tabs\.get\(debugTabId\);/);
  assert.match(backgroundResolveBlock, /const sidePanelBoundTab = await resolvePopupSidePanelBoundTab\(sender\);/);
  assert.match(backgroundResolveBlock, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/);
  assert.match(backgroundResolveBlock, /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}\)/);
  assert.match(loadActiveTabBlock, /type: "resolvePopupTabContext"/);
  assert.match(loadActiveTabBlock, /debugTabId: Number\.isFinite\(debugTabIdParam\)/);
  assert.match(loadActiveTabBlock, /state\.currentTab = response && response\.ok && response\.tab \? response\.tab : null;/);
  assert.doesNotMatch(loadActiveTabBlock, /utils\.tabsQuery|chrome\.tabs\.get|chrome\.runtime\.getContexts|getSidePanelBoundTab/);
  assert.doesNotMatch(popupMessagesSource, /async function getSidePanelBoundTab\(\)/);
});

test("shared tab state writes mirror enabled sessions into reload restore state", () => {
  const setTabStateBlock = extractSourceBlock(
    utilitiesSource,
    "export async function setTabState(tabId, state, scope = null) {",
    "export async function clearTabState"
  );

  assert.match(setTabStateBlock, /if \(scope\) \{\s*return;\s*\}/);
  assert.match(setTabStateBlock, /const restoreKey = `\$\{TAB_STATE_PREFIX\}restore:\$\{tabId\}`;/);
  assert.match(setTabStateBlock, /if \(nextState && nextState\.enabled && nextState\.baseUrl\) \{/);
  assert.match(setTabStateBlock, /await storageSet\(chrome\.storage\.session, \{/);
  assert.match(setTabStateBlock, /await storageRemove\(chrome\.storage\.session, \[restoreKey\]\);/);
});

test("completed reload restores marking when the page stays within the saved base URL", () => {
  const onUpdatedBlock = extractSourceBlock(
    backgroundSource,
    "chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {",
    "chrome.storage.onChanged.addListener"
  );

  assert.match(backgroundSource, /const TAB_RESTORE_SCOPE = "restore";/);
  assert.match(backgroundSource, /async function getReloadRestoreTabState\(tabId\) \{/);
  assert.match(backgroundSource, /async function setReloadRestoreTabState\(tabId, state\) \{/);
  assert.match(backgroundSource, /async function clearReloadRestoreTabStateAfterActivation\(tabId, tabState\) \{/);
  assert.match(onUpdatedBlock, /const tabState = \(await utils\.getTabState\(tabId\)\) \|\| \(await getReloadRestoreTabState\(tabId\)\);/);
  assert.match(onUpdatedBlock, /await utils\.setTabState\(tabId, tabState\);/);
  assert.match(onUpdatedBlock, /requestContentActivation\(tabId\);/);
  assert.match(onUpdatedBlock, /restoreEnabledStateForTab\(tabId, tabState\);/);
  assert.match(backgroundSource, /performInitialReveal: true/);
});

test("successful same-base restore activation clears restore intent after content acknowledgement", () => {
  const restoreBlock = extractSourceBlock(
    backgroundSource,
    "function restoreEnabledStateForTab",
    "async function getTabUrl"
  );
  const clearBlock = extractSourceBlock(
    backgroundSource,
    "async function clearReloadRestoreTabStateAfterActivation",
    "function requestContentActivation"
  );

  assert.match(restoreBlock, /if \(chrome\.runtime\.lastError \|\| !response \|\| response\.ok === false\) \{/);
  assert.match(restoreBlock, /clearReloadRestoreTabStateAfterActivation\(tabId, tabState\)\.catch\(\(\) => \{\}\);/);
  assert.match(clearBlock, /const restoreState = await getReloadRestoreTabState\(tabId\);/);
  assert.match(clearBlock, /restoreState\.baseUrl !== tabState\.baseUrl/);
  assert.match(clearBlock, /const tabUrl = await getTabUrl\(tabId\);/);
  assert.match(clearBlock, /!utils\.isPageWithinBaseUrl\(tabUrl, tabState\.baseUrl\)/);
  assert.match(clearBlock, /await clearReloadRestoreTabState\(tabId\);/);
});

test("completed navigation clears marking when the new page leaves the saved base URL", () => {
  const onUpdatedBlock = extractSourceBlock(
    backgroundSource,
    "chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {",
    "chrome.storage.onChanged.addListener"
  );

  assert.match(onUpdatedBlock, /!utils\.isPageWithinBaseUrl\(tab\.url \|\| "", tabState\.baseUrl\)/);
  assert.match(onUpdatedBlock, /await utils\.disableExtensionForTab\(tabId\);/);
});

test("popup refresh routes fresh active tabs through background activation before reading device state", () => {
  const refreshBlock = extractSourceBlock(
    popupSource,
    "let initialTabState = currentTabId",
    "const tabInScope = Boolean("
  );

  assert.match(
    refreshBlock,
    /messages\.sendRuntimeMessage\(\{\s*type:\s*"activateContentForTab",\s*tabId:\s*currentTabId,\s*url:\s*pageUrl\s*\}\)/
  );
  assert.match(
    refreshBlock,
    /if \(!activationResponse \|\| activationResponse\.ok === false\) \{\s*await utils\.setTabState\(currentTabId,\s*\{\s*active:\s*true\s*\},\s*"initial"\);\s*\}/
  );
});

test("default mobile helper preserves stored per-session choices", () => {
  const helperBlock = extractSourceBlock(
    emulationSource,
    "export async function ensureDefaultMobileDeviceEmulation",
    "export function normalizeDeviceEmulationStateForUi"
  );

  assert.match(helperBlock, /hasStoredDeviceEmulationState\(tabId\)/);
  assert.match(helperBlock, /reconcileDeviceEmulationState\(tabId\)/);
  assert.match(helperBlock, /enabled:\s*true/);
  assert.match(helperBlock, /mode:\s*"mobile"/);
  assert.match(helperBlock, /recalculateScale:\s*true/);
});

test("render mode cleanup preserves an active mobile simulation choice", () => {
  const cleanupBlock = extractSourceBlock(
    popupSource,
    "async function normalizeRenderModeDebuggerPage",
    "async function syncRenderModeDebuggerLifecycle"
  );

  assert.match(cleanupBlock, /const deviceState = await emulation\.getDeviceEmulationState\(tabId\);/);
  assert.match(cleanupBlock, /if \(deviceState && deviceState\.enabled\) \{/);
  assert.match(cleanupBlock, /await utils\.reloadPageWithJavaScriptControl\(tabId,\s*false\)/);
  assert.match(cleanupBlock, /const detachResult = await utils\.detachDebugger\(tabId\);/);
});

test("render mode lifecycle reuses shared page normalization on close and tab switch", () => {
  const lifecycleBlock = extractSourceBlock(
    popupSource,
    "async function syncRenderModeDebuggerLifecycle",
    "async function handleRenderModeInspectWithJavaScript"
  );

  assert.match(lifecycleBlock, /await normalizeRenderModeDebuggerPage\(managedTabId\);/);
});

test("disabled mobile emulation remains a per-session choice after navigation cleanup", () => {
  const cleanupBlock = extractSourceBlock(
    emulationSource,
    "export async function clearDeviceEmulationAfterNavigation",
    "\n  await detachDebugger(tabId);\n}"
  );

  assert.match(cleanupBlock, /Emulation\.clearDeviceMetricsOverride/);
  assert.doesNotMatch(cleanupBlock, /storageRemove/);
  assert.doesNotMatch(cleanupBlock, /DEVICE_EMULATION_PREFIX/);
});
