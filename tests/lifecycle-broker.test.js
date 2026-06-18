import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const backgroundSource = readFileSync(new URL("../background.ts", import.meta.url), "utf8");
const popupStateBrokerSource = readFileSync(new URL("../background/popup-state-broker.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
const renderModeHandlersSource = readFileSync(new URL("../content/render-mode-inspection-handlers.ts", import.meta.url), "utf8");
const contractSource = readFileSync(new URL("../common/world-messaging-contract.ts", import.meta.url), "utf8");

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
  assert.match(contractSource, /SILENT_HIGHLIGHTING: "silent-highlighting"/);
  assert.match(contractSource, /export const LIFECYCLE_PHASES = Object\.freeze/);
  assert.match(contractSource, /export function buildPopupStatePortName\(tabId(?:\s*:[^\)]*)?\)(?:\s*:[^\{]+)?/);
  assert.match(backgroundSource, /from "\.\/background\/background-tab-state\.js"/);
  assert.doesNotMatch(backgroundSource, /const tabLifecycleStateByTabId = new Map\(\);/);
  assert.doesNotMatch(backgroundSource, /const tabSpinnerQueueByTabId = new Map\(\);/);
  assert.doesNotMatch(backgroundSource, /const popupStatePortsByTabId = new Map\(\);/);
  assert.match(backgroundSource, /from "\.\/background\/popup-state-broker\.js"/);
  assert.match(backgroundSource, /const popupStateBroker = createPopupStateBroker\(\{/);
  assert.match(backgroundSource, /const updateLifecycleState = popupStateBroker\.updateLifecycleState;/);
  assert.match(popupStateBrokerSource, /function updateLifecycleState\(tabId, event = \{\}\) \{/);
  assert.match(backgroundSource, /function setBackgroundSpinnerEntry\(tabId, key, entry = \{\}\) \{/);
  assert.match(backgroundSource, /function removeBackgroundSpinnerEntry\(tabId, key\) \{/);
  assert.match(backgroundSource, /function clearBackgroundSpinnerQueue\(tabId, options = \{\}\) \{/);
  assert.match(popupStateBrokerSource, /const hasBusy = Object\.prototype\.hasOwnProperty\.call\(event, "busy"\);/);
  assert.match(popupStateBrokerSource, /busy: hasBusy \? Boolean\(event\.busy\) : Boolean\(previous\.busy\)/);
  assert.match(popupStateBrokerSource, /eventOperationId !== previous\.operationId[\s\S]*?isTerminalEvent[\s\S]*?return buildBrokerState\(normalizedTabId\);/);
});

test("background authoritatively tears down the navigation-inspection curtain on terminal lifecycle", () => {
  assert.match(contractSource, /export const SPINNER_KEYS = Object\.freeze\(\{[\s\S]*?NAV_INSPECT: "navInspect"[\s\S]*?\}\);/);
  assert.match(contractSource, /export function isCurtainBearingLifecycleKind\(kind(?:\s*:[^\)]*)?\)(?:\s*:[^\{]+)?\s*\{/);
  assert.match(
    contractSource,
    /CURTAIN_BEARING_LIFECYCLE_KINDS(?:\s*:[^=]+)?\s*= Object\.freeze\(\[[\s\S]*?LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION[\s\S]*?LIFECYCLE_KINDS\.SILENT_HIGHLIGHTING[\s\S]*?\]\);/
  );
  // The terminal-curtain clear is gated on a curtain-bearing kind so routine
  // terminal events (content-ready on every load) never drop the curtain.
  assert.match(
    popupStateBrokerSource,
    /const clearsCurtain = isTerminalEvent && isCurtainBearingLifecycleKind\(eventKind\);/
  );
  assert.match(
    popupStateBrokerSource,
    /if \(clearsCurtain\) \{[\s\S]*?clearNavInspectCurtain\(normalizedTabId\);[\s\S]*?\}/
  );
  assert.match(popupStateBrokerSource, /function clearNavInspectCurtain\(normalizedTabId\) \{[\s\S]*?queue\.delete\(SPINNER_KEYS\.NAV_INSPECT\)[\s\S]*?\}/);
  // Superseded terminal events are ignored before curtain teardown so a stale
  // operation cannot clear the active operation's navInspect curtain.
  assert.match(
    popupStateBrokerSource,
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
  assert.doesNotMatch(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.GET_BACKGROUND_STATE\) \{/);
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
  assert.match(block, /runBackgroundTask\([\s\S]*?clearReloadRestoreTabStateAfterActivation\(tabId, tabState\)/);
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
  assert.match(
    contentSource,
    /createRenderModeInspectionHandlers\(createRenderModeInspectionHandlersDeps\(\)\)|contentMainServiceRegistry\.getRenderModeInspectionHandlers\(\)/
  );
  assert.match(renderModeHandlersSource, /kind: deps\.LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION[\s\S]*?phase: deps\.LIFECYCLE_PHASES\.STARTED/);
  assert.match(renderModeHandlersSource, /phase: deps\.LIFECYCLE_PHASES\.REVEAL_STARTED/);
  assert.match(renderModeHandlersSource, /phase: deps\.LIFECYCLE_PHASES\.REVEAL_FINISHED/);
  assert.match(renderModeHandlersSource, /phase: deps\.LIFECYCLE_PHASES\.HTML_CAPTURED/);
  assert.match(renderModeHandlersSource, /phase: deps\.LIFECYCLE_PHASES\.FINISHED/);
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
