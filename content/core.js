import * as config from "../common/config.js";
import * as utils from "../common/utilities.js";
import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS
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
  getExplicitMarkingPresentation,
  isValidExpandedExclusionBoundary,
  shouldAllowExplicitIncludeDescendantTarget,
  shouldAutoSeedMarkingsFromAiSelectors,
  shouldSelfMarkToggleableDefaultBoundary
} from "./marking-rules.js";

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
  altPassThrough: false,
  altHeld: false,
  shiftHeld: false,
  lastPointer: null,
  markIdCounter: 1,
  markIds: new WeakMap(),
  markedElements: new Set(),
  renderRaf: 0,
  renderTimer: 0,
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
  disabledUnsavedDraft: null,
  consentSyncedPageUrl: "",
  consentRootElements: new Set(),
  initialized: false,
  layerBoxes: new WeakMap(),
  cachedCollections: null,
  visibilityCache: null,
  hoverRaf: 0,
  currentPageUrl: "",
  currentPageEntry: null,
  autoSeededPendingSavePageUrl: "",
  suppressNextAutoSeedFromAiSelectors: false
};

export const CONSENT_HIDDEN_ATTR = "data-uf-consent-hidden";
const CONSENT_BYPASS_STYLE_ID = "uf-consent-bypass";
const CONSENT_SELECTOR = REMOVABLE_ELEMENT_SELECTORS.join(",");
const SCROLL_DEBOUNCE_MS = 250;
const EXTENSION_SNAPSHOT_STRIP_SELECTORS = [
  "[data-uf-extension-ui=\"true\"]",
  "[id^=\"unfluffify-\"]",
  "#unfluffify-overlay",
  "#unfluffify-freeze-style",
  "#unfluffify-ai-popover-style",
  "#unfluffify-ai-preview-focus-style"
];
const EXTENSION_SNAPSHOT_ROOT_CLASSES = [
  "uf-cursor-exclude",
  "uf-cursor-include",
  "uf-cursor-passthrough"
];
const AI_PREVIEW_FOCUS_CLASS = "uf-ai-preview-focus-target";
const AI_PREVIEW_FOCUS_STYLE_ID = "unfluffify-ai-preview-focus-style";

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
      .map((item) => `${item.xpath}|${item.excluded ? "1" : "0"}`)
      .sort();
  const includeFingerprint = Array.isArray(entry.includeXpaths)
      ? entry.includeXpaths
          .filter((xpath) => typeof xpath === "string" && xpath)
          .map((xpath) => `include:${xpath}`)
          .sort()
      : [];
  const consentFingerprint = Array.isArray(entry.consentXpaths)
      ? entry.consentXpaths
          .filter((xpath) => typeof xpath === "string" && xpath)
          .map((xpath) => `consent:${xpath}`)
          .sort()
      : [];
  const pageTypeFingerprint = `pageType:${normalizePageEntryPageType(entry.pageType)}`;
  return xpathFingerprint.concat(includeFingerprint, consentFingerprint, pageTypeFingerprint);
}

function isClippedByOverflow(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  let parent = el.parentElement;
  while (parent && parent.nodeType === 1) {
    // Stop at body or document element
    if (parent === document.body || parent === document.documentElement) {
      break;
    }
    const parentStyle = window.getComputedStyle(parent);
    const overflow = parentStyle.overflow;
    const overflowX = parentStyle.overflowX;
    const overflowY = parentStyle.overflowY;

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

function isReachableInDocumentVisualArea(rect) {
  const documentRect = toDocumentCoordinateRect(rect);
  const documentBounds = getDocumentVisualBounds();
  return Boolean(intersectRects(documentRect, documentBounds));
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
  if (typeof target.contains === "function" && target.contains(element)) {
    return true;
  }
  if (typeof element.contains === "function" && element.contains(target)) {
    return true;
  }
  return false;
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
    const elementsAtPoint =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)].filter(Boolean);
    for (const hit of elementsAtPoint) {
      if (!hit || hit.nodeType !== 1 || isWithinExtensionUi(hit)) {
        continue;
      }
      if (isElementInHitPath(hit, el)) {
        return true;
      }
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
  return isReachableInDocumentVisualArea(visibleRect);
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
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      return true;
    }
  }
  return false;
}

function matchesToggleableDefaultExcluded(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  for (const selector of DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS) {
    try {
      if (isTagSelector(selector)) {
        if (el.tagName === selector.toUpperCase()) {
          return true;
        }
      } else if (el.matches(selector)) {
        return true;
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  return false;
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

function isTextualContainer(el, options = {}) {
  const ignoreVisibilityForInclusionDetection = Boolean(
    options && options.ignoreVisibilityForInclusionDetection
  );
  if (!ignoreVisibilityForInclusionDetection && !isVisible(el)) {
    return false;
  }
  if (hasDirectText(el)) {
    return true;
  }
  if (matchesToggleableDefaultExcluded(el)) {
    if (el.children.length > 0) {
      return true;
    }
    const nestedText = (el.innerText || "").replace(/\s+/g, " ").trim();
    return Boolean(nestedText);
  }
  return Boolean(getNormalizedElementText(el));
}

function hasTextualDescendant(el, options = {}) {
  if (!el || el.nodeType !== 1) {
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
    if (isTextualContainer(node, options)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function hasTextualImmutableDescendant(el, options = {}) {
  if (!el || el.nodeType !== 1) {
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
    if (isWithinImmutableExcluded(node) && isTextualContainer(node, options)) {
      return true;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
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
  if (!isTextualContainer(el, options)) {
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
  const hasVisibleTextualDescendant = hasTextualDescendant(el, descendantShapeOptions);
  if (!hasDirectOwnText && hasVisibleTextualDescendant) {
    return false;
  }
  if (!matchesToggleableDefaultExcluded(el)) {
    if (!hasDirectOwnText && !hasVisibleTextualDescendant) {
      return false;
    }
    if (!hasDirectOwnText && hasTextualImmutableDescendant(el, descendantShapeOptions)) {
      return false;
    }
    return true;
  }
  return shouldSelfMarkToggleableDefaultBoundary({
    hasDirectOwnText,
    hasVisibleTextualDescendant,
    hasExplicitlyMarkedDescendant: hasExplicitlyMarkedDescendant(el)
  });
}

function isExplicitIncludeBoundaryCandidate(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinImmutableExcluded(el)) {
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
  for (const selector of DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS) {
    try {
      if (isTagSelector(selector)) {
        if (el.tagName === selector.toUpperCase()) {
          return true;
        }
      } else if (el.matches(selector)) {
        return true;
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  return false;
}

function isWithinImmutableExcluded(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (matchesImmutableExcluded(node)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
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
    const isDefaultExcluded = matchesToggleableDefaultExcluded(el);
    if (item.excluded && !isDefaultExcluded) {
      return true;
    }
    if (!item.excluded && isDefaultExcluded) {
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

function collectToggleableTargets(immutableExcluded, excludedParents) {
  const results = [];
  if (!document.body) {
    return results;
  }
  const stack = [document.body];
  const hasExcludedParents = Boolean(excludedParents && excludedParents.size);
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
    if (hasExcludedParents && excludedParents.has(node)) {
      if (
        !isWithinImmutableExcluded(node) &&
        isTextualContainer(node) &&
        (
          matchesToggleableDefaultExcluded(node) ||
          isSelfMarkableWithoutParentMode(node)
        )
      ) {
        results.push(node);
      }
      continue;
    }
    if (hasExcludedParents && isWithinExcludedParents(node, excludedParents)) {
      continue;
    }
    if (immutableExcluded && immutableExcluded.has(node)) {
      continue;
    }
    if (
      !isWithinImmutableExcluded(node) &&
      (
        (matchesAutoToggleableDefaultExcluded(node) && isTextualContainer(node)) ||
        isSelfMarkableWithoutParentMode(node)
      )
    ) {
      results.push(node);
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return results;
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
          excludedAncestorSet.has(frame.node) ||
          excludedAncestorSet.has(child);
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

function collectSelectorElements(selectors) {
  const elements = new Set();
  for (const rawSelector of Array.isArray(selectors) ? selectors : []) {
    if (typeof rawSelector !== "string") {
      continue;
    }
    const selector = rawSelector.trim();
    if (!selector) {
      continue;
    }
    try {
      document.querySelectorAll(selector).forEach((el) => {
        elements.add(el);
      });
    } catch {
      // Ignore invalid selectors
    }
  }
  return elements;
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
  configValue.pageMarkings[pageUrl] = entry;
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

function collectToggleableDefaultExcludedElements(includedElements) {
  if (!document.body) {
    return [];
  }
  const results = [];
  const stack = [document.body];
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) {
      continue;
    }
    if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinExtensionUi(el)) {
      continue;
    }
    if (isWithinElementSet(el, includedElements)) {
      continue;
    }
    if (matchesImmutableExcluded(el)) {
      continue;
    }
    if (matchesAutoToggleableDefaultExcluded(el)) {
      results.push(el);
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
        getNormalizedElementText(el) ||
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
  const excludedElements = new Set(
    collapseElementsByNesting(collectSelectorElements(normalized.exclusionSelectors), {
      prefer: "shallowest"
    })
  );
  const rawIncludedElements = collectSelectorElements(normalized.inclusionSelectors);
  const includedElements = new Set();
  rawIncludedElements.forEach((el) => {
    if (el && el.nodeType === 1 && !isWithinConsentElement(el)) {
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
    explicitIncludedSet.has(el) ||
    hasRenderableTextForHighlight(
      el,
      excludedElements,
      includedElements,
      inclusionContextSet,
      options
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
  const list = Array.from(elements || []).filter((el) => {
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
    for (const candidate of reverseSorted) {
      const isAncestorOfKept = keptDeep.some((el) => candidate.contains(el));
      if (!isAncestorOfKept) {
        keptDeep.push(candidate);
      }
    }
    keptDeep.sort(compareDocumentOrder);
    return keptDeep;
  }
  const kept = [];
  for (const candidate of list) {
    const hasAncestor = kept.some((ancestor) => ancestor.contains(candidate));
    if (!hasAncestor) {
      kept.push(candidate);
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
    normalized.unshift({ xpath, excluded: Boolean(item.excluded) });
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
  entry.title = normalizePageEntryTitle(entry.title);
  entry.pageType = normalizePageEntryPageType(entry.pageType);
  entry.xpaths = normalizeXPathItems(entry.xpaths);
  entry.includeXpaths = normalizeXPathList(entry.includeXpaths);
  entry.consentXpaths = normalizeXPathList(entry.consentXpaths);
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
  const extraStripSelectors = Array.isArray(options.extraStripSelectors)
    ? options.extraStripSelectors.filter((value) => typeof value === "string" && value)
    : [];
  const stripSelectors = EXTENSION_SNAPSHOT_STRIP_SELECTORS.concat(extraStripSelectors);
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
      if (parent && getNormalizedElementText(parent)) {
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

function isXpathWithinExplicitInclude(xpath, includeSet) {
  if (!xpath || !includeSet || includeSet.size === 0) {
    return false;
  }
  for (const includeXpath of includeSet) {
    if (includeXpath && includeXpath !== xpath && isXPathDescendant(includeXpath, xpath)) {
      return true;
    }
  }
  return false;
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
      #unfluffify-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483646;
        pointer-events: auto;
      }
      #unfluffify-overlay .uf-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #unfluffify-overlay .uf-layer[data-layer="ghost"] { z-index: 1; }
      #unfluffify-overlay .uf-layer[data-layer="hard"] { z-index: 2; }
      #unfluffify-overlay .uf-layer[data-layer="default"] { z-index: 3; }
      #unfluffify-overlay .uf-layer[data-layer="ai-content-excluded"] { z-index: 4; }
      #unfluffify-overlay .uf-layer[data-layer="explicit-exclude"] { z-index: 5; }
      #unfluffify-overlay .uf-layer[data-layer="ai-content"] { z-index: 6; }
      #unfluffify-overlay .uf-layer[data-layer="explicit-include"] { z-index: 7; }
      #unfluffify-overlay .uf-layer[data-layer="focus"] { z-index: 8; }
      #unfluffify-overlay .uf-layer[data-layer="hover"] { z-index: 9; }
      #unfluffify-overlay.uf-scrolling .uf-layer {
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
      #unfluffify-overlay .uf-hard-toggle {
        border: 2px solid #b71c1c;
        background: rgba(183, 28, 28, 0.12);
      }
      #unfluffify-overlay .uf-hard-locked {
        border: 1px dashed rgba(156, 107, 107, 0.45);
        background: transparent;
      }
      #unfluffify-overlay .uf-ghost-exclude {
        border: 2px dashed rgba(198, 40, 40, 0.45);
        background: transparent;
        opacity: 0.55;
      }
      #unfluffify-overlay .uf-ghost-include {
        border: 2px dotted rgba(46, 125, 50, 0.45);
        background: transparent;
        opacity: 0.55;
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
      #unfluffify-overlay .uf-ai-content-excluded {
        border: 3px solid #c62828;
        background: rgba(198, 40, 40, 0.2);
      }
      #unfluffify-overlay .uf-explicit-include {
        border: 3px solid #1b5e20;
        background: rgba(27, 94, 32, 0.2);
      }
      #unfluffify-overlay .uf-explicit-exclude {
        border: 3px solid #c62828;
        background: rgba(198, 40, 40, 0.2);
      }
      #unfluffify-overlay .uf-toast {
        position: fixed;
        left: 14px;
        right: 14px;
        bottom: 14px;
        padding: 10px 12px;
        background: rgba(47, 42, 36, 0.9);
        color: #fdf6ed;
        font-family: "Palatino Linotype", "Book Antiqua", Palatino, serif;
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
    `;
  (document.body || document.documentElement).appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "unfluffify-overlay";

  const layerKeys = [
    "ghost",
    "hard",
    "explicit-exclude",
    "explicit-include",
    "ai-content",
    "ai-content-excluded",
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

  overlay.addEventListener("mousemove", handleMouseMove, true);
  overlay.addEventListener("click", handleClick, true);
  overlay.addEventListener("contextmenu", handleContextMenu, true);
  (document.body || document.documentElement).appendChild(overlay);
  state.overlay = overlay;
  updateAltPassThroughFromModifiers();
  updateCursorMode();

  window.addEventListener("keydown", handleKeydown, true);
  window.addEventListener("click", handleAltClick, true);
  window.addEventListener("keyup", handleKeyup, true);
  window.addEventListener("blur", handleWindowBlur, true);
  document.addEventListener("visibilitychange", handleVisibilityChange, true);
  updateOverlayGutter();
}


function removeOverlay() {
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
  }
  state.lastPointer = null;
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
  clearTimeout(state.toastHideTimer);
  state.toastHideTimer = setTimeout(() => {
    if (state.toast) {
      state.toast.classList.remove("uf-toast-show");
    }
  }, 1800);
}

function getMarkMode() {
  if (!state.enabled || !state.overlay) {
    return "disabled";
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
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.classList.remove(
    "uf-cursor-exclude",
    "uf-cursor-include",
    "uf-cursor-passthrough"
  );
}

function updateCursorMode() {
  clearCursorMode();
  const root = document.documentElement;
  if (!root) {
    return;
  }
  const mode = getMarkMode();
  if (mode === "exclude") {
    root.classList.add("uf-cursor-exclude");
  } else if (mode === "include") {
    root.classList.add("uf-cursor-include");
  }
}

function updateAltPassThroughFromModifiers() {
  if (state.altPassThrough) {
    setAltPassThrough(false);
  }
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
        font-family: Arial, sans-serif;
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
      chrome.runtime.sendMessage({ type: "aiPreviewClosed" }).then().catch(() => {
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
  const immutableExcluded = collectImmutableElements();
  syncPageMarkings(configValue, pageUrl, immutableExcluded);
  const entry = getPageMarkingEntry(configValue, pageUrl);
  const snapshot = createSanitizedPageSnapshot({
    renderMode: config.getConfigRenderMode(configValue)
  });
  entry.renderedHtml = snapshot.renderedHtml;
  entry.title = normalizePageEntryTitle(document.title, pageUrl);
  configValue.pageMarkings[pageUrl] = entry;
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

function hasMultipleMarkableDescendants(el) {
  const options = arguments.length > 1 && arguments[1] ? arguments[1] : {};
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(el.children);
  let markableCount = 0;
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
      markableCount += 1;
      if (isValidExpandedExclusionBoundary({
        hasDirectOwnText: hasDirectText(el),
        textualDescendantCount: markableCount
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

function isPointOverMarkableDescendant(el, options = {}) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  const hitPoint = options && options.hitPoint;
  if (
    !hitPoint ||
    !Number.isFinite(Number(hitPoint.x)) ||
    !Number.isFinite(Number(hitPoint.y)) ||
    typeof document.elementsFromPoint !== "function"
  ) {
    return true;
  }
  const descendantOptions = {
    ...options,
    allowParent: false,
    explicitlyExcluded: false,
    explicitlyIncluded: false
  };
  const elements = document.elementsFromPoint(Number(hitPoint.x), Number(hitPoint.y));
  for (const node of elements) {
    if (!node || node.nodeType !== 1 || node === el) {
      continue;
    }
    if (node === document.documentElement || node === document.body) {
      continue;
    }
    if (!el.contains(node)) {
      continue;
    }
    if (isWithinAiPopover(node) || isWithinConsentElement(node) || isWithinImmutableExcluded(node)) {
      continue;
    }
    if (isSelfMarkableWithoutParentMode(node, descendantOptions)) {
      return true;
    }
    if (matchesToggleableDefaultExcluded(node) && isTextualContainer(node, descendantOptions)) {
      return true;
    }
    if (isStructuredGroupExclusionCandidate(node, descendantOptions)) {
      return true;
    }
  }
  return false;
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

function getMarkableTarget(x, y, options) {
  const allowParent = options && options.allowParent;
  const allowExplicitTarget = options && options.allowExplicitTarget;
  const preferExplicitTarget = !options || options.preferExplicitTarget !== false;
  const preferMixedTextAncestor = Boolean(options && options.preferMixedTextAncestor);
  const excludedSet = options && options.excludedSet;
  const includeSet = options && options.includeSet;
  const explicitParentSet = options && options.explicitParentSet;
  const allowExcludedParentChildren = options && options.allowExcludedParentChildren;
  const allowImmutableChildren = options && options.allowImmutableChildren;
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
        xpath && excludedSet && excludedSet.size > 0 && excludedSet.has(xpath);
      const explicitlyIncluded =
        xpath && includeSet && includeSet.size > 0 && includeSet.has(xpath);
      const withinExplicitIncludedParent =
        xpath && includeSet && includeSet.size > 0 && isXpathWithinExplicitInclude(xpath, includeSet);
      const withinExplicitExcludedParent =
        !allowExcludedParentChildren &&
        xpath &&
        explicitParentSet &&
        explicitParentSet.size > 0 &&
        isWithinExplicitExcludedXpath(xpath, explicitParentSet);
      if (!shouldAllowExplicitIncludeDescendantTarget({
        insideExplicitIncludeAncestor: withinExplicitIncludedParent,
        isExactExplicitInclude: explicitlyIncluded
      })) {
        continue;
      }
      if (withinExplicitExcludedParent && !explicitlyIncluded) {
        continue;
      }
      if (
        explicitlyExcluded ||
        explicitlyIncluded
      ) {
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
        allowExplicitTarget && isExplicitlyExcludedElement(el, excludedSet);
    const explicitlyIncluded =
        allowExplicitTarget && isExplicitlyIncludedElement(el, includeSet);
    const xpath = includeSet && includeSet.size > 0 ? getXPath(el) : "";
    if (!shouldAllowExplicitIncludeDescendantTarget({
      insideExplicitIncludeAncestor: isXpathWithinExplicitInclude(xpath, includeSet),
      isExactExplicitInclude: Boolean(xpath && includeSet && includeSet.has(xpath))
    })) {
      continue;
    }
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
  const layerState = beginLayerRender(layerHover);
  const explicitParentSet = getExcludedXPathSet(state.config, location.href);
  const excludedSet =
    allowParent || allowExcludedParentChildren ? null : explicitParentSet;
  const includeSet = getIncludeXPathSet(state.config, location.href);
  const target = getMarkableTarget(x, y, {
    allowParent,
    allowExplicitTarget: true,
    preferExplicitTarget: allowExcludedParentChildren,
    preferMixedTextAncestor: allowExcludedParentChildren && !allowParent,
    excludedSet,
    includeSet,
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
}

function refreshHoverHighlight() {
  if (!state.enabled || state.altPassThrough) {
    return;
  }
  const layerHover = state.layers["hover"];
  if (!layerHover) {
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
  state.hoverRaf = window.requestAnimationFrame(() => {
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

function toggleExplicitExclude(target) {
  if (!state.baseUrl || !state.config) {
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

  const config = state.config;
  const entry = getPageMarkingEntry(config, location.href);
  const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
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
    config.pageMarkings[location.href] = entry;
    state.config = config;
    scheduleRender();
    scheduleSnapshotSave();
    notifyDraftStatus(location.href);
    scheduleDraftPersist(state.baseUrl);
    return;
  }
  const cleanupHierarchy = (currentXPath) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!item || !item.xpath || item.xpath === currentXPath) {
        continue;
      }
      const existingEl = getElementFromXPath(item.xpath);
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
      : getElementFromXPath(currentXPath);
    for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
      const includeXPath = includeXpaths[i];
      if (!includeXPath || includeXPath === currentXPath) {
        continue;
      }
      const includeEl = getElementFromXPath(includeXPath);
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
      const itemEl = getElementFromXPath(item.xpath);
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
      const existingEl = getElementFromXPath(item.xpath);
      if (
        (existingEl && existingEl.contains(target)) ||
        (!existingEl && isXPathDescendant(item.xpath, currentXPath))
      ) {
        cleanupDescendantIncludeOverrides(item.xpath, existingEl);
        items.splice(i, 1);
      }
    }
  };
  const cleanupIncludeHierarchy = (currentXPath) => {
    for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
      const includeXPath = includeXpaths[i];
      if (!includeXPath) {
        continue;
      }
      const includeEl = getElementFromXPath(includeXPath);
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
      const itemEl = getElementFromXPath(item.xpath);
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
    targetItem = { xpath, excluded: true };
    items.push(targetItem);
    addedExclude = true;
  } else {
    targetItem.excluded = !targetItem.excluded;
    addedExclude = targetItem.excluded;
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
  config.pageMarkings[location.href] = entry;
  state.config = config;
  scheduleRender();
  scheduleSnapshotSave();
  notifyDraftStatus(location.href);
  scheduleDraftPersist(state.baseUrl);
}

function toggleExplicitInclude(target) {
  if (!state.baseUrl || !state.config) {
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

  const config = state.config;
  const entry = getPageMarkingEntry(config, location.href);
  const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
  const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const targetItemIndex = items.findIndex((item) => item && item.xpath === xpath);
  const targetItem = targetItemIndex >= 0 ? items[targetItemIndex] : null;
  let convertedFromExcluded = false;
  if (targetItem && targetItem.excluded) {
    if (!canApplyExplicitInclude(target, state.config, location.href, entry)) {
      // If the target is no longer include-eligible, Alt acts as an unmark for the exclusion.
      targetItem.excluded = false;
      for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
        if (includeXpaths[i] === xpath) {
          includeXpaths.splice(i, 1);
        }
      }
      entry.includeXpaths = includeXpaths;
      entry.xpaths = items;
      touchPageEntryTimestamp(entry);
      normalizePageEntryXpaths(entry);
      config.pageMarkings[location.href] = entry;
      state.config = config;
      scheduleRender();
      scheduleSnapshotSave();
      notifyDraftStatus(location.href);
      scheduleDraftPersist(state.baseUrl);
      return;
    }
    if (matchesToggleableDefaultExcluded(target)) {
      targetItem.excluded = false;
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
        const existingEl = getElementFromXPath(item.xpath);
        if (existingEl ? target.contains(existingEl) : isXPathDescendant(xpath, item.xpath)) {
          items.splice(i, 1);
        }
      }
      for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
        const childXpath = includeXpaths[i];
        if (!childXpath || childXpath === xpath) {
          continue;
        }
        const existingEl = getElementFromXPath(childXpath);
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
  config.pageMarkings[location.href] = entry;
  state.config = config;
  scheduleRender();
  scheduleSnapshotSave();
  notifyDraftStatus(location.href);
  scheduleDraftPersist(state.baseUrl);
}

function handleToggleEvent(event) {
  if (!state.enabled) {
    return;
  }
  syncModifierState(event);
  const mode = getMarkModeFromEvent(event);
  event.preventDefault();
  event.stopPropagation();
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
  const target = getMarkableTarget(event.clientX, event.clientY, {
    allowParent,
    allowExplicitTarget: true,
    preferExplicitTarget: mode === "include",
    preferMixedTextAncestor: mode === "include" && !allowParent,
    excludedSet,
    includeSet,
    explicitParentSet,
    allowExcludedParentChildren,
    allowImmutableChildren,
    requireExcludedAncestor: false
  });
  if (target) {
    if (mode === "include") {
      toggleExplicitInclude(target);
    } else {
      toggleExplicitExclude(target);
    }
  }
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
  if (event.key !== "Alt" && event.key !== "Shift") {
    return;
  }
  syncModifierState(event);
}

function handleKeyup(event) {
  if (!state.enabled) {
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
  if (!getNormalizedElementText(el)) {
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
  const allowCollapsedTextFallback = Boolean(getNormalizedElementText(el));
  if (!isVisible(el) && !allowCollapsedTextFallback) {
    return [];
  }
  const visibleRects = collectRectsFromClientRects(el.getClientRects());
  if (visibleRects.length > 0) {
    return visibleRects;
  }
  if (allowCollapsedTextFallback) {
    return getCollapsedTextualFallbackRects(el);
  }
  return [];
}

function invalidateCachedCollections() {
  state.cachedCollections = null;
}

function renderHighlights() {
  if (!state.enabled || !state.overlay) {
    return;
  }

  state.visibilityCache = new Map();
  try {
    renderHighlightsInner();
  } finally {
    state.visibilityCache = null;
  }
}

function renderHighlightsInner() {
  updateOverlayGutter();
  state.currentPageUrl = location.href;

  const cached = state.cachedCollections;
  if (cached) {
    repositionHighlights(cached);
    return;
  }

  const immutableExcluded = collectImmutableElements();
  const pageUrl = location.href;
  const normalizedAiSelectorSet = config.getNewestConfigSelectorSet(state.config).selectorSet;
  const hasAiSelectors = combineAiSelectorSet(normalizedAiSelectorSet).length > 0;
  const existingPageEntry =
    state.config &&
    state.config.pageMarkings &&
    typeof state.config.pageMarkings === "object"
      ? state.config.pageMarkings[pageUrl] || null
      : null;
  const hasSavedMarkingsForPage = hasExplicitUserMarkings(existingPageEntry);
  let hasEntry = hasPageMarkingEntry(state.config, pageUrl);
  let autoSeededFromAiSelectors = false;
  const suppressAutoSeedFromAiSelectors = Boolean(
    state.suppressNextAutoSeedFromAiSelectors
  );
  state.suppressNextAutoSeedFromAiSelectors = false;
  if (shouldAutoSeedMarkingsFromAiSelectors({
    hasAiSelectors,
    hasSavedMarkingsForPage,
    suppressAutoSeed: suppressAutoSeedFromAiSelectors
  })) {
    const seeded = seedMarkingsFromAiSelectorsForUnmarkedPage(
      state.config,
      pageUrl,
      normalizedAiSelectorSet,
      immutableExcluded
    );
    if (seeded.createdEntry) {
      hasEntry = true;
      autoSeededFromAiSelectors = true;
    }
  }
  const syncResult = syncPageMarkings(state.config, pageUrl, immutableExcluded, {
    allowCreate: hasEntry,
    persist: hasEntry
  });
  const entry =
      syncResult.entry || getPageMarkingEntry(state.config, pageUrl, { create: false });
  state.currentPageEntry = entry || null;
  const explicitExclude = collectXPathElements(
      collectExcludedXPaths(entry.xpaths)
  );
  const explicitInclude = collectXPathElements(entry.includeXpaths);
  const consentExcluded = collectConsentExcludedElements();
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
      { skipExplicitExcludedUnlessIncluded = false, skipExplicitIncluded = false } = {}
  ) => {
    if (!el || el.nodeType !== 1) {
      return true;
    }
    if (isWithinElementSet(el, immutableExcluded) || isWithinElementSet(el, consentExcluded)) {
      return true;
    }
    if (skipExplicitExcludedUnlessIncluded
        && isWithinElementSet(el, explicitExclude)
        && !isWithinExplicitInclude(el)) {
      return true;
    }
    if (skipExplicitIncluded && isWithinExplicitInclude(el)) {
      return true;
    }
    return false;
  };
  let aiContent = new Set();
  let aiExcludedDescendants = new Set();
  if (hasAiSelectors) {
    const aiCollections = collectIncludedElementsFromSelectorSet(normalizedAiSelectorSet, {
      ignoreVisibilityForInclusionDetection: true,
      preserveExplicitIncludedDescendants: true,
      includeAllExplicitMatches: true
    });
    for (const el of aiCollections.included || []) {
      if (shouldSkipAiCollectionElement(el, { skipExplicitExcludedUnlessIncluded: true })) {
        continue;
      }
      aiContent.add(el);
    }
    for (const el of aiCollections.excluded || []) {
      if (shouldSkipAiCollectionElement(el, { skipExplicitIncluded: true })) {
        continue;
      }
      aiExcludedDescendants.add(el);
    }
    for (const el of explicitInclude) {
      if (shouldSkipAiCollectionElement(el)) {
        continue;
      }
      aiContent.add(el);
    }
  }
  const precedenceSet = new Set([
    ...immutableExcluded,
    ...consentExcluded,
    ...explicitExclude,
    ...explicitInclude,
    ...aiContent,
    ...aiExcludedDescendants
  ]);
  const hasHigherPrecedence = (el) => precedenceSet.has(el);

  const hiddenStoredExplicitExclude = [];
  const filteredExplicitExclude = [];
  for (const el of explicitExclude) {
    if (consentExcluded.has(el) || isWithinElementSet(el, consentExcluded)) {
      continue;
    }
    if (isWithinExplicitInclude(el)) {
      continue;
    }
    if (!isVisible(el)) {
      hiddenStoredExplicitExclude.push(el);
      continue;
    }
    if (!immutableExcluded.has(el)) {
      filteredExplicitExclude.push(el);
    }
  }

  const hiddenStoredExplicitInclude = [];
  const filteredExplicitInclude = [];
  for (const el of explicitInclude) {
    if (
      !immutableExcluded.has(el) &&
      !consentExcluded.has(el) &&
      !isWithinElementSet(el, consentExcluded) &&
      !explicitExclude.has(el)
    ) {
      if (!isVisible(el)) {
        hiddenStoredExplicitInclude.push(el);
        continue;
      }
      filteredExplicitInclude.push(el);
    }
  }
  const aiAnimatedExplicitIncludeElements = hasAiSelectors
    ? filteredExplicitInclude.filter((el) => aiContent.has(el))
    : [];

  // Hidden explicit excludes render below in ghostExcludeElements, not as hard exclusions.
  const hardExcludedSet = new Set([
    ...immutableExcluded
  ]);

  const defaultTargets = collectDefaultHighlightTargets(document.body, {
    excludedSet: precedenceSet,
    hardExcludedSet,
    hasHigherPrecedence,
    excludedAncestorSet: new Set([
      ...hardExcludedSet,
      ...consentExcluded,
      ...explicitExclude,
      ...aiExcludedDescendants,
      ...explicitInclude,
      ...aiContent
    ])
  });

  const collections = {
    ghostExcludeElements: hiddenStoredExplicitExclude.filter((el) =>
      hasRenderableTextForHighlight(el, null, null, null)
    ),
    ghostIncludeElements: hiddenStoredExplicitInclude.filter((el) =>
      hasRenderableTextForHighlight(el, null, null, null)
    ),
    hardElements: Array.from(hardExcludedSet).filter((el) =>
      !isWithinElementSet(el, consentExcluded) &&
      hasRenderableTextForHighlight(el, null, null, null)
    ),
    explicitExcludeElements: filteredExplicitExclude,
    explicitIncludeElements: filteredExplicitInclude,
    aiAnimatedExplicitIncludeElements,
    aiContentElements: Array.from(aiContent),
    aiContentExcludedElements: Array.from(aiExcludedDescendants),
    defaultElements: defaultTargets
  };
  state.cachedCollections = collections;

  if (autoSeededFromAiSelectors) {
    state.autoSeededPendingSavePageUrl = pageUrl;
    scheduleSnapshotSave();
    notifyDraftStatus(pageUrl);
  }

  drawCollections(collections, getVisibleRects);
}

function getRectsInViewport(el) {
  const visibleRects = collectRectsFromClientRects(el.getClientRects());
  if (visibleRects.length > 0) {
    return visibleRects;
  }
  if (getNormalizedElementText(el)) {
    return getCollapsedTextualFallbackRects(el);
  }
  return [];
}

function repositionHighlights(collections) {
  drawCollections(collections, getRectsInViewport);
}

function drawCollections(collections, getRects) {
  const layerGhostState = beginLayerRender(state.layers["ghost"]);
  const layerHardState = beginLayerRender(state.layers["hard"]);
  const layerExplicitExcludeState = beginLayerRender(state.layers["explicit-exclude"]);
  const layerExplicitIncludeState = beginLayerRender(state.layers["explicit-include"]);
  const layerAiContentState = beginLayerRender(state.layers["ai-content"]);
  const layerAiContentExcludedState = beginLayerRender(state.layers["ai-content-excluded"]);
  const layerDefaultState = beginLayerRender(state.layers["default"]);
  const markedElements = new Set();

  for (const el of collections.ghostExcludeElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "exclude", visible: false });
      drawMultiRectReuse(
        layerGhostState, rects, presentation.className, el, "ghost-exclude", null
      );
    }
  }

  for (const el of collections.ghostIncludeElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include", visible: false });
      drawMultiRectReuse(
        layerGhostState, rects, presentation.className, el, "ghost-include", null
      );
    }
  }

  for (const el of collections.hardElements) {
    const rects = getRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerHardState, rects, "uf-hard-locked", el, "immutable", markedElements
      );
    }
  }

  for (const el of collections.explicitExcludeElements) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "exclude", visible: true });
      drawMultiRectReuse(
        layerExplicitExcludeState,
        rects,
        presentation.className,
        el,
        "explicit-exclude",
        markedElements
      );
    }
  }

  for (const el of collections.explicitIncludeElements) {
    const rects = getRects(el);
    if (rects.length > 0) {
      const presentation = getExplicitMarkingPresentation({ type: "include", visible: true });
      drawMultiRectReuse(
        layerExplicitIncludeState,
        rects,
        presentation.className,
        el,
        "explicit-include",
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

  for (const el of collections.aiContentExcludedElements || []) {
    const rects = getRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerAiContentExcludedState,
        rects,
        "uf-ai-content-excluded",
        el,
        "ai-content-excluded",
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

  finalizeLayerRender(layerGhostState);
  finalizeLayerRender(layerHardState);
  finalizeLayerRender(layerExplicitExcludeState);
  finalizeLayerRender(layerExplicitIncludeState);
  finalizeLayerRender(layerAiContentState);
  finalizeLayerRender(layerAiContentExcludedState);
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
      const renderMode = getMutationRenderMode(mutations);
      if (renderMode === "none") {
        return;
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

function startUrlWatcher() {
  if (state.urlCheckTimer) {
    return;
  }
  let lastUrl = location.href;
  state.urlCheckTimer = window.setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Page-scoped behavior: disable extension on any URL change
      disable();
      window.dispatchEvent(new Event("unfluffify:url-changed"));
    }
  }, 800);
}

function stopUrlWatcher() {
  if (state.urlCheckTimer) {
    window.clearInterval(state.urlCheckTimer);
    state.urlCheckTimer = 0;
  }
}

export function hideConsentElements(storedXpaths = null) {
  if (Array.isArray(storedXpaths) && storedXpaths.length) {
    const removedXpaths = removeConsentElements(storedXpaths);
    if (removedXpaths.length > 0) {
      restorePageScrolling();
    }
    return removedXpaths.length;
  }
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

function removeConsentElements(storedXpaths) {
  const removedSet = new Set();
  const removedXpaths = [];
  const recordRemoved = (xpath) => {
    if (typeof xpath !== "string" || !xpath || removedSet.has(xpath)) {
      return;
    }
    removedSet.add(xpath);
    removedXpaths.push(xpath);
  };
  try {
    if (Array.isArray(storedXpaths)) {
      storedXpaths.forEach((xpath) => {
        if (typeof xpath !== "string" || !xpath) {
          return;
        }
        const element = getElementFromXPath(xpath);
        if (element) {
          if (hideConsentElement(element)) {
            recordRemoved(xpath);
          }
        }
      });
    }

    const elements = Array.from(document.querySelectorAll(CONSENT_SELECTOR));
    elements
      .filter((element) => typeof element.parentElement !== "undefined")
      .map((element) => ({ element, xpath: getXPath(element) }))
      .filter(({ element, xpath }) => element && xpath)
      .forEach(({ element, xpath }) => {
        if (hideConsentElement(element)) {
          recordRemoved(xpath);
        }
      });

    if (removedXpaths.length > 0) {
      console.log(`Hidden ${removedXpaths.length} consent UI elements from DOM`);
    }
  } catch (error) {
    console.log("Error removing elements:", error);
  }

  return removedXpaths;
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

    if (overflowBlocked || overflowXBlocked || overflowYBlocked || positionBlocked) {
      console.log("Restored scrolling on", element.tagName);
    }
  });
}

function normalizeConsentXpaths(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const xpath of list) {
    if (typeof xpath !== "string" || !xpath) {
      continue;
    }
    if (seen.has(xpath)) {
      continue;
    }
    seen.add(xpath);
    result.push(xpath);
  }
  return result;
}

function syncConsentOnEnable(pageUrl, hasSavedEntry) {
  if (!pageUrl || state.consentSyncedPageUrl === pageUrl) {
    return;
  }
  state.consentSyncedPageUrl = pageUrl;
  const storedEntry =
    state.config &&
    state.config.pageMarkings &&
    state.config.pageMarkings[pageUrl];
  const storedConsentXpaths =
    storedEntry && Array.isArray(storedEntry.consentXpaths)
      ? storedEntry.consentXpaths
      : [];
  const removedConsentXpaths = removeConsentElements(storedConsentXpaths);
  if (removedConsentXpaths.length > 0) {
    restorePageScrolling();
  }
  syncConsentXpaths(pageUrl, removedConsentXpaths, {
    notifyOnChange: hasSavedEntry
  });
}

function syncConsentXpaths(pageUrl, consentXpaths, options) {
  if (!state.enabled || !state.config || !pageUrl) {
    return false;
  }
  const { notifyOnChange = true } = options || {};
  const normalized = normalizeConsentXpaths(consentXpaths);
  const hadEntry = hasPageMarkingEntry(state.config, pageUrl);
  if (!hadEntry && normalized.length === 0) {
    return false;
  }
  const entry = getPageMarkingEntry(state.config, pageUrl, {
    create: hadEntry || normalized.length > 0,
    persist: hadEntry || normalized.length > 0
  });
  const previous = Array.isArray(entry.consentXpaths) ? entry.consentXpaths : [];
  const changed =
    previous.length !== normalized.length ||
    previous.some((xpath, index) => xpath !== normalized[index]);
  if (!changed) {
    return false;
  }
  entry.consentXpaths = normalized;
  touchPageEntryTimestamp(entry);
  state.config.pageMarkings[pageUrl] = entry;
  if (notifyOnChange) {
    notifyDraftStatus(pageUrl);
    chrome.runtime.sendMessage({
      type: "consentXpathsChanged",
      baseUrl: state.baseUrl,
      pageUrl
    }).then();
  }
  return true;
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
  const draft = getDraftPageEntry(pageUrl);
  const saved = getSavedPageEntry(pageUrl);
  return !areEntriesEquivalent(draft, saved);
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
    consentXpaths: Array.isArray(entry.consentXpaths) ? entry.consentXpaths : [],
    includeXpaths: Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [],
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

export function scheduleSnapshotSave() {
  if (!state.baseUrl || !state.config) {
    return;
  }
  if (state.snapshotTimer) {
    window.clearTimeout(state.snapshotTimer);
  }
  state.snapshotTimer = window.setTimeout(() => {
    state.snapshotTimer = 0;
    if (!state.baseUrl || !state.config) {
      return;
    }
    recordPageSnapshot(state.config, location.href);
  }, 220);
}

export function scheduleDraftPersist(baseUrl = state.baseUrl, delayMs = 220) {
  const targetBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!targetBaseUrl || !state.config) {
    return;
  }
  if (state.draftPersistTimer) {
    window.clearTimeout(state.draftPersistTimer);
  }
  state.draftPersistTimer = window.setTimeout(() => {
    state.draftPersistTimer = 0;
    if (!targetBaseUrl || !state.config) {
      return;
    }
    saveConfig(targetBaseUrl, state.config).catch(() => {
      // Keep manual marking responsive; persistence failures are non-blocking.
    });
  }, Math.max(0, Math.trunc(delayMs)));
}

function setAltPassThrough(enabled) {
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
}

export function isMarkableElement(el, config, options) {
  if (!config) {
    return false;
  }
  if (isWithinAiPopover(el)) {
    return false;
  }
  if (isWithinConsentElement(el)) {
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
  if (!isPointOverMarkableDescendant(el, options || {})) {
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
  if (isWithinAiPopover(el) || isWithinConsentElement(el) || isWithinImmutableExcluded(el)) {
    return false;
  }
  if (isVisible(el)) {
    return false;
  }
  const xpath = getXPath(el);
  if (!xpath) {
    return false;
  }
  const configEntry =
    configValue &&
    configValue.pageMarkings &&
    typeof configValue.pageMarkings === "object" &&
    pageUrl
      ? configValue.pageMarkings[pageUrl] || null
      : null;
  const sourceEntries = [configEntry, entryOverride];
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
  let node = el;
  while (node && node.nodeType === 1) {
    const style = window.getComputedStyle(node);
    const state = getTheoreticalVisibilityState(node, style);
    if (state.definitiveHidden) {
      return false;
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
  return isActuallyVisibleInDocument(el);
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
  return Boolean(config.pageMarkings[pageUrl]);
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
  const shouldInvalidate = !options || options.invalidate !== false;
  state.pendingRenderInvalidate = state.pendingRenderInvalidate || shouldInvalidate;
  if (state.renderTimer) {
    return;
  }
  const { delay = 50, minInterval = 0 } = options || {};
  const now = Date.now();
  const sinceLast = now - (state.lastRenderAt || 0);
  const waitForInterval =
    minInterval > 0 && sinceLast < minInterval ? minInterval - sinceLast : 0;
  const effectiveDelay = Math.max(delay, waitForInterval);
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = 0;
    if (state.pendingRenderInvalidate) {
      invalidateCachedCollections();
    }
    if (state.renderRaf) {
      return;
    }
    state.renderRaf = window.requestAnimationFrame(() => {
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
  config.pageMarkings[pageUrl] = clonePageEntry(draftEntry);
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
      consentXpaths: [],
      includeXpaths: [],
      submissionXpaths: [],
      renderedHtml: "",
      rawHtml: ""
    };
  }
  if (!configValue.pageMarkings || typeof configValue.pageMarkings !== "object") {
    configValue.pageMarkings = {};
  }
  const existing = configValue.pageMarkings[pageUrl];
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
    consentXpaths: [],
    includeXpaths: [],
    submissionXpaths: [],
    renderedHtml: "",
    rawHtml: ""
  };
  if (create && persist) {
    configValue.pageMarkings[pageUrl] = entry;
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

function cacheUnsavedDraftBeforeDisable() {
  if (!state.enabled || !state.baseUrl || !state.config) {
    return;
  }
  const pageUrl = location.href;
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

export function disable() {
  cacheUnsavedDraftBeforeDisable();
  state.enabled = false;
  state.baseUrl = "";
  state.currentPageType = "";
  state.config = null;
  state.currentPageUrl = "";
  state.currentPageEntry = null;
  state.autoSeededPendingSavePageUrl = "";
  state.suppressNextAutoSeedFromAiSelectors = false;
  state.altPassThrough = false;
  state.consentSyncedPageUrl = "";
  if (state.renderTimer) {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = 0;
  }
  if (state.renderRaf) {
    window.cancelAnimationFrame(state.renderRaf);
    state.renderRaf = 0;
  }
  state.pendingRenderInvalidate = false;
  if (state.scrollHideTimer) {
    window.clearTimeout(state.scrollHideTimer);
    state.scrollHideTimer = 0;
  }
  if (state.snapshotTimer) {
    window.clearTimeout(state.snapshotTimer);
    state.snapshotTimer = 0;
  }
  if (state.draftPersistTimer) {
    window.clearTimeout(state.draftPersistTimer);
    state.draftPersistTimer = 0;
    if (state.baseUrl && state.config) {
      saveConfig(state.baseUrl, state.config).catch(() => {
        // Ignore best-effort persistence failures during teardown.
      });
    }
  }
  if (state.hoverRaf) {
    window.cancelAnimationFrame(state.hoverRaf);
    state.hoverRaf = 0;
  }
  state.isScrolling = false;
  state.cachedCollections = null;
  state.savedPageEntry = null;
  state.savedPageUrl = "";
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
  stopObservers();
  stopUrlWatcher();
}

export async function enableForBaseUrl(baseUrl) {
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !utils.isPageWithinBaseUrl(location.href, normalizedBaseUrl)) {
    disable();
    return;
  }
  state.enabled = true;
  state.baseUrl = normalizedBaseUrl;
  state.config = await loadConfig(normalizedBaseUrl);
  state.consentRootElements = new Set();
  const pageUrl = location.href;
  const savedEntry =
      state.config &&
      state.config.pageMarkings &&
      state.config.pageMarkings[pageUrl];
  if (!state.currentPageType) {
    state.currentPageType = normalizePageEntryPageType(savedEntry && savedEntry.pageType);
  }
  setSavedPageEntry(pageUrl, savedEntry || null);
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

  const hasSavedEntry = Boolean(savedEntry);
  syncConsentOnEnable(pageUrl, hasSavedEntry);
  // Hide any detected consent elements on the current page (not just previously stored ones)
  const hiddenCount = hideConsentElements();
  // Always inject bypass style in case consent elements exist but weren't hidden yet
  if (hiddenCount === 0) {
    injectConsentBypassStyle();
  }
  createOverlay();
  scheduleRender();
  startObservers();
  startUrlWatcher();
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
  if (!isViewportScroll) {
    // Nested scroll containers (carousels, internal panes) should not trigger a
    // full overlay redraw. This avoids flicker/redraw storms unrelated to page scroll.
    return;
  }
  const hideDuringScroll = isViewportScroll && (!options || options.hideDuringScroll !== false);
  if (hideDuringScroll && !state.isScrolling) {
    state.isScrolling = true;
    state.overlay.classList.add("uf-scrolling");
  } else if (!hideDuringScroll && state.isScrolling) {
    state.isScrolling = false;
    state.overlay.classList.remove("uf-scrolling");
  }
  if (state.scrollHideTimer) {
    window.clearTimeout(state.scrollHideTimer);
  }
  state.scrollHideTimer = window.setTimeout(() => {
    state.scrollHideTimer = 0;
    if (!state.overlay) {
      state.isScrolling = false;
      return;
    }
    window.requestAnimationFrame(() => {
      renderHighlights();
      refreshHoverHighlight();
      window.requestAnimationFrame(() => {
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
  return state.config.pageMarkings[pageUrl] || null;
}

export function getSavedPageEntry(pageUrl) {
  if (!pageUrl || state.savedPageUrl !== pageUrl) {
    return null;
  }
  return state.savedPageEntry ? clonePageEntry(state.savedPageEntry) : null;
}

export async function refreshFromTabState() {
  const response = await utils.sendRuntimeMessage({ type: "getTabState" });
  if (response && response.enabled && response.baseUrl) {
    // Enable if the URL still matches the baseUrl.
    if (utils.isPageWithinBaseUrl(location.href, response.baseUrl)) {
      const pageUrl = location.href;
      const draftEntry = getDraftPageEntry(pageUrl);
      const savedEntry = getSavedPageEntry(pageUrl);
      const wasClean = areEntriesEquivalent(draftEntry, savedEntry);
      const config = await loadConfig(response.baseUrl);
      const storedEntry =
          config.pageMarkings && config.pageMarkings[pageUrl]
              ? config.pageMarkings[pageUrl]
              : null;
      state.currentPageType = normalizePageEntryPageType(
        (response && response.pageType) || (storedEntry && storedEntry.pageType) || ""
      );
      if (draftEntry && !normalizePageEntryPageType(draftEntry.pageType) && state.currentPageType) {
        draftEntry.pageType = state.currentPageType;
      }
      mergeDraftEntry(config, pageUrl, draftEntry, savedEntry);
      state.baseUrl = response.baseUrl;
      state.config = config;
      setSavedPageEntry(pageUrl, storedEntry);
      if (storedEntry) {
        const immutableExcluded = collectImmutableElements();
        const syncResult = syncPageMarkings(config, pageUrl, immutableExcluded, {
          allowCreate: true,
          persist: true
        });
        if (wasClean && syncResult.changed && syncResult.entry) {
          setSavedPageEntry(pageUrl, syncResult.entry);
        }
      }
      scheduleRender();
      const hasSavedData = Boolean(
        storedEntry &&
          ((Array.isArray(storedEntry.xpaths) && storedEntry.xpaths.length > 0) ||
            (Array.isArray(storedEntry.includeXpaths) &&
              storedEntry.includeXpaths.length > 0) ||
            (Array.isArray(storedEntry.consentXpaths) &&
              storedEntry.consentXpaths.length > 0) ||
            (typeof storedEntry.renderedHtml === "string" &&
              storedEntry.renderedHtml.length > 0))
      );
      syncConsentOnEnable(pageUrl, hasSavedData);
      return;
    }
  }
  disable();
}

export function syncPageMarkings(config, pageUrl, immutableExcluded, options) {
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
  const excludedLookup = new Map();
  for (const item of entry.xpaths || []) {
    if (item && item.xpath) {
      excludedLookup.set(item.xpath, Boolean(item.excluded));
    }
  }
  const explicitExcludeSet = new Set();
  for (const [xpath, excluded] of excludedLookup) {
    if (excluded && typeof xpath === "string" && xpath) {
      explicitExcludeSet.add(xpath);
    }
  }
  const explicitExcludeAncestorSet = new Set();
  for (const xpath of explicitExcludeSet) {
    const explicitExcludedEl = getElementFromXPath(xpath);
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
    const includeEl = getElementFromXPath(xpath);
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
    const explicitMarkedEl = getElementFromXPath(xpath);
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
    return excludedLookup.has(xpath);
  };
  const explicitIncludeElements = [];
  for (const xpath of explicitIncludeSet) {
    const el = getElementFromXPath(xpath);
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
  const previousItems = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const excludedParents = collectExcludedParentElements(previousItems);
  const items = [];
  const seen = new Set();
  const generatedExcludedSet = new Set();
  const candidates = collectToggleableTargets(immutableExcluded, excludedParents);
  for (const el of candidates) {
    const xpath = getXPath(el);
    if (!xpath || seen.has(xpath)) {
      continue;
    }
    const autoToggleableDefault = matchesAutoToggleableDefaultExcluded(el);
    if (
      autoToggleableDefault &&
      explicitMarkedAncestorSet.has(el) &&
      !isExplicitlyMarkedXpath(xpath)
    ) {
      continue;
    }
    if (
      isWithinExplicitExcludedXpath(xpath, generatedExcludedSet) &&
      !isExplicitlyMarkedXpath(xpath)
    ) {
      continue;
    }
    if (
      isWithinExplicitExcludedXpath(xpath, explicitExcludeSet) &&
      !isExplicitlyMarkedXpath(xpath) &&
      !isWithinExplicitInclude(el) &&
      !isWithinExplicitIncludeXpath(xpath)
    ) {
      continue;
    }
    if (
      (isWithinExplicitInclude(el) || isWithinExplicitIncludeXpath(xpath)) &&
      !isExplicitlyMarkedXpath(xpath)
    ) {
      continue;
    }
    if (
      explicitExcludeAncestorSet.has(el) &&
      !explicitIncludeSet.has(xpath)
    ) {
      continue;
    }
    seen.add(xpath);
    const defaultExcluded = matchesToggleableDefaultExcluded(el);
    const excluded = explicitIncludeSet.has(xpath)
      ? false
      : excludedLookup.has(xpath)
        ? excludedLookup.get(xpath) === true
        : defaultExcluded;
    items.push({ xpath, excluded });
    if (excluded) {
      generatedExcludedSet.add(xpath);
    }
  }
  for (const item of previousItems) {
    if (!item || !item.xpath || !item.excluded) {
      continue;
    }
    if (explicitIncludeSet.has(item.xpath)) {
      continue;
    }
    if (seen.has(item.xpath)) {
      continue;
    }
    if (isWithinExplicitExcludedXpath(item.xpath, explicitExcludeSet)) {
      continue;
    }
    const explicitEl = getElementFromXPath(item.xpath);
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
    items.push({ xpath: item.xpath, excluded: true });
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
    const explicitEl = getElementFromXPath(item.xpath);
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
      items.some((item, index) => {
        const previous = previousItems[index];
        return (
            !previous ||
            previous.xpath !== item.xpath ||
            Boolean(previous.excluded) !== item.excluded
        );
      });
  entry.xpaths = items;
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
    config.pageMarkings[pageUrl] = entry;
  }
  return { changed, entry, persisted: shouldPersist, hadEntry };
}
