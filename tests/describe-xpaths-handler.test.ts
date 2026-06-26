import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createDescribeXpathsHandler } from "../src/content/describe-xpaths-handler.js";

test("describe xpaths handler returns labels for visible elements only", () => {
  const visible = { id: "visible" };
  const hidden = { id: "hidden" };
  const handler = createDescribeXpathsHandler({
    getElementFromXPath: (xpath) => {
      if (xpath === "//a") {
        return visible;
      }
      if (xpath === "//b") {
        return hidden;
      }
      return null;
    },
    isVisible: (element) => element === visible,
    getElementLabel: (element) => (element === visible ? "Visible Label" : "Hidden Label")
  });

  const response = handler.handleMessage({ xpaths: ["//a", "//b", "//c"] });

  assert.deepEqual(response, {
    items: [{ xpath: "//a", text: "Visible Label" }]
  });
});

test("describe xpaths handler tolerates missing xpath arrays", () => {
  const handler = createDescribeXpathsHandler({
    getElementFromXPath: () => null,
    isVisible: () => false,
    getElementLabel: () => ""
  });

  assert.deepEqual(handler.handleMessage({}), { items: [] });
  assert.deepEqual(handler.handleMessage(), { items: [] });
});
