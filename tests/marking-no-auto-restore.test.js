import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(
  new URL("../background.js", import.meta.url),
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
    "chrome.webNavigation.onBeforeNavigate"
  );

  assert.match(block, /await clearReloadRestoreTabState\(tabId\);/);
  assert.doesNotMatch(block, /setReloadRestoreTabState\(tabId,/);
});

test("background sweeps stale transfer-payload keys on service-worker start", () => {
  // sweepStaleTransferPayloads must be defined and called at module scope
  // so orphaned session-storage keys from aborted AI runs are cleaned up.
  assert.match(backgroundSource, /async function sweepStaleTransferPayloads\(\)/);
  assert.match(backgroundSource, /TRANSFER_PAYLOAD_MAX_AGE_MS/);
  assert.match(backgroundSource, /sweepStaleTransferPayloads\(\)\.then\(\)/);
  // Both key builders use the same prefix so the sweep covers popup keys too.
  const bgKeyBuilder = backgroundSource.match(
    /function buildRemoteConfigPayloadKey[\s\S]{0,300}return `\${TRANSFER_PAYLOAD_KEY_PREFIX}/
  );
  assert.ok(bgKeyBuilder, "background key builder must use TRANSFER_PAYLOAD_KEY_PREFIX");
  // Max age is generous enough for any live flow but short enough to clean up crashes.
  const ageMatch = backgroundSource.match(/TRANSFER_PAYLOAD_MAX_AGE_MS = (\d+) \* 60_000/);
  assert.ok(ageMatch, "TRANSFER_PAYLOAD_MAX_AGE_MS must be defined as N * 60_000");
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
