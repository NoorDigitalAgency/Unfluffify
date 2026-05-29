import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findPageMarkingEntry, state } from "../content/core.js";

test("content-main stores page-scoped selector suppression when explicit marks are removed", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /function addSelectorSuppressedXpath\(entry, xpath\)/);
  assert.match(source, /if \(excluded\) \{[\s\S]*?clearSelectorSuppressedXpathsWithin\(entry, xpath\);[\s\S]*?\} else \{[\s\S]*?addSelectorSuppressedXpath\(entry, xpath\);/);
  assert.match(source, /if \(included\) \{[\s\S]*?clearSelectorSuppressedXpathsWithin\(entry, xpath\);[\s\S]*?\} else \{[\s\S]*?addSelectorSuppressedXpath\(entry, xpath\);/);
});

test("core render path and silent highlighting both honor selector suppression xpaths", () => {
  const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(contentSource, /function getEffectiveAiSelectorSet\(baseConfig\) \{[\s\S]*?suppressedXpaths/);
  assert.match(contentSource, /collectNodesFromSelectors\(normalized\.exclusionSelectors, \{[\s\S]*?suppressedXpaths/);
  assert.match(coreSource, /collectIncludedElementsFromSelectorSet\(selectorSet, options = \{\}\) \{[\s\S]*?suppressedXpaths/);
  assert.match(coreSource, /collectIncludedElementsFromSelectorSet\(normalizedAiSelectorSet, \{[\s\S]*?suppressedXpaths: selectorSuppressedXpaths/);
});

test("marking mode suppresses default marks inside selector-excluded AI regions", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(coreSource, /for \(const el of aiCollections\.excluded \|\| \[\]\) \{/);
  assert.match(
    coreSource,
    /if \(explicitInclude\.has\(el\) \|\| isWithinElementSet\(el, explicitInclude\)\) \{\s*continue;\s*\}/
  );
  assert.match(
    coreSource,
    /const precedenceSet = new Set\(\[[\s\S]*?\.\.\.selectorExcludedSet[\s\S]*?\]\);/
  );
  assert.match(
    coreSource,
    /excludedAncestorSet: new Set\(\[[\s\S]*?\.\.\.selectorExcludedSet[\s\S]*?\]\)/
  );
});

test("marking logic docs describe AI selector exclusions as default-suppression only", () => {
  const docSource = readFileSync(
    new URL("../MARKING_AND_HIGHLIGHTING_LOGIC.md", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(docSource, /^- AI excluded content elements$/m);
  assert.match(
    docSource,
    /AI excluded content is still collected to suppress default marking inside selector-excluded regions, but it is not rendered as a dedicated overlay layer\./
  );
});

test("page-scoped selector suppression lookup normalizes equivalent page URLs", () => {
  const originalBaseUrl = state.baseUrl;
  state.baseUrl = "https://example.test/";
  try {
    const entry = {
      xpaths: [],
      selectorSuppressedXpaths: ["/HTML/BODY/DIV[1]"]
    };
    const config = {
      pageMarkings: {
        "https://example.test/path/": entry
      }
    };

    assert.equal(findPageMarkingEntry(config, "https://example.test/path"), entry);
  } finally {
    state.baseUrl = originalBaseUrl;
  }
});