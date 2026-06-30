import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import {
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
  PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS,
  PROPERTY_LOCK_STATE_UNLOCKED,
  buildPropertyLockWssUrl,
  createInactiveLockState,
  normalizeLockStateMessage,
} from "../src/common/property-lock.js";

const propertyLockBannerSource = readFileSync(
  new URL("../src/content/property-lock-banner.ts", import.meta.url),
  "utf8"
);
const propertyLockBannerModeSource = readFileSync(
  new URL("../src/content/property-lock-banner-mode.ts", import.meta.url),
  "utf8"
);
const propertyLockStateMachineSource = readFileSync(
  new URL("../src/content/property-lock-state-machine.ts", import.meta.url),
  "utf8"
);

test("buildPropertyLockWssUrl requires a stage base and token", () => {
  assert.equal(buildPropertyLockWssUrl("", "token"), "");
  assert.equal(buildPropertyLockWssUrl("example.test", ""), "");
  assert.equal(
    buildPropertyLockWssUrl("https://example.test/path", "token value"),
    "wss://example.test/property-lock?token=token%20value"
  );
});

test("buildPropertyLockWssUrl uses configured endpoint origin without api prefix", () => {
  assert.equal(
    buildPropertyLockWssUrl("https://config.example.test/load", "abc123"),
    "wss://config.example.test/property-lock?token=abc123"
  );
  assert.equal(
    buildPropertyLockWssUrl("https://config.example.test/nested/save?x=1#hash", "abc123"),
    "wss://config.example.test/property-lock?token=abc123"
  );
});

test("buildPropertyLockWssUrl only downgrades http local endpoints to ws", () => {
  assert.equal(
    buildPropertyLockWssUrl("http://localhost:8787/load", "token"),
    "ws://localhost:8787/property-lock?token=token"
  );
  assert.equal(
    buildPropertyLockWssUrl("http://example.test/load", "token"),
    "wss://example.test/property-lock?token=token"
  );
});

test("normalizeLockStateMessage clamps countdown and preserves editor flags", () => {
  const normalized = normalizeLockStateMessage({
    state: "expiry_warning",
    editorIdentity: "editor@example.test",
    editorClientId: "client-a",
    editorName: "Editor",
    isEditor: true,
    isRecentEditor: false,
    expiresAtUtc: "2026-05-27T10:00:00.0000000Z",
    secondsRemaining: -4,
  });

  assert.equal(normalized.state, "expiry_warning");
  assert.equal(normalized.editorIdentity, "editor@example.test");
  assert.equal(normalized.editorClientId, "client-a");
  assert.equal(normalized.editorName, "Editor");
  assert.equal(normalized.isEditor, true);
  assert.equal(normalized.isRecentEditor, false);
  assert.equal(normalized.secondsRemaining, 0);
});

test("normalizeLockStateMessage treats same-user different-client editor as a passive same-user lock", () => {
  const normalized = normalizeLockStateMessage(
    {
      state: "locked",
      editorIdentity: "editor@example.test",
      editorClientId: "client-a",
      editorName: "Editor",
      isEditor: true,
      otherTabHasUnsavedChanges: true,
    },
    {
      ownIdentity: "editor@example.test",
      clientId: "client-b",
    }
  );

  assert.equal(normalized.isEditor, false);
  assert.equal(normalized.isSameUserEditor, true);
  assert.equal(normalized.otherTabHasUnsavedChanges, true);
});

test("property lock timing constants preserve the editor warning windows", () => {
  assert.equal(PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS, 30_000);
  assert.equal(PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS, 30 * 60_000);
  assert.equal(PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS, 70_000);
  assert.equal(PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS, 30_000);
  assert.equal(PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS, 70_000);
  assert.equal(PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS, 70_000);
});

