import test from "node:test";
import assert from "node:assert/strict";

import {
  SILENT_HIGHLIGHT_OPTIONS_DEFAULTS,
  normalizeSilentHighlightOptions
} from "../common/silent-highlight-options.js";

test("normalizeSilentHighlightOptions returns the current defaults", () => {
  assert.deepEqual(normalizeSilentHighlightOptions(), SILENT_HIGHLIGHT_OPTIONS_DEFAULTS);
});

test("normalizeSilentHighlightOptions ignores removed marked-page settings", () => {
  assert.deepEqual(
    normalizeSilentHighlightOptions({
      markedPages: false,
      includedContent: false,
      excludedContent: true,
      visibleConsent: true,
      hideDuringScrollRedraw: false
    }),
    {
      includedContent: false,
      excludedContent: true,
      visibleConsent: true,
      hideDuringScrollRedraw: false
    }
  );
});