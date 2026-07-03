import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

test("silent highlight titles combine matched selectors with xpath and fall back to xpath-only", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function buildSilentHighlightTitle\(selector(?:\s*:\s*[^,]+)?, xpath(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?"Matched CSS selectors:"[\s\S]*?`Matched CSS selector: \$\{selectorLines\[0\]\}`[\s\S]*?`XPath: \$\{normalizedXpath\}`[\s\S]*?return normalizedXpath \|\| normalizedSelector;[\s\S]*?\}/
  );
});

test("silent highlight annotations apply selector plus xpath for excluded and explicit include nodes", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function applySilentSelectorAnnotations\(collections(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const explicitIncludeXpathByNode =[\s\S]*?const excludedXpathByNode =[\s\S]*?explicitIncludeXpathByNode\.forEach\(\(xpath, node\) => \{[\s\S]*?setSilentSelectorAnnotation\([\s\S]*?"included",[\s\S]*?explicitIncludeSelectorByNode\.get\(node\) \|\| "",[\s\S]*?xpath[\s\S]*?\);[\s\S]*?\}\);[\s\S]*?excludedXpathByNode\.forEach\(\(xpath, node\) => \{[\s\S]*?setSilentSelectorAnnotation\([\s\S]*?"excluded",[\s\S]*?excludedSelectorByNode\.get\(node\) \|\| "",[\s\S]*?xpath[\s\S]*?\);[\s\S]*?\}\);/
  );
});

test("silent highlight annotations apply xpath-only metadata to by-default-included content", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /implicitIncludeXpathByNode\.forEach\(\(xpath, node\) => \{[\s\S]*?setSilentSelectorAnnotation\(node, "implicit", "", xpath\);[\s\S]*?\}\);/
  );
  assert.match(
    source,
    /const implicitIncludeXpathByNode = buildSilentHighlightXpathByNode\([\s\S]*?contentNodes\.filter\(\(node\) => !explicitIncludeXpathByNode\.has\(node\)\)[\s\S]*?\);/
  );
});

test("silent highlight render keys and stored collections include xpath metadata maps", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function buildSilentHighlightingRenderKey\([\s\S]*?explicitIncludeXpathByNode(?:\s*:\s*[^=]+)? = null,[\s\S]*?excludedXpathByNode(?:\s*:\s*[^=]+)? = null,[\s\S]*?implicitIncludeXpathByNode(?:\s*:\s*[^=]+)? = null[\s\S]*?const explicitIncludeXpathKey = buildNodeValueKey\(explicitIncludeXpathByNode\);[\s\S]*?const excludedXpathKey = buildNodeValueKey\(excludedXpathByNode\);[\s\S]*?const implicitIncludeXpathKey = buildNodeValueKey\(implicitIncludeXpathByNode\);[\s\S]*?explicitIncludeXpathKey,[\s\S]*?excludedXpathKey,[\s\S]*?implicitIncludeXpathKey[\s\S]*?\.join\("\|"\);/
  );
  assert.match(
    source,
    /silentHighlightCollections = \{[\s\S]*?explicitIncludeXpathByNode:[\s\S]*?new Map\(collections\.explicitIncludeXpathByNode\)[\s\S]*?excludedXpathByNode:[\s\S]*?new Map\(collections\.excludedXpathByNode\)[\s\S]*?implicitIncludeXpathByNode:[\s\S]*?new Map\(collections\.implicitIncludeXpathByNode\)[\s\S]*?\};/
  );
});

test("silent highlight keeps source-node collections so reflowed overlays can be rebuilt from stable inputs", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function buildSilentHighlightRenderableCollections\([\s\S]*?collections(?:\s*:\s*[^)]+)?[\s\S]*?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const sourceContentNodes = cloneSilentHighlightNodes\([\s\S]*?const sourceExcludedNodes = cloneSilentHighlightNodes\([\s\S]*?const sourceExplicitIncludeNodes = cloneSilentHighlightNodes\([\s\S]*?const contentNodes = toRenderableNodeList\(sourceContentNodes\);[\s\S]*?const excludedRenderable = toRenderableNodeListWithSelectors\([\s\S]*?sourceExcludedNodes,[\s\S]*?return \{[\s\S]*?sourceContentNodes,[\s\S]*?sourceExcludedNodes,[\s\S]*?sourceExplicitIncludeNodes,[\s\S]*?sourceInclusionSelectorByNode,[\s\S]*?sourceExclusionSelectorByNode,[\s\S]*?implicitIncludeXpathByNode[\s\S]*?\};/
  );
  assert.match(
    source,
    /silentHighlightCollections = \{[\s\S]*?sourceContentNodes: cloneSilentHighlightNodes\(collections\.sourceContentNodes\),[\s\S]*?sourceExcludedNodes: cloneSilentHighlightNodes\(collections\.sourceExcludedNodes\),[\s\S]*?sourceExplicitIncludeNodes: cloneSilentHighlightNodes\(collections\.sourceExplicitIncludeNodes\),[\s\S]*?sourceInclusionSelectorByNode: cloneSilentHighlightNodeValueMap\([\s\S]*?sourceExclusionSelectorByNode: cloneSilentHighlightNodeValueMap\([\s\S]*?explicitIncludeSelectorByNode:[\s\S]*?excludedSelectorByNode:/
  );
});

test("silent highlighting keeps immutable sources on a dedicated immutable overlay layer", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(source, /const SILENT_HIGHLIGHT_LAYER_KEYS = \["immutable", "content", "excluded"\];/);
  assert.match(source, /#\$\{SILENT_HIGHLIGHT_OVERLAY_ID\} \.uf-silent-immutable \{[\s\S]*?border: 1px dashed rgba\(156, 107, 107, 0\.45\);[\s\S]*?background: transparent;/);
  assert.match(
    source,
    /function collectImmutableDefaultExcludedNodes\(includedNodes(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{/
  );
  assert.match(
    source,
    /function buildSilentHighlightRenderableCollections\([\s\S]*?collections(?:\s*:\s*[^)]+)?[\s\S]*?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const sourceImmutableNodes = cloneSilentHighlightNodes\([\s\S]*?const immutableNodes = toRenderableNodeList\(sourceImmutableNodes\);[\s\S]*?return \{[\s\S]*?immutableNodes,[\s\S]*?sourceImmutableNodes,[\s\S]*?contentNodes,[\s\S]*?excludedNodes/
  );
  assert.match(
    source,
    /function renderSilentHighlightOverlay\([\s\S]*?collections(?:\s*:\s*[^,]+)?[\s\S]*?options(?:\s*:\s*[^=]+)? = \{\}[\s\S]*?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const immutableNodes = Array\.from\(collections\.immutableNodes \|\| \[\]\);[\s\S]*?const immutableLayerState = beginSilentLayerRender\("immutable"\);[\s\S]*?drawSilentRectsForNode\(immutableLayerState, node, "uf-silent-immutable"\);/
  );
  assert.match(
    source,
    /function collectSilentHighlightSources\([\s\S]*?const immutableSourcesForSilentOverlay = Array\.isArray\(contentMarking\.immutableExcluded\)[\s\S]*?sourceImmutableNodes: immutableSourcesForSilentOverlay/
  );
});

test("silent highlighting owns page motion pause for matching pages even without overlay targets", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const stateMachineSource = readFileSync(new URL("../src/content/property-lock-state-machine.ts", import.meta.url), "utf8");

  assert.match(source, /const SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON = "silent-highlighting";/);
  assert.match(
    source,
    /function setSilentHighlightingPageMotionPaused\(\s*paused(?:\s*:\s*[^)]+)?\s*\)(?:: [^{]+)? \{[\s\S]*?core\.pausePageMotion\(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON\);[\s\S]*?core\.resumePageMotion\(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /async function loadAndNormalizeConfigs\([\s\S]*?const baseUrl = utils\.findMatchingBaseUrl\(pageUrl, configs\);[\s\S]*?if \(!baseUrl\) \{[\s\S]*?snapshot: null[\s\S]*?silentModeActive: false[\s\S]*?\}[\s\S]*?const normalized = config\.normalizeConfig\(baseUrl, configs\[baseUrl\]\);[\s\S]*?const currentSilentRevealKey = getSilentHighlightEditorRevealKey\(baseUrl, pageUrl\);[\s\S]*?const previewPreservesMotionPause = Boolean\([\s\S]*?contentMarkingMachine\.state === "preview"[\s\S]*?core\.hasPageMotionPauseReason\(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON\)[\s\S]*?\);[\s\S]*?const holdSilentMotionPause = Boolean\([\s\S]*?previewPreservesMotionPause[\s\S]*?\|\|[\s\S]*?shouldRunSilentHighlightEditorActivation\(\)[\s\S]*?!silentHighlightEditorRevealInFlight[\s\S]*?currentSilentRevealKey === silentHighlightEditorRevealKey[\s\S]*?\);/
  );
  assert.match(
    source,
    /async function refreshSilentHighlightings\(\) \{[\s\S]*?if \(!isSilentHighlightActiveByDirective\(\) && !snapshot\.holdSilentMotionPause\) \{[\s\S]*?deactivateSilentHighlightings\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?setSilentHighlightingPageMotionPaused\(snapshot\.holdSilentMotionPause\);/
  );
  // #8: the marking-enabled early-bail must be gated on the directive being INACTIVE,
  // so a displaying preview (directive active while marking enabled) still renders the
  // stored-selector silent highlightings alongside the yellow AI-detected content
  // instead of tearing them down. Content reflects the directive; it must not re-derive
  // the block from state.enabled alone.
  assert.match(
    source,
    /async function refreshSilentHighlightings\(\) \{[\s\S]*?if \(state\.enabled && !isSilentHighlightActiveByDirective\(\)\) \{[\s\S]*?deactivateSilentHighlightings\(\);[\s\S]*?refreshEnabledAiHighlights\(\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    source,
    /const loadResult = await loadAndNormalizeConfigs\(pageUrl\);[\s\S]*?if \(refreshGeneration !== silentHighlightingRefreshGeneration \|\| location\.href !== pageUrl\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?publishSilentHighlightSessionFacts\(loadResult\.facts\);/
  );
  assert.match(
    source,
    /function publishSilentHighlightSessionFacts\([\s\S]*?const factsKey = JSON\.stringify\([\s\S]*?if \(factsKey === lastSilentHighlightSessionFactsKey\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?publishContentSessionFacts\(facts\);/
  );
  assert.match(
    source,
    /let lastSilentHighlightDirectiveActive = isSilentHighlightActiveByDirective\(\);[\s\S]*?let lastPageRevealFreezeActive = isPageRevealFreezeActiveByDirective\(\);[\s\S]*?addContentDirectiveListener\(\(directive\) => \{[\s\S]*?nextSilentHighlightDirectiveActive === lastSilentHighlightDirectiveActive &&[\s\S]*?nextPageRevealFreezeActive === lastPageRevealFreezeActive[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    source,
    /const SILENT_HIGHLIGHTING_PREPARATION_REASON = "editor_preparing";/
  );
  assert.match(
    source,
    /function shouldRunSilentHighlightEditorActivation\(\) \{[\s\S]*?if \(state\.enabled\) \{[\s\S]*?return false;[\s\S]*?\}[\s\S]*?if \(isRenderModeInspectionActive\(\)\) \{[\s\S]*?return false;[\s\S]*?\}[\s\S]*?if \(!isPageRevealFreezeActiveByDirective\(\)\) \{[\s\S]*?return false;[\s\S]*?\}/
  );
  assert.match(
    source,
    /function shouldRunSilentHighlightEditorActivation\(\) \{[\s\S]*?if \(!isPropertyLockCollaborationEnabled\(\)\) \{[\s\S]*?return true;[\s\S]*?\}[\s\S]*?return Boolean\(propertyLockState && propertyLockState\.isEditor\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function shouldRunSilentHighlightEditorActivation\(\) \{[\s\S]*?!isPageRevealFreezeActiveByDirective\(\)[\s\S]*?!isPropertyLockCollaborationEnabled\(\)[\s\S]*?propertyLockState && propertyLockState\.isEditor[\s\S]*?\}[\s\S]*?async function runEditorSilentHighlightingActivation\(\) \{[\s\S]*?const pageTypeResult = await resolveCurrentPageTypeForMarking\(baseUrl, pageUrl\);[\s\S]*?if \(!pageTypeResult\.ok \|\| !pageTypeResult\.pageType\) \{[\s\S]*?resetPageVisitRevealFreezeKeys\(\);[\s\S]*?shouldRefreshAfterActivation = true;[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(!consumePageVisitRevealFreezeAttempt\(baseUrl, pageUrl\)\) \{[\s\S]*?shouldRefreshAfterActivation = true;[\s\S]*?return;[\s\S]*?\}[\s\S]*?core\.setPageSaveReconciliationPending\(baseUrl, pageUrl, \{[\s\S]*?reason: SILENT_HIGHLIGHTING_PREPARATION_REASON[\s\S]*?\}\);[\s\S]*?core\.warmupSilentHighlightingBeforeMotionPause\([\s\S]*?SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON[\s\S]*?\);[\s\S]*?markSilentHighlightEditorRevealPrepared\(baseUrl, pageUrl\);[\s\S]*?await refreshSilentHighlightings\(\);[\s\S]*?\}/
  );
  assert.match(
    stateMachineSource,
    /const becameEditor = \(!previousState \|\| !previousState\.isEditor\) && serverMessage\.isEditor;[\s\S]*?if \(becameEditor\) \{[\s\S]*?deps\.runEditorSilentHighlightingActivation\(\)\.catch\(\(\) => \{/
  );
  assert.match(source, /createLifecycleOperationId\(LIFECYCLE_KINDS\.SILENT_HIGHLIGHTING\)/);
  assert.match(
    source,
    /emitSilentHighlightLifecycle\(\s*LIFECYCLE_PHASES\.REVEAL_STARTED,\s*true,\s*"Inspecting page\.\.\."\s*\);/
  );
  assert.match(
    source,
    /const finishSilentHighlightLifecycle = \(\) => \{[\s\S]*?emitSilentHighlightLifecycle\(lifecyclePhase, false, ""\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /core\.finishPageInspectionUi\(\);\s*finishSilentHighlightLifecycle\(\);/
  );
  const noTargetsBlock = source.match(/const shouldObserve = snapshot\.hasSelectorHighlights \|\| hasHiddenConsent;[\s\S]*?if \(!shouldObserve\) \{[\s\S]*?return \{[\s\S]*?\};[\s\S]*?\}/);
  assert.ok(noTargetsBlock);
  assert.match(source, /setSilentHighlightingsActive\(snapshot\.holdSilentMotionPause\);/);
});

test("silent highlight reposition and mutation tracking use source collections instead of only stale render targets", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(
    source,
    /function repositionSilentHighlightOverlay\(options(?:\s*:\s*[^=]+)? = \{\}\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const keepVisible = Boolean\(options\.keepVisible\);[\s\S]*?const nextCollections = buildSilentHighlightRenderableCollections\(silentHighlightCollections\);[\s\S]*?renderSilentHighlightOverlay\(nextCollections, \{ keepVisible \}\);[\s\S]*?\}/
  );
  // Settle-driven repositions keep the overlay visible (no hide->reveal blink),
  // while scroll/resize repositions still hide up front.
  assert.match(
    source,
    /repositionSilentHighlightOverlay\(\{ keepVisible: true \}\);/
  );
  // The tracked-node index that backs mutationTargetTouchesSilentCollections
  // must still draw from every source AND projected collection so a mutation
  // anywhere in the tracked subtree triggers a refresh.
  assert.match(
    source,
    /function buildSilentHighlightTrackedNodeIndex\(\)(?:\s*:\s*[^{]+)? \{[\s\S]*?silentHighlightCollections\.sourceImmutableNodes[\s\S]*?silentHighlightCollections\.sourceContentNodes[\s\S]*?silentHighlightCollections\.sourceExcludedNodes[\s\S]*?silentHighlightCollections\.sourceExplicitIncludeNodes[\s\S]*?silentHighlightCollections\.immutableNodes[\s\S]*?silentHighlightCollections\.contentNodes[\s\S]*?silentHighlightCollections\.excludedNodes[\s\S]*?\];/
  );
});

test("silent highlight annotated nodes are marked copyable and clicks copy the full title", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");

  assert.match(source, /const SILENT_TITLE_COPY_ATTR = "data-uf-silent-title-copy";/);
  assert.match(
    source,
    /const SILENT_HIGHLIGHTING_INTERNAL_ATTRS = new Set\([\s\S]*?SILENT_TITLE_COPY_ATTR,[\s\S]*?\]\);/
  );
  assert.match(
    source,
    /function setSilentSelectorAnnotation\([\s\S]*?node(?:\s*:\s*[^,]+)?[\s\S]*?kind(?:\s*:\s*[^,]+)?[\s\S]*?selector(?:\s*:\s*[^=]+)? = ""[\s\S]*?xpath(?:\s*:\s*[^=]+)? = ""[\s\S]*?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?node\.setAttribute\(SILENT_TITLE_COPY_ATTR, "on"\);[\s\S]*?node\.setAttribute\("title", title\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function clearSilentSelectorAnnotations\(\) \{[\s\S]*?node\.removeAttribute\(SILENT_TITLE_COPY_ATTR\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function handleSilentSelectorClickCopy\(event(?:\s*:\s*[^)]+)?\)(?:\s*:\s*[^{]+)? \{[\s\S]*?const annotated = target\.closest\(`\[\$\{SILENT_TITLE_COPY_ATTR\}\]`\);[\s\S]*?const title = annotated\.getAttribute\("title"\) \|\| "";[\s\S]*?copyTextToClipboard\(title\)\.then\(\);[\s\S]*?\}/
  );
});

test("silent highlight overlays never capture page clicks", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const stylesBody = source.match(
    /function ensureSilentHighlightingStyles\(\) \{[\s\S]*?style\.textContent = `([\s\S]*?)`;[\s\S]*?\n\}/
  )[1];

  assert.match(
    stylesBody,
    /#\$\{SILENT_HIGHLIGHT_OVERLAY_ID\} \{[\s\S]*?pointer-events: none;[\s\S]*?\}/
  );
  assert.match(
    stylesBody,
    /#\$\{SILENT_HIGHLIGHT_OVERLAY_ID\} \.uf-silent-layer \{[\s\S]*?pointer-events: none;[\s\S]*?\}/
  );
  assert.match(
    stylesBody,
    /#\$\{SILENT_HIGHLIGHT_OVERLAY_ID\} \.uf-silent-rect \{[\s\S]*?pointer-events: none;[\s\S]*?\}/
  );
  assert.match(
    source,
    /document\.addEventListener\("click", \(event\) => \{[\s\S]*?handleSilentSelectorClickCopy\(event\);[\s\S]*?\}\);/
  );
});