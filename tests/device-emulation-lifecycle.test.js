import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const emulationSource = readFileSync(new URL("../src/common/emulation.ts", import.meta.url), "utf8");
const utilitiesSource = readFileSync(new URL("../src/common/utilities.ts", import.meta.url), "utf8");
const popupChromeHelpersSource = readFileSync(new URL("../src/popup/chrome-helpers.ts", import.meta.url), "utf8");
const popupMessagesSource = readFileSync(new URL("../src/popup/messages.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

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
    "browser.webNavigation.onCommitted"
  );

  // onCommitted (not onBeforeNavigate) fires after the navigation actually
  // commits, so rejected beforeunload dialogs don't prematurely tear down
  // the marking session. The listener fully tears down marking tab state
  // via utils.disableExtensionForTab, which does NOT touch device emulation.
  assert.match(backgroundSource, /browser\.webNavigation\.onCommitted\.addListener\(disableExtensionOnTopLevelNavigation\)/);
  assert.doesNotMatch(backgroundSource, /browser\.webNavigation\.onBeforeNavigate\.addListener\(disableExtensionOnTopLevelNavigation\)/);
  assert.match(block, /await clearReloadRestoreTabState\(tabId\);/);
  assert.match(block, /await utils\.disableExtensionForTab\(tabId\);/);
  assert.doesNotMatch(block, /updateDeviceEmulation\(tabId,\s*\{\s*enabled:\s*false\s*\}\)/);
  assert.doesNotMatch(block, /DEVICE_EMULATION_PREFIX/);
});

test("top-level navigation normalizes render-mode JavaScript debugging state", () => {
  const normalizeBlock = extractSourceBlock(
    backgroundSource,
    "async function normalizeRenderModeJavaScriptOnTopLevelNavigation",
    "browser.webNavigation.onBeforeNavigate.addListener"
  );

  assert.match(backgroundSource, /browser\.webNavigation\.onBeforeNavigate\.addListener\(normalizeRenderModeJavaScriptOnTopLevelNavigation\)/);
  // Only act on tabs intentionally left in "Without JavaScript" render mode (tracked
  // in chrome.storage.session). The inspection's own reload also fires
  // onBeforeNavigate, but those tabs are not held yet, so JavaScript is never
  // re-enabled mid-inspection.
  assert.match(normalizeBlock, /if \(!\(await isRenderModeNoJsHeld\(details\.tabId\)\)\)/);
  assert.match(normalizeBlock, /clearRenderModeNoJsHeld\(details\.tabId\)/);
  assert.match(normalizeBlock, /brain\.recordRenderModeNoJsHold\(details\.tabId, \{[\s\S]*?held: false,[\s\S]*?javaScriptDisabled: false[\s\S]*?\}, "render-mode:top-level-navigation"\)/);
  assert.match(normalizeBlock, /utils\.setPageJavaScriptExecutionDisabled\(details\.tabId, false\)/);
  assert.match(normalizeBlock, /getDeviceEmulationState\(details\.tabId\)/);
  assert.match(normalizeBlock, /utils\.detachDebugger\(details\.tabId\)/);
  // The set guard replaces the old debugger-attachment probe so the handler never
  // fires for device-emulation-only tabs or for the inspection's own reload.
  assert.doesNotMatch(normalizeBlock, /chrome\.debugger\.getTargets\(\)/);
});

test("unregister-and-reload preserves user-controlled device emulation state", () => {
  const block = extractSourceBlock(
    backgroundSource,
    'if (message.type === "unregisterTabAndReload")',
    'if (message.type === "injectContentScript")'
  );

  assert.match(block, /await utils\.disableExtensionForTab\(tabId\);/);
  assert.match(block, /await clearTrackedTabSessionState\(tabId\);/);
  assert.doesNotMatch(block, /const tabKey = `\$\{TAB_STATE_PREFIX\}\$\{tabId\}`;/);
  assert.doesNotMatch(block, /const initialKey = `\$\{TAB_STATE_PREFIX\}initial:\$\{tabId\}`;/);
  assert.doesNotMatch(block, /const scriptKey = `\$\{SCRIPT_INJECTED_PREFIX\}\$\{tabId\}`;/);
  assert.doesNotMatch(block, /updateDeviceEmulation\(tabId,\s*\{\s*enabled:\s*false\s*\}\)/);
  assert.doesNotMatch(block, /DEVICE_EMULATION_PREFIX/);
});

