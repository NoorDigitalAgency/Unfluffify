import * as core from "./content/core.js";
import * as config from "./common/config.js";
import * as utils from "./common/utilities.js";
import { DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS } from "./common/constants.js";

const { state } = core;

const SILENT_LINK_HIGHLIGHTING_ATTR = "data-uf-silent-link-highlighting";
const SILENT_CONTENT_HIGHLIGHTING_ATTR = "data-uf-silent-content-highlighting";
const SILENT_CONTENT_EXCLUDED_ATTR = "data-uf-silent-content-excluded";
const SILENT_HIGHLIGHTINGS_ACTIVE_ATTR = "data-uf-silent-highlightings";
const SILENT_CONTENT_POSITION_ATTR = "data-uf-silent-content-position";
const PAGE_TOAST_ID = "unfluffify-page-toast";
const PAGE_TOAST_STYLE_ID = "unfluffify-page-toast-style";
const URL_CHANGED_EVENT = "unfluffify:url-changed";

let silentHighlightingUrlTimer = 0;
let silentHighlightingObserver = null;
let silentHighlightingRefreshTimer = 0;
let lastSilentHighlightingRenderKey = "";
let lastSilentHighlightingsActive = false;
const SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS = {
  markedPages: true,
  includedContent: true,
  excludedContent: false,
  visibleConsent: false
};
let silentHighlightVisibility = { ...SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS };

const SILENT_HIGHLIGHTING_INTERNAL_ATTRS = new Set([
  SILENT_LINK_HIGHLIGHTING_ATTR,
  SILENT_CONTENT_HIGHLIGHTING_ATTR,
  SILENT_CONTENT_EXCLUDED_ATTR,
  SILENT_HIGHLIGHTINGS_ACTIVE_ATTR,
  SILENT_CONTENT_POSITION_ATTR,
  core.CONSENT_HIDDEN_ATTR
]);

