import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const propertyLockUiSource = readFileSync(new URL("../popup/property-lock-ui.js", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
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
    contentSource,
    "function applyPropertyLockServerMessage(serverMessage) {",
    "function updatePropertyLockBannerMode()"
  );
  const renderBlock = extractSourceBlock(
    contentSource,
    "function renderPropertyLockBanner()",
    "function clearPropertyLockBannerCountdown()"
  );
  const endHandlerStart = contentSource.indexOf('if (message.type === "renderModeInspectionEnd") {');
  const endHandlerEnd = contentSource.indexOf('if (message.type === "hideConsentForInspection") {', endHandlerStart);
  assert.ok(endHandlerStart > -1);
  assert.ok(endHandlerEnd > endHandlerStart);
  const endHandlerBlock = contentSource.slice(endHandlerStart, endHandlerEnd);

  assert.match(contentSource, /function isRenderModeInspectionActive\(\) \{[\s\S]*?renderModeInspectionActive \|\| readRenderModeInspectionActive\(\)/);
  assert.match(
    applyBlock,
    /if \(type === PROPERTY_LOCK_WS_DISCONNECT_WARNING\) \{[\s\S]*?if \(isRenderModeInspectionActive\(\)\) \{[\s\S]*?propertyLockBannerMode = "editor_inspection_reconnecting";[\s\S]*?clearPropertyLockBannerCountdown\(\);[\s\S]*?return;/
  );
  assert.match(
    applyBlock,
    /serverMessage\.connectionStatus === PROPERTY_LOCK_CONNECTION_UNAVAILABLE[\s\S]*?if \(isRenderModeInspectionActive\(\)\) \{[\s\S]*?propertyLockBannerMode = "editor_inspection_reconnecting";[\s\S]*?return;/
  );
  assert.match(renderBlock, /case "editor_inspection_reconnecting":[\s\S]*?propertyLockText\.editorInspectionReconnectingMessage/);
  assert.match(endHandlerBlock, /propertyLockBannerMode === "editor_inspection_reconnecting"[\s\S]*?updatePropertyLockBannerMode\(\);[\s\S]*?renderPropertyLockBanner\(\);/);
  assert.match(textSource, /popupInspectionReconnecting: "Reconnecting after inspection\.\.\."/);
  assert.match(textSource, /editorInspectionReconnectingMessage: "Reconnecting after inspection\.\.\."/);
});
