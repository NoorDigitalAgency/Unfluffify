import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("popup scheduleRefresh uses the quiet refresh path", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /function scheduleRefresh\(\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
});

test("quiet popup refresh skips redundant property lock fetches", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(source, /const skipPropertyLockFetch = Boolean\(options\.skipPropertyLockFetch\);/);
  assert.match(source, /if \(!skipPropertyLockFetch \|\| !state\.propertyLockState\) \{[\s\S]*?fetchPropertyLockState/);
});

test("explicit include and exclude removals use the quiet refresh path", () => {
  const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8");

  assert.match(
    source,
    /async function handleExplicitExcludeRemove\(xpath\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
  assert.match(
    source,
    /async function handleExplicitIncludeRemove\(xpath\) \{[\s\S]*?await refreshUi\(\{ useBusyOverlay: false, skipPropertyLockFetch: true \}\);[\s\S]*?\}/
  );
});