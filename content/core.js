import * as config from "../common/config.js";
import * as patterns from "../common/patterns.js";
import * as utils from "../common/utilities.js";
import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "../common/constants.js";
import {
  applyAiSelectorModifiers,
  getMaximumDescendantSelectorCount,
  normalizeAiSelectorModifiers
} from "../common/ai-selector-modifiers.js";
import {
  HEADING_TAG_SELECTOR,
  REMOVABLE_ELEMENT_SELECTORS
} from "./constants.js";

export const state = {
  enabled: false,
  baseUrl: "",
  config: null,
  overlay: null,
  layers: {},
  hoverBox: null,
  focusBox: null,
  focusElement: null,
  aiPopover: null,
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
  lastRenderAt: 0,
  scrollHideTimer: 0,
  isScrolling: false,
  snapshotTimer: 0,
  urlCheckTimer: 0,
  mutationObserver: null,
  savedPageEntry: null,
  savedPageUrl: "",
  consentSyncedPageUrl: "",
  consentRootElements: new Set(),
  initialized: false,
  cssHighlightEnabled: false,
  cssHighlightSelectors: "",
  aiSelectorModifierOverride: null,
  layerBoxes: new WeakMap()
};

export const CONSENT_HIDDEN_ATTR = "data-uf-consent-hidden";
const CONSENT_SELECTOR = REMOVABLE_ELEMENT_SELECTORS.join(",");
const SCROLL_DEBOUNCE_MS = 250;

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
  const pattern = patterns.normalizePatternValue(entry.pagePattern || "");
  const fingerprint = [`pattern:${pattern}`];
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
  return fingerprint.concat(xpathFingerprint, includeFingerprint, consentFingerprint);
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

