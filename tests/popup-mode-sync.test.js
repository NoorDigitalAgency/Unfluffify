import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("content inspection status reports the authoritative marking mode", () => {
  const statusBlock = extractSourceBlock(
    contentSource,
    'if (message.type === "getInspectionStatus") {',
    'if (message.type === "renderModeInspectionBegin") {'
  );

  assert.match(statusBlock, /markingEnabled: Boolean\(state\.enabled\)/);
  assert.match(statusBlock, /mode: state\.enabled \? CONTENT_MODES\.MARKING : CONTENT_MODES\.SILENT/);
});

test("popup refresh reconciles toggle state to content mode without setEnabled", () => {
  const refreshBlock = extractSourceBlock(
    popupSource,
    "async function refreshUiInner(options = {})",
    "async function maybeResumePersistedAiRun"
  );
  const modeStart = refreshBlock.indexOf("let contentModeStatus = null;");
  const modeEnd = refreshBlock.indexOf("let isEnabled = toggleEnabled;", modeStart);
  assert.ok(modeStart > -1);
  assert.ok(modeEnd > modeStart);
  const modeBlock = refreshBlock.slice(modeStart, modeEnd);

  assert.match(modeBlock, /messages\.sendTabMessageToTab\(currentTabId, \{\s*type: "getInspectionStatus"\s*\}\)\.catch\(\(\) => null\)/);
  assert.match(modeBlock, /typeof contentModeStatus\.markingEnabled === "boolean"/);
  assert.match(modeBlock, /const contentMarkingEnabled = Boolean\(contentModeStatus\.markingEnabled\);/);
  assert.match(modeBlock, /effectiveTabState = \{[\s\S]*?enabled: contentMarkingEnabled,[\s\S]*?\};/);
  assert.match(modeBlock, /await messages\.setTabState\(currentTabId, effectiveTabState\);/);
  assert.match(modeBlock, /clearLastPopupEnabled\(\);/);
  assert.match(modeBlock, /const shouldPreserveEnabledDuringReactivation = Boolean\(/);
  assert.match(
    modeBlock,
    /toggleEnabled = shouldPreserveEnabledDuringReactivation[\s\S]*?\? Boolean\(effectiveTabState\.enabled\)[\s\S]*?: contentMarkingEnabled;/
  );
  assert.doesNotMatch(modeBlock, /setEnabled/);
});

test("popup runtime inspection status reuses the content-mode response", () => {
  const refreshBlock = extractSourceBlock(
    popupSource,
    "async function refreshUiInner(options = {})",
    "async function maybeResumePersistedAiRun"
  );

  assert.match(
    refreshBlock,
    /let inspectionStatus =\s*contentModeStatus \|\|\s*\(markingInspectionInScope \|\| silentInspectionInScope[\s\S]*?type: "getInspectionStatus"/
  );
});
