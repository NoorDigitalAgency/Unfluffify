import test from "node:test";
import assert from "node:assert/strict";

import { runPageMotionFreezeControl } from "../common/page-motion-freeze-control.js";

const STATE_KEY = "__unfluffifyPageMotionFreezeState";

function createTimerWindowHarness() {
  let nextTimeoutId = 1;
  let nextIntervalId = 1000;
  let nextFrameId = 2000;
  const timeouts = new Map();
  const intervals = new Map();
  const frames = new Map();
  const listenerTargets = new Map();

  function createEventTarget(name) {
    const listeners = new Map();
    listenerTargets.set(name, listeners);
    return {
      addEventListener(type, listener, options) {
        if (typeof listener !== "function" && !(listener && typeof listener.handleEvent === "function")) {
          return;
        }
        const entries = listeners.get(type) || [];
        entries.push({ listener, capture: Boolean(options === true || (options && options.capture)) });
        listeners.set(type, entries);
      },
      removeEventListener(type, listener, options) {
        const entries = listeners.get(type) || [];
        const capture = Boolean(options === true || (options && options.capture));
        listeners.set(
          type,
          entries.filter((entry) => entry.listener !== listener || entry.capture !== capture)
        );
      }
    };
  }

  const windowEventTarget = createEventTarget("window");
  const documentObject = createEventTarget("document");
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

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    __trigger(entries = []) {
      if (typeof this.callback === "function") {
        this.callback(entries, this);
      }
    }
  }

  const windowObject = {
    setTimeout(callback, delay, ...args) {
      const id = nextTimeoutId;
      nextTimeoutId += 1;
      timeouts.set(id, { callback, delay, args });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(callback, delay, ...args) {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, { callback, delay, args });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    requestAnimationFrame(callback) {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, { callback });
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    addEventListener: windowEventTarget.addEventListener,
    removeEventListener: windowEventTarget.removeEventListener,
    document: documentObject,
    IntersectionObserver: FakeIntersectionObserver,
    ResizeObserver: FakeResizeObserver
  };
  const originalApis = {
    setTimeout: windowObject.setTimeout,
    clearTimeout: windowObject.clearTimeout,
    setInterval: windowObject.setInterval,
    clearInterval: windowObject.clearInterval,
    requestAnimationFrame: windowObject.requestAnimationFrame,
    cancelAnimationFrame: windowObject.cancelAnimationFrame,
    addEventListener: windowObject.addEventListener,
    removeEventListener: windowObject.removeEventListener,
    documentAddEventListener: documentObject.addEventListener,
    documentRemoveEventListener: documentObject.removeEventListener,
    IntersectionObserver: windowObject.IntersectionObserver,
    ResizeObserver: windowObject.ResizeObserver
  };

  function dispatchEvent(targetName, type) {
    const listeners = Array.from(listenerTargets.get(targetName)?.get(type) || []);
    const event = {
      type,
      stopImmediatePropagationCalls: 0,
      stopPropagationCalls: 0,
      stopImmediatePropagation() {
        this.stopImmediatePropagationCalls += 1;
      },
      stopPropagation() {
        this.stopPropagationCalls += 1;
      }
    };
    listeners.forEach((entry) => {
      if (typeof entry.listener === "function") {
        entry.listener.call(targetName === "window" ? windowObject : documentObject, event);
      } else {
        entry.listener.handleEvent(event);
      }
    });
    return event;
  }

  function runTimeout(id) {
    const record = timeouts.get(id);
    assert.ok(record, `Expected timeout ${id} to be scheduled`);
    timeouts.delete(id);
    record.callback(...record.args);
  }

  return {
    windowObject,
    documentObject,
    originalApis,
    get timeoutCount() {
      return timeouts.size;
    },
    get frameCount() {
      return frames.size;
    },
    runControl(controlOrPaused) {
      const control = typeof controlOrPaused === "object" && controlOrPaused !== null
        ? controlOrPaused
        : { command: "setPaused", paused: controlOrPaused };
      const details = {};
      if (Object.prototype.hasOwnProperty.call(control, "paused")) {
        details.paused = control.paused;
      }
      if (Object.prototype.hasOwnProperty.call(control, "suppressed")) {
        details.suppressed = control.suppressed;
      }
      return runPageMotionFreezeControl(
        typeof control.command === "string" ? control.command : "setPaused",
        details
      );
    },
    runTimeout,
    runNextTimeout() {
      const id = timeouts.keys().next().value;
      assert.notEqual(id, undefined, "Expected a timeout to be scheduled");
      runTimeout(id);
      return id;
    },
    runInterval(id) {
      const record = intervals.get(id);
      assert.ok(record, `Expected interval ${id} to be scheduled`);
      record.callback(...record.args);
    },
    runNextFrame(timestamp = 123) {
      const id = frames.keys().next().value;
      assert.notEqual(id, undefined, "Expected an animation frame to be scheduled");
      const record = frames.get(id);
      frames.delete(id);
      record.callback(timestamp);
      return id;
    },
    dispatchEvent
  };
}

async function withTimerWindow(callback) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const harness = createTimerWindowHarness();
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

test("page motion freeze leaves inactive pages untouched", async () => {
  await withTimerWindow(async ({ windowObject, originalApis, runControl, runTimeout }) => {
    const calls = [];
    const timerId = windowObject.setTimeout(() => calls.push("timeout"), 25);

    const result = runControl({ command: "setPaused", paused: false });
    runTimeout(timerId);

    assert.equal(result.ok, true);
    assert.equal(result.active, false);
    assert.equal(windowObject[STATE_KEY], undefined);
    assert.equal(windowObject.setTimeout, originalApis.setTimeout);
    assert.equal(windowObject.requestAnimationFrame, originalApis.requestAnimationFrame);
    assert.equal(windowObject.IntersectionObserver, originalApis.IntersectionObserver);
    assert.equal(windowObject.addEventListener, originalApis.addEventListener);
    assert.deepEqual(calls, ["timeout"]);
  });
});

