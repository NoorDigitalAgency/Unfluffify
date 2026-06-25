import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("popup restores startup/tab snapshot from background command", () => {
  const source = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function restoreSpinnerQueueFromBackground(tabId, popupBus)");
  const end = source.indexOf("async function handleTraceModeToggle", start);
  assert.ok(start >= 0 && end > start, "Expected restoreSpinnerQueueFromBackground in popup.js");
  const block = source.slice(start, end);

  assert.match(block, /requestPopupView\(popupBus, tabId\)/);
  assert.match(block, /applyPopupViewSnapshot\(viewState\)/);
  assert.doesNotMatch(block, /setTabState\(/);
});

test("popup tab snapshot helper sends popup.view.get to background over the bus", () => {
  const source = readFileSync(new URL("../popup/layers/popup-bus-client.ts", import.meta.url), "utf8");

  assert.match(source, /requestPopupView\(bus/);
  assert.match(source, /POPUP_STATE_REQUEST_TYPES\.GET/);
  assert.match(source, /target: REALMS\.BACKGROUND/);
  assert.match(source, /tab: tabId/);
});
