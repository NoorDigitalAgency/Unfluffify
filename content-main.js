import * as core from "./content/core.js";
import * as config from "./common/config.js";
import * as utils from "./common/utilities.js";
import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS
} from "./common/constants.js";
import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  isWithinAncestorSet as isWithinNodeSet,
  buildInclusionContextSet,
  getNormalizedTextContent as getNormalizedNodeText,
  canUseCollapsedTextFallback as canUseCollapsedTextFallbackNode
} from "./content/shared-inclusion.js";
import {
  SILENT_HIGHLIGHT_OPTIONS_DEFAULTS,
  normalizeSilentHighlightOptions
} from "./common/silent-highlight-options.js";
import {
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS,
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES,
  shouldCollectSilentExcludedSource,
  shouldRenderSilentHighlightOverlay,
  sampleSettledSilentHighlightPosition
} from "./content/silent-highlight-rules.js";

const { state } = core;

const SILENT_LINK_HIGHLIGHTING_ATTR = "data-uf-silent-link-highlighting";
const SILENT_CONTENT_HIGHLIGHTING_ATTR = "data-uf-silent-content-highlighting";
const SILENT_CONTENT_EXCLUDED_ATTR = "data-uf-silent-content-excluded";
const SILENT_HIGHLIGHTINGS_ACTIVE_ATTR = "data-uf-silent-highlightings";
const SILENT_CONTENT_POSITION_ATTR = "data-uf-silent-content-position";
const SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR = "data-uf-silent-selector-include";
const SILENT_SELECTOR_EXCLUDE_ATTR = "data-uf-silent-selector-exclude";
const AI_PREVIEW_CLICKABLE_ATTR = "data-uf-ai-preview-clickable";
const SILENT_SELECTOR_TITLE_PREFIX = "Unfluffify selector: ";
const PAGE_SAVE_MOBILE_SIMULATION_REQUIRED_MESSAGE =
  "Mobile simulation must be enabled to save markings.";
const PAGE_TOAST_ID = "unfluffify-page-toast";
const PAGE_TOAST_STYLE_ID = "unfluffify-page-toast-style";
const URL_CHANGED_EVENT = "unfluffify:url-changed";
const SILENT_HIGHLIGHT_OVERLAY_ID = "unfluffify-silent-highlight-overlay";
const SILENT_HIGHLIGHT_STYLE_ID = "unfluffify-silent-highlightings-style";
const SILENT_HIGHLIGHT_LAYER_KEYS = ["links", "content", "excluded"];
const SILENT_HIGHLIGHT_OVERLAY_Z_INDEX = "2147483646";
const SILENT_SCROLL_REPOSITION_DEBOUNCE_MS = 120;
const SILENT_SETTLE_REPOSITION_SAMPLE_MS = 120;
const SILENT_SETTLE_REPOSITION_STABLE_SAMPLES =
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES;
const SILENT_SETTLE_REPOSITION_MAX_MS =
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS;
const SILENT_HIGHLIGHTING_MUTATION_DEBOUNCE_MS = 300;
const SILENT_HIGHLIGHTING_MUTATION_MIN_INTERVAL_MS = 1200;
const SILENT_HIGHLIGHTING_RELEVANT_MUTATION_ATTRS = new Set([
  "class",
  "id",
  "style",
  "href",
  "src",
  "hidden",
  "aria-hidden",
  "open"
]);
const CONSENT_EXCLUDED_OVERLAY_LABEL = "Hidden consent UI";
const SILENT_HIGHLIGHTING_POSITION_REFRESH_ATTRS = new Set([
  "class",
  "style",
  "hidden",
  "aria-hidden",
  "open"
]);

let silentHighlightingUrlTimer = 0;
let silentHighlightingObserver = null;
let silentHighlightingLayoutShiftObserver = null;
let silentHighlightingRefreshTimer = 0;
let silentHighlightingRefreshDueAt = 0;
let lastSilentHighlightingRefreshAt = 0;
let lastSilentHighlightingRenderKey = "";
let lastSilentHighlightingsActive = false;
let silentHighlightingPositionRefreshPending = false;
let silentHighlightVisibility = { ...SILENT_HIGHLIGHT_OPTIONS_DEFAULTS };
let silentHighlightOverlay = null;
let silentHighlightLayers = {};
let silentHighlightLayerBoxes = {};
let silentHighlightCollections = null;
let silentHighlightScrollTimer = 0;
let silentHighlightRepositionRaf = 0;
let silentHighlightSettleTimer = 0;
let silentHighlightSettleStartedAt = 0;
let silentHighlightSettleStableSamples = 0;
let silentHighlightLastPositionSignature = "";
let silentHighlightRevealRaf = 0;
let silentHighlightLegacyAttrsCleaned = false;
let silentSelectorAnnotatedNodes = new Set();
let aiPreviewClickableNodes = new Set();
const silentSelectorOriginalTitles = new WeakMap();

function createAiPreviewState() {
  return {
    active: false,
    items: [],
    itemXpathSet: new Set(),
    focusedXpath: "",
    previousEnabled: false,
    previousBaseUrl: "",
    previousPageUrl: "",
    previousDraftEntry: null,
    previousSavedEntry: null,
    previousAutoSeededPendingSavePageUrl: "",
    previousSilentHighlightVisibility: normalizeSilentHighlightOptions(
      SILENT_HIGHLIGHT_OPTIONS_DEFAULTS
    )
  };
}

let aiPreviewState = createAiPreviewState();

function normalizeAiPreviewItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      xpath: typeof item.xpath === "string" ? item.xpath : "",
      text: typeof item.text === "string" ? item.text : ""
    }))
    .filter((item) => item.xpath);
}

function setAiPreviewItems(items) {
  const normalized = normalizeAiPreviewItems(items);
  aiPreviewState.items = normalized;
  aiPreviewState.itemXpathSet = new Set(normalized.map((item) => item.xpath));
  aiPreviewState.focusedXpath = "";
  syncAiPreviewClickableTargets(normalized);
}

function clearAiPreviewClickableTargets() {
  if (!aiPreviewClickableNodes.size) {
    return;
  }
  for (const node of aiPreviewClickableNodes) {
    if (!node || node.nodeType !== 1) {
      continue;
    }
    node.removeAttribute(AI_PREVIEW_CLICKABLE_ATTR);
  }
  aiPreviewClickableNodes.clear();
}

function syncAiPreviewClickableTargets(items) {
  clearAiPreviewClickableTargets();
  if (!Array.isArray(items) || !items.length) {
    return;
  }
  items.forEach((item) => {
    const xpath = item && typeof item.xpath === "string" ? item.xpath : "";
    if (!xpath) {
      return;
    }
    const node = core.getElementFromXPath(xpath);
    if (!node || node.nodeType !== 1 || isExtensionUiNode(node)) {
      return;
    }
    node.setAttribute(AI_PREVIEW_CLICKABLE_ATTR, "on");
    aiPreviewClickableNodes.add(node);
  });
}

function notifyAiPreviewFocusChanged(xpath) {
  chrome.runtime.sendMessage({
    type: "aiPreviewFocusChanged",
    baseUrl: state.baseUrl || "",
    pageUrl: location.href,
    xpath: typeof xpath === "string" ? xpath : ""
  }).then().catch(() => {
    // Ignore popup-sync failures while preview focus changes.
  });
}

function setAiPreviewFocusedXpath(xpath, options = {}) {
  if (!aiPreviewState.active) {
    return false;
  }
  const nextXpath = typeof xpath === "string" ? xpath : "";
  if (nextXpath && !aiPreviewState.itemXpathSet.has(nextXpath)) {
    return false;
  }
  aiPreviewState.focusedXpath = nextXpath;
  if (options.notify !== false) {
    notifyAiPreviewFocusChanged(nextXpath);
  }
  return true;
}

function getAiPreviewClickTarget(eventTarget) {
  let node = eventTarget && eventTarget.nodeType === 1
    ? eventTarget
    : eventTarget && eventTarget.parentElement
      ? eventTarget.parentElement
      : null;
  while (node && node.nodeType === 1) {
    if (isExtensionUiNode(node)) {
      return null;
    }
    const xpath = core.getXPath(node);
    if (xpath && aiPreviewState.itemXpathSet.has(xpath)) {
      return { element: node, xpath };
    }
    node = node.parentElement;
  }
  return null;
}

function handleAiPreviewClick(event) {
  if (!aiPreviewState.active || !event || event.button !== 0) {
    return false;
  }
  const target = getAiPreviewClickTarget(event.target);
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (target) {
    core.focusPreviewElement(target.element, { center: false });
    setAiPreviewFocusedXpath(target.xpath);
    return true;
  }
  core.clearFocusHighlight();
  setAiPreviewFocusedXpath("");
  return true;
}

const SILENT_HIGHLIGHTING_INTERNAL_ATTRS = new Set([
  SILENT_LINK_HIGHLIGHTING_ATTR,
  SILENT_CONTENT_HIGHLIGHTING_ATTR,
  SILENT_CONTENT_EXCLUDED_ATTR,
  SILENT_HIGHLIGHTINGS_ACTIVE_ATTR,
  SILENT_CONTENT_POSITION_ATTR,
  SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR,
  SILENT_SELECTOR_EXCLUDE_ATTR,
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
        z-index: 2147483646;
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

function submissionXpathsEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    const leftItem = left[i];
    const rightItem = right[i];
    if (
      !leftItem ||
      !rightItem ||
      leftItem.xpath !== rightItem.xpath ||
      Boolean(leftItem.excluded) !== Boolean(rightItem.excluded)
    ) {
      return false;
    }
  }
  return true;
}

function getConfiguredRenderMode() {
  return config.getConfigRenderMode(state.config);
}

function createCurrentPageSnapshot() {
  return core.createSanitizedPageSnapshot({
    renderMode: getConfiguredRenderMode(),
    extraStripSelectors: [
      `#${PAGE_TOAST_ID}`,
      `#${PAGE_TOAST_STYLE_ID}`,
      `#${SILENT_HIGHLIGHT_OVERLAY_ID}`,
      `#${SILENT_HIGHLIGHT_STYLE_ID}`
    ],
    titlePrefix: SILENT_SELECTOR_TITLE_PREFIX
  });
}

async function fetchCurrentPageRawHtml(pageUrl = location.href) {
  const targetUrl = typeof pageUrl === "string" ? pageUrl : "";
  if (!targetUrl) {
    return null;
  }
  try {
    const response = await utils.sendRuntimeMessage({
      type: "fetchStaticPageHtml",
      url: targetUrl
    });
    if (!response || !response.ok || typeof response.html !== "string") {
      return null;
    }
    return response.html;
  } catch (error) {
    return null;
  }
}

function matchesActiveBaseUrl(baseUrl) {
  return Boolean(baseUrl && state.baseUrl && utils.sameBaseUrl(baseUrl, state.baseUrl));
}

