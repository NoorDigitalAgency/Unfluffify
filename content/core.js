import * as config from "../common/config.js";
import * as utils from "../common/utilities.js";
import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS,
  EXTENSION_UI_FONT_STACK
} from "../common/constants.js";
import { ContentText } from "../common/text.js";
import { REMOVABLE_ELEMENT_SELECTORS } from "./constants.js";
import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  isWithinAncestorSet as isWithinElementSet,
  buildInclusionContextSet,
  getNormalizedTextContent as getNormalizedElementText,
  canUseCollapsedTextFallback as canUseCollapsedTextFallbackElement
} from "./shared-inclusion.js";
import {
  chooseExcludeParentBoundaryTarget,
  getExplicitMarkingFullRenderOptions,
  getExplicitMarkingPresentation,
  isStoredExcludeStateUserModified,
  shouldAllowParentMarkingBoundary,
  shouldAutoSeedMarkingsFromAiSelectors,
  shouldCollectToggleableDefaultBoundary,
  shouldIgnoreDuplicateUserToggle,
  shouldSelfMarkToggleableDefaultBoundary
} from "./marking-rules.js";
import {
  collectCachedSelectorMatches,
  invalidateSharedSelectorCache
} from "./shared-selector-cache.js";
import { shouldRetainIncludedSource } from "./silent-highlight-rules.js";

export const state = {
  enabled: false,
  baseUrl: "",
  currentPageType: "",
  config: null,
  overlay: null,
  layers: {},
  hoverBox: null,
  focusBox: null,
  focusElement: null,
  aiPopover: null,
  aiPopoverCollapsed: false,
  aiPopoverOnClose: null,
  aiPopoverOnCollapsedChange: null,
  toast: null,
  toastHideTimer: 0,
  markingDisabledNotice: null,
  pageInspectionNotice: null,
  inspectionBlocker: null,
  altPassThrough: false,
  altHeld: false,
  shiftHeld: false,
  lastPointer: null,
  markIdCounter: 1,
  markIds: new WeakMap(),
  markedElements: new Set(),
  renderRaf: 0,
  renderTimer: 0,
  explicitFullRenderTimer: 0,
  pendingRenderInvalidate: false,
  lastRenderAt: 0,
  scrollHideTimer: 0,
  isScrolling: false,
  snapshotTimer: 0,
  draftPersistTimer: 0,
  urlCheckTimer: 0,
  mutationObserver: null,
  savedPageEntry: null,
  savedPageUrl: "",
  // Per-page fingerprint of the last clean state. Lazy-initialised on the
  // first dirty check after sync populates the draft, and refreshed when a
  // backend-confirmed entry lands via setSavedPageEntry. Cleared in disable().
  cleanBaselineFingerprintByPageUrl: new Map(),
  pageSaveReconciliation: null,
  disabledUnsavedDraft: null,
  consentSyncedPageUrl: "",
  consentRootElements: new Set(),
  initialized: false,
  layerBoxes: new WeakMap(),
  cachedCollections: null,
  cachedCollectionsKey: "",
  markingSettleTimers: [],
  paintReachabilityFallbackCount: 0,
  paintReachabilityFallbackLastLoggedAt: 0,
  elementComputationCacheDepth: 0,
  visibilityCache: null,
  ancestorVisStateCache: null,
  ancestorOverflowCache: null,
  directTextCache: null,
  normalizedTextCache: null,
  toggleableDefaultCache: null,
  immutableMatchCache: null,
  immutableAncestorCache: null,
  textualContainerCache: null,
  textualDescendantCache: null,
  textualImmutableDescendantCache: null,
  hoverRaf: 0,
  currentPageUrl: "",
  currentPageEntry: null,
  autoSeededPendingSavePageUrl: "",
  autoSeedSuppressedPageUrl: "",
  toggleAckTimer: 0,
  toggleInFlightKey: "",
  toggleQueuedActionKey: "",
  toggleMutationQueue: [],
  toggleMutationHandle: 0,
  toggleMutationHandleType: "",
  toggleReconcileGeneration: 0,
  lastToggleActionKey: "",
  lastToggleActionAt: 0,
  explicitOverlayRefreshScheduled: false,
  explicitOverlayRefreshHandle: 0,
  explicitOverlayRefreshHandleType: "",
  explicitOverlayRefreshEntry: null,
  explicitOverlayRefreshContext: null,
  pageMotionPause: null,
  pageRevealWarmupId: 0,
  lazyLoadSuppressRestorer: null,
  perfEnabled: null
};

export const CONSENT_HIDDEN_ATTR = "data-uf-consent-hidden";
const CONSENT_BYPASS_STYLE_ID = "uf-consent-bypass";
const CONSENT_SELECTOR = REMOVABLE_ELEMENT_SELECTORS.join(",");
const pageMarkingEntryLookupCache = new WeakMap();
const SCROLL_DEBOUNCE_MS = 250;
const TOGGLE_ACK_ANIMATION_MS = 160;
const TOGGLE_ACK_CLEAR_MS = TOGGLE_ACK_ANIMATION_MS + 20;
const DEFAULT_SNAPSHOT_SAVE_DELAY_MS = 1000;
const EXPLICIT_TOGGLE_SNAPSHOT_DELAY_MS = 3500;
const EXPLICIT_TOGGLE_DRAFT_PERSIST_DELAY_MS = 350;
const EXPLICIT_TOGGLE_DEFERRED_FULL_RENDER_DELAY_MS = 180;
const TOGGLE_RECONCILE_YIELD_INTERVAL = 40;
const MARKING_MODE_SETTLE_RENDER_DELAYS_MS = [180, 700, 1800];
const SNAPSHOT_IDLE_TIMEOUT_MS = 5000;
const PAGE_INTERACTION_KEY = " ";
const PAGE_INTERACTION_KEY_CODE = "Space";
const PARENT_MARKING_CONTENT_BOUNDARY_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "DETAILS",
  "DIALOG",
  "FIELDSET",
  "FIGURE",
  "FOOTER",
  "FORM",
  "HEADER",
  "LI",
  "NAV",
  "OL",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL"
]);
const PARENT_MARKING_PAGE_SHELL_LANDMARK_TAGS = new Set([
  "FOOTER",
  "HEADER",
  "MAIN",
  "NAV"
]);
const PARENT_MARKING_PAGE_SHELL_ROLES = new Set([
  "banner",
  "contentinfo",
  "main",
  "navigation"
]);
const MARKING_DISABLED_OVERLAY_CLASS = "uf-marking-temporarily-disabled";
const MARKING_DISABLED_CURSOR_CLASS = "uf-cursor-disabled";
const PAGE_INTERACTION_LEGACY_KEY = "Spacebar";
const PAGE_MOTION_PAUSE_STYLE_ID = "unfluffify-page-motion-pause-style";
const PAGE_MOTION_PAUSE_INDICATOR_ID = "unfluffify-page-motion-pause-indicator";
const PAGE_MOTION_PAUSE_INDICATOR_CLASS = "uf-page-motion-pause-indicator";
const PAGE_MOTION_PAUSE_ROOT_CLASS = "uf-page-motion-paused";
const PAGE_MOTION_PAUSE_CONTROL_COMMAND_SET_PAUSED = "setPaused";
const PAGE_MOTION_PAUSE_CONTROL_COMMAND_SET_LAZY_LOADING_SUPPRESSED = "setLazyLoadingSuppressed";
const PAGE_MOTION_PAUSE_LOCK_ATTR = "data-uf-motion-lock-id";
const PAGE_MOTION_ICON_FONT_FAMILY = "Unfluffify Material Design Icons";
const MATERIAL_DESIGN_ICONS_FONT_PATH = "assets/materialdesignicons-webfont.woff2";
const MATERIAL_DESIGN_ICON_CODE_TAGS = "\\F1C86";
const MATERIAL_DESIGN_ICON_SNOWFLAKE = "\\F0717";
const PAGE_MOTION_PAUSE_DEFAULT_REASON = "marking";
const PAGE_MOTION_PAUSE_REFRESH_MS = 250;
const PAGE_MOTION_PAUSE_MAX_LOCKED_ELEMENTS = 800;
const PAGE_MOTION_PAUSE_MAX_HOVER_TARGETS = 500;
const PAGE_INSPECTION_STYLE_ID = "unfluffify-page-inspection-style";
const PAGE_INSPECTION_OVERLAY_CLASS = "uf-page-inspection-active";
const PAGE_INSPECTION_DEFAULT_MAX_SCROLLS = 10;
const PAGE_INSPECTION_DEFAULT_PAUSE_MS = 1000;
const PAGE_INSPECTION_LAZY_LOAD_PHASES = 1;
const SILENT_HIGHLIGHT_WARMUP_SETTLE_DELAY_MS = 2000;
const PAGE_INSPECTION_SCROLL_END_TIMEOUT_MS = 8000;
const PAGE_INSPECTION_SCROLL_SETTLE_MS = 220;
const PAGE_INSPECTION_SCROLL_TOLERANCE_PX = 2;
const PAGE_INSPECTION_RENDER_WAIT_TIMEOUT_MS = 3000;
const PAGE_INSPECTION_INPUT_EVENTS = [
  "auxclick",
  "beforeinput",
  "click",
  "contextmenu",
  "dblclick",
  "dragstart",
  "drop",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "mousedown",
  "mouseup",
  "pointercancel",
  "pointerdown",
  "pointermove",
  "pointerup",
  "submit",
  "touchcancel",
  "touchend",
  "touchmove",
  "touchstart",
  "wheel"
];
const PAGE_MOTION_PAUSE_CONTENT_SELECTOR = `html.${PAGE_MOTION_PAUSE_ROOT_CLASS} body ` +
  `:not([data-uf-extension-ui="true"]):not([data-uf-extension-ui="true"] *)` +
  `:not([id^="unfluffify-"]):not([id^="unfluffify-"] *)`;
const PAGE_MOTION_PAUSE_DESCRIPTOR_RE = /auto[-_\s]?play|carousel|slider|slideshow|marquee|ticker|animation|animated|animate|motion|parallax|scroll[-_\s]?snap/i;
const PAGE_MOTION_REVEAL_DESCRIPTOR_RE = /(^|[-_\s:])(aos|appear|appearance|animate|animated|entrance|enter|fade|intersect|intersection|inview|in-view|on[-_\s]?scroll|reveal|scroll[-_\s]?(animate|animation|fade|reveal|trigger)?|slide[-_\s]?(in|up|down|left|right)|viewport|wow|zoom)([-_\s:]|$)/i;
const PAGE_MOTION_REVEAL_EXCLUDED_DESCRIPTOR_RE = /accordion|backdrop|carousel|collapse|dialog|drawer|dropdown|lightbox|marquee|menu|modal|offcanvas|overlay|popover|slider|slideshow|tab|tabpanel|ticker|toast|tooltip/i;
const PAGE_MOTION_REVEAL_INTERACTION_ATTRIBUTE_NAMES = new Set(["data-ix", "data-w-id"]);
const PAGE_MOTION_PAUSE_INLINE_STYLE_RE = /(^|;|\s)(animation|transition|transform|translate|rotate|scale|offset|opacity|filter|clip-path|top|right|bottom|left)\s*:/i;
let pageMotionFreezeTimersPaused = false;
let pageMotionFreezeLazyLoadingSuppressed = false;
const PAGE_MOTION_PAUSE_BASE_LOCK_PROPERTIES = [
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
const PAGE_MOTION_PAUSE_POSITION_LOCK_PROPERTIES = [
  "top",
  "right",
  "bottom",
  "left",
  "inset-block-start",
  "inset-block-end",
  "inset-inline-start",
  "inset-inline-end"
];
const EXTENSION_SNAPSHOT_STRIP_SELECTORS = [
  "[data-uf-extension-ui=\"true\"]",
  "[data-wxt-shadow-root]",
  "browser-mcp-container",
  "[id^=\"unfluffify-\"]",
  "#unfluffify-overlay",
  "#unfluffify-freeze-style",
  "#unfluffify-ai-popover-style",
  "#unfluffify-ai-preview-focus-style"
];
const EXTENSION_SNAPSHOT_ROOT_CLASSES = [
  "uf-cursor-exclude",
  "uf-cursor-include",
  "uf-cursor-passthrough",
  MARKING_DISABLED_CURSOR_CLASS,
  PAGE_INSPECTION_OVERLAY_CLASS,
  PAGE_MOTION_PAUSE_ROOT_CLASS
];
const AI_PREVIEW_FOCUS_CLASS = "uf-ai-preview-focus-target";
const AI_PREVIEW_FOCUS_STYLE_ID = "unfluffify-ai-preview-focus-style";
const SILENT_HIGHLIGHTING_PREPARATION_REASON = "editor_preparing";

const capturedExtensionTimers = (() => {
  const root = typeof window !== "undefined" ? window : globalThis;
  const bindTimer = (name) => {
    const value = root && typeof root[name] === "function" ? root[name] : null;
    return value ? value.bind(root) : null;
  };
  return {
    setTimeout: bindTimer("setTimeout"),
    clearTimeout: bindTimer("clearTimeout"),
    setInterval: bindTimer("setInterval"),
    clearInterval: bindTimer("clearInterval"),
    requestAnimationFrame: bindTimer("requestAnimationFrame"),
    cancelAnimationFrame: bindTimer("cancelAnimationFrame"),
    requestIdleCallback: bindTimer("requestIdleCallback"),
    cancelIdleCallback: bindTimer("cancelIdleCallback")
  };
})();

function isPageMotionFreezeTimerFunction(value) {
  const name = value && typeof value === "function" ? value.name || "" : "";
  return name.startsWith("unfluffifySet") ||
    name.startsWith("unfluffifyClear") ||
    name.startsWith("unfluffifyRequest") ||
    name.startsWith("unfluffifyCancel");
}

function getExtensionTimer(name) {
  const current = typeof window !== "undefined" && typeof window[name] === "function"
    ? window[name]
    : null;
  if (current && !isPageMotionFreezeTimerFunction(current)) {
    return current.bind(window);
  }
  return capturedExtensionTimers[name] || (current ? current.bind(window) : null);
}

function getExtensionNow() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function extensionSetTimeout(callback, delay, ...args) {
  const timer = getExtensionTimer("setTimeout") || setTimeout;
  return timer(callback, delay, ...args);
}

function extensionClearTimeout(handle) {
  const timer = getExtensionTimer("clearTimeout") || clearTimeout;
  timer(handle);
}

function extensionSetInterval(callback, delay, ...args) {
  const timer = getExtensionTimer("setInterval") || setInterval;
  return timer(callback, delay, ...args);
}

function extensionClearInterval(handle) {
  const timer = getExtensionTimer("clearInterval") || clearInterval;
  timer(handle);
}

function getExtensionRequestAnimationFrame() {
  return getExtensionTimer("requestAnimationFrame");
}

function extensionRequestAnimationFrame(callback) {
  const requestFrame = getExtensionRequestAnimationFrame();
  if (requestFrame) {
    return requestFrame(callback);
  }
  return extensionSetTimeout(() => callback(getExtensionNow()), 16);
}

function extensionCancelAnimationFrame(handle) {
  const cancelFrame = getExtensionTimer("cancelAnimationFrame");
  if (cancelFrame) {
    cancelFrame(handle);
    return;
  }
  extensionClearTimeout(handle);
}

function extensionRequestIdleCallback(callback, options) {
  const requestIdle = getExtensionTimer("requestIdleCallback");
  if (requestIdle) {
    return requestIdle(callback, options);
  }
  return extensionSetTimeout(callback, 0);
}

let aiPreviewFocusElement = null;

function createCurrentTimestamp() {
  return config.createTimestampNow();
}

function normalizeEntryTimestampValue(value) {
  return config.normalizeEntryTimestamp(value);
}

function normalizePageEntryTitle(value, fallbackUrl = "") {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === fallbackUrl) {
    return "";
  }
  return trimmed;
}

function nowMs() {
  if (typeof performance !== "undefined" && performance && performance.now) {
    return performance.now();
  }
  return Date.now();
}

function isTogglePerfEnabled() {
  if (state.perfEnabled !== null) {
    return state.perfEnabled;
  }
  try {
    state.perfEnabled = Boolean(
      window && (
        window.__UNFLUFFIFY_TOGGLE_PERF__ ||
        (window.localStorage && window.localStorage.getItem("unfluffify:toggle-perf") === "1")
      )
    );
  } catch {
    state.perfEnabled = false;
  }
  return state.perfEnabled;
}

function logTogglePerf(label, startedAt, details = null) {
  if (!isTogglePerfEnabled()) {
    return;
  }
  const elapsedMs = Math.max(0, nowMs() - startedAt);
  try {
    console.debug("[Unfluffify][toggle-perf]", label, {
      elapsedMs: Number(elapsedMs.toFixed(2)),
      ...(details && typeof details === "object" ? details : {})
    });
  } catch {
    // Ignore diagnostics failures.
  }
}

function createTextualOptionCache() {
  return {
    visible: new WeakMap(),
    ignoreVisibility: new WeakMap()
  };
}

function getTextualOptionCache(cache, options = {}) {
  if (!cache) {
    return null;
  }
  return options && options.ignoreVisibilityForInclusionDetection
    ? cache.ignoreVisibility
    : cache.visible;
}

export function withElementComputationCache(callback) {
  const outermost = state.elementComputationCacheDepth === 0;
  const previous = outermost
    ? {
      visibilityCache: state.visibilityCache,
      ancestorVisStateCache: state.ancestorVisStateCache,
      ancestorOverflowCache: state.ancestorOverflowCache,
      directTextCache: state.directTextCache,
      normalizedTextCache: state.normalizedTextCache,
      toggleableDefaultCache: state.toggleableDefaultCache,
      immutableMatchCache: state.immutableMatchCache,
      immutableAncestorCache: state.immutableAncestorCache,
      textualContainerCache: state.textualContainerCache,
      textualDescendantCache: state.textualDescendantCache,
      textualImmutableDescendantCache: state.textualImmutableDescendantCache
    }
    : null;
  if (outermost) {
    state.visibilityCache = new Map();
    state.ancestorVisStateCache = new Map();
    state.ancestorOverflowCache = new Map();
    state.directTextCache = new WeakMap();
    state.normalizedTextCache = new WeakMap();
    state.toggleableDefaultCache = new WeakMap();
    state.immutableMatchCache = new WeakMap();
    state.immutableAncestorCache = new WeakMap();
    state.textualContainerCache = createTextualOptionCache();
    state.textualDescendantCache = createTextualOptionCache();
    state.textualImmutableDescendantCache = createTextualOptionCache();
  }
  state.elementComputationCacheDepth += 1;
  try {
    return callback();
  } finally {
    state.elementComputationCacheDepth -= 1;
    if (outermost) {
      state.visibilityCache = previous.visibilityCache;
      state.ancestorVisStateCache = previous.ancestorVisStateCache;
      state.ancestorOverflowCache = previous.ancestorOverflowCache;
      state.directTextCache = previous.directTextCache;
      state.normalizedTextCache = previous.normalizedTextCache;
      state.toggleableDefaultCache = previous.toggleableDefaultCache;
      state.immutableMatchCache = previous.immutableMatchCache;
      state.immutableAncestorCache = previous.immutableAncestorCache;
      state.textualContainerCache = previous.textualContainerCache;
      state.textualDescendantCache = previous.textualDescendantCache;
      state.textualImmutableDescendantCache = previous.textualImmutableDescendantCache;
    }
  }
}

async function withElementComputationCacheAsync(callback) {
  const outermost = state.elementComputationCacheDepth === 0;
  const previous = outermost
    ? {
      visibilityCache: state.visibilityCache,
      ancestorVisStateCache: state.ancestorVisStateCache,
      ancestorOverflowCache: state.ancestorOverflowCache,
      directTextCache: state.directTextCache,
      normalizedTextCache: state.normalizedTextCache,
      toggleableDefaultCache: state.toggleableDefaultCache,
      immutableMatchCache: state.immutableMatchCache,
      immutableAncestorCache: state.immutableAncestorCache,
      textualContainerCache: state.textualContainerCache,
      textualDescendantCache: state.textualDescendantCache,
      textualImmutableDescendantCache: state.textualImmutableDescendantCache
    }
    : null;
  if (outermost) {
    state.visibilityCache = new Map();
    state.ancestorVisStateCache = new Map();
    state.ancestorOverflowCache = new Map();
    state.directTextCache = new WeakMap();
    state.normalizedTextCache = new WeakMap();
    state.toggleableDefaultCache = new WeakMap();
    state.immutableMatchCache = new WeakMap();
    state.immutableAncestorCache = new WeakMap();
    state.textualContainerCache = createTextualOptionCache();
    state.textualDescendantCache = createTextualOptionCache();
    state.textualImmutableDescendantCache = createTextualOptionCache();
  }
  state.elementComputationCacheDepth += 1;
  try {
    return await callback();
  } finally {
    state.elementComputationCacheDepth -= 1;
    if (outermost) {
      state.visibilityCache = previous.visibilityCache;
      state.ancestorVisStateCache = previous.ancestorVisStateCache;
      state.ancestorOverflowCache = previous.ancestorOverflowCache;
      state.directTextCache = previous.directTextCache;
      state.normalizedTextCache = previous.normalizedTextCache;
      state.toggleableDefaultCache = previous.toggleableDefaultCache;
      state.immutableMatchCache = previous.immutableMatchCache;
      state.immutableAncestorCache = previous.immutableAncestorCache;
      state.textualContainerCache = previous.textualContainerCache;
      state.textualDescendantCache = previous.textualDescendantCache;
      state.textualImmutableDescendantCache = previous.textualImmutableDescendantCache;
    }
  }
}

function yieldForToggleReconcileWork() {
  return new Promise((resolve) => {
    if (getExtensionRequestAnimationFrame()) {
      extensionRequestAnimationFrame(() => resolve());
      return;
    }
    if (getExtensionTimer("setTimeout")) {
      extensionSetTimeout(() => resolve(), 0);
      return;
    }
    resolve();
  });
}

function runWhenIdle(callback, timeout = SNAPSHOT_IDLE_TIMEOUT_MS) {
  return extensionRequestIdleCallback(callback, { timeout });
}

function isTagSelector (selector){
  return /^[a-z]+$/i.test(selector);
}

function toQuerySelector (selector){
  return isTagSelector(selector) ? selector.toLowerCase() : selector;
}

function getEntryFingerprint(entry) {
  if (!entry || !Array.isArray(entry.xpaths)) {
    return [];
  }
  const xpathFingerprint = entry.xpaths
      .filter((item) => item && typeof item.xpath === "string")
      .map((item) => `${item.xpath}|${item.excluded ? "1" : "0"}|${item.explicit === true ? "1" : "0"}`)
      .sort();
  const includeFingerprint = Array.isArray(entry.includeXpaths)
      ? entry.includeXpaths
          .filter((xpath) => typeof xpath === "string" && xpath)
          .map((xpath) => `include:${xpath}`)
          .sort()
      : [];
  const selectorSuppressedFingerprint = Array.isArray(entry.selectorSuppressedXpaths)
      ? entry.selectorSuppressedXpaths
          .filter((xpath) => typeof xpath === "string" && xpath)
          .map((xpath) => `selectorSuppressed:${xpath}`)
          .sort()
      : [];
  const silentWhitespaceFingerprint = Array.isArray(entry.silentWhitespaceExcludedXpaths)
      ? entry.silentWhitespaceExcludedXpaths
          .filter((xpath) => typeof xpath === "string" && xpath)
          .map((xpath) => `silentWhitespace:${xpath}`)
          .sort()
      : [];
  const pageTypeFingerprint = `pageType:${normalizePageEntryPageType(entry.pageType)}`;
  return xpathFingerprint.concat(
    includeFingerprint,
    selectorSuppressedFingerprint,
    silentWhitespaceFingerprint,
    pageTypeFingerprint
  );
}

function getSelectorSetFingerprint(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  if (combineAiSelectorSet(normalized).length === 0) {
    return "";
  }
  return JSON.stringify(normalized);
}

function buildMarkingCollectionsCacheKey({ pageUrl = "", selectorSet = null, entry = null } = {}) {
  const entryFingerprint = getEntryFingerprint(entry);
  return [
    pageUrl,
    getSelectorSetFingerprint(selectorSet),
    ...entryFingerprint
  ].join("\u001f");
}

function resolveMarkingSelectorContext(configValue, entry = null) {
  const selectorSet = config.getNewestConfigSelectorSet(configValue).selectorSet;
  const hasAiSelectors = combineAiSelectorSet(selectorSet).length > 0;
  const selectorSuppressedXpaths = Array.isArray(entry && entry.selectorSuppressedXpaths)
    ? entry.selectorSuppressedXpaths
    : [];
  return {
    selectorSet,
    hasAiSelectors,
    selectorSuppressedXpaths
  };
}

function isClippedByOverflow(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  let parent = el.parentElement;
  const ovCache = state.ancestorOverflowCache;
  while (parent && parent.nodeType === 1) {
    // Stop at body or document element
    if (parent === document.body || parent === document.documentElement) {
      break;
    }
    let overflow, overflowX, overflowY;
    if (ovCache && ovCache.has(parent)) {
      ({ overflow, overflowX, overflowY } = ovCache.get(parent));
    } else {
      const parentStyle = window.getComputedStyle(parent);
      overflow = parentStyle.overflow;
      overflowX = parentStyle.overflowX;
      overflowY = parentStyle.overflowY;
      if (ovCache) {
        ovCache.set(parent, { overflow, overflowX, overflowY });
      }
    }

    // Check if parent has overflow clipping
    if (
        overflow === "hidden" ||
        overflow === "clip" ||
        overflowX === "hidden" ||
        overflowX === "clip" ||
        overflowY === "hidden" ||
        overflowY === "clip"
    ) {
      const parentRect = parent.getBoundingClientRect();
      // Check if element is completely outside parent's visible area
      if (
          rect.bottom <= parentRect.top ||
          rect.top >= parentRect.bottom ||
          rect.right <= parentRect.left ||
          rect.left >= parentRect.right
      ) {
        return true;
      }
    }
    parent = parent.parentElement;
  }
  return false;
}

function getViewportBounds() {
  const width = Number(window.innerWidth) || 0;
  const height = Number(window.innerHeight) || 0;
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height
  };
}

function getPositiveFiniteMax(values) {
  return values.reduce((maxValue, value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return maxValue;
    }
    return Math.max(maxValue, numericValue);
  }, 0);
}

function getDocumentVisualBounds() {
  const documentElement = document.documentElement;
  const body = document.body;
  const width = getPositiveFiniteMax([
    documentElement?.scrollWidth,
    body?.scrollWidth,
    documentElement?.offsetWidth,
    body?.offsetWidth,
    documentElement?.clientWidth,
    body?.clientWidth,
    window.innerWidth
  ]);
  const height = getPositiveFiniteMax([
    documentElement?.scrollHeight,
    body?.scrollHeight,
    documentElement?.offsetHeight,
    body?.offsetHeight,
    documentElement?.clientHeight,
    body?.clientHeight,
    window.innerHeight
  ]);
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height
  };
}

function getSubmissionVisualBounds() {
  const documentBounds = getDocumentVisualBounds();
  const viewportBounds = getViewportBounds();
  const width = viewportBounds.width || documentBounds.width;
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: documentBounds.bottom,
    width,
    height: documentBounds.height
  };
}

function getWindowScrollOffset() {
  return {
    x: Number(window.scrollX ?? window.pageXOffset) || 0,
    y: Number(window.scrollY ?? window.pageYOffset) || 0
  };
}

function toDocumentCoordinateRect(rect) {
  const scrollOffset = getWindowScrollOffset();
  return {
    left: rect.left + scrollOffset.x,
    top: rect.top + scrollOffset.y,
    right: rect.right + scrollOffset.x,
    bottom: rect.bottom + scrollOffset.y,
    width: rect.width,
    height: rect.height
  };
}

function hasFixedPositionAncestor(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    const style = window.getComputedStyle(node);
    if (style && style.position === "fixed") {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function isReachableInDocumentVisualArea(rect, bounds = getDocumentVisualBounds()) {
  const documentRect = toDocumentCoordinateRect(rect);
  return Boolean(intersectRects(documentRect, bounds));
}

function intersectRects(rectA, rectB) {
  const left = Math.max(rectA.left, rectB.left);
  const top = Math.max(rectA.top, rectB.top);
  const right = Math.min(rectA.right, rectB.right);
  const bottom = Math.min(rectA.bottom, rectB.bottom);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    left,
    top,
    right,
    bottom,
    width,
    height
  };
}

function hasOverflowClipping(style) {
  if (!style) {
    return false;
  }
  return (
    style.overflow === "hidden" ||
    style.overflow === "clip" ||
    style.overflowX === "hidden" ||
    style.overflowX === "clip" ||
    style.overflowY === "hidden" ||
    style.overflowY === "clip"
  );
}

function getElementEffectiveVisibleRect(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return null;
  }
  const clipToViewport = options.clipToViewport !== false;
  const baseRect = el.getBoundingClientRect();
  if (baseRect.width <= 0 || baseRect.height <= 0) {
    return null;
  }
  let visibleRect = clipToViewport
    ? intersectRects(baseRect, getViewportBounds())
    : {
      left: baseRect.left,
      top: baseRect.top,
      right: baseRect.right,
      bottom: baseRect.bottom,
      width: baseRect.width,
      height: baseRect.height
    };
  if (!visibleRect) {
    return null;
  }
  let parent = el.parentElement;
  while (parent && parent.nodeType === 1) {
    if (parent === document.body || parent === document.documentElement) {
      break;
    }
    const parentStyle = window.getComputedStyle(parent);
    if (hasOverflowClipping(parentStyle)) {
      const parentRect = parent.getBoundingClientRect();
      visibleRect = intersectRects(visibleRect, parentRect);
      if (!visibleRect) {
        return null;
      }
    }
    parent = parent.parentElement;
  }
  return visibleRect;
}

function isTheoreticallyInvisibleNode(node, style) {
  if (!node || node.nodeType !== 1) {
    return true;
  }
  if (node.hidden || node.getAttribute("aria-hidden") === "true") {
    return true;
  }
  if (
    node.classList &&
    (node.classList.contains("sr-only") || node.classList.contains("visually-hidden"))
  ) {
    return true;
  }
  if (!style) {
    return false;
  }
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return true;
  }
  if (parseFloat(style.opacity) === 0) {
    return true;
  }
  return isVisuallyHiddenByStyle(style);
}

function isElementInHitPath(target, element) {
  if (!target || !element) {
    return false;
  }
  if (target === element) {
    return true;
  }
  if (typeof element.contains === "function" && element.contains(target)) {
    return true;
  }
  return false;
}

function isIgnoredHitTestElement(element) {
  if (!element || element.nodeType !== 1) {
    return true;
  }
  if (state.overlay && (element === state.overlay || state.overlay.contains(element))) {
    return true;
  }
  return isWithinExtensionUi(element) || isWithinAiPopover(element);
}

function getPageHitElementsAtPoint(x, y) {
  const rawHits = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(x, y)
    : typeof document.elementFromPoint === "function"
      ? [document.elementFromPoint(x, y)].filter(Boolean)
      : [];
  return rawHits.filter((hit) => hit && hit.nodeType === 1 && !isIgnoredHitTestElement(hit));
}

function getPaintReachabilityForRect(el, rect) {
  if (!el || el.nodeType !== 1 || !rect) {
    return null;
  }
  if (typeof document.elementFromPoint !== "function" && typeof document.elementsFromPoint !== "function") {
    return null;
  }
  let sawPageHit = false;
  const points = getRealityCheckPoints(rect);
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      continue;
    }
    const elementsAtPoint = getPageHitElementsAtPoint(x, y);
    if (elementsAtPoint.length === 0) {
      continue;
    }
    sawPageHit = true;
    if (elementsAtPoint.some((hit) => isElementInHitPath(hit, el))) {
      return true;
    }
  }
  return sawPageHit ? false : null;
}

function reportPaintReachabilityFallback(el, rectCount) {
  state.paintReachabilityFallbackCount += 1;
  if (!isTogglePerfEnabled()) {
    return;
  }
  const now = Date.now();
  const count = state.paintReachabilityFallbackCount;
  const shouldLog =
    count <= 3 ||
    count % 25 === 0 ||
    now - state.paintReachabilityFallbackLastLoggedAt >= 5000;
  if (!shouldLog) {
    return;
  }
  state.paintReachabilityFallbackLastLoggedAt = now;
  logTogglePerf("render.reachability-fallback", nowMs(), {
    count,
    rectCount,
    tag: el && el.nodeType === 1 ? el.tagName : "",
    className: el && el.nodeType === 1 && typeof el.className === "string"
      ? el.className.slice(0, 120)
      : "",
    pageUrl: typeof location !== "undefined" ? location.href : ""
  });
}

function filterPaintReachableRects(el, rects) {
  if (!Array.isArray(rects) || rects.length === 0) {
    return [];
  }
  const reachableRects = rects.filter((rect) => getPaintReachabilityForRect(el, rect) !== false);
  if (reachableRects.length > 0) {
    return reachableRects;
  }
  // Guard against hit-testing false negatives on complex masks/sliders where
  // the target can be visible but not top-most at sampled points.
  if (
    el &&
    el.nodeType === 1 &&
    isVisible(el) &&
    !isDefinitelyHiddenSubtreeElement(el)
  ) {
    reportPaintReachabilityFallback(el, rects.length);
    return rects;
  }
  return reachableRects;
}

function isPaintReachableInCurrentViewport(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const rects = collectRectsFromClientRects(el.getClientRects());
  if (rects.length === 0) {
    return true;
  }
  let sawUnknown = false;
  for (const rect of rects) {
    const reachability = getPaintReachabilityForRect(el, rect);
    if (reachability === true) {
      return true;
    }
    if (reachability === null) {
      sawUnknown = true;
    }
  }
  return sawUnknown;
}

function getRealityCheckPoints(rect) {
  const inset = 1;
  const left = rect.left + inset;
  const right = rect.right - inset;
  const top = rect.top + inset;
  const bottom = rect.bottom - inset;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return [
    [centerX, centerY],
    [left, top],
    [left, bottom],
    [right, top],
    [right, bottom]
  ];
}

function isActuallyVisibleToUser(el) {
  const visibleRect = getElementEffectiveVisibleRect(el, { clipToViewport: true });
  if (!visibleRect) {
    return false;
  }
  if (typeof document.elementFromPoint !== "function") {
    return true;
  }
  const points = getRealityCheckPoints(visibleRect);
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      continue;
    }
    const elementsAtPoint = getPageHitElementsAtPoint(x, y);
    if (elementsAtPoint.length > 0 && isElementInHitPath(elementsAtPoint[0], el)) {
      return true;
    }
  }
  return false;
}

function isActuallyVisibleInDocument(el) {
  const visibleRect = getElementEffectiveVisibleRect(el, { clipToViewport: false });
  if (!visibleRect) {
    return false;
  }
  if (hasFixedPositionAncestor(el)) {
    return Boolean(intersectRects(visibleRect, getViewportBounds()));
  }
  return isReachableInDocumentVisualArea(visibleRect, getSubmissionVisualBounds());
}

function anyClientRectIntersectsSubmissionArea(el) {
  if (!el || el.nodeType !== 1 || typeof el.getClientRects !== "function") {
    return false;
  }
  let clientRects;
  try {
    clientRects = el.getClientRects();
  } catch (_) {
    return false;
  }
  if (!clientRects || clientRects.length === 0) {
    return false;
  }
  const fixed = hasFixedPositionAncestor(el);
  const viewportBounds = getViewportBounds();
  const submissionBounds = getSubmissionVisualBounds();
  for (const rect of clientRects) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    if (fixed) {
      if (intersectRects(rect, viewportBounds)) {
        return true;
      }
      continue;
    }
    const docRect = toDocumentCoordinateRect(rect);
    if (intersectRects(docRect, submissionBounds)) {
      return true;
    }
  }
  return false;
}

function getTheoreticalVisibilityState(node, style) {
  if (!node || node.nodeType !== 1) {
    return { definitiveHidden: true, ambiguousHidden: false };
  }
  const ambiguousHidden = Boolean(
    node.getAttribute("aria-hidden") === "true" ||
    (node.classList &&
      (node.classList.contains("sr-only") || node.classList.contains("visually-hidden")))
  );
  const definitiveHidden = Boolean(
    node.hidden ||
    (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse")) ||
    (style && parseFloat(style.opacity) === 0) ||
    isVisuallyHiddenByStyle(style)
  );
  return { definitiveHidden, ambiguousHidden };
}

function isVisuallyHiddenByStyle(style) {
  if (!style) {
    return false;
  }
  const clip = (style.clip || "").replace(/\s+/g, "").toLowerCase();
  if (clip && clip !== "auto" && clip.includes("rect(")) {
    const numbers = clip.match(/-?\d*\.?\d+/g);
    if (numbers && numbers.length >= 4) {
      const allZero = numbers.every((value) => Number(value) === 0);
      if (allZero) {
        return true;
      }
    }
  }
  const clipPath = (style.clipPath || "").replace(/\s+/g, "").toLowerCase();
  if (
      clipPath &&
      clipPath !== "none" &&
      (clipPath.includes("inset(50%") ||
          clipPath.includes("inset(100%") ||
          clipPath.includes("circle(0") ||
          clipPath.includes("ellipse(0"))
  ) {
    return true;
  }
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  const position = style.position;
  if (
      (Number.isFinite(width) && width <= 1) ||
      (Number.isFinite(height) && height <= 1)
  ) {
    if (
        style.overflow === "hidden" &&
        (position === "absolute" || position === "fixed" || position === "sticky")
    ) {
      return true;
    }
  }
  return false;
}

function hasDirectText(el) {
  const cache = state.directTextCache;
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  let result = false;
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      result = true;
      break;
    }
  }
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function getCachedNormalizedElementText(el) {
  const cache = state.normalizedTextCache;
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  const value = getNormalizedElementText(el);
  if (cache) {
    cache.set(el, value);
  }
  return value;
}

function matchesToggleableDefaultExcluded(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const cache = state.toggleableDefaultCache;
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  let result = false;
  for (const selector of DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS) {
    try {
      if (isTagSelector(selector)) {
        if (el.tagName === selector.toUpperCase()) {
          result = true;
          break;
        }
      } else if (el.matches(selector)) {
        result = true;
        break;
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function hasNestedToggleableDefaultExcludedDescendant(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(el.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node) || isWithinConsentElement(node)) {
      continue;
    }
    if (matchesToggleableDefaultExcluded(node)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function isTextualContainer(el, options = {}) {
  const cache = getTextualOptionCache(state.textualContainerCache, options);
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  const ignoreVisibilityForInclusionDetection = Boolean(
    options && options.ignoreVisibilityForInclusionDetection
  );
  if (!ignoreVisibilityForInclusionDetection && !isVisible(el)) {
    if (cache) {
      cache.set(el, false);
    }
    return false;
  }
  let result;
  if (hasDirectText(el)) {
    result = true;
  } else if (matchesToggleableDefaultExcluded(el)) {
    if (el.children.length > 0) {
      result = true;
    } else {
      const nestedText = (el.innerText || "").replace(/\s+/g, " ").trim();
      result = Boolean(nestedText);
    }
  } else {
    result = Boolean(getCachedNormalizedElementText(el));
  }
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function hasTextualDescendant(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const cache = getTextualOptionCache(state.textualDescendantCache, options);
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  let result = false;
  const stack = Array.from(el.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node)) {
      continue;
    }
    if (isWithinConsentElement(node)) {
      continue;
    }
    if (isWithinImmutableExcluded(node)) {
      continue;
    }
    if (isTextualContainer(node, options)) {
      result = true;
      break;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function hasTextualImmutableDescendant(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const cache = getTextualOptionCache(state.textualImmutableDescendantCache, options);
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  let result = false;
  const stack = Array.from(el.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node)) {
      continue;
    }
    if (isWithinConsentElement(node)) {
      continue;
    }
    if (isWithinImmutableExcluded(node) && isTextualContainer(node, options)) {
      result = true;
      break;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function hasVisibleImmutableDescendant(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(el.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node) || isWithinConsentElement(node)) {
      continue;
    }
    if (matchesImmutableExcluded(node) && isVisible(node)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function matchesAutoToggleableDefaultExcluded(el) {
  if (!matchesToggleableDefaultExcluded(el)) {
    return false;
  }
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (!hasTextualDescendant(el)) {
    return true;
  }
  if (hasNestedToggleableDefaultExcludedDescendant(el)) {
    return true;
  }
  return !hasVisibleImmutableDescendant(el);
}

function hasExplicitlyMarkedDescendant(el) {
  if (!el || el.nodeType !== 1 || !state.config) {
    return false;
  }
  const explicitExcludeSet = getExcludedXPathSet(state.config, location.href);
  const explicitIncludeSet = getIncludeXPathSet(state.config, location.href);
  if (explicitExcludeSet.size === 0 && explicitIncludeSet.size === 0) {
    return false;
  }
  const stack = Array.from(el.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node)) {
      continue;
    }
    if (isWithinConsentElement(node)) {
      continue;
    }
    if (isWithinImmutableExcluded(node)) {
      continue;
    }
    const xpath = getXPath(node);
    if (
      xpath &&
      (explicitExcludeSet.has(xpath) || explicitIncludeSet.has(xpath))
    ) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function isSelfMarkableWithoutParentMode(el, options = {}) {
  const diagnostics = options && options.__diagnostics ? options.__diagnostics : null;
  const textualContainerStartedAt = diagnostics ? nowMs() : 0;
  const textualContainer = isTextualContainer(el, options);
  if (diagnostics) {
    diagnostics.textualContainerCount += 1;
    diagnostics.textualContainerElapsedMs += nowMs() - textualContainerStartedAt;
  }
  if (!textualContainer) {
    return false;
  }
  const paintReachableStartedAt = diagnostics ? nowMs() : 0;
  const paintReachable = isPaintReachableInCurrentViewport(el);
  if (diagnostics) {
    diagnostics.paintReachableCount += 1;
    diagnostics.paintReachableElapsedMs += nowMs() - paintReachableStartedAt;
  }
  if (!paintReachable) {
    return false;
  }
  // Preserve the previous shallowest-ancestor behavior: hidden responsive
  // descendants should not suppress a visible ancestor just because preview/
  // silent inclusion detection is configured to ignore visibility.
  const descendantShapeOptions = options && options.ignoreVisibilityForInclusionDetection
    ? {
      ...options,
      ignoreVisibilityForInclusionDetection: false
    }
    : options;
  const hasDirectOwnText = hasDirectText(el);
  const textualDescendantStartedAt = diagnostics ? nowMs() : 0;
  const hasVisibleTextualDescendant = hasTextualDescendant(el, descendantShapeOptions);
  if (diagnostics) {
    diagnostics.textualDescendantCount += 1;
    diagnostics.textualDescendantElapsedMs += nowMs() - textualDescendantStartedAt;
  }
  if (!hasDirectOwnText && hasVisibleTextualDescendant) {
    return false;
  }
  if (!matchesToggleableDefaultExcluded(el)) {
    if (!hasDirectOwnText && !hasVisibleTextualDescendant) {
      return false;
    }
    let hasImmutableTextualDescendant = false;
    if (!hasDirectOwnText) {
      const immutableDescendantStartedAt = diagnostics ? nowMs() : 0;
      hasImmutableTextualDescendant = hasTextualImmutableDescendant(el, descendantShapeOptions);
      if (diagnostics) {
        diagnostics.immutableTextualDescendantCount += 1;
        diagnostics.immutableTextualDescendantElapsedMs += nowMs() - immutableDescendantStartedAt;
      }
    }
    if (!hasDirectOwnText && hasImmutableTextualDescendant) {
      return false;
    }
    return true;
  }
  let hasMarkedDescendant = false;
  const explicitMarkedDescendantStartedAt = diagnostics ? nowMs() : 0;
  hasMarkedDescendant = hasExplicitlyMarkedDescendant(el);
  if (diagnostics) {
    diagnostics.explicitMarkedDescendantCount += 1;
    diagnostics.explicitMarkedDescendantElapsedMs += nowMs() - explicitMarkedDescendantStartedAt;
  }
  return shouldSelfMarkToggleableDefaultBoundary({
    hasDirectOwnText,
    hasVisibleTextualDescendant,
    hasExplicitlyMarkedDescendant: hasMarkedDescendant
  });
}

function isExplicitIncludeBoundaryCandidate(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinImmutableExcluded(el)) {
    return false;
  }
  if (!hasRenderableMarkingTargetGeometry(el, { allowGhost: true })) {
    return false;
  }
  if (isSelfMarkableWithoutParentMode(el, options)) {
    return true;
  }
  return matchesToggleableDefaultExcluded(el) && hasDirectText(el) && isTextualContainer(el, options);
}

function isGroupedBoundaryChildCandidate(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinImmutableExcluded(el)) {
    return false;
  }
  if (!isTextualContainer(el, options)) {
    return false;
  }
  if (isSelfMarkableWithoutParentMode(el, options)) {
    return true;
  }
  return matchesToggleableDefaultExcluded(el) && hasDirectText(el);
}

function isStructuredGroupExclusionCandidate(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinImmutableExcluded(el)) {
    return false;
  }
  if (matchesToggleableDefaultExcluded(el) || hasDirectText(el)) {
    return false;
  }
  if (!isTextualContainer(el, options)) {
    return false;
  }
  if (isUnsafeShallowParentMarkingTarget(el, options || {})) {
    return false;
  }
  const children = Array.from(el.children || []).filter((child) => {
    if (!child || child.nodeType !== 1) {
      return false;
    }
    if (isWithinAiPopover(child)) {
      return false;
    }
    if (isWithinConsentElement(child) || isWithinImmutableExcluded(child)) {
      return false;
    }
    return true;
  });
  if (children.length < 2) {
    return false;
  }
  return children.every((child) => isGroupedBoundaryChildCandidate(child, options));
}

function matchesImmutableExcluded(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const cache = state.immutableMatchCache;
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  let result = false;
  for (const selector of DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS) {
    try {
      if (isTagSelector(selector)) {
        if (el.tagName === selector.toUpperCase()) {
          result = true;
          break;
        }
      } else if (el.matches(selector)) {
        result = true;
        break;
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function isWithinImmutableExcluded(el) {
  const cache = state.immutableAncestorCache;
  if (cache && cache.has(el)) {
    return cache.get(el);
  }
  let result = false;
  let node = el;
  while (node && node.nodeType === 1) {
    if (matchesImmutableExcluded(node)) {
      result = true;
      break;
    }
    node = node.parentElement;
  }
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function isToggleableDefaultExcludedElement(el, includedElements) {
  return matchesAutoToggleableDefaultExcluded(el) && !isWithinElementSet(el, includedElements);
}

function isWithinToggleableDefaultExcludedElement(el, includedElements) {
  if (isWithinElementSet(el, includedElements)) {
    return false;
  }
  let node = el;
  while (node && node.nodeType === 1) {
    if (isToggleableDefaultExcludedElement(node, includedElements)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function isWithinAiPopover(el) {
  return Boolean(
      state.aiPopover &&
      el &&
      el.nodeType === 1 &&
      state.aiPopover.contains(el)
  );
}

function isWithinExtensionUi(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  return Boolean(el.closest("[data-uf-extension-ui=\"true\"]"));
}

function registerConsentRoot(element) {
  if (!element || element.nodeType !== 1) {
    return false;
  }
  if (!state.consentRootElements) {
    state.consentRootElements = new Set();
  }
  const roots = state.consentRootElements;
  for (const root of roots) {
    if (!root || root.isConnected === false) {
      roots.delete(root);
      continue;
    }
    if (root === element || root.contains(element)) {
      return false;
    }
    if (element.contains(root)) {
      roots.delete(root);
    }
  }
  roots.add(element);
  return true;
}

function injectConsentBypassStyle() {
  if (document.getElementById(CONSENT_BYPASS_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = CONSENT_BYPASS_STYLE_ID;
  // Counter consent-framework patterns that apply pointer-events:none to page content
  // via aria-hidden (e.g. CookieTractor's html.cc-active [aria-hidden='true'] rule).
  // :not([data-uf-consent-hidden]) and :not([data-uf-consent-hidden] *) ensure we do
  // not re-enable pointer events on hidden consent elements or their descendants —
  // those keep their inline pointer-events:none !important which wins in specificity.
  style.textContent =
    `[aria-hidden='true']:not([${CONSENT_HIDDEN_ATTR}]):not([${CONSENT_HIDDEN_ATTR}] *) ` +
    `{ pointer-events: auto !important; }`;
  document.head.appendChild(style);
}

function removeConsentBypassStyle() {
  const existing = document.getElementById(CONSENT_BYPASS_STYLE_ID);
  if (existing) {
    existing.remove();
  }
}

function hideConsentElementVisibility(element) {
  if (!element || element.nodeType !== 1) {
    return;
  }
  element.style.setProperty("opacity", "0", "important");
  element.style.setProperty("visibility", "hidden", "important");
  element.style.setProperty("pointer-events", "none", "important");
  // Native <dialog open> elements live in the browser top-layer and intercept ALL
  // pointer events before CSS hit-testing runs — no CSS property can remove an element
  // from the top-layer. Calling close() removes it from the top-layer while keeping
  // the element fully in the DOM with all attributes, children and XPath intact,
  // so consent detection is unaffected.
  if (element.tagName.toLowerCase() === "dialog" && element.hasAttribute("open")) {
    try { element.close?.(); } catch { /* ignore */ }
  }
}

function markConsentElementHidden(element) {
  if (!element || element.nodeType !== 1) {
    return false;
  }
  const wasAlreadyMarked = element.hasAttribute(CONSENT_HIDDEN_ATTR);
  element.setAttribute(CONSENT_HIDDEN_ATTR, "on");
  hideConsentElementVisibility(element);
  return !wasAlreadyMarked;
}

function hideConsentElement(element) {
  if (isWithinAiPopover(element) || isWithinExtensionUi(element)) {
    return false;
  }
  if (isWithinConsentElement(element)) {
    return false;
  }

  let changed = false;
  if (markConsentElementHidden(element)) {
    changed = true;
  }

  const descendants = element.querySelectorAll("*");
  descendants.forEach((node) => {
    if (!node || node.nodeType !== 1) {
      return;
    }
    if (isWithinAiPopover(node) || isWithinExtensionUi(node)) {
      return;
    }
    if (markConsentElementHidden(node)) {
      changed = true;
    }
  });

  if (registerConsentRoot(element)) {
    changed = true;
  }

  return changed;
}

function isWithinConsentElement(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const roots = state.consentRootElements;
  if (roots && roots.size) {
    for (const root of roots) {
      if (!root || (root.isConnected === false)) {
        roots.delete(root);
        continue;
      }
      if (root === el || root.contains(el)) {
        return true;
      }
    }
  }
  return el.hasAttribute(CONSENT_HIDDEN_ATTR);
}

export function collectConsentExcludedElements() {
  const elements = new Set();
  const roots = state.consentRootElements;
  if (roots && roots.size) {
    for (const root of roots) {
      if (!root || root.nodeType !== 1 || root.isConnected === false) {
        continue;
      }
      elements.add(root);
    }
  }
  document.querySelectorAll(`[${CONSENT_HIDDEN_ATTR}]`).forEach((el) => {
    if (el && el.nodeType === 1 && el.isConnected !== false) {
      elements.add(el);
    }
  });
  return elements;
}

export function getXPath(el) {
  if (!el || el.nodeType !== 1) {
    return "";
  }
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}[${index}]`);
    if (node === document.documentElement) {
      break;
    }
    node = node.parentElement;
  }
  return `/${parts.join("/")}`;
}

function getSnapshotStripSelectors(options = {}) {
  const extraStripSelectors = Array.isArray(options.extraStripSelectors)
    ? options.extraStripSelectors.filter((value) => typeof value === "string" && value)
    : [];
  return EXTENSION_SNAPSHOT_STRIP_SELECTORS.concat(extraStripSelectors);
}

function matchesAnySelector(el, selectors) {
  if (!el || el.nodeType !== 1 || typeof el.matches !== "function") {
    return false;
  }
  for (const selector of selectors || []) {
    try {
      if (selector && el.matches(selector)) {
        return true;
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  return false;
}

function isStrippedFromSnapshot(el, options = {}) {
  const stripSelectors = getSnapshotStripSelectors(options);
  let node = el;
  while (node && node.nodeType === 1) {
    if (matchesAnySelector(node, stripSelectors)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function getSnapshotXPath(el, options = {}) {
  if (!el || el.nodeType !== 1 || isStrippedFromSnapshot(el, options)) {
    return "";
  }
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    if (isStrippedFromSnapshot(node, options)) {
      return "";
    }
    const tag = node.tagName.toLowerCase();
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (
        sibling.tagName === node.tagName &&
        !isStrippedFromSnapshot(sibling, options)
      ) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}[${index}]`);
    if (node === document.documentElement) {
      break;
    }
    node = node.parentElement;
  }
  return `/${parts.join("/")}`;
}

export function isXPathDescendant(parentXpath, childXpath) {
  if (!parentXpath || !childXpath) {
    return false;
  }
  const prefix = `${parentXpath}/`;
  return childXpath.startsWith(prefix);
}

function isWithinExplicitExcludedXpath(xpath, excludedSet) {
  if (!xpath || !excludedSet || excludedSet.size === 0) {
    return false;
  }
  for (const excludedXpath of excludedSet) {
    if (!excludedXpath || excludedXpath === xpath) {
      continue;
    }
    if (isXPathDescendant(excludedXpath, xpath)) {
      return true;
    }
  }
  return false;
}

function escapeCssIdentifier(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function getClassSelector(node) {
  if (!node || !node.classList) {
    return "";
  }
  const classes = Array.from(node.classList)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !value.startsWith("uf-"));
  if (!classes.length) {
    return "";
  }
  return {
    classes,
    selector: `.${classes.map((value) => escapeCssIdentifier(value)).join(".")}`
  };
}

function getNthOfTypeIndex(el) {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) {
      index += 1;
    }
    sibling = sibling.previousElementSibling;
  }
  return index;
}

/**
 * Builds a CSS selector path for an element, including class selectors or nth-of-type.
 * Used primarily for debugging or advanced element targeting.
 * @private
 * @param {Element} el - The element to build a selector path for
 * @returns {string} A CSS selector path from body to the element
 */
function buildCssSelectorPath(el) {
  if (!el || el.nodeType !== 1) {
    return "";
  }
  if (el === document.documentElement || el === document.body) {
    return "";
  }
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    if (node === document.documentElement || node === document.body) {
      break;
    }
    const tag = node.tagName.toLowerCase();
    const classInfo = getClassSelector(node);
    const classSelector = classInfo ? classInfo.selector : "";
    let segment = `${tag}${classSelector}`;
    if (!classSelector) {
      const index = getNthOfTypeIndex(node);
      segment = `${tag}:nth-of-type(${index})`;
    } else if (node.parentElement) {
      const siblings = Array.from(node.parentElement.children).filter((sibling) => {
        if (sibling.tagName !== node.tagName) {
          return false;
        }
        return classInfo.classes.every((cls) => sibling.classList.contains(cls));
      });
      if (siblings.length > 1) {
        const index = getNthOfTypeIndex(node);
        segment = `${segment}:nth-of-type(${index})`;
      }
    }
    parts.unshift(segment);
    if (node === document.documentElement) {
      break;
    }
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function collectXPathElements(xpaths) {
  const elements = new Set();
  for (const xpath of xpaths || []) {
    const el = getElementFromXPath(xpath);
    if (el) {
      elements.add(el);
    }
  }
  return elements;
}

function hasExplicitUserMarkings(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
  if (includeXpaths.some((xpath) => typeof xpath === "string" && xpath)) {
    return true;
  }
  const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  for (const item of items) {
    if (!item || typeof item.xpath !== "string" || !item.xpath) {
      continue;
    }
    const el = getElementFromXPath(item.xpath);
    if (!el) {
      // Missing elements are typically preserved explicit markings from older snapshots.
      return true;
    }
    if (isSilentWhitespaceExplicitExclusion(entry, item, el)) {
      continue;
    }
    const isDefaultExcluded = matchesToggleableDefaultExcluded(el);
    if (isStoredExcludeStateUserModified({
      isExcluded: item.excluded,
      isDefaultExcluded
    })) {
      return true;
    }
  }
  return false;
}

function isWithinExcludedParents(el, excludedParents) {
  if (!el || !excludedParents || excludedParents.size === 0) {
    return false;
  }
  for (const parent of excludedParents) {
    if (parent && parent !== el && parent.contains(el)) {
      return true;
    }
  }
  return false;
}

function collectExcludedParentElements(items) {
  const parents = new Set();
  if (!Array.isArray(items)) {
    return parents;
  }
  for (const item of items) {
    if (!item || !item.xpath || !item.excluded) {
      continue;
    }
    const el = getElementFromXPath(item.xpath);
    if (!el) {
      continue;
    }
    if (isWithinConsentElement(el)) {
      continue;
    }
    if (isWithinImmutableExcluded(el)) {
      continue;
    }
    parents.add(el);
  }
  return parents;
}

function scanReconcileDocumentCandidates(immutableExcluded, excludedParents) {
  const toggleableCandidates = [];
  const silentWhitespaceCandidates = [];
  if (!document.body) {
    return {
      toggleableCandidates,
      silentWhitespaceCandidates,
      stats: {
        visitedCount: 0,
        autoDefaultCount: 0,
        autoDefaultElapsedMs: 0,
        selfMarkableCount: 0,
        selfMarkableElapsedMs: 0,
        textualContainerCount: 0,
        textualContainerElapsedMs: 0,
        paintReachableCount: 0,
        paintReachableElapsedMs: 0,
        textualDescendantCount: 0,
        textualDescendantElapsedMs: 0,
        immutableTextualDescendantCount: 0,
        immutableTextualDescendantElapsedMs: 0,
        explicitMarkedDescendantCount: 0,
        explicitMarkedDescendantElapsedMs: 0
      }
    };
  }
  const stack = [{ node: document.body, withinExcludedParent: false }];
  const hasExcludedParents = Boolean(excludedParents && excludedParents.size);
  const stats = {
    visitedCount: 0,
    autoDefaultCount: 0,
    autoDefaultElapsedMs: 0,
    selfMarkableCount: 0,
    selfMarkableElapsedMs: 0,
    textualContainerCount: 0,
    textualContainerElapsedMs: 0,
    paintReachableCount: 0,
    paintReachableElapsedMs: 0,
    textualDescendantCount: 0,
    textualDescendantElapsedMs: 0,
    immutableTextualDescendantCount: 0,
    immutableTextualDescendantElapsedMs: 0,
    explicitMarkedDescendantCount: 0,
    explicitMarkedDescendantElapsedMs: 0
  };
  while (stack.length) {
    const current = stack.pop();
    const node = current && current.node;
    if (!node || node.nodeType !== 1) {
      continue;
    }
    stats.visitedCount += 1;
    if (isWithinAiPopover(node)) {
      continue;
    }
    const withinConsent = isWithinConsentElement(node);
    if (withinConsent) {
      continue;
    }
    const withinImmutable = isWithinImmutableExcluded(node);
    const isExcludedParentBoundary = hasExcludedParents && excludedParents.has(node);
    let autoToggleableDefault = false;
    if (
      !current.withinExcludedParent &&
      !withinImmutable
    ) {
      const autoDefaultStartedAt = nowMs();
      autoToggleableDefault = matchesAutoToggleableDefaultExcluded(node) && isTextualContainer(node);
      stats.autoDefaultElapsedMs += nowMs() - autoDefaultStartedAt;
      stats.autoDefaultCount += 1;
      if (autoToggleableDefault) {
        toggleableCandidates.push(node);
      } else {
        const selfMarkableStartedAt = nowMs();
        const selfMarkable = isSelfMarkableWithoutParentMode(node, { __diagnostics: stats });
        stats.selfMarkableElapsedMs += nowMs() - selfMarkableStartedAt;
        stats.selfMarkableCount += 1;
        if (selfMarkable) {
          toggleableCandidates.push(node);
        }
      }
    }
    if (
      !withinImmutable &&
      !isWithinExtensionUi(node) &&
      isSilentWhitespaceExclusionCandidate(node)
    ) {
      silentWhitespaceCandidates.push(node);
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push({
        node: node.children[i],
        withinExcludedParent: current.withinExcludedParent || isExcludedParentBoundary
      });
    }
  }
  return {
    toggleableCandidates,
    silentWhitespaceCandidates,
    stats
  };
}

async function scanReconcileDocumentCandidatesAsync(immutableExcluded, excludedParents, options = {}) {
  const toggleableCandidates = [];
  const silentWhitespaceCandidates = [];
  if (!document.body) {
    return {
      toggleableCandidates,
      silentWhitespaceCandidates,
      stats: {
        visitedCount: 0,
        autoDefaultCount: 0,
        autoDefaultElapsedMs: 0,
        selfMarkableCount: 0,
        selfMarkableElapsedMs: 0,
        textualContainerCount: 0,
        textualContainerElapsedMs: 0,
        paintReachableCount: 0,
        paintReachableElapsedMs: 0,
        textualDescendantCount: 0,
        textualDescendantElapsedMs: 0,
        immutableTextualDescendantCount: 0,
        immutableTextualDescendantElapsedMs: 0,
        explicitMarkedDescendantCount: 0,
        explicitMarkedDescendantElapsedMs: 0
      }
    };
  }
  const shouldAbort = typeof options.shouldAbort === "function"
    ? options.shouldAbort
    : null;
  const stack = [{ node: document.body, withinExcludedParent: false }];
  const hasExcludedParents = Boolean(excludedParents && excludedParents.size);
  const stats = {
    visitedCount: 0,
    autoDefaultCount: 0,
    autoDefaultElapsedMs: 0,
    selfMarkableCount: 0,
    selfMarkableElapsedMs: 0,
    textualContainerCount: 0,
    textualContainerElapsedMs: 0,
    paintReachableCount: 0,
    paintReachableElapsedMs: 0,
    textualDescendantCount: 0,
    textualDescendantElapsedMs: 0,
    immutableTextualDescendantCount: 0,
    immutableTextualDescendantElapsedMs: 0,
    explicitMarkedDescendantCount: 0,
    explicitMarkedDescendantElapsedMs: 0
  };
  let processedCount = 0;
  while (stack.length) {
    const current = stack.pop();
    const node = current && current.node;
    if (!node || node.nodeType !== 1) {
      continue;
    }
    stats.visitedCount += 1;
    if (shouldAbort && shouldAbort()) {
      return { toggleableCandidates, silentWhitespaceCandidates, stats };
    }
    if (isWithinAiPopover(node)) {
      continue;
    }
    const withinConsent = isWithinConsentElement(node);
    if (withinConsent) {
      continue;
    }
    const withinImmutable = isWithinImmutableExcluded(node);
    const isExcludedParentBoundary = hasExcludedParents && excludedParents.has(node);
    let autoToggleableDefault = false;
    if (
      !current.withinExcludedParent &&
      !withinImmutable
    ) {
      const autoDefaultStartedAt = nowMs();
      autoToggleableDefault = matchesAutoToggleableDefaultExcluded(node) && isTextualContainer(node);
      stats.autoDefaultElapsedMs += nowMs() - autoDefaultStartedAt;
      stats.autoDefaultCount += 1;
      if (autoToggleableDefault) {
        toggleableCandidates.push(node);
      } else {
        const selfMarkableStartedAt = nowMs();
        const selfMarkable = isSelfMarkableWithoutParentMode(node, { __diagnostics: stats });
        stats.selfMarkableElapsedMs += nowMs() - selfMarkableStartedAt;
        stats.selfMarkableCount += 1;
        if (selfMarkable) {
          toggleableCandidates.push(node);
        }
      }
    }
    if (
      !withinImmutable &&
      !isWithinExtensionUi(node) &&
      isSilentWhitespaceExclusionCandidate(node)
    ) {
      silentWhitespaceCandidates.push(node);
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push({
        node: node.children[i],
        withinExcludedParent: current.withinExcludedParent || isExcludedParentBoundary
      });
    }
    processedCount += 1;
    if (processedCount >= TOGGLE_RECONCILE_YIELD_INTERVAL) {
      processedCount = 0;
      await yieldForToggleReconcileWork();
    }
  }
  return {
    toggleableCandidates,
    silentWhitespaceCandidates,
    stats
  };
}

function collectToggleableTargets(immutableExcluded, excludedParents) {
  return scanReconcileDocumentCandidates(immutableExcluded, excludedParents).toggleableCandidates;
}

async function collectToggleableTargetsAsync(immutableExcluded, excludedParents, options = {}) {
  const scanned = await scanReconcileDocumentCandidatesAsync(immutableExcluded, excludedParents, options);
  return scanned.toggleableCandidates;
}

function collectDefaultHighlightTargets(root, options) {
  if (!root) {
    return [];
  }
  const {
    excludedSet = new Set(),
    hardExcludedSet = new Set(),
    hasHigherPrecedence = () => false,
    excludedAncestorSet = new Set()
  } = options || {};
  const results = [];
  const stack = [
    {
      node: root,
      index: 0,
      ancestorHardExcluded: false,
      ancestorExcluded: false
    }
  ];

  while (stack.length) {
    const frame = stack[stack.length - 1];
    const children = frame.node.children;
    if (frame.index < children.length) {
      const child = children[frame.index];
      frame.index += 1;
      if (isWithinAiPopover(child)) {
        continue;
      }
      if (isWithinConsentElement(child)) {
        continue;
      }
      const childHardExcluded =
          frame.ancestorHardExcluded ||
          hardExcludedSet.has(frame.node) ||
          hardExcludedSet.has(child);
      const childExcluded =
          frame.ancestorExcluded ||
          excludedAncestorSet.has(frame.node);
      stack.push({
        node: child,
        index: 0,
        ancestorHardExcluded: childHardExcluded,
        ancestorExcluded: childExcluded
      });
      continue;
    }

    const node = frame.node;
    const excludedSelf = excludedSet.has(node);
    const isRoot = node === document.body || node === document.documentElement;
    const candidate =
        !excludedSelf &&
        !isRoot &&
        !frame.ancestorHardExcluded &&
        !frame.ancestorExcluded &&
        isSelfMarkableWithoutParentMode(node) &&
        !hasHigherPrecedence(node);

    if (candidate) {
      results.push(node);
    }
    stack.pop();
  }

  return results;
}

export function collectDefaultLayerElements(root, options = {}) {
  const immutableExcluded = new Set(options.immutableExcluded || []);
  const consentExcluded = new Set(options.consentExcluded || []);
  const explicitExclude = new Set(options.explicitExclude || []);
  const explicitInclude = new Set(options.explicitInclude || []);
  const excludedByStateAncestors = new Set(options.excludedByStateAncestors || []);
  const aiContent = new Set(options.aiContent || []);
  const selectorExcluded = new Set(options.selectorExcluded || options.selectorExcludedSet || []);
  const hiddenStoredExplicitExclude = new Set(options.hiddenStoredExplicitExclude || []);
  const unexcludedToggleableDefault = new Set(options.unexcludedToggleableDefault || []);
  const precedenceSet = new Set([
    ...immutableExcluded,
    ...consentExcluded,
    ...explicitExclude,
    ...explicitInclude,
    ...excludedByStateAncestors,
    ...aiContent,
    ...selectorExcluded,
    ...unexcludedToggleableDefault
  ]);
  const hardExcludedSet = new Set([
    ...immutableExcluded,
    ...hiddenStoredExplicitExclude
  ]);

  return collectDefaultHighlightTargets(root, {
    excludedSet: precedenceSet,
    hardExcludedSet,
    hasHigherPrecedence: (el) => precedenceSet.has(el),
    // Selector-excluded elements do not render their own marking-mode layer, so
    // only the matched element should suppress the default layer, not its whole subtree.
    // Stored unexcluded default boundaries follow the same self-only rule.
    excludedAncestorSet: new Set([
      ...hardExcludedSet,
      ...consentExcluded,
      ...excludedByStateAncestors,
      ...explicitExclude,
      ...explicitInclude,
      ...aiContent
    ])
  });
}

function collectSelectorElements(selectors) {
  return collectCachedSelectorMatches({
    root: document,
    selectors,
    pageUrl:
      typeof window !== "undefined" && window.location
        ? window.location.href
        : "",
    scope: "core-selector-elements"
  }).nodes;
}

function seedMarkingsFromAiSelectorsForUnmarkedPage(
  configValue,
  pageUrl,
  selectorSet,
  immutableExcluded
) {
  if (!configValue || !pageUrl) {
    return { createdEntry: false, changed: false };
  }
  const existingEntry =
    configValue &&
    configValue.pageMarkings &&
    typeof configValue.pageMarkings === "object"
      ? configValue.pageMarkings[pageUrl] || null
      : null;
  const hasAnySavedMarks = hasExplicitUserMarkings(existingEntry);
  // Allow seeding into an existing empty page entry. Only skip if the page already
  // has real saved markings.
  if (hasAnySavedMarks) {
    return { createdEntry: false, changed: false };
  }
  const normalizedSelectorSet = normalizeAiSelectorSet(selectorSet);
  if (combineAiSelectorSet(normalizedSelectorSet).length === 0) {
    return { createdEntry: false, changed: false };
  }

  const entry = getPageMarkingEntry(configValue, pageUrl, { create: true, persist: true });
  const existingItems = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const existingIncludeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
  // This seeding path is only for pages without explicit saved marks. Reset any
  // previously generated/default-only rows first so CSS-seeded explicit marks become
  // the true precedence baseline for the subsequent default sync pass.
  const items = [];
  const includeXpaths = [];
  let changed = existingItems.length > 0 || existingIncludeXpaths.length > 0;

  const removeItemByXpath = (xpath) => {
    let removed = false;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item && item.xpath === xpath) {
        items.splice(i, 1);
        removed = true;
      }
    }
    if (removed) {
      changed = true;
    }
    return removed;
  };

  const removeIncludeByXpath = (xpath) => {
    let removed = false;
    for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
      if (includeXpaths[i] === xpath) {
        includeXpaths.splice(i, 1);
        removed = true;
      }
    }
    if (removed) {
      changed = true;
    }
    return removed;
  };

  const removeDescendants = (xpath) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!item || !item.xpath || item.xpath === xpath) {
        continue;
      }
      if (isXPathDescendant(xpath, item.xpath)) {
        items.splice(i, 1);
        changed = true;
      }
    }
    for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
      const childXpath = includeXpaths[i];
      if (!childXpath || childXpath === xpath) {
        continue;
      }
      if (isXPathDescendant(xpath, childXpath)) {
        includeXpaths.splice(i, 1);
        changed = true;
      }
    }
  };

  const getExplicitExcludeXPathSet = () =>
    new Set(
      items
        .filter((item) => item && item.xpath && item.excluded)
        .map((item) => item.xpath)
    );

  const setExplicitExclude = (xpath) => {
    let targetItem = items.find((item) => item && item.xpath === xpath);
    if (!targetItem) {
      items.push({ xpath, excluded: true });
      changed = true;
      return;
    }
    if (!targetItem.excluded) {
      targetItem.excluded = true;
      changed = true;
    }
  };

  const excludedMatches = Array.from(
    collectSelectorElements(normalizedSelectorSet.exclusionSelectors)
  )
    .filter((el) =>
      el &&
      el.nodeType === 1 &&
      !isWithinAiPopover(el) &&
      !isWithinConsentElement(el) &&
      !isWithinExtensionUi(el) &&
      !isWithinElementSet(el, immutableExcluded || new Set())
    )
    .sort((left, right) => {
      const depthDiff = getElementDepth(left) - getElementDepth(right);
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return compareDocumentOrder(left, right);
    });

  for (const el of excludedMatches) {
    const xpath = getXPath(el);
    if (!xpath) {
      continue;
    }
    const explicitExcludeSet = getExplicitExcludeXPathSet();
    if (isWithinExplicitExcludedXpath(xpath, explicitExcludeSet)) {
      continue;
    }
    removeIncludeByXpath(xpath);
    removeItemByXpath(xpath);
    removeDescendants(xpath);
    setExplicitExclude(xpath);
  }

  const includedMatches = Array.from(
    collectSelectorElements(normalizedSelectorSet.inclusionSelectors)
  )
    .filter((el) =>
      el &&
      el.nodeType === 1 &&
      !isWithinAiPopover(el) &&
      !isWithinConsentElement(el) &&
      !isWithinExtensionUi(el) &&
      !isWithinElementSet(el, immutableExcluded || new Set())
    )
    .sort(compareDocumentOrder);

  for (const el of includedMatches) {
    const xpath = getXPath(el);
    if (!xpath) {
      continue;
    }
    const entryOverride = {
      ...entry,
      xpaths: items,
      includeXpaths
    };
    if (!canApplyExplicitInclude(el, configValue, pageUrl, entryOverride)) {
      continue;
    }
    removeItemByXpath(xpath);
    if (!includeXpaths.includes(xpath)) {
      includeXpaths.push(xpath);
      changed = true;
    }
    removeDescendants(xpath);
  }

  entry.xpaths = items;
  entry.includeXpaths = includeXpaths;
  normalizePageEntryXpaths(entry);
  if (changed) {
    touchPageEntryTimestamp(entry);
  }
  setPageMarkingEntry(configValue.pageMarkings, pageUrl, entry);
  return { createdEntry: true, changed };
}

function isRawSelectorExcludedElement(el, excludedElements, includedElements) {
  return isWithinElementSet(el, excludedElements) && !isWithinElementSet(el, includedElements);
}

function isSelectorExcludedElement(
  el,
  excludedElements,
  includedElements,
  inclusionContextSet
) {
  return isRawSelectorExcludedElement(el, excludedElements, includedElements);
}

function isExcludedNatureElement(
  el,
  excludedElements,
  includedElements,
  inclusionContextSet
) {
  return matchesImmutableExcluded(el) ||
    isToggleableDefaultExcludedElement(el, includedElements) ||
    isSelectorExcludedElement(
      el,
      excludedElements,
      includedElements,
      inclusionContextSet
    );
}

function isInclusionEligibleElement(
  el,
  excludedElements,
  includedElements,
  inclusionContextSet,
  options = {}
) {
  const ignoreVisibilityForInclusionDetection = Boolean(
    options && options.ignoreVisibilityForInclusionDetection
  );
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinExtensionUi(el)) {
    return false;
  }
  if (
    !ignoreVisibilityForInclusionDetection &&
    !isVisible(el) &&
    !canUseCollapsedTextFallbackElement(el)
  ) {
    return false;
  }
  if (isWithinImmutableExcluded(el)) {
    return false;
  }
  if (isWithinToggleableDefaultExcludedElement(el, includedElements)) {
    return false;
  }
  return !isWithinElementSet(el, excludedElements) ||
    isWithinElementSet(el, includedElements) ||
    Boolean(inclusionContextSet && inclusionContextSet.has(el));
}

function isDefinitelyHiddenSubtreeElement(el) {
  if (!el || el.nodeType !== 1) {
    return true;
  }
  let theoreticallyHidden = false;
  try {
    theoreticallyHidden = isTheoreticallyInvisibleNode(el, window.getComputedStyle(el));
  } catch {
    return false;
  }
  if (!theoreticallyHidden) {
    return false;
  }
  return !isActuallyVisibleToUser(el);
}

function hasRenderableTextOutsideExcludedNature(
  el,
  excludedElements,
  includedElements,
  inclusionContextSet,
  options = {}
) {
  const ignoreVisibilityForInclusionDetection = Boolean(
    options && options.ignoreVisibilityForInclusionDetection
  );
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = [el];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node) || isWithinConsentElement(node) || isWithinExtensionUi(node)) {
      continue;
    }
    if (
      node !== el &&
      !ignoreVisibilityForInclusionDetection &&
      !isVisible(node) &&
      isDefinitelyHiddenSubtreeElement(node)
    ) {
      continue;
    }
    if (
      node !== el &&
      isExcludedNatureElement(
        node,
        excludedElements,
        includedElements,
        inclusionContextSet
      )
    ) {
      continue;
    }
    if (hasDirectText(node)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function hasRenderableTextForHighlight(
  el,
  excludedElements,
  includedElements,
  inclusionContextSet,
  options = {}
) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (hasDirectText(el)) {
    return true;
  }
  return hasRenderableTextOutsideExcludedNature(
    el,
    excludedElements,
    includedElements,
    inclusionContextSet,
    options
  );
}

function hasRenderableTextForExcludedHighlight(
  el,
  includedElements,
  inclusionContextSet
) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (hasDirectText(el)) {
    return true;
  }
  const stack = [el];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node) || isWithinConsentElement(node) || isWithinExtensionUi(node)) {
      continue;
    }
    if (
      node !== el &&
      !isVisible(node) &&
      isDefinitelyHiddenSubtreeElement(node)
    ) {
      continue;
    }
    if (
      node !== el &&
      isWithinElementSet(node, includedElements)
    ) {
      continue;
    }
    if (hasDirectText(node)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function collectExcludedChildrenInsideIncludedParents(
  includedParents,
  excludedElements,
  includedElements,
  inclusionContextSet
) {
  const marked = [];
  const seen = new Set();
  includedParents.forEach((parent) => {
    if (!parent || parent.nodeType !== 1) {
      return;
    }
    const stack = Array.from(parent.children || []);
    while (stack.length) {
      const el = stack.pop();
      if (!el || el.nodeType !== 1) {
        continue;
      }
      if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinExtensionUi(el)) {
        continue;
      }
      if (!isVisible(el) && isDefinitelyHiddenSubtreeElement(el)) {
        continue;
      }
      if (
        isExcludedNatureElement(
          el,
          excludedElements,
          includedElements,
          inclusionContextSet
        )
      ) {
        if (!seen.has(el) && hasRenderableTextForExcludedHighlight(
          el,
          includedElements,
          inclusionContextSet
        )) {
          seen.add(el);
          marked.push(el);
        }
        continue;
      }
      for (let i = el.children.length - 1; i >= 0; i -= 1) {
        stack.push(el.children[i]);
      }
    }
  });
  return marked;
}

function collectSelectorExcludedElements(
  excludedElements,
  includedElements,
  inclusionContextSet
) {
  const marked = new Set();
  for (const el of excludedElements || []) {
    if (!el || el.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinExtensionUi(el)) {
      continue;
    }
    if (!isVisible(el) && isDefinitelyHiddenSubtreeElement(el)) {
      continue;
    }
    if (isWithinElementSet(el, includedElements)) {
      continue;
    }
    if (!hasRenderableTextForExcludedHighlight(el, includedElements, inclusionContextSet)) {
      continue;
    }
    marked.add(el);
  }
  return Array.from(marked).sort(compareDocumentOrder);
}

export function collectToggleableDefaultExcludedElements(includedElements, options = {}) {
  if (!document.body) {
    return [];
  }
  const boundarySelfSkipSet = new Set(
    options.boundarySelfSkip || includedElements || []
  );
  const boundarySubtreeSkipSet = new Set(
    options.boundarySubtreeSkip || includedElements || []
  );
  const results = [];
  const stack = [document.body];
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) {
      continue;
    }
    const isToggleableDefaultExcluded = matchesAutoToggleableDefaultExcluded(el);
    const isBoundarySelfSkipped = boundarySelfSkipSet.has(el);
    const isWithinBoundarySubtreeSkip = isWithinElementSet(el, boundarySubtreeSkipSet);
    const isWithinImmutableBoundary = isWithinImmutableExcluded(el);
    if (shouldCollectToggleableDefaultBoundary({
      isToggleableDefaultExcluded,
      isHiddenSubtree: isToggleableDefaultExcluded &&
        !isVisible(el) &&
        isDefinitelyHiddenSubtreeElement(el),
      isWithinAiIncluded: isWithinBoundarySubtreeSkip,
      isWithinAiPopover: isWithinAiPopover(el),
      isWithinExplicitIncluded: isBoundarySelfSkipped,
      isWithinConsent: isWithinConsentElement(el),
      isWithinExtensionUi: isWithinExtensionUi(el),
      isImmutableExcluded: isWithinImmutableBoundary
    })) {
      results.push(el);
      continue;
    }
    if (
      (isToggleableDefaultExcluded && !isBoundarySelfSkipped) ||
      isWithinAiPopover(el) ||
      isWithinConsentElement(el) ||
      isWithinExtensionUi(el) ||
      isWithinBoundarySubtreeSkip ||
      isWithinImmutableBoundary
    ) {
      continue;
    }
    for (let i = el.children.length - 1; i >= 0; i -= 1) {
      stack.push(el.children[i]);
    }
  }
  return results.sort(compareDocumentOrder);
}

function collectExplicitIncludedElements(
  explicitIncludedMatches,
  excludedElements,
  includedElements,
  inclusionContextSet,
  options = {}
) {
  const preserveExplicitIncludedDescendants = Boolean(
    options && options.preserveExplicitIncludedDescendants
  );
  const includeAllExplicitMatches = Boolean(options && options.includeAllExplicitMatches);
  const selected = new Set();
  const ordered = preserveExplicitIncludedDescendants
    ? Array.from(new Set(explicitIncludedMatches || []))
      .filter((el) => el && el.nodeType === 1)
      .sort(compareDocumentOrder)
    : collapseElementsByNesting(explicitIncludedMatches, {
      prefer: "shallowest"
    });
  for (const el of ordered) {
    if (!el || el.nodeType !== 1) {
      continue;
    }
    if (!isInclusionEligibleElement(
      el,
      excludedElements,
      includedElements,
      inclusionContextSet,
      options
    )) {
      continue;
    }
    if (!includeAllExplicitMatches) {
      if (!isSelfMarkableWithoutParentMode(el, options)) {
        continue;
      }
      if (!hasRenderableTextOutsideExcludedNature(
        el,
        excludedElements,
        includedElements,
        inclusionContextSet,
        options
      )) {
        continue;
      }
    }
    selected.add(el);
  }
  if (preserveExplicitIncludedDescendants) {
    return Array.from(selected).sort(compareDocumentOrder);
  }
  return collapseElementsByNesting(selected, { prefer: "shallowest" }).filter((el) =>
    hasRenderableTextForHighlight(
      el,
      excludedElements,
      includedElements,
      inclusionContextSet,
      options
    )
  );
}

function collectImplicitIncludedElementsOutsideExplicit(
  explicitIncluded,
  excludedElements,
  includedElements,
  inclusionContextSet,
  options = {}
) {
  const explicitIncludedSet = new Set(explicitIncluded || []);
  const baseSelected = new Set();
  const stack = document.body ? [document.body] : [];
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) {
      continue;
    }
    if (
      explicitIncludedSet.size > 0 &&
      !explicitIncludedSet.has(el) &&
      isWithinElementSet(el, explicitIncludedSet)
    ) {
      continue;
    }
    if (!isInclusionEligibleElement(
      el,
      excludedElements,
      includedElements,
      inclusionContextSet,
      options
    )) {
      continue;
    }
    const rawSelectorExcluded = isRawSelectorExcludedElement(
      el,
      excludedElements,
      includedElements
    );
    const isAutoIncludedCollapsedText =
      canUseCollapsedTextFallbackElement(el) &&
      (
        getCachedNormalizedElementText(el) ||
        hasRenderableTextOutsideExcludedNature(
          el,
          excludedElements,
          includedElements,
          inclusionContextSet,
          options
        )
      );
    const isMarkableInclusionCandidate =
      isSelfMarkableWithoutParentMode(el, options);
    if (
      isMarkableInclusionCandidate &&
      (hasDirectText(el) || isAutoIncludedCollapsedText) &&
      !rawSelectorExcluded
    ) {
      baseSelected.add(el);
    }
    for (let i = el.children.length - 1; i >= 0; i -= 1) {
      stack.push(el.children[i]);
    }
  }
  return collapseElementsByNesting(baseSelected, { prefer: "shallowest" }).filter((el) =>
    hasRenderableTextForHighlight(
      el,
      excludedElements,
      includedElements,
      inclusionContextSet,
      options
    )
  );
}

function collectIncludedElementsFromSelectorSet(selectorSet, options = {}) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  const suppressedXpaths = Array.isArray(options && options.suppressedXpaths)
    ? options.suppressedXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
  const suppressedElementsByXpath = new Map();
  suppressedXpaths.forEach((xpath) => {
    const element = getElementFromXPath(xpath);
    if (element && element.nodeType === 1) {
      suppressedElementsByXpath.set(xpath, element);
    }
  });
  const suppressedElementSet = new Set(suppressedElementsByXpath.values());
  const unresolvedSuppressedXpaths = suppressedXpaths.filter((xpath) =>
    !suppressedElementsByXpath.has(xpath)
  );
  const isSuppressedSelectorElement = (element) => {
    if (!element || !suppressedXpaths.length) {
      return false;
    }
    if (isWithinElementSet(element, suppressedElementSet)) {
      return true;
    }
    if (!unresolvedSuppressedXpaths.length) {
      return false;
    }
    const xpath = getXPath(element);
    if (!xpath) {
      return false;
    }
    return unresolvedSuppressedXpaths.some((suppressedXpath) =>
      suppressedXpath === xpath || isXPathDescendant(suppressedXpath, xpath)
    );
  };
  const excludedElements = new Set(
    collapseElementsByNesting(collectSelectorElements(normalized.exclusionSelectors), {
      prefer: "shallowest"
    })
  );
  for (const element of Array.from(excludedElements)) {
    if (isSuppressedSelectorElement(element)) {
      excludedElements.delete(element);
    }
  }
  const rawIncludedElements = collectSelectorElements(normalized.inclusionSelectors);
  const includedElements = new Set();
  rawIncludedElements.forEach((el) => {
    if (
      el &&
      el.nodeType === 1 &&
      !isWithinConsentElement(el) &&
      !isSuppressedSelectorElement(el)
    ) {
      includedElements.add(el);
    }
  });
  const inclusionContextSet = buildInclusionContextSet(includedElements);
  const explicitIncluded = collectExplicitIncludedElements(
    includedElements,
    excludedElements,
    includedElements,
    inclusionContextSet,
    options
  );
  const explicitIncludedSet = new Set(explicitIncluded);
  const explicitIncludedContextSet = buildInclusionContextSet(explicitIncludedSet);
  const toggleableDefaultExcluded = collectToggleableDefaultExcludedElements(explicitIncludedSet);
  const excludedBoundaryElements = new Set([
    ...Array.from(excludedElements),
    ...toggleableDefaultExcluded
  ]);
  const implicitIncluded = collectImplicitIncludedElementsOutsideExplicit(
    explicitIncluded,
    excludedElements,
    includedElements,
    inclusionContextSet,
    options
  );
  const preserveExplicitIncludedDescendants = Boolean(
    options && options.preserveExplicitIncludedDescendants
  );
  const included = (
    preserveExplicitIncludedDescendants
      ? collapseElementsByNestingPreservingExplicit(
        [...explicitIncluded, ...implicitIncluded],
        explicitIncludedSet
      )
      : collapseElementsByNesting(
        new Set([...explicitIncluded, ...implicitIncluded]),
        { prefer: "shallowest" }
      )
  ).filter((el) =>
    shouldRetainIncludedSource({
      explicitlyIncluded: explicitIncludedSet.has(el),
      visibleToUser: isVisible(el) || !isDefinitelyHiddenSubtreeElement(el)
    }) &&
    (
      explicitIncludedSet.has(el) ||
      hasRenderableTextForHighlight(
        el,
        excludedElements,
        includedElements,
        inclusionContextSet,
        options
      )
    )
  );
  const includedScopeRootsForExcludedTraversal = collapseElementsByNesting(includedElements, {
    prefer: "shallowest"
  });
  const excludedDescendants = collectExcludedChildrenInsideIncludedParents(
    includedScopeRootsForExcludedTraversal,
    excludedElements,
    explicitIncludedSet,
    explicitIncludedContextSet
  );
  const selectorExcluded = collectSelectorExcludedElements(
    excludedBoundaryElements,
    explicitIncludedSet,
    explicitIncludedContextSet
  );
  const inferredExcluded = collapseElementsByNestingWithOppositeBoundary(
    excludedDescendants,
    explicitIncludedSet
  );
  const excluded = Array.from(
    new Set([...(selectorExcluded || []), ...(inferredExcluded || [])])
  ).sort(compareDocumentOrder);
  return { included, excluded };
}

function getElementDepth(el) {
  let depth = 0;
  let current = el;
  while (current && current.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function compareDocumentOrder(left, right) {
  if (left === right) {
    return 0;
  }
  const relation = left.compareDocumentPosition(right);
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
    return -1;
  }
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
    return 1;
  }
  return 0;
}

function addElementAndAncestorsToSet(targetSet, element) {
  let current = element;
  while (current && current.nodeType === 1) {
    targetSet.add(current);
    current = current.parentElement;
  }
}

/**
 * Collapses a collection of elements, removing nested or descendant elements.
 * Useful for deduplicating element selections based on DOM hierarchy.
 * @param {Element[]|NodeList} elements - The elements to collapse
 * @param {Object} [options={}] - Options for collapsing
 * @param {boolean} [options.onlyVisible=false] - Only include visible elements
 * @param {string} [options.prefer='shallowest'] - 'shallowest' to keep ancestors or 'deepest' to keep descendants
 * @returns {Element[]} Collapsed array of elements
 */
export function collapseElementsByNesting(elements, options = {}) {
  const { onlyVisible = false, prefer = "shallowest" } = options;
  const list = Array.from(new Set(elements || [])).filter((el) => {
    if (!el || el.nodeType !== 1) {
      return false;
    }
    if (onlyVisible && !isVisible(el)) {
      return false;
    }
    return true;
  });
  list.sort((left, right) => {
    const depthDiff = getElementDepth(left) - getElementDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareDocumentOrder(left, right);
  });
  if (prefer === "deepest") {
    const reverseSorted = list.slice().sort((left, right) => {
      const depthDiff = getElementDepth(right) - getElementDepth(left);
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return compareDocumentOrder(left, right);
    });
    const keptDeep = [];
    const keptDeepAncestorSet = new Set();
    for (const candidate of reverseSorted) {
      if (!keptDeepAncestorSet.has(candidate)) {
        keptDeep.push(candidate);
        addElementAndAncestorsToSet(keptDeepAncestorSet, candidate);
      }
    }
    keptDeep.sort(compareDocumentOrder);
    return keptDeep;
  }
  const kept = [];
  const keptSet = new Set();
  for (const candidate of list) {
    let current = candidate.parentElement;
    let hasAncestor = false;
    while (current && current.nodeType === 1) {
      if (keptSet.has(current)) {
        hasAncestor = true;
        break;
      }
      current = current.parentElement;
    }
    if (!hasAncestor) {
      kept.push(candidate);
      keptSet.add(candidate);
    }
  }
  kept.sort(compareDocumentOrder);
  return kept;
}

function collapseElementsByNestingPreservingExplicit(elements, explicitElements) {
  const explicitSet = new Set(explicitElements || []);
  const list = Array.from(new Set(elements || [])).filter((el) => el && el.nodeType === 1);
  list.sort((left, right) => {
    const depthDiff = getElementDepth(left) - getElementDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareDocumentOrder(left, right);
  });
  const kept = [];
  const keptSet = new Set();
  for (const candidate of list) {
    if (explicitSet.has(candidate)) {
      if (!keptSet.has(candidate)) {
        kept.push(candidate);
        keptSet.add(candidate);
      }
      continue;
    }
    let current = candidate.parentElement;
    let suppressed = false;
    while (current && current.nodeType === 1) {
      if (keptSet.has(current)) {
        suppressed = true;
        break;
      }
      current = current.parentElement;
    }
    if (suppressed) {
      continue;
    }
    kept.push(candidate);
    keptSet.add(candidate);
  }
  kept.sort(compareDocumentOrder);
  return kept;
}

function collapseElementsByNestingWithOppositeBoundary(elements, oppositeElements) {
  const oppositeSet = new Set(oppositeElements || []);
  const list = Array.from(new Set(elements || [])).filter((el) => el && el.nodeType === 1);
  list.sort((left, right) => {
    const depthDiff = getElementDepth(left) - getElementDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareDocumentOrder(left, right);
  });
  const kept = [];
  const keptSet = new Set();
  for (const candidate of list) {
    let current = candidate.parentElement;
    while (current && current.nodeType === 1) {
      if (oppositeSet.has(current)) {
        break;
      }
      if (keptSet.has(current)) {
        current = null;
        break;
      }
      current = current.parentElement;
    }
    if (current === null) {
      continue;
    }
    kept.push(candidate);
    keptSet.add(candidate);
  }
  kept.sort(compareDocumentOrder);
  return kept;
}

function collectExcludedXPaths(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const results = [];
  for (const item of items) {
    if (item && item.xpath && item.excluded) {
      results.push(item.xpath);
    }
  }
  return results;
}

function collectExplicitExcludedXPaths(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const results = [];
  for (const item of items) {
    if (item && item.xpath && item.excluded && item.explicit === true) {
      results.push(item.xpath);
    }
  }
  return results;
}

function collectSilentWhitespaceExcludedXPaths(entry) {
  return normalizeXPathList(entry && entry.silentWhitespaceExcludedXpaths);
}

function hasVisibleNonTextualContent(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = [el];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    const tag = node.tagName;
    if (
      tag === "IMG" ||
      tag === "SVG" ||
      tag === "CANVAS" ||
      tag === "VIDEO" ||
      tag === "AUDIO" ||
      tag === "IFRAME" ||
      tag === "PICTURE" ||
      tag === "OBJECT" ||
      tag === "EMBED" ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON"
    ) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function isSilentWhitespaceExclusionCandidate(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (el === document.documentElement || el === document.body) {
    return false;
  }
  if (
    isWithinExtensionUi(el) ||
    isWithinAiPopover(el) ||
    isWithinConsentElement(el) ||
    isWithinImmutableExcluded(el)
  ) {
    return false;
  }
  if (!isVisible(el) || !hasRenderableMarkingTargetGeometry(el)) {
    return false;
  }
  const style = window.getComputedStyle(el);
  const display = style && typeof style.display === "string" ? style.display : "";
  const inlineDisplays = new Set(["inline", "inline-block", "inline-flex", "inline-grid", "inline-table"]);
  if (!display || display === "none" || display === "contents" || inlineDisplays.has(display)) {
    return false;
  }
  if (getCachedNormalizedElementText(el)) {
    return false;
  }
  return !hasVisibleNonTextualContent(el);
}

function isSilentWhitespaceExplicitExclusion(entry, item, el = null) {
  if (!item || !item.xpath || item.excluded !== true || item.explicit !== true) {
    return false;
  }
  const silentXpaths = new Set(collectSilentWhitespaceExcludedXPaths(entry));
  if (silentXpaths.has(item.xpath)) {
    return true;
  }
  const resolved = el || getElementFromXPath(item.xpath);
  return isSilentWhitespaceExclusionCandidate(resolved);
}

function setEntrySilentWhitespaceExcludedXpaths(entry, xpaths) {
  if (!entry || typeof entry !== "object" || entry === Object.prototype) {
    return;
  }
  Object.defineProperty(entry, "silentWhitespaceExcludedXpaths", {
    value: normalizeXPathList(xpaths),
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function isXpathCoveredByAncestor(xpath, ancestorXpaths) {
  if (!xpath || !ancestorXpaths) {
    return false;
  }
  for (const ancestorXpath of ancestorXpaths) {
    if (ancestorXpath && ancestorXpath !== xpath && isXPathDescendant(ancestorXpath, xpath)) {
      return true;
    }
  }
  return false;
}

function isStaleSilentWhitespaceExclusion(xpath, el, previousSilentWhitespaceExcludedSet) {
  return Boolean(
    previousSilentWhitespaceExcludedSet &&
    previousSilentWhitespaceExcludedSet.has(xpath) &&
    !isSilentWhitespaceExclusionCandidate(el)
  );
}

function collectSilentWhitespaceExclusionCandidates(options = {}) {
  if (!document.body) {
    return [];
  }
  const excludedXpaths = options.excludedXpaths || new Set();
  const includeXpaths = options.includeXpaths || new Set();
  const results = [];
  const prefetchedCandidates = Array.isArray(options.prefetchedCandidates)
    ? options.prefetchedCandidates
    : null;
  const excludedElements = new Set();
  for (const xpath of excludedXpaths) {
    const el = getElementFromXPath(xpath);
    if (el) {
      excludedElements.add(el);
    }
  }
  if (prefetchedCandidates) {
    for (const node of prefetchedCandidates) {
      if (!node || node.nodeType !== 1 || node.isConnected === false) {
        continue;
      }
      if (isWithinAiPopover(node) || isWithinConsentElement(node) || isWithinExtensionUi(node)) {
        continue;
      }
      if (isWithinImmutableExcluded(node)) {
        continue;
      }
      if (isWithinElementSet(node, excludedElements)) {
        continue;
      }
      const xpath = getXPath(node);
      if (
        xpath &&
        !includeXpaths.has(xpath) &&
        !excludedXpaths.has(xpath) &&
        !results.some((resultEl) => resultEl !== node && resultEl.contains(node))
      ) {
        results.push(node);
      }
    }
    results.sort(compareDocumentOrder);
    return results;
  }
  const stack = [{ node: document.body, withinExcludedSubtree: false }];
  while (stack.length) {
    const current = stack.pop();
    const node = current && current.node;
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node) || isWithinConsentElement(node) || isWithinExtensionUi(node)) {
      continue;
    }
    if (isWithinImmutableExcluded(node)) {
      continue;
    }
    const isExcludedBoundary = excludedElements.has(node);
    if (current.withinExcludedSubtree || isExcludedBoundary) {
      continue;
    }
    if (!isSilentWhitespaceExclusionCandidate(node)) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        stack.push({
          node: node.children[i],
          withinExcludedSubtree: isExcludedBoundary
        });
      }
      continue;
    }
    const xpath = getXPath(node);
    if (
      xpath &&
      !includeXpaths.has(xpath) &&
      !excludedXpaths.has(xpath)
    ) {
      results.push(node);
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push({
        node: node.children[i],
        withinExcludedSubtree: isExcludedBoundary
      });
    }
  }
  results.sort(compareDocumentOrder);
  return results;
}

function normalizeXPathItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || typeof item.xpath !== "string") {
      continue;
    }
    const xpath = item.xpath.trim();
    if (!xpath || seen.has(xpath)) {
      continue;
    }
    seen.add(xpath);
    const excluded = Boolean(item.excluded);
    normalized.unshift(
      item.explicit === true
        ? { xpath, excluded, explicit: true }
        : { xpath, excluded }
    );
  }
  return normalized;
}

function normalizeXPathList(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const value of list) {
    if (typeof value !== "string") {
      continue;
    }
    const xpath = value.trim();
    if (!xpath || seen.has(xpath)) {
      continue;
    }
    seen.add(xpath);
    normalized.push(xpath);
  }
  return normalized;
}

export function normalizePageEntryXpaths(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  const normalizedXpaths = normalizeXPathItems(entry.xpaths);
  const explicitIncludeXpaths = normalizedXpaths
    .filter((item) =>
      item &&
      item.explicit === true &&
      item.excluded === false &&
      typeof item.xpath === "string" &&
      item.xpath
    )
    .map((item) => item.xpath);
  const appendUnique = (values, xpath) => {
    if (!xpath) {
      return;
    }
    const existingIndex = values.indexOf(xpath);
    if (existingIndex >= 0) {
      values.splice(existingIndex, 1);
    }
    values.push(xpath);
  };
  entry.title = normalizePageEntryTitle(entry.title);
  entry.pageType = normalizePageEntryPageType(entry.pageType);
  entry.xpaths = normalizedXpaths.filter((item) => !(item.explicit === true && item.excluded === false));
  const includeXpaths = normalizeXPathList(entry.includeXpaths);
  explicitIncludeXpaths.forEach((xpath) => appendUnique(includeXpaths, xpath));
  entry.includeXpaths = includeXpaths;
  delete entry.consentXpaths;
  const selectorSuppressedXpaths = normalizeXPathList(entry.selectorSuppressedXpaths);
  explicitIncludeXpaths.forEach((xpath) => appendUnique(selectorSuppressedXpaths, xpath));
  entry.selectorSuppressedXpaths = selectorSuppressedXpaths;
  setEntrySilentWhitespaceExcludedXpaths(entry, entry.silentWhitespaceExcludedXpaths);
  entry.submissionXpaths = normalizeXPathItems(entry.submissionXpaths);
  entry.renderedHtml = typeof entry.renderedHtml === "string" ? entry.renderedHtml : "";
  entry.rawHtml = typeof entry.rawHtml === "string" ? entry.rawHtml : "";
  delete entry.renderMode;
  delete entry.url;
  entry.timestamp = normalizeEntryTimestampValue(entry.timestamp);
  return entry;
}

function normalizePageEntryPageType(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function createSanitizedPageSnapshot(options = {}) {
  const normalizedRenderMode = config.normalizeRenderMode(options.renderMode);
  const root = document.documentElement;
  if (!root) {
    return {
      renderedHtml: "",
      renderMode: normalizedRenderMode
    };
  }

  const clone = root.cloneNode(true);
  const stripSelectors = getSnapshotStripSelectors(options);
  if (stripSelectors.length) {
    clone.querySelectorAll(stripSelectors.join(",")).forEach((node) => {
      node.remove();
    });
  }

  const rootClasses = EXTENSION_SNAPSHOT_ROOT_CLASSES.concat(
    Array.isArray(options.extraRootClasses)
      ? options.extraRootClasses.filter((value) => typeof value === "string" && value)
      : []
  );
  if (clone.classList && rootClasses.length) {
    clone.classList.remove(...rootClasses);
  }

  restorePageMotionLocksInSnapshotClone(clone);

  const titlePrefix = typeof options.titlePrefix === "string" ? options.titlePrefix : "";
  const elements = [clone, ...clone.querySelectorAll("*")];
  for (const element of elements) {
    if (!element || element.nodeType !== 1) {
      continue;
    }
    for (const attribute of Array.from(element.attributes || [])) {
      const attributeName = attribute && typeof attribute.name === "string"
        ? attribute.name
        : "";
      if (!attributeName) {
        continue;
      }
      if (attributeName.startsWith("data-uf-")) {
        element.removeAttribute(attributeName);
        continue;
      }
      if (
        titlePrefix &&
        attributeName === "title" &&
        typeof attribute.value === "string" &&
        attribute.value.startsWith(titlePrefix)
      ) {
        element.removeAttribute(attributeName);
      }
    }
  }

  return {
    renderedHtml: clone.outerHTML,
    renderMode: normalizedRenderMode
  };
}

function createPageMotionPauseState() {
  return {
    reasons: new Set(),
    animations: new Set(),
    hoverTargets: new Set(),
    mediaElements: new Map(),
    svgElements: new Map(),
    lockedElements: new Map(),
    lockedElementsById: new Map(),
    lockIdCounter: 1,
    refreshTimer: 0,
    refreshScheduled: false,
    observer: null
  };
}

function normalizePageMotionPauseReason(reason) {
  return typeof reason === "string" && reason.trim()
    ? reason.trim()
    : PAGE_MOTION_PAUSE_DEFAULT_REASON;
}

function getExtensionResourceUrl(path) {
  if (
    !path ||
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.getURL !== "function"
  ) {
    return "";
  }
  try {
    return chrome.runtime.getURL(path) || "";
  } catch (error) {
    return "";
  }
}

function getMaterialDesignIconFontFaceCss() {
  const fontUrl = getExtensionResourceUrl(MATERIAL_DESIGN_ICONS_FONT_PATH);
  if (!fontUrl) {
    return "";
  }
  return `
    @font-face {
      font-family: "${PAGE_MOTION_ICON_FONT_FAMILY}";
      src: url(${JSON.stringify(fontUrl)}) format("woff2");
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }
  `;
}

function getViewportHeightForPageInspection() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return 0;
  }
  return getPositiveFiniteMax([
    window.innerHeight,
    window.visualViewport?.height,
    document.documentElement?.clientHeight,
    document.body?.clientHeight
  ]);
}

function getDocumentScrollHeightForPageInspection() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return 0;
  }
  return getPositiveFiniteMax([
    document.documentElement?.scrollHeight,
    document.body?.scrollHeight,
    document.documentElement?.offsetHeight,
    document.body?.offsetHeight,
    document.documentElement?.clientHeight,
    document.body?.clientHeight
  ]);
}

function getMaxScrollYForPageInspection() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return 0;
  }
  const viewportHeight = getViewportHeightForPageInspection();
  if (!viewportHeight) {
    return 0;
  }
  const documentHeight = getDocumentScrollHeightForPageInspection();
  return Math.max(0, Math.round(documentHeight - viewportHeight));
}

function scrollWindowInstantlyTo(x, y) {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    if (typeof window.scrollTo === "function") {
      window.scrollTo(Number(x) || 0, Number(y) || 0);
      return true;
    }
    const documentElement = typeof document !== "undefined" ? document.documentElement : null;
    const body = typeof document !== "undefined" ? document.body : null;
    if (documentElement) {
      documentElement.scrollLeft = Number(x) || 0;
      documentElement.scrollTop = Number(y) || 0;
    }
    if (body) {
      body.scrollLeft = Number(x) || 0;
      body.scrollTop = Number(y) || 0;
    }
    return Boolean(documentElement || body);
  } catch (error) {
    return false;
  }
}

function ensurePageInspectionStyle() {
  if (typeof document === "undefined") {
    return null;
  }
  const existing = typeof document.getElementById === "function"
    ? document.getElementById(PAGE_INSPECTION_STYLE_ID)
    : null;
  if (existing) {
    return existing;
  }
  if (typeof document.createElement !== "function") {
    return null;
  }
  const style = document.createElement("style");
  style.id = PAGE_INSPECTION_STYLE_ID;
  if (typeof style.setAttribute === "function") {
    style.setAttribute("data-uf-extension-ui", "true");
  }
  style.textContent = `
    html.${PAGE_INSPECTION_OVERLAY_CLASS},
    html.${PAGE_INSPECTION_OVERLAY_CLASS} * {
      cursor: progress !important;
    }
  `;
  const parent = document.head || document.documentElement || document.body;
  if (parent && typeof parent.appendChild === "function") {
    parent.appendChild(style);
  }
  return style;
}

function removePageInspectionStyle() {
  const style = typeof document !== "undefined" && typeof document.getElementById === "function"
    ? document.getElementById(PAGE_INSPECTION_STYLE_ID)
    : null;
  if (style && typeof style.remove === "function") {
    style.remove();
  }
}

function waitForPageInspectionDelay(ms, isStillCurrent = () => true) {
  const delay = Math.max(0, Math.trunc(Number(ms) || 0));
  if (delay === 0 || !isStillCurrent()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (!isStillCurrent()) {
        resolve();
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= delay) {
        resolve();
        return;
      }
      extensionSetTimeout(tick, Math.min(100, delay - elapsed));
    };
    extensionSetTimeout(tick, Math.min(100, delay));
  });
}

function normalizePageInspectionScrollDirection(value) {
  const direction = typeof value === "string" ? value.trim().toLowerCase() : "";
  return direction === "top" || direction === "bottom" || direction === "both"
    ? direction
    : "both";
}

function waitForPageInspectionScrollEnd(isStillCurrent, options = {}) {
  const timeout = Math.max(
    0,
    Math.trunc(
      options.scrollEndTimeoutMs === undefined
        ? PAGE_INSPECTION_SCROLL_END_TIMEOUT_MS
        : Number(options.scrollEndTimeoutMs) || 0
    )
  );
  if (timeout === 0 || !isStillCurrent()) {
    return Promise.resolve();
  }
  const settleMs = Math.max(
    0,
    Math.trunc(
      options.scrollSettleMs === undefined
        ? PAGE_INSPECTION_SCROLL_SETTLE_MS
        : Number(options.scrollSettleMs) || 0
    )
  );
  const targetY = Number.isFinite(options.targetY) ? Number(options.targetY) : null;
  return new Promise((resolve) => {
    let resolved = false;
    let timeoutHandle = 0;
    let rafHandle = 0;
    let lastScrollY = Number(window.scrollY) || 0;
    let lastMovementAt = Date.now();
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (rafHandle) {
        extensionCancelAnimationFrame(rafHandle);
        rafHandle = 0;
      }
      window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("scroll", onScroll);
      if (timeoutHandle) {
        extensionClearTimeout(timeoutHandle);
        timeoutHandle = 0;
      }
      resolve();
    };
    const updateMovement = () => {
      const currentScrollY = Number(window.scrollY) || 0;
      if (Math.abs(currentScrollY - lastScrollY) > PAGE_INSPECTION_SCROLL_TOLERANCE_PX) {
        lastScrollY = currentScrollY;
        lastMovementAt = Date.now();
      }
    };
    const isNearTarget = () => {
      if (targetY === null) {
        return true;
      }
      const currentScrollY = Number(window.scrollY) || 0;
      return Math.abs(currentScrollY - targetY) <= PAGE_INSPECTION_SCROLL_TOLERANCE_PX;
    };
    const hasSettled = () => Date.now() - lastMovementAt >= settleMs;
    const pollUntilSettled = () => {
      if (!isStillCurrent()) {
        finish();
        return;
      }
      updateMovement();
      if (hasSettled() && isNearTarget()) {
        finish();
        return;
      }
      rafHandle = extensionRequestAnimationFrame(pollUntilSettled);
    };
    const onScrollEnd = () => {
      if (!isStillCurrent()) {
        finish();
        return;
      }
      updateMovement();
      if (hasSettled() && isNearTarget()) {
        finish();
      }
    };
    const onScroll = () => {
      updateMovement();
    };
    window.addEventListener("scroll", onScroll);
    window.addEventListener("scrollend", onScrollEnd);
    rafHandle = extensionRequestAnimationFrame(pollUntilSettled);
    timeoutHandle = extensionSetTimeout(finish, timeout);
  });
}

function getPageInspectionScrollHeight() {
  if (typeof document === "undefined") {
    return 0;
  }
  return Math.max(
    0,
    Math.round(
      Math.max(
        Number(document.documentElement?.scrollHeight) || 0,
        Number(document.body?.scrollHeight) || 0
      )
    )
  );
}

function isPageInspectionAtBottom() {
  const doc = typeof document !== "undefined" ? document.documentElement : null;
  if (!doc || typeof window === "undefined") {
    return true;
  }
  const currentY = window.scrollY || 0;
  const viewportHeight = window.innerHeight || doc.clientHeight || 0;
  const scrollHeight = getPageInspectionScrollHeight();
  if (scrollHeight <= viewportHeight) {
    return true;
  }
  return currentY + viewportHeight >= scrollHeight;
}

function getPageInspectionScrollTarget(target) {
  if (target === "end") {
    const viewportHeight = (
      window?.innerHeight
      || (typeof document !== "undefined" ? document.documentElement?.clientHeight : 0)
    ) || 0;
    return Math.max(0, getPageInspectionScrollHeight() - viewportHeight);
  }
  if (target === "start") {
    return 0;
  }
  return Math.max(0, Math.round(Number(target) || 0));
}

function suppressPageInspectionLazyLoading() {
  const applied = setPageMotionFreezeLazyLoadingSuppressed(true);
  let restored = false;
  const restore = () => {
    if (restored) {
      return;
    }
    restored = true;
    setPageMotionFreezeLazyLoadingSuppressed(false);
  };
  // Expose the cross-world apply confirmation so reveal can wait for the lock
  // to take effect in the page world before scrolling again.
  restore.lazyLoadingSuppressionApplied =
    applied && typeof applied.then === "function" ? applied : Promise.resolve();
  return restore;
}

async function waitForPageInspectionLazyLoadingLock(restorer) {
  const applied = restorer && restorer.lazyLoadingSuppressionApplied;
  if (!applied || typeof applied.then !== "function") {
    return;
  }
  try {
    await applied;
  } catch {
    // Lock confirmation is best-effort; reveal proceeds regardless.
  }
}

function notifyPageInspectionProgress(options = {}) {
  if (options && typeof options.onProgress === "function") {
    try {
      options.onProgress();
    } catch {
      // Progress hooks are best-effort and must not affect reveal/freeze.
    }
  }
}

async function scrollPageInspectionTo(target, isStillCurrent, options = {}) {
  if (!isStillCurrent() || typeof window === "undefined" || typeof window.scrollTo !== "function") {
    return false;
  }
  notifyPageInspectionProgress(options);
  const targetScrollY = getPageInspectionScrollTarget(target);
  window.scrollTo({ top: targetScrollY, behavior: "smooth" });
  await waitForPageInspectionScrollEnd(isStillCurrent, {
    ...options,
    targetY: targetScrollY
  });
  return true;
}

export async function revealPageContentBeforeMotionPause(
  scrollDirection = "both",
  maximumScrollCount = PAGE_INSPECTION_DEFAULT_MAX_SCROLLS,
  pauseMs = PAGE_INSPECTION_DEFAULT_PAUSE_MS,
  isStillCurrent = () => true,
  options = {}
) {
  if (typeof document === "undefined" || typeof window === "undefined" || !isStillCurrent()) {
    return false;
  }
  if (document.visibilityState === "hidden") {
    return false;
  }
  hideConsentBeforeReveal();
  const direction = normalizePageInspectionScrollDirection(scrollDirection);
  const maxScrolls = Math.max(1, Math.trunc(Number(maximumScrollCount) || PAGE_INSPECTION_DEFAULT_MAX_SCROLLS));
  const pauseDelay = Math.max(0, Math.trunc(Number(pauseMs) || 0));
  const reservedScrollY = Math.max(0, Math.round(getWindowScrollOffset().y));
  let visited = false;
  let lazyLoadRestorer = null;
  ensurePageInspectionStyle();
  try {
    if (direction === "top") {
      if (reservedScrollY > 0) {
        visited = await scrollPageInspectionTo("start", isStillCurrent, options) || visited;
        await waitForPageInspectionDelay(pauseDelay, isStillCurrent);
      }
    }
    if (direction === "bottom" || direction === "both") {
      if (direction === "both" && reservedScrollY > 0) {
        visited = await scrollPageInspectionTo("start", isStillCurrent, options) || visited;
        await waitForPageInspectionDelay(pauseDelay, isStillCurrent);
      }
      let scrollCount = 0;
      while (scrollCount < maxScrolls && isStillCurrent()) {
        if (scrollCount === PAGE_INSPECTION_LAZY_LOAD_PHASES && !lazyLoadRestorer && !state.lazyLoadSuppressRestorer) {
          lazyLoadRestorer = suppressPageInspectionLazyLoading();
          state.lazyLoadSuppressRestorer = lazyLoadRestorer;
          // Wait for the page-world lock to actually apply before scrolling
          // again; otherwise lazy loading keeps firing for every scroll pass.
          await waitForPageInspectionLazyLoadingLock(lazyLoadRestorer);
          if (!isStillCurrent()) {
            break;
          }
        }
        notifyPageInspectionProgress(options);
        const scrolled = await scrollPageInspectionTo("end", isStillCurrent, options);
        visited = scrolled || visited;
        await waitForPageInspectionDelay(pauseDelay, isStillCurrent);
        notifyPageInspectionProgress(options);
        if (isPageInspectionAtBottom()) {
          break;
        }
        scrollCount++;
      }
      await waitForPageInspectionDelay(pauseDelay, isStillCurrent);
      if (direction === "both" && isStillCurrent()) {
        visited = await scrollPageInspectionTo(reservedScrollY, isStillCurrent, options) || visited;
        await waitForPageInspectionDelay(pauseDelay, isStillCurrent);
      }
    }
  } finally {
    // Reveal may arm lazy-loading suppression mid-run; always restore it when
    // the inspection walk exits so silent/normal flows do not stay suppressed.
    restorePageInspectionLazyLoadingSuppression();
    removePageInspectionStyle();
  }
  return visited;
}

function blockPageInspectionInput(event) {
  if (!state.inspectionBlocker) {
    return;
  }
  if (event && event.cancelable && typeof event.preventDefault === "function") {
    event.preventDefault();
  }
  if (event && typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
    return;
  }
  if (event && typeof event.stopPropagation === "function") {
    event.stopPropagation();
  }
}

function startPageInspectionInputBlocker() {
  if (state.inspectionBlocker) {
    return;
  }
  const targets = [window, document].filter((target) =>
    target && typeof target.addEventListener === "function"
  );
  const options = { capture: true, passive: false };
  for (const target of targets) {
    for (const eventName of PAGE_INSPECTION_INPUT_EVENTS) {
      target.addEventListener(eventName, blockPageInspectionInput, options);
    }
  }
  state.inspectionBlocker = { targets, options };
}

function stopPageInspectionInputBlocker() {
  const blocker = state.inspectionBlocker;
  if (!blocker) {
    return;
  }
  for (const target of blocker.targets) {
    if (!target || typeof target.removeEventListener !== "function") {
      continue;
    }
    for (const eventName of PAGE_INSPECTION_INPUT_EVENTS) {
      target.removeEventListener(eventName, blockPageInspectionInput, blocker.options);
    }
  }
  state.inspectionBlocker = null;
}

function ensurePageMotionPauseStyle() {
  if (typeof document === "undefined") {
    return null;
  }
  const existing = typeof document.getElementById === "function"
    ? document.getElementById(PAGE_MOTION_PAUSE_STYLE_ID)
    : null;
  if (existing) {
    return existing;
  }
  if (typeof document.createElement !== "function") {
    return null;
  }
  const style = document.createElement("style");
  style.id = PAGE_MOTION_PAUSE_STYLE_ID;
  if (typeof style.setAttribute === "function") {
    style.setAttribute("data-uf-extension-ui", "true");
  }
  style.textContent = `
    ${getMaterialDesignIconFontFaceCss()}
    html.${PAGE_MOTION_PAUSE_ROOT_CLASS},
    html.${PAGE_MOTION_PAUSE_ROOT_CLASS} body {
      scroll-behavior: auto !important;
    }
    html.${PAGE_MOTION_PAUSE_ROOT_CLASS} body,
    html.${PAGE_MOTION_PAUSE_ROOT_CLASS} body::before,
    html.${PAGE_MOTION_PAUSE_ROOT_CLASS} body::after,
    ${PAGE_MOTION_PAUSE_CONTENT_SELECTOR},
    ${PAGE_MOTION_PAUSE_CONTENT_SELECTOR}::before,
    ${PAGE_MOTION_PAUSE_CONTENT_SELECTOR}::after {
      animation-play-state: paused !important;
      transition-property: none !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
    }
    #${PAGE_MOTION_PAUSE_INDICATOR_ID}.${PAGE_MOTION_PAUSE_INDICATOR_CLASS} {
      position: fixed !important;
      top: max(10px, env(safe-area-inset-top, 0px) + 10px) !important;
      right: max(10px, env(safe-area-inset-right, 0px) + 10px) !important;
      width: 48px !important;
      height: 30px !important;
      padding-top: 1px !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      box-sizing: border-box !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 4px !important;
      border: 1px solid rgba(255, 255, 255, 0.32) !important;
      border-radius: 7px !important;
      background: rgba(17, 24, 39, 0.78) !important;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.22) !important;
      backdrop-filter: blur(6px) !important;
      -webkit-backdrop-filter: blur(6px) !important;
    }
    #${PAGE_MOTION_PAUSE_INDICATOR_ID}.${PAGE_MOTION_PAUSE_INDICATOR_CLASS}::before,
    #${PAGE_MOTION_PAUSE_INDICATOR_ID}.${PAGE_MOTION_PAUSE_INDICATOR_CLASS}::after {
      display: block !important;
      width: 18px !important;
      height: 18px !important;
      font-family: "${PAGE_MOTION_ICON_FONT_FAMILY}" !important;
      font-size: 18px !important;
      font-style: normal !important;
      font-weight: normal !important;
      line-height: 18px !important;
      color: rgba(255, 255, 255, 0.96) !important;
      text-rendering: auto !important;
      -webkit-font-smoothing: antialiased !important;
      -moz-osx-font-smoothing: grayscale !important;
    }
    #${PAGE_MOTION_PAUSE_INDICATOR_ID}.${PAGE_MOTION_PAUSE_INDICATOR_CLASS}::before {
      content: "${MATERIAL_DESIGN_ICON_SNOWFLAKE}" !important;
    }
    #${PAGE_MOTION_PAUSE_INDICATOR_ID}.${PAGE_MOTION_PAUSE_INDICATOR_CLASS}::after {
      content: "${MATERIAL_DESIGN_ICON_CODE_TAGS}" !important;
    }
  `;
  const parent = document.head || document.documentElement || document.body;
  if (parent && typeof parent.appendChild === "function") {
    parent.appendChild(style);
  }
  return style;
}

function ensurePageMotionPauseIndicator() {
  if (typeof document === "undefined") {
    return null;
  }
  const existing = typeof document.getElementById === "function"
    ? document.getElementById(PAGE_MOTION_PAUSE_INDICATOR_ID)
    : null;
  if (existing) {
    return existing;
  }
  if (typeof document.createElement !== "function") {
    return null;
  }
  const indicator = document.createElement("div");
  indicator.id = PAGE_MOTION_PAUSE_INDICATOR_ID;
  if (typeof indicator.setAttribute === "function") {
    indicator.setAttribute("class", PAGE_MOTION_PAUSE_INDICATOR_CLASS);
    indicator.setAttribute("data-uf-extension-ui", "true");
    indicator.setAttribute("role", "img");
    indicator.setAttribute("aria-label", "Page motion paused");
    indicator.setAttribute("title", "Page motion paused");
  }
  const parent = document.body || document.documentElement;
  if (parent && typeof parent.appendChild === "function") {
    parent.appendChild(indicator);
  }
  return indicator;
}

function setPageMotionPauseClass(paused) {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root || !root.classList) {
    return;
  }
  if (paused && typeof root.classList.add === "function") {
    root.classList.add(PAGE_MOTION_PAUSE_ROOT_CLASS);
  } else if (!paused && typeof root.classList.remove === "function") {
    root.classList.remove(PAGE_MOTION_PAUSE_ROOT_CLASS);
  }
}

function setElementClassPresence(element, className, enabled) {
  if (!element || !element.classList) {
    return;
  }
  if (typeof element.classList.toggle === "function") {
    element.classList.toggle(className, Boolean(enabled));
    return;
  }
  if (enabled && typeof element.classList.add === "function") {
    element.classList.add(className);
  } else if (!enabled && typeof element.classList.remove === "function") {
    element.classList.remove(className);
  }
}

function removePageMotionPauseStyle() {
  const style = typeof document !== "undefined" && typeof document.getElementById === "function"
    ? document.getElementById(PAGE_MOTION_PAUSE_STYLE_ID)
    : null;
  if (style && typeof style.remove === "function") {
    style.remove();
  }
}

function removePageMotionPauseIndicator() {
  const indicator = typeof document !== "undefined" && typeof document.getElementById === "function"
    ? document.getElementById(PAGE_MOTION_PAUSE_INDICATOR_ID)
    : null;
  if (indicator && typeof indicator.remove === "function") {
    indicator.remove();
  }
}

function sendPageMotionFreezeControl(command, details = null) {
  if (
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== "function" ||
    typeof command !== "string" ||
    !command
  ) {
    return Promise.resolve();
  }
  const message = {
    type: "pageMotionFreezeControl",
    command
  };
  if (details && typeof details === "object") {
    message.details = details;
  }
  try {
    // The runtime response resolves only after the background relays the command
    // into the page (MAIN) world, so awaiting this confirms the lock is applied.
    return utils.sendRuntimeMessage(message).catch(() => {});
  } catch (error) {
    // Best-effort page-world motion control; CSS/Web Animations freezing still applies.
    return Promise.resolve();
  }
}

function setPageMotionFreezeTimersPaused(paused) {
  const shouldPause = Boolean(paused);
  if (pageMotionFreezeTimersPaused === shouldPause) {
    return;
  }
  pageMotionFreezeTimersPaused = shouldPause;
  sendPageMotionFreezeControl(
    PAGE_MOTION_PAUSE_CONTROL_COMMAND_SET_PAUSED,
    { paused: shouldPause }
  );
}

function setPageMotionFreezeLazyLoadingSuppressed(suppressed) {
  const shouldSuppress = Boolean(suppressed);
  if (pageMotionFreezeLazyLoadingSuppressed === shouldSuppress) {
    return Promise.resolve();
  }
  pageMotionFreezeLazyLoadingSuppressed = shouldSuppress;
  return sendPageMotionFreezeControl(
    PAGE_MOTION_PAUSE_CONTROL_COMMAND_SET_LAZY_LOADING_SUPPRESSED,
    { suppressed: shouldSuppress }
  );
}

function restorePageInspectionLazyLoadingSuppression() {
  const restorer = state.lazyLoadSuppressRestorer;
  state.lazyLoadSuppressRestorer = null;
  if (typeof restorer === "function") {
    try {
      restorer();
      return;
    } catch (error) {
      // Fall through to direct cleanup below.
    }
  }
  setPageMotionFreezeLazyLoadingSuppressed(false);
}

function getDocumentAnimations() {
  if (typeof document === "undefined" || typeof document.getAnimations !== "function") {
    return [];
  }
  try {
    return Array.from(document.getAnimations({ subtree: true }) || []);
  } catch (error) {
    try {
      return Array.from(document.getAnimations() || []);
    } catch (fallbackError) {
      return [];
    }
  }
}

function pauseDocumentAnimations(pauseState) {
  for (const animation of getDocumentAnimations()) {
    if (!animation || typeof animation.pause !== "function") {
      continue;
    }
    const target = getAnimationEffectTarget(animation);
    if (target && isIgnoredPageMotionElement(target)) {
      continue;
    }
    if (
      !pauseState.animations.has(animation) &&
      (animation.playState === "paused" || animation.playState === "finished" || animation.playState === "idle")
    ) {
      continue;
    }
    pauseState.animations.add(animation);
    try {
      animation.pause();
    } catch (error) {
      // Ignore animations that cannot be controlled by content scripts.
    }
  }
}

function resumeDocumentAnimations(pauseState) {
  for (const animation of pauseState.animations) {
    if (!animation || typeof animation.play !== "function") {
      continue;
    }
    try {
      animation.play();
    } catch (error) {
      // Ignore animations that were removed while marking mode was active.
    }
  }
}

function createSyntheticPageMotionEvent(type, bubbles) {
  const eventOptions = {
    bubbles: Boolean(bubbles),
    cancelable: true,
    composed: true,
    view: typeof window !== "undefined" ? window : null
  };
  const EventConstructor = type.startsWith("pointer") && typeof PointerEvent === "function"
    ? PointerEvent
    : typeof MouseEvent === "function"
      ? MouseEvent
      : typeof Event === "function"
        ? Event
        : null;
  if (!EventConstructor) {
    return null;
  }
  try {
    return new EventConstructor(type, eventOptions);
  } catch (error) {
    try {
      return new Event(type, eventOptions);
    } catch (fallbackError) {
      return null;
    }
  }
}

function dispatchPageMotionEvents(target, events) {
  if (!target || typeof target.dispatchEvent !== "function") {
    return;
  }
  for (const [type, bubbles] of events) {
    const event = createSyntheticPageMotionEvent(type, bubbles);
    if (!event) {
      continue;
    }
    try {
      target.dispatchEvent(event);
    } catch (error) {
      // Ignore third-party widgets that reject synthetic events.
    }
  }
}

function isIgnoredPageMotionElement(element) {
  if (!element || element.nodeType !== 1) {
    return true;
  }
  if (state.overlay && (element === state.overlay || state.overlay.contains(element))) {
    return true;
  }
  if (element.id && typeof element.id === "string" && element.id.startsWith("unfluffify-")) {
    return true;
  }
  if (typeof element.getAttribute === "function" && element.getAttribute("data-uf-extension-ui") === "true") {
    return true;
  }
  if (typeof element.closest === "function") {
    try {
      return Boolean(element.closest("[data-uf-extension-ui=\"true\"]"));
    } catch (error) {
      return false;
    }
  }
  return false;
}

function getComputedCssStyle(element) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return null;
  }
  try {
    return window.getComputedStyle(element);
  } catch (error) {
    return null;
  }
}

function toStylePropertyName(property) {
  return String(property || "").replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
}

function getComputedCssValue(computedStyle, property) {
  if (!computedStyle || !property) {
    return "";
  }
  if (typeof computedStyle.getPropertyValue === "function") {
    return computedStyle.getPropertyValue(property) || "";
  }
  return computedStyle[toStylePropertyName(property)] || "";
}

function parseCssTimeMs(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return normalized.endsWith("ms") ? amount : amount * 1000;
}

function cssTimeListHasPositiveValue(value) {
  return String(value || "")
    .split(",")
    .some((part) => parseCssTimeMs(part) > 0);
}

function cssNameListHasValue(value) {
  return String(value || "")
    .split(",")
    .some((part) => {
      const normalized = part.trim().toLowerCase();
      return normalized && normalized !== "none";
    });
}

function isNonDefaultMotionCssValue(property, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "normal" || normalized === "auto") {
    return false;
  }
  if (normalized === "initial" || normalized === "inherit" || normalized === "unset" || normalized === "revert") {
    return false;
  }
  if (property === "opacity") {
    return normalized !== "1";
  }
  if (property === "filter" || property === "backdrop-filter" || property === "clip-path") {
    return normalized !== "none";
  }
  return !/^0(?:px|%|deg|rad|turn|s|ms)?$/.test(normalized);
}

function hasMotionWillChange(computedStyle) {
  const willChange = getComputedCssValue(computedStyle, "will-change");
  return /transform|translate|rotate|scale|top|right|bottom|left|opacity|filter|clip-path|offset/i.test(willChange);
}

function hasTimedMotionStyle(computedStyle) {
  if (!computedStyle) {
    return false;
  }
  const animationName = getComputedCssValue(computedStyle, "animation-name");
  const transitionDuration = getComputedCssValue(computedStyle, "transition-duration");
  const transitionDelay = getComputedCssValue(computedStyle, "transition-delay");
  return (
    cssNameListHasValue(animationName) ||
    cssTimeListHasPositiveValue(transitionDuration) ||
    cssTimeListHasPositiveValue(transitionDelay) ||
    hasMotionWillChange(computedStyle)
  );
}

function getElementAttributePairs(element) {
  if (!element || !element.attributes) {
    return [];
  }
  try {
    return Array.from(element.attributes)
      .map((attribute) => ({
        name: attribute && typeof attribute.name === "string" ? attribute.name : "",
        value: attribute && typeof attribute.value === "string" ? attribute.value : ""
      }))
      .filter((attribute) => attribute.name);
  } catch (error) {
    return [];
  }
}

function getElementMotionDescriptorText(element) {
  const descriptorParts = [];
  for (const attribute of getElementAttributePairs(element)) {
    const name = attribute.name.toLowerCase();
    if (
      name === "id" ||
      name === "class" ||
      name === "role" ||
      name.startsWith("aria-") ||
      name.startsWith("data-") ||
      name === "autoplay" ||
      name === "loop"
    ) {
      descriptorParts.push(name, attribute.value);
    }
  }
  return descriptorParts.join(" ");
}

function elementMatchesMotionDescriptor(element) {
  return PAGE_MOTION_PAUSE_DESCRIPTOR_RE.test(getElementMotionDescriptorText(element));
}

function elementOrAncestorMatchesRevealExcludedDescriptor(element) {
  let current = element;
  let depth = 0;
  while (current && current.nodeType === 1 && depth < 6) {
    if (PAGE_MOTION_REVEAL_EXCLUDED_DESCRIPTOR_RE.test(getElementMotionDescriptorText(current))) {
      return true;
    }
    current = current.parentElement || null;
    depth += 1;
  }
  return false;
}

function elementHasRevealInteractionAttribute(element) {
  return getElementAttributePairs(element).some((attribute) =>
    PAGE_MOTION_REVEAL_INTERACTION_ATTRIBUTE_NAMES.has(attribute.name.toLowerCase())
  );
}

function elementMatchesRevealDescriptor(element) {
  const descriptorText = getElementMotionDescriptorText(element);
  return (PAGE_MOTION_REVEAL_DESCRIPTOR_RE.test(descriptorText) || elementHasRevealInteractionAttribute(element)) &&
    !elementOrAncestorMatchesRevealExcludedDescriptor(element);
}

function elementHasInlineMotionStyle(element) {
  const styleText = element && typeof element.getAttribute === "function"
    ? element.getAttribute("style") || ""
    : "";
  return PAGE_MOTION_PAUSE_INLINE_STYLE_RE.test(styleText);
}

function computedStyleIndicatesMotion(computedStyle) {
  if (!computedStyle) {
    return false;
  }
  if (hasTimedMotionStyle(computedStyle)) {
    return true;
  }
  return [
    "transform",
    "translate",
    "rotate",
    "scale",
    "offset-path",
    "offset-distance",
    "offset-rotate",
    "perspective"
  ].some((property) =>
    isNonDefaultMotionCssValue(property, getComputedCssValue(computedStyle, property))
  );
}

function mergePageMotionCandidate(candidates, element, options = {}) {
  if (isIgnoredPageMotionElement(element)) {
    return;
  }
  const existing = candidates.get(element) || {
    descriptorMatched: false,
    inlineMotion: false,
    computedStyle: null
  };
  candidates.set(element, {
    descriptorMatched: existing.descriptorMatched || Boolean(options.descriptorMatched),
    inlineMotion: existing.inlineMotion || Boolean(options.inlineMotion),
    computedStyle: existing.computedStyle || options.computedStyle || null
  });
}

function getAnimationEffectTarget(animation) {
  if (!animation || !animation.effect) {
    return null;
  }
  try {
    const target = animation.effect.target;
    return target && target.nodeType === 1 ? target : null;
  } catch (error) {
    return null;
  }
}

function collectPageMotionCandidates() {
  const candidates = new Map();
  for (const animation of getDocumentAnimations()) {
    const target = getAnimationEffectTarget(animation);
    if (target) {
      mergePageMotionCandidate(candidates, target, { descriptorMatched: true });
    }
  }
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return candidates;
  }
  let elements = [];
  try {
    elements = Array.from(document.querySelectorAll("*") || []);
  } catch (error) {
    elements = [];
  }
  const inspectComputedStyle = elements.length <= PAGE_MOTION_PAUSE_MAX_LOCKED_ELEMENTS * 3;
  for (const element of elements) {
    if (isIgnoredPageMotionElement(element)) {
      continue;
    }
    const descriptorMatched = elementMatchesMotionDescriptor(element);
    const inlineMotion = elementHasInlineMotionStyle(element);
    if (descriptorMatched || inlineMotion) {
      mergePageMotionCandidate(candidates, element, { descriptorMatched, inlineMotion });
      continue;
    }
    if (!inspectComputedStyle) {
      continue;
    }
    const computedStyle = getComputedCssStyle(element);
    if (computedStyleIndicatesMotion(computedStyle)) {
      mergePageMotionCandidate(candidates, element, { computedStyle });
    }
  }
  return candidates;
}

function getDefaultLockValue(property, computedValue) {
  const normalized = String(computedValue || "").trim();
  if (normalized) {
    return normalized;
  }
  if (property === "opacity") {
    return "1";
  }
  if (PAGE_MOTION_PAUSE_POSITION_LOCK_PROPERTIES.includes(property)) {
    return "auto";
  }
  return "none";
}

function shouldLockBaseMotionProperty(property, computedStyle, descriptorMatched) {
  const value = getComputedCssValue(computedStyle, property);
  if (isNonDefaultMotionCssValue(property, value)) {
    return true;
  }
  return descriptorMatched && (
    property === "transform" ||
    property === "translate" ||
    property === "rotate" ||
    property === "scale" ||
    property === "offset-distance"
  );
}

function getPageMotionLockProperties(computedStyle, descriptorMatched) {
  if (!computedStyle) {
    return [];
  }
  const properties = [];
  const timedMotionStyle = hasTimedMotionStyle(computedStyle);
  for (const property of PAGE_MOTION_PAUSE_BASE_LOCK_PROPERTIES) {
    if (shouldLockBaseMotionProperty(property, computedStyle, descriptorMatched || timedMotionStyle)) {
      properties.push(property);
    }
  }
  const position = getComputedCssValue(computedStyle, "position").trim().toLowerCase();
  if (position && position !== "static") {
    for (const property of PAGE_MOTION_PAUSE_POSITION_LOCK_PROPERTIES) {
      const value = getComputedCssValue(computedStyle, property);
      if (value && value.trim().toLowerCase() !== "auto") {
        properties.push(property);
      }
    }
  }
  return properties;
}

function createPageMotionLockRecord(pauseState, element) {
  const id = `ufm-${pauseState.lockIdCounter}`;
  pauseState.lockIdCounter += 1;
  const record = {
    id,
    element,
    hadStyleAttribute: typeof element.hasAttribute === "function" ? element.hasAttribute("style") : false,
    properties: new Map()
  };
  pauseState.lockedElements.set(element, record);
  pauseState.lockedElementsById.set(id, record);
  if (typeof element.setAttribute === "function") {
    element.setAttribute(PAGE_MOTION_PAUSE_LOCK_ATTR, id);
  }
  return record;
}

function applyPageMotionLockProperty(record, element, property, lockValue) {
  let lock = record.properties.get(property);
  if (!lock) {
    const previousValue = typeof element.style.getPropertyValue === "function"
      ? element.style.getPropertyValue(property)
      : "";
    const previousPriority = typeof element.style.getPropertyPriority === "function"
      ? element.style.getPropertyPriority(property)
      : "";
    lock = {
      hadInlineValue: Boolean(previousValue || previousPriority),
      previousValue,
      previousPriority,
      lockValue
    };
    record.properties.set(property, lock);
  } else {
    lock.lockValue = lockValue;
  }
  const currentValue = typeof element.style.getPropertyValue === "function"
    ? element.style.getPropertyValue(property)
    : "";
  const currentPriority = typeof element.style.getPropertyPriority === "function"
    ? element.style.getPropertyPriority(property)
    : "";
  if (currentValue !== lock.lockValue || currentPriority !== "important") {
    try {
      element.style.setProperty(property, lock.lockValue, "important");
    } catch (error) {
      // Ignore immutable inline style declarations.
    }
  }
}

function parseCssNumber(value) {
  const parsed = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function elementHasMotionLayoutBox(element) {
  if (!element || element.nodeType !== 1) {
    return false;
  }
  try {
    if (typeof element.getClientRects === "function") {
      const rects = Array.from(element.getClientRects() || []);
      if (rects.length > 0) {
        return rects.some((rect) => Number(rect.width) > 1 && Number(rect.height) > 1);
      }
    }
    if (typeof element.getBoundingClientRect === "function") {
      const rect = element.getBoundingClientRect();
      return Boolean(rect && Number(rect.width) > 1 && Number(rect.height) > 1);
    }
  } catch (error) {
    return true;
  }
  return true;
}

function isSemanticallyHiddenForReveal(element, computedStyle) {
  if (!element || element.nodeType !== 1) {
    return true;
  }
  if (element.hidden || (typeof element.hasAttribute === "function" && element.hasAttribute("hidden"))) {
    return true;
  }
  if (typeof element.getAttribute === "function" && element.getAttribute("aria-hidden") === "true") {
    return true;
  }
  const display = getComputedCssValue(computedStyle, "display").trim().toLowerCase();
  return display === "none";
}

function getPageMotionRevealNormalizationProperties(computedStyle) {
  if (!computedStyle) {
    return [];
  }
  const properties = [];
  const opacity = parseCssNumber(getComputedCssValue(computedStyle, "opacity"));
  const visibility = getComputedCssValue(computedStyle, "visibility").trim().toLowerCase();
  const clipPath = getComputedCssValue(computedStyle, "clip-path");
  const hiddenByOpacity = opacity !== null && opacity < 0.5;
  const hiddenByVisibility = visibility === "hidden" || visibility === "collapse";
  const hiddenByClip = isNonDefaultMotionCssValue("clip-path", clipPath);
  if (!hiddenByOpacity && !hiddenByVisibility && !hiddenByClip) {
    return [];
  }
  if (hiddenByVisibility) {
    properties.push(["visibility", "visible"]);
  }
  if (hiddenByOpacity) {
    properties.push(["opacity", "1"]);
  }
  for (const property of ["transform", "translate", "rotate", "perspective"]) {
    if (isNonDefaultMotionCssValue(property, getComputedCssValue(computedStyle, property))) {
      properties.push([property, "none"]);
    }
  }
  const scale = getComputedCssValue(computedStyle, "scale").trim().toLowerCase();
  if (scale && scale !== "none" && scale !== "1") {
    properties.push(["scale", "none"]);
  }
  for (const property of ["filter", "backdrop-filter", "clip-path"]) {
    if (isNonDefaultMotionCssValue(property, getComputedCssValue(computedStyle, property))) {
      properties.push([property, "none"]);
    }
  }
  return properties;
}

function shouldNormalizePageMotionRevealCandidate(element, candidate, computedStyle) {
  if (!elementMatchesRevealDescriptor(element)) {
    return false;
  }
  if (!candidate || (!candidate.descriptorMatched && !candidate.inlineMotion && !candidate.computedStyle)) {
    return false;
  }
  if (isSemanticallyHiddenForReveal(element, computedStyle) || !elementHasMotionLayoutBox(element)) {
    return false;
  }
  return getPageMotionRevealNormalizationProperties(computedStyle).length > 0;
}

function normalizePageMotionRevealElement(pauseState, element, computedStyle) {
  const properties = getPageMotionRevealNormalizationProperties(computedStyle);
  if (!properties.length) {
    return false;
  }
  const record = pauseState.lockedElements.get(element) || createPageMotionLockRecord(pauseState, element);
  for (const [property, lockValue] of properties) {
    applyPageMotionLockProperty(record, element, property, lockValue);
  }
  return true;
}

function lockPageMotionElement(pauseState, element, candidate) {
  if (!element || !element.style) {
    return;
  }
  if (!pauseState.lockedElements.has(element) && pauseState.lockedElements.size >= PAGE_MOTION_PAUSE_MAX_LOCKED_ELEMENTS) {
    return;
  }
  const computedStyle = candidate.computedStyle || getComputedCssStyle(element);
  if (shouldNormalizePageMotionRevealCandidate(element, candidate, computedStyle)) {
    normalizePageMotionRevealElement(pauseState, element, computedStyle);
    return;
  }
  const properties = getPageMotionLockProperties(computedStyle, candidate.descriptorMatched || candidate.inlineMotion);
  if (!properties.length) {
    return;
  }
  const record = pauseState.lockedElements.get(element) || createPageMotionLockRecord(pauseState, element);
  for (const property of properties) {
    applyPageMotionLockProperty(
      record,
      element,
      property,
      getDefaultLockValue(property, getComputedCssValue(computedStyle, property))
    );
  }
}

function restorePageMotionLockRecordOnElement(element, record) {
  if (!element || !element.style || !record) {
    return;
  }
  for (const [property, lock] of record.properties) {
    try {
      if (lock.hadInlineValue) {
        element.style.setProperty(property, lock.previousValue, lock.previousPriority || "");
      } else if (typeof element.style.removeProperty === "function") {
        element.style.removeProperty(property);
      }
    } catch (error) {
      // Ignore detached elements and immutable inline style declarations.
    }
  }
  if (typeof element.removeAttribute === "function") {
    element.removeAttribute(PAGE_MOTION_PAUSE_LOCK_ATTR);
    if (!record.hadStyleAttribute && element.style.length === 0) {
      element.removeAttribute("style");
    }
  }
}

function restorePageMotionLocks(pauseState) {
  for (const record of pauseState.lockedElements.values()) {
    restorePageMotionLockRecordOnElement(record.element, record);
  }
  pauseState.lockedElements.clear();
  pauseState.lockedElementsById.clear();
}

function restorePageMotionLocksInSnapshotClone(clone) {
  const pauseState = state.pageMotionPause;
  if (!pauseState || !pauseState.lockedElementsById || !clone) {
    return;
  }
  const lockedCloneElements = [];
  if (typeof clone.getAttribute === "function" && clone.getAttribute(PAGE_MOTION_PAUSE_LOCK_ATTR)) {
    lockedCloneElements.push(clone);
  }
  if (typeof clone.querySelectorAll === "function") {
    try {
      lockedCloneElements.push(...clone.querySelectorAll(`[${PAGE_MOTION_PAUSE_LOCK_ATTR}]`));
    } catch (error) {
      // Ignore selector support differences on cloned documents.
    }
  }
  for (const cloneElement of lockedCloneElements) {
    const id = typeof cloneElement.getAttribute === "function"
      ? cloneElement.getAttribute(PAGE_MOTION_PAUSE_LOCK_ATTR)
      : "";
    const record = id ? pauseState.lockedElementsById.get(id) : null;
    if (record) {
      restorePageMotionLockRecordOnElement(cloneElement, record);
    }
  }
}

function lockPageMotionCandidates(pauseState, candidates) {
  for (const [element, candidate] of candidates) {
    lockPageMotionElement(pauseState, element, candidate);
  }
}

function collectPageMotionHoverTargets(candidates) {
  const targets = new Set();
  for (const element of candidates.keys()) {
    let current = element;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 8 && targets.size < PAGE_MOTION_PAUSE_MAX_HOVER_TARGETS) {
      const tagName = current.tagName ? String(current.tagName).toLowerCase() : "";
      if (tagName !== "html" && tagName !== "body" && !isIgnoredPageMotionElement(current)) {
        targets.add(current);
      }
      current = current.parentElement || null;
      depth += 1;
    }
    if (targets.size >= PAGE_MOTION_PAUSE_MAX_HOVER_TARGETS) {
      break;
    }
  }
  return targets;
}

function pauseInteractiveMotionTargets(pauseState, candidates) {
  for (const target of collectPageMotionHoverTargets(candidates)) {
    pauseState.hoverTargets.add(target);
    dispatchPageMotionEvents(target, [
      ["pointerenter", false],
      ["mouseenter", false],
      ["mouseover", true]
    ]);
  }
}

function resumeInteractiveMotionTargets(pauseState) {
  for (const target of pauseState.hoverTargets) {
    dispatchPageMotionEvents(target, [
      ["pointerleave", false],
      ["mouseleave", false],
      ["mouseout", true]
    ]);
  }
  pauseState.hoverTargets.clear();
}

function queryPageMotionElements(selector) {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return [];
  }
  try {
    return Array.from(document.querySelectorAll(selector) || []);
  } catch (error) {
    return [];
  }
}

function pauseSvgAnimations(pauseState) {
  for (const svgElement of queryPageMotionElements("svg")) {
    if (!svgElement || isIgnoredPageMotionElement(svgElement) || typeof svgElement.pauseAnimations !== "function") {
      continue;
    }
    if (!pauseState.svgElements.has(svgElement)) {
      let wasPaused = false;
      if (typeof svgElement.animationsPaused === "function") {
        try {
          wasPaused = Boolean(svgElement.animationsPaused());
        } catch (error) {
          wasPaused = false;
        }
      }
      pauseState.svgElements.set(svgElement, { wasPaused });
    }
    try {
      svgElement.pauseAnimations();
    } catch (error) {
      // Ignore SVG roots whose animation clock is unavailable.
    }
  }
}

function resumeSvgAnimations(pauseState) {
  for (const [svgElement, svgState] of pauseState.svgElements) {
    if (!svgElement || svgState.wasPaused || typeof svgElement.unpauseAnimations !== "function") {
      continue;
    }
    try {
      svgElement.unpauseAnimations();
    } catch (error) {
      // Ignore SVG roots removed while page motion was paused.
    }
  }
  pauseState.svgElements.clear();
}

function shouldPauseMediaElement(element) {
  const tagName = element && element.tagName ? String(element.tagName).toUpperCase() : "";
  if (!element || (tagName !== "VIDEO" && tagName !== "AUDIO")) {
    return false;
  }
  if (element.paused) {
    return false;
  }
  if (typeof element.hasAttribute === "function") {
    return element.hasAttribute("autoplay") || element.hasAttribute("loop") || element.hasAttribute("muted");
  }
  return Boolean(element.autoplay || element.loop || element.muted);
}

function pauseMediaElements(pauseState) {
  for (const mediaElement of queryPageMotionElements("video, audio")) {
    if (isIgnoredPageMotionElement(mediaElement) || !shouldPauseMediaElement(mediaElement) || typeof mediaElement.pause !== "function") {
      continue;
    }
    if (!pauseState.mediaElements.has(mediaElement)) {
      pauseState.mediaElements.set(mediaElement, { wasPaused: Boolean(mediaElement.paused) });
    }
    try {
      mediaElement.pause();
    } catch (error) {
      // Ignore media controlled by page policies.
    }
  }
}

function resumeMediaElements(pauseState) {
  for (const [mediaElement, mediaState] of pauseState.mediaElements) {
    if (!mediaElement || mediaState.wasPaused || typeof mediaElement.play !== "function") {
      continue;
    }
    try {
      const result = mediaElement.play();
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch (error) {
      // Ignore media that cannot resume due to browser autoplay policy.
    }
  }
  pauseState.mediaElements.clear();
}

function schedulePageMotionPauseRefresh(pauseState = state.pageMotionPause) {
  if (!pauseState || pauseState.refreshScheduled) {
    return;
  }
  const run = () => {
    if (state.pageMotionPause !== pauseState) {
      return;
    }
    pauseState.refreshScheduled = false;
    refreshPageMotionPause();
  };
  pauseState.refreshScheduled = true;
  try {
    extensionRequestAnimationFrame(run);
    return;
  } catch (error) {
    extensionSetTimeout(run, 0);
  }
}

function startPageMotionPauseRefreshTimer(pauseState) {
  if (pauseState.refreshTimer) {
    return;
  }
  pauseState.refreshTimer = extensionSetInterval(() => {
    if (state.pageMotionPause === pauseState) {
      refreshPageMotionPause();
    }
  }, PAGE_MOTION_PAUSE_REFRESH_MS);
}

function stopPageMotionPauseRefreshTimer(pauseState) {
  if (!pauseState.refreshTimer) {
    pauseState.refreshTimer = 0;
    return;
  }
  extensionClearInterval(pauseState.refreshTimer);
  pauseState.refreshTimer = 0;
}

function startPageMotionPauseObserver(pauseState) {
  if (pauseState.observer || typeof document === "undefined") {
    return;
  }
  const Observer = typeof MutationObserver === "function"
    ? MutationObserver
    : typeof window !== "undefined" && typeof window.MutationObserver === "function"
      ? window.MutationObserver
      : null;
  const root = document.documentElement || document.body;
  if (!Observer || !root) {
    return;
  }
  try {
    pauseState.observer = new Observer((mutations) => {
      if (state.pageMotionPause !== pauseState) {
        return;
      }
      const relevant = Array.from(mutations || []).some((mutation) => {
        const target = mutation && mutation.target && mutation.target.nodeType === 1
          ? mutation.target
          : null;
        return target && !isIgnoredPageMotionElement(target) && mutation.attributeName !== PAGE_MOTION_PAUSE_LOCK_ATTR;
      });
      if (relevant) {
        schedulePageMotionPauseRefresh(pauseState);
      }
    });
    pauseState.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "aria-hidden",
        "aria-label",
        "aria-roledescription",
        "role"
      ]
    });
  } catch (error) {
    pauseState.observer = null;
  }
}

function stopPageMotionPauseObserver(pauseState) {
  if (!pauseState.observer) {
    return;
  }
  try {
    pauseState.observer.disconnect();
  } catch (error) {
    // Ignore observers already detached by the browser.
  }
  pauseState.observer = null;
}

export function pausePageMotion(reason = PAGE_MOTION_PAUSE_DEFAULT_REASON) {
  const pauseState = state.pageMotionPause || createPageMotionPauseState();
  pauseState.reasons.add(normalizePageMotionPauseReason(reason));
  state.pageMotionPause = pauseState;
  refreshPageMotionPause();
}

export function refreshPageMotionPause() {
  const pauseState = state.pageMotionPause;
  if (!pauseState || !pauseState.reasons || pauseState.reasons.size === 0) {
    return;
  }
  ensurePageMotionPauseStyle();
  ensurePageMotionPauseIndicator();
  setPageMotionPauseClass(true);
  setPageMotionFreezeTimersPaused(true);
  pauseDocumentAnimations(pauseState);
  pauseSvgAnimations(pauseState);
  pauseMediaElements(pauseState);
  const candidates = collectPageMotionCandidates();
  lockPageMotionCandidates(pauseState, candidates);
  pauseInteractiveMotionTargets(pauseState, candidates);
  startPageMotionPauseRefreshTimer(pauseState);
  startPageMotionPauseObserver(pauseState);
}

export function resumePageMotion(reason = PAGE_MOTION_PAUSE_DEFAULT_REASON) {
  const pauseState = state.pageMotionPause;
  if (!pauseState) {
    setPageMotionFreezeTimersPaused(false);
    removePageMotionPauseStyle();
    removePageMotionPauseIndicator();
    setPageMotionPauseClass(false);
    return;
  }
  if (pauseState.reasons) {
    pauseState.reasons.delete(normalizePageMotionPauseReason(reason));
    if (pauseState.reasons.size > 0) {
      refreshPageMotionPause();
      return;
    }
  }
  state.pageMotionPause = null;
  stopPageMotionPauseRefreshTimer(pauseState);
  stopPageMotionPauseObserver(pauseState);
  resumeInteractiveMotionTargets(pauseState);
  restorePageMotionLocks(pauseState);
  removePageMotionPauseStyle();
  removePageMotionPauseIndicator();
  setPageMotionPauseClass(false);
  setPageMotionFreezeTimersPaused(false);
  resumeSvgAnimations(pauseState);
  resumeMediaElements(pauseState);
  resumeDocumentAnimations(pauseState);
}

export function touchPageEntryTimestamp(entry, timestamp = null) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  if (typeof timestamp === "string" && timestamp.trim()) {
    entry.timestamp = config.normalizeEntryTimestamp(timestamp);
    return entry.timestamp;
  }
  const previousMillis = Date.parse(normalizeEntryTimestampValue(entry.timestamp));
  const nowTimestamp = config.createTimestampNow();
  let nextMillis = Date.parse(nowTimestamp);
  if (Number.isFinite(previousMillis) && Number.isFinite(nextMillis) && nextMillis <= previousMillis) {
    nextMillis = previousMillis + 1000;
  }
  if (!Number.isFinite(nextMillis)) {
    entry.timestamp = nowTimestamp;
    return entry.timestamp;
  }
  entry.timestamp = normalizeEntryTimestampValue(new Date(nextMillis).toISOString());
  return entry.timestamp;
}

function getExcludedXPathSet(config, pageUrl) {
  const entry =
    config &&
    config.pageMarkings &&
    typeof config.pageMarkings === "object" &&
    config.pageMarkings[pageUrl]
      ? config.pageMarkings[pageUrl]
      : state.currentPageUrl === pageUrl && state.currentPageEntry
        ? state.currentPageEntry
        : null;
  const items = entry && Array.isArray(entry.xpaths) ? entry.xpaths : [];
  return new Set(collectExcludedXPaths(items));
}

function getIncludeXPathSet(config, pageUrl) {
  const entry =
    config &&
    config.pageMarkings &&
    typeof config.pageMarkings === "object" &&
    config.pageMarkings[pageUrl]
      ? config.pageMarkings[pageUrl]
      : state.currentPageUrl === pageUrl && state.currentPageEntry
        ? state.currentPageEntry
        : null;
  const includeXpaths = entry && Array.isArray(entry.includeXpaths)
    ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
  return new Set(includeXpaths);
}

function getSilentWhitespaceExcludedXPathSet(config, pageUrl) {
  const entry =
    config &&
    config.pageMarkings &&
    typeof config.pageMarkings === "object" &&
    config.pageMarkings[pageUrl]
      ? config.pageMarkings[pageUrl]
      : state.currentPageUrl === pageUrl && state.currentPageEntry
        ? state.currentPageEntry
        : null;
  return new Set(collectSilentWhitespaceExcludedXPaths(entry));
}

function isExplicitlyExcludedElement(el, excludedSet) {
  if (!el || !excludedSet || excludedSet.size === 0) {
    return false;
  }
  const xpath = getXPath(el);
  return Boolean(xpath && excludedSet.has(xpath));
}

export function getMutationRenderMode(mutations) {
  let mode = "none";
  for (const mutation of mutations) {
    const targetNode =
      mutation.target && mutation.target.nodeType === 1
        ? mutation.target
        : mutation.target && mutation.target.parentElement;
    if (targetNode && isWithinConsentElement(targetNode)) {
      continue;
    }
    if (mutation.type === "attributes") {
      const name = mutation.attributeName || "";
      if (
        name === "class" ||
        name === "id"
      ) {
        return "rebuild";
      }
      if (name === "style") {
        return "rebuild";
      }
      if (name === "hidden" || name === "aria-hidden") {
        return "rebuild";
      }
      continue;
    }
    if (mutation.type === "characterData") {
      const parent = mutation.target && mutation.target.parentElement;
      if (parent && isWithinConsentElement(parent)) {
        continue;
      }
      if (parent && getCachedNormalizedElementText(parent)) {
        return "rebuild";
      }
      continue;
    }
    if (mutation.type === "childList") {
      let hasRelevantChange = false;
      for (const node of mutation.addedNodes || []) {
        if (node && node.nodeType === 1 && !isWithinConsentElement(node)) {
          hasRelevantChange = true;
          break;
        }
      }
      if (!hasRelevantChange) {
        for (const node of mutation.removedNodes || []) {
          if (node && node.nodeType === 1 && !isWithinConsentElement(node)) {
            hasRelevantChange = true;
            break;
          }
        }
      }
      if (hasRelevantChange) {
        return "rebuild";
      }
    }
  }
  return mode;
}

function isExplicitlyIncludedElement(el, includeSet) {
  if (!el || !includeSet || includeSet.size === 0) {
    return false;
  }
  const xpath = getXPath(el);
  return Boolean(xpath && includeSet.has(xpath));
}

function createOverlay() {
  if (state.overlay) {
    return;
  }

  const style = document.createElement("style");
  style.id = "unfluffify-freeze-style";
  const excludeCursorUrl = chrome.runtime.getURL("cursors/exclude.svg");
  const includeCursorUrl = chrome.runtime.getURL("cursors/include.svg");
  style.textContent = `
      html {
        scroll-behavior: auto !important;
      }
      html.uf-cursor-exclude,
      html.uf-cursor-exclude * {
        cursor: url("${excludeCursorUrl}") 4 3, not-allowed !important;
      }
      html.uf-cursor-include,
      html.uf-cursor-include * {
        cursor: url("${includeCursorUrl}") 4 3, copy !important;
      }
      html.uf-cursor-passthrough,
      html.uf-cursor-passthrough * {
        cursor: unset !important;
      }
      html.${MARKING_DISABLED_CURSOR_CLASS},
      html.${MARKING_DISABLED_CURSOR_CLASS} * {
        cursor: progress !important;
      }
      #unfluffify-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647 !important;
        pointer-events: auto;
      }
      #unfluffify-overlay.${PAGE_INSPECTION_OVERLAY_CLASS} {
        background: rgba(16, 20, 28, 0.2);
      }
      #unfluffify-overlay .uf-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #unfluffify-overlay .uf-layer[data-layer="hard"] { z-index: 2; }
      #unfluffify-overlay .uf-layer[data-layer="default"] { z-index: 3; }
      #unfluffify-overlay .uf-layer[data-layer="saved-explicit-exclude"] { z-index: 4; }
      #unfluffify-overlay .uf-layer[data-layer="saved-explicit-include"] { z-index: 5; }
      #unfluffify-overlay .uf-layer[data-layer="ai-content"] { z-index: 6; }
      #unfluffify-overlay .uf-layer[data-layer="session-explicit-exclude"] { z-index: 7; }
      #unfluffify-overlay .uf-layer[data-layer="session-explicit-include"] { z-index: 8; }
      #unfluffify-overlay .uf-layer[data-layer="focus"] { z-index: 9; }
      #unfluffify-overlay .uf-layer[data-layer="hover"] { z-index: 10; }
      #unfluffify-overlay .uf-layer[data-layer="interaction"] { z-index: 11; }
      #unfluffify-overlay.uf-scrolling .uf-layer {
        opacity: 0;
      }
      #unfluffify-overlay.${PAGE_INSPECTION_OVERLAY_CLASS} .uf-layer {
        opacity: 0;
      }
      #unfluffify-overlay.${MARKING_DISABLED_OVERLAY_CLASS} .uf-layer {
        opacity: 0.28;
        filter: grayscale(0.75) saturate(0.55);
      }
      #unfluffify-overlay.${MARKING_DISABLED_OVERLAY_CLASS} .uf-layer[data-layer="hover"],
      #unfluffify-overlay.${MARKING_DISABLED_OVERLAY_CLASS} .uf-layer[data-layer="interaction"] {
        opacity: 0;
      }
      #unfluffify-overlay .uf-rect {
        position: absolute;
        box-sizing: border-box;
        pointer-events: none;
        border-radius: 4px;
      }
      #unfluffify-overlay .uf-hover {
        border: 2px solid #ffb300;
        background: rgba(255, 179, 0, 0.1);
      }
      @keyframes blink {
        0%,100% { opacity: 0 }
        50% { opacity: 1 }
      }
      #unfluffify-overlay .uf-focus {
        border: 3px solid #00acc1;
        background: rgba(0, 172, 193, 0.12);
        box-shadow: 0px 0px 5px 5px #00acc178;
        opacity: 1;
        animation: blink 1s linear infinite !important;
      }
      #unfluffify-overlay .uf-hard-locked {
        background: repeating-linear-gradient(45deg, rgba(225, 70, 70, 0.1), rgba(225, 70, 70, 0.1) 20px, rgba(225, 150, 70, 0.1) 20px, rgb(225, 150, 70, 0.1) 40px);
        border: 2px dashed rgba(225, 70, 70, 0.25);
      }
      #unfluffify-overlay .uf-default {
        border: 1px solid #2e7d32;
        background: rgba(46, 125, 50, 0.08);
      }
      @keyframes uf-ai-content-dash {
        0% {
          background-position: 0 0, 0 100%, 0 0, 100% 0;
        }
        100% {
          background-position: 24px 0, -24px 100%, 0 -24px, 100% 24px;
        }
      }
      #unfluffify-overlay .uf-ai-content {
        border: 1px solid transparent;
        background-color: rgba(46, 125, 50, 0.08);
        background-image:
          repeating-linear-gradient(90deg, #35943a 0 6px, transparent 6px 12px),
          repeating-linear-gradient(90deg, #35943a 0 6px, transparent 6px 12px),
          repeating-linear-gradient(0deg, #35943a 0 6px, transparent 6px 12px),
          repeating-linear-gradient(0deg, #35943a 0 6px, transparent 6px 12px);
        background-size: 24px 2px, 24px 2px, 2px 24px, 2px 24px;
        background-position: 0 0, 0 100%, 0 0, 100% 0;
        background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
        background-origin: border-box;
        background-clip: border-box;
        animation: uf-ai-content-dash 2s linear infinite !important;
      }
      #unfluffify-overlay .uf-ai-content.uf-ai-content-overlay {
        background-color: transparent;
      }
      #unfluffify-overlay .uf-ai-content.uf-ai-content-ghost {
        background-color: transparent;
        background-image: none;
        border-style: dotted;
        border-color: rgba(53, 148, 58, 0.45);
        animation: none !important;
      }
      #unfluffify-overlay .uf-explicit-include {
        border: 3px solid #1b5e20;
        background: rgba(27, 94, 32, 0.2);
      }
      #unfluffify-overlay .uf-explicit-include-ghost {
        border: 1px dotted rgba(27, 94, 32, 0.45);
        background: transparent;
      }
      #unfluffify-overlay .uf-explicit-exclude {
        border: 3px solid #c62828;
        background: rgba(198, 40, 40, 0.2);
      }
      #unfluffify-overlay .uf-explicit-exclude-ghost {
        border: 1px dashed rgba(198, 40, 40, 0.45);
        background: transparent;
      }
      @keyframes uf-interaction-pulse {
        0% { opacity: 0.95; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.02); }
      }
      #unfluffify-overlay .uf-interaction-ack {
        animation: uf-interaction-pulse ${TOGGLE_ACK_ANIMATION_MS}ms ease-out forwards;
      }
      @media (prefers-reduced-motion: reduce) {
        #unfluffify-overlay .uf-interaction-ack {
          animation: none;
          opacity: 0.6;
        }
      }
      #unfluffify-overlay .uf-toast {
        position: fixed;
        left: 14px;
        right: 14px;
        bottom: 14px;
        padding: 10px 12px;
        background: rgba(47, 42, 36, 0.9);
        color: #fdf6ed;
        font-family: ${EXTENSION_UI_FONT_STACK};
        font-size: 12px;
        border-radius: 10px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      }
      #unfluffify-overlay .uf-toast.uf-toast-show {
        opacity: 1;
        transform: translateY(0);
      }
      #unfluffify-overlay .uf-marking-disabled-notice {
        position: fixed;
        top: max(14px, env(safe-area-inset-top));
        left: 50%;
        max-width: min(420px, calc(100vw - 28px));
        box-sizing: border-box;
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: rgba(35, 39, 47, 0.94);
        color: #ffffff;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
        font-family: ${EXTENSION_UI_FONT_STACK};
        font-size: 13px;
        font-weight: 650;
        line-height: 1.25;
        text-align: center;
        pointer-events: none;
        transform: translate(-50%, -6px);
        opacity: 0;
        transition: opacity 0.16s ease, transform 0.16s ease;
      }
      #unfluffify-overlay.${MARKING_DISABLED_OVERLAY_CLASS} .uf-marking-disabled-notice {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      #unfluffify-overlay .uf-marking-disabled-notice[hidden] {
        display: none;
      }
      #unfluffify-overlay .uf-page-inspection-notice {
        position: fixed;
        top: 50%;
        left: 50%;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: min(460px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 14px 16px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.24);
        background: rgba(22, 26, 34, 0.96);
        color: #ffffff;
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
        font-family: ${EXTENSION_UI_FONT_STACK};
        font-size: 14px;
        font-weight: 650;
        line-height: 1.3;
        pointer-events: none;
        transform: translate(-50%, -50%) scale(0.98);
        opacity: 0;
        transition: opacity 0.16s ease, transform 0.16s ease;
      }
      #unfluffify-overlay.${PAGE_INSPECTION_OVERLAY_CLASS} .uf-page-inspection-notice {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      #unfluffify-overlay .uf-page-inspection-notice[hidden] {
        display: none;
      }
      #unfluffify-overlay .uf-page-inspection-spinner {
        width: 20px;
        height: 20px;
        box-sizing: border-box;
        border: 2px solid rgba(255, 255, 255, 0.28);
        border-top-color: #ffffff;
        border-radius: 999px;
        animation: uf-page-inspection-spin 0.8s linear infinite;
        flex: 0 0 auto;
      }
      @keyframes uf-page-inspection-spin {
        to { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        #unfluffify-overlay .uf-page-inspection-spinner {
          animation: none;
        }
      }
    `;
  (document.body || document.documentElement).appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "unfluffify-overlay";
  overlay.setAttribute("data-uf-extension-ui", "true");

  const layerKeys = [
    "hard",
    "saved-explicit-exclude",
    "saved-explicit-include",
    "interaction",
    "ai-content",
    "session-explicit-exclude",
    "session-explicit-include",
    "default",
    "focus",
    "hover"
  ];

  layerKeys.forEach((key) => {
    const layer = document.createElement("div");
    layer.className = "uf-layer";
    layer.dataset.layer = key;
    overlay.appendChild(layer);
    state.layers[key] = layer;
  });

  // Hover and focus boxes are now managed dynamically via layers
  state.hoverBox = null;
  state.focusBox = null;

  const toast = document.createElement("div");
  toast.className = "uf-toast";
  overlay.appendChild(toast);
  state.toast = toast;

  const disabledNotice = document.createElement("div");
  disabledNotice.className = "uf-marking-disabled-notice";
  disabledNotice.hidden = true;
  disabledNotice.setAttribute("data-uf-extension-ui", "true");
  disabledNotice.setAttribute("role", "status");
  disabledNotice.setAttribute("aria-live", "polite");
  overlay.appendChild(disabledNotice);
  state.markingDisabledNotice = disabledNotice;

  const inspectionNotice = document.createElement("div");
  inspectionNotice.className = "uf-page-inspection-notice";
  inspectionNotice.hidden = true;
  inspectionNotice.setAttribute("data-uf-extension-ui", "true");
  inspectionNotice.setAttribute("role", "status");
  inspectionNotice.setAttribute("aria-live", "assertive");
  const inspectionSpinner = document.createElement("span");
  inspectionSpinner.className = "uf-page-inspection-spinner";
  inspectionSpinner.setAttribute("aria-hidden", "true");
  const inspectionMessage = document.createElement("span");
  inspectionMessage.className = "uf-page-inspection-message";
  inspectionMessage.textContent = ContentText.marking.pageInspection;
  inspectionNotice.appendChild(inspectionSpinner);
  inspectionNotice.appendChild(inspectionMessage);
  overlay.appendChild(inspectionNotice);
  state.pageInspectionNotice = inspectionNotice;

  overlay.addEventListener("mousemove", handleMouseMove, true);
  overlay.addEventListener("click", handleClick, true);
  overlay.addEventListener("contextmenu", handleContextMenu, true);
  (document.body || document.documentElement).appendChild(overlay);
  state.overlay = overlay;
  updateMarkingTemporarilyDisabledUi();
  updateAltPassThroughFromModifiers();
  updateCursorMode();

  window.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("click", handleAltClick, true);
  window.addEventListener("keyup", handleKeyup, true);
  window.addEventListener("blur", handleWindowBlur, true);
  document.addEventListener("visibilitychange", handleVisibilityChange, true);
  updateOverlayGutter();
}

function setPageInspectionUiActive(active) {
  const enabled = Boolean(active);
  if (typeof document !== "undefined" && document.documentElement) {
    setElementClassPresence(document.documentElement, PAGE_INSPECTION_OVERLAY_CLASS, enabled);
  }
  if (state.overlay) {
    setElementClassPresence(state.overlay, PAGE_INSPECTION_OVERLAY_CLASS, enabled);
    state.overlay.setAttribute("aria-busy", enabled ? "true" : "false");
  }
  if (state.pageInspectionNotice) {
    state.pageInspectionNotice.hidden = !enabled;
  }
  updateCursorMode();
}

export function isPageInspectionUiActive() {
  return Boolean(
    (state.pageInspectionNotice && !state.pageInspectionNotice.hidden) ||
      state.inspectionBlocker
  );
}

async function inspectPageBeforeMotionPause(isStillCurrent) {
  const keepUiActive = arguments.length > 1 && Boolean(arguments[1]?.keepUiActive);
  startPageInspectionInputBlocker();
  try {
    createOverlay();
    setPageInspectionUiActive(true);
    return await revealPageContentBeforeMotionPause(
      "both",
      PAGE_INSPECTION_DEFAULT_MAX_SCROLLS,
      PAGE_INSPECTION_DEFAULT_PAUSE_MS,
      isStillCurrent
    );
  } finally {
    if (!keepUiActive) {
      setPageInspectionUiActive(false);
      stopPageInspectionInputBlocker();
    }
  }
}

async function warmupPageRevealBeforeMotionPause(baseUrl, pageUrl, options = {}) {
  const keepUiActive = Boolean(options.keepUiActive);
  const revealWarmupId = state.pageRevealWarmupId + 1;
  state.pageRevealWarmupId = revealWarmupId;
  const isRevealWarmupCurrent = () =>
    state.pageRevealWarmupId === revealWarmupId &&
    state.enabled &&
    state.baseUrl === baseUrl &&
    location.href === pageUrl;
  await inspectPageBeforeMotionPause(isRevealWarmupCurrent, { keepUiActive });
  if (!isRevealWarmupCurrent()) {
    if (keepUiActive) {
      finishPageInspectionUi();
    }
    return false;
  }
  pausePageMotion();
  return true;
}

function hasPageMotionPauseReason(reason) {
  const pauseState = state.pageMotionPause;
  if (!pauseState || !pauseState.reasons || pauseState.reasons.size === 0) {
    return false;
  }
  return pauseState.reasons.has(normalizePageMotionPauseReason(reason));
}

export async function warmupSilentHighlightingBeforeMotionPause(
  baseUrl,
  pageUrl,
  reason = PAGE_MOTION_PAUSE_DEFAULT_REASON,
  options = {}
) {
  const keepUiActive = Boolean(options.keepUiActive);
  const onRevealProgress = typeof options.onRevealProgress === "function"
    ? options.onRevealProgress
    : null;
  const revealWarmupId = state.pageRevealWarmupId + 1;
  state.pageRevealWarmupId = revealWarmupId;
  const isRevealWarmupCurrent = () =>
    state.pageRevealWarmupId === revealWarmupId &&
    location.href === pageUrl &&
    (!baseUrl || utils.isPageWithinBaseUrl(location.href, baseUrl));
  const hadPauseReason = hasPageMotionPauseReason(reason);
  // Reveal scrolling can stall when deferred main-world timers stay paused from
  // a previous silent-highlight pass. Temporarily release only timer pausing
  // while keeping existing page-motion locks intact.
  if (hadPauseReason) {
    setPageMotionFreezeTimersPaused(false);
  }
  try {
    startPageInspectionInputBlocker();
    createOverlay();
    setPageInspectionUiActive(true);
    await revealPageContentBeforeMotionPause(
      "both",
      PAGE_INSPECTION_DEFAULT_MAX_SCROLLS,
      PAGE_INSPECTION_DEFAULT_PAUSE_MS,
      isRevealWarmupCurrent,
      onRevealProgress ? { onProgress: onRevealProgress } : {}
    );
    if (!isRevealWarmupCurrent()) {
      return false;
    }
    await waitForPageInspectionDelay(
      SILENT_HIGHLIGHT_WARMUP_SETTLE_DELAY_MS,
      isRevealWarmupCurrent
    );
    if (!isRevealWarmupCurrent()) {
      return false;
    }
    pausePageMotion(reason);
    return true;
  } finally {
    if (hadPauseReason && hasPageMotionPauseReason(reason)) {
      refreshPageMotionPause();
    }
    if (!keepUiActive) {
      setPageInspectionUiActive(false);
      stopPageInspectionInputBlocker();
      // Silent highlighting reveal uses the inspection UI only as a temporary
      // blocker while preparing the frozen page posture.
      if (!state.enabled) {
        removeOverlay();
      }
    } else if (!state.enabled && !isRevealWarmupCurrent()) {
      finishPageInspectionUi();
    }
  }
}

export function finishPageInspectionUi() {
  setPageInspectionUiActive(false);
  stopPageInspectionInputBlocker();
  if (!state.enabled) {
    removeOverlay();
  }
}

function flushPendingInspectionRender() {
  const hadPendingRender = Boolean(state.renderTimer || state.renderRaf);
  if (state.renderTimer) {
    extensionClearTimeout(state.renderTimer);
    state.renderTimer = 0;
  }
  if (state.renderRaf) {
    extensionCancelAnimationFrame(state.renderRaf);
    state.renderRaf = 0;
  }
  if (!hadPendingRender) {
    return;
  }
  if (state.pendingRenderInvalidate) {
    invalidateCachedCollections();
  }
  state.lastRenderAt = Date.now();
  try {
    renderHighlights();
  } finally {
    state.pendingRenderInvalidate = false;
  }
}

export function finishPageInspectionUiAfterRender() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const pollUntilRendered = () => {
      if (state.renderTimer || state.renderRaf) {
        if (Date.now() - startedAt >= PAGE_INSPECTION_RENDER_WAIT_TIMEOUT_MS) {
          try {
            flushPendingInspectionRender();
          } catch {
            // Rendering is best-effort here; the inspection blocker must not outlive the enable response.
          }
        } else {
          extensionSetTimeout(pollUntilRendered, 50);
          return;
        }
      }
      if (state.renderTimer || state.renderRaf) {
        extensionSetTimeout(pollUntilRendered, 50);
        return;
      }
      finishPageInspectionUi();
      resolve();
    };
    pollUntilRendered();
  });
}


function removeOverlay() {
  setPageInspectionUiActive(false);
  if (state.overlay) {
    state.overlay.removeEventListener("mousemove", handleMouseMove, true);
    state.overlay.removeEventListener("click", handleClick, true);
    state.overlay.removeEventListener("contextmenu", handleContextMenu, true);
    state.overlay.remove();
    state.overlay = null;
    state.layers = {};
    state.hoverBox = null;
    state.focusBox = null;
    state.focusElement = null;
    state.toast = null;
    state.markingDisabledNotice = null;
    state.pageInspectionNotice = null;
  }
  state.lastPointer = null;
  if (state.toggleAckTimer) {
    extensionClearTimeout(state.toggleAckTimer);
    state.toggleAckTimer = 0;
  }
  window.removeEventListener("keydown", handleKeydown, true);
  window.removeEventListener("click", handleAltClick, true);
  window.removeEventListener("keyup", handleKeyup, true);
  window.removeEventListener("blur", handleWindowBlur, true);
  document.removeEventListener("visibilitychange", handleVisibilityChange, true);
  const style = document.getElementById("unfluffify-freeze-style");
  if (style) {
    style.remove();
  }
  clearMarkedElements();
  state.altPassThrough = false;
  state.altHeld = false;
  state.shiftHeld = false;
  state.layerBoxes = new WeakMap();
  clearCursorMode();
}

function updateOverlayGutter() {
  if (!state.overlay) {
    return;
  }
  const verticalGutter = window.innerWidth - document.documentElement.clientWidth;
  const horizontalGutter =
      window.innerHeight - document.documentElement.clientHeight;
  state.overlay.style.right = verticalGutter > 0 ? `${verticalGutter}px` : "0px";
  state.overlay.style.bottom =
      horizontalGutter > 0 ? `${horizontalGutter}px` : "0px";
}

function showToast(message) {
  if (!state.toast) {
    return;
  }
  state.toast.textContent = message;
  state.toast.classList.add("uf-toast-show");
  extensionClearTimeout(state.toastHideTimer);
  state.toastHideTimer = extensionSetTimeout(() => {
    if (state.toast) {
      state.toast.classList.remove("uf-toast-show");
    }
  }, 1800);
}

function getMarkingTemporarilyDisabledReason() {
  const pageUrl = typeof location !== "undefined" ? location.href : "";
  const reconciliation = pageUrl ? getPageSaveReconciliationState(pageUrl) : null;
  if (config.isPageSaveReconciliationPending(reconciliation)) {
    if (reconciliation && reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON) {
      return "";
    }
    return reconciliation.reason || "pending";
  }
  return "";
}

function getMarkingTemporarilyDisabledMessage(reason) {
  if (reason === "saving") {
    return ContentText.marking.temporarilyDisabledSaving;
  }
  if (reason) {
    return ContentText.marking.temporarilyDisabledSyncing;
  }
  return ContentText.marking.temporarilyDisabled;
}

function isMarkingTemporarilyDisabled() {
  return Boolean(getMarkingTemporarilyDisabledReason());
}

function updateMarkingTemporarilyDisabledUi() {
  if (!state.overlay) {
    clearCursorMode();
    return;
  }
  const reason = getMarkingTemporarilyDisabledReason();
  const disabled = Boolean(reason);
  if (disabled && state.altPassThrough) {
    setAltPassThrough(false);
  }
  state.overlay.classList.toggle(MARKING_DISABLED_OVERLAY_CLASS, disabled);
  if (disabled) {
    state.overlay.setAttribute("aria-disabled", "true");
    clearLayer(state.layers["hover"]);
  } else {
    state.overlay.removeAttribute("aria-disabled");
  }
  const notice = state.markingDisabledNotice || state.overlay.querySelector(".uf-marking-disabled-notice");
  if (notice) {
    notice.hidden = !disabled;
    notice.textContent = disabled ? getMarkingTemporarilyDisabledMessage(reason) : "";
  }
  updateCursorMode();
}

function getMarkMode() {
  if (!state.enabled || !state.overlay) {
    return "disabled";
  }
  if (isMarkingTemporarilyDisabled()) {
    return "disabled";
  }
  if (state.altPassThrough) {
    return "passthrough";
  }
  if (state.altHeld) {
    return "include";
  }
  return "exclude";
}

function getMarkModeFromEvent(event) {
  if (!event) {
    return getMarkMode();
  }
  if (event.altKey) {
    return "include";
  }
  return "exclude";
}

function shouldAllowParentMarking(mode, shiftHeld) {
  return mode !== "include" && Boolean(shiftHeld);
}

function clearCursorMode() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root) {
    return;
  }
  root.classList.remove(
    "uf-cursor-exclude",
    "uf-cursor-include",
    "uf-cursor-passthrough",
    MARKING_DISABLED_CURSOR_CLASS
  );
}

function updateCursorMode() {
  clearCursorMode();
  const root = document.documentElement;
  if (!root) {
    return;
  }
  const mode = getMarkMode();
  if (mode === "passthrough") {
    root.classList.add("uf-cursor-passthrough");
  } else if (mode === "disabled") {
    root.classList.add(MARKING_DISABLED_CURSOR_CLASS);
  } else if (mode === "exclude") {
    root.classList.add("uf-cursor-exclude");
  } else if (mode === "include") {
    root.classList.add("uf-cursor-include");
  }
}

function updateAltPassThroughFromModifiers() {
  updateCursorMode();
}

function isPageInteractionKeyEvent(event) {
  if (!event || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }
  return event.code === PAGE_INTERACTION_KEY_CODE ||
    event.key === PAGE_INTERACTION_KEY ||
    event.key === PAGE_INTERACTION_LEGACY_KEY;
}

function isEditableKeyEventTarget(target) {
  if (!target || target.nodeType !== 1) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName ? String(target.tagName).toUpperCase() : "";
  if (tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (tagName !== "INPUT") {
    return false;
  }
  const inputType = typeof target.getAttribute === "function"
    ? String(target.getAttribute("type") || "text").toLowerCase()
    : "text";
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "image",
    "radio",
    "range",
    "reset",
    "submit"
  ].includes(inputType);
}

function syncModifierState(event) {
  if (!event) {
    return;
  }
  const altHeld =
    typeof event.getModifierState === "function"
      ? event.getModifierState("Alt")
      : Boolean(event.altKey);
  const shiftHeld =
    typeof event.getModifierState === "function"
      ? event.getModifierState("Shift")
      : Boolean(event.shiftKey);
  const changed =
    altHeld !== state.altHeld || shiftHeld !== state.shiftHeld;
  state.altHeld = altHeld;
  state.shiftHeld = shiftHeld;
  if (changed) {
    updateAltPassThroughFromModifiers();
    updateCursorMode();
    refreshHoverHighlight();
  }
}

function resetModifierState() {
  const hadModifiers = state.altHeld || state.shiftHeld || state.altPassThrough;
  state.altHeld = false;
  state.shiftHeld = false;
  if (state.altPassThrough) {
    setAltPassThrough(false);
  }
  if (hadModifiers) {
    updateCursorMode();
    refreshHoverHighlight();
  }
}

function handleWindowBlur() {
  if (!state.enabled) {
    return;
  }
  resetModifierState();
}

function handleVisibilityChange() {
  if (!state.enabled || !document.hidden) {
    return;
  }
  resetModifierState();
}

function updateFocusHighlight() {
  const layerFocus = state.layers["focus"];
  if (!layerFocus) {
    syncAiPreviewFocusElement(state.focusElement);
    return;
  }
  const layerState = beginLayerRender(layerFocus);
  if (!state.focusElement) {
    clearAiPreviewFocusElement();
    finalizeLayerRender(layerState);
    return;
  }
  syncAiPreviewFocusElement(state.focusElement);
  const rects = getVisibleRects(state.focusElement);
  if (rects.length > 0) {
    drawMultiRectReuse(
      layerState,
      rects,
      "uf-focus",
      state.focusElement,
      null,
      null
    );
  }
  finalizeLayerRender(layerState);
}

function showImmediateToggleAcknowledgement(target, mode) {
  const interactionLayer = state.layers["interaction"];
  if (!interactionLayer || !target || target.nodeType !== 1) {
    return;
  }
  const presentation = getExplicitMarkingPresentation({ type: mode });
  const rects = getVisibleRects(target);
  const layerState = beginLayerRender(interactionLayer);
  if (rects.length > 0) {
    drawMultiRectReuse(
      layerState,
      rects,
      `${presentation.className} uf-interaction-ack`,
      target,
      mode,
      null
    );
  }
  finalizeLayerRender(layerState);
  if (state.toggleAckTimer) {
    extensionClearTimeout(state.toggleAckTimer);
  }
  state.toggleAckTimer = extensionSetTimeout(() => {
    state.toggleAckTimer = 0;
    clearLayer(state.layers["interaction"]);
  }, TOGGLE_ACK_CLEAR_MS);
}

function ensureAiPopoverStyle() {
  if (document.getElementById("unfluffify-ai-popover-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "unfluffify-ai-popover-style";
  style.textContent = `
      .uf-ai-popover {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }
      .uf-ai-popover-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(26, 22, 18, 0.42);
        opacity: 1;
        transition: opacity 0.26s ease;
        pointer-events: auto;
      }
      .uf-ai-popover-stage {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 20px;
        overflow: auto;
        opacity: 1;
        transform: translateX(0);
        transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease;
        pointer-events: auto;
      }
      .uf-ai-popover-modal {
        margin-top: max(24px, 5vh);
        background: linear-gradient(180deg, #fffaf2 0%, #fffdf8 100%);
        color: #2f2a24;
        width: min(720px, 100%);
        max-height: min(82vh, 720px);
        border: 1px solid #eadccc;
        border-radius: 18px;
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.22);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .uf-ai-popover-toggle {
        appearance: none;
        -webkit-appearance: none;
        width: 36px;
        height: 36px;
        padding: 0;
        margin: 0;
        border: 1px solid #dcc9ae;
        border-radius: 10px;
        background: linear-gradient(180deg, #fff8ef 0%, #f6ead9 100%);
        color: #6c4c2b;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        line-height: 1;
        box-shadow: none;
        transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      }
      .uf-ai-popover-toggle:hover,
      .uf-ai-popover-close:hover {
        background: linear-gradient(180deg, #fffdf8 0%, #f7efe3 100%);
      }
      .uf-ai-popover-toggle:focus-visible,
      .uf-ai-popover-close:focus-visible {
        outline: 2px solid #6c4c2b;
        outline-offset: 2px;
      }
      .uf-ai-popover-toggle:active,
      .uf-ai-popover-close:active {
        transform: translateY(1px);
      }
      .uf-ai-popover-icon {
        width: 18px;
        height: 18px;
        display: block;
      }
      .uf-ai-popover-toggle--restore {
        position: fixed;
        left: -16px;
        top: 50%;
        width: 40px;
        height: 40px;
        opacity: 0;
        transform: translateY(-50%) translateX(-18px);
        transition: opacity 0.22s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), background 0.2s ease, box-shadow 0.2s ease, left 0.2s ease;
        pointer-events: none;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
      }
      .uf-ai-popover-toggle--restore:hover {
        left: 0;
      }
      .uf-ai-popover--collapsed {
        pointer-events: none;
      }
      .uf-ai-popover--collapsed .uf-ai-popover-backdrop {
        opacity: 0;
        pointer-events: none;
      }
      .uf-ai-popover--collapsed .uf-ai-popover-stage {
        opacity: 0;
        transform: translateX(calc(-100% - 48px));
        pointer-events: none;
      }
      .uf-ai-popover--collapsed .uf-ai-popover-toggle--restore {
        opacity: 1;
        transform: translateY(-50%) translateX(0);
        pointer-events: auto;
      }
      .uf-ai-popover-header {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 12px;
        padding: 16px 18px 12px;
        border-bottom: 1px solid #eadccc;
      }
      .uf-ai-popover-title {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6c4c2b;
        text-align: center;
      }
      .uf-ai-popover-close {
        appearance: none;
        -webkit-appearance: none;
        border: 1px solid #dcc9ae;
        background: linear-gradient(180deg, #fff8ef 0%, #f6ead9 100%);
        color: #6c4c2b;
        border-radius: 999px;
        width: 34px;
        height: 34px;
        min-width: 34px;
        min-height: 34px;
        padding: 0;
        margin: 0;
        flex: 0 0 34px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 700;
        font-family: ${EXTENSION_UI_FONT_STACK};
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        text-transform: none;
        text-indent: 0;
        box-shadow: none;
        overflow: hidden;
        transition: transform 0.2s ease, background 0.2s ease;
        visibility: hidden;
      }
      .uf-ai-popover-body {
        padding: 14px 22px 22px;
        overflow: auto;
        min-height: 0;
      }
      .uf-ai-popover-list {
        margin: 0;
        padding: 0 0 0 22px;
        display: grid;
        gap: 10px;
        font-size: 13px;
        line-height: 1.45;
        color: #2f2a24;
      }
      .uf-ai-popover-list li {
        font-size: 13px;
        line-height: 1.45;
        color: #2f2a24;
        white-space: pre-line;
      }
      .uf-ai-popover-item-button {
        appearance: none;
        -webkit-appearance: none;
        display: block;
        width: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: inherit;
        text-align: left;
        cursor: pointer;
      }
      .uf-ai-popover-item-button:hover,
      .uf-ai-popover-item-button:focus-visible {
        color: #6c4c2b;
        text-decoration: underline;
      }
    `;
  document.documentElement.appendChild(style);
}

function createAiPopoverPanelIcon(direction) {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "uf-ai-popover-icon");

  const frame = document.createElementNS(svgNs, "rect");
  frame.setAttribute("x", "1.5");
  frame.setAttribute("y", "2.5");
  frame.setAttribute("width", "15");
  frame.setAttribute("height", "13");
  frame.setAttribute("rx", "2.5");
  frame.setAttribute("fill", "none");
  frame.setAttribute("stroke", "currentColor");
  frame.setAttribute("stroke-width", "1.4");

  const divider = document.createElementNS(svgNs, "line");
  divider.setAttribute("x1", "5.2");
  divider.setAttribute("y1", "3.6");
  divider.setAttribute("x2", "5.2");
  divider.setAttribute("y2", "14.4");
  divider.setAttribute("stroke", "currentColor");
  divider.setAttribute("stroke-width", "1.4");
  divider.setAttribute("stroke-linecap", "round");

  const arrow = document.createElementNS(svgNs, "path");
  const pathValue = direction === "right"
    ? "M7.2 9h5.2M10.7 6.2l2.6 2.8-2.6 2.8"
    : "M12.4 9H7.2M8.9 6.2 6.3 9l2.6 2.8";
  arrow.setAttribute("d", pathValue);
  arrow.setAttribute("fill", "none");
  arrow.setAttribute("stroke", "currentColor");
  arrow.setAttribute("stroke-width", "1.6");
  arrow.setAttribute("stroke-linecap", "round");
  arrow.setAttribute("stroke-linejoin", "round");

  svg.appendChild(frame);
  svg.appendChild(divider);
  svg.appendChild(arrow);
  return svg;
}

function ensureAiPreviewFocusStyle() {
  if (document.getElementById(AI_PREVIEW_FOCUS_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = AI_PREVIEW_FOCUS_STYLE_ID;
  style.textContent = `
      .${AI_PREVIEW_FOCUS_CLASS} {
        background: rgb(255, 255, 0) !important;
        color: rgb(0, 0, 0) !important;
        border-radius: 6px !important;
        scroll-margin: 24vh !important;
      }
    `;
  document.documentElement.appendChild(style);
}

function clearAiPreviewFocusElement() {
  if (aiPreviewFocusElement && aiPreviewFocusElement.classList) {
    aiPreviewFocusElement.classList.remove(AI_PREVIEW_FOCUS_CLASS);
  }
  aiPreviewFocusElement = null;
}

function syncAiPreviewFocusElement(target) {
  ensureAiPreviewFocusStyle();
  if (aiPreviewFocusElement && aiPreviewFocusElement !== target && aiPreviewFocusElement.classList) {
    aiPreviewFocusElement.classList.remove(AI_PREVIEW_FOCUS_CLASS);
  }
  aiPreviewFocusElement = target || null;
  if (aiPreviewFocusElement && aiPreviewFocusElement.classList) {
    aiPreviewFocusElement.classList.add(AI_PREVIEW_FOCUS_CLASS);
  }
}

function closeAiPopover(options = {}) {
  const notify = options.notify !== false;
  const suppressCallback = options.suppressCallback === true;
  if (!state.aiPopover) {
    return;
  }
  const popover = state.aiPopover;
  const onClose = state.aiPopoverOnClose;
  state.aiPopoverOnClose = null;
  state.aiPopoverOnCollapsedChange = null;
  clearFocusHighlight();
  popover.remove();
  state.aiPopover = null;
  state.aiPopoverCollapsed = false;
  const afterClose = !suppressCallback && typeof onClose === "function"
    ? Promise.resolve()
        .then(() => onClose())
        .catch(() => {
          // Ignore preview restore callback failures during teardown.
        })
    : Promise.resolve();
  if (notify) {
    afterClose.finally(() => {
      chrome.runtime.sendMessage({
        type: "aiPreviewClosed",
        markingEnabled: Boolean(state.enabled)
      }).then().catch(() => {
        // Ignore notification failures during teardown.
      });
    });
  }
}

function setAiPopoverCollapsed(collapsed) {
  if (!state.aiPopover) {
    return;
  }
  if (!collapsed) {
    clearFocusHighlight();
  }
  state.aiPopoverCollapsed = Boolean(collapsed);
  state.aiPopover.classList.toggle("uf-ai-popover--collapsed", state.aiPopoverCollapsed);
  if (typeof state.aiPopoverOnCollapsedChange === "function") {
    try {
      state.aiPopoverOnCollapsedChange(state.aiPopoverCollapsed);
    } catch {
      // Ignore preview collapse state sync failures.
    }
  }
}

export function hasAiPopover() {
  return Boolean(state.aiPopover);
}

export function requestAiPopoverClose(options = {}) {
  closeAiPopover(options);
}

export function focusPreviewElement(target, options = {}) {
  if (!target || target.nodeType !== 1) {
    return false;
  }
  state.focusElement = target;
  syncAiPreviewFocusElement(target);
  if (options.center !== false && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "center", inline: "center" });
  }
  updateFocusHighlight();
  return true;
}

function recordPageSnapshot(configValue, pageUrl) {
  if (!configValue || !pageUrl) {
    return;
  }
  const snapshotStartedAt = nowMs();
  const immutableExcluded = collectImmutableElements();
  syncPageMarkings(configValue, pageUrl, immutableExcluded);
  const entry = getPageMarkingEntry(configValue, pageUrl);
  const snapshot = createSanitizedPageSnapshot({
    renderMode: config.getConfigRenderMode(configValue)
  });
  logTogglePerf("snapshot.serialize", snapshotStartedAt, { pageUrl });
  entry.renderedHtml = snapshot.renderedHtml;
  entry.title = normalizePageEntryTitle(document.title, pageUrl);
  setPageMarkingEntry(configValue.pageMarkings, pageUrl, entry);
}

function getMarkId(el) {
  if (!el || el.nodeType !== 1) {
    return "";
  }
  let id = state.markIds.get(el);
  if (!id) {
    id = `uf-${state.markIdCounter}`;
    state.markIdCounter += 1;
    state.markIds.set(el, id);
  }
  return id;
}

function clearMarkedElements() {
  if (!state.markedElements) {
    return;
  }
  for (const el of state.markedElements) {
    if (el && el.nodeType === 1) {
      el.removeAttribute("data-uf-mark-id");
    }
  }
  state.markedElements = new Set();
}

function updateMarkedElements(currentMarked) {
  if (!currentMarked) {
    return;
  }
  const previous = state.markedElements || new Set();
  for (const el of previous) {
    if (!currentMarked.has(el) && el && el.nodeType === 1) {
      el.removeAttribute("data-uf-mark-id");
    }
  }
  for (const el of currentMarked) {
    if (!previous.has(el) && el && el.nodeType === 1) {
      const markId = getMarkId(el);
      if (markId) {
        el.setAttribute("data-uf-mark-id", markId);
      }
    }
  }
  state.markedElements = currentMarked;
}

function getTargetElement(x, y) {
  const elements = document.elementsFromPoint(x, y);
  for (const el of elements) {
    if (!el || el.nodeType !== 1) {
      continue;
    }
    if (state.overlay && (el === state.overlay || state.overlay.contains(el))) {
      continue;
    }
    if (el === document.documentElement || el === document.body) {
      continue;
    }
    return el;
  }
  return null;
}


function hasMultipleMarkableDescendants(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(el.children);
  let markableDescendantCount = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(node)) {
      continue;
    }
    if (isWithinConsentElement(node)) {
      continue;
    }
    if (isWithinImmutableExcluded(node)) {
      continue;
    }
    if (isSelfMarkableWithoutParentMode(node, options)) {
      markableDescendantCount += 1;
      if (shouldAllowParentMarkingBoundary({
        hasDirectText: false,
        markableDescendantCount
      })) {
        return true;
      }
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function getDepthBelowBody(el) {
  if (!el || el.nodeType !== 1 || typeof document === "undefined" || !document.body) {
    return Number.POSITIVE_INFINITY;
  }
  let depth = 0;
  let node = el;
  while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
    depth += 1;
    node = node.parentElement;
  }
  return node === document.body ? depth : Number.POSITIVE_INFINITY;
}

function isParentMarkingContentBoundary(el) {
  const tagName = el && el.tagName ? String(el.tagName).toUpperCase() : "";
  return PARENT_MARKING_CONTENT_BOUNDARY_TAGS.has(tagName) || matchesToggleableDefaultExcluded(el);
}

function getElementRole(el) {
  return el && typeof el.getAttribute === "function"
    ? String(el.getAttribute("role") || "").trim().toLowerCase()
    : "";
}

function containsPageShellLandmark(el) {
  const landmarkKinds = new Set();
  const stack = Array.from(el && el.children ? el.children : []);
  while (stack.length && landmarkKinds.size < 2) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    const tagName = node.tagName ? String(node.tagName).toUpperCase() : "";
    if (PARENT_MARKING_PAGE_SHELL_LANDMARK_TAGS.has(tagName)) {
      landmarkKinds.add(tagName);
    }
    const role = getElementRole(node);
    if (PARENT_MARKING_PAGE_SHELL_ROLES.has(role)) {
      landmarkKinds.add(role);
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return landmarkKinds.size >= 2;
}

function hasBroadParentMarkingFootprint(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return false;
  }
  let rect;
  try {
    rect = el.getBoundingClientRect();
  } catch (error) {
    return false;
  }
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const viewport = getViewportBounds();
  const viewportWidth = viewport.width || (typeof window !== "undefined" ? window.innerWidth : 0) || 0;
  const viewportHeight = viewport.height || (typeof window !== "undefined" ? window.innerHeight : 0) || 0;
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return false;
  }
  const widthRatio = rect.width / viewportWidth;
  const heightRatio = rect.height / viewportHeight;
  return widthRatio >= 0.85 && heightRatio >= 0.65;
}

function isUnsafeShallowParentMarkingTarget(el, options = {}) {
  if (!options || !options.allowParent || !el || el.nodeType !== 1) {
    return false;
  }
  if (isParentMarkingContentBoundary(el)) {
    return false;
  }
  if (hasDirectText(el)) {
    return false;
  }
  const depth = getDepthBelowBody(el);
  if (depth > 2) {
    return false;
  }
  return containsPageShellLandmark(el) || hasBroadParentMarkingFootprint(el);
}

function createExcludedAncestorChecker(options = {}) {
  const configValue = options.config || state.config;
  const pageUrl = options.pageUrl || location.href;
  const entry = options.entry || (
    configValue &&
    configValue.pageMarkings &&
    typeof configValue.pageMarkings === "object"
      ? configValue.pageMarkings[pageUrl] || null
      : null
  ) || (
    state.currentPageUrl === pageUrl && state.currentPageEntry
      ? state.currentPageEntry
      : null
  );
  const excludedLookup = new Map();
  const includeSet = new Set();
  if (entry && typeof entry === "object") {
    const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
    for (const item of items) {
      if (item && typeof item.xpath === "string" && item.xpath) {
        excludedLookup.set(item.xpath, Boolean(item.excluded));
      }
    }
    const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
    for (const xpath of includeXpaths) {
      if (typeof xpath === "string" && xpath) {
        includeSet.add(xpath);
      }
    }
  }
  return (element) => {
    if (!element || element.nodeType !== 1) {
      return false;
    }
    let node = element.parentElement;
    while (node && node.nodeType === 1) {
      if (isWithinAiPopover(node) || isWithinConsentElement(node)) {
        node = node.parentElement;
        continue;
      }
      const xpath = getXPath(node);
      if (xpath && includeSet.has(xpath)) {
        node = node.parentElement;
        continue;
      }
      if (xpath && excludedLookup.has(xpath)) {
        if (excludedLookup.get(xpath) === true) {
          return true;
        }
        node = node.parentElement;
        continue;
      }
      if (matchesImmutableExcluded(node) || matchesAutoToggleableDefaultExcluded(node)) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  };
}

function resolveMarkableElement(el, config, options) {
  if (!el || el.nodeType !== 1) {
    return null;
  }

  const currentOptions = {
    ...(options || {})
  };
  const ancestorOptions = {
    ...currentOptions,
    allowParent: false,
    explicitlyExcluded: false,
    explicitlyIncluded: false,
    preferMixedTextAncestor: false
  };

  if (currentOptions.allowParent) {
    const selfStructuredGroup =
      !isWithinAiPopover(el) &&
      !isWithinConsentElement(el) &&
      isStructuredGroupExclusionCandidate(el, ancestorOptions);
    const selfToggleableBoundary =
      !isWithinAiPopover(el) &&
      !isWithinConsentElement(el) &&
      matchesToggleableDefaultExcluded(el) &&
      isTextualContainer(el, ancestorOptions);
    const ancestorCandidates = [];
    let ancestor = el.parentElement;
    while (ancestor && ancestor.nodeType === 1) {
      if (ancestor === document.documentElement || ancestor === document.body) {
        break;
      }
      if (!isWithinAiPopover(ancestor) && !isWithinConsentElement(ancestor)) {
        const structuredGroupBoundary = isStructuredGroupExclusionCandidate(
          ancestor,
          ancestorOptions
        );
        const toggleableBoundary =
          !structuredGroupBoundary &&
          matchesToggleableDefaultExcluded(ancestor) &&
          isTextualContainer(ancestor);
        const markableBoundary =
          !structuredGroupBoundary &&
          !toggleableBoundary &&
          isMarkableElement(ancestor, config, ancestorOptions);
        ancestorCandidates.push({
          value: ancestor,
          isStructuredGroup: structuredGroupBoundary,
          isToggleableBoundary: toggleableBoundary,
          isMarkable: markableBoundary
        });
      }
      ancestor = ancestor.parentElement;
    }
    const preferredBoundary = chooseExcludeParentBoundaryTarget({
      selfValue: el,
      selfStructuredGroup,
      selfToggleableBoundary,
      ancestors: ancestorCandidates
    });
    if (preferredBoundary) {
      return preferredBoundary;
    }
  }

  if (currentOptions.preferMixedTextAncestor) {
    let ancestor = el.parentElement;
    while (ancestor && ancestor.nodeType === 1) {
      if (ancestor === document.documentElement || ancestor === document.body) {
        break;
      }
      if (
        !isWithinAiPopover(ancestor) &&
        !isWithinConsentElement(ancestor) &&
        isExplicitIncludeBoundaryCandidate(ancestor, ancestorOptions)
      ) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    if (isExplicitIncludeBoundaryCandidate(el, ancestorOptions)) {
      return el;
    }
  }

  if (!isMarkableElement(el, config, currentOptions)) {
    return null;
  }
  return el;
}

export function getMarkableTarget(x, y, options) {
  const allowParent = options && options.allowParent;
  const allowExplicitTarget = options && options.allowExplicitTarget;
  const preferExplicitTarget = !options || options.preferExplicitTarget !== false;
  const excludedSet = options && options.excludedSet;
  const includeSet = options && options.includeSet;
  const silentWhitespaceExcludedSet = options && options.silentWhitespaceExcludedSet;
  const explicitParentSet = options && options.explicitParentSet;
  const allowExcludedParentChildren = options && options.allowExcludedParentChildren;
  const allowImmutableChildren = options && options.allowImmutableChildren;
  const preferMixedTextAncestor = Boolean(options && options.preferMixedTextAncestor);
  const requireExcludedAncestor = Boolean(options && options.requireExcludedAncestor);
  const hasExcludedAncestor = requireExcludedAncestor
    ? createExcludedAncestorChecker({ config: state.config, pageUrl: location.href })
    : null;
  const elements = document.elementsFromPoint(x, y);
  if (
    allowExplicitTarget &&
    preferExplicitTarget &&
    ((excludedSet && excludedSet.size > 0) || (includeSet && includeSet.size > 0))
  ) {
    for (const el of elements) {
      if (!el || el.nodeType !== 1) {
        continue;
      }
      if (state.overlay && (el === state.overlay || state.overlay.contains(el))) {
        continue;
      }
      if (el === document.documentElement || el === document.body) {
        continue;
      }
      if (isWithinAiPopover(el)) {
        continue;
      }
      if (isWithinConsentElement(el)) {
        continue;
      }
      const xpath = (explicitParentSet || excludedSet || includeSet) ? getXPath(el) : "";
      const explicitlyExcluded =
        xpath &&
        excludedSet &&
        excludedSet.size > 0 &&
        excludedSet.has(xpath) &&
        !(silentWhitespaceExcludedSet && silentWhitespaceExcludedSet.has(xpath));
      const explicitlyIncluded =
        xpath && includeSet && includeSet.size > 0 && includeSet.has(xpath);
      const withinExplicitExcludedParent =
        !allowExcludedParentChildren &&
        xpath &&
        explicitParentSet &&
        explicitParentSet.size > 0 &&
        isWithinExplicitExcludedXpath(xpath, explicitParentSet);
      if (withinExplicitExcludedParent && !explicitlyIncluded) {
        continue;
      }
      if (
        explicitlyExcluded ||
        explicitlyIncluded
      ) {
        if (!hasRenderableMarkingTargetGeometry(el, { allowGhost: explicitlyIncluded })) {
          continue;
        }
        return el;
      }
    }
  }
  for (const el of elements) {
    if (!el || el.nodeType !== 1) {
      continue;
    }
    if (state.overlay && (el === state.overlay || state.overlay.contains(el))) {
      continue;
    }
    if (el === document.documentElement || el === document.body) {
      continue;
    }
    if (isWithinConsentElement(el)) {
      continue;
    }
    const explicitlyExcluded =
        allowExplicitTarget &&
        isExplicitlyExcludedElement(el, excludedSet) &&
        !(silentWhitespaceExcludedSet && silentWhitespaceExcludedSet.has(getXPath(el)));
    const explicitlyIncluded =
        allowExplicitTarget && isExplicitlyIncludedElement(el, includeSet);
    if (
      requireExcludedAncestor &&
      !explicitlyExcluded &&
      !explicitlyIncluded &&
      hasExcludedAncestor &&
      !hasExcludedAncestor(el)
    ) {
      continue;
    }
    const resolved = resolveMarkableElement(el, state.config, {
      allowParent,
      explicitlyExcluded,
      explicitlyIncluded,
      allowImmutableChildren,
      preferMixedTextAncestor,
      hitPoint: { x, y }
    });
    if (resolved) {
      if (!hasRenderableMarkingTargetGeometry(resolved)) {
        continue;
      }
      return resolved;
    }
  }
  return null;
}

function updateHoverHighlight(
  x,
  y,
  allowParent,
  allowExcludedParentChildren,
  allowImmutableChildren
) {
  if (!state.enabled || state.altPassThrough) {
    return;
  }
  const layerHover = state.layers["hover"];
  if (!layerHover) {
    return;
  }
  const savedVisibilityCache = state.visibilityCache;
  if (!savedVisibilityCache) {
    state.visibilityCache = new Map();
  }
  const layerState = beginLayerRender(layerHover);
  try {
    const explicitParentSet = getExcludedXPathSet(state.config, location.href);
    const excludedSet =
      allowParent || allowExcludedParentChildren ? null : explicitParentSet;
    const includeSet = getIncludeXPathSet(state.config, location.href);
    const silentWhitespaceExcludedSet = getSilentWhitespaceExcludedXPathSet(state.config, location.href);
    const target = getMarkableTarget(x, y, {
      allowParent,
      allowExplicitTarget: true,
      preferExplicitTarget: allowExcludedParentChildren,
      preferMixedTextAncestor: allowExcludedParentChildren && !allowParent,
      excludedSet,
      includeSet,
      silentWhitespaceExcludedSet,
      explicitParentSet,
      allowExcludedParentChildren,
      allowImmutableChildren,
      requireExcludedAncestor: false
    });
    if (!target) {
      finalizeLayerRender(layerState);
      return;
    }
    const rects = getVisibleRects(target);
    if (rects.length === 0) {
      finalizeLayerRender(layerState);
      return;
    }
    drawMultiRectReuse(layerState, rects, "uf-hover", target, null, null);
    finalizeLayerRender(layerState);
  } finally {
    state.visibilityCache = savedVisibilityCache;
  }
}

function refreshHoverHighlight() {
  if (!state.enabled || state.altPassThrough) {
    return;
  }
  updateMarkingTemporarilyDisabledUi();
  const layerHover = state.layers["hover"];
  if (!layerHover) {
    return;
  }
  if (isPageSaveReconciliationPending(location.href)) {
    clearLayer(layerHover);
    return;
  }
  if (!state.lastPointer) {
    clearLayer(layerHover);
    return;
  }
  const mode = getMarkMode();
  const allowExcludedParentChildren = mode === "include";
  const allowImmutableChildren = false;
  const allowParent = shouldAllowParentMarking(mode, state.shiftHeld);
  updateHoverHighlight(
      state.lastPointer.x,
      state.lastPointer.y,
      allowParent,
      allowExcludedParentChildren,
      allowImmutableChildren
  );
}

function handleMouseMove(event) {
  if (!state.enabled) {
    return;
  }
  if (isPageSaveReconciliationPending(location.href)) {
    updateMarkingTemporarilyDisabledUi();
    clearLayer(state.layers["hover"]);
    return;
  }
  event.stopPropagation();
  syncModifierState(event);
  state.lastPointer = {
    x: event.clientX,
    y: event.clientY,
    shiftKey: event.shiftKey
  };
  if (state.hoverRaf) {
    return;
  }
  state.hoverRaf = extensionRequestAnimationFrame(() => {
    state.hoverRaf = 0;
    if (!state.enabled || !state.lastPointer) {
      return;
    }
    const mode = getMarkModeFromEvent(event);
    const allowExcludedParentChildren = mode === "include";
    const allowImmutableChildren = false;
    const allowParent = shouldAllowParentMarking(mode, state.lastPointer.shiftKey);
    updateHoverHighlight(
      state.lastPointer.x,
      state.lastPointer.y,
      allowParent,
      allowExcludedParentChildren,
      allowImmutableChildren
    );
  });
}

function toggleExplicitExclude(target, options = {}) {
  if (!state.baseUrl || !state.config) {
    return;
  }
  if (isPageSaveReconciliationPending(location.href)) {
    updateMarkingTemporarilyDisabledUi();
    showToast(ContentText.marking.saveReconciliationBlocked);
    return;
  }
  if (isWithinImmutableExcluded(target)) {
    showToast(ContentText.marking.immutableOverrideBlocked);
    return;
  }

  const xpath = getXPath(target);
  if (!xpath) {
    return;
  }

  const mutationStartedAt = nowMs();
  const config = state.config;
  const entry = getPageMarkingEntry(config, location.href);
  const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
  const xpathElementCache = new Map();
  const getCachedElementFromXPath = (value) => {
    if (typeof value !== "string" || !value) {
      return null;
    }
    if (xpathElementCache.has(value)) {
      return xpathElementCache.get(value);
    }
    const resolved = getElementFromXPath(value);
    xpathElementCache.set(value, resolved);
    return resolved;
  };
  const includeIndex = includeXpaths.indexOf(xpath);
  if (includeIndex >= 0) {
    includeXpaths.splice(includeIndex, 1);
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item && item.xpath === xpath && !item.excluded) {
        items.splice(i, 1);
      }
    }
    entry.includeXpaths = includeXpaths;
    entry.xpaths = items;
    touchPageEntryTimestamp(entry);
    normalizePageEntryXpaths(entry);
    setPageMarkingEntry(config.pageMarkings, location.href, entry);
    state.config = config;
    completeExplicitToggle(entry, target, "exclude", mutationStartedAt, options);
    return;
  }
  const cleanupHierarchy = (currentXPath) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!item || !item.xpath || item.xpath === currentXPath) {
        continue;
      }
      const existingEl = getCachedElementFromXPath(item.xpath);
      if (
        (existingEl && target.contains(existingEl)) ||
        (!existingEl && isXPathDescendant(currentXPath, item.xpath))
      ) {
        items.splice(i, 1);
      }
    }
  };
  const cleanupDescendantIncludeOverrides = (currentXPath, currentTarget = null) => {
    const boundaryTarget = currentTarget && currentTarget.nodeType === 1
      ? currentTarget
      : getCachedElementFromXPath(currentXPath);
    for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
      const includeXPath = includeXpaths[i];
      if (!includeXPath || includeXPath === currentXPath) {
        continue;
      }
      const includeEl = getCachedElementFromXPath(includeXPath);
      if (
        (boundaryTarget && includeEl && boundaryTarget.contains(includeEl)) ||
        (!includeEl && isXPathDescendant(currentXPath, includeXPath))
      ) {
        includeXpaths.splice(i, 1);
      }
    }
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!item || !item.xpath || item.excluded || item.xpath === currentXPath) {
        continue;
      }
      const itemEl = getCachedElementFromXPath(item.xpath);
      if (
        (boundaryTarget && itemEl && boundaryTarget.contains(itemEl)) ||
        (!itemEl && isXPathDescendant(currentXPath, item.xpath))
      ) {
        items.splice(i, 1);
      }
    }
  };
  const cleanupAncestorHierarchy = (currentXPath) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!item || !item.xpath || item.xpath === currentXPath || !item.excluded) {
        continue;
      }
      const existingEl = getCachedElementFromXPath(item.xpath);
      if (
        (existingEl && existingEl.contains(target)) ||
        (!existingEl && isXPathDescendant(item.xpath, currentXPath))
      ) {
        cleanupDescendantIncludeOverrides(item.xpath, existingEl);
        if (existingEl && matchesToggleableDefaultExcluded(existingEl)) {
          item.excluded = false;
          delete item.explicit;
        } else {
          items.splice(i, 1);
        }
      }
    }
  };
  const cleanupIncludeHierarchy = (currentXPath) => {
    for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
      const includeXPath = includeXpaths[i];
      if (!includeXPath) {
        continue;
      }
      const includeEl = getCachedElementFromXPath(includeXPath);
      if (
        includeXPath === currentXPath ||
        (includeEl && (includeEl.contains(target) || target.contains(includeEl))) ||
        (!includeEl && (
          isXPathDescendant(includeXPath, currentXPath) ||
          isXPathDescendant(currentXPath, includeXPath)
        ))
      ) {
        includeXpaths.splice(i, 1);
      }
    }
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!item || !item.xpath || item.excluded) {
        continue;
      }
      const itemEl = getCachedElementFromXPath(item.xpath);
      if (
        item.xpath === currentXPath ||
        (itemEl && (itemEl.contains(target) || target.contains(itemEl))) ||
        (!itemEl && (
          isXPathDescendant(item.xpath, currentXPath) ||
          isXPathDescendant(currentXPath, item.xpath)
        ))
      ) {
        items.splice(i, 1);
      }
    }
  };

  let addedExclude;
  let targetItem = items.find((item) => item && item.xpath === xpath);
  if (!targetItem) {
    targetItem = { xpath, excluded: true, explicit: true };
    items.push(targetItem);
    addedExclude = true;
  } else {
    targetItem.excluded = !targetItem.excluded;
    addedExclude = targetItem.excluded;
    if (addedExclude) {
      targetItem.explicit = true;
    } else {
      delete targetItem.explicit;
    }
  }
  if (addedExclude) {
    cleanupHierarchy(xpath);
    cleanupAncestorHierarchy(xpath);
    cleanupIncludeHierarchy(xpath);
    if (Array.isArray(entry.includeXpaths)) {
      entry.includeXpaths = entry.includeXpaths.filter((value) => value !== xpath);
    }
  } else if (targetItem && !targetItem.excluded) {
    cleanupDescendantIncludeOverrides(xpath, target);
  }

  entry.xpaths = items;
  touchPageEntryTimestamp(entry);
  normalizePageEntryXpaths(entry);
  setPageMarkingEntry(config.pageMarkings, location.href, entry);
  state.config = config;
  completeExplicitToggle(entry, target, "exclude", mutationStartedAt, options);
}

function toggleExplicitInclude(target, options = {}) {
  if (!state.baseUrl || !state.config) {
    return;
  }
  if (isPageSaveReconciliationPending(location.href)) {
    updateMarkingTemporarilyDisabledUi();
    showToast(ContentText.marking.saveReconciliationBlocked);
    return;
  }
  if (matchesImmutableExcluded(target)) {
    showToast(ContentText.marking.immutableOverrideBlocked);
    return;
  }

  const xpath = getXPath(target);
  if (!xpath) {
    return;
  }

  const mutationStartedAt = nowMs();
  const config = state.config;
  const entry = getPageMarkingEntry(config, location.href);
  const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
  const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const xpathElementCache = new Map();
  const getCachedElementFromXPath = (value) => {
    if (typeof value !== "string" || !value) {
      return null;
    }
    if (xpathElementCache.has(value)) {
      return xpathElementCache.get(value);
    }
    const resolved = getElementFromXPath(value);
    xpathElementCache.set(value, resolved);
    return resolved;
  };
  const targetItemIndex = items.findIndex((item) => item && item.xpath === xpath);
  const targetItem = targetItemIndex >= 0 ? items[targetItemIndex] : null;
  let convertedFromExcluded = false;
  if (targetItem && targetItem.excluded) {
    if (!canApplyExplicitInclude(target, state.config, location.href, entry)) {
      // If the target is no longer include-eligible, Alt acts as an unmark for the exclusion.
      targetItem.excluded = false;
      delete targetItem.explicit;
      for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
        if (includeXpaths[i] === xpath) {
          includeXpaths.splice(i, 1);
        }
      }
      entry.includeXpaths = includeXpaths;
      entry.xpaths = items;
      touchPageEntryTimestamp(entry);
      normalizePageEntryXpaths(entry);
      setPageMarkingEntry(config.pageMarkings, location.href, entry);
      state.config = config;
      completeExplicitToggle(entry, target, "include", mutationStartedAt, options);
      return;
    }
    if (matchesToggleableDefaultExcluded(target)) {
      targetItem.excluded = false;
      delete targetItem.explicit;
    } else {
      items.splice(targetItemIndex, 1);
    }
    convertedFromExcluded = true;
  }
  const existingIndex = includeXpaths.indexOf(xpath);
  if (existingIndex >= 0 && !convertedFromExcluded) {
    includeXpaths.splice(existingIndex, 1);
  } else {
    if (!canApplyExplicitInclude(target, state.config, location.href, entry)) {
      showToast(ContentText.marking.explicitIncludeBlocked);
      return;
    }
    includeXpaths.push(xpath);
    const cleanupDescendants = () => {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (!item || !item.xpath || item.xpath === xpath) {
          continue;
        }
        const existingEl = getCachedElementFromXPath(item.xpath);
        if (existingEl ? target.contains(existingEl) : isXPathDescendant(xpath, item.xpath)) {
          items.splice(i, 1);
        }
      }
      for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
        const childXpath = includeXpaths[i];
        if (!childXpath || childXpath === xpath) {
          continue;
        }
        const existingEl = getCachedElementFromXPath(childXpath);
        if (existingEl ? target.contains(existingEl) : isXPathDescendant(xpath, childXpath)) {
          includeXpaths.splice(i, 1);
        }
      }
    };
    cleanupDescendants();
  }

  entry.includeXpaths = includeXpaths;
  entry.xpaths = items;
  touchPageEntryTimestamp(entry);
  normalizePageEntryXpaths(entry);
  setPageMarkingEntry(config.pageMarkings, location.href, entry);
  state.config = config;
  completeExplicitToggle(entry, target, "include", mutationStartedAt, options);
}

function handleToggleEvent(event) {
  if (!state.enabled || state.altPassThrough) {
    return;
  }
  const toggleStartedAt = nowMs();
  syncModifierState(event);
  const mode = getMarkModeFromEvent(event);
  event.preventDefault();
  event.stopPropagation();
  if (isPageSaveReconciliationPending(location.href)) {
    updateMarkingTemporarilyDisabledUi();
    showToast(ContentText.marking.saveReconciliationBlocked);
    clearLayer(state.layers["hover"]);
    return;
  }
  if (state.focusElement) {
    const rawTarget = getTargetElement(event.clientX, event.clientY);
    if (!rawTarget || !state.focusElement.contains(rawTarget)) {
      clearFocusHighlight();
    }
  }
  const allowParent = shouldAllowParentMarking(mode, event.shiftKey);
  const allowExcludedParentChildren = mode === "include";
  const allowImmutableChildren = false;
  const explicitParentSet = getExcludedXPathSet(state.config, location.href);
  const excludedSet =
    allowParent || allowExcludedParentChildren ? null : explicitParentSet;
  const includeSet = getIncludeXPathSet(state.config, location.href);
  const silentWhitespaceExcludedSet = getSilentWhitespaceExcludedXPathSet(state.config, location.href);
  const targetResolutionStartedAt = nowMs();
  const target = getMarkableTarget(event.clientX, event.clientY, {
    allowParent,
    allowExplicitTarget: true,
    preferExplicitTarget: mode === "include",
    preferMixedTextAncestor: mode === "include" && !allowParent,
    excludedSet,
    includeSet,
    silentWhitespaceExcludedSet,
    explicitParentSet,
    allowExcludedParentChildren,
    allowImmutableChildren,
    requireExcludedAncestor: false
  });
  logTogglePerf("toggle.target-resolution", targetResolutionStartedAt, {
    mode,
    hasTarget: Boolean(target)
  });
  if (target) {
    const xpath = getXPath(target);
    const interactionNow = nowMs();
    const toggleActionKey = xpath ? `${mode}:${xpath}` : "";
    if (shouldIgnoreDuplicateUserToggle({
      targetXpath: xpath,
      mode,
      now: interactionNow,
      inFlightKey: state.toggleInFlightKey || state.toggleQueuedActionKey,
      lastActionKey: state.lastToggleActionKey,
      lastActionAt: state.lastToggleActionAt
    })) {
      logTogglePerf("toggle.duplicate-click-suppressed", toggleStartedAt, { mode });
      return;
    }
    showImmediateToggleAcknowledgement(target, mode);
    scheduleQueuedToggleMutation({
      target,
      mode,
      key: toggleActionKey,
      interactionNow
    });
  }
  logTogglePerf("toggle.total", toggleStartedAt, {
    mode,
    hadTarget: Boolean(target)
  });
}

function handleClick(event) {
  handleToggleEvent(event);
}

function handleContextMenu(event) {
  handleToggleEvent(event);
}

function handleKeydown(event) {
  if (!state.enabled) {
    return;
  }
  if (isMarkingTemporarilyDisabled()) {
    updateMarkingTemporarilyDisabledUi();
    return;
  }
  if (isPageInteractionKeyEvent(event)) {
    if (isEditableKeyEventTarget(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!state.altPassThrough) {
      setAltPassThrough(true);
      showToast(ContentText.marking.pageInteractionMode);
    }
    return;
  }
  if (event.key !== "Alt" && event.key !== "Shift") {
    return;
  }
  syncModifierState(event);
}

function handleKeyup(event) {
  if (!state.enabled) {
    return;
  }
  if (isPageInteractionKeyEvent(event) || state.altPassThrough && event.code === PAGE_INTERACTION_KEY_CODE) {
    if (!isEditableKeyEventTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (state.altPassThrough) {
      setAltPassThrough(false);
      refreshHoverHighlight();
    }
    return;
  }
  if (event.key !== "Alt" && event.key !== "Shift") {
    return;
  }
  syncModifierState(event);
}

function handleAltClick(event) {
  if (!state.enabled || !state.altPassThrough) {
    return;
  }
  if (state.aiPopover) {
    return;
  }
  if (!event.altKey) {
    return;
  }
  const target = event.target;
  if (!target || !target.closest) {
    return;
  }
  const link = target.closest("a[href]");
  if (!link) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const href = link.href;
  if (!href) {
    return;
  }
  const openInNewTab =
      link.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey;
  if (openInNewTab) {
    window.open(href, link.target || "_blank");
  } else {
    window.location.assign(href);
  }
}

function clearLayer(layer) {
  if (!layer) {
    return;
  }
  while (layer.firstChild) {
    layer.removeChild(layer.firstChild);
  }
  if (state.layerBoxes) {
    const boxMap = state.layerBoxes.get(layer);
    if (boxMap) {
      boxMap.clear();
    }
  }
}

function getLayerBoxMap(layer) {
  if (!state.layerBoxes) {
    state.layerBoxes = new WeakMap();
  }
  let map = state.layerBoxes.get(layer);
  if (!map) {
    map = new Map();
    state.layerBoxes.set(layer, map);
  }
  return map;
}

function beginLayerRender(layer) {
  return { layer, map: getLayerBoxMap(layer), used: new Set() };
}

function finalizeLayerRender(layerState) {
  const { map, used } = layerState;
  for (const [key, box] of map) {
    if (!used.has(key)) {
      box.remove();
      map.delete(key);
    }
  }
}

function drawRectReuse(layerState, rect, className, el, kind, markedSet, index) {
  const { layer, map, used } = layerState;
  const markId = el ? getMarkId(el) : "";
  const key = `${markId || "anon"}|${className}|${kind || ""}|${index}`;
  let box = map.get(key);
  if (!box) {
    box = document.createElement("div");
    box.className = `uf-rect ${className}`;
    map.set(key, box);
    layer.appendChild(box);
  } else if (box.className !== `uf-rect ${className}`) {
    box.className = `uf-rect ${className}`;
  }
  box.style.top = `${rect.top}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  if (el) {
    if (markId) {
      box.dataset.mcMarkId = markId;
      if (kind) {
        box.dataset.mcMarkKind = kind;
      }
      if (markedSet) {
        markedSet.add(el);
      }
    }
  }
  used.add(key);
}

function drawMultiRectReuse(layerState, rects, className, el, kind, markedSet) {
  if (rects.length === 0) {
    return;
  }
  // Add element to marked set once (not per rectangle)
  if (el && markedSet) {
    markedSet.add(el);
  }
  for (let i = 0; i < rects.length; i += 1) {
    drawRectReuse(layerState, rects[i], className, el, kind, null, i);
  }
}

function collectRectsFromClientRects(clientRects) {
  const visibleRects = [];
  for (let i = 0; i < clientRects.length; i++) {
    const rect = clientRects[i];
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
    ) {
      continue;
    }
    visibleRects.push({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom
    });
  }
  return visibleRects;
}

function getCollapsedTextualFallbackRects(el) {
  if (!getCachedNormalizedElementText(el)) {
    return [];
  }
  const stack = Array.from(el.children || []);
  let inspected = 0;
  const MAX_INSPECTED = 200;
  while (stack.length && inspected < MAX_INSPECTED) {
    const node = stack.shift();
    inspected += 1;
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (!isVisible(node)) {
      continue;
    }
    const rects = collectRectsFromClientRects(node.getClientRects());
    if (rects.length > 0) {
      return rects;
    }
    for (let i = 0; i < node.children.length; i += 1) {
      stack.push(node.children[i]);
    }
  }
  return [];
}

function getVisibleRects(el) {
  const allowCollapsedTextFallback = Boolean(getCachedNormalizedElementText(el));
  if (!isVisible(el)) {
    return allowCollapsedTextFallback
      ? filterPaintReachableRects(el, getCollapsedTextualFallbackRects(el))
      : [];
  }
  const visibleRects = collectRectsFromClientRects(el.getClientRects());
  if (visibleRects.length > 0) {
    return filterPaintReachableRects(el, visibleRects);
  }
  if (allowCollapsedTextFallback) {
    return filterPaintReachableRects(el, getCollapsedTextualFallbackRects(el));
  }
  return [];
}

function hasRenderableMarkingTargetGeometry(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (getVisibleRects(el).length > 0) {
    return true;
  }
  return Boolean(options.allowGhost && getGhostRects(el).length > 0);
}

export function collectExplicitMarkingElements(entry) {
  const items = Array.isArray(entry && entry.xpaths) ? entry.xpaths : [];
  const explicitInclude = collectXPathElements(entry && entry.includeXpaths);
  const consentExcluded = collectConsentExcludedElements();
  const explicitIncludeSet = new Set(explicitInclude);
  const isWithinExplicitInclude = (el) => {
    for (const includeEl of explicitIncludeSet) {
      if (includeEl && includeEl !== el && includeEl.contains(el)) {
        return true;
      }
    }
    return false;
  };
  const explicitExcludeElements = [];
  const hiddenExplicitExcludeElements = [];
  for (const item of items) {
    if (!item || !item.xpath || !item.excluded) {
      continue;
    }
    const el = getElementFromXPath(item.xpath);
    if (!el) {
      continue;
    }
    if (isSilentWhitespaceExplicitExclusion(entry, item, el)) {
      continue;
    }
    const isOrdinaryExcludeRow =
      item.explicit === true || matchesToggleableDefaultExcluded(el);
    if (!isOrdinaryExcludeRow) {
      continue;
    }
    if (
      consentExcluded.has(el) ||
      isWithinElementSet(el, consentExcluded) ||
      isWithinExplicitInclude(el) ||
      isWithinImmutableExcluded(el)
    ) {
      continue;
    }
    if (!isVisible(el) && isDefinitelyHiddenSubtreeElement(el)) {
      hiddenExplicitExcludeElements.push(el);
      continue;
    }
    explicitExcludeElements.push(el);
  }
  const localExplicitExcludeSet = new Set([
    ...explicitExcludeElements,
    ...hiddenExplicitExcludeElements
  ]);
  const explicitIncludeElements = [];
  const hiddenExplicitIncludeElements = [];
  for (const el of explicitInclude) {
    if (
      isWithinImmutableExcluded(el) ||
      consentExcluded.has(el) ||
      isWithinElementSet(el, consentExcluded) ||
      localExplicitExcludeSet.has(el)
    ) {
      continue;
    }
    if (!isVisible(el) && isDefinitelyHiddenSubtreeElement(el)) {
      hiddenExplicitIncludeElements.push(el);
      continue;
    }
    explicitIncludeElements.push(el);
  }
  return {
    explicitExcludeElements,
    hiddenExplicitExcludeElements,
    hiddenExplicitIncludeElements,
    explicitIncludeElements
  };
}

function collectEntryExplicitXpathSets(entry) {
  const excludedXpaths = new Set(
    collectExcludedXPaths(Array.isArray(entry && entry.xpaths) ? entry.xpaths : [])
  );
  const includeXpaths = new Set(
    Array.isArray(entry && entry.includeXpaths)
      ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
      : []
  );
  return {
    excludedXpaths,
    includeXpaths
  };
}

function splitExplicitMarkingCollectionsBySavedState(currentCollections, savedEntry) {
  const savedSets = collectEntryExplicitXpathSets(savedEntry);
  const splitByXpath = (items, savedXpathSet) => {
    const fetched = [];
    const session = [];
    for (const el of Array.isArray(items) ? items : []) {
      const xpath = getXPath(el);
      if (xpath && savedXpathSet.has(xpath)) {
        fetched.push(el);
      } else {
        session.push(el);
      }
    }
    return { fetched, session };
  };

  const excludeSplit = splitByXpath(
    currentCollections && currentCollections.explicitExcludeElements,
    savedSets.excludedXpaths
  );
  const includeSplit = splitByXpath(
    currentCollections && currentCollections.explicitIncludeElements,
    savedSets.includeXpaths
  );
  const hiddenIncludeSplit = splitByXpath(
    currentCollections && currentCollections.hiddenExplicitIncludeElements,
    savedSets.includeXpaths
  );

  return {
    fetchedExplicitExcludeElements: excludeSplit.fetched,
    sessionExplicitExcludeElements: excludeSplit.session,
    fetchedExplicitIncludeElements: includeSplit.fetched,
    sessionExplicitIncludeElements: includeSplit.session,
    hiddenFetchedExplicitIncludeElements: hiddenIncludeSplit.fetched,
    hiddenSessionExplicitIncludeElements: hiddenIncludeSplit.session
  };
}

export function collectAiContentElementsForRender(aiCollections, options = {}) {
  const immutableExcluded = options.immutableExcluded || new Set();
  const consentExcluded = options.consentExcluded || new Set();
  const excludedByState = options.excludedByState || new Set();
  const explicitInclude = options.explicitInclude || new Set();
  const aiContent = new Set();
  const hiddenAiContent = new Set();
  const selectorExcludedSet = new Set();
  const isWithinExplicitInclude = (el) => {
    if (!el || explicitInclude.size === 0) {
      return false;
    }
    for (const includeEl of explicitInclude) {
      if (includeEl && includeEl !== el && includeEl.contains(el)) {
        return true;
      }
    }
    return false;
  };
  const shouldSkipAiCollectionElement = (
    el,
    { skipExplicitExcludedUnlessIncluded = false } = {}
  ) => {
    if (!el || el.nodeType !== 1) {
      return true;
    }
    if (isWithinElementSet(el, immutableExcluded) || isWithinElementSet(el, consentExcluded)) {
      return true;
    }
    if (
      skipExplicitExcludedUnlessIncluded &&
      isWithinElementSet(el, excludedByState) &&
      !isWithinExplicitInclude(el)
    ) {
      return true;
    }
    return false;
  };
  const addAiContentElement = (el) => {
    if (shouldSkipAiCollectionElement(el, { skipExplicitExcludedUnlessIncluded: true })) {
      return;
    }
    if (!isVisible(el) && isDefinitelyHiddenSubtreeElement(el)) {
      hiddenAiContent.add(el);
      return;
    }
    aiContent.add(el);
  };

  for (const el of aiCollections?.included || []) {
    addAiContentElement(el);
  }
  for (const el of aiCollections?.excluded || []) {
    if (shouldSkipAiCollectionElement(el)) {
      continue;
    }
    if (explicitInclude.has(el) || isWithinElementSet(el, explicitInclude)) {
      continue;
    }
    selectorExcludedSet.add(el);
  }
  for (const el of explicitInclude) {
    addAiContentElement(el);
  }

  return {
    aiContentElements: Array.from(aiContent),
    hiddenAiContentElements: Array.from(hiddenAiContent),
    selectorExcludedElements: Array.from(selectorExcludedSet)
  };
}

export function collectStoredUnexcludedToggleableDefaultElements(entry) {
  const items = Array.isArray(entry && entry.xpaths) ? entry.xpaths : [];
  const elements = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || !item.xpath || item.excluded) {
      continue;
    }
    const el = getElementFromXPath(item.xpath);
    if (!el || seen.has(el)) {
      continue;
    }
    if (!matchesToggleableDefaultExcluded(el)) {
      continue;
    }
    if (isWithinConsentElement(el) || isWithinImmutableExcluded(el)) {
      continue;
    }
    seen.add(el);
    elements.push(el);
  }
  return elements;
}

function drawExplicitMarkingLayers(
  fetchedExplicitExcludeElements,
  fetchedExplicitIncludeElements,
  hiddenFetchedExplicitIncludeElements,
  sessionExplicitExcludeElements,
  sessionExplicitIncludeElements,
  hiddenSessionExplicitIncludeElements,
  computeElementRects
) {
  const drawStartedAt = nowMs();
  const layerSavedExplicitExcludeState = beginLayerRender(state.layers["saved-explicit-exclude"]);
  const layerSavedExplicitIncludeState = beginLayerRender(state.layers["saved-explicit-include"]);
  const layerSessionExplicitExcludeState = beginLayerRender(state.layers["session-explicit-exclude"]);
  const layerSessionExplicitIncludeState = beginLayerRender(state.layers["session-explicit-include"]);

  for (const el of fetchedExplicitExcludeElements) {
    const rects = computeElementRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "exclude" });
      drawMultiRectReuse(
        layerSavedExplicitExcludeState,
        rects,
        presentation.className,
        el,
        "saved-explicit-exclude",
        null
      );
    }
  }

  for (const el of fetchedExplicitIncludeElements) {
    const rects = computeElementRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include" });
      drawMultiRectReuse(
        layerSavedExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "saved-explicit-include",
        null
      );
    }
  }

  for (const el of hiddenFetchedExplicitIncludeElements || []) {
    const rects = getGhostRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include", ghost: true });
      drawMultiRectReuse(
        layerSavedExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "saved-explicit-include-ghost",
        null
      );
    }
  }

  for (const el of sessionExplicitExcludeElements) {
    const rects = computeElementRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "exclude" });
      drawMultiRectReuse(
        layerSessionExplicitExcludeState,
        rects,
        presentation.className,
        el,
        "session-explicit-exclude",
        null
      );
    }
  }

  for (const el of sessionExplicitIncludeElements) {
    const rects = computeElementRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include" });
      drawMultiRectReuse(
        layerSessionExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "session-explicit-include",
        null
      );
    }
  }

  for (const el of hiddenSessionExplicitIncludeElements || []) {
    const rects = getGhostRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include", ghost: true });
      drawMultiRectReuse(
        layerSessionExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "session-explicit-include-ghost",
        null
      );
    }
  }

  finalizeLayerRender(layerSavedExplicitExcludeState);
  finalizeLayerRender(layerSavedExplicitIncludeState);
  finalizeLayerRender(layerSessionExplicitExcludeState);
  finalizeLayerRender(layerSessionExplicitIncludeState);
  logTogglePerf("draw.explicit-layers", drawStartedAt, {
    savedExcludeCount: fetchedExplicitExcludeElements.length,
    savedIncludeCount: fetchedExplicitIncludeElements.length + (hiddenFetchedExplicitIncludeElements || []).length,
    sessionExcludeCount: sessionExplicitExcludeElements.length,
    sessionIncludeCount: sessionExplicitIncludeElements.length + (hiddenSessionExplicitIncludeElements || []).length
  });
}

function shouldUseImmediateFullRenderForExplicitToggle(options = {}) {
  // Keep toggles responsive: explicit layers update immediately, while the
  // heavier invalidating rebuild is deferred and coalesced.
  return false;
}

function applyExplicitStateToCachedCollections(
  cachedCollections,
  explicitExcludeElements,
  explicitIncludeElements
) {
  if (!cachedCollections) {
    return;
  }
  const explicitExcludeSet = new Set(explicitExcludeElements || []);
  if (explicitExcludeSet.size === 0) {
    return;
  }
  const explicitIncludeSet = new Set(explicitIncludeElements || []);
  const isProtectedByExplicitInclude = (el) =>
    explicitIncludeSet.size > 0 && isWithinElementSet(el, explicitIncludeSet);
  const isSuppressedByExplicitExclude = (el) =>
    isWithinElementSet(el, explicitExcludeSet) && !isProtectedByExplicitInclude(el);
  const filterSuppressed = (items) =>
    Array.isArray(items) ? items.filter((el) => !isSuppressedByExplicitExclude(el)) : [];

  cachedCollections.defaultElements = filterSuppressed(cachedCollections.defaultElements);
  cachedCollections.aiContentElements = filterSuppressed(cachedCollections.aiContentElements);
  cachedCollections.hiddenAiContentElements = filterSuppressed(cachedCollections.hiddenAiContentElements);
  cachedCollections.selectorExcludedElements = filterSuppressed(cachedCollections.selectorExcludedElements);
}

function refreshExplicitMarkingOverlay(entry, context = null) {
  if (!state.enabled || !state.overlay) {
    return;
  }
  withElementComputationCache(() => {
    const refreshStartedAt = nowMs();
    const pageUrl = location.href;
    const immutableExcluded = collectImmutableElements();
    let syncedEntry = entry;
    if (state.config && pageUrl && hasPageMarkingEntry(state.config, pageUrl)) {
      const syncResult = syncPageMarkings(state.config, pageUrl, immutableExcluded, {
        allowCreate: true,
        persist: true
      });
      syncedEntry = syncResult.entry || syncedEntry;
      state.currentPageEntry = syncedEntry || null;
    }
    const {
      explicitExcludeElements,
      hiddenExplicitExcludeElements,
      explicitIncludeElements,
      hiddenExplicitIncludeElements
    } = collectExplicitMarkingElements(syncedEntry);
    const explicitLayerSplit = splitExplicitMarkingCollectionsBySavedState(
      {
        explicitExcludeElements,
        hiddenExplicitExcludeElements,
        explicitIncludeElements,
        hiddenExplicitIncludeElements
      },
      getSavedPageEntry(pageUrl)
    );
    const cachedCollections = state.cachedCollections;
    if (cachedCollections) {
      const selectorContext = resolveMarkingSelectorContext(state.config, syncedEntry);
      const consentExcluded = collectConsentExcludedElements();
      const aiContentSet = new Set(cachedCollections.aiContentElements || []);
      const hiddenAiContentSet = new Set(cachedCollections.hiddenAiContentElements || []);
      const hiddenStoredExplicitExclude = new Set(hiddenExplicitExcludeElements || []);
      cachedCollections.explicitExcludeElements = explicitExcludeElements;
      cachedCollections.explicitIncludeElements = explicitIncludeElements;
      cachedCollections.hiddenExplicitIncludeElements = hiddenExplicitIncludeElements;
      cachedCollections.fetchedExplicitExcludeElements = explicitLayerSplit.fetchedExplicitExcludeElements;
      cachedCollections.fetchedExplicitIncludeElements = explicitLayerSplit.fetchedExplicitIncludeElements;
      cachedCollections.hiddenFetchedExplicitIncludeElements = explicitLayerSplit.hiddenFetchedExplicitIncludeElements;
      cachedCollections.sessionExplicitExcludeElements = explicitLayerSplit.sessionExplicitExcludeElements;
      cachedCollections.sessionExplicitIncludeElements = explicitLayerSplit.sessionExplicitIncludeElements;
      cachedCollections.hiddenSessionExplicitIncludeElements = explicitLayerSplit.hiddenSessionExplicitIncludeElements;
      if (context && context.immediateFullRender === false) {
        applyExplicitStateToCachedCollections(
          cachedCollections,
          explicitLayerSplit.sessionExplicitExcludeElements,
          explicitLayerSplit.sessionExplicitIncludeElements
        );
      }
      cachedCollections.hardElements = Array.from(new Set([
        ...immutableExcluded,
        ...hiddenStoredExplicitExclude
      ])).filter((el) =>
        !isWithinElementSet(el, consentExcluded)
      );
      cachedCollections.aiAnimatedExplicitIncludeElements =
        explicitLayerSplit.sessionExplicitIncludeElements.filter((el) => aiContentSet.has(el));
      cachedCollections.hiddenAiAnimatedExplicitIncludeElements =
        explicitLayerSplit.hiddenSessionExplicitIncludeElements.filter((el) => hiddenAiContentSet.has(el));
      state.cachedCollectionsKey = buildMarkingCollectionsCacheKey({
        pageUrl,
        selectorSet: selectorContext.selectorSet,
        entry: syncedEntry
      });
    }
    drawExplicitMarkingLayers(
      explicitLayerSplit.fetchedExplicitExcludeElements,
      explicitLayerSplit.fetchedExplicitIncludeElements,
      explicitLayerSplit.hiddenFetchedExplicitIncludeElements,
      explicitLayerSplit.sessionExplicitExcludeElements,
      explicitLayerSplit.sessionExplicitIncludeElements,
      explicitLayerSplit.hiddenSessionExplicitIncludeElements,
      getVisibleRects
    );
    logTogglePerf("toggle.explicit-overlay-refresh", refreshStartedAt);
  });
}

async function refreshExplicitMarkingOverlayAsync(entry, context = null) {
  if (!state.enabled || !state.overlay) {
    return { ok: false, aborted: false };
  }
  return withElementComputationCacheAsync(async () => {
    const refreshStartedAt = nowMs();
    const pageUrl = location.href;
    const immutableExcluded = collectImmutableElements();
    let syncedEntry = entry;
    if (state.config && pageUrl && hasPageMarkingEntry(state.config, pageUrl)) {
      const syncResult = await syncPageMarkingsAsync(state.config, pageUrl, immutableExcluded, {
        allowCreate: true,
        persist: true,
        shouldAbort: context && typeof context.shouldAbort === "function"
          ? context.shouldAbort
          : null
      });
      if (syncResult && syncResult.aborted) {
        return { ok: false, aborted: true };
      }
      syncedEntry = syncResult.entry || syncedEntry;
      state.currentPageEntry = syncedEntry || null;
    }
    if (context && typeof context.shouldAbort === "function" && context.shouldAbort()) {
      return { ok: false, aborted: true };
    }
    const {
      explicitExcludeElements,
      hiddenExplicitExcludeElements,
      explicitIncludeElements,
      hiddenExplicitIncludeElements
    } = collectExplicitMarkingElements(syncedEntry);
    const explicitLayerSplit = splitExplicitMarkingCollectionsBySavedState(
      {
        explicitExcludeElements,
        hiddenExplicitExcludeElements,
        explicitIncludeElements,
        hiddenExplicitIncludeElements
      },
      getSavedPageEntry(pageUrl)
    );
    const cachedCollections = state.cachedCollections;
    if (cachedCollections) {
      const selectorContext = resolveMarkingSelectorContext(state.config, syncedEntry);
      const consentExcluded = collectConsentExcludedElements();
      const aiContentSet = new Set(cachedCollections.aiContentElements || []);
      const hiddenAiContentSet = new Set(cachedCollections.hiddenAiContentElements || []);
      const hiddenStoredExplicitExclude = new Set(hiddenExplicitExcludeElements || []);
      cachedCollections.explicitExcludeElements = explicitExcludeElements;
      cachedCollections.explicitIncludeElements = explicitIncludeElements;
      cachedCollections.hiddenExplicitIncludeElements = hiddenExplicitIncludeElements;
      cachedCollections.fetchedExplicitExcludeElements = explicitLayerSplit.fetchedExplicitExcludeElements;
      cachedCollections.fetchedExplicitIncludeElements = explicitLayerSplit.fetchedExplicitIncludeElements;
      cachedCollections.hiddenFetchedExplicitIncludeElements = explicitLayerSplit.hiddenFetchedExplicitIncludeElements;
      cachedCollections.sessionExplicitExcludeElements = explicitLayerSplit.sessionExplicitExcludeElements;
      cachedCollections.sessionExplicitIncludeElements = explicitLayerSplit.sessionExplicitIncludeElements;
      cachedCollections.hiddenSessionExplicitIncludeElements = explicitLayerSplit.hiddenSessionExplicitIncludeElements;
      if (context && context.immediateFullRender === false) {
        applyExplicitStateToCachedCollections(
          cachedCollections,
          explicitLayerSplit.sessionExplicitExcludeElements,
          explicitLayerSplit.sessionExplicitIncludeElements
        );
      }
      cachedCollections.hardElements = Array.from(new Set([
        ...immutableExcluded,
        ...hiddenStoredExplicitExclude
      ])).filter((el) =>
        !isWithinElementSet(el, consentExcluded)
      );
      cachedCollections.aiAnimatedExplicitIncludeElements =
        explicitLayerSplit.sessionExplicitIncludeElements.filter((el) => aiContentSet.has(el));
      cachedCollections.hiddenAiAnimatedExplicitIncludeElements =
        explicitLayerSplit.hiddenSessionExplicitIncludeElements.filter((el) => hiddenAiContentSet.has(el));
      state.cachedCollectionsKey = buildMarkingCollectionsCacheKey({
        pageUrl,
        selectorSet: selectorContext.selectorSet,
        entry: syncedEntry
      });
    }
    drawExplicitMarkingLayers(
      explicitLayerSplit.fetchedExplicitExcludeElements,
      explicitLayerSplit.fetchedExplicitIncludeElements,
      explicitLayerSplit.hiddenFetchedExplicitIncludeElements,
      explicitLayerSplit.sessionExplicitExcludeElements,
      explicitLayerSplit.sessionExplicitIncludeElements,
      explicitLayerSplit.hiddenSessionExplicitIncludeElements,
      getVisibleRects
    );
    logTogglePerf("toggle.explicit-overlay-refresh", refreshStartedAt, { async: true });
    return { ok: true, aborted: false };
  });
}

function scheduleExplicitToggleFullRender(options = {}) {
  const immediate = options.immediate !== false;
  if (immediate && state.explicitFullRenderTimer) {
    extensionClearTimeout(state.explicitFullRenderTimer);
    state.explicitFullRenderTimer = 0;
  }
  if (immediate) {
    scheduleRender(getExplicitMarkingFullRenderOptions());
    return;
  }
  if (state.explicitFullRenderTimer) {
    extensionClearTimeout(state.explicitFullRenderTimer);
    state.explicitFullRenderTimer = 0;
  }
  state.explicitFullRenderTimer = extensionSetTimeout(() => {
    state.explicitFullRenderTimer = 0;
    scheduleRender(getExplicitMarkingFullRenderOptions());
  }, EXPLICIT_TOGGLE_DEFERRED_FULL_RENDER_DELAY_MS);
}

export function scheduleExplicitOverlayRefresh(entry, context = null) {
  state.explicitOverlayRefreshEntry = entry;
  state.explicitOverlayRefreshContext = context;
  if (state.explicitOverlayRefreshScheduled) {
    return;
  }
  state.explicitOverlayRefreshScheduled = true;
  const runRefresh = () => {
    const pendingEntry = state.explicitOverlayRefreshEntry;
    const pendingContext = state.explicitOverlayRefreshContext;
    state.explicitOverlayRefreshScheduled = false;
    state.explicitOverlayRefreshHandle = 0;
    state.explicitOverlayRefreshHandleType = "";
    state.explicitOverlayRefreshEntry = null;
    state.explicitOverlayRefreshContext = null;
    if (!pendingEntry) {
      return;
    }
    const coalesceStartedAt = nowMs();
    refreshExplicitMarkingOverlay(pendingEntry, pendingContext);
    scheduleExplicitToggleFullRender({
      immediate: !pendingContext || pendingContext.immediateFullRender !== false
    });
    logTogglePerf("toggle.coalesced-refresh", coalesceStartedAt);
  };
  if (getExtensionRequestAnimationFrame()) {
    state.explicitOverlayRefreshHandle = extensionRequestAnimationFrame(runRefresh);
    state.explicitOverlayRefreshHandleType = "raf";
  } else if (getExtensionTimer("setTimeout")) {
    state.explicitOverlayRefreshHandle = extensionSetTimeout(runRefresh, 0);
    state.explicitOverlayRefreshHandleType = "timeout";
  } else {
    runRefresh();
  }
}

function cancelExplicitOverlayRefresh() {
  if (!state.explicitOverlayRefreshScheduled) {
    return;
  }
  const handle = state.explicitOverlayRefreshHandle;
  const type = state.explicitOverlayRefreshHandleType;
  if (handle) {
    if (type === "raf") {
      extensionCancelAnimationFrame(handle);
    } else if (type === "timeout") {
      extensionClearTimeout(handle);
    }
  }
  state.explicitOverlayRefreshScheduled = false;
  state.explicitOverlayRefreshHandle = 0;
  state.explicitOverlayRefreshHandleType = "";
  state.explicitOverlayRefreshEntry = null;
  state.explicitOverlayRefreshContext = null;
}

function scheduleAsyncExplicitToggleReconcile(entry, context = null) {
  const generation = state.toggleReconcileGeneration + 1;
  state.toggleReconcileGeneration = generation;
  const runReconcile = async () => {
    const result = await refreshExplicitMarkingOverlayAsync(entry, {
      ...(context || {}),
      shouldAbort: () => generation !== state.toggleReconcileGeneration
    });
    if (!result || result.aborted || generation !== state.toggleReconcileGeneration) {
      return;
    }
    scheduleExplicitToggleFullRender({
      immediate: !context || context.immediateFullRender !== false
    });
  };
  runReconcile().catch(() => {});
}

function completeExplicitToggle(entry, target, type, mutationStartedAt, options = {}) {
  logTogglePerf("toggle.mutation", mutationStartedAt, {
    type,
    hasTarget: Boolean(target)
  });
  const immediateFullRender = Object.prototype.hasOwnProperty.call(options, "immediateFullRender")
    ? Boolean(options.immediateFullRender)
    : shouldUseImmediateFullRenderForExplicitToggle({ target, type });
  if (options && options.deferMarkingRefresh && !immediateFullRender) {
    scheduleAsyncExplicitToggleReconcile(entry, {
      target,
      type,
      immediateFullRender
    });
  } else {
    // User-driven toggles draw the explicit overlay synchronously so the mark
    // appears immediately. The async reconcile path delayed the visible mark by
    // up to ~2s on large pages (the explicit layer only drew after the chunked
    // document re-scan), which made clicks feel unregistered (issue #6).
    scheduleExplicitOverlayRefresh(entry, {
      target,
      type,
      immediateFullRender
    });
  }
  scheduleSnapshotSave(EXPLICIT_TOGGLE_SNAPSHOT_DELAY_MS);
  notifyDraftStatus(location.href);
  scheduleDraftPersist(state.baseUrl, EXPLICIT_TOGGLE_DRAFT_PERSIST_DELAY_MS);
}

function scheduleQueuedToggleMutationDrain() {
  if (state.toggleMutationHandle) {
    return;
  }
  const runDrain = () => {
    state.toggleMutationHandle = 0;
    state.toggleMutationHandleType = "";
    const nextJob = Array.isArray(state.toggleMutationQueue) && state.toggleMutationQueue.length
      ? state.toggleMutationQueue.shift()
      : null;
    if (!nextJob) {
      state.toggleQueuedActionKey = "";
      return;
    }
    const applyStartedAt = nowMs();
    state.toggleInFlightKey = nextJob.key || "";
    try {
      if (!nextJob.target || nextJob.target.nodeType !== 1 || nextJob.target.isConnected === false) {
        return;
      }
      if (nextJob.mode === "include") {
        toggleExplicitInclude(nextJob.target, { deferMarkingRefresh: true, immediateFullRender: true });
      } else {
        toggleExplicitExclude(nextJob.target, { deferMarkingRefresh: true, immediateFullRender: true });
      }
      if (state.toggleInFlightKey) {
        state.lastToggleActionKey = state.toggleInFlightKey;
        state.lastToggleActionAt = Number(nextJob.interactionNow) || nowMs();
      }
    } finally {
      state.toggleInFlightKey = "";
      logTogglePerf("toggle.apply", applyStartedAt, {
        mode: nextJob.mode,
        queued: true,
        remainingQueue: Array.isArray(state.toggleMutationQueue) ? state.toggleMutationQueue.length : 0
      });
      if (Array.isArray(state.toggleMutationQueue) && state.toggleMutationQueue.length) {
        const pendingJob = state.toggleMutationQueue[state.toggleMutationQueue.length - 1];
        state.toggleQueuedActionKey = pendingJob && pendingJob.key ? pendingJob.key : "";
        scheduleQueuedToggleMutationDrain();
      } else {
        state.toggleQueuedActionKey = "";
      }
    }
  };
  if (getExtensionRequestAnimationFrame()) {
    state.toggleMutationHandle = extensionRequestAnimationFrame(runDrain);
    state.toggleMutationHandleType = "raf";
    return;
  }
  if (getExtensionTimer("setTimeout")) {
    state.toggleMutationHandle = extensionSetTimeout(runDrain, 0);
    state.toggleMutationHandleType = "timeout";
    return;
  }
  runDrain();
}

function scheduleQueuedToggleMutation(job) {
  if (!job || !job.target || (job.mode !== "include" && job.mode !== "exclude")) {
    return;
  }
  if (!Array.isArray(state.toggleMutationQueue)) {
    state.toggleMutationQueue = [];
  }
  state.toggleMutationQueue.push(job);
  state.toggleQueuedActionKey = job.key || state.toggleQueuedActionKey;
  scheduleQueuedToggleMutationDrain();
}

function cancelQueuedToggleMutations() {
  state.toggleReconcileGeneration += 1;
  if (state.toggleMutationHandle) {
    if (state.toggleMutationHandleType === "raf") {
      extensionCancelAnimationFrame(state.toggleMutationHandle);
    } else if (state.toggleMutationHandleType === "timeout") {
      extensionClearTimeout(state.toggleMutationHandle);
    }
  }
  state.toggleMutationQueue = [];
  state.toggleMutationHandle = 0;
  state.toggleMutationHandleType = "";
  state.toggleQueuedActionKey = "";
}

function invalidateCachedCollections() {
  state.cachedCollections = null;
  state.cachedCollectionsKey = "";
}

function renderHighlights() {
  if (!state.enabled) {
    return;
  }
  if (!state.overlay) {
    createOverlay();
  }
  if (!state.overlay) {
    return;
  }
  withElementComputationCache(renderHighlightsInner);
  updateMarkingTemporarilyDisabledUi();
}

function renderHighlightsInner() {
  const renderStartedAt = nowMs();
  updateOverlayGutter();
  state.currentPageUrl = location.href;
  const pageUrl = location.href;
  const latestEntry = findPageMarkingEntry(state.config, pageUrl);
  const latestSelectorContext = resolveMarkingSelectorContext(state.config, latestEntry);
  const nextCollectionsCacheKey = buildMarkingCollectionsCacheKey({
    pageUrl,
    selectorSet: latestSelectorContext.selectorSet,
    entry: latestEntry
  });

  const cached = state.cachedCollections;
  if (cached && state.cachedCollectionsKey === nextCollectionsCacheKey) {
    const drawStartedAt = nowMs();
    repositionHighlights(cached);
    logTogglePerf("render.reposition", drawStartedAt, { pageUrl: location.href });
    return;
  }

  const rebuildStartedAt = nowMs();
  const immutableExcluded = collectImmutableElements();
  const selectorSetForSeed = latestSelectorContext.selectorSet;
  const hasAiSelectors = latestSelectorContext.hasAiSelectors;
  const existingPageEntry = findPageMarkingEntry(state.config, pageUrl);
  const hasSavedMarkingsForPage = hasExplicitUserMarkings(existingPageEntry);
  const suppressAutoSeed = state.autoSeedSuppressedPageUrl === pageUrl;
  if (suppressAutoSeed) {
    state.autoSeedSuppressedPageUrl = "";
  }
  let hasEntry = hasPageMarkingEntry(state.config, pageUrl);
  let autoSeededFromAiSelectors = false;
  if (shouldAutoSeedMarkingsFromAiSelectors({
    hasAiSelectors,
    hasSavedMarkingsForPage,
    suppressAutoSeed
  })) {
    const seeded = seedMarkingsFromAiSelectorsForUnmarkedPage(
      state.config,
      pageUrl,
      selectorSetForSeed,
      immutableExcluded
    );
    if (seeded.createdEntry) {
      hasEntry = true;
      autoSeededFromAiSelectors = true;
    }
  }
  const syncStartedAt = nowMs();
  const syncResult = syncPageMarkings(state.config, pageUrl, immutableExcluded, {
    allowCreate: hasEntry,
    persist: hasEntry
  });
  logTogglePerf("render.sync", syncStartedAt, { pageUrl });
  const entry =
      syncResult.entry || getPageMarkingEntry(state.config, pageUrl, { create: false });
  state.currentPageEntry = entry || null;
  const selectorContext = resolveMarkingSelectorContext(state.config, entry);
  const selectorSetForMarking = selectorContext.selectorSet;
  const normalizedAiSelectorSet = selectorSetForMarking;
  const hasAiSelectorsForMarking = selectorContext.hasAiSelectors;
  const selectorSuppressedXpaths = selectorContext.selectorSuppressedXpaths;
  const excludedByState = collectXPathElements(
    collectExcludedXPaths(entry.xpaths)
  );
  const explicitExclude = collectXPathElements(
    collectExplicitExcludedXPaths(entry.xpaths)
  );
  const explicitInclude = collectXPathElements(entry.includeXpaths);
  const consentExcluded = collectConsentExcludedElements();
  let aiContent = new Set();
  let hiddenAiContent = new Set();
  const selectorExcludedSet = new Set();
  const {
    explicitExcludeElements: filteredExplicitExclude,
    hiddenExplicitExcludeElements: hiddenStoredExplicitExclude,
    hiddenExplicitIncludeElements,
    explicitIncludeElements: filteredExplicitInclude
  } = collectExplicitMarkingElements(entry);
  const explicitLayerSplit = splitExplicitMarkingCollectionsBySavedState(
    {
      explicitExcludeElements: filteredExplicitExclude,
      hiddenExplicitExcludeElements: hiddenStoredExplicitExclude,
      hiddenExplicitIncludeElements,
      explicitIncludeElements: filteredExplicitInclude
    },
    getSavedPageEntry(pageUrl)
  );
  const savedEntryExplicitSets = collectEntryExplicitXpathSets(getSavedPageEntry(pageUrl));
  const aiSuppressedBySessionExcluded = new Set([
    ...explicitLayerSplit.sessionExplicitExcludeElements,
    ...hiddenStoredExplicitExclude.filter((el) => {
      const xpath = getXPath(el);
      return Boolean(xpath && savedEntryExplicitSets.excludedXpaths.has(xpath) === false);
    })
  ]);
  const sessionExplicitIncludeForAi = new Set([
    ...explicitLayerSplit.sessionExplicitIncludeElements,
    ...explicitLayerSplit.hiddenSessionExplicitIncludeElements
  ]);
  if (hasAiSelectorsForMarking) {
    const aiCollections = collectIncludedElementsFromSelectorSet(normalizedAiSelectorSet, {
      ignoreVisibilityForInclusionDetection: true,
      preserveExplicitIncludedDescendants: true,
      includeAllExplicitMatches: true,
      suppressedXpaths: selectorSuppressedXpaths
    });
    const aiRenderCollections = collectAiContentElementsForRender(aiCollections, {
      immutableExcluded,
      consentExcluded,
      excludedByState: aiSuppressedBySessionExcluded,
      explicitInclude: sessionExplicitIncludeForAi
    });
    aiContent = new Set(aiRenderCollections.aiContentElements);
    hiddenAiContent = new Set(aiRenderCollections.hiddenAiContentElements);
    for (const el of aiRenderCollections.selectorExcludedElements) {
      selectorExcludedSet.add(el);
    }
  }
  const aiAnimatedExplicitIncludeElements = hasAiSelectorsForMarking
    ? explicitLayerSplit.sessionExplicitIncludeElements.filter((el) => aiContent.has(el))
    : [];
  const hiddenAiAnimatedExplicitIncludeElements = hasAiSelectorsForMarking
    ? explicitLayerSplit.hiddenSessionExplicitIncludeElements.filter((el) => hiddenAiContent.has(el))
    : [];
  const storedUnexcludedToggleableDefaultElements =
    collectStoredUnexcludedToggleableDefaultElements(entry);

  const hardExcludedSet = new Set([
    ...immutableExcluded,
    ...hiddenStoredExplicitExclude
  ]);

  const defaultTargets = collectDefaultLayerElements(document.body, {
    immutableExcluded,
    consentExcluded,
    explicitExclude,
    explicitInclude,
    excludedByStateAncestors: excludedByState,
    aiContent,
    selectorExcluded: selectorExcludedSet,
    hiddenStoredExplicitExclude,
    unexcludedToggleableDefault: new Set(storedUnexcludedToggleableDefaultElements)
  });

  const collections = {
    hardElements: Array.from(hardExcludedSet).filter((el) =>
      !isWithinElementSet(el, consentExcluded)
    ),
    explicitExcludeElements: filteredExplicitExclude,
    explicitIncludeElements: filteredExplicitInclude,
    hiddenExplicitIncludeElements,
    fetchedExplicitExcludeElements: explicitLayerSplit.fetchedExplicitExcludeElements,
    fetchedExplicitIncludeElements: explicitLayerSplit.fetchedExplicitIncludeElements,
    hiddenFetchedExplicitIncludeElements: explicitLayerSplit.hiddenFetchedExplicitIncludeElements,
    sessionExplicitExcludeElements: explicitLayerSplit.sessionExplicitExcludeElements,
    sessionExplicitIncludeElements: explicitLayerSplit.sessionExplicitIncludeElements,
    hiddenSessionExplicitIncludeElements: explicitLayerSplit.hiddenSessionExplicitIncludeElements,
    aiAnimatedExplicitIncludeElements,
    hiddenAiAnimatedExplicitIncludeElements,
    aiContentElements: Array.from(aiContent),
    hiddenAiContentElements: Array.from(hiddenAiContent),
    selectorExcludedElements: Array.from(selectorExcludedSet),
    defaultElements: defaultTargets
  };
  state.cachedCollections = collections;
  state.cachedCollectionsKey = buildMarkingCollectionsCacheKey({
    pageUrl,
    selectorSet: selectorSetForMarking,
    entry
  });
  logTogglePerf("render.rebuild", rebuildStartedAt, { pageUrl });

  if (autoSeededFromAiSelectors) {
    state.autoSeededPendingSavePageUrl = pageUrl;
    scheduleSnapshotSave();
    notifyDraftStatus(pageUrl);
  }

  const drawStartedAt = nowMs();
  drawCollections(collections, getVisibleRects);
  logTogglePerf("draw.collections", drawStartedAt, { pageUrl });
  logTogglePerf("render.total", renderStartedAt, { pageUrl });
}

function getRectsInViewport(el) {
  const visibleRects = collectRectsFromClientRects(el.getClientRects());
  if (visibleRects.length > 0) {
    return filterPaintReachableRects(el, visibleRects);
  }
  if (getCachedNormalizedElementText(el)) {
    return filterPaintReachableRects(el, getCollapsedTextualFallbackRects(el));
  }
  return [];
}

function getGhostRects(el) {
  if (!el || el.nodeType !== 1) {
    return [];
  }
  return collectRectsFromClientRects(el.getClientRects());
}

function repositionHighlights(collections) {
  drawCollections(collections, getRectsInViewport);
}

function drawCollections(collections, getRects) {
  const layerHardState = beginLayerRender(state.layers["hard"]);
  const layerSavedExplicitExcludeState = beginLayerRender(state.layers["saved-explicit-exclude"]);
  const layerSavedExplicitIncludeState = beginLayerRender(state.layers["saved-explicit-include"]);
  const layerAiContentState = beginLayerRender(state.layers["ai-content"]);
  const layerSessionExplicitExcludeState = beginLayerRender(state.layers["session-explicit-exclude"]);
  const layerSessionExplicitIncludeState = beginLayerRender(state.layers["session-explicit-include"]);
  const layerDefaultState = beginLayerRender(state.layers["default"]);
  const markedElements = new Set();

  for (const el of collections.hardElements) {
    const rects = getRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerHardState, rects, "uf-hard-locked", el, "immutable", markedElements
      );
    }
  }

  for (const el of collections.fetchedExplicitExcludeElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "exclude" });
      drawMultiRectReuse(
        layerSavedExplicitExcludeState,
        rects,
        presentation.className,
        el,
        "saved-explicit-exclude",
        markedElements
      );
    }
  }

  for (const el of collections.fetchedExplicitIncludeElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include" });
      drawMultiRectReuse(
        layerSavedExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "saved-explicit-include",
        markedElements
      );
    }
  }

  for (const el of collections.hiddenFetchedExplicitIncludeElements || []) {
    const rects = getGhostRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include", ghost: true });
      drawMultiRectReuse(
        layerSavedExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "saved-explicit-include-ghost",
        markedElements
      );
    }
  }

  for (const el of collections.aiContentElements) {
    const rects = getRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerAiContentState, rects, "uf-ai-content", el, "ai-content", markedElements
      );
    }
  }

  for (const el of collections.hiddenAiContentElements || []) {
    const rects = getGhostRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerAiContentState,
        rects,
        "uf-ai-content uf-ai-content-ghost",
        el,
        "ai-content-ghost",
        markedElements
      );
    }
  }

  for (const el of collections.aiAnimatedExplicitIncludeElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerAiContentState,
        rects,
        "uf-ai-content uf-ai-content-overlay",
        el,
        "ai-content-explicit-include",
        markedElements
      );
    }
  }

  for (const el of collections.hiddenAiAnimatedExplicitIncludeElements || []) {
    const rects = getGhostRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerAiContentState,
        rects,
        "uf-ai-content uf-ai-content-overlay uf-ai-content-ghost",
        el,
        "ai-content-explicit-include-ghost",
        markedElements
      );
    }
  }

  for (const el of collections.sessionExplicitExcludeElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "exclude" });
      drawMultiRectReuse(
        layerSessionExplicitExcludeState,
        rects,
        presentation.className,
        el,
        "session-explicit-exclude",
        markedElements
      );
    }
  }

  for (const el of collections.sessionExplicitIncludeElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include" });
      drawMultiRectReuse(
        layerSessionExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "session-explicit-include",
        markedElements
      );
    }
  }

  for (const el of collections.hiddenSessionExplicitIncludeElements || []) {
    const rects = getGhostRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include", ghost: true });
      drawMultiRectReuse(
        layerSessionExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "session-explicit-include-ghost",
        markedElements
      );
    }
  }

  for (const el of collections.defaultElements) {
    const rects = getRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerDefaultState, rects, "uf-default", el, "default", markedElements
      );
    }
  }

  finalizeLayerRender(layerHardState);
  finalizeLayerRender(layerSavedExplicitExcludeState);
  finalizeLayerRender(layerSavedExplicitIncludeState);
  finalizeLayerRender(layerAiContentState);
  finalizeLayerRender(layerSessionExplicitExcludeState);
  finalizeLayerRender(layerSessionExplicitIncludeState);
  finalizeLayerRender(layerDefaultState);

  updateFocusHighlight();
  updateMarkedElements(markedElements);
}


function startObservers() {
  if (state.mutationObserver) {
    return;
  }
  state.mutationObserver = new MutationObserver((mutations) => {
    try {
      if (state.overlay) {
        const hasNonOverlayChange = mutations.some((mutation) => {
          const target = mutation.target;
          return !(target === state.overlay || state.overlay.contains(target));
        });
        if (!hasNonOverlayChange) {
          return;
        }
      }
      if (mutations.some((mutation) => mutation.type === "childList")) {
        hideConsentElements();
      }
      const renderMode = getMutationRenderMode(mutations);
      if (renderMode === "none") {
        return;
      }
      if (renderMode === "rebuild") {
        invalidateSharedSelectorCache({ domStructure: true });
      }
      scheduleRender({
        delay: 120,
        minInterval: 250,
        invalidate: renderMode === "rebuild"
      });
    } catch (error) {
      // Silently handle errors to prevent observer from stopping
    }
  });
  if (document.body) {
    try {
      state.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "id", "hidden", "aria-hidden", "style"]
      });
    } catch (error) {
      // Silently handle if body is not available
      state.mutationObserver = null;
    }
  }
}

function stopObservers() {
  if (state.mutationObserver) {
    state.mutationObserver.disconnect();
    state.mutationObserver = null;
  }
}

function shouldPreserveDraftCacheForUrlChange(previousUrl, nextUrl) {
  if (!state.enabled || !state.baseUrl || !previousUrl || !nextUrl) {
    return false;
  }
  if (!utils.isPageWithinBaseUrl(previousUrl, state.baseUrl)) {
    return false;
  }
  if (!utils.isPageWithinBaseUrl(nextUrl, state.baseUrl)) {
    return false;
  }
  return isPageDraftDirty(previousUrl);
}

export function handleUrlWatcherTransition(previousUrl, nextUrl) {
  const preserveUnsavedDraftCache = shouldPreserveDraftCacheForUrlChange(previousUrl, nextUrl);
  disable({
    preserveUnsavedDraftCache,
    pageUrl: previousUrl
  });
}

export function startUrlWatcher() {
  if (state.urlCheckTimer) {
    return;
  }
  let lastUrl = location.href;
  state.urlCheckTimer = extensionSetInterval(() => {
    if (location.href !== lastUrl) {
      const previousUrl = lastUrl;
      const nextUrl = location.href;
      lastUrl = location.href;
      handleUrlWatcherTransition(previousUrl, nextUrl);
      window.dispatchEvent(new Event("unfluffify:url-changed"));
    }
  }, 800);
}

function stopUrlWatcher() {
  if (state.urlCheckTimer) {
    extensionClearInterval(state.urlCheckTimer);
    state.urlCheckTimer = 0;
  }
}

export function hideConsentElements() {
  const elements = Array.from(document.querySelectorAll(CONSENT_SELECTOR))
      .filter((element) => typeof element.parentElement !== "undefined");

  let hiddenCount = 0;
  elements.forEach((element) => {
    if (hideConsentElement(element)) {
      hiddenCount += 1;
    }
  });

  if (hiddenCount > 0) {
    restorePageScrolling();
    injectConsentBypassStyle();
  }
  return hiddenCount;
}


function restorePageScrolling() {
  const html = document.documentElement;
  const body = document.body;

  if (!html || !body) return;

  const setStyle = (el, prop, value) => {
    el.style.setProperty(prop, value, "important");
  };

  [html, body].forEach((element) => {
    const style = window.getComputedStyle(element);
    const overflowBlocked =
      style.overflow === "hidden" || style.overflow === "clip";
    const overflowXBlocked =
      style.overflowX === "hidden" || style.overflowX === "clip";
    const overflowYBlocked =
      style.overflowY === "hidden" || style.overflowY === "clip";
    const positionBlocked = style.position === "fixed";

    if (overflowBlocked) {
      setStyle(element, "overflow", "auto");
    }
    if (overflowXBlocked) {
      setStyle(element, "overflow-x", "auto");
    }
    if (overflowYBlocked) {
      setStyle(element, "overflow-y", "auto");
    }
    if (positionBlocked) {
      setStyle(element, "position", "static");
    }
    if ((overflowBlocked || positionBlocked) && style.height !== "auto") {
      setStyle(element, "height", "auto");
    }
  });
}

function hideConsentOnEnable(pageUrl) {
  if (!pageUrl || state.consentSyncedPageUrl === pageUrl) {
    return 0;
  }
  state.consentSyncedPageUrl = pageUrl;
  return hideConsentBeforeReveal();
}

function hideConsentBeforeReveal() {
  const hiddenCount = hideConsentElements();
  if (hiddenCount === 0) {
    injectConsentBypassStyle();
  }
  return hiddenCount;
}

// ====================================================================
// Public API
// ====================================================================

/**
 * Checks if an element is a default toggleable excluded element (e.g., header, footer, nav).
 * @param {Element} el - The element to check
 * @returns {boolean} True if the element matches a toggleable default exclusion
 */
export function isDefaultToggleableExcludedElement(el) {
  return matchesToggleableDefaultExcluded(el);
}

/**
 * Checks if an element matches immutable exclusion selectors.
 * @param {Element} el - The element to check
 * @returns {boolean} True if the element matches an immutable exclusion
 */
export function isImmutableExcludedElement(el) {
  return matchesImmutableExcluded(el);
}

export function isPageDraftDirty(pageUrl) {
  if (pageUrl && state.autoSeededPendingSavePageUrl === pageUrl) {
    return true;
  }
  if (isPageSaveReconciliationPending(pageUrl)) {
    return true;
  }
  const draft = getDraftPageEntry(pageUrl);
  const draftFingerprint = getEntryFingerprint(draft).join("\n");
  const baseline = pageUrl
    ? state.cleanBaselineFingerprintByPageUrl.get(pageUrl)
    : undefined;
  if (baseline === undefined) {
    // No baseline yet. If the draft has been populated by the initial sync
    // (defaults + AI CSS selectors), snapshot it as the implicit clean
    // baseline so subsequent user/AI changes are detected. If the draft is
    // still empty (sync hasn't run), there is nothing to lose yet.
    if (pageUrl && draft && Array.isArray(draft.xpaths) && draft.xpaths.length > 0) {
      state.cleanBaselineFingerprintByPageUrl.set(pageUrl, draftFingerprint);
    }
    return false;
  }
  return draftFingerprint !== baseline;
}

export function getPageSaveReconciliationState(pageUrl = location.href) {
  const reconciliation = config.normalizePageSaveReconciliation(state.pageSaveReconciliation);
  if (!reconciliation || reconciliation.pageUrl !== pageUrl) {
    return null;
  }
  if (state.baseUrl && !utils.sameBaseUrl(reconciliation.baseUrl, state.baseUrl)) {
    return null;
  }
  return { ...reconciliation };
}

export function isPageSaveReconciliationPending(pageUrl = location.href) {
  const reconciliation = getPageSaveReconciliationState(pageUrl);
  return config.isPageSaveReconciliationPending(reconciliation);
}

export async function refreshPageSaveReconciliation(baseUrl = state.baseUrl, pageUrl = location.href) {
  if (!baseUrl || !pageUrl) {
    state.pageSaveReconciliation = null;
    return null;
  }
  const reconciliation = await config.getPageSaveReconciliation(baseUrl, pageUrl);
  state.pageSaveReconciliation = reconciliation;
  updateMarkingTemporarilyDisabledUi();
  return reconciliation;
}

export async function setPageSaveReconciliationPending(baseUrl = state.baseUrl, pageUrl = location.href, options = {}) {
  if (!baseUrl || !pageUrl) {
    return null;
  }
  const reconciliation = await config.setPageSaveReconciliation(baseUrl, pageUrl, {
    reason: typeof options.reason === "string" ? options.reason : "pending"
  });
  state.pageSaveReconciliation = reconciliation;
  updateMarkingTemporarilyDisabledUi();
  notifyDraftStatus(pageUrl);
  return reconciliation;
}

export async function clearPageSaveReconciliation(baseUrl = state.baseUrl, pageUrl = location.href) {
  if (baseUrl && pageUrl) {
    await config.clearPageSaveReconciliation(baseUrl, pageUrl);
  }
  const current = config.normalizePageSaveReconciliation(state.pageSaveReconciliation);
  if (!current || !pageUrl || current.pageUrl === pageUrl) {
    state.pageSaveReconciliation = null;
  }
  updateMarkingTemporarilyDisabledUi();
  notifyDraftStatus(pageUrl);
}

export function areEntriesEquivalent(left, right) {
  const leftFingerprint = getEntryFingerprint(left);
  const rightFingerprint = getEntryFingerprint(right);
  if (leftFingerprint.length !== rightFingerprint.length) {
    return false;
  }
  for (let i = 0; i < leftFingerprint.length; i += 1) {
    if (leftFingerprint[i] !== rightFingerprint[i]) {
      return false;
    }
  }
  return true;
}

export function clonePageEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const cloned = {
    title: normalizePageEntryTitle(entry.title),
    timestamp: normalizeEntryTimestampValue(entry.timestamp),
    pageType: normalizePageEntryPageType(entry.pageType),
    xpaths: Array.isArray(entry.xpaths) ? entry.xpaths : [],
    includeXpaths: Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [],
    selectorSuppressedXpaths: Array.isArray(entry.selectorSuppressedXpaths)
      ? entry.selectorSuppressedXpaths
      : [],
    silentWhitespaceExcludedXpaths: Array.isArray(entry.silentWhitespaceExcludedXpaths)
      ? entry.silentWhitespaceExcludedXpaths
      : [],
    submissionXpaths: Array.isArray(entry.submissionXpaths) ? entry.submissionXpaths : [],
    renderedHtml: typeof entry.renderedHtml === "string" ? entry.renderedHtml : "",
    rawHtml: typeof entry.rawHtml === "string" ? entry.rawHtml : ""
  };
  return normalizePageEntryXpaths(cloned);
}

export function setSavedPageEntry(pageUrl, entry) {
  state.savedPageUrl = pageUrl || "";
  state.savedPageEntry = clonePageEntry(entry);
  if (pageUrl && state.autoSeededPendingSavePageUrl === pageUrl) {
    state.autoSeededPendingSavePageUrl = "";
  }
  // A backend-confirmed entry refreshes the clean baseline for that page so
  // subsequent edits or AI runs flip the dirty signal back on. Skip empty
  // entries (null / reset) so we do not erase an established baseline mid
  // session.
  if (pageUrl && entry && Array.isArray(entry.xpaths) && entry.xpaths.length > 0) {
    state.cleanBaselineFingerprintByPageUrl.set(
      pageUrl,
      getEntryFingerprint(entry).join("\n")
    );
  }
}

export async function refreshSavedPageEntryFromBackendCache(baseUrl = state.baseUrl, pageUrl = location.href) {
  if (!baseUrl || !pageUrl) {
    setSavedPageEntry(pageUrl, null);
    return null;
  }
  const backendSavedPageMarkings = await config.getBackendSavedPageMarkings(baseUrl);
  const savedEntry = findPageMarkingEntry(
    { pageMarkings: backendSavedPageMarkings },
    pageUrl,
    baseUrl
  );
  setSavedPageEntry(pageUrl, savedEntry || null);
  return getSavedPageEntry(pageUrl);
}

export function notifyDraftStatus(pageUrl) {
  if (!state.enabled || !state.baseUrl || !state.config) {
    return;
  }
  chrome.runtime.sendMessage({
    type: "pageDraftChanged",
    baseUrl: state.baseUrl,
    pageUrl: pageUrl || location.href,
    dirty: isPageDraftDirty(pageUrl || location.href)
  }).then();
}

export function scheduleSnapshotSave(delayMs = DEFAULT_SNAPSHOT_SAVE_DELAY_MS) {
  if (!state.baseUrl || !state.config) {
    return;
  }
  if (state.snapshotTimer) {
    extensionClearTimeout(state.snapshotTimer);
  }
  state.snapshotTimer = extensionSetTimeout(() => {
    state.snapshotTimer = 0;
    runWhenIdle(() => {
      if (!state.baseUrl || !state.config) {
        return;
      }
      const snapshotStartedAt = nowMs();
      recordPageSnapshot(state.config, location.href);
      logTogglePerf("snapshot.generate", snapshotStartedAt);
    });
  }, Math.max(0, Math.trunc(delayMs)));
}

export function scheduleDraftPersist(baseUrl = state.baseUrl, delayMs = 220) {
  const targetBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!targetBaseUrl || !state.config) {
    return;
  }
  if (state.draftPersistTimer) {
    extensionClearTimeout(state.draftPersistTimer);
  }
  state.draftPersistTimer = extensionSetTimeout(() => {
    state.draftPersistTimer = 0;
    if (!targetBaseUrl || !state.config) {
      return;
    }
    const persistStartedAt = nowMs();
    saveConfig(targetBaseUrl, state.config).catch(() => {
      // Keep manual marking responsive; persistence failures are non-blocking.
    }).finally(() => {
      logTogglePerf("draft.persist", persistStartedAt);
    });
  }, Math.max(0, Math.trunc(delayMs)));
}

function flushPendingSnapshotSave(configValue, pageUrl) {
  if (!configValue || !pageUrl) {
    return false;
  }
  try {
    recordPageSnapshot(configValue, pageUrl);
    return true;
  } catch {
    return false;
  }
}

function persistTeardownConfig(baseUrl, configValue) {
  if (!baseUrl || !configValue) {
    return;
  }
  saveConfig(baseUrl, configValue).catch(() => {
    // Ignore best-effort persistence failures during teardown.
  });
}

function flushPendingTeardownPersistence(baseUrl, configValue, pageUrl) {
  let shouldPersist = false;
  if (state.snapshotTimer) {
    extensionClearTimeout(state.snapshotTimer);
    state.snapshotTimer = 0;
    shouldPersist = flushPendingSnapshotSave(configValue, pageUrl) || shouldPersist;
  }
  if (state.draftPersistTimer) {
    extensionClearTimeout(state.draftPersistTimer);
    state.draftPersistTimer = 0;
    shouldPersist = true;
  }
  if (shouldPersist) {
    persistTeardownConfig(baseUrl, configValue);
  }
}

function setAltPassThrough(enabled) {
  const changed = state.altPassThrough !== enabled;
  state.altPassThrough = enabled;
  if (!state.overlay) {
    return;
  }
  state.overlay.style.pointerEvents = enabled ? "none" : "auto";
  state.overlay.style.opacity = enabled ? "0.5" : "1";
  if (enabled && state.layers["hover"]) {
    clearLayer(state.layers["hover"]);
  }
  if (!enabled) {
    scheduleRender();
  }
  if (changed) {
    updateCursorMode();
  }
}

export function isMarkableElement(el, config, options) {
  if (!config) {
    return false;
  }
  if (isWithinAiPopover(el)) {
    return false;
  }
  if (!(options && options.allowConsentElements) && isWithinConsentElement(el)) {
    return false;
  }
  if (isSilentWhitespaceExclusionCandidate(el)) {
    return false;
  }
  if (options && options.allowImmutableChildren) {
    if (matchesImmutableExcluded(el)) {
      return false;
    }
  } else if (isWithinImmutableExcluded(el)) {
    return false;
  }
  if (options && (options.explicitlyExcluded || options.explicitlyIncluded)) {
    return true;
  }
  if (isSelfMarkableWithoutParentMode(el, options || {})) {
    return true;
  }
  if (!options || !options.allowParent) {
    return false;
  }
  if (isUnsafeShallowParentMarkingTarget(el, options || {})) {
    return false;
  }
  return hasMultipleMarkableDescendants(el, options || {});
}

export function canApplyExplicitInclude(
  el,
  configValue = state.config,
  pageUrl = location.href,
  entryOverride = null
) {
  if (isExplicitIncludeBoundaryCandidate(el, {
    allowParent: false,
    allowImmutableChildren: false
  })) {
    return true;
  }
  if (isMarkableElement(el, configValue, {
    allowParent: false,
    allowImmutableChildren: false
  })) {
    return true;
  }
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const xpath = getXPath(el);
  const configEntry =
    configValue &&
    configValue.pageMarkings &&
    typeof configValue.pageMarkings === "object" &&
    pageUrl
      ? configValue.pageMarkings[pageUrl] || null
      : null;
  const sourceEntries = [configEntry, entryOverride];
  if (
    xpath &&
    sourceEntries.some((entry) =>
      collectSilentWhitespaceExcludedXPaths(entry).includes(xpath) &&
      isSilentWhitespaceExclusionCandidate(el)
    )
  ) {
    return false;
  }
  if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinImmutableExcluded(el)) {
    return false;
  }
  if (matchesToggleableDefaultExcluded(el)) {
    return true;
  }
  if (isVisible(el)) {
    return false;
  }
  if (!xpath) {
    return false;
  }
  for (const entry of sourceEntries) {
    const includeXpaths = Array.isArray(entry && entry.includeXpaths) ? entry.includeXpaths : [];
    if (includeXpaths.includes(xpath)) {
      return true;
    }
  }
  return false;
}

export function clearFocusHighlight() {
  if (!state.focusElement) {
    clearAiPreviewFocusElement();
    return;
  }
  state.focusElement = null;
  clearAiPreviewFocusElement();
  updateFocusHighlight();
}

export function isVisible(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const cache = state.visibilityCache;
  if (cache) {
    const cached = cache.get(el);
    if (cached !== undefined) {
      return cached;
    }
  }
  const result = isVisibleUncached(el);
  if (cache) {
    cache.set(el, result);
  }
  return result;
}

function isVisibleUncached(el) {
  if (isWithinExtensionUi(el)) {
    return false;
  }
  let ambiguousHidden = false;
  let node = el;
  const visCache = state.ancestorVisStateCache;
  while (node && node.nodeType === 1) {
    let visState;
    if (visCache && visCache.has(node)) {
      visState = visCache.get(node);
    } else {
      const style = window.getComputedStyle(node);
      visState = getTheoreticalVisibilityState(node, style);
      if (visCache) {
        visCache.set(node, visState);
      }
    }
    if (visState.definitiveHidden) {
      return false;
    }
    if (visState.ambiguousHidden) {
      ambiguousHidden = true;
    }
    node = node.parentElement;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  if (isClippedByOverflow(el)) {
    return false;
  }
  if (!ambiguousHidden) {
    return true;
  }
  return isActuallyVisibleToUser(el);
}

export function isVisibleForSubmission(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (isWithinExtensionUi(el)) {
    return false;
  }
  let ambiguousHidden = false;
  let node = el;
  while (node && node.nodeType === 1) {
    const style = window.getComputedStyle(node);
    const state = getTheoreticalVisibilityState(node, style);
    if (state.definitiveHidden) {
      return false;
    }
    if (state.ambiguousHidden) {
      ambiguousHidden = true;
    }
    node = node.parentElement;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  if (isClippedByOverflow(el)) {
    return false;
  }
  if (ambiguousHidden && !isActuallyVisibleToUser(el)) {
    // Shared user-visible contract: an ambiguous-hidden ancestor (aria-hidden,
    // sr-only, visually-hidden) only counts as visible-for-submission when the
    // element still survives a hit-test reality check. Otherwise the AI server
    // would be told that pure accessibility / off-canvas labels are visible
    // content the user accepted, polluting the inclusion set with text the
    // user cannot review. This matches the marking-side `isVisible(...)`
    // contract so submission, marking, and silent-highlight retention agree on
    // what counts as user-visible.
    return false;
  }
  if (isActuallyVisibleInDocument(el)) {
    return true;
  }
  // Partial-visibility contract bridge: align with the marking / silent-highlight
  // retention path that treats a non-definitively-hidden element as visible to the
  // user when any rendered client rect intersects the submission visual area. This
  // prevents wrapper/ancestor rows whose primary bounding rect anchors out of
  // bounds (column layouts, sticky containers, broad clipping ancestors) from
  // being auto-promoted to `excluded: true` while their visible descendant
  // content is still being submitted as included.
  return anyClientRectIntersectsSubmissionArea(el);
}

export function getElementFromXPath(xpath) {
  try {
    const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
    );
    const node = result.singleNodeValue;
    if (node && node.nodeType === 1) {
      return node;
    }
    return null;
  } catch (error) {
    return null;
  }
}

export function hasPageMarkingEntry(config, pageUrl) {
  if (!config || !config.pageMarkings || typeof config.pageMarkings !== "object") {
    return false;
  }
  return Boolean(findPageMarkingEntry(config, pageUrl));
}

// Normalize URL paths so "/page" and "/page/" resolve to the same page-marking entry.
function normalizeUrlPath(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return "/";
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

// Build a stable page-marking key for equivalent URLs by ignoring trailing slashes.
function toLooseUrlKey(value, baseUrl) {
  if (typeof value !== "string" || !value) {
    return "";
  }
  try {
    const url = new URL(value, baseUrl || location.href);
    const host = url.host.toLowerCase();
    const path = normalizeUrlPath(url.pathname);
    return `${host}${path}${url.search || ""}`;
  } catch {
    return "";
  }
}

export function findPageMarkingEntry(configValue, pageUrl, baseUrl = state.baseUrl || pageUrl) {
  const pageMarkings = configValue && configValue.pageMarkings;
  if (!pageMarkings || typeof pageMarkings !== "object" || !pageUrl) {
    return null;
  }
  if (pageMarkings[pageUrl]) {
    return pageMarkings[pageUrl];
  }
  const targetLooseKey = toLooseUrlKey(pageUrl, baseUrl || pageUrl);
  if (!targetLooseKey) {
    return null;
  }
  const lookupBaseUrl = baseUrl || pageUrl;
  let cached = pageMarkingEntryLookupCache.get(pageMarkings);
  if (!cached || cached.baseUrl !== lookupBaseUrl) {
    const entriesByLooseKey = new Map();
    Object.keys(pageMarkings).forEach((url) => {
      const looseKey = toLooseUrlKey(url, lookupBaseUrl);
      if (looseKey && !entriesByLooseKey.has(looseKey)) {
        entriesByLooseKey.set(looseKey, pageMarkings[url]);
      }
    });
    cached = { baseUrl: lookupBaseUrl, entriesByLooseKey };
    pageMarkingEntryLookupCache.set(pageMarkings, cached);
  }
  return cached.entriesByLooseKey.get(targetLooseKey) || null;
}

// Write an entry into a pageMarkings object and evict its loose-lookup cache
// so that the next findPageMarkingEntry call rebuilds with up-to-date data.
function setPageMarkingEntry(pageMarkings, url, entry) {
  pageMarkings[url] = entry;
  pageMarkingEntryLookupCache.delete(pageMarkings);
}

export function collectImmutableElements() {
  const immutable = new Set();
  for (const selector of DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS) {
    if (!selector) {
      continue;
    }
    try {
      const elements = document.querySelectorAll(toQuerySelector(selector));
      for (const el of elements) {
        if (isVisible(el) && !isWithinAiPopover(el)) {
          immutable.add(el);
        }
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  return immutable;
}

export function scheduleRender(options) {
  const scheduleStartedAt = nowMs();
  const shouldInvalidate = !options || options.invalidate !== false;
  state.pendingRenderInvalidate = state.pendingRenderInvalidate || shouldInvalidate;
  if (state.renderTimer) {
    logTogglePerf("scheduleRender.skipped-existing", scheduleStartedAt, {
      reason: options && options.reason ? options.reason : "unknown"
    });
    return;
  }
  // Observer/mutation-driven renders stay slightly delayed by default to reduce redraw churn.
  const { delay = 50, minInterval = 0, reason = "unspecified" } = options || {};
  const now = Date.now();
  const sinceLast = now - (state.lastRenderAt || 0);
  const waitForInterval =
    minInterval > 0 && sinceLast < minInterval ? minInterval - sinceLast : 0;
  const effectiveDelay = Math.max(delay, waitForInterval);
  logTogglePerf("scheduleRender.queued", scheduleStartedAt, {
    reason,
    delay,
    waitForInterval,
    effectiveDelay
  });
  state.renderTimer = extensionSetTimeout(() => {
    state.renderTimer = 0;
    if (state.pendingRenderInvalidate) {
      invalidateCachedCollections();
    }
    if (state.renderRaf) {
      return;
    }
    state.renderRaf = extensionRequestAnimationFrame(() => {
      state.renderRaf = 0;
      state.lastRenderAt = Date.now();
      renderHighlights();
      state.pendingRenderInvalidate = false;
    });
  }, effectiveDelay);
}

export function mergeDraftEntry(config, pageUrl, draftEntry, savedEntry) {
  if (!config || !pageUrl || !draftEntry) {
    return;
  }
  if (areEntriesEquivalent(draftEntry, savedEntry)) {
    return;
  }
  if (!config.pageMarkings || typeof config.pageMarkings !== "object") {
    config.pageMarkings = {};
  }
  setPageMarkingEntry(config.pageMarkings, pageUrl, clonePageEntry(draftEntry));
}

export function getPageMarkingEntry(configValue, pageUrl, options) {
  const { create = true, persist = true } = options || {};
  const currentPageType = normalizePageEntryPageType(state.currentPageType);
  if (!configValue) {
    return {
      title: "",
      timestamp: createCurrentTimestamp(),
      pageType: currentPageType,
      xpaths: [],
      includeXpaths: [],
      silentWhitespaceExcludedXpaths: [],
      submissionXpaths: [],
      renderedHtml: "",
      rawHtml: ""
    };
  }
  if (!configValue.pageMarkings || typeof configValue.pageMarkings !== "object") {
    configValue.pageMarkings = {};
  }
  const existing = findPageMarkingEntry(configValue, pageUrl);
  if (existing && Array.isArray(existing.xpaths)) {
    if (!normalizePageEntryPageType(existing.pageType) && currentPageType) {
      existing.pageType = currentPageType;
    }
    return normalizePageEntryXpaths(existing);
  }
  const entry = {
    title: normalizePageEntryTitle(document.title, pageUrl || ""),
    timestamp: createCurrentTimestamp(),
    pageType: currentPageType,
    xpaths: [],
    includeXpaths: [],
    silentWhitespaceExcludedXpaths: [],
    submissionXpaths: [],
    renderedHtml: "",
    rawHtml: ""
  };
  if (create && persist) {
    setPageMarkingEntry(configValue.pageMarkings, pageUrl, entry);
  }
  return entry;
}

export async function loadConfig(baseUrl) {
  const result = await utils.idbGet("configs");
  const configs = result.configs || {};
  const normalized = config.normalizeConfig(baseUrl, configs[baseUrl]);
  configs[baseUrl] = normalized.config;
  if (normalized.changed) {
    await utils.idbSet({ configs });
  }
  return configs[baseUrl];
}

function cloneDraftEntryForDisableCache(entry) {
  const cloned = clonePageEntry(entry);
  if (!cloned) {
    return null;
  }
  // Keep disable/enable cache small; saved HTML is not needed for draft restoration.
  cloned.renderedHtml = "";
  cloned.rawHtml = "";
  return cloned;
}

function clearMarkingSettleRenders() {
  if (!Array.isArray(state.markingSettleTimers) || state.markingSettleTimers.length === 0) {
    state.markingSettleTimers = [];
    return;
  }
  state.markingSettleTimers.forEach((timerId) => {
    if (timerId) {
      extensionClearTimeout(timerId);
    }
  });
  state.markingSettleTimers = [];
}

function scheduleMarkingSettleRenders() {
  clearMarkingSettleRenders();
  const timers = [];
  for (const delay of MARKING_MODE_SETTLE_RENDER_DELAYS_MS) {
    const timerId = extensionSetTimeout(() => {
      state.markingSettleTimers = state.markingSettleTimers.filter((id) => id !== timerId);
      if (!state.enabled) {
        return;
      }
      scheduleRender({
        reason: "marking-settle",
        delay: 0,
        invalidate: true
      });
    }, delay);
    timers.push(timerId);
  }
  state.markingSettleTimers = timers;
}

function cacheUnsavedDraftBeforeDisable(pageUrl = location.href) {
  if (!state.enabled || !state.baseUrl || !state.config) {
    return;
  }
  const draftEntry = getDraftPageEntry(pageUrl);
  const savedEntry = getSavedPageEntry(pageUrl);
  if (!draftEntry || areEntriesEquivalent(draftEntry, savedEntry)) {
    state.disabledUnsavedDraft = null;
    return;
  }
  state.disabledUnsavedDraft = {
    baseUrl: state.baseUrl,
    pageUrl,
    draftEntry: cloneDraftEntryForDisableCache(draftEntry),
    savedEntry: cloneDraftEntryForDisableCache(savedEntry)
  };
}

export function disable(options = {}) {
  const optionPageUrl =
    typeof options.pageUrl === "string" && options.pageUrl
      ? options.pageUrl
      : "";
  const teardownBaseUrl = state.baseUrl;
  const teardownConfig = state.config;
  const teardownPageUrl =
    optionPageUrl ||
    (typeof location !== "undefined" && location.href
      ? location.href
      : state.currentPageUrl);
  flushPendingTeardownPersistence(teardownBaseUrl, teardownConfig, teardownPageUrl);
  const preserveUnsavedDraftCache = options.preserveUnsavedDraftCache !== false;
  if (preserveUnsavedDraftCache) {
    cacheUnsavedDraftBeforeDisable(teardownPageUrl);
  } else {
    state.disabledUnsavedDraft = null;
  }
  state.enabled = false;
  state.baseUrl = "";
  state.currentPageType = "";
  state.config = null;
  state.currentPageUrl = "";
  state.currentPageEntry = null;
  state.autoSeededPendingSavePageUrl = "";
  state.autoSeedSuppressedPageUrl = "";
  state.toggleInFlightKey = "";
  state.toggleQueuedActionKey = "";
  state.lastToggleActionKey = "";
  state.lastToggleActionAt = 0;
  state.pageSaveReconciliation = null;
  state.altPassThrough = false;
  state.consentSyncedPageUrl = "";
  state.pageRevealWarmupId += 1;
  stopPageInspectionInputBlocker();
  if (state.renderTimer) {
    extensionClearTimeout(state.renderTimer);
    state.renderTimer = 0;
  }
  if (state.explicitFullRenderTimer) {
    extensionClearTimeout(state.explicitFullRenderTimer);
    state.explicitFullRenderTimer = 0;
  }
  cancelQueuedToggleMutations();
  cancelExplicitOverlayRefresh();
  if (state.renderRaf) {
    extensionCancelAnimationFrame(state.renderRaf);
    state.renderRaf = 0;
  }
  state.pendingRenderInvalidate = false;
  if (state.scrollHideTimer) {
    extensionClearTimeout(state.scrollHideTimer);
    state.scrollHideTimer = 0;
  }
  if (state.hoverRaf) {
    extensionCancelAnimationFrame(state.hoverRaf);
    state.hoverRaf = 0;
  }
  if (state.toggleAckTimer) {
    extensionClearTimeout(state.toggleAckTimer);
    state.toggleAckTimer = 0;
  }
  state.isScrolling = false;
  state.cachedCollections = null;
  state.cachedCollectionsKey = "";
  state.paintReachabilityFallbackCount = 0;
  state.paintReachabilityFallbackLastLoggedAt = 0;
  clearMarkingSettleRenders();
  state.savedPageEntry = null;
  state.savedPageUrl = "";
  state.cleanBaselineFingerprintByPageUrl.clear();
  removeOverlay();
  closeAiPopover();
  removeConsentBypassStyle();
  const popoverStyle = document.getElementById("unfluffify-ai-popover-style");
  if (popoverStyle) {
    popoverStyle.remove();
  }
  if (state.consentRootElements) {
    state.consentRootElements.clear();
  }
  resumePageMotion();
  stopObservers();
  stopUrlWatcher();
}

export async function enableForBaseUrl(baseUrl, options = {}) {
  const skipInitialReveal = Boolean(options && options.skipInitialReveal);
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !utils.isPageWithinBaseUrl(location.href, normalizedBaseUrl)) {
    disable();
    return;
  }
  state.enabled = true;
  state.baseUrl = normalizedBaseUrl;
  state.paintReachabilityFallbackCount = 0;
  state.paintReachabilityFallbackLastLoggedAt = 0;
  state.config = await loadConfig(normalizedBaseUrl);
  state.consentRootElements = new Set();
  const pageUrl = location.href;
  const storedEntry =
      state.config &&
      state.config.pageMarkings &&
      state.config.pageMarkings[pageUrl];
  const savedEntry = await refreshSavedPageEntryFromBackendCache(normalizedBaseUrl, pageUrl);
  if (!state.currentPageType) {
    state.currentPageType = normalizePageEntryPageType(
      (savedEntry && savedEntry.pageType) || (storedEntry && storedEntry.pageType)
    );
  }
  await refreshPageSaveReconciliation(normalizedBaseUrl, pageUrl);
  const cachedDraft = state.disabledUnsavedDraft;
  if (
    cachedDraft &&
    utils.sameBaseUrl(cachedDraft.baseUrl, normalizedBaseUrl) &&
    cachedDraft.pageUrl === pageUrl &&
    cachedDraft.draftEntry
  ) {
    mergeDraftEntry(
      state.config,
      pageUrl,
      cachedDraft.draftEntry,
      cachedDraft.savedEntry
    );
  }
  state.disabledUnsavedDraft = null;

  hideConsentOnEnable(pageUrl);
  if (hasPageMotionPauseReason("silent-highlighting")) {
    pausePageMotion();
  } else if (!skipInitialReveal) {
    const revealReady = await warmupPageRevealBeforeMotionPause(normalizedBaseUrl, pageUrl, {
      keepUiActive: true
    });
    if (!revealReady) {
      return;
    }
  }
  scheduleRender();
  scheduleMarkingSettleRenders();
  startObservers();
  startUrlWatcher();
  if (!skipInitialReveal) {
    await finishPageInspectionUiAfterRender();
  }
}

export function handleBeforeUnload(event) {
  if (!state.enabled) {
    return;
  }
  if (!isPageDraftDirty(location.href)) {
    return;
  }
  event.preventDefault();
  event.returnValue = "";
}

function isViewportScrollEvent(event) {
  if (!event) {
    return true;
  }
  const target = event.target;
  const currentTarget = event.currentTarget;
  if (
    currentTarget === window ||
    target === window ||
    target === document ||
    target === document.documentElement ||
    target === document.body
  ) {
    return true;
  }
  return false;
}

export function handleScroll(event, options = {}) {
  if (!state.enabled || state.aiPopover || !state.overlay) {
    return;
  }
  const isViewportScroll = isViewportScrollEvent(event);
  // Nested scroll containers still need a debounced redraw so partially visible
  // marked content tracks carousels and internal panes. Only viewport scrolls
  // hide the overlay during motion to avoid full-page flicker.
  const hideDuringScroll = isViewportScroll && (!options || options.hideDuringScroll !== false);
  if (hideDuringScroll && !state.isScrolling) {
    state.isScrolling = true;
    state.overlay.classList.add("uf-scrolling");
  } else if (!hideDuringScroll && state.isScrolling) {
    state.isScrolling = false;
    state.overlay.classList.remove("uf-scrolling");
  }
  if (state.scrollHideTimer) {
    extensionClearTimeout(state.scrollHideTimer);
  }
  state.scrollHideTimer = extensionSetTimeout(() => {
    state.scrollHideTimer = 0;
    if (!state.overlay) {
      state.isScrolling = false;
      return;
    }
    extensionRequestAnimationFrame(() => {
      renderHighlights();
      refreshHoverHighlight();
      extensionRequestAnimationFrame(() => {
        if (state.isScrolling) {
          state.isScrolling = false;
        }
        if (state.overlay) {
          state.overlay.classList.remove("uf-scrolling");
        }
      });
    });
  }, SCROLL_DEBOUNCE_MS);
}

export function collectPreviewItems(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  const excludedElements = collectSelectorElements(normalized.exclusionSelectors);
  const includedElements = new Set();
  collectSelectorElements(normalized.inclusionSelectors).forEach((el) => {
    if (el && el.nodeType === 1 && !isWithinConsentElement(el)) {
      includedElements.add(el);
    }
  });
  const inclusionContextSet = buildInclusionContextSet(includedElements);
  // Preview mirrors silent highlighting inclusion detection: implicit
  // non-excluded content plus explicit includes, while ignoring visibility for
  // inclusion selection (text extraction still honors exclusions).
  const { included: elements } = collectIncludedElementsFromSelectorSet(selectorSet, {
    ignoreVisibilityForInclusionDetection: true,
    preserveExplicitIncludedDescendants: true,
    includeAllExplicitMatches: true
  });
  const rows = [];
  for (const el of elements) {
    const text = getPreviewTextForIncludedElement(
      el,
      excludedElements,
      includedElements,
      inclusionContextSet
    );
    if (!text) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    rows.push({
      xpath: getXPath(el),
      text,
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX
    });
  }
  rows.sort((a, b) => {
    if (a.top === b.top) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });
  return rows
    .filter((row) => typeof row.xpath === "string" && row.xpath)
    .map((row) => ({ xpath: row.xpath, text: row.text }));
}

function getPreviewTextForIncludedElement(
  root,
  excludedElements,
  includedElements,
  inclusionContextSet
) {
  if (!root || root.nodeType !== 1) {
    return "";
  }
  const chunks = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").replace(/\u00a0/g, " ");
      if (text.trim()) {
        chunks.push(text);
      }
      continue;
    }
    if (node.nodeType !== 1) {
      continue;
    }

    const el = node;
    if (el.tagName === "BR" || el.tagName === "WBR") {
      chunks.push("\n");
      continue;
    }
    if (el !== root) {
      if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinExtensionUi(el)) {
        continue;
      }
      // Intentionally do not filter by visibility here: preview text should
      // reflect the inclusion selector match subtree, even if parts are hidden.
      // We still honor excluded/immutable subtrees so exclusions remain visible
      // in preview output semantics.
      if (
        isExcludedNatureElement(
          el,
          excludedElements,
          includedElements,
          inclusionContextSet
        )
      ) {
        continue;
      }
    }

    if (
      el.tagName === "SCRIPT" ||
      el.tagName === "STYLE" ||
      el.tagName === "NOSCRIPT" ||
      el.tagName === "TEMPLATE"
    ) {
      continue;
    }
    for (let i = el.childNodes.length - 1; i >= 0; i -= 1) {
      stack.push(el.childNodes[i]);
    }
  }
  return chunks
    .join("")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getElementLabel(el) {
  if (!el || el.nodeType !== 1) {
    return "";
  }
  let text = (el.innerText || "").replace(/\s+/g, " ").trim();
  if (!text) {
    text = (el.getAttribute("aria-label") || "").trim();
  }
  if (!text) {
    text = (el.getAttribute("title") || "").trim();
  }
  if (!text) {
    text = el.tagName.toLowerCase();
  }
  if (text.length > 80) {
    text = `${text.slice(0, 77)}...`;
  }
  return text;
}

export async function saveConfig(baseUrl, configValue) {
  const result = await utils.idbGet("configs");
  const configs = result.configs || {};
  configs[baseUrl] = config.normalizeConfig(baseUrl, configValue).config;
  await utils.idbSet({ configs });
}

export function showAiPopover(items, options = {}) {
  clearFocusHighlight();
  closeAiPopover({ notify: false, suppressCallback: true });
  const marker = document.createElement("div");
  marker.hidden = true;
  marker.setAttribute("data-uf-extension-ui", "true");
  document.documentElement.appendChild(marker);
  state.aiPopover = marker;
  state.aiPopoverOnClose = typeof options.onClose === "function" ? options.onClose : null;
  state.aiPopoverOnCollapsedChange = null;
  state.aiPopoverCollapsed = false;
}

export function getDraftPageEntry(pageUrl) {
  if (
      !pageUrl ||
      !state.config ||
      !state.config.pageMarkings ||
      typeof state.config.pageMarkings !== "object"
  ) {
    return null;
  }
  return findPageMarkingEntry(state.config, pageUrl);
}

export function getSavedPageEntry(pageUrl) {
  if (!pageUrl || state.savedPageUrl !== pageUrl) {
    return null;
  }
  return state.savedPageEntry ? clonePageEntry(state.savedPageEntry) : null;
}

export async function refreshFromTabState(options = {}) {
  void options;
  const response = await utils.sendRuntimeMessage({ type: "getTabState" });
  if (response && response.enabled && response.baseUrl) {
    // Enable if the URL still matches the baseUrl.
    if (utils.isPageWithinBaseUrl(location.href, response.baseUrl)) {
      const pageUrl = location.href;
      const draftEntry = getDraftPageEntry(pageUrl);
      const loadedConfig = await loadConfig(response.baseUrl);
      const storedEntry =
          loadedConfig.pageMarkings && loadedConfig.pageMarkings[pageUrl]
              ? loadedConfig.pageMarkings[pageUrl]
              : null;
      const backendSavedPageMarkings = await config.getBackendSavedPageMarkings(response.baseUrl);
      const storedBackendEntry = findPageMarkingEntry(
        { pageMarkings: backendSavedPageMarkings },
        pageUrl,
        response.baseUrl
      );
      const savedEntry = clonePageEntry(storedBackendEntry);
      const wasClean = areEntriesEquivalent(draftEntry, savedEntry);
      state.currentPageType = normalizePageEntryPageType(
        (response && response.pageType) ||
          (storedBackendEntry && storedBackendEntry.pageType) ||
          (storedEntry && storedEntry.pageType) ||
          ""
      );
      if (draftEntry && !normalizePageEntryPageType(draftEntry.pageType) && state.currentPageType) {
        draftEntry.pageType = state.currentPageType;
      }
      mergeDraftEntry(loadedConfig, pageUrl, draftEntry, savedEntry);
      state.baseUrl = response.baseUrl;
      state.config = loadedConfig;
      setSavedPageEntry(pageUrl, storedBackendEntry || null);
      await refreshPageSaveReconciliation(response.baseUrl, pageUrl);
      if (storedEntry) {
        const immutableExcluded = collectImmutableElements();
        const syncResult = syncPageMarkings(loadedConfig, pageUrl, immutableExcluded, {
          allowCreate: true,
          persist: true
        });
        if (wasClean && syncResult.changed && syncResult.entry) {
          setSavedPageEntry(pageUrl, syncResult.entry);
        }
      }
      state.enabled = true;
      state.consentRootElements = new Set();
      hideConsentOnEnable(pageUrl);
      // Reveal/freeze is intentionally NOT run here. It is bound strictly to the
      // silent-highlighting activation gate (and to manual marking enable), so a
      // marking-restore reload (e.g. render-mode inspection) does not re-trigger
      // the scroll-reveal routine.
      scheduleRender();
      startObservers();
      startUrlWatcher();
      return;
    }
  }
  disable();
}

export function syncPageMarkings(config, pageUrl, immutableExcluded, options) {
  return withElementComputationCache(() =>
    syncPageMarkingsInner(config, pageUrl, immutableExcluded, options)
  );
}

export async function syncPageMarkingsAsync(config, pageUrl, immutableExcluded, options) {
  return withElementComputationCacheAsync(() =>
    syncPageMarkingsInnerAsync(config, pageUrl, immutableExcluded, options)
  );
}

function appendSyncedCandidateItem(el, context) {
  const {
    seen,
    generatedExcludedSet,
    explicitMarkedAncestorSet,
    explicitExcludeSet,
    explicitIncludeSet,
    explicitExcludeAncestorSet,
    excludedLookup,
    explicitXpathSet,
    getCachedElementFromXPath,
    items,
    previousSilentWhitespaceExcludedSet,
    isExplicitlyMarkedXpath,
    isWithinExplicitInclude,
    isWithinExplicitIncludeXpath
  } = context;
  const xpath = getXPath(el);
  if (!xpath || seen.has(xpath)) {
    return;
  }
  if (isStaleSilentWhitespaceExclusion(xpath, el, previousSilentWhitespaceExcludedSet)) {
    return;
  }
  const toggleableDefault = matchesToggleableDefaultExcluded(el);
  if (
    toggleableDefault &&
    explicitMarkedAncestorSet.has(el) &&
    !isExplicitlyMarkedXpath(xpath)
  ) {
    seen.add(xpath);
    items.push({ xpath, excluded: false });
    return;
  }
  if (
    isWithinExplicitExcludedXpath(xpath, generatedExcludedSet) &&
    !isExplicitlyMarkedXpath(xpath)
  ) {
    return;
  }
  if (
    isWithinExplicitExcludedXpath(xpath, explicitExcludeSet) &&
    !isExplicitlyMarkedXpath(xpath) &&
    !isWithinExplicitInclude(el) &&
    !isWithinExplicitIncludeXpath(xpath)
  ) {
    return;
  }
  if (
    (isWithinExplicitInclude(el) || isWithinExplicitIncludeXpath(xpath)) &&
    !isExplicitlyMarkedXpath(xpath)
  ) {
    return;
  }
  if (
    explicitExcludeAncestorSet.has(el) &&
    !explicitIncludeSet.has(xpath)
  ) {
    return;
  }
  seen.add(xpath);
  const defaultExcluded = matchesToggleableDefaultExcluded(el);
  const excluded = explicitIncludeSet.has(xpath)
    ? false
    : excludedLookup.has(xpath)
      ? excludedLookup.get(xpath) === true
      : defaultExcluded;
  items.push(
    explicitXpathSet.has(xpath)
      ? { xpath, excluded, explicit: true }
      : { xpath, excluded }
  );
  if (excluded) {
    generatedExcludedSet.add(xpath);
  }
}

function appendSyncedCandidateItems(candidates, context) {
  for (const el of candidates) {
    appendSyncedCandidateItem(el, context);
  }
}

async function appendSyncedCandidateItemsAsync(candidates, context, options = {}) {
  const shouldAbort = typeof options.shouldAbort === "function"
    ? options.shouldAbort
    : null;
  let processedCount = 0;
  for (const el of candidates) {
    if (shouldAbort && shouldAbort()) {
      return false;
    }
    appendSyncedCandidateItem(el, context);
    processedCount += 1;
    if (processedCount >= TOGGLE_RECONCILE_YIELD_INTERVAL) {
      processedCount = 0;
      await yieldForToggleReconcileWork();
    }
  }
  return true;
}

function collectReconcilePreviousItemState(previousItems, getCachedElementFromXPath) {
  const excludedLookup = new Map();
  const explicitXpathSet = new Set();
  const explicitExcludeSet = new Set();
  const explicitUserExcludeSet = new Set();
  const excludedParents = new Set();
  for (const item of previousItems) {
    const xpath = item && item.xpath;
    if (typeof xpath !== "string" || !xpath) {
      continue;
    }
    excludedLookup.set(xpath, Boolean(item.excluded));
    if (item.explicit === true) {
      explicitXpathSet.add(xpath);
    }
    if (!item.excluded) {
      continue;
    }
    explicitExcludeSet.add(xpath);
    if (item.explicit === true) {
      explicitUserExcludeSet.add(xpath);
    }
    const el = getCachedElementFromXPath(xpath);
    if (!el) {
      continue;
    }
    if (isWithinConsentElement(el)) {
      continue;
    }
    if (isWithinImmutableExcluded(el)) {
      continue;
    }
    excludedParents.add(el);
  }
  return {
    excludedLookup,
    explicitXpathSet,
    explicitExcludeSet,
    explicitUserExcludeSet,
    excludedParents
  };
}

function syncPageMarkingsInner(config, pageUrl, immutableExcluded, options) {
  const syncStartedAt = nowMs();
  if (!config || !pageUrl) {
    return { changed: false, entry: null, persisted: false, hadEntry: false };
  }
  const {
    allowCreate = true,
    persist = true
  } = options || {};
  const hadEntry = hasPageMarkingEntry(config, pageUrl);
  const shouldPersist = persist && (allowCreate || hadEntry);
  const entry = getPageMarkingEntry(config, pageUrl, {
    create: allowCreate || hadEntry,
    persist: shouldPersist
  });
  normalizePageEntryXpaths(entry);
  const entrySetupStartedAt = nowMs();
  const xpathElementCache = new Map();
  let xpathLookupCount = 0;
  const getCachedElementFromXPath = (value) => {
    if (typeof value !== "string" || !value) {
      return null;
    }
    if (xpathElementCache.has(value)) {
      return xpathElementCache.get(value);
    }
    xpathLookupCount += 1;
    const resolved = getElementFromXPath(value);
    xpathElementCache.set(value, resolved);
    return resolved;
  };
  const previousItems = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const {
    excludedLookup,
    explicitXpathSet,
    explicitExcludeSet,
    explicitUserExcludeSet,
    excludedParents
  } = collectReconcilePreviousItemState(previousItems, getCachedElementFromXPath);
  const previousSilentWhitespaceExcludedSet = new Set(
    collectSilentWhitespaceExcludedXPaths(entry)
  );
  const explicitExcludeAncestorSet = new Set();
  for (const xpath of explicitExcludeSet) {
    const explicitExcludedEl = getCachedElementFromXPath(xpath);
    let current = explicitExcludedEl && explicitExcludedEl.nodeType === 1
      ? explicitExcludedEl.parentElement
      : null;
    while (current && current.nodeType === 1) {
      explicitExcludeAncestorSet.add(current);
      current = current.parentElement;
    }
  }
  const rawIncludeXpaths = Array.isArray(entry.includeXpaths)
    ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
  const filteredIncludeXpaths = [];
  for (const xpath of rawIncludeXpaths) {
    const includeEl = getCachedElementFromXPath(xpath);
    if (!includeEl) {
      continue;
    }
    const includeEntry = {
      ...entry,
      includeXpaths: filteredIncludeXpaths
    };
    if (!canApplyExplicitInclude(includeEl, config, pageUrl, includeEntry)) {
      continue;
    }
    filteredIncludeXpaths.push(xpath);
  }
  const explicitIncludeSet = new Set(filteredIncludeXpaths);
  entry.includeXpaths = filteredIncludeXpaths;
  const explicitMarkedAncestorSet = new Set();
  const explicitMarkedXpaths = new Set([
    ...Array.from(excludedLookup.keys()),
    ...filteredIncludeXpaths
  ]);
  for (const xpath of explicitMarkedXpaths) {
    if (typeof xpath !== "string" || !xpath) {
      continue;
    }
    const explicitMarkedEl = getCachedElementFromXPath(xpath);
    let current = explicitMarkedEl && explicitMarkedEl.nodeType === 1
      ? explicitMarkedEl.parentElement
      : null;
    while (current && current.nodeType === 1) {
      explicitMarkedAncestorSet.add(current);
      current = current.parentElement;
    }
  }
  const isExplicitlyMarkedXpath = (xpath) => {
    if (!xpath) {
      return false;
    }
    if (explicitIncludeSet.has(xpath)) {
      return true;
    }
    return explicitXpathSet.has(xpath);
  };
  const explicitIncludeElements = [];
  for (const xpath of explicitIncludeSet) {
    const el = getCachedElementFromXPath(xpath);
    if (el) {
      explicitIncludeElements.push(el);
    }
  }
  const isWithinExplicitIncludeXpath = (xpath) => {
    if (!xpath || explicitIncludeSet.size === 0) {
      return false;
    }
    for (const includeXpath of explicitIncludeSet) {
      if (includeXpath && includeXpath !== xpath && isXPathDescendant(includeXpath, xpath)) {
        return true;
      }
    }
    return false;
  };
  const isWithinExplicitInclude = (el) => {
    if (!el || explicitIncludeElements.length === 0) {
      return false;
    }
    for (const includeEl of explicitIncludeElements) {
      if (includeEl && includeEl !== el && includeEl.contains(el)) {
        return true;
      }
    }
    return false;
  };
  logTogglePerf("sync.entry-setup", entrySetupStartedAt, {
    previousItemCount: previousItems.length,
    xpathLookupCount
  });
  const items = [];
  const seen = new Set();
  const generatedExcludedSet = new Set();
  const candidateCollectionStartedAt = nowMs();
  const scannedCandidates = scanReconcileDocumentCandidates(immutableExcluded, excludedParents);
  const candidates = scannedCandidates.toggleableCandidates;
  logTogglePerf("sync.candidate-collection", candidateCollectionStartedAt, {
    candidateCount: candidates.length,
    excludedParentCount: excludedParents.size
  });
  logTogglePerf("sync.candidate-evaluation", candidateCollectionStartedAt, {
    visitedCount: scannedCandidates.stats.visitedCount,
    autoDefaultCount: scannedCandidates.stats.autoDefaultCount,
    autoDefaultElapsedMs: Number(scannedCandidates.stats.autoDefaultElapsedMs.toFixed(1)),
    selfMarkableCount: scannedCandidates.stats.selfMarkableCount,
    selfMarkableElapsedMs: Number(scannedCandidates.stats.selfMarkableElapsedMs.toFixed(1))
  });
  logTogglePerf("sync.candidate-self-markable", candidateCollectionStartedAt, {
    textualContainerElapsedMs: Number(scannedCandidates.stats.textualContainerElapsedMs.toFixed(1)),
    paintReachableElapsedMs: Number(scannedCandidates.stats.paintReachableElapsedMs.toFixed(1)),
    textualDescendantElapsedMs: Number(scannedCandidates.stats.textualDescendantElapsedMs.toFixed(1)),
    immutableTextualDescendantElapsedMs: Number(scannedCandidates.stats.immutableTextualDescendantElapsedMs.toFixed(1)),
    explicitMarkedDescendantElapsedMs: Number(scannedCandidates.stats.explicitMarkedDescendantElapsedMs.toFixed(1))
  });
  const candidateMergeStartedAt = nowMs();
  appendSyncedCandidateItems(candidates, {
    seen,
    generatedExcludedSet,
    explicitMarkedAncestorSet,
    explicitExcludeSet,
    explicitIncludeSet,
    explicitExcludeAncestorSet,
    excludedLookup,
    explicitXpathSet,
    getCachedElementFromXPath,
    items,
    previousSilentWhitespaceExcludedSet,
    isExplicitlyMarkedXpath,
    isWithinExplicitInclude,
    isWithinExplicitIncludeXpath
  });
  logTogglePerf("sync.candidate-merge", candidateMergeStartedAt, {
    candidateCount: candidates.length,
    itemCount: items.length
  });
  const currentExcludedXpaths = new Set(
    items
      .filter((item) => item && item.xpath && item.excluded)
      .map((item) => item.xpath)
  );
  const silentWhitespaceExcludedXpaths = [];
  const silentWhitespaceCollectionStartedAt = nowMs();
  const silentWhitespaceCandidates = collectSilentWhitespaceExclusionCandidates({
    excludedXpaths: currentExcludedXpaths,
    includeXpaths: explicitIncludeSet,
    prefetchedCandidates: scannedCandidates.silentWhitespaceCandidates
  });
  logTogglePerf("sync.silent-whitespace-collection", silentWhitespaceCollectionStartedAt, {
    candidateCount: silentWhitespaceCandidates.length,
    excludedCount: currentExcludedXpaths.size
  });
  const silentWhitespaceMergeStartedAt = nowMs();
  for (const el of silentWhitespaceCandidates) {
    const xpath = getXPath(el);
    if (!xpath || seen.has(xpath)) {
      continue;
    }
    if (isWithinExplicitExcludedXpath(xpath, currentExcludedXpaths)) {
      continue;
    }
    items.push({ xpath, excluded: true, explicit: true });
    seen.add(xpath);
    currentExcludedXpaths.add(xpath);
    silentWhitespaceExcludedXpaths.push(xpath);
  }
  logTogglePerf("sync.silent-whitespace-merge", silentWhitespaceMergeStartedAt, {
    candidateCount: silentWhitespaceCandidates.length,
    addedCount: silentWhitespaceExcludedXpaths.length
  });
  for (const item of previousItems) {
    if (!item || !item.xpath || !item.excluded || item.explicit !== true) {
      continue;
    }
    if (previousSilentWhitespaceExcludedSet.has(item.xpath)) {
      continue;
    }
    if (explicitIncludeSet.has(item.xpath)) {
      continue;
    }
    if (seen.has(item.xpath)) {
      continue;
    }
    if (isWithinExplicitExcludedXpath(item.xpath, explicitUserExcludeSet)) {
      continue;
    }
    const explicitEl = getCachedElementFromXPath(item.xpath);
    if (!explicitEl) {
      if (isWithinExplicitIncludeXpath(item.xpath)) {
        continue;
      }
      continue;
    }
    if (isWithinImmutableExcluded(explicitEl)) {
      continue;
    }
    if (isWithinExplicitInclude(explicitEl)) {
      continue;
    }
    items.push({ xpath: item.xpath, excluded: true, explicit: true });
    seen.add(item.xpath);
  }
  for (const item of previousItems) {
    if (!item || !item.xpath || item.excluded) {
      continue;
    }
    if (explicitIncludeSet.has(item.xpath)) {
      continue;
    }
    if (seen.has(item.xpath)) {
      continue;
    }
    const explicitEl = getCachedElementFromXPath(item.xpath);
    if (!explicitEl) {
      continue;
    }
    if (isWithinConsentElement(explicitEl)) {
      continue;
    }
    if (isWithinImmutableExcluded(explicitEl)) {
      continue;
    }
    if (isVisible(explicitEl)) {
      continue;
    }
    // Preserve hidden include choices so user overrides survive accordion-like visibility toggles.
    items.push({ xpath: item.xpath, excluded: false });
    seen.add(item.xpath);
  }
  const changed =
      items.length !== previousItems.length ||
      silentWhitespaceExcludedXpaths.length !== previousSilentWhitespaceExcludedSet.size ||
      silentWhitespaceExcludedXpaths.some((xpath) => !previousSilentWhitespaceExcludedSet.has(xpath)) ||
      items.some((item, index) => {
        const previous = previousItems[index];
        return (
            !previous ||
            previous.xpath !== item.xpath ||
            Boolean(previous.excluded) !== item.excluded ||
            (previous.explicit === true) !== (item.explicit === true)
        );
      });
  entry.xpaths = items;
  setEntrySilentWhitespaceExcludedXpaths(entry, silentWhitespaceExcludedXpaths);
  entry.title = normalizePageEntryTitle(document.title, pageUrl);
  if (!entry.renderedHtml) {
    entry.renderedHtml = "";
  }
  if (!entry.rawHtml) {
    entry.rawHtml = "";
  }
  if (changed) {
    touchPageEntryTimestamp(entry);
  } else if (!entry.timestamp) {
    entry.timestamp = normalizeEntryTimestampValue(entry.timestamp);
  }
  if (shouldPersist) {
    setPageMarkingEntry(config.pageMarkings, pageUrl, entry);
  }
  logTogglePerf("sync.total", syncStartedAt, { pageUrl });
  return { changed, entry, persisted: shouldPersist, hadEntry };
}

async function syncPageMarkingsInnerAsync(config, pageUrl, immutableExcluded, options) {
  const syncStartedAt = nowMs();
  const shouldAbort = options && typeof options.shouldAbort === "function"
    ? options.shouldAbort
    : null;
  const isAbortRequested = () => Boolean(shouldAbort && shouldAbort());
  if (!config || !pageUrl) {
    return { changed: false, entry: null, persisted: false, hadEntry: false, aborted: false };
  }
  const {
    allowCreate = true,
    persist = true
  } = options || {};
  const hadEntry = hasPageMarkingEntry(config, pageUrl);
  const shouldPersist = persist && (allowCreate || hadEntry);
  const entry = getPageMarkingEntry(config, pageUrl, {
    create: allowCreate || hadEntry,
    persist: false
  });
  const abortResult = () => ({ changed: false, entry, persisted: false, hadEntry, aborted: true });
  normalizePageEntryXpaths(entry);
  const entrySetupStartedAt = nowMs();
  const xpathElementCache = new Map();
  let xpathLookupCount = 0;
  const getCachedElementFromXPath = (value) => {
    if (typeof value !== "string" || !value) {
      return null;
    }
    if (xpathElementCache.has(value)) {
      return xpathElementCache.get(value);
    }
    xpathLookupCount += 1;
    const resolved = getElementFromXPath(value);
    xpathElementCache.set(value, resolved);
    return resolved;
  };
  const previousItems = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const {
    excludedLookup,
    explicitXpathSet,
    explicitExcludeSet,
    explicitUserExcludeSet,
    excludedParents
  } = collectReconcilePreviousItemState(previousItems, getCachedElementFromXPath);
  const previousSilentWhitespaceExcludedSet = new Set(
    collectSilentWhitespaceExcludedXPaths(entry)
  );
  const explicitExcludeAncestorSet = new Set();
  for (const xpath of explicitExcludeSet) {
    const explicitExcludedEl = getCachedElementFromXPath(xpath);
    let current = explicitExcludedEl && explicitExcludedEl.nodeType === 1
      ? explicitExcludedEl.parentElement
      : null;
    while (current && current.nodeType === 1) {
      explicitExcludeAncestorSet.add(current);
      current = current.parentElement;
    }
  }
  const rawIncludeXpaths = Array.isArray(entry.includeXpaths)
    ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
  const filteredIncludeXpaths = [];
  for (const xpath of rawIncludeXpaths) {
    const includeEl = getCachedElementFromXPath(xpath);
    if (!includeEl) {
      continue;
    }
    const includeEntry = {
      ...entry,
      includeXpaths: filteredIncludeXpaths
    };
    if (!canApplyExplicitInclude(includeEl, config, pageUrl, includeEntry)) {
      continue;
    }
    filteredIncludeXpaths.push(xpath);
  }
  const explicitIncludeSet = new Set(filteredIncludeXpaths);
  const explicitMarkedAncestorSet = new Set();
  const explicitMarkedXpaths = new Set([
    ...Array.from(excludedLookup.keys()),
    ...filteredIncludeXpaths
  ]);
  for (const xpath of explicitMarkedXpaths) {
    if (typeof xpath !== "string" || !xpath) {
      continue;
    }
    const explicitMarkedEl = getCachedElementFromXPath(xpath);
    let current = explicitMarkedEl && explicitMarkedEl.nodeType === 1
      ? explicitMarkedEl.parentElement
      : null;
    while (current && current.nodeType === 1) {
      explicitMarkedAncestorSet.add(current);
      current = current.parentElement;
    }
  }
  const isExplicitlyMarkedXpath = (xpath) => {
    if (!xpath) {
      return false;
    }
    if (explicitIncludeSet.has(xpath)) {
      return true;
    }
    return explicitXpathSet.has(xpath);
  };
  const explicitIncludeElements = [];
  for (const xpath of explicitIncludeSet) {
    const el = getCachedElementFromXPath(xpath);
    if (el) {
      explicitIncludeElements.push(el);
    }
  }
  const isWithinExplicitIncludeXpath = (xpath) => {
    if (!xpath || explicitIncludeSet.size === 0) {
      return false;
    }
    for (const includeXpath of explicitIncludeSet) {
      if (includeXpath && includeXpath !== xpath && isXPathDescendant(includeXpath, xpath)) {
        return true;
      }
    }
    return false;
  };
  const isWithinExplicitInclude = (el) => {
    if (!el || explicitIncludeElements.length === 0) {
      return false;
    }
    for (const includeEl of explicitIncludeElements) {
      if (includeEl && includeEl !== el && includeEl.contains(el)) {
        return true;
      }
    }
    return false;
  };
  logTogglePerf("sync.entry-setup", entrySetupStartedAt, {
    previousItemCount: previousItems.length,
    xpathLookupCount,
    async: true
  });
  const items = [];
  const seen = new Set();
  const generatedExcludedSet = new Set();
  const candidateCollectionStartedAt = nowMs();
  const scannedCandidates = await scanReconcileDocumentCandidatesAsync(immutableExcluded, excludedParents, {
    shouldAbort
  });
  const candidates = scannedCandidates.toggleableCandidates;
  logTogglePerf("sync.candidate-collection", candidateCollectionStartedAt, {
    candidateCount: candidates.length,
    excludedParentCount: excludedParents.size,
    async: true
  });
  logTogglePerf("sync.candidate-evaluation", candidateCollectionStartedAt, {
    visitedCount: scannedCandidates.stats.visitedCount,
    autoDefaultCount: scannedCandidates.stats.autoDefaultCount,
    autoDefaultElapsedMs: Number(scannedCandidates.stats.autoDefaultElapsedMs.toFixed(1)),
    selfMarkableCount: scannedCandidates.stats.selfMarkableCount,
    selfMarkableElapsedMs: Number(scannedCandidates.stats.selfMarkableElapsedMs.toFixed(1)),
    async: true
  });
  logTogglePerf("sync.candidate-self-markable", candidateCollectionStartedAt, {
    textualContainerElapsedMs: Number(scannedCandidates.stats.textualContainerElapsedMs.toFixed(1)),
    paintReachableElapsedMs: Number(scannedCandidates.stats.paintReachableElapsedMs.toFixed(1)),
    textualDescendantElapsedMs: Number(scannedCandidates.stats.textualDescendantElapsedMs.toFixed(1)),
    immutableTextualDescendantElapsedMs: Number(scannedCandidates.stats.immutableTextualDescendantElapsedMs.toFixed(1)),
    explicitMarkedDescendantElapsedMs: Number(scannedCandidates.stats.explicitMarkedDescendantElapsedMs.toFixed(1)),
    async: true
  });
  if (isAbortRequested()) {
    return abortResult();
  }
  const candidateMergeStartedAt = nowMs();
  const completedCandidates = await appendSyncedCandidateItemsAsync(candidates, {
    seen,
    generatedExcludedSet,
    explicitMarkedAncestorSet,
    explicitExcludeSet,
    explicitIncludeSet,
    explicitExcludeAncestorSet,
    excludedLookup,
    explicitXpathSet,
    getCachedElementFromXPath,
    items,
    previousSilentWhitespaceExcludedSet,
    isExplicitlyMarkedXpath,
    isWithinExplicitInclude,
    isWithinExplicitIncludeXpath
  }, {
    shouldAbort
  });
  logTogglePerf("sync.candidate-merge", candidateMergeStartedAt, {
    candidateCount: candidates.length,
    itemCount: items.length,
    async: true
  });
  if (!completedCandidates || isAbortRequested()) {
    return abortResult();
  }
  const currentExcludedXpaths = new Set(
    items
      .filter((item) => item && item.xpath && item.excluded)
      .map((item) => item.xpath)
  );
  const silentWhitespaceExcludedXpaths = [];
  const silentWhitespaceCollectionStartedAt = nowMs();
  const silentWhitespaceCandidates = collectSilentWhitespaceExclusionCandidates({
    excludedXpaths: currentExcludedXpaths,
    includeXpaths: explicitIncludeSet,
    prefetchedCandidates: scannedCandidates.silentWhitespaceCandidates
  });
  logTogglePerf("sync.silent-whitespace-collection", silentWhitespaceCollectionStartedAt, {
    candidateCount: silentWhitespaceCandidates.length,
    excludedCount: currentExcludedXpaths.size,
    async: true
  });
  const silentWhitespaceMergeStartedAt = nowMs();
  let lateLoopProcessedCount = 0;
  const maybeYieldLateReconcileLoop = async () => {
    lateLoopProcessedCount += 1;
    if (lateLoopProcessedCount < TOGGLE_RECONCILE_YIELD_INTERVAL) {
      return false;
    }
    lateLoopProcessedCount = 0;
    await yieldForToggleReconcileWork();
    return isAbortRequested();
  };
  for (const el of silentWhitespaceCandidates) {
    if (isAbortRequested()) {
      return abortResult();
    }
    const xpath = getXPath(el);
    if (!xpath || seen.has(xpath)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (isWithinExplicitExcludedXpath(xpath, currentExcludedXpaths)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    items.push({ xpath, excluded: true, explicit: true });
    seen.add(xpath);
    currentExcludedXpaths.add(xpath);
    silentWhitespaceExcludedXpaths.push(xpath);
    if (await maybeYieldLateReconcileLoop()) {
      return abortResult();
    }
  }
  logTogglePerf("sync.silent-whitespace-merge", silentWhitespaceMergeStartedAt, {
    candidateCount: silentWhitespaceCandidates.length,
    addedCount: silentWhitespaceExcludedXpaths.length,
    async: true
  });
  for (const item of previousItems) {
    if (isAbortRequested()) {
      return abortResult();
    }
    if (!item || !item.xpath || !item.excluded || item.explicit !== true) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (previousSilentWhitespaceExcludedSet.has(item.xpath)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (explicitIncludeSet.has(item.xpath)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (seen.has(item.xpath)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (isWithinExplicitExcludedXpath(item.xpath, explicitUserExcludeSet)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    const explicitEl = getCachedElementFromXPath(item.xpath);
    if (!explicitEl) {
      if (isWithinExplicitIncludeXpath(item.xpath)) {
        if (await maybeYieldLateReconcileLoop()) {
          return abortResult();
        }
        continue;
      }
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (isWithinImmutableExcluded(explicitEl)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (isWithinExplicitInclude(explicitEl)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    items.push({ xpath: item.xpath, excluded: true, explicit: true });
    seen.add(item.xpath);
    if (await maybeYieldLateReconcileLoop()) {
      return abortResult();
    }
  }
  for (const item of previousItems) {
    if (isAbortRequested()) {
      return abortResult();
    }
    if (!item || !item.xpath || item.excluded) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (explicitIncludeSet.has(item.xpath)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (seen.has(item.xpath)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    const explicitEl = getCachedElementFromXPath(item.xpath);
    if (!explicitEl) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (isWithinConsentElement(explicitEl)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (isWithinImmutableExcluded(explicitEl)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    if (isVisible(explicitEl)) {
      if (await maybeYieldLateReconcileLoop()) {
        return abortResult();
      }
      continue;
    }
    items.push({ xpath: item.xpath, excluded: false });
    seen.add(item.xpath);
    if (await maybeYieldLateReconcileLoop()) {
      return abortResult();
    }
  }
  const changed =
    items.length !== previousItems.length ||
    silentWhitespaceExcludedXpaths.length !== previousSilentWhitespaceExcludedSet.size ||
    silentWhitespaceExcludedXpaths.some((xpath) => !previousSilentWhitespaceExcludedSet.has(xpath)) ||
    items.some((item, index) => {
      const previous = previousItems[index];
      return (
        !previous ||
        previous.xpath !== item.xpath ||
        Boolean(previous.excluded) !== item.excluded ||
        (previous.explicit === true) !== (item.explicit === true)
      );
    });
  if (isAbortRequested()) {
    return abortResult();
  }
  entry.includeXpaths = filteredIncludeXpaths;
  entry.xpaths = items;
  setEntrySilentWhitespaceExcludedXpaths(entry, silentWhitespaceExcludedXpaths);
  entry.title = normalizePageEntryTitle(document.title, pageUrl);
  if (!entry.renderedHtml) {
    entry.renderedHtml = "";
  }
  if (!entry.rawHtml) {
    entry.rawHtml = "";
  }
  if (changed) {
    touchPageEntryTimestamp(entry);
  } else if (!entry.timestamp) {
    entry.timestamp = normalizeEntryTimestampValue(entry.timestamp);
  }
  if (shouldPersist) {
    setPageMarkingEntry(config.pageMarkings, pageUrl, entry);
  }
  logTogglePerf("sync.total", syncStartedAt, { pageUrl, async: true });
  return { changed, entry, persisted: shouldPersist, hadEntry, aborted: false };
}
