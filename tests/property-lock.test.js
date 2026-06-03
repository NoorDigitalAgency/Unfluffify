import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS,
  PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS,
  PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS,
  PROPERTY_LOCK_STATE_UNLOCKED,
  buildPropertyLockWssUrl,
  createInactiveLockState,
  normalizeLockStateMessage
} from "../common/property-lock.js";

test("buildPropertyLockWssUrl requires a stage base and token", () => {
  assert.equal(buildPropertyLockWssUrl("", "token"), "");
  assert.equal(buildPropertyLockWssUrl("example.test", ""), "");
  assert.equal(buildPropertyLockWssUrl("https://example.test/path", "token value"), "wss://example.test/property-lock?token=token%20value");
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

test("buildPropertyLockWssUrl preserves valid token query encoding", () => {
  assert.equal(
    buildPropertyLockWssUrl("https://example.test/remove", "token+value /?="),
    "wss://example.test/property-lock?token=token%2Bvalue%20%2F%3F%3D"
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
    secondsRemaining: -4
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
  const normalized = normalizeLockStateMessage({
    state: "locked",
    editorIdentity: "editor@example.test",
    editorClientId: "client-a",
    editorName: "Editor",
    isEditor: true,
    otherTabHasUnsavedChanges: true
  }, {
    ownIdentity: "editor@example.test",
    clientId: "client-b"
  });

  assert.equal(normalized.isEditor, false);
  assert.equal(normalized.isSameUserEditor, true);
  assert.equal(normalized.otherTabHasUnsavedChanges, true);
});

test("property lock timing constants preserve the editor warning windows", () => {
  assert.equal(PROPERTY_LOCK_HEARTBEAT_INTERVAL_MS, 30_000);
  assert.equal(PROPERTY_LOCK_EDITOR_IDLE_TIMEOUT_MS, 30 * 60_000);
  assert.equal(PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS, 70_000);
  assert.equal(PROPERTY_LOCK_PORT_DISCONNECT_DELAY_MS, 70_000);
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
    secondsRemaining: null
  });
});

test("content-main reconnects property lock after an unexpected active port disconnect", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /nextPort\.onDisconnect\.addListener\(\(\) => \{[\s\S]*?resetPropertyLockUiState\(\);[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?\}\);/
  );
});

test("content-main consumes property lock port disconnect lastError without lifecycle hooks", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /function consumeRuntimeLastErrorMessage\(\) \{[\s\S]*?const lastError = chrome\.runtime\.lastError;[\s\S]*?\}/);
  assert.match(
    source,
    /nextPort\.onDisconnect\.addListener\(\(\) => \{[\s\S]*?consumeRuntimeLastErrorMessage\(\);[\s\S]*?resetPropertyLockUiState\(\);[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?\}\);/
  );
  assert.doesNotMatch(source, /window\.addEventListener\("pagehide", handlePropertyLockPageHide\);/);
  assert.doesNotMatch(source, /window\.addEventListener\("pageshow", handlePropertyLockPageShow\);/);
});

