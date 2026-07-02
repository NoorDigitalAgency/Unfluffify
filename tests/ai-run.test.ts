import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  AI_RUN_POLL_INTERVAL_MS,
  AI_RUN_RESUME_TTL_MS,
  formatAiRunCountdown,
  getAiRunRemainingMs,
  getAiRunResumeExpiresAt,
  parseAiRunStartResponse,
  parseAiRunStatusResponse,
  normalizePersistedAiRunRecord,
  shouldResumePersistedAiRun
} from "../src/popup/ai-run.js";

test("AI run polling uses a five second cadence", () => {
  assert.equal(AI_RUN_POLL_INTERVAL_MS, 5_000);
});

test("AI run countdown formats remaining time as m:ss", () => {
  assert.equal(formatAiRunCountdown(300_000), "5:00");
  assert.equal(formatAiRunCountdown(241_000), "4:01");
  assert.equal(formatAiRunCountdown(999), "0:01");
  assert.equal(formatAiRunCountdown(0), "0:00");
});

test("AI run remaining time clamps at zero", () => {
  assert.equal(getAiRunRemainingMs(10_000, 8_000), 2_000);
  assert.equal(getAiRunRemainingMs(10_000, 10_000), 0);
  assert.equal(getAiRunRemainingMs(10_000, 12_000), 0);
});

test("AI run resume expiry uses the configured recovery window", () => {
  assert.equal(getAiRunResumeExpiresAt(50_000), 50_000 + AI_RUN_RESUME_TTL_MS);
});

test("AI run start response only accepts the expected session payload", () => {
  assert.equal(parseAiRunStartResponse({ session_id: "abc" }), "abc");
  assert.equal(parseAiRunStartResponse({ session_id: "abc", status: "running" }), "");
  assert.equal(parseAiRunStartResponse({}), "");
  assert.equal(parseAiRunStartResponse(null), "");
});

test("AI run status response accepts only known statuses with a session id", () => {
  assert.deepEqual(
    parseAiRunStatusResponse({ session_id: "abc", status: "running" }),
    { sessionId: "abc", status: "running" }
  );
  assert.deepEqual(
    parseAiRunStatusResponse({ session_id: "abc", status: "DONE" }),
    { sessionId: "abc", status: "done" }
  );
  assert.equal(parseAiRunStatusResponse({ session_id: "abc", status: "pending" }), null);
  assert.equal(parseAiRunStatusResponse({ status: "running" }), null);
});

test("persisted AI run records normalize and validate the current site", () => {
  const record = normalizePersistedAiRunRecord({
    sessionId: " session-1 ",
    siteId: " 9 ",
    expiresAt: 20_000,
    deadlineAt: 300_000
  });
  assert.deepEqual(record, {
    sessionId: "session-1",
    siteId: 9,
    expiresAt: 20_000,
    deadlineAt: 300_000
  });
  assert.equal(shouldResumePersistedAiRun(record, 9, 19_999), true);
  assert.equal(shouldResumePersistedAiRun(record, "9", 19_999), true);
  assert.equal(shouldResumePersistedAiRun(record, 9, 20_000), false);
  assert.equal(shouldResumePersistedAiRun(record, 8, 19_999), false);
  assert.equal(normalizePersistedAiRunRecord({ sessionId: "s", siteId: "site-9" }), null);
  assert.equal(normalizePersistedAiRunRecord({ sessionId: "", siteId: "x" }), null);
});

