import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  collectCachedSelectorMatches,
  invalidateSharedSelectorCache
} from "../content/shared-selector-cache.js";

test("shared selector cache documents filtered-result cache key requirements", () => {
  const source = readFileSync(new URL("../content/shared-selector-cache.js", import.meta.url), "utf8");
  const commentStart = source.indexOf("* Collects selector matches through the shared cache.");
  const functionStart = source.indexOf("export function collectCachedSelectorMatches", commentStart);
  const contract = source.slice(commentStart, functionStart);

  assert.ok(commentStart > -1);
  assert.ok(functionStart > commentStart);
  assert.match(contract, /shouldIncludeNode/);
  assert.match(contract, /suppressionFingerprint/);
  assert.match(contract, /generation bump/);
});

test("shared selector cache reuses selector matches until invalidated", () => {
  invalidateSharedSelectorCache({ reset: true });

  const article = { nodeType: 1, tagName: "ARTICLE" };
  const main = { nodeType: 1, tagName: "MAIN" };
  const calls = [];
  const root = {
    querySelectorAll(selector) {
      calls.push(selector);
      if (selector === "article") {
        return [article];
      }
      if (selector === "main") {
        return [main, article];
      }
      return [];
    }
  };

  const firstResult = collectCachedSelectorMatches({
    root,
    selectors: ["article", "main"],
    pageUrl: "https://example.com/article",
    scope: "test",
    includeSelectorByNode: true
  });

  assert.deepEqual(calls, ["article", "main"]);
  assert.equal(firstResult.nodes.size, 2);
  assert.equal(firstResult.selectorByNode.get(article), "article");
  assert.equal(firstResult.selectorByNode.get(main), "main");

  calls.length = 0;
  const secondResult = collectCachedSelectorMatches({
    root,
    selectors: ["article", "main"],
    pageUrl: "https://example.com/article",
    scope: "test",
    includeSelectorByNode: true
  });

  assert.deepEqual(calls, []);
  assert.equal(secondResult.nodes.size, 2);
  assert.equal(secondResult.selectorByNode.get(article), "article");
  assert.equal(secondResult.selectorByNode.get(main), "main");

  invalidateSharedSelectorCache({ domStructure: true });

  const thirdResult = collectCachedSelectorMatches({
    root,
    selectors: ["article", "main"],
    pageUrl: "https://example.com/article",
    scope: "test",
    includeSelectorByNode: true
  });

  assert.deepEqual(calls, ["article", "main"]);
  assert.equal(thirdResult.nodes.size, 2);
});

test("shared selector cache retains selector owners for later callers", () => {
  invalidateSharedSelectorCache({ reset: true });

  const article = { nodeType: 1, tagName: "ARTICLE" };
  const calls = [];
  const root = {
    querySelectorAll(selector) {
      calls.push(selector);
      return selector === "article" ? [article] : [];
    }
  };

  const firstResult = collectCachedSelectorMatches({
    root,
    selectors: ["article"],
    pageUrl: "https://example.com/article",
    scope: "test"
  });

  assert.deepEqual(calls, ["article"]);
  assert.equal(firstResult.nodes.has(article), true);
  assert.equal(firstResult.selectorByNode.size, 0);

  calls.length = 0;
  const secondResult = collectCachedSelectorMatches({
    root,
    selectors: ["article"],
    pageUrl: "https://example.com/article",
    scope: "test",
    includeSelectorByNode: true
  });

  assert.deepEqual(calls, []);
  assert.equal(secondResult.selectorByNode.get(article), "article");
});
