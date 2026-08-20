type PageWorldRequest = Readonly<{
  kind?: string;
  type?: string;
  channel?: string;
  id?: string;
  nonce?: string;
  sessionNonce?: string;
  command?: string;
  payload?: Record<string, unknown>;
}>;

type PageWorldFailure = Readonly<{ code: string; message: string }>;

type PageTimerHandler = string | ((...args: unknown[]) => void);
type PageTimer = (
  | Readonly<{ type: "timeout"; callback: (...args: unknown[]) => void; args: unknown[] }>
  | Readonly<{ type: "raf"; callback: FrameRequestCallback; args: [] }>
) & { cancelled: boolean; nativeId?: unknown };
type PageEventListener = EventListenerOrEventListenerObject;
type PageListenerOptions = boolean | AddEventListenerOptions | undefined;
type WrappedEventRegistration = Readonly<{
  target: EventTarget;
  type: string;
  listener: PageEventListener;
  wrapped: EventListener;
  options: PageListenerOptions;
  capture: boolean;
}>;
type InstrumentedAttachShadow = ((this: Element, init: ShadowRootInit) => ShadowRoot) & {
  __ufClosedShadowInstrumented?: boolean;
};
type PageWorldRoot = Readonly<{
  location: Location;
  history: History;
  document: Document;
  performance: Performance;
  Element?: typeof Element;
  EventTarget?: typeof EventTarget;
}> & {
  setTimeout: (callback: PageTimerHandler, delay?: number, ...args: unknown[]) => unknown;
  clearTimeout: (token: unknown) => void;
  setInterval: (callback: PageTimerHandler, delay?: number, ...args: unknown[]) => unknown;
  clearInterval: (token: unknown) => void;
  requestAnimationFrame: (callback: FrameRequestCallback) => unknown;
  cancelAnimationFrame: (token: unknown) => void;
  IntersectionObserver?: typeof IntersectionObserver;
  ResizeObserver?: typeof ResizeObserver;
  queueMicrotask?: (callback: () => void) => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
  addEventListener: (
    type: string,
    listener: (event: MessageEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ) => void;
};

const page = globalThis as unknown as PageWorldRoot;

(function installPageWorldProgram() {
  const CHANNEL = "uf-page-bus/1";
  const LEGACY_CHANNEL = "unfluffify:page-world-relay:v1";
  const URL_CHANGED_KIND = "uf-page-url-changed/1";
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
  const queued: PageTimer[] = [];
  const originals = {
    setTimeout: page.setTimeout,
    clearTimeout: page.clearTimeout,
    setInterval: page.setInterval,
    clearInterval: page.clearInterval,
    requestAnimationFrame: page.requestAnimationFrame,
    cancelAnimationFrame: page.cancelAnimationFrame,
    IntersectionObserver: page.IntersectionObserver,
    ResizeObserver: page.ResizeObserver,
    attachShadow: page.Element?.prototype.attachShadow as InstrumentedAttachShadow | undefined,
    addEventListener: page.EventTarget?.prototype.addEventListener,
    removeEventListener: page.EventTarget?.prototype.removeEventListener,
  };
  const wrappedEventRegistrations: WrappedEventRegistration[] = [];
  const timeoutTokens = new Map<unknown, PageTimer>();
  const rafTokens = new Map<unknown, PageTimer>();
  let lastKnownUrl = page.location && page.location.href ? String(page.location.href) : "";

  function installClosedShadowInstrumentation() {
    const originalAttachShadow = originals.attachShadow;
    if (!page.Element || typeof originalAttachShadow !== "function") return;
    const current = page.Element.prototype.attachShadow as InstrumentedAttachShadow;
    if (current.__ufClosedShadowInstrumented) return;
    const patched: InstrumentedAttachShadow = function patchedAttachShadow(this: Element, init: ShadowRootInit) {
      if (init && init.mode === "closed") {
        this.setAttribute?.("data-uf-closed-shadow-host", "true");
        // Closed roots created before this hook remain genuinely inaccessible.
        // Roots created after it retain their authored "closed" provenance but
        // are exposed as open so the extension can flatten and mark the same
        // composed content Google WRS can retrieve.
        return originalAttachShadow.call(this, { ...init, mode: "open" });
      }
      return originalAttachShadow.call(this, init);
    };
    patched.__ufClosedShadowInstrumented = true;
    page.Element.prototype.attachShadow = patched;
  }

  function emitUrlChanged() {
    const currentUrl = page.location && page.location.href ? String(page.location.href) : "";
    if (!currentUrl || currentUrl === lastKnownUrl) return;
    const previousUrl = lastKnownUrl;
    lastKnownUrl = currentUrl;
    page.postMessage?.({
      kind: URL_CHANGED_KIND,
      fromUrl: previousUrl,
      toUrl: currentUrl,
    }, "*");
  }

  function installNavigationBridge() {
    if (!page.history) return;
    const patchHistoryMethod = (method: "pushState" | "replaceState"): void => {
      const original = page.history[method];
      if (typeof original !== "function") return;
      const patched = function patchedHistoryMethod(
        this: History,
        ...args: Parameters<History["pushState"]>
      ): void {
        const result = original.apply(this, args);
        if (typeof page.queueMicrotask === "function") {
          page.queueMicrotask(emitUrlChanged);
        } else {
          originals.setTimeout.call(page, emitUrlChanged, 0);
        }
        return result;
      };
      page.history[method] = patched;
    };
    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    page.addEventListener?.("popstate", emitUrlChanged);
    page.addEventListener?.("hashchange", emitUrlChanged);
  }

  function listenerCapture(options: boolean | EventListenerOptions | undefined): boolean {
    return typeof options === "boolean" ? options : Boolean(options && options.capture);
  }

  function listenerOnce(options: PageListenerOptions): boolean {
    return Boolean(options && typeof options === "object" && options.once);
  }

  function installTimerBridge() {
    if (installed) return;
    installed = true;
    page.setTimeout = function patchedSetTimeout(callback, delay, ...args) {
        if (typeof callback !== "function") {
          return originals.setTimeout.call(page, callback, delay, ...args);
        }
        const token: PageTimer = { type: "timeout", callback, args, cancelled: false };
        const nativeId = originals.setTimeout.call(page, () => {
          if (token.cancelled) return;
          if (paused) {
            queued.push(token);
            return;
          }
          timeoutTokens.delete(token.nativeId);
          callback.call(page, ...args);
      }, delay);
        token.nativeId = nativeId;
        timeoutTokens.set(nativeId, token);
        return nativeId;
    };
    page.clearTimeout = function patchedClearTimeout(token) {
        const tracked = timeoutTokens.get(token);
        if (tracked) {
          tracked.cancelled = true;
          timeoutTokens.delete(token);
          originals.clearTimeout.call(page, token);
        return;
        }
      return originals.clearTimeout.call(page, token);
    };
    page.setInterval = function patchedSetInterval(callback, delay, ...args) {
      if (typeof callback !== "function") {
        return originals.setInterval.call(page, callback, delay, ...args);
      }
      return originals.setInterval.call(page, function intervalGate() {
        if (!paused) callback.call(page, ...args);
      }, delay);
    };
    page.clearInterval = function patchedClearInterval(token) {
      return originals.clearInterval.call(page, token);
    };
    page.requestAnimationFrame = function patchedRequestAnimationFrame(callback) {
      if (typeof callback !== "function") {
        return originals.requestAnimationFrame.call(page, callback);
      }
      const token: PageTimer = { type: "raf", callback, args: [], cancelled: false };
      const schedule = originals.requestAnimationFrame || originals.setTimeout;
      const nativeId = schedule.call(page, (now) => {
        if (token.cancelled) return;
        if (paused) {
          queued.push(token);
          return;
        }
        rafTokens.delete(token.nativeId);
        callback.call(page, now);
      });
      token.nativeId = nativeId;
      rafTokens.set(nativeId, token);
      return nativeId;
    };
    page.cancelAnimationFrame = function patchedCancelAnimationFrame(token) {
      const tracked = rafTokens.get(token);
      if (tracked) {
        tracked.cancelled = true;
        rafTokens.delete(token);
        originals.cancelAnimationFrame?.call(page, token);
        return;
      }
      return originals.cancelAnimationFrame?.call(page, token);
    };
    if (originals.IntersectionObserver) {
      const PatchedIntersectionObserver = function PatchedIntersectionObserver(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        return Reflect.construct(originals.IntersectionObserver!, [(entries: IntersectionObserverEntry[], observer: IntersectionObserver) => {
          if (!lazySuppressed) callback(entries, observer);
        }, options], new.target || PatchedIntersectionObserver);
      } as unknown as typeof IntersectionObserver;
      page.IntersectionObserver = PatchedIntersectionObserver;
      page.IntersectionObserver.prototype = originals.IntersectionObserver.prototype;
      Object.setPrototypeOf(page.IntersectionObserver, originals.IntersectionObserver);
    }
    if (originals.ResizeObserver) {
      const PatchedResizeObserver = function PatchedResizeObserver(callback: ResizeObserverCallback) {
        return Reflect.construct(originals.ResizeObserver!, [(entries: ResizeObserverEntry[], observer: ResizeObserver) => {
          if (!lazySuppressed) callback(entries, observer);
        }], new.target || PatchedResizeObserver);
      } as unknown as typeof ResizeObserver;
      page.ResizeObserver = PatchedResizeObserver;
      page.ResizeObserver.prototype = originals.ResizeObserver.prototype;
      Object.setPrototypeOf(page.ResizeObserver, originals.ResizeObserver);
    }
    const originalAddEventListener = originals.addEventListener;
    const originalRemoveEventListener = originals.removeEventListener;
    if (page.EventTarget && originalAddEventListener && originalRemoveEventListener) {
      page.EventTarget.prototype.addEventListener = function patchedAddEventListener(
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        const isLazyEvent = ["scroll", "wheel", "touchmove"].includes(String(type));
        const callable = typeof listener === "function" || (listener && typeof listener.handleEvent === "function");
        if (!isLazyEvent || !callable || !listener) {
          return originalAddEventListener.call(this, type, listener, options);
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
        const wrapped = function lazySuppressionGate(this: EventTarget, event: Event): void {
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
        return originalAddEventListener.call(this, type, wrapped, options);
      };
      page.EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        const wrapped = removeWrappedRegistration(this, type, listener, listenerCapture(options));
        return originalRemoveEventListener.call(this, type, wrapped || listener, options);
      };
    }
  }

  function removeWrappedRegistration(
    target: EventTarget,
    type: string,
    listener: PageEventListener | null,
    capture: boolean,
  ): EventListener | null {
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
    page.setTimeout = originals.setTimeout;
    page.clearTimeout = originals.clearTimeout;
    page.setInterval = originals.setInterval;
    page.clearInterval = originals.clearInterval;
    page.requestAnimationFrame = originals.requestAnimationFrame;
    page.cancelAnimationFrame = originals.cancelAnimationFrame;
    page.IntersectionObserver = originals.IntersectionObserver;
    page.ResizeObserver = originals.ResizeObserver;
    while (wrappedEventRegistrations.length > 0) {
      const registration = wrappedEventRegistrations.pop();
      if (!registration) {
        break;
      }
      originals.removeEventListener?.call(registration.target, registration.type, registration.wrapped, registration.options);
      originals.addEventListener?.call(registration.target, registration.type, registration.listener, registration.options);
    }
    if (page.EventTarget && originals.addEventListener && originals.removeEventListener) {
      page.EventTarget.prototype.addEventListener = originals.addEventListener;
      page.EventTarget.prototype.removeEventListener = originals.removeEventListener;
    }
    installed = false;
    paused = false;
    lazySuppressed = false;
    timeoutTokens.clear();
    rafTokens.clear();
    if (page.document && page.document.documentElement) {
      page.document.documentElement.toggleAttribute("data-uf-lazy-loading-suppressed", false);
    }
    queued.length = 0;
  }

  function flushQueued() {
    const pending = queued.splice(0);
    originals.setTimeout.call(page, () => {
      for (const item of pending) {
        if (item.cancelled) continue;
        try {
          if (item.type === "raf") {
            rafTokens.delete(item.nativeId);
            item.callback.call(page, performance.now());
          } else {
            timeoutTokens.delete(item.nativeId);
            item.callback.call(page, ...item.args);
          }
        } catch (error) {
          originals.setTimeout.call(page, () => { throw error; }, 0);
        }
      }
    }, 0);
  }

  function normalizeCommand(command: string | undefined): string | undefined {
    if (command === "PAGE_WORLD_ARM") return "ARM";
    if (command === "PAGE_WORLD_SET_MOTION_PAUSED") return "SET_MOTION_PAUSED";
    if (command === "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED") return "SET_LAZY_LOADING_SUPPRESSED";
    if (command === "PAGE_WORLD_DESTROY") return "DESTROY";
    return command;
  }

  function reply(
    source: Pick<PageWorldRoot, "postMessage">,
    request: PageWorldRequest,
    ok: boolean,
    payload: unknown,
    failure?: PageWorldFailure,
  ): void {
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
  installNavigationBridge();
  installClosedShadowInstrumentation();

  page.addEventListener("message", (event: MessageEvent) => {
    const request = event.data as PageWorldRequest | null;
    if (event.source as unknown !== globalThis) {
      return;
    }
    if (!request || !(
      request.kind === CHANNEL && request.type === "request" ||
      request.channel === LEGACY_CHANNEL && request.kind === "request"
    )) {
      return;
    }
    const command = normalizeCommand(request.command);
    if (!ALLOWED.has(request.command ?? "")) {
      reply(page, request, false, null, {
        code: "PAGE_COMMAND_REJECTED",
        message: "Unsupported page-world command",
      });
      return;
    }
    if (typeof request.nonce !== "string" || request.nonce.length === 0) {
      reply(page, request, false, null, {
        code: "PAGE_NONCE_REQUIRED",
        message: "Page-world command requires a nonce",
      });
      return;
    }
    const requestSessionNonce = request.channel === LEGACY_CHANNEL ? request.nonce : request.sessionNonce;
    if (command === "ARM") {
      if (armed && request.nonce !== sessionNonce) {
        reply(page, request, false, null, {
          code: "PAGE_NONCE_MISMATCH",
          message: "Page-world command nonce did not match the armed session",
        });
        return;
      }
      armed = true;
      sessionNonce = request.nonce;
      installTimerBridge();
    } else if (!armed || requestSessionNonce !== sessionNonce) {
      reply(page, request, false, null, {
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
      if (page.document && page.document.documentElement) {
        page.document.documentElement.toggleAttribute("data-uf-lazy-loading-suppressed", lazySuppressed);
      }
    }
    if (command === "DESTROY") {
      armed = false;
      sessionNonce = "";
      paused = false;
      lazySuppressed = false;
      if (page.document && page.document.documentElement) {
        page.document.documentElement.toggleAttribute("data-uf-lazy-loading-suppressed", false);
      }
      flushQueued();
      restoreTimerBridge();
    }
    reply(page, request, true, { armed, paused, lazySuppressed });
  });
}());
