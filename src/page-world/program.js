// GENERATED from src/page-world/program.ts. Run: pnpm page-world:generate
"use strict";
(() => {
  // src/page-world/program.ts
  var page = globalThis;
  (function installPageWorldProgram() {
    const CHANNEL = "uf-page-bus/1";
    const LEGACY_CHANNEL = "unfluffify:page-world-relay:v1";
    const URL_CHANGED_KIND = "uf-page-url-changed/1";
    const ALLOWED = /* @__PURE__ */ new Set([
      "ARM",
      "SET_MOTION_PAUSED",
      "SET_LAZY_LOADING_SUPPRESSED",
      "DESTROY",
      "PAGE_WORLD_ARM",
      "PAGE_WORLD_SET_MOTION_PAUSED",
      "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED",
      "PAGE_WORLD_DESTROY"
    ]);
    let armed = false;
    let sessionNonce = "";
    let installed = false;
    let paused = false;
    let lazySuppressed = false;
    const queued = [];
    const originals = {
      setTimeout: page.setTimeout,
      clearTimeout: page.clearTimeout,
      setInterval: page.setInterval,
      clearInterval: page.clearInterval,
      requestAnimationFrame: page.requestAnimationFrame,
      cancelAnimationFrame: page.cancelAnimationFrame,
      requestIdleCallback: page.requestIdleCallback,
      cancelIdleCallback: page.cancelIdleCallback,
      IntersectionObserver: page.IntersectionObserver,
      ResizeObserver: page.ResizeObserver,
      attachShadow: page.Element?.prototype.attachShadow,
      animate: page.Element?.prototype.animate,
      animationPlay: page.Animation?.prototype.play,
      mediaPlay: page.HTMLMediaElement?.prototype.play,
      addEventListener: page.EventTarget?.prototype.addEventListener,
      removeEventListener: page.EventTarget?.prototype.removeEventListener
    };
    const wrappedEventRegistrations = [];
    const timeoutTokens = /* @__PURE__ */ new Map();
    const rafTokens = /* @__PURE__ */ new Map();
    const idleTokens = /* @__PURE__ */ new Map();
    const pausedAnimations = /* @__PURE__ */ new Set();
    const pausedMedia = /* @__PURE__ */ new Set();
    const pausedSvgRoots = /* @__PURE__ */ new Set();
    const normalizedMotionStyles = [];
    const normalizedProperties = /* @__PURE__ */ new WeakMap();
    let normalizedStyleMutationBudgets = /* @__PURE__ */ new WeakMap();
    const pendingMotionRoots = /* @__PURE__ */ new Set();
    const motionEventCleanups = [];
    let motionStyle = null;
    let motionObserver = null;
    let motionEnforcementScheduled = false;
    let motionFreezeInstalled = false;
    let motionSourceHooksInstalled = false;
    let motionErrorCount = 0;
    let lastKnownUrl = page.location && page.location.href ? String(page.location.href) : "";
    function installClosedShadowInstrumentation() {
      const originalAttachShadow = originals.attachShadow;
      if (!page.Element || typeof originalAttachShadow !== "function") return;
      const current = page.Element.prototype.attachShadow;
      if (current.__ufClosedShadowInstrumented) return;
      const patched = function patchedAttachShadow(init) {
        if (init && init.mode === "closed") {
          this.setAttribute?.("data-uf-closed-shadow-host", "true");
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
        toUrl: currentUrl
      }, "*");
    }
    function installNavigationBridge() {
      if (!page.history) return;
      const patchHistoryMethod = (method) => {
        const original = page.history[method];
        if (typeof original !== "function") return;
        const patched = function patchedHistoryMethod(...args) {
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
    function listenerCapture(options) {
      return typeof options === "boolean" ? options : Boolean(options && options.capture);
    }
    function listenerOnce(options) {
      return Boolean(options && typeof options === "object" && options.once);
    }
    function isExtensionElement(element) {
      return element.getAttribute?.("data-uf-extension-ui") === "true" || Boolean(element.closest?.('[data-uf-extension-ui="true"]'));
    }
    function isSemanticallyHidden(element) {
      let cursor = element;
      while (cursor) {
        if (cursor.hasAttribute?.("hidden") || cursor.hasAttribute?.("inert") || cursor.getAttribute?.("aria-hidden") === "true" || cursor.tagName === "DIALOG" && !cursor.hasAttribute?.("open")) {
          return true;
        }
        if (cursor !== element && cursor.getAttribute?.("aria-expanded") === "false") {
          return true;
        }
        if (cursor.tagName === "DETAILS" && !cursor.hasAttribute?.("open")) {
          const summary = Array.from(cursor.children ?? []).find((child) => child.tagName === "SUMMARY");
          if (element !== summary && !summary?.contains?.(element)) {
            return true;
          }
        }
        cursor = cursor.parentElement;
      }
      return false;
    }
    function rememberMotionStyle(element, property, value) {
      const remembered = normalizedProperties.get(element) ?? /* @__PURE__ */ new Set();
      if (remembered.has(property)) return;
      remembered.add(property);
      normalizedProperties.set(element, remembered);
      normalizedMotionStyles.push({
        element,
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property)
      });
      if (motionObserver) {
        normalizedStyleMutationBudgets.set(
          element,
          (normalizedStyleMutationBudgets.get(element) ?? 0) + 1
        );
      }
      element.style.setProperty(property, value, "important");
    }
    function normalizeMotionHiddenElement(element) {
      if (isExtensionElement(element) || isSemanticallyHidden(element) || !page.getComputedStyle) return;
      const styled = element;
      if (!styled.style) return;
      const computed = page.getComputedStyle(element);
      if (computed.display === "none" || computed.visibility === "hidden" || computed.visibility === "collapse") return;
      const animations = typeof element.getAnimations === "function" ? element.getAnimations({ subtree: false }) : [];
      const motionDriven = animations.length > 0 || computed.animationName !== "none" && computed.animationDuration !== "0s";
      if (!motionDriven) return;
      const opacity = Number.parseFloat(computed.opacity || "1");
      const clipPath = computed.clipPath || computed.getPropertyValue?.("clip-path") || "none";
      const filtered = computed.filter && computed.filter !== "none";
      const transformed = computed.transform && computed.transform !== "none";
      const collapsed = "scrollHeight" in element && element.scrollHeight > 0 && (Number.parseFloat(computed.height || "0") <= 1 || Number.parseFloat(computed.maxHeight || "0") <= 1) && ["hidden", "clip"].includes(computed.overflowY || computed.overflow);
      if (opacity <= 0.05) rememberMotionStyle(styled, "opacity", "1");
      if (transformed) rememberMotionStyle(styled, "transform", "none");
      if (filtered) rememberMotionStyle(styled, "filter", "none");
      if (clipPath !== "none") rememberMotionStyle(styled, "clip-path", "none");
      if (collapsed) {
        rememberMotionStyle(styled, "height", "auto");
        rememberMotionStyle(styled, "max-height", `${element.scrollHeight}px`);
      }
    }
    function pauseMotionSources(root, documentAnimations = page.document?.getAnimations?.() ?? []) {
      for (const animation of documentAnimations) {
        const target = animation.effect?.target;
        if (target?.nodeType === 1 && !root.contains(target) && root !== target) continue;
        if (animation.playState === "running") {
          try {
            animation.pause();
            pausedAnimations.add(animation);
          } catch {
            motionErrorCount += 1;
          }
        }
      }
      const elements = [root, ...Array.from(root.querySelectorAll?.("*") ?? [])];
      for (const element of elements) {
        normalizeMotionHiddenElement(element);
        const media = element;
        if (["AUDIO", "VIDEO"].includes(element.tagName) && typeof media.pause === "function" && !media.paused) {
          try {
            media.pause();
            pausedMedia.add(media);
          } catch {
            motionErrorCount += 1;
          }
        }
        const svg = element;
        if (element.tagName.toLowerCase() === "svg" && typeof svg.pauseAnimations === "function") {
          try {
            svg.pauseAnimations();
            pausedSvgRoots.add(svg);
          } catch {
            motionErrorCount += 1;
          }
        }
      }
    }
    function addPendingMotionRoot(root) {
      if (!paused || !root || isExtensionElement(root) || root.isConnected === false) return;
      for (const pendingRoot of pendingMotionRoots) {
        if (pendingRoot === root || pendingRoot.contains(root)) {
          return;
        }
        if (root.contains(pendingRoot)) {
          pendingMotionRoots.delete(pendingRoot);
        }
      }
      pendingMotionRoots.add(root);
    }
    function scheduleMotionEnforcement(root) {
      if (!paused) return;
      if (root) {
        addPendingMotionRoot(root);
      }
      if (motionEnforcementScheduled || pendingMotionRoots.size === 0) return;
      motionEnforcementScheduled = true;
      const enforce = () => {
        motionEnforcementScheduled = false;
        const roots = [...pendingMotionRoots];
        pendingMotionRoots.clear();
        const documentAnimations = page.document?.getAnimations?.() ?? [];
        for (const pendingRoot of roots) {
          if (pendingRoot.isConnected !== false) {
            pauseMotionSources(pendingRoot, documentAnimations);
          }
        }
      };
      if (originals.requestAnimationFrame) {
        originals.requestAnimationFrame.call(page, enforce);
      } else {
        originals.setTimeout.call(page, enforce, 0);
      }
    }
    function installMotionSourceHooks() {
      if (motionSourceHooksInstalled) return;
      motionSourceHooksInstalled = true;
      if (page.Element && originals.animate) {
        page.Element.prototype.animate = function patchedAnimate(keyframes, options) {
          const animation = originals.animate.call(this, keyframes, options);
          if (paused) {
            try {
              animation.pause();
              pausedAnimations.add(animation);
            } catch {
              motionErrorCount += 1;
            }
          }
          return animation;
        };
      }
      if (page.Animation && originals.animationPlay) {
        page.Animation.prototype.play = function patchedAnimationPlay() {
          originals.animationPlay.call(this);
          if (paused) {
            try {
              this.pause();
              pausedAnimations.add(this);
            } catch {
              motionErrorCount += 1;
            }
          }
        };
      }
      if (page.HTMLMediaElement && originals.mediaPlay) {
        page.HTMLMediaElement.prototype.play = function patchedMediaPlay() {
          const result = originals.mediaPlay.call(this);
          if (paused) {
            try {
              this.pause();
              pausedMedia.add(this);
            } catch {
              motionErrorCount += 1;
            }
          }
          return result;
        };
      }
    }
    function restoreMotionSourceHooks() {
      if (!motionSourceHooksInstalled) return;
      if (page.Element && originals.animate) page.Element.prototype.animate = originals.animate;
      if (page.Animation && originals.animationPlay) page.Animation.prototype.play = originals.animationPlay;
      if (page.HTMLMediaElement && originals.mediaPlay) page.HTMLMediaElement.prototype.play = originals.mediaPlay;
      motionSourceHooksInstalled = false;
    }
    function installMotionFreeze() {
      const documentElement = page.document?.documentElement;
      if (!documentElement || typeof documentElement.setAttribute !== "function") return;
      if (motionFreezeInstalled) return;
      motionFreezeInstalled = true;
      documentElement.setAttribute("data-uf-page-motion-paused", "true");
      installMotionSourceHooks();
      if (!motionStyle) {
        motionStyle = page.document.createElement("style");
        motionStyle.setAttribute("data-uf-extension-ui", "true");
        motionStyle.setAttribute("data-uf-page-motion-style", "true");
        motionStyle.textContent = `
html[data-uf-page-motion-paused="true"] *:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *) {
  animation-play-state: paused !important;
  transition-property: none !important;
  scroll-behavior: auto !important;
}
`;
        (page.document.head || documentElement).appendChild(motionStyle);
      }
      pauseMotionSources(documentElement);
      if (!motionObserver && page.MutationObserver) {
        motionObserver = new page.MutationObserver((records) => {
          for (const record of records) {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (record.type === "attributes") {
              if (!target || isExtensionElement(target)) {
                continue;
              }
              if (record.attributeName === "style") {
                const ownWriteBudget = normalizedStyleMutationBudgets.get(target) ?? 0;
                if (ownWriteBudget > 0) {
                  if (ownWriteBudget === 1) {
                    normalizedStyleMutationBudgets.delete(target);
                  } else {
                    normalizedStyleMutationBudgets.set(target, ownWriteBudget - 1);
                  }
                  continue;
                }
              }
              if (record.attributeName === "class") {
                const authoredClassTokens = (value) => (value ?? "").split(/\s+/).filter((token) => token && !token.startsWith("uf-cursor-")).sort().join(" ");
                if (authoredClassTokens(record.oldValue) === authoredClassTokens(target.getAttribute?.("class"))) {
                  continue;
                }
              }
              addPendingMotionRoot(target);
              continue;
            }
            for (const node of Array.from(record.addedNodes ?? [])) {
              if (node.nodeType === 1) {
                addPendingMotionRoot(node);
              }
            }
          }
          scheduleMotionEnforcement();
        });
        motionObserver.observe(documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ["class", "style", "hidden", "open", "aria-hidden", "aria-expanded"]
        });
      }
      if (motionEventCleanups.length === 0 && originals.addEventListener && originals.removeEventListener) {
        for (const type of ["animationstart", "animationiteration", "transitionrun", "play", "pointerover", "mouseover"]) {
          const listener = (event) => {
            const target = event.target?.nodeType === 1 ? event.target : null;
            if (target) {
              scheduleMotionEnforcement(target);
            }
          };
          originals.addEventListener.call(page.document, type, listener, true);
          motionEventCleanups.push(() => originals.removeEventListener?.call(page.document, type, listener, true));
        }
      }
    }
    function releaseMotionFreeze() {
      motionObserver?.disconnect();
      motionObserver = null;
      while (motionEventCleanups.length > 0) motionEventCleanups.pop()?.();
      pendingMotionRoots.clear();
      motionEnforcementScheduled = false;
      motionFreezeInstalled = false;
      motionStyle?.remove();
      motionStyle = null;
      page.document?.documentElement?.removeAttribute?.("data-uf-page-motion-paused");
      restoreMotionSourceHooks();
      for (let index = normalizedMotionStyles.length - 1; index >= 0; index -= 1) {
        const remembered = normalizedMotionStyles[index];
        if (!remembered) continue;
        if (remembered.value) {
          remembered.element.style.setProperty(remembered.property, remembered.value, remembered.priority);
        } else {
          remembered.element.style.removeProperty(remembered.property);
        }
        normalizedProperties.get(remembered.element)?.delete(remembered.property);
      }
      normalizedMotionStyles.length = 0;
      normalizedStyleMutationBudgets = /* @__PURE__ */ new WeakMap();
      for (const animation of pausedAnimations) {
        try {
          if (animation.playState === "paused") animation.play();
        } catch {
          motionErrorCount += 1;
        }
      }
      pausedAnimations.clear();
      for (const media of pausedMedia) {
        try {
          void media.play().catch(() => void 0);
        } catch {
          motionErrorCount += 1;
        }
      }
      pausedMedia.clear();
      for (const svg of pausedSvgRoots) {
        try {
          svg.unpauseAnimations();
        } catch {
          motionErrorCount += 1;
        }
      }
      pausedSvgRoots.clear();
    }
    function installTimerBridge() {
      if (installed) return;
      installed = true;
      page.setTimeout = function patchedSetTimeout(callback, delay, ...args) {
        const callable = typeof callback === "function" ? callback : () => {
          originals.setTimeout.call(page, callback, 0, ...args);
        };
        const token = { type: "timeout", callback: callable, args, cancelled: false };
        const nativeId = originals.setTimeout.call(page, () => {
          if (token.cancelled) return;
          if (paused) {
            queued.push(token);
            return;
          }
          timeoutTokens.delete(token.nativeId);
          callable.call(page, ...args);
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
        return originals.setInterval.call(page, function intervalGate() {
          if (paused) return;
          if (typeof callback === "function") {
            callback.call(page, ...args);
          } else {
            originals.setTimeout.call(page, callback, 0, ...args);
          }
        }, delay);
      };
      page.clearInterval = function patchedClearInterval(token) {
        return originals.clearInterval.call(page, token);
      };
      page.requestAnimationFrame = function patchedRequestAnimationFrame(callback) {
        if (typeof callback !== "function") {
          return originals.requestAnimationFrame.call(page, callback);
        }
        const token = { type: "raf", callback, args: [], cancelled: false };
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
      if (originals.requestIdleCallback) {
        page.requestIdleCallback = function patchedRequestIdleCallback(callback, options) {
          const token = { type: "idle", callback, args: [], cancelled: false };
          const nativeId = originals.requestIdleCallback.call(page, (deadline) => {
            if (token.cancelled) return;
            if (paused) {
              queued.push(token);
              return;
            }
            idleTokens.delete(token.nativeId);
            callback.call(page, deadline);
          }, options);
          token.nativeId = nativeId;
          idleTokens.set(nativeId, token);
          return nativeId;
        };
        page.cancelIdleCallback = function patchedCancelIdleCallback(token) {
          const tracked = idleTokens.get(token);
          if (tracked) {
            tracked.cancelled = true;
            idleTokens.delete(token);
            originals.cancelIdleCallback?.call(page, token);
            return;
          }
          return originals.cancelIdleCallback?.call(page, token);
        };
      }
      if (originals.IntersectionObserver) {
        const PatchedIntersectionObserver = function PatchedIntersectionObserver2(callback, options) {
          return Reflect.construct(originals.IntersectionObserver, [(entries, observer) => {
            if (!lazySuppressed) callback(entries, observer);
          }, options], new.target || PatchedIntersectionObserver2);
        };
        page.IntersectionObserver = PatchedIntersectionObserver;
        page.IntersectionObserver.prototype = originals.IntersectionObserver.prototype;
        Object.setPrototypeOf(page.IntersectionObserver, originals.IntersectionObserver);
      }
      if (originals.ResizeObserver) {
        const PatchedResizeObserver = function PatchedResizeObserver2(callback) {
          return Reflect.construct(originals.ResizeObserver, [(entries, observer) => {
            if (!lazySuppressed) callback(entries, observer);
          }], new.target || PatchedResizeObserver2);
        };
        page.ResizeObserver = PatchedResizeObserver;
        page.ResizeObserver.prototype = originals.ResizeObserver.prototype;
        Object.setPrototypeOf(page.ResizeObserver, originals.ResizeObserver);
      }
      const originalAddEventListener = originals.addEventListener;
      const originalRemoveEventListener = originals.removeEventListener;
      if (page.EventTarget && originalAddEventListener && originalRemoveEventListener) {
        page.EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
          const isLazyEvent = ["scroll", "wheel", "touchmove"].includes(String(type));
          const callable = typeof listener === "function" || listener && typeof listener.handleEvent === "function";
          if (!isLazyEvent || !callable || !listener) {
            return originalAddEventListener.call(this, type, listener, options);
          }
          const capture = listenerCapture(options);
          if (wrappedEventRegistrations.some(
            (registration) => registration.target === this && registration.type === type && registration.listener === listener && registration.capture === capture
          )) {
            return void 0;
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
          return originalAddEventListener.call(this, type, wrapped, options);
        };
        page.EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
          const wrapped = removeWrappedRegistration(this, type, listener, listenerCapture(options));
          return originalRemoveEventListener.call(this, type, wrapped || listener, options);
        };
      }
    }
    function removeWrappedRegistration(target, type, listener, capture) {
      for (let index = wrappedEventRegistrations.length - 1; index >= 0; index -= 1) {
        const registration = wrappedEventRegistrations[index];
        if (registration.target === target && registration.type === type && registration.listener === listener && registration.capture === capture) {
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
      page.requestIdleCallback = originals.requestIdleCallback;
      page.cancelIdleCallback = originals.cancelIdleCallback;
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
      idleTokens.clear();
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
            } else if (item.type === "idle") {
              idleTokens.delete(item.nativeId);
              item.callback.call(page, {
                didTimeout: false,
                timeRemaining: () => 0
              });
            } else {
              timeoutTokens.delete(item.nativeId);
              item.callback.call(page, ...item.args);
            }
          } catch (error) {
            originals.setTimeout.call(page, () => {
              throw error;
            }, 0);
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
          result: ok ? payload : void 0,
          code: ok ? void 0 : failure && failure.code,
          error: ok ? void 0 : failure && failure.message,
          details: ok ? void 0 : failure
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
        failure: ok ? void 0 : failure
      }, "*");
    }
    installTimerBridge();
    installNavigationBridge();
    installClosedShadowInstrumentation();
    page.addEventListener("message", (event) => {
      const request = event.data;
      if (event.source !== globalThis) {
        return;
      }
      if (!request || !(request.kind === CHANNEL && request.type === "request" || request.channel === LEGACY_CHANNEL && request.kind === "request")) {
        return;
      }
      const command = normalizeCommand(request.command);
      if (!ALLOWED.has(request.command ?? "")) {
        reply(page, request, false, null, {
          code: "PAGE_COMMAND_REJECTED",
          message: "Unsupported page-world command"
        });
        return;
      }
      if (typeof request.nonce !== "string" || request.nonce.length === 0) {
        reply(page, request, false, null, {
          code: "PAGE_NONCE_REQUIRED",
          message: "Page-world command requires a nonce"
        });
        return;
      }
      const requestSessionNonce = request.channel === LEGACY_CHANNEL ? request.nonce : request.sessionNonce;
      if (command === "ARM") {
        if (armed && request.nonce !== sessionNonce) {
          reply(page, request, false, null, {
            code: "PAGE_NONCE_MISMATCH",
            message: "Page-world command nonce did not match the armed session"
          });
          return;
        }
        armed = true;
        sessionNonce = request.nonce;
        installTimerBridge();
      } else if (!armed || requestSessionNonce !== sessionNonce) {
        reply(page, request, false, null, {
          code: "PAGE_NONCE_MISMATCH",
          message: "Page-world command session nonce did not match the armed session"
        });
        return;
      }
      if (command === "SET_MOTION_PAUSED") {
        paused = Boolean(request.payload && request.payload.paused);
        if (paused) {
          installMotionFreeze();
        } else {
          releaseMotionFreeze();
          flushQueued();
        }
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
        releaseMotionFreeze();
        if (page.document && page.document.documentElement) {
          page.document.documentElement.toggleAttribute("data-uf-lazy-loading-suppressed", false);
        }
        flushQueued();
        restoreTimerBridge();
      }
      reply(page, request, true, { armed, paused, lazySuppressed, motionErrorCount });
    });
  })();
})();
