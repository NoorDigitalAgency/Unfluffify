import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const popupSource = readFileSync(new URL("../popup.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
const inspectionStatusSource = readFileSync(new URL("../content/inspection-status.ts", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("content inspection status reports the authoritative marking mode", () => {
  assert.match(contentSource, /function handleGetInspectionStatusCommand\(\) \{[\s\S]*?getInspectionStatusResolver\(\)\.resolve\(\)/);
  assert.match(inspectionStatusSource, /markingEnabled: Boolean\(deps\.isMarkingEnabled\(\)\)/);
  assert.match(inspectionStatusSource, /mode: deps\.getCurrentContentMode\(\)/);
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

test("popup keeps marking mode active when content reports authoritative enabled state", () => {
  const refreshBlock = extractSourceBlock(
    popupSource,
    "async function refreshUiInner(options = {})",
    "async function maybeResumePersistedAiRun"
  );

  assert.match(refreshBlock, /const contentMarkingModeActive = Boolean\(/);
  assert.match(refreshBlock, /const previewRestorePending = Boolean\(state\.previewRestorePending\);/);
  assert.match(
    refreshBlock,
    /const aiComputeRunActive =[\s\S]*?state\.aiRequestInFlight === "compute" \|\| state\.aiComputeStartPending;/
  );
  assert.match(refreshBlock, /const aiPreviewSessionActive = Boolean\(previewActive\);/);
  assert.match(refreshBlock, /const preserveEnabledDuringPreviewCloseRestore = Boolean\(/);
  assert.match(refreshBlock, /const preserveEnabledDuringAiComputeRun = Boolean\(/);
  assert.match(
    refreshBlock,
    /if \([\s\S]*?tabInScope[\s\S]*?\(previewRestorePending \|\| aiComputeRunActive \|\| aiPreviewSessionActive\)[\s\S]*?\(!contentModeKnown \|\| !toggleEnabled\)[\s\S]*?\) \{/
  );
  assert.match(
    refreshBlock,
    /isEnabled = toggleEnabled && \([\s\S]*?contentMarkingModeActive \|\|[\s\S]*?previewRestorePending \|\|[\s\S]*?navigationInspectionPending/
  );
  assert.match(refreshBlock, /!aiComputeRunActive &&[\s\S]*?!aiPreviewSessionActive &&[\s\S]*?!previewRestorePending &&[\s\S]*?!navigationInspectionPending/);
});
