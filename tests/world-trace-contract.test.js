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

test("world messaging contract exposes trace message types", () => {
  assert.match(contractSource, /TRACE_SET: "ufTraceSet"/);
  assert.match(contractSource, /CONTENT_TRACE_SET: "setWorldTraceEnabled"/);
});

test("background persists per-tab trace state and propagates trace enablement to content", () => {
  assert.match(backgroundSource, /const tabWorldTraceStateByTabId = new Map\(\);/);
  assert.match(backgroundSource, /function setWorldTraceEnabled\(tabId, enabled\) \{/);
  assert.match(backgroundSource, /type: WORLD_MESSAGE_TYPES\.CONTENT_TRACE_SET,/);
  assert.match(backgroundSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.TRACE_SET\) \{/);
  assert.match(backgroundSource, /snapshot-requested/);
  assert.match(backgroundSource, /set-requested/);
  assert.match(backgroundSource, /traceEnabled: Boolean\(traceState && traceState\.enabled\),/);
  assert.match(backgroundSource, /traceEvents: traceState && Array\.isArray\(traceState\.events\) \? \[\.\.\.traceState\.events\] : \[\]/);
});

test("popup exposes trace mode toggle and syncs with background state", () => {
  assert.match(popupUiSource, /id: "trace-mode-enabled"/);
  assert.match(popupUiSource, /onChange: handlers\.onTraceModeToggle/);
  assert.match(textSource, /traceModeLabel:/);
  assert.match(textSource, /diagnosticsSectionTitle:/);
  assert.doesNotMatch(textSource, /traceModeHint:/);

  assert.match(popupSource, /async function handleTraceModeToggle\(event\) \{/);
  assert.match(popupSource, /type: WORLD_MESSAGE_TYPES\.TRACE_SET,/);
  assert.match(popupSource, /state\.traceModeEnabled = Boolean\(snapshot\.traceEnabled\);/);
  assert.match(popupSource, /state\.traceEvents = Array\.isArray\(snapshot\.traceEvents\) \? \[\.\.\.snapshot\.traceEvents\] : \[\];/);
  assert.match(popupSource, /nextViewState\.traceEvents = Array\.isArray\(state\.traceEvents\) \? state\.traceEvents : \[\];/);
  assert.match(popupSource, /nextViewState\.traceEventCount = nextViewState\.traceEvents\.length;/);
  assert.match(popupSource, /nextViewState\.traceModeEnabled = Boolean\(state\.traceModeEnabled\);/);
  assert.match(popupSource, /const GLOBAL_TRACE_MODE_KEY = "globalTraceModeEnabled";/);
  assert.match(popupSource, /async function loadTraceModeSetting\(\) \{/);
  assert.match(popupSource, /async function persistTraceModeSetting\(enabled\) \{/);
  assert.match(popupSource, /await persistTraceModeSetting\(enabled\)\.catch\(\(\) => null\);/);
  assert.match(popupSource, /state\.traceModeEnabled = await loadTraceModeSetting\(\)\.catch\(\(\) => false\);/);
  assert.match(popupSource, /await applyTraceModePreferenceToTab\(initTabId, state\.traceModeEnabled\)\.catch\(\(\) => null\);/);
  assert.match(popupSource, /await applyTraceModePreferenceToTab\(newTabId, state\.traceModeEnabled\)\.catch\(\(\) => null\);/);
  assert.match(popupSource, /if \(changes\[GLOBAL_THEME_KEY\] \|\| changes\[GLOBAL_THEME_MODE_KEY\] \|\| changes\[GLOBAL_TRACE_MODE_KEY\]\)/);
  assert.match(popupUiSource, /trace-events-panel/);
  assert.match(popupUiSource, /id: "trace-events-output"/);
  assert.match(popupUiSource, /Boolean\(view\.traceModeEnabled\)/);
  assert.doesNotMatch(popupUiSource, /trace-events-list/);
});

test("diagnostics section renders after optional remote support section", () => {
  const diagnosticsIndex = popupUiSource.indexOf("diagnosticsSectionTitle");
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

test("content supports runtime trace toggling and traces inbound\/outbound world traffic", () => {
  assert.match(contentSource, /let worldTraceEnabled = false;/);
  assert.match(contentSource, /if \(message\.type === WORLD_MESSAGE_TYPES\.CONTENT_TRACE_SET\) \{/);
  assert.match(contentSource, /\[world-trace\]\[content\] runtime:inbound/);
  assert.match(contentSource, /\[world-trace\]\[content\] runtime:send/);
  assert.match(contentSource, /\[world-trace\]\[content\] lifecycle:emit/);
});
