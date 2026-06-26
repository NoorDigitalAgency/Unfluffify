import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const contentMainSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

test("compute-lock preview keeps restore-marking intent and preserves enabled tab state for exit restore", () => {
  assert.match(contentMainSource, /restoreMarkingOnExit: false,/);
  assert.match(
    contentMainSource,
    /const restoreMarkingOnExit = nextMode === "compute_lock";/
  );
  assert.match(
    contentMainSource,
    /if \(restoreMarkingOnExit\) \{[\s\S]*?aiPreviewState\.restoreMarkingOnExit = true;[\s\S]*?\}/
  );
  assert.match(
    contentMainSource,
    /if \(aiPreviewState\.restoreMarkingOnExit\) \{[\s\S]*?type: "setTabState",[\s\S]*?enabled: true,[\s\S]*?baseUrl: lockedBaseUrl/
  );
});

test("preview expanded-mode change still short-circuits while disabled and round-trips popup state on success", () => {
  assert.match(
    popupSource,
    /async function handlePreviewShowAllCategoriesChange\(event(?:\s*:\s*[^)]*)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?if \(!isFeatureEnabled\("previewExpandedStates"\)\) \{[\s\S]*?previewShowAllCategories: false[\s\S]*?return;/
  );
  assert.match(
    popupSource,
    /async function handlePreviewShowAllCategoriesChange\(event(?:\s*:\s*[^)]*)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?messages\.requestTabSetAiPreviewExpandedMode\(tabId, \{[\s\S]*?active: nextChecked[\s\S]*?uiModule\.setViewState\(buildPreviewViewState\(response\.result\.previewState \|\| null\)\);/
  );
});

test("content preview remaps hydrated rows to renderable targets before storing preview item sets", () => {
  assert.match(
    contentMainSource,
    /function mapAiPreviewItemsToRenderableTargets\(items(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?collectSilentHighlightRenderTargets\(sourceNode,[\s\S]*?hasRenderableClientBox\(sourceNode\)[\s\S]*?core\.getXPath\(target\)[\s\S]*?seenXpaths\.add\(xpath\);[\s\S]*?\}/
  );
  assert.match(
    contentMainSource,
    /function setAiPreviewItemSets\([\s\S]*?defaultItems(?:\s*:\s*[^,]+)?[\s\S]*?expandedItems(?:\s*:\s*[^,]+)?[\s\S]*?options(?:\s*:\s*[^=]+)? = \{\}[\s\S]*?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?aiPreviewState\.defaultItems = mapAiPreviewItemsToRenderableTargets\(defaultItems\);[\s\S]*?aiPreviewState\.expandedItems = mapAiPreviewItemsToRenderableTargets\(expandedItems\);/
  );
});

test("preview hydration keeps using the captured marking config even after marking is disabled", () => {
  assert.match(
    contentMainSource,
    /previousConfig: state\.config,[\s\S]*?previousDraftEntry: core\.clonePageEntry\(core\.getDraftPageEntry\(previousPageUrl\)\)/
  );
  assert.match(
    contentMainSource,
    /function collectUndetectedAiPreviewNodes\(trackedNodes(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const markabilityConfig = aiPreviewState\.previousConfig \|\| state\.config;[\s\S]*?core\.isMarkableElement\(node, markabilityConfig, \{/
  );
});

test("preview exit re-resolves the base URL when the captured restore scope is empty or stale", () => {
  assert.match(
    contentMainSource,
    /const shouldRestoreMarking = Boolean\([\s\S]*?restoreState\.previousEnabled \|\| restoreState\.restoreMarkingOnExit[\s\S]*?\);/
  );
  assert.match(
    contentMainSource,
    /let restoredBaseUrl = restoreState\.previousBaseUrl \|\| state\.baseUrl \|\| "";/
  );
  assert.match(
    contentMainSource,
    /if \([\s\S]*?shouldRestoreMarking[\s\S]*?!restoredBaseUrl \|\| !utils\.isPageWithinBaseUrl\(location\.href, restoredBaseUrl\)[\s\S]*?\) \{[\s\S]*?restoredBaseUrl = await resolveBaseUrlForCurrentPage\(\);/
  );
  assert.match(
    contentMainSource,
    /if \(shouldRestoreMarking && restoredBaseUrl\) \{[\s\S]*?await core\.enableForBaseUrl\(restoredBaseUrl, \{/
  );
});
