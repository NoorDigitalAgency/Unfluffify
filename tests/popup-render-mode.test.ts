import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import { PopupText } from "../src/common/text.js";
import {
  getRenderModeOptionIcon,
  getRenderModeOptionLabel,
  resolveRenderModeInspectionReloadOutcome
} from "../src/popup/render-mode.js";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("render mode text copy uses the updated manual comparison wording", () => {
  assert.equal(PopupText.renderMode.copyLookAlmostSame, "Meaningful content the same in both");
  assert.equal(PopupText.renderMode.copyLookVeryDifferent, "Meaningful content only with JavaScript");
});

test("render mode option label maps known modes and falls back to undetermined", () => {
  assert.equal(getRenderModeOptionLabel("static"), PopupText.renderMode.optionStatic);
  assert.equal(getRenderModeOptionLabel("rendered"), PopupText.renderMode.optionRendered);
  assert.equal(getRenderModeOptionLabel("undetermined"), PopupText.renderMode.optionUndetermined);
  assert.equal(getRenderModeOptionLabel("unexpected"), PopupText.renderMode.optionUndetermined);
});

test("render mode option icon maps known modes and falls back to the dashboard glyph", () => {
  assert.equal(getRenderModeOptionIcon("static"), "language-html5");
  assert.equal(getRenderModeOptionIcon("rendered"), "language-javascript");
  assert.equal(getRenderModeOptionIcon("undetermined"), "monitor-dashboard");
  assert.equal(getRenderModeOptionIcon("unexpected"), "monitor-dashboard");
});

test("render mode inspection reload outcome uses the explicit reload error when reload setup fails", () => {
  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: false, error: "Debugger attach failed" },
      false,
      false
    ),
    {
      ok: false,
      toast: "Debugger attach failed"
    }
  );
});

test("render mode inspection reload outcome fails when navigation never starts", () => {
  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: true },
      false,
      true
    ),
    {
      ok: false,
      toast: PopupText.renderMode.toastInspectReloadFailed
    }
  );
});

test("render mode inspection reload outcome returns the started toast for the chosen javascript mode", () => {
  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: true },
      true,
      false
    ),
    {
      ok: true,
      toast: PopupText.renderMode.toastInspectWithJavaScriptStarted
    }
  );

  assert.deepEqual(
    resolveRenderModeInspectionReloadOutcome(
      { ok: true },
      true,
      true
    ),
    {
      ok: true,
      toast: PopupText.renderMode.toastInspectWithoutJavaScriptStarted
    }
  );
});

test("render mode set still exits no-js inspection and normalizes the page before notifying content", () => {
  const setBlock = extractSourceBlock(
    popupSource,
    "async function handleRenderModeSet",
    "async function handleRenderModeEditToggle"
  );

  assert.match(setBlock, /const wasNoJsHeld = tabId \? await isRenderModeNoJsHeld\(tabId\) : false;/);
  assert.match(
    setBlock,
    /await requestPopupRenderModeInspectionEnd\(tabId,\s*\{[\s\S]*?operationId:\s*`render-mode-set-exit:\$\{tabId\}:\$\{Date\.now\(\)\}`/
  );
  assert.match(
    setBlock,
    /if \(tabId && wasNoJsHeld\) \{[\s\S]*?await messages\.sendTabMessageWithRetry\(\{[\s\S]*?type:\s*"configUpdated"/
  );
  assert.match(
    setBlock,
    /else \{[\s\S]*?await messages\.sendTabMessage\(\{[\s\S]*?type:\s*"configUpdated"/
  );
  assert.match(
    setBlock,
    /if \(tabId && !wasNoJsHeld\) \{[\s\S]*?await normalizeRenderModeDebuggerPage\(tabId\);/
  );
});

test("render mode edit/open flows still refresh without the generic busy curtain", () => {
  const editToggleBlock = extractSourceBlock(
    popupSource,
    "async function handleRenderModeEditToggle",
    "async function handleOpenRenderModeSection"
  );
  const openSectionBlock = extractSourceBlock(
    popupSource,
    "async function handleOpenRenderModeSection",
    "function handleRenderModeSummaryToggle"
  );

  assert.match(editToggleBlock, /await refreshUi\(\{ useBusyOverlay: false \}\);/);
  assert.match(openSectionBlock, /await refreshUi\(\{ useBusyOverlay: false \}\);/);
});
