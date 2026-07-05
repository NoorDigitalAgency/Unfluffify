import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

const coreSource = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

// Chromium transiently drops custom image cursors (fetch/decode hiccups on a
// busy renderer) and shows the NEXT cursor in the CSS list until the image is
// usable again. With `not-allowed` as the exclude fallback every drop flashed
// the FORBIDDEN cursor over marking (live report). The fallback must stay a
// neutral marking-appropriate cursor, and the images are pre-warmed at
// overlay creation so the drop window is rare in the first place.
test("the exclude cursor never falls back to the forbidden cursor", () => {
  assert.match(
    coreSource,
    /html\.uf-cursor-exclude \* \{\s*cursor: url\("\$\{excludeCursorUrl\}"\) 4 3, crosshair !important;/
  );
  assert.doesNotMatch(coreSource, /cursor: url\([^)]*\) 4 3, not-allowed/);
});

test("the marking cursor images are pre-warmed with GC-held refs", () => {
  assert.match(
    coreSource,
    /const preloadedMarkingCursorImages: HTMLImageElement\[\] = \[\];/
  );
  assert.match(
    coreSource,
    /preloadMarkingCursorImages\(\[excludeCursorUrl, includeCursorUrl\]\);/
  );
});
