(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  if (!root) {
    return;
  }

  const STATE_KEY = "__unfluffifyPageMotionFreezeState";
  const CONTROL_MARKER = "unfluffify:page-motion-freeze-control:v1";

  if (root[STATE_KEY] && typeof root[STATE_KEY].setPaused === "function") {
    return;
  }

  const originalSetTimeout = typeof root.setTimeout === "function" ? root.setTimeout.bind(root) : null;
  const originalClearTimeout = typeof root.clearTimeout === "function" ? root.clearTimeout.bind(root) : null;
  const originalSetInterval = typeof root.setInterval === "function" ? root.setInterval.bind(root) : null;
  const originalClearInterval = typeof root.clearInterval === "function" ? root.clearInterval.bind(root) : null;
  const originalRequestAnimationFrame = typeof root.requestAnimationFrame === "function"
    ? root.requestAnimationFrame.bind(root)
    : null;
  const originalCancelAnimationFrame = typeof root.cancelAnimationFrame === "function"
    ? root.cancelAnimationFrame.bind(root)
    : null;

  let paused = false;
  let nextDeferredTimerId = -1;
  let nextDeferredFrameId = -1000000;
  const deferredTimeouts = new Map();
  const deferredFrames = new Map();

  function nextTimerId() {
    nextDeferredTimerId -= 1;
    return nextDeferredTimerId;
  }

  function nextFrameId() {
    nextDeferredFrameId -= 1;
    return nextDeferredFrameId;
  }

  function runCallback(callback, args) {
    try {
      callback.apply(root, args);
    } catch (error) {
      originalSetTimeout(() => {
        throw error;
      }, 0);
    }
  }

  function runAnimationFrame(callback, timestamp) {
    try {
      callback.call(root, timestamp);
    } catch (error) {
      originalSetTimeout(() => {
        throw error;
      }, 0);
    }
  }

  function deferTimeout(callback, args) {
    const id = nextTimerId();
    deferredTimeouts.set(id, {
      id,
      callback,
      args,
      nativeId: null
    });
    return id;
  }

  function scheduleDeferredTimeout(record) {
    if (!record || record.nativeId !== null || !originalSetTimeout) {
      return;
    }
    record.nativeId = originalSetTimeout(() => {
      deferredTimeouts.delete(record.id);
      runCallback(record.callback, record.args);
    }, 0);
  }

  function deferAnimationFrame(callback) {
    const id = nextFrameId();
    deferredFrames.set(id, {
      id,
      callback,
      nativeId: null
    });
    return id;
  }

  function scheduleDeferredFrame(record) {
    if (!record || record.nativeId !== null || !originalRequestAnimationFrame) {
      return;
    }
    record.nativeId = originalRequestAnimationFrame((timestamp) => {
      deferredFrames.delete(record.id);
      runAnimationFrame(record.callback, timestamp);
    });
  }

  function flushDeferredCallbacks() {
    for (const record of Array.from(deferredTimeouts.values())) {
      scheduleDeferredTimeout(record);
    }
    for (const record of Array.from(deferredFrames.values())) {
      scheduleDeferredFrame(record);
    }
  }

  function setPaused(nextPaused) {
    const shouldPause = Boolean(nextPaused);
    if (paused === shouldPause) {
      return;
    }
    paused = shouldPause;
    if (!paused) {
      flushDeferredCallbacks();
    }
  }

  if (originalSetTimeout) {
    root.setTimeout = function unfluffifySetTimeout(callback, delay, ...args) {
      if (typeof callback !== "function") {
        return originalSetTimeout(callback, delay, ...args);
      }
      if (paused) {
        return deferTimeout(callback, args);
      }
      return originalSetTimeout(() => {
        if (paused) {
          deferTimeout(callback, args);
          return;
        }
        runCallback(callback, args);
      }, delay);
    };
  }

  if (originalClearTimeout) {
    root.clearTimeout = function unfluffifyClearTimeout(id) {
      const record = deferredTimeouts.get(id);
      if (record) {
        if (record.nativeId !== null && originalClearTimeout) {
          originalClearTimeout(record.nativeId);
        }
        deferredTimeouts.delete(id);
        return;
      }
      originalClearTimeout(id);
    };
  }

  if (originalSetInterval) {
    root.setInterval = function unfluffifySetInterval(callback, delay, ...args) {
      if (typeof callback !== "function") {
        return originalSetInterval(callback, delay, ...args);
      }
      return originalSetInterval(() => {
        if (paused) {
          return;
        }
        runCallback(callback, args);
      }, delay);
    };
  }

  if (originalClearInterval) {
    root.clearInterval = function unfluffifyClearInterval(id) {
      originalClearInterval(id);
    };
  }

  if (originalRequestAnimationFrame) {
    root.requestAnimationFrame = function unfluffifyRequestAnimationFrame(callback) {
      if (typeof callback !== "function") {
        return originalRequestAnimationFrame(callback);
      }
      if (paused) {
        return deferAnimationFrame(callback);
      }
      return originalRequestAnimationFrame((timestamp) => {
        if (paused) {
          deferAnimationFrame(callback);
          return;
        }
        runAnimationFrame(callback, timestamp);
      });
    };
  }

  if (originalCancelAnimationFrame) {
    root.cancelAnimationFrame = function unfluffifyCancelAnimationFrame(id) {
      const record = deferredFrames.get(id);
      if (record) {
        if (record.nativeId !== null && originalCancelAnimationFrame) {
          originalCancelAnimationFrame(record.nativeId);
        }
        deferredFrames.delete(id);
        return;
      }
      originalCancelAnimationFrame(id);
    };
  }

  function handleControlMessage(event) {
    if (!event || event.source !== root) {
      return;
    }
    const data = event.data && typeof event.data === "object" ? event.data : null;
    if (!data || data.__unfluffifyPageMotionFreeze !== CONTROL_MARKER) {
      return;
    }
    setPaused(Boolean(data.paused));
  }

  root[STATE_KEY] = {
    setPaused,
    isPaused: () => paused
  };

  if (typeof root.addEventListener === "function") {
    root.addEventListener("message", handleControlMessage);
  }
}());