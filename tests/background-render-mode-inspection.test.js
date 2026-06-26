import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import wxtConfig from "../wxt.config";

const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
const renderModeInspectorSource = readFileSync(new URL("../src/background/render-mode-inspector.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const popupMessagesSource = readFileSync(new URL("../src/popup/messages.ts", import.meta.url), "utf8");
const manifestPermissions = wxtConfig.manifest?.permissions || [];

test("background keeps only the granular render-mode helper commands tab-scoped", () => {
  assert.match(backgroundSource, /TAB_BEGIN_RENDER_MODE_INSPECTION: "TAB_BEGIN_RENDER_MODE_INSPECTION"/);
  assert.match(backgroundSource, /TAB_RUN_REVEAL_FREEZE: "TAB_RUN_REVEAL_FREEZE"/);
  assert.match(backgroundSource, /TAB_CAPTURE_RENDER_MODE_HTML: "TAB_CAPTURE_RENDER_MODE_HTML"/);
  assert.doesNotMatch(backgroundSource, /TAB_END_RENDER_MODE_INSPECTION: "TAB_END_RENDER_MODE_INSPECTION"/);
  assert.doesNotMatch(backgroundSource, /TAB_RUN_RENDER_MODE_INSPECTION: "TAB_RUN_RENDER_MODE_INSPECTION"/);
  assert.match(backgroundSource, /TAB_SCOPED_BACKGROUND_COMMANDS = new Set\(\[[\s\S]*?BACKGROUND_COMMANDS\.TAB_CAPTURE_RENDER_MODE_HTML/);
});

test("popup render-mode inspection delegates through the popup render-mode bus layer", () => {
  const block = popupSource.match(
    /async function runRenderModeInspectionReload\(javaScriptDisabled(?:\s*:\s*[^)]*)?\) \{([\s\S]*?)\n\}(?:\n|\r\n)+(?:\/\/ @ts-(?:ignore|expect-error)[^\n]*\n)?(?:\n|\r\n)*async function normalizeRenderModeDebuggerPage/
  )[1];

  assert.match(block, /requestPopupRenderModeInspection\(tabId, \{/);
  assert.match(block, /baseUrl: state\.currentBaseUrl/);
  assert.match(block, /javaScriptDisabled/);
  assert.doesNotMatch(block, /messages\.requestTabRunRenderModeInspection/);
});

test("background registers render-mode bus handlers directly against the new helpers", () => {
  assert.match(backgroundSource, /brain\.bus\.registerHandler\(RENDER_MODE_REQUEST_TYPES\.RUN_INSPECTION,[\s\S]*?executeRenderModeInspection\(normalizedTabId, payload\)/);
  assert.match(backgroundSource, /brain\.bus\.registerHandler\(RENDER_MODE_REQUEST_TYPES\.END_INSPECTION,[\s\S]*?executeRenderModeInspectionEnd\(normalizedTabId, payload\)/);
  assert.doesNotMatch(popupMessagesSource, /export function requestTabRunRenderModeInspection\(/);
  assert.doesNotMatch(popupMessagesSource, /export function requestTabEndRenderModeInspection\(/);
});

test("background executeRenderModeInspection orchestrates reload, capture, and end while tracking the no-js hold", () => {
  const commandBlock = backgroundSource.match(
    /async function executeRenderModeInspection\([\s\S]*?\{([\s\S]*?)\n\}\n\nregisterBackgroundCommand\(BACKGROUND_COMMANDS\.TAB_RUN_AI/
  )[1];

  assert.match(commandBlock, /runBackgroundTabOperation\([\s\S]*?kind: LIFECYCLE_KINDS\.RENDER_MODE_INSPECTION/);
  assert.match(commandBlock, /runRenderModeInspectionBeginStep\(normalizedTabId, operationId\)/);
  assert.match(commandBlock, /waitForTabLoadStartInBackground\(/);
  assert.match(commandBlock, /utils\.reloadPageWithJavaScriptControl\(/);
  assert.match(commandBlock, /if \(javaScriptDisabled\) \{[\s\S]*?captureResult = await captureRenderModeHtmlWithDebugger\(normalizedTabId\);[\s\S]*?\} else \{[\s\S]*?runRenderModeHideConsentStep\(normalizedTabId\)[\s\S]*?runRenderModeCaptureHtmlStep\(\s*normalizedTabId,\s*baseUrl,\s*operationId\s*\)/);
  assert.match(commandBlock, /sendRenderModeInspectionEndWithRetry\(\s*normalizedTabId,\s*operationId\s*\)/);
  assert.match(commandBlock, /clearRenderModeNoJsHeld\(normalizedTabId\)/);
  assert.match(commandBlock, /if \(javaScriptDisabled && javaScriptReloadAttempted\) \{[\s\S]*?await setRenderModeNoJsHeld\(normalizedTabId, true\);[\s\S]*?updateRenderModeNoJsInactivityWatch\(normalizedTabId\)\.catch\(\(\) => null\);/);
});

test("background executeRenderModeInspectionEnd restores JavaScript and clears the no-js hold", () => {
  const endBlock = backgroundSource.match(
    /async function executeRenderModeInspectionEnd\([\s\S]*?\{([\s\S]*?)\n\}\n\nasync function executeRenderModeInspection/
  )[1];

  assert.match(endBlock, /if \(await isRenderModeNoJsHeld\(normalizedTabId\)\) \{/);
  assert.match(endBlock, /clearRenderModeNoJsHeld\(normalizedTabId\)/);
  assert.match(endBlock, /tabInactivityObserver\.clearTab\(normalizedTabId,[\s\S]*?scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE/);
  assert.match(endBlock, /utils\.setPageJavaScriptExecutionDisabled\(normalizedTabId, false\)/);
  assert.match(endBlock, /utils\.detachDebugger\(normalizedTabId\)/);
  assert.match(endBlock, /brain\.recordRenderModeInspection\(normalizedTabId, \{[\s\S]*?inspecting: false,[\s\S]*?noJsHeld: false/);
});

test("background restores no-js render-mode holds after central tab inactivity", () => {
  const activityMessageBlock = backgroundSource.match(
    /if \(message\.type === "pageActivityObserved"\) \{([\s\S]*?)\n {2}\}\n\n {2}if \(PROPERTY_LOCK_MESSAGE_TYPES/
  )[1];

  assert.equal(manifestPermissions.includes("alarms"), true);
  assert.match(backgroundSource, /const RENDER_MODE_NO_JS_INACTIVITY_SCOPE = "render-mode-no-js";/);
  assert.match(backgroundSource, /const RENDER_MODE_NO_JS_INACTIVITY_TIMEOUT_MS = 30_000;/);
  assert.match(backgroundSource, /const tabInactivityObserver = createTabInactivityObserver\(\{/);
  assert.match(backgroundSource, /async function updateRenderModeNoJsInactivityWatch\(tabId(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?tabInactivityObserver\.scheduleInactive\(normalizedTabId, \{[\s\S]*?scope: RENDER_MODE_NO_JS_INACTIVITY_SCOPE/);
  assert.match(backgroundSource, /async function restoreRenderModeJavaScriptAfterNoJsInactivity\(\s*tabId(?:\s*:\s*[^,)]+)?,?\s*\)(?:\s*:\s*[^{]+)? \{[\s\S]*?clearRenderModeNoJsHeld\(normalizedTabId\)[\s\S]*?utils\.reloadPageWithJavaScriptControl\(normalizedTabId, false\)[\s\S]*?utils\.detachDebugger\(normalizedTabId\)/);
  assert.match(backgroundSource, /tabInactivityObserver\.subscribe\(async \(event\) => \{[\s\S]*?event\.scope !== RENDER_MODE_NO_JS_INACTIVITY_SCOPE[\s\S]*?restoreRenderModeJavaScriptAfterNoJsInactivity\(event\.tabId\)/);
  assert.match(activityMessageBlock, /tabInactivityObserver\.recordActivity\(tabId, \{[\s\S]*?source: "content"/);
  assert.match(activityMessageBlock, /updateRenderModeNoJsInactivityWatch\(tabId\)/);
});

test("background render-mode consent hide is separate from HTML capture", () => {
  assert.match(
    renderModeInspectorSource,
    /async function runRenderModeHideConsentStep\(tabId\) \{[\s\S]*?RENDER_MODE_REQUEST_TYPES\.CONTENT_HIDE_CONSENT/
  );
  const helperBlock = renderModeInspectorSource.match(
    /async function runRenderModeCaptureHtmlStep\(tabId, baseUrl, operationId\) \{([\s\S]*?)\n {2}\}/
  )[1];

  assert.match(helperBlock, /RENDER_MODE_REQUEST_TYPES\.CONTENT_CAPTURE_HTML/);
  assert.doesNotMatch(helperBlock, /hideConsentForInspection/);
});
