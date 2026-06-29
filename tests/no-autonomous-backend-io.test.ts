import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");
const popupRemoteConfigSource = readFileSync(new URL("../src/popup/remote-config.ts", import.meta.url), "utf8");
const pageDataLifecycleSource = readFileSync(new URL("../src/background/page-data-lifecycle.ts", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

function functionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > -1, `Missing start marker ${startMarker}`);
  assert.ok(end > start, `Missing end marker ${endMarker}`);
  return source.slice(start, end);
}

test("popup refresh never performs autonomous backend writes", () => {
  const refreshBody = functionBody(
    popupSource,
    "async function refreshUiInner(",
    "async function maybeResumePersistedAiRun"
  );

  assert.match(refreshBody, /await pruneLocalInvalidPageMarkings\(\{/);
  assert.doesNotMatch(refreshBody, /syncBaseConfigToServer\(/);
  assert.doesNotMatch(refreshBody, /pruneRemoteInvalidPageMarkings\(/);
  assert.doesNotMatch(refreshBody, /removePageMarkingFromRemote\(/);
  assert.doesNotMatch(refreshBody, /saveRemoteConfigSnapshot/);
  assert.doesNotMatch(refreshBody, /removeRemotePageMarking/);
});

test("AI run and preview paths stay local/fact-reporting only until explicit user actions", () => {
  const applyComputedSelectorSetBody = functionBody(
    popupSource,
    "function applyComputedSelectorSet(",
    "async function failAiRun"
  );
  const previewOpenBody = functionBody(
    popupSource,
    "async function handleMarkingPreview()",
    "async function handleExitPreviewMode()"
  );
  const previewStateBody = functionBody(
    popupSource,
    "function applyAiPreviewStateUpdate(",
    "async function handleComputeSelectors"
  );

  for (const body of [applyComputedSelectorSetBody, previewOpenBody, previewStateBody]) {
    assert.doesNotMatch(body, /syncBaseConfigToServer\(/);
    assert.doesNotMatch(body, /saveRemoteConfigSnapshot/);
    assert.doesNotMatch(body, /removeRemotePageMarking/);
    assert.doesNotMatch(body, /submitSelectorSetGraphqlUpdate/);
  }
  assert.match(applyComputedSelectorSetBody, /PopupText\.ai\.selectorsComputedLocally/);
});

test("remote config loads are event/request driven, cached, and never recurring timers", () => {
  const loadBody = functionBody(
    popupRemoteConfigSource,
    "export async function loadRemoteConfigForCurrentPage",
    "export async function syncBaseConfigToServer"
  );

  assert.match(loadBody, /cachedPageLoadResult/);
  assert.match(loadBody, /type: "loadPageDataForNavigation"/);
  assert.doesNotMatch(loadBody, /setInterval\(/);
  assert.doesNotMatch(loadBody, /setTimeout\(/);
  assert.doesNotMatch(loadBody, /windowRef\.setTimeout/);
  assert.doesNotMatch(loadBody, /loadRemoteConfigSnapshot/);

  assert.match(backgroundSource, /browser\.webNavigation\.onCommitted\.addListener/);
  assert.match(backgroundSource, /pageDataLifecycle\.handleTopLevelNavigationCommitted\(details\)/);
  assert.match(backgroundSource, /pageDataLifecycle\.loadPageDataForNavigation\(\{/);
  assert.doesNotMatch(pageDataLifecycleSource, /setInterval\(/);
  assert.doesNotMatch(pageDataLifecycleSource, /setTimeout\(/);
});

test("remote config save transport is centralized behind the save wrapper", () => {
  assert.doesNotMatch(popupSource, /saveRemoteConfigSnapshot/);
  assert.match(popupRemoteConfigSource, /type: "saveRemoteConfigSnapshot"/);
  assert.match(backgroundSource, /if \(message\.type === "saveRemoteConfigSnapshot"\) \{/);
});
