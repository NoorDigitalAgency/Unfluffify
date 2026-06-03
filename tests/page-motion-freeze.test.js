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
    addEventListener(type, listener) {
      if (type === "message") {
        messageListeners.push(listener);
      }
    }
  };

  function runTimeout(id) {
    const record = timeouts.get(id);
    assert.ok(record, `Expected timeout ${id} to be scheduled`);
    timeouts.delete(id);
    record.callback(...record.args);
  }

  return {
    windowObject,
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
    }
  };
}

async function withTimerWindow(callback, { init = true } = {}) {
  const originalWindow = globalThis.window;
  const harness = createTimerWindowHarness();
  globalThis.window = harness.windowObject;
  try {
    importCounter += 1;
    await import(`../common/page-motion-freeze.js?case=${importCounter}`);
    if (init) {
      harness.dispatchControl({ command: "init" });
    }
    await callback(harness);
  } finally {
    globalThis.window = originalWindow;
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