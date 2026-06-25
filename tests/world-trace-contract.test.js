import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const contractSource = readFileSync(new URL("../src/common/world-messaging-contract.ts", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const worldTraceSource = readFileSync(new URL("../src/background/world-trace.ts", import.meta.url), "utf8");
const popupStateBrokerSource = readFileSync(new URL("../src/background/popup-state-broker.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const popupUiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");
const popupMessagesSource = readFileSync(new URL("../src/popup/messages.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
const textSource = readFileSync(new URL("../src/common/text.ts", import.meta.url), "utf8");

test("world messaging contract no longer exposes runtime trace toggle message types", () => {
  assert.doesNotMatch(contractSource, /TRACE_SET:/);
  assert.doesNotMatch(contractSource, /CONTENT_TRACE_SET:/);
});

test("background keeps trace enablement fixed from feature and debug flags", () => {
  assert.match(backgroundSource, /from "\.\/background\/background-tab-state\.js"/);
  assert.doesNotMatch(backgroundSource, /const tabWorldTraceStateByTabId = new Map\(\);/);
  assert.match(backgroundSource, /from "\.\/background\/world-trace\.js"/);
  assert.match(backgroundSource, /const worldTrace = createWorldTrace\(\{/);
  assert.match(backgroundSource, /const isWorldTraceEnabled = worldTrace\.isWorldTraceEnabled;/);
  assert.doesNotMatch(backgroundSource, /function isWorldTraceEnabled\(\) \{/);
  assert.match(worldTraceSource, /export const WORLD_TRACE_EVENT_LIMIT = 160;/);
  assert.match(worldTraceSource, /export function createWorldTrace\(options = \{\}\) \{/);
  assert.match(worldTraceSource, /return isFeatureEnabled\("traceDiagnostics"\) && isDebugFlagEnabled\("worldTraceEnabled"\);/);
  assert.match(popupStateBrokerSource, /traceEnabled: isWorldTraceEnabled\(\),/);
  assert.doesNotMatch(backgroundSource, /BACKGROUND_COMMANDS\.POPUP_GET_TAB_VIEW_STATE/);
  assert.doesNotMatch(backgroundSource, /function setWorldTraceEnabled\(tabId, enabled\) \{/);
  assert.doesNotMatch(backgroundSource, /WORLD_MESSAGE_TYPES\.TRACE_SET/);
  assert.doesNotMatch(backgroundSource, /WORLD_MESSAGE_TYPES\.CONTENT_TRACE_SET/);
  assert.match(backgroundSource, /const isWorldTraceEnabled = worldTrace\.isWorldTraceEnabled;/);
  assert.match(worldTraceSource, /reason: typeof payloadRecord\.reason === "string" \? payloadRecord\.reason : ""/);
  assert.match(worldTraceSource, /source: typeof payloadRecord\.source === "string" \? payloadRecord\.source : ""/);
  assert.match(worldTraceSource, /key: typeof payloadRecord\.key === "string" \? payloadRecord\.key : ""/);
  assert.match(popupStateBrokerSource, /traceEvents: traceState && Array\.isArray\(traceState\.events\) \? \[\.\.\.traceState\.events\] : \[\]/);
});

test("background spinner broker preserves blocking reason metadata", () => {
  assert.match(popupStateBrokerSource, /const reason = entry && typeof entry\.reason === "string" \? entry\.reason : ""/);
  assert.match(popupStateBrokerSource, /source: entry && typeof entry\.source === "string" \? entry\.source : ""/);
  assert.match(popupStateBrokerSource, /const startedAt = entry && Number\.isFinite\(entry\.startedAt\) \? Number\(entry\.startedAt\) : 0/);
  assert.match(popupStateBrokerSource, /activeSpinnerLease: normalizedTabId \? getActiveSpinnerLease\(normalizedTabId\) : null/);
  assert.match(backgroundSource, /reason: typeof entry\.reason === "string" && entry\.reason \? entry\.reason : `spinner:\$\{String\(key\)\}`/);
  assert.match(backgroundSource, /source: typeof entry\.source === "string" && entry\.source \? entry\.source : "background-spinner-broker"/);
  assert.match(backgroundSource, /brain\.bus\.registerHandler\(SPINNER_REQUEST_TYPES\.SET, \(payload(?:\s*:\s*[^,)]+)?, meta\) => \{/);
  assert.match(backgroundSource, /setBackgroundSpinnerEntry\(meta\.tab, payload\.key, \{/);
  assert.match(backgroundSource, /\.\.\.payload,/);
  assert.match(backgroundSource, /owner: SPINNER_OWNERS\.POPUP/);
});

test("popup keeps trace diagnostics behind a disabled feature flag", () => {
  assert.match(popupUiSource, /if \(isPopupFeatureEnabled\(view, "traceDiagnostics"\)\) \{/);
  assert.match(popupUiSource, /id: "trace-mode-enabled"/);
  assert.match(popupUiSource, /onChange: handlers\.onTraceModeToggle/);
  assert.match(textSource, /traceModeLabel:/);
  assert.match(textSource, /diagnosticsSectionTitle:/);
  assert.doesNotMatch(textSource, /traceModeHint:/);

  assert.match(popupSource, /async function handleTraceModeToggle\(event\) \{/);
  assert.match(popupSource, /event\.currentTarget\.checked = Boolean\(state\.traceModeEnabled\);/);
  assert.doesNotMatch(popupSource, /type: WORLD_MESSAGE_TYPES\.TRACE_SET,/);
  assert.match(popupSource, /const traceDiagnosticsEnabled = isFeatureEnabled\("traceDiagnostics"\);/);
  assert.match(popupSource, /state\.traceModeEnabled = traceDiagnosticsEnabled && Boolean\(snapshot\.traceEnabled\);/);
  assert.match(popupSource, /state\.traceEvents = traceDiagnosticsEnabled && Array\.isArray\(snapshot\.traceEvents\) \? \[\.\.\.snapshot\.traceEvents\] : \[\];/);
  assert.match(
    popupSource,
    /const traceEvents: PopupViewState\["traceEvents"\] =[\s\S]*?traceDiagnosticsEnabled && Array\.isArray\(state\.traceEvents\)[\s\S]*?state\.traceEvents[\s\S]*?: \[\];/
  );
  assert.match(popupSource, /nextViewState\.traceEvents = traceEvents;/);
  assert.match(popupSource, /nextViewState\.traceEventCount = traceEvents\.length;/);
  assert.match(popupSource, /const traceDiagnosticsEnabled = isFeatureEnabled\("traceDiagnostics"\);/);
  assert.match(popupSource, /nextViewState\.traceModeEnabled = traceDiagnosticsEnabled && Boolean\(state\.traceModeEnabled\);/);
  assert.match(popupSource, /async function loadTraceModeSetting\(\) \{/);
  assert.match(popupSource, /return isFeatureEnabled\("traceDiagnostics"\) && isDebugFlagEnabled\("worldTraceEnabled"\);/);
  assert.match(popupSource, /async function applyTraceModePreferenceToTab\(tabId, enabled, popupBus\) \{[\s\S]*?if \(!isFeatureEnabled\("traceDiagnostics"\)\) \{[\s\S]*?traceModeEnabled: false[\s\S]*?return null;/);
  assert.match(popupSource, /requestPopupView\(popupBus, tabId\)/);
  assert.doesNotMatch(popupSource, /WORLD_MESSAGE_TYPES\.GET_BACKGROUND_STATE/);
  assert.match(popupSource, /state\.traceModeEnabled = await loadTraceModeSetting\(\)\.catch\(\(\) => false\);/);
  assert.match(popupSource, /await applyTraceModePreferenceToTab\(initTabId, state\.traceModeEnabled, popupBus\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(popupSource, /await applyTraceModePreferenceToTab\(newTabId, state\.traceModeEnabled, popupBus\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(popupSource, /GLOBAL_TRACE_MODE_KEY/);
  assert.match(popupUiSource, /trace-events-panel/);
  assert.match(popupUiSource, /id: "trace-events-output"/);
  assert.match(popupUiSource, /Boolean\(view\.traceModeEnabled\)/);
  assert.doesNotMatch(popupUiSource, /trace-events-list/);
});

test("popup message transport logs world traffic when trace mode is enabled", () => {
  assert.match(popupMessagesSource, /function shouldTraceWorldMessaging\(\) \{/);
  assert.match(popupMessagesSource, /\[world-trace\]\[popup:messages\]/);
  assert.match(popupMessagesSource, /runtime:send/);
  assert.match(popupMessagesSource, /tab:send/);
});

test("content uses fixed trace flag and traces inbound/outbound world traffic", () => {
  assert.match(contentSource, /function isWorldTraceEnabled\(\) \{\s*return isDebugFlagEnabled\("worldTraceEnabled"\);\s*\}/);
  assert.doesNotMatch(contentSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.CONTENT_TRACE_SET\) \{/);
  assert.match(contentSource, /\[world-trace\]\[content\] runtime:inbound/);
  assert.match(contentSource, /\[world-trace\]\[content\] runtime:send/);
  assert.match(contentSource, /\[world-trace\]\[content\] lifecycle:emit/);
  assert.match(contentSource, /function logPageBlockerReason\(event = \{\}\) \{/);
  assert.match(contentSource, /console\.debug\("\[page-blocker\]", event\.busy \? "start-or-update" : "clear"/);
  assert.match(contentSource, /reason: normalizePageBlockingReason\(event\)/);
  assert.match(contentSource, /reason: normalizedEvent\.reason \|\| ""/);
  assert.match(contentSource, /source: normalizedEvent\.source \|\| ""/);
});
