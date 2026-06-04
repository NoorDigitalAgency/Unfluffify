import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PopupText } from "../common/text.js";
import {
  getRenderModeOptionIcon,
  getRenderModeOptionLabel,
  resolveRenderModeInspectionReloadOutcome
} from "../popup/render-mode.js";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("render mode text copy uses the updated manual comparison wording", () => {
  assert.equal(
    PopupText.renderMode.copyLookAlmostSame,
    "Meaningful content the same in both"
  );
  assert.equal(
    PopupText.renderMode.copyLookVeryDifferent,
    "Meaningful content only with JavaScript"
  );
});

test("render mode editor shows a textual selected-mode summary instead of a visible dropdown", () => {
  const editorBlock = extractSourceBlock(
    uiSource,
    "function renderRenderModeEditor",
    "function getTodoProgress"
  );

  assert.match(editorBlock, /const selectedRenderModeLabel = getRenderModeOptionLabel\(view\.renderModeValue\);/);
  assert.match(editorBlock, /const selectedRenderModeIcon = getRenderModeOptionIcon\(view\.renderModeValue\);/);
  assert.match(editorBlock, /class:\s*"render-mode-selected-value"/);
  assert.match(editorBlock, /icon\(selectedRenderModeIcon, "render-mode-selected-value__icon"\)/);
  assert.match(editorBlock, /selectedRenderModeLabel/);
  assert.match(editorBlock, /id:\s*"render-mode",[\s\S]*class:\s*"u-d-none"/);
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
  // After the reload, the popup reconciles the property lock so it stops showing
  // "disconnected" once the content re-claims the lock (#9).
  assert.match(
    followUpBlock,
    /await reconcilePropertyLockAfterRenderModeReload\(\);/
  );
});

test("the property lock is reconciled (polled until reconnected) after a render-mode reload", () => {
  const reconcileBlock = extractSourceBlock(
    popupSource,
    "async function reconcilePropertyLockAfterRenderModeReload",
    "function buildTodoExpansionContextKey"
  );
  assert.match(reconcileBlock, /refreshPropertyLockSnapshot\(siteId\)/);
  assert.match(reconcileBlock, /PROPERTY_LOCK_CONNECTION_CONNECTED/);
  assert.match(reconcileBlock, /PROPERTY_LOCK_CONNECTION_INACTIVE/);
  assert.match(reconcileBlock, /skipPropertyLockFetch: true/);
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
