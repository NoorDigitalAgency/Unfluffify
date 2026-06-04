import test from "node:test";
import assert from "node:assert/strict";

const CONTROL_MARKER = "unfluffify:page-motion-freeze-control:v1";

let importCounter = 0;

function createTimerWindowHarness() {
  let nextTimeoutId = 1;
  let nextIntervalId = 1000;
  let nextFrameId = 2000;
  const timeouts = new Map();
  const intervals = new Map();
  const frames = new Map();
  const messageListeners = [];
  const listenerTargets = new Map();

  function createEventTarget(name) {
    const listeners = new Map();
    listenerTargets.set(name, listeners);
    return {
      addEventListener(type, listener, options) {
        if (typeof listener !== "function") {
          return;
        }
        const entries = listeners.get(type) || [];
        entries.push({ listener, capture: Boolean(options === true || (options && options.capture)) });
        listeners.set(type, entries);
        if (name === "window" && type === "message") {
          messageListeners.push(listener);
        }
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
    listeners.forEach((entry) => entry.listener.call(targetName === "window" ? windowObject : documentObject, event));
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
    get timeoutCount() {
      return timeouts.size;
    },
    get frameCount() {
      return frames.size;
    },
    dispatchControl(controlOrPaused) {
      const control = typeof controlOrPaused === "object" && controlOrPaused !== null
        ? controlOrPaused
        : { command: "setPaused", paused: controlOrPaused };
      const event = {
        source: windowObject,
        data: {
          __unfluffifyPageMotionFreeze: CONTROL_MARKER,
          command: typeof control.command === "string" ? control.command : "setPaused",
          ...(Object.prototype.hasOwnProperty.call(control, "paused")
            ? { paused: control.paused }
            : {})
        }
      };
      messageListeners.forEach((listener) => listener(event));
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

async function withTimerWindow(callback, { init = true } = {}) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const harness = createTimerWindowHarness();
  globalThis.window = harness.windowObject;
  globalThis.document = harness.documentObject;
  try {
    importCounter += 1;
    await import(`../common/page-motion-freeze.js?case=${importCounter}`);
    if (init) {
      harness.dispatchControl({ command: "init" });
    }
    await callback(harness);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

test("page motion freeze ignores setPaused commands before init", async () => {
  await withTimerWindow(async ({ windowObject, dispatchControl, runTimeout }) => {
    const calls = [];
    const timerId = windowObject.setTimeout(() => calls.push("timeout"), 25);

    dispatchControl(true);
    runTimeout(timerId);

    assert.deepEqual(calls, ["timeout"]);
  }, { init: false });
});

test("page motion freeze defers timeout callbacks that become due while paused", async () => {
  await withTimerWindow(async ({ windowObject, dispatchControl, runTimeout, runNextTimeout }) => {
    const calls = [];
    const timerId = windowObject.setTimeout(() => calls.push("timeout"), 25);

    dispatchControl(true);
    runTimeout(timerId);

    assert.deepEqual(calls, []);

    dispatchControl(false);
    runNextTimeout();

    assert.deepEqual(calls, ["timeout"]);
  });
});

test("page motion freeze defers newly scheduled timeouts and animation frames while paused", async () => {
  await withTimerWindow(async ({ windowObject, dispatchControl, runNextTimeout, runNextFrame }) => {
    const calls = [];
    dispatchControl(true);

    windowObject.setTimeout(() => calls.push("timeout"), 25);
    windowObject.requestAnimationFrame((timestamp) => calls.push(`frame:${timestamp}`));

    assert.deepEqual(calls, []);

    dispatchControl(false);
    runNextTimeout();
    runNextFrame(456);

    assert.deepEqual(calls, ["timeout", "frame:456"]);
  });
});

test("page motion freeze lets deferred timer and frame callbacks be cancelled", async () => {
  await withTimerWindow(async ({ windowObject, dispatchControl, timeoutCount, frameCount }) => {
    const calls = [];
    dispatchControl(true);

    const timeoutId = windowObject.setTimeout(() => calls.push("timeout"), 25);
    const frameId = windowObject.requestAnimationFrame(() => calls.push("frame"));
    windowObject.clearTimeout(timeoutId);
    windowObject.cancelAnimationFrame(frameId);
    dispatchControl(false);

    assert.equal(timeoutCount, 0);
    assert.equal(frameCount, 0);
    assert.deepEqual(calls, []);
  });
});

test("page motion freeze skips interval ticks only while paused", async () => {
  await withTimerWindow(async ({ windowObject, dispatchControl, runInterval }) => {
    const calls = [];
    const intervalId = windowObject.setInterval(() => calls.push("interval"), 50);

    dispatchControl(true);
    runInterval(intervalId);
    assert.deepEqual(calls, []);

    dispatchControl(false);
    runInterval(intervalId);
    assert.deepEqual(calls, ["interval"]);
  });
});

test("page motion freeze can suppress and restore lazy-load listeners and future observers", async () => {
  await withTimerWindow(async ({ windowObject, dispatchEvent }) => {
    const freezeState = windowObject.__unfluffifyPageMotionFreezeState;
    const calls = [];
    const observer = new windowObject.IntersectionObserver(() => calls.push("intersection"));
    const resizeObserver = new windowObject.ResizeObserver(() => calls.push("resize"));
    windowObject.addEventListener("scroll", () => calls.push("scroll"));
    windowObject.addEventListener("wheel", () => calls.push("wheel"));

    freezeState.setLazyLoadingSuppressed(true);

    observer.__trigger();
    resizeObserver.__trigger();
    dispatchEvent("window", "scroll");
    dispatchEvent("window", "wheel");

    assert.equal(freezeState.isLazyLoadingSuppressed(), true);
    assert.deepEqual(calls, []);

    freezeState.setLazyLoadingSuppressed(false);

    observer.__trigger();
    resizeObserver.__trigger();
    dispatchEvent("window", "scroll");
    dispatchEvent("window", "wheel");

    assert.equal(freezeState.isLazyLoadingSuppressed(), false);
    assert.deepEqual(calls, ["intersection", "resize", "scroll", "wheel"]);
  });
});