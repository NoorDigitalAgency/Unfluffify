import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

// Regression: the popup curtain ("Inspecting page..."/"Working...") must clear
// from a deterministic content-emitted settle event, not only from popup
// polling. Content reports the fact (`inspectionSettled`); the popup re-reads
// inspection status once and ends the navigation-inspection overlay, which lets
// the brain `navigationInspectionPending` fact go false and the brain clear the
// dual-broadcast curtain. This keeps curtain authority brain-side (the popup
// only reports a fact + ends its overlay; it does not invent curtain state).

test("core finishPageInspectionUi fires the settled listener on every settle", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /export function setPageInspectionUiSettledListener\(listener: \(\(\) => void\) \| null\): void \{/
  );
  const fnStart = source.indexOf("export function finishPageInspectionUi()");
  assert.ok(fnStart > -1, "finishPageInspectionUi must exist");
  const fnEnd = source.indexOf("\n}", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.match(body, /if \(pageInspectionUiSettledListener\) \{\s*pageInspectionUiSettledListener\(\);/);
});

test("content-main emits inspectionSettled and registers it as the settle listener", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  assert.match(source, /function notifyInspectionSettled\(\) \{/);
  assert.match(source, /type: "inspectionSettled"/);
  assert.match(source, /core\.setPageInspectionUiSettledListener\(notifyInspectionSettled\);/);
});

test("silent-highlight editor activation fires a second inspectionSettled after editorPreparation clears", () => {
  // The silent-highlight editor reveal/freeze (silentHighlightEditorActivationPromise)
  // is a component of the content inspection `pending` fact, but it clears AFTER
  // the page-inspection UI already fired its single inspectionSettled event. Without
  // a second settle signal here, the popup's last poll sees pending=true and nothing
  // re-triggers a refresh, so the "Preparing page content..." curtain sticks. The
  // activation completion must fire notifyInspectionSettled() so the popup re-polls.
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function runEditorSilentHighlightingActivation(");
  assert.ok(fnStart > -1, "runEditorSilentHighlightingActivation must exist");
  const fnEnd = source.indexOf("async function runEditorSilentHighlightingActivationOnce(", fnStart);
  assert.ok(fnEnd > fnStart, "activation function boundary must resolve");
  const body = source.slice(fnStart, fnEnd);
  const nullIdx = body.indexOf("silentHighlightEditorActivationPromise = null;");
  const notifyIdx = body.indexOf("notifyInspectionSettled();");
  assert.ok(nullIdx > -1, "activation must clear its in-flight promise");
  assert.ok(
    notifyIdx > nullIdx,
    "notifyInspectionSettled() must fire after the activation promise clears"
  );
});

test("content warmups leave inspection UI toggling to the brain pageCurtain", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  const warmupStart = source.indexOf("async function inspectPageBeforeMotionPause(");
  const warmupEnd = source.indexOf("export function setPageInspectionUiSettledListener", warmupStart);
  assert.ok(warmupStart > -1);
  assert.ok(warmupEnd > warmupStart);
  const warmupSource = source.slice(warmupStart, warmupEnd);
  assert.doesNotMatch(warmupSource, /setPageInspectionUiActive\(/);
  const busSource = readFileSync(new URL("../src/content/layers/content-bus-client.ts", import.meta.url), "utf8");
  assert.match(busSource, /setPageCurtainRenderer\(\(visible, state\) => \{[\s\S]*?setPageInspectionUiActive\(visible\);/);
  // Data-affecting curtains (blockSurfaces.page) must raise the REAL page input
  // block, not just the inspection tint; non-blocking curtains and clears release it.
  assert.match(busSource, /const pageBlocking = Boolean\(visible && blockSurfaces && blockSurfaces\.page === true\);/);
  assert.match(busSource, /if \(pageBlocking\) \{[\s\S]*?setPopupBusyOnPage\(true, message, \{ operationId, releaseBy \}\);[\s\S]*?\} else \{[\s\S]*?setPopupBusyOnPage\(false\);/);
});

test("popup reports navigation-inspection settle facts on inspectionSettled", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const handlerStart = source.indexOf('message.type === "inspectionSettled"');
  assert.ok(handlerStart > -1, "popup must handle inspectionSettled");
  const handlerBody = source.slice(handlerStart, handlerStart + 400);
  assert.match(handlerBody, /endNavigationInspectionOverlay\(\)/);
  assert.match(handlerBody, /scheduleRefresh\(\)/);
  const reporterStart = source.indexOf("function reportNavigationInspectionSettledToBrain(");
  assert.ok(reporterStart > -1, "popup must report settled inspection facts upward");
  const reporterBody = source.slice(reporterStart, reporterStart + 900);
  assert.match(reporterBody, /publishCurrentSessionFacts\(tabId, \{[\s\S]*?navigationInspectionPending: false/);
  assert.match(reporterBody, /pageInspectionBusy: false/);
  assert.match(reporterBody, /busyVisible: false/);
  assert.match(reporterBody, /forgetLocalSpinnerRequest\("navInspect"\)/);
});

test("popup inspection settle timers are bounded fail-opens, not self-rescheduling polls", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  // Bounded one-shot fail-open windows replace the old retry-polling loops.
  assert.match(source, /const NAV_INSPECTION_SETTLE_FAILOPEN_MS = 15_000;/);
  assert.match(source, /const STALE_INSPECTION_FAILOPEN_MS = 15_000;/);

  // The navigation settle scheduler must not re-run itself on a retry delay.
  const navStart = source.indexOf("function scheduleNavigationInspectionSettlePoll(");
  assert.ok(navStart > -1);
  const navEnd = source.indexOf("\nfunction ", navStart + 1);
  const navBody = source.slice(navStart, navEnd);
  assert.doesNotMatch(navBody, /getRetryDelayMs\(/);
  assert.match(navBody, /NAV_INSPECTION_SETTLE_FAILOPEN_MS/);

  // The stale-inspection clearer must not re-poll content status on a 400ms loop.
  const staleStart = source.indexOf("function scheduleStaleInspectionBusyClear(");
  assert.ok(staleStart > -1);
  const staleEnd = source.indexOf("\nfunction ", staleStart + 1);
  const staleBody = source.slice(staleStart, staleEnd);
  assert.doesNotMatch(staleBody, /void run\(\);\s*\}, 400\);/);
  assert.match(staleBody, /STALE_INSPECTION_FAILOPEN_MS/);
});

test("popup publishes inspection facts so the brain heartbeat reconciles a lost settle", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const fnStart = source.indexOf("publishCurrentSessionFacts(currentTabId, {");
  assert.ok(fnStart > -1, "popup must publish session facts each refresh");
  const factsBlock = source.slice(fnStart, fnStart + 600);
  // The 1s brain heartbeat pulls these facts; if the inspectionSettled event is
  // lost, the next published fact value (false) lets the brain clear the curtain
  // without any popup-local poll.
  assert.match(factsBlock, /navigationInspectionPending,/);
  assert.match(factsBlock, /pageInspectionBusy,/);
});

test("brain heartbeat folds reported inspection facts on each tick", async () => {
  const { createBrainHeartbeat } = await import("../src/background/brain/heartbeat.js");
  const folded = [];
  let pending = true;
  const heartbeat = createBrainHeartbeat({
    request: async () => ({ source: "popup", facts: { navigationInspectionPending: pending } }),
    foldFacts: (_tabId, _source, facts) => folded.push(facts.navigationInspectionPending),
    intervalMs: 1000,
    setInterval: (handler) => handler,
    clearInterval: () => {}
  });
  heartbeat.start(3);
  await heartbeat.tick();
  pending = false;
  await heartbeat.tick();
  // The popup reports pending=true then pending=false; the brain folds both,
  // so a missed settle event recovers within one heartbeat instead of needing
  // a popup re-poll.
  assert.equal(folded.includes(true), true);
  assert.equal(folded.includes(false), true);
});

test("brain owns navigation-inspection curtain fail-open clears from reported facts", () => {
  const source = readFileSync(new URL("../src/background/brain/index.ts", import.meta.url), "utf8");
  assert.match(source, /function clearNavigationInspectionCurtainDraft\(/);
  assert.match(source, /const wasNavigationInspectionPending = draft\.sessionFacts\.navigationInspectionPending/);
  assert.match(source, /const wasPageInspectionBusy = draft\.sessionFacts\.pageInspectionBusy/);
  assert.match(source, /nextFacts\.navigationInspectionPending === false &&\s*wasNavigationInspectionPending/);
  assert.match(source, /nextFacts\.pageInspectionBusy === false &&\s*wasPageInspectionBusy/);
  assert.match(source, /clearNavigationInspectionCurtainDraft\(draft\);/);
});

test("popup stale inspection fail-open recognizes local page-inspection busy views", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const fnStart = source.indexOf("function isNavigationInspectionBusyView(");
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf("\n}", fnStart);
  const body = source.slice(fnStart, fnEnd);
  assert.match(body, /view\.busyReason === "page-inspection-pending"/);
});
