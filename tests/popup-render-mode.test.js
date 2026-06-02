import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PopupText } from "../common/text.js";
import { resolveRenderModeInspectionReloadOutcome } from "../popup/render-mode.js";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

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

test("render mode inspection reload waits only for load start and defers post-reload follow-up", () => {
  const inspectionBlock = extractSourceBlock(
    popupSource,
    "async function runRenderModeInspectionReload",
    "async function normalizeRenderModeDebuggerPage"
  );
  const followUpBlock = extractSourceBlock(
    popupSource,
    "async function completeRenderModeInspectionReloadFollowUp",
    "async function runRenderModeInspectionReload"
  );

  assert.match(
    inspectionBlock,
    /const loadStartPromise = waitForTabLoadStart\(\s*tabId,\s*RENDER_MODE_INSPECTION_START_TIMEOUT_MS\s*\);/
  );
  assert.match(
    inspectionBlock,
    /const loadStarted = await loadStartPromise;[\s\S]*?resolveRenderModeInspectionReloadOutcome\(result,\s*loadStarted,\s*javaScriptDisabled\)/
  );
  assert.match(
    inspectionBlock,
    /void completeRenderModeInspectionReloadFollowUp\(tabId\)\.catch\(\(\) => \{\}\);/
  );
  assert.doesNotMatch(
    inspectionBlock,
    /await hideConsentForRenderModeInspection\(\);/
  );
  assert.match(
    followUpBlock,
    /waitForTabLoadComplete\(\s*tabId,\s*RENDER_MODE_INSPECTION_LOAD_TIMEOUT_MS\s*\)/
  );
  assert.match(
    followUpBlock,
    /await hideConsentForRenderModeInspection\(tabId\);/
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
