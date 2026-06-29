import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

// Regression: reconciliation-pending authority is brain-owned. Content owns only
// the IndexedDB write and reports the save lifecycle as a fact; the brain holds
// pageSaveReconciliationPending and dictates UI from it. The popup must NOT
// report the boolean fact itself — it consumes brain dictation. This keeps a
// single content->brain bridge for the flag and removes popup/content input
// authority over the dictated phase.

test("core exposes a reconciliation fact reporter and fires it on set/clear/refresh", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /export function setPageSaveReconciliationFactReporter\(\s*reporter: \(\(pending: boolean\) => void\) \| null\s*\): void \{/
  );
  const setStart = source.indexOf("export async function setPageSaveReconciliationPending(");
  assert.ok(setStart > -1, "setPageSaveReconciliationPending must exist");
  const setBody = source.slice(setStart, setStart + 800);
  assert.match(setBody, /reportPageSaveReconciliationFact\(isPageSaveReconciliationPending\(pageUrl\)\);/);
  const clearStart = source.indexOf("export async function clearPageSaveReconciliation(");
  assert.ok(clearStart > -1, "clearPageSaveReconciliation must exist");
  const clearBody = source.slice(clearStart, clearStart + 800);
  assert.match(clearBody, /reportPageSaveReconciliationFact\(isPageSaveReconciliationPending\(pageUrl\)\);/);
  const refreshStart = source.indexOf("export async function refreshPageSaveReconciliation(");
  assert.ok(refreshStart > -1, "refreshPageSaveReconciliation must exist");
  const refreshBody = source.slice(refreshStart, refreshStart + 800);
  assert.match(refreshBody, /reportPageSaveReconciliationFact\(isPageSaveReconciliationPending\(pageUrl\)\);/);
});

test("content-main wires the reporter to publishContentSessionFacts", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  assert.match(source, /publishContentSessionFacts/);
  assert.match(
    source,
    /core\.setPageSaveReconciliationFactReporter\(\(pending\) => \{\s*void publishContentSessionFacts\(\{ pageSaveReconciliationPending: pending \}\);/
  );
});

test("popup no longer reports pageSaveReconciliationPending as a session fact", () => {
  const source = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
  const reportStart = source.indexOf("publishCurrentSessionFacts(currentTabId, {");
  assert.ok(reportStart > -1, "popup must publish session facts");
  const reportBody = source.slice(reportStart, reportStart + 1400);
  assert.doesNotMatch(reportBody, /^\s*pageSaveReconciliationPending,$/m);
});