async function isMobileSimulationActiveForCurrentTab() {
  const response = await utils.sendRuntimeMessage({ type: "getDeviceEmulationState" });
  if (!response || !response.ok || !response.state) {
    return false;
  }
  return Boolean(response.state.enabled) && response.state.mode === "mobile";
}

async function toggleDeviceEmulationFromPage() {
  let currentState = null;
  try {
    const response = await utils.sendRuntimeMessage({ type: "getDeviceEmulationState" });
    if (response && response.ok && response.state) {
      currentState = response.state;
    }
  } catch (error) {
    currentState = null;
  }

  const currentlyEnabled = Boolean(currentState && currentState.enabled);
  const request = currentlyEnabled
    ? {
      type: "updateDeviceEmulation",
      enabled: false
    }
    : {
      type: "updateDeviceEmulation",
      enabled: true,
      mode: "mobile"
    };
  const result = await utils.sendRuntimeMessage(request);
  if (!result || !result.ok) {
    showPageToast("Unable to update simulation mode.");
    return;
  }
  if (request.enabled) {
    showPageToast("Mobile simulation enabled.");
  } else {
    showPageToast("Simulation disabled.");
  }
}

async function saveCurrentPageDraft(options) {
  const { baseUrl, showToast = false } = options || {};
  const targetBaseUrl = baseUrl || state.baseUrl || "";
  if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
    if (showToast) {
      showPageToast("Enable marking to save this page.");
    }
    return { ok: false };
  }
  const pageUrl = location.href;
  const savedEntry = core.getSavedPageEntry(pageUrl);
  const hasSavedEntry = Boolean(savedEntry);
  const savedEntryHasAiSubmissionData = Boolean(
    savedEntry &&
    typeof savedEntry.renderedHtml === "string" &&
    savedEntry.renderedHtml &&
    Array.isArray(savedEntry.submissionXpaths) &&
    savedEntry.submissionXpaths.length > 0
  );
  const currentSnapshot = createCurrentPageSnapshot();
  const currentRenderedHtml = currentSnapshot.renderedHtml;
  const currentRawHtml = await fetchCurrentPageRawHtml(pageUrl);
  const currentSubmissionXpaths = collectAiSubmissionXpathsForCurrentPage();
  const savedEntryMatchesCurrentSnapshot = Boolean(
    savedEntry &&
    savedEntry.renderedHtml === currentRenderedHtml &&
    (
      currentRawHtml === null ||
      (typeof savedEntry.rawHtml === "string" ? savedEntry.rawHtml : "") === currentRawHtml
    ) &&
    submissionXpathsEqual(savedEntry.submissionXpaths, currentSubmissionXpaths)
  );
  if (
    !core.isPageDraftDirty(pageUrl) &&
    hasSavedEntry &&
    savedEntryHasAiSubmissionData &&
    savedEntryMatchesCurrentSnapshot
  ) {
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
  entry.renderedHtml = currentRenderedHtml;
  entry.rawHtml = typeof currentRawHtml === "string"
    ? currentRawHtml
    : typeof entry.rawHtml === "string"
      ? entry.rawHtml
      : "";
  entry.title =
    typeof document.title === "string" &&
    document.title.trim() &&
    document.title.trim() !== pageUrl
      ? document.title.trim()
      : "";
  entry.submissionXpaths = currentSubmissionXpaths;
  core.touchPageEntryTimestamp(entry);
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
  return {
    ok: true,
    saved: true,
    dirty: false
  };
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
  let style = document.getElementById(SILENT_HIGHLIGHT_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = SILENT_HIGHLIGHT_STYLE_ID;
    style.setAttribute("data-uf-extension-ui", "true");
    style.textContent = `
      #${SILENT_HIGHLIGHT_OVERLAY_ID} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: ${SILENT_HIGHLIGHT_OVERLAY_Z_INDEX};
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID}.uf-silent-hidden .uf-silent-layer {
        opacity: 0;
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-rect {
        position: absolute;
        box-sizing: border-box;
        border-radius: 4px;
        pointer-events: none;
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-content {
        border: 2px dashed #44b532;
        background: rgba(68, 181, 50, 0.08);
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-link {
        border: 2px dashed #56acce;
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-link.uf-silent-link-dual {
        background: rgba(86, 172, 206, 0.5);
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-excluded {
        border: 2px dashed #b03b3b;
        background: rgba(176, 59, 59, 0.08);
      }
      html [${core.CONSENT_HIDDEN_ATTR}] {
        pointer-events: none !important;
        visibility: hidden !important;
      }
      html [${AI_PREVIEW_CLICKABLE_ATTR}],
      html [${AI_PREVIEW_CLICKABLE_ATTR}] * {
        cursor: pointer !important;
      }
      html.uf-visible-consent [${core.CONSENT_HIDDEN_ATTR}] {
        visibility: visible !important;
        pointer-events: auto !important;
      }
    `;
  }
  const host = document.documentElement || document.body || document.head;
  if (!host) {
    return;
  }
  if (style.parentNode !== host) {
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

function ensureSilentHighlightOverlay() {
  ensureSilentHighlightingStyles();
  let overlay = document.getElementById(SILENT_HIGHLIGHT_OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = SILENT_HIGHLIGHT_OVERLAY_ID;
    overlay.setAttribute("data-uf-extension-ui", "true");
    SILENT_HIGHLIGHT_LAYER_KEYS.forEach((key) => {
      const layer = document.createElement("div");
      layer.className = "uf-silent-layer";
      layer.dataset.layer = key;
      overlay.appendChild(layer);
    });
  }
  const host = document.documentElement || document.body;
  if (!host) {
    return null;
  }
  if (overlay.parentNode !== host || host.lastElementChild !== overlay) {
    host.appendChild(overlay);
  }
  overlay.style.zIndex = SILENT_HIGHLIGHT_OVERLAY_Z_INDEX;
  if (silentHighlightOverlay !== overlay) {
    silentHighlightOverlay = overlay;
    silentHighlightLayers = {};
    silentHighlightLayerBoxes = {};
  }
  SILENT_HIGHLIGHT_LAYER_KEYS.forEach((key) => {
    let layer = overlay.querySelector(`[data-layer="${key}"]`);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "uf-silent-layer";
      layer.dataset.layer = key;
    }
    // Enforce stacking order: later siblings render above earlier ones.
    overlay.appendChild(layer);
    silentHighlightLayers[key] = layer;
    if (!silentHighlightLayerBoxes[key]) {
      silentHighlightLayerBoxes[key] = new Map();
    }
  });
  return overlay;
}

function clearSilentHighlightOverlay() {
  const overlays = document.querySelectorAll(`#${SILENT_HIGHLIGHT_OVERLAY_ID}`);
  overlays.forEach((node) => {
    if (node && node.remove) {
      node.remove();
    }
  });
  silentHighlightOverlay = null;
  silentHighlightLayers = {};
  silentHighlightLayerBoxes = {};
  silentHighlightCollections = null;
  clearSilentSelectorAnnotations();
}

function setSilentHighlightOverlayHidden(hidden) {
  if (!silentHighlightOverlay) {
    return;
  }
  if (!silentHighlightVisibility.hideDuringScrollRedraw) {
    silentHighlightOverlay.classList.remove("uf-silent-hidden");
    return;
  }
  if (hidden) {
    silentHighlightOverlay.classList.add("uf-silent-hidden");
  } else {
    silentHighlightOverlay.classList.remove("uf-silent-hidden");
  }
}

function scheduleSilentHighlightOverlayReveal() {
  if (!silentHighlightVisibility.hideDuringScrollRedraw) {
    setSilentHighlightOverlayHidden(false);
    return;
  }
  if (silentHighlightRevealRaf) {
    window.cancelAnimationFrame(silentHighlightRevealRaf);
    silentHighlightRevealRaf = 0;
  }
  silentHighlightRevealRaf = window.requestAnimationFrame(() => {
    silentHighlightRevealRaf = 0;
    if (
      silentHighlightScrollTimer ||
      silentHighlightRepositionRaf ||
      silentHighlightSettleTimer
    ) {
      return;
    }
    setSilentHighlightOverlayHidden(false);
  });
}

function resetSilentHighlightSettleTracking() {
  if (silentHighlightSettleTimer) {
    window.clearTimeout(silentHighlightSettleTimer);
    silentHighlightSettleTimer = 0;
  }
  silentHighlightSettleStartedAt = 0;
  silentHighlightSettleStableSamples = 0;
  silentHighlightLastPositionSignature = "";
}

function clearSilentHighlightRepositionTimers() {
  if (silentHighlightScrollTimer) {
    window.clearTimeout(silentHighlightScrollTimer);
    silentHighlightScrollTimer = 0;
  }
  resetSilentHighlightSettleTracking();
  if (silentHighlightRepositionRaf) {
    window.cancelAnimationFrame(silentHighlightRepositionRaf);
    silentHighlightRepositionRaf = 0;
  }
  if (silentHighlightRevealRaf) {
    window.cancelAnimationFrame(silentHighlightRevealRaf);
    silentHighlightRevealRaf = 0;
  }
}

function beginSilentLayerRender(key) {
  const layer = silentHighlightLayers[key];
  if (!layer) {
    return null;
  }
  const map = silentHighlightLayerBoxes[key] || new Map();
  silentHighlightLayerBoxes[key] = map;
  return { layer, map, used: new Set() };
}

function finalizeSilentLayerRender(layerState) {
  if (!layerState) {
    return;
  }
  const { map, used } = layerState;
  for (const [key, node] of map) {
    if (!used.has(key)) {
      node.remove();
      map.delete(key);
    }
  }
}

function collectSilentHighlightRects(node) {
  if (!node || node.nodeType !== 1 || !core.isVisible(node)) {
    return [];
  }
  const rects = [];
  const clientRects = node.getClientRects();
  for (let i = 0; i < clientRects.length; i += 1) {
    const rect = clientRects[i];
    if (!rect || rect.width <= 0 || rect.height <= 0) {
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
    rects.push({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height
    });
  }
  if (rects.length > 0) {
    return rects;
  }
  const fallbackRect = node.getBoundingClientRect();
  if (
    !fallbackRect ||
    fallbackRect.width <= 0 ||
    fallbackRect.height <= 0 ||
    fallbackRect.bottom < 0 ||
    fallbackRect.top > window.innerHeight ||
    fallbackRect.right < 0 ||
    fallbackRect.left > window.innerWidth
  ) {
    return [];
  }
  return [
    {
      top: fallbackRect.top,
      left: fallbackRect.left,
      width: fallbackRect.width,
      height: fallbackRect.height
    }
  ];
}

function drawSilentRectsForNode(layerState, node, className, keySalt = "") {
  if (!layerState || !node || node.nodeType !== 1 || !className) {
    return;
  }
  const rects = collectSilentHighlightRects(node);
  const markId = getSilentRenderNodeId(node);
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    const key = `${markId}|${className}|${keySalt}|${i}`;
    let box = layerState.map.get(key);
    if (!box) {
      box = document.createElement("div");
      box.className = `uf-silent-rect ${className}`;
      layerState.layer.appendChild(box);
      layerState.map.set(key, box);
    } else if (box.className !== `uf-silent-rect ${className}`) {
      box.className = `uf-silent-rect ${className}`;
    }
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    layerState.used.add(key);
  }
}

function renderSilentHighlightOverlay(collections) {
  const overlay = ensureSilentHighlightOverlay();
  if (!overlay) {
    return;
  }
  setSilentHighlightOverlayHidden(true);
  const contentNodes = Array.from(collections.contentNodes || []);
  const anchorNodes = Array.from(collections.anchors || []);
  const excludedNodes = Array.from(collections.excludedNodes || []);
  const contentSet = new Set(contentNodes);
  const contentLayerState = beginSilentLayerRender("content");
  const linksLayerState = beginSilentLayerRender("links");
  const excludedLayerState = beginSilentLayerRender("excluded");

  contentNodes.forEach((node) => {
    drawSilentRectsForNode(contentLayerState, node, "uf-silent-content");
  });
  anchorNodes.forEach((node) => {
    const className = contentSet.has(node)
      ? "uf-silent-link uf-silent-link-dual"
      : "uf-silent-link";
    drawSilentRectsForNode(linksLayerState, node, className);
  });
  // Preserve duplicate excluded render targets (e.g. nested selector matches that
  // resolve to the same visible node) by using per-occurrence keys.
  excludedNodes.forEach((node, index) => {
    drawSilentRectsForNode(
      excludedLayerState,
      node,
      "uf-silent-excluded",
      `excluded-occurrence-${index}`
    );
  });

  finalizeSilentLayerRender(contentLayerState);
  finalizeSilentLayerRender(linksLayerState);
  finalizeSilentLayerRender(excludedLayerState);
  applySilentSelectorAnnotations(collections);
  silentHighlightCollections = {
    anchors: anchorNodes,
    contentNodes,
    excludedNodes,
    explicitIncludeSelectorByNode:
      collections.explicitIncludeSelectorByNode instanceof Map
        ? new Map(collections.explicitIncludeSelectorByNode)
        : new Map(),
    excludedSelectorByNode:
      collections.excludedSelectorByNode instanceof Map
        ? new Map(collections.excludedSelectorByNode)
        : new Map()
  };
  scheduleSilentHighlightOverlayReveal();
}

function repositionSilentHighlightOverlay() {
  if (!lastSilentHighlightingsActive || state.enabled || !silentHighlightCollections) {
    return;
  }
  setSilentHighlightOverlayHidden(true);
  renderSilentHighlightOverlay(silentHighlightCollections);
}

function buildSilentHighlightPositionSignature(collections = silentHighlightCollections) {
  if (!collections) {
    return "";
  }
  const entries = [];
  const appendNodes = (nodes, prefix) => {
    (nodes || []).forEach((node, nodeIndex) => {
      const targets = collectSilentHighlightRenderTargets(node, {
        keepShallowestOnly: true
      });
      const renderTargets = targets.length > 0 ? targets : [node];
      renderTargets.forEach((target, targetIndex) => {
        if (!target || target.nodeType !== 1) {
          return;
        }
        const rect = target.getBoundingClientRect();
        entries.push([
          prefix,
          nodeIndex,
          targetIndex,
          getSilentRenderNodeId(target),
          Math.round(rect.top),
          Math.round(rect.left),
          Math.round(rect.width),
          Math.round(rect.height)
        ].join(":"));
      });
    });
  };
  appendNodes(collections.anchors, "anchor");
  appendNodes(collections.contentNodes, "content");
  appendNodes(collections.excludedNodes, "excluded");
  entries.sort();
  return entries.join("|");
}

function runSilentHighlightSettledRepositionSample() {
  silentHighlightSettleTimer = 0;
  if (state.enabled || !lastSilentHighlightingsActive || !silentHighlightCollections) {
    resetSilentHighlightSettleTracking();
    return;
  }
  const signature = buildSilentHighlightPositionSignature();
  const elapsed = silentHighlightSettleStartedAt
    ? Date.now() - silentHighlightSettleStartedAt
    : 0;
  const settleState = sampleSettledSilentHighlightPosition(
    {
      lastSignature: silentHighlightLastPositionSignature,
      stableSamples: silentHighlightSettleStableSamples
    },
    signature,
    elapsed,
    {
      requiredStableSamples: SILENT_SETTLE_REPOSITION_STABLE_SAMPLES,
      maxWaitMs: SILENT_SETTLE_REPOSITION_MAX_MS
    }
  );
  silentHighlightLastPositionSignature = settleState.lastSignature;
  silentHighlightSettleStableSamples = settleState.stableSamples;
  if (settleState.shouldFinalize) {
    resetSilentHighlightSettleTracking();
    if (silentHighlightRepositionRaf) {
      return;
    }
    silentHighlightRepositionRaf = window.requestAnimationFrame(() => {
      silentHighlightRepositionRaf = 0;
      repositionSilentHighlightOverlay();
    });
    return;
  }
  silentHighlightSettleTimer = window.setTimeout(
    runSilentHighlightSettledRepositionSample,
    SILENT_SETTLE_REPOSITION_SAMPLE_MS
  );
}

function scheduleSilentHighlightReposition(options = {}) {
  if (state.enabled || !lastSilentHighlightingsActive || !silentHighlightCollections) {
    return;
  }
  setSilentHighlightOverlayHidden(true);
  if (options && options.waitForSettle) {
    if (!silentHighlightSettleStartedAt) {
      silentHighlightSettleStartedAt = Date.now();
      silentHighlightSettleStableSamples = 0;
      silentHighlightLastPositionSignature = "";
    }
    if (silentHighlightSettleTimer) {
      window.clearTimeout(silentHighlightSettleTimer);
    }
    silentHighlightSettleTimer = window.setTimeout(
      runSilentHighlightSettledRepositionSample,
      SILENT_SETTLE_REPOSITION_SAMPLE_MS
    );
    return;
  }
  resetSilentHighlightSettleTracking();
  if (silentHighlightScrollTimer) {
    window.clearTimeout(silentHighlightScrollTimer);
  }
  silentHighlightScrollTimer = window.setTimeout(() => {
    silentHighlightScrollTimer = 0;
    if (silentHighlightRepositionRaf) {
      return;
    }
    silentHighlightRepositionRaf = window.requestAnimationFrame(() => {
      silentHighlightRepositionRaf = 0;
      repositionSilentHighlightOverlay();
    });
  }, SILENT_SCROLL_REPOSITION_DEBOUNCE_MS);
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

function clearLegacySilentHighlightingAttributes() {
  if (silentHighlightLegacyAttrsCleaned) {
    return;
  }
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
  silentHighlightLegacyAttrsCleaned = true;
}

function clearSilentSelectorAnnotations() {
  if (!silentSelectorAnnotatedNodes.size) {
    return;
  }
  for (const node of silentSelectorAnnotatedNodes) {
    if (!node || node.nodeType !== 1) {
      continue;
    }
    node.removeAttribute(SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR);
    node.removeAttribute(SILENT_SELECTOR_EXCLUDE_ATTR);
    const originalTitleState = silentSelectorOriginalTitles.get(node);
    if (originalTitleState && typeof originalTitleState === "object") {
      if (originalTitleState.hadTitle) {
        node.setAttribute("title", originalTitleState.title || "");
      } else if ((node.getAttribute("title") || "").startsWith(SILENT_SELECTOR_TITLE_PREFIX)) {
        node.removeAttribute("title");
      }
      silentSelectorOriginalTitles.delete(node);
    } else if ((node.getAttribute("title") || "").startsWith(SILENT_SELECTOR_TITLE_PREFIX)) {
      node.removeAttribute("title");
    }
  }
  silentSelectorAnnotatedNodes.clear();
}

function setSilentSelectorAnnotation(node, kind, selector) {
  if (!node || node.nodeType !== 1 || typeof selector !== "string" || !selector) {
    return;
  }
  const attrName = kind === "excluded"
    ? SILENT_SELECTOR_EXCLUDE_ATTR
    : SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR;
  if (!silentSelectorOriginalTitles.has(node)) {
    const hadTitle = node.hasAttribute("title");
    silentSelectorOriginalTitles.set(node, {
      hadTitle,
      title: hadTitle ? (node.getAttribute("title") || "") : ""
    });
  }
  node.setAttribute(attrName, selector);
  node.setAttribute("title", `${SILENT_SELECTOR_TITLE_PREFIX}${selector}`);
  silentSelectorAnnotatedNodes.add(node);
}

function applySilentSelectorAnnotations(collections) {
  clearSilentSelectorAnnotations();
  if (!collections || typeof collections !== "object") {
    return;
  }
  const explicitIncludeSelectorByNode =
    collections.explicitIncludeSelectorByNode instanceof Map
      ? collections.explicitIncludeSelectorByNode
      : new Map();
  const excludedSelectorByNode =
    collections.excludedSelectorByNode instanceof Map
      ? collections.excludedSelectorByNode
      : new Map();
  explicitIncludeSelectorByNode.forEach((selector, node) => {
    setSilentSelectorAnnotation(node, "included", selector);
  });
  excludedSelectorByNode.forEach((selector, node) => {
    setSilentSelectorAnnotation(node, "excluded", selector);
  });
}

async function copyTextToClipboard(text) {
  if (typeof text !== "string" || !text) {
    return false;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("data-uf-extension-ui", "true");
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    (document.body || document.documentElement).appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return Boolean(copied);
  } catch {
    return false;
  }
}

function handleSilentSelectorClickCopy(event) {
  if (!event || event.defaultPrevented || event.button !== 0) {
    return;
  }
  const target = event.target && event.target.nodeType === 1
    ? event.target
    : event.target && event.target.parentElement
      ? event.target.parentElement
      : null;
  if (!target || isExtensionUiNode(target)) {
    return;
  }
  const annotated = target.closest(
    `[${SILENT_SELECTOR_EXCLUDE_ATTR}], [${SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR}]`
  );
  if (!annotated || isExtensionUiNode(annotated)) {
    return;
  }
  const selector =
    annotated.getAttribute(SILENT_SELECTOR_EXCLUDE_ATTR) ||
    annotated.getAttribute(SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR) ||
    "";
  if (!selector) {
    return;
  }
  copyTextToClipboard(selector).then();
}

function clearSilentHighlightingMarks() {
  clearSilentHighlightRepositionTimers();
  clearSilentHighlightOverlay();
  clearSilentSelectorAnnotations();
  clearLegacySilentHighlightingAttributes();
  lastSilentHighlightingRenderKey = "";
  lastSilentHighlightingsActive = false;
  silentHighlightingPositionRefreshPending = false;
}

function stopSilentHighlightingObserver() {
  if (silentHighlightingObserver) {
    silentHighlightingObserver.disconnect();
    silentHighlightingObserver = null;
  }
  if (silentHighlightingLayoutShiftObserver) {
    silentHighlightingLayoutShiftObserver.disconnect();
    silentHighlightingLayoutShiftObserver = null;
  }
  if (silentHighlightingRefreshTimer) {
    window.clearTimeout(silentHighlightingRefreshTimer);
    silentHighlightingRefreshTimer = 0;
  }
  silentHighlightingRefreshDueAt = 0;
  clearSilentHighlightRepositionTimers();
}

function scheduleSilentHighlightingsRefresh(options = {}) {
  const debounceMs = Number.isFinite(options && options.debounceMs)
    ? Math.max(0, Math.trunc(options.debounceMs))
    : SILENT_HIGHLIGHTING_MUTATION_DEBOUNCE_MS;
  const minIntervalMs = Number.isFinite(options && options.minIntervalMs)
    ? Math.max(0, Math.trunc(options.minIntervalMs))
    : SILENT_HIGHLIGHTING_MUTATION_MIN_INTERVAL_MS;
  const now = Date.now();
  const sinceLast = now - lastSilentHighlightingRefreshAt;
  const waitForMinInterval =
    sinceLast < minIntervalMs
      ? minIntervalMs - sinceLast
      : 0;
  const delay = Math.max(debounceMs, waitForMinInterval);
  const dueAt = now + delay;
  if (
    silentHighlightingRefreshTimer &&
    silentHighlightingRefreshDueAt &&
    silentHighlightingRefreshDueAt <= dueAt
  ) {
    return;
  }
  if (silentHighlightingRefreshTimer) {
    window.clearTimeout(silentHighlightingRefreshTimer);
    silentHighlightingRefreshTimer = 0;
  }
  silentHighlightingRefreshDueAt = dueAt;
  silentHighlightingRefreshTimer = window.setTimeout(() => {
    silentHighlightingRefreshTimer = 0;
    silentHighlightingRefreshDueAt = 0;
    lastSilentHighlightingRefreshAt = Date.now();
    refreshSilentHighlightings().then();
  }, delay);
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
    if (!SILENT_HIGHLIGHTING_RELEVANT_MUTATION_ATTRS.has(attrName)) {
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

function mutationTargetTouchesSilentCollections(target) {
  if (!target || target.nodeType !== 1 || !silentHighlightCollections) {
    return false;
  }
  const trackedNodes = [
    ...(silentHighlightCollections.contentNodes || []),
    ...(silentHighlightCollections.anchors || []),
    ...(silentHighlightCollections.excludedNodes || [])
  ];
  for (const tracked of trackedNodes) {
    if (!tracked || tracked.nodeType !== 1) {
      continue;
    }
    if (tracked === target || tracked.contains(target) || target.contains(tracked)) {
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
    let needsFullRefresh = false;
    let needsPositionRefresh = false;
    for (const mutation of mutations) {
      if (!shouldRefreshForSilentMutation(mutation)) {
        continue;
      }
      if (mutation.type === "attributes") {
        const attributeName = mutation.attributeName || "";
        if (SILENT_HIGHLIGHTING_POSITION_REFRESH_ATTRS.has(attributeName)) {
          if (mutationTargetTouchesSilentCollections(mutation.target)) {
            needsPositionRefresh = true;
          }
          continue;
        }
      }
      needsFullRefresh = true;
      break;
    }

    if (needsFullRefresh) {
      scheduleSilentHighlightingsRefresh();
      return;
    }
    if (needsPositionRefresh) {
      silentHighlightingPositionRefreshPending = true;
      scheduleSilentHighlightReposition({ waitForSettle: true });
    }
  });
  silentHighlightingObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: Array.from(SILENT_HIGHLIGHTING_RELEVANT_MUTATION_ATTRS)
  });
  if (
    typeof PerformanceObserver === "function" &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes("layout-shift")
  ) {
    try {
      silentHighlightingLayoutShiftObserver = new PerformanceObserver((list) => {
        if (
          !list ||
          state.enabled ||
          !lastSilentHighlightingsActive ||
          !silentHighlightCollections
        ) {
          return;
        }
        const entries = typeof list.getEntries === "function"
          ? list.getEntries()
          : [];
        if (!Array.isArray(entries) || entries.length === 0) {
          return;
        }
        const hasLayoutShift = entries.some((entry) =>
          entry && typeof entry.value === "number"
            ? entry.value > 0
            : Boolean(entry)
        );
        if (!hasLayoutShift) {
          return;
        }
        silentHighlightingPositionRefreshPending = true;
        scheduleSilentHighlightReposition({ waitForSettle: true });
      });
      silentHighlightingLayoutShiftObserver.observe({ type: "layout-shift" });
    } catch {
      if (silentHighlightingLayoutShiftObserver) {
        silentHighlightingLayoutShiftObserver.disconnect();
        silentHighlightingLayoutShiftObserver = null;
      }
    }
  }
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

function applyVisibleConsentVisibility(visibility) {
  const normalized = normalizeSilentHighlightOptions(visibility);
  core.setHiddenConsentElementsVisible(normalized.visibleConsent);
  if (normalized.visibleConsent) {
    document.documentElement.classList.add("uf-visible-consent");
  } else {
    document.documentElement.classList.remove("uf-visible-consent");
  }
}

function resetAiPreviewState() {
  clearAiPreviewClickableTargets();
  aiPreviewState = createAiPreviewState();
}

function clearAiPreviewState() {
  if (!aiPreviewState.active) {
    return false;
  }
  silentHighlightVisibility = normalizeSilentHighlightOptions(
    aiPreviewState.previousSilentHighlightVisibility
  );
  applyVisibleConsentVisibility(silentHighlightVisibility);
  resetAiPreviewState();
  return true;
}

function getAiPreviewSilentHighlightVisibility(sourceVisibility) {
  const baseVisibility = normalizeSilentHighlightOptions(sourceVisibility);
  return normalizeSilentHighlightOptions({
    ...baseVisibility,
    includedContent: true,
    excludedContent: true
  });
}

function restoreAiPreviewDraftState(restoreState) {
  if (!restoreState || !restoreState.previousEnabled || !state.config) {
    return;
  }
  const pageUrl = restoreState.previousPageUrl || "";
  if (!pageUrl || location.href !== pageUrl) {
    return;
  }
  if (!state.config.pageMarkings || typeof state.config.pageMarkings !== "object") {
    state.config.pageMarkings = {};
  }
  const previousDraftEntry = core.clonePageEntry(restoreState.previousDraftEntry);
  if (previousDraftEntry) {
    state.config.pageMarkings[pageUrl] = previousDraftEntry;
  } else {
    delete state.config.pageMarkings[pageUrl];
  }
  core.setSavedPageEntry(pageUrl, restoreState.previousSavedEntry || null);
  state.autoSeededPendingSavePageUrl =
    restoreState.previousAutoSeededPendingSavePageUrl || "";
  state.suppressNextAutoSeedFromAiSelectors = true;
}

async function enterAiPreviewMode() {
  if (!aiPreviewState.active) {
    const previousPageUrl = location.href;
    aiPreviewState = {
      active: true,
      items: [],
      itemXpathSet: new Set(),
      focusedXpath: "",
      previousEnabled: Boolean(state.enabled),
      previousBaseUrl: state.baseUrl || "",
      previousPageUrl,
      previousDraftEntry: core.clonePageEntry(core.getDraftPageEntry(previousPageUrl)),
      previousSavedEntry: core.getSavedPageEntry(previousPageUrl),
      previousAutoSeededPendingSavePageUrl: state.autoSeededPendingSavePageUrl || "",
      previousSilentHighlightVisibility: normalizeSilentHighlightOptions(
        silentHighlightVisibility
      )
    };
  }

  if (aiPreviewState.previousEnabled && state.enabled) {
    core.disable();
  }

  silentHighlightVisibility = getAiPreviewSilentHighlightVisibility(
    aiPreviewState.previousSilentHighlightVisibility
  );
  applyVisibleConsentVisibility(silentHighlightVisibility);
  await refreshSilentHighlightings();
}

async function exitAiPreviewMode() {
  if (!aiPreviewState.active) {
    return;
  }

  const restoreState = aiPreviewState;
  resetAiPreviewState();
  silentHighlightVisibility = normalizeSilentHighlightOptions(
    restoreState.previousSilentHighlightVisibility
  );
  applyVisibleConsentVisibility(silentHighlightVisibility);

  if (restoreState.previousEnabled && restoreState.previousBaseUrl) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    await core.enableForBaseUrl(restoreState.previousBaseUrl);
    restoreAiPreviewDraftState(restoreState);
    refreshEnabledAiHighlights();
    return;
  }

  await refreshSilentHighlightings();
}

async function syncSilentHighlightVisibilityFromTabState() {
  try {
    const tabState = await utils.sendRuntimeMessage({ type: "getTabState" });
    silentHighlightVisibility = normalizeSilentHighlightOptions(
      tabState && tabState.silentHighlightOptions
    );
  } catch {
      clearAiPreviewState();
    silentHighlightVisibility = { ...SILENT_HIGHLIGHT_OPTIONS_DEFAULTS };
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
  return config.getNewestConfigSelectorSet(baseConfig).selectorSet;
}

function getEffectiveAiSelectorSet(baseConfig) {
  return getStoredAiSelectorSet(baseConfig);
}

function collectNodesFromSelectors(selectors) {
  const nodes = new Set();
  const selectorByNode = new Map();
  selectors.forEach((rawSelector) => {
    if (typeof rawSelector !== "string") {
      return;
    }
    const selector = rawSelector.trim();
    if (!selector) {
      return;
    }
    try {
      document.querySelectorAll(selector).forEach((node) => {
        if (!isExtensionUiNode(node)) {
          nodes.add(node);
          if (!selectorByNode.has(node)) {
            selectorByNode.set(node, selector);
          }
        }
      });
    } catch {
      // Ignore invalid selectors
    }
  });
  return { nodes, selectorByNode };
}

function resolveSelectorForNode(node, selectorByNode, allowAncestorMatch = false) {
  if (!node || !selectorByNode || selectorByNode.size === 0) {
    return "";
  }
  if (selectorByNode.has(node)) {
    return selectorByNode.get(node) || "";
  }
  if (!allowAncestorMatch) {
    return "";
  }
  let current = node.parentElement;
  while (current && current.nodeType === 1) {
    if (selectorByNode.has(current)) {
      return selectorByNode.get(current) || "";
    }
    current = current.parentElement;
  }
  return "";
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

function isWithinConsentBoundary(node) {
  return Boolean(
    node &&
    node.nodeType === 1 &&
    typeof node.closest === "function" &&
    node.closest(`[${core.CONSENT_HIDDEN_ATTR}]`)
  );
}

function hasDirectRenderableText(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (
    node.tagName === "SCRIPT" ||
    node.tagName === "STYLE" ||
    node.tagName === "NOSCRIPT" ||
    node.tagName === "TEMPLATE"
  ) {
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

function isDefinitelyHiddenSubtreeNode(node) {
  if (!node || node.nodeType !== 1) {
    return true;
  }
  if (node.hidden) {
    return true;
  }
  const ariaHidden = node.getAttribute("aria-hidden");
  if (ariaHidden === "true") {
    return true;
  }
  try {
    const style = window.getComputedStyle(node);
    if (!style) {
      return false;
    }
    if (style.display === "none") {
      return true;
    }
    if (style.visibility === "hidden" || style.visibility === "collapse") {
      return true;
    }
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity === 0) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
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

function matchesToggleableDefaultSelector(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  for (const selector of DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS) {
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

function hasNestedToggleableDefaultExcludedDescendant(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(node.children || []);
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(current) || isWithinConsentBoundary(current)) {
      continue;
    }
    if (matchesToggleableDefaultSelector(current)) {
      return true;
    }
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      stack.push(current.children[i]);
    }
  }
  return false;
}

function hasVisibleImmutableDescendant(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(node.children || []);
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(current) || isWithinConsentBoundary(current)) {
      continue;
    }
    if (matchesImmutableDefaultSelector(current) && core.isVisible(current)) {
      return true;
    }
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      stack.push(current.children[i]);
    }
  }
  return false;
}

function matchesAutoToggleableDefaultSelector(node) {
  if (!matchesToggleableDefaultSelector(node)) {
    return false;
  }
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (!hasTextualDescendantForInclusion(node)) {
    return true;
  }
  if (hasNestedToggleableDefaultExcludedDescendant(node)) {
    return true;
  }
  return !hasVisibleImmutableDescendant(node);
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

function isToggleableDefaultExcludedNode(node, includedNodes) {
  return matchesAutoToggleableDefaultSelector(node) && !isWithinNodeSet(node, includedNodes);
}

function isWithinToggleableDefaultExcludedNode(node, includedNodes) {
  if (isWithinNodeSet(node, includedNodes)) {
    return false;
  }
  let current = node;
  while (current && current.nodeType === 1) {
    if (isToggleableDefaultExcludedNode(current, includedNodes)) {
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
  return isRawSelectorExcludedNode(node, excludedNodes, includedNodes);
}

function isExcludedNatureNode(node, excludedNodes, includedNodes, inclusionContextSet) {
  return matchesImmutableDefaultSelector(node) ||
    isToggleableDefaultExcludedNode(node, includedNodes) ||
    isSelectorExcludedNode(node, excludedNodes, includedNodes, inclusionContextSet);
}

function isInclusionEligibleNode(
  node,
  excludedNodes,
  includedNodes,
  inclusionContextSet,
  options = {}
) {
  const ignoreVisibilityForInclusionDetection = Boolean(
    options && options.ignoreVisibilityForInclusionDetection
  );
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (isExtensionUiNode(node)) {
    return false;
  }
  if (isWithinConsentBoundary(node)) {
    return false;
  }
  if (
    !ignoreVisibilityForInclusionDetection &&
    !core.isVisible(node) &&
    !canUseCollapsedTextFallbackNode(node)
  ) {
    return false;
  }
  if (isWithinImmutableDefaultNode(node)) {
    return false;
  }
  if (isWithinToggleableDefaultExcludedNode(node, includedNodes)) {
    return false;
  }
  return !isWithinNodeSet(node, excludedNodes) ||
    isWithinNodeSet(node, includedNodes) ||
    Boolean(inclusionContextSet && inclusionContextSet.has(node));
}

function isTextualContainerForInclusion(node, options = {}) {
  const ignoreVisibilityForInclusionDetection = Boolean(
    options && options.ignoreVisibilityForInclusionDetection
  );
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (!ignoreVisibilityForInclusionDetection && !core.isVisible(node)) {
    return false;
  }
  if (hasDirectRenderableText(node)) {
    return true;
  }
  if (matchesToggleableDefaultSelector(node)) {
    if (node.children.length > 0) {
      return true;
    }
    const nestedText = (node.innerText || "").replace(/\s+/g, " ").trim();
    return Boolean(nestedText);
  }
  return Boolean(getNormalizedNodeText(node));
}

function hasTextualDescendantForInclusion(node, options = {}) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(node.children || []);
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(current)) {
      continue;
    }
    if (matchesImmutableDefaultSelector(current)) {
      continue;
    }
    if (isTextualContainerForInclusion(current, options)) {
      return true;
    }
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      stack.push(current.children[i]);
    }
  }
  return false;
}

function hasTextualImmutableDescendantForInclusion(node, options = {}) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const stack = Array.from(node.children || []);
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(current)) {
      continue;
    }
    if (
      matchesImmutableDefaultSelector(current) &&
      isTextualContainerForInclusion(current, options)
    ) {
      return true;
    }
    for (let i = current.children.length - 1; i >= 0; i -= 1) {
      stack.push(current.children[i]);
    }
  }
  return false;
}

