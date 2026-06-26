import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";
import { findPageMarkingEntry, state } from "../src/content/core.js";

test("core render path and silent highlighting both honor selector suppression xpaths", () => {
  const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

  assert.match(
    contentSource,
    /function getEffectiveAiSelectorSet\(\s*baseConfig(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?suppressedXpaths/
  );
  assert.match(contentSource, /collectNodesFromSelectors\(normalized\.exclusionSelectors, \{[\s\S]*?suppressedXpaths/);
  assert.match(coreSource, /collectIncludedElementsFromSelectorSet\(\s*selectorSet(?:\s*:\s*[^,]+)?,\s*options(?:\s*:\s*[^=]+)? = \{\}\s*\)(?:: [^{]+)? \{[\s\S]*?suppressedXpaths/);
  assert.match(coreSource, /collectIncludedElementsFromSelectorSet\(normalizedAiSelectorSet, \{[\s\S]*?suppressedXpaths: selectorSuppressedXpaths/);
});

test("content-main routes live-page GraphQL lookups through background runtime messages", () => {
  const contentSource = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const resolveSiteIdStart = contentSource.indexOf("async function resolveSiteIdFromGraphql(");
  const resolveSiteIdEnd = contentSource.indexOf("function extractUrlPathAndHostname", resolveSiteIdStart);
  assert.ok(resolveSiteIdStart > -1);
  assert.ok(resolveSiteIdEnd > resolveSiteIdStart);
  const resolveSiteIdBlock = contentSource.slice(resolveSiteIdStart, resolveSiteIdEnd);
  const fetchPageTypesStart = contentSource.search(/async function fetchPropertyPageTypesForSiteId\(/);
  const fetchPageTypesEnd = contentSource.indexOf("async function resolveCurrentLivePageTarget", fetchPageTypesStart);
  assert.ok(fetchPageTypesStart > -1);
  assert.ok(fetchPageTypesEnd > fetchPageTypesStart);
  const fetchPageTypesBlock = contentSource.slice(fetchPageTypesStart, fetchPageTypesEnd);

  assert.match(
    contentSource,
    /async function resolveSiteIdFromGraphql\([\s\S]*?options(?:\s*:\s*[^=]+)? = \{\}[\s\S]*?\{[\s\S]*?utils\.sendRuntimeMessage\(\{[\s\S]*?type: "resolveLivePageSiteId"/
  );
  assert.doesNotMatch(
    contentSource,
    /async function resolveSiteIdFromGraphql\([\s\S]*?options(?:\s*:\s*[^=]+)? = \{\}[\s\S]*?\{[\s\S]*?fetch\(/
  );
  assert.doesNotMatch(resolveSiteIdBlock, /utils\.sendRuntimeMessage\(\{[\s\S]*?tokenValue[\s\S]*?\}\);/);
  assert.match(
    contentSource,
    /async function fetchPropertyPageTypesForSiteId\([\s\S]*?siteId(?:\s*:\s*[^,]+)?[\s\S]*?stageBaseValue(?:\s*:\s*[^,]+)?[\s\S]*?tokenValue(?:\s*:\s*[^)]+)?[\s\S]*?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?utils\.sendRuntimeMessage\(\{[\s\S]*?type: "fetchLivePagePropertyPageTypes"/
  );
  assert.doesNotMatch(fetchPageTypesBlock, /utils\.sendRuntimeMessage\(\{[\s\S]*?tokenValue[\s\S]*?\}\);/);
  assert.doesNotMatch(
    contentSource,
    /async function fetchPropertyPageTypesForSiteId\([\s\S]*?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?fetch\(/
  );
});

test("background owns live-page GraphQL runtime dispatch", () => {
  const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const resolveBranch = backgroundSource.slice(
    backgroundSource.indexOf('if (message.type === "resolveLivePageSiteId") {'),
    backgroundSource.indexOf('if (message.type === "fetchLivePagePropertyPageTypes") {')
  );

  assert.match(backgroundSource, /from "\.\/background\/live-page-client\.js"/);
  assert.match(backgroundSource, /if \(message\.type === "resolveLivePageSiteId"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === "fetchLivePagePropertyPageTypes"\) \{/);
  assert.match(resolveBranch, /resolveBackgroundNetworkCredentials/);
  assert.doesNotMatch(resolveBranch, /tokenValue: message\.tokenValue/);
});

test("popup site-resolution keeps live-page token handling in the background layer", () => {
  const popupSource = readFileSync(new URL("../src/popup/site-resolution.ts", import.meta.url), "utf8");
  const resolveBlock = popupSource.match(
    /export async function resolveSiteIdFromGraphql\(_deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^=]+)? = \{\}\) \{([\s\S]*?)\n\}/
  )[1];
  const fetchBlock = popupSource.match(
    /export async function fetchPropertyPageTypesFromGraphql\(_deps(?:\s*:\s*[^,]+)?, options(?:\s*:\s*[^=]+)? = \{\}\) \{([\s\S]*?)\n\}/
  )[1];

  assert.match(resolveBlock, /type: "resolveLivePageSiteId"/);
  assert.doesNotMatch(resolveBlock, /tokenValue/);
  assert.match(fetchBlock, /type: "fetchLivePagePropertyPageTypes"/);
  assert.doesNotMatch(fetchBlock, /tokenValue/);
});

test("marking mode refresh reconciles entries before drawing explicit overlays", () => {
  const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
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
