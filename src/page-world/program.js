(function () {
  const CHANNEL = "uf-page-bus/1";
  const LEGACY_CHANNEL = "unfluffify:page-world-relay:v1";
  const ALLOWED = new Set([
    "ARM",
    "SET_MOTION_PAUSED",
    "SET_LAZY_LOADING_SUPPRESSED",
    "DESTROY",
    "PAGE_WORLD_ARM",
    "PAGE_WORLD_SET_MOTION_PAUSED",
    "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED",
    "PAGE_WORLD_DESTROY",
  ]);
  let armed = false;
  let sessionNonce = "";
  let installed = false;
  let paused = false;
  let lazySuppressed = false;
  const queued = [];
  const originals = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    IntersectionObserver: globalThis.IntersectionObserver,
    ResizeObserver: globalThis.ResizeObserver,
    addEventListener: globalThis.EventTarget && globalThis.EventTarget.prototype.addEventListener,
    removeEventListener: globalThis.EventTarget && globalThis.EventTarget.prototype.removeEventListener,
  };
  const wrappedEventRegistrations = [];
  const timeoutTokens = new Map();
  const rafTokens = new Map();

  function listenerCapture(options) {
    return typeof options === "boolean" ? options : Boolean(options && options.capture);
  }

  function listenerOnce(options) {
    return Boolean(options && typeof options === "object" && options.once);
  }

  function installTimerBridge() {
    if (installed) return;
    installed = true;
    globalThis.setTimeout = function patchedSetTimeout(callback, delay, ...args) {
        if (typeof callback !== "function") {
          return originals.setTimeout.call(globalThis, callback, delay, ...args);
        }
        const token = { type: "timeout", callback, args, cancelled: false };
        const nativeId = originals.setTimeout.call(globalThis, () => {
          if (token.cancelled) return;
          if (paused) {
            queued.push(token);
            return;
          }
          timeoutTokens.delete(token.nativeId);
          callback.call(globalThis, ...args);
      }, delay);
        token.nativeId = nativeId;
        timeoutTokens.set(nativeId, token);
        return nativeId;
    };
    globalThis.clearTimeout = function patchedClearTimeout(token) {
        const tracked = timeoutTokens.get(token);
        if (tracked) {
          tracked.cancelled = true;
          timeoutTokens.delete(token);
          originals.clearTimeout.call(globalThis, token);
        return;
        }
      return originals.clearTimeout.call(globalThis, token);
    };
    globalThis.setInterval = function patchedSetInterval(callback, delay, ...args) {
      if (typeof callback !== "function") {
        return originals.setInterval.call(globalThis, callback, delay, ...args);
      }
      return originals.setInterval.call(globalThis, function intervalGate() {
        if (!paused) callback.call(globalThis, ...args);
      }, delay);
    };
    globalThis.clearInterval = function patchedClearInterval(token) {
      return originals.clearInterval.call(globalThis, token);
    };
    globalThis.requestAnimationFrame = function patchedRequestAnimationFrame(callback) {
      if (typeof callback !== "function") {
        return originals.requestAnimationFrame.call(globalThis, callback);
      }
      const token = { type: "raf", callback, args: [], cancelled: false };
      const schedule = originals.requestAnimationFrame || originals.setTimeout;
      const nativeId = schedule.call(globalThis, (now) => {
        if (token.cancelled) return;
        if (paused) {
          queued.push(token);
          return;
        }
        rafTokens.delete(token.nativeId);
        callback.call(globalThis, now);
      });
      token.nativeId = nativeId;
      rafTokens.set(nativeId, token);
      return nativeId;
    };
    globalThis.cancelAnimationFrame = function patchedCancelAnimationFrame(token) {
      const tracked = rafTokens.get(token);
      if (tracked) {
        tracked.cancelled = true;
        rafTokens.delete(token);
        originals.cancelAnimationFrame?.call(globalThis, token);
        return;
      }
      return originals.cancelAnimationFrame?.call(globalThis, token);
    };
    if (originals.IntersectionObserver) {
      globalThis.IntersectionObserver = function PatchedIntersectionObserver(callback, options) {
        return Reflect.construct(originals.IntersectionObserver, [(entries, observer) => {
          if (!lazySuppressed) callback(entries, observer);
        }, options], new.target || PatchedIntersectionObserver);
      };
      globalThis.IntersectionObserver.prototype = originals.IntersectionObserver.prototype;
      Object.setPrototypeOf(globalThis.IntersectionObserver, originals.IntersectionObserver);
    }
    if (originals.ResizeObserver) {
      globalThis.ResizeObserver = function PatchedResizeObserver(callback) {
        return Reflect.construct(originals.ResizeObserver, [(entries, observer) => {
          if (!lazySuppressed) callback(entries, observer);
        }], new.target || PatchedResizeObserver);
      };
      globalThis.ResizeObserver.prototype = originals.ResizeObserver.prototype;
      Object.setPrototypeOf(globalThis.ResizeObserver, originals.ResizeObserver);
    }
    if (originals.addEventListener && originals.removeEventListener) {
      globalThis.EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
        const isLazyEvent = ["scroll", "wheel", "touchmove"].includes(String(type));
        const callable = typeof listener === "function" || (listener && typeof listener.handleEvent === "function");
        if (!isLazyEvent || !callable) {
          return originals.addEventListener.call(this, type, listener, options);
        }
        const capture = listenerCapture(options);
        if (wrappedEventRegistrations.some((registration) =>
          registration.target === this &&
          registration.type === type &&
          registration.listener === listener &&
          registration.capture === capture
        )) {
          return undefined;
        }
        const wrapped = function lazySuppressionGate(event) {
            if (listenerOnce(options)) {
              removeWrappedRegistration(this, type, listener, listenerCapture(options));
            }
            if (lazySuppressed) return;
            if (typeof listener === "function") {
            listener.call(this, event);
          } else {
            listener.handleEvent.call(listener, event);
          }
        };
        wrappedEventRegistrations.push({ target: this, type, listener, wrapped, options, capture });
        return originals.addEventListener.call(this, type, wrapped, options);
      };
      globalThis.EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
        const wrapped = removeWrappedRegistration(this, type, listener, listenerCapture(options));
        return originals.removeEventListener.call(this, type, wrapped || listener, options);
      };
    }
  }

  function removeWrappedRegistration(target, type, listener, capture) {
    for (let index = wrappedEventRegistrations.length - 1; index >= 0; index -= 1) {
      const registration = wrappedEventRegistrations[index];
      if (
        registration.target === target &&
        registration.type === type &&
        registration.listener === listener &&
        registration.capture === capture
      ) {
        wrappedEventRegistrations.splice(index, 1);
        return registration.wrapped;
      }
    }
    return null;
  }

  function restoreTimerBridge() {
    if (!installed) return;
    globalThis.setTimeout = originals.setTimeout;
    globalThis.clearTimeout = originals.clearTimeout;
    globalThis.setInterval = originals.setInterval;
    globalThis.clearInterval = originals.clearInterval;
    globalThis.requestAnimationFrame = originals.requestAnimationFrame;
    globalThis.cancelAnimationFrame = originals.cancelAnimationFrame;
    globalThis.IntersectionObserver = originals.IntersectionObserver;
    globalThis.ResizeObserver = originals.ResizeObserver;
    while (wrappedEventRegistrations.length > 0) {
      const registration = wrappedEventRegistrations.pop();
      originals.removeEventListener?.call(registration.target, registration.type, registration.wrapped, registration.options);
      originals.addEventListener?.call(registration.target, registration.type, registration.listener, registration.options);
    }
    if (originals.addEventListener && originals.removeEventListener) {
      globalThis.EventTarget.prototype.addEventListener = originals.addEventListener;
      globalThis.EventTarget.prototype.removeEventListener = originals.removeEventListener;
    }
    installed = false;
    paused = false;
    lazySuppressed = false;
    timeoutTokens.clear();
    rafTokens.clear();
    if (globalThis.document && globalThis.document.documentElement) {
      globalThis.document.documentElement.toggleAttribute("data-uf-lazy-loading-suppressed", false);
    }
    queued.length = 0;
  }

  function flushQueued() {
    const pending = queued.splice(0);
    originals.setTimeout.call(globalThis, () => {
      for (const item of pending) {
        if (item.cancelled) continue;
        try {
          if (item.type === "raf") {
            rafTokens.delete(item.nativeId);
            item.callback.call(globalThis, performance.now());
          } else {
            timeoutTokens.delete(item.nativeId);
            item.callback.call(globalThis, ...item.args);
          }
        } catch (error) {
          originals.setTimeout.call(globalThis, () => { throw error; }, 0);
        }
      }
    }, 0);
  }

  function normalizeCommand(command) {
    if (command === "PAGE_WORLD_ARM") return "ARM";
    if (command === "PAGE_WORLD_SET_MOTION_PAUSED") return "SET_MOTION_PAUSED";
    if (command === "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED") return "SET_LAZY_LOADING_SUPPRESSED";
    if (command === "PAGE_WORLD_DESTROY") return "DESTROY";
    return command;
  }

  function reply(source, request, ok, payload, failure) {
    if (request.channel === LEGACY_CHANNEL) {
      source.postMessage({
        channel: LEGACY_CHANNEL,
        kind: "response",
        id: request.id,
        nonce: request.nonce,
        command: request.command,
        ok,
        result: ok ? payload : undefined,
        code: ok ? undefined : failure && failure.code,
        error: ok ? undefined : failure && failure.message,
        details: ok ? undefined : failure,
      }, "*");
      return;
    }
    source.postMessage({
      kind: CHANNEL,
      type: "response",
      nonce: request.nonce,
      command: request.command,
      ok,
      payload: ok ? payload : null,
      failure: ok ? undefined : failure,
    }, "*");
  }

  installTimerBridge();

  globalThis.addEventListener("message", (event) => {
    const request = event.data;
    if (event.source !== globalThis) {
      return;
    }
    if (!request || !(
      request.kind === CHANNEL && request.type === "request" ||
      request.channel === LEGACY_CHANNEL && request.kind === "request"
    )) {
      return;
    }
    const command = normalizeCommand(request.command);
    if (!ALLOWED.has(request.command)) {
      reply(event.source || globalThis, request, false, null, {
        code: "PAGE_COMMAND_REJECTED",
        message: "Unsupported page-world command",
      });
      return;
    }
    if (typeof request.nonce !== "string" || request.nonce.length === 0) {
      reply(event.source || globalThis, request, false, null, {
        code: "PAGE_NONCE_REQUIRED",
        message: "Page-world command requires a nonce",
      });
      return;
    }
    const requestSessionNonce = request.channel === LEGACY_CHANNEL ? request.nonce : request.sessionNonce;
    if (command === "ARM") {
      if (armed && request.nonce !== sessionNonce) {
        reply(event.source || globalThis, request, false, null, {
          code: "PAGE_NONCE_MISMATCH",
          message: "Page-world command nonce did not match the armed session",
        });
        return;
      }
      armed = true;
      sessionNonce = request.nonce;
      installTimerBridge();
    } else if (!armed || requestSessionNonce !== sessionNonce) {
      reply(event.source || globalThis, request, false, null, {
        code: "PAGE_NONCE_MISMATCH",
        message: "Page-world command session nonce did not match the armed session",
      });
      return;
    }
    if (command === "SET_MOTION_PAUSED") {
      paused = Boolean(request.payload && request.payload.paused);
      if (!paused) flushQueued();
    }
    if (command === "SET_LAZY_LOADING_SUPPRESSED") {
      lazySuppressed = Boolean(request.payload && request.payload.suppressed);
      if (globalThis.document && globalThis.document.documentElement) {
        globalThis.document.documentElement.toggleAttribute("data-uf-lazy-loading-suppressed", lazySuppressed);
      }
    }
    if (command === "DESTROY") {
      armed = false;
      sessionNonce = "";
      paused = false;
      flushQueued();
      restoreTimerBridge();
    }
    reply(event.source || globalThis, request, true, { armed, paused, lazySuppressed }, undefined);
  });
}());
