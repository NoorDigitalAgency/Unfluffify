import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import { readFileSync } from "./file-kit.ts";

import { runPageMotionFreezeControl } from "../common/page-motion-freeze-control.js";

const STATE_KEY = "__unfluffifyPageMotionFreezeState";

const bridgeSource = readFileSync(
  new URL("../common/page-motion-freeze-bridge.ts", import.meta.url),
  "utf8"
);
const controlSource = readFileSync(
  new URL("../common/page-motion-freeze-control.ts", import.meta.url),
  "utf8"
);

// Both files must embed an identical runPageMotionFreezeControl so the
// document_start arming (bridge) and the executeScript toggling (control module)
// build the same state shape/version and interoperate on the same window state.
function extractControlBody(source) {
  const startMarker = "const STATE_KEY = \"__unfluffifyPageMotionFreezeState\";";
  const endMarker = "return buildResult();";
  const start = source.indexOf(startMarker);
  const end = source.lastIndexOf(endMarker);
  assert.notEqual(start, -1, "Expected STATE_KEY marker in source");
  assert.notEqual(end, -1, "Expected final return buildResult() in source");
  return source
    .slice(start, end + endMarker.length)
    .replace(/\/\/\s*@ts-(?:ignore|expect-error)[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

test("page-motion-freeze bridge is a classic document_start script that arms on load", () => {
  // Manifest injects the bridge as a classic MAIN-world content script at
  // document_start, so it must not use module syntax.
  assert.doesNotMatch(bridgeSource, /^\s*export\s/m);
  assert.doesNotMatch(bridgeSource, /^\s*import\s/m);
  // Self-installing IIFE that arms the lazy-loading interception immediately.
  assert.match(bridgeSource, /\(function \(\) \{/);
  assert.match(bridgeSource, /runPageMotionFreezeControl\("arm", null\)/);
});

test("page-motion-freeze bridge embeds a control function identical to the module", () => {
  assert.equal(extractControlBody(bridgeSource), extractControlBody(controlSource));
});

test("page-motion-freeze bridge registered at document_start in the MAIN world", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../manifest.json", import.meta.url), "utf8")
  );
  const bridgeEntry = (manifest.content_scripts || []).find(
    (entry) => Array.isArray(entry.js) && entry.js.includes("common/page-motion-freeze-bridge.js")
  );
  assert.ok(bridgeEntry, "Expected a content_scripts entry for the bridge");
  assert.equal(bridgeEntry.run_at, "document_start");
  assert.equal(bridgeEntry.world, "MAIN");
  assert.equal(bridgeEntry.all_frames, true);
});

function createObserverWindow() {
  const listeners = new Map();
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    __trigger(entries = []) {
      if (typeof this.callback === "function") {
        this.callback(entries, this);
      }
    }
  }
  const documentObject = {
    addEventListener() {},
    removeEventListener() {}
  };
  const windowObject = {
    setTimeout: (cb) => cb,
    clearTimeout() {},
    setInterval: (cb) => cb,
    clearInterval() {},
    requestAnimationFrame: (cb) => cb,
    cancelAnimationFrame() {},
    addEventListener(type, listener, options) {
      const entries = listeners.get(type) || [];
      entries.push({ listener, capture: Boolean(options === true || (options && options.capture)) });
      listeners.set(type, entries);
    },
    removeEventListener() {},
    document: documentObject,
    IntersectionObserver: FakeIntersectionObserver
  };
  return { windowObject, documentObject, originalIntersectionObserver: FakeIntersectionObserver };
}

async function withObserverWindow(callback) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const harness = createObserverWindow();
  globalThis.window = harness.windowObject;
  globalThis.document = harness.documentObject;
  try {
    await callback(harness);
  } finally {
    delete harness.windowObject[STATE_KEY];
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

test("document_start arming makes a later suppression toggle stop a pre-existing observer", async () => {
  await withObserverWindow(async ({ windowObject, originalIntersectionObserver }) => {
    // 1. Bridge arms at document_start: the IntersectionObserver constructor is
    //    wrapped before the page creates any observer; suppression stays off.
    // eslint-disable-next-line no-eval
    (0, eval)(bridgeSource);
    const armedState = windowObject[STATE_KEY];
    assert.ok(armedState, "Expected the bridge to create armed state");
    assert.equal(armedState.armed, true);
    assert.equal(armedState.lazyLoadingSuppressed, false);
    assert.notEqual(windowObject.IntersectionObserver, originalIntersectionObserver);

    // 2. The page creates its lazy-load observer AFTER arming but BEFORE the
    //    reveal toggle (this is the real-world ordering the just-in-time
    //    injection used to miss).
    const calls = [];
    const observer = new windowObject.IntersectionObserver(() => calls.push("intersection"));
    observer.__trigger();
    assert.deepEqual(calls, ["intersection"], "Observer should fire while not suppressed");

    // 3. Reveal flips suppression via the executeScript control path. Because the
    //    observer was wrapped at creation time, the already-created observer is
    //    now suppressed - no extra lazy loads while scrolling.
    const result = runPageMotionFreezeControl("setLazyLoadingSuppressed", { suppressed: true });
    assert.equal(result.lazyLoadingSuppressed, true);
    observer.__trigger();
    assert.deepEqual(calls, ["intersection"], "Pre-existing observer must be suppressed after toggle");

    // 4. Turning suppression back off keeps the armed bridge installed for the
    //    next reveal instead of tearing everything down.
    const restored = runPageMotionFreezeControl("setLazyLoadingSuppressed", { suppressed: false });
    assert.equal(restored.lazyLoadingSuppressed, false);
    assert.ok(windowObject[STATE_KEY], "Armed bridge should persist across reveals");
    assert.equal(windowObject[STATE_KEY].armed, true);
    observer.__trigger();
    assert.deepEqual(calls, ["intersection", "intersection"], "Observer fires again once unsuppressed");
  });
});