test("background centralizes tracked tab-session cleanup with optional device-state removal", () => {
  const helperBlock = extractSourceBlock(
    backgroundSource,
    "async function clearTrackedTabSessionState",
    "async function clearReloadRestoreTabState"
  );
  const onRemovedBlock = extractSourceBlock(
    backgroundSource,
    "browser.tabs.onRemoved.addListener((tabId) => {",
    "async function disableExtensionOnTopLevelNavigation"
  );

  assert.match(helperBlock, /const \{ includeDeviceState = false \} = options;/);
  assert.match(helperBlock, /await clearStoredTrackedTabSessionState\(normalizedTabId, \{/);
  assert.match(helperBlock, /includeRestoreScope: true/);
  assert.match(helperBlock, /includeScriptInjected: true/);
  assert.match(helperBlock, /if \(includeDeviceState\) \{\s*await clearDeviceEmulationState\(normalizedTabId\);\s*\}/);
  assert.match(onRemovedBlock, /clearTrackedTabSessionState\(tabId, \{ includeDeviceState: true \}\)\.then\(\);/);
  assert.match(onRemovedBlock, /brain\.recordRenderModeNoJsHold\(tabId, \{[\s\S]*?held: false,[\s\S]*?javaScriptDisabled: false[\s\S]*?\}, "render-mode:tab-removed"\)/);
});

test("extension activation enables default mobile emulation for fresh tab sessions", () => {
  const actionBlock = extractSourceBlock(
    backgroundSource,
    "browser.action.onClicked.addListener",
    "// Sweep orphaned transfer-payload keys on every service-worker start."
  );
  const bootstrapBlock = extractSourceBlock(
    backgroundSource,
    "registerBackgroundCommand(BACKGROUND_COMMANDS.TAB_BOOTSTRAP_CONTENT, async (context) => {",
    "}, POPUP_TAB_COMMAND_POLICY);"
  );
  const helperBlock = extractSourceBlock(
    backgroundSource,
    "async function ensureDefaultMobileEmulationForTab",
    "browser.tabs.onUpdated.addListener"
  );

  assert.match(actionBlock, /openBrowserSidePanel\(\{\s*tabId:\s*tab\.id\s*\}\)\.then\(\)/);
  assert.match(bootstrapBlock, /await utils\.setTabState\(normalizedTabId,\s*\{\s*active:\s*true\s*\},\s*"initial"\)/);
  assert.match(bootstrapBlock, /await utils\.updateActionForTab\(normalizedTabId\)/);
  assert.match(bootstrapBlock, /await ensureDefaultMobileEmulationForTab\(normalizedTabId,\s*tabUrl\)/);
  assert.match(bootstrapBlock, /const result = await ensureContentMainForTab\(normalizedTabId\)/);
  assert.match(bootstrapBlock, /if \(!mobileState\) \{\s*requestContentActivation\(normalizedTabId\);/);
  assert.match(bootstrapBlock, /if \(!result \|\| !result\.ok\) \{\s*requestContentActivation\(normalizedTabId\);/);
  assert.doesNotMatch(backgroundSource, /message\.type !== "activateContentForTab"/);
  assert.match(helperBlock, /utils\.getOriginFromUrl\(resolvedUrl\)/);
  assert.match(helperBlock, /ensureDefaultMobileDeviceEmulation\(normalizedTabId\)/);
});

test("marking enable delegates mobile simulation prep to TAB_ACTIVATE_MARKING and keeps popup device toggle locked", () => {
  const enableBlock = extractSourceBlock(
    popupSource,
    "async function handleEnableToggle(",
    "async function handleDeviceEmulationEnabledToggle"
  );
  const uiBlock = extractSourceBlock(
    readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8"),
    "function renderMarkingView({state: view, actions: handlers}: PopupRenderProps)",
    "function renderConfigurationView"
  );
  void uiBlock;

  assert.match(enableBlock, /setSpinnerMessage\(spinnerKey, PopupText\.overlay\.pageInspection\);/);
  assert.match(enableBlock, /messages\.requestTabActivateMarking\(tab\.id, \{/);
  assert.match(enableBlock, /desktopPreviewEnabled: Boolean\(uiModule\.getViewState\(\)\.desktopPreviewEnabled\)/);
  assert.doesNotMatch(enableBlock, /ensureEditorMobileSimulation\(/);
  assert.doesNotMatch(enableBlock, /messages\.setTabState\(tab\.id, \{\s*enabled: true,/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_ACTIVATE_MARKING/);
  assert.match(backgroundSource, /ensureDefaultMobileEmulationForTab\(normalizedTabId, tabUrl\)/);
  assert.match(popupSource, /nextViewState\.deviceControlsDisabled = Boolean\(state\.deviceControlsDisabled \|\| isEnabled\);/);
});

test("desktop preview persists on initial tab state and clears itself on debugger detach", () => {
  const setTabStateBlock = extractSourceBlock(
    backgroundSource,
    'if (message.type === "setTabState") {',
    'if (message.type === "setDeviceEmulation") {'
  );
  const detachBlock = extractSourceBlock(
    backgroundSource,
    "browser.debugger.onDetach.addListener(async (source) => {",
    "async function refreshActionIconsForWindow"
  );

  assert.match(setTabStateBlock, /if \(Object\.prototype\.hasOwnProperty\.call\(message\.state, "desktopPreviewEnabled"\)\) \{/);
  assert.match(setTabStateBlock, /nextState\.desktopPreviewEnabled = isFeatureEnabled\("desktopPreview"\) &&\s*Boolean\(message\.state\.desktopPreviewEnabled\);/);
  assert.match(detachBlock, /const initialState = await utils\.getTabState\(source\.tabId, "initial"\);/);
  assert.match(detachBlock, /if \(initialState && initialState\.desktopPreviewEnabled\) \{/);
  assert.match(detachBlock, /desktopPreviewEnabled: false/);
  assert.match(detachBlock, /mode: "mobile"/);
  assert.match(detachBlock, /await setDeviceEmulationEnabled\(source\.tabId, false\);/);
  assert.doesNotMatch(detachBlock, /chrome\.storage\.session\.set/);
});

test("desktop preview section is rendered outside renderMarkingView so it is view-independent", () => {
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");

  // The section must be rendered at the top-level render call site, NOT inside
  // renderMarkingView, so it appears regardless of the current popup view.
  const markingViewStart = uiSource.indexOf("function renderMarkingView({state: view, actions: handlers}: PopupRenderProps)");
  const markingViewEnd = uiSource.indexOf("\nfunction ", markingViewStart + 1);
  const markingViewBody = uiSource.slice(markingViewStart, markingViewEnd);
  assert.doesNotMatch(markingViewBody, /desktop-preview-section/,
    "desktop preview must not be trapped inside renderMarkingView");
  assert.doesNotMatch(markingViewBody, /desktopPreviewVisible/,
    "desktop preview visibility check must not live inside renderMarkingView");

  // It must appear after the view-conditional block (i.e. after renderMarkingView call site).
  const viewConditionalIdx = uiSource.indexOf("view.currentView === View.Marking");
  const desktopPreviewIdx = uiSource.indexOf("desktop-preview-section");
  assert.ok(desktopPreviewIdx > viewConditionalIdx,
    "desktop-preview-section must render after the view-conditional block");
});

test("desktop preview section has a section-divider and uses the correct icon and row structure", () => {
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");
  const sectionStart = uiSource.indexOf("key: \"desktop-preview-section\"");
  assert.ok(sectionStart > -1);
  const sectionEnd = uiSource.indexOf(": null,", sectionStart);
  const sectionBody = uiSource.slice(sectionStart, sectionEnd);

  // Visual separation from surrounding sections
  assert.match(sectionBody, /section-divider/);
  // Correct icon for desktop preview
  assert.match(sectionBody, /monitor-eye/);
  // Keyboard shortcut tooltip is present (mobileSimulationHotkey was repurposed for the M key)
  assert.match(sectionBody, /mobileSimulationHotkey/);
});

test("desktop preview visibility is gated by silent mode", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /const desktopPreviewVisible = Boolean\(\s*desktopPreviewFeatureEnabled &&\s*silentModeActive &&[\s\S]*?hasStoredSelectors/
  );
});

test("content main registers central page activity listeners for inactivity subscribers", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const mainStart = source.indexOf("export function main()");
  const mainEnd = source.lastIndexOf("}");
  const mainBody = source.slice(mainStart, mainEnd);

  // Activity debounce timer and subscriber set are declared at module scope.
  assert.match(source, /let pageActivityTimer = 0;/);
  assert.match(source, /const pageActivitySubscribers = new Set(?:<[^>]+>)?\(\);/);
  assert.match(source, /function sendPageActivityObserved\(\) \{/);
  assert.match(source, /type: "pageActivityObserved"/);
  assert.match(source, /function publishPageActivity\(\) \{/);
  assert.match(mainBody, /subscribePageActivity\(sendPropertyLockActivity\);/);
  // General page inputs (not just marking actions) trigger the debounced central ping.
  assert.match(mainBody, /addEventListener\("mousemove", handlePageActivity/);
  assert.match(mainBody, /addEventListener\("keydown", handlePageActivity/);
  assert.match(mainBody, /addEventListener\("pointerdown", handlePageActivity/);
  assert.match(mainBody, /addEventListener\("scroll", handlePageActivity/);
  // Activity is debounced — not fired on every event.
  assert.match(mainBody, /pageActivityTimer = window\.setTimeout/);
  assert.match(mainBody, /publishPageActivity\(\);/);
  // Debounced pings only run when a content-side consumer (property-lock port)
  // is listening, so normal pages don't wake the service worker every 10s.
  assert.match(mainBody, /if \(pageActivityTimer \|\| !getPropertyLockPortClient\(\)\.hasPort\(\)\)/);
});

test("popup delegates active tab context resolution to the background", () => {
  const backgroundResolveBlock = extractSourceBlock(
    backgroundSource,
    "async function resolvePopupTabContext(",
    "const popupStateBroker = createPopupStateBroker"
  );
  const loadActiveTabBlock = popupMessagesSource.match(
    /export async function loadActiveTab\(\) \{([\s\S]*?)\n\}/
  )[0];

  assert.match(backgroundSource, /if \(message\.type === "resolvePopupTabContext"\) \{/);
  assert.match(backgroundSource, /async function resolvePopupSidePanelBoundTab\(sender(?:\s*:\s*[^=]+)? = \{\}\)(?:\s*:\s*[^{]+)? \{/);
  assert.match(backgroundSource, /browser\.runtime\.getContexts/);
  assert.match(backgroundSource, /contextTypes: \["SIDE_PANEL"\]/);
  assert.match(backgroundSource, /documentUrls: \[utils\.getExtensionResourceUrl\("popup\.html"\)\]/);
  assert.match(backgroundSource, /const senderDocumentId = typeof sender\.documentId === "string" \? sender\.documentId : "";/);
  assert.match(backgroundSource, /context && context\.documentId === senderDocumentId/);
  assert.match(backgroundSource, /getExtensionContextWindowId\(context\) === senderWindowId/);
  assert.match(backgroundResolveBlock, /const debugTabId = normalizeBrokerTabId\(message\.debugTabId\);/);
  assert.match(backgroundResolveBlock, /const tab = await getBrowserTab\(debugTabId\);/);
  assert.match(backgroundResolveBlock, /const sidePanelBoundTab = await resolvePopupSidePanelBoundTab\(sender\);/);
  assert.match(backgroundResolveBlock, /queryBrowserTabs\(\{ active: true, currentWindow: true \}\)/);
  assert.match(backgroundResolveBlock, /queryBrowserTabs\(\{ active: true, lastFocusedWindow: true \}\)/);
  assert.match(loadActiveTabBlock, /type: "resolvePopupTabContext"/);
  assert.match(loadActiveTabBlock, /debugTabId: Number\.isFinite\(debugTabIdParam\)/);
  assert.match(loadActiveTabBlock, /state(?:Any)?\.currentTab = response && response\.ok && response\.tab[\s\S]*?\? response\.tab[\s\S]*?: await loadActiveTabFallback\(debugTabIdParam\);/);
  assert.match(popupMessagesSource, /async function loadActiveTabFallback\(debugTabId(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(popupMessagesSource, /tabsApi\.get\(tabId/);
  assert.match(popupMessagesSource, /tabsApi\.query\(\{ active: true, currentWindow: true \}/);
  assert.match(popupMessagesSource, /tabsApi\.query\(\{ active: true, lastFocusedWindow: true \}/);
  assert.doesNotMatch(loadActiveTabBlock, /utils\.tabsQuery|chrome\.runtime\.getContexts|getSidePanelBoundTab/);
  assert.doesNotMatch(popupMessagesSource, /async function getSidePanelBoundTab\(\)/);
});

test("popup chrome helpers route privileged tab and browsing-data APIs through background", () => {
  assert.match(backgroundSource, /function clearBrowsingDataForOrigin\(origin(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{/);
  assert.match(backgroundSource, /callBrowserApiVoid\([\s\S]*?api\.browsingData\.remove/);
  assert.match(backgroundSource, /if \(message\.type === "clearBrowsingDataForOrigin"\) \{/);
  assert.match(backgroundSource, /function reloadTab\(tabId(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(backgroundSource, /reloadBrowserTab\(normalizedTabId\)/);
  assert.match(backgroundSource, /if \(message\.type === "reloadTab"\) \{/);

  assert.match(popupChromeHelpersSource, /utils\.sendRuntimeMessage\(message\)/);
  assert.match(popupChromeHelpersSource, /type: "clearBrowsingDataForOrigin"/);
  assert.match(popupChromeHelpersSource, /type: "reloadTab"/);
  assert.doesNotMatch(popupChromeHelpersSource, /chrome\.browsingData\.remove/);
  assert.doesNotMatch(popupChromeHelpersSource, /chrome\.tabs\.reload/);
});

test("setTabState no longer mirrors enabled sessions into reload restore state", () => {
  // Phase 2 retired auto-restore. setTabState now just writes the key and
  // returns; it does not populate or clear the restore scope.
  const backgroundSetTabStateBlock = extractSourceBlock(
    backgroundSource,
    'if (message.type === "setTabState") {',
    'if (message.type === "setDeviceEmulation") {'
  );
  const setTabStateBlock = extractSourceBlock(
    utilitiesSource,
    "export async function setTabState(tabId: number, state: Record<string, unknown> | null, scope: string | null = null) {",
    "export async function clearTabState"
  );

  assert.match(backgroundSetTabStateBlock, /queueTabSessionWrite\(tabId, async \(\) => \{/);
  assert.match(backgroundSetTabStateBlock, /const existingState = await getStoredTabState\(tabId, scope\);/);
  assert.match(backgroundSetTabStateBlock, /await setStoredTabState\(tabId, nextState, scope, \{ skipQueue: true \}\);/);
  assert.match(setTabStateBlock, /await setStoredTabState\(tabId, state, scope\);/);
  // No restore-scope write or clear
  assert.doesNotMatch(setTabStateBlock, /restoreKey/);
  assert.doesNotMatch(setTabStateBlock, /TAB_STATE_PREFIX.*restore/);
});

test("shared clearTabState removes initial tab lifecycle state as well as live tab state", () => {
  const clearTabStateBlock = extractSourceBlock(
    utilitiesSource,
    "export async function clearTabState(tabId: number) {",
    "// Action icon utilities"
  );
  const clearMessageBlock = extractSourceBlock(
    backgroundSource,
    'if (message.type === "clearTabState") {',
    'if (message.type === "unregisterTabAndReload") {'
  );
  const clearRestoreMessageBlock = extractSourceBlock(
    backgroundSource,
    'if (message.type === "clearReloadRestoreTabState") {',
    'if (message.type === "setTabState") {'
  );

  assert.match(clearTabStateBlock, /await clearTabSessionState\(tabId\);/);
  assert.match(clearMessageBlock, /utils\.clearTabState\(message\.tabId\)/);
  assert.match(clearMessageBlock, /clearReloadRestoreTabState\(message\.tabId\)/);
  assert.match(clearRestoreMessageBlock, /clearReloadRestoreTabState\(tabId\)/);
  assert.doesNotMatch(clearRestoreMessageBlock, /utils\.clearTabState/);
});

test("completed reload reactivates live enabled tabs without restore scope fallback", () => {
  const onUpdatedBlock = extractSourceBlock(
    backgroundSource,
    "browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {",
    "utils.addStorageChangeListener"
  );

  assert.match(backgroundSource, /const TAB_RESTORE_SCOPE = "restore";/);
  assert.doesNotMatch(backgroundSource, /async function getReloadRestoreTabState\(tabId\) \{/);
  // setReloadRestoreTabState was removed in Phase 2 slice 1 (auto-restore retired);
  // only the cleanup key path remains.
  assert.doesNotMatch(backgroundSource, /async function setReloadRestoreTabState\(tabId, state\) \{/);
  assert.match(backgroundSource, /async function clearReloadRestoreTabStateAfterActivation\(\s*tabId(?:\s*:\s*[^,]+)?,\s*tabState(?:\s*:\s*[^)]+)?\s*\)(?:\s*:\s*[^{]+)? \{/);
  // Restore scope is no longer consulted (auto-restore retired in Phase 2.1)
  assert.match(onUpdatedBlock, /const tabState = await utils\.getTabState\(tabId\);/);
  assert.doesNotMatch(onUpdatedBlock, /getReloadRestoreTabState/);
  // The redundant setTabState(tabId, tabState) was removed (navigation clears
  // live state, so tabState is null/disabled when onUpdated fires).
  assert.doesNotMatch(onUpdatedBlock, /await utils\.setTabState\(tabId, tabState\);/);
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

  assert.match(restoreBlock, /const normalizedResponse = response && typeof response === "object"/);
  assert.match(restoreBlock, /if \(!normalizedResponse \|\| normalizedResponse\.ok === false\) \{/);
  assert.match(restoreBlock, /runBackgroundTask\([\s\S]*?clearReloadRestoreTabStateAfterActivation\(normalizedTabId, tabState\)/);
  assert.doesNotMatch(clearBlock, /getReloadRestoreTabState|restoreState|await getTabUrl/);
  assert.match(clearBlock, /await clearReloadRestoreTabState\(normalizedTabId\);/);
  assert.match(backgroundSource, /await clearTabStateScope\(normalizedTabId, TAB_RESTORE_SCOPE\);/);
  assert.doesNotMatch(backgroundSource, /getReloadRestoreTabStateKey/);
});

test("completed navigation clears marking when the new page leaves the saved base URL", () => {
  const onUpdatedBlock = extractSourceBlock(
    backgroundSource,
    "browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {",
    "utils.addStorageChangeListener"
  );

  assert.match(onUpdatedBlock, /!utils\.isPageWithinBaseUrl\(tab\.url \|\| "", tabState\.baseUrl\)/);
  assert.match(onUpdatedBlock, /await utils\.disableExtensionForTab\(tabId\);/);
});

test("popup refresh routes fresh active tabs through tab bootstrap command before reading device state", () => {
  const refreshBlock = extractSourceBlock(
    popupSource,
    "let initialTabState = currentTabId",
    "const tabInScope = Boolean("
  );

  assert.match(
    refreshBlock,
    /messages\.requestTabBootstrapContent\(currentTabId\)/
  );
  assert.match(
    refreshBlock,
    /if \(!activationResponse \|\| activationResponse\.ok === false\) \{\s*await messages\.setTabState\(currentTabId,\s*\{\s*active:\s*true\s*\},\s*"initial"\);\s*\}/
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
  assert.match(emulationSource, /!current\.enabled && !isFeatureEnabled\("deviceEmulationToggle"\)/);
  assert.match(emulationSource, /current\.mode === "desktop" && !isFeatureEnabled\("desktopPreview"\)/);
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
  assert.match(lifecycleBlock, /if \(managedTabId === currentTabId\) \{[\s\S]*?await hideConsentForRenderModeInspection\(\);/);
  assert.match(lifecycleBlock, /if \(attachResult\.ok \|\| attachResult\.alreadyAttached\) \{[\s\S]*?await hideConsentForRenderModeInspection\(\);/);
});

test("disabled mobile emulation remains a per-session choice after navigation cleanup", () => {
  const cleanupBlock = extractSourceBlock(
    emulationSource,
    "export async function clearDeviceEmulationAfterNavigation",
    "\n  });\n}"
  );

  assert.match(cleanupBlock, /Emulation\.clearDeviceMetricsOverride/);
  assert.doesNotMatch(cleanupBlock, /storageRemove/);
  assert.doesNotMatch(cleanupBlock, /DEVICE_EMULATION_PREFIX/);
});

test("device emulation debugger operations serialize per tab", () => {
  const queueBlock = extractSourceBlock(
    emulationSource,
    "async function runDeviceEmulationOperation(tabId: number, operation: () => unknown) {",
    "function getDebuggerTargets()"
  );
  const updateBlock = extractSourceBlock(
    emulationSource,
    "export async function updateDeviceEmulation(tabId: number, updates: DeviceEmulationUpdate): Promise<DeviceEmulationResult> {",
    "export async function ensureDefaultMobileDeviceEmulation"
  );
  const cleanupBlock = extractSourceBlock(
    emulationSource,
    "export async function clearDeviceEmulationAfterNavigation(tabId: number) {",
    "\n  });\n}"
  );

  assert.match(emulationSource, /const deviceEmulationQueueByTabId = new Map\(\);/);
  assert.match(queueBlock, /const previous = deviceEmulationQueueByTabId\.get\(queueKey\) \|\| Promise\.resolve\(\);/);
  assert.match(queueBlock, /\.catch\(\(\) => \{\}\)\s*\.then\(operation\)/);
  assert.match(queueBlock, /deviceEmulationQueueByTabId\.set\(queueKey, next\);/);
  assert.match(queueBlock, /if \(deviceEmulationQueueByTabId\.get\(queueKey\) === next\) \{/);
  assert.match(queueBlock, /deviceEmulationQueueByTabId\.delete\(queueKey\);/);
  assert.match(emulationSource, /export async function setDeviceEmulationEnabled\(tabId(?:\s*:\s*[^,]+)?, enabled(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(emulationSource, /export async function clearDeviceEmulationState\(tabId(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(emulationSource, /runDeviceEmulationOperation\(tabId, async \(\) => \{/);
  assert.match(emulationSource, /runDeviceEmulationOperation\(tabId, \(\) => storageRemove\(getSessionStorageArea\(\), key\)\)/);
  assert.match(updateBlock, /return runDeviceEmulationOperation\(tabId, async \(\)(?:\s*:\s*[^=]+)? => \{/);
  assert.match(cleanupBlock, /return runDeviceEmulationOperation\(tabId, async \(\) => \{/);
});

test("debugger detach reapplies mobile emulation while marking stays enabled", () => {
  const detachBlock = extractSourceBlock(
    backgroundSource,
    "browser.debugger.onDetach.addListener(async (source) => {",
    "async function refreshActionIconsForWindow"
  );

  assert.match(detachBlock, /const tabState = await utils\.getTabState\(source\.tabId\);/);
  assert.match(detachBlock, /if \(tabState && tabState\.enabled\) \{/);
  assert.match(detachBlock, /runBackgroundTask\([\s\S]*?updateDeviceEmulation\(source\.tabId,\s*\{[\s\S]*?recalculateScale:\s*true[\s\S]*?\}\)/);
});
