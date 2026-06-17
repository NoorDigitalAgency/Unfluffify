// @ts-nocheck
/**
 * @fileoverview Page-world (MAIN) document_start bridge for page-motion freeze.
 *
 * This classic content script is injected at document_start into the page's MAIN
 * world (see manifest.json content_scripts). Running before the page's own
 * scripts lets it install the lazy-loading interception (IntersectionObserver /
 * ResizeObserver constructors and scroll/wheel/touchmove listeners) BEFORE the
 * page creates its lazy-load observers. Wrapping them after the fact (the old
 * just-in-time executeScript injection) was too late, so flipping the suppression
 * flag during reveal had no effect and the page kept lazy-loading on every pass.
 *
 * The bridge only "arms" here (installs the wrappers with the flag off). The
 * actual on/off toggling stays on the deterministic, awaited two-way control
 * path: content (isolated world) -> chrome.runtime -> background ->
 * chrome.scripting.executeScript(runPageMotionFreezeControl) in this same MAIN
 * world. Because the wrappers are already installed, that toggle takes effect
 * immediately and synchronously for every existing observer/listener.
 *
 * IMPORTANT: runPageMotionFreezeControl below must stay byte-identical (modulo
 * the leading `export ` keyword) to common/page-motion-freeze-control.js. The
 * test tests/page-motion-freeze-bridge.test.js enforces this so the document_start
 * arming and the executeScript toggling share an identical state shape/version
 * and therefore interoperate on the same window.__unfluffifyPageMotionFreezeState.
 */

(function () {
  "use strict";

function runPageMotionFreezeControl(command = "setPaused", details = null) {
  const STATE_KEY = "__unfluffifyPageMotionFreezeState";
  const VERSION = "main-world-exec-v1";
  const COMMAND_SET_PAUSED = "setPaused";
  const COMMAND_SET_LAZY_LOADING_SUPPRESSED = "setLazyLoadingSuppressed";
  const COMMAND_DESTROY = "destroy";
  const COMMAND_ARM = "arm";
  const LAZY_LOAD_EVENT_TYPES = ["scroll", "wheel", "touchmove"];
  const root = typeof window !== "undefined" ? window : globalThis;

  if (!root) {
    return { ok: false, error: "missing-root" };
  }

  const doc = root.document || null;
  const normalizedCommand = typeof command === "string" && command
    ? command
    : COMMAND_SET_PAUSED;

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

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
    const state = root[STATE_KEY];
    return state && typeof state === "object" && state.version === VERSION
      ? state
      : null;
  }

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

  function nextTimerId(state) {
    state.nextDeferredTimerId -= 1;
    return state.nextDeferredTimerId;
  }

  function nextFrameId(state) {
    state.nextDeferredFrameId -= 1;
    return state.nextDeferredFrameId;
  }

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

  function scheduleDeferredTimeout(state, record) {
    if (!record || record.nativeId !== null || !state.originalSetTimeout) {
      return;
    }
    record.nativeId = state.originalSetTimeout.call(state.root, () => {
      state.deferredTimeouts.delete(record.id);
      runCallback(state, record.callback, record.args);
    }, 0);
  }

  function deferAnimationFrame(state, callback) {
    const id = nextFrameId(state);
    state.deferredFrames.set(id, {
      id,
      callback,
      nativeId: null
    });
    return id;
  }

  function scheduleDeferredFrame(state, record) {
    if (!record || record.nativeId !== null || !state.originalRequestAnimationFrame) {
      return;
    }
    record.nativeId = state.originalRequestAnimationFrame.call(state.root, (timestamp) => {
      state.deferredFrames.delete(record.id);
      runAnimationFrame(state, record.callback, timestamp);
    });
  }

  function flushDeferredCallbacks(state) {
    for (const record of Array.from(state.deferredTimeouts.values())) {
      scheduleDeferredTimeout(state, record);
    }
    for (const record of Array.from(state.deferredFrames.values())) {
      scheduleDeferredFrame(state, record);
    }
  }

  function initTimerBridge(state) {
    if (state.timerBridgeInitialized) {
      return true;
    }
    if (state.originalSetTimeout) {
      root.setTimeout = function unfluffifySetTimeout(callback, delay, ...args) {
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
      root.setInterval = function unfluffifySetInterval(callback, delay, ...args) {
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

  function createObserverConstructor(state, OriginalObserver) {
    if (typeof OriginalObserver !== "function") {
      return OriginalObserver;
    }
    function UnfluffifyObserver(callback, options) {
      const wrappedCallback = typeof callback === "function"
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

  function getLazyLoadListenerKey(type, options) {
    return `${type}:${Boolean(options === true || (options && options.capture))}`;
  }

  function createWrappedLazyLoadListener(state, listener) {
    if (typeof listener === "function") {
      return function unfluffifyLazyLoadWrappedListener(...args) {
        if (state.lazyLoadingSuppressed) {
          return;
        }
        return listener.apply(this, args);
      };
    }
    if (listener && typeof listener.handleEvent === "function") {
      return {
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

  function wrapLazyLoadEventTarget(state, target, originalAddEventListener, originalRemoveEventListener) {
    if (
      !target ||
      typeof originalAddEventListener !== "function" ||
      typeof originalRemoveEventListener !== "function"
    ) {
      return;
    }
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

  function destroyState(state) {
    state.paused = false;
    state.lazyLoadingSuppressed = false;
    flushDeferredCallbacks(state);
    restoreTimerBridge(state);
    restoreLazyLoadingBridge(state);
    state.deferredTimeouts.clear();
    state.deferredFrames.clear();
    try {
      delete root[STATE_KEY];
    } catch (error) {
      Object.defineProperty(root, STATE_KEY, {
        value: undefined,
        configurable: true,
        enumerable: false,
        writable: true
      });
      delete root[STATE_KEY];
    }
  }

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

  const PAGE_WORLD_RELAY_CHANNEL = "unfluffify:page-world-relay:v1";
  const PAGE_WORLD_RELAY_REQUEST_KIND = "request";
  const PAGE_WORLD_RELAY_RESPONSE_KIND = "response";
  const PAGE_WORLD_RELAY_STATE_KEY = "__unfluffifyPageWorldRelayBridgeState";
  const PAGE_WORLD_COMMAND_ARM = "PAGE_WORLD_ARM";
  const PAGE_WORLD_COMMAND_SET_MOTION_PAUSED = "PAGE_WORLD_SET_MOTION_PAUSED";
  const PAGE_WORLD_COMMAND_SET_LAZY_LOADING_SUPPRESSED = "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED";
  const PAGE_WORLD_COMMAND_DESTROY = "PAGE_WORLD_DESTROY";

  function getRelayBridgeState() {
    if (!window[PAGE_WORLD_RELAY_STATE_KEY] || typeof window[PAGE_WORLD_RELAY_STATE_KEY] !== "object") {
      Object.defineProperty(window, PAGE_WORLD_RELAY_STATE_KEY, {
        value: {
          nonce: ""
        },
        configurable: true,
        enumerable: false,
        writable: false
      });
    }
    return window[PAGE_WORLD_RELAY_STATE_KEY];
  }

  function postRelayResponse(request, response) {
    if (typeof window.postMessage !== "function") {
      return;
    }
    window.postMessage({
      channel: PAGE_WORLD_RELAY_CHANNEL,
      kind: PAGE_WORLD_RELAY_RESPONSE_KIND,
      id: request.id,
      nonce: request.nonce,
      command: request.command,
      ...response
    }, "*");
  }

  function mapRelayCommand(command) {
    if (command === PAGE_WORLD_COMMAND_ARM) {
      return "arm";
    }
    if (command === PAGE_WORLD_COMMAND_SET_MOTION_PAUSED) {
      return "setPaused";
    }
    if (command === PAGE_WORLD_COMMAND_SET_LAZY_LOADING_SUPPRESSED) {
      return "setLazyLoadingSuppressed";
    }
    if (command === PAGE_WORLD_COMMAND_DESTROY) {
      return "destroy";
    }
    return "";
  }

  function handlePageWorldRelayRequest(event) {
    if (!event || event.source !== window) {
      return;
    }
    const request = event.data;
    if (!request || typeof request !== "object") {
      return;
    }
    if (request.channel !== PAGE_WORLD_RELAY_CHANNEL || request.kind !== PAGE_WORLD_RELAY_REQUEST_KIND) {
      return;
    }
    if (typeof request.id !== "string" || !request.id) {
      return;
    }
    if (typeof request.command !== "string" || !request.command) {
      postRelayResponse(request, {
        ok: false,
        code: "invalid_message",
        error: "Missing relay command"
      });
      return;
    }

    const relayState = getRelayBridgeState();
    if (request.command === PAGE_WORLD_COMMAND_ARM) {
      if (typeof request.nonce !== "string" || !request.nonce) {
        postRelayResponse(request, {
          ok: false,
          code: "invalid_message",
          error: "Missing relay nonce"
        });
        return;
      }
      if (relayState.nonce && relayState.nonce !== request.nonce) {
        postRelayResponse(request, {
          ok: false,
          code: "invalid_message",
          error: "Relay already armed with different nonce"
        });
        return;
      }
      relayState.nonce = request.nonce;
    } else if (!relayState.nonce || request.nonce !== relayState.nonce) {
      postRelayResponse(request, {
        ok: false,
        code: "invalid_message",
        error: "Relay nonce mismatch"
      });
      return;
    }

    const mappedCommand = mapRelayCommand(request.command);
    if (!mappedCommand) {
      postRelayResponse(request, {
        ok: false,
        code: "handler_not_found",
        error: `Unknown relay command: ${request.command}`
      });
      return;
    }

    const details = request.payload && typeof request.payload === "object"
      ? request.payload
      : null;
    const result = runPageMotionFreezeControl(mappedCommand, details);
    if (!result || result.ok !== true) {
      postRelayResponse(request, {
        ok: false,
        code: "handler_failed",
        error: (result && result.error) || "Page-world control failed",
        details: result && typeof result === "object" ? result : {}
      });
      return;
    }

    postRelayResponse(request, {
      ok: true,
      result
    });
  }

  try {
    // Arm the lazy-loading interception at document_start so the wrappers are in
    // place before the page creates its own observers/scroll listeners.
    runPageMotionFreezeControl("arm", null);
    if (typeof window.addEventListener === "function") {
      window.addEventListener("message", handlePageWorldRelayRequest, false);
    }
  } catch (error) {
    // Best-effort early arming; the executeScript toggle path still applies the
    // pause/suppression flags if arming did not run for any reason.
  }
}());