function ensurePageToastStyle() {
  if (document.getElementById(PAGE_TOAST_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = PAGE_TOAST_STYLE_ID;
  style.textContent = `
      #${PAGE_TOAST_ID} {
        position: fixed;
        left: 14px;
        right: 14px;
        top: 14px;
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
        z-index: 2147483647;
        text-align: center;
        box-shadow: 0 8px 10px rgba(0, 0, 0, 0.35);
      }
      #${PAGE_TOAST_ID}.uf-toast-show {
        opacity: 1;
        transform: translateY(0);
      }
    `;
  (document.head || document.documentElement).appendChild(style);
}

function showPageToast(message) {
  ensurePageToastStyle();
  let toast = document.getElementById(PAGE_TOAST_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = PAGE_TOAST_ID;
    toast.setAttribute("data-uf-extension-ui", "true");
    (document.body || document.documentElement).appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("uf-toast-show");
  window.clearTimeout(showPageToast._timer);
  showPageToast._timer = window.setTimeout(() => {
    if (toast) {
      toast.classList.remove("uf-toast-show");
    }
  }, 3000);
}

function isEditableTarget(target) {
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

async function saveCurrentPageDraft(options) {
  const { baseUrl, showToast = false } = options || {};
  const targetBaseUrl = baseUrl || state.baseUrl || "";
  if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
    if (showToast) {
      showPageToast("Enable marking to save this page.");
    }
    return { ok: false };
  }
  const pageUrl = location.href;
  if (!core.isPageDraftDirty(pageUrl)) {
    if (showToast) {
      showPageToast("No changes to save");
    }
    return { ok: true, saved: false, dirty: false };
  }
  const immutableExcluded = core.collectImmutableElements();
  core.syncPageMarkings(state.config, pageUrl, immutableExcluded, {
    allowCreate: true,
    persist: true
  });
  const entry = core.getPageMarkingEntry(state.config, pageUrl);
  entry.fullHTML = document.documentElement.outerHTML;
  entry.title = document.title || pageUrl;
  state.config.pageMarkings[pageUrl] = entry;
  try {
    await core.saveConfig(targetBaseUrl, state.config);
  } catch (error) {
    if (showToast) {
      showPageToast("Unable to save page");
    }
    return { ok: false };
  }
  core.setSavedPageEntry(pageUrl, entry);
  core.scheduleRender();
  core.notifyDraftStatus(pageUrl);
  if (showToast) {
    showPageToast("Page saved");
  }
  return { ok: true, saved: true, dirty: false };
}

async function toggleEnabledFromPage() {
  const tabState = await utils.sendRuntimeMessage({ type: "getTabState" });
  const currentlyEnabled = Boolean(state.enabled || (tabState && tabState.enabled));
  let baseUrl = state.baseUrl || (tabState && tabState.baseUrl ? tabState.baseUrl : "");
  if (!baseUrl || !utils.isPageWithinBaseUrl(location.href, baseUrl)) {
    const configs = await config.getConfigs();
    baseUrl = utils.findMatchingBaseUrl(location.href, configs);
  }
  if (!baseUrl || !utils.isPageWithinBaseUrl(location.href, baseUrl)) {
    showPageToast("Set Base Page URL in the Unfluffify popup first.");
    return;
  }
  if (currentlyEnabled) {
    core.disable();
    await utils.sendRuntimeMessage({
      type: "setTabState",
      enabled: false,
      baseUrl
    });
    refreshSilentHighlightings().then();
    return;
  }
  await utils.sendRuntimeMessage({
    type: "setTabState",
    enabled: true,
    baseUrl
  });
  core.enableForBaseUrl(baseUrl).then();
  refreshSilentHighlightings().then();
}

function ensureSilentHighlightingStyles() {
  let style = document.getElementById("unfluffify-silent-highlightings-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "unfluffify-silent-highlightings-style";
    style.setAttribute("data-uf-extension-ui", "true");
    style.textContent = `
      html body a[${SILENT_LINK_HIGHLIGHTING_ATTR}][${SILENT_LINK_HIGHLIGHTING_ATTR}] {
        outline: 2px dashed #56acce !important;
        outline-offset: -2px !important;
      }
      html body a[${SILENT_LINK_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_POSITION_ATTR}="relative"] {
        position: relative !important;
      }
      html body a[${SILENT_LINK_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_POSITION_ATTR}]::before {
        content: "" !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        border: 2px dashed #56acce !important;
        pointer-events: none !important;
        z-index: 2 !important;
        box-sizing: border-box !important;
      }
      html body [${SILENT_CONTENT_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_POSITION_ATTR}="relative"][${SILENT_CONTENT_HIGHLIGHTING_ATTR}] {
        position: relative !important;
      }
      html body [${SILENT_CONTENT_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_POSITION_ATTR}][${SILENT_CONTENT_HIGHLIGHTING_ATTR}] {
        outline: 2px dashed #44b532 !important;
        outline-offset: -2px !important;
      }
      html body [${SILENT_CONTENT_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_POSITION_ATTR}][${SILENT_CONTENT_HIGHLIGHTING_ATTR}]::after {
        content: "" !important;
        position: absolute !important;
        outline: 2px dashed #44b532 !important;
        outline-offset: -2px !important;
        pointer-events: none !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 1 !important;
      }
      html body [${SILENT_CONTENT_EXCLUDED_ATTR}][${SILENT_CONTENT_EXCLUDED_ATTR}] {
        outline: 2px dashed #b03b3b !important;
        outline-offset: -2px !important;
        background: rgba(176, 59, 59, 0.08) !important;
      }
      html body [${SILENT_CONTENT_EXCLUDED_ATTR}][${SILENT_CONTENT_POSITION_ATTR}="relative"] {
        position: relative !important;
      }
      html body [${SILENT_CONTENT_EXCLUDED_ATTR}][${SILENT_CONTENT_POSITION_ATTR}]::before {
        content: "" !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        border: 2px dashed #b03b3b !important;
        pointer-events: none !important;
        z-index: 2 !important;
        box-sizing: border-box !important;
      }
      html body a[${SILENT_LINK_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_POSITION_ATTR}]::before {
        content: none !important;
      }
      html body a[${SILENT_LINK_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_HIGHLIGHTING_ATTR}][${SILENT_CONTENT_POSITION_ATTR}] {
        outline: none !important;
      }
      html [${core.CONSENT_HIDDEN_ATTR}] {
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }
      html.uf-visible-consent [${core.CONSENT_HIDDEN_ATTR}] {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }
    `;
  }
  const host = document.documentElement || document.body || document.head;
  if (!host) {
    return;
  }
  if (style.parentNode !== host || host.lastElementChild !== style) {
    host.appendChild(style);
  }
}

function setSilentHighlightingsActive(active) {
  if (active) {
    document.documentElement.setAttribute(SILENT_HIGHLIGHTINGS_ACTIVE_ATTR, "on");
  } else {
    document.documentElement.removeAttribute(SILENT_HIGHLIGHTINGS_ACTIVE_ATTR);
  }
}

function clearSilentHighlightingMarks() {
  const marked = document.querySelectorAll(
    `a[${SILENT_LINK_HIGHLIGHTING_ATTR}], [${SILENT_CONTENT_HIGHLIGHTING_ATTR}], [${SILENT_CONTENT_EXCLUDED_ATTR}]`
  );
  marked.forEach((node) => {
    const title = node.getAttribute("title") || "";
    if (title.startsWith("Unfluffify selector:")) {
      node.removeAttribute("title");
    }
    node.removeAttribute(SILENT_LINK_HIGHLIGHTING_ATTR);
    node.removeAttribute(SILENT_CONTENT_HIGHLIGHTING_ATTR);
    node.removeAttribute(SILENT_CONTENT_EXCLUDED_ATTR);
    node.removeAttribute(SILENT_CONTENT_POSITION_ATTR);
  });
  lastSilentHighlightingRenderKey = "";
  lastSilentHighlightingsActive = false;
}

function stopSilentHighlightingObserver() {
  if (silentHighlightingObserver) {
    silentHighlightingObserver.disconnect();
    silentHighlightingObserver = null;
  }
  if (silentHighlightingRefreshTimer) {
    window.clearTimeout(silentHighlightingRefreshTimer);
    silentHighlightingRefreshTimer = 0;
  }
}

function scheduleSilentHighlightingsRefresh() {
  if (silentHighlightingRefreshTimer) {
    return;
  }
  silentHighlightingRefreshTimer = window.setTimeout(() => {
    silentHighlightingRefreshTimer = 0;
    refreshSilentHighlightings().then();
  }, 500);
}

function isExtensionUiNode(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (node.getAttribute("data-uf-extension-ui") === "true") {
    return true;
  }
  return Boolean(node.closest("[data-uf-extension-ui=\"true\"]"));
}

function shouldRefreshForSilentMutation(mutation) {
  if (!mutation) {
    return false;
  }
  if (mutation.type === "attributes") {
    const attrName = mutation.attributeName || "";
    if (SILENT_HIGHLIGHTING_INTERNAL_ATTRS.has(attrName) || attrName === "title") {
      return false;
    }
    return !isExtensionUiNode(mutation.target);
  }
  if (mutation.type !== "childList") {
    return false;
  }
  if (isExtensionUiNode(mutation.target)) {
    return false;
  }
  for (const node of mutation.addedNodes || []) {
    if (node && node.nodeType === 1 && !isExtensionUiNode(node)) {
      return true;
    }
  }
  for (const node of mutation.removedNodes || []) {
    if (node && node.nodeType === 1 && !isExtensionUiNode(node)) {
      return true;
    }
  }
  return false;
}

function startSilentHighlightingObserver() {
  if (silentHighlightingObserver) {
    return;
  }
  const root = document.documentElement || document.body;
  if (!root) {
    return;
  }
  silentHighlightingObserver = new MutationObserver((mutations) => {
    if (!Array.isArray(mutations) || mutations.length === 0) {
      return;
    }
    if (mutations.some((mutation) => shouldRefreshForSilentMutation(mutation))) {
      scheduleSilentHighlightingsRefresh();
    }
  });
  silentHighlightingObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true
  });
}

function startSilentHighlightingUrlWatcher() {
  if (silentHighlightingUrlTimer) {
    return;
  }
  let lastUrl = location.href;
  silentHighlightingUrlTimer = window.setInterval(() => {
    if (state.enabled) {
      lastUrl = location.href;
      return;
    }
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      refreshSilentHighlightings().then();
    }
  }, 800);
}

