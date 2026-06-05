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
  assert.match(backgroundSource, /traceEnabled: Boolean\(traceState && traceState\.enabled\),/);
  assert.match(backgroundSource, /traceEvents: traceState && Array\.isArray\(traceState\.events\) \? \[\.\.\.traceState\.events\] : \[\]/);
});

test("popup exposes trace mode toggle and syncs with background state", () => {
  assert.match(popupUiSource, /id: "trace-mode-enabled"/);
  assert.match(popupUiSource, /onChange: handlers\.onTraceModeToggle/);
  assert.match(textSource, /traceModeLabel:/);
  assert.match(textSource, /traceModeHint:/);

  assert.match(popupSource, /async function handleTraceModeToggle\(event\) \{/);
  assert.match(popupSource, /type: WORLD_MESSAGE_TYPES\.TRACE_SET,/);
  assert.match(popupSource, /state\.traceModeEnabled = Boolean\(snapshot\.traceEnabled\);/);
  assert.match(popupSource, /nextViewState\.traceModeEnabled = Boolean\(state\.traceModeEnabled\);/);
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
