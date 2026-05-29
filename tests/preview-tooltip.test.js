import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("preview sidebar buttons expose each detected content xpath as the button title", () => {
  const source = readFileSync(new URL("../popup/ui.js", import.meta.url), "utf8");

  assert.match(
    source,
    /class: "preview-sidebar__item-button",[\s\S]*?title: item\.xpath,[\s\S]*?onClick: \(\) => handlers\.onPreviewItemFocus\(item\.xpath\)/
  );
});

test("content-main applies the matching xpath as the preview target title", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(source, /const aiPreviewOriginalTitles = new WeakMap\(\);/);
  assert.match(
    source,
    /function setAiPreviewClickableTitle\(node, xpath\) \{[\s\S]*?previewTitle: xpath[\s\S]*?node\.setAttribute\("title", xpath\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /function syncAiPreviewClickableTargets\(items\) \{[\s\S]*?setAiPreviewClickableTitle\(node, xpath\);[\s\S]*?aiPreviewClickableNodes\.add\(node\);[\s\S]*?\}/
  );
});

test("content-main restores original page titles after preview highlighting clears", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function clearAiPreviewClickableTargets\(\) \{[\s\S]*?originalTitleState\.hadTitle[\s\S]*?node\.setAttribute\("title", originalTitleState\.title \|\| ""\);[\s\S]*?node\.getAttribute\("title"\) === originalTitleState\.previewTitle[\s\S]*?node\.removeAttribute\("title"\);[\s\S]*?aiPreviewOriginalTitles\.delete\(node\);[\s\S]*?\}/
  );
});

test("content-main copies the preview target title while keeping preview focus behavior", () => {
  const source = readFileSync(new URL("../content-main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function handleAiPreviewClick\(event\) \{[\s\S]*?if \(target\) \{[\s\S]*?copyTextToClipboard\(target\.element\.getAttribute\("title"\) \|\| target\.xpath\)\.then\(\);[\s\S]*?core\.focusPreviewElement\(target\.element, \{ center: false \}\);[\s\S]*?setAiPreviewFocusedXpath\(target\.xpath\);[\s\S]*?return true;[\s\S]*?\}/
  );
});