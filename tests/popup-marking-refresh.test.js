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

test("Todo List marks the current candidate's parent subsection", () => {
  const popupSource = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

  assert.match(
    popupSource,
    /const groupCurrent =\s*currentPageMarkingAllowed &&\s*currentPageCandidateState\.pageTypeKey === pageType\.key;/
  );
  assert.match(
    popupSource,
    /current: groupCurrent,[\s\S]*?const isCurrent = groupCurrent && currentPageCandidateState\.url === candidate\.url;/
  );
  assert.match(
    uiSource,
    /group\.current && "todo-subsection--current"/
  );
  assert.match(
    uiSource,
    /group\.current[\s\S]*?todo-subsection-current-badge[\s\S]*?PopupText\.pageTypes\.currentBadge/
  );
});

test("periodic page-type refresh stays quiet unless candidates change", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const refreshBody = source.match(
    /function schedulePropertyPageTypesRefresh\(options = \{\}\) \{([\s\S]*?)\n\}\n\nfunction formatPageTypeCandidateLabel/
  )[1];

  assert.match(refreshBody, /force: true,[\s\S]*?notifyOnChange: false/);
  assert.doesNotMatch(refreshBody, /showToast\(PopupText\.pageTypes\.refreshFailed\)/);
  assert.match(refreshBody, /if \(!result \|\| !result\.changed\) \{[\s\S]*?return;/);
  assert.match(refreshBody, /propertyPageTypesChangeNoticeVisible = true/);
  assert.match(refreshBody, /propertyPageTypesInvalidAlertPending = true/);
  assert.match(refreshBody, /propertyPageTypesChangeForceTodoOpen = true/);
  assert.match(
    refreshBody,
    /refreshUi\(\{[\s\S]*?useBusyOverlay: false,[\s\S]*?skipPropertyLockFetch: true,[\s\S]*?propertyPageTypesRefreshChanged: true/
  );
});

test("changed page-type refresh alerts before rendering the warning notice", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const refreshBody = source.match(
    /async function refreshUiInner\(options = \{\}\) \{([\s\S]*?)\n\}\n\nasync function maybeResumePersistedAiRun/
  )[1];

  assert.match(
    refreshBody,
    /if \(state\.propertyPageTypesInvalidAlertPending\) \{[\s\S]*?state\.propertyPageTypesInvalidAlertPending = false;[\s\S]*?if \(pageTypeUiBlocked\) \{[\s\S]*?window\.alert\(PopupText\.pageTypes\.currentPageInvalidAfterRefreshAlert\);[\s\S]*?\}/
  );
  assert.match(
    refreshBody,
    /nextViewState\.pageTypeNoticeText = state\.propertyPageTypesChangeNoticeVisible[\s\S]*?PopupText\.pageTypes\.changedNotice[\s\S]*?: pageTypeCandidateNoticeText;/
  );
  assert.ok(
    refreshBody.indexOf("window.alert(PopupText.pageTypes.currentPageInvalidAfterRefreshAlert)") <
      refreshBody.indexOf("uiModule.setViewState(nextViewState)")
  );
});

test("changed page-type refresh expands the Todo List root", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /propertyPageTypesRefreshChanged &&[\s\S]*?state\.propertyPageTypesChangeForceTodoOpen &&[\s\S]*?nextViewState\.todoListVisible[\s\S]*?nextViewState\.todoSectionExpanded = true;[\s\S]*?state\.propertyPageTypesChangeForceTodoOpen = false;/
  );
});

test("page-type refresh change copy is documented in shared text", () => {
  const textSource = readFileSync(new URL("../common/text.js", import.meta.url), "utf8");

  assert.match(textSource, /changedNotice: "Live Page candidates changed in Lynx\./);
  assert.match(textSource, /currentPageInvalidAfterRefreshAlert: "Live Page candidates changed in Lynx,[\s\S]*?Marking has been stopped/);
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

test("marking enable does not send a redundant force refresh after setEnabled", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
  const enableBody = source.match(
    /async function handleEnableToggle\(event\) \{([\s\S]*?)\n\}\n\nasync function handleDeviceEmulationEnabledToggle/
  )[1];

  assert.match(enableBody, /type: "setEnabled"[\s\S]*enabled: true/);
  assert.doesNotMatch(enableBody, /type: "forceRefresh"/);
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
