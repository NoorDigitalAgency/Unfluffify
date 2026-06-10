import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("popup restores startup/tab snapshot from background command", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const start = source.indexOf("async function restoreSpinnerQueueFromBackground(tabId)");
  const end = source.indexOf("async function handleTraceModeToggle", start);
  assert.ok(start >= 0 && end > start, "Expected restoreSpinnerQueueFromBackground in popup.js");
  const block = source.slice(start, end);

  assert.match(block, /messages\.requestPopupTabViewState\(tabId\)/);
  assert.match(block, /applyBackgroundStateSnapshot\(viewState\.state\)/);
  assert.doesNotMatch(block, /setTabState\(/);
});

test("popup tab snapshot helper sends POPUP_GET_TAB_VIEW_STATE via runtime envelope", () => {
  const source = readFileSync(new URL("../popup/messages.js", import.meta.url), "utf8");

  assert.match(source, /requestPopupTabViewState\(tabId/);
  assert.match(source, /requestRuntime\(\{/);
  assert.match(source, /type:\s*POPUP_GET_TAB_VIEW_STATE_COMMAND/);
  assert.match(source, /tabId,/);
});
