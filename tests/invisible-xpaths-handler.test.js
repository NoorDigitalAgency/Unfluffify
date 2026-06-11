import test from "node:test";
import assert from "node:assert/strict";

import { createInvisibleXpathsHandler } from "../content/invisible-xpaths-handler.js";

test("invisible xpaths handler returns only non-visible elements", () => {
  const visibleElement = { id: "visible" };
  const hiddenElement = { id: "hidden" };
  const handler = createInvisibleXpathsHandler({
    getElementFromXPath: (xpath) => {
      if (xpath === "//a") {
        return visibleElement;
      }
      if (xpath === "//b") {
        return hiddenElement;
      }
      return null;
    },
    isVisible: (element) => element === visibleElement
  });

  const response = handler.handleMessage({ xpaths: ["//a", "//b", "//c"] });

  assert.deepEqual(response, { xpaths: ["//b"] });
});

test("invisible xpaths handler tolerates missing xpath arrays", () => {
  const handler = createInvisibleXpathsHandler({
    getElementFromXPath: () => null,
    isVisible: () => false
  });

  assert.deepEqual(handler.handleMessage({}), { xpaths: [] });
  assert.deepEqual(handler.handleMessage(), { xpaths: [] });
});
