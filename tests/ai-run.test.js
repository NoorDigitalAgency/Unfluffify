import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
} from "../popup/ai-run.js";

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
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const match = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  );
  assert.ok(match, "handleComputeSelectors body should be found");
  const body = match[1];
  const activeIndex = body.indexOf("setAiRunActiveState({");
  const firstPaintIndex = body.indexOf("await waitForPopupUiPaint();", activeIndex);
  const lockIndex = body.indexOf("await syncAiComputeLock(true, initialLockExpiresAt);", firstPaintIndex);
  const secondPaintIndex = body.indexOf("await waitForPopupUiPaint();", lockIndex);
  const snapshotIndex = body.indexOf("type: \"capturePageSnapshot\"", secondPaintIndex);
  const prepareIndex = body.indexOf("type: \"prepareAiRunPayloadSnapshot\"", secondPaintIndex);
  const refineIndex = body.indexOf("rawXPaths: refineXPathEntries(renderedHtml, rawHtml, renderedXPaths)", prepareIndex);

  assert.ok(activeIndex >= 0, "AI run state should be activated");
  assert.ok(firstPaintIndex > activeIndex, "popup should yield for busy feedback before locking");
  assert.ok(lockIndex > firstPaintIndex, "marking should be locked after busy feedback is visible");
  assert.ok(secondPaintIndex > lockIndex, "popup should yield after marking is locked");
  assert.ok(snapshotIndex > secondPaintIndex, "current-page snapshot capture should wait for visible feedback");
  assert.ok(prepareIndex > secondPaintIndex, "AI payload preparation should wait for visible feedback");
  assert.ok(refineIndex > prepareIndex, "XPath refinement should remain behind the busy feedback");
  assert.match(backgroundSource, /async function prepareAiRunPayloadSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /fetchStaticPageHtmlForBackground/);
});

