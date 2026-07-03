import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

// P6 follow-up: the page-type taxonomy is the allowlist the todo list filters
// property page types against (normalizePropertyPageTypes drops any slug not in
// it). The refresh stays FAIL-OPEN but must RETRY on transient failure so a
// fresh install whose first fetch fails self-heals and populates the cache,
// instead of silently dropping backend-only page types.

const popupSource = readFileSync(new URL("../src/popup.ts", import.meta.url), "utf8");

test("the taxonomy refresh retries on failure but not on terminal outcomes", () => {
  const start = popupSource.indexOf("function loadPageTypeTaxonomyWithRetry(");
  assert.ok(start > -1, "loadPageTypeTaxonomyWithRetry must exist");
  const end = popupSource.indexOf("\nasync function init()", start);
  const body = popupSource.slice(start, end);

  // Applied-ok, no-endpoint (skipped), and auth_error are terminal — no retry.
  assert.match(body, /result\.ok === true && result\.status === "ok"/);
  assert.match(body, /result\.skipped === true/);
  assert.match(body, /result\.status === "auth_error"/);
  assert.match(body, /if \(terminal\) \{[\s\S]*?pageTypeTaxonomyRetryCount = 0;[\s\S]*?return;/);
  // A network/HTTP failure schedules a retry (both the resolved-not-ok and the
  // rejected paths).
  assert.match(body, /\}\)\s*\.catch\(\(\) => \{\s*schedulePageTypeTaxonomyRetry\(\);\s*\}\)/);
});

test("the retry uses bounded exponential backoff and guards against overlap", () => {
  const start = popupSource.indexOf("function schedulePageTypeTaxonomyRetry(");
  assert.ok(start > -1);
  const end = popupSource.indexOf("\nasync function init()", start);
  const body = popupSource.slice(start, end);
  // Overlap + attempt-cap guard.
  assert.match(body, /if \(pageTypeTaxonomyRetryTimer \|\| pageTypeTaxonomyRetryCount >= PAGE_TYPE_TAXONOMY_MAX_RETRIES\)/);
  // Exponential backoff capped at 30s.
  assert.match(body, /Math\.min\(30000, 2000 \* Math\.pow\(2, pageTypeTaxonomyRetryCount\)\)/);
  assert.match(body, /loadPageTypeTaxonomyWithRetry\(\);/);
});

test("init drives the retrying loader (not a fire-and-forget one-shot) and resets its state", () => {
  const start = popupSource.indexOf("async function init()");
  const body = popupSource.slice(start, start + 400);
  assert.match(body, /pageTypeTaxonomyRetryCount = 0;/);
  assert.match(body, /loadPageTypeTaxonomyWithRetry\(\);/);
  // The old fire-and-forget one-shot is gone.
  assert.doesNotMatch(
    body,
    /void messages\.sendRuntimeMessage\(\{ type: "loadPageTypeTaxonomy" \}\)\.catch\(\(\) => \{\}\);/
  );
});
