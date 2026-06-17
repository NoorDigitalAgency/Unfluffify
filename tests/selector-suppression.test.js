import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findPageMarkingEntry, state } from "../content/core.js";

test("explicit marking handler stores page-scoped selector suppression when explicit marks are removed", () => {
  const source = readFileSync(new URL("../content/explicit-marking-handler.ts", import.meta.url), "utf8");

  assert.match(source, /function addSelectorSuppressedXpath\(deps, entry, xpath\)/);
  assert.match(source, /if \(excluded\) \{[\s\S]*?clearSelectorSuppressedXpathsWithin\(deps, entry, xpath\);[\s\S]*?\} else \{[\s\S]*?addSelectorSuppressedXpath\(deps, entry, xpath\);/);
  assert.match(source, /if \(included\) \{[\s\S]*?clearSelectorSuppressedXpathsWithin\(deps, entry, xpath\);[\s\S]*?\} else \{[\s\S]*?addSelectorSuppressedXpath\(deps, entry, xpath\);/);
});

test("core render path and silent highlighting both honor selector suppression xpaths", () => {
  const contentSource = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");

  assert.match(contentSource, /function getEffectiveAiSelectorSet\(baseConfig\) \{[\s\S]*?suppressedXpaths/);
  assert.match(contentSource, /collectNodesFromSelectors\(normalized\.exclusionSelectors, \{[\s\S]*?suppressedXpaths/);
  assert.match(coreSource, /collectIncludedElementsFromSelectorSet\(selectorSet, options = \{\}\) \{[\s\S]*?suppressedXpaths/);
  assert.match(coreSource, /collectIncludedElementsFromSelectorSet\(normalizedAiSelectorSet, \{[\s\S]*?suppressedXpaths: selectorSuppressedXpaths/);
});

test("content-main routes live-page GraphQL lookups through background runtime messages", () => {
  const contentSource = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
  const resolveSiteIdStart = contentSource.indexOf("async function resolveSiteIdFromGraphql(options = {}) {");
  const resolveSiteIdEnd = contentSource.indexOf("function extractUrlPathAndHostname", resolveSiteIdStart);
  assert.ok(resolveSiteIdStart > -1);
  assert.ok(resolveSiteIdEnd > resolveSiteIdStart);
  const resolveSiteIdBlock = contentSource.slice(resolveSiteIdStart, resolveSiteIdEnd);
  const fetchPageTypesStart = contentSource.indexOf("async function fetchPropertyPageTypesForSiteId(siteId, stageBaseValue, tokenValue) {");
  const fetchPageTypesEnd = contentSource.indexOf("async function resolveCurrentLivePageTarget", fetchPageTypesStart);
  assert.ok(fetchPageTypesStart > -1);
  assert.ok(fetchPageTypesEnd > fetchPageTypesStart);
  const fetchPageTypesBlock = contentSource.slice(fetchPageTypesStart, fetchPageTypesEnd);

  assert.match(
    contentSource,
    /async function resolveSiteIdFromGraphql\(options = \{\}\) \{[\s\S]*?utils\.sendRuntimeMessage\(\{[\s\S]*?type: "resolveLivePageSiteId"/
  );
  assert.doesNotMatch(
    contentSource,
    /async function resolveSiteIdFromGraphql\(options = \{\}\) \{[\s\S]*?fetch\(/
  );
  assert.doesNotMatch(resolveSiteIdBlock, /utils\.sendRuntimeMessage\(\{[\s\S]*?tokenValue[\s\S]*?\}\);/);
  assert.match(
    contentSource,
    /async function fetchPropertyPageTypesForSiteId\(siteId, stageBaseValue, tokenValue\) \{[\s\S]*?utils\.sendRuntimeMessage\(\{[\s\S]*?type: "fetchLivePagePropertyPageTypes"/
  );
  assert.doesNotMatch(fetchPageTypesBlock, /utils\.sendRuntimeMessage\(\{[\s\S]*?tokenValue[\s\S]*?\}\);/);
  assert.doesNotMatch(
    contentSource,
    /async function fetchPropertyPageTypesForSiteId\(siteId, stageBaseValue, tokenValue\) \{[\s\S]*?fetch\(/
  );
});

test("background owns the live-page GraphQL transport handlers", () => {
  const backgroundSource = readFileSync(new URL("../background.ts", import.meta.url), "utf8");
  const livePageClientSource = readFileSync(new URL("../background/live-page-client.ts", import.meta.url), "utf8");
  const popupSource = readFileSync(new URL("../popup/site-resolution.ts", import.meta.url), "utf8");
  const backgroundDispatchResolveStart = backgroundSource.indexOf("if (message.type === \"resolveLivePageSiteId\") {");
  const backgroundDispatchResolveEnd = backgroundSource.indexOf("if (message.type === \"fetchLivePagePropertyPageTypes\") {", backgroundDispatchResolveStart);
  const livePageResolveStart = livePageClientSource.indexOf("export async function resolveLivePageSiteId(options = {}) {");
  const livePageResolveEnd = livePageClientSource.indexOf("export async function fetchLivePagePropertyPageTypes(options = {}) {", livePageResolveStart);
  const popupResolveStart = popupSource.search(/export async function resolveSiteIdFromGraphql\(_deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  const popupResolveEnd = popupSource.indexOf("export function mergeConfigEntriesForResolvedBaseUrl", popupResolveStart);
  const popupFetchStart = popupSource.search(/export async function fetchPropertyPageTypesFromGraphql\(_deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^=]+)? = \{\}\) \{/);
  const popupFetchEnd = popupSource.indexOf("export async function ensurePropertyPageTypes", popupFetchStart);
  assert.ok(backgroundDispatchResolveStart > -1);
  assert.ok(backgroundDispatchResolveEnd > backgroundDispatchResolveStart);
  assert.ok(livePageResolveStart > -1);
  assert.ok(livePageResolveEnd > livePageResolveStart);
  assert.ok(popupResolveStart > -1);
  assert.ok(popupResolveEnd > popupResolveStart);
  assert.ok(popupFetchStart > -1);
  assert.ok(popupFetchEnd > popupFetchStart);
  const livePageResolveBlock = livePageClientSource.slice(livePageResolveStart, livePageResolveEnd);
  const backgroundDispatchResolveBlock = backgroundSource.slice(backgroundDispatchResolveStart, backgroundDispatchResolveEnd);
  const popupResolveBlock = popupSource.slice(popupResolveStart, popupResolveEnd);
  const popupFetchBlock = popupSource.slice(popupFetchStart, popupFetchEnd);

  assert.match(backgroundSource, /from "\.\/background\/live-page-client\.js"/);
  assert.doesNotMatch(backgroundSource, /async function resolveLivePageSiteId\(options = \{\}\) \{/);
  assert.doesNotMatch(backgroundSource, /function normalizeBaseUrlFromDomainName\(domainName, pageUrl = ""\) \{/);
  assert.doesNotMatch(backgroundSource, /async function fetchLivePagePropertyPageTypes\(options = \{\}\) \{/);
  assert.doesNotMatch(backgroundSource, /function buildPropertyPageTypesSignature\(pageTypes\) \{/);
  assert.match(livePageClientSource, /export async function resolveLivePageSiteId\(options = \{\}\) \{/);
  assert.match(livePageClientSource, /export function normalizeBaseUrlFromDomainName\(domainName, pageUrl = ""\) \{/);
  assert.match(livePageClientSource, /baseUrl,\s*\n\s*notFound: false/);
  assert.match(livePageClientSource, /export async function fetchLivePagePropertyPageTypes\(options = \{\}\) \{/);
  assert.match(livePageClientSource, /export function buildPropertyPageTypesSignature\(pageTypes\) \{/);
  assert.match(livePageClientSource, /duplicateUrls: normalized\.duplicateUrls \|\| \[\]/);
  assert.match(livePageClientSource, /signature: buildPropertyPageTypesSignature\(normalized\.pageTypes\)/);
  assert.match(backgroundSource, /if \(message\.type === "resolveLivePageSiteId"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "fetchLivePagePropertyPageTypes"\) \{/);
  assert.match(livePageResolveBlock, /options\.resolveBackgroundNetworkCredentials === "function"/);
  assert.match(livePageResolveBlock, /resolveCredentials\(\{[\s\S]*?stageBase: options\.stageBase,[\s\S]*?tokenValue: options\.tokenValue/);
  assert.match(livePageResolveBlock, /const tokenValue = credentials\.tokenValue;/);
  assert.match(livePageResolveBlock, /\.{3}\(tokenValue \? \{ Authorization: `Bearer \$\{tokenValue\}` \} : \{\}\)/);
  assert.match(backgroundDispatchResolveBlock, /resolveBackgroundNetworkCredentials/);
  assert.doesNotMatch(backgroundDispatchResolveBlock, /tokenValue: message\.tokenValue/);
  assert.match(popupResolveBlock, /type: "resolveLivePageSiteId"/);
  assert.doesNotMatch(popupResolveBlock, /tokenValue/);
  assert.doesNotMatch(popupResolveBlock, /fetch\(|URL_SEARCH_INFO_QUERY|maybeUpdateStoredTokenFromResponse/);
  assert.doesNotMatch(popupSource, /function normalizeBaseUrlFromDomainName/);
  assert.match(popupFetchBlock, /type: "fetchLivePagePropertyPageTypes"/);
  assert.doesNotMatch(popupFetchBlock, /fetch\(|PROPERTY_PAGE_TYPES_QUERY|maybeUpdateStoredTokenFromResponse/);
});

test("marking mode keeps selector-matched elements off the default layer without suppressing their whole subtree", () => {
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /export function collectAiContentElementsForRender\(aiCollections, options = \{\}\) \{[\s\S]*?for \(const el of aiCollections\?\.excluded \|\| \[\]\) \{/
  );
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
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /hardElements: Array\.from\(hardExcludedSet\)\.filter\(\(el\) =>(?:\n|\r\n)+(?:\/\/ @ts-ignore[^\n]*\n)?(?:\n|\r\n)*\s*!isWithinElementSet\(el, consentExcluded\)\s*\),/
  );
  assert.doesNotMatch(
    coreSource,
    /hardElements: Array\.from\(hardExcludedSet\)\.filter\(\(el\) =>[\s\S]*?hasRenderableTextForHighlight\(el, null, null, null\)/
  );
});

test("marking mode keeps default exclusions out of a generated render collection", () => {
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /const storedUnexcludedToggleableDefaultElements =\s*collectStoredUnexcludedToggleableDefaultElements\(entry\);/
  );
  assert.doesNotMatch(coreSource, /defaultExcludedToggleElements/);
  assert.doesNotMatch(coreSource, /defaultBoundarySelfSkip/);
});

test("marking mode renders synced default exclusions as ordinary exclude markings", () => {
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
  const collectorStart = coreSource.indexOf("function collectExplicitMarkingElements");
  const collectorEnd = coreSource.indexOf("export function collectStoredUnexcludedToggleableDefaultElements", collectorStart);
  const collectorSource = coreSource.slice(collectorStart, collectorEnd);

  assert.doesNotMatch(coreSource, /default-toggle/);
  assert.doesNotMatch(coreSource, /uf-hard-toggle/);
  assert.doesNotMatch(coreSource, /default-toggle-exclude/);
  assert.doesNotMatch(collectorSource, /isStoredExcludeStateUserModified/);
  assert.match(
    collectorSource,
    /item\.explicit === true \|\| matchesToggleableDefaultExcluded\(el\)/
  );
  assert.match(
    coreSource,
    /drawMultiRectReuse\([\s\S]*?layerSavedExplicitExcludeState,[\s\S]*?presentation\.className,[\s\S]*?"saved-explicit-exclude"/
  );
});

test("marking precedence contract is enforced as defaults then saved then css then session", () => {
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");

  assert.match(coreSource, /saved-explicit-exclude/);
  assert.match(coreSource, /saved-explicit-include/);
  assert.match(coreSource, /session-explicit-exclude/);
  assert.match(coreSource, /session-explicit-include/);
  assert.match(coreSource, /splitExplicitMarkingCollectionsBySavedState\(/);
  assert.match(
    coreSource,
    /#unfluffify-overlay \.uf-layer\[data-layer="default"\] \{ z-index: 3; \}[\s\S]*?#unfluffify-overlay \.uf-layer\[data-layer="saved-explicit-exclude"\] \{ z-index: 4; \}[\s\S]*?#unfluffify-overlay \.uf-layer\[data-layer="saved-explicit-include"\] \{ z-index: 5; \}[\s\S]*?#unfluffify-overlay \.uf-layer\[data-layer="ai-content"\] \{ z-index: 6; \}[\s\S]*?#unfluffify-overlay \.uf-layer\[data-layer="session-explicit-exclude"\] \{ z-index: 7; \}[\s\S]*?#unfluffify-overlay \.uf-layer\[data-layer="session-explicit-include"\] \{ z-index: 8; \}/
  );
  assert.match(
    coreSource,
    /collectAiContentElementsForRender\(aiCollections, \{[\s\S]*?excludedByState: aiSuppressedBySessionExcluded,[\s\S]*?explicitInclude: sessionExplicitIncludeForAi/
  );
  assert.match(
    coreSource,
    /for \(const el of collections\.fetchedExplicitExcludeElements \|\| \[\]\)[\s\S]*?for \(const el of collections\.fetchedExplicitIncludeElements \|\| \[\]\)[\s\S]*?for \(const el of collections\.aiContentElements\)[\s\S]*?for \(const el of collections\.sessionExplicitExcludeElements \|\| \[\]\)[\s\S]*?for \(const el of collections\.sessionExplicitIncludeElements \|\| \[\]\)/
  );
});

test("marking runtime keeps default exclusions decision-only", () => {
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
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
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
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
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
  const handlerSource = readFileSync(new URL("../content/explicit-marking-handler.ts", import.meta.url), "utf8");

  assert.match(
    coreSource,
    /function collectExcludedParentElements\(items\) \{[\s\S]*?if \(!item \|\| !item\.xpath \|\| !item\.excluded\) \{[\s\S]*?parents\.add\(el\);/
  );
  assert.doesNotMatch(
    coreSource,
    /storedExplicitContextSet/
  );
  assert.match(
    coreSource,
    /const explicitMarkedXpaths = new Set\(\[[\s\S]*?\.\.\.Array\.from\(excludedLookup\.keys\(\)\),[\s\S]*?\.\.\.filteredIncludeXpaths/
  );
  assert.match(
    coreSource,
    /return explicitXpathSet\.has\(xpath\);/
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
    handlerSource,
    /if \(existingEl && deps\.isDefaultToggleableExcludedElement\(existingEl\)\) \{\s*item\.excluded = false;/
  );
});

test("explicit marking toggles cache XPath element resolution per operation", () => {
  const contentSource = readFileSync(new URL("../content/runtime-message-handler.ts", import.meta.url), "utf8");
  const handlerSource = readFileSync(new URL("../content/explicit-marking-handler.ts", import.meta.url), "utf8");
  const excludeStart = handlerSource.indexOf("function setExplicitExclude(options) {");
  const includeStart = handlerSource.indexOf("function setExplicitInclude(options) {");
  const afterInclude = handlerSource.indexOf("\n\n  return {", includeStart);
  const excludeSource = handlerSource.slice(excludeStart, includeStart);
  const includeSource = handlerSource.slice(includeStart, afterInclude);

  assert.match(contentSource, /deps\.getExplicitMarkingHandler\(\)\.setExplicitExclude\(\{/);
  assert.match(contentSource, /deps\.getExplicitMarkingHandler\(\)\.setExplicitInclude\(\{/);
  assert.match(handlerSource, /function createXPathElementCache\(deps\)/);
  assert.match(handlerSource, /function isSameOrDescendantByElementOrXPath\(deps,/);
  assert.match(excludeSource, /const getElement = createXPathElementCache\(deps\);/);
  assert.match(includeSource, /const getElement = createXPathElementCache\(deps\);/);
  assert.doesNotMatch(excludeSource, /deps\.getElementFromXPath/);
  assert.doesNotMatch(includeSource, /deps\.getElementFromXPath/);
});

test("render collection hot paths avoid nested contains scans", () => {
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
  const collapseStart = coreSource.indexOf("export function collapseElementsByNesting");
  const collapseEnd = coreSource.indexOf("function collapseElementsByNestingPreservingExplicit", collapseStart);
  const collapseSource = coreSource.slice(collapseStart, collapseEnd);
  const selectorStart = coreSource.indexOf("function collectIncludedElementsFromSelectorSet");
  const selectorEnd = coreSource.indexOf("function getElementDepth", selectorStart);
  const selectorSource = coreSource.slice(selectorStart, selectorEnd);

  assert.match(collapseSource, /const keptSet = new Set\(\);/);
  assert.match(collapseSource, /addElementAndAncestorsToSet\(keptDeepAncestorSet, candidate\);/);
  assert.doesNotMatch(collapseSource, /\.some\([\s\S]*?\.contains\(/);
  assert.match(selectorSource, /const suppressedElementSet = new Set\(suppressedElementsByXpath\.values\(\)\);/);
  assert.match(selectorSource, /isWithinElementSet\(element, suppressedElementSet\)/);
  assert.doesNotMatch(selectorSource, /for \(const suppressedElement of suppressedElements\)/);
});

test("marking mode keeps unexcluded default ancestors off the default layer", () => {
  const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");

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
    new URL("../common/constants.ts", import.meta.url),
    "utf8"
  );

  for (const source of [docSource, knowledgeSource]) {
    assert.match(source, /locked (?:compatibility )?contract/i);
    assert.match(source, /explicit(?:ly)? (?:asks|requests|requested|instructed)/i);
    assert.match(source, /052c164b077d459fa7a6e79b306f01144336719c/);
    assert.match(source, /no separate visual layer|must not have a dedicated visual layer/i);
    assert.match(source, /ordinary exclude marking path|ordinary exclude overlay/i);
    assert.match(source, /silent highlighting (?:keeps|stays|uses)[\s\S]*immutable[\s\S]*content[\s\S]*excluded/i);
  }
  assert.match(docSource, /direct own text makes the\s+boundary self-markable/i);
  assert.match(docSource, /every stored excluded XPath row submits as an excluded row/i);
  assert.match(docSource, /Structural toggles still schedule the\s+full invalidating rebuild immediately after the fast explicit refresh/i);
  assert.match(docSource, /Leaf explicit-exclude toggles may patch cached lower-priority\s+collections and debounce that full rebuild/i);
  assert.match(docSource, /052c `links` silent layer[\s\S]*not part\s+of the current locked contract/i);
  assert.match(docSource, /`BUTTON` is intentionally toggleable\. `LINK` is intentionally omitted from the\s+taxonomy/);
  assert.match(docSource, /Any legitimate contract change must update this document, `\.copilot\/knowledge\.md`,\s+`\.copilot\/plan\.md`, `README\.md`, and the focused regression tests/i);
  assert.match(planSource, /Marking Contract Lock/);
  assert.match(planSource, /Do not change default-exclusion taxonomy, target resolution, sync semantics, or overlay projection unless the user explicitly asks/i);
  assert.match(planSource, /052c-derived marking restoration completed/);
  assert.match(planSource, /submit every stored excluded XPath row as excluded/i);
  assert.match(readmeSource, /locked 052c-derived restored contract/i);
  assert.match(
    readmeSource,
    /(?:node --test|deno test -A --no-check --unstable-sloppy-imports) tests\/core-visibility\.test\.js tests\/core-motion-pause\.test\.js tests\/core-scheduling\.test\.js tests\/marking-rules\.test\.js tests\/popup-marking-refresh\.test\.js tests\/selector-suppression\.test\.js tests\/silent-highlight-annotations\.test\.js tests\/silent-highlight-rules\.test\.js tests\/submission-rules\.test\.js/
  );
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
