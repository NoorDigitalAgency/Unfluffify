import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

// Regression: SPA navigation detection must be event-based (history patch +
// popstate/hashchange), not an 800ms polling timer. Behavioral coverage for the
// watcher lives in core-scheduling.test.ts; these assertions lock the mechanism.

test("core URL detection patches history and listens for popstate/hashchange", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  assert.match(source, /export function ensureNavigationNotifierInstalled\(\): void \{/);
  assert.match(source, /patchHistoryMethod\("pushState"\);/);
  assert.match(source, /patchHistoryMethod\("replaceState"\);/);
  assert.match(source, /window\.addEventListener\("popstate", emitNavigationChangeIfUrlChanged\);/);
  assert.match(source, /window\.addEventListener\("hashchange", emitNavigationChangeIfUrlChanged\);/);

  // startUrlWatcher must subscribe to the notifier, not poll on an interval.
  const startStart = source.indexOf("export function startUrlWatcher()");
  assert.ok(startStart > -1);
  const startEnd = source.indexOf("\n}", startStart);
  const startBody = source.slice(startStart, startEnd);
  assert.match(startBody, /subscribeNavigationChange\(/);
  assert.doesNotMatch(startBody, /extensionSetInterval|setInterval/);
});

test("content-main silent URL watcher no longer polls on an 800ms interval", () => {
  const source = readFileSync(new URL("../src/content-main.ts", import.meta.url), "utf8");
  const fnStart = source.indexOf("function startSilentHighlightingUrlWatcher()");
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf("\n}", fnStart);
  const fnBody = source.slice(fnStart, fnEnd);
  assert.doesNotMatch(fnBody, /setInterval/);
  assert.match(fnBody, /core\.ensureNavigationNotifierInstalled\(\)/);
  // The dedicated 800ms URL polling timer field is gone.
  assert.doesNotMatch(source, /silentHighlightingUrlTimer/);
});

test("the page freeze is a single page-visit lock released only on navigation", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");
  // pausePageMotion holds the page-visit lock so per-subsystem resumes (marking
  // disable, silent teardown, AI run/preview/exit) drop only their own reason.
  assert.match(source, /const PAGE_VISIT_MOTION_PAUSE_REASON = "page-visit";/);
  assert.match(
    source,
    /export function pausePageMotion\([\s\S]*?pauseState\.reasons\.add\(PAGE_VISIT_MOTION_PAUSE_REASON\);[\s\S]*?refreshPageMotionPause\(\);/
  );
  // The ONLY release is on URL change, wired into the navigation notifier.
  const emitStart = source.indexOf("function emitNavigationChangeIfUrlChanged()");
  assert.ok(emitStart > -1);
  const emitEnd = source.indexOf("\n}", emitStart);
  const emitBody = source.slice(emitStart, emitEnd);
  assert.match(emitBody, /resumeAllPageMotion\(\);/);
  // enableForBaseUrl keeps an existing freeze instead of re-running the reveal warmup.
  assert.match(
    source,
    /if \(isPageMotionPaused\(\)\) \{[\s\S]*?pausePageMotion\(\);[\s\S]*?\} else if \(!skipInitialReveal\)/
  );
});
