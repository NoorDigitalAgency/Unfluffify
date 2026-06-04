import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("popup scheduleRefresh uses the quiet refresh path", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function scheduleRefresh\(\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
});

test("quiet popup refresh skips redundant property lock fetches", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const refreshSource = source.match(
    /async function refreshPropertyLockSnapshot\(siteId, options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function sendPropertyLockCommand/
  )[1];

  assert.match(refreshSource, /const \{ skipFetch = false \} = options;/);
  assert.match(refreshSource, /if \(skipFetch && state\.propertyLockState\) \{\s*return state\.propertyLockState;\s*\}/);
  assert.match(refreshSource, /const lockResponse = await fetchPropertyLockState\(normalizedSiteId\);/);
});

test("explicit include and exclude removals use the quiet refresh path", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /async function handleExplicitExcludeRemove\(xpath\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /async function handleExplicitIncludeRemove\(xpath\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
});

test("Todo List completion is sourced from backend-saved markings only", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /const backendSavedPageMarkings = state\.currentBaseUrl[\s\S]*?config\.getBackendSavedPageMarkings\(state\.currentBaseUrl\)/
  );
  assert.match(
    source,
    /const coverageMarkedPageItems = backendSavedPageMarkingItems;/
  );
  assert.match(
    source,
    /const pageTypeCoverageModel = buildLynxChecklistViewModel\(\{[\s\S]*?markedPages: coverageMarkedPageItems[\s\S]*?\}\);/
  );
  assert.match(
    source,
    /const pageMarkingItemByKey = new Map\(\s*coverageMarkedPageItems\.map/
  );
  assert.doesNotMatch(source, /useLocalMarkedPagesForCoverage/);
});

test("preview and Send to Lynx actions are exposed from silent mode only", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");
  const previewBody = popupSource.match(
    /async function handlePreviewLatest\(\) \{([\s\S]*?)\n\}\n\nasync function handleExitPreviewMode/
  )[1];
  const saveExcludesBody = popupSource.match(
    /async function handleSaveExcludes\(\) \{([\s\S]*?)\n\}\n\nasync function handlePreviewLatest/
  )[1];

  assert.match(
    popupSource,
    /const silentModeActive =[\s\S]*?resolvedView === uiModule\.View\.Marking[\s\S]*?!isEnabled;/
  );
  assert.match(
    popupSource,
    /nextViewState\.saveExcludesButtonDisabled =[\s\S]*?!silentModeActive/
  );
  assert.match(
    popupSource,
    /nextViewState\.previewLatestButtonDisabled =[\s\S]*?!silentModeActive/
  );
  assert.match(
    popupSource,
    /nextViewState\.cssSelectorsVisible = silentModeActive;/
  );
  assert.match(previewBody, /if \(!uiModule\.getViewState\(\)\.silentModeActive\) \{\s*return;\s*\}/);
  assert.match(saveExcludesBody, /if \(!uiModule\.getViewState\(\)\.silentModeActive\) \{\s*return;\s*\}/);
  assert.match(
    uiSource,
    /if \(showDeviceSection\) \{[\s\S]*?device-emulation-enabled/
  );
  assert.match(
    uiSource,
    /const mergedControlsSection = mergedControlsSectionChildren\.length/
  );
  assert.doesNotMatch(uiSource, /title: PopupText\.tooltips\.pageSaveHotkey/);
  assert.doesNotMatch(uiSource, /lynx-checklist-ai|PopupText\.lynxChecklist\.aiQuestion/);
});

