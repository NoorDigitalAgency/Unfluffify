import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createAiPreviewShowHandler } from "../content/ai-preview-show-handler.js";

function createDeps(overrides = {}) {
  const calls = [];
  const defaultItems = [{ xpath: "/html/body/main", text: "Main" }];
  const expandedItems = [{ xpath: "/html/body/main", text: "Main", kind: "implicit_included" }];
  const deps = {
    calls,
    buildAiPreviewItemsWithCategories: (selectorSet, items) => {
      calls.push(["buildAiPreviewItemsWithCategories", selectorSet, items]);
      return expandedItems;
    },
    collectPreviewItems: (selectorSet) => {
      calls.push(["collectPreviewItems", selectorSet]);
      return defaultItems;
    },
    enterAiPreviewMode: async (options) => calls.push(["enterAiPreviewMode", options]),
    exitAiPreviewMode: () => {
      calls.push(["exitAiPreviewMode"]);
      return Promise.resolve();
    },
    normalizeAiSelectorSet: (selectorSet) => {
      calls.push(["normalizeAiSelectorSet", selectorSet]);
      return { content: ["main"] };
    },
    setAiPreviewItemSets: (defaultPreviewItems, expandedPreviewItems, options) => {
      calls.push(["setAiPreviewItemSets", defaultPreviewItems, expandedPreviewItems, options]);
    },
    showAiPopover: (items, options) => calls.push(["showAiPopover", items, options]),
    ...overrides
  };
  return deps;
}

test("show AI preview builds item sets, enters preview mode, and shows the popover", async () => {
  const deps = createDeps();
  const handler = createAiPreviewShowHandler(deps);

  const response = await handler.handleMessage({ selectorSet: { content: ["article"] } });

  assert.deepEqual(response, { ok: true, count: 1 });
  assert.deepEqual(deps.calls.map((call) => call[0]), [
    "normalizeAiSelectorSet",
    "collectPreviewItems",
    "buildAiPreviewItemsWithCategories",
    "enterAiPreviewMode",
    "setAiPreviewItemSets",
    "showAiPopover"
  ]);
  assert.deepEqual(deps.calls[3], ["enterAiPreviewMode", { mode: "preview" }]);
  assert.deepEqual(deps.calls[4][3], { showAllCategories: false });
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

  assert.deepEqual(response, { ok: true, count: 0 });
  assert.deepEqual(
    deps.calls.filter((call) => ["setAiPreviewItemSets", "showAiPopover"].includes(call[0])),
    [
      ["setAiPreviewItemSets", [], [], { showAllCategories: false }],
      ["showAiPopover", [], deps.calls.find((call) => call[0] === "showAiPopover")[2]]
    ]
  );
});

test("show AI preview propagates preview-entry failures to the runtime catch", async () => {
  const deps = createDeps({
    enterAiPreviewMode: async () => {
      throw new Error("enter failed");
    }
  });
  const handler = createAiPreviewShowHandler(deps);

  await assert.rejects(
    () => handler.handleMessage({ selectorSet: { content: ["article"] } }),
    /enter failed/
  );
});
