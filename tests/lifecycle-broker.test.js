import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("background owns per-tab lifecycle and spinner current state", () => {
  assert.match(backgroundSource, /const tabLifecycleStateByTabId = new Map\(\);/);
  assert.match(backgroundSource, /const tabSpinnerQueueByTabId = new Map\(\);/);
  assert.match(backgroundSource, /const popupStatePortsByTabId = new Map\(\);/);
  assert.match(backgroundSource, /function updateLifecycleState\(tabId, event = \{\}\) \{/);
  assert.match(backgroundSource, /function setBackgroundSpinnerEntry\(tabId, key, entry = \{\}\) \{/);
  assert.match(backgroundSource, /function removeBackgroundSpinnerEntry\(tabId, key\) \{/);
  assert.match(backgroundSource, /function clearBackgroundSpinnerQueue\(tabId, options = \{\}\) \{/);
  assert.match(backgroundSource, /const hasBusy = Object\.prototype\.hasOwnProperty\.call\(event, "busy"\);/);
  assert.match(backgroundSource, /busy: hasBusy \? Boolean\(event\.busy\) : Boolean\(previous\.busy\)/);
  assert.match(backgroundSource, /eventOperationId !== previous\.operationId[\s\S]*?isTerminalEvent[\s\S]*?return buildBrokerState\(normalizedTabId\);/);
});

test("background exposes lifecycle and spinner state over messages and popup ports", () => {
  assert.match(backgroundSource, /chrome\.runtime\.onConnect\.addListener\(\(port\) => \{/);
  assert.match(backgroundSource, /port\.name\.startsWith\(POPUP_STATE_PORT_PREFIX\)/);
  assert.match(backgroundSource, /port\.postMessage\(\{ type: "ufBackgroundState", state: buildBrokerState\(tabId\) \}\)/);
  assert.match(backgroundSource, /if \(message\.type === "ufLifecycleEvent"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "getUfBackgroundState"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "ufSpinnerSet"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "ufSpinnerRemove"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "ufSpinnerClear"\) \{/);
});

test("background restore activation starts an operation and passes its id to content", () => {
  const block = extractSourceBlock(
    backgroundSource,
    "function restoreEnabledStateForTab",
    "async function getTabUrl"
  );

  assert.match(block, /const operationId = `activation:\$\{tabId\}:\$\{Date\.now\(\)\}:\$\{attempt\}`;/);
  assert.match(block, /updateLifecycleState\(tabId, \{[\s\S]*?kind: "activation"[\s\S]*?phase: "started"[\s\S]*?busy: true/);
  assert.match(block, /operationId/);
  assert.match(block, /phase: "failed"[\s\S]*?busy: false/);
});

test("content emits lifecycle events for readiness, activation, and render-mode inspection", () => {
  assert.match(contentSource, /function emitLifecycleEvent\(event = \{\}\) \{/);
  assert.match(contentSource, /type: "ufLifecycleEvent"/);
  assert.match(
    contentSource,
    /emitLifecycleEvent\(\{\s*kind: "content-ready",\s*phase: "finished",\s*message: ""\s*\}\);/
  );
  assert.match(contentSource, /kind: "activation"[\s\S]*?phase: "started"/);
  assert.match(contentSource, /kind: "activation"[\s\S]*?phase: "finished"/);
  assert.match(contentSource, /kind: "render-mode-inspection"[\s\S]*?phase: "started"/);
  assert.match(contentSource, /phase: "reveal-started"/);
  assert.match(contentSource, /phase: "reveal-finished"/);
  assert.match(contentSource, /phase: "html-captured"/);
  assert.match(contentSource, /phase: "finished"/);
});

test("popup spinner UI mirrors background current state instead of session storage", () => {
  assert.match(popupSource, /function connectBackgroundStatePort\(tabId\) \{/);
  assert.match(popupSource, /chrome\.runtime\.connect\(\{ name: `ufPopupState:\$\{tabId\}` \}\)/);
  assert.match(popupSource, /function applyBackgroundStateSnapshot\(snapshot\) \{/);
  assert.match(popupSource, /function syncUiBusyFromBrokerState\(\) \{/);
  assert.match(popupSource, /type: "ufSpinnerSet"/);
  assert.match(popupSource, /type: "ufSpinnerRemove"/);
  assert.match(popupSource, /type: "ufSpinnerClear"/);
  assert.doesNotMatch(popupSource, /restoreSpinnerQueueFromStorage/);
  assert.doesNotMatch(popupSource, /persistSpinnerQueueToStorage/);
});