function normalizeSelectorList(selectors) {
  const values = [];
  const seen = new Set();
  for (const selector of Array.isArray(selectors) ? selectors : []) {
    if (typeof selector !== "string") {
      continue;
    }
    const trimmed = selector.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    values.push(trimmed);
  }
  return values;
}

function normalizeAiSelectorSet(value) {
  if (!value || typeof value !== "object") {
    return { exclusionSelectors: [], inclusionSelectors: [] };
  }
  return {
    exclusionSelectors: normalizeSelectorList(value.exclusionSelectors),
    inclusionSelectors: normalizeSelectorList(value.inclusionSelectors)
  };
}

function combineAiSelectorSet(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  return [...normalized.exclusionSelectors, ...normalized.inclusionSelectors];
}

function normalizeSilentHighlightVisibility(value) {
  if (!value || typeof value !== "object") {
    return { ...SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS };
  }
  return {
    markedPages:
      typeof value.markedPages === "boolean"
        ? value.markedPages
        : SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS.markedPages,
    includedContent:
      typeof value.includedContent === "boolean"
        ? value.includedContent
        : SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS.includedContent,
    excludedContent:
      typeof value.excludedContent === "boolean"
        ? value.excludedContent
        : SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS.excludedContent,
    visibleConsent:
      typeof value.visibleConsent === "boolean"
        ? value.visibleConsent
        : SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS.visibleConsent
  };
}

function applyVisibleConsentVisibility(visibility) {
  const normalized = normalizeSilentHighlightVisibility(visibility);
  if (normalized.visibleConsent) {
    document.documentElement.classList.add("uf-visible-consent");
  } else {
    document.documentElement.classList.remove("uf-visible-consent");
  }
}

async function syncSilentHighlightVisibilityFromTabState() {
  try {
    const tabState = await utils.sendRuntimeMessage({ type: "getTabState" });
    silentHighlightVisibility = normalizeSilentHighlightVisibility(
      tabState && tabState.silentHighlightOptions
    );
  } catch {
    silentHighlightVisibility = { ...SILENT_HIGHLIGHT_VISIBILITY_DEFAULTS };
  }
  applyVisibleConsentVisibility(silentHighlightVisibility);
}

