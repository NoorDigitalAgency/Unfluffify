export function runPageMotionFreezeControl(command = "setPaused", details = null) {
  type RuntimeRoot = Window & {
    setTimeout: Window["setTimeout"];
    clearTimeout: Window["clearTimeout"];
    setInterval: Window["setInterval"];
    clearInterval: Window["clearInterval"];
    requestAnimationFrame: Window["requestAnimationFrame"];
    cancelAnimationFrame: Window["cancelAnimationFrame"];
    IntersectionObserver: typeof IntersectionObserver;
    ResizeObserver: typeof ResizeObserver;
  };
  const root = (typeof window !== "undefined" ? window : globalThis) as unknown as RuntimeRoot;
  const STATE_KEY = "__unfluffifyPageMotionFreezeState";
  const VERSION = "main-world-exec-v1";
  const COMMAND_SET_PAUSED = "setPaused";
  const COMMAND_SET_LAZY_LOADING_SUPPRESSED = "setLazyLoadingSuppressed";
  const COMMAND_DESTROY = "destroy";
  const COMMAND_ARM = "arm";
  const LAZY_LOAD_EVENT_TYPES = ["scroll", "wheel", "touchmove"];

  if (!root) {
    return { ok: false, error: "missing-root" };
  }

  const doc = root.document || null;
  const normalizedCommand = typeof command === "string" && command
    ? command
    : COMMAND_SET_PAUSED;

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function getBooleanDetail(name) {
    if (typeof details === "boolean") {
      return Boolean(details);
    }
    if (details && typeof details === "object" && hasOwn(details, name)) {
      return Boolean(details[name]);
    }
    return false;
  }

  function getManagedState() {
    // @ts-expect-error root is runtime-mutable and indexed by internal state key
    const state = root[STATE_KEY];
    return state && typeof state === "object" && state.version === VERSION
      ? state
      : null;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function defineManagedState(state) {
    Object.defineProperty(root, STATE_KEY, {
      value: state,
      configurable: true,
      enumerable: false,
      writable: false
    });
  }

  function createState() {
    return {
      version: VERSION,
      root,
      doc,
      armed: false,
      timerBridgeInitialized: false,
      lazyLoadingBridgeInitialized: false,
      paused: false,
      lazyLoadingSuppressed: false,
      nextDeferredTimerId: -1,
      nextDeferredFrameId: -1000000,
      deferredTimeouts: new Map(),
      deferredFrames: new Map(),
      lazyLoadListenerWrappers: new WeakMap(),
      originalSetTimeout: typeof root.setTimeout === "function" ? root.setTimeout : null,
      originalClearTimeout: typeof root.clearTimeout === "function" ? root.clearTimeout : null,
      originalSetInterval: typeof root.setInterval === "function" ? root.setInterval : null,
      originalClearInterval: typeof root.clearInterval === "function" ? root.clearInterval : null,
      originalRequestAnimationFrame:
        typeof root.requestAnimationFrame === "function" ? root.requestAnimationFrame : null,
      originalCancelAnimationFrame:
        typeof root.cancelAnimationFrame === "function" ? root.cancelAnimationFrame : null,
      originalIntersectionObserver:
        typeof root.IntersectionObserver === "function" ? root.IntersectionObserver : null,
      originalResizeObserver:
        typeof root.ResizeObserver === "function" ? root.ResizeObserver : null,
      originalRootAddEventListener:
        typeof root.addEventListener === "function" ? root.addEventListener : null,
      originalRootRemoveEventListener:
        typeof root.removeEventListener === "function" ? root.removeEventListener : null,
      originalDocumentAddEventListener:
        doc && typeof doc.addEventListener === "function" ? doc.addEventListener : null,
      originalDocumentRemoveEventListener:
        doc && typeof doc.removeEventListener === "function" ? doc.removeEventListener : null
    };
  }

  function getOrCreateState() {
    const existing = getManagedState();
    if (existing) {
      return existing;
    }
    const state = createState();
    defineManagedState(state);
    return state;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function nextTimerId(state) {
    state.nextDeferredTimerId -= 1;
    return state.nextDeferredTimerId;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function nextFrameId(state) {
    state.nextDeferredFrameId -= 1;
    return state.nextDeferredFrameId;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function runCallback(state, callback, args) {
    try {
      callback.apply(state.root, args);
    } catch (error) {
      if (state.originalSetTimeout) {
        state.originalSetTimeout.call(state.root, () => {
          throw error;
        }, 0);
        return;
      }
      throw error;
    }
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function runAnimationFrame(state, callback, timestamp) {
    try {
      callback.call(state.root, timestamp);
    } catch (error) {
      if (state.originalSetTimeout) {
        state.originalSetTimeout.call(state.root, () => {
          throw error;
        }, 0);
        return;
      }
      throw error;
    }
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function deferTimeout(state, callback, args) {
    const id = nextTimerId(state);
    state.deferredTimeouts.set(id, {
      id,
      callback,
      args,
      nativeId: null
    });
    return id;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function scheduleDeferredTimeout(state, record) {
    if (!record || record.nativeId !== null || !state.originalSetTimeout) {
      return;
    }
    record.nativeId = state.originalSetTimeout.call(state.root, () => {
      state.deferredTimeouts.delete(record.id);
      runCallback(state, record.callback, record.args);
    }, 0);
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function deferAnimationFrame(state, callback) {
    const id = nextFrameId(state);
    state.deferredFrames.set(id, {
      id,
      callback,
      nativeId: null
    });
    return id;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function scheduleDeferredFrame(state, record) {
    if (!record || record.nativeId !== null || !state.originalRequestAnimationFrame) {
      return;
    }
    // @ts-expect-error preserve JS-runtime callback signature parity
    record.nativeId = state.originalRequestAnimationFrame.call(state.root, (timestamp) => {
      state.deferredFrames.delete(record.id);
      runAnimationFrame(state, record.callback, timestamp);
    });
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function flushDeferredCallbacks(state) {
    for (const record of Array.from(state.deferredTimeouts.values())) {
      scheduleDeferredTimeout(state, record);
    }
    for (const record of Array.from(state.deferredFrames.values())) {
      scheduleDeferredFrame(state, record);
    }
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function initTimerBridge(state) {
    if (state.timerBridgeInitialized) {
      return true;
    }
    if (state.originalSetTimeout) {
      /**
       * @param {TimerHandler} callback
       * @param {number} [delay]
       * @param {...unknown} args
       */
      // @ts-expect-error preserve JS-runtime signature parity with bridge copy
      const unfluffifySetTimeout = function unfluffifySetTimeout(callback, delay, ...args) {
        if (typeof callback !== "function") {
          return state.originalSetTimeout.call(root, callback, delay, ...args);
        }
        if (state.paused) {
          return deferTimeout(state, callback, args);
        }
        return state.originalSetTimeout.call(root, () => {
          if (state.paused) {
            deferTimeout(state, callback, args);
            return;
          }
          runCallback(state, callback, args);
        }, delay);
      };
      Object.assign(root, {
        setTimeout: /** @type {any} */ (unfluffifySetTimeout)
      });
    }
    if (state.originalClearTimeout) {
      root.clearTimeout = function unfluffifyClearTimeout(id) {
        const record = state.deferredTimeouts.get(id);
        if (record) {
          if (record.nativeId !== null && state.originalClearTimeout) {
            state.originalClearTimeout.call(root, record.nativeId);
          }
          state.deferredTimeouts.delete(id);
          return;
        }
        state.originalClearTimeout.call(root, id);
      };
    }
    if (state.originalSetInterval) {
      /**
       * @param {TimerHandler} callback
       * @param {number} [delay]
       * @param {...unknown} args
       */
      // @ts-expect-error preserve JS-runtime signature parity with bridge copy
      const unfluffifySetInterval = function unfluffifySetInterval(callback, delay, ...args) {
        if (typeof callback !== "function") {
          return state.originalSetInterval.call(root, callback, delay, ...args);
        }
        return state.originalSetInterval.call(root, () => {
          if (state.paused) {
            return;
          }
          runCallback(state, callback, args);
        }, delay);
      };
      root.setInterval = /** @type {typeof root.setInterval} */ (unfluffifySetInterval);
    }
    if (state.originalClearInterval) {
      root.clearInterval = function unfluffifyClearInterval(id) {
        state.originalClearInterval.call(root, id);
      };
    }
    if (state.originalRequestAnimationFrame) {
      root.requestAnimationFrame = function unfluffifyRequestAnimationFrame(callback) {
        if (typeof callback !== "function") {
          return state.originalRequestAnimationFrame.call(root, callback);
        }
        if (state.paused) {
          return deferAnimationFrame(state, callback);
        }
        // @ts-expect-error preserve JS-runtime callback signature parity
        return state.originalRequestAnimationFrame.call(root, (timestamp) => {
          if (state.paused) {
            deferAnimationFrame(state, callback);
            return;
          }
          runAnimationFrame(state, callback, timestamp);
        });
      };
    }
    if (state.originalCancelAnimationFrame) {
      root.cancelAnimationFrame = function unfluffifyCancelAnimationFrame(id) {
        const record = state.deferredFrames.get(id);
        if (record) {
          if (record.nativeId !== null && state.originalCancelAnimationFrame) {
            state.originalCancelAnimationFrame.call(root, record.nativeId);
          }
          state.deferredFrames.delete(id);
          return;
        }
        state.originalCancelAnimationFrame.call(root, id);
      };
    }
    state.timerBridgeInitialized = true;
    if (!state.paused) {
      flushDeferredCallbacks(state);
    }
    return true;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function createObserverConstructor(state, OriginalObserver) {
    if (typeof OriginalObserver !== "function") {
      return OriginalObserver;
    }
    // @ts-expect-error preserve JS-runtime signature parity with bridge copy
    function UnfluffifyObserver(callback, options) {
      const wrappedCallback = typeof callback === "function"
        // @ts-expect-error preserve JS-runtime callback signature parity
        ? (...args) => {
          if (state.lazyLoadingSuppressed) {
            return;
          }
          return callback(...args);
        }
        : callback;
      return Reflect.construct(OriginalObserver, [wrappedCallback, options], new.target || OriginalObserver);
    }
    try {
      Object.defineProperty(UnfluffifyObserver, "name", {
        value: OriginalObserver.name || "UnfluffifyObserver"
      });
    } catch (error) {
      // Function names are cosmetic; bridge behavior does not depend on them.
    }
    UnfluffifyObserver.prototype = OriginalObserver.prototype;
    Object.setPrototypeOf(UnfluffifyObserver, OriginalObserver);
    return UnfluffifyObserver;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function getLazyLoadListenerKey(type, options) {
    return `${type}:${Boolean(options === true || (options && options.capture))}`;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function createWrappedLazyLoadListener(state, listener) {
    if (typeof listener === "function") {
      // @ts-expect-error preserve JS-runtime wrapper signature parity
      return function unfluffifyLazyLoadWrappedListener(...args) {
        if (state.lazyLoadingSuppressed) {
          return;
        }
        // @ts-expect-error this is runtime-bound by event target semantics
        return listener.apply(this, args);
      };
    }
    if (listener && typeof listener.handleEvent === "function") {
      return {
        // @ts-expect-error preserve JS-runtime handler signature parity
        handleEvent(...args) {
          if (state.lazyLoadingSuppressed) {
            return;
          }
          return listener.handleEvent.apply(listener, args);
        }
      };
    }
    return listener;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function getWrappedLazyLoadListener(state, listener, type, options) {
    if (!listener || (typeof listener !== "function" && typeof listener.handleEvent !== "function")) {
      return listener;
    }
    let entry = state.lazyLoadListenerWrappers.get(listener);
    if (!entry) {
      entry = new Map();
      state.lazyLoadListenerWrappers.set(listener, entry);
    }
    const key = getLazyLoadListenerKey(type, options);
    if (!entry.has(key)) {
      entry.set(key, createWrappedLazyLoadListener(state, listener));
    }
    return entry.get(key);
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function wrapLazyLoadEventTarget(state, target, originalAddEventListener, originalRemoveEventListener) {
    if (
      !target ||
      typeof originalAddEventListener !== "function" ||
      typeof originalRemoveEventListener !== "function"
    ) {
      return;
    }
    // @ts-expect-error preserve JS-runtime wrapper signature parity
    target.addEventListener = function unfluffifyAddEventListener(type, listener, options) {
      if (LAZY_LOAD_EVENT_TYPES.includes(type)) {
        return originalAddEventListener.call(
          this,
          type,
          getWrappedLazyLoadListener(state, listener, type, options),
          options
        );
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
    // @ts-expect-error preserve JS-runtime wrapper signature parity
    target.removeEventListener = function unfluffifyRemoveEventListener(type, listener, options) {
      if (LAZY_LOAD_EVENT_TYPES.includes(type)) {
        return originalRemoveEventListener.call(
          this,
          type,
          getWrappedLazyLoadListener(state, listener, type, options),
          options
        );
      }
      return originalRemoveEventListener.call(this, type, listener, options);
    };
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function initLazyLoadingBridge(state) {
    if (state.lazyLoadingBridgeInitialized) {
      return true;
    }
    if (state.originalIntersectionObserver) {
      root.IntersectionObserver = createObserverConstructor(state, state.originalIntersectionObserver);
    }
    if (state.originalResizeObserver) {
      root.ResizeObserver = createObserverConstructor(state, state.originalResizeObserver);
    }
    wrapLazyLoadEventTarget(
      state,
      root,
      state.originalRootAddEventListener,
      state.originalRootRemoveEventListener
    );
    wrapLazyLoadEventTarget(
      state,
      doc,
      state.originalDocumentAddEventListener,
      state.originalDocumentRemoveEventListener
    );
    state.lazyLoadingBridgeInitialized = true;
    return true;
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function restoreTimerBridge(state) {
    if (state.originalSetTimeout) {
      root.setTimeout = state.originalSetTimeout;
    }
    if (state.originalClearTimeout) {
      root.clearTimeout = state.originalClearTimeout;
    }
    if (state.originalSetInterval) {
      root.setInterval = state.originalSetInterval;
    }
    if (state.originalClearInterval) {
      root.clearInterval = state.originalClearInterval;
    }
    if (state.originalRequestAnimationFrame) {
      root.requestAnimationFrame = state.originalRequestAnimationFrame;
    }
    if (state.originalCancelAnimationFrame) {
      root.cancelAnimationFrame = state.originalCancelAnimationFrame;
    }
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function restoreLazyLoadingBridge(state) {
    if (state.originalIntersectionObserver) {
      root.IntersectionObserver = state.originalIntersectionObserver;
    }
    if (state.originalResizeObserver) {
      root.ResizeObserver = state.originalResizeObserver;
    }
    if (state.originalRootAddEventListener) {
      root.addEventListener = state.originalRootAddEventListener;
    }
    if (state.originalRootRemoveEventListener) {
      root.removeEventListener = state.originalRootRemoveEventListener;
    }
    if (doc && state.originalDocumentAddEventListener) {
      doc.addEventListener = state.originalDocumentAddEventListener;
    }
    if (doc && state.originalDocumentRemoveEventListener) {
      doc.removeEventListener = state.originalDocumentRemoveEventListener;
    }
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function destroyState(state) {
    state.paused = false;
    state.lazyLoadingSuppressed = false;
    flushDeferredCallbacks(state);
    restoreTimerBridge(state);
    restoreLazyLoadingBridge(state);
    state.deferredTimeouts.clear();
    state.deferredFrames.clear();
    try {
      // @ts-expect-error root is runtime-mutable and indexed by internal state key
      delete root[STATE_KEY];
    } catch (error) {
      Object.defineProperty(root, STATE_KEY, {
        value: undefined,
        configurable: true,
        enumerable: false,
        writable: true
      });
      // @ts-expect-error root is runtime-mutable and indexed by internal state key
      delete root[STATE_KEY];
    }
  }

  // @ts-expect-error preserve JS-runtime signature parity with bridge copy
  function maybeDestroyInactiveState(state) {
    if (state && !state.armed && !state.paused && !state.lazyLoadingSuppressed) {
      destroyState(state);
    }
  }

  function buildResult() {
    const state = getManagedState();
    return {
      ok: true,
      active: Boolean(state),
      timerBridgeInitialized: Boolean(state && state.timerBridgeInitialized),
      lazyLoadingBridgeInitialized: Boolean(state && state.lazyLoadingBridgeInitialized),
      paused: Boolean(state && state.paused),
      lazyLoadingSuppressed: Boolean(state && state.lazyLoadingSuppressed)
    };
  }

  const shouldPause = getBooleanDetail("paused");
  const shouldSuppress = getBooleanDetail("suppressed");
  const shouldCreateState =
    normalizedCommand === COMMAND_ARM ||
    (normalizedCommand === COMMAND_SET_PAUSED && shouldPause) ||
    (normalizedCommand === COMMAND_SET_LAZY_LOADING_SUPPRESSED && shouldSuppress);
  let state = getManagedState();

  if (!state && !shouldCreateState) {
    return buildResult();
  }

  if (normalizedCommand === COMMAND_DESTROY) {
    if (state) {
      destroyState(state);
    }
    return buildResult();
  }

  state = state || getOrCreateState();
  if (normalizedCommand === COMMAND_ARM) {
    // Install the lazy-loading interception at document_start (before the page
    // creates its observers/scroll listeners) and keep the state alive so a
    // later setLazyLoadingSuppressed toggle takes effect immediately. Timer
    // wrapping stays lazy (installed on the first setPaused) to avoid overhead.
    initLazyLoadingBridge(state);
    state.armed = true;
    return buildResult();
  }
  if (normalizedCommand === COMMAND_SET_PAUSED) {
    if (shouldPause) {
      initTimerBridge(state);
    }
    state.paused = shouldPause;
    if (!shouldPause) {
      flushDeferredCallbacks(state);
    }
    maybeDestroyInactiveState(state);
    return buildResult();
  }

  if (normalizedCommand === COMMAND_SET_LAZY_LOADING_SUPPRESSED) {
    if (shouldSuppress) {
      initLazyLoadingBridge(state);
    }
    state.lazyLoadingSuppressed = shouldSuppress;
    maybeDestroyInactiveState(state);
    return buildResult();
  }

  return buildResult();
}
