import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { deriveDictation } from "../src/background/brain/deciders/dictation-decider.js";
import { decideSessionPhase } from "../src/background/brain/deciders/session-phase-decider.js";
import { AI_RUN_PHASES, BUTTON_IDS } from "../src/common/bus/contracts/session-state.js";

test("preview exit restores a captured marking-session snapshot before payload fallback", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const popupStateSource = readFileSync(new URL("../src/popup/state.ts", import.meta.url), "utf8");

  assert.match(
    popupSource,
    /function buildPreviewViewState\(previewState(?:\s*:\s*[^)]*)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?previewWillRestoreMarking: Boolean\([\s\S]*?\(previewState\.previousEnabled \|\| previewState\.restoreMarkingOnExit\)/
  );
  assert.match(
    popupSource,
    /async function handleExitPreviewMode\(\) \{[\s\S]*?const currentView = uiModule\.getViewState\(\);[\s\S]*?const shouldRestoreMarking = Boolean\(currentView\.previewWillRestoreMarking\);[\s\S]*?const previewRestoreToken = shouldRestoreMarking[\s\S]*?\? beginPreviewRestorePending\(\)[\s\S]*?: null;[\s\S]*?messages\.requestTabCloseAiPreview\(tabId, \{\s*previewRestoreToken\s*\}\)/
  );
  assert.match(
    popupSource,
    /async function handleExitPreviewMode\(\) \{[\s\S]*?if \(!previewCloseIndicatesNavigation\(closeResult\) && restoreMarkingSessionSnapshot\(\)\) \{[\s\S]*?const closeDraftStatus = closeResult && closeResult\.draftStatus[\s\S]*?if \(closeResult && closeResult\.markingEnabled\) \{[\s\S]*?applyDraftStatusToPopupState\(closeDraftStatus\);[\s\S]*?\}[\s\S]*?if \(previewRestoreToken !== null\) \{[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?state\.previewRestoreAppliedToken = Math\.max\(\s*state\.previewRestoreAppliedToken,\s*previewRestoreToken\s*\);[\s\S]*?\}[\s\S]*?await refreshUi\(\{[\s\S]*?preserveCurrentDraftStatus: true[\s\S]*?\}\)(?:\.catch\(\(\) => null\))?;[\s\S]*?clearMarkingSessionSnapshot\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(closeResult && \(typeof closeResult\.markingEnabled === "boolean" \|\| closeResult\.draftStatus\)\) \{[\s\S]*?await applyPreviewClosedState\(closeResult\);/
  );
  assert.match(
    popupSource,
    /function previewCloseIndicatesNavigation\(closeState(?:\s*:\s*[^=]+)? = \{\}\) \{[\s\S]*?const nextBaseUrl = typeof normalizedCloseState\.baseUrl === "string"[\s\S]*?return Boolean\([\s\S]*?state\.currentBaseUrl[\s\S]*?nextBaseUrl[\s\S]*?!utils\.sameBaseUrl\(nextBaseUrl, state\.currentBaseUrl\)/
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
    /function captureMarkingSessionSnapshot\(\) \{[\s\S]*?currentDraftEntry:[\s\S]*?currentSavedEntry:[\s\S]*?currentDraftDirty:[\s\S]*?currentDraftAvailable:[\s\S]*?currentPageSaveReconciliation:[\s\S]*?currentPageSaveReconciliationPending:[\s\S]*?aiRunMarkingsFingerprint:[\s\S]*?aiSelectorsComputedSinceLastSubmit:[\s\S]*?aiSelectorsComputedBaseUrl:[\s\S]*?selectorsPendingConfigSync:[\s\S]*?selectorsPendingConfigSyncBaseUrl:/
  );
  assert.match(
    popupSource,
    /function restoreMarkingSessionSnapshot\(\) \{[\s\S]*?state\.currentDraftEntry =[\s\S]*?state\.currentSavedEntry =[\s\S]*?state\.currentDraftDirty =[\s\S]*?state\.currentDraftAvailable =[\s\S]*?state\.currentPageSaveReconciliation =[\s\S]*?state\.currentPageSaveReconciliationPending =[\s\S]*?state\.aiRunMarkingsFingerprint =[\s\S]*?state\.aiSelectorsComputedSinceLastSubmit =[\s\S]*?state\.aiSelectorsComputedBaseUrl =[\s\S]*?state\.selectorsPendingConfigSync =[\s\S]*?state\.selectorsPendingConfigSyncBaseUrl =/
  );
  assert.match(
    popupSource,
    /if \(previewOpened\) \{[\s\S]*?resetAiRunState\(\);[\s\S]*?captureMarkingSessionSnapshot\(\);[\s\S]*?uiModule\.setViewState\(\{/
  );
  assert.match(
    popupSource,
    /async function handleMarkingPreview\(\) \{[\s\S]*?const latestView = await refreshUiForActionGates\(\);[\s\S]*?captureMarkingSessionSnapshot\(\);[\s\S]*?messages\.requestTabShowAiPreview\(tabId, \{[\s\S]*?publishCurrentTabAiRunEvent\(AI_RUN_EVENT_TYPES\.PREVIEW_READY\);/
  );
  assert.match(
    popupSource,
    /if \(message && message\.type === "aiPreviewClosed"\) \{[\s\S]*?applyPreviewClosedState\(message\)\.catch\(\(\) => \{[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?clearMarkingSessionSnapshot\(\);[\s\S]*?\}\);/
  );
  assert.doesNotMatch(popupSource, /setPreviewBlocked/);
  assert.match(popupStateSource, /previewRestoreAppliedToken: 0,/);
  assert.match(popupSource, /function getPreviewRestoreToken\(message = \{\}\) \{/);
  assert.match(
    popupSource,
    /if \(\s*messageToken !== null &&\s*messageToken <= state\.previewRestoreAppliedToken\s*\) \{\s*return false;\s*\}/
  );
  assert.match(
    popupSource,
    /async function finalizePreviewRestoreFromRuntime\(options(?:\s*:\s*[^)]*)? = \{\}\)(?:\s*:\s*[^{]+)? \{[\s\S]*?if \(restoreMarkingSessionSnapshot\(\)\) \{[\s\S]*?clearPreviewRestorePending\(\);[\s\S]*?state\.previewRestoreAppliedToken = Math\.max\(state\.previewRestoreAppliedToken, token\);[\s\S]*?refreshUi\(\{[\s\S]*?preserveCurrentDraftStatus: true/
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
  assert.doesNotMatch(source, /deriveSecondaryGatesViewState/);
  assert.match(source, /const secondaryGatesViewState = resolveSecondaryGatesViewStatePatch\(\{/);
  assert.match(source, /Object\.assign\(nextViewState, secondaryGatesViewState\);/);
  assert.match(
    source,
    /async function refreshUiForActionGates\(\)[\s\S]*?requestPopupSessionFactsApply\([\s\S]*?latestSessionFactsPatch[\s\S]*?appliedFacts\.secondaryGates[\s\S]*?resolveSecondaryGatesViewStatePatch\(\{[\s\S]*?uiModule\.setViewState\(NEUTRAL_SECONDARY_GATES_VIEW_PATCH\);/
  );
  assert.match(previewBody, /if \(!hasCalculatedSelectorsFromConfig\(state\.currentConfig\)\) \{[\s\S]*?PopupText\.preview\.noStoredSelectors/);
  assert.match(previewBody, /if \(view\.previewLatestBlockedReason === SECONDARY_GATES_BLOCK_REASONS\.NO_STORED_SELECTORS\) \{[\s\S]*?PopupText\.preview\.noStoredSelectors/);
  assert.match(previewBody, /const selectorSet = getLatestAvailableSelectorsFromConfig\(\);/);
  assert.match(previewBody, /if \(!combineAiSelectorSet\(selectorSet\)\.length\) \{[\s\S]*?PopupText\.preview\.noStoredSelectors/);
  assert.doesNotMatch(previewBody, /getCurrentSelectorsFromConfig\(/);
});

test("silent mode gates preview, save-excludes, and Lynx checklist submission", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const previewBody = popupSource.match(
    /async function handlePreviewLatest\(\) \{([\s\S]*?)\n\}\n\nasync function handleExitPreviewMode/
  )[1];
  const saveExcludesBody = popupSource.match(
    /async function handleSaveExcludes\(\) \{([\s\S]*?)\n\}\n\nasync function handlePreviewLatest/
  )[1];
  const sendBody = popupSource.match(
    /async function handleLynxChecklistSend\(\) \{([\s\S]*?)\n\}\n\nasync function handleSaveExcludes/
  )[1];

  assert.match(
    popupSource,
    /const silentModeActive =[\s\S]*?resolvedView === uiModule\.View\.Marking[\s\S]*?!isEnabled;/
  );
  assert.match(
    popupSource,
    /Object\.assign\(nextViewState, secondaryGatesViewState\);/
  );
  assert.match(
    popupSource,
    /nextViewState\.cssSelectorsVisible = silentModeActive;/
  );
  assert.match(previewBody, /if \(view\.previewLatestBlockedReason !== SECONDARY_GATES_BLOCK_REASONS\.NONE\) \{\s*return;\s*\}/);
  assert.match(saveExcludesBody, /if \(view\.saveExcludesBlockedReason !== SECONDARY_GATES_BLOCK_REASONS\.NONE\) \{\s*return;\s*\}/);
  assert.match(sendBody, /const view = await refreshUiForActionGates\(\);[\s\S]*?if \(view\.lynxChecklistSendBlockedReason\) \{/);
  assert.doesNotMatch(sendBody, /aiAnswer:/);
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

test("popup auth transport stays in the background layer", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const validateBody = popupSource.match(
    /async function validateStoredToken\(options(?:\s*:\s*[^)]*)? = \{\}\) \{([\s\S]*?)\n\}\n\nasync function clearFocusedElement/
  )[1];
  const loginBody = popupSource.match(
    /async function handleLoginAction\(\) \{([\s\S]*?)\n\}\n\nasync function alignPopupToSilentMode/
  )[1];

  assert.match(validateBody, /type: "validateAuthToken"/);
  assert.match(validateBody, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(validateBody, /fetch\(|buildValidateEndpointFromStageBase|maybeUpdateStoredTokenFromResponse/);
  assert.match(loginBody, /type: "requestAuthLogin"/);
  assert.match(loginBody, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(loginBody, /fetch\(|buildLoginEndpointFromStageBase|maybeUpdateStoredTokenFromResponse/);
});

test("popup remote page removal delegates privileged network transport to the background", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const removeBody = popupSource.match(
    /async function removePageMarkingFromRemote\(options(?:\s*:\s*[^)]+)? = \{\}\) \{([\s\S]*?)\n\}\n\nasync function pruneRemoteInvalidPageMarkings/
  )[1];

  assert.match(removeBody, /type: "removeRemotePageMarking"/);
  assert.match(removeBody, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(removeBody, /fetch\(|maybeUpdateStoredTokenFromResponse|createConfigSyncHeaders/);
});

test("popup render-mode detection delegates heavy network transport to the background", () => {
  const popupSource = readFileSync(new URL("../src/popup/render-mode-inspection.ts", import.meta.url), "utf8");
  const detectBody = popupSource.match(
    /export async function detectRenderModeViaEndpoint\(deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^)]+)? = \{\}\)(?:\s*:\s*[^{]+)? \{([\s\S]*?)\n\}\n\nexport async function maybeAutoDetectRenderMode/
  )[1];

  assert.match(detectBody, /type: "requestRenderModeDetection"/);
  assert.match(detectBody, /const requestPayloadKey = deps\.buildTransferPayloadKey\("render-mode-request"\);/);
  assert.match(detectBody, /const stored = await deps\.putTransferPayload\("render-mode-request", \{/);
  assert.doesNotMatch(detectBody, /fetch\(detectUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
});

test("popup hydrates property-lock timer and recovery state from the initial tab snapshot", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const propertyLockUiSource = readFileSync(new URL("../src/popup/property-lock-ui.ts", import.meta.url), "utf8");
  const propertyLockDeciderSource = readFileSync(new URL("../src/background/brain/deciders/property-lock-decider.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

  assert.match(propertyLockUiSource, /export function syncPropertyLockOffCandidateRefreshTimer\(deps(?:\s*:\s*[^,]+)?, active(?:\s*:\s*[^)]+)?\) \{/);
  assert.match(popupSource, /state\.propertyLockOffCandidateDeadlineAt =\s*initialTabState && Number\.isFinite\(initialTabState\.propertyLockOffCandidateDeadlineAt\)/);
  assert.match(
    popupSource,
    /syncPropertyLockOffCandidateRefreshTimer\(\s*hasProjectedPropertyLockDeadlineTimerForTab\(currentTabId\)\s*\|\|[\s\S]*state\.propertyLockOffCandidateDeadlineAt[\s\S]*state\.propertyLockRecoveryDeadlineAt[\s\S]*\);/
  );
  assert.match(popupSource, /state\.propertyLockRecoverySiteId =\s*initialTabState && Number\.isFinite\(initialTabState\.propertyLockRecoverySiteId\)/);
  assert.match(popupSource, /state\.propertyLockRecoveryBaseUrl =\s*initialTabState && typeof initialTabState\.propertyLockRecoveryBaseUrl === "string"/);
  assert.match(popupSource, /state\.propertyLockRecoveryClientId =\s*initialTabState && typeof initialTabState\.propertyLockRecoveryClientId === "string"/);
  assert.match(popupSource, /state\.propertyLockRecoveryDeadlineAt =\s*initialTabState && Number\.isFinite\(initialTabState\.propertyLockRecoveryDeadlineAt\)/);
  assert.match(popupSource, /const persistedRecoveryState = \{\s*siteId: state\.propertyLockRecoverySiteId,\s*baseUrl: state\.propertyLockRecoveryBaseUrl,\s*clientId: state\.propertyLockRecoveryClientId,\s*deadlineAt: state\.propertyLockRecoveryDeadlineAt\s*\};/);
  assert.match(popupSource, /const recoveryBaseUrl =\s*state\.propertyLockRecoveryBaseUrl \|\| persistedRecoveryState\.baseUrl \|\| "";/);
  assert.match(popupSource, /const isOutsideRecoveryBaseUrl = Boolean\(\s*hasPersistedRecoverySession &&\s*pageUrl &&\s*!utils\.isPageWithinBaseUrl\(pageUrl, recoveryBaseUrl\)\s*\);/);
  assert.match(popupSource, /if \(hasPersistedRecoverySession && isOutsideRecoveryBaseUrl\) \{\s*const nextRecoveryDeadlineAt = recoveryDeadlineAt > Date\.now\(\)\s*\?\s*recoveryDeadlineAt\s*:\s*Date\.now\(\) \+ PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS;/);
  assert.match(popupSource, /state\.propertyLockRecoveryBaseUrl = recoveryBaseUrl;/);
  assert.match(popupSource, /state\.propertyLockRecoveryDeadlineAt = nextRecoveryDeadlineAt;/);
  assert.match(popupSource, /deadlineAt: nextRecoveryDeadlineAt/);
  assert.match(popupSource, /const propertyLockScopeSiteId = isPropertyLockCollaborationEnabled\(\)\s*\?[\s\S]*?state\.propertyLockRecoveryDeadlineAt > Date\.now\(\) && state\.propertyLockRecoverySiteId[\s\S]*?state\.propertyLockRecoverySiteId\s*:\s*liveSiteId[\s\S]*?: null;/);
  assert.match(popupSource, /await refreshPropertyLockSnapshot\(propertyLockScopeSiteId,\s*\{\s*skipFetch: skipPropertyLockFetch\s*\}\s*\);/);
  assert.match(popupSource, /resetDisabledPropertyLockState\(\);/);
  assert.match(popupSource, /Object\.assign\(\s*nextViewState,\s*buildPropertyLockViewState\(\)\s*\);/);
  assert.match(propertyLockUiSource, /state\.propertyLockRecoverySiteId === normalizedSiteId\s*\?\s*state\.propertyLockRecoveryClientId/);
  assert.match(propertyLockUiSource, /projection\.timerState\.source === PROPERTY_LOCK_TIMER_SOURCES\.DEADLINE/);
  assert.match(propertyLockDeciderSource, /deps\.propertyLockText\.popupOffCandidateWarning\(\s*timerState\.secondsRemaining\s*\)/);
  assert.match(propertyLockDeciderSource, /deps\.propertyLockText\.popupCrossPropertyWarning\(\s*timerState\.secondsRemaining\s*\)/);
  assert.match(backgroundSource, /nextState\.propertyLockOffCandidateDeadlineAt = Number\.isFinite\(message\.state\.propertyLockOffCandidateDeadlineAt\)/);
  assert.match(backgroundSource, /nextState\.propertyLockRecoverySiteId = Number\.isFinite\(message\.state\.propertyLockRecoverySiteId\)/);
  assert.match(backgroundSource, /nextState\.propertyLockRecoveryClientId = typeof message\.state\.propertyLockRecoveryClientId === "string"/);
  assert.match(backgroundSource, /nextState\.propertyLockRecoveryDeadlineAt = Number\.isFinite\(message\.state\.propertyLockRecoveryDeadlineAt\)/);
});

test("desktop preview stays behind its own popup toggle and disables marking entry while active", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.tsx", import.meta.url), "utf8");
  const desktopToggleStart = popupSource.indexOf("async function handleDesktopPreviewEnabledToggle(");
  const desktopToggleEnd = popupSource.indexOf("function handleDeviceScaleInput", desktopToggleStart);
  assert.ok(desktopToggleStart >= 0 && desktopToggleEnd > desktopToggleStart);
  const desktopToggleBody = popupSource.slice(desktopToggleStart, desktopToggleEnd);

  assert.match(popupSource, /const desktopPreviewVisible = Boolean\(\s*desktopPreviewFeatureEnabled &&\s*silentModeActive &&/);
  assert.match(popupSource, /const desktopPreviewActive = Boolean\(\s*desktopPreviewVisible && state\.currentDesktopPreviewEnabled\s*\);/);
  assert.match(popupSource, /const secondaryGatesViewState = resolveSecondaryGatesViewStatePatch\(\{/);
  assert.match(popupSource, /nextViewState\.desktopPreviewNoticeVisible = secondaryGatesViewState\.desktopPreviewEnabled;/);
  assert.match(desktopToggleBody, /if \(!isFeatureEnabled\("desktopPreview"\)\) \{\s*return;\s*\}/);
  assert.match(desktopToggleBody, /if \(\s*desiredEnabled &&\s*\(\s*!currentView\.desktopPreviewVisible \|\|[\s\S]*?currentView\.desktopPreviewBlockedReason !== SECONDARY_GATES_BLOCK_REASONS\.NONE/);
  assert.match(desktopToggleBody, /if \(desiredEnabled && currentView\.toggleEnabled\) \{/);
  assert.match(desktopToggleBody, /await handleEnableToggle\(\{ currentTarget: \{ checked: false \} \}\);/);
  assert.match(desktopToggleBody, /await persistDesktopPreviewEnabled\(tab\.id, desiredEnabled\);/);
  assert.match(uiSource, /isPopupFeatureEnabled\(view, "desktopPreview"\) && view\.desktopPreviewVisible/);
  assert.match(uiSource, /id="desktop-preview-enabled"/);

  const dictation = deriveDictation(decideSessionPhase({
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: false,
    pageInspectionBusy: false,
    desktopPreviewVisible: true,
    desktopPreviewActive: true,
    deviceControlsDisabled: false,
    isEnabled: true,
    silentModeActive: false,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.PRE_AI,
    aiRunUpToDate: false,
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false,
    sessionHasPendingChanges: false,
    sessionRequiresAiRun: false,
    currentDraftDirty: false,
    pageSaveReconciliationPending: false,
    propertyLockBlocked: false,
    saving: false,
    discarding: false,
    hasStoredSelectors: true,
    lynxChecklistCanSend: false,
    lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: ""
  }), {
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: false,
    pageInspectionBusy: false,
    desktopPreviewVisible: true,
    desktopPreviewActive: true,
    deviceControlsDisabled: false,
    isEnabled: true,
    silentModeActive: false,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.PRE_AI,
    aiRunUpToDate: false,
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false,
    sessionHasPendingChanges: false,
    sessionRequiresAiRun: false,
    currentDraftDirty: false,
    pageSaveReconciliationPending: false,
    propertyLockBlocked: false,
    saving: false,
    discarding: false,
    hasStoredSelectors: true,
    lynxChecklistCanSend: false,
    lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: ""
  });
  assert.equal(dictation.buttons[BUTTON_IDS.TOGGLE_ENABLED].enabled, false);
});

test("marking-mode preview remains a dedicated marking control", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/popup/ui.tsx", import.meta.url), "utf8");
  const markingPreviewBody = popupSource.match(
    /async function handleMarkingPreview\(\) \{([\s\S]*?)\n\}\n\nasync function handleExitPreviewMode/
  )[1];

  assert.match(uiSource, /if \(markingMode && view\.markingPreviewVisible\) \{/);
  assert.match(uiSource, /id="marking-preview"/);
  assert.match(uiSource, /onClick=\{handlers\.onMarkingPreview\}/);
  assert.match(markingPreviewBody, /if \(!view\.markingPreviewVisible \|\| view\.markingPreviewDisabled\) \{/);
  assert.match(markingPreviewBody, /const selectorSet = getLatestAvailableSelectorsFromConfig\(\);/);
  assert.match(markingPreviewBody, /messages\.requestTabShowAiPreview\(tabId, \{/);

  const readyToSaveFacts = {
    baseUrlReady: true,
    pageScopedUiDisabled: false,
    navigationInspectionPending: false,
    siteIdReady: true,
    renderModeReady: true,
    pageTypeUiBlocked: false,
    currentPageHasPendingChanges: true,
    pageInspectionBusy: false,
    desktopPreviewVisible: false,
    desktopPreviewActive: false,
    deviceControlsDisabled: false,
    isEnabled: true,
    silentModeActive: false,
    aiReady: true,
    aiBusy: false,
    aiComputing: false,
    aiRunPhase: AI_RUN_PHASES.POST_AI,
    aiRunUpToDate: true,
    previewActive: false,
    previewBlocked: false,
    previewItemsPending: false,
    previewRestorePending: false,
    sessionHasPendingChanges: true,
    sessionRequiresAiRun: false,
    currentDraftDirty: true,
    pageSaveReconciliationPending: false,
    propertyLockBlocked: false,
    saving: false,
    discarding: false,
    hasStoredSelectors: true,
    lynxChecklistCanSend: false,
    lynxChecklistBlockingReason: { code: "", pageTypeKeys: [] },
    busyVisible: false,
    busyMessage: "",
    busyNote: "",
    busyTimerText: ""
  };
  const dictation = deriveDictation(decideSessionPhase(readyToSaveFacts), readyToSaveFacts);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].visible, true);
  assert.equal(dictation.buttons[BUTTON_IDS.MARKING_PREVIEW].enabled, true);
});

test("popup preview sidebar keeps the active-item scroll path on a synchronous React commit", () => {
  const uiSource = readFileSync(new URL("../src/popup/ui.tsx", import.meta.url), "utf8");

  assert.match(uiSource, /import \{ flushSync \} from "react-dom";/);
  assert.match(
    uiSource,
    /flushSync\(\(\) => \{\s*if \(!reactRoot \|\| reactRootElement !== root\) \{\s*reactRootElement = root;\s*reactRoot = createPopupRoot\(root\);\s*\}\s*reactRoot\.render\(<App state=\{viewState\} actions=\{actions\} \/>\);\s*\}\);/
  );
  assert.match(uiSource, /const previewActiveItem = refs\.previewActiveItem as HTMLElement \| null;/);
  assert.match(uiSource, /previewActiveItem\.scrollIntoView\(\{/);
});

test("popup React root wires render recovery through root error hooks", () => {
  const uiSource = readFileSync(new URL("../src/popup/ui.tsx", import.meta.url), "utf8");

  assert.match(uiSource, /function schedulePopupRenderRecovery\(rootElement: HTMLElement, error: unknown\): void \{/);
  assert.match(uiSource, /queueMicrotask\(\(\) => \{/);
  assert.match(uiSource, /return createRoot\(rootElement, \{\s*onCaughtError\(error\) \{\s*schedulePopupRenderRecovery\(rootElement, error\);/);
  assert.match(uiSource, /onUncaughtError\(error\) \{\s*schedulePopupRenderRecovery\(rootElement, error\);/);
});

test("periodic page-type refresh stays quiet unless candidates change", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const refreshBody = source.match(
    /function schedulePropertyPageTypesRefresh\(options(?:\s*:\s*[^)]+)? = \{\}\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*function formatPageTypeCandidateLabel/
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
    /async function refreshUiInner\(options(?:\s*:\s*[^)]*)? = \{\}\) \{([\s\S]*?)\n\}\n\nasync function maybeResumePersistedAiRun/
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
  assert.match(applyLocalPageDiscardBody, /helpers\.loadGlobalAiSettings\(\)/);
  assert.match(applyLocalPageDiscardBody, /ensureBaseUrlSiteId\(\{[\s\S]*?persist: false/);
  assert.match(applyLocalPageDiscardBody, /loadRemoteConfigForCurrentPage\(\{[\s\S]*?force: true/);
  assert.doesNotMatch(applyLocalPageDiscardBody, /config\.getBackendSavedPageMarkings\(baseUrl\)/);
  assert.doesNotMatch(applyLocalPageDiscardBody, /findBackendSavedPageMarkingEntry/);
  assert.doesNotMatch(applyLocalPageDiscardBody, /config\.updateConfig/);
  assert.match(applyLocalPageDiscardBody, /messages\.requestTabApplyLocalDiscard\(tabId, \{ baseUrl \}\)/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_LOCAL_DISCARD, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /type: "configUpdated",[\s\S]*?forceReloadPageEntry: true/);
  assert.match(source, /void messages\.requestTabApplyPostSaveTransition\(tabId, \{ baseUrl \}\);/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_APPLY_POST_SAVE_TRANSITION, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /type: "setEnabled",[\s\S]*?enabled: false/);
  assert.doesNotMatch(applyLocalPageDiscardBody, /validateStoredToken/);
  assert.match(applyLocalPageDiscardBody, /await clearCurrentPageSaveReconciliation\(\);/);
  // Discard/save must not block the spinner on slow tab roundtrips: the popup is
  // already PRE_AI/silent-clean locally, so the content apply fires best-effort.
  assert.match(applyLocalPageDiscardBody, /void messages\.requestTabApplyLocalDiscard\(tabId, \{ baseUrl \}\)/);
  assert.doesNotMatch(applyLocalPageDiscardBody, /await messages\.requestTabApplyLocalDiscard/);
  assert.doesNotMatch(source, /await messages\.requestTabApplyPostSaveTransition/);
  assert.match(handlePageRevertHandlerBody, /const blockedReason = typeof currentViewState\.pageRevertBlockedReason === "string"/);
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

test("tab reload keeps the inspection curtain active while enabled pages re-inspect", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(source, /async function waitForEnableMarkingInspectionToSettle\(\s*tabId(?:\s*:\s*[^,)]+)?,\s*baseUrl(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{/);
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
  assert.match(source, /function beginNavigationInspectionOverlay\(tabId(?:\s*:\s*[^)]*)?\)(?:\s*:\s*[^{]+)? \{/);
  assert.match(source, /function endNavigationInspectionOverlay\(tabId = popupNavigationInspectionOverlayTabId\) \{/);
  assert.match(
    source,
    /function scheduleNavigationInspectionSettlePoll\(tabId(?:: [^,)]+)?, baseUrl(?:: [^,)]+)?\)(?:: [^{]+)? \{/
  );
  assert.match(source, /function clearNavigationInspectionSettlePollsExcept\(tabIdToKeep(?:\s*:\s*[^=]+)? = null\) \{/);
  assert.match(source, /const popupNavigationInspectionSettlePollByTabId = new Map(?:<[^;]+>)?\(\);/);

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
    /function beginNavigationInspectionOverlay\(tabId(?:\s*:\s*[^)]*)?\)(?:\s*:\s*[^{]+)? \{([\s\S]*?)\n\}/
  )[1];
  assert.match(beginBody, /clearNavigationInspectionSettlePollsExcept\(tabId\);/);
  const endBody = source.match(
    /function endNavigationInspectionOverlay\(tabId = popupNavigationInspectionOverlayTabId\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(endBody, /reportNavigationInspectionSettledToBrain\(tabId, "nav-overlay-end"\);/);
  assert.doesNotMatch(endBody, /removeSpinnerEntryFromBackground\("navInspect", tabId\)/);

  const snapshotApplyBody = source.match(
    /function applyPopupViewSnapshot\(snapshot(?:: [^)]+)?\) \{([\s\S]*?)\n\}/
  )[1];
  assert.match(snapshotApplyBody, /activation: snapshot\.activation \|\| null,/);

  const refreshBody = source.match(
    /async function refreshUiInner\(options(?:\s*:\s*[^)]*)? = \{\}\) \{([\s\S]*?)\n\}\n\nasync function maybeResumePersistedAiRun/
  )[1];
  assert.match(refreshBody, /const persistedTabState = await messages\.getTabState\(state\.currentTab\.id\);/);
  assert.match(refreshBody, /type: "clearReloadRestoreTabState"/);
  assert.doesNotMatch(refreshBody, /messages\.getTabState\(state\.currentTab\.id, "restore"\)/);
  assert.match(refreshBody, /await messages\.sendTabMessageToTab\(currentTabId, \{ type: "getInspectionStatus" \}\)/);
  assert.match(refreshBody, /contentInspectionPending/);
  assert.match(refreshBody, /let latestRuntimeStatus = null;/);
  assert.match(refreshBody, /const runtimeStatusBaseUrl = state\.currentBaseUrl \|\| effectiveTabState\.baseUrl \|\| "";/);
  assert.doesNotMatch(refreshBody, /latestRuntimeResponseObserved/);
  assert.match(refreshBody, /inspectionStatus = latestRuntimeStatus\.inspectionStatus;/);
  assert.match(refreshBody, /const backgroundActivationInspectionPending = Boolean\(/);
  assert.match(refreshBody, /popupBackgroundStateTabId === currentTabId/);
  assert.match(refreshBody, /popupBackgroundActivation\.bootstrapStatus === "bootstrapping"/);
  assert.match(refreshBody, /!navigationInspectionPending &&\s*\(!siteIdReady \|\| !renderModeReady \|\| pageTypeUiBlocked\)/);
  assert.doesNotMatch(refreshBody, /const pageScopedUiDisabled =[\s\S]*pageTypeUiBlocked && !navigationInspectionPending/);
  assert.match(refreshBody, /const mainUiHidden =[\s\S]*?!isEnabled[\s\S]*?\(!navigationInspectionPending && \(!siteIdReady \|\| !renderModeReady\)\)/);
  assert.doesNotMatch(refreshBody, /useLocalSessionAuthorityFallback/);
  assert.match(refreshBody, /applyCentralSessionDictation\(nextViewState, currentTabId\);/);
});

test("tab activation does not end persisted inspection overlay before old-tab spinner state is cleared", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const onActivatedBlock = source.match(
    /browser\.tabs\.onActivated\.addListener\(async \(\{ tabId \}\) => \{([\s\S]*?)\n {2}\}\);\n\n {2}browser\.tabs\.onUpdated/
  )[1];

  assert.doesNotMatch(onActivatedBlock, /endNavigationInspectionOverlay\(/);
  assert.match(onActivatedBlock, /clearSpinnerQueueInBackground\(oldTabId, \{ transientOnly: true \}\)\.catch\(\(\) => \{\}\);/);
  assert.match(onActivatedBlock, /clearNavigationInspectionSettlePollsExcept\(\);/);
  assert.match(onActivatedBlock, /clearProjectedPopupSpinnerSurfaces\(\);/);
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
    /function hasSessionPendingChanges\(\s*sourceConfig(?:\s*:\s*[^,)]+)?,\s*localPageMarkings(?:\s*:\s*[^,)]+)?,\s*backendSavedPageMarkings(?:\s*:\s*[^,)]+)?,\s*options(?:\s*:\s*[^)]+)? = \{\}\s*\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(pendingBody, /options\.currentDraftDirty/);
  assert.match(pendingBody, /options\.reconciliationPending/);
  assert.match(pendingBody, /hasSessionPageMarkingChanges\(localPageMarkings, backendSavedPageMarkings\)/);
  assert.doesNotMatch(pendingBody, /areCurrentSelectorsSubmitted|submittedSelectorsFingerprint/);
});

test("marking enable upgrades the popup spinner to page inspection during reveal warmup", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const spinnerSource = readFileSync(new URL("../src/popup/spinner.ts", import.meta.url), "utf8");
  const runWithSpinnerBody = spinnerSource.match(
    /export async function runWithSpinner(?:<[^>]+>)?\(\s*deps(?:\s*:\s*[^,]+)?,\s*key(?:\s*:\s*[^,]+)?,\s*message(?:\s*:\s*[^,]+)?,\s*task(?:\s*:\s*[^,]+)?,\s*options(?:\s*:\s*[^=]+)? = \{\}\s*\)(?::\s*[^{]+)? \{([\s\S]*?)\n\}/
  )[1];
  const enableBody = source.match(
    /async function handleEnableToggle\(event(?:\s*:\s*[^)]*)?\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function handleDeviceEmulationEnabledToggle/
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
    /async function handleEnableToggle\(event(?:\s*:\s*[^)]*)?\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /const pendingKnownFromCurrentView = Boolean\([\s\S]*?!desiredEnabled && currentViewState\.sessionHasPendingChanges[\s\S]*?\);/);
  assert.match(enableBody, /const showImmediateDisableSpinner = \(\) => \{[\s\S]*?pushSpinner\(null, PopupText\.overlay\.disablingMarking, \{[\s\S]*?delayMs: 0,[\s\S]*?reason: "marking-disable"/);
  assert.match(enableBody, /if \(!desiredEnabled\) \{\s*showImmediateDisableSpinner\(\);\s*\}[\s\S]*?tab = await helpers\.ensureActiveTab\(\{ requireId: true, requireUrl: true \}\);/);
  assert.match(enableBody, /if \(!desiredEnabled && !pendingKnownFromCurrentView\) \{[\s\S]*?showImmediateDisableSpinner\(\);[\s\S]*?await refreshCurrentPageRuntimeStatus\(\{[\s\S]*?tabId: tab\.id,[\s\S]*?baseUrl: state\.currentBaseUrl[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?latestViewState = uiModule\.getViewState\(\);/);
  assert.match(enableBody, /if \(!desiredEnabled && latestViewState\.sessionHasPendingChanges\)/);
  assert.match(enableBody, /clearImmediateDisableSpinner\(\);[\s\S]*?const confirmedDiscard = window\.confirm\(PopupText\.page\.disableDiscardConfirm\);/);
  assert.match(enableBody, /PopupText\.page\.exitRequiresAiResolution/);
  assert.match(enableBody, /PopupText\.page\.exitRequiresResolution/);
  assert.match(enableBody, /const confirmedDiscard = window\.confirm\(PopupText\.page\.disableDiscardConfirm\);/);
  assert.match(enableBody, /if \(!confirmedDiscard\) \{[\s\S]*?uiModule\.setViewState\(\{ toggleEnabled: true \}\)[\s\S]*?setLastPopupEnabled\(true, buildPopupEnabledContext\(tab, state\.currentBaseUrl\)\)[\s\S]*?return;/);
  assert.match(enableBody, /showImmediateDisableSpinner\(\);[\s\S]*?await applyLocalPageDiscard\(\);/);
  assert.match(enableBody, /desiredEnabled \? null : immediateDisableSpinnerKey,[\s\S]*?\{[\s\S]*?delayMs: desiredEnabled \? POPUP_BUSY_OVERLAY_DELAY_MS : 0[\s\S]*?\}/);
});

test("popup scopes optimistic enabled state to the current tab page and base URL", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(source, /lastPopupEnabledContext/);
  assert.match(source, /function buildPopupEnabledContext\(tab(?:\s*:\s*[^=]+)? = state\.currentTab, baseUrl(?:\s*:\s*[^=]+)? = state\.currentBaseUrl\)(?:\s*:\s*[^{]+)? \{/);
  assert.match(source, /function isPopupEnabledContextCurrent\(\s*context(?:\s*:\s*[^)]+)?,\s*currentContext(?:\s*:\s*[^)]+)? = buildPopupEnabledContext\(\)\s*\) \{/);
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
