import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("popup scheduleRefresh uses the quiet refresh path", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function scheduleRefresh\(\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
});

test("quiet popup refresh skips redundant property lock fetches", () => {
  const source = readFileSync(new URL("../src/popup/property-lock-ui.ts", import.meta.url), "utf8");
  const refreshSource = source.match(
    /export async function refreshPropertyLockSnapshot\(deps(?:\s*:\s*[^,]+)?, siteId(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^=]+)? = \{\}\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*export async function sendPropertyLockCommand/
  )[1];

  assert.match(refreshSource, /const \{ skipFetch = false \} = options;/);
  assert.match(refreshSource, /if \(skipFetch && state\.propertyLockState\) \{\s*return state\.propertyLockState;\s*\}/);
  assert.match(refreshSource, /const lockResponse = await deps\.fetchPropertyLockState\(normalizedSiteId\)(?: as [^;]+)?;/);
});

test("explicit include and exclude removals use the quiet refresh path", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

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
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

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

test("silent Preview Contents and Send to Lynx actions are exposed from silent mode only", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");
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
    /const mergedControlsSection = mergedControlsSectionChildren\.length/
  );
  assert.doesNotMatch(uiSource, /title: PopupText\.tooltips\.pageSaveHotkey/);
  assert.doesNotMatch(uiSource, /lynx-checklist-ai|PopupText\.lynxChecklist\.aiQuestion/);
});

