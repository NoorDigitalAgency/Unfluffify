const HOVER_CLASS = "markcontit-hover";
const EXPLICIT_INCLUDE_CLASS = "markcontit-explicit-include";
const EXPLICIT_EXCLUDE_CLASS = "markcontit-explicit-exclude";
const INFERRED_INCLUDE_CLASS = "markcontit-inferred-include";
const INFERRED_EXCLUDE_CLASS = "markcontit-inferred-exclude";

let enabled = false;
let config = null;
let overlayEl = null;
let styleEl = null;
let toastEl = null;
let hoverEl = null;
let highlightedEls = new Set();
let rafId = null;
let lastPointer = { x: 0, y: 0 };
let toastTimer = null;

function configApplies(currentConfig) {
  return !!currentConfig && location.href.startsWith(currentConfig.baseUrl);
}

function ensureStyles() {
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.id = "markcontit-style";
  styleEl.textContent = `
html.markcontit-freeze, html.markcontit-freeze body {
  scroll-behavior: auto !important;
}
html.markcontit-freeze *,
html.markcontit-freeze *::before,
html.markcontit-freeze *::after {
  transition: none !important;
  animation: none !important;
}
.markcontit-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  cursor: crosshair;
  background: transparent;
}
.${HOVER_CLASS} {
  outline: 3px solid #ffb300 !important;
  outline-offset: 2px !important;
}
.${EXPLICIT_INCLUDE_CLASS} {
  background: rgba(0, 153, 74, 0.25) !important;
  box-shadow: inset 0 0 0 2px #00994a !important;
}
.${EXPLICIT_EXCLUDE_CLASS} {
  background: rgba(198, 0, 0, 0.25) !important;
  box-shadow: inset 0 0 0 2px #c60000 !important;
}
.${INFERRED_INCLUDE_CLASS} {
  background: rgba(0, 153, 74, 0.12) !important;
  box-shadow: inset 0 0 0 1px #00994a !important;
}
.${INFERRED_EXCLUDE_CLASS} {
  background: rgba(198, 0, 0, 0.12) !important;
  box-shadow: inset 0 0 0 1px #c60000 !important;
}
.markcontit-toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #111;
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  z-index: 2147483647;
}
.markcontit-toast.markcontit-toast-show {
  opacity: 0.95;
}
`;
  document.documentElement.appendChild(styleEl);
}

function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement("div");
  overlayEl.className = "markcontit-overlay";
  overlayEl.setAttribute("data-markcontit-root", "true");
  overlayEl.addEventListener("pointermove", onPointerMove, { passive: true });
  overlayEl.addEventListener("pointerdown", onPointerDown);
  overlayEl.addEventListener("contextmenu", onContextMenu);
  overlayEl.addEventListener("wheel", blockEvent, { passive: false });
  overlayEl.addEventListener("touchmove", blockEvent, { passive: false });
  overlayEl.addEventListener("dblclick", blockEvent);
  document.documentElement.appendChild(overlayEl);
}

function ensureToast() {
  if (toastEl) return;
  toastEl = document.createElement("div");
  toastEl.className = "markcontit-toast";
  toastEl.setAttribute("data-markcontit-root", "true");
  document.documentElement.appendChild(toastEl);
}

function showToast(message) {
  ensureToast();
  toastEl.textContent = message;
  toastEl.classList.add("markcontit-toast-show");
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("markcontit-toast-show");
  }, 1600);
}

function blockEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}

function onPointerMove(event) {
  lastPointer = { x: event.clientX, y: event.clientY };
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    updateHover();
  });
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  handleToggle("include");
}

function onContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  handleToggle("exclude");
}

function onKeyDown(event) {
  const blocked = [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " "
  ];
  if (blocked.includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function enable() {
  if (enabled) return;
  enabled = true;
  ensureStyles();
  ensureOverlay();
  document.documentElement.classList.add("markcontit-freeze");
  document.addEventListener("keydown", onKeyDown, true);
  applyHighlights();
}

function disable() {
  enabled = false;
  config = null;
  clearHighlights();
  if (hoverEl) {
    hoverEl.classList.remove(HOVER_CLASS);
    hoverEl = null;
  }
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  if (styleEl) {
    styleEl.remove();
    styleEl = null;
  }
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
  document.documentElement.classList.remove("markcontit-freeze");
  document.removeEventListener("keydown", onKeyDown, true);
}

function updateHover() {
  if (!enabled || !overlayEl) return;
  const target = getElementFromPoint(lastPointer.x, lastPointer.y);
  const nextHover = findTextContainer(target);
  if (hoverEl === nextHover) return;
  if (hoverEl) {
    hoverEl.classList.remove(HOVER_CLASS);
  }
  hoverEl = nextHover;
  if (hoverEl) {
    hoverEl.classList.add(HOVER_CLASS);
  }
}

function getElementFromPoint(x, y) {
  if (!overlayEl) return null;
  overlayEl.style.pointerEvents = "none";
  const element = document.elementFromPoint(x, y);
  overlayEl.style.pointerEvents = "auto";
  if (!element) return null;
  if (element.closest("[data-markcontit-root]")) return null;
  return element;
}

function findTextContainer(start) {
  let el = start;
  while (el && el !== document.documentElement) {
    if (isValidTextContainer(el)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function isValidTextContainer(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.closest("[data-markcontit-root]")) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return elementContainsVisibleText(el);
}

function elementContainsVisibleText(el) {
  const walker = document.createTreeWalker(
    el,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("[data-markcontit-root]")) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }
        const rect = parent.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  return !!walker.nextNode();
}

function clearHighlights() {
  highlightedEls.forEach((el) => {
    el.classList.remove(
      EXPLICIT_INCLUDE_CLASS,
      EXPLICIT_EXCLUDE_CLASS,
      INFERRED_INCLUDE_CLASS,
      INFERRED_EXCLUDE_CLASS
    );
  });
  highlightedEls = new Set();
}

function applyHighlights() {
  clearHighlights();
  if (!config || !configApplies(config)) return;
  const matchMap = new Map();
  const addMatches = (record, category) => {
    let matches = [];
    try {
      matches = document.querySelectorAll(record.selector);
    } catch (err) {
      return;
    }
    matches.forEach((element) => {
      if (!element || element.closest("[data-markcontit-root]")) return;
      const entry = matchMap.get(element) || {
        include: false,
        exclude: false,
        explicitInclude: false,
        explicitExclude: false
      };
      if (category === "include") {
        entry.include = true;
        if (record.createdFromUrl === location.href) {
          entry.explicitInclude = true;
        }
      } else {
        entry.exclude = true;
        if (record.createdFromUrl === location.href) {
          entry.explicitExclude = true;
        }
      }
      matchMap.set(element, entry);
    });
  };

  (config.includeSelectors || []).forEach((record) => addMatches(record, "include"));
  (config.excludeSelectors || []).forEach((record) => addMatches(record, "exclude"));

  matchMap.forEach((flags, element) => {
    let className = "";
    if (flags.explicitExclude) {
      className = EXPLICIT_EXCLUDE_CLASS;
    } else if (flags.explicitInclude) {
      className = EXPLICIT_INCLUDE_CLASS;
    } else if (flags.exclude) {
      className = INFERRED_EXCLUDE_CLASS;
    } else if (flags.include) {
      className = INFERRED_INCLUDE_CLASS;
    }
    if (className) {
      element.classList.add(className);
      highlightedEls.add(element);
    }
  });
}

function handleToggle(category) {
  if (!enabled) return;
  if (!configApplies(config)) {
    showToast("Set a base URL for this site in the popup.");
    return;
  }
  if (!hoverEl) return;
  const explicitRecords = getExplicitRecords(category);
  if (hasExplicitAncestor(hoverEl, explicitRecords)) {
    const message = category === "include"
      ? "Cannot include a child of an included segment."
      : "Cannot exclude a child of an excluded segment.";
    showToast(message);
    return;
  }

  const existing = findExplicitRecordForElement(hoverEl, explicitRecords);
  if (existing) {
    removeSelector(existing);
    return;
  }

  const selector = generateSelector(hoverEl);
  if (!selector) {
    showToast("Could not generate a selector for that element.");
    return;
  }
  addSelector(category, selector);
}

function getExplicitRecords(category) {
  const list = category === "include" ? config.includeSelectors : config.excludeSelectors;
  return (list || []).filter((record) => record.createdFromUrl === location.href);
}

function hasExplicitAncestor(element, explicitRecords) {
  let parent = element.parentElement;
  while (parent && parent !== document.documentElement) {
    if (matchesAnyRecord(parent, explicitRecords)) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

function findExplicitRecordForElement(element, explicitRecords) {
  let bestRecord = null;
  let bestCount = Number.POSITIVE_INFINITY;
  explicitRecords.forEach((record) => {
    try {
      if (!element.matches(record.selector)) return;
      const count = document.querySelectorAll(record.selector).length;
      if (count < bestCount) {
        bestCount = count;
        bestRecord = record;
      }
    } catch (err) {
      return;
    }
  });
  return bestRecord;
}

function matchesAnyRecord(element, records) {
  return records.some((record) => {
    try {
      return element.matches(record.selector);
    } catch (err) {
      return false;
    }
  });
}

function addSelector(category, selector) {
  chrome.runtime.sendMessage(
    {
      type: "addSelector",
      baseUrl: config.baseUrl,
      category,
      selector,
      createdFromUrl: location.href
    },
    (response) => {
      if (!response || response.error) {
        showToast(response && response.error ? response.error : "Unable to save selector.");
        return;
      }
      config = response.config;
      applyHighlights();
    }
  );
}

function removeSelector(record) {
  chrome.runtime.sendMessage(
    {
      type: "removeSelector",
      baseUrl: config.baseUrl,
      selectorId: record.id,
      category: record.category
    },
    (response) => {
      if (!response || response.error) {
        showToast(response && response.error ? response.error : "Unable to remove selector.");
        return;
      }
      config = response.config;
      applyHighlights();
    }
  );
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeAttrValue(value) {
  return value.replace(/"/g, "\\\"");
}

function stableAttributes(element) {
  const allowed = ["aria-label", "aria-labelledby", "role", "name", "title", "type"];
  return element
    .getAttributeNames()
    .filter((name) => name.startsWith("data-") || allowed.includes(name))
    .map((name) => [name, element.getAttribute(name)])
    .filter((pair) => pair[1] && pair[1].trim().length > 0)
    .filter((pair) => pair[1].length <= 60);
}

function stableClasses(element) {
  return Array.from(element.classList).filter((cls) => {
    if (!cls) return false;
    if (cls.length > 32) return false;
    if (/[a-f0-9]{6,}/i.test(cls)) return false;
    return true;
  });
}

function buildSelectorCandidates(element) {
  const tag = element.tagName.toLowerCase();
  const candidates = [];

  if (element.id) {
    candidates.push(`#${cssEscape(element.id)}`);
  }

  const attrs = stableAttributes(element);
  if (attrs.length) {
    const pairs = attrs.slice(0, 2)
      .map(([name, value]) => `[${name}="${escapeAttrValue(value)}"]`)
      .join("");
    candidates.push(`${tag}${pairs}`);
  }

  const classes = stableClasses(element);
  if (classes.length) {
    const list = classes.slice(0, 3).map((cls) => `.${cssEscape(cls)}`).join("");
    candidates.push(`${tag}${list}`);
  }

  candidates.push(tag);
  return candidates;
}

function bestSelectorFromCandidates(element, candidates) {
  let best = null;
  let bestCount = Number.POSITIVE_INFINITY;
  candidates.forEach((selector) => {
    try {
      const matches = document.querySelectorAll(selector);
      if (!element.matches(selector)) return;
      const count = matches.length;
      if (count < bestCount) {
        bestCount = count;
        best = selector;
      }
    } catch (err) {
      return;
    }
  });
  return best ? { selector: best, count: bestCount } : null;
}

function simpleSelector(element) {
  if (element.id) return `#${cssEscape(element.id)}`;
  const attrs = stableAttributes(element);
  if (attrs.length) {
    const [name, value] = attrs[0];
    return `${element.tagName.toLowerCase()}[${name}="${escapeAttrValue(value)}"]`;
  }
  const classes = stableClasses(element);
  if (classes.length) {
    return `${element.tagName.toLowerCase()}.${cssEscape(classes[0])}`;
  }
  return element.tagName.toLowerCase();
}

function nthOfTypeIndex(element) {
  const tag = element.tagName.toLowerCase();
  let index = 1;
  let sibling = element;
  while ((sibling = sibling.previousElementSibling)) {
    if (sibling.tagName.toLowerCase() === tag) {
      index += 1;
    }
  }
  return index;
}

function generateSelector(element) {
  const maxMatches = 5;
  let candidates = buildSelectorCandidates(element);
  let best = bestSelectorFromCandidates(element, candidates);

  let selectorPath = best ? best.selector : element.tagName.toLowerCase();
  let current = element;
  let depth = 0;

  while ((!best || best.count > maxMatches) && current.parentElement && depth < 3) {
    const parent = current.parentElement;
    const parentSelector = simpleSelector(parent);
    selectorPath = `${parentSelector} > ${selectorPath}`;
    candidates = [selectorPath];
    best = bestSelectorFromCandidates(element, candidates);
    current = parent;
    depth += 1;
  }

  if (!best) {
    return selectorPath;
  }

  if (best.count > maxMatches) {
    const nth = nthOfTypeIndex(element);
    const nthSelector = `${selectorPath}:nth-of-type(${nth})`;
    try {
      if (element.matches(nthSelector)) {
        return nthSelector;
      }
    } catch (err) {
      return selectorPath;
    }
  }

  return best.selector;
}

function initializeFromBackground() {
  chrome.runtime.sendMessage(
    { type: "getStateForContent", url: location.href },
    (response) => {
      if (!response) return;
      config = response.config;
      if (response.enabled && configApplies(config)) {
        enable();
      }
    }
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "setEnabled") {
    if (message.enabled && message.config && configApplies(message.config)) {
      config = message.config;
      enable();
    } else {
      if (message.enabled && !message.config) {
        showToast("Set a base URL for this site in the popup.");
      }
      disable();
    }
  }

  if (message.type === "configUpdated") {
    config = message.config;
    if (enabled) {
      if (configApplies(config)) {
        applyHighlights();
      } else {
        showToast("Current page is outside the base URL scope.");
      }
    }
  }

  sendResponse({ ok: true });
});

initializeFromBackground();