test("createInactiveLockState returns an unlocked non-editor snapshot", () => {
  assert.deepEqual(createInactiveLockState(), {
    state: PROPERTY_LOCK_STATE_UNLOCKED,
    editorIdentity: "",
    editorClientId: "",
    editorName: "",
    isEditor: false,
    isRecentEditor: false,
    isSameUserEditor: false,
    otherTabHasUnsavedChanges: false,
    canContinueHere: false,
    transferFromName: "",
    transferToName: "",
    expiresAtUtc: "",
    secondsRemaining: null,
  });
});

test("content-main stops property lock reconnects when extension context is invalidated", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(source, /let extensionContextInvalidated = false;/);
  assert.match(
    source,
    /function markExtensionContextInvalidated\(\s*error(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?utils\.isExtensionContextInvalidatedError\(error\)[\s\S]*?extensionContextInvalidated = true;[\s\S]*?disconnectPropertyLockPort\(\{ notifyBackground: false \}\);[\s\S]*?return true;[\s\S]*?\}/
  );
  assert.match(
    source,
    /function schedulePropertyLockReconnect\(options = \{\}\) \{[\s\S]*?getPropertyLockPortClient\(\)\.scheduleReconnect\(options\);/
  );
  assert.match(
    source,
    /function createPropertyLockPortClientDeps\(\)(?:\s*:\s*[^{]+)? \{[\s\S]*?shouldSkipReconnect:\s*\(\) => extensionContextInvalidated,/
  );
  assert.doesNotMatch(source, /syncPropertyLockConnection\(\{[^}]*\}\)\.then\(\);/);
});

test("content-main reconnects property lock after an unexpected active port disconnect", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /onDisconnect:\s*\(disconnectReason\) => \{[\s\S]*?resetPropertyLockUiState\(\);[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?\}/
  );
});

test("content-main requests a reconnect when property lock activity or page commands have no active port", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function sendPropertyLockActivity\(\) \{[\s\S]*?const portClient = getPropertyLockPortClient\(\);[\s\S]*?if \(!portClient\.hasPort\(\)\) \{[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    source,
    /function sendPropertyLockMessage\(type(?:\s*:\s*[^,]+)?, payload(?:\s*:\s*[^=]+)? = \{\}\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const portClient = getPropertyLockPortClient\(\);[\s\S]*?if \(!portClient\.hasPort\(\)\) \{[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?return;[\s\S]*?\}/
  );
});

test("content-main blocks extension and page interaction while connection-loss banner is active", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const runtimeMessageHandlerSource = readFileSync(
    new URL("../src/content/runtime-message-handler.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /function isPropertyLockDisconnectedForInteractionBlock\(\) \{/);
  assert.match(source, /function isPropertyLockInactivityWarningForInteractionBlock\(\) \{/);
  assert.match(
    source,
    /function isPropertyLockInteractionBlocked\(\) \{[\s\S]*?isMarkingBlockedByPropertyLock\(\) \|\|[\s\S]*?isPropertyLockDisconnectedForInteractionBlock\(\) \|\|[\s\S]*?isPropertyLockInactivityWarningForInteractionBlock\(\);/
  );
  assert.match(
    source,
    /function handleBlockedPropertyLockInteraction\(\s*event(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?const blockDuringDisconnect = isPropertyLockDisconnectedForInteractionBlock\(\);[\s\S]*?const blockDuringInactivityWarning = isPropertyLockInactivityWarningForInteractionBlock\(\);[\s\S]*?const blockDuringEditorWarning =[\s\S]*?blockDuringDisconnect \|\|[\s\S]*?blockDuringInactivityWarning;[\s\S]*?if \(\(!blockDuringEditorWarning && !isMarkingBlockedByPropertyLock\(\)\) \|\| !event \|\| !event\.isTrusted\) \{/
  );
  assert.match(
    source,
    /const isInactivityRescueControl = Boolean\([\s\S]*?blockDuringInactivityWarning[\s\S]*?target\.closest\(`#\$\{PROPERTY_LOCK_BANNER_ID\} \.uf-lock-banner-continue-editing`\)[\s\S]*?\);[\s\S]*?if \(isInactivityRescueControl\) \{[\s\S]*?return;/
  );
  assert.match(
    source,
    /if \(\s*!blockDuringEditorWarning[\s\S]*?target\.closest\('\[data-uf-extension-ui="true"\]'\)[\s\S]*?\) \{[\s\S]*?return;/
  );
  assert.match(
    source,
    /if \(!currentlyEnabled && isPropertyLockInteractionBlocked\(\)\) \{[\s\S]*?showPropertyLockBlockedToast\(\);/
  );
  assert.match(
    runtimeMessageHandlerSource,
    /if \(!deps\.checkPropertyLockBlocksMarking\(\)\) \{[\s\S]*?sendResponse\(\{ ok: false, locked: true \}\);/
  );
});

test("property lock text includes disconnected, off-candidate, and cross-property warning copy", () => {
  const textSource = readFileSync(new URL("../src/common/text.ts", import.meta.url), "utf8");
  assert.match(
    textSource,
    /disconnectedInteractionBlockedToast:\s*"Editing is temporarily blocked while the property lock reconnects\."/
  );
  assert.match(
    textSource,
    /inactivityInteractionBlockedToast:\s*"Editing is temporarily blocked due to inactivity\. Continue editing from the warning banner\."/
  );
  assert.match(
    textSource,
    /editorOffCandidateCountdownMessage:\s*\(secondsRemaining(?:\s*:\s*[^)]+)?\) => `This page is not a current Live Page candidate\./
  );
  assert.match(
    textSource,
    /editorCrossPropertyCountdownMessage:\s*\(secondsRemaining(?:\s*:\s*[^)]+)?\) => `You left the previous property\./
  );
  assert.match(
    textSource,
    /popupOffCandidateWarning:\s*\(secondsRemaining(?:\s*:\s*[^)]+)?\) => `Off candidate page • editor role ends in \$\{secondsRemaining\}s`/
  );
  assert.match(
    textSource,
    /popupCrossPropertyWarning:\s*\(secondsRemaining(?:\s*:\s*[^)]+)?\) => `Previous property held • editor role ends in \$\{secondsRemaining\}s`/
  );
});

test("content-main starts and persists an off-candidate editor countdown before releasing the lock", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function persistPropertyLockOffCandidateDeadline\(deadlineAt(?:\s*:\s*[^)]+)?\) \{[\s\S]*?getPropertyLockStateMachine\(\)\.persistOffCandidateDeadline\(deadlineAt\);/
  );
  assert.match(
    source,
    /function startPropertyLockOffCandidateWarning\(\) \{[\s\S]*?getPropertyLockStateMachine\(\)\.startOffCandidateWarning\(\);/
  );
  assert.match(
    propertyLockStateMachineSource,
    /propertyLockOffCandidateDeadlineAt:[\s\S]*?typeof deadlineAt === "number" && Number\.isFinite\(deadlineAt\)/
  );
  assert.match(
    propertyLockStateMachineSource,
    /deps\.setPropertyLockOffCandidateDeadlineAt\(Date\.now\(\) \+ deps\.PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS\);/
  );
  assert.match(propertyLockStateMachineSource, /deps\.setPropertyLockBannerMode\("editor_off_candidate_countdown"\);/);
  assert.match(
    propertyLockStateMachineSource,
    /deps\.getTimerHost\(\)\.setTimeout\(\(\) => \{[\s\S]*?deps\.sendPropertyLockMessage\(deps\.PROPERTY_LOCK_CONTENT_RELEASE\);[\s\S]*?\}, deps\.PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS \+ 100\);/
  );
  assert.match(
    source,
    /async function syncPropertyLockOffCandidateWarning\(baseUrl(?:\s*:\s*[^,]+)?, pageUrl(?:\s*:\s*[^=]+)? = location\.href\)(?:\s*:\s*[^{]+)? \{/
  );
  assert.match(source, /if \(propertyLockState && propertyLockState\.isEditor\) \{\s*startPropertyLockOffCandidateWarning\(\);/);
  assert.match(propertyLockBannerSource, /case "editor_off_candidate_countdown":/);
  assert.match(propertyLockBannerSource, /propertyLockText\.editorOffCandidateCountdownMessage\(propertyLockBannerCountdownValue\)/);
});

test("content-main starts and persists a cross-property editor cooldown before releasing the old lock", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function normalizePropertyLockRecoveryTabState\(tabState(?:\s*:\s*[^)]+)?\) \{[\s\S]*?getPropertyLockStateMachine\(\)\.normalizeRecoveryTabState\(/
  );
  assert.match(
    source,
    /function persistPropertyLockRecoveryState\(\{ siteId = null, baseUrl = "", clientId = "", deadlineAt = 0 \} = \{\}\) \{[\s\S]*?getPropertyLockStateMachine\(\)\.persistRecoveryState\(\{/
  );
  assert.match(
    source,
    /function startPropertyLockCrossPropertyWarning\(recoveryState(?:\s*:\s*[^)]+)?\) \{[\s\S]*?getPropertyLockStateMachine\(\)\.startCrossPropertyWarning\(/
  );
  assert.match(
    propertyLockStateMachineSource,
    /deps\.setPropertyLockRecoveryDeadlineAt\([\s\S]*?Date\.now\(\) \+ deps\.PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS/
  );
  assert.match(source, /type: PROPERTY_LOCK_CONTENT_RELEASE,\s*siteId: recoverySiteId,\s*clientId: recoveryClientId/);
  assert.match(
    propertyLockBannerModeSource,
    /if \(deps\.getPropertyLockRecoveryDeadlineAt\(\) > Date\.now\(\)\) \{[\s\S]*?deps\.setPropertyLockBannerMode\("editor_cross_property_countdown"\);/
  );
  assert.match(propertyLockBannerSource, /case "editor_cross_property_countdown":/);
  assert.match(propertyLockBannerSource, /propertyLockText\.editorCrossPropertyCountdownMessage\(propertyLockBannerCountdownValue\)/);
});

test("content-main uses 70-second fallback countdown for inactivity warning and keeps it running", () => {
  const applyStart = propertyLockStateMachineSource.indexOf("function applyServerMessage(serverMessage");
  const applyEnd = propertyLockStateMachineSource.indexOf("return {", applyStart);
  const applySource = propertyLockStateMachineSource.slice(applyStart, applyEnd);

  assert.ok(applyStart >= 0);
  assert.match(
    applySource,
    /if \(type === deps\.PROPERTY_LOCK_WS_INACTIVITY_WARNING\) \{[\s\S]*?const defaultInactivityCountdownSeconds = Math\.ceil\(deps\.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS \/ 1000\);/
  );
  assert.match(
    applySource,
    /\} else if \(deps\.getPropertyLockBannerCountdownValue\(\) <= 0\) \{[\s\S]*?deps\.setPropertyLockBannerCountdownValue\(defaultInactivityCountdownSeconds\);[\s\S]*?deps\.restartPropertyLockBannerCountdown\(\);/
  );
  assert.match(
    applySource,
    /\} else if \(!deps\.getPropertyLockBannerCountdownTimer\(\)\) \{[\s\S]*?deps\.restartPropertyLockBannerCountdown\(\);/
  );
  assert.match(
    propertyLockBannerModeSource,
    /if \(isEditor && lockState === deps\.PROPERTY_LOCK_STATE_EXPIRY_WARNING\) \{[\s\S]*?const defaultInactivityCountdownSeconds = Math\.ceil\(deps\.PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS \/ 1000\);[\s\S]*?deps\.setPropertyLockBannerMode\("editor_inactivity_warning"\);/
  );
});

test("content-main does not reset disconnect countdown on repeated unavailable status updates", () => {
  const applyStart = propertyLockStateMachineSource.indexOf("function applyServerMessage(serverMessage");
  const applyEnd = propertyLockStateMachineSource.indexOf("return {", applyStart);
  const applySource = propertyLockStateMachineSource.slice(applyStart, applyEnd);

  assert.ok(applyStart >= 0);
  assert.match(
    applySource,
    /if \(deps\.getPropertyLockBannerMode\(\) !== "editor_disconnect_countdown" \|\| deps\.getPropertyLockBannerCountdownValue\(\) <= 0\) \{[\s\S]*?deps\.setPropertyLockBannerCountdownValue\(defaultDisconnectCountdownSeconds\);[\s\S]*?deps\.restartPropertyLockBannerCountdown\(\);/
  );
  assert.match(
    applySource,
    /\} else if \(!deps\.getPropertyLockBannerCountdownTimer\(\)\) \{[\s\S]*?deps\.restartPropertyLockBannerCountdown\(\);/
  );
});

test("content-main connects property lock with a stable client identity and auto-claims on eligible-page connect", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const syncStart = source.indexOf("async function syncPropertyLockConnection");
  const syncEnd = source.indexOf("function handlePropertyLockPortMessage", syncStart);
  const syncSource = source.slice(syncStart, syncEnd);
  const portMessageStart = source.indexOf("function handlePropertyLockPortMessage");
  const portMessageEnd = source.indexOf("function sendPropertyLockActivity", portMessageStart);
  const portMessageSource = source.slice(portMessageStart, portMessageEnd);

  assert.match(source, /const PROPERTY_LOCK_CLIENT_SESSION_KEY = "unfluffify:propertyLockClientId";/);
  assert.match(source, /function getPropertyLockClientId\(\)/);
  assert.match(source, /function setPropertyLockClientId\(\s*nextClientId(?:\s*:\s*[^)]+)?\s*\)/);
  assert.match(syncSource, /type: PROPERTY_LOCK_CONTENT_CONNECT,[\s\S]*?\.\.\.getPropertyLockDraftStatusPayload\(\)/);
  assert.match(syncSource, /queuePropertyLockEditorClaim\(\);/);
  assert.match(
    source,
    /if \(typeof (?:message|envelope)\.clientId === "string" && (?:message|envelope)\.clientId\) \{\s*setPropertyLockClientId\((?:message|envelope)\.clientId\);\s*\}/
  );
  assert.match(
    portMessageSource,
    /(?:message|envelope)\.type === PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS[\s\S]*?(?:message|envelope)\.connectionStatus === PROPERTY_LOCK_CONNECTION_CONNECTED[\s\S]*?flushQueuedPropertyLockEditorClaim\(\);/
  );
  assert.match(
    portMessageSource,
    /server(?:State)?Message\.type === PROPERTY_LOCK_WS_LOCK_STATE[\s\S]*?flushQueuedPropertyLockEditorClaim\(\);/
  );
});

test("content-main reads siteId from config for property lock — brain owns resolution", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  // resolveSiteIdFromGraphql no longer exists in content — brain owns resolution
  assert.ok(source.indexOf("async function resolveSiteIdFromGraphql") === -1);
  // Content still reads siteId from config
  const resolverStart = source.indexOf("async function resolveCurrentPropertyLockConnectionTarget");
  const resolverEnd = source.indexOf("async function resolveCurrentPageTypeForMarking", resolverStart);
  const resolverSource = source.slice(resolverStart, resolverEnd);
  assert.match(resolverSource, /normalizeSiteIdValue\(normalizedConfig && normalizedConfig\.siteId\)/);
  assert.doesNotMatch(resolverSource, /resolveSiteIdFromGraphql/);
});

test("content-main starts property lock sync immediately during content-script initialization", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const mainStart = source.indexOf("export function main()");
  const immediateSyncIndex = source.indexOf("runPropertyLockSync({ forceSiteIdRefresh: true });", mainStart);
  const refreshMatch = source.slice(mainStart).match(/core\.refreshFromTabState\(\)\.then\(async \(\) => \{/);
  const refreshIndex = refreshMatch ? mainStart + refreshMatch.index : -1;

  assert.ok(mainStart >= 0);
  assert.ok(immediateSyncIndex > mainStart);
  assert.ok(refreshIndex > immediateSyncIndex);
});

test("content-main resolves property lock targets from config siteId", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const resolverStart = source.indexOf("async function resolveCurrentPropertyLockConnectionTarget");
  const resolverEnd = source.indexOf("async function resolveCurrentPageTypeForMarking", resolverStart);
  const resolverSource = source.slice(resolverStart, resolverEnd);

  assert.ok(resolverStart >= 0);
  assert.match(resolverSource, /const matchingBaseUrl = utils\.findMatchingBaseUrl\(pageUrl, currentConfigs\);/);
  assert.match(resolverSource, /const normalizedBaseUrl = utils\.normalizeBaseUrl\(matchingBaseUrl\) \|\| matchingBaseUrl \|\| "";/);
  assert.match(resolverSource, /const siteId = normalizeSiteIdValue\(normalizedConfig && normalizedConfig\.siteId\);/);
  assert.match(resolverSource, /if \(!siteId\) \{/);
  assert.doesNotMatch(resolverSource, /resolveSiteIdFromGraphql/);
});

test("content-main coalesces concurrent property lock sync requests", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const runSyncStart = source.search(/function runPropertyLockSync\(options(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  const runSyncEnd = source.search(/async function syncPropertyLockConnection\(options(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  const runSyncSource = source.slice(runSyncStart, runSyncEnd);

  assert.ok(runSyncStart >= 0);
  assert.match(source, /let propertyLockSyncInFlight = false;/);
  assert.match(source, /let propertyLockQueuedSyncOptions(?:\s*:\s*[^=]+)? = null;/);
  assert.match(
    source,
    /function mergePropertyLockSyncOptions\([\s\S]*?currentOptions(?:\s*:\s*[^=]+)? = \{\},[\s\S]*?incomingOptions(?:\s*:\s*[^=]+)? = \{\}[\s\S]*?\) \{/
  );
  assert.match(runSyncSource, /if \(propertyLockSyncInFlight\) \{[\s\S]*?propertyLockQueuedSyncOptions = mergePropertyLockSyncOptions\(/);
  assert.match(runSyncSource, /while \(!extensionContextInvalidated\) \{[\s\S]*?await syncPropertyLockConnection\(activeOptions\);/);
  assert.match(runSyncSource, /if \(propertyLockQueuedSyncOptions && !extensionContextInvalidated\) \{[\s\S]*?runPropertyLockSync\(queuedOptions\);/);
});

test("content-main re-queues property lock sync when URL changes during a sync", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const syncStart = source.search(/async function syncPropertyLockConnection\(options(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  const syncEnd = source.indexOf("function handlePropertyLockPortMessage(message) {", syncStart);
  const syncSource = source.slice(syncStart, syncEnd);

  assert.ok(syncStart >= 0);
  assert.match(
    syncSource,
    /if \(pageUrl !== location\.href\) \{[\s\S]*?runPropertyLockSync\(\{[\s\S]*?pageUrl: location\.href,[\s\S]*?forceSiteIdRefresh: true[\s\S]*?\}\);[\s\S]*?return;[\s\S]*?\}/
  );
});

test("background remote merges reconcile page markings by timestamp without wiping local saved pages", () => {
  const source = readFileSync(new URL("../src/background/remote-config-sync.ts", import.meta.url), "utf8");
  const mergeStart = source.indexOf("async function mergeServerConfigIntoLocalSnapshot");
  const mergeEnd = source.indexOf("export async function preparePageTypeAssignmentsSnapshot", mergeStart);
  const mergeSource = source.slice(mergeStart, mergeEnd);

  assert.ok(mergeStart >= 0);
  assert.match(
    mergeSource,
    /const incomingPageMarkings = configStore\.normalizePageMarkings\(normalizedPayload\.pageMarkings\)\.normalized;/
  );
  assert.match(mergeSource, /const confirmedPageMarkings = configStore\.normalizePageMarkings/);
  assert.match(mergeSource, /configStore\.mergePageMarkingsByTimestamp/);
  assert.match(mergeSource, /localConfig\.pageMarkings = mergedPageMarkings;/);
});

test("popup only skips periodic remote loads for the active editor tab and includes the routed client hint", () => {
  const source = readFileSync(new URL("../src/popup/property-lock-ui.ts", import.meta.url), "utf8");
  const fetchStart = source.indexOf("export async function fetchPropertyLockState");
  const fetchEnd = source.indexOf("export async function refreshPropertyLockSnapshot", fetchStart);
  const fetchSource = source.slice(fetchStart, fetchEnd);
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const skipStart = popupSource.indexOf("function shouldSkipRemoteConfigLoadForPropertyEditor");
  const skipEnd = popupSource.indexOf("function updateLoginActionState", skipStart);
  const skipSource = popupSource.slice(skipStart, skipEnd);

  assert.match(fetchSource, /clientId: clientIdHint \|\| ""/);
  assert.match(skipSource, /state\.propertyLockState &&[\s\S]*state\.propertyLockState\.isEditor/);
  assert.doesNotMatch(skipSource, /isSameUserEditor/);
});

test("popup property lock commands refresh draft status and reconcile lock state", () => {
  const source = readFileSync(new URL("../src/popup/property-lock-ui.ts", import.meta.url), "utf8");
  const commandStart = source.indexOf("export async function sendPropertyLockCommand");
  const commandEnd = source.indexOf("export async function reconcilePropertyLockAfterCommand", commandStart);
  const commandSource = source.slice(commandStart, commandEnd);
  const reconcileStart = source.indexOf("export async function reconcilePropertyLockAfterCommand");
  const reconcileSource = source.slice(reconcileStart);
  const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

  assert.match(commandSource, /await deps\.refreshCurrentPageRuntimeStatus\(\)\.catch\(\(\) => null\);/);
  assert.match(reconcileSource, /await deps\.refreshPropertyLockSnapshot\(siteId\)\.catch\(\(\) => null\);/);
  assert.match(reconcileSource, /deps\.setViewState\(deps\.buildPropertyLockViewState\(\)\);/);
  assert.match(reconcileSource, /await deps\.refreshUi\(\{ useBusyOverlay \}\);/);
  assert.match(popupSource, /async function handlePropertyLockTake\(\) \{[\s\S]*?await reconcilePropertyLockAfterCommand\(\);[\s\S]*?\}/);
  assert.match(popupSource, /async function handlePropertyLockContinue\(\) \{[\s\S]*?await reconcilePropertyLockAfterCommand\(\);[\s\S]*?\}/);
  assert.match(
    popupSource,
    /async function handlePropertyLockForceContinue\(\) \{[\s\S]*?await reconcilePropertyLockAfterCommand\(\);[\s\S]*?\}/
  );
  assert.match(
    popupSource,
    /async function handlePropertyLockAcceptSuggestion\(\) \{[\s\S]*?await reconcilePropertyLockAfterCommand\(\);[\s\S]*?\}/
  );
  assert.match(
    popupSource,
    /async function handlePropertyLockRejectSuggestion\(\) \{[\s\S]*?await reconcilePropertyLockAfterCommand\(\);[\s\S]*?\}/
  );
});
