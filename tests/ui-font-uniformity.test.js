import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const constantsSource = readFileSync(new URL("../common/constants.ts", import.meta.url), "utf8");
const coreSource = readFileSync(new URL("../content/core.ts", import.meta.url), "utf8");
const contentMainSource = readFileSync(new URL("../content-main.ts", import.meta.url), "utf8");
const popupCss = readFileSync(new URL("../popup.css", import.meta.url), "utf8");
const themeColorCss = readFileSync(new URL("../theme-color.css", import.meta.url), "utf8");

// Hardcoded UI font families that should NOT appear ad-hoc in injected page-world
// styles — they must go through EXTENSION_UI_FONT_STACK so extension chrome is
// uniform. (The Material Design Icons glyph font is intentionally separate.)
const AD_HOC_FONT_PATTERN = /(Palatino|Book Antiqua|Arial,|Helvetica Neue|"Segoe UI"|apple-system)/;

test("EXTENSION_UI_FONT_STACK is exported and mirrors the popup brand sans", () => {
  assert.match(constantsSource, /export const EXTENSION_UI_FONT_STACK\s*=/);
  // Brand sans leads with Inter in theme-color.css; the injected stack mirrors it.
  assert.match(themeColorCss, /--font-sans:\s*"Inter"/);
  assert.match(constantsSource, /EXTENSION_UI_FONT_STACK[\s\S]*?Inter/);
});

test("injected page-world styles use the shared font stack, not ad-hoc families", () => {
  for (const [label, source] of [["content/core.js", coreSource], ["content-main.js", contentMainSource]]) {
    const fontLines = source
      .split("\n")
      .filter((line) => /font(-family)?\s*:/.test(line));
    for (const line of fontLines) {
      // Allow the icon font and the unified stack.
      if (line.includes("ICON_FONT_FAMILY") || line.includes("EXTENSION_UI_FONT_STACK")) {
        continue;
      }
      assert.ok(
        !AD_HOC_FONT_PATTERN.test(line),
        `${label} has an ad-hoc UI font family (use EXTENSION_UI_FONT_STACK): ${line.trim()}`
      );
    }
  }
});

test("popup mono field references the defined --font-mono variable, not an undefined --mono", () => {
  assert.doesNotMatch(popupCss, /var\(--mono\)/);
  assert.match(popupCss, /var\(--font-mono\)/);
});
