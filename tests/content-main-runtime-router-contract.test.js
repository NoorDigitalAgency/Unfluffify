import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const contentMainPath = new URL("../content-main.js", import.meta.url);
const runtimeMessageHandlerPath = new URL("../content/runtime-message-handler.js", import.meta.url);
const supportPageRouterPath = new URL(
  "../content/remote-support-support-page-message-handler.js",
  import.meta.url
);

const contentMainSource = readFileSync(contentMainPath, "utf8");
const runtimeMessageHandlerSource = existsSync(runtimeMessageHandlerPath)
  ? readFileSync(runtimeMessageHandlerPath, "utf8")
  : "";
const supportPageRouterSource = existsSync(supportPageRouterPath)
  ? readFileSync(supportPageRouterPath, "utf8")
  : "";

const commandRegistrations = [
  "activateContentMain",
  "setEnabled",
  "getInspectionStatus",
  "renderModeInspectionBegin",
  "runRenderModeRevealOnce",
  "captureRenderModeInspectionHtml",
  "renderModeInspectionEnd",
  "hideConsentForInspection"
];

const legacyRuntimeMessages = [
  "remoteSupportViewerTransportStart",
  "remoteSupportViewerTransportStop",
  "remoteSupportViewerTransportSendData",
  "remoteSupportStateChanged",
  "remoteSupportFrame",
  "setEnabled",
  "getInspectionStatus",
  "renderModeInspectionBegin",
  "runRenderModeRevealOnce",
  "captureRenderModeInspectionHtml",
  "renderModeInspectionEnd",
  "hideConsentForInspection",
  "remoteSupportState",
  "remoteSupportModeChanged",
  "getAiPreviewState",
  "setAiPreviewExpandedMode",
  "setAiComputeLock",
  "closeAiPreview",
  "configUpdated",
  "forceRefresh",
  "getDefaultExclusions",
  "collectPageData",
  "filterXPathsOnPage",
  "collectAiSubmissionXpaths",
  "filterInvisibleXpathsOnPage",
  "describeXPathsOnPage",
  "focusElement",
  "clearFocus",
  "capturePageSnapshot",
  "getPageDraftStatus",
  "setPageSaveReconciliationPending",
  "clearPageSaveReconciliation",
  "setExplicitExclude",
  "setExplicitInclude",
  "savePageDraft",
  "revertPageDraft",
  "showAiPreview"
];

function containsMessageType(source, messageType) {
  if (!source) {
    return false;
  }
  const escapedType = messageType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const routingPatterns = [
    new RegExp(`message\\.type\\s*===\\s*"${escapedType}"`),
    new RegExp(`case\\s+"${escapedType}"\\s*:`)
  ];
  return routingPatterns.some((pattern) => pattern.test(source));
}

test("runtime command registrations stay present in content-main", () => {
  for (const commandName of commandRegistrations) {
    assert.match(
      contentMainSource,
      new RegExp(`registerContentCommand\\("${commandName}"`),
      `expected command registration for ${commandName}`
    );
  }
});

test("legacy runtime message inventory stays available across runtime routers", () => {
  for (const messageType of legacyRuntimeMessages) {
    const found = [
      containsMessageType(contentMainSource, messageType),
      containsMessageType(runtimeMessageHandlerSource, messageType),
      containsMessageType(supportPageRouterSource, messageType)
    ].some(Boolean);
    assert.equal(found, true, `expected legacy runtime message branch for ${messageType}`);
  }
});

test("content-main keeps a legacy onMessage listener registration", () => {
  assert.match(
    contentMainSource,
    /chrome\.runtime\.onMessage\.addListener\(/,
    "expected content-main.js to keep legacy runtime listener registration"
  );
});
