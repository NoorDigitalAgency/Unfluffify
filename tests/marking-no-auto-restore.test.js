import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(
  new URL("../background.js", import.meta.url),
  "utf8"
);
const transferPayloadStoreSource = readFileSync(
  new URL("../background/transfer-payload-store.js", import.meta.url),
  "utf8"
);

function extractFunctionBody(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("setTabState handler does not mirror enabled state into the reload restore scope", () => {
  // Per the editor-mobile-only contract, marking enabled state does not
  // survive a navigation/refresh. The setTabState handler must therefore not
  // populate the reload restore scope when enabled flips on, only clear it.
  const block = extractFunctionBody(
    backgroundSource,
    "if (message.type === \"setTabState\")",
    "if (message.type === \"setDeviceEmulation\")"
  );

  assert.doesNotMatch(block, /setReloadRestoreTabState\(tabId,/);
  assert.match(block, /clearReloadRestoreTabState\(tabId\)/);
});

test("disableExtensionOnTopLevelNavigation clears the reload restore scope without re-populating it", () => {
  const block = extractFunctionBody(
    backgroundSource,
    "async function disableExtensionOnTopLevelNavigation",
    "chrome.webNavigation.onCommitted"
  );

  assert.match(block, /await clearReloadRestoreTabState\(tabId\);/);
  assert.doesNotMatch(block, /setReloadRestoreTabState\(tabId,/);
});

test("disableExtensionOnTopLevelNavigation never preserves marking for same-base navigations", () => {
  // Editor-mobile-only contract: every top-level navigation/reload is a fresh
  // start. The handler must ALWAYS disable marking when enabled - it must not
  // short-circuit and keep marking alive for same-base navigations, which would
  // re-seed a stale marking session on reload and corrupt the clean initial
  // load reveal/freeze flow.
  const block = extractFunctionBody(
    backgroundSource,
    "async function disableExtensionOnTopLevelNavigation",
    "chrome.webNavigation.onCommitted"
  );

  assert.doesNotMatch(block, /preserveEnabledOnNavigation/);
  assert.doesNotMatch(block, /isPageWithinBaseUrl/);
  assert.match(block, /await utils\.disableExtensionForTab\(tabId\);/);
});

test("background sweeps stale transfer-payload keys on service-worker start", () => {
  // Sweep must run at module scope from background startup, while key/TTL
  // logic lives in the dedicated transfer payload store module.
  assert.match(transferPayloadStoreSource, /export async function sweepStaleTransferPayloads\(options = \{\}\)/);
  assert.match(transferPayloadStoreSource, /TRANSFER_PAYLOAD_KEY_PREFIX = "remote-config-"/);
  assert.match(transferPayloadStoreSource, /const DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS = 5 \* 60_000/);
  assert.match(backgroundSource, /sweepStaleTransferPayloads\(\)\.then\(\)/);
  // Key format remains prefixed with remote-config- for cross-surface cleanup.
  const storeKeyBuilder = transferPayloadStoreSource.match(
    /export function buildTransferPayloadKey\(scope = "payload"\)[\s\S]{0,500}return `\${TRANSFER_PAYLOAD_KEY_PREFIX}/
  );
  assert.ok(storeKeyBuilder, "transfer payload key builder must use TRANSFER_PAYLOAD_KEY_PREFIX");
  // Max age is generous enough for any live flow but short enough to clean up crashes.
  const ageMatch = transferPayloadStoreSource.match(/DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS = (\d+) \* 60_000/);
  assert.ok(ageMatch, "DEFAULT_TRANSFER_PAYLOAD_MAX_AGE_MS must be defined as N * 60_000");
  const minutes = Number(ageMatch[1]);
  assert.ok(minutes >= 2 && minutes <= 30, `max age should be 2-30 min; got ${minutes}`);
});

test("setReloadRestoreTabState is fully removed from background.js (auto-restore writer retired)", () => {
  // setReloadRestoreTabState used to mirror enabled state into a restore
  // scope so a navigation/reload could auto-resume marking. Phase 2.1 retires
  // that auto-restore mechanism; the function was also removed as dead code.
  const callMatches = backgroundSource.match(/setReloadRestoreTabState\(/g) || [];
  assert.equal(
    callMatches.length,
    0,
    `expected setReloadRestoreTabState to be removed; saw ${callMatches.length} occurrences`
  );
});
