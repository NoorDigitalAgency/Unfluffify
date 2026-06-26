import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import { createAiPreviewStateResponseBuilder } from "../src/content/ai-preview-state-response.js";
import { createAiPreviewShowHandler } from "../src/content/ai-preview-show-handler.js";

const contentMainSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const popupUiSource = readFileSync(new URL("../src/popup/ui.ts", import.meta.url), "utf8");

function createPreviewState(overrides = {}) {
  return {
    active: true,
    mode: "compute_lock",
    previousEnabled: true,
    restoreMarkingOnExit: true,
    previousBaseUrl: "https://example.test/article",
    showAllCategories: true,
    itemsPending: false,
    focusedXpath: "/html/body/main",
    items: [
      {
        xpath: "/html/body/main",
        text: "Main",
        title: "Article > Main",
        kind: "implicit_included"
      }
    ],
    ...overrides
  };
}

function createShowHandlerDeps() {
  const calls = [];
  const scheduled = [];
  const defaultItems = [
    {
      xpath: "/html/body/main",
      text: "Main",
      title: "Article > Main"
    }
  ];
  const expandedItems = [
    {
      xpath: "/html/body/main",
      text: "Main",
      title: "Article > Main",
      kind: "implicit_included"
    }
  ];
  const deps = {
    calls,
    scheduled,
    defaultItems,
    expandedItems,
    buildAiPreviewItemsWithCategories: (selectorSet, items) => {
      calls.push(["buildAiPreviewItemsWithCategories", selectorSet, items]);
      return expandedItems;
    },
    buildPreviewState: () => {
      calls.push(["buildPreviewState"]);
      return {
        active: true,
        mode: "preview",
        previousEnabled: true,
        restoreMarkingOnExit: true,
        previousBaseUrl: "https://example.test/article",
        items: [],
        itemsPending: true,
        focusedXpath: "",
        showAllCategories: false
      };
    },
    collectPreviewItems: (selectorSet) => {
      calls.push(["collectPreviewItems", selectorSet]);
      return defaultItems;
    },
    beginAiPreviewMode: (options) => calls.push(["beginAiPreviewMode", options]),
    exitAiPreviewMode: () => Promise.resolve(),
    isAiPreviewActive: () => true,
    normalizeAiSelectorSet: (selectorSet) => {
      calls.push(["normalizeAiSelectorSet", selectorSet]);
      return selectorSet;
    },
    notifyPreviewStateChanged: () => calls.push(["notifyPreviewStateChanged"]),
    refreshSilentHighlightings: () => {
      calls.push(["refreshSilentHighlightings"]);
      return Promise.resolve();
    },
    schedulePreviewItemsHydration: (callback) => {
      calls.push(["schedulePreviewItemsHydration"]);
      scheduled.push(callback);
    },
    setAiPreviewItemSets: (defaultPreviewItems, expandedPreviewItems, options) =>
      calls.push(["setAiPreviewItemSets", defaultPreviewItems, expandedPreviewItems, options]),
    setPreviewItemsPending: (pending) => calls.push(["setPreviewItemsPending", pending]),
    showAiPopover: (items, options) => calls.push(["showAiPopover", items, options])
  };
  return deps;
}

test("preview response builder preserves preview item metadata while gating expanded mode", () => {
  const builder = createAiPreviewStateResponseBuilder({
    FEATURE_DISABLED_REASON: "feature_disabled",
    getAiPreviewState: () => createPreviewState(),
    isPreviewExpandedStatesEnabled: () => false
  });

  const response = builder.buildGetStateResponse();

  assert.deepEqual(response, {
    ok: true,
    active: true,
    mode: "compute_lock",
    previousEnabled: true,
    restoreMarkingOnExit: true,
    previousBaseUrl: "https://example.test/article",
    showAllCategories: false,
    items: [
      {
        xpath: "/html/body/main",
        text: "Main",
        title: "Article > Main",
        kind: "implicit_included"
      }
    ],
    itemsPending: false,
    focusedXpath: "/html/body/main"
  });
});

test("preview response builder returns the disabled expanded-mode payload with the same item metadata", () => {
  const builder = createAiPreviewStateResponseBuilder({
    FEATURE_DISABLED_REASON: "feature_disabled",
    getAiPreviewState: () => createPreviewState(),
    isPreviewExpandedStatesEnabled: () => true
  });

  const response = builder.buildExpandedModeDisabledResponse();

  assert.deepEqual(response, {
    ok: false,
    reason: "feature_disabled",
    feature: "previewExpandedStates",
    active: true,
    mode: "compute_lock",
    previousEnabled: true,
    restoreMarkingOnExit: true,
    previousBaseUrl: "https://example.test/article",
    showAllCategories: false,
    items: [
      {
        xpath: "/html/body/main",
        text: "Main",
        title: "Article > Main",
        kind: "implicit_included"
      }
    ],
    itemsPending: false,
    focusedXpath: "/html/body/main"
  });
});

test("show handler hydrates default and categorized preview rows asynchronously", async () => {
  const deps = createShowHandlerDeps();
  const handler = createAiPreviewShowHandler(deps);

  const response = await handler.handleMessage({
    selectorSet: { content: ["main"] }
  });

  assert.deepEqual(response, {
    ok: true,
    active: true,
    mode: "preview",
    previousEnabled: true,
    restoreMarkingOnExit: true,
    previousBaseUrl: "https://example.test/article",
    items: [],
    itemsPending: true,
    focusedXpath: "",
    showAllCategories: false,
    count: 0
  });
  assert.deepEqual(deps.calls.slice(0, 7).map((call) => call[0]), [
    "normalizeAiSelectorSet",
    "beginAiPreviewMode",
    "setPreviewItemsPending",
    "setAiPreviewItemSets",
    "showAiPopover",
    "schedulePreviewItemsHydration",
    "buildPreviewState"
  ]);

  deps.scheduled[0]();

  assert.deepEqual(
    deps.calls.filter((call) => call[0] === "setAiPreviewItemSets"),
    [
      ["setAiPreviewItemSets", [], [], { showAllCategories: false }],
      ["setAiPreviewItemSets", deps.defaultItems, deps.expandedItems, { showAllCategories: false }]
    ]
  );
  assert.deepEqual(
    deps.calls.slice(-3).map((call) => call[0]),
    ["setPreviewItemsPending", "notifyPreviewStateChanged", "refreshSilentHighlightings"]
  );
});

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

test("preview sidebar buttons keep tooltip/title fallback and focus-click wiring", () => {
  assert.match(
    popupUiSource,
    /class: "preview-sidebar__item-button",[\s\S]*?title: item\.title \|\| item\.xpath,[\s\S]*?onClick: \(\) => handlers\.onPreviewItemFocus\(item\.xpath\)/
  );
  assert.match(
    contentMainSource,
    /function setAiPreviewClickableTitle\(node(?:\s*:\s*[^,]+)?, title(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?previewTitle: title[\s\S]*?node\.setAttribute\("title", title\);[\s\S]*?\}/
  );
  assert.match(
    contentMainSource,
    /function handleAiPreviewClick\(event(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?copyTextToClipboard\(target\.element\.getAttribute\("title"\) \|\| target\.xpath\)\.then\(\);[\s\S]*?core\.focusPreviewElement\(target\.element, \{ center: false \}\);[\s\S]*?setAiPreviewFocusedXpath\(target\.xpath\);/
  );
  assert.match(
    contentMainSource,
    /function clearAiPreviewClickableTargets\(\) \{[\s\S]*?originalTitleState\.hadTitle[\s\S]*?node\.setAttribute\("title", originalTitleState\.title \|\| ""\);[\s\S]*?node\.getAttribute\("title"\) === originalTitleState\.previewTitle[\s\S]*?node\.removeAttribute\("title"\);/
  );
});

test("preview expanded-mode checkbox stays feature-gated and round-trips through the popup request handler", () => {
  assert.match(
    popupUiSource,
    /isPopupFeatureEnabled\(view, "previewExpandedStates"\)[\s\S]*?type: "checkbox",[\s\S]*?checked: view\.previewShowAllCategories,[\s\S]*?onChange: handlers\.onPreviewShowAllCategoriesChange[\s\S]*?: null/
  );
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
