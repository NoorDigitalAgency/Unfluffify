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

test("marking mode keeps default exclusions out of a generated render collection", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /const storedUnexcludedToggleableDefaultElements =\s*collectStoredUnexcludedToggleableDefaultElements\(entry\);/
  );
  assert.doesNotMatch(coreSource, /defaultExcludedToggleElements/);
  assert.doesNotMatch(coreSource, /defaultBoundarySelfSkip/);
});

test("marking mode renders synced default exclusions as ordinary exclude markings", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const collectorStart = coreSource.indexOf("function collectExplicitMarkingElements");
  const collectorEnd = coreSource.indexOf("export function collectStoredUnexcludedToggleableDefaultElements", collectorStart);
  const collectorSource = coreSource.slice(collectorStart, collectorEnd);

  assert.doesNotMatch(coreSource, /default-toggle/);
  assert.doesNotMatch(coreSource, /uf-hard-toggle/);
  assert.doesNotMatch(coreSource, /default-toggle-exclude/);
  assert.doesNotMatch(collectorSource, /isStoredExcludeStateUserModified/);
  assert.match(
    coreSource,
    /drawMultiRectReuse\([\s\S]*?layerExplicitExcludeState,[\s\S]*?presentation\.className,[\s\S]*?"explicit-exclude"/
  );
});

test("marking runtime keeps default exclusions decision-only", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const defaultLayerStart = coreSource.indexOf("export function collectDefaultLayerElements");
  const defaultLayerEnd = coreSource.indexOf("function collectSelectorElements", defaultLayerStart);
  const defaultLayerSource = coreSource.slice(defaultLayerStart, defaultLayerEnd);
  const explicitCollectorStart = coreSource.indexOf("function collectExplicitMarkingElements");
  const explicitCollectorEnd = coreSource.indexOf("export function collectStoredUnexcludedToggleableDefaultElements", explicitCollectorStart);
  const explicitCollectorSource = coreSource.slice(explicitCollectorStart, explicitCollectorEnd);

  assert.doesNotMatch(coreSource, /default-toggle|uf-hard-toggle|default-toggle-exclude/);
  assert.doesNotMatch(coreSource, /defaultExcludedToggleElements/);
  assert.doesNotMatch(coreSource, /filterDefaultElementsForExplicitMarks/);
  assert.doesNotMatch(defaultLayerSource, /toggleableDefaultExcluded/);
  assert.doesNotMatch(defaultLayerSource, /options\.toggleableDefaultExcluded/);
  assert.doesNotMatch(explicitCollectorSource, /isStoredExcludeStateUserModified/);
  assert.match(
    coreSource,
    /const storedUnexcludedToggleableDefaultElements =\s*collectStoredUnexcludedToggleableDefaultElements\(entry\);/
  );
});

test("marking mode refresh reconciles entries before drawing explicit overlays", () => {
  const coreSource = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");
  const refreshStart = coreSource.indexOf("function refreshExplicitMarkingOverlay");
  const refreshEnd = coreSource.indexOf("function scheduleExplicitToggleFullRender", refreshStart);
  const refreshSource = coreSource.slice(refreshStart, refreshEnd);

  assert.match(
    refreshSource,
    /const syncResult = syncPageMarkings\(state\.config, pageUrl, immutableExcluded, \{[\s\S]*?allowCreate: true,[\s\S]*?persist: true[\s\S]*?\}\);/
  );
  assert.match(
    refreshSource,
    /syncedEntry = syncResult\.entry \|\| syncedEntry;/
  );
  assert.match(
    refreshSource,
    /collectExplicitMarkingElements\(syncedEntry\)/
  );
  assert.doesNotMatch(refreshSource, /defaultExcludedToggleElements/);
  assert.doesNotMatch(refreshSource, /toggleableDefaultExcluded/);
  assert.doesNotMatch(refreshSource, /collectDefaultLayerElements\(document\.body, \{/);
  assert.match(refreshSource, /drawExplicitMarkingLayers/);
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

  assert.doesNotMatch(coreSource, /filterDefaultElementsForExplicitMarks/);
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
    /Toggleable default exclusions have no separate visual layer/i
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
    /It must suppress the\s+boundary's own default-layer marking/
  );
  assert.match(
    docSource,
    /fast explicit-toggle overlay refreshes must run page\s+marking synchronization before drawing/i
  );
});

test("marking contract is locked across docs, memory, plan, and README", () => {
  const docSource = readFileSync(
    new URL("../MARKING_AND_HIGHLIGHTING_LOGIC.md", import.meta.url),
    "utf8"
  );
  const knowledgeSource = readFileSync(
    new URL("../.copilot/knowledge.md", import.meta.url),
    "utf8"
  );
  const planSource = readFileSync(
    new URL("../.copilot/plan.md", import.meta.url),
    "utf8"
  );
  const readmeSource = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const constantsSource = readFileSync(
    new URL("../common/constants.js", import.meta.url),
    "utf8"
  );

  for (const source of [docSource, knowledgeSource]) {
    assert.match(source, /locked (?:compatibility )?contract/i);
    assert.match(source, /explicit(?:ly)? (?:asks|requests|requested|instructed)/i);
    assert.match(source, /b9c86238b08dd0b0ee0231fcab7b214625e29670/);
    assert.match(source, /no separate visual layer|must not have a dedicated visual layer/i);
    assert.match(source, /ordinary exclude marking path|ordinary exclude overlay/i);
  }
  assert.match(docSource, /Toggleable defaults differ from user\/CSS-selected exclusions only while the\s+excluded\/included state is being decided/i);
  assert.match(docSource, /`BUTTON` is intentionally toggleable\. `LINK` is intentionally immutable\./);
  assert.match(docSource, /Any legitimate contract change must update this document, `\.copilot\/knowledge\.md`,\s+`\.copilot\/plan\.md`, `README\.md`, and the focused regression tests/i);
  assert.match(planSource, /Marking Contract Lock/);
  assert.match(planSource, /Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks/i);
  assert.match(planSource, /`BUTTON` is now a toggleable default exclusion/);
  assert.match(planSource, /`LINK` is now an immutable default exclusion/);
  assert.match(readmeSource, /locked restored contract/i);
  assert.match(readmeSource, /node --test tests\/core-visibility\.test\.js tests\/core-scheduling\.test\.js tests\/marking-rules\.test\.js tests\/popup-marking-refresh\.test\.js tests\/selector-suppression\.test\.js tests\/silent-highlight-annotations\.test\.js tests\/silent-highlight-rules\.test\.js tests\/submission-rules\.test\.js/);
  assert.match(constantsSource, /locked marking contract/);
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
