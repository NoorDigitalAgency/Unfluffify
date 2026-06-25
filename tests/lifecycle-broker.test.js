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
  assert.match(backgroundSource, /from "\.\/background\/background-tab-state\.js"/);
  assert.doesNotMatch(backgroundSource, /const tabLifecycleStateByTabId = new Map\(\);/);
  assert.doesNotMatch(backgroundSource, /const tabSpinnerQueueByTabId = new Map\(\);/);
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
  assert.match(contractSource, /export function isCurtainBearingLifecycleKind\(kind(?:\s*:[^)]*)?\)(?:\s*:[^{]+)?\s*\{/);
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
  // After the popup moved to the bus-only snapshot/update path, transient
  // spinner cleanup no longer depends on popup-state port disconnects; the
  // persistent navInspect curtain is still cleared authoritatively by the
  // terminal-lifecycle path above.
  assert.doesNotMatch(backgroundSource, /clearBackgroundSpinnerQueue\(tabId, \{ transientOnly: true \}\);/);
});

test("background exposes lifecycle and spinner state over broker updates and bus ports", () => {
  assert.match(backgroundSource, /chrome\.runtime\.onConnect\.addListener\(\(port\) => \{/);
  assert.match(backgroundSource, /port\.name\.startsWith\(BUS_PORT_PREFIX\)/);
  assert.doesNotMatch(backgroundSource, /WORLD_PORTS\.POPUP_STATE_PREFIX/);
  assert.doesNotMatch(backgroundSource, /WORLD_MESSAGE_TYPES\.BACKGROUND_STATE/);
  assert.match(
    backgroundSource,
    /syncPopupView\(tabId: number, state: PopupBrokerState, reason: string\) \{[\s\S]*?brain\.mirrorPopupState\(tabId, state, reason\);[\s\S]*?brain\.mirrorLegacySpinnerQueue\(tabId, state\.spinnerQueue, `\$\{reason\}:spinners`\);[\s\S]*?\}/
  );
  assert.doesNotMatch(
    backgroundSource,
    /syncPopupView\(tabId: number, state: PopupBrokerState, reason: string\) \{[\s\S]*?brain\.mirrorActivationLifecycle\(tabId, state\.lifecycle, `\$\{reason\}:activation`\);/
  );
  assert.match(
    backgroundSource,
    /const brokerState = buildBrokerState\(normalizedTabId\);[\s\S]*?brain\.mirrorPopupState\(normalizedTabId, brokerState, "popup-state-broker:seed"\);[\s\S]*?brain\.mirrorLegacySpinnerQueue\(normalizedTabId, brokerState\.spinnerQueue, "popup-state-broker:seed:spinners"\);/
  );
  assert.doesNotMatch(
    backgroundSource,
    /const brokerState = buildBrokerState\(normalizedTabId\);[\s\S]*?brain\.mirrorActivationLifecycle\(normalizedTabId, brokerState\.lifecycle, "popup-state-broker:seed:activation"\);/
  );
  assert.match(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.LIFECYCLE_EVENT\) \{/);
  assert.match(backgroundSource, /if \(normalizedTabId && isActivationLifecycleKind\(eventKind\)\) \{/);
  assert.match(backgroundSource, /const runtimeLifecycle = buildRuntimeLifecycleSnapshot\([\s\S]*?normalizedTabId,[\s\S]*?event[\s\S]*?\);/);
  assert.match(backgroundSource, /updateTabRuntime\(normalizedTabId, \{[\s\S]*?lifecycle: runtimeLifecycle[\s\S]*?\}\);/);
  assert.match(backgroundSource, /appendWorldTraceEvent\(normalizedTabId, "lifecycle", "state-update", runtimeLifecycle\);/);
  assert.match(backgroundSource, /brain\.mirrorActivationLifecycle\([\s\S]*?"background:world-lifecycle-event"/);
  assert.match(backgroundSource, /if \([\s\S]*?eventKind === LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?isLifecycleTerminalPhase\(eventPhase\)[\s\S]*?\) \{[\s\S]*?removeBackgroundSpinnerEntry\(normalizedTabId, "navInspect"\);/);
  assert.match(backgroundSource, /const currentBrokerLifecycle = buildBrokerState\(normalizedTabId\)\.lifecycle;/);
  assert.match(backgroundSource, /const shouldClearPopupLifecycleAuthority = Boolean\([\s\S]*?!currentBrokerLifecycle[\s\S]*?currentBrokerLifecycle\.busy !== true[\s\S]*?isActivationLifecycleKind\(currentBrokerLifecycleKind\)/);
  assert.match(backgroundSource, /const state = shouldClearPopupLifecycleAuthority[\s\S]*?clearLifecycleState\(normalizedTabId, \{[\s\S]*?reason: "popup-state-broker:lifecycle-clear:activation"[\s\S]*?runtimeLifecycle[\s\S]*?\}\)[\s\S]*?: buildBrokerState\(normalizedTabId\);/);
  assert.doesNotMatch(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.GET_BACKGROUND_STATE\) \{/);
  assert.match(backgroundSource, /brain\.bus\.registerHandler\(SPINNER_REQUEST_TYPES\.SET, \(payload(?:\s*:\s*[^,)]+)?, meta\) => \{/);
  assert.match(backgroundSource, /brain\.bus\.registerHandler\(SPINNER_REQUEST_TYPES\.REMOVE, \(payload(?:\s*:\s*[^,)]+)?, meta\) => \{/);
  assert.match(backgroundSource, /brain\.bus\.registerHandler\(SPINNER_REQUEST_TYPES\.CLEAR, \(payload(?:\s*:\s*[^,)]+)?, meta\) => \{/);
});

test("background restore activation starts an operation and passes its id to content", () => {
  const block = extractSourceBlock(
    backgroundSource,
    "function restoreEnabledStateForTab",
    "async function getTabUrl"
  );

  assert.match(block, /const operationId = `activation:\$\{tabId\}:\$\{Date\.now\(\)\}:\$\{attempt\}`;/);
  assert.match(block, /brain\.mirrorActivationLifecycle\(tabId, \{[\s\S]*?kind: LIFECYCLE_KINDS\.ACTIVATION[\s\S]*?phase: LIFECYCLE_PHASES\.STARTED[\s\S]*?busy: true/);
  assert.match(block, /operationId/);
  assert.match(block, /phase: LIFECYCLE_PHASES\.FAILED[\s\S]*?busy: false[\s\S]*?"background:restore-enabled-state:lifecycle-failed"/);
  assert.match(block, /removeBackgroundSpinnerEntry\(tabId, "navInspect"\);/);
  assert.match(block, /runBackgroundTask\([\s\S]*?clearReloadRestoreTabStateAfterActivation\(tabId, tabState\)/);
});

test("background content bootstrap mirrors activation bootstrap state into the brain", () => {
  const block = extractSourceBlock(
    backgroundSource,
    "async function ensureContentMainForTab",
    "function createBackgroundCommandError"
  );

  assert.match(
    block,
    /brain\.updateActivationBootstrapState\(normalizedTabId, \{[\s\S]*?contentReady: false,[\s\S]*?bootstrapStatus: "bootstrapping"[\s\S]*?\}, "background:ensure-content-main:start"\);/
  );
  assert.match(
    block,
    /if \(response && response\.ok\) \{[\s\S]*?brain\.updateActivationBootstrapState\(normalizedTabId, \{[\s\S]*?contentReady: true,[\s\S]*?bootstrapStatus: "ready"[\s\S]*?\}, "background:ensure-content-main:ready"\);/
  );
  assert.match(
    block,
    /if \(retryResponse && retryResponse\.ok\) \{[\s\S]*?brain\.updateActivationBootstrapState\(normalizedTabId, \{[\s\S]*?contentReady: true,[\s\S]*?bootstrapStatus: "ready"[\s\S]*?\}, "background:ensure-content-main:ready"\);/
  );
  assert.match(
    block,
    /brain\.updateActivationBootstrapState\(normalizedTabId, \{[\s\S]*?contentReady: false,[\s\S]*?bootstrapStatus: "failed"[\s\S]*?lastError: "Content activation failed"[\s\S]*?\}, "background:ensure-content-main:failed"\);/
  );
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
  assert.match(popupSource, /requestPopupView\(popupBus, tabId\)/);
  assert.doesNotMatch(popupSource, /function connectBackgroundStatePort\(tabId\) \{/);
  assert.doesNotMatch(popupSource, /buildPopupStatePortName\(tabId\)/);
  assert.match(popupSource, /function applyBackgroundStateSnapshot\(snapshot\) \{/);
  assert.match(popupSource, /function applyPopupViewSnapshot\(snapshot(?:: [^)]+)?\) \{/);
  assert.match(popupSource, /function syncUiBusyFromBrokerState\(\) \{/);
  assert.match(popupSource, /type: SPINNER_REQUEST_TYPES\.SET/);
  assert.match(popupSource, /requestPopupSpinnerRemove\(tabId, \{/);
  assert.match(popupSource, /requestPopupSpinnerClear\(tabId, \{/);
  assert.doesNotMatch(popupSource, /restoreSpinnerQueueFromStorage/);
  assert.doesNotMatch(popupSource, /persistSpinnerQueueToStorage/);
});
