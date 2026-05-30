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

test("content-main routes live-page GraphQL lookups through background runtime messages", () => {
  const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    contentSource,
    /async function resolveSiteIdFromGraphql\(options = \{\}\) \{[\s\S]*?utils\.sendRuntimeMessage\(\{[\s\S]*?type: "resolveLivePageSiteId"/
  );
  assert.doesNotMatch(
    contentSource,
    /async function resolveSiteIdFromGraphql\(options = \{\}\) \{[\s\S]*?fetch\(/
  );
  assert.match(
    contentSource,
    /async function fetchPropertyPageTypesForSiteId\(siteId, stageBaseValue, tokenValue\) \{[\s\S]*?utils\.sendRuntimeMessage\(\{[\s\S]*?type: "fetchLivePagePropertyPageTypes"/
  );
  assert.doesNotMatch(
    contentSource,
    /async function fetchPropertyPageTypesForSiteId\(siteId, stageBaseValue, tokenValue\) \{[\s\S]*?fetch\(/
  );
});

test("background owns the live-page GraphQL transport handlers", () => {
  const backgroundSource = readFileSync(new URL("../background.js", import.meta.url), "utf8");

  assert.match(backgroundSource, /async function resolveLivePageSiteId\(options = \{\}\) \{/);
  assert.match(backgroundSource, /async function fetchLivePagePropertyPageTypes\(options = \{\}\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "resolveLivePageSiteId"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "fetchLivePagePropertyPageTypes"\) \{/);
});

test("marking mode keeps selector-matched elements off the default layer without suppressing their whole subtree", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(coreSource, /for \(const el of aiCollections\.excluded \|\| \[\]\) \{/);
  assert.match(
    coreSource,
    /if \(explicitInclude\.has\(el\) \|\| isWithinElementSet\(el, explicitInclude\)\) \{\s*continue;\s*\}/
  );
  assert.match(
    coreSource,
    /export function collectDefaultLayerElements\(root, options = \{\}\) \{[\s\S]*?const selectorExcluded = new Set\(options\.selectorExcluded \|\| options\.selectorExcludedSet \|\| \[\]\);/
  );
  assert.match(
    coreSource,
    /const precedenceSet = new Set\(\[[\s\S]*?\.\.\.selectorExcluded[\s\S]*?\]\);/
  );
  assert.doesNotMatch(
    coreSource,
    /excludedAncestorSet: new Set\(\[[\s\S]*?\.\.\.selectorExcluded[\s\S]*?\]\)/
  );
});

test("marking mode keeps immutable hard elements eligible without requiring renderable text", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /hardElements: Array\.from\(hardExcludedSet\)\.filter\(\(el\) =>\s*!isWithinElementSet\(el, consentExcluded\)\s*\),/
  );
  assert.doesNotMatch(
    coreSource,
    /hardElements: Array\.from\(hardExcludedSet\)\.filter\(\(el\) =>[\s\S]*?hasRenderableTextForHighlight\(el, null, null, null\)/
  );
});

test("marking mode skips stored unexcluded defaults on the hard-toggle layer", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /const storedUnexcludedToggleableDefaultElements =\s*collectStoredUnexcludedToggleableDefaultElements\(entry\);/
  );
  assert.match(
    coreSource,
    /const defaultBoundarySelfSkip = new Set\(\[[\s\S]*?\.\.\.explicitInclude,[\s\S]*?\.\.\.storedUnexcludedToggleableDefaultElements[\s\S]*?\]\);/
  );
  assert.match(
    coreSource,
    /collectToggleableDefaultExcludedElements\(\s*defaultBoundarySelfSkip,[\s\S]*?boundarySelfSkip: defaultBoundarySelfSkip/
  );
});

test("marking mode renders toggleable defaults below immutable hard markings", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const defaultToggleLayerIndex = coreSource.indexOf(
    '#unfluffify-overlay .uf-layer[data-layer="default-toggle"] { z-index: 1; }'
  );
  const hardLayerIndex = coreSource.indexOf(
    '#unfluffify-overlay .uf-layer[data-layer="hard"] { z-index: 2; }'
  );

  assert.notEqual(defaultToggleLayerIndex, -1);
  assert.notEqual(hardLayerIndex, -1);
  assert.equal(defaultToggleLayerIndex < hardLayerIndex, true);
  assert.match(
    coreSource,
    /const layerDefaultToggleState = beginLayerRender\(state\.layers\["default-toggle"\]\);/
  );
  assert.match(
    coreSource,
    /layerDefaultToggleState,\s*rects,\s*"uf-hard-toggle",\s*el,\s*"default-toggle-exclude"/
  );
  assert.doesNotMatch(
    coreSource,
    /layerHardState,\s*rects,\s*"uf-hard-toggle",\s*el,\s*"default-toggle-exclude"/
  );
});

test("marking mode refresh reconciles default-toggle cache after boundary unmarks", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const refreshStart = coreSource.indexOf("function refreshExplicitMarkingOverlay");
  const refreshEnd = coreSource.indexOf("function scheduleExplicitToggleFullRender", refreshStart);
  const refreshSource = coreSource.slice(refreshStart, refreshEnd);

  assert.match(
    refreshSource,
    /collectStoredUnexcludedToggleableDefaultElements\(entry\)/
  );
  assert.match(
    refreshSource,
    /cachedCollections\.defaultExcludedToggleElements = defaultExcludedToggleElements;/
  );
  assert.match(
    refreshSource,
    /collectDefaultLayerElements\(document\.body, \{[\s\S]*?toggleableDefaultExcluded: toggleableDefaultExcludedSet/
  );
});

test("marking mode stores default ancestors as unexcluded when descendants are marked", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /if \(matchesToggleableDefaultExcluded\(el\)\) \{\s*continue;\s*\}/
  );
  assert.match(
    coreSource,
    /const generatedDefaultExcludeSet = new Set\(\);[\s\S]*?const storedExplicitContextSet = new Set\(\);/
  );
  assert.match(
    coreSource,
    /toggleableDefault &&[\s\S]*?explicitMarkedAncestorSet\.has\(el\)[\s\S]*?items\.push\(\{ xpath, excluded: false \}\);/
  );
  assert.match(
    coreSource,
    /if \(existingEl && matchesToggleableDefaultExcluded\(existingEl\)\) \{\s*item\.excluded = false;/
  );
  assert.match(
    contentSource,
    /if \(existingEl && core\.isDefaultToggleableExcludedElement\(existingEl\)\) \{\s*item\.excluded = false;/
  );
});

test("marking mode keeps unexcluded default ancestors off the default layer", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(coreSource, /filterDefaultElementsForExplicitMarks,/);
  assert.match(
    coreSource,
    /const unexcludedToggleableDefault = new Set\(options\.unexcludedToggleableDefault \|\| \[\]\);/
  );
  assert.match(
    coreSource,
    /const precedenceSet = new Set\(\[[\s\S]*?\.\.\.unexcludedToggleableDefault[\s\S]*?\]\);/
  );
  assert.doesNotMatch(
    coreSource,
    /excludedAncestorSet: new Set\(\[[\s\S]*?\.\.\.unexcludedToggleableDefault[\s\S]*?\]\)/
  );
  assert.match(
    coreSource,
    /unexcludedToggleableDefault: new Set\(storedUnexcludedToggleableDefaultElements\)/
  );
  assert.match(
    coreSource,
    /return filterDefaultElementsForExplicitMarks\(\s*defaultTargets,\s*explicitDefaultFilterElements\s*\);/
  );
  assert.match(
    coreSource,
    /explicitDefaultFilterElements: explicitExcludeElements\.concat\(explicitIncludeElements\)/
  );
  assert.match(
    coreSource,
    /explicitDefaultFilterElements: filteredExplicitExclude\.concat\(filteredExplicitInclude\)/
  );
});

test("marking logic docs describe selector exclusions as element-only default suppression", () => {
  const docSource = readFileSync(
    new URL("../MARKING_AND_HIGHLIGHTING_LOGIC.md", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(docSource, /^- AI excluded content elements$/m);
  assert.match(
    docSource,
    /AI excluded content is still collected for selector-matched elements, but it is not rendered as a dedicated overlay layer\./
  );
  assert.match(
    docSource,
    /The matched selector-excluded element itself suppresses the default layer, but unmatched markable descendants can still fall through to the default layer\./
  );
  assert.match(
    docSource,
    /toggleable default exclusions render on the lower\s+`default-toggle` overlay layer/i
  );
  assert.match(
    docSource,
    /clicking a markable\s+descendant inside a default-excluded footer/i
  );
  assert.match(
    docSource,
    /broader generated default-excluded ancestors are converted to `excluded:\s+false`/
  );
  assert.match(
    docSource,
    /It also suppresses that\s+boundary's own default-layer marking/
  );
  assert.match(
    docSource,
    /Default-layer candidates that wrap or sit inside\s+visible explicit markings are filtered out/
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
