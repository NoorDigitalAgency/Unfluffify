import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("preview sidebar buttons expose each detected content xpath as the button title", () => {
  const source = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

  assert.match(
    source,
    /class: "preview-sidebar__item-button",[\s\S]*?title: item\.title \|\| item\.xpath,[\s\S]*?onClick: \(\) => handlers\.onPreviewItemFocus\(item\.xpath\)/
  );
});

test("preview sidebar renders a checkbox that switches to the expanded content-state list", () => {
  const source = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

  assert.match(
    source,
    /type: "checkbox",[\s\S]*?checked: view\.previewShowAllCategories,[\s\S]*?onChange: handlers\.onPreviewShowAllCategoriesChange/
  );
  assert.match(
    source,
    /const kindClass = view\.previewShowAllCategories && item\.kind[\s\S]*?`preview-sidebar__item--\$\{item\.kind\}`/
  );
});

test("content-main applies the matching xpath as the preview target title", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /const aiPreviewOriginalTitles = new WeakMap\(\);/);
  assert.match(
    source,
    /function setAiPreviewClickableTitle\(node, title\) \{[\s\S]*?previewTitle: title[\s\S]*?node\.setAttribute\("title", title\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function syncAiPreviewClickableTargets\(items\) \{[\s\S]*?const title = item && typeof item\.title === "string" && item\.title[\s\S]*?setAiPreviewClickableTitle\(node, title\);[\s\S]*?aiPreviewClickableNodes\.add\(node\);[\s\S]*?\}/
  );
});

test("content-main tracks separate default and expanded preview item sets", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function createAiPreviewState\(\) \{[\s\S]*?defaultItems: \[],[\s\S]*?expandedItems: \[],[\s\S]*?showAllCategories: false,[\s\S]*?\}/
  );
  assert.match(
    source,
    /function setAiPreviewExpandedMode\(active\) \{[\s\S]*?aiPreviewState\.showAllCategories = Boolean\(active\);[\s\S]*?aiPreviewState\.showAllCategories[\s\S]*?aiPreviewState\.expandedItems[\s\S]*?aiPreviewState\.defaultItems/
  );
  assert.match(
    source,
    /if \(message\.type === "setAiPreviewExpandedMode"\) \{[\s\S]*?showAllCategories: aiPreviewState\.showAllCategories,[\s\S]*?title: item\.title,[\s\S]*?kind: item\.kind/
  );
});

test("popup.js sends preview list mode changes to the content script and normalizes the returned items", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function buildPreviewViewState\(previewState\) \{[\s\S]*?previewShowAllCategories:[\s\S]*?previewState\.showAllCategories/
  );
  assert.match(
    source,
    /async function handlePreviewShowAllCategoriesChange\(event\) \{[\s\S]*?type: "setAiPreviewExpandedMode",[\s\S]*?active: nextChecked[\s\S]*?uiModule\.setViewState\(buildPreviewViewState\(response\)\);/
  );
});

test("content-main restores original page titles after preview highlighting clears", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function clearAiPreviewClickableTargets\(\) \{[\s\S]*?originalTitleState\.hadTitle[\s\S]*?node\.setAttribute\("title", originalTitleState\.title \|\| ""\);[\s\S]*?node\.getAttribute\("title"\) === originalTitleState\.previewTitle[\s\S]*?node\.removeAttribute\("title"\);[\s\S]*?aiPreviewOriginalTitles\.delete\(node\);[\s\S]*?\}/
  );
});

test("content-main copies the preview target title while keeping preview focus behavior", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function handleAiPreviewClick\(event\) \{[\s\S]*?if \(target\) \{[\s\S]*?copyTextToClipboard\(target\.element\.getAttribute\("title"\) \|\| target\.xpath\)\.then\(\);[\s\S]*?core\.focusPreviewElement\(target\.element, \{ center: false \}\);[\s\S]*?setAiPreviewFocusedXpath\(target\.xpath\);[\s\S]*?return true;[\s\S]*?\}/
  );
});

test("content-main remaps preview rows to renderable targets before syncing preview item sets", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function mapAiPreviewItemsToRenderableTargets\(items\) \{[\s\S]*?collectSilentHighlightRenderTargets\(sourceNode,[\s\S]*?hasRenderableClientBox\(sourceNode\)[\s\S]*?core\.getXPath\(target\)[\s\S]*?seenXpaths\.add\(xpath\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function setAiPreviewItemSets\(defaultItems, expandedItems, options = \{\}\) \{[\s\S]*?aiPreviewState\.defaultItems = mapAiPreviewItemsToRenderableTargets\(defaultItems\);[\s\S]*?aiPreviewState\.expandedItems = mapAiPreviewItemsToRenderableTargets\(expandedItems\);/
  );
});

test("content preview close notification includes restored marking state", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(
    source,
    /chrome\.runtime\.sendMessage\(\{[\s\S]*?type: "aiPreviewClosed",[\s\S]*?markingEnabled: Boolean\(state\.enabled\)/
  );
});

test("content preview close waits for popover restore before responding", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const closeBlock = contentSource.match(
    /if \(message\.type === "closeAiPreview"\) \{([\s\S]*?)\n    if \(message\.type === "configUpdated"\)/
  )[1];

  assert.match(
    coreSource,
    /function closeAiPopover\(options = \{\}\) \{[\s\S]*?return afterClose\.finally\(\(\) => chrome\.runtime\.sendMessage\(/
  );
  assert.match(
    coreSource,
    /export function requestAiPopoverClose\(options = \{\}\) \{\s*return closeAiPopover\(options\);\s*\}/
  );
  assert.match(
    closeBlock,
    /core\.requestAiPopoverClose\(\)\.then\(\(\) => \{\s*sendResponse\(\{ ok: true, active: false \}\);/
  );
  assert.doesNotMatch(closeBlock, /core\.requestAiPopoverClose\(\);\s*sendResponse/);
});

test("content preview exit serializes duplicate close requests", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /let aiPreviewExitPromise = null;/);
  assert.match(
    source,
    /async function exitAiPreviewMode\(\) \{\s*if \(aiPreviewExitPromise\) \{\s*return aiPreviewExitPromise;\s*\}[\s\S]*?aiPreviewExitPromise = exitAiPreviewModeInner\(\)\.finally\(\(\) => \{\s*aiPreviewExitPromise = null;\s*\}\);\s*return aiPreviewExitPromise;\s*\}/
  );
  assert.match(source, /async function exitAiPreviewModeInner\(\) \{/);
});

test("content preview exit recovers marking base URL when preview state captured an empty base URL", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /const shouldRestoreMarking = Boolean\([\s\S]*?restoreState\.previousEnabled \|\| restoreState\.restoreMarkingOnExit[\s\S]*?\);/
  );
  assert.match(
    source,
    /let restoredBaseUrl = restoreState\.previousBaseUrl \|\| state\.baseUrl \|\| "";/
  );
  assert.match(
    source,
    /if \([\s\S]*?shouldRestoreMarking[\s\S]*?!restoredBaseUrl \|\| !utils\.isPageWithinBaseUrl\(location\.href, restoredBaseUrl\)[\s\S]*?\) \{[\s\S]*?restoredBaseUrl = await resolveBaseUrlForCurrentPage\(\);/
  );
  assert.match(
    source,
    /if \(shouldRestoreMarking && restoredBaseUrl\) \{[\s\S]*?await core\.enableForBaseUrl\(restoredBaseUrl, \{/
  );
});

test("compute-lock preview pins marking restore intent and preserves enabled tab state", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /restoreMarkingOnExit: false,/);
  assert.match(
    source,
    /const restoreMarkingOnExit = nextMode === "compute_lock";/
  );
  assert.match(
    source,
    /if \(restoreMarkingOnExit\) \{[\s\S]*?aiPreviewState\.restoreMarkingOnExit = true;[\s\S]*?\}/
  );
  assert.match(
    source,
    /if \(aiPreviewState\.restoreMarkingOnExit\) \{[\s\S]*?type: "setTabState",[\s\S]*?enabled: true,[\s\S]*?baseUrl: lockedBaseUrl/
  );
});

test("content-main keeps preview restore state when config updates during AI preview", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /if \(message\.type === "configUpdated"\) \{[\s\S]*?if \(aiPreviewState\.active\) \{[\s\S]*?core\.loadConfig\(message\.baseUrl\)\.then\(\(loadedConfig\) => \{[\s\S]*?state\.config = loadedConfig;[\s\S]*?sendResponse\(\{ ok: true \}\);[\s\S]*?return true;/
  );
});