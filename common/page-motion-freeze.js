(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  if (!root) {
    return;
  }
  const doc = root.document || null;

  const STATE_KEY = "__unfluffifyPageMotionFreezeState";
  const CONTROL_MARKER = "unfluffify:page-motion-freeze-control:v1";
  const COMMAND_INIT = "init";
  const COMMAND_SET_PAUSED = "setPaused";
  const COMMAND_SET_LAZY_LOADING_SUPPRESSED = "setLazyLoadingSuppressed";
  const LAZY_LOAD_EVENT_TYPES = ["scroll", "wheel", "touchmove"];

  if (
    root[STATE_KEY] &&
    typeof root[STATE_KEY].setPaused === "function" &&
    typeof root[STATE_KEY].init === "function" &&
    typeof root[STATE_KEY].setLazyLoadingSuppressed === "function"
  ) {
    return;
  }

  let originalSetTimeout = null;
  let originalClearTimeout = null;
  let originalSetInterval = null;
  let originalClearInterval = null;
  let originalRequestAnimationFrame = null;
  let originalCancelAnimationFrame = null;
  let originalIntersectionObserver = null;
  let originalResizeObserver = null;
  let originalRootAddEventListener = null;
  let originalRootRemoveEventListener = null;
  let originalDocumentAddEventListener = null;
  let originalDocumentRemoveEventListener = null;

  let paused = false;
  let initialized = false;
  let lazyLoadingBridgeInitialized = false;
  let lazyLoadingSuppressed = false;
  let nextDeferredTimerId = -1;
  let nextDeferredFrameId = -1000000;
  const deferredTimeouts = new Map();
  const deferredFrames = new Map();
  const lazyLoadListenerWrappers = new WeakMap();

  function createObserverConstructor(OriginalObserver) {
    if (typeof OriginalObserver !== "function") {
      return OriginalObserver;
    }
    function UnfluffifyObserver(callback, options) {
      const wrappedCallback = typeof callback === "function"
        ? (...args) => {
          if (lazyLoadingSuppressed) {
            return;
          }
          return callback(...args);
        }
        : callback;
      return Reflect.construct(OriginalObserver, [wrappedCallback, options], new.target || OriginalObserver);
    }
    Object.defineProperty(UnfluffifyObserver, "name", {
      value: OriginalObserver.name || "UnfluffifyObserver"
    });
    UnfluffifyObserver.prototype = OriginalObserver.prototype;
    Object.setPrototypeOf(UnfluffifyObserver, OriginalObserver);
    return UnfluffifyObserver;
  }

  function forEachLazyLoadEventTarget(callback) {
    if (typeof callback !== "function") {
      return;
    }
    callback(root);
    if (doc && doc !== root) {
      callback(doc);
    }
  }

  function getLazyLoadListenerKey(type, options) {
    return `${type}:${Boolean(options === true || (options && options.capture))}`;
  }

  function createWrappedLazyLoadListener(listener) {
    if (typeof listener === "function") {
      return function unfluffifyLazyLoadWrappedListener(...args) {
        if (lazyLoadingSuppressed) {
          return;
        }
        return listener.apply(this, args);
      };
    }
    if (listener && typeof listener.handleEvent === "function") {
      return {
        handleEvent(...args) {
          if (lazyLoadingSuppressed) {
            return;
          }
          return listener.handleEvent.apply(listener, args);
        }
      };
    }
    return listener;
  }

  function getWrappedLazyLoadListener(listener, type, options) {
    if (!listener || (typeof listener !== "function" && typeof listener.handleEvent !== "function")) {
      return listener;
    }
    let entry = lazyLoadListenerWrappers.get(listener);
    if (!entry) {
      entry = new Map();
      lazyLoadListenerWrappers.set(listener, entry);
    }
    const key = getLazyLoadListenerKey(type, options);
    if (!entry.has(key)) {
      entry.set(key, createWrappedLazyLoadListener(listener));
    }
    return entry.get(key);
  }

  function wrapLazyLoadEventTarget(target, originalAddEventListener, originalRemoveEventListener) {
    if (
      !target ||
      typeof originalAddEventListener !== "function" ||
      typeof originalRemoveEventListener !== "function"
    ) {
      return;
    }
    target.addEventListener = function unfluffifyAddEventListener(type, listener, options) {
      if (LAZY_LOAD_EVENT_TYPES.includes(type)) {
        const wrappedListener = getWrappedLazyLoadListener(listener, type, options);
        return originalAddEventListener.call(this, type, wrappedListener, options);
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
    target.removeEventListener = function unfluffifyRemoveEventListener(type, listener, options) {
      if (LAZY_LOAD_EVENT_TYPES.includes(type)) {
        const wrappedListener = getWrappedLazyLoadListener(listener, type, options);
        return originalRemoveEventListener.call(this, type, wrappedListener, options);
      }
      return originalRemoveEventListener.call(this, type, listener, options);
    };
  }

  function initLazyLoadingBridge() {
    if (lazyLoadingBridgeInitialized) {
      return true;
    }
    originalIntersectionObserver = root.IntersectionObserver;
    originalResizeObserver = root.ResizeObserver;
    originalRootAddEventListener = typeof root.addEventListener === "function"
      ? root.addEventListener
      : null;
    originalRootRemoveEventListener = typeof root.removeEventListener === "function"
      ? root.removeEventListener
      : null;
    originalDocumentAddEventListener = doc && typeof doc.addEventListener === "function"
      ? doc.addEventListener
      : null;
    originalDocumentRemoveEventListener = doc && typeof doc.removeEventListener === "function"
      ? doc.removeEventListener
      : null;
    if (typeof originalIntersectionObserver === "function") {
      root.IntersectionObserver = createObserverConstructor(originalIntersectionObserver);
    }
    if (typeof originalResizeObserver === "function") {
      root.ResizeObserver = createObserverConstructor(originalResizeObserver);
    }
    wrapLazyLoadEventTarget(root, originalRootAddEventListener, originalRootRemoveEventListener);
    wrapLazyLoadEventTarget(doc, originalDocumentAddEventListener, originalDocumentRemoveEventListener);
    lazyLoadingBridgeInitialized = true;
    return true;
  }

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
      if (originalSetTimeout) {
        originalSetTimeout(() => {
          throw error;
        }, 0);
        return;
      }
      throw error;
    }
  }

  function runAnimationFrame(callback, timestamp) {
    try {
      callback.call(root, timestamp);
    } catch (error) {
      if (originalSetTimeout) {
        originalSetTimeout(() => {
          throw error;
        }, 0);
        return;
      }
      throw error;
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
    if (!initialized) {
      return;
    }
    if (!paused) {
      flushDeferredCallbacks();
    }
  }

  function setLazyLoadingSuppressed(nextSuppressed) {
    initLazyLoadingBridge();
    const shouldSuppress = Boolean(nextSuppressed);
    if (lazyLoadingSuppressed === shouldSuppress) {
      return;
    }
    lazyLoadingSuppressed = shouldSuppress;
  }

  function init() {
    if (initialized) {
      return true;
    }

    originalSetTimeout = typeof root.setTimeout === "function" ? root.setTimeout.bind(root) : null;
    originalClearTimeout = typeof root.clearTimeout === "function" ? root.clearTimeout.bind(root) : null;
    originalSetInterval = typeof root.setInterval === "function" ? root.setInterval.bind(root) : null;
    originalClearInterval = typeof root.clearInterval === "function" ? root.clearInterval.bind(root) : null;
    originalRequestAnimationFrame = typeof root.requestAnimationFrame === "function"
      ? root.requestAnimationFrame.bind(root)
      : null;
    originalCancelAnimationFrame = typeof root.cancelAnimationFrame === "function"
      ? root.cancelAnimationFrame.bind(root)
      : null;
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

    initialized = true;
    initLazyLoadingBridge();
    if (!paused) {
      flushDeferredCallbacks();
    }
    return true;
  }

  function handleControlMessage(event) {
    if (!event || event.source !== root) {
      return;
    }
    const data = event.data && typeof event.data === "object" ? event.data : null;
    if (!data || data.__unfluffifyPageMotionFreeze !== CONTROL_MARKER) {
      return;
    }
    const command = typeof data.command === "string" ? data.command : COMMAND_SET_PAUSED;
    if (command === COMMAND_INIT) {
      init();
      if (Object.prototype.hasOwnProperty.call(data, "paused")) {
        setPaused(Boolean(data.paused));
      }
      if (Object.prototype.hasOwnProperty.call(data, "suppressed")) {
        setLazyLoadingSuppressed(Boolean(data.suppressed));
      }
      return;
    }
    if (command === COMMAND_SET_PAUSED) {
      setPaused(Boolean(data.paused));
      return;
    }
    if (command === COMMAND_SET_LAZY_LOADING_SUPPRESSED) {
      setLazyLoadingSuppressed(Boolean(data.suppressed));
    }
  }

  root[STATE_KEY] = {
    init,
    setPaused,
    setLazyLoadingSuppressed,
    isInitialized: () => initialized,
    isPaused: () => paused,
    isLazyLoadingSuppressed: () => lazyLoadingSuppressed
  };

  initLazyLoadingBridge();

  if (typeof root.addEventListener === "function") {
    root.addEventListener("message", handleControlMessage);
  }
}());