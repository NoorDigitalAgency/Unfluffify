import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("silent highlight titles combine matched selectors with xpath and fall back to xpath-only", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function buildSilentHighlightTitle\(selector, xpath\) \{[\s\S]*?"Matched CSS selectors:"[\s\S]*?`Matched CSS selector: \$\{selectorLines\[0\]\}`[\s\S]*?`XPath: \$\{normalizedXpath\}`[\s\S]*?return normalizedXpath \|\| normalizedSelector;[\s\S]*?\}/
  );
});

test("silent highlight annotations apply selector plus xpath for excluded and explicit include nodes", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function applySilentSelectorAnnotations\(collections\) \{[\s\S]*?const explicitIncludeXpathByNode =[\s\S]*?const excludedXpathByNode =[\s\S]*?explicitIncludeXpathByNode\.forEach\(\(xpath, node\) => \{[\s\S]*?setSilentSelectorAnnotation\([\s\S]*?"included",[\s\S]*?explicitIncludeSelectorByNode\.get\(node\) \|\| "",[\s\S]*?xpath[\s\S]*?\);[\s\S]*?\}\);[\s\S]*?excludedXpathByNode\.forEach\(\(xpath, node\) => \{[\s\S]*?setSilentSelectorAnnotation\([\s\S]*?"excluded",[\s\S]*?excludedSelectorByNode\.get\(node\) \|\| "",[\s\S]*?xpath[\s\S]*?\);[\s\S]*?\}\);/
  );
});

test("silent highlight annotations apply xpath-only metadata to by-default-included content", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

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
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function buildSilentHighlightingRenderKey\([\s\S]*?explicitIncludeXpathByNode = null,[\s\S]*?excludedXpathByNode = null,[\s\S]*?implicitIncludeXpathByNode = null[\s\S]*?const explicitIncludeXpathKey = buildNodeValueKey\(explicitIncludeXpathByNode\);[\s\S]*?const excludedXpathKey = buildNodeValueKey\(excludedXpathByNode\);[\s\S]*?const implicitIncludeXpathKey = buildNodeValueKey\(implicitIncludeXpathByNode\);[\s\S]*?explicitIncludeXpathKey,[\s\S]*?excludedXpathKey,[\s\S]*?implicitIncludeXpathKey[\s\S]*?\.join\("\|"\);/
  );
  assert.match(
    source,
    /silentHighlightCollections = \{[\s\S]*?explicitIncludeXpathByNode:[\s\S]*?new Map\(collections\.explicitIncludeXpathByNode\)[\s\S]*?excludedXpathByNode:[\s\S]*?new Map\(collections\.excludedXpathByNode\)[\s\S]*?implicitIncludeXpathByNode:[\s\S]*?new Map\(collections\.implicitIncludeXpathByNode\)[\s\S]*?\};/
  );
});

test("silent highlight keeps source-node collections so reflowed overlays can be rebuilt from stable inputs", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function buildSilentHighlightRenderableCollections\(collections\) \{[\s\S]*?const sourceContentNodes = cloneSilentHighlightNodes\([\s\S]*?const sourceExcludedNodes = cloneSilentHighlightNodes\([\s\S]*?const sourceExplicitIncludeNodes = cloneSilentHighlightNodes\([\s\S]*?const contentNodes = toRenderableNodeList\(sourceContentNodes\);[\s\S]*?const excludedRenderable = toRenderableNodeListWithSelectors\([\s\S]*?sourceExcludedNodes,[\s\S]*?return \{[\s\S]*?sourceContentNodes,[\s\S]*?sourceExcludedNodes,[\s\S]*?sourceExplicitIncludeNodes,[\s\S]*?sourceInclusionSelectorByNode,[\s\S]*?sourceExclusionSelectorByNode,[\s\S]*?implicitIncludeXpathByNode[\s\S]*?\};/
  );
  assert.match(
    source,
    /silentHighlightCollections = \{[\s\S]*?sourceContentNodes: cloneSilentHighlightNodes\(collections\.sourceContentNodes\),[\s\S]*?sourceExcludedNodes: cloneSilentHighlightNodes\(collections\.sourceExcludedNodes\),[\s\S]*?sourceExplicitIncludeNodes: cloneSilentHighlightNodes\(collections\.sourceExplicitIncludeNodes\),[\s\S]*?sourceInclusionSelectorByNode: cloneSilentHighlightNodeValueMap\([\s\S]*?sourceExclusionSelectorByNode: cloneSilentHighlightNodeValueMap\([\s\S]*?explicitIncludeSelectorByNode:[\s\S]*?excludedSelectorByNode:/
  );
});

test("silent highlight reposition and mutation tracking use source collections instead of only stale render targets", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function repositionSilentHighlightOverlay\(\) \{[\s\S]*?const nextCollections = buildSilentHighlightRenderableCollections\(silentHighlightCollections\);[\s\S]*?renderSilentHighlightOverlay\(nextCollections\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function mutationTargetTouchesSilentCollections\(target\) \{[\s\S]*?silentHighlightCollections\.sourceContentNodes[\s\S]*?silentHighlightCollections\.sourceExcludedNodes[\s\S]*?silentHighlightCollections\.sourceExplicitIncludeNodes[\s\S]*?silentHighlightCollections\.contentNodes[\s\S]*?silentHighlightCollections\.excludedNodes[\s\S]*?\];/
  );
});

test("silent highlight annotated nodes are marked copyable and clicks copy the full title", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /const SILENT_TITLE_COPY_ATTR = "data-uf-silent-title-copy";/);
  assert.match(
    source,
    /const SILENT_HIGHLIGHTING_INTERNAL_ATTRS = new Set\([\s\S]*?SILENT_TITLE_COPY_ATTR,[\s\S]*?\]\);/
  );
  assert.match(
    source,
    /function setSilentSelectorAnnotation\(node, kind, selector = "", xpath = ""\) \{[\s\S]*?node\.setAttribute\(SILENT_TITLE_COPY_ATTR, "on"\);[\s\S]*?node\.setAttribute\("title", title\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function clearSilentSelectorAnnotations\(\) \{[\s\S]*?node\.removeAttribute\(SILENT_TITLE_COPY_ATTR\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function handleSilentSelectorClickCopy\(event\) \{[\s\S]*?const annotated = target\.closest\(`\[\$\{SILENT_TITLE_COPY_ATTR\}\]`\);[\s\S]*?const title = annotated\.getAttribute\("title"\) \|\| "";[\s\S]*?copyTextToClipboard\(title\)\.then\(\);[\s\S]*?\}/
  );
});