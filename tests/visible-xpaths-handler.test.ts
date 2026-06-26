import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createVisibleXpathsHandler } from "../src/content/visible-xpaths-handler.js";

test("visible xpaths handler returns only visible elements", () => {
  const visibleElement = { id: "visible" };
  const hiddenElement = { id: "hidden" };
  const handler = createVisibleXpathsHandler({
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

  assert.deepEqual(response, { xpaths: ["//a"] });
});

test("visible xpaths handler tolerates missing xpath arrays", () => {
  const handler = createVisibleXpathsHandler({
    getElementFromXPath: () => null,
    isVisible: () => false
  });

  assert.deepEqual(handler.handleMessage({}), { xpaths: [] });
  assert.deepEqual(handler.handleMessage(), { xpaths: [] });
});
