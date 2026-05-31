import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");

function extractSourceBlock(startNeedle, endNeedle) {
  const start = backgroundSource.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = backgroundSource.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return backgroundSource.slice(start, end);
}

test("top-level navigation preserves user-controlled device emulation", () => {
  const block = extractSourceBlock(
    "async function disableExtensionOnTopLevelNavigation",
    "chrome.webNavigation.onBeforeNavigate"
  );

  assert.match(block, /await utils\.disableExtensionForTab\(tabId\);/);
  assert.doesNotMatch(block, /updateDeviceEmulation\(tabId,\s*\{\s*enabled:\s*false\s*\}\)/);
});

test("unregister-and-reload preserves user-controlled device emulation state", () => {
  const block = extractSourceBlock(
    'if (message.type === "unregisterTabAndReload")',
    'if (message.type === "injectContentScript")'
  );

  assert.match(block, /await utils\.disableExtensionForTab\(tabId\);/);
  assert.doesNotMatch(block, /updateDeviceEmulation\(tabId,\s*\{\s*enabled:\s*false\s*\}\)/);
  assert.doesNotMatch(block, /DEVICE_EMULATION_PREFIX/);
});