test("content-main stops property lock reconnects when extension context is invalidated", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /let extensionContextInvalidated = false;/);
  assert.match(
    source,
    /function markExtensionContextInvalidated\(error\) \{[\s\S]*?utils\.isExtensionContextInvalidatedError\(error\)[\s\S]*?extensionContextInvalidated = true;[\s\S]*?disconnectPropertyLockPort\(\{ notifyBackground: false \}\);[\s\S]*?return true;[\s\S]*?\}/
  );
  assert.match(
    source,
    /function schedulePropertyLockReconnect\(options = \{\}\) \{[\s\S]*?if \(extensionContextInvalidated \|\| propertyLockReconnectTimer\)/
  );
  assert.match(
    source,
    /nextPort\.onDisconnect\.addListener\(\(\) => \{[\s\S]*?const disconnectReason = consumeRuntimeLastErrorMessage\(\);[\s\S]*?if \(markExtensionContextInvalidated\(disconnectReason\)\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?schedulePropertyLockReconnect\(\);/
  );
  assert.doesNotMatch(source, /syncPropertyLockConnection\(\{[^}]*\}\)\.then\(\);/);
});

test("content-main requests a reconnect when property lock activity or page commands have no active port", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function sendPropertyLockActivity\(\) \{[\s\S]*?if \(!propertyLockPort\) \{[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    source,
    /function sendPropertyLockMessage\(type, payload = \{\}\) \{[\s\S]*?if \(!propertyLockPort\) \{[\s\S]*?schedulePropertyLockReconnect\(\);[\s\S]*?return;[\s\S]*?\}/
  );
});

test("content-main connects property lock without gating on Live Page candidate verification", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const syncStart = source.indexOf("async function syncPropertyLockConnection");
  const connectIndex = source.indexOf("type: PROPERTY_LOCK_CONTENT_CONNECT", syncStart);
  const candidateIndex = source.indexOf("resolvePropertyLockCandidateState(target)", syncStart);

  assert.ok(syncStart >= 0);
  assert.ok(connectIndex > syncStart);
  assert.equal(candidateIndex, -1);
});

test("content-main connects property lock with a stable client identity and auto-claims on eligible-page connect", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const syncStart = source.indexOf("async function syncPropertyLockConnection");
  const syncEnd = source.indexOf("function handlePropertyLockPortMessage", syncStart);
  const syncSource = source.slice(syncStart, syncEnd);
  const portMessageStart = source.indexOf("function handlePropertyLockPortMessage");
  const portMessageEnd = source.indexOf("function sendPropertyLockActivity", portMessageStart);
  const portMessageSource = source.slice(portMessageStart, portMessageEnd);

  assert.match(source, /const PROPERTY_LOCK_CLIENT_SESSION_KEY = "unfluffify:propertyLockClientId";/);
  assert.match(source, /function getPropertyLockClientId\(\)/);
  assert.match(source, /function setPropertyLockClientId\(nextClientId\)/);
  assert.match(syncSource, /type: PROPERTY_LOCK_CONTENT_CONNECT,[\s\S]*?\.\.\.getPropertyLockDraftStatusPayload\(\)/);
  assert.match(syncSource, /queuePropertyLockEditorClaim\(\);/);
  assert.match(source, /if \(typeof message\.clientId === "string" && message\.clientId\) \{\s*setPropertyLockClientId\(message\.clientId\);\s*\}/);
  assert.match(
    portMessageSource,
    /message\.type === PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS[\s\S]*?message\.connectionStatus === PROPERTY_LOCK_CONNECTION_CONNECTED[\s\S]*?flushQueuedPropertyLockEditorClaim\(\);/
  );
  assert.match(
    portMessageSource,
    /serverMessage\.type === PROPERTY_LOCK_WS_LOCK_STATE[\s\S]*?flushQueuedPropertyLockEditorClaim\(\);/
  );
});

test("content-main resolves property lock targets without requiring current extension base-url state", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const resolverStart = source.indexOf("async function resolveCurrentPropertyLockConnectionTarget");
  const resolverEnd = source.indexOf("async function resolveCurrentPageTypeForMarking", resolverStart);
  const resolverSource = source.slice(resolverStart, resolverEnd);

  assert.ok(resolverStart >= 0);
  assert.match(resolverSource, /const matchingBaseUrl = utils\.findMatchingBaseUrl\(pageUrl, currentConfigs\);/);
  assert.match(resolverSource, /const normalizedBaseUrl = utils\.normalizeBaseUrl\(matchingBaseUrl\) \|\| matchingBaseUrl \|\| "";/);
  assert.match(resolverSource, /const storedSiteId = normalizeSiteIdValue\(normalizedConfig && normalizedConfig\.siteId\);/);
  assert.match(resolverSource, /if \(normalizedBaseUrl && siteId !== storedSiteId\) \{/);
  assert.doesNotMatch(resolverSource, /!normalizedBaseUrl \|\| !pageUrl \|\| !utils\.isPageWithinBaseUrl\(pageUrl, normalizedBaseUrl\)/);
});

test("content-main treats property lock site-id fetch failures as a null lookup", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const resolverStart = source.indexOf("async function resolveSiteIdFromGraphql");
  const resolverEnd = source.indexOf("function extractUrlPathAndHostname", resolverStart);
  const resolverSource = source.slice(resolverStart, resolverEnd);

  assert.ok(resolverStart >= 0);
  assert.match(resolverSource, /try \{[\s\S]*?response = await utils\.sendRuntimeMessage\(\{/);
  assert.match(resolverSource, /\} catch \(error\) \{\s*return null;\s*\}/);
});

test("content-main starts property lock sync immediately during content-script initialization", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const mainStart = source.indexOf("export function main()");
  const immediateSyncIndex = source.indexOf("runPropertyLockSync({ forceSiteIdRefresh: true });", mainStart);
  const refreshMatch = source.slice(mainStart).match(
    /core\.refreshFromTabState\(\{\s*withInitialReveal:\s*true\s*\}\)\.then\(async \(\) => \{/
  );
  const refreshIndex = refreshMatch ? mainStart + refreshMatch.index : -1;

  assert.ok(mainStart >= 0);
  assert.ok(immediateSyncIndex > mainStart);
  assert.ok(refreshIndex > immediateSyncIndex);
});

test("property lock contract is documented with stable client and editor source-of-truth rules", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const propertyLockDoc = readFileSync(new URL("../PROPERTY_LOCK.md", import.meta.url), "utf8");

  assert.match(readme, /PROPERTY_LOCK\.md/);
  assert.match(readme, /active editor uses the local session data/);
  assert.match(propertyLockDoc, /stable page-session client ID/);
  assert.match(
    propertyLockDoc,
    /lands on an eligible Live Page candidate[\s\S]*?property requests the lock/
  );
  assert.match(propertyLockDoc, /duplicated or cloned tab copies that [`']?sessionStorage[`']? value/i);
  assert.match(propertyLockDoc, /must rotate the new tab onto a fresh client ID/);
  assert.match(propertyLockDoc, /not the Chrome tab ID/);
  assert.match(propertyLockDoc, /single source of truth/);
  assert.match(propertyLockDoc, /periodic remote loads must not replace the editor's local draft/);
});

test("popup remote loads merge page markings by timestamp without wiping local saved pages", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const mergeStart = source.indexOf("async function mergeServerConfigIntoLocal");
  const mergeEnd = source.indexOf("async function loadRemoteConfigForCurrentPage", mergeStart);
  const mergeSource = source.slice(mergeStart, mergeEnd);

  assert.ok(mergeStart >= 0);
  assert.match(mergeSource, /const incomingPageMarkings = config\.normalizePageMarkings\(normalizedPayload\.pageMarkings\)\.normalized;/);
  assert.match(mergeSource, /const confirmedPageMarkings = config\.normalizePageMarkings/);
  assert.match(mergeSource, /config\.mergePageMarkingsByTimestamp/);
  assert.match(mergeSource, /localConfig\.pageMarkings = mergedPageMarkings;/);
});

test("popup only skips periodic remote loads for the active editor tab and includes the routed client hint", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const fetchStart = source.indexOf("async function fetchPropertyLockState");
  const fetchEnd = source.indexOf("async function sendPropertyLockCommand", fetchStart);
  const fetchSource = source.slice(fetchStart, fetchEnd);
  const skipStart = source.indexOf("function shouldSkipRemoteConfigLoadForPropertyEditor");
  const skipEnd = source.indexOf("async function syncBaseConfigToServer", skipStart);
  const skipSource = source.slice(skipStart, skipEnd);

  assert.match(fetchSource, /clientId: clientIdHint \|\| ""/);
  assert.match(skipSource, /state\.propertyLockState &&[\s\S]*state\.propertyLockState\.isEditor/);
  assert.doesNotMatch(skipSource, /isSameUserEditor/);
});
