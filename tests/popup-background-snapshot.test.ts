import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("popup restores startup snapshot from background popup.view state without mutating tab state directly", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const block = source.match(
    /async function restoreSpinnerQueueFromBackground\(tabId(?:\s*:\s*[^,)]+)?, popupBus(?:\s*:\s*[^,)]+)?\)(?:: [^{]+)? \{[\s\S]*?\n\}\n\nasync function handleTraceModeToggle/
  )?.[0];
  assert.ok(block, "Expected restoreSpinnerQueueFromBackground in popup.ts");

  assert.match(block, /requestPopupView\(popupBus, tabId\)/);
  assert.match(block, /applyPopupViewSnapshot\(viewState\)/);
  assert.doesNotMatch(block, /setTabState\(/);
});

test("popup tab snapshot helper requests popup.view.get from the background realm", () => {
  const source = readFileSync(new URL("../src/popup/layers/popup-bus-client.ts", import.meta.url), "utf8");

  assert.match(source, /requestPopupView\(bus/);
  assert.match(source, /POPUP_STATE_REQUEST_TYPES\.GET/);
  assert.match(source, /target: REALMS\.BACKGROUND/);
  assert.match(source, /tab: tabId/);
});