test("AI compute builds the request from stored local page snapshots only", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const match = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  );

  assert.ok(match, "handleComputeSelectors body should be found");
  const body = match[1];

  assert.match(
    body,
    /let pageMarkings = state\.currentConfig\.pageMarkings \|\| \{\};/
  );
  assert.match(
    body,
    /const currentPageNeedsSnapshot =\s*[\s\S]*?state\.currentDraftDirty[\s\S]*?!currentPageEntry[\s\S]*?!currentPageHtml[\s\S]*?!hasCurrentSubmissionXpaths/
  );
  assert.match(
    body,
    /type: "capturePageSnapshot"[\s\S]*?persist: true/
  );
  assert.doesNotMatch(
    body,
    /snapshotResponse\.(renderedHtml|rawHtml|submissionXpaths|pageMarkings|xpaths)/
  );
  assert.match(
    body,
    /type: "prepareAiRunPayloadSnapshot"[\s\S]*?baseUrl: state\.currentBaseUrl,[\s\S]*?currentPageUrl,[\s\S]*?currentRenderMode/
  );
  assert.match(
    body,
    /preparedPayload\.requiresRawXPathRefinement/
  );
  assert.match(
    body,
    /await utils\.storageGet\(chrome\.storage\.session, preparedPayload\.payloadKey\)/
  );
  assert.match(
    body,
    /startPayloadKey = buildRemoteConfigTransferKey\("ai-run-start-refined"\)/
  );
  assert.match(
    backgroundSource,
    /const storedPageEntries = Object\.entries\(pageMarkings\)/
  );
  assert.match(
    backgroundSource,
    /const urlsMissingRawHtml = storedPageEntries/
  );
  assert.match(
    backgroundSource,
    /renderedXPaths: buildAiSubmissionXpaths\(entry\)/
  );
  assert.match(
    backgroundSource,
    /defaultExclusionSelectors: constants\.DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS/
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

test("AI compute reports specific snapshot preparation blockers", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const failureStart = source.indexOf("function getAiSnapshotFailureMessage");
  const failureEnd = source.indexOf("async function continueAiRunPolling", failureStart);
  const computeMatch = source.match(
    /async function handleComputeSelectors\(\) \{([\s\S]*?)\n\}\n\nasync function postPageTypeAssignmentsToAiServer/
  );

  assert.ok(failureStart > -1);
  assert.ok(failureEnd > failureStart);
  assert.ok(computeMatch, "handleComputeSelectors body should be found");
  const failureSource = source.slice(failureStart, failureEnd);
  const computeBody = computeMatch[1];

  assert.match(failureSource, /if \(response && response\.reconciliationPending\) \{[\s\S]*?return PopupText\.page\.statusServerSyncPending;/);
  assert.match(failureSource, /if \(response && response\.locked\) \{[\s\S]*?propertyLockText\.lockedInteractionBlockedToast/);
  assert.match(failureSource, /return PopupText\.ai\.saveCurrentPageBeforeComputing;/);
  assert.match(computeBody, /await failAiRun\(getAiSnapshotFailureMessage\(snapshotResponse\)\);/);
});

test("AI run recovery metadata is persisted through background", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const loadStart = popupSource.indexOf("async function loadPersistedAiRunRecord() {");
  const loadEnd = popupSource.indexOf("async function syncAiComputeLock", loadStart);
  assert.ok(loadStart > -1);
  assert.ok(loadEnd > loadStart);
  const popupPersistenceBlock = popupSource.slice(loadStart, loadEnd);

  assert.match(backgroundSource, /AI_RUN_PERSIST_KEY/);
  assert.match(backgroundSource, /function getPersistedAiRunRecord|async function getPersistedAiRunRecord/);
  assert.match(backgroundSource, /if \(message\.type === "getPersistedAiRunRecord"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "savePersistedAiRunRecord"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "clearPersistedAiRunRecord"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "setAiComputeLockForTab"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "refreshAiRunHeartbeat"\) \{/);
  assert.match(popupPersistenceBlock, /type: "getPersistedAiRunRecord"/);
  assert.match(popupPersistenceBlock, /type: "clearPersistedAiRunRecord"/);
  assert.doesNotMatch(popupPersistenceBlock, /type: "savePersistedAiRunRecord"/);
  assert.doesNotMatch(popupPersistenceBlock, /storageGet|storageSet|storageRemove|AI_RUN_PERSIST_KEY/);
});

test("AI run recovery heartbeat and page lock are coordinated by background", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const heartbeatStart = popupSource.indexOf("async function refreshAiRunHeartbeat(options = {}) {");
  const heartbeatEnd = popupSource.indexOf("async function stopAiRun", heartbeatStart);
  const computeLockStart = contentSource.indexOf('if (message.type === "setAiComputeLock") {');
  const computeLockEnd = contentSource.indexOf('if (message.type === "closeAiPreview") {', computeLockStart);
  assert.ok(heartbeatStart > -1);
  assert.ok(heartbeatEnd > heartbeatStart);
  assert.ok(computeLockStart > -1);
  assert.ok(computeLockEnd > computeLockStart);
  const popupHeartbeatBlock = popupSource.slice(heartbeatStart, heartbeatEnd);
  const contentComputeLockBlock = contentSource.slice(computeLockStart, computeLockEnd);

  assert.match(backgroundSource, /function sendContentMessageToTab\(tabId, message, timeoutMs = 3000\) \{/);
  assert.match(backgroundSource, /Content message timed out/);
  assert.match(backgroundSource, /if \(settled\) \{[\s\S]*?return;[\s\S]*?\}/);
  assert.match(backgroundSource, /async function ensureContentMainForTab\(tabId\) \{/);
  assert.match(backgroundSource, /type: "activateContentMain"/);
  assert.match(backgroundSource, /async function setAiComputeLockForTab\(tabId, active, expiresAt = 0, baseUrl = ""\) \{/);
  assert.match(backgroundSource, /const activationResult = await ensureContentMainForTab\(normalizedTabId\);/);
  assert.match(
    backgroundSource,
    /type: "setAiComputeLock",[\s\S]*?active: Boolean\(active\),[\s\S]*?expiresAt: Number\(expiresAt\) \|\| 0/
  );
  assert.match(backgroundSource, /if \(!active && \(!response \|\| !response\.ok\)\) \{/);
  assert.match(backgroundSource, /async function refreshAiRunHeartbeat\(options = \{\}\) \{/);
  assert.match(backgroundSource, /const expiresAt = getAiRunResumeExpiresAt\(\);/);
  assert.match(
    backgroundSource,
    /const record = await savePersistedAiRunRecord\(\{[\s\S]*?sessionId,[\s\S]*?siteId,[\s\S]*?expiresAt,[\s\S]*?deadlineAt[\s\S]*?\}\);/
  );
  assert.match(backgroundSource, /const lockResult = await setAiComputeLockForTab\(tabId, true, expiresAt, baseUrl\);/);
  assert.match(backgroundSource, /if \(!lockResult\.ok\) \{[\s\S]*?await clearPersistedAiRunRecord\(\);/);
  assert.match(popupHeartbeatBlock, /type: "refreshAiRunHeartbeat"/);
  assert.match(popupHeartbeatBlock, /state\.aiRunResumeExpiresAt = expiresAt;/);
  assert.doesNotMatch(popupHeartbeatBlock, /savePersistedAiRunRecord|clearPersistedAiRunRecord|sendTabMessage\(\{[\s\S]*?setAiComputeLock/);
  assert.match(contentSource, /function beginAiPreviewMode\(options = \{\}\) \{/);
  assert.match(contentSource, /async function enterAiPreviewMode\(options = \{\}\) \{[\s\S]*?beginAiPreviewMode\(options\);[\s\S]*?await refreshSilentHighlightings\(\);/);
  assert.match(contentSource, /preserveDraftOnExit: false/);
  assert.match(contentSource, /if \(restoreState\.preserveDraftOnExit\) \{[\s\S]*?return;[\s\S]*?\}/);
  assert.match(contentSource, /enterAiPreviewMode\(\{ mode: "preview", preserveDraftOnExit: true \}\)/);
  assert.match(contentSource, /discardUnsavedDraftCache: Boolean\(restoreState\.preserveDraftOnExit\)/);
  assert.match(contentComputeLockBlock, /beginAiPreviewMode\(\{ mode: "compute_lock" \}\);/);
  assert.match(contentComputeLockBlock, /sendResponse\(\{ ok: true, active: true \}\);[\s\S]*?refreshSilentHighlightings\(\)\.then\(\);/);
});

test("AI run start, status polling, and result transport use background messaging with staged heavy bodies", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  const statusStart = popupSource.indexOf("async function requestAiRunStatus(");
  const statusEnd = popupSource.indexOf("async function requestAiRunResult", statusStart);
  const startStart = popupSource.indexOf("async function requestAiRunStart(");
  const startEnd = popupSource.indexOf("async function requestAiRunStatus", startStart);
  const resultStart = popupSource.indexOf("async function requestAiRunResult(");
  const resultEnd = popupSource.indexOf("async function applyComputedSelectorSet", resultStart);
  assert.ok(statusStart > -1);
  assert.ok(statusEnd > statusStart);
  assert.ok(startStart > -1);
  assert.ok(startEnd > startStart);
  assert.ok(resultStart > -1);
  assert.ok(resultEnd > resultStart);
  const statusBlock = popupSource.slice(statusStart, statusEnd);
  const startBlock = popupSource.slice(startStart, startEnd);
  const resultBlock = popupSource.slice(resultStart, resultEnd);

  assert.match(backgroundSource, /async function requestAiRunStartSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /async function requestAiRunStatus\(options = \{\}\) \{/);
  assert.match(backgroundSource, /async function requestAiRunResultSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "requestAiRunStartSnapshot"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "requestAiRunStatus"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "requestAiRunResultSnapshot"\) \{/);
  assert.match(backgroundSource, /parseAiRunStatusResponse\(await response\.json\(\)\)/);
  assert.match(startBlock, /type: "requestAiRunStartSnapshot"/);
  assert.match(startBlock, /await utils\.storageSet\(chrome\.storage\.session, \{ \[requestPayloadKey\]: payload \|\| \{\} \}\);/);
  assert.match(statusBlock, /type: "requestAiRunStatus"/);
  assert.match(statusBlock, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(statusBlock, /fetch\(|parseAiRunStatusResponse|maybeUpdateStoredTokenFromResponse/);
  assert.doesNotMatch(startBlock, /fetch\(computeSelectorsUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
  assert.match(resultBlock, /type: "requestAiRunResultSnapshot"/);
  assert.match(resultBlock, /await utils\.storageGet\(chrome\.storage\.session, payloadKey\)/);
  assert.match(resultBlock, /await utils\.storageRemove\(chrome\.storage\.session, payloadKey\)/);
  assert.doesNotMatch(resultBlock, /fetch\(resultUrl|createConfigSyncHeaders|maybeUpdateStoredTokenFromResponse/);
  assert.match(resultBlock, /selectorSet: normalizeAiSelectorSet\(data\)/);
});

test("selector submit GraphQL mutation and page-type assignment both use background transport", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
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

  assert.match(backgroundSource, /async function submitSelectorSetGraphqlUpdate\(options = \{\}\) \{/);
  assert.match(backgroundSource, /async function submitPageTypeAssignments\(options = \{\}\) \{/);
  assert.match(backgroundSource, /async function preparePageTypeAssignmentsSnapshot\(options = \{\}\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "submitSelectorSetGraphqlUpdate"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "submitPageTypeAssignments"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "preparePageTypeAssignmentsSnapshot"\) \{/);
  assert.match(backgroundSource, /query: UPDATE_SCRAPING_CONDITIONS_MUTATION/);
  assert.match(submitBlock, /type: "submitSelectorSetGraphqlUpdate"/);
  assert.match(submitBlock, /messages\.sendRuntimeMessage/);
  assert.doesNotMatch(submitBlock, /fetch\(graphqlEndpoint|UPDATE_SCRAPING_CONDITIONS_MUTATION|maybeUpdateStoredTokenFromResponse/);
  assert.match(assignmentBlock, /type: "preparePageTypeAssignmentsSnapshot"/);
  assert.match(assignmentBlock, /type: "submitPageTypeAssignments"/);
  assert.match(assignmentBlock, /messages\.sendRuntimeMessage/);
  assert.match(backgroundSource, /const urlsMissingRawHtml = assignments/);
  assert.match(backgroundSource, /const payload = assignments\.map\(\(item\) => \{/);
  assert.match(backgroundSource, /rawHtml:/);
  assert.match(backgroundSource, /renderedHtml:/);
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