function isTextualContainer(el) {
  if (!isVisible(el)) {
    return false;
  }
  if (hasDirectText(el)) {
    return true;
  }
  if (!isHeadingElement(el)) {
    return false;
  }
  const headingText = (el.innerText || "").replace(/\s+/g, " ").trim();
  return Boolean(headingText);
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

function collectHeadingTargets() {
  if (!HEADING_TAG_SELECTOR) {
    return new Set();
  }
  const targets = new Set();
  const headings = document.querySelectorAll(HEADING_TAG_SELECTOR);

  for (const heading of headings) {
    if (isWithinAiPopover(heading)) {
      continue;
    }
    if (isWithinImmutableExcluded(heading)) {
      continue;
    }
    if (isTextualContainer(heading)) {
      targets.add(heading);
    }
  }
  return targets;
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

function hideConsentElement(element) {
  if (isWithinConsentElement(element)) {
    return false;
  }
  element.setAttribute(CONSENT_HIDDEN_ATTR, "on");
  return registerConsentRoot(element);
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

function getXPath(el) {
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

export function buildCssSelectorPath(el) {
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
      if (isTextualContainer(node) && !isWithinImmutableExcluded(node)) {
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
    if (isTextualContainer(node) && !isWithinImmutableExcluded(node)) {
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
    precedenceSet = new Set()
  } = options || {};
  const results = [];
  const stack = [
    {
      node: root,
      index: 0,
      ancestorHardExcluded: false,
      ancestorHasPrecedence: false
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
      const childHasPrecedence =
          frame.ancestorHasPrecedence ||
          precedenceSet.has(frame.node) ||
          precedenceSet.has(child);
      stack.push({
        node: child,
        index: 0,
        ancestorHardExcluded: childHardExcluded,
        ancestorHasPrecedence: childHasPrecedence
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
        !frame.ancestorHasPrecedence &&
        isTextualContainer(node) &&
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
  for (const selector of selectors || []) {
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
  entry.xpaths = normalizeXPathItems(entry.xpaths);
  entry.includeXpaths = normalizeXPathList(entry.includeXpaths);
  entry.consentXpaths = normalizeXPathList(entry.consentXpaths);
  return entry;
}

function getExcludedXPathSet(config, pageUrl) {
  if (!config || !config.pageMarkings || typeof config.pageMarkings !== "object") {
    return new Set();
  }
  const entry = config.pageMarkings[pageUrl];
  const items = entry && Array.isArray(entry.xpaths) ? entry.xpaths : [];
  return new Set(collectExcludedXPaths(items));
}

function getIncludeXPathSet(config, pageUrl) {
  if (!config || !config.pageMarkings || typeof config.pageMarkings !== "object") {
    return new Set();
  }
  const entry = config.pageMarkings[pageUrl];
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

function shouldScheduleRenderForMutations(mutations) {
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
        name === "style" ||
        name === "hidden" ||
        name === "aria-hidden"
      ) {
        return true;
      }
      continue;
    }
    if (mutation.type === "characterData") {
      const parent = mutation.target && mutation.target.parentElement;
      if (parent && isWithinConsentElement(parent)) {
        continue;
      }
      if (parent && (isHeadingElement(parent) || hasDirectText(parent))) {
        return true;
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
        return true;
      }
    }
  }
  return false;
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
      * {
        animation: none !important;
        transition: none !important;
      }
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
        z-index: 2147483647;
        pointer-events: auto;
      }
      #unfluffify-overlay .uf-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
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
        border: 2px dashed #9c6b6b;
        background: rgba(183, 28, 28, 0.08);
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
      @keyframes uf-css-highlight-dash {
        0% {
          box-shadow: 0px 0px 7.5px 0 rgba(34, 124, 40, 0);
        }
        50% {
          box-shadow: 0px 0px 7.5px 7.5px rgba(34, 124, 40, 0.85);
        }
        100% {
          box-shadow: 0px 0px 7.5px 0 rgba(34, 124, 40, 0);
        }
      }
      #unfluffify-overlay .uf-css-highlight {
        box-shadow: 0px 0px 7.5px 0 rgba(34, 124, 40, 0);
        animation: uf-css-highlight-dash 2s linear infinite !important;
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
    "hard",
    "explicit-exclude",
    "explicit-include",
    "ai-content",
    "css-highlight",
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
    return;
  }
  const layerState = beginLayerRender(layerFocus);
  if (!state.focusElement) {
    finalizeLayerRender(layerState);
    return;
  }
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
        background: rgba(26, 22, 18, 0.45);
        z-index: 2147483648;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 28px;
        overflow: auto;
      }
      .uf-ai-popover-modal {
        background: #ffffff;
        color: #2f2a24;
        width: min(720px, 100%);
        max-height: min(80vh, 720px);
        border-radius: 18px;
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.28);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .uf-ai-popover-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 20px 12px;
        border-bottom: 1px solid #eadccc;
      }
      .uf-ai-popover-title {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6c4c2b;
      }
      .uf-ai-popover-close {
        border: 1px solid #8a6f52;
        background: #f8e9d5;
        color: #6c4c2b;
        border-radius: 999px;
        width: 32px;
        height: 32px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }
      .uf-ai-popover-close:focus-visible {
        outline: 2px solid #6c4c2b;
        outline-offset: 2px;
      }
      .uf-ai-popover-body {
        padding: 14px 22px 20px;
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
      }
    `;
  document.documentElement.appendChild(style);
}

function closeAiPopover() {
  if (state.aiPopover) {
    state.aiPopover.remove();
    state.aiPopover = null;
  }
}

function recordPageSnapshot(config, pageUrl) {
  if (!config || !pageUrl) {
    return;
  }
  const immutableExcluded = collectImmutableElements();
  syncPageMarkings(config, pageUrl, immutableExcluded);
  const entry = getPageMarkingEntry(config, pageUrl);
  entry.fullHTML = document.documentElement.outerHTML;
  entry.title = document.title || pageUrl;
  config.pageMarkings[pageUrl] = entry;
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
    if (isTextualContainer(node)) {
      markableCount += 1;
      if (markableCount >= 2) {
        return true;
      }
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
}

function resolveMarkableElement(el, config, options) {
  if (!isMarkableElement(el, config, options)) {
    return null;
  }
  return el;
}

function getMarkableTarget(x, y, options) {
  const allowParent = options && options.allowParent;
  const allowExplicitTarget = options && options.allowExplicitTarget;
  const excludedSet = options && options.excludedSet;
  const includeSet = options && options.includeSet;
  const explicitParentSet = options && options.explicitParentSet;
  const allowImmutableChildren = options && options.allowImmutableChildren;
  const elements = document.elementsFromPoint(x, y);
  if (
    allowExplicitTarget &&
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
      const withinExplicitExcludedParent =
        !allowImmutableChildren &&
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
    if (!allowImmutableChildren && explicitParentSet && explicitParentSet.size > 0) {
      const xpath = getXPath(el);
      if (xpath && isWithinExplicitExcludedXpath(xpath, explicitParentSet)) {
        continue;
      }
    }
    const explicitlyExcluded =
        allowExplicitTarget && isExplicitlyExcludedElement(el, excludedSet);
    const explicitlyIncluded =
        allowExplicitTarget && isExplicitlyIncludedElement(el, includeSet);
    const resolved = resolveMarkableElement(el, state.config, {
      allowParent,
      explicitlyExcluded,
      explicitlyIncluded,
      allowImmutableChildren
    });
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function updateHoverHighlight(x, y, allowParent, allowImmutableChildren) {
  if (!state.enabled || state.altPassThrough) {
    return;
  }
  const layerHover = state.layers["hover"];
  if (!layerHover) {
    return;
  }
  const layerState = beginLayerRender(layerHover);
  const explicitParentSet = getExcludedXPathSet(state.config, location.href);
  const excludedSet = allowParent ? null : explicitParentSet;
  const includeSet = getIncludeXPathSet(state.config, location.href);
  const target = getMarkableTarget(x, y, {
    allowParent,
    allowExplicitTarget: true,
    excludedSet,
    includeSet,
    explicitParentSet,
    allowImmutableChildren
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
  const allowImmutableChildren = getMarkMode() === "include";
  updateHoverHighlight(
      state.lastPointer.x,
      state.lastPointer.y,
      state.shiftHeld,
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
  const allowImmutableChildren = getMarkModeFromEvent(event) === "include";
  updateHoverHighlight(
    event.clientX,
    event.clientY,
    event.shiftKey,
    allowImmutableChildren
  );
}

function toggleExplicitExclude(target) {
  if (!state.baseUrl || !state.config) {
    return;
  }
  if (isWithinImmutableExcluded(target)) {
    showToast("Default exclusions cannot be overridden");
    return;
  }

  const xpath = getXPath(target);
  if (!xpath) {
    return;
  }

  const config = state.config;
  const entry = getPageMarkingEntry(config, location.href);
  const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
  const explicitExcludeSet = new Set(collectExcludedXPaths(items));
  if (isWithinExplicitExcludedXpath(xpath, explicitExcludeSet)) {
    showToast("Use include to override an excluded parent");
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
    if (Array.isArray(entry.includeXpaths)) {
      entry.includeXpaths = entry.includeXpaths.filter((value) => value !== xpath);
    }
  }

  entry.xpaths = items;
  normalizePageEntryXpaths(entry);
  config.pageMarkings[location.href] = entry;
  state.config = config;
  scheduleRender();
  scheduleSnapshotSave();
  notifyDraftStatus(location.href);
}

function toggleExplicitInclude(target) {
  if (!state.baseUrl || !state.config) {
    return;
  }
  if (matchesImmutableExcluded(target)) {
    showToast("Default exclusions cannot be overridden");
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
  const existingIndex = includeXpaths.indexOf(xpath);
  if (existingIndex >= 0) {
    includeXpaths.splice(existingIndex, 1);
  } else {
    includeXpaths.push(xpath);
    cleanupDescendants();
  }

  entry.includeXpaths = includeXpaths;
  entry.xpaths = items;
  normalizePageEntryXpaths(entry);
  config.pageMarkings[location.href] = entry;
  state.config = config;
  scheduleRender();
  scheduleSnapshotSave();
  notifyDraftStatus(location.href);
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
  const allowParent = event.shiftKey;
  const allowImmutableChildren = mode === "include";
  const explicitParentSet = getExcludedXPathSet(state.config, location.href);
  const excludedSet = allowParent ? null : explicitParentSet;
  const includeSet = getIncludeXPathSet(state.config, location.href);
  const target = getMarkableTarget(event.clientX, event.clientY, {
    allowParent,
    allowExplicitTarget: true,
    excludedSet,
    includeSet,
    explicitParentSet,
    allowImmutableChildren
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

function getVisibleRects(el) {
  if (!isVisible(el)) {
    return [];
  }
  const clientRects = el.getClientRects();
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

function renderHighlights() {
  if (!state.enabled || !state.overlay) {
    return;
  }

  updateOverlayGutter();

  const immutableExcluded = collectImmutableElements();
  const pageUrl = location.href;
  const hasEntry = hasPageMarkingEntry(state.config, pageUrl);
  const syncResult = syncPageMarkings(state.config, pageUrl, immutableExcluded, {
    allowCreate: hasEntry,
    persist: hasEntry
  });
  const entry =
      syncResult.entry || getPageMarkingEntry(state.config, pageUrl, { create: false });
  const explicitExclude = collectXPathElements(
      collectExcludedXPaths(entry.xpaths)
  );
  const explicitInclude = collectXPathElements(entry.includeXpaths);
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
  const rawAiSelectors = Array.isArray(state.config.latestComputedSelectors) &&
    state.config.latestComputedSelectors.length
    ? state.config.latestComputedSelectors
    : Array.isArray(
      state.config.domainAiSelectorSet &&
      state.config.domainAiSelectorSet.inclusionSelectors
    )
      ? state.config.domainAiSelectorSet.inclusionSelectors
      : [];
  const normalizedAiSelectors = rawAiSelectors
    .filter((selector) => typeof selector === "string")
    .map((selector) => selector.trim())
    .filter(Boolean);
  const aiSelectorMaxDepth = getMaximumDescendantSelectorCount(normalizedAiSelectors);
  const aiSelectorOverride = state.aiSelectorModifierOverride &&
    typeof state.aiSelectorModifierOverride === "object" &&
    (!state.aiSelectorModifierOverride.baseUrl ||
      !state.baseUrl ||
      state.aiSelectorModifierOverride.baseUrl === state.baseUrl)
    ? state.aiSelectorModifierOverride
    : null;
  const aiSelectorModifiers = normalizeAiSelectorModifiers(
    aiSelectorOverride || state.config.aiSelectorModifiers,
    aiSelectorMaxDepth
  );
  const aiContent = collectSelectorElements(
    applyAiSelectorModifiers(normalizedAiSelectors, aiSelectorModifiers)
  );
  const allDefaultExcluded = new Set([...immutableExcluded, ...explicitExclude]);

  const layerHard = state.layers["hard"];
  const layerExplicitExclude = state.layers["explicit-exclude"];
  const layerExplicitInclude = state.layers["explicit-include"];
  const layerAiContent = state.layers["ai-content"];
  const layerDefault = state.layers["default"];

  const layerHardState = beginLayerRender(layerHard);
  const layerExplicitExcludeState = beginLayerRender(layerExplicitExclude);
  const layerExplicitIncludeState = beginLayerRender(layerExplicitInclude);
  const layerAiContentState = beginLayerRender(layerAiContent);
  const layerDefaultState = beginLayerRender(layerDefault);
  const markedElements = new Set();

  const precedenceSet = new Set([
    ...immutableExcluded,
    ...explicitExclude,
    ...explicitInclude,
    ...aiContent
  ]);
  const hasHigherPrecedence = (el) => precedenceSet.has(el);

  for (const el of immutableExcluded) {
    const rects = getVisibleRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerHardState,
        rects,
        "uf-hard-locked",
        el,
        "immutable",
        markedElements
      );
    }
  }

  for (const el of explicitExclude) {
    if (immutableExcluded.has(el) || isWithinExplicitInclude(el)) {
      continue;
    }
    const rects = getVisibleRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerExplicitExcludeState,
        rects,
        "uf-explicit-exclude",
        el,
        "explicit-exclude",
        markedElements
      );
    }
  }

  for (const el of explicitInclude) {
    if (immutableExcluded.has(el) || explicitExclude.has(el)) {
      continue;
    }
    const rects = getVisibleRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerExplicitIncludeState,
        rects,
        "uf-explicit-include",
        el,
        "explicit-include",
        markedElements
      );
    }
  }

  for (const el of aiContent) {
    const rects = getVisibleRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerAiContentState,
        rects,
        "uf-ai-content",
        el,
        "ai-content",
        markedElements
      );
    }
  }

  const defaultTargets = collectDefaultHighlightTargets(document.body, {
    excludedSet: precedenceSet,
    hardExcludedSet: immutableExcluded,
    hasHigherPrecedence,
    precedenceSet
  });
  for (const el of defaultTargets) {
    const rects = getVisibleRects(el);
    if (rects.length > 0) {
      drawMultiRectReuse(
        layerDefaultState,
        rects,
        "uf-default",
        el,
        "default",
        markedElements
      );
    }
  }

  const layerCssHighlight = state.layers["css-highlight"];
  const layerCssState = beginLayerRender(layerCssHighlight);
  if (state.cssHighlightEnabled && state.cssHighlightSelectors) {
    let cssElements;
    try {
      cssElements = document.querySelectorAll(state.cssHighlightSelectors);
    } catch (error) {
      cssElements = [];
    }
    for (const el of cssElements) {
      const rects = getVisibleRects(el);
      if (rects.length > 0) {
        drawMultiRectReuse(
          layerCssState,
          rects,
          "uf-css-highlight",
          el,
          null,
          null
        );
      }
    }
  }
  finalizeLayerRender(layerHardState);
  finalizeLayerRender(layerExplicitExcludeState);
  finalizeLayerRender(layerExplicitIncludeState);
  finalizeLayerRender(layerAiContentState);
  finalizeLayerRender(layerDefaultState);
  finalizeLayerRender(layerCssState);

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
      if (!shouldScheduleRenderForMutations(mutations)) {
        return;
      }
      scheduleRender({ delay: 120, minInterval: 250 });
    } catch (error) {
      // Silently handle errors to prevent observer from stopping
    }
  });
  if (document.body) {
    try {
      state.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
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
    return;
  }
  const elements = Array.from(document.querySelectorAll(CONSENT_SELECTOR))
      .filter((element) => typeof element.parentElement !== "undefined");

  elements.forEach(element => hideConsentElement(element));

  if (elements.length > 0) {
    restorePageScrolling();
  }
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

export function isHeadingElement (el) {
  return Boolean(el && el.nodeType === 1 && el.matches(HEADING_TAG_SELECTOR));
}

export function isPageDraftDirty(pageUrl) {
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
    url: entry.url || "",
    title: entry.title || "",
    xpaths: Array.isArray(entry.xpaths) ? entry.xpaths : [],
    consentXpaths: Array.isArray(entry.consentXpaths) ? entry.consentXpaths : [],
    includeXpaths: Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [],
    pagePattern: patterns.normalizePatternValue(entry.pagePattern || ""),
    fullHTML: typeof entry.fullHTML === "string" ? entry.fullHTML : ""
  };
  return normalizePageEntryXpaths(cloned);
}

export function copyEntryXpathsToPage(config, pageUrl, sourceEntry) {
  if (!config || !pageUrl || !sourceEntry || !Array.isArray(sourceEntry.xpaths)) {
    return { copied: 0, total: 0 };
  }
  const sourceItems = sourceEntry.xpaths;
  const matchedItems = [];
  const seen = new Set();
  for (const item of sourceItems) {
    if (!item || typeof item.xpath !== "string") {
      continue;
    }
    if (seen.has(item.xpath)) {
      continue;
    }
    const el = getElementFromXPath(item.xpath);
    if (!el) {
      continue;
    }
    if (!isMarkableElement(el, config, {
      allowParent: true,
      explicitlyExcluded: Boolean(item.excluded)
    })) {
      continue;
    }
    matchedItems.push({ xpath: item.xpath, excluded: Boolean(item.excluded) });
    seen.add(item.xpath);
  }
  const entry = getPageMarkingEntry(config, pageUrl);
  entry.xpaths = matchedItems;
  const includeSource = Array.isArray(sourceEntry.includeXpaths)
    ? sourceEntry.includeXpaths
    : [];
  const includeMatched = [];
  const includeSeen = new Set();
  for (const xpath of includeSource) {
    if (typeof xpath !== "string" || !xpath) {
      continue;
    }
    if (includeSeen.has(xpath)) {
      continue;
    }
    const el = getElementFromXPath(xpath);
    if (!el) {
      continue;
    }
    includeMatched.push(xpath);
    includeSeen.add(xpath);
  }
  entry.includeXpaths = includeMatched;
  entry.title = document.title || pageUrl;
  config.pageMarkings[pageUrl] = entry;
  return {
    copied: matchedItems.length,
    total: sourceItems.length,
    copiedIncludes: includeMatched.length,
    totalIncludes: includeSource.length
  };
}

export function setSavedPageEntry(pageUrl, entry) {
  state.savedPageUrl = pageUrl || "";
  state.savedPageEntry = clonePageEntry(entry);
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
  if (isTextualContainer(el)) {
    return true;
  }
  if (!options || !options.allowParent) {
    return false;
  }
  return hasMultipleMarkableDescendants(el);
}

export function clearFocusHighlight() {
  if (!state.focusElement) {
    return;
  }
  state.focusElement = null;
  updateFocusHighlight();
}

export function setCssHighlight(enabled, css) {
  state.cssHighlightEnabled = Boolean(enabled);
  state.cssHighlightSelectors = typeof css === "string" ? css : "";
  scheduleRender();
}

export function isVisible(el) {
  if (!el || el.nodeType !== 1) {
    return false;
  }
  if (isWithinExtensionUi(el)) {
    return false;
  }
  let node = el;
  while (node && node.nodeType === 1) {
    if (
        node.classList &&
        (node.classList.contains("sr-only") ||
            node.classList.contains("visually-hidden"))
    ) {
      return false;
    }
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    if (parseFloat(style.opacity) === 0) {
      return false;
    }
    if (isVisuallyHiddenByStyle(style)) {
      return false;
    }
    node = node.parentElement;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  // Check if element is clipped by ancestor overflow
  return !isClippedByOverflow(el);
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
    if (state.renderRaf) {
      return;
    }
    state.renderRaf = window.requestAnimationFrame(() => {
      state.renderRaf = 0;
      state.lastRenderAt = Date.now();
      renderHighlights();
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

export function getPageMarkingEntry(config, pageUrl, options) {
  const { create = true, persist = true } = options || {};
  if (!config) {
    return {
      url: pageUrl || "",
      title: pageUrl || "",
      xpaths: [],
      consentXpaths: [],
      pagePattern: "",
      fullHTML: ""
    };
  }
  if (!config.pageMarkings || typeof config.pageMarkings !== "object") {
    config.pageMarkings = {};
  }
  const existing = config.pageMarkings[pageUrl];
  if (existing && Array.isArray(existing.xpaths)) {
    return normalizePageEntryXpaths(existing);
  }
  const entry = {
    url: pageUrl || "",
    title: document.title || pageUrl || "",
    xpaths: [],
    consentXpaths: [],
    includeXpaths: [],
    pagePattern: "",
    fullHTML: ""
  };
  if (create && persist) {
    config.pageMarkings[pageUrl] = entry;
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

export function disable() {
  state.enabled = false;
  state.baseUrl = "";
  state.config = null;
  state.aiSelectorModifierOverride = null;
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
  if (state.scrollHideTimer) {
    window.clearTimeout(state.scrollHideTimer);
    state.scrollHideTimer = 0;
  }
  if (state.snapshotTimer) {
    window.clearTimeout(state.snapshotTimer);
    state.snapshotTimer = 0;
  }
  state.isScrolling = false;
  state.savedPageEntry = null;
  state.savedPageUrl = "";
  removeOverlay();
  closeAiPopover();
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

export async function enableForBaseUrl(baseUrl, options) {
  if (!baseUrl || !location.href.startsWith(baseUrl)) {
    disable();
    return;
  }
  state.enabled = true;
  state.baseUrl = baseUrl;
  state.config = await loadConfig(baseUrl);
  state.consentRootElements = new Set();
  const pendingPattern = patterns.normalizePatternValue(options && options.pagePattern);
  const pageUrl = location.href;
  if (pendingPattern) {
    const entry = getPageMarkingEntry(state.config, pageUrl);
    entry.pagePattern = pendingPattern;
    state.config.pageMarkings[pageUrl] = entry;
  }
  if (!patterns.isPageUrlAllowed(state.config, pageUrl, pendingPattern)) {
    disable();
    return;
  }
  const savedEntry =
      state.config &&
      state.config.pageMarkings &&
      state.config.pageMarkings[pageUrl];
  setSavedPageEntry(pageUrl, savedEntry || null);

  const hasSavedEntry = Boolean(savedEntry);
  syncConsentOnEnable(pageUrl, hasSavedEntry);
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

export function handleScroll() {
  if (!state.enabled || state.aiPopover || !state.overlay) {
    return;
  }
  if (!state.isScrolling) {
    state.isScrolling = true;
    state.overlay.classList.add("uf-scrolling");
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
        state.isScrolling = false;
        if (state.overlay) {
          state.overlay.classList.remove("uf-scrolling");
        }
      });
    });
  }, SCROLL_DEBOUNCE_MS);
}

export function collectPreviewItems(selectors) {
  const seen = new Set();
  const rows = [];
  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (!el || el.nodeType !== 1 || seen.has(el)) {
          continue;
        }
        if (!isVisible(el)) {
          continue;
        }
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (!text) {
          continue;
        }
        rows.push({
          text,
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX
        });
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  rows.sort((a, b) => {
    if (a.top === b.top) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });
  return rows.map((row) => row.text);
}

export function collectHeadingDefaultStatus(config, entryOverride) {
  if (!config) {
    return [];
  }
  const entry = entryOverride || getPageMarkingEntry(config, location.href);
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
  const includeSet = new Set(
    Array.isArray(entry.includeXpaths)
      ? entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
      : []
  );
  const includeElements = [];
  for (const xpath of includeSet) {
    const el = getElementFromXPath(xpath);
    if (el) {
      includeElements.push(el);
    }
  }
  const withinExplicitInclude = new Set();
  const results = new Map();
  const headingTargets = HEADING_TAG_SELECTOR
    ? Array.from(document.querySelectorAll(HEADING_TAG_SELECTOR))
    : [];
  for (const el of headingTargets) {
    if (isWithinAiPopover(el)) {
      continue;
    }
    if (!isTextualContainer(el)) {
      continue;
    }
    const xpath = getXPath(el);
    if (!xpath || results.has(xpath)) {
      continue;
    }
    let isWithinInclude = false;
    for (const includeEl of includeElements) {
      if (includeEl && includeEl !== el && includeEl.contains(el)) {
        withinExplicitInclude.add(xpath);
        isWithinInclude = true;
        break;
      }
    }
    const explicitlyIncluded = includeSet.has(xpath) || isWithinInclude;
    if (
      !explicitlyIncluded &&
      (isWithinImmutableExcluded(el) ||
        isWithinExplicitExcludedXpath(xpath, explicitExcludeSet))
    ) {
      continue;
    }
    const text = (el.innerText || "").trim();
    results.set(xpath, {
      xpath,
      text: text || el.tagName.toLowerCase()
    });
  }
  return Array.from(results.values()).map((item) => ({
    ...item,
    excluded: includeSet.has(item.xpath) || withinExplicitInclude.has(item.xpath)
      ? false
      : excludedLookup.get(item.xpath) === true
  }));
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

export async function saveConfig(baseUrl, config) {
  const result = await utils.idbGet("configs");
  const configs = result.configs || {};
  configs[baseUrl] = config;
  await utils.idbSet({ configs });
}

export function removePageEntry(config, pageUrl) {
  if (!config || !pageUrl) {
    return false;
  }
  if (!config.pageMarkings || typeof config.pageMarkings !== "object") {
    return false;
  }
  if (!config.pageMarkings[pageUrl]) {
    return false;
  }
  delete config.pageMarkings[pageUrl];
  return true;
}

export function showAiPopover(items) {
  ensureAiPopoverStyle();
  closeAiPopover();
  const popover = document.createElement("div");
  popover.className = "uf-ai-popover";
  const modal = document.createElement("div");
  modal.className = "uf-ai-popover-modal";
  const header = document.createElement("div");
  header.className = "uf-ai-popover-header";
  const title = document.createElement("div");
  title.className = "uf-ai-popover-title";
  title.textContent = "Computed Content";
  const close = document.createElement("button");
  close.className = "uf-ai-popover-close";
  close.type = "button";
  close.innerHTML = "&#x2715;";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => closeAiPopover());
  header.appendChild(title);
  header.appendChild(close);
  const body = document.createElement("div");
  body.className = "uf-ai-popover-body";
  const list = document.createElement("ul");
  list.className = "uf-ai-popover-list";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = "No content found";
    list.appendChild(empty);
  } else {
    items.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
  }
  body.appendChild(list);
  modal.appendChild(header);
  modal.appendChild(body);
  popover.appendChild(modal);
  document.documentElement.appendChild(popover);
  state.aiPopover = popover;
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
    if (location.href.startsWith(response.baseUrl)) {
      const pageUrl = location.href;
      const draftEntry = getDraftPageEntry(pageUrl);
      const savedEntry = getSavedPageEntry(pageUrl);
      const wasClean = areEntriesEquivalent(draftEntry, savedEntry);
      const config = await loadConfig(response.baseUrl);
      const storedEntry =
          config.pageMarkings && config.pageMarkings[pageUrl]
              ? config.pageMarkings[pageUrl]
              : null;
      mergeDraftEntry(config, pageUrl, draftEntry, savedEntry);
      if (!patterns.isPageUrlAllowed(config, pageUrl)) {
        disable();
        return;
      }
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
            (typeof storedEntry.fullHTML === "string" &&
              storedEntry.fullHTML.length > 0))
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
  const { allowCreate = true, persist = true } = options || {};
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
  const explicitIncludeSet = new Set(
    entry.includeXpaths.filter((xpath) => typeof xpath === "string" && xpath)
  );
  entry.includeXpaths = Array.from(explicitIncludeSet);
  const isExplicitlyMarkedXpath = (xpath) => {
    if (!xpath) {
      return false;
    }
    if (explicitIncludeSet.has(xpath)) {
      return true;
    }
    return excludedLookup.get(xpath) === true && !utils.isHeadingXPath(xpath);
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
    seen.add(xpath);
    const isHeading = isHeadingElement(el);
    const excluded = explicitIncludeSet.has(xpath)
      ? false
      : excludedLookup.has(xpath)
        ? excludedLookup.get(xpath) === true
        : isHeading;
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
  entry.title = document.title || pageUrl;
  if (!entry.fullHTML) {
    entry.fullHTML = "";
  }
  if (shouldPersist) {
    config.pageMarkings[pageUrl] = entry;
  }
  return { changed, entry, persisted: shouldPersist, hadEntry };
}
