import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("popup scheduleRefresh uses the quiet refresh path", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function scheduleRefresh\(\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
});

test("quiet popup refresh skips redundant property lock fetches", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(source, /const skipPropertyLockFetch = Boolean\(options\.skipPropertyLockFetch\);/);
  assert.match(source, /if \(!skipPropertyLockFetch \|\| !state\.propertyLockState\) \{[\s\S]*?fetchPropertyLockState/);
});

test("explicit include and exclude removals use the quiet refresh path", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /async function handleExplicitExcludeRemove\(xpath\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /async function handleExplicitIncludeRemove\(xpath\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
});

test("Todo List completion uses backend-saved markings instead of local drafts", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /const backendSavedPageMarkings = state\.currentBaseUrl[\s\S]*?config\.getBackendSavedPageMarkings\(state\.currentBaseUrl\)/
  );
  assert.match(
    source,
    /const pageTypeCoverageModel = buildLynxChecklistViewModel\(\{[\s\S]*?markedPages: backendSavedPageMarkingItems[\s\S]*?\}\);/
  );
  assert.match(
    source,
    /const pageMarkingItemByKey = new Map\(\s*backendSavedPageMarkingItems\.map/
  );
  assert.match(
    source,
    /nextViewState\.pageTypeGroups = pageTypeCoverageModel\.pageTypes\.map/
  );
});

test("config sync does not upload unsaved local page drafts by default", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(source, /includeCurrentPageMarking = false/);
  assert.match(
    source,
    /const backendSavedPageMarkings = await config\.getBackendSavedPageMarkings\(resolvedBaseUrl\)/
  );
  assert.match(
    source,
    /backendSavedPageUrls\.has\(url\) \|\| \(includeCurrentPageMarking && url === pageUrl\)/
  );
  assert.match(
    source,
    /type: "savePageDraft"[\s\S]*?syncBaseConfigToServer\(\{[\s\S]*?includeCurrentPageMarking: true/
  );
  assert.match(
    source,
    /function hasBackendSavedPageMarking\(pageMarkings, pageUrl\) \{[\s\S]*?normalizeCandidatePageUrl\(url\) === normalizedTargetUrl/
  );
  assert.match(
    source,
    /loadResult\.status !== "ok" \|\|[\s\S]*?!hasBackendSavedPageMarking\(backendSavedAfterLoad, pageUrl\)/
  );
});

test("content saved baseline is refreshed from backend cache, not local drafts", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /export async function refreshSavedPageEntryFromBackendCache[\s\S]*?config\.getBackendSavedPageMarkings\(baseUrl\)/
  );
  assert.match(
    contentSource,
    /if \(message\.type === "getPageDraftStatus"\) \{[\s\S]*?refreshSavedPageEntryFromBackendCache\(targetBaseUrl, pageUrl\)/
  );
  assert.match(
    contentSource,
    /if \(message\.type === "clearPageSaveReconciliation"\) \{[\s\S]*?config\.getBackendSavedPageMarkings\(targetBaseUrl\)/
  );
  assert.doesNotMatch(contentSource, /confirmed local snapshot|immediate post-save remote reload omits/);
});
