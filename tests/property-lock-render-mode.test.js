import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const propertyLockUiSource = readFileSync(new URL("../popup/property-lock-ui.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
const propertyLockBannerSource = readFileSync(new URL("../content/property-lock-banner.js", import.meta.url), "utf8");
const propertyLockStateMachineSource = readFileSync(new URL("../content/property-lock-state-machine.js", import.meta.url), "utf8");
const textSource = readFileSync(new URL("../common/text.js", import.meta.url), "utf8");

function extractSourceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("render-mode reload reclaims the property lock before polling snapshots", () => {
  const block = extractSourceBlock(
    popupSource,
    "async function reconcilePropertyLockAfterRenderModeReload",
    "function buildTodoExpansionContextKey"
  );

  const claimIndex = block.indexOf("sendPropertyLockCommand(PROPERTY_LOCK_CONTENT_TAKE_LOCK");
  const pollIndex = block.indexOf("refreshPropertyLockSnapshot(siteId)");

  assert.ok(claimIndex > -1);
  assert.ok(pollIndex > claimIndex);
  assert.match(block, /renderModeInspectionReconnect: true/);
  assert.match(block, /PROPERTY_LOCK_CONNECTION_CONNECTED/);
  assert.match(block, /PROPERTY_LOCK_CONNECTION_INACTIVE/);
});

test("popup suppresses the disconnect countdown while render-mode inspection is active", () => {
  const viewBlock = extractSourceBlock(
    propertyLockUiSource,
    "export function buildPropertyLockViewState",
    "export async function fetchPropertyLockState"
  );
  const reloadBlock = extractSourceBlock(
    popupSource,
    "async function runRenderModeInspectionReload",
    "async function normalizeRenderModeDebuggerPage"
  );

  const inspectionStatusIndex = viewBlock.indexOf("state.renderModeInspectionActive && state.propertyLockDisconnectCountdown !== null");
  const countdownIndex = viewBlock.indexOf("propertyLockText.editorDisconnectCountdownMessage");

  assert.ok(inspectionStatusIndex > -1);
  assert.ok(countdownIndex > inspectionStatusIndex);
  assert.match(viewBlock, /propertyLockText\.popupInspectionReconnecting/);
  assert.match(reloadBlock, /state\.renderModeInspectionActive = true;[\s\S]*?requestTabRunRenderModeInspection\(/);
  assert.match(reloadBlock, /finally \{[\s\S]*?state\.renderModeInspectionActive = false;[\s\S]*?buildPropertyLockViewState\(\)/);
});

test("content suppresses page-side connection-loss countdown during render-mode inspection", () => {
  const applyBlock = extractSourceBlock(
    propertyLockStateMachineSource,
    "function applyServerMessage(serverMessage) {",
    "return {"
  );
  const renderBlock = extractSourceBlock(
    propertyLockBannerSource,
    "export function renderPropertyLockBanner",
    "export function clearPropertyLockBannerCountdown"
  );
  const endHandlerStart = contentSource.indexOf("function handleRenderModeInspectionEndCommand(message = {}) {");
  const endHandlerEnd = contentSource.indexOf("function handleHideConsentForInspectionCommand()", endHandlerStart);
  assert.ok(endHandlerStart > -1);
  assert.ok(endHandlerEnd > endHandlerStart);
  const endHandlerBlock = contentSource.slice(endHandlerStart, endHandlerEnd);

  assert.match(contentSource, /function isRenderModeInspectionActive\(\) \{[\s\S]*?renderModeInspectionActive \|\| readRenderModeInspectionActive\(\)/);
  assert.match(
    applyBlock,
    /if \(type === deps\.PROPERTY_LOCK_WS_DISCONNECT_WARNING\) \{[\s\S]*?if \(deps\.isRenderModeInspectionActive\(\)\) \{[\s\S]*?deps\.setPropertyLockBannerMode\("editor_inspection_reconnecting"\);[\s\S]*?deps\.clearPropertyLockBannerCountdown\(\);[\s\S]*?return;/
  );
  assert.match(
    applyBlock,
    /serverMessage\.connectionStatus === deps\.PROPERTY_LOCK_CONNECTION_UNAVAILABLE[\s\S]*?if \(deps\.isRenderModeInspectionActive\(\)\) \{[\s\S]*?deps\.setPropertyLockBannerMode\("editor_inspection_reconnecting"\);[\s\S]*?return;/
  );
  assert.match(renderBlock, /case "editor_inspection_reconnecting":[\s\S]*?propertyLockText\.editorInspectionReconnectingMessage/);
  assert.match(endHandlerBlock, /propertyLockBannerMode === "editor_inspection_reconnecting"[\s\S]*?updatePropertyLockBannerMode\(\);[\s\S]*?renderPropertyLockBanner\(\);/);
  assert.match(textSource, /popupInspectionReconnecting: "Reconnecting after inspection\.\.\."/);
  assert.match(textSource, /editorInspectionReconnectingMessage: "Reconnecting after inspection\.\.\."/);
});
