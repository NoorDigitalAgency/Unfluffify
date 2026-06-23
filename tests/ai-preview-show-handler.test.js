import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiPreviewShowHandler } from "../content/ai-preview-show-handler.js";

function createDeps(overrides = {}) {
  const calls = [];
  const scheduled = [];
  const defaultItems = [{ xpath: "/html/body/main", text: "Main" }];
  const expandedItems = [{ xpath: "/html/body/main", text: "Main", kind: "implicit_included" }];
  let previewItems = [];
  let previewItemsPending = false;
  const deps = {
    calls,
    scheduled,
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
        items: previewItems,
        itemsPending: previewItemsPending,
        focusedXpath: "",
        showAllCategories: false
      };
    },
    collectPreviewItems: (selectorSet) => {
      calls.push(["collectPreviewItems", selectorSet]);
      return defaultItems;
    },
    beginAiPreviewMode: (options) => calls.push(["beginAiPreviewMode", options]),
    exitAiPreviewMode: () => {
      calls.push(["exitAiPreviewMode"]);
      return Promise.resolve();
    },
    isAiPreviewActive: () => true,
    normalizeAiSelectorSet: (selectorSet) => {
      calls.push(["normalizeAiSelectorSet", selectorSet]);
      return { content: ["main"] };
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
    setAiPreviewItemSets: (defaultPreviewItems, expandedPreviewItems, options) => {
      calls.push(["setAiPreviewItemSets", defaultPreviewItems, expandedPreviewItems, options]);
      previewItems = defaultPreviewItems;
    },
    setPreviewItemsPending: (pending) => {
      calls.push(["setPreviewItemsPending", pending]);
      previewItemsPending = Boolean(pending);
    },
    showAiPopover: (items, options) => calls.push(["showAiPopover", items, options]),
    ...overrides
  };
  return deps;
}

test("show AI preview opens immediately and hydrates items asynchronously", async () => {
  const deps = createDeps();
  const handler = createAiPreviewShowHandler(deps);

  const response = await handler.handleMessage({ selectorSet: { content: ["article"] } });

  assert.deepEqual(response, {
    ok: true,
    active: true,
    mode: "preview",
    previousEnabled: true,
    restoreMarkingOnExit: true,
    items: [],
    itemsPending: true,
    focusedXpath: "",
    showAllCategories: false,
    count: 0
  });
  assert.deepEqual(deps.calls.map((call) => call[0]), [
    "normalizeAiSelectorSet",
    "beginAiPreviewMode",
    "setPreviewItemsPending",
    "setAiPreviewItemSets",
    "showAiPopover",
    "schedulePreviewItemsHydration",
    "buildPreviewState"
  ]);
  assert.deepEqual(deps.calls[1], ["beginAiPreviewMode", { mode: "preview" }]);
  assert.deepEqual(deps.calls[2], ["setPreviewItemsPending", true]);
  assert.deepEqual(deps.calls[3], ["setAiPreviewItemSets", [], [], { showAllCategories: false }]);

  deps.scheduled[0]();

  assert.deepEqual(deps.calls.slice(7).map((call) => call[0]), [
    "collectPreviewItems",
    "buildAiPreviewItemsWithCategories",
    "setAiPreviewItemSets",
    "setPreviewItemsPending",
    "notifyPreviewStateChanged",
    "refreshSilentHighlightings"
  ]);
  assert.deepEqual(deps.calls.at(-3), ["setPreviewItemsPending", false]);
});

test("show AI preview closes by exiting AI preview mode", async () => {
  const deps = createDeps();
  const handler = createAiPreviewShowHandler(deps);

  await handler.handleMessage({ selectorSet: { content: ["article"] } });
  const popoverOptions = deps.calls.find((call) => call[0] === "showAiPopover")[2];
  await popoverOptions.onClose();

  assert.deepEqual(deps.calls.at(-1), ["exitAiPreviewMode"]);
});

test("show AI preview degrades collection failures to an empty preview", async () => {
  const deps = createDeps({
    collectPreviewItems: () => {
      deps.calls.push(["collectPreviewItems"]);
      throw new Error("collection failed");
    }
  });
  const handler = createAiPreviewShowHandler(deps);

  const response = await handler.handleMessage({ selectorSet: { content: ["article"] } });
  deps.scheduled[0]();

  assert.deepEqual(
    response,
    {
      ok: true,
      active: true,
      mode: "preview",
      previousEnabled: true,
      restoreMarkingOnExit: true,
      items: [],
      itemsPending: true,
      focusedXpath: "",
      showAllCategories: false,
      count: 0
    }
  );
  assert.deepEqual(
    deps.calls.filter((call) => ["setAiPreviewItemSets", "showAiPopover"].includes(call[0])),
    [
      ["setAiPreviewItemSets", [], [], { showAllCategories: false }],
      ["showAiPopover", [], deps.calls.find((call) => call[0] === "showAiPopover")[2]],
      ["setAiPreviewItemSets", [], [], { showAllCategories: false }]
    ]
  );
  assert.deepEqual(deps.calls.at(-3), ["setPreviewItemsPending", false]);
});

test("show AI preview propagates preview-entry failures to the runtime catch", async () => {
  const deps = createDeps({
    beginAiPreviewMode: () => {
      throw new Error("enter failed");
    }
  });
  const handler = createAiPreviewShowHandler(deps);

  await assert.rejects(
    () => handler.handleMessage({ selectorSet: { content: ["article"] } }),
    /enter failed/
  );
});
