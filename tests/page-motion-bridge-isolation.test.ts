import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { existsSync, readFileSync } from "./file-kit.ts";

import { runPageMotionFreezeControl } from "../src/common/page-motion-freeze-control.js";

test("page motion bridge is not bootstrapped by the content loader", () => {
  const source = readFileSync(new URL("../src/entrypoints/content-loader.content.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /page-motion-freeze/i);
  assert.doesNotMatch(source, /unfluffify-page-motion-freeze-script/);
  assert.doesNotMatch(source, /ensurePageMotionFreezeBootstrapScript/);
});

test("content core uses page-world relay with background fallback", () => {
  const source = readFileSync(new URL("../src/content/core.ts", import.meta.url), "utf8");

  assert.match(source, /initializePageWorldRelay/);
  assert.match(source, /requestPageWorldCommand/);
  assert.match(source, /type:\s*"pageMotionFreezeControl"/);
  assert.match(source, /utils\.sendRuntimeMessage\(message\)/);
  assert.match(source, /\.catch\(\(\) => sendPageMotionFreezeControlThroughBackground/);
  assert.doesNotMatch(source, /unfluffify:page-motion-freeze-control:v1/);
  assert.doesNotMatch(source, /common\/page-motion-freeze\.js/);
  assert.doesNotMatch(source, /PAGE_MOTION_PAUSE_SCRIPT_ID/);
});

test("background executes the page motion control function in MAIN world", () => {
  const source = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

  assert.match(source, /import \{ runPageMotionFreezeControl \} from "\.\/common\/page-motion-freeze-control\.js";/);
  assert.match(source, /if \(message\.type === "pageMotionFreezeControl"\) \{/);
  assert.match(source, /browser\.scripting\.executeScript\((?:\{|injection)/);
  assert.match(source, /world:\s*"MAIN"/);
  assert.match(source, /func:\s*runPageMotionFreezeControl/);
  assert.match(source, /pageMotionFreezeControlQueueByTarget/);
  assert.match(source, /getPageMotionFreezeControlTargetKey/);
});

test("page motion control function has no persistent page message listener", () => {
  const source = readFileSync(new URL("../src/common/page-motion-freeze-control.ts", import.meta.url), "utf8");
  const serialized = Function.prototype.toString.call(runPageMotionFreezeControl);

  assert.equal(existsSync(new URL("../src/common/page-motion-freeze.ts", import.meta.url)), false);
  assert.match(source, /export function runPageMotionFreezeControl/);
  assert.match(serialized, /const STATE_KEY = "__unfluffifyPageMotionFreezeState"/);
  assert.match(serialized, /function initTimerBridge/);
  assert.match(serialized, /function initLazyLoadingBridge/);
  assert.doesNotMatch(source, /CONTROL_MARKER/);
  assert.doesNotMatch(source, /unfluffify:page-motion-freeze-control:v1/);
  assert.doesNotMatch(source, /addEventListener\("message"/);
});