function normalizeUrlPath(pathname) {
  if (typeof pathname !== "string" || !pathname) {
    return "/";
  }
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

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

function getStoredAiSelectorSet(baseConfig) {
  if (!baseConfig || typeof baseConfig !== "object") {
    return { exclusionSelectors: [], inclusionSelectors: [] };
  }
  const latestComputed = normalizeAiSelectorSet(baseConfig.latestComputedSelectors);
  if (combineAiSelectorSet(latestComputed).length) {
    return latestComputed;
  }
  return normalizeAiSelectorSet(baseConfig.domainAiSelectorSet);
}

function getEffectiveAiSelectorSet(baseConfig) {
  return getStoredAiSelectorSet(baseConfig);
}

function collectExcludedNodesFromSelectors(selectors) {
  const excluded = new Set();
  selectors.forEach((selector) => {
    if (typeof selector !== "string" || !selector) {
      return;
    }
    try {
      document.querySelectorAll(selector).forEach((node) => {
        if (!isExtensionUiNode(node)) {
          excluded.add(node);
        }
      });
    } catch {
      // Ignore invalid selectors
    }
  });
  return excluded;
}

function isWithinExcludedNode(node, excluded) {
  if (!node || !excluded || excluded.size === 0) {
    return false;
  }
  let current = node;
  while (current && current.nodeType === 1) {
    if (excluded.has(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hasDirectRenderableText(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (node.tagName === "SCRIPT" || node.tagName === "STYLE" || node.tagName === "NOSCRIPT") {
    return false;
  }
  for (const child of node.childNodes || []) {
    if (child.nodeType !== Node.TEXT_NODE) {
      continue;
    }
    if ((child.textContent || "").replace(/\s+/g, " ").trim()) {
      return true;
    }
  }
  return false;
}

function getNormalizedNodeText(node) {
  if (!node || node.nodeType !== 1) {
    return "";
  }
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

function canUseCollapsedTextFallbackNode(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (!getNormalizedNodeText(node)) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width === 0 || rect.height === 0;
}

function matchesImmutableDefaultSelector(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  for (const selector of DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS) {
    try {
      const query = /^[a-z]+$/i.test(selector) ? selector.toLowerCase() : selector;
      if (node.matches(query)) {
        return true;
      }
    } catch {
      // Ignore invalid selectors
    }
  }
  return false;
}

function isWithinImmutableDefaultNode(node) {
  let current = node;
  while (current && current.nodeType === 1) {
    if (matchesImmutableDefaultSelector(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isWithinNodeSet(node, nodes) {
  if (!node || !nodes || nodes.size === 0) {
    return false;
  }
  let current = node;
  while (current && current.nodeType === 1) {
    if (nodes.has(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isRawSelectorExcludedNode(node, excludedNodes, includedNodes) {
  return isWithinNodeSet(node, excludedNodes) && !isWithinNodeSet(node, includedNodes);
}

function isSelectorExcludedNode(node, excludedNodes, includedNodes, inclusionContextSet) {
  if (!isRawSelectorExcludedNode(node, excludedNodes, includedNodes)) {
    return false;
  }
  return !(inclusionContextSet && inclusionContextSet.has(node));
}

function isExcludedNatureNode(node, excludedNodes, includedNodes, inclusionContextSet) {
  return matchesImmutableDefaultSelector(node) ||
    isSelectorExcludedNode(node, excludedNodes, includedNodes, inclusionContextSet);
}

function buildInclusionContextSet(includedNodes) {
  const context = new Set();
  for (const node of includedNodes || []) {
    let current = node;
    while (current && current.nodeType === 1) {
      context.add(current);
      current = current.parentElement;
    }
  }
  return context;
}

function isInclusionEligibleNode(node, excludedNodes, includedNodes, inclusionContextSet) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (isExtensionUiNode(node)) {
    return false;
  }
  if (!core.isVisible(node) && !canUseCollapsedTextFallbackNode(node)) {
    return false;
  }
  if (isWithinImmutableDefaultNode(node)) {
    return false;
  }
  return !isWithinNodeSet(node, excludedNodes) ||
    isWithinNodeSet(node, includedNodes) ||
    Boolean(inclusionContextSet && inclusionContextSet.has(node));
}

function hasRenderableTextOutsideExcludedNature(
  node,
  excludedNodes,
  includedNodes,
  inclusionContextSet
) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(current)) {
      continue;
    }
    if (current !== node && !core.isVisible(current)) {
      continue;
    }
    if (
      current !== node &&
      isExcludedNatureNode(
        current,
        excludedNodes,
        includedNodes,
        inclusionContextSet
      )
    ) {
      continue;
    }
    if (hasDirectRenderableText(current)) {
      return true;
    }
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      stack.push(current.children[i]);
    }
  }
  return false;
}

function getNodeDepth(node) {
  let depth = 0;
  let current = node;
  while (current && current.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function isCoveredBySelected(node, boundary, selectedNodes) {
  let current = node;
  while (current && current !== boundary) {
    if (selectedNodes.has(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function canPromoteToParent(
  parent,
  selectedNodes,
  excludedNodes,
  includedNodes,
  inclusionContextSet
) {
  if (!isInclusionEligibleNode(parent, excludedNodes, includedNodes, inclusionContextSet)) {
    return false;
  }
  if (!hasDirectRenderableText(parent)) {
    if (
      !canUseCollapsedTextFallbackNode(parent) ||
      !(
        getNormalizedNodeText(parent) ||
        hasRenderableTextOutsideExcludedNature(
          parent,
          excludedNodes,
          includedNodes,
          inclusionContextSet
        )
      )
    ) {
      return false;
    }
  }
  let hasSelectedDescendant = false;
  const stack = Array.from(parent.children || []);
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(node) || !core.isVisible(node)) {
      continue;
    }
    if (isExcludedNatureNode(node, excludedNodes, includedNodes, inclusionContextSet)) {
      return false;
    }
    if (selectedNodes.has(node)) {
      hasSelectedDescendant = true;
    }
    if (hasDirectRenderableText(node) && !isCoveredBySelected(node, parent, selectedNodes)) {
      return false;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return hasSelectedDescendant;
}

function collapseToShallowest(nodes) {
  const sorted = Array.from(nodes || []).sort((left, right) => {
    const depthDiff = getNodeDepth(left) - getNodeDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return 0;
  });
  const kept = [];
  sorted.forEach((node) => {
    if (!node || node.nodeType !== 1) {
      return;
    }
    const hasAncestor = kept.some((ancestor) => ancestor.contains(node));
    if (!hasAncestor) {
      kept.push(node);
    }
  });
  return kept;
}

function collectExcludedChildrenInsideIncludedParents(
  includedParents,
  excludedNodes,
  includedNodes,
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
      const node = stack.pop();
      if (!node || node.nodeType !== 1) {
        continue;
      }
      if (isExtensionUiNode(node) || !core.isVisible(node)) {
        continue;
      }
      const excludedNature = isExcludedNatureNode(
        node,
        excludedNodes,
        includedNodes,
        inclusionContextSet
      );
      if (excludedNature) {
        if (!seen.has(node)) {
          seen.add(node);
          marked.push(node);
        }
        continue;
      }
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        stack.push(node.children[i]);
      }
    }
  });
  return marked;
}

function collectSelectorExcludedNodes(excludedNodes, includedNodes) {
  const marked = new Set();
  for (const node of excludedNodes || []) {
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(node) || !core.isVisible(node)) {
      continue;
    }
    if (isWithinNodeSet(node, includedNodes)) {
      continue;
    }
    marked.add(node);
  }
  return collapseToShallowest(marked);
}

function collectIncludedNodesFromSelectorSet(selectorSet) {
  const normalized = normalizeAiSelectorSet(selectorSet);
  const excludedNodes = collectExcludedNodesFromSelectors(normalized.exclusionSelectors);
  const includedNodes = collectExcludedNodesFromSelectors(normalized.inclusionSelectors);
  const inclusionContextSet = buildInclusionContextSet(includedNodes);
  const baseSelected = new Set();
  const stack = [document.body];

  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (!isInclusionEligibleNode(node, excludedNodes, includedNodes, inclusionContextSet)) {
      continue;
    }
    const rawSelectorExcluded = isRawSelectorExcludedNode(
      node,
      excludedNodes,
      includedNodes
    );
    const isAutoIncludedCollapsedText =
      canUseCollapsedTextFallbackNode(node) &&
      (
        getNormalizedNodeText(node) ||
        hasRenderableTextOutsideExcludedNature(
          node,
          excludedNodes,
          includedNodes,
          inclusionContextSet
        )
      );
    if ((hasDirectRenderableText(node) || isAutoIncludedCollapsedText) && !rawSelectorExcluded) {
      baseSelected.add(node);
    } else if (
      includedNodes.has(node) &&
      hasRenderableTextOutsideExcludedNature(
        node,
        excludedNodes,
        includedNodes,
        inclusionContextSet
      )
    ) {
      baseSelected.add(node);
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }

  const selectedNodes = new Set(baseSelected);
  const sortedByDepthDesc = Array.from(baseSelected).sort(
    (left, right) => getNodeDepth(right) - getNodeDepth(left)
  );
  sortedByDepthDesc.forEach((node) => {
    let current = node && node.parentElement;
    while (current && current.nodeType === 1) {
      if (
        !canPromoteToParent(
          current,
          selectedNodes,
          excludedNodes,
          includedNodes,
          inclusionContextSet
        )
      ) {
        break;
      }
      for (const existing of Array.from(selectedNodes)) {
        if (existing !== current && current.contains(existing)) {
          selectedNodes.delete(existing);
        }
      }
      selectedNodes.add(current);
      current = current.parentElement;
    }
  });

  const included = collapseToShallowest(selectedNodes);
  const excludedDescendants = collectExcludedChildrenInsideIncludedParents(
    included,
    excludedNodes,
    includedNodes,
    inclusionContextSet
  );
  const selectorExcluded = collectSelectorExcludedNodes(excludedNodes, includedNodes);
  const excluded = Array.from(new Set([...selectorExcluded, ...excludedDescendants]));
  return { included, excluded };
}

let silentRenderNodeIdCounter = 0;
const silentRenderNodeIds = new WeakMap();

function getSilentRenderNodeId(node) {
  if (!node || node.nodeType !== 1) {
    return 0;
  }
  let id = silentRenderNodeIds.get(node);
  if (!id) {
    id = ++silentRenderNodeIdCounter;
    silentRenderNodeIds.set(node, id);
  }
  return id;
}

function buildSilentHighlightingRenderKey(visibility, anchors, contentNodes, excludedNodes) {
  const anchorIds = anchors
    .map(getSilentRenderNodeId)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const contentIds = contentNodes
    .map(getSilentRenderNodeId)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const excludedIds = excludedNodes
    .map(getSilentRenderNodeId)
    .filter(Boolean)
    .sort((a, b) => a - b);
  return [
    visibility.markedPages ? 1 : 0,
    visibility.includedContent ? 1 : 0,
    visibility.excludedContent ? 1 : 0,
    visibility.visibleConsent ? 1 : 0,
    anchorIds.join(","),
    contentIds.join(","),
    excludedIds.join(",")
  ].join("|");
}

function hasRenderableClientBox(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function resolveSilentHighlightRenderTarget(node) {
  if (!node || node.nodeType !== 1) {
    return null;
  }
  if (hasRenderableClientBox(node)) {
    return node;
  }
  const stack = Array.from(node.children || []);
  let inspected = 0;
  const MAX_INSPECTED = 200;
  while (stack.length && inspected < MAX_INSPECTED) {
    const current = stack.shift();
    inspected += 1;
    if (!current || current.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(current) || !core.isVisible(current)) {
      continue;
    }
    if (hasRenderableClientBox(current)) {
      return current;
    }
    for (let i = 0; i < current.children.length; i += 1) {
      stack.push(current.children[i]);
    }
  }
  return null;
}

function toRenderableNodeList(nodes) {
  const results = [];
  const seen = new Set();
  for (const node of nodes || []) {
    const target = resolveSilentHighlightRenderTarget(node);
    if (!target || seen.has(target)) {
      continue;
    }
    seen.add(target);
    results.push(target);
  }
  return results;
}

function setSilentHighlightNodePosition(node) {
  if (!node || node.nodeType !== 1) {
    return;
  }
  const computed = window.getComputedStyle(node);
  const position = computed ? computed.position : "";
  const positionValue = position && position !== "static" ? "existing" : "relative";
  node.setAttribute(SILENT_CONTENT_POSITION_ATTR, positionValue);
}

function refreshEnabledAiHighlights() {
  if (!state.enabled || !state.baseUrl || !state.config) {
    return;
  }
  const selectorSet = getEffectiveAiSelectorSet(state.config);
  if (!state.config.domainAiSelectorSet || typeof state.config.domainAiSelectorSet !== "object") {
    state.config.domainAiSelectorSet = {
      exclusionSelectors: [],
      inclusionSelectors: []
    };
  }
  state.config.domainAiSelectorSet = selectorSet;
  core.scheduleRender();
}

async function refreshSilentHighlightings() {
  if (state.enabled) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    refreshEnabledAiHighlights();
    return;
  }
  const pageUrl = location.href;
  const configs = await config.getConfigs();
  const baseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  if (!baseUrl) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  const normalized = config.normalizeConfig(baseUrl, configs[baseUrl]);
  const baseConfig = normalized.config || {};
  if (normalized.changed) {
    configs[baseUrl] = baseConfig;
    await config.saveConfigs(configs);
  }
  const pageMarkings = baseConfig.pageMarkings || {};
  const latestComputedSelectors = getStoredAiSelectorSet(baseConfig);
  const effectiveSelectorSet = getEffectiveAiSelectorSet(baseConfig);
  const visibility = normalizeSilentHighlightVisibility(silentHighlightVisibility);
  applyVisibleConsentVisibility(visibility);
  ensureSilentHighlightingStyles();
  const hasSelectorHighlights = combineAiSelectorSet(latestComputedSelectors).length > 0;
  const savedUrls = new Set();
  const savedLooseUrls = new Set();
  Object.keys(pageMarkings).forEach((url) => {
    if (typeof url !== "string" || !url) {
      return;
    }
    savedUrls.add(url);
    const loose = toLooseUrlKey(url, pageUrl);
    if (loose) {
      savedLooseUrls.add(loose);
    }
  });
  const storedEntry = pageMarkings[pageUrl] || null;
  const storedConsentXpaths =
    storedEntry && Array.isArray(storedEntry.consentXpaths)
      ? storedEntry.consentXpaths
      : null;
  const newlyHiddenConsentCount = core.hideConsentElements(storedConsentXpaths);
  const hasHiddenConsent =
    newlyHiddenConsentCount > 0 ||
    Boolean(document.querySelector(`[${core.CONSENT_HIDDEN_ATTR}]`));
  const shouldObserve =
    (visibility.markedPages && savedUrls.size > 0) ||
    ((visibility.includedContent || visibility.excludedContent) && hasSelectorHighlights) ||
    hasHiddenConsent;
  if (!shouldObserve) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  const anchors = [];
  if (visibility.markedPages && savedUrls.size > 0) {
    const anchorNodes = document.querySelectorAll("a[href]");
    anchorNodes.forEach((anchor) => {
      if (!anchor || !anchor.getAttribute) {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("javascript:") || href.startsWith("#")) {
        return;
      }
      let resolved = "";
      let resolvedLoose = "";
      try {
        resolved = new URL(href, pageUrl).href;
        resolvedLoose = toLooseUrlKey(resolved, pageUrl);
      } catch (error) {
        return;
      }
      if (
        savedUrls.has(resolved) ||
        (resolvedLoose && savedLooseUrls.has(resolvedLoose))
      ) {
        anchors.push(anchor);
      }
    });
  }
  let contentNodes = [];
  let excludedNodes = [];
  if ((visibility.includedContent || visibility.excludedContent) && hasSelectorHighlights) {
    const contentMarking = collectIncludedNodesFromSelectorSet(effectiveSelectorSet);
    if (visibility.includedContent) {
      contentNodes = toRenderableNodeList(contentMarking.included);
    }
    if (visibility.excludedContent) {
      excludedNodes = toRenderableNodeList(contentMarking.excluded);
    }
  }
  const shouldBeActive =
    anchors.length > 0 || contentNodes.length > 0 || excludedNodes.length > 0;
  const renderKey = buildSilentHighlightingRenderKey(
    visibility,
    anchors,
    contentNodes,
    excludedNodes
  );
  if (
    renderKey !== lastSilentHighlightingRenderKey ||
    shouldBeActive !== lastSilentHighlightingsActive
  ) {
    clearSilentHighlightingMarks();
    anchors.forEach((anchor) => {
      anchor.setAttribute(SILENT_LINK_HIGHLIGHTING_ATTR, "on");
      setSilentHighlightNodePosition(anchor);
    });
    contentNodes.forEach((node) => {
      node.setAttribute(SILENT_CONTENT_HIGHLIGHTING_ATTR, "on");
      setSilentHighlightNodePosition(node);
    });
    excludedNodes.forEach((node) => {
      node.setAttribute(SILENT_CONTENT_EXCLUDED_ATTR, "on");
      setSilentHighlightNodePosition(node);
    });
    lastSilentHighlightingRenderKey = renderKey;
    lastSilentHighlightingsActive = shouldBeActive;
  }
  setSilentHighlightingsActive(shouldBeActive);
  startSilentHighlightingObserver();
}

export function main() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;

  core.refreshFromTabState().then(() => {
    refreshEnabledAiHighlights();
    syncSilentHighlightVisibilityFromTabState().then(() => {
      refreshSilentHighlightings().then();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.altKey &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.repeat
    ) {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.key === "e" || event.key === "E") {
        event.preventDefault();
        event.stopPropagation();
        toggleEnabledFromPage().then();
        return;
      }
      if (event.key === "s" || event.key === "S") {
        if (!state.enabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        saveCurrentPageDraft({ showToast: true }).then();
      }
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "setEnabled") {
      if (message.enabled) {
        stopSilentHighlightingObserver();
        clearSilentHighlightingMarks();
        setSilentHighlightingsActive(false);
        core.enableForBaseUrl(message.baseUrl)
          .then(() => {
            refreshEnabledAiHighlights();
          });
      } else {
        core.disable();
        refreshSilentHighlightings().then();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "setSilentHighlightVisibility") {
      silentHighlightVisibility = normalizeSilentHighlightVisibility(message);
      applyVisibleConsentVisibility(silentHighlightVisibility);
      refreshSilentHighlightings().then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "configUpdated") {
      if (state.enabled && message.baseUrl === state.baseUrl) {
        const pageUrl = location.href;
        const draftEntry = core.getDraftPageEntry(pageUrl);
        const savedEntry = core.getSavedPageEntry(pageUrl);
        core.loadConfig(state.baseUrl).then((config) => {
          core.mergeDraftEntry(config, pageUrl, draftEntry, savedEntry);
          state.config = config;
          refreshEnabledAiHighlights();
        });
      } else {
        refreshSilentHighlightings().then();
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "forceRefresh") {
      core.refreshFromTabState().then(() => {
        refreshEnabledAiHighlights();
        refreshSilentHighlightings().then(() => {
          sendResponse({ ok: true });
        });
      });
      return true;
    }

    if (message.type === "getDefaultExclusions") {
      sendResponse({
        immutableSelectors: DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.slice()
      });
      return;
    }

    if (message.type === "collectPageData") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      core.loadConfig(targetBaseUrl).then((config) => {
        const entry = core.getPageMarkingEntry(config, location.href, {
          create: false,
          persist: false
        });
        sendResponse({
          baseUrl: targetBaseUrl,
          pageUrl: location.href,
          fullHTML: document.documentElement.outerHTML,
          immutableSelectors: DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.slice(),
          xpaths: entry.xpaths || []
        });
      });
      return true;
    }

    if (message.type === "getDefaultTagExclusionStatus") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const useStateConfig =
        state.baseUrl === targetBaseUrl && state.config;
      const loadPromise = useStateConfig
        ? Promise.resolve(state.config)
        : core.loadConfig(targetBaseUrl);
      loadPromise.then((config) => {
        const immutableExcluded = core.collectImmutableElements();
        const hasEntry = core.hasPageMarkingEntry(config, location.href);
        const syncResult = core.syncPageMarkings(config, location.href, immutableExcluded, {
          allowCreate: hasEntry,
          persist: useStateConfig && hasEntry
        });
        sendResponse({ items: core.collectDefaultTagExclusionStatus(config, syncResult.entry) });
      });
      return true;
    }

    if (message.type === "filterXPathsOnPage") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const filtered = xpaths.filter((xpath) => {
        const el = core.getElementFromXPath(xpath);
        return el && core.isVisible(el);
      });
      sendResponse({ xpaths: filtered });
      return;
    }

    if (message.type === "describeXPathsOnPage") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const items = [];
      xpaths.forEach((xpath) => {
        const el = core.getElementFromXPath(xpath);
        if (!el || !core.isVisible(el)) {
          return;
        }
        items.push({ xpath, text: core.getElementLabel(el) });
      });
      sendResponse({ items });
      return;
    }

    if (message.type === "focusElement") {
      const xpath = message.xpath || "";
      const target = xpath ? core.getElementFromXPath(xpath) : null;
      if (!target) {
        sendResponse({ ok: false });
        return;
      }
      state.focusElement = target;
      target.scrollIntoView({ block: "center", inline: "center" });
      core.scheduleRender();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "clearFocus") {
      core.clearFocusHighlight();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "toggleDefaultTagExclusion") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const xpath = message.xpath || "";
      if (!xpath) {
        sendResponse({ ok: false });
        return;
      }
      const useStateConfig =
        state.baseUrl === targetBaseUrl && state.config;
      const loadPromise = useStateConfig
        ? Promise.resolve(state.config)
        : core.loadConfig(targetBaseUrl);
      loadPromise.then((config) => {
        const target = core.getElementFromXPath(xpath);
        if (
          !target ||
          !core.isMarkableElement(target, config, { allowParent: true }) ||
          !core.isDefaultToggleableExcludedElement(target)
        ) {
          sendResponse({ ok: false });
          return;
        }
        const entry = core.getPageMarkingEntry(config, location.href);
        const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
        let targetItem = items.find((item) => item && item.xpath === xpath);
        const currentExcluded = targetItem ? Boolean(targetItem.excluded) : true;
        const nextExcluded = !currentExcluded;
        if (!targetItem) {
          targetItem = { xpath, excluded: nextExcluded };
          items.push(targetItem);
        } else {
          targetItem.excluded = nextExcluded;
        }
        if (targetItem.excluded) {
          for (let i = items.length - 1; i >= 0; i -= 1) {
            const item = items[i];
            if (!item || !item.xpath || item.xpath === xpath) {
              continue;
            }
            const existingEl = core.getElementFromXPath(item.xpath);
            if (
              (existingEl && target.contains(existingEl)) ||
              core.isXPathDescendant(xpath, item.xpath)
            ) {
              items.splice(i, 1);
            }
          }
          if (Array.isArray(entry.includeXpaths)) {
            entry.includeXpaths = entry.includeXpaths.filter((value) => value !== xpath);
          }
        }
        entry.xpaths = items;
        core.normalizePageEntryXpaths(entry);
        config.pageMarkings[location.href] = entry;
        if (useStateConfig) {
          state.config = config;
          core.scheduleRender();
          core.scheduleSnapshotSave();
          core.notifyDraftStatus(location.href);
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "capturePageSnapshot") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl) {
        sendResponse({ ok: false });
        return;
      }
      const shouldPersist = Boolean(message.persist);

      (async () => {
        let config;
        if (state.baseUrl === targetBaseUrl && state.config) {
          // Use the in-memory config to preserve any unsaved changes
          config = state.config;
        } else {
          // Load from storage if it's a different base URL
          config = await core.loadConfig(targetBaseUrl);
        }

        const allowCreate = shouldPersist;
        const hasEntry = core.hasPageMarkingEntry(config, location.href);
        if (!allowCreate && !hasEntry) {
          sendResponse({ ok: false });
          return;
        }

        // Ensure page entry is synced first, then capture HTML
        const immutableExcluded = core.collectImmutableElements();
        const syncResult = core.syncPageMarkings(config, location.href, immutableExcluded, {
          allowCreate,
          persist: allowCreate || hasEntry
        });

        // Now capture the full HTML (after consent elements are removed)
        const entry = syncResult.entry || core.getPageMarkingEntry(config, location.href);
        entry.fullHTML = document.documentElement.outerHTML;
        entry.title = document.title || location.href;
        config.pageMarkings[location.href] = entry;

        if (shouldPersist) {
          await core.saveConfig(targetBaseUrl, config);
        }

        if (state.baseUrl === targetBaseUrl) {
          state.config = config;
          if (shouldPersist) {
            core.setSavedPageEntry(location.href, entry);
          }
        }
        sendResponse({ ok: true });
      })();

      return true;
    }

    if (message.type === "copyPageDataFromStored") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const sourceBaseUrl = message.sourceBaseUrl || "";
      const sourcePageUrl = message.sourcePageUrl || "";
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false, error: "Page data unavailable" });
        return;
      }
      if (!sourceBaseUrl || !sourcePageUrl) {
        sendResponse({ ok: false, error: "Missing source page" });
        return;
      }
      (async () => {
        const sourceConfig = await core.loadConfig(sourceBaseUrl);
        const sourceEntry =
          sourceConfig.pageMarkings && sourceConfig.pageMarkings[sourcePageUrl]
            ? sourceConfig.pageMarkings[sourcePageUrl]
            : null;
        if (!sourceEntry || !Array.isArray(sourceEntry.xpaths)) {
          sendResponse({ ok: false, error: "No stored page data found" });
          return;
        }
        const result = core.copyEntryXpathsToPage(state.config, location.href, sourceEntry);
        core.scheduleRender();
        core.scheduleSnapshotSave();
        core.notifyDraftStatus(location.href);
        sendResponse({ ok: true, copied: result.copied, total: result.total });
      })();
      return true;
    }

    if (message.type === "getPageDraftStatus") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      const pageUrl = location.href;
      const hasEntry = core.hasPageMarkingEntry(state.config, pageUrl);
      const savedEntryBeforeSync = core.getSavedPageEntry(pageUrl);
      const draftEntryBeforeSync = core.getDraftPageEntry(pageUrl);
      const wasClean =
        hasEntry && core.areEntriesEquivalent(draftEntryBeforeSync, savedEntryBeforeSync);
      const immutableExcluded = core.collectImmutableElements();
      const syncResult = core.syncPageMarkings(state.config, pageUrl, immutableExcluded, {
        allowCreate: hasEntry,
        persist: hasEntry
      });
      const entry = hasEntry ? syncResult.entry : null;
      if (hasEntry && wasClean && syncResult.changed && entry) {
        core.setSavedPageEntry(pageUrl, entry);
      }
      const savedEntry = core.getSavedPageEntry(pageUrl);
      sendResponse({
        ok: true,
        entry: entry ? core.clonePageEntry(entry) : null,
        savedEntry,
        dirty: !core.areEntriesEquivalent(entry, savedEntry)
      });
      return;
    }

    if (message.type === "setExplicitExclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      const xpath = message.xpath || "";
      if (!xpath) {
        sendResponse({ ok: false });
        return;
      }
      const excluded = Boolean(message.excluded);
      const entry = core.getPageMarkingEntry(state.config, location.href);
      const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
      let targetItem = items.find((item) => item && item.xpath === xpath);
      if (!targetItem) {
        targetItem = { xpath, excluded };
        items.push(targetItem);
      } else {
        targetItem.excluded = excluded;
      }
      const target = core.getElementFromXPath(xpath);
      if (excluded) {
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (!item || !item.xpath || item.xpath === xpath) {
            continue;
          }
          const existingEl = core.getElementFromXPath(item.xpath);
          const withinTarget =
            target && existingEl ? target.contains(existingEl) : core.isXPathDescendant(xpath, item.xpath);
          if (withinTarget) {
            items.splice(i, 1);
          }
        }
      }
      if (excluded && Array.isArray(entry.includeXpaths)) {
        entry.includeXpaths = entry.includeXpaths.filter((value) => value !== xpath);
      }
      entry.xpaths = items;
      core.normalizePageEntryXpaths(entry);
      state.config.pageMarkings[location.href] = entry;
      core.scheduleRender();
      core.scheduleSnapshotSave();
      core.notifyDraftStatus(location.href);
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "setExplicitInclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      const xpath = message.xpath || "";
      if (!xpath) {
        sendResponse({ ok: false });
        return;
      }
      const included = Boolean(message.included);
      const entry = core.getPageMarkingEntry(state.config, location.href);
      const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
      const existingIndex = includeXpaths.indexOf(xpath);
      if (included) {
        const target = core.getElementFromXPath(xpath);
        if (!target) {
          sendResponse({ ok: false });
          return;
        }
        if (
          existingIndex === -1 &&
          !core.canApplyExplicitInclude(target, state.config, location.href, entry)
        ) {
          sendResponse({ ok: false });
          return;
        }
        if (existingIndex === -1) {
          includeXpaths.push(xpath);
        }
        const items = Array.isArray(entry.xpaths) ? entry.xpaths : [];
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (!item || !item.xpath || item.xpath === xpath) {
            continue;
          }
          const existingEl = core.getElementFromXPath(item.xpath);
          const withinTarget =
            target && existingEl ? target.contains(existingEl) : core.isXPathDescendant(xpath, item.xpath);
          if (withinTarget) {
            items.splice(i, 1);
          }
        }
        entry.xpaths = items;
        for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
          const childXpath = includeXpaths[i];
          if (!childXpath || childXpath === xpath) {
            continue;
          }
          const existingEl = core.getElementFromXPath(childXpath);
          const withinTarget =
            target && existingEl ? target.contains(existingEl) : core.isXPathDescendant(xpath, childXpath);
          if (withinTarget) {
            includeXpaths.splice(i, 1);
          }
        }
      } else if (existingIndex >= 0) {
        includeXpaths.splice(existingIndex, 1);
      }
      entry.includeXpaths = includeXpaths;
      core.normalizePageEntryXpaths(entry);
      state.config.pageMarkings[location.href] = entry;
      core.scheduleRender();
      core.scheduleSnapshotSave();
      core.notifyDraftStatus(location.href);
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "savePageDraft") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      saveCurrentPageDraft({ baseUrl: targetBaseUrl }).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    if (message.type === "revertPageDraft") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      (async () => {
        const pageUrl = location.href;
        const config = await core.loadConfig(targetBaseUrl);
        const storedEntry =
          config.pageMarkings && config.pageMarkings[pageUrl]
            ? config.pageMarkings[pageUrl]
            : null;
        core.setSavedPageEntry(pageUrl, storedEntry);
        if (storedEntry) {
          const immutableExcluded = core.collectImmutableElements();
          core.syncPageMarkings(config, pageUrl, immutableExcluded, {
            allowCreate: true,
            persist: true
          });
        }
        state.baseUrl = targetBaseUrl;
        state.config = config;
        core.scheduleRender();
        core.notifyDraftStatus(pageUrl);
        sendResponse({
          ok: true,
          dirty: core.isPageDraftDirty(pageUrl),
          entry: storedEntry ? core.clonePageEntry(storedEntry) : null
        });
      })();
      return true;
    }

    if (message.type === "deletePageEntry") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || state.baseUrl !== targetBaseUrl || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      (async () => {
        const pageUrl = location.href;
        core.removePageEntry(state.config, pageUrl);
        const storedConfig = await core.loadConfig(targetBaseUrl);
        core.removePageEntry(storedConfig, pageUrl);
        await core.saveConfig(targetBaseUrl, storedConfig);
        core.setSavedPageEntry(pageUrl, null);
        core.scheduleRender();
        core.notifyDraftStatus(pageUrl);
        sendResponse({ ok: true, dirty: core.isPageDraftDirty(pageUrl) });
      })();
      return true;
    }

    if (message.type === "showAiPreview") {
      const selectorSet = normalizeAiSelectorSet(message.selectorSet);
      const items = core.collectPreviewItems(selectorSet);
      core.showAiPopover(items);
      sendResponse({ ok: true, count: items.length });
    }
  });

  window.addEventListener(URL_CHANGED_EVENT, () => {
    refreshSilentHighlightings().then();
  });

  syncSilentHighlightVisibilityFromTabState().then(() => {
    refreshSilentHighlightings().then();
  });
  startSilentHighlightingUrlWatcher();
  window.addEventListener("resize", core.scheduleRender);
  window.addEventListener("scroll", core.handleScroll, { passive: true });
  window.addEventListener("beforeunload", core.handleBeforeUnload);
}
