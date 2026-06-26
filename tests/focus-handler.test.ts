import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createFocusHandler } from "../src/content/focus-handler.js";

function createDeps(overrides = {}) {
  const calls = {
    focusedElements: [],
    focusedXpaths: [],
    clearFocusHighlight: 0
  };

  const deps = {
    clearFocusHighlight: () => {
      calls.clearFocusHighlight += 1;
    },
    focusPreviewElement: (element) => {
      calls.focusedElements.push(element);
    },
    getElementFromXPath: () => null,
    isAiPreviewActive: () => false,
    setAiPreviewFocusedXpath: (xpath) => {
      calls.focusedXpaths.push(xpath);
    },
    ...overrides
  };

  return {
    calls,
    deps
  };
}

test("focus handler returns failure when xpath target cannot be resolved", () => {
  const { calls, deps } = createDeps();
  const handler = createFocusHandler(deps);

  const response = handler.handleFocusMessage({ xpath: "//missing" });

  assert.deepEqual(response, { ok: false });
  assert.deepEqual(calls.focusedElements, []);
  assert.deepEqual(calls.focusedXpaths, []);
});

test("focus handler focuses element and syncs preview xpath when preview is active", () => {
  const target = { id: "node" };
  const { calls, deps } = createDeps({
    getElementFromXPath: (xpath) => (xpath === "//a" ? target : null),
    isAiPreviewActive: () => true
  });
  const handler = createFocusHandler(deps);

  const response = handler.handleFocusMessage({ xpath: "//a" });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(calls.focusedElements, [target]);
  assert.deepEqual(calls.focusedXpaths, ["//a"]);
});

test("clear-focus handler clears focus and resets preview xpath when preview is active", () => {
  const { calls, deps } = createDeps({
    isAiPreviewActive: () => true
  });
  const handler = createFocusHandler(deps);

  const response = handler.handleClearFocusMessage();

  assert.deepEqual(response, { ok: true });
  assert.equal(calls.clearFocusHighlight, 1);
  assert.deepEqual(calls.focusedXpaths, [""]);
});