test("Preview Contents uses the latest stored selector set and stays disabled without stored selectors", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const previewBody = source.match(
    /async function handlePreviewLatest\(\) \{([\s\S]*?)\n\}\n\nasync function handleExitPreviewMode/
  )[1];

  assert.match(source, /const hasStoredSelectors = hasCalculatedSelectorsFromConfig\(\);/);
  assert.match(source, /nextViewState\.previewLatestButtonDisabled =[\s\S]*?!hasStoredSelectors/);
  assert.match(previewBody, /if \(!hasCalculatedSelectorsFromConfig\(state\.currentConfig\)\) \{[\s\S]*?PopupText\.preview\.noStoredSelectors/);
  assert.match(previewBody, /const selectorSet = getLatestAvailableSelectorsFromConfig\(\);/);
  assert.match(previewBody, /if \(!combineAiSelectorSet\(selectorSet\)\.length\) \{[\s\S]*?PopupText\.preview\.noStoredSelectors/);
  assert.doesNotMatch(previewBody, /getCurrentSelectorsFromConfig\(/);
});

test("Lynx checklist submission uses the current view's marked-page coverage without AI-answer gating", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");
  const sendBody = popupSource.match(
    /async function handleLynxChecklistSend\(\) \{([\s\S]*?)\n\}\n\nasync function handleSaveExcludes/
  )[1];

  assert.match(sendBody, /if \(!uiModule\.getViewState\(\)\.silentModeActive\) \{\s*return;\s*\}/);
  assert.match(sendBody, /markedPages: uiModule\.getViewState\(\)\.markedPages/);
  assert.doesNotMatch(sendBody, /aiAnswer:/);
  assert.doesNotMatch(uiSource, /lynx-checklist-popover__choices|lynx-checklist-popover__choice/);
  assert.doesNotMatch(uiSource, /onLynxChecklistAiAnswerChange/);
});

test("Todo List marks the current candidate's parent subsection", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

  assert.match(
    popupSource,
    /const groupCurrent =\s*currentPageMarkingAllowed &&\s*currentPageCandidateState\.pageTypeKey === pageType\.key;/
  );
  assert.match(
    popupSource,
    /current: groupCurrent,[\s\S]*?const isCurrent = groupCurrent && currentPageCandidateState\.url === candidate\.url;/
  );
  assert.match(
    uiSource,
    /group\.current && "todo-subsection--current"/
  );
  assert.match(
    uiSource,
    /group\.current[\s\S]*?todo-subsection-current-badge[\s\S]*?PopupText\.pageTypes\.currentBadge/
  );
});

test("periodic page-type refresh stays quiet unless candidates change", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const refreshBody = source.match(
    /function schedulePropertyPageTypesRefresh\(options = \{\}\) \{([\s\S]*?)\n\}\n\nfunction formatPageTypeCandidateLabel/
  )[1];

  assert.match(refreshBody, /force: true,[\s\S]*?notifyOnChange: false/);
  assert.doesNotMatch(refreshBody, /showToast\(PopupText\.pageTypes\.refreshFailed\)/);
  assert.match(refreshBody, /if \(!result \|\| !result\.changed\) \{[\s\S]*?return;/);
  assert.match(refreshBody, /propertyPageTypesChangeNoticeVisible = true/);
  assert.match(refreshBody, /propertyPageTypesInvalidAlertPending = true/);
  assert.match(refreshBody, /propertyPageTypesChangeForceTodoOpen = true/);
  assert.match(
    refreshBody,
    /refreshUi\(\{[\s\S]*?useBusyOverlay: false,[\s\S]*?skipPropertyLockFetch: true,[\s\S]*?propertyPageTypesRefreshChanged: true/
  );
});

test("changed page-type refresh alerts before rendering the warning notice", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const refreshBody = source.match(
    /async function refreshUiInner\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function maybeResumePersistedAiRun/
  )[1];

  assert.match(
    refreshBody,
    /if \(state\.propertyPageTypesInvalidAlertPending\) \{[\s\S]*?state\.propertyPageTypesInvalidAlertPending = false;[\s\S]*?if \(pageTypeUiBlocked\) \{[\s\S]*?window\.alert\(PopupText\.pageTypes\.currentPageInvalidAfterRefreshAlert\);[\s\S]*?\}/
  );
  assert.match(
    refreshBody,
    /nextViewState\.pageTypeNoticeText = state\.propertyPageTypesChangeNoticeVisible[\s\S]*?PopupText\.pageTypes\.changedNotice[\s\S]*?: pageTypeCandidateNoticeText;/
  );
  assert.ok(
    refreshBody.indexOf("window.alert(PopupText.pageTypes.currentPageInvalidAfterRefreshAlert)") <
      refreshBody.indexOf("uiModule.setViewState(nextViewState)")
  );
});

test("changed page-type refresh expands the Todo List root", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /propertyPageTypesRefreshChanged &&[\s\S]*?state\.propertyPageTypesChangeForceTodoOpen &&[\s\S]*?nextViewState\.todoListVisible[\s\S]*?nextViewState\.todoSectionExpanded = true;[\s\S]*?state\.propertyPageTypesChangeForceTodoOpen = false;/
  );
});