test("same-property non-candidate pages keep silent mode and property-lock scope while marking stays blocked", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(
    popupSource,
    /const propertyLockScopeSiteId = isPropertyLockCollaborationEnabled\(\)\s*\?[\s\S]*?state\.propertyLockRecoveryDeadlineAt > Date\.now\(\) && state\.propertyLockRecoverySiteId[\s\S]*?state\.propertyLockRecoverySiteId\s*:\s*liveSiteId[\s\S]*?: null;/
  );
  assert.match(popupSource, /if \(propertyLockScopeSiteId && state\.currentBaseUrl && tokenValue\) \{/);
  assert.match(popupSource, /const pageScopedUiDisabled =[\s\S]*?remoteConfigRetryBlocked[\s\S]*?isPropertyLockBlockingEditing\(\)/);
  assert.doesNotMatch(
    popupSource,
    /const pageScopedUiDisabled =[\s\S]*pageTypeUiBlocked && !navigationInspectionPending/
  );
  assert.match(popupSource, /const silentModeActive =[\s\S]*?resolvedView === uiModule\.View\.Marking[\s\S]*?!isEnabled;/);
  assert.match(
    popupSource,
    /if \(\s*tabInScope &&\s*toggleEnabled &&\s*!aiComputeRunActive &&\s*!aiPreviewSessionActive &&\s*!previewRestorePending &&\s*!navigationInspectionPending &&\s*\(!siteIdReady \|\| !renderModeReady \|\| pageTypeUiBlocked\)/
  );
});

test("popup mirrors the off-candidate editor countdown from initial tab state", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const propertyLockUiSource = readFileSync(new URL("../src/popup/property-lock-ui.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

  assert.match(propertyLockUiSource, /export function syncPropertyLockOffCandidateRefreshTimer\(deps(?:\s*:\s*[^,]+)?, active(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(propertyLockUiSource, /state\.propertyLockOffCandidateRefreshTimer = deps\.windowRef\.setInterval\(\(\) => \{/);
  assert.match(popupSource, /state\.propertyLockOffCandidateDeadlineAt =\s*initialTabState && Number\.isFinite\(initialTabState\.propertyLockOffCandidateDeadlineAt\)/);
  assert.match(
    popupSource,
    /syncPropertyLockOffCandidateRefreshTimer\(\s*Boolean\([\s\S]*state\.propertyLockOffCandidateDeadlineAt[\s\S]*state\.propertyLockRecoveryDeadlineAt[\s\S]*\)\s*\);/
  );
  assert.match(propertyLockUiSource, /if \(offCandidateSecondsRemaining > 0\) \{/);
  assert.match(propertyLockUiSource, /deps\.propertyLockText\.popupOffCandidateWarning\(offCandidateSecondsRemaining\)/);
  assert.match(backgroundSource, /nextState\.propertyLockOffCandidateDeadlineAt = Number\.isFinite\(message\.state\.propertyLockOffCandidateDeadlineAt\)/);
});

test("popup mirrors the cross-property editor cooldown from initial tab state and recovery scope", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const propertyLockUiSource = readFileSync(new URL("../src/popup/property-lock-ui.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

  assert.match(popupSource, /const persistedRecoveryState = \{\s*siteId: state\.propertyLockRecoverySiteId,\s*baseUrl: state\.propertyLockRecoveryBaseUrl,\s*clientId: state\.propertyLockRecoveryClientId,\s*deadlineAt: state\.propertyLockRecoveryDeadlineAt\s*\};/);
  assert.match(popupSource, /const recoverySiteId = normalizeSiteIdValue\(\s*state\.propertyLockRecoverySiteId \|\| persistedRecoveryState\.siteId\s*\);/);
  assert.match(popupSource, /const recoveryBaseUrl =\s*state\.propertyLockRecoveryBaseUrl \|\| persistedRecoveryState\.baseUrl \|\| "";/);
  assert.match(popupSource, /const recoveryClientId =\s*state\.propertyLockRecoveryClientId \|\| persistedRecoveryState\.clientId \|\| "";/);
  assert.match(popupSource, /const hasPersistedRecoverySession = Boolean\(\s*recoverySiteId &&\s*recoveryBaseUrl &&\s*recoveryClientId\s*\);/);
  assert.match(popupSource, /const isOutsideRecoveryBaseUrl = Boolean\(\s*hasPersistedRecoverySession &&\s*pageUrl &&\s*!utils\.isPageWithinBaseUrl\(pageUrl, recoveryBaseUrl\)\s*\);/);
  assert.match(popupSource, /state\.propertyLockRecoverySiteId =\s*initialTabState && Number\.isFinite\(initialTabState\.propertyLockRecoverySiteId\)/);
  assert.match(popupSource, /state\.propertyLockRecoveryClientId =\s*initialTabState && typeof initialTabState\.propertyLockRecoveryClientId === "string"/);
  assert.match(popupSource, /state\.propertyLockRecoveryDeadlineAt =\s*initialTabState && Number\.isFinite\(initialTabState\.propertyLockRecoveryDeadlineAt\)/);
  assert.match(popupSource, /const propertyLockScopeSiteId = isPropertyLockCollaborationEnabled\(\)\s*\?[\s\S]*?state\.propertyLockRecoveryDeadlineAt > Date\.now\(\) && state\.propertyLockRecoverySiteId[\s\S]*?state\.propertyLockRecoverySiteId\s*:\s*liveSiteId[\s\S]*?: null;/);
  assert.match(propertyLockUiSource, /state\.propertyLockRecoverySiteId === normalizedSiteId\s*\?\s*state\.propertyLockRecoveryClientId/);
  assert.match(popupSource, /if \(hasPersistedRecoverySession && isOutsideRecoveryBaseUrl\) \{\s*const nextRecoveryDeadlineAt = recoveryDeadlineAt > Date\.now\(\)\s*\?\s*recoveryDeadlineAt\s*:\s*Date\.now\(\) \+ PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS;/);
  assert.match(propertyLockUiSource, /if \(crossPropertySecondsRemaining > 0\) \{/);
  assert.match(propertyLockUiSource, /deps\.propertyLockText\.popupCrossPropertyWarning\(crossPropertySecondsRemaining\)/);
  assert.match(backgroundSource, /nextState\.propertyLockRecoverySiteId = Number\.isFinite\(message\.state\.propertyLockRecoverySiteId\)/);
  assert.match(backgroundSource, /nextState\.propertyLockRecoveryClientId = typeof message\.state\.propertyLockRecoveryClientId === "string"/);
  assert.match(backgroundSource, /nextState\.propertyLockRecoveryDeadlineAt = Number\.isFinite\(message\.state\.propertyLockRecoveryDeadlineAt\)/);
});

test("desktop preview is a separate popup section that disables marking entry while active", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");
  const desktopToggleStart = popupSource.indexOf("async function handleDesktopPreviewEnabledToggle(event) {");
  const desktopToggleEnd = popupSource.indexOf("function handleDeviceScaleInput", desktopToggleStart);
  assert.ok(desktopToggleStart >= 0 && desktopToggleEnd > desktopToggleStart);
  const desktopToggleBody = popupSource.slice(desktopToggleStart, desktopToggleEnd);

  assert.match(popupSource, /state\.currentDesktopPreviewEnabled = Boolean\(\s*desktopPreviewFeatureEnabled && initialTabState && initialTabState\.desktopPreviewEnabled\s*\);/);
  assert.match(
    popupSource,
    /const desktopPreviewVisible = Boolean\(\s*desktopPreviewFeatureEnabled &&\s*silentModeActive &&/
  );
  assert.match(popupSource, /const desktopPreviewActive = Boolean\(\s*desktopPreviewVisible && state\.currentDesktopPreviewEnabled\s*\);/);
  assert.match(popupSource, /nextViewState\.desktopPreviewVisible = desktopPreviewVisible;/);
  assert.match(popupSource, /nextViewState\.desktopPreviewEnabled = desktopPreviewActive;/);
  assert.match(popupSource, /nextViewState\.toggleEnabledDisabled =[\s\S]*desktopPreviewActive;/);
  // Non-candidate pages (pageTypeUiBlocked) must disable the marking toggle so
  // marking cannot be enabled where it is not allowed.
  assert.match(
    popupSource,
    /nextViewState\.toggleEnabledDisabled =[\s\S]*?\(!navigationInspectionPending && \(!siteIdReady \|\| !renderModeReady \|\| pageTypeUiBlocked\)\)[\s\S]*?desktopPreviewActive;/
  );
  assert.match(desktopToggleBody, /if \(!isFeatureEnabled\("desktopPreview"\)\) \{\s*return;\s*\}/);
  assert.match(desktopToggleBody, /if \(desiredEnabled && uiModule\.getViewState\(\)\.toggleEnabled\) \{/);
  assert.match(desktopToggleBody, /await handleEnableToggle\(\{ currentTarget: \{ checked: false \} \}\);/);
  assert.match(desktopToggleBody, /const targetMode = desiredEnabled \? "desktop" : "mobile";/);
  assert.match(desktopToggleBody, /await persistDesktopPreviewEnabled\(tab\.id, desiredEnabled\);/);
  assert.match(uiSource, /isPopupFeatureEnabled\(view, "desktopPreview"\) && view\.desktopPreviewVisible/);
  assert.match(uiSource, /id: "desktop-preview-enabled"/);
  assert.match(uiSource, /PopupText\.device\.desktopPreviewLabel/);
  assert.match(uiSource, /view\.desktopPreviewNoticeVisible/);
});

test("marking-mode Preview Contents stays separate from silent Preview and Send to Lynx", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");
  const markingPreviewBody = popupSource.match(
    /async function handleMarkingPreview\(\) \{([\s\S]*?)\n\}\n\nasync function handleExitPreviewMode/
  )[1];

  assert.match(popupSource, /nextViewState\.markingPreviewVisible = pageControlsVisible && Boolean\(isEnabled\);/);
  assert.match(
    popupSource,
    /nextViewState\.markingPreviewDisabled =\s*aiBusy \|\|\s*previewRestorePending \|\|\s*pageSaveReconciliationPending \|\|\s*!aiRunUpToDate \|\|\s*sessionRequiresAiRun;/
  );
  assert.match(uiSource, /if \(markingMode && view\.markingPreviewVisible\) \{/);
  assert.match(uiSource, /id: "marking-preview"/);
  assert.match(uiSource, /onClick: handlers\.onMarkingPreview/);
  assert.match(markingPreviewBody, /const view = uiModule\.getViewState\(\);/);
  assert.match(markingPreviewBody, /if \(!view\.markingPreviewVisible \|\| view\.markingPreviewDisabled\) \{/);
  assert.match(markingPreviewBody, /await refreshCurrentPageRuntimeStatus\(\);/);
  assert.match(markingPreviewBody, /const selectorSet = getLatestAvailableSelectorsFromConfig\(\);/);
  assert.match(markingPreviewBody, /messages\.requestTabShowAiPreview\(tabId, \{/);
  assert.doesNotMatch(markingPreviewBody, /silentModeActive/);
  assert.doesNotMatch(markingPreviewBody, /openLynxChecklistPopover|submitSelectorSetToServer|syncBaseConfigToServer/);
  assert.doesNotMatch(markingPreviewBody, /setCurrentPageSaveReconciliation|markCurrentPageSaveReconciliationDirty/);
});

test("preview exit restores a captured marking-session snapshot before payload fallback", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const popupStateSource = readFileSync(new URL("../src/popup/state.ts", import.meta.url), "utf8");

  assert.match(
    popupSource,
    /function buildPreviewViewState\(previewState\) \{[\s\S]*?previewWillRestoreMarking: Boolean\([\s\S]*?\(previewState\.previousEnabled \|\| previewState\.restoreMarkingOnExit\)/
  );
  assert.match(
    popupSource,
    /async function handleExitPreviewMode\(\) \{[\s\S]*?const shouldRestoreMarking = Boolean\(uiModule\.getViewState\(\)\.previewWillRestoreMarking\);[\s\S]*?const previewRestoreToken = shouldRestoreMarking[\s\S]*?\? beginPreviewRestorePending\(\)[\s\S]*?: null;[\s\S]*?messages\.requestTabCloseAiPreview\(tabId, \{\s*previewRestoreToken\s*\}\)/
  );
  assert.match(
    popupSource,
    /async function handleExitPreviewMode\(\) \{[\s\S]*?if \(shouldRestoreMarking && restoreMarkingSessionSnapshot\(\)\) \{[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?await refreshUi\(\{[\s\S]*?preserveCurrentDraftStatus: true[\s\S]*?\}\)(?:\.catch\(\(\) => null\))?;[\s\S]*?if \(previewRestoreToken !== null\) \{[\s\S]*?state\.previewRestoreAppliedToken = Math\.max\(\s*state\.previewRestoreAppliedToken,\s*previewRestoreToken\s*\);[\s\S]*?\}[\s\S]*?clearMarkingSessionSnapshot\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(closeResult && \(typeof closeResult\.markingEnabled === "boolean" \|\| closeResult\.draftStatus\)\) \{[\s\S]*?await applyPreviewClosedState\(closeResult\);/
  );
  assert.match(
    popupStateSource,
    /previewMarkingSessionSnapshot: null,/
  );
  assert.match(popupSource, /function captureMarkingSessionSnapshot\(\) \{/);
  assert.match(popupSource, /function restoreMarkingSessionSnapshot\(\) \{/);
  assert.match(popupSource, /function clearMarkingSessionSnapshot\(\) \{/);
  assert.match(
    popupSource,
    /function captureMarkingSessionSnapshot\(\) \{[\s\S]*?currentDraftEntry:[\s\S]*?currentSavedEntry:[\s\S]*?currentDraftDirty:[\s\S]*?currentDraftAvailable:[\s\S]*?currentPageSaveReconciliation:[\s\S]*?currentPageSaveReconciliationPending:[\s\S]*?aiRunMarkingsFingerprint:[\s\S]*?aiSelectorsComputedSinceLastSubmit:[\s\S]*?aiSelectorsComputedBaseUrl:/
  );
  assert.match(
    popupSource,
    /function restoreMarkingSessionSnapshot\(\) \{[\s\S]*?state\.currentDraftEntry =[\s\S]*?state\.currentSavedEntry =[\s\S]*?state\.currentDraftDirty =[\s\S]*?state\.currentDraftAvailable =[\s\S]*?state\.currentPageSaveReconciliation =[\s\S]*?state\.currentPageSaveReconciliationPending =[\s\S]*?state\.aiRunMarkingsFingerprint =[\s\S]*?state\.aiSelectorsComputedSinceLastSubmit =[\s\S]*?state\.aiSelectorsComputedBaseUrl =/
  );
  assert.match(
    popupSource,
    /if \(previewOpened\) \{[\s\S]*?resetAiRunState\(\);[\s\S]*?captureMarkingSessionSnapshot\(\);[\s\S]*?uiModule\.setViewState\(\{/
  );
  assert.match(
    popupSource,
    /async function handleMarkingPreview\(\) \{[\s\S]*?await refreshCurrentPageRuntimeStatus\(\);[\s\S]*?captureMarkingSessionSnapshot\(\);[\s\S]*?setPreviewBlocked\(true, PopupText\.preview\.blockedActive\);/
  );
  assert.match(
    popupSource,
    /if \(message && message\.type === "aiPreviewClosed"\) \{[\s\S]*?applyPreviewClosedState\(message\)\.catch\(\(\) => \{[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?clearMarkingSessionSnapshot\(\);[\s\S]*?setPreviewBlocked\(false\);/
  );
  assert.match(popupStateSource, /previewRestoreAppliedToken: 0,/);
  assert.match(popupSource, /function getPreviewRestoreToken\(message = \{\}\) \{/);
  assert.match(
    popupSource,
    /if \(\s*messageToken !== null &&\s*messageToken <= state\.previewRestoreAppliedToken\s*\) \{\s*return false;\s*\}/
  );
  assert.match(
    popupSource,
    /async function applyPreviewClosedState\(closeState = \{\}\) \{[\s\S]*?const draftStatus = normalizedCloseState\.draftStatus[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?clearMarkingSessionSnapshot\(\);[\s\S]*?refreshUi\(\{[\s\S]*?preserveCurrentDraftStatus: Boolean\(hasDraftStatus\)/
  );
  assert.match(
    popupSource,
    /if \(messageToken !== null\) \{\s*state\.previewRestoreAppliedToken = Math\.max\(state\.previewRestoreAppliedToken, messageToken\);\s*\}/
  );
});

test("Preview Contents uses the latest stored selector set and stays disabled without stored selectors", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
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
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");
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
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");

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
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const refreshBody = source.match(
    /function schedulePropertyPageTypesRefresh\(options = \{\}\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*function formatPageTypeCandidateLabel/
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
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
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
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /propertyPageTypesRefreshChanged &&[\s\S]*?state\.propertyPageTypesChangeForceTodoOpen &&[\s\S]*?todoListVisible[\s\S]*?nextViewState\.todoSectionExpanded = true;[\s\S]*?state\.propertyPageTypesChangeForceTodoOpen = false;/
  );
});

test("page-type refresh change copy is documented in shared text", () => {
  const textSource = readFileSync(new URL("../src/common/text.ts", import.meta.url), "utf8");

  assert.match(textSource, /changedNotice: "Live Page candidates changed in Lynx\./);
  assert.match(textSource, /currentPageInvalidAfterRefreshAlert: "Live Page candidates changed in Lynx,[\s\S]*?Marking has been stopped/);
});

test("session save uploads all local page markings while default sync stays backend-scoped", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const remoteConfigSource = readFileSync(new URL("../src/popup/remote-config.ts", import.meta.url), "utf8");
  const pageReconciliationSource = readFileSync(new URL("../src/popup/page-reconciliation.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const handlePageSaveBody = pageReconciliationSource.match(
    /export async function handlePageSave\(deps(?:\s*:\s*[^)]+)?\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?export async function handlePageRevert/
  )[1];
  const handlePageRevertHandlerBody = pageReconciliationSource.match(
    /export async function handlePageRevert\(deps(?:\s*:\s*[^)]+)?\) \{([\s\S]*?)\n\}/
  )[1];
  const applyLocalPageDiscardBody = source.match(
    /async function applyLocalPageDiscard\(\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:(?:\/\/ (?:eslint-disable-next-line|@ts-(?:ignore|expect-error))[^\n]*\n))*async function requestAiRunStart/
  )[1];

  assert.match(remoteConfigSource, /includeCurrentPageMarking = false/);
  assert.match(remoteConfigSource, /includeAllLocalPageMarkings = false/);
  assert.match(
    remoteConfigSource,
    /const backendSavedPageMarkings = await getBackendSavedPageMarkings\(resolvedBaseUrl\)/
  );
  assert.match(
    remoteConfigSource,
    /includeAllLocalPageMarkings \|\|[\s\S]*?backendSavedPageUrls\.has\(url\) \|\|[\s\S]*?\(includeCurrentPageMarking && url === pageUrl\)/
  );
  assert.match(
    remoteConfigSource,
    /markedPages: includeAllLocalPageMarkings[\s\S]*?\?[\s\S]*?localPageMarkingItems[\s\S]*?:[\s\S]*?backendSavedPageMarkingItems/
  );
  assert.match(
    handlePageSaveBody,
    /deps\.syncBaseConfigToServer\(\{[\s\S]*?includeAllLocalPageMarkings: true/
  );
  assert.match(handlePageSaveBody, /deps\.validateStoredToken\(\{ force: true \}\)/);
  assert.match(handlePageSaveBody, /deps\.PopupText\.status\.remoteServerRetryNotice/);
  assert.match(handlePageSaveBody, /maxAttempts: 1/);
  assert.match(source, /const PAGE_SAVE_SYNC_MAX_ATTEMPTS = 5;/);
  assert.match(source, /const PAGE_SAVE_SYNC_INITIAL_RETRY_DELAY_MS = 1500;/);
  assert.match(source, /const PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS = 10000;/);
  assert.match(handlePageSaveBody, /for \(let attempt = 0; attempt < deps\.PAGE_SAVE_SYNC_MAX_ATTEMPTS; attempt \+= 1\) \{/);
  assert.doesNotMatch(handlePageSaveBody, /while \(true\)/);
  assert.match(
    handlePageSaveBody,
    /if \(attempt \+ 1 >= deps\.PAGE_SAVE_SYNC_MAX_ATTEMPTS\) \{[\s\S]*?deps\.updateLastConfigSaveStatus\(deps\.PopupText\.page\.saveFailed\);[\s\S]*?deps\.showToast\(deps\.PopupText\.page\.saveFailedToast\);[\s\S]*?await deps\.refreshUi\(\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    handlePageSaveBody,
    /retryDelayMs = Math\.min\(retryDelayMs \* 2, deps\.PAGE_SAVE_SYNC_MAX_RETRY_DELAY_MS\);/
  );
  assert.match(handlePageSaveBody, /await deps\.clearCurrentPageSaveReconciliation\(\);/);
  assert.match(
    applyLocalPageDiscardBody,
    /const backendSavedPageMarkings = await config\.getBackendSavedPageMarkings\(baseUrl\)/
  );
  assert.match(
    applyLocalPageDiscardBody,
    /findBackendSavedPageMarkingEntry\(backendSavedPageMarkings, pageUrl\)/
  );
  assert.match(applyLocalPageDiscardBody, /messages\.requestTabApplyLocalDiscard\(tabId, \{ baseUrl \}\)/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_LOCAL_DISCARD, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /type: "configUpdated",[\s\S]*?forceReloadPageEntry: true/);
  assert.match(source, /await messages\.requestTabApplyPostSaveTransition\(tabId, \{ baseUrl \}\);/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_POST_SAVE_TRANSITION, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /type: "setEnabled",[\s\S]*?enabled: false/);
  assert.doesNotMatch(applyLocalPageDiscardBody, /loadRemoteConfigForCurrentPage/);
  assert.doesNotMatch(applyLocalPageDiscardBody, /validateStoredToken/);
  assert.match(applyLocalPageDiscardBody, /await clearCurrentPageSaveReconciliation\(\);/);
  assert.match(handlePageRevertHandlerBody, /if \(!currentViewState\.currentPageHasPendingChanges\) \{/);
  assert.doesNotMatch(handlePageSaveBody, /type: "savePageDraft"/);
});

test("session save terminal retry failure leaves the local draft dirty for retry", () => {
  const source = readFileSync(new URL("../src/popup/page-reconciliation.ts", import.meta.url), "utf8");
  const handlePageSaveBody = source.match(
    /export async function handlePageSave\(deps(?:\s*:\s*[^)]+)?\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?export async function handlePageRevert/
  )[1];
  const terminalFailureStart = handlePageSaveBody.indexOf("if (attempt + 1 >= deps.PAGE_SAVE_SYNC_MAX_ATTEMPTS)");
  const terminalFailureEnd = handlePageSaveBody.indexOf(
    "deps.setUiBusy(true, deps.PopupText.status.remoteServerRetryNotice",
    terminalFailureStart
  );
  assert.ok(terminalFailureStart > -1);
  assert.ok(terminalFailureEnd > terminalFailureStart);
  const terminalFailureBody = handlePageSaveBody.slice(terminalFailureStart, terminalFailureEnd);

  assert.match(terminalFailureBody, /deps\.updateLastConfigSaveStatus\(deps\.PopupText\.page\.saveFailed\);/);
  assert.match(terminalFailureBody, /deps\.showToast\(deps\.PopupText\.page\.saveFailedToast\);/);
  assert.match(terminalFailureBody, /await deps\.refreshUi\(\);/);
  assert.doesNotMatch(terminalFailureBody, /applyPostSaveSilentTransition|state\.currentDraftDirty = false|alignPopupToSilentMode/);
});

test("todo completion backend cache ignores local confirmed page markings unless explicitly enabled", () => {
  const source = readFileSync(new URL("../src/background/remote-config-sync.ts", import.meta.url), "utf8");
  const mergeBody = source.match(
    /async function mergeServerConfigIntoLocalSnapshot\(options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(mergeBody, /const applyConfirmedToBackendSaved = Boolean\((?:optionsAny\.applyConfirmedToBackendSaved|options && options\.applyConfirmedToBackendSaved)\);/);
  assert.match(mergeBody, /const existingBackendSavedPageMarkings = await configStore\.getBackendSavedPageMarkings\(baseUrl\);/);
  assert.match(mergeBody, /let mergedBackendSavedPageMarkings = configStore\.mergePageMarkingsByTimestamp\([\s\S]*?incomingPageMarkings/);
  assert.match(mergeBody, /if \(applyConfirmedToBackendSaved\) \{[\s\S]*?confirmedPageMarkings/);
  assert.match(
    mergeBody,
    /if \([\s\S]*?Object\.keys\(incomingPageMarkings\)\.length > 0[\s\S]*?\|\|[\s\S]*?\(applyConfirmedToBackendSaved && Object\.keys\(confirmedPageMarkings\)\.length > 0\)[\s\S]*?\) \{[\s\S]*?configStore\.setBackendSavedPageMarkings\(baseUrl, mergedBackendSavedPageMarkings\);/
  );
});

test("invalid remote page pruning delegates the remove transport to background", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const remoteNetworkSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");
  const removeBody = popupSource.match(
    /async function removePageMarkingFromRemote\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function pruneRemoteInvalidPageMarkings/
  )[1];
  const pruneBody = popupSource.match(
    /async function pruneRemoteInvalidPageMarkings\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function pruneLocalInvalidPageMarkings/
  )[1];

  assert.match(backgroundSource, /from "\.\/background\/remote-network\.js"/);
  assert.match(remoteNetworkSource, /export async function removeRemotePageMarking\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /const removeUrl = resolveBackgroundEndpoint\(endpointValue, "\/remove"\);/);
  assert.match(remoteNetworkSource, /body: JSON\.stringify\(\{[\s\S]*?siteId: normalizedSiteId,[\s\S]*?url: pageUrl[\s\S]*?\}\)/);
  assert.match(backgroundSource, /if \(message\.type === "removeRemotePageMarking"\) \{/);
  assert.match(removeBody, /type: "removeRemotePageMarking"/);
  assert.match(removeBody, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(removeBody, /fetch\(|maybeUpdateStoredTokenFromResponse|createConfigSyncHeaders/);
  assert.match(pruneBody, /state\.removedRemotePageKeys\.has\(removalKey\)/);
  assert.match(pruneBody, /state\.removedRemotePageKeys\.add\(removalKey\)/);
});

test("token validation delegates the auth transport to background", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const networkCoreSource = readFileSync(new URL("../src/background/network-core.ts", import.meta.url), "utf8");
  const validateBody = popupSource.match(
    /async function validateStoredToken\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function clearFocusedElement/
  )[1];

  assert.match(backgroundSource, /from "\.\/background\/network-core\.js"/);
  assert.match(networkCoreSource, /export function buildValidateEndpointFromStageBase\(stageBase(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(networkCoreSource, /export async function validateAuthToken\(options = \{\}\) \{/);
  assert.match(networkCoreSource, /const validateUrl = buildValidateEndpointFromStageBase\(stageBase\);/);
  assert.match(backgroundSource, /if \(message\.type === "validateAuthToken"\) \{/);
  assert.match(validateBody, /type: "validateAuthToken"/);
  assert.match(validateBody, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(validateBody, /fetch\(|buildValidateEndpointFromStageBase|maybeUpdateStoredTokenFromResponse/);
});

test("login delegates the auth transport to background while popup keeps token persistence", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const networkCoreSource = readFileSync(new URL("../src/background/network-core.ts", import.meta.url), "utf8");
  const loginBody = popupSource.match(
    /async function handleLoginAction\(\) \{([\s\S]*?)\n\}\n\nasync function alignPopupToSilentMode/
  )[1];

  assert.match(backgroundSource, /from "\.\/background\/network-core\.js"/);
  assert.match(networkCoreSource, /export function buildLoginEndpointFromStageBase\(stageBase(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(networkCoreSource, /export async function requestAuthLogin\(options = \{\}\) \{/);
  assert.match(networkCoreSource, /const loginUrl = buildLoginEndpointFromStageBase\(stageBase\);/);
  assert.match(backgroundSource, /if \(message\.type === "requestAuthLogin"\) \{/);
  assert.match(loginBody, /type: "requestAuthLogin"/);
  assert.match(loginBody, /messages\.sendRuntimeMessage/);
  assert.match(loginBody, /await saveLoginSettings\(\{ stageBase, token \}\);/);
  assert.doesNotMatch(loginBody, /fetch\(|buildLoginEndpointFromStageBase|maybeUpdateStoredTokenFromResponse/);
});

test("remote config load delegates transport to background and hydrates the payload from session storage", () => {
  const popupSource = readFileSync(new URL("../src/popup/remote-config.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const remoteNetworkSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");
  const remoteConfigSyncSource = readFileSync(new URL("../src/background/remote-config-sync.ts", import.meta.url), "utf8");
  const loadBody = popupSource.match(
    /export async function loadRemoteConfigForCurrentPage\(deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^=]+)? = \{\}\) \{([\s\S]*?)\n\}\n\n(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?export async function syncBaseConfigToServer/
  )[1];

  assert.match(backgroundSource, /from "\.\/background\/remote-network\.js"/);
  assert.match(remoteNetworkSource, /export async function loadRemoteConfigSnapshot\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /const loadUrl = resolveBackgroundEndpoint\(endpointValue, "\/load"\);/);
  assert.match(remoteNetworkSource, /const stored = await putTransferPayload\("load", payload\);/);
  assert.match(backgroundSource, /from "\.\/background\/remote-config-sync\.js"/);
  assert.match(remoteConfigSyncSource, /export async function replaceServerConfigIntoLocalSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "loadRemoteConfigSnapshot"\) \{/);
  assert.match(loadBody, /type: "loadRemoteConfigSnapshot"/);
  assert.match(loadBody, /await replaceServerConfigIntoLocal\(\{/);
  assert.match(loadBody, /payloadKey: typeof response\.payloadKey === "string" \? response\.payloadKey : ""/);
  assert.doesNotMatch(loadBody, /await utils\.storageGet\(chrome\.storage\.session, payloadKey\)/);
  assert.doesNotMatch(loadBody, /await utils\.storageRemove\(chrome\.storage\.session, payloadKey\)/);
  assert.doesNotMatch(loadBody, /fetch\(loadUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
});

test("remote config save delegates transport to background and hydrates the response from session storage", () => {
  const popupSource = readFileSync(new URL("../src/popup/remote-config.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const remoteNetworkSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");
  const remoteConfigSyncSource = readFileSync(new URL("../src/background/remote-config-sync.ts", import.meta.url), "utf8");
  const saveBody = popupSource.match(
    /export async function syncBaseConfigToServer\(deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^=]+)? = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(backgroundSource, /from "\.\/background\/remote-network\.js"/);
  assert.match(remoteNetworkSource, /export async function saveRemoteConfigSnapshot\(\s*options(?:\s*:\s*[^=]+)? = \{\}\s*\) \{/);
  assert.match(remoteNetworkSource, /const saveUrl = resolveBackgroundEndpoint\(endpointValue, "\/save"\);/);
  assert.match(remoteNetworkSource, /const requestPayloadKey = typeof options\.payloadKey === "string" \? options\.payloadKey\.trim\(\) : "";/);
  assert.match(remoteNetworkSource, /const loaded = await getTransferPayload\(requestPayloadKey, \{ expectedType: "object" \}\);/);
  assert.match(remoteNetworkSource, /await removeTransferPayload\(requestPayloadKey\);/);
  assert.match(backgroundSource, /from "\.\/background\/remote-config-sync\.js"/);
  assert.match(remoteConfigSyncSource, /export async function mergeServerConfigIntoLocalSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "mergeServerConfigIntoLocalSnapshot"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "saveRemoteConfigSnapshot"\) \{/);
  assert.match(saveBody, /type: "saveRemoteConfigSnapshot"/);
  assert.match(saveBody, /const requestPayloadKey = deps\.buildTransferPayloadKey\("save-request"\);/);
  assert.match(saveBody, /const stored = await deps\.putTransferPayload\("save-request", payload, \{/);
  assert.match(saveBody, /payloadKey: requestPayloadKey/);
  assert.match(saveBody, /type: "mergeServerConfigIntoLocalSnapshot"/);
  assert.match(saveBody, /payloadKey: responsePayloadKey/);
  assert.doesNotMatch(saveBody, /await utils\.storageGet\(chrome\.storage\.session, responsePayloadKey\)/);
  assert.doesNotMatch(saveBody, /await utils\.storageRemove\(chrome\.storage\.session, responsePayloadKey\)/);
  assert.doesNotMatch(saveBody, /fetch\(saveUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
});

test("render-mode detection delegates the heavy html transport to background", () => {
  const popupSource = readFileSync(new URL("../src/popup/render-mode-inspection.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const remoteNetworkSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");
  const detectBody = popupSource.match(
    /export async function detectRenderModeViaEndpoint\(deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^)]+)? = \{\}\)(?:\s*:\s*[^{]+)? \{([\s\S]*?)\n\}\n\nexport async function maybeAutoDetectRenderMode/
  )[1];

  assert.match(backgroundSource, /from "\.\/background\/remote-network\.js"/);
  assert.match(remoteNetworkSource, /export async function requestRenderModeDetection\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /const detectUrl = resolveBackgroundEndpoint\(endpointValue, "\/is_js_rendered"\);/);
  assert.match(backgroundSource, /if \(message\.type === "requestRenderModeDetection"\) \{/);
  assert.match(detectBody, /type: "requestRenderModeDetection"/);
  assert.match(detectBody, /const requestPayloadKey = deps\.buildTransferPayloadKey\("render-mode-request"\);/);
  assert.match(detectBody, /const stored = await deps\.putTransferPayload\("render-mode-request", \{/);
  assert.match(detectBody, /rawHtml,/);
  assert.match(detectBody, /renderedHtml/);
  assert.match(detectBody, /normalizeRenderModeDetectionResult\(deps, response\.payload\)/);
  assert.doesNotMatch(detectBody, /fetch\(detectUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
});

test("popup blocks the interface with a spinner while page inspection is running", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");

  assert.match(source, /const SILENT_HIGHLIGHTING_PREPARATION_REASON = "editor_preparing";/);
  assert.match(source, /let contentInspectionPending = Boolean\(/);
  assert.doesNotMatch(source, /restoreInspectionPending/);
  assert.match(
    source,
    /const pageInspectionBusy =[\s\S]*?contentInspectionPending[\s\S]*?pageSaveReconciliationPending[\s\S]*?state\.currentPageSaveReconciliation\.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON/
  );
  assert.match(
    source,
    /nextViewState\.isBusy = popupBusyActive \|\| backgroundLifecycleBusy \|\| remoteConfigRetryBlocked \|\| pageInspectionBusy;/
  );
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
  assert.match(uiSource, /busyReason: isBusy && details && typeof details\.reason === "string" \? details\.reason : ""/);
  assert.match(uiSource, /console\.debug\("\[popup-blocker\]", eventName/);
  assert.match(uiSource, /const busyCopy = getBusyCurtainCopy\(view\);[\s\S]*?note: busyCopy\.note,[\s\S]*?reason: view\.busyReason \|\| "popup-busy"/);
  assert.match(
    uiSource,
    /function getBlockingUiCurtainState\(\s*view(?:\s*:\s*[^)]+)?\)\s*(?::\s*[^{]+)?\{[\s\S]*?if \(view\.computeButtonLoading\)[\s\S]*?PopupText\.overlay\.computingSelectors[\s\S]*?if \(view\.isBusy\)/
  );
  assert.match(uiSource, /function formatCountdownFromDeadline\(deadlineAt(?::\s*unknown)?\)(?::\s*string)? \{/);
  assert.match(uiSource, /const liveCountdownText = formatCountdownFromDeadline\(view\.aiRunDeadlineAt\);/);
  assert.match(uiSource, /backgroundReason === "tab-run-ai-running"/);
  assert.match(uiSource, /aiRunPhase === "running"/);
  assert.match(uiSource, /reason: "ai-run-compute-preparing"[\s\S]*?timerText: ""/);
  assert.match(
    uiSource,
    /timerText: view\.aiRunCountdownVisible \? \(liveCountdownText \|\| aiRunCountdownText\) : "Up to 8:00"/
  );
  assert.match(uiSource, /function syncBlockingCurtainCountdownTimer\(curtain/);
  assert.match(uiSource, /blockingCurtainCountdownTimer = setInterval\(\(\) => \{\s*renderApp\(\);/);
  assert.match(source, /aiRunDeadlineAt: state\.aiRunDeadlineAt/);
  assert.match(source, /formatAiRunCountdown\(\s*getAiRunRemainingMs\(state\.aiRunDeadlineAt\)\s*\)/);
  assert.doesNotMatch(source, /state\.aiRunRemainingMs\s*\|\|\s*getAiRunRemainingMs\(state\.aiRunDeadlineAt\)/);
  assert.match(uiSource, /function getBusyCurtainCopy\(view(?::\s*ViewState)?\) \{/);
  assert.match(uiSource, /reason === "popup-refresh"/);
  assert.match(uiSource, /reason === "render-mode-inspection-start"/);
  assert.match(uiSource, /reason === "tab-run-ai"/);
  assert.match(uiSource, /spinnerKey === "navInspect" \|\| reason === "page-inspection-pending"/);
  assert.match(uiSource, /let lastPopupBlockerLogSignature = "";/);
  assert.match(
    uiSource,
    /const signature = \[\s*curtain\.message \|\| "",\s*curtain\.reason \|\| "",\s*curtain\.source \|\| "",\s*curtain\.spinnerKey \|\| ""\s*\]\.join\("\|"\);/
  );
  assert.match(uiSource, /function App\(\{ state: view, actions: handlers \}:\s*PopupRenderProps\) \{\s*const curtain = getBlockingUiCurtainState\(view\);\s*logPopupBlockerReason\("render", curtain\);/);
  assert.match(uiSource, /if \(!curtain\.visible\) \{\s*lastPopupBlockerLogSignature = "";\s*return;\s*\}/);
  // A stale "Inspecting page..." curtain is cleared once the spinner queue
  // drains and the content side reports no pending inspection.
  assert.match(source, /function scheduleStaleInspectionBusyClear\(/);
  assert.match(source, /logPopupSpinnerDebug\("stale-inspection-busy-clear"/);
  assert.match(source, /reconcileRenderModeNavSpinner = false/);
  assert.match(source, /const renderModeNavSpinnerStuck = Boolean\(\s*reconcileRenderModeNavSpinner &&\s*popupSpinnerQueue\.has\("navInspect"\)\s*\);/);
  assert.match(source, /render-mode-nav-curtain-clear/);
  assert.match(source, /popSpinner\("navInspect"\);/);
  assert.match(source, /const backgroundLifecycleBusy = Boolean\(popupBackgroundLifecycle && popupBackgroundLifecycle\.busy\);/);
  assert.match(
    source,
    /nextViewState\.isBusy = popupBusyActive \|\| backgroundLifecycleBusy \|\| remoteConfigRetryBlocked \|\| pageInspectionBusy;/
  );
  assert.match(
    source,
    /backgroundLifecycleBusy[\s\S]*?\? \(popupBackgroundLifecycle\?\.message \|\| PopupText\.overlay\.pleaseWait\)/
  );
});

test("popup spinner queue pushSpinner returns key and handles delays correctly", () => {
  const source = readFileSync(new URL("../src/popup/spinner.ts", import.meta.url), "utf8");
  const pushBody = source.match(
    /export function pushSpinner\(deps, key, message, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  // suppressIfActive path returns null when queue is active
  assert.match(pushBody, /suppressIfActive[\s\S]*?return null;/);
  // delay path sets timer and returns effectiveKey
  assert.match(pushBody, /if \(delayMs > 0\) \{[\s\S]*?getPopupSpinnerTimer\(\)[\s\S]*?setPopupSpinnerTimer\([\s\S]*?return effectiveKey;/);
  // immediate show path sets popupSpinnerVisible and applies reason-aware busy details.
  assert.match(pushBody, /setPopupSpinnerVisible\(true\);[\s\S]*?setUiBusyFromCurrentSpinner\(\)/);
  assert.match(pushBody, /const reason = normalizeSpinnerReason\(deps, options\.reason, effectiveKey, msg\);/);
  assert.match(pushBody, /const source = typeof options\.source === "string"/);
  // upsert path updates in-place without re-checking suppressIfActive
  assert.match(pushBody, /const isUpdate = deps\.popupSpinnerQueue\.has\(effectiveKey\)/);
  assert.match(pushBody, /syncSpinnerEntryToBackground\(effectiveKey\)/);
});

test("popup spinner pop removes entries from the background broker", () => {
  const source = readFileSync(new URL("../src/popup/spinner.ts", import.meta.url), "utf8");
  const popBody = source.match(
    /export function popSpinner\(deps, key\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(popBody, /const mappedTabId = deps\.popupSpinnerKeyTabIds\.get\(key\);/);
  assert.match(popBody, /if \(!deps\.popupSpinnerQueue\.has\(key\)\) \{[\s\S]*?deps\.removeSpinnerEntryFromBackground\(key, mappedTabId\)/);
  assert.match(popBody, /deps\.removeSpinnerEntryFromBackground\(key, mappedTabId \|\| deps\.getCurrentPopupTabId\(\)\)/);
});

test("popup delegates spinner queue state to the background broker", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const setBody = source.match(
    /function syncSpinnerEntryToBackground\(key\) \{([\s\S]*?)\n\}/
  )[1];
  const clearBody = source.match(
    /function clearSpinnerQueueInBackground\(\s*tabId = getCurrentPopupTabId\(\),\s*options(?:\s*:\s*[^=]+)? = \{\}\s*\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(setBody, /type: SPINNER_REQUEST_TYPES\.SET/);
  assert.match(setBody, /persistent: expectedPersistent/);
  assert.match(setBody, /reason: normalizeSpinnerReason\(entry\.reason, key, expectedMessage\)/);
  assert.match(setBody, /source: typeof entry\.source === "string" && entry\.source \? entry\.source : "popup-spinner"/);
  assert.match(setBody, /startedAt: Number\.isFinite\(entry\.startedAt\) \? entry\.startedAt : Date\.now\(\)/);
  assert.match(clearBody, /requestPopupSpinnerClear\(tabId, \{/);
  assert.match(clearBody, /transientOnly: Boolean\(options\.transientOnly\)/);
  assert.doesNotMatch(source, /spinnerQueue:<tabId>/);
  assert.doesNotMatch(source, /restoreSpinnerQueueFromStorage/);
});

test("popup ignores stale spinner-set broker snapshots after local removal", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const sendBody = source.match(
    /function sendSpinnerBrokerMessage\(message, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];
  const setBody = source.match(
    /function syncSpinnerEntryToBackground\(key\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(sendBody, /const shouldApplySnapshot = typeof options\.shouldApplySnapshot === "function"/);
  assert.match(sendBody, /response && shouldApplySnapshot\(response\)/);
  assert.match(setBody, /const entry = popupSpinnerQueue\.get\(key\);/);
  assert.match(setBody, /const expectedMessage = entry\.message;/);
  assert.match(setBody, /const expectedPersistent = entry\.persistent;/);
  assert.match(setBody, /const shouldApplySnapshot = \(\) => \{[\s\S]*?const currentEntry = popupSpinnerQueue\.get\(key\);/);
  assert.match(setBody, /if \(!currentEntry\) \{[\s\S]*?return false;/);
  assert.match(setBody, /currentEntry\.message === expectedMessage/);
  assert.match(setBody, /Boolean\(currentEntry\.persistent\) === Boolean\(expectedPersistent\)/);
  assert.match(setBody, /shouldApplySnapshot/);
  assert.match(sendBody, /requestPopupSpinnerSet\(tabId, \{/);
});

test("popup restores spinner state from background current state", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const restoreBody = source.match(
    /async function restoreSpinnerQueueFromBackground\(tabId, popupBus\) \{([\s\S]*?)\n\}/
  )[1];
  const applyBody = source.match(
    /function applyBackgroundStateSnapshot\(snapshot\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(restoreBody, /requestPopupView\(popupBus, tabId\)/);
  assert.match(restoreBody, /applyPopupViewSnapshot\(viewState\)/);
  assert.doesNotMatch(restoreBody, /WORLD_MESSAGE_TYPES\.GET_BACKGROUND_STATE/);
  assert.match(applyBody, /popupSpinnerQueue\.clear\(\);/);
  assert.match(applyBody, /Array\.isArray\(snapshot\.spinnerQueue\)/);
  assert.match(applyBody, /popupSpinnerQueue\.set\(entry\.key/);
  assert.match(applyBody, /syncUiBusyFromBrokerState\(\);/);
});

test("tab reload keeps the inspection curtain active while enabled pages re-inspect", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(source, /async function waitForEnableMarkingInspectionToSettle\(tabId, baseUrl\) \{/);
  assert.match(source, /type: "getInspectionStatus"/);
  assert.match(source, /type: "getPageDraftStatus",\s*\n\s*baseUrl/);
  assert.match(source, /let responseObserved = false;/);
  assert.match(source, /responseObserved = true;/);
  assert.match(source, /\(responseObserved && attempt >= 2\) \|\| attempt >= 6/);
  assert.match(source, /const navigationInspectionPending = Boolean\(/);
  assert.match(source, /let popupBackgroundStateTabId(?:: [^=]+)? = null;/);
  assert.match(source, /let popupBackgroundActivation(?:: [^=]+)? = null;/);
  assert.match(source, /popupNavigationInspectionOverlayStarted/);
  assert.match(source, /popupNavigationInspectionOverlayTabId === currentTabId/);
  assert.match(source, /let contentInspectionPending = Boolean\(/);
  assert.doesNotMatch(source, /restoreInspectionPending/);
  assert.match(source, /function beginNavigationInspectionOverlay\(tabId\) \{/);
  assert.match(source, /function endNavigationInspectionOverlay\(tabId = popupNavigationInspectionOverlayTabId\) \{/);
  assert.match(source, /function scheduleNavigationInspectionSettlePoll\(tabId, baseUrl\) \{/);
  assert.match(source, /function clearNavigationInspectionSettlePollsExcept\(tabIdToKeep = null\) \{/);
  assert.match(source, /const popupNavigationInspectionSettlePollByTabId = new Map\(\);/);

  const onUpdatedBlock = source.match(
    /browser\.tabs\.onUpdated\.addListener\(async \(tabId, changeInfo, tab\) => \{([\s\S]*?)\n {2}\}\);\n {2}window\.addEventListener/
  )[1];

  assert.match(onUpdatedBlock, /changeInfo\.status === "loading"/);
  assert.match(onUpdatedBlock, /type: "clearReloadRestoreTabState"/);
  assert.doesNotMatch(onUpdatedBlock, /messages\.getTabState\(tabId, "restore"\)/);
  assert.doesNotMatch(onUpdatedBlock, /messages\.setTabState\(tabId, tabState\)/);
  assert.match(onUpdatedBlock, /beginNavigationInspectionOverlay\(tabId\);/);
  assert.match(onUpdatedBlock, /await refreshUi\(\{ useBusyOverlay: false \}\);/);
  assert.match(onUpdatedBlock, /const settleResult = await waitForEnableMarkingInspectionToSettle\(tabId, settleBaseUrl\);/);
  assert.match(onUpdatedBlock, /if \(settleResult\.responseObserved \|\| settleResult\.inspectionObserved\) \{/);
  assert.match(onUpdatedBlock, /endNavigationInspectionOverlay\(tabId\);\s*await refreshUi\(\{ useBusyOverlay: false \}\);/);
  assert.match(onUpdatedBlock, /scheduleNavigationInspectionSettlePoll\(tabId, settleBaseUrl\);/);
  assert.doesNotMatch(onUpdatedBlock, /finally \{[\s\S]*?endNavigationInspectionOverlay\(tabId\);/);

  const beginBody = source.match(
    /function beginNavigationInspectionOverlay\(tabId\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(beginBody, /clearNavigationInspectionSettlePollsExcept\(tabId\);/);
  const endBody = source.match(
    /function endNavigationInspectionOverlay\(tabId = popupNavigationInspectionOverlayTabId\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(endBody, /removeSpinnerEntryFromBackground\("navInspect", tabId\)/);
  assert.match(endBody, /if \(!response\) \{\s*popSpinner\("navInspect"\);/);

  const snapshotApplyBody = source.match(
    /function applyPopupViewSnapshot\(snapshot(?:: [^)]+)?\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(snapshotApplyBody, /activation: snapshot\.activation \|\| null,/);

  const refreshBody = source.match(
    /async function refreshUiInner\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function maybeResumePersistedAiRun/
  )[1];
  assert.match(refreshBody, /const persistedTabState = await messages\.getTabState\(state\.currentTab\.id\);/);
  assert.match(refreshBody, /type: "clearReloadRestoreTabState"/);
  assert.doesNotMatch(refreshBody, /messages\.getTabState\(state\.currentTab\.id, "restore"\)/);
  assert.match(refreshBody, /await messages\.sendTabMessageToTab\(currentTabId, \{ type: "getInspectionStatus" \}\)/);
  assert.match(refreshBody, /contentInspectionPending/);
  // After a tab reload, the latest runtime status response is authoritative:
  // once it arrives the popup adopts the fresh inspection status instead of
  // stale optimistic UI state.
  assert.match(refreshBody, /let latestRuntimeStatus = null;/);
  assert.match(refreshBody, /const runtimeStatusBaseUrl = state\.currentBaseUrl \|\| effectiveTabState\.baseUrl \|\| "";/);
  assert.doesNotMatch(refreshBody, /latestRuntimeResponseObserved/);
  assert.match(refreshBody, /inspectionStatus = latestRuntimeStatus\.inspectionStatus;/);
  assert.match(refreshBody, /const backgroundActivationInspectionPending = Boolean\(/);
  assert.match(refreshBody, /popupBackgroundStateTabId === currentTabId/);
  assert.match(refreshBody, /popupBackgroundActivation\.bootstrapStatus === "bootstrapping"/);
  assert.match(refreshBody, /!navigationInspectionPending &&\s*\(!siteIdReady \|\| !renderModeReady \|\| pageTypeUiBlocked\)/);
  assert.doesNotMatch(refreshBody, /const pageScopedUiDisabled =[\s\S]*pageTypeUiBlocked && !navigationInspectionPending/);
  assert.match(refreshBody, /nextViewState\.mainUiHidden =[\s\S]*?!isEnabled[\s\S]*?\(!navigationInspectionPending && \(!siteIdReady \|\| !renderModeReady\)\)/);
});

test("tab activation does not end persisted inspection overlay before old-tab spinner state is cleared", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const onActivatedBlock = source.match(
    /browser\.tabs\.onActivated\.addListener\(async \(\{ tabId \}\) => \{([\s\S]*?)\n {2}\}\);\n\n {2}browser\.tabs\.onUpdated/
  )[1];

  assert.doesNotMatch(onActivatedBlock, /endNavigationInspectionOverlay\(/);
  assert.match(onActivatedBlock, /clearSpinnerQueueInBackground\(oldTabId, \{ transientOnly: true \}\)\.catch\(\(\) => \{\}\);/);
  assert.match(onActivatedBlock, /clearNavigationInspectionSettlePollsExcept\(\);/);
  assert.match(onActivatedBlock, /popupNavigationInspectionOverlayStarted = false;/);
  assert.match(onActivatedBlock, /popupBackgroundLifecycle = null;/);
  assert.match(onActivatedBlock, /popupBackgroundStateTabId = null;/);
  assert.match(onActivatedBlock, /popupBackgroundActivation = null;/);
  assert.match(onActivatedBlock, /popupNavigationInspectionOverlayTabId = null;/);
});

test("popup unload clears navigation inspection settle polls", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const beforeUnloadBlock = source.match(
    /window\.addEventListener\("beforeunload", \(\) => \{([\s\S]*?)\n {2}\}\);\n\n {2}utils\.addStorageChangeListener/
  )[1];

  assert.match(beforeUnloadBlock, /clearNavigationInspectionSettlePollsExcept\(\);/);
  assert.match(beforeUnloadBlock, /clearSpinnerQueueInBackground\(tabId, \{ transientOnly: true \}\)\.catch\(\(\) => \{\}\);/);
});

test("session pending is no longer tied to Lynx selector submission state", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const pendingBody = source.match(
    /function hasSessionPendingChanges\(sourceConfig, localPageMarkings, backendSavedPageMarkings, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(pendingBody, /options\.currentDraftDirty/);
  assert.match(pendingBody, /options\.reconciliationPending/);
  assert.match(pendingBody, /hasSessionPageMarkingChanges\(localPageMarkings, backendSavedPageMarkings\)/);
  assert.doesNotMatch(pendingBody, /areCurrentSelectorsSubmitted|submittedSelectorsFingerprint/);
});

test("popup no longer schedules observer remote config polling", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /OBSERVER_REMOTE_CONFIG_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(source, /syncObserverRemoteConfigRefreshTimer/);
  assert.doesNotMatch(source, /remoteConfigLoadMode:\s*"observer_poll"/);
});

test("marking enable does not send a redundant force refresh after TAB_ACTIVATE_MARKING", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /messages\.requestTabActivateMarking\(tab\.id, \{/);
  assert.doesNotMatch(enableBody, /type: "forceRefresh"/);
});

test("marking enable upgrades the popup spinner to page inspection during reveal warmup", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const spinnerSource = readFileSync(new URL("../src/popup/spinner.ts", import.meta.url), "utf8");
  const runWithSpinnerBody = spinnerSource.match(
    /export async function runWithSpinner\(deps, key, message, task, options = \{\}\) \{([\s\S]*?)\n\}/
  )[1];
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(runWithSpinnerBody, /return await task\(pushed\);/);
  assert.match(
    enableBody,
    /setSpinnerMessage\(spinnerKey, PopupText\.overlay\.pageInspection\);[\s\S]*?const enableResponse = await messages\.requestTabActivateMarking\(tab\.id, \{[\s\S]*?baseUrl: effectiveBaseUrl/
  );
  assert.match(enableBody, /desktopPreviewEnabled: Boolean\(uiModule\.getViewState\(\)\.desktopPreviewEnabled\)/);
  assert.doesNotMatch(enableBody, /await waitForEnableMarkingInspectionToSettle\(tab\.id, effectiveBaseUrl\);/);
  assert.match(
    enableBody,
    /const enableResponse = await messages\.requestTabActivateMarking[\s\S]*?resetAiRunMarkingsFingerprint\(\);[\s\S]*?await refreshUi\(\);/
  );
});

test("disabling marking with a pending session prompts to discard before exiting", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /const pendingKnownFromCurrentView = Boolean\([\s\S]*?!desiredEnabled && currentViewState\.sessionHasPendingChanges[\s\S]*?\);/);
  assert.match(enableBody, /const showImmediateDisableSpinner = \(\) => \{[\s\S]*?pushSpinner\(null, PopupText\.overlay\.disablingMarking, \{[\s\S]*?delayMs: 0,[\s\S]*?reason: "marking-disable"/);
  assert.match(enableBody, /if \(!desiredEnabled\) \{\s*showImmediateDisableSpinner\(\);\s*\}[\s\S]*?tab = await helpers\.ensureActiveTab\(\{ requireId: true, requireUrl: true \}\);/);
  assert.match(enableBody, /if \(!desiredEnabled && !pendingKnownFromCurrentView\) \{[\s\S]*?showImmediateDisableSpinner\(\);[\s\S]*?await refreshCurrentPageRuntimeStatus\(\{[\s\S]*?tabId: tab\.id,[\s\S]*?baseUrl: state\.currentBaseUrl[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?latestViewState = uiModule\.getViewState\(\);/);
  assert.match(enableBody, /if \(!desiredEnabled && latestViewState\.sessionHasPendingChanges\)/);
  assert.match(enableBody, /clearImmediateDisableSpinner\(\);[\s\S]*?const confirmedDiscard = window\.confirm\(PopupText\.page\.disableDiscardConfirm\);/);
  assert.match(enableBody, /PopupText\.page\.exitRequiresAiResolution/);
  assert.match(enableBody, /PopupText\.page\.exitRequiresResolution/);
  // A toast is shown, then a confirm dialog gates discard+disable.
  assert.match(enableBody, /const confirmedDiscard = window\.confirm\(PopupText\.page\.disableDiscardConfirm\);/);
  // Cancel keeps the session and stays in marking mode.
  assert.match(enableBody, /if \(!confirmedDiscard\) \{[\s\S]*?uiModule\.setViewState\(\{ toggleEnabled: true \}\)[\s\S]*?setLastPopupEnabled\(true, buildPopupEnabledContext\(tab, state\.currentBaseUrl\)\)[\s\S]*?return;/);
  // OK discards locally, then falls through to disable.
  assert.match(enableBody, /showImmediateDisableSpinner\(\);[\s\S]*?await applyLocalPageDiscard\(\);/);
  assert.match(enableBody, /desiredEnabled \? null : immediateDisableSpinnerKey,[\s\S]*?\{[\s\S]*?delayMs: desiredEnabled \? POPUP_BUSY_OVERLAY_DELAY_MS : 0[\s\S]*?\}/);
});

test("popup scopes optimistic enabled state to the current tab page and base URL", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(source, /lastPopupEnabledContext/);
  assert.match(source, /function buildPopupEnabledContext\(tab = state\.currentTab, baseUrl = state\.currentBaseUrl\) \{/);
  assert.match(source, /function isPopupEnabledContextCurrent\(context, currentContext = buildPopupEnabledContext\(\)\) \{/);
  assert.match(source, /function clearLastPopupEnabled\(\) \{/);
  assert.match(source, /if \(tabChanged\) \{[\s\S]*?clearLastPopupEnabled\(\);/);
  assert.match(source, /if \(!tabChanged && pageUrl !== state\.lastPopupPageUrl\) \{[\s\S]*?clearLastPopupEnabled\(\);/);
  assert.match(source, /if \(!isPopupEnabledContextCurrent\(state\.lastPopupEnabledContext, popupEnabledContext\)\) \{[\s\S]*?clearLastPopupEnabled\(\);/);
});

test("run ai refreshes page runtime status before honoring reconciliation gates", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const computeBody = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  )[1];

  assert.match(computeBody, /await refreshCurrentPageRuntimeStatus\(\);[\s\S]*?if \(state\.currentPageSaveReconciliationPending\) \{/);
});

test("content-side save hotkey workflow is removed from the marking session", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const keydownBody = source.match(
    /document\.addEventListener\("keydown", \(event\) => \{([\s\S]*?)\n\s*\}, true\);/
  )[1];

  assert.match(keydownBody, /if \(key !== "e" && key !== "m"\) \{/);
  assert.doesNotMatch(keydownBody, /key === "s"|isPageSaveHotkeyAllowedOnPage|saveCurrentPageDraft/);
});

test("content saved baseline is refreshed from backend cache, not local drafts", () => {
  const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const runtimeMessageHandlerSource = readFileSync(
    new URL("../src/content/runtime-message-handler.ts", import.meta.url),
    "utf8"
  );
  const draftStatusHandlerSource = readFileSync(
    new URL("../src/content/page-draft-status-handler.ts", import.meta.url),
    "utf8"
  );
  const clearHandlerSource = readFileSync(
    new URL("../src/content/page-save-reconciliation-clear-handler.ts", import.meta.url),
    "utf8"
  );

  assert.match(
    coreSource,
    /export async function refreshSavedPageEntryFromBackendCache[\s\S]*?config\.getBackendSavedPageMarkings\(baseUrl\)/
  );
  assert.match(
    runtimeMessageHandlerSource,
    /if \(message\.type === "getPageDraftStatus"\) \{[\s\S]*?deps\.getPageDraftStatusHandler\(\)\.getStatus\(\{ targetBaseUrl \}\)/
  );
  assert.match(
    draftStatusHandlerSource,
    /refreshSavedPageEntryFromBackendCache\(targetBaseUrl, pageUrl\)/
  );
  assert.match(
    draftStatusHandlerSource,
    /reconciliationPending: deps\.getPageSaveReconciliationPending\(pageUrl\)/
  );
  assert.match(
    runtimeMessageHandlerSource,
    /if \(message\.type === "clearPageSaveReconciliation"\) \{[\s\S]*?deps\.getPageSaveReconciliationClearHandler\(\)\.clear\(\{ targetBaseUrl, pageUrl \}\)/
  );
  assert.match(
    clearHandlerSource,
    /deps\.getBackendSavedPageMarkings\(targetBaseUrl\)/
  );
  assert.doesNotMatch(contentSource, /confirmed local snapshot|immediate post-save remote reload omits/);
});

test("submission-xpath staleness only counts when the entry already has prior run data", () => {
  const draftStatusHandlerSource = readFileSync(
    new URL("../src/content/page-draft-status-handler.ts", import.meta.url),
    "utf8"
  );
  const block = draftStatusHandlerSource.match(
    /const entrySubmissionXpaths =[\s\S]*?reconciliationPending: deps\.getPageSaveReconciliationPending\(pageUrl\)/
  )[0];

  // The stale check must be gated on the entry carrying submission xpaths from a
  // prior AI run/save. Without this gate a freshly enabled page (empty
  // submissionXpaths vs. non-empty live xpaths) is wrongly flagged dirty and the
  // Discard button false-enables.
  assert.match(
    block,
    /const entrySubmissionXpaths =\s*\n?\s*entry && Array\.isArray\(entry\.submissionXpaths\) \? entry\.submissionXpaths : \[\];/
  );
  assert.match(
    block,
    /const submissionXpathsStale = Boolean\([\s\S]*?entrySubmissionXpaths\.length > 0 &&[\s\S]*?deps\.submissionXpathsEqual\(\s*entrySubmissionXpaths,/
  );
});

test("forced config reload replaces the current page entry without re-syncing live DOM", () => {
  const source = readFileSync(new URL("../src/content/runtime-message-handler.ts", import.meta.url), "utf8");
  const handlerSource = readFileSync(
    new URL("../src/content/config-updated-handler.ts", import.meta.url),
    "utf8"
  );
  const configUpdatedSource = source.match(
    /if \(message\.type === "configUpdated"\) \{([\s\S]*?)\n\s*\}\n\n\s*if \(message\.type === "forceRefresh"\)/
  )[1];

  assert.match(
    configUpdatedSource,
    /deps\.getConfigUpdatedHandler\(\)\.handleMessage\(message\)/
  );
  assert.match(
    handlerSource,
    /if \(!forceReloadPageEntry\) \{[\s\S]*?deps\.mergeDraftEntry\(loadedConfig, pageUrl, draftEntry, savedEntry\);/
  );
  assert.match(
    handlerSource,
    /const reloadedEntry = backendEntry \|\| loadedEntry \|\| null;[\s\S]*?deps\.setSavedPageEntry\(pageUrl, reloadedEntry\);/
  );
  assert.doesNotMatch(
    handlerSource,
    /forceReloadPageEntry[\s\S]*?syncPageMarkings\(loadedConfig, pageUrl/
  );
});
