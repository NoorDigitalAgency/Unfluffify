import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const contractSource = readFileSync(new URL("../common/world-messaging-contract.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("background owns per-tab lifecycle and spinner current state", () => {
  assert.match(contractSource, /export const WORLD_MESSAGE_TYPES = Object\.freeze/);
  assert.match(contractSource, /export const LIFECYCLE_KINDS = Object\.freeze/);
  assert.match(contractSource, /export const LIFECYCLE_PHASES = Object\.freeze/);
  assert.match(contractSource, /export function buildPopupStatePortName\(tabId\)/);
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

test("background authoritatively tears down the navigation-inspection curtain on terminal lifecycle", () => {
  assert.match(contractSource, /export const SPINNER_KEYS = Object\.freeze\(\{[\s\S]*?NAV_INSPECT: "navInspect"[\s\S]*?\}\);/);
  assert.match(contractSource, /export function isCurtainBearingLifecycleKind\(kind\) \{/);
  assert.match(
    contractSource,
    /CURTAIN_BEARING_LIFECYCLE_KINDS = Object\.freeze\(\[[\s\S]*?LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION[\s\S]*?\]\);/
  );
  // The terminal-curtain clear is gated on a curtain-bearing kind so routine
  // terminal events (content-ready on every load) never drop the curtain.
  assert.match(
    backgroundSource,
    /const clearsCurtain = isTerminalEvent && isCurtainBearingLifecycleKind\(eventKind\);/
  );
  assert.match(
    backgroundSource,
    /if \(clearsCurtain\) \{[\s\S]*?clearNavInspectCurtain\(normalizedTabId\);[\s\S]*?\}/
  );
  assert.match(backgroundSource, /function clearNavInspectCurtain\(normalizedTabId\) \{[\s\S]*?queue\.delete\(SPINNER_KEYS\.NAV_INSPECT\)[\s\S]*?\}/);
  // Superseded terminal events are ignored before curtain teardown so a stale
  // operation cannot clear the active operation's navInspect curtain.
  assert.match(
    backgroundSource,
    /eventOperationId !== previous\.operationId &&[\s\S]*?isTerminalEvent[\s\S]*?\) \{[\s\S]*?return buildBrokerState\(normalizedTabId\);[\s\S]*?const clearsCurtain = isTerminalEvent && isCurtainBearingLifecycleKind\(eventKind\);/
  );
  // Transient spinners remain popup-session scoped: the last port disconnect
  // clears them, while the persistent navInspect curtain is cleared by the
  // authoritative terminal-lifecycle path above.
  assert.match(
    backgroundSource,
    /port\.onDisconnect\.addListener\(\(\) => \{[\s\S]*?clearBackgroundSpinnerQueue\(tabId, \{ transientOnly: true \}\);[\s\S]*?\}\);/
  );
});

test("background exposes lifecycle and spinner state over messages and popup ports", () => {
  assert.match(backgroundSource, /chrome\.runtime\.onConnect\.addListener\(\(port\) => \{/);
  assert.match(backgroundSource, /port\.name\.startsWith\(WORLD_PORTS\.POPUP_STATE_PREFIX\)/);
  assert.match(backgroundSource, /port\.postMessage\(\{ type: WORLD_MESSAGE_TYPES\.BACKGROUND_STATE, state: buildBrokerState\(tabId\) \}\)/);
  assert.match(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.LIFECYCLE_EVENT\) \{/);
  assert.match(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.GET_BACKGROUND_STATE\) \{/);
  assert.match(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.SPINNER_SET\) \{/);
  assert.match(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.SPINNER_REMOVE\) \{/);
  assert.match(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.SPINNER_CLEAR\) \{/);
});

test("background restore activation starts an operation and passes its id to content", () => {
  const block = extractSourceBlock(
    backgroundSource,
    "function restoreEnabledStateForTab",
    "async function getTabUrl"
  );

  assert.match(block, /const operationId = `activation:\$\{tabId\}:\$\{Date\.now\(\)\}:\$\{attempt\}`;/);
  assert.match(block, /updateLifecycleState\(tabId, \{[\s\S]*?kind: LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?phase: LIFECYCLE_PHASES\.STARTED[\s\S]*?busy: true/);
  assert.match(block, /operationId/);
  assert.match(block, /phase: LIFECYCLE_PHASES\.FAILED[\s\S]*?busy: false/);
  assert.match(block, /clearReloadRestoreTabStateAfterActivation\(tabId, tabState\)\.catch\(\(\) => \{\}\);/);
});

test("content emits lifecycle events for readiness, activation, and render-mode inspection", () => {
  assert.match(contentSource, /function emitLifecycleEvent\(event = \{\}\) \{/);
  assert.match(contentSource, /type: WORLD_MESSAGE_TYPES\.LIFECYCLE_EVENT/);
  assert.match(
    contentSource,
    /emitLifecycleEvent\(\{\s*kind: LIFECYCLE_KINDS\.CONTENT_READY,\s*phase: LIFECYCLE_PHASES\.FINISHED,\s*message: ""\s*\}\);/
  );
  assert.match(contentSource, /kind: LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?phase: LIFECYCLE_PHASES\.STARTED/);
  assert.match(contentSource, /kind: LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?phase: LIFECYCLE_PHASES\.FINISHED/);
  assert.match(contentSource, /kind: LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION[\s\S]*?phase: LIFECYCLE_PHASES\.STARTED/);
  assert.match(contentSource, /phase: LIFECYCLE_PHASES\.REVEAL_STARTED/);
  assert.match(contentSource, /phase: LIFECYCLE_PHASES\.REVEAL_FINISHED/);
  assert.match(contentSource, /phase: LIFECYCLE_PHASES\.HTML_CAPTURED/);
  assert.match(contentSource, /phase: LIFECYCLE_PHASES\.FINISHED/);
});

test("popup spinner UI mirrors background current state instead of session storage", () => {
  assert.match(popupSource, /function connectBackgroundStatePort\(tabId\) \{/);
  assert.match(popupSource, /chrome\.runtime\.connect\(\{ name: buildPopupStatePortName\(tabId\) \}\)/);
  assert.match(popupSource, /function applyBackgroundStateSnapshot\(snapshot\) \{/);
  assert.match(popupSource, /function syncUiBusyFromBrokerState\(\) \{/);
  assert.match(popupSource, /type: WORLD_MESSAGE_TYPES\.SPINNER_SET/);
  assert.match(popupSource, /type: WORLD_MESSAGE_TYPES\.SPINNER_REMOVE/);
  assert.match(popupSource, /type: WORLD_MESSAGE_TYPES\.SPINNER_CLEAR/);
  assert.doesNotMatch(popupSource, /restoreSpinnerQueueFromStorage/);
  assert.doesNotMatch(popupSource, /persistSpinnerQueueToStorage/);
});