test("page-type refresh change copy is documented in shared text", () => {
  const textSource = readFileSync(new URL("../common/text.js", import.meta.url), "utf8");

  assert.match(textSource, /changedNotice: "Live Page candidates changed in Lynx\./);
  assert.match(textSource, /currentPageInvalidAfterRefreshAlert: "Live Page candidates changed in Lynx,[\s\S]*?Marking has been stopped/);
});

test("session save uploads all local page markings while default sync stays backend-scoped", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const handlePageSaveBody = source.match(
    /async function handlePageSave\(\) \{([\s\S]*?)\n\}\n\nasync function handlePageRevert/
  )[1];
  const handlePageRevertBody = source.match(
    /async function applyLocalPageDiscard\(\) \{([\s\S]*?)\n\}\n\nasync function handlePageRevert/
  )[1];

  assert.match(source, /includeCurrentPageMarking = false/);
  assert.match(source, /includeAllLocalPageMarkings = false/);
  assert.match(
    source,
    /const backendSavedPageMarkings = await config\.getBackendSavedPageMarkings\(resolvedBaseUrl\)/
  );
  assert.match(
    source,
    /includeAllLocalPageMarkings \|\|[\s\S]*?backendSavedPageUrls\.has\(url\) \|\|[\s\S]*?\(includeCurrentPageMarking && url === pageUrl\)/
  );
  assert.match(
    source,
    /markedPages: includeAllLocalPageMarkings[\s\S]*?\?[\s\S]*?localPageMarkingItems[\s\S]*?:[\s\S]*?backendSavedPageMarkingItems/
  );
  assert.match(
    handlePageSaveBody,
    /syncBaseConfigToServer\(\{[\s\S]*?includeAllLocalPageMarkings: true/
  );
  assert.match(handlePageSaveBody, /validateStoredToken\(\{ force: true \}\)/);
  assert.match(handlePageSaveBody, /PopupText\.status\.remoteServerRetryNotice/);
  assert.match(handlePageSaveBody, /maxAttempts: 1/);
  assert.match(handlePageSaveBody, /await clearCurrentPageSaveReconciliation\(\);/);
  assert.match(
    handlePageRevertBody,
    /const backendSavedPageMarkings = await config\.getBackendSavedPageMarkings\(baseUrl\)/
  );
  assert.match(
    handlePageRevertBody,
    /findBackendSavedPageMarkingEntry\(backendSavedPageMarkings, pageUrl\)/
  );
  assert.match(handlePageRevertBody, /forceReloadPageEntry: true/);
  assert.doesNotMatch(handlePageRevertBody, /loadRemoteConfigForCurrentPage/);
  assert.doesNotMatch(handlePageRevertBody, /validateStoredToken/);
  assert.match(handlePageRevertBody, /await clearCurrentPageSaveReconciliation\(\);/);
  assert.doesNotMatch(handlePageSaveBody, /type: "savePageDraft"/);
});

test("todo completion backend cache ignores local confirmed page markings unless explicitly enabled", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const mergeBody = source.match(
    /async function mergeServerConfigIntoLocal\(payload, currentPageUrl, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(mergeBody, /const applyConfirmedToBackendSaved = Boolean\(options && options\.applyConfirmedToBackendSaved\);/);
  assert.match(mergeBody, /const existingBackendSavedPageMarkings = await config\.getBackendSavedPageMarkings\(baseUrl\);/);
  assert.match(mergeBody, /let mergedBackendSavedPageMarkings = config\.mergePageMarkingsByTimestamp\([\s\S]*?incomingPageMarkings/);
  assert.match(mergeBody, /if \(applyConfirmedToBackendSaved\) \{[\s\S]*?confirmedPageMarkings/);
  assert.match(
    mergeBody,
    /if \([\s\S]*?Object\.keys\(incomingPageMarkings\)\.length > 0[\s\S]*?\|\|[\s\S]*?\(applyConfirmedToBackendSaved && Object\.keys\(confirmedPageMarkings\)\.length > 0\)[\s\S]*?\) \{[\s\S]*?config\.setBackendSavedPageMarkings\(baseUrl, mergedBackendSavedPageMarkings\);/
  );
});

test("popup blocks the interface with a spinner while page inspection is running", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

  assert.match(source, /const SILENT_HIGHLIGHTING_PREPARATION_REASON = "editor_preparing";/);
  assert.match(source, /let contentInspectionPending = Boolean\(/);
  assert.match(source, /let restoreInspectionPending = Boolean\(/);
  assert.match(
    source,
    /const pageInspectionBusy =[\s\S]*?contentInspectionPending[\s\S]*?restoreInspectionPending[\s\S]*?pageSaveReconciliationPending[\s\S]*?state\.currentPageSaveReconciliation\.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON/
  );
  assert.match(source, /nextViewState\.isBusy = popupBusyActive \|\| remoteConfigRetryBlocked \|\| pageInspectionBusy;/);
  assert.match(
    source,
    /nextViewState\.busyMessage = popupBusyActive[\s\S]*?PopupText\.overlay\.pageInspection/
  );
  // The blocking curtain DOM is reconciled by a module-scope helper, not an
  // IIFE buried inside a render call, so the popup never throws a reference
  // error while toggling the busy state.
  assert.match(uiSource, /^function syncBlockingUiCurtainDom\(\) \{/m);
  assert.match(uiSource, /document\.body\.classList\.toggle\("is-busy", curtain\.visible\)/);
  assert.match(uiSource, /function setUiBusy\([\s\S]*?try \{[\s\S]*?setViewState\(patch\);[\s\S]*?\} catch[\s\S]*?syncBlockingUiCurtainDom\(\);/);
  // A stale "Inspecting page..." curtain is cleared once the spinner queue
  // drains and the content side reports no pending inspection.
  assert.match(source, /function scheduleStaleInspectionBusyClear\(/);
  assert.match(source, /logPopupSpinnerDebug\("stale-inspection-busy-clear"/);
});

test("popup spinner queue pushSpinner returns key and handles delays correctly", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const pushBody = source.match(
    /function pushSpinner\(key, message, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  // suppressIfActive path returns null when queue is active
  assert.match(pushBody, /suppressIfActive[\s\S]*?return null;/);
  // delay path sets timer and returns effectiveKey
  assert.match(pushBody, /if \(delayMs > 0\) \{[\s\S]*?popupSpinnerTimer[\s\S]*?return effectiveKey;/);
  // immediate show path sets popupSpinnerVisible and calls setUiBusy
  assert.match(pushBody, /popupSpinnerVisible = true;[\s\S]*?uiModule\.setUiBusy\(true/);
  // upsert path updates in-place without re-checking suppressIfActive
  assert.match(pushBody, /const isUpdate = popupSpinnerQueue\.has\(effectiveKey\)/);
});

test("popup spinner pop can clean up orphaned entries for inactive tabs", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const popBody = source.match(
    /function popSpinner\(key\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(source, /const popupSpinnerKeyTabIds = new Map\(\);/);
  assert.match(popBody, /const mappedTabId = popupSpinnerKeyTabIds\.get\(key\);/);
  assert.match(popBody, /if \(!popupSpinnerQueue\.has\(key\)\) \{[\s\S]*?removeSpinnerEntryFromStorage\(mappedTabId, key\)/);
});

test("popup serializes spinner storage operations per tab", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const persistBody = source.match(
    /async function persistSpinnerQueueToStorage\(tabId, stored = buildSpinnerQueueStorageRecord\(popupSpinnerQueue\)\) \{([\s\S]*?)\n\}/
  )[1];
  const clearBody = source.match(
    /async function clearSpinnerQueueStorage\(tabId\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(source, /const popupSpinnerStorageQueueByTabId = new Map\(\);/);
  assert.match(source, /function enqueueSpinnerStorageUpdate\(tabId, operation\) \{/);
  assert.match(persistBody, /await enqueueSpinnerStorageUpdate\(tabId, \(\) =>/);
  assert.match(clearBody, /await enqueueSpinnerStorageUpdate\(tabId, \(\) =>/);
});

test("tab reload keeps the inspection curtain active while enabled pages re-inspect", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(source, /async function waitForEnableMarkingInspectionToSettle\(tabId, baseUrl\) \{/);
  assert.match(source, /type: "getInspectionStatus"/);
  assert.match(source, /type: "getPageDraftStatus",\s*\n\s*baseUrl/);
  assert.match(source, /let responseObserved = false;/);
  assert.match(source, /responseObserved = true;/);
  assert.match(source, /\(responseObserved && attempt >= 2\) \|\| attempt >= 6/);
  assert.match(source, /const navigationInspectionPending = Boolean\(/);
  assert.match(source, /popupNavigationInspectionOverlayStarted/);
  assert.match(source, /popupNavigationInspectionOverlayTabId === currentTabId/);
  assert.match(source, /let contentInspectionPending = Boolean\(/);
  assert.match(source, /let restoreInspectionPending = Boolean\(/);
  assert.match(source, /function beginNavigationInspectionOverlay\(tabId\) \{/);
  assert.match(source, /function endNavigationInspectionOverlay\(tabId = popupNavigationInspectionOverlayTabId\) \{/);
  assert.match(source, /function scheduleNavigationInspectionSettlePoll\(tabId, baseUrl\) \{/);
  assert.match(source, /const popupNavigationInspectionSettlePollByTabId = new Map\(\);/);

  const onUpdatedBlock = source.match(
    /chrome\.tabs\.onUpdated\.addListener\(async \(tabId, changeInfo, tab\) => \{([\s\S]*?)\n  \}\);\n  window\.addEventListener/
  )[1];

  assert.match(onUpdatedBlock, /changeInfo\.status === "loading"/);
  assert.match(onUpdatedBlock, /await utils\.getTabState\(tabId, "restore"\)/);
  assert.match(onUpdatedBlock, /beginNavigationInspectionOverlay\(tabId\);/);
  assert.match(onUpdatedBlock, /await refreshUi\(\{ useBusyOverlay: false \}\);/);
  assert.match(onUpdatedBlock, /const settleResult = await waitForEnableMarkingInspectionToSettle\(tabId, tabState\.baseUrl\);/);
  assert.match(onUpdatedBlock, /if \(settleResult\.responseObserved \|\| settleResult\.inspectionObserved\) \{/);
  assert.match(onUpdatedBlock, /endNavigationInspectionOverlay\(tabId\);\s*await refreshUi\(\{ useBusyOverlay: false \}\);/);
  assert.match(onUpdatedBlock, /scheduleNavigationInspectionSettlePoll\(tabId, tabState\.baseUrl\);/);
  assert.doesNotMatch(onUpdatedBlock, /finally \{[\s\S]*?endNavigationInspectionOverlay\(tabId\);/);

  const refreshBody = source.match(
    /async function refreshUiInner\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function maybeResumePersistedAiRun/
  )[1];
  assert.match(refreshBody, /const persistedTabState = await utils\.getTabState\(state\.currentTab\.id\);/);
  assert.match(refreshBody, /await utils\.getTabState\(state\.currentTab\.id, "restore"\)/);
  assert.match(refreshBody, /await messages\.sendTabMessageToTab\(currentTabId, \{ type: "getInspectionStatus" \}\)/);
  assert.match(refreshBody, /restoreInspectionPending \|\|\s*contentInspectionPending/);
  // After a tab reload, the latest runtime status response is authoritative:
  // once it arrives the popup stops treating restore inspection as pending and
  // adopts the fresh inspection status instead of the stale optimistic value.
  assert.match(refreshBody, /let latestRuntimeStatus = null;/);
  assert.match(refreshBody, /const runtimeStatusBaseUrl = state\.currentBaseUrl \|\| effectiveTabState\.baseUrl \|\|/);
  assert.match(refreshBody, /if \(latestRuntimeResponseObserved\) \{\s*restoreInspectionPending = false;/);
  assert.match(refreshBody, /inspectionStatus = latestRuntimeStatus\.inspectionStatus;/);
  assert.match(refreshBody, /!navigationInspectionPending &&\s*\(!siteIdReady \|\| !renderModeReady \|\| pageTypeUiBlocked\)/);
  assert.match(refreshBody, /nextViewState\.mainUiHidden =[\s\S]*?!isEnabled[\s\S]*?\(!navigationInspectionPending && \(!siteIdReady \|\| !renderModeReady\)\)/);
});

test("tab activation does not end persisted inspection overlay before old-tab spinner state is cleared", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const onActivatedBlock = source.match(
    /chrome\.tabs\.onActivated\.addListener\(async \(\{ tabId \}\) => \{([\s\S]*?)\n  \}\);\n\n  chrome\.tabs\.onUpdated/
  )[1];

  assert.doesNotMatch(onActivatedBlock, /endNavigationInspectionOverlay\(/);
  assert.match(onActivatedBlock, /clearSpinnerQueueStorage\(oldTabId\)\.catch\(\(\) => \{\}\);/);
  assert.match(onActivatedBlock, /popupNavigationInspectionOverlayStarted = false;/);
  assert.match(onActivatedBlock, /popupNavigationInspectionOverlayTabId = null;/);
});

test("session pending is no longer tied to Lynx selector submission state", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const pendingBody = source.match(
    /function hasSessionPendingChanges\(sourceConfig, localPageMarkings, backendSavedPageMarkings, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(pendingBody, /options\.currentDraftDirty/);
  assert.match(pendingBody, /options\.reconciliationPending/);
  assert.match(pendingBody, /hasSessionPageMarkingChanges\(localPageMarkings, backendSavedPageMarkings\)/);
  assert.doesNotMatch(pendingBody, /areCurrentSelectorsSubmitted|submittedSelectorsFingerprint/);
});

test("observer remote config polling stays passive-only and runs once a minute", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(source, /const OBSERVER_REMOTE_CONFIG_REFRESH_INTERVAL_MS = 60 \* 1000;/);
  assert.match(
    source,
    /function syncObserverRemoteConfigRefreshTimer\(active\) \{[\s\S]*?window\.setInterval\(\(\) => \{[\s\S]*?refreshUi\(\{[\s\S]*?useBusyOverlay: false,[\s\S]*?remoteConfigLoadMode: "observer_poll"[\s\S]*?\}/
  );
  assert.match(
    source,
    /syncObserverRemoteConfigRefreshTimer\([\s\S]*?!state\.propertyLockState\.isEditor/
  );
});

test("marking enable does not send a redundant force refresh after setEnabled", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}\n\nasync function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /type: "setEnabled"[\s\S]*enabled: true/);
  assert.doesNotMatch(enableBody, /type: "forceRefresh"/);
});

test("marking enable upgrades the popup spinner to page inspection during reveal warmup", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const runWithSpinnerBody = source.match(
    /async function runWithSpinner\(key, message, task, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}\n\nasync function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(runWithSpinnerBody, /return await task\(pushed\);/);
  assert.match(
    enableBody,
    /setSpinnerMessage\(spinnerKey, PopupText\.overlay\.pageInspection\);[\s\S]*?const enableResponse = await messages\.sendTabMessageWithRetry\(\{[\s\S]*?type: "setEnabled"[\s\S]*?enabled: true/
  );
  assert.match(enableBody, /performInitialReveal: true/);
  assert.match(enableBody, /await waitForEnableMarkingInspectionToSettle\(tab\.id, effectiveBaseUrl\);/);
});

test("disabling marking with a pending session prompts to discard before exiting", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}\n\nasync function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /if \(!desiredEnabled\) \{[\s\S]*?await refreshCurrentPageRuntimeStatus\(\{[\s\S]*?tabId: tab\.id,[\s\S]*?baseUrl: state\.currentBaseUrl[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?latestViewState = uiModule\.getViewState\(\);/);
  assert.match(enableBody, /if \(!desiredEnabled && latestViewState\.sessionHasPendingChanges\)/);
  assert.match(enableBody, /PopupText\.page\.exitRequiresAiResolution/);
  assert.match(enableBody, /PopupText\.page\.exitRequiresResolution/);
  // A toast is shown, then a confirm dialog gates discard+disable.
  assert.match(enableBody, /const confirmedDiscard = window\.confirm\(PopupText\.page\.disableDiscardConfirm\);/);
  // Cancel keeps the session and stays in marking mode.
  assert.match(enableBody, /if \(!confirmedDiscard\) \{[\s\S]*?uiModule\.setViewState\(\{ toggleEnabled: true \}\)[\s\S]*?setLastPopupEnabled\(true, buildPopupEnabledContext\(tab, state\.currentBaseUrl\)\)[\s\S]*?return;/);
  // OK discards locally, then falls through to disable.
  assert.match(enableBody, /await applyLocalPageDiscard\(\);/);
});

test("popup scopes optimistic enabled state to the current tab page and base URL", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(source, /lastPopupEnabledContext/);
  assert.match(source, /function buildPopupEnabledContext\(tab = state\.currentTab, baseUrl = state\.currentBaseUrl\) \{/);
  assert.match(source, /function isPopupEnabledContextCurrent\(context, currentContext = buildPopupEnabledContext\(\)\) \{/);
  assert.match(source, /function clearLastPopupEnabled\(\) \{/);
  assert.match(source, /if \(tabChanged\) \{[\s\S]*?clearLastPopupEnabled\(\);/);
  assert.match(source, /if \(pageUrl !== state\.lastPopupPageUrl\) \{[\s\S]*?clearLastPopupEnabled\(\);/);
  assert.match(source, /if \(!isPopupEnabledContextCurrent\(state\.lastPopupEnabledContext, popupEnabledContext\)\) \{[\s\S]*?clearLastPopupEnabled\(\);/);
});

test("run ai refreshes page runtime status before honoring reconciliation gates", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const computeBody = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nfunction getStoredPageHtmlSnapshot/
  )[1];

  assert.match(computeBody, /await refreshCurrentPageRuntimeStatus\(\);[\s\S]*?if \(state\.currentPageSaveReconciliationPending\) \{/);
});

test("content-side save hotkey workflow is removed from the marking session", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const keydownBody = source.match(
    /document\.addEventListener\("keydown", \(event\) => \{([\s\S]*?)\n\s*\}, true\);/
  )[1];

  assert.match(keydownBody, /if \(key !== "e" && key !== "m"\) \{/);
  assert.doesNotMatch(keydownBody, /key === "s"|isPageSaveHotkeyAllowedOnPage|saveCurrentPageDraft/);
});

test("content saved baseline is refreshed from backend cache, not local drafts", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /export async function refreshSavedPageEntryFromBackendCache[\s\S]*?config\.getBackendSavedPageMarkings\(baseUrl\)/
  );
  assert.match(
    contentSource,
    /if \(message\.type === "getPageDraftStatus"\) \{[\s\S]*?refreshSavedPageEntryFromBackendCache\(targetBaseUrl, pageUrl\)/
  );
  assert.match(
    contentSource,
    /if \(message\.type === "getPageDraftStatus"\) \{[\s\S]*?reconciliationPending: core\.isPageSaveReconciliationPending\(pageUrl\)/
  );
  assert.match(
    contentSource,
    /if \(message\.type === "clearPageSaveReconciliation"\) \{[\s\S]*?config\.getBackendSavedPageMarkings\(targetBaseUrl\)/
  );
  assert.doesNotMatch(contentSource, /confirmed local snapshot|immediate post-save remote reload omits/);
});

test("forced config reload replaces the current page entry without re-syncing live DOM", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const configUpdatedSource = source.match(
    /if \(message\.type === "configUpdated"\) \{([\s\S]*?)\n\s*\}\n\n\s*if \(message\.type === "forceRefresh"\)/
  )[1];

  assert.match(
    configUpdatedSource,
    /if \(!forceReloadPageEntry\) \{[\s\S]*?core\.mergeDraftEntry\(loadedConfig, pageUrl, draftEntry, savedEntry\);/
  );
  assert.match(
    configUpdatedSource,
    /const reloadedEntry = backendEntry \|\| loadedEntry \|\| null;[\s\S]*?core\.setSavedPageEntry\(pageUrl, reloadedEntry\);/
  );
  assert.doesNotMatch(
    configUpdatedSource,
    /forceReloadPageEntry[\s\S]*?syncPageMarkings\(loadedConfig, pageUrl/
  );
});
