// GENERATED from src/page-world/program.ts. Run: pnpm page-world:generate
/* eslint-disable no-empty, @typescript-eslint/no-unused-vars -- generated bundle keeps an inert installer until capability injection */
"use strict";
(() => {
  // src/page-world/program.ts
  async function installPageWorldProgram(endpointKey, capability) {
    const page = globalThis;
    const RUNTIME_VERSION = 4;
    const runtimeHost = page;
    const rejected = (code, message) => ({
      ok: false,
      nonce: "",
      command: "",
      payload: null,
      failure: { code, message }
    });
    if (!/^__uf_[a-f\d]{32,128}$/i.test(endpointKey) || !/^[a-f\d]{64}$/i.test(capability)) {
      return rejected("PAGE_CAPABILITY_INVALID", "Page-world capability identity is invalid");
    }
    const existingRuntime = runtimeHost[endpointKey];
    if (typeof existingRuntime === "function") {
      try {
        const result = await existingRuntime(capability, { kind: "probe" });
        return result;
      } catch {
        return rejected("PAGE_RUNTIME_UNAVAILABLE", "Page-world runtime probe failed");
      }
    }
    const inheritedQueuedTimers = [];
    let inheritedEventRegistrations = [];
    const OPEN_SHADOW_ATTACHED_EVENT = "uf:open-shadow-attached";
    const MOTION_CAPTURE_LEDGER_ATTR = "data-uf-motion-lock-ledger";
    const MAX_MOTION_LOCKS = 800;
    const MAX_FULL_STYLE_DISCOVERY_DOCUMENT_ELEMENTS = MAX_MOTION_LOCKS * 3;
    const MOTION_DISCOVERY_YIELD_EVERY = 1e3;
    const MAX_HOVER_PAUSE_TARGETS = 500;
    const MOTION_MAINTENANCE_DELAY_MS = 250;
    const MAX_VIEWPORT_OWNER_CANDIDATES = 1600;
    const MAX_VIEWPORT_OWNER_HITS_PER_POINT = 12;
    const MAX_VIEWPORT_OWNER_ANCESTOR_DEPTH = 128;
    const MAX_VIEWPORT_OWNER_TREE_WALK = 1500;
    const MAX_VIEWPORT_OWNER_MOVEMENT_PROOFS = 12;
    const DOMINANT_NESTED_RANGE_RATIO = 2;
    const DOMINANT_NESTED_EXTRA_VIEWPORTS = 0.5;
    const MOTION_DESCRIPTOR_PATTERN = /auto[-_\s]?play|carousel|slider|slideshow|marquee|ticker|animation|animated|animate|motion|parallax|scroll[-_\s]?snap/i;
    const REVEAL_DESCRIPTOR_PATTERN = /(^|[-_\s:])(aos|appear|appearance|animate|animated|entrance|enter|fade|intersect|intersection|inview|in-view|on[-_\s]?scroll|reveal|scroll[-_\s]?(animate|animation|fade|reveal|trigger)?|slide[-_\s]?(in|up|down|left|right)|viewport|wow|zoom)([-_\s:]|$)/i;
    const SEMANTIC_UI_DESCRIPTOR_PATTERN = /accordion|backdrop|carousel|collapse|dialog|drawer|dropdown|lightbox|marquee|menu|modal|offcanvas|overlay|popover|slider|slideshow|tab|tabpanel|ticker|toast|tooltip/i;
    const INLINE_MOTION_PATTERN = /(^|;|\s)(animation|transition|transform|translate|rotate|scale|offset|opacity|filter|clip-path|top|right|bottom|left)\s*:/i;
    const REVEAL_ATTRIBUTE_NAMES = /* @__PURE__ */ new Set(["data-ix", "data-w-id"]);
    const MOTION_PROPERTIES = [
      "transform",
      "translate",
      "rotate",
      "scale",
      "offset-path",
      "offset-distance",
      "offset-rotate",
      "perspective",
      "opacity",
      "filter",
      "backdrop-filter",
      "clip-path"
    ];
    const POSITION_EDGE_PROPERTIES = [
      "top",
      "right",
      "bottom",
      "left",
      "inset-block-start",
      "inset-block-end",
      "inset-inline-start",
      "inset-inline-end"
    ];
    const ALLOWED = /* @__PURE__ */ new Set([
      "ARM",
      "RECONCILE",
      "SET_MOTION_PAUSED",
      "SET_LAZY_LOADING_SUPPRESSED",
      "SET_NAVIGATION_GUARD",
      "DESTROY",
      "PAGE_WORLD_ARM",
      "PAGE_WORLD_SET_MOTION_PAUSED",
      "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED",
      "PAGE_WORLD_DESTROY"
    ]);
    let armed = false;
    let sessionNonce = "";
    let installed = false;
    let lazyBridgeInstalled = false;
    let paused = false;
    let lazySuppressed = false;
    let navigationGuardActive = false;
    let guardedPushState = null;
    let guardedReplaceState = null;
    let guardedBack = null;
    let guardedForward = null;
    let guardedGo = null;
    let guardedNavigationListener = null;
    const queued = [...inheritedQueuedTimers];
    const originals = {
      setTimeout: page.setTimeout,
      clearTimeout: page.clearTimeout,
      setInterval: page.setInterval,
      clearInterval: page.clearInterval,
      requestAnimationFrame: page.requestAnimationFrame,
      cancelAnimationFrame: page.cancelAnimationFrame,
      requestIdleCallback: page.requestIdleCallback,
      cancelIdleCallback: page.cancelIdleCallback,
      evaluate: page.eval,
      IntersectionObserver: page.IntersectionObserver,
      ResizeObserver: page.ResizeObserver,
      attachShadow: page.Element?.prototype.attachShadow,
      animate: page.Element?.prototype.animate,
      animationPlay: page.Animation?.prototype.play,
      mediaPlay: page.HTMLMediaElement?.prototype.play,
      addEventListener: page.EventTarget?.prototype.addEventListener,
      removeEventListener: page.EventTarget?.prototype.removeEventListener,
      rootAddEventListener: page.addEventListener,
      rootRemoveEventListener: page.removeEventListener,
      documentAddEventListener: page.document?.addEventListener,
      documentRemoveEventListener: page.document?.removeEventListener,
      historyPushState: page.history?.pushState,
      historyReplaceState: page.history?.replaceState,
      historyBack: page.history?.back,
      historyForward: page.history?.forward,
      historyGo: page.history?.go
    };
    const wrappedEventRegistrations = [];
    const timeoutTokens = /* @__PURE__ */ new Map();
    const rafTokens = /* @__PURE__ */ new Map();
    const idleTokens = /* @__PURE__ */ new Map();
    const pendingTimerFlushHandles = /* @__PURE__ */ new Set();
    const pendingTimerFlushItems = /* @__PURE__ */ new Set();
    let timerBridgeRestoreRequested = false;
    let timerDeliveryEpoch = 0;
    let nextDeferredTimerId = -1;
    let nextDeferredFrameId = -1e6;
    let nextDeferredIdleId = -2e6;
    function timerAliases(item) {
      if (!item.tokenAliases) item.tokenAliases = /* @__PURE__ */ new Set();
      if (item.nativeId !== void 0) item.tokenAliases.add(item.nativeId);
      return item.tokenAliases;
    }
    function trackTimerAlias(tokens, item, alias) {
      timerAliases(item).add(alias);
      tokens.set(alias, item);
    }
    function forgetTimerAliases(tokens, item) {
      for (const alias of timerAliases(item)) {
        if (tokens.get(alias) === item) tokens.delete(alias);
      }
    }
    function cancelTrackedTimer(tokens, alias) {
      const tracked = tokens.get(alias);
      if (!tracked) return false;
      tracked.cancelled = true;
      forgetTimerAliases(tokens, tracked);
      return true;
    }
    function executeTimeoutHandler(callback, args) {
      if (typeof callback === "function") {
        callback.call(page, ...args);
        return;
      }
      if (originals.evaluate) {
        originals.evaluate.call(page, callback);
        return;
      }
      originals.setTimeout.call(page, callback, 0, ...args);
    }
    for (const item of inheritedQueuedTimers) {
      const tokens = item.type === "timeout" ? timeoutTokens : item.type === "raf" ? rafTokens : idleTokens;
      for (const alias of timerAliases(item)) tokens.set(alias, item);
      if (typeof item.nativeId !== "number") continue;
      if (item.type === "timeout") nextDeferredTimerId = Math.min(nextDeferredTimerId, item.nativeId);
      if (item.type === "raf") nextDeferredFrameId = Math.min(nextDeferredFrameId, item.nativeId);
      if (item.type === "idle") nextDeferredIdleId = Math.min(nextDeferredIdleId, item.nativeId);
    }
    const pausedAnimations = /* @__PURE__ */ new Set();
    const pausedMedia = /* @__PURE__ */ new Set();
    const pausedSvgRoots = /* @__PURE__ */ new Map();
    const lockedMotionElements = /* @__PURE__ */ new Set();
    const hoverPauseTargets = /* @__PURE__ */ new Set();
    const normalizedMotionStyles = [];
    const normalizedMotionStyleRecords = /* @__PURE__ */ new WeakMap();
    const normalizedProperties = /* @__PURE__ */ new WeakMap();
    const lockedMotionValues = /* @__PURE__ */ new WeakMap();
    const motionStyleLedgers = /* @__PURE__ */ new Map();
    const pendingMotionRoots = /* @__PURE__ */ new Set();
    const pendingMotionElements = /* @__PURE__ */ new Set();
    const motionEventCleanups = [];
    const lazyEventCleanups = [];
    const lazyTargetRestorations = [];
    let motionStyle = null;
    const motionShadowStyles = /* @__PURE__ */ new Map();
    let motionObserver = null;
    let observedMotionRoots = /* @__PURE__ */ new WeakSet();
    let motionEnforcementScheduled = false;
    let motionEnforcementTimer = null;
    let motionFreezeInstalled = false;
    let motionInitialDiscoveryComplete = false;
    let motionInitialDiscoveryPromise = null;
    let motionFreezeGeneration = 0;
    let motionSourceHooksInstalled = false;
    let motionErrorCount = 0;
    let lifecyclePhase = "idle";
    let nestedLazyViewportOwner = null;
    let lazyOwnerObserver = null;
    let lazyOwnerRefreshScheduled = false;
    let lazyOwnerRefreshToken = null;
    let observedLazyOwnerRoots = /* @__PURE__ */ new WeakSet();
    const patchedLazyTargets = /* @__PURE__ */ new WeakSet();
    const nestedLazyCaptureTargets = /* @__PURE__ */ new WeakSet();
    let patchLazyTarget = () => void 0;
    let installedAttachShadow = null;
    let installedIntersectionObserver = null;
    let installedResizeObserver = null;
    let lazyOwnerMovementProofs = /* @__PURE__ */ new WeakMap();
    class SupersededMotionFreezeError extends Error {
      constructor() {
        super("Motion freeze generation was superseded");
        this.name = "SupersededMotionFreezeError";
      }
    }
    function installClosedShadowInstrumentation() {
      const originalAttachShadow = originals.attachShadow;
      if (!page.Element || typeof originalAttachShadow !== "function") return;
      const current = page.Element.prototype.attachShadow;
      if (current.__ufClosedShadowInstrumented) return;
      const patched = function patchedAttachShadow(init) {
        let root;
        if (init && init.mode === "closed") {
          this.setAttribute?.("data-uf-closed-shadow-host", "true");
          root = originalAttachShadow.call(this, { ...init, mode: "open" });
        } else {
          root = originalAttachShadow.call(this, init);
        }
        if (paused) registerMotionShadowRoot(root);
        if (lazySuppressed) {
          observeLazyOwnerMutationRoot(root);
          scheduleNestedLazyViewportOwnerRefresh();
        }
        if (root.mode === "open" && page.Event) {
          try {
            this.dispatchEvent(new page.Event(OPEN_SHADOW_ATTACHED_EVENT, {
              bubbles: true,
              composed: true
            }));
          } catch {
          }
        }
        return root;
      };
      patched.__ufClosedShadowInstrumented = true;
      page.Element.prototype.attachShadow = patched;
      installedAttachShadow = patched;
    }
    function listenerCapture(options) {
      return typeof options === "boolean" ? options : Boolean(options && options.capture);
    }
    function listenerOnce(options) {
      return Boolean(options && typeof options === "object" && options.once);
    }
    function listenerSignal(options) {
      return options && typeof options === "object" ? options.signal ?? void 0 : void 0;
    }
    function snapshotListenerOptions(options) {
      if (typeof options === "boolean" || options === void 0) return options;
      const snapshot = {
        capture: Boolean(options.capture),
        once: Boolean(options.once)
      };
      if ("passive" in options) snapshot.passive = Boolean(options.passive);
      if (options.signal) snapshot.signal = options.signal;
      return snapshot;
    }
    function runCleanupsSafely(cleanups) {
      while (cleanups.length > 0) {
        const cleanup = cleanups.pop();
        try {
          cleanup?.();
        } catch {
        }
      }
    }
    function isExtensionElement(element) {
      let cursor = element;
      for (let depth = 0; cursor && depth < 16; depth += 1) {
        if (cursor.getAttribute?.("data-uf-extension-ui") === "true" || cursor.closest?.('[data-uf-extension-ui="true"]')) {
          return true;
        }
        const root = cursor.getRootNode?.();
        cursor = root && "host" in root && root.host ? root.host : null;
      }
      return false;
    }
    function authoredClassTokens(value) {
      return (value ?? "").split(/\s+/).filter((token) => token && !token.startsWith("uf-cursor-")).sort().join(" ");
    }
    function isConsentSuppressedElement(element) {
      let cursor = element;
      for (let depth = 0; cursor && depth < 32; depth += 1) {
        if (cursor.hasAttribute?.("data-uf-consent-hidden")) return true;
        let parent = cursor.parentElement;
        if (!parent) {
          const root = cursor.getRootNode?.();
          parent = root && "host" in root && root.host ? root.host : null;
        }
        cursor = parent;
      }
      return false;
    }
    function animationTargetIsExcluded(animation) {
      const target = animation.effect?.target;
      return Boolean(target?.nodeType === 1 && (isExtensionElement(target) || isConsentSuppressedElement(target)));
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
    function relevantAttributeDescriptor(element) {
      if (!element.attributes) return "";
      const parts = [];
      try {
        for (const rawAttribute of Array.from(element.attributes)) {
          const attribute = Array.isArray(rawAttribute) ? { name: rawAttribute[0], value: rawAttribute[1] } : rawAttribute;
          const name = String(attribute.name || "").toLowerCase();
          if (name === "id" || name === "class" || name === "role" || name.startsWith("aria-") || name.startsWith("data-") || name === "autoplay" || name === "loop") {
            parts.push(name, String(attribute.value || ""));
          }
        }
      } catch {
        return "";
      }
      return parts.join(" ");
    }
    function hasRevealAttribute(element) {
      try {
        return Array.from(element.attributes ?? []).some((rawAttribute) => {
          const attribute = Array.isArray(rawAttribute) ? { name: rawAttribute[0] } : rawAttribute;
          return REVEAL_ATTRIBUTE_NAMES.has(String(attribute.name || "").toLowerCase());
        });
      } catch {
        return false;
      }
    }
    function hasSemanticUiDescriptor(element) {
      let cursor = element;
      for (let depth = 0; cursor && depth < 6; depth += 1) {
        if (SEMANTIC_UI_DESCRIPTOR_PATTERN.test(relevantAttributeDescriptor(cursor))) return true;
        cursor = cursor.parentElement;
      }
      return false;
    }
    function hasRevealDescriptor(element) {
      return (REVEAL_DESCRIPTOR_PATTERN.test(relevantAttributeDescriptor(element)) || hasRevealAttribute(element)) && !hasSemanticUiDescriptor(element);
    }
    function hasInlineMotion(element) {
      return INLINE_MOTION_PATTERN.test(element.getAttribute?.("style") ?? "");
    }
    function hasNonZeroTimeList(value) {
      return String(value || "").split(",").some((entry) => {
        const normalized = entry.trim().toLowerCase();
        if (!normalized) return false;
        const amount = Number.parseFloat(normalized);
        return Number.isFinite(amount) && amount > 0;
      });
    }
    function hasNamedListValue(value) {
      return String(value || "").split(",").some((entry) => {
        const normalized = entry.trim().toLowerCase();
        return Boolean(normalized && normalized !== "none");
      });
    }
    function computedStyleHasMotion(computed) {
      const animationName = computed.getPropertyValue?.("animation-name") || computed.animationName;
      const transitionDuration = computed.getPropertyValue?.("transition-duration") || computed.transitionDuration;
      const transitionDelay = computed.getPropertyValue?.("transition-delay") || computed.transitionDelay;
      const willChange = computed.getPropertyValue?.("will-change") || computed.willChange;
      return hasNamedListValue(animationName) || hasNonZeroTimeList(transitionDuration) || hasNonZeroTimeList(transitionDelay) || /transform|translate|rotate|scale|top|right|bottom|left|opacity|filter|clip-path|offset/i.test(willChange);
    }
    function activeMotionValue(property, value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized || ["none", "normal", "auto", "initial", "inherit", "unset", "revert"].includes(normalized)) {
        return false;
      }
      if (property === "opacity") return normalized !== "1";
      if (["filter", "backdrop-filter", "clip-path"].includes(property)) return normalized !== "none";
      return !/^0(?:px|%|deg|rad|turn|s|ms)?$/.test(normalized);
    }
    function addMotionCandidate(candidates, element, next = {}) {
      if (!element || isExtensionElement(element) || isConsentSuppressedElement(element)) return;
      const current = candidates.get(element);
      candidates.set(element, {
        descriptorMatched: Boolean(current?.descriptorMatched || next.descriptorMatched),
        inlineMotion: Boolean(current?.inlineMotion || next.inlineMotion),
        computedStyle: current?.computedStyle || next.computedStyle
      });
    }
    function syncMotionCaptureLedger(element) {
      const ledger = motionStyleLedgers.get(element);
      if (!ledger) return;
      try {
        element.setAttribute(MOTION_CAPTURE_LEDGER_ATTR, JSON.stringify({
          version: 1,
          hadStyleAttribute: ledger.hadStyleAttribute,
          properties: [...ledger.properties].map(([name, remembered]) => ({
            name,
            value: remembered.value,
            priority: remembered.priority
          }))
        }));
      } catch {
        motionErrorCount += 1;
      }
    }
    function rememberMotionStyle(element, property, value) {
      const remembered = normalizedProperties.get(element) ?? /* @__PURE__ */ new Set();
      const lockedValues = lockedMotionValues.get(element) ?? /* @__PURE__ */ new Map();
      const existingLock = lockedValues.get(property);
      if (existingLock !== void 0) {
        if (element.style.getPropertyValue(property) !== existingLock || element.style.getPropertyPriority(property) !== "important") {
          element.style.setProperty(property, existingLock, "important");
        }
        return;
      }
      remembered.add(property);
      normalizedProperties.set(element, remembered);
      lockedValues.set(property, value);
      lockedMotionValues.set(element, lockedValues);
      const originalValue = element.style.getPropertyValue(property);
      const originalPriority = element.style.getPropertyPriority(property);
      const normalizedRecord = {
        element,
        property,
        value: originalValue,
        priority: originalPriority
      };
      normalizedMotionStyles.push(normalizedRecord);
      const elementRecords = normalizedMotionStyleRecords.get(element) ?? /* @__PURE__ */ new Map();
      elementRecords.set(property, normalizedRecord);
      normalizedMotionStyleRecords.set(element, elementRecords);
      const ledger = motionStyleLedgers.get(element) ?? {
        hadStyleAttribute: element.hasAttribute("style"),
        properties: /* @__PURE__ */ new Map()
      };
      ledger.properties.set(property, { value: originalValue, priority: originalPriority });
      motionStyleLedgers.set(element, ledger);
      element.style.setProperty(property, value, "important");
      syncMotionCaptureLedger(element);
    }
    function captureLatestAuthoredMotionStyles(element) {
      const styled = element;
      const lockedValues = lockedMotionValues.get(element);
      const normalizedRecords = normalizedMotionStyleRecords.get(element);
      const ledger = motionStyleLedgers.get(styled);
      if (!styled.style || !lockedValues || !normalizedRecords || !ledger) return;
      let changed = false;
      try {
        for (const [property, lockedValue] of lockedValues) {
          const value = styled.style.getPropertyValue(property);
          const priority = styled.style.getPropertyPriority(property);
          if (value === lockedValue && priority === "important") continue;
          const normalizedRecord = normalizedRecords.get(property);
          if (!normalizedRecord) continue;
          normalizedRecord.value = value;
          normalizedRecord.priority = priority;
          ledger.properties.set(property, { value, priority });
          changed = true;
        }
      } catch {
        motionErrorCount += 1;
        return;
      }
      if (changed) {
        ledger.hadStyleAttribute = styled.hasAttribute("style");
        syncMotionCaptureLedger(styled);
      }
    }
    function motionLocksIntact(element) {
      const styled = element;
      const lockedValues = lockedMotionValues.get(element);
      if (!styled.style || !lockedValues || lockedValues.size === 0) return false;
      for (const [property, value] of lockedValues) {
        if (styled.style.getPropertyValue(property) !== value || styled.style.getPropertyPriority(property) !== "important") {
          return false;
        }
      }
      return true;
    }
    function elementHasLayoutBox(element) {
      try {
        const rects = Array.from(element.getClientRects?.() ?? []);
        if (rects.length > 0) {
          return rects.some((rect2) => Number(rect2.width) > 1 && Number(rect2.height) > 1);
        }
        const rect = element.getBoundingClientRect?.();
        return rect ? Number(rect.width) > 1 && Number(rect.height) > 1 : true;
      } catch {
        return true;
      }
    }
    function computedValue(computed, property) {
      return computed.getPropertyValue?.(property) || "";
    }
    function revealNormalization(element, candidate, computed) {
      if (!hasRevealDescriptor(element) || !candidate.descriptorMatched && !candidate.inlineMotion && !candidate.computedStyle || isSemanticallyHidden(element) || computed.display === "none" || !elementHasLayoutBox(element)) {
        return [];
      }
      const opacity = Number.parseFloat(computed.opacity || "1");
      const visibility = String(computed.visibility || "").trim().toLowerCase();
      const clipPath = computed.clipPath || computedValue(computed, "clip-path") || "none";
      const hiddenByOpacity = Number.isFinite(opacity) && opacity < 0.5;
      const hiddenByVisibility = visibility === "hidden" || visibility === "collapse";
      const hiddenByClip = activeMotionValue("clip-path", clipPath);
      if (!hiddenByOpacity && !hiddenByVisibility && !hiddenByClip) return [];
      const entries = [];
      if (hiddenByVisibility) entries.push(["visibility", "visible"]);
      if (hiddenByOpacity) entries.push(["opacity", "1"]);
      for (const property of ["transform", "translate", "rotate", "perspective"]) {
        if (activeMotionValue(property, computedValue(computed, property))) entries.push([property, "none"]);
      }
      const scale = computedValue(computed, "scale").trim().toLowerCase();
      if (scale && scale !== "none" && scale !== "1") entries.push(["scale", "none"]);
      for (const property of ["filter", "backdrop-filter", "clip-path"]) {
        if (activeMotionValue(property, computedValue(computed, property))) entries.push([property, "none"]);
      }
      return entries;
    }
    function motionLockProperties(computed, forceTransformLocks) {
      const properties = [];
      const computedMotion = computedStyleHasMotion(computed);
      for (const property of MOTION_PROPERTIES) {
        const value = computedValue(computed, property);
        if (activeMotionValue(property, value) || (forceTransformLocks || computedMotion) && ["transform", "translate", "rotate", "scale", "offset-distance"].includes(property)) {
          properties.push(property);
        }
      }
      const position = computedValue(computed, "position").trim().toLowerCase();
      if (position && position !== "static") {
        for (const property of POSITION_EDGE_PROPERTIES) {
          const value = computedValue(computed, property);
          if (value && value.trim().toLowerCase() !== "auto") properties.push(property);
        }
      }
      return properties;
    }
    function lockFallbackValue(property, value) {
      const normalized = String(value || "").trim();
      if (normalized) return normalized;
      if (property === "opacity") return "1";
      if (POSITION_EDGE_PROPERTIES.includes(property)) return "auto";
      return "none";
    }
    function applyMotionCandidate(element, candidate) {
      if (!page.getComputedStyle || isExtensionElement(element) || isConsentSuppressedElement(element)) return;
      if (!lockedMotionElements.has(element) && lockedMotionElements.size >= MAX_MOTION_LOCKS) return;
      const styled = element;
      if (!styled.style) return;
      let computed;
      try {
        computed = candidate.computedStyle || page.getComputedStyle(element);
      } catch {
        motionErrorCount += 1;
        return;
      }
      const revealEntries = revealNormalization(element, candidate, computed);
      if (revealEntries.length > 0) {
        lockedMotionElements.add(element);
        for (const [property, value] of revealEntries) rememberMotionStyle(styled, property, value);
        return;
      }
      const properties = motionLockProperties(
        computed,
        candidate.descriptorMatched || candidate.inlineMotion
      );
      if (properties.length === 0) return;
      lockedMotionElements.add(element);
      for (const property of properties) {
        rememberMotionStyle(styled, property, lockFallbackValue(property, computedValue(computed, property)));
      }
    }
    function yieldToPage() {
      return new Promise((resolve) => {
        originals.setTimeout.call(page, () => resolve(), 0);
      });
    }
    const motionObserverOptions = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["class", "style", "hidden", "open", "aria-hidden", "aria-expanded"]
    };
    function registerMotionShadowRoot(root) {
      if (!root || isExtensionElement(root.host) || isConsentSuppressedElement(root.host)) return true;
      let complete = true;
      if (!motionShadowStyles.has(root)) {
        try {
          const style = page.document.createElement("style");
          style.setAttribute("data-uf-extension-ui", "true");
          style.setAttribute("data-uf-page-motion-shadow-style", "true");
          style.textContent = `
:host,
:host::before,
:host::after,
*:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *):not([data-uf-consent-hidden]):not([data-uf-consent-hidden] *),
*:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *):not([data-uf-consent-hidden]):not([data-uf-consent-hidden] *)::before,
*:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *):not([data-uf-consent-hidden]):not([data-uf-consent-hidden] *)::after {
  animation-play-state: paused !important;
  transition-property: none !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}
`;
          root.appendChild(style);
          motionShadowStyles.set(root, style);
        } catch {
          motionErrorCount += 1;
          complete = false;
        }
      }
      if (motionObserver && !observedMotionRoots.has(root)) {
        try {
          motionObserver.observe(root, motionObserverOptions);
          observedMotionRoots.add(root);
        } catch {
          motionErrorCount += 1;
          complete = false;
        }
      }
      return complete && motionShadowStyles.has(root) && (!motionObserver || observedMotionRoots.has(root));
    }
    function accessibleShadowRoot(element) {
      try {
        const root = element.shadowRoot;
        return root && root.mode === "open" ? root : null;
      } catch {
        motionErrorCount += 1;
        return null;
      }
    }
    async function dispatchHoverPause(candidates, stillCurrent) {
      if (!page.Event) return stillCurrent();
      let dispatchedSinceYield = 0;
      for (const candidate of candidates.keys()) {
        if (!stillCurrent()) return false;
        if (isConsentSuppressedElement(candidate)) continue;
        let cursor = candidate;
        for (let depth = 0; cursor && depth < 8 && hoverPauseTargets.size < MAX_HOVER_PAUSE_TARGETS; depth += 1) {
          if (!stillCurrent()) return false;
          const tagName = String(cursor.tagName || "").toLowerCase();
          if (tagName !== "html" && tagName !== "body" && !isExtensionElement(cursor) && !isConsentSuppressedElement(cursor) && !hoverPauseTargets.has(cursor)) {
            hoverPauseTargets.add(cursor);
            try {
              cursor.dispatchEvent(new page.Event("pointerenter", { bubbles: false }));
              cursor.dispatchEvent(new page.Event("mouseenter", { bubbles: false }));
              cursor.dispatchEvent(new page.Event("mouseover", { bubbles: true }));
              dispatchedSinceYield += 1;
            } catch {
              motionErrorCount += 1;
            }
            if (dispatchedSinceYield >= 20) {
              dispatchedSinceYield = 0;
              await yieldToPage();
              if (!stillCurrent()) return false;
            }
          }
          cursor = cursor.parentElement;
        }
        if (hoverPauseTargets.size >= MAX_HOVER_PAUSE_TARGETS) break;
      }
      return stillCurrent();
    }
    async function pauseMotionSourcesBatch(subtreeRoots, exactElements, documentAnimations = page.document?.getAnimations?.() ?? [], expectedGeneration = motionFreezeGeneration, requireCompleteSubtreeEnumeration = false) {
      const stillCurrent = () => paused && expectedGeneration === motionFreezeGeneration;
      if (!stillCurrent()) return false;
      const candidates = /* @__PURE__ */ new Map();
      const processedAnimations = /* @__PURE__ */ new Set();
      const processAnimation = (animation) => {
        if (processedAnimations.has(animation)) return;
        processedAnimations.add(animation);
        if (!stillCurrent()) return;
        try {
          if (animationTargetIsExcluded(animation)) return;
          const target = animation.effect?.target;
          if (target?.nodeType === 1) addMotionCandidate(candidates, target, { descriptorMatched: true });
          if (animation.playState === "running") {
            animation.pause();
            pausedAnimations.add(animation);
          }
        } catch {
          motionErrorCount += 1;
        }
      };
      for (const animation of documentAnimations) {
        if (!stillCurrent()) return false;
        processAnimation(animation);
      }
      const processedElements = /* @__PURE__ */ new Set();
      const processElement = (element, inspectComputedStyle) => {
        if (!stillCurrent()) return;
        if (processedElements.has(element) || element.isConnected === false) return;
        processedElements.add(element);
        if (isExtensionElement(element) || isConsentSuppressedElement(element)) return;
        const media = element;
        if (["AUDIO", "VIDEO"].includes(element.tagName) && typeof media.pause === "function" && !media.paused && (media.autoplay || media.loop || media.muted || media.hasAttribute?.("autoplay") || media.hasAttribute?.("loop") || media.hasAttribute?.("muted"))) {
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
            const wasPaused = typeof svg.animationsPaused === "function" ? svg.animationsPaused() : false;
            svg.pauseAnimations();
            pausedSvgRoots.set(svg, wasPaused);
          } catch {
            motionErrorCount += 1;
          }
        }
        const descriptor = relevantAttributeDescriptor(element);
        const descriptorMatched = MOTION_DESCRIPTOR_PATTERN.test(descriptor) || REVEAL_DESCRIPTOR_PATTERN.test(descriptor) || hasRevealAttribute(element);
        const inlineMotion = hasInlineMotion(element);
        if (descriptorMatched || inlineMotion) {
          addMotionCandidate(candidates, element, { descriptorMatched, inlineMotion });
          return;
        }
        if (!inspectComputedStyle || !page.getComputedStyle) return;
        try {
          const computedStyle = page.getComputedStyle(element);
          const transformed = [
            "transform",
            "translate",
            "rotate",
            "scale",
            "offset-path",
            "offset-distance",
            "offset-rotate",
            "perspective"
          ].some((property) => activeMotionValue(property, computedValue(computedStyle, property)));
          if (computedStyleHasMotion(computedStyle) || transformed) {
            addMotionCandidate(candidates, element, { computedStyle });
          }
        } catch {
          motionErrorCount += 1;
        }
      };
      const processElementRecoverably = (element, inspectComputedStyle) => {
        try {
          processElement(element, inspectComputedStyle);
        } catch {
          motionErrorCount += 1;
        }
      };
      const enumeratedTraversalRoots = /* @__PURE__ */ new Set();
      for (const root of subtreeRoots) {
        if (!stillCurrent()) return false;
        if (root.isConnected === false) {
          if (requireCompleteSubtreeEnumeration) {
            throw new Error("Initial motion discovery document root was disconnected");
          }
          continue;
        }
        const elements = [];
        const traversalRoots = [root];
        for (let traversalIndex = 0; traversalIndex < traversalRoots.length; traversalIndex += 1) {
          if (!stillCurrent()) return false;
          const traversalRoot = traversalRoots[traversalIndex];
          if (!traversalRoot || enumeratedTraversalRoots.has(traversalRoot)) continue;
          enumeratedTraversalRoots.add(traversalRoot);
          if (traversalRoot === root) elements.push(root);
          let descendants = [];
          try {
            descendants = Array.from(traversalRoot.querySelectorAll?.("*") ?? []);
          } catch (error) {
            if (requireCompleteSubtreeEnumeration) {
              throw new Error(
                traversalRoot === root ? "Initial motion discovery could not enumerate the document root" : "Initial motion discovery could not enumerate an accessible shadow root",
                { cause: error }
              );
            }
            motionErrorCount += 1;
          }
          elements.push(...descendants);
          const shadowHosts = traversalRoot === root ? [root, ...descendants] : descendants;
          for (const element of shadowHosts) {
            if (isExtensionElement(element) || isConsentSuppressedElement(element)) continue;
            const shadowRoot = accessibleShadowRoot(element);
            if (!shadowRoot || enumeratedTraversalRoots.has(shadowRoot)) continue;
            if (!registerMotionShadowRoot(shadowRoot) && requireCompleteSubtreeEnumeration) {
              throw new Error("Initial motion discovery could not freeze or observe an accessible shadow root");
            }
            traversalRoots.push(shadowRoot);
            try {
              for (const animation of shadowRoot.getAnimations?.() ?? []) processAnimation(animation);
            } catch (error) {
              if (requireCompleteSubtreeEnumeration) {
                throw new Error("Initial motion discovery could not enumerate shadow-root animations", { cause: error });
              }
              motionErrorCount += 1;
            }
          }
        }
        const inspectComputedStyle = elements.length <= MAX_FULL_STYLE_DISCOVERY_DOCUMENT_ELEMENTS;
        for (let index = 0; index < elements.length && stillCurrent(); index += 1) {
          const element = elements[index];
          if (element) processElementRecoverably(element, inspectComputedStyle);
          if (index > 0 && index % MOTION_DISCOVERY_YIELD_EVERY === 0) {
            await yieldToPage();
          }
        }
      }
      for (let index = 0; index < exactElements.length; index += 1) {
        if (!stillCurrent()) return false;
        const element = exactElements[index];
        if (element) processElementRecoverably(element, true);
        if (index > 0 && index % MOTION_DISCOVERY_YIELD_EVERY === 0) {
          await yieldToPage();
        }
      }
      let candidatesSinceYield = 0;
      for (const [element, candidate] of candidates) {
        if (!stillCurrent()) return false;
        try {
          applyMotionCandidate(element, candidate);
        } catch {
          motionErrorCount += 1;
        }
        candidatesSinceYield += 1;
        if (candidatesSinceYield >= 25) {
          candidatesSinceYield = 0;
          await yieldToPage();
        }
      }
      let locksSinceYield = 0;
      for (const element of lockedMotionElements) {
        if (!stillCurrent()) return false;
        const lockedValues = lockedMotionValues.get(element);
        if (!lockedValues || element.isConnected === false || isConsentSuppressedElement(element)) continue;
        try {
          for (const [property, value] of lockedValues) {
            rememberMotionStyle(element, property, value);
          }
        } catch {
          motionErrorCount += 1;
        }
        locksSinceYield += 1;
        if (locksSinceYield >= 50) {
          locksSinceYield = 0;
          await yieldToPage();
        }
      }
      if (!stillCurrent()) return false;
      return dispatchHoverPause(candidates, stillCurrent);
    }
    function addPendingMotionRoot(root, includeDescendants) {
      if (!paused || !root || isExtensionElement(root) || isConsentSuppressedElement(root) || root.isConnected === false) return;
      if (!includeDescendants) {
        for (const pendingRoot of pendingMotionRoots) {
          if (pendingRoot === root || pendingRoot.contains(root)) return;
        }
        pendingMotionElements.add(root);
        return;
      }
      for (const pendingRoot of pendingMotionRoots) {
        if (pendingRoot === root || pendingRoot.contains(root)) {
          return;
        }
        if (root.contains(pendingRoot)) {
          pendingMotionRoots.delete(pendingRoot);
        }
      }
      for (const pendingElement of pendingMotionElements) {
        if (root === pendingElement || root.contains(pendingElement)) pendingMotionElements.delete(pendingElement);
      }
      pendingMotionRoots.add(root);
    }
    function scheduleMotionEnforcement(root, includeDescendants = false) {
      if (!paused) return;
      if (root) {
        addPendingMotionRoot(root, includeDescendants);
      }
      if (!motionInitialDiscoveryComplete) return;
      if (motionEnforcementScheduled || pendingMotionRoots.size === 0 && pendingMotionElements.size === 0) return;
      motionEnforcementScheduled = true;
      const enforce = async () => {
        motionEnforcementTimer = null;
        const expectedGeneration = motionFreezeGeneration;
        const roots = [...pendingMotionRoots];
        const elements = [...pendingMotionElements];
        pendingMotionRoots.clear();
        pendingMotionElements.clear();
        const documentAnimations = page.document?.getAnimations?.() ?? [];
        try {
          await pauseMotionSourcesBatch(roots, elements, documentAnimations, expectedGeneration);
        } catch {
          motionErrorCount += 1;
        } finally {
          motionEnforcementScheduled = false;
          if (pendingMotionRoots.size > 0 || pendingMotionElements.size > 0) {
            scheduleMotionEnforcement();
          }
        }
      };
      motionEnforcementTimer = originals.setTimeout.call(page, enforce, MOTION_MAINTENANCE_DELAY_MS);
    }
    function installMotionSourceHooks() {
      if (motionSourceHooksInstalled) return;
      motionSourceHooksInstalled = true;
      if (page.Element && originals.animate) {
        page.Element.prototype.animate = function patchedAnimate(keyframes, options) {
          const animation = originals.animate.call(this, keyframes, options);
          if (paused && !isExtensionElement(this) && !isConsentSuppressedElement(this)) {
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
          if (paused && !animationTargetIsExcluded(this)) {
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
          if (paused && !isExtensionElement(this) && !isConsentSuppressedElement(this)) {
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
    async function installMotionFreeze() {
      const documentElement = page.document?.documentElement;
      if (!documentElement || typeof documentElement.setAttribute !== "function") return;
      if (motionFreezeInstalled) {
        await motionInitialDiscoveryPromise;
        return;
      }
      installTimerBridge();
      motionFreezeInstalled = true;
      motionInitialDiscoveryComplete = false;
      lifecyclePhase = "discovering";
      motionFreezeGeneration += 1;
      const expectedGeneration = motionFreezeGeneration;
      documentElement.setAttribute("data-uf-page-motion-paused", "true");
      installMotionSourceHooks();
      if (!motionStyle) {
        motionStyle = page.document.createElement("style");
        motionStyle.setAttribute("data-uf-extension-ui", "true");
        motionStyle.setAttribute("data-uf-page-motion-style", "true");
        motionStyle.textContent = `
html[data-uf-page-motion-paused="true"],
html[data-uf-page-motion-paused="true"]::before,
html[data-uf-page-motion-paused="true"]::after,
html[data-uf-page-motion-paused="true"] body,
html[data-uf-page-motion-paused="true"] body::before,
html[data-uf-page-motion-paused="true"] body::after,
html[data-uf-page-motion-paused="true"] *:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *):not([data-uf-consent-hidden]):not([data-uf-consent-hidden] *),
html[data-uf-page-motion-paused="true"] *:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *):not([data-uf-consent-hidden]):not([data-uf-consent-hidden] *)::before,
html[data-uf-page-motion-paused="true"] *:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *):not([data-uf-consent-hidden]):not([data-uf-consent-hidden] *)::after {
  animation-play-state: paused !important;
  transition-property: none !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}
`;
        (page.document.head || documentElement).appendChild(motionStyle);
      }
      if (!motionObserver && page.MutationObserver) {
        motionObserver = new page.MutationObserver((records) => {
          for (const record of records) {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (record.type === "attributes") {
              if (!target || isExtensionElement(target) || isConsentSuppressedElement(target)) {
                continue;
              }
              if (record.attributeName === "style") {
                captureLatestAuthoredMotionStyles(target);
                if (motionLocksIntact(target)) continue;
              }
              if (record.attributeName === "class") {
                if (authoredClassTokens(record.oldValue) === authoredClassTokens(target.getAttribute?.("class"))) {
                  continue;
                }
              }
              addPendingMotionRoot(target, false);
              continue;
            }
            for (const node of Array.from(record.addedNodes ?? [])) {
              if (node.nodeType === 1) {
                addPendingMotionRoot(node, true);
              }
            }
          }
          scheduleMotionEnforcement();
        });
        motionObserver.observe(documentElement, motionObserverOptions);
        observedMotionRoots.add(documentElement);
      }
      if (motionEventCleanups.length === 0 && originals.addEventListener && originals.removeEventListener) {
        for (const type of ["animationstart", "animationiteration", "transitionrun", "play", "pointerover", "mouseover"]) {
          const listener = (event) => {
            const target = event.target?.nodeType === 1 ? event.target : null;
            if (target && !isConsentSuppressedElement(target)) {
              scheduleMotionEnforcement(target);
            }
          };
          originals.addEventListener.call(page.document, type, listener, true);
          motionEventCleanups.push(() => originals.removeEventListener?.call(page.document, type, listener, true));
        }
      }
      motionInitialDiscoveryPromise = (async () => {
        try {
          let documentAnimations;
          try {
            documentAnimations = page.document?.getAnimations?.() ?? [];
          } catch (error) {
            throw new Error("Initial motion discovery could not enumerate document animations", { cause: error });
          }
          const complete = await pauseMotionSourcesBatch(
            [documentElement],
            [],
            documentAnimations,
            expectedGeneration,
            true
          );
          if (expectedGeneration !== motionFreezeGeneration) {
            throw new SupersededMotionFreezeError();
          }
          if (paused) {
            if (!complete) {
              throw new Error("Initial motion discovery did not complete for the active generation");
            }
            motionInitialDiscoveryComplete = true;
            lifecyclePhase = "frozen";
            scheduleMotionEnforcement();
          }
        } catch (error) {
          if (!(error instanceof SupersededMotionFreezeError)) motionErrorCount += 1;
          throw error;
        }
      })();
      try {
        await motionInitialDiscoveryPromise;
      } finally {
        if (expectedGeneration === motionFreezeGeneration) motionInitialDiscoveryPromise = null;
      }
    }
    function releaseMotionFreeze() {
      motionFreezeGeneration += 1;
      motionInitialDiscoveryComplete = false;
      motionInitialDiscoveryPromise = null;
      motionObserver?.disconnect();
      motionObserver = null;
      observedMotionRoots = /* @__PURE__ */ new WeakSet();
      runCleanupsSafely(motionEventCleanups);
      pendingMotionRoots.clear();
      pendingMotionElements.clear();
      if (motionEnforcementTimer !== null) {
        originals.clearTimeout.call(page, motionEnforcementTimer);
        motionEnforcementTimer = null;
      }
      motionEnforcementScheduled = false;
      motionFreezeInstalled = false;
      motionStyle?.remove();
      motionStyle = null;
      for (const style of motionShadowStyles.values()) style.remove();
      motionShadowStyles.clear();
      page.document?.documentElement?.removeAttribute?.("data-uf-page-motion-paused");
      restoreMotionSourceHooks();
      if (page.Event) {
        for (const element of hoverPauseTargets) {
          try {
            element.dispatchEvent(new page.Event("pointerleave", { bubbles: false }));
            element.dispatchEvent(new page.Event("mouseleave", { bubbles: false }));
            element.dispatchEvent(new page.Event("mouseout", { bubbles: true }));
          } catch {
            motionErrorCount += 1;
          }
        }
      }
      hoverPauseTargets.clear();
      for (let index = normalizedMotionStyles.length - 1; index >= 0; index -= 1) {
        const remembered = normalizedMotionStyles[index];
        if (!remembered) continue;
        if (remembered.value) {
          remembered.element.style.setProperty(remembered.property, remembered.value, remembered.priority);
        } else {
          remembered.element.style.removeProperty(remembered.property);
        }
        normalizedProperties.get(remembered.element)?.delete(remembered.property);
        lockedMotionValues.get(remembered.element)?.delete(remembered.property);
      }
      normalizedMotionStyles.length = 0;
      lockedMotionElements.clear();
      for (const [element, ledger] of motionStyleLedgers) {
        normalizedMotionStyleRecords.delete(element);
        normalizedProperties.delete(element);
        lockedMotionValues.delete(element);
        element.removeAttribute(MOTION_CAPTURE_LEDGER_ATTR);
        if (!ledger.hadStyleAttribute && !(element.getAttribute("style") ?? "").trim()) {
          element.removeAttribute("style");
        }
      }
      motionStyleLedgers.clear();
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
      for (const [svg, wasPaused] of pausedSvgRoots) {
        try {
          if (!wasPaused) svg.unpauseAnimations();
        } catch {
          motionErrorCount += 1;
        }
      }
      pausedSvgRoots.clear();
      lifecyclePhase = armed ? "armed" : "idle";
    }
    function installTimerBridge() {
      if (installed) return;
      installed = true;
      page.setTimeout = function patchedSetTimeout(callback, delay, ...args) {
        const defer = () => {
          nextDeferredTimerId -= 1;
          const token = {
            type: "timeout",
            callback,
            args,
            cancelled: false,
            nativeId: nextDeferredTimerId,
            tokenAliases: /* @__PURE__ */ new Set([nextDeferredTimerId])
          };
          trackTimerAlias(timeoutTokens, token, nextDeferredTimerId);
          queued.push(token);
          return token;
        };
        if (paused) return defer().nativeId;
        let externalTokenAssigned = false;
        let synchronouslyDeferred = null;
        const externalToken = originals.setTimeout.call(page, () => {
          if (paused) {
            const deferred = defer();
            if (externalTokenAssigned) trackTimerAlias(timeoutTokens, deferred, externalToken);
            else synchronouslyDeferred = deferred;
            return;
          }
          executeTimeoutHandler(callback, args);
        }, delay);
        externalTokenAssigned = true;
        if (synchronouslyDeferred) trackTimerAlias(timeoutTokens, synchronouslyDeferred, externalToken);
        return externalToken;
      };
      page.clearTimeout = function patchedClearTimeout(token) {
        if (cancelTrackedTimer(timeoutTokens, token)) return;
        return originals.clearTimeout.call(page, token);
      };
      page.setInterval = function patchedSetInterval(callback, delay, ...args) {
        return originals.setInterval.call(page, function intervalGate() {
          if (paused) return;
          executeTimeoutHandler(callback, args);
        }, delay);
      };
      page.clearInterval = function patchedClearInterval(token) {
        return originals.clearInterval.call(page, token);
      };
      page.requestAnimationFrame = function patchedRequestAnimationFrame(callback) {
        if (typeof callback !== "function") {
          return originals.requestAnimationFrame.call(page, callback);
        }
        const defer = () => {
          nextDeferredFrameId -= 1;
          const token = {
            type: "raf",
            callback,
            args: [],
            cancelled: false,
            nativeId: nextDeferredFrameId,
            tokenAliases: /* @__PURE__ */ new Set([nextDeferredFrameId])
          };
          trackTimerAlias(rafTokens, token, nextDeferredFrameId);
          queued.push(token);
          return token;
        };
        if (paused) return defer().nativeId;
        let externalTokenAssigned = false;
        let synchronouslyDeferred = null;
        const externalToken = originals.requestAnimationFrame.call(page, (now) => {
          if (paused) {
            const deferred = defer();
            if (externalTokenAssigned) trackTimerAlias(rafTokens, deferred, externalToken);
            else synchronouslyDeferred = deferred;
            return;
          }
          callback.call(page, now);
        });
        externalTokenAssigned = true;
        if (synchronouslyDeferred) trackTimerAlias(rafTokens, synchronouslyDeferred, externalToken);
        return externalToken;
      };
      page.cancelAnimationFrame = function patchedCancelAnimationFrame(token) {
        if (cancelTrackedTimer(rafTokens, token)) return;
        return originals.cancelAnimationFrame?.call(page, token);
      };
      if (originals.requestIdleCallback) {
        page.requestIdleCallback = function patchedRequestIdleCallback(callback, options) {
          const defer = () => {
            nextDeferredIdleId -= 1;
            const token = {
              type: "idle",
              callback,
              args: [],
              cancelled: false,
              nativeId: nextDeferredIdleId,
              tokenAliases: /* @__PURE__ */ new Set([nextDeferredIdleId])
            };
            trackTimerAlias(idleTokens, token, nextDeferredIdleId);
            queued.push(token);
            return token;
          };
          if (paused) return defer().nativeId;
          let externalTokenAssigned = false;
          let synchronouslyDeferred = null;
          const externalToken = originals.requestIdleCallback.call(page, (deadline) => {
            if (paused) {
              const deferred = defer();
              if (externalTokenAssigned) trackTimerAlias(idleTokens, deferred, externalToken);
              else synchronouslyDeferred = deferred;
              return;
            }
            callback.call(page, deadline);
          }, options);
          externalTokenAssigned = true;
          if (synchronouslyDeferred) trackTimerAlias(idleTokens, synchronouslyDeferred, externalToken);
          return externalToken;
        };
        page.cancelIdleCallback = function patchedCancelIdleCallback(token) {
          if (cancelTrackedTimer(idleTokens, token)) return;
          return originals.cancelIdleCallback?.call(page, token);
        };
      }
    }
    function installLazyLoadingBridge() {
      if (lazyBridgeInstalled) return;
      lazyBridgeInstalled = true;
      if (originals.IntersectionObserver) {
        const PatchedIntersectionObserver = function PatchedIntersectionObserver2(callback, options) {
          return Reflect.construct(originals.IntersectionObserver, [(entries, observer) => {
            if (!lazySuppressed) callback(entries, observer);
          }, options], new.target || PatchedIntersectionObserver2);
        };
        page.IntersectionObserver = PatchedIntersectionObserver;
        installedIntersectionObserver = PatchedIntersectionObserver;
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
        installedResizeObserver = PatchedResizeObserver;
        page.ResizeObserver.prototype = originals.ResizeObserver.prototype;
        Object.setPrototypeOf(page.ResizeObserver, originals.ResizeObserver);
      }
      patchLazyTarget = (target, originalAddEventListener, originalRemoveEventListener) => {
        if (!originalAddEventListener || !originalRemoveEventListener || patchedLazyTargets.has(target)) return;
        const mutableTarget = target;
        const patchedAddEventListener = function patchedAddEventListener2(type, listener, options) {
          const isLazyEvent = ["scroll", "wheel", "touchmove"].includes(String(type));
          const callable = typeof listener === "function" || listener && typeof listener.handleEvent === "function";
          if (!isLazyEvent || !callable || !listener) {
            return originalAddEventListener.call(target, type, listener, options);
          }
          const capture = listenerCapture(options);
          const once = listenerOnce(options);
          const signal = listenerSignal(options);
          const transferOptions = snapshotListenerOptions(options);
          if (signal?.aborted) {
            return originalAddEventListener.call(target, type, listener, options);
          }
          if (wrappedEventRegistrations.some(
            (registration2) => registration2.target === target && registration2.type === type && registration2.listener === listener && registration2.capture === capture
          )) {
            return void 0;
          }
          let nativeOptions = options;
          if (options && typeof options === "object") {
            const wrappedOptions = { once: false };
            if ("capture" in options) wrappedOptions.capture = capture;
            if ("passive" in options) wrappedOptions.passive = Boolean(options.passive);
            if ("signal" in options && signal) wrappedOptions.signal = signal;
            nativeOptions = wrappedOptions;
          }
          const wrapped = function lazySuppressionGate(event) {
            if (lazySuppressed && (target === page || target === page.document || target === nestedLazyViewportOwner)) return;
            if (once && forgetWrappedRegistration(registration)) {
              originalRemoveEventListener.call(target, type, wrapped, capture);
            }
            if (typeof listener === "function") {
              listener.call(target, event);
            } else {
              listener.handleEvent.call(listener, event);
            }
          };
          const abortListener = signal ? (() => {
            if (forgetWrappedRegistration(registration)) {
              originalRemoveEventListener.call(target, type, wrapped, capture);
            }
          }) : void 0;
          const registration = {
            target,
            type,
            listener,
            wrapped,
            options: transferOptions,
            capture,
            once,
            signal,
            abortListener,
            nativeRemoveEventListener: originalRemoveEventListener
          };
          wrappedEventRegistrations.push(registration);
          signal?.addEventListener("abort", abortListener, { once: true });
          try {
            return originalAddEventListener.call(target, type, wrapped, nativeOptions);
          } catch (error) {
            forgetWrappedRegistration(registration);
            throw error;
          }
        };
        const patchedRemoveEventListener = function patchedRemoveEventListener2(type, listener, options) {
          const registration = removeWrappedRegistration(target, type, listener, listenerCapture(options));
          return originalRemoveEventListener.call(target, type, registration?.wrapped || listener, options);
        };
        mutableTarget.addEventListener = patchedAddEventListener;
        mutableTarget.removeEventListener = patchedRemoveEventListener;
        lazyTargetRestorations.push(() => {
          if (mutableTarget.addEventListener === patchedAddEventListener) {
            mutableTarget.addEventListener = originalAddEventListener;
          }
          if (mutableTarget.removeEventListener === patchedRemoveEventListener) {
            mutableTarget.removeEventListener = originalRemoveEventListener;
          }
        });
        patchedLazyTargets.add(target);
      };
      patchLazyTarget(page, originals.rootAddEventListener, originals.rootRemoveEventListener);
      patchLazyTarget(page.document, originals.documentAddEventListener, originals.documentRemoveEventListener);
      if (originals.documentAddEventListener) {
        for (const type of ["scroll", "wheel", "touchmove"]) {
          const captureGate = (event) => {
            if (!lazySuppressed || !nestedLazyViewportOwner) return;
            const target = event.target;
            try {
              if (target !== nestedLazyViewportOwner && (!target || !nestedLazyViewportOwner.contains(target))) return;
              event.stopImmediatePropagation?.();
              event.stopPropagation?.();
            } catch {
              nestedLazyViewportOwner = null;
            }
          };
          originals.documentAddEventListener.call(page.document, type, captureGate, {
            capture: true,
            passive: true
          });
          lazyEventCleanups.push(() => {
            try {
              originals.documentRemoveEventListener?.call(page.document, type, captureGate, true);
            } catch {
            }
            if (originals.removeEventListener !== originals.documentRemoveEventListener) {
              originals.removeEventListener?.call(page.document, type, captureGate, true);
            }
          });
        }
      }
    }
    function finiteNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }
    function composedParentElement(element) {
      if (element.parentElement) return element.parentElement;
      try {
        const root = element.getRootNode?.();
        return root && "host" in root && root.host ? root.host : null;
      } catch {
        return null;
      }
    }
    function composedLazyElementsFromPoint(x, y) {
      const document = page.document;
      if (!document) return [];
      const result = [];
      const seenElements = /* @__PURE__ */ new Set();
      const seenRoots = /* @__PURE__ */ new Set();
      const visit = (root) => {
        if (seenRoots.has(root) || result.length >= MAX_VIEWPORT_OWNER_HITS_PER_POINT) return;
        seenRoots.add(root);
        if (root !== document) observeLazyOwnerMutationRoot(root);
        let hits;
        try {
          if (typeof root.elementsFromPoint !== "function") return;
          hits = Array.from(root.elementsFromPoint(x, y));
        } catch {
          return;
        }
        for (const hit of hits) {
          if (result.length >= MAX_VIEWPORT_OWNER_HITS_PER_POINT) break;
          try {
            const shadow = hit.shadowRoot;
            if (shadow?.mode === "open") visit(shadow);
          } catch {
          }
          if (!seenElements.has(hit) && result.length < MAX_VIEWPORT_OWNER_HITS_PER_POINT) {
            seenElements.add(hit);
            result.push(hit);
          }
        }
      };
      visit(document);
      return result;
    }
    function composedElementWithin(element, ancestor) {
      let cursor = element;
      for (let depth = 0; cursor && depth < MAX_VIEWPORT_OWNER_ANCESTOR_DEPTH; depth += 1) {
        if (cursor === ancestor) return true;
        cursor = composedParentElement(cursor);
      }
      return false;
    }
    function couldOwnLazyViewport(element) {
      if (element.isConnected === false || isExtensionElement(element) || isConsentSuppressedElement(element) || finiteNumber(element.scrollHeight) - finiteNumber(element.clientHeight) <= 2) return false;
      const documentElement = page.document?.documentElement;
      const viewportWidth = Math.max(1, finiteNumber(page.innerWidth) || finiteNumber(documentElement?.clientWidth));
      const viewportHeight = Math.max(1, finiteNumber(page.innerHeight) || finiteNumber(documentElement?.clientHeight));
      try {
        const overflowY = String(page.getComputedStyle?.(element).overflowY || "").toLowerCase();
        if (!/^(auto|scroll|overlay|hidden)$/.test(overflowY)) return false;
        const rect = element.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(0, rect.left));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(0, rect.top));
        return visibleWidth * visibleHeight >= viewportWidth * viewportHeight * 0.45 && finiteNumber(rect.width) >= viewportWidth * 0.55 && finiteNumber(rect.height) >= viewportHeight * 0.55;
      } catch {
        return false;
      }
    }
    function boundedLazyOwnerCandidates(root, limit = 64) {
      const result = [];
      const pending = [root];
      while (pending.length > 0 && result.length < limit) {
        const element = pending.pop();
        if (isExtensionElement(element) || isConsentSuppressedElement(element)) continue;
        result.push(element);
        const lightChildren = Array.from(element.children);
        for (let index = lightChildren.length - 1; index >= 0; index -= 1) {
          pending.push(lightChildren[index]);
        }
        try {
          const shadow = element.shadowRoot;
          if (shadow?.mode === "open") {
            observeLazyOwnerMutationRoot(shadow);
            const shadowChildren = Array.from(shadow.children);
            for (let index = shadowChildren.length - 1; index >= 0; index -= 1) {
              pending.push(shadowChildren[index]);
            }
          }
        } catch {
        }
      }
      return result;
    }
    function lazyOwnerMutationRequiresRefresh(records) {
      const owner = nestedLazyViewportOwner;
      if (owner && (owner.isConnected === false || finiteNumber(owner.scrollHeight) - finiteNumber(owner.clientHeight) <= 2)) return true;
      for (const record of records) {
        if (record.type === "attributes") {
          const target = record.target;
          if (target.nodeType !== 1) continue;
          const elementTarget = target;
          const isDocumentRoot = elementTarget === page.document.documentElement || elementTarget === page.document.body;
          if (isDocumentRoot && record.attributeName === "class" && authoredClassTokens(record.oldValue) === authoredClassTokens(elementTarget.getAttribute?.("class"))) {
            continue;
          }
          if (isDocumentRoot || owner && composedElementWithin(owner, elementTarget) || couldOwnLazyViewport(elementTarget)) return true;
          continue;
        }
        if (record.type !== "childList") continue;
        if (owner) {
          for (const removed of Array.from(record.removedNodes)) {
            if (removed.nodeType === 1 && composedElementWithin(owner, removed)) return true;
          }
        }
        for (const added of Array.from(record.addedNodes)) {
          if (added.nodeType !== 1) continue;
          if (boundedLazyOwnerCandidates(added).some(couldOwnLazyViewport)) return true;
        }
      }
      return false;
    }
    function observeLazyOwnerMutationRoot(root) {
      if (!lazyOwnerObserver || observedLazyOwnerRoots.has(root)) return;
      try {
        lazyOwnerObserver.observe(root, {
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ["aria-hidden", "class", "hidden", "inert", "style"],
          childList: true,
          subtree: true
        });
        observedLazyOwnerRoots.add(root);
      } catch {
      }
    }
    function scheduleNestedLazyViewportOwnerRefresh() {
      if (!lazySuppressed || lazyOwnerRefreshScheduled) return;
      lazyOwnerRefreshScheduled = true;
      lazyOwnerRefreshToken = originals.setTimeout.call(page, () => {
        lazyOwnerRefreshScheduled = false;
        lazyOwnerRefreshToken = null;
        if (lazySuppressed) refreshNestedLazyViewportOwner();
      }, 0);
    }
    function stopLazyOwnerLifecycle() {
      lazyOwnerObserver?.disconnect();
      lazyOwnerObserver = null;
      observedLazyOwnerRoots = /* @__PURE__ */ new WeakSet();
      if (lazyOwnerRefreshScheduled && lazyOwnerRefreshToken !== null) {
        try {
          originals.clearTimeout.call(page, lazyOwnerRefreshToken);
        } catch {
        }
      }
      lazyOwnerRefreshScheduled = false;
      lazyOwnerRefreshToken = null;
      lazyOwnerMovementProofs = /* @__PURE__ */ new WeakMap();
    }
    function startLazyOwnerLifecycle() {
      stopLazyOwnerLifecycle();
      if (!page.MutationObserver || !page.document?.documentElement) return;
      try {
        lazyOwnerObserver = new page.MutationObserver((records) => {
          if (lazySuppressed && lazyOwnerMutationRequiresRefresh(records)) {
            lazyOwnerMovementProofs = /* @__PURE__ */ new WeakMap();
            scheduleNestedLazyViewportOwnerRefresh();
          }
        });
        observeLazyOwnerMutationRoot(page.document.documentElement);
      } catch {
        lazyOwnerObserver = null;
      }
    }
    function lazyProbeGeometry(probes) {
      return probes.map((probe) => {
        try {
          const rect = probe.getBoundingClientRect();
          return `${Math.round(rect.top * 2) / 2}:${Math.round(rect.bottom * 2) / 2}`;
        } catch {
          return "unmeasurable";
        }
      }).join("|");
    }
    function isInFlowLazyProbe(element) {
      if (isExtensionElement(element) || isConsentSuppressedElement(element)) return false;
      try {
        const position = String(page.getComputedStyle?.(element).position || "").toLowerCase();
        return position !== "fixed" && position !== "sticky";
      } catch {
        return true;
      }
    }
    function appendLazyProbe(probesByOwner, owner, probe) {
      const probes = probesByOwner.get(owner) ?? [];
      if (probes.length < 8 && !probes.includes(probe)) {
        probes.push(probe);
        probesByOwner.set(owner, probes);
      }
    }
    function nestedLazyCapacityDominatesDocument(nestedRange, documentRange, viewportExtent) {
      return nestedRange >= Math.max(
        viewportExtent,
        documentRange * DOMINANT_NESTED_RANGE_RATIO
      ) && nestedRange - documentRange >= viewportExtent * DOMINANT_NESTED_EXTRA_VIEWPORTS;
    }
    function proveLazyOwnerMovement(element, maximumOffset, viewportExtent, currentOffset, currentInlineOffset, scrollTo, probes) {
      const usableProbes = probes.filter((probe) => probe !== element).slice(0, 8);
      const probeGeometry = lazyProbeGeometry(usableProbes);
      const cached = lazyOwnerMovementProofs.get(element);
      if (cached && Math.abs(cached.maximumOffset - maximumOffset) <= 2 && Math.abs(cached.viewportExtent - viewportExtent) <= 2 && cached.probes.length === usableProbes.length && cached.probes.every((probe, index) => probe === usableProbes[index]) && cached.probeGeometry === probeGeometry) {
        return cached.moved;
      }
      if (usableProbes.length === 0 || maximumOffset <= 2) {
        lazyOwnerMovementProofs.set(element, {
          maximumOffset,
          viewportExtent,
          probes: usableProbes,
          probeGeometry,
          moved: null
        });
        return null;
      }
      const beforeTop = currentOffset();
      const beforeLeft = currentInlineOffset();
      const delta = Math.min(4, maximumOffset);
      const target = beforeTop + delta <= maximumOffset ? beforeTop + delta : Math.max(0, beforeTop - delta);
      let moved;
      try {
        const rectsBefore = usableProbes.map((probe) => probe.getBoundingClientRect());
        scrollTo(target, beforeLeft);
        const appliedDelta = currentOffset() - beforeTop;
        const expectedVisualDelta = -appliedDelta;
        moved = Math.abs(appliedDelta) >= 0.5 && usableProbes.some((probe, index) => {
          const after = probe.getBoundingClientRect();
          const before = rectsBefore[index];
          const coupled = (visualDelta) => Math.abs(visualDelta) >= 0.5 && Math.sign(visualDelta) === Math.sign(expectedVisualDelta) && Math.abs(visualDelta - expectedVisualDelta) <= 1;
          return coupled(after.top - before.top) || coupled(after.bottom - before.bottom);
        });
      } catch {
        moved = null;
      } finally {
        try {
          scrollTo(beforeTop, beforeLeft);
        } catch {
          moved = false;
        }
      }
      lazyOwnerMovementProofs.set(element, {
        maximumOffset,
        viewportExtent,
        probes: usableProbes,
        probeGeometry: lazyProbeGeometry(usableProbes),
        moved
      });
      return moved;
    }
    function resolveNestedLazyViewportOwner() {
      const documentElement = page.document?.documentElement;
      if (!documentElement || !page.getComputedStyle) return null;
      const viewportWidth = Math.max(1, finiteNumber(page.innerWidth) || finiteNumber(documentElement.clientWidth));
      const viewportHeight = Math.max(1, finiteNumber(page.innerHeight) || finiteNumber(documentElement.clientHeight));
      const points = [
        [0.5, 0.5],
        [0.12, 0.12],
        [0.5, 0.12],
        [0.88, 0.12],
        [0.12, 0.5],
        [0.88, 0.5],
        [0.12, 0.88],
        [0.5, 0.88],
        [0.88, 0.88]
      ];
      const candidates = /* @__PURE__ */ new Set();
      const memberships = /* @__PURE__ */ new Map();
      const visualProbesByCandidate = /* @__PURE__ */ new Map();
      const documentVisualProbes = [];
      if (typeof page.document.elementsFromPoint === "function") {
        for (let sample = 0; sample < points.length; sample += 1) {
          const [xRatio, yRatio] = points[sample];
          const hits = composedLazyElementsFromPoint(
            viewportWidth * xRatio,
            viewportHeight * yRatio
          );
          for (const hit of hits) {
            const hitIsProbe = isInFlowLazyProbe(hit);
            if (hitIsProbe && documentVisualProbes.length < 8 && !documentVisualProbes.includes(hit)) {
              documentVisualProbes.push(hit);
            }
            let cursor = hit;
            for (let depth = 0; cursor && depth < MAX_VIEWPORT_OWNER_ANCESTOR_DEPTH; depth += 1) {
              const element = cursor;
              if (candidates.has(element) || candidates.size < MAX_VIEWPORT_OWNER_CANDIDATES) {
                candidates.add(element);
                const membership = memberships.get(element) ?? /* @__PURE__ */ new Set();
                membership.add(sample);
                memberships.set(element, membership);
                if (element !== hit && hitIsProbe) appendLazyProbe(visualProbesByCandidate, element, hit);
              }
              cursor = composedParentElement(cursor);
            }
          }
        }
      }
      try {
        const pending = [documentElement];
        let visited = 0;
        while (pending.length > 0 && visited < MAX_VIEWPORT_OWNER_TREE_WALK && candidates.size < MAX_VIEWPORT_OWNER_CANDIDATES) {
          const element = pending.pop();
          visited += 1;
          if (isExtensionElement(element) || isConsentSuppressedElement(element)) continue;
          candidates.add(element);
          const lightChildren = Array.from(element.children);
          for (let index = lightChildren.length - 1; index >= 0; index -= 1) {
            pending.push(lightChildren[index]);
          }
          try {
            const shadowChildren = element.shadowRoot?.mode === "open" ? Array.from(element.shadowRoot.children) : [];
            if (element.shadowRoot?.mode === "open") {
              observeLazyOwnerMutationRoot(element.shadowRoot);
            }
            for (let index = shadowChildren.length - 1; index >= 0; index -= 1) {
              pending.push(shadowChildren[index]);
            }
          } catch {
          }
        }
      } catch {
      }
      const rankedCandidates = [];
      for (const candidate of candidates) {
        if (candidate === documentElement || candidate === page.document.body || candidate.isConnected === false || isExtensionElement(candidate) || isConsentSuppressedElement(candidate)) continue;
        const range = finiteNumber(candidate.scrollHeight) - finiteNumber(candidate.clientHeight);
        if (range <= 2) continue;
        let overflowY;
        let rect;
        try {
          overflowY = String(page.getComputedStyle(candidate).overflowY || "").toLowerCase();
          rect = candidate.getBoundingClientRect();
        } catch {
          continue;
        }
        if (!/^(auto|scroll|overlay|hidden)$/.test(overflowY)) continue;
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        const coverage = visibleWidth * visibleHeight / (viewportWidth * viewportHeight);
        const sampleCoverage = (memberships.get(candidate)?.size ?? 0) / points.length;
        if (coverage < 0.45 || finiteNumber(rect.width) < viewportWidth * 0.55 || finiteNumber(rect.height) < viewportHeight * 0.55 || sampleCoverage < 0.22 && coverage < 0.85) continue;
        const viewportCoupling = Math.abs(rect.left) <= viewportWidth * 0.12 && Math.abs(rect.top) <= viewportHeight * 0.12 && Math.abs(rect.right - viewportWidth) <= viewportWidth * 0.12 && Math.abs(rect.bottom - viewportHeight) <= viewportHeight * 0.12 ? 1 : 0;
        const score = coverage * 4 + sampleCoverage * 3 + viewportCoupling * 2 + Math.min(1, Math.log2(range + 1) / 16) + (overflowY === "hidden" ? 0.25 : 0);
        rankedCandidates.push({ element: candidate, score, range });
      }
      rankedCandidates.sort((left, right) => right.score - left.score || right.range - left.range);
      const scrollingElement = page.document.scrollingElement || documentElement;
      const documentHeight = Math.max(
        finiteNumber(scrollingElement.scrollHeight),
        finiteNumber(documentElement.scrollHeight),
        finiteNumber(page.document.body?.scrollHeight)
      );
      const documentMaximumOffset = Math.max(0, documentHeight - viewportHeight);
      const documentHasRange = documentMaximumOffset > 2;
      let documentOverflowLocked = false;
      try {
        const rootOverflow = String(page.getComputedStyle(documentElement).overflowY || "").toLowerCase();
        const bodyOverflow = page.document.body ? String(page.getComputedStyle(page.document.body).overflowY || "").toLowerCase() : rootOverflow;
        documentOverflowLocked = /^(hidden|clip)$/.test(rootOverflow) || /^(hidden|clip)$/.test(bodyOverflow);
      } catch {
      }
      const movementCandidates = rankedCandidates.slice(0, MAX_VIEWPORT_OWNER_MOVEMENT_PROOFS);
      const proveCandidate = (candidate) => {
        const nestedProbes = visualProbesByCandidate.get(candidate.element) ?? [];
        const firstChild = candidate.element.firstElementChild;
        if (nestedProbes.length === 0 && firstChild && isInFlowLazyProbe(firstChild)) {
          nestedProbes.push(firstChild);
        }
        return proveLazyOwnerMovement(
          candidate.element,
          candidate.range,
          Math.max(1, finiteNumber(candidate.element.clientHeight)),
          () => finiteNumber(candidate.element.scrollTop),
          () => finiteNumber(candidate.element.scrollLeft),
          (top, left) => {
            try {
              candidate.element.scrollTo({ top, left, behavior: "auto" });
            } catch {
              candidate.element.scrollTop = top;
              candidate.element.scrollLeft = left;
            }
          },
          nestedProbes
        );
      };
      if (!documentHasRange || documentOverflowLocked) {
        let unprovenFallback = null;
        for (const candidate of movementCandidates) {
          const movement = proveCandidate(candidate);
          if (movement === true) return candidate.element;
          if (movement === null && !unprovenFallback) unprovenFallback = candidate.element;
        }
        return unprovenFallback;
      }
      const documentMovement = proveLazyOwnerMovement(
        scrollingElement,
        documentMaximumOffset,
        viewportHeight,
        () => Math.max(finiteNumber(page.scrollY), finiteNumber(scrollingElement.scrollTop)),
        () => Math.max(finiteNumber(page.scrollX), finiteNumber(scrollingElement.scrollLeft)),
        (top, left) => {
          try {
            if (page.scrollTo) {
              page.scrollTo({ top, left, behavior: "auto" });
              return;
            }
          } catch {
          }
          scrollingElement.scrollTop = top;
          scrollingElement.scrollLeft = left;
        },
        documentVisualProbes
      );
      if (documentMovement === false) {
        for (const candidate of movementCandidates) {
          if (proveCandidate(candidate) === true) return candidate.element;
        }
      } else {
        for (const candidate of movementCandidates) {
          if (nestedLazyCapacityDominatesDocument(
            candidate.range,
            documentMaximumOffset,
            viewportHeight
          ) && proveCandidate(candidate) === true) return candidate.element;
        }
      }
      return null;
    }
    function refreshNestedLazyViewportOwner() {
      nestedLazyViewportOwner = resolveNestedLazyViewportOwner();
      if (!nestedLazyViewportOwner) return;
      const owner = nestedLazyViewportOwner;
      try {
        const root = owner.getRootNode?.();
        if (root && root !== page.document) observeLazyOwnerMutationRoot(root);
      } catch {
      }
      const originalAddEventListener = owner.addEventListener;
      const originalRemoveEventListener = owner.removeEventListener;
      if (!nestedLazyCaptureTargets.has(owner)) {
        try {
          for (const type of ["scroll", "wheel", "touchmove"]) {
            const captureGate = (event) => {
              if (!lazySuppressed || nestedLazyViewportOwner !== owner) return;
              event.stopImmediatePropagation?.();
              event.stopPropagation?.();
            };
            originalAddEventListener.call(owner, type, captureGate, { capture: true, passive: true });
            lazyEventCleanups.push(() => {
              try {
                originalRemoveEventListener.call(owner, type, captureGate, true);
              } catch {
              }
              if (originals.removeEventListener !== originalRemoveEventListener) {
                originals.removeEventListener?.call(owner, type, captureGate, true);
              }
            });
          }
          nestedLazyCaptureTargets.add(owner);
        } catch {
        }
      }
      try {
        patchLazyTarget(owner, originalAddEventListener, originalRemoveEventListener);
      } catch {
      }
    }
    function forgetWrappedRegistration(registration) {
      const index = wrappedEventRegistrations.indexOf(registration);
      if (index < 0) return false;
      wrappedEventRegistrations.splice(index, 1);
      if (registration.signal && registration.abortListener) {
        try {
          registration.signal.removeEventListener("abort", registration.abortListener);
        } catch {
        }
      }
      return true;
    }
    function removeWrappedRegistration(target, type, listener, capture) {
      for (let index = wrappedEventRegistrations.length - 1; index >= 0; index -= 1) {
        const registration = wrappedEventRegistrations[index];
        if (registration.target === target && registration.type === type && registration.listener === listener && registration.capture === capture) {
          forgetWrappedRegistration(registration);
          return registration;
        }
      }
      return null;
    }
    function restoreTimerBridge(force = false) {
      if (!installed) return;
      if (!force && (paused || queued.length > 0 || pendingTimerFlushHandles.size > 0)) {
        timerBridgeRestoreRequested = true;
        return;
      }
      if (force) {
        timerDeliveryEpoch += 1;
        for (const handle of pendingTimerFlushHandles) originals.clearTimeout.call(page, handle);
        pendingTimerFlushHandles.clear();
        pendingTimerFlushItems.clear();
        queued.length = 0;
      }
      page.setTimeout = originals.setTimeout;
      page.clearTimeout = originals.clearTimeout;
      page.setInterval = originals.setInterval;
      page.clearInterval = originals.clearInterval;
      page.requestAnimationFrame = originals.requestAnimationFrame;
      page.cancelAnimationFrame = originals.cancelAnimationFrame;
      page.requestIdleCallback = originals.requestIdleCallback;
      page.cancelIdleCallback = originals.cancelIdleCallback;
      installed = false;
      paused = false;
      timerBridgeRestoreRequested = false;
      timeoutTokens.clear();
      rafTokens.clear();
      idleTokens.clear();
    }
    function flushQueued() {
      const pending = queued.splice(0);
      if (pending.length === 0) {
        if (timerBridgeRestoreRequested) restoreTimerBridge();
        return;
      }
      for (const item of pending) pendingTimerFlushItems.add(item);
      const expectedDeliveryEpoch = timerDeliveryEpoch;
      let completedSynchronously = false;
      const flushRecord = {};
      const deliver = () => {
        completedSynchronously = true;
        pendingTimerFlushHandles.delete(flushRecord.handle);
        for (const item of pending) pendingTimerFlushItems.delete(item);
        if (expectedDeliveryEpoch !== timerDeliveryEpoch) return;
        if (paused) {
          const deliverable = pending.filter((item) => !item.cancelled);
          queued.unshift(...deliverable);
          return;
        }
        for (const item of pending) {
          if (item.cancelled) continue;
          try {
            if (item.type === "raf") {
              forgetTimerAliases(rafTokens, item);
              item.callback.call(page, performance.now());
            } else if (item.type === "idle") {
              forgetTimerAliases(idleTokens, item);
              item.callback.call(page, {
                didTimeout: false,
                timeRemaining: () => 0
              });
            } else {
              forgetTimerAliases(timeoutTokens, item);
              executeTimeoutHandler(item.callback, item.args);
            }
          } catch (error) {
            originals.setTimeout.call(page, () => {
              throw error;
            }, 0);
          }
        }
        if (timerBridgeRestoreRequested) restoreTimerBridge();
      };
      const flushHandle = originals.setTimeout.call(page, deliver, 0);
      flushRecord.handle = flushHandle;
      if (!completedSynchronously) pendingTimerFlushHandles.add(flushHandle);
    }
    function normalizeCommand(command) {
      if (command === "PAGE_WORLD_ARM") return "ARM";
      if (command === "PAGE_WORLD_SET_MOTION_PAUSED") return "SET_MOTION_PAUSED";
      if (command === "PAGE_WORLD_SET_LAZY_LOADING_SUPPRESSED") return "SET_LAZY_LOADING_SUPPRESSED";
      if (command === "PAGE_WORLD_DESTROY") return "DESTROY";
      return command;
    }
    function normalizedNavigationDocumentUrl(value) {
      if (value === void 0 || value === null || value === "") return null;
      try {
        const url = new URL(String(value), page.location.href);
        return `${url.origin}${url.pathname}${url.search}`;
      } catch {
        return null;
      }
    }
    function restoreNavigationGuardHooks() {
      const history = page.history;
      if (history && guardedPushState && history.pushState === guardedPushState && originals.historyPushState) {
        history.pushState = originals.historyPushState;
      }
      if (history && guardedReplaceState && history.replaceState === guardedReplaceState && originals.historyReplaceState) {
        history.replaceState = originals.historyReplaceState;
      }
      if (history && guardedBack && history.back === guardedBack && originals.historyBack) {
        history.back = originals.historyBack;
      }
      if (history && guardedForward && history.forward === guardedForward && originals.historyForward) {
        history.forward = originals.historyForward;
      }
      if (history && guardedGo && history.go === guardedGo && originals.historyGo) {
        history.go = originals.historyGo;
      }
      if (guardedNavigationListener) {
        page.navigation?.removeEventListener?.("navigate", guardedNavigationListener);
      }
      guardedPushState = null;
      guardedReplaceState = null;
      guardedBack = null;
      guardedForward = null;
      guardedGo = null;
      guardedNavigationListener = null;
    }
    function approveDirtyNavigation(target) {
      if (!navigationGuardActive) return true;
      const current = normalizedNavigationDocumentUrl(page.location.href);
      const next = normalizedNavigationDocumentUrl(target);
      if (next !== null && next === current) return true;
      const approved = page.confirm?.(
        "Leaving this page discards your unsaved Unfluffify markings. Continue?"
      ) === true;
      if (!approved) return false;
      navigationGuardActive = false;
      restoreNavigationGuardHooks();
      return true;
    }
    function setNavigationGuard(active) {
      navigationGuardActive = active;
      if (!active) {
        restoreNavigationGuardHooks();
        return;
      }
      const history = page.history;
      const nativePushState = originals.historyPushState;
      const nativeReplaceState = originals.historyReplaceState;
      const nativeBack = originals.historyBack;
      const nativeForward = originals.historyForward;
      const nativeGo = originals.historyGo;
      if (!guardedPushState && history && nativePushState && nativeReplaceState) {
        guardedPushState = function guardedHistoryPushState(data, unused, url) {
          if (!approveDirtyNavigation(url)) return;
          nativePushState.call(this, data, unused, url);
        };
        guardedReplaceState = function guardedHistoryReplaceState(data, unused, url) {
          if (!approveDirtyNavigation(url)) return;
          nativeReplaceState.call(this, data, unused, url);
        };
        history.pushState = guardedPushState;
        history.replaceState = guardedReplaceState;
        if (!page.navigation && nativeBack && nativeForward && nativeGo) {
          guardedBack = function guardedHistoryBack() {
            if (!approveDirtyNavigation()) return;
            nativeBack.call(this);
          };
          guardedForward = function guardedHistoryForward() {
            if (!approveDirtyNavigation()) return;
            nativeForward.call(this);
          };
          guardedGo = function guardedHistoryGo(delta) {
            if (!approveDirtyNavigation()) return;
            nativeGo.call(this, delta);
          };
          history.back = guardedBack;
          history.forward = guardedForward;
          history.go = guardedGo;
        }
      }
      if (!guardedNavigationListener && page.navigation) {
        guardedNavigationListener = ((event) => {
          if (approveDirtyNavigation(event.destination?.url)) return;
          if (event.cancelable) event.preventDefault();
        });
        page.navigation.addEventListener("navigate", guardedNavigationListener);
      }
    }
    function resetPageWorldToIdle() {
      paused = false;
      lazySuppressed = false;
      setNavigationGuard(false);
      stopLazyOwnerLifecycle();
      nestedLazyViewportOwner = null;
      releaseMotionFreeze();
      page.document?.documentElement?.toggleAttribute("data-uf-lazy-loading-suppressed", false);
      flushQueued();
      restoreTimerBridge();
      armed = false;
      sessionNonce = "";
      lifecyclePhase = "idle";
    }
    const responseResolvers = /* @__PURE__ */ new Map();
    function reply(_source, request, ok, payload, failure) {
      const nonce = request.nonce ?? "";
      const resolve = responseResolvers.get(nonce);
      if (!resolve) return;
      resolve({
        ok,
        nonce,
        command: request.command ?? "",
        payload: ok && payload && typeof payload === "object" ? payload : null,
        failure: ok ? void 0 : failure
      });
    }
    async function handlePageWorldRequest(request, requestEpoch = commandEpoch) {
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
      const requestSessionNonce = request.sessionNonce;
      if (command === "RECONCILE") {
        resetPageWorldToIdle();
        reply(page, request, true, {
          armed: false,
          paused: false,
          lazySuppressed: false,
          sessionNonce: "",
          phase: "idle",
          initialDiscoveryComplete: false,
          motionErrorCount
        });
        return;
      }
      if (command === "ARM") {
        if (armed && request.nonce === sessionNonce) {
          reply(page, request, true, {
            armed,
            paused,
            lazySuppressed,
            sessionNonce,
            phase: lifecyclePhase,
            initialDiscoveryComplete: motionInitialDiscoveryComplete,
            motionErrorCount
          });
          return;
        }
        if (armed && request.nonce !== sessionNonce && (paused || lazySuppressed)) {
          reply(page, request, false, null, {
            code: "PAGE_NONCE_MISMATCH",
            message: "Page-world command nonce did not match the active armed session"
          });
          return;
        }
        armed = true;
        sessionNonce = request.nonce;
        lifecyclePhase = "armed";
      } else if (command === "DESTROY" && !armed) {
        resetPageWorldToIdle();
        reply(page, request, true, {
          armed: false,
          paused: false,
          lazySuppressed: false,
          sessionNonce: "",
          phase: "idle",
          initialDiscoveryComplete: false,
          motionErrorCount
        });
        return;
      } else if (!armed || requestSessionNonce !== sessionNonce) {
        reply(page, request, false, null, {
          code: "PAGE_NONCE_MISMATCH",
          message: "Page-world command session nonce did not match the armed session"
        });
        return;
      }
      try {
        if (command === "SET_MOTION_PAUSED") {
          const nextPaused = Boolean(request.payload && request.payload.paused);
          if (nextPaused) {
            installTimerBridge();
            paused = true;
            await installMotionFreeze();
            if (requestEpoch !== commandEpoch) {
              reply(page, request, false, null, {
                code: "PAGE_COMMAND_SUPERSEDED",
                message: "Page-world command was superseded by terminal teardown"
              });
              return;
            }
          } else if (paused || motionFreezeInstalled) {
            paused = false;
            releaseMotionFreeze();
            flushQueued();
            restoreTimerBridge();
          }
        }
        if (command === "SET_LAZY_LOADING_SUPPRESSED") {
          const nextLazySuppressed = Boolean(request.payload && request.payload.suppressed);
          lazySuppressed = nextLazySuppressed;
          if (nextLazySuppressed) {
            startLazyOwnerLifecycle();
            refreshNestedLazyViewportOwner();
          } else {
            stopLazyOwnerLifecycle();
            nestedLazyViewportOwner = null;
          }
          page.document?.documentElement?.toggleAttribute("data-uf-lazy-loading-suppressed", lazySuppressed);
        }
        if (command === "SET_NAVIGATION_GUARD") {
          setNavigationGuard(Boolean(request.payload && request.payload.active));
        }
        if (command === "DESTROY") {
          lifecyclePhase = "destroying";
          resetPageWorldToIdle();
        }
        reply(page, request, true, {
          armed,
          paused,
          lazySuppressed,
          navigationGuardActive,
          sessionNonce,
          phase: lifecyclePhase,
          initialDiscoveryComplete: motionInitialDiscoveryComplete,
          motionErrorCount
        });
      } catch (error) {
        if (requestEpoch !== commandEpoch) {
          reply(page, request, false, null, {
            code: "PAGE_COMMAND_SUPERSEDED",
            message: "Page-world command was superseded by terminal teardown"
          });
          return;
        }
        paused = false;
        releaseMotionFreeze();
        flushQueued();
        restoreTimerBridge();
        reply(page, request, false, null, {
          code: "PAGE_COMMAND_FAILED",
          message: error instanceof Error ? error.message : "Page-world command failed"
        });
      }
    }
    let commandEpoch = 0;
    let activeCommand = null;
    const queuedCommands = [];
    const startCommand = (request) => {
      const epoch = commandEpoch;
      const operation = handlePageWorldRequest(request, epoch);
      activeCommand = { epoch, operation };
      operation.then(
        () => drainCommands(epoch, operation),
        () => drainCommands(epoch, operation)
      );
      return operation;
    };
    const terminalCanPreemptActiveCommand = (request) => {
      const command = normalizeCommand(request.command);
      if (command === "RECONCILE") return true;
      if (command !== "DESTROY") return false;
      if (!armed) return true;
      const requestSessionNonce = request.sessionNonce;
      return requestSessionNonce === sessionNonce;
    };
    const preemptForTerminal = () => {
      lifecyclePhase = "destroying";
      paused = false;
      lazySuppressed = false;
      releaseMotionFreeze();
      page.document?.documentElement?.toggleAttribute("data-uf-lazy-loading-suppressed", false);
      flushQueued();
      restoreTimerBridge();
      commandEpoch += 1;
      activeCommand = null;
      for (const superseded of queuedCommands.splice(0)) {
        reply(page, superseded.request, false, null, {
          code: "PAGE_COMMAND_SUPERSEDED",
          message: "Page-world command was superseded by terminal teardown"
        });
        superseded.resolve();
      }
    };
    const enqueueCommand = (request) => {
      if (!activeCommand) return startCommand(request);
      if (terminalCanPreemptActiveCommand(request)) {
        preemptForTerminal();
        return handlePageWorldRequest(request, commandEpoch);
      }
      return new Promise((resolve, reject) => {
        queuedCommands.push({ request, resolve, reject });
      });
    };
    function drainCommands(epoch, operation) {
      if (epoch !== commandEpoch || activeCommand?.epoch !== epoch || activeCommand.operation !== operation) {
        return;
      }
      activeCommand = null;
      const next = queuedCommands.shift();
      if (!next) return;
      startCommand(next.request).then(next.resolve, next.reject);
    }
    const dispatchCommand = async (request) => {
      const nonce = request.nonce ?? "";
      if (!nonce || responseResolvers.has(nonce)) {
        return {
          ok: false,
          nonce,
          command: request.command ?? "",
          payload: null,
          failure: {
            code: nonce ? "PAGE_NONCE_IN_USE" : "PAGE_NONCE_REQUIRED",
            message: nonce ? "Page-world command nonce is already active" : "Page-world command requires a nonce"
          }
        };
      }
      try {
        return await new Promise((resolve) => {
          responseResolvers.set(nonce, resolve);
          void enqueueCommand(request).catch((error) => {
            reply(page, request, false, null, {
              code: "PAGE_COMMAND_FAILED",
              message: error instanceof Error ? error.message : "Page-world command failed"
            });
          });
        });
      } finally {
        responseResolvers.delete(nonce);
      }
    };
    function uniqueTransferredRegistrations(registrations) {
      const unique = [];
      const seen = /* @__PURE__ */ new Map();
      for (const registration of registrations) {
        const byType = seen.get(registration.target) ?? /* @__PURE__ */ new Map();
        seen.set(registration.target, byType);
        const byListener = byType.get(registration.type) ?? /* @__PURE__ */ new Map();
        byType.set(registration.type, byListener);
        const captureBit = listenerCapture(registration.options) ? 2 : 1;
        const priorBits = byListener.get(registration.listener) ?? 0;
        if ((priorBits & captureBit) !== 0) continue;
        byListener.set(registration.listener, priorBits | captureBit);
        unique.push(registration);
      }
      return unique;
    }
    function restoreTransferredRegistrationsBestEffort(registrations) {
      for (const registration of uniqueTransferredRegistrations(registrations)) {
        try {
          registration.target.addEventListener(
            registration.type,
            registration.listener,
            registration.options
          );
        } catch {
        }
      }
    }
    function removeTransferredRegistrationsBestEffort(registrations) {
      for (const registration of uniqueTransferredRegistrations(registrations)) {
        try {
          registration.target.removeEventListener(
            registration.type,
            registration.listener,
            listenerCapture(registration.options)
          );
        } catch {
          try {
            originals.removeEventListener?.call(
              registration.target,
              registration.type,
              registration.listener,
              listenerCapture(registration.options)
            );
          } catch {
          }
        }
      }
    }
    function releaseTransferredTimersBestEffort(timers) {
      for (const timer of timers) {
        if (timer.cancelled) continue;
        try {
          if (timer.type === "raf" && originals.requestAnimationFrame) {
            originals.requestAnimationFrame.call(page, timer.callback);
          } else if (timer.type === "idle" && originals.requestIdleCallback) {
            originals.requestIdleCallback.call(page, timer.callback);
          } else {
            originals.setTimeout.call(page, () => {
              if (timer.type === "timeout") {
                executeTimeoutHandler(timer.callback, timer.args);
              } else if (timer.type === "raf") {
                timer.callback.call(page, page.performance.now());
              } else {
                timer.callback.call(page, {
                  didTimeout: false,
                  timeRemaining: () => 0
                });
              }
            }, 0);
          }
        } catch {
        }
      }
    }
    function forceDisposeTimerBridge() {
      timerDeliveryEpoch += 1;
      for (const handle of pendingTimerFlushHandles) {
        try {
          originals.clearTimeout.call(page, handle);
        } catch {
        }
      }
      pendingTimerFlushHandles.clear();
      pendingTimerFlushItems.clear();
      queued.length = 0;
      const timerOriginals = [
        ["setTimeout", originals.setTimeout],
        ["clearTimeout", originals.clearTimeout],
        ["setInterval", originals.setInterval],
        ["clearInterval", originals.clearInterval],
        ["requestAnimationFrame", originals.requestAnimationFrame],
        ["cancelAnimationFrame", originals.cancelAnimationFrame],
        ["requestIdleCallback", originals.requestIdleCallback],
        ["cancelIdleCallback", originals.cancelIdleCallback]
      ];
      for (const [property, value] of timerOriginals) {
        try {
          Reflect.set(page, property, value);
        } catch {
        }
      }
      installed = false;
      paused = false;
      timerBridgeRestoreRequested = false;
      timeoutTokens.clear();
      rafTokens.clear();
      idleTokens.clear();
    }
    function disposeRuntime() {
      commandEpoch += 1;
      activeCommand = null;
      for (const superseded of queuedCommands.splice(0)) {
        try {
          reply(page, superseded.request, false, null, {
            code: "PAGE_COMMAND_SUPERSEDED",
            message: "Page-world command was superseded by runtime takeover"
          });
        } catch {
        }
        try {
          superseded.resolve();
        } catch {
        }
      }
      const carriedTimers = [.../* @__PURE__ */ new Set([...queued, ...pendingTimerFlushItems])].filter((item) => !item.cancelled);
      const transferredRegistrations = uniqueTransferredRegistrations(
        wrappedEventRegistrations.map((registration) => ({
          target: registration.target,
          type: registration.type,
          listener: registration.listener,
          options: registration.options
        }))
      );
      forceDisposeTimerBridge();
      armed = false;
      paused = false;
      lazySuppressed = false;
      stopLazyOwnerLifecycle();
      try {
        releaseMotionFreeze();
      } catch {
      }
      nestedLazyViewportOwner = null;
      try {
        page.document?.documentElement?.toggleAttribute("data-uf-lazy-loading-suppressed", false);
      } catch {
      }
      lifecyclePhase = "idle";
      for (const registration of [...wrappedEventRegistrations]) {
        try {
          registration.nativeRemoveEventListener.call(
            registration.target,
            registration.type,
            registration.wrapped,
            registration.capture
          );
        } catch {
        }
        if (originals.removeEventListener !== registration.nativeRemoveEventListener) {
          try {
            originals.removeEventListener?.call(
              registration.target,
              registration.type,
              registration.wrapped,
              registration.capture
            );
          } catch {
          }
        }
        try {
          forgetWrappedRegistration(registration);
        } catch {
        }
      }
      runCleanupsSafely(lazyEventCleanups);
      runCleanupsSafely(lazyTargetRestorations);
      try {
        if (installedIntersectionObserver && page.IntersectionObserver === installedIntersectionObserver) {
          Reflect.set(page, "IntersectionObserver", originals.IntersectionObserver);
        }
      } catch {
      }
      try {
        if (installedResizeObserver && page.ResizeObserver === installedResizeObserver) {
          Reflect.set(page, "ResizeObserver", originals.ResizeObserver);
        }
      } catch {
      }
      installedIntersectionObserver = null;
      installedResizeObserver = null;
      lazyBridgeInstalled = false;
      try {
        if (installedAttachShadow && page.Element && page.Element.prototype.attachShadow === installedAttachShadow && originals.attachShadow) {
          page.Element.prototype.attachShadow = originals.attachShadow;
        }
      } catch {
      }
      installedAttachShadow = null;
      return {
        queuedTimers: carriedTimers,
        eventRegistrations: transferredRegistrations
      };
    }
    let retired = false;
    const capabilityDispatcher = async (providedCapability, invocation) => {
      if (providedCapability !== capability) {
        return rejected("PAGE_CAPABILITY_REJECTED", "Page-world capability was rejected");
      }
      if (retired) {
        return rejected("PAGE_RUNTIME_RETIRED", "Page-world runtime has been retired");
      }
      if (invocation.kind === "probe") {
        return {
          ok: true,
          nonce: "",
          command: "PROBE",
          payload: { ready: true, version: RUNTIME_VERSION }
        };
      }
      if (invocation.kind === "retire") {
        disposeRuntime();
        retired = true;
        return {
          ok: true,
          nonce: "",
          command: "RETIRE",
          payload: { ready: false, retired: true, version: RUNTIME_VERSION }
        };
      }
      if (!invocation.request) {
        return rejected("PAGE_COMMAND_REQUIRED", "Page-world command request is missing");
      }
      return await dispatchCommand(invocation.request);
    };
    const adoptedInheritedRegistrations = [];
    try {
      installLazyLoadingBridge();
      installClosedShadowInstrumentation();
      for (const registration of uniqueTransferredRegistrations(inheritedEventRegistrations)) {
        registration.target.addEventListener(
          registration.type,
          registration.listener,
          registration.options
        );
        adoptedInheritedRegistrations.push(registration);
      }
      if (inheritedQueuedTimers.length > 0) {
        installTimerBridge();
        flushQueued();
        restoreTimerBridge();
      }
      Object.defineProperty(runtimeHost, endpointKey, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: capabilityDispatcher
      });
      inheritedEventRegistrations = [];
      return await capabilityDispatcher(capability, { kind: "probe" });
    } catch (error) {
      removeTransferredRegistrationsBestEffort(adoptedInheritedRegistrations);
      const abandoned = disposeRuntime();
      restoreTransferredRegistrationsBestEffort([
        ...inheritedEventRegistrations,
        ...abandoned.eventRegistrations
      ]);
      releaseTransferredTimersBestEffort(abandoned.queuedTimers);
      return rejected(
        "PAGE_RUNTIME_INSTALL_FAILED",
        error instanceof Error ? error.message : "Page-world runtime installation failed"
      );
    }
  }
})();
