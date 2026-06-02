import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const emulationSource = readFileSync(new URL("../common/emulation.js", import.meta.url), "utf8");
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

  assert.match(block, /await utils\.disableExtensionForTab\(tabId\);/);
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