test("page motion freeze defers newly scheduled timeouts and animation frames while paused", async () => {
  await withTimerWindow(async ({ windowObject, runControl, runNextTimeout, runNextFrame }) => {
    const calls = [];
    const pauseResult = runControl(true);

    windowObject.setTimeout(() => calls.push("timeout"), 25);
    windowObject.requestAnimationFrame((timestamp) => calls.push(`frame:${timestamp}`));

    assert.equal(pauseResult.active, true);
    assert.equal(pauseResult.paused, true);
    assert.deepEqual(calls, []);

    const resumeResult = runControl(false);
    runNextTimeout();
    runNextFrame(456);

    assert.equal(resumeResult.active, false);
    assert.deepEqual(calls, ["timeout", "frame:456"]);
  });
});

test("page motion freeze lets deferred timer and frame callbacks be cancelled", async () => {
  await withTimerWindow(async ({ windowObject, runControl, timeoutCount, frameCount }) => {
    const calls = [];
    runControl(true);

    const timeoutId = windowObject.setTimeout(() => calls.push("timeout"), 25);
    const frameId = windowObject.requestAnimationFrame(() => calls.push("frame"));
    windowObject.clearTimeout(timeoutId);
    windowObject.cancelAnimationFrame(frameId);
    runControl(false);

    assert.equal(timeoutCount, 0);
    assert.equal(frameCount, 0);
    assert.deepEqual(calls, []);
  });
});

test("page motion freeze skips interval ticks only while paused", async () => {
  await withTimerWindow(async ({ windowObject, runControl, runInterval }) => {
    const calls = [];
    runControl(true);
    const intervalId = windowObject.setInterval(() => calls.push("interval"), 50);

    runInterval(intervalId);
    assert.deepEqual(calls, []);

    runControl(false);
    runInterval(intervalId);
    assert.deepEqual(calls, ["interval"]);
  });
});

test("page motion freeze can suppress and restore lazy-load listeners and future observers", async () => {
  await withTimerWindow(async ({ windowObject, originalApis, runControl, dispatchEvent }) => {
    const calls = [];
    const suppressResult = runControl({ command: "setLazyLoadingSuppressed", suppressed: true });
    const observer = new windowObject.IntersectionObserver(() => calls.push("intersection"));
    const resizeObserver = new windowObject.ResizeObserver(() => calls.push("resize"));
    windowObject.addEventListener("scroll", () => calls.push("scroll"));
    windowObject.addEventListener("wheel", () => calls.push("wheel"));

    observer.__trigger();
    resizeObserver.__trigger();
    dispatchEvent("window", "scroll");
    dispatchEvent("window", "wheel");

    assert.equal(suppressResult.active, true);
    assert.equal(suppressResult.lazyLoadingSuppressed, true);
    assert.deepEqual(calls, []);

    const restoreResult = runControl({ command: "setLazyLoadingSuppressed", suppressed: false });

    observer.__trigger();
    resizeObserver.__trigger();
    dispatchEvent("window", "scroll");
    dispatchEvent("window", "wheel");

    assert.equal(restoreResult.active, false);
    assert.equal(windowObject[STATE_KEY], undefined);
    assert.equal(windowObject.IntersectionObserver, originalApis.IntersectionObserver);
    assert.equal(windowObject.ResizeObserver, originalApis.ResizeObserver);
    assert.equal(windowObject.addEventListener, originalApis.addEventListener);
    assert.equal(windowObject.removeEventListener, originalApis.removeEventListener);
    assert.deepEqual(calls, ["intersection", "resize", "scroll", "wheel"]);
  });
});

test("page motion freeze restores all wrapped APIs when pause and lazy suppression are off", async () => {
  await withTimerWindow(async ({ windowObject, documentObject, originalApis, runControl }) => {
    runControl(true);
    runControl({ command: "setLazyLoadingSuppressed", suppressed: true });

    assert.notEqual(windowObject.setTimeout, originalApis.setTimeout);
    assert.notEqual(windowObject.IntersectionObserver, originalApis.IntersectionObserver);

    runControl(false);
    assert.notEqual(windowObject.setTimeout, originalApis.setTimeout);

    const result = runControl({ command: "setLazyLoadingSuppressed", suppressed: false });

    assert.equal(result.active, false);
    assert.equal(windowObject[STATE_KEY], undefined);
    assert.equal(windowObject.setTimeout, originalApis.setTimeout);
    assert.equal(windowObject.clearTimeout, originalApis.clearTimeout);
    assert.equal(windowObject.setInterval, originalApis.setInterval);
    assert.equal(windowObject.clearInterval, originalApis.clearInterval);
    assert.equal(windowObject.requestAnimationFrame, originalApis.requestAnimationFrame);
    assert.equal(windowObject.cancelAnimationFrame, originalApis.cancelAnimationFrame);
    assert.equal(windowObject.IntersectionObserver, originalApis.IntersectionObserver);
    assert.equal(windowObject.ResizeObserver, originalApis.ResizeObserver);
    assert.equal(windowObject.addEventListener, originalApis.addEventListener);
    assert.equal(windowObject.removeEventListener, originalApis.removeEventListener);
    assert.equal(documentObject.addEventListener, originalApis.documentAddEventListener);
    assert.equal(documentObject.removeEventListener, originalApis.documentRemoveEventListener);
  });
});