function isSelfMarkableInclusionNode(node, options = {}) {
  if (!isTextualContainerForInclusion(node, options)) {
    return false;
  }
  // Keep ancestor/descendant self-markable decisions stable even when
  // inclusion detection ignores visibility (used by silent highlight/preview).
  // Otherwise hidden responsive descendants can suppress a visible ancestor.
  const descendantShapeOptions = options && options.ignoreVisibilityForInclusionDetection
    ? {
      ...options,
      ignoreVisibilityForInclusionDetection: false
    }
    : options;
  const hasDirectOwnText = hasDirectRenderableText(node);
  const hasVisibleTextualDescendant = hasTextualDescendantForInclusion(
    node,
    descendantShapeOptions
  );
  if (!hasDirectOwnText && hasVisibleTextualDescendant) {
    return false;
  }
  if (!matchesToggleableDefaultSelector(node)) {
    if (!hasDirectOwnText && !hasVisibleTextualDescendant) {
      return false;
    }
    if (
      !hasDirectOwnText &&
      hasTextualImmutableDescendantForInclusion(node, descendantShapeOptions)
    ) {
      return false;
    }
    return true;
  }
  return !hasVisibleTextualDescendant;
}

function hasRenderableTextOutsideExcludedNature(
  node,
  excludedNodes,
  includedNodes,
  inclusionContextSet,
  options = {}
) {
  const ignoreVisibilityForInclusionDetection = Boolean(
    options && options.ignoreVisibilityForInclusionDetection
  );
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
    if (
      current !== node &&
      !ignoreVisibilityForInclusionDetection &&
      !core.isVisible(current) &&
      isDefinitelyHiddenSubtreeNode(current)
    ) {
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

function hasRenderableTextForHighlight(
  node,
  excludedNodes,
  includedNodes,
  inclusionContextSet,
  options = {}
) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (hasDirectRenderableText(node)) {
    return true;
  }
  return hasRenderableTextOutsideExcludedNature(
    node,
    excludedNodes,
    includedNodes,
    inclusionContextSet,
    options
  );
}

function hasRenderableTextForExcludedHighlight(
  node,
  includedNodes,
  inclusionContextSet
) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  if (hasDirectRenderableText(node)) {
    return true;
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
    if (
      current !== node &&
      !core.isVisible(current) &&
      isDefinitelyHiddenSubtreeNode(current)
    ) {
      continue;
    }
    if (
      current !== node &&
      isWithinNodeSet(current, includedNodes)
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

function collapseToShallowestWithOppositeBoundary(nodes, oppositeNodes) {
  const oppositeSet = new Set(oppositeNodes || []);
  const sorted = Array.from(new Set(nodes || [])).sort((left, right) => {
    const depthDiff = getNodeDepth(left) - getNodeDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareNodeOrder(left, right);
  });
  const kept = [];
  const keptSet = new Set();
  sorted.forEach((node) => {
    if (!node || node.nodeType !== 1) {
      return;
    }
    let current = node.parentElement;
    while (current && current.nodeType === 1) {
      if (oppositeSet.has(current)) {
        break;
      }
      if (keptSet.has(current)) {
        return;
      }
      current = current.parentElement;
    }
    kept.push(node);
    keptSet.add(node);
  });
  kept.sort(compareNodeOrder);
  return kept;
}

function collapseToShallowestPreservingExplicitNodes(nodes, explicitNodes) {
  const explicitSet = new Set(explicitNodes || []);
  const sorted = Array.from(new Set(nodes || [])).sort((left, right) => {
    const depthDiff = getNodeDepth(left) - getNodeDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareNodeOrder(left, right);
  });
  const kept = [];
  const keptSet = new Set();
  sorted.forEach((node) => {
    if (!node || node.nodeType !== 1) {
      return;
    }
    if (explicitSet.has(node)) {
      if (!keptSet.has(node)) {
        kept.push(node);
        keptSet.add(node);
      }
      return;
    }
    let current = node.parentElement;
    while (current && current.nodeType === 1) {
      if (keptSet.has(current)) {
        return;
      }
      current = current.parentElement;
    }
    kept.push(node);
    keptSet.add(node);
  });
  kept.sort(compareNodeOrder);
  return kept;
}

function compareNodeOrder(left, right) {
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

function collapseToDeepest(nodes) {
  const sorted = Array.from(nodes || []).sort((left, right) => {
    const depthDiff = getNodeDepth(right) - getNodeDepth(left);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareNodeOrder(left, right);
  });
  const kept = [];
  sorted.forEach((node) => {
    if (!node || node.nodeType !== 1) {
      return;
    }
    const isAncestorOfKept = kept.some((descendant) => node.contains(descendant));
    if (!isAncestorOfKept) {
      kept.push(node);
    }
  });
  kept.sort(compareNodeOrder);
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
      if (isExtensionUiNode(node)) {
        continue;
      }
      const excludedNature = isExcludedNatureNode(
        node,
        excludedNodes,
        includedNodes,
        inclusionContextSet
      );
      if (excludedNature) {
        if (!seen.has(node) && shouldCollectSilentExcludedSource({
          isWithinIncluded: false,
          hasRenderableText: hasRenderableTextForExcludedHighlight(
            node,
            includedNodes,
            inclusionContextSet
          )
        })) {
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

function collectSelectorExcludedNodes(
  excludedNodes,
  includedNodes,
  inclusionContextSet
) {
  const marked = new Set();
  for (const node of excludedNodes || []) {
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(node)) {
      continue;
    }
    if (!shouldCollectSilentExcludedSource({
      isWithinIncluded: isWithinNodeSet(node, includedNodes),
      hasRenderableText: hasRenderableTextForExcludedHighlight(
        node,
        includedNodes,
        inclusionContextSet
      )
    })) {
      continue;
    }
    marked.add(node);
  }
  return Array.from(marked).sort(compareNodeOrder);
}

function collectToggleableDefaultExcludedNodes(includedNodes) {
  if (!document.body) {
    return [];
  }
  const results = [];
  const stack = [document.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(node) || isWithinConsentBoundary(node)) {
      continue;
    }
    if (isWithinNodeSet(node, includedNodes)) {
      continue;
    }
    if (matchesImmutableDefaultSelector(node)) {
      continue;
    }
    if (matchesAutoToggleableDefaultSelector(node)) {
      results.push(node);
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return results.sort(compareNodeOrder);
}

function collectExplicitIncludedNodes(
  explicitIncludedMatches,
  excludedNodes,
  includedNodes,
  inclusionContextSet,
  options = {}
) {
  const keepAllExplicitMatches = Boolean(options && options.keepAllExplicitMatches);
  const preserveNestedExplicitIncludedDescendants = Boolean(
    options && options.preserveNestedExplicitIncludedDescendants
  );
  const selected = new Set();
  const ordered = preserveNestedExplicitIncludedDescendants
    ? Array.from(new Set(explicitIncludedMatches || [])).sort(compareNodeOrder)
    : collapseToShallowest(explicitIncludedMatches);
  ordered.forEach((node) => {
    if (!node || node.nodeType !== 1) {
      return;
    }
    if (!isInclusionEligibleNode(
      node,
      excludedNodes,
      includedNodes,
      inclusionContextSet,
      options
    )) {
      return;
    }
    if (!keepAllExplicitMatches) {
      const isMarkableInclusionCandidate = isSelfMarkableInclusionNode(node, options);
      if (!isMarkableInclusionCandidate) {
        return;
      }
      if (!hasRenderableTextOutsideExcludedNature(
        node,
        excludedNodes,
        includedNodes,
        inclusionContextSet,
        options
      )) {
        return;
      }
    }
    selected.add(node);
  });
  if (preserveNestedExplicitIncludedDescendants) {
    return Array.from(selected).sort(compareNodeOrder);
  }
  return collapseToShallowest(selected).filter((node) => hasRenderableTextForHighlight(
    node,
    excludedNodes,
    includedNodes,
    inclusionContextSet,
    options
  ));
}

function collectImplicitIncludedNodesOutsideExplicit(
  explicitIncluded,
  excludedNodes,
  includedNodes,
  inclusionContextSet,
  options = {}
) {
  const explicitIncludedSet = new Set(explicitIncluded || []);
  const baseSelected = new Set();
  const stack = [document.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (
      explicitIncludedSet.size > 0 &&
      !explicitIncludedSet.has(node) &&
      isWithinNodeSet(node, explicitIncludedSet)
    ) {
      continue;
    }
    if (!isInclusionEligibleNode(
      node,
      excludedNodes,
      includedNodes,
      inclusionContextSet,
      options
    )) {
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
          inclusionContextSet,
          options
        )
      );
    const isMarkableInclusionCandidate = isSelfMarkableInclusionNode(node, options);
    if (
      isMarkableInclusionCandidate &&
      (hasDirectRenderableText(node) || isAutoIncludedCollapsedText) &&
      !rawSelectorExcluded
    ) {
      baseSelected.add(node);
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return collapseToShallowest(baseSelected).filter((node) =>
    hasRenderableTextForHighlight(
      node,
      excludedNodes,
      includedNodes,
      inclusionContextSet,
      options
    )
  );
}

function collectIncludedNodesFromSelectorSet(selectorSet) {
  // Silent highlighting inclusion selection is visibility-agnostic:
  // implicit non-excluded content + all explicit inclusion selector matches.
  const inclusionSelectionOptions = {
    ignoreVisibilityForInclusionDetection: true,
    preserveNestedExplicitIncludedDescendants: true,
    keepAllExplicitMatches: true
  };
  const normalized = normalizeAiSelectorSet(selectorSet);
  const excludedMatches = collectNodesFromSelectors(normalized.exclusionSelectors);
  const includedMatches = collectNodesFromSelectors(normalized.inclusionSelectors);
  const filteredIncludedNodes = new Set();
  const filteredInclusionSelectorByNode = new Map();
  for (const node of includedMatches.nodes || []) {
    if (!node || isWithinConsentBoundary(node)) {
      continue;
    }
    filteredIncludedNodes.add(node);
    if (includedMatches.selectorByNode.has(node)) {
      filteredInclusionSelectorByNode.set(node, includedMatches.selectorByNode.get(node));
    }
  }
  const rawExcludedNodes = collapseToShallowest(excludedMatches.nodes);
  // Collapse raw exclusion matches first so descendants under an excluded
  // ancestor are treated as one region unless an opposite marking reintroduces
  // them through the existing boundary rules.
  const excludedNodes = new Set(rawExcludedNodes);
  const includedNodes = filteredIncludedNodes;
  const inclusionContextSet = buildInclusionContextSet(includedNodes);
  const explicitIncluded = collectExplicitIncludedNodes(
    includedNodes,
    excludedNodes,
    includedNodes,
    inclusionContextSet,
    inclusionSelectionOptions
  );
  const explicitIncludedSet = new Set(explicitIncluded);
  const explicitIncludedContextSet = buildInclusionContextSet(explicitIncludedSet);
  const toggleableDefaultExcluded = collectToggleableDefaultExcludedNodes(explicitIncludedSet);
  const excludedBoundaryNodes = new Set([
    ...Array.from(excludedNodes),
    ...toggleableDefaultExcluded
  ]);
  const implicitIncluded = collectImplicitIncludedNodesOutsideExplicit(
    explicitIncluded,
    excludedNodes,
    includedNodes,
    inclusionContextSet,
    inclusionSelectionOptions
  );
  const included = collapseToShallowestPreservingExplicitNodes(
    [...explicitIncluded, ...implicitIncluded],
    explicitIncludedSet
  ).filter((node) =>
    explicitIncludedSet.has(node) ||
    hasRenderableTextForHighlight(
      node,
      excludedNodes,
      includedNodes,
      inclusionContextSet,
      inclusionSelectionOptions
    )
  );
  const includedScopeRootsForExcludedTraversal = collapseToShallowest(includedNodes);
  const excludedDescendants = collectExcludedChildrenInsideIncludedParents(
    includedScopeRootsForExcludedTraversal,
    excludedNodes,
    explicitIncludedSet,
    explicitIncludedContextSet
  );
  const selectorExcluded = collectSelectorExcludedNodes(
    excludedBoundaryNodes,
    explicitIncludedSet,
    explicitIncludedContextSet
  );
  const inferredExcluded = collapseToShallowestWithOppositeBoundary(
    excludedDescendants,
    explicitIncludedSet
  );
  const excluded = Array.from(
    new Set([...(selectorExcluded || []), ...(inferredExcluded || [])])
  ).sort(compareNodeOrder);
  return {
    included,
    excluded,
    explicitIncluded,
    inclusionSelectorByNode: filteredInclusionSelectorByNode,
    exclusionSelectorByNode: excludedMatches.selectorByNode
  };
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

function buildSilentHighlightingRenderKey(
  visibilityOptions,
  anchors,
  contentNodes,
  excludedNodes,
  explicitIncludeSelectorByNode = null,
  excludedSelectorByNode = null
) {
  const explicitIncludeSelectorEntries = explicitIncludeSelectorByNode instanceof Map
    ? Array.from(explicitIncludeSelectorByNode.entries())
    : [];
  const excludedSelectorEntries = excludedSelectorByNode instanceof Map
    ? Array.from(excludedSelectorByNode.entries())
    : [];
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
  const explicitIncludeSelectorKey = JSON.stringify(
    explicitIncludeSelectorEntries
      .map(([node, selector]) => [getSilentRenderNodeId(node), selector || ""])
      .filter(([id, selector]) => id && selector)
      .sort((left, right) => {
        if (left[0] !== right[0]) {
          return left[0] - right[0];
        }
        return String(left[1]).localeCompare(String(right[1]));
      })
  );
  const excludedSelectorKey = JSON.stringify(
    excludedSelectorEntries
      .map(([node, selector]) => [getSilentRenderNodeId(node), selector || ""])
      .filter(([id, selector]) => id && selector)
      .sort((left, right) => {
        if (left[0] !== right[0]) {
          return left[0] - right[0];
        }
        return String(left[1]).localeCompare(String(right[1]));
      })
  );
  return [
    visibilityOptions && visibilityOptions.markedPages ? 1 : 0,
    visibilityOptions && visibilityOptions.includedContent ? 1 : 0,
    visibilityOptions && visibilityOptions.excludedContent ? 1 : 0,
    visibilityOptions && visibilityOptions.visibleConsent ? 1 : 0,
    anchorIds.join(","),
    contentIds.join(","),
    excludedIds.join(","),
    explicitIncludeSelectorKey,
    excludedSelectorKey
  ].join("|");
}

function hasRenderableClientBox(node) {
  if (!node || node.nodeType !== 1) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function collectSilentHighlightRenderTargets(node, options = {}) {
  const keepShallowestOnly = !options || options.keepShallowestOnly !== false;
  if (!node || node.nodeType !== 1) {
    return [];
  }
  if (hasRenderableClientBox(node)) {
    return [node];
  }
  const targets = [];
  const stack = Array.from(node.children || []);
  let inspected = 0;
  const MAX_INSPECTED = 400;
  while (stack.length && inspected < MAX_INSPECTED) {
    const current = stack.shift();
    inspected += 1;
    if (!current || current.nodeType !== 1) {
      continue;
    }
    if (isExtensionUiNode(current)) {
      continue;
    }
    if (!core.isVisible(current) && isDefinitelyHiddenSubtreeNode(current)) {
      continue;
    }
    if (hasRenderableClientBox(current)) {
      targets.push(current);
      if (keepShallowestOnly) {
        // Keep the shallowest renderable descendants to avoid dense nested overlays.
        continue;
      }
    }
    for (let i = 0; i < current.children.length; i += 1) {
      stack.push(current.children[i]);
    }
  }
  return targets;
}

function toRenderableNodeListWithSelectors(
  nodes,
  selectorResolver = null,
  options = {}
) {
  const dedupeTargets = !options || options.dedupeTargets !== false;
  const keepShallowestFallbackTargets =
    !options || options.keepShallowestFallbackTargets !== false;
  const results = [];
  const seen = new Set();
  const selectorByNode = new Map();
  const appendSelector = (targetNode, selector) => {
    if (
      !targetNode ||
      typeof selector !== "string" ||
      !selector
    ) {
      return;
    }
    const existing = selectorByNode.get(targetNode);
    if (!existing) {
      selectorByNode.set(targetNode, selector);
      return;
    }
    const parts = String(existing)
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.includes(selector)) {
      parts.push(selector);
      selectorByNode.set(targetNode, parts.join("\n"));
    }
  };
  for (const node of nodes || []) {
    const targets = collectSilentHighlightRenderTargets(node, {
      keepShallowestOnly: keepShallowestFallbackTargets
    });
    const selector = typeof selectorResolver === "function"
      ? selectorResolver(node)
      : "";
    if (!targets.length) {
      if (!node || (dedupeTargets && seen.has(node))) {
        continue;
      }
      if (dedupeTargets) {
        seen.add(node);
      }
      results.push(node);
      appendSelector(node, selector);
      continue;
    }
    for (const target of targets) {
      if (!target || (dedupeTargets && seen.has(target))) {
        continue;
      }
      if (dedupeTargets) {
        seen.add(target);
      }
      results.push(target);
      appendSelector(target, selector);
    }
  }
  return { nodes: results, selectorByNode };
}

function toRenderableNodeList(nodes) {
  return toRenderableNodeListWithSelectors(nodes).nodes;
}

function collectAiSubmissionXpathsForCurrentPage() {
  if (!state.config) {
    return [];
  }
  const pageUrl = location.href;
  const entry = core.getPageMarkingEntry(state.config, pageUrl, {
    create: false,
    persist: false
  });
  const explicitExcludedXpaths = new Set();
  const explicitIncludedXpaths = new Set();
  const consentXpaths = new Set();
  const rowIndexByXpath = new Map();
  const excludedRowXpaths = [];
  const excludedRowXpathSet = new Set();
  const rows = [];
  const pushRow = (xpath, excluded) => {
    if (typeof xpath !== "string" || !xpath) {
      return;
    }
    const existingIndex = rowIndexByXpath.has(xpath)
      ? rowIndexByXpath.get(xpath)
      : -1;
    if (existingIndex >= 0) {
      // `excluded: true` wins for duplicate xpaths so a later hidden/excluded
      // determination cannot be accidentally downgraded by an earlier include row.
      if (excluded) {
        rows[existingIndex] = { xpath, excluded: true };
        if (!excludedRowXpathSet.has(xpath)) {
          excludedRowXpathSet.add(xpath);
          excludedRowXpaths.push(xpath);
        }
      }
      return;
    }
    rowIndexByXpath.set(xpath, rows.length);
    rows.push({ xpath, excluded: Boolean(excluded) });
    if (excluded && !excludedRowXpathSet.has(xpath)) {
      excludedRowXpathSet.add(xpath);
      excludedRowXpaths.push(xpath);
    }
  };
  const normalizeXPath = (value) => (typeof value === "string" ? value.trim() : "");
  const explicitRows = Array.isArray(entry && entry.xpaths) ? entry.xpaths : [];
  explicitRows.forEach((item) => {
    if (!item || typeof item.xpath !== "string") {
      return;
    }
    const xpath = normalizeXPath(item.xpath);
    if (!xpath) {
      return;
    }
    if (item.excluded) {
      explicitExcludedXpaths.add(xpath);
    }
  });
  (Array.isArray(entry && entry.includeXpaths) ? entry.includeXpaths : []).forEach((xpath) => {
    const normalized = normalizeXPath(xpath);
    if (normalized) {
      explicitIncludedXpaths.add(normalized);
    }
  });
  (Array.isArray(entry && entry.consentXpaths) ? entry.consentXpaths : []).forEach((xpath) => {
    const normalized = normalizeXPath(xpath);
    if (normalized) {
      consentXpaths.add(normalized);
      explicitExcludedXpaths.add(normalized);
    }
  });

  explicitExcludedXpaths.forEach((xpath) => pushRow(xpath, true));
  consentXpaths.forEach((xpath) => pushRow(xpath, true));

  const hasExcludedAncestorRow = (xpath) => {
    if (!xpath || excludedRowXpaths.length === 0) {
      return false;
    }
    for (const excludedXpath of excludedRowXpaths) {
      if (
        excludedXpath &&
        excludedXpath !== xpath &&
        core.isXPathDescendant(excludedXpath, xpath)
      ) {
        return true;
      }
    }
    return false;
  };

  if (!document.body) {
    return rows;
  }
  const stack = [document.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
    const xpath = core.getXPath(node);
    if (!xpath) {
      continue;
    }
    if (isWithinConsentBoundary(node)) {
      if (node.hasAttribute(core.CONSENT_HIDDEN_ATTR) && !hasExcludedAncestorRow(xpath)) {
        pushRow(xpath, true);
      }
      continue;
    }
    const explicitlyExcluded = explicitExcludedXpaths.has(xpath);
    if (explicitlyExcluded) {
      pushRow(xpath, true);
      continue;
    }
    const explicitlyIncluded = explicitIncludedXpaths.has(xpath);
    const insideExcludedAncestorRow = hasExcludedAncestorRow(xpath);
    // Descendants of an excluded subtree (explicit or hidden/auto-detected)
    // are omitted by default to keep the saved payload shallow and stable.
    // keep the saved payload shallow and stable. The only exception is an
    // explicit include override on that descendant.
    if (insideExcludedAncestorRow && !explicitlyIncluded) {
      continue;
    }
    if (explicitlyIncluded) {
      // Explicit includes persist while the element exists, regardless of visibility.
      pushRow(xpath, false);
      continue;
    }
    const visibleToUser = core.isVisible(node);
    const isMarkableTextual = core.isMarkableElement(node, state.config, {
      allowParent: false,
      allowImmutableChildren: false,
      // Hidden subtrees can still contain meaningful text content that must be
      // sent as excluded. We keep the snapshot shallow via ancestor-row suppression above.
      ignoreVisibilityForInclusionDetection: !visibleToUser
    });
    if (!isMarkableTextual) {
      continue;
    }
    // Non-explicit textual elements: visible => included, hidden => excluded.
    pushRow(xpath, !visibleToUser);
  }
  return rows;
}

function refreshEnabledAiHighlights() {
  if (!state.enabled || !state.baseUrl || !state.config) {
    return;
  }
  stopSilentHighlightingObserver();
  clearSilentHighlightingMarks();
  setSilentHighlightingsActive(false);
  const selectorSet = getEffectiveAiSelectorSet(state.config);
  if (!state.config.selectors || typeof state.config.selectors !== "object") {
    state.config.selectors = {
      exclusionSelectors: [],
      inclusionSelectors: []
    };
  }
  state.config.selectors = selectorSet;
  core.scheduleRender();
}

async function refreshSilentHighlightings() {
  if (silentHighlightingRefreshTimer) {
    window.clearTimeout(silentHighlightingRefreshTimer);
    silentHighlightingRefreshTimer = 0;
  }
  silentHighlightingRefreshDueAt = 0;
  lastSilentHighlightingRefreshAt = Date.now();
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
  const storedSelectors = getStoredAiSelectorSet(baseConfig);
  const effectiveSelectorSet = getEffectiveAiSelectorSet(baseConfig);
  const visibility = normalizeSilentHighlightOptions(silentHighlightVisibility);
  ensureSilentHighlightingStyles();
  clearLegacySilentHighlightingAttributes();
  const hasSelectorHighlights = combineAiSelectorSet(storedSelectors).length > 0;
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
  applyVisibleConsentVisibility(visibility);
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
  let explicitIncludeSelectorByRenderNode = new Map();
  let excludedSelectorByRenderNode = new Map();
  if ((visibility.includedContent || visibility.excludedContent) && hasSelectorHighlights) {
    try {
      const contentMarking = collectIncludedNodesFromSelectorSet(
        effectiveSelectorSet
      );
      const excludedSourcesForSilentOverlay = Array.isArray(contentMarking.excluded)
        ? contentMarking.excluded
        : [];
      if (visibility.includedContent) {
        contentNodes = toRenderableNodeList(contentMarking.included);
        const explicitIncludedSources = Array.isArray(contentMarking.explicitIncluded)
          ? contentMarking.explicitIncluded
          : [];
        const explicitIncludedRenderable = toRenderableNodeListWithSelectors(
          explicitIncludedSources,
          (node) => resolveSelectorForNode(node, contentMarking.inclusionSelectorByNode, false)
        );
        explicitIncludeSelectorByRenderNode = explicitIncludedRenderable.selectorByNode;
      }
      if (visibility.excludedContent) {
        const excludedRenderable = toRenderableNodeListWithSelectors(
          excludedSourcesForSilentOverlay,
          (node) => resolveSelectorForNode(node, contentMarking.exclusionSelectorByNode, true)
        );
        excludedNodes = excludedRenderable.nodes;
        excludedSelectorByRenderNode = excludedRenderable.selectorByNode;
      }
    } catch {
      // Keep other silent highlighting features active even if selector processing fails.
      contentNodes = [];
      excludedNodes = [];
      explicitIncludeSelectorByRenderNode = new Map();
      excludedSelectorByRenderNode = new Map();
    }
  }
  if (visibility.visibleConsent && hasHiddenConsent) {
    const consentExcludedRenderable = toRenderableNodeListWithSelectors(
      Array.from(core.collectConsentExcludedElements()),
      () => CONSENT_EXCLUDED_OVERLAY_LABEL,
      { dedupeTargets: true }
    );
    const seenExcludedNodes = new Set(excludedNodes);
    consentExcludedRenderable.nodes.forEach((node) => {
      if (!node || seenExcludedNodes.has(node)) {
        return;
      }
      seenExcludedNodes.add(node);
      excludedNodes.push(node);
    });
    consentExcludedRenderable.selectorByNode.forEach((selector, node) => {
      if (!node || !selector) {
        return;
      }
      const existing = excludedSelectorByRenderNode.get(node);
      if (!existing) {
        excludedSelectorByRenderNode.set(node, selector);
        return;
      }
      const parts = String(existing)
        .split("\n")
        .map((part) => part.trim())
        .filter(Boolean);
      if (!parts.includes(selector)) {
        parts.push(selector);
        excludedSelectorByRenderNode.set(node, parts.join("\n"));
      }
    });
  }
  const shouldBeActive =
    anchors.length > 0 || contentNodes.length > 0 || excludedNodes.length > 0;
  const renderKey = buildSilentHighlightingRenderKey(
    visibility,
    anchors,
    contentNodes,
    excludedNodes,
    explicitIncludeSelectorByRenderNode,
    excludedSelectorByRenderNode
  );
  const renderChanged =
    renderKey !== lastSilentHighlightingRenderKey ||
    shouldBeActive !== lastSilentHighlightingsActive;
  const shouldRenderOverlay = shouldRenderSilentHighlightOverlay({
    shouldBeActive,
    renderChanged,
    positionRefreshPending: silentHighlightingPositionRefreshPending,
    hasOverlay: Boolean(silentHighlightOverlay),
    isFullRefresh: true
  });
  if (shouldRenderOverlay) {
    renderSilentHighlightOverlay({
      anchors,
      contentNodes,
      excludedNodes,
      explicitIncludeSelectorByNode: explicitIncludeSelectorByRenderNode,
      excludedSelectorByNode: excludedSelectorByRenderNode
    });
  } else if (renderChanged) {
    clearSilentHighlightOverlay();
  }
  if (renderChanged) {
    lastSilentHighlightingRenderKey = renderKey;
    lastSilentHighlightingsActive = shouldBeActive;
  }
  silentHighlightingPositionRefreshPending = false;
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
    const primaryModifier = event.ctrlKey || event.metaKey;
    if (!primaryModifier || event.altKey || event.shiftKey || event.repeat) {
      return;
    }
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key !== "e" && key !== "s" && key !== "m") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (key === "e") {
      toggleEnabledFromPage().then();
      return;
    }
    if (key === "m") {
      toggleDeviceEmulationFromPage().then();
      return;
    }
    if (!state.enabled) {
      return;
    }
    (async () => {
      if (!await isMobileSimulationActiveForCurrentTab()) {
        showPageToast(PAGE_SAVE_MOBILE_SIMULATION_REQUIRED_MESSAGE);
        return;
      }
      saveCurrentPageDraft({ showToast: true }).then();
    })();
  }, true);

  document.addEventListener("click", (event) => {
    if (state.enabled) {
      return;
    }
    if (handleAiPreviewClick(event)) {
      return;
    }
    handleSilentSelectorClickCopy(event);
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
        sendResponse({ ok: true });
        return;
      }
      clearAiPreviewState();
      core.disable();
      refreshSilentHighlightings().then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "setSilentHighlightVisibility") {
      silentHighlightVisibility = normalizeSilentHighlightOptions(message);
      applyVisibleConsentVisibility(silentHighlightVisibility);
      refreshSilentHighlightings().then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "getAiPreviewState") {
      sendResponse({
        ok: true,
        active: aiPreviewState.active,
        items: aiPreviewState.items.map((item) => ({
          xpath: item.xpath,
          text: item.text
        })),
        focusedXpath: aiPreviewState.focusedXpath
      });
      return;
    }

    if (message.type === "closeAiPreview") {
      if (!aiPreviewState.active) {
        sendResponse({ ok: true, active: false });
        return;
      }
      if (core.hasAiPopover()) {
        core.requestAiPopoverClose();
        sendResponse({ ok: true, active: false });
        return;
      }
      exitAiPreviewMode().then(() => {
        sendResponse({ ok: true, active: false });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    if (message.type === "configUpdated") {
      if (state.enabled && utils.sameBaseUrl(message.baseUrl, state.baseUrl)) {
        const pageUrl = location.href;
        const draftEntry = core.getDraftPageEntry(pageUrl);
        const savedEntry = core.getSavedPageEntry(pageUrl);
        const forceReloadPageEntry = Boolean(message.forceReloadPageEntry);
        core.loadConfig(state.baseUrl).then((config) => {
          if (!forceReloadPageEntry) {
            core.mergeDraftEntry(config, pageUrl, draftEntry, savedEntry);
          } else {
            const storedEntry =
              config.pageMarkings && config.pageMarkings[pageUrl]
                ? config.pageMarkings[pageUrl]
                : null;
            core.setSavedPageEntry(pageUrl, storedEntry);
            if (storedEntry) {
              const immutableExcluded = core.collectImmutableElements();
              const syncResult = core.syncPageMarkings(config, pageUrl, immutableExcluded, {
                allowCreate: true,
                persist: true
              });
              if (syncResult && syncResult.entry) {
                core.setSavedPageEntry(pageUrl, syncResult.entry);
              }
            }
          }
          state.config = config;
          refreshEnabledAiHighlights();
          if (forceReloadPageEntry) {
            core.scheduleRender();
            core.notifyDraftStatus(pageUrl);
          }
        });
      } else {
        clearAiPreviewState();
        core.disable();
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
        const snapshot = createCurrentPageSnapshot();
        sendResponse({
          baseUrl: targetBaseUrl,
          pageUrl: location.href,
          renderedHtml: snapshot.renderedHtml,
          rawHtml: typeof entry.rawHtml === "string" ? entry.rawHtml : "",
          renderMode: snapshot.renderMode,
          immutableSelectors: DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.slice(),
          xpaths: entry.xpaths || []
        });
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

    if (message.type === "collectAiSubmissionXpaths") {
      const xpaths = collectAiSubmissionXpathsForCurrentPage();
      sendResponse({ xpaths });
      return;
    }

    if (message.type === "filterInvisibleXpathsOnPage") {
      const xpaths = Array.isArray(message.xpaths) ? message.xpaths : [];
      const filtered = xpaths.filter((xpath) => {
        const el = core.getElementFromXPath(xpath);
        return el && !core.isVisible(el);
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
      core.focusPreviewElement(target);
      if (aiPreviewState.active) {
        setAiPreviewFocusedXpath(xpath);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "clearFocus") {
      core.clearFocusHighlight();
      if (aiPreviewState.active) {
        setAiPreviewFocusedXpath("");
      }
      sendResponse({ ok: true });
      return;
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
        if (matchesActiveBaseUrl(targetBaseUrl) && state.config) {
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
        const snapshot = createCurrentPageSnapshot();
        const rawHtml = await fetchCurrentPageRawHtml(location.href);
        entry.renderedHtml = snapshot.renderedHtml;
        entry.rawHtml = typeof rawHtml === "string"
          ? rawHtml
          : typeof entry.rawHtml === "string"
            ? entry.rawHtml
            : "";
        entry.title = document.title || location.href;
        entry.submissionXpaths = collectAiSubmissionXpathsForCurrentPage();
        core.touchPageEntryTimestamp(entry);
        config.pageMarkings[location.href] = entry;

        if (shouldPersist) {
          await core.saveConfig(targetBaseUrl, config);
        }

        if (matchesActiveBaseUrl(targetBaseUrl)) {
          state.config = config;
          if (shouldPersist) {
            core.setSavedPageEntry(location.href, entry);
          }
        }
        sendResponse({ ok: true });
      })();

      return true;
    }

    if (message.type === "getPageDraftStatus") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
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
        dirty: core.isPageDraftDirty(pageUrl)
      });
      return;
    }

    if (message.type === "setExplicitExclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
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
      const includeXpaths = Array.isArray(entry.includeXpaths) ? entry.includeXpaths : [];
      let targetItem = items.find((item) => item && item.xpath === xpath);
      if (!targetItem) {
        targetItem = { xpath, excluded };
        items.push(targetItem);
      } else {
        targetItem.excluded = excluded;
      }
      const target = core.getElementFromXPath(xpath);
      const cleanupDescendantIncludeOverrides = (currentXPath, currentTarget = null) => {
        const boundaryTarget = currentTarget && currentTarget.nodeType === 1
          ? currentTarget
          : core.getElementFromXPath(currentXPath);
        for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
          const includeXPath = includeXpaths[i];
          if (!includeXPath || includeXPath === currentXPath) {
            continue;
          }
          const includeEl = core.getElementFromXPath(includeXPath);
          if (
            (boundaryTarget && includeEl && boundaryTarget.contains(includeEl)) ||
            (!includeEl && core.isXPathDescendant(currentXPath, includeXPath))
          ) {
            includeXpaths.splice(i, 1);
          }
        }
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (!item || !item.xpath || item.excluded || item.xpath === currentXPath) {
            continue;
          }
          const itemEl = core.getElementFromXPath(item.xpath);
          if (
            (boundaryTarget && itemEl && boundaryTarget.contains(itemEl)) ||
            (!itemEl && core.isXPathDescendant(currentXPath, item.xpath))
          ) {
            items.splice(i, 1);
          }
        }
      };
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
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (!item || !item.xpath || item.xpath === xpath || !item.excluded) {
            continue;
          }
          const existingEl = core.getElementFromXPath(item.xpath);
          const containsTarget =
            existingEl && target ? existingEl.contains(target) : core.isXPathDescendant(item.xpath, xpath);
          if (containsTarget) {
            cleanupDescendantIncludeOverrides(item.xpath, existingEl);
            items.splice(i, 1);
          }
        }
        for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
          const includeXPath = includeXpaths[i];
          if (!includeXPath) {
            continue;
          }
          const includeEl = core.getElementFromXPath(includeXPath);
          if (
            includeXPath === xpath ||
            (includeEl && target && (includeEl.contains(target) || target.contains(includeEl))) ||
            (!includeEl && (
              core.isXPathDescendant(includeXPath, xpath) ||
              core.isXPathDescendant(xpath, includeXPath)
            ))
          ) {
            includeXpaths.splice(i, 1);
          }
        }
      } else if (targetItem && !targetItem.excluded) {
        cleanupDescendantIncludeOverrides(xpath, target);
      }
      entry.includeXpaths = includeXpaths;
      entry.xpaths = items;
      core.touchPageEntryTimestamp(entry);
      core.normalizePageEntryXpaths(entry);
      state.config.pageMarkings[location.href] = entry;
      core.scheduleRender();
      core.scheduleSnapshotSave();
      core.notifyDraftStatus(location.href);
      core.scheduleDraftPersist(targetBaseUrl);
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "setExplicitInclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
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
      core.touchPageEntryTimestamp(entry);
      core.normalizePageEntryXpaths(entry);
      state.config.pageMarkings[location.href] = entry;
      core.scheduleRender();
      core.scheduleSnapshotSave();
      core.notifyDraftStatus(location.href);
      core.scheduleDraftPersist(targetBaseUrl);
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "savePageDraft") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
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
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
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
          entry: core.getSavedPageEntry(pageUrl)
        });
      })();
      return true;
    }

    if (message.type === "showAiPreview") {
      (async () => {
        const selectorSet = normalizeAiSelectorSet(message.selectorSet);
        let items = [];
        try {
          items = core.collectPreviewItems(selectorSet);
        } catch {
          items = [];
        }
        await enterAiPreviewMode();
        setAiPreviewItems(items);
        core.showAiPopover(items, {
          onClose: () => exitAiPreviewMode()
        });
        sendResponse({ ok: true, count: items.length });
      })().catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }
  });

  window.addEventListener(URL_CHANGED_EVENT, () => {
    refreshSilentHighlightings().then();
  });

  syncSilentHighlightVisibilityFromTabState().then(() => {
    refreshSilentHighlightings().then();
  });
  startSilentHighlightingUrlWatcher();
  window.addEventListener("resize", () => {
    if (state.enabled) {
      core.scheduleRender({ invalidate: false });
      return;
    }
    scheduleSilentHighlightReposition();
  });
  const handleSilentOrMarkingScroll = (event) => {
    if (state.enabled) {
      core.handleScroll(event);
      return;
    }
    if (!isViewportScrollEvent(event)) {
      return;
    }
    scheduleSilentHighlightReposition();
  };
  window.addEventListener("scroll", handleSilentOrMarkingScroll, { passive: true });
  document.addEventListener("scroll", handleSilentOrMarkingScroll, {
    passive: true,
    capture: true
  });
  window.addEventListener("beforeunload", core.handleBeforeUnload);
}
