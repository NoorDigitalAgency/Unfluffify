import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { runPageMotionFreezeControl } from "../common/page-motion-freeze-control.js";

test("page motion bridge is not bootstrapped by the content loader", () => {
  const source = readFileSync(new URL("../content-loader.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /page-motion-freeze/i);
  assert.doesNotMatch(source, /unfluffify-page-motion-freeze-script/);
  assert.doesNotMatch(source, /ensurePageMotionFreezeBootstrapScript/);
});

test("content core sends page motion controls through background instead of postMessage", () => {
  const source = readFileSync(new URL("../content/core.js", import.meta.url), "utf8");

  assert.match(source, /type:\s*"pageMotionFreezeControl"/);
  assert.match(source, /utils\.sendRuntimeMessage\(message\)/);
  assert.doesNotMatch(source, /window\.postMessage/);
  assert.doesNotMatch(source, /unfluffify:page-motion-freeze-control:v1/);
  assert.doesNotMatch(source, /common\/page-motion-freeze\.js/);
  assert.doesNotMatch(source, /PAGE_MOTION_PAUSE_SCRIPT_ID/);
});

test("background executes the page motion control function in MAIN world", () => {
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");

  assert.match(source, /import \{ runPageMotionFreezeControl \} from "\.\/common\/page-motion-freeze-control\.js";/);
  assert.match(source, /if \(message\.type === "pageMotionFreezeControl"\) \{/);
  assert.match(source, /chrome\.scripting\.executeScript\(\{/);
  assert.match(source, /world:\s*"MAIN"/);
  assert.match(source, /func:\s*runPageMotionFreezeControl/);
  assert.match(source, /pageMotionFreezeControlQueueByTarget/);
  assert.match(source, /getPageMotionFreezeControlTargetKey/);
});

test("page motion control function has no persistent page message listener", () => {
  const source = readFileSync(new URL("../common/page-motion-freeze-control.js", import.meta.url), "utf8");
  const serialized = Function.prototype.toString.call(runPageMotionFreezeControl);

  assert.equal(existsSync(new URL("../common/page-motion-freeze.js", import.meta.url)), false);
  assert.match(source, /export function runPageMotionFreezeControl/);
  assert.match(serialized, /const STATE_KEY = "__unfluffifyPageMotionFreezeState"/);
  assert.match(serialized, /function initTimerBridge/);
  assert.match(serialized, /function initLazyLoadingBridge/);
  assert.doesNotMatch(source, /CONTROL_MARKER/);
  assert.doesNotMatch(source, /unfluffify:page-motion-freeze-control:v1/);
  assert.doesNotMatch(source, /addEventListener\("message"/);
});
