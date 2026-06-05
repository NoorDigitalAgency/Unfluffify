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

test("setReloadRestoreTabState has no callers in background.js (auto-restore writer is retired)", () => {
  // setReloadRestoreTabState used to mirror enabled state into a restore
  // scope so a navigation/reload could auto-resume marking. Phase 2.1 retires
  // that auto-restore mechanism: there must be no callers left.
  const callMatches = backgroundSource.match(/setReloadRestoreTabState\(/g) || [];
  // The function declaration itself counts once; nothing else may call it.
  assert.equal(
    callMatches.length,
    1,
    `expected only the function declaration to mention setReloadRestoreTabState; saw ${callMatches.length} occurrences`
  );
});
