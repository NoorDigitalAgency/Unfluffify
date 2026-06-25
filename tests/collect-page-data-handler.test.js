import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createCollectPageDataHandler } from "../src/content/collect-page-data-handler.js";

test("collect-page-data handler builds payload from config entry and snapshot", async () => {
  const handler = createCollectPageDataHandler({
    createCurrentPageSnapshot: () => ({ renderedHtml: "<html></html>", renderMode: "dom" }),
    getBaseUrl: () => "https://base.example",
    getImmutableSelectors: () => [".immutable"],
    getPageMarkingEntry: () => ({ rawHtml: "<raw></raw>", xpaths: ["//main"] }),
    getPageUrl: () => "https://page.example",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async (baseUrl) => ({ baseUrl })
  });

  const response = await handler.handleMessage({});

  assert.deepEqual(response, {
    baseUrl: "https://base.example",
    pageUrl: "https://page.example",
    renderedHtml: "<html></html>",
    rawHtml: "<raw></raw>",
    renderMode: "dom",
    immutableSelectors: [".immutable"],
    xpaths: ["//main"]
  });
});

test("collect-page-data handler normalizes missing entry fields", async () => {
  const handler = createCollectPageDataHandler({
    createCurrentPageSnapshot: () => ({ renderedHtml: "<html></html>", renderMode: "dom" }),
    getBaseUrl: () => "https://base.example",
    getImmutableSelectors: () => [".immutable"],
    getPageMarkingEntry: () => ({ rawHtml: null, xpaths: null }),
    getPageUrl: () => "https://page.example",
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    loadConfig: async () => ({})
  });

  const response = await handler.handleMessage({ baseUrl: "https://override.example" });

  assert.equal(response.baseUrl, "https://override.example");
  assert.equal(response.rawHtml, "");
  assert.deepEqual(response.xpaths, []);
});
