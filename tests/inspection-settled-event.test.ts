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

test("popup clears the navigation-inspection overlay on inspectionSettled", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const handlerStart = source.indexOf('message.type === "inspectionSettled"');
  assert.ok(handlerStart > -1, "popup must handle inspectionSettled");
  const handlerBody = source.slice(handlerStart, handlerStart + 400);
  assert.match(handlerBody, /endNavigationInspectionOverlay\(\)/);
  assert.match(handlerBody, /scheduleRefresh\(\)/);
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