test("AI compute shows busy feedback and locks marking before payload work", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const aiRunOrchestratorSource = readFileSync(new URL("../src/background/ai-run-orchestrator.ts", import.meta.url), "utf8");
  const match = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  );
  assert.ok(match, "handleComputeSelectors body should be found");
  const body = match[1];
  const activeIndex = body.indexOf("setAiRunActiveState({");
  const firstPaintIndex = body.indexOf("await waitForPopupUiPaint();", activeIndex);
  const runCommandIndex = body.indexOf("messages.requestTabRunAi(tabId, {", firstPaintIndex);

  const runAiPattern = /async function runAiCommandForTab\(tabId(?:\s*:\s*[^,]+)?, payload(?:\s*:\s*[^,]+)?, update(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?await setAiComputeLockForTab\([\s\S]*?await prepareAiRunPayloadSnapshot\(\{/;

  assert.ok(activeIndex >= 0, "AI run state should be activated");
  assert.ok(firstPaintIndex > activeIndex, "popup should yield for busy feedback before locking");
  assert.ok(runCommandIndex > firstPaintIndex, "AI command should run after busy feedback is visible");
  assert.match(aiRunOrchestratorSource, runAiPattern);
  assert.match(backgroundSource, /TAB_RUN_AI: "TAB_RUN_AI"/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RUN_AI, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /publishBackgroundAiRunEvent\(normalizedTabId, AI_RUN_EVENT_TYPES\.STARTED/);
  assert.doesNotMatch(backgroundSource, /key: `run-ai:\$\{normalizedTabId\}`[\s\S]*?withBackgroundTabSpinner/);
  assert.match(backgroundSource, /from "\.\/background\/ai-run-orchestrator"/);
  assert.match(backgroundSource, /const aiRunOrchestrator = createAiRunOrchestrator\(\{/);
  assert.match(aiRunOrchestratorSource, /async function prepareAiRunPayloadSnapshot\(options(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  assert.match(aiRunOrchestratorSource, /fetchStaticPageHtmlForBackground/);
  assert.match(aiRunOrchestratorSource, /await update\(\{[\s\S]*?reason: "tab-run-ai-running"/);
});

test("selector submit paints busy feedback before save-side runtime work", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const match = source.match(
    /async function submitSelectorSetToServer\(options(?:\s*:\s*[^=]+)? = \{\}\) \{([\s\S]*?)\n\}\n\nasync function handleLynxChecklistSend/
  );

  assert.ok(match, "submitSelectorSetToServer body should be found");
  const body = match[1];
  const activeIndex = body.indexOf('state.aiRequestInFlight = "save";');
  const busyPatchIndex = body.indexOf("saveExcludesButtonLoading: true", activeIndex);
  const savingStartIndex = body.indexOf("saving: true", busyPatchIndex);
  const firstPaintIndex = body.indexOf("await waitForPopupUiPaint();", savingStartIndex);
  const statusRefreshIndex = body.indexOf("await refreshCurrentPageRuntimeStatus({ baseUrl });", firstPaintIndex);
  const submitIndex = body.indexOf('type: "submitSelectorSetGraphqlUpdate"', statusRefreshIndex);

  assert.match(
    body,
    /uiModule\.setViewState\(\{\s*saveExcludesButtonText: ViewText\.saveExcludesBusy,\s*saveExcludesButtonLoading: true,\s*saveExcludesButtonDisabled: true,[\s\S]*?stageBaseInputDisabled: true,[\s\S]*?stageBaseSetDisabled: true,[\s\S]*?stageBaseEditDisabled: true,[\s\S]*?themeControlsDisabled: true,[\s\S]*?loginCredentialsDisabled: true,[\s\S]*?loginActionDisabled: true,[\s\S]*?configEndpointInputDisabled: true,[\s\S]*?configEndpointSetDisabled: true,[\s\S]*?configEndpointEditDisabled: true,[\s\S]*?endpointInputDisabled: true,[\s\S]*?endpointSetDisabled: true,[\s\S]*?endpointEditDisabled: true,[\s\S]*?renderModeInputDisabled: true,[\s\S]*?renderModeInspectButtonsDisabled: true,[\s\S]*?renderModeInspectWithoutJavaScriptDisabled: true,[\s\S]*?renderModeInspectWithJavaScriptDisabled: true,[\s\S]*?renderModeSetDisabled: true,[\s\S]*?renderModeEditDisabled: true[\s\S]*?\}\);/
  );
  assert.match(body, /publishCurrentTabSessionFacts\(\{\s*saving: true\s*\}\);/);
  assert.match(
    body,
    /state\.aiRequestInFlight = null;[\s\S]*?publishCurrentTabSessionFacts\(\{\s*saving: false\s*\}\);[\s\S]*?await refreshUi\(\);/
  );
  assert.ok(activeIndex >= 0, "selector submit should enter save-flight state");
  assert.ok(busyPatchIndex > activeIndex, "selector submit should synchronously patch the save button loading state after entering save-flight state");
  assert.ok(savingStartIndex > busyPatchIndex, "selector submit should publish saving facts after the local busy patch");
  assert.ok(firstPaintIndex > savingStartIndex, "selector submit should yield for the busy paint before runtime status refresh");
  assert.ok(statusRefreshIndex > firstPaintIndex, "runtime status refresh should wait until busy feedback is visible");
  assert.ok(submitIndex > statusRefreshIndex, "GraphQL submit should happen after the busy feedback and status refresh");
});

test("AI compute builds the request from stored local page snapshots only", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const aiRunOrchestratorSource = readFileSync(new URL("../src/background/ai-run-orchestrator.ts", import.meta.url), "utf8");
  void backgroundSource;
  const match = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  );

  assert.ok(match, "handleComputeSelectors body should be found");
  const body = match[1];

  assert.match(body, /const currentPageNeedsSnapshot =/);
  assert.match(
    body,
    /const currentPageNeedsSnapshot =\s*[\s\S]*?state\.currentDraftDirty[\s\S]*?!currentPageEntry[\s\S]*?!currentPageHtml[\s\S]*?!hasCurrentSubmissionXpaths/
  );
  assert.match(body, /messages\.requestTabRunAi\(tabId, \{/);
  assert.match(
    body,
    /baseUrl: state\.currentBaseUrl,[\s\S]*?currentPageUrl,[\s\S]*?pageType: state\.currentPageTypeKey \|\| "",[\s\S]*?currentRenderMode/
  );
  assert.doesNotMatch(
    body,
    /type: "capturePageSnapshot"|type: "prepareAiRunPayloadSnapshot"|type: "requestAiRunStartSnapshot"|type: "requestAiRunStatus"|type: "requestAiRunResultSnapshot"/
  );
  assert.match(
    aiRunOrchestratorSource,
    /type: "capturePageSnapshot"[\s\S]*?persist: true/
  );
  assert.match(
    aiRunOrchestratorSource,
    /await prepareAiRunPayloadSnapshot\(\{[\s\S]*?baseUrl,[\s\S]*?currentPageUrl,[\s\S]*?currentRenderMode/
  );
  assert.match(
    aiRunOrchestratorSource,
    /preparedPayload\.requiresRawXPathRefinement/
  );
  assert.match(
    aiRunOrchestratorSource,
    /refineAiRunPayloadXpathsInBackground\(startPayloadKey\)/
  );
  assert.match(
    aiRunOrchestratorSource,
    /await requestAiRunStartSnapshot\(/ 
  );
  assert.match(
    aiRunOrchestratorSource,
    /await requestAiRunStatus\(/ 
  );
  assert.match(
    aiRunOrchestratorSource,
    /await requestAiRunResultSnapshot\(/ 
  );
  assert.match(
    aiRunOrchestratorSource,
    /const storedPageEntries = Object\.entries\(pageMarkings\)/
  );
  assert.match(
    aiRunOrchestratorSource,
    /const urlsMissingRawHtml = storedPageEntries/
  );
  assert.match(
    aiRunOrchestratorSource,
    /renderedXPaths: buildAiSubmissionXpaths\(entry\)/
  );
  assert.match(
    aiRunOrchestratorSource,
    /defaultExclusionSelectors: defaultExcludedImmutableSelectors/
  );
  assert.doesNotMatch(
    body,
    /const storedPageEntries = Object\.entries\(pageMarkings\)|const rawHtmlBackfills = await backfillRawHtmlForPages|const payload = \{[\s\S]*?pages: storedPages/
  );
  assert.doesNotMatch(
    body,
    /collectAiSubmissionXpaths|savePageDraft|getPageDraftStatus/
  );
});

test("TAB_RUN_AI resolves omitted credentials from fresh settings reads", () => {
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const aiRunOrchestratorSource = readFileSync(new URL("../src/background/ai-run-orchestrator.ts", import.meta.url), "utf8");
  const networkCoreSource = readFileSync(new URL("../src/background/network-core.ts", import.meta.url), "utf8");

  assert.match(backgroundSource, /from "\.\/background\/network-core"/);
  assert.doesNotMatch(backgroundSource, /async function resolveBackgroundNetworkCredentials\(options = \{\}\) \{/);
  assert.match(networkCoreSource, /export async function resolveBackgroundNetworkCredentials\(options = \{\}\) \{/);
  assert.match(networkCoreSource, /const needsFreshSettings = !requestedEndpoint \|\| !requestedToken \|\| !requestedStageBase;/);
  assert.match(networkCoreSource, /getGlobalAiSettings\(\{ useCache: !needsFreshSettings \}\)/);
  assert.match(
    aiRunOrchestratorSource,
    /const credentials = await resolveBackgroundNetworkCredentials\(\{[\s\S]*?endpointValue: payload && payload\.endpointValue,[\s\S]*?tokenValue: payload && payload\.tokenValue,[\s\S]*?endpointPreference: "ai"[\s\S]*?\}\);/
  );
  assert.match(aiRunOrchestratorSource, /const endpointValue = credentials\.endpointValue;/);
  assert.match(aiRunOrchestratorSource, /const tokenValue = credentials\.tokenValue;/);
});

test("AI compute reports specific snapshot preparation blockers", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const failureStart = source.indexOf("function getAiRunCommandFailureMessage");
  const failureEnd = source.indexOf("async function handleComputeSelectors", failureStart);
  const computeMatch = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  );

  assert.ok(failureStart > -1);
  assert.ok(failureEnd > failureStart);
  assert.ok(computeMatch, "handleComputeSelectors body should be found");
  const failureSource = source.slice(failureStart, failureEnd);
  const computeBody = computeMatch[1];

  assert.match(failureSource, /if \(details && details\.reconciliationPending\) \{[\s\S]*?PopupText\.page\.statusServerSyncPending/);
  assert.match(failureSource, /if \(details && details\.locked\) \{[\s\S]*?propertyLockText\.lockedInteractionBlockedToast/);
  assert.match(failureSource, /if \(details && details\.reason === "missing_current_page"\)/);
  assert.match(failureSource, /if \(details && details\.reason === "missing_saved_pages"\)/);
  assert.match(failureSource, /if \(details && details\.reason === "timed_out"\)/);
  assert.match(computeBody, /await failAiRun\(getAiRunCommandFailureMessage\(aiRunResponse\)\);/);
});

test("AI run recovery metadata is persisted through background", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const loadStart = popupSource.indexOf("async function loadPersistedAiRunRecord() {");
  const loadEnd = popupSource.indexOf("async function syncAiComputeLock", loadStart);
  assert.ok(loadStart > -1);
  assert.ok(loadEnd > loadStart);
  const popupPersistenceBlock = popupSource.slice(loadStart, loadEnd);

  assert.match(backgroundSource, /AI_RUN_PERSIST_KEY/);
  assert.match(backgroundSource, /from "\.\/background\/ai-run-record-store"/);
  assert.match(backgroundSource, /if \(message\.type === "getPersistedAiRunRecord"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "savePersistedAiRunRecord"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "clearPersistedAiRunRecord"\) \{/);
  assert.match(backgroundSource, /clearPersistedAiRunRecord,\s*[\s\S]*getPersistedAiRunRecord,\s*[\s\S]*savePersistedAiRunRecord/);
  assert.match(backgroundSource, /if \(message\.type === "setAiComputeLockForTab"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "refreshAiRunHeartbeat"\) \{/);
  assert.match(popupPersistenceBlock, /type: "getPersistedAiRunRecord"/);
  assert.match(popupPersistenceBlock, /type: "clearPersistedAiRunRecord"/);
  assert.doesNotMatch(popupPersistenceBlock, /type: "savePersistedAiRunRecord"/);
  assert.doesNotMatch(popupPersistenceBlock, /storageGet|storageSet|storageRemove|AI_RUN_PERSIST_KEY/);
});

test("AI run countdown timing prefers projected deadlines instead of a popup-owned interval loop", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const timerStart = popupSource.indexOf("function startAiRunCountdownTimer() {");
  const timerEnd = popupSource.indexOf("function resetAiRunState()", timerStart);
  const refreshStart = popupSource.indexOf("nextViewState.computeButtonText =");
  const refreshEnd = popupSource.indexOf("nextViewState.aiDirtyNoticeVisible =", refreshStart);
  assert.ok(timerStart > -1);
  assert.ok(timerEnd > timerStart);
  assert.ok(refreshStart > -1);
  assert.ok(refreshEnd > refreshStart);
  const timerBlock = popupSource.slice(timerStart, timerEnd);
  const refreshBlock = popupSource.slice(refreshStart, refreshEnd);

  assert.match(timerBlock, /function startAiRunCountdownTimer\(\) \{\s*clearAiRunCountdownTimer\(\);\s*updateAiRunCountdownState\(\);\s*\}/);
  assert.doesNotMatch(timerBlock, /setInterval\(/);
  assert.match(refreshBlock, /const projectedAiRunCountdownVisible = Boolean\([\s\S]*?operationKind === "ai-run"[\s\S]*?timerMode === "countdown"/);
  assert.match(refreshBlock, /const aiRunCountdownDeadlineAt = projectedAiRunDeadlineAt > 0[\s\S]*?state\.aiRunDeadlineAt/);
});

test("background owns the authoritative AI-run countdown deadline for the primary compute path", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const aiRunOrchestratorSource = readFileSync(new URL("../src/background/ai-run-orchestrator.ts", import.meta.url), "utf8");
  const handleMatch = popupSource.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  );
  assert.ok(handleMatch, "handleComputeSelectors body should be found");
  const handleBody = handleMatch[1];

  // The popup no longer generates or forwards a deadline; the background brain owns it.
  assert.doesNotMatch(handleBody, /const deadlineAt = Date\.now\(\) \+ AI_RUN_TIMEOUT_MS;/);
  const requestBlock = handleBody.slice(handleBody.indexOf("messages.requestTabRunAi(tabId, {"));
  assert.doesNotMatch(requestBlock.slice(0, requestBlock.indexOf("}")), /deadlineAt/);

  // The orchestrator stamps the running-phase spinner lease with the authoritative deadline.
  assert.match(
    aiRunOrchestratorSource,
    /await update\(\{[\s\S]*?reason: "tab-run-ai-running",[\s\S]*?deadlineAt\s*\}\)/
  );
});

test("popup only pushes AI-run busy facts on the resume path and never dictates timer text", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const countdownStart = popupSource.indexOf("function updateAiRunCountdownState() {");
  const countdownEnd = popupSource.indexOf("function startAiRunCountdownTimer()", countdownStart);
  assert.ok(countdownStart > -1);
  assert.ok(countdownEnd > countdownStart);
  const countdownBlock = popupSource.slice(countdownStart, countdownEnd);

  // The compute-path activation never dictates a timer text; the spinner self-ticks.
  assert.doesNotMatch(countdownBlock, /busyTimerText:/);
  // Busy facts are only reported when the popup itself owns a resumed run.
  assert.match(
    countdownBlock,
    /if \(state\.aiRunResumed\) \{\s*publishCurrentTabSessionFacts\(\{\s*aiBusy: true,[\s\S]*?aiComputing: true,/
  );

  // The continuous publisher gates aiBusy/aiComputing behind resume ownership and emits no dictated timer text.
  assert.match(popupSource, /const popupOwnsAiRunFacts = state\.aiRunResumed;/);
  assert.match(
    popupSource,
    /\.\.\.\(popupOwnsAiRunFacts\s*\?\s*\{ aiBusy: aiBusyForSessionFacts, aiComputing: aiComputingForSessionFacts \}/
  );
  assert.match(popupSource, /busyNote: busyNoteForSessionFacts,\s*busyTimerText: ""/);
});

test("AI run recovery heartbeat and page lock are coordinated by background", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const aiRunOrchestratorSource = readFileSync(new URL("../src/background/ai-run-orchestrator.ts", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const runtimeMessageHandlerSource = readFileSync(
    new URL("../src/content/runtime-message-handler.ts", import.meta.url),
    "utf8"
  );
  const computeLockStart = runtimeMessageHandlerSource.indexOf('if (message.type === "setAiComputeLock") {');
  const computeLockEnd = runtimeMessageHandlerSource.indexOf('if (message.type === "closeAiPreview") {', computeLockStart);
  assert.ok(computeLockStart > -1);
  assert.ok(computeLockEnd > computeLockStart);
  const contentComputeLockBlock = runtimeMessageHandlerSource.slice(computeLockStart, computeLockEnd);

  assert.match(
    backgroundSource,
    /function sendContentMessageToTab\([\s\S]*?timeoutMs(?:\s*:\s*[^=]+)? = 15000,?\s*\)(?:\s*:\s*[^{]+)? \{/
  );
  assert.match(backgroundSource, /Content message timed out/);
  assert.match(backgroundSource, /if \(settled\) \{[\s\S]*?return;[\s\S]*?\}/);
  assert.match(
    backgroundSource,
    /async function ensureContentMainForTab\(tabId(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{/
  );
  assert.match(backgroundSource, /type: "activateContentMain"/);
  assert.match(backgroundSource, /utils\.injectContentScript\(normalizedTabId, \{ force: true \}\)/);
  assert.match(aiRunOrchestratorSource, /async function setAiComputeLockForTab\(tabId(?:\s*:\s*[^,]+)?, active(?:\s*:\s*[^,]+)?, expiresAt(?:\s*:\s*[^=]+)? = 0, baseUrl(?:\s*:\s*[^=]+)? = ""(?:, lockOptions(?:\s*:\s*[^=]+)? = \{\})?\) \{/);
  assert.match(aiRunOrchestratorSource, /const activationResult = await ensureContentMainForTab\(normalizedTabId\);/);
  assert.match(
    aiRunOrchestratorSource,
    /type: "setAiComputeLock",[\s\S]*?active: Boolean\(active\),[\s\S]*?expiresAt: Number\(expiresAt\) \|\| 0/
  );
  assert.match(aiRunOrchestratorSource, /if \(!active && \(!response \|\| !response\.ok\)\) \{/);
  assert.match(aiRunOrchestratorSource, /async function refreshAiRunHeartbeat\(options(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  assert.match(aiRunOrchestratorSource, /const expiresAt = getAiRunResumeExpiresAt\(\);/);
  assert.match(
    aiRunOrchestratorSource,
    /const record = await savePersistedAiRunRecord\(\{[\s\S]*?sessionId,[\s\S]*?siteId,[\s\S]*?expiresAt,[\s\S]*?deadlineAt[\s\S]*?\}\);/
  );
  assert.match(aiRunOrchestratorSource, /const lockResult = await setAiComputeLockForTab\(tabId, true, expiresAt, baseUrl, \{ skipActivation: true \}\);/);
  assert.match(aiRunOrchestratorSource, /if \(!lockResult\.ok\) \{[\s\S]*?await clearPersistedAiRunRecord\(\);/);
  // Resume is owned by the background poller: the popup awaits requestTabResumeAi and never polls locally.
  assert.match(popupSource, /messages\.requestTabResumeAi\(tabId, \{/);
  assert.doesNotMatch(popupSource, /async function continueAiRunPolling/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RESUME_AI, async \(context, payload\) => \{/);
  assert.match(aiRunOrchestratorSource, /async function resumeAiCommandForTab\(tabId(?:\s*:\s*[^,]+)?, payload(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?await pollAiRunUntilDone\(/);
  assert.match(contentSource, /function beginAiPreviewMode\(options = \{\}\) \{/);
  assert.match(contentSource, /async function enterAiPreviewMode\(options = \{\}\) \{[\s\S]*?beginAiPreviewMode\(options\);[\s\S]*?await refreshSilentHighlightings\(\);/);
  assert.match(contentComputeLockBlock, /deps\.getAiPreviewComputeLockHandler\(\)\.handleMessage\(message\)/);
  assert.match(contentComputeLockBlock, /sendResponse\(response && typeof response === "object" \? response : \{ ok: false \}\);/);
});

test("AI run start, status polling, and result transport use background messaging with staged heavy bodies", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const remoteNetworkSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");
  const aiRunOrchestratorSource = readFileSync(new URL("../src/background/ai-run-orchestrator.ts", import.meta.url), "utf8");
  const statusStart = popupSource.indexOf("async function requestAiRunStatus(");
  const statusEnd = popupSource.indexOf("async function applyComputedSelectorSet", statusStart);
  const startStart = popupSource.indexOf("async function requestAiRunStart(");
  const startEnd = popupSource.indexOf("async function requestAiRunStatus", startStart);
  assert.ok(statusStart > -1);
  assert.ok(statusEnd > statusStart);
  assert.ok(startStart > -1);
  assert.ok(startEnd > startStart);
  const statusBlock = popupSource.slice(statusStart, statusEnd);
  const startBlock = popupSource.slice(startStart, startEnd);

  assert.match(backgroundSource, /from "\.\/background\/remote-network"/);
  assert.match(remoteNetworkSource, /export async function requestAiRunStartSnapshot\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function requestAiRunStatus\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function requestAiRunResultSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RUN_AI, async \(context, payload\) => \{/);
  assert.match(backgroundSource, /if \(message\.type === "requestAiRunStartSnapshot"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "requestAiRunStatus"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "requestAiRunResultSnapshot"\) \{/);
  assert.match(popupSource, /messages\.requestTabRunAi\(tabId, \{/);
  assert.match(remoteNetworkSource, /parseAiRunStatusResponse\(await response\.json\(\)\)/);
  assert.match(startBlock, /type: "requestAiRunStartSnapshot"/);
  assert.match(startBlock, /const requestPayloadKey =\s*[\s\S]*buildTransferPayloadKey\("ai-run-start-request"\);/);
  assert.match(startBlock, /const stored = await putTransferPayload\("ai-run-start-request", payload \|\| \{\}, \{/);
  assert.match(startBlock, /payloadKey: requestPayloadKey/);
  assert.match(statusBlock, /type: "requestAiRunStatus"/);
  assert.match(statusBlock, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(statusBlock, /endpointValue|tokenValue/);
  assert.doesNotMatch(statusBlock, /fetch\(|parseAiRunStatusResponse|maybeUpdateStoredTokenFromResponse/);
  assert.doesNotMatch(startBlock, /fetch\(computeSelectorsUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
  // Result fetching/selector application is owned by the background orchestrator poll loop.
  assert.match(aiRunOrchestratorSource, /const resultSnapshot = await requestAiRunResultSnapshot\(\{/);
  assert.match(aiRunOrchestratorSource, /loadAiRunSelectorSetFromPayloadKey\(resultSnapshot\.payloadKey\)/);
});

test("selector submit GraphQL mutation and page-type assignment both use background transport", () => {
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const remoteNetworkSource = readFileSync(new URL("../src/background/remote-network.ts", import.meta.url), "utf8");
  const remoteConfigSyncSource = readFileSync(new URL("../src/background/remote-config-sync.ts", import.meta.url), "utf8");
  const submitStart = popupSource.indexOf("async function submitSelectorSetToServer(");
  const submitEnd = popupSource.indexOf("async function handleSaveExcludes", submitStart);
  const assignmentStart = popupSource.indexOf("async function postPageTypeAssignmentsToAiServer(");
  const assignmentEnd = popupSource.indexOf("async function submitSelectorSetToServer(", assignmentStart);
  assert.ok(submitStart > -1);
  assert.ok(submitEnd > submitStart);
  assert.ok(assignmentStart > -1);
  assert.ok(assignmentEnd > assignmentStart);
  const submitBlock = popupSource.slice(submitStart, submitEnd);
  const assignmentBlock = popupSource.slice(assignmentStart, assignmentEnd);

  assert.match(backgroundSource, /from "\.\/background\/remote-network"/);
  assert.match(backgroundSource, /from "\.\/background\/remote-config-sync"/);
  assert.match(remoteNetworkSource, /export async function submitSelectorSetGraphqlUpdate\(options = \{\}\) \{/);
  assert.match(remoteNetworkSource, /export async function submitPageTypeAssignments\(options = \{\}\) \{/);
  assert.match(remoteConfigSyncSource, /export async function preparePageTypeAssignmentsSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "submitSelectorSetGraphqlUpdate"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "submitPageTypeAssignments"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "preparePageTypeAssignmentsSnapshot"\) \{/);
  assert.match(remoteNetworkSource, /query: UPDATE_SCRAPING_CONDITIONS_MUTATION/);
  // updateScrapingConditions returns Int! (a scalar): the mutation must not
  // select subfields, and renderingMode must be the DomainRenderMode enum
  // (mapped to STATIC | RENDERED) — not a String — or GraphQL rejects the submit.
  assert.match(remoteNetworkSource, /\$renderingMode: DomainRenderMode/);
  assert.doesNotMatch(remoteNetworkSource, /\$renderingMode: String/);
  assert.doesNotMatch(remoteNetworkSource, /\)\s*\{\s*renderingMode\s*\}/);
  assert.match(remoteNetworkSource, /"STATIC"/);
  assert.match(remoteNetworkSource, /"RENDERED"/);
  assert.match(submitBlock, /type: "submitSelectorSetGraphqlUpdate"/);
  assert.match(submitBlock, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(submitBlock, /fetch\(graphqlEndpoint|UPDATE_SCRAPING_CONDITIONS_MUTATION|maybeUpdateStoredTokenFromResponse/);
  assert.match(assignmentBlock, /type: "preparePageTypeAssignmentsSnapshot"/);
  assert.match(assignmentBlock, /type: "submitPageTypeAssignments"/);
  assert.match(assignmentBlock, /messages\.sendRuntimeMessage/);
  assert.match(remoteConfigSyncSource, /const urlsMissingRawHtml = assignments/);
  assert.match(remoteConfigSyncSource, /const payload = assignments\.map\(\(item\) => \{/);
  assert.match(remoteConfigSyncSource, /rawHtml:/);
  assert.match(remoteConfigSyncSource, /renderedHtml:/);
  assert.doesNotMatch(assignmentBlock, /await utils\.storageSet\(chrome\.storage\.session, \{ \[requestPayloadKey\]: payload \}\);/);
  assert.doesNotMatch(assignmentBlock, /backfillRawHtmlForPages|getStoredPageHtmlSnapshot|buildLynxChecklistAssignments/);
  assert.doesNotMatch(assignmentBlock, /fetch\(assignPageTypesUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
});

test("AI corpus rule is documented as a stored multi-page snapshot contract", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const logicDoc = readFileSync(new URL("../MARKING_AND_HIGHLIGHTING_LOGIC.md", import.meta.url), "utf8");

  assert.match(readme, /stored raw\/rendered HTML and XPath evidence for every marked page/);
  assert.match(logicDoc, /An AI run always uses the stored local page snapshots for every marked page/);
  assert.match(logicDoc, /Compute-time DOM collection must not replace that corpus/);
});
