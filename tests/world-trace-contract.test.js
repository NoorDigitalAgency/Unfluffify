import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contractSource = readFileSync(new URL("../common/world-messaging-contract.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const popupUiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");
const popupMessagesSource = readFileSync(new URL("../popup/messages.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const textSource = readFileSync(new URL("../common/text.js", import.meta.url), "utf8");

test("world messaging contract no longer exposes runtime trace toggle message types", () => {
  assert.doesNotMatch(contractSource, /TRACE_SET:/);
  assert.doesNotMatch(contractSource, /CONTENT_TRACE_SET:/);
});

test("background keeps trace enablement fixed from feature and debug flags", () => {
  assert.match(backgroundSource, /const tabWorldTraceStateByTabId = new Map\(\);/);
  assert.match(backgroundSource, /function isWorldTraceEnabled\(\) \{\s*return isFeatureEnabled\("traceDiagnostics"\) && isDebugFlagEnabled\("worldTraceEnabled"\);\s*\}/);
  assert.match(backgroundSource, /traceEnabled: isWorldTraceEnabled\(\),/);
  assert.match(backgroundSource, /registerBackgroundCommand\(BACKGROUND_COMMANDS\.POPUP_GET_TAB_VIEW_STATE, async \(context\) => \{/);
  assert.doesNotMatch(backgroundSource, /function setWorldTraceEnabled\(tabId, enabled\) \{/);
  assert.doesNotMatch(backgroundSource, /WORLD_MESSAGE_TYPES\.TRACE_SET/);
  assert.doesNotMatch(backgroundSource, /WORLD_MESSAGE_TYPES\.CONTENT_TRACE_SET/);
  assert.match(backgroundSource, /snapshot-requested/);
  assert.match(backgroundSource, /reason: typeof payload\.reason === "string" \? payload\.reason : ""/);
  assert.match(backgroundSource, /source: typeof payload\.source === "string" \? payload\.source : ""/);
  assert.match(backgroundSource, /key: typeof payload\.key === "string" \? payload\.key : ""/);
  assert.match(backgroundSource, /traceEvents: traceState && Array\.isArray\(traceState\.events\) \? \[\.\.\.traceState\.events\] : \[\]/);
});

test("background spinner broker preserves blocking reason metadata", () => {
  assert.match(backgroundSource, /reason: entry && typeof entry\.reason === "string" \? entry\.reason : ""/);
  assert.match(backgroundSource, /source: entry && typeof entry\.source === "string" \? entry\.source : ""/);
  assert.match(backgroundSource, /startedAt: entry && Number\.isFinite\(entry\.startedAt\) \? entry\.startedAt : 0/);
  assert.match(backgroundSource, /reason: typeof entry\.reason === "string" && entry\.reason \? entry\.reason : `spinner:\$\{String\(key\)\}`/);
  assert.match(backgroundSource, /source: typeof entry\.source === "string" && entry\.source \? entry\.source : "background-spinner-broker"/);
  assert.match(backgroundSource, /reason: message\.reason,/);
  assert.match(backgroundSource, /source: message\.source,/);
  assert.match(backgroundSource, /startedAt: message\.startedAt/);
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
  assert.match(popupSource, /nextViewState\.traceEvents = traceDiagnosticsEnabled && Array\.isArray\(state\.traceEvents\) \? state\.traceEvents : \[\];/);
  assert.match(popupSource, /nextViewState\.traceEventCount = nextViewState\.traceEvents\.length;/);
  assert.match(popupSource, /const traceDiagnosticsEnabled = isFeatureEnabled\("traceDiagnostics"\);/);
  assert.match(popupSource, /nextViewState\.traceModeEnabled = traceDiagnosticsEnabled && Boolean\(state\.traceModeEnabled\);/);
  assert.match(popupSource, /async function loadTraceModeSetting\(\) \{/);
  assert.match(popupSource, /return isFeatureEnabled\("traceDiagnostics"\) && isDebugFlagEnabled\("worldTraceEnabled"\);/);
  assert.match(popupSource, /async function applyTraceModePreferenceToTab\(tabId, enabled\) \{[\s\S]*?if \(!isFeatureEnabled\("traceDiagnostics"\)\) \{[\s\S]*?traceModeEnabled: false[\s\S]*?return null;/);
  assert.match(popupSource, /messages\.requestPopupTabViewState\(tabId\)/);
  assert.doesNotMatch(popupSource, /WORLD_MESSAGE_TYPES\.GET_BACKGROUND_STATE/);
  assert.match(popupSource, /state\.traceModeEnabled = await loadTraceModeSetting\(\)\.catch\(\(\) => false\);/);
  assert.match(popupSource, /await applyTraceModePreferenceToTab\(initTabId, state\.traceModeEnabled\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(popupSource, /await applyTraceModePreferenceToTab\(newTabId, state\.traceModeEnabled\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(popupSource, /GLOBAL_TRACE_MODE_KEY/);
  assert.match(popupUiSource, /trace-events-panel/);
  assert.match(popupUiSource, /id: "trace-events-output"/);
  assert.match(popupUiSource, /Boolean\(view\.traceModeEnabled\)/);
  assert.doesNotMatch(popupUiSource, /trace-events-list/);
});

test("diagnostics feature gate stays after optional remote support section", () => {
  const diagnosticsIndex = popupUiSource.indexOf("isPopupFeatureEnabled(view, \"traceDiagnostics\")");
  const remoteSupportPushIndex = popupUiSource.indexOf("sections.push(renderRemoteSupportSection");
  assert.ok(remoteSupportPushIndex > -1);
  assert.ok(diagnosticsIndex > remoteSupportPushIndex);
});

test("popup message transport logs world traffic when trace mode is enabled", () => {
  assert.match(popupMessagesSource, /function shouldTraceWorldMessaging\(\) \{/);
  assert.match(popupMessagesSource, /\[world-trace\]\[popup:messages\]/);
  assert.match(popupMessagesSource, /runtime:send/);
  assert.match(popupMessagesSource, /tab:send/);
});

test("content uses fixed trace flag and traces inbound\/outbound world traffic", () => {
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
