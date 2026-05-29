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
import { installExtensionTelemetry } from "./common/extension-telemetry.js";
import {
  normalizeCandidatePageUrl,
  normalizePropertyPageTypes
} from "./common/lynx-checklist.js";
import {
  PROPERTY_PAGE_TYPES_QUERY,
  URL_SEARCH_INFO_QUERY,
  buildGraphqlEndpointFromStageBase,
  getCurrentPageCandidateState,
  maybeUpdateStoredTokenFromResponse,
  normalizeSiteIdValue,
  normalizeStageBase as normalizeStageBaseValue
} from "./common/lynx-live-pages.js";
import {
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
  REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  formatRemoteSupportCountdown,
  normalizeRemoteSupportDockState
} from "./common/remote-support.js";
import {
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS,
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES,
  shouldCollectSilentExcludedSource,
  shouldRenderSilentHighlightOverlay,
  sampleSettledSilentHighlightPosition
} from "./content/silent-highlight-rules.js";
import {
  collectCachedSelectorMatches,
  SELECTOR_LIST_DELIMITER,
  getSelectorFingerprint,
  invalidateSharedSelectorCache
} from "./content/shared-selector-cache.js";
import {
  isAiSubmissionDocumentRootXpath,
  resolveAiSubmissionRowState
} from "./content/submission-rules.js";

import {
  PROPERTY_LOCK_STATE_UNLOCKED,
  PROPERTY_LOCK_STATE_LOCKED,
  PROPERTY_LOCK_STATE_EXPIRY_WARNING,
  PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
  PROPERTY_LOCK_STATE_TRANSFER,
  PROPERTY_LOCK_PORT_NAME,
  PROPERTY_LOCK_CONTENT_CONNECT,
  PROPERTY_LOCK_CONTENT_DISCONNECT,
  PROPERTY_LOCK_CONTENT_ACTIVITY,
  PROPERTY_LOCK_CONTENT_TAKE_LOCK,
  PROPERTY_LOCK_CONTENT_SUGGEST,
  PROPERTY_LOCK_CONTENT_RESPOND,
  PROPERTY_LOCK_CONTENT_CONTINUE,
  PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_WS_DISCONNECT_WARNING,
  PROPERTY_LOCK_WS_INACTIVITY_WARNING,
  PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
  PROPERTY_LOCK_WS_SUGGESTION_PENDING,
  PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
  PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
  PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN,
  PROPERTY_LOCK_WS_ERROR
} from "./common/property-lock.js";
import { propertyLockText } from "./common/text.js";

const { state } = core;

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
const SILENT_HIGHLIGHT_LAYER_KEYS = ["content", "excluded"];
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
const SILENT_HIGHLIGHTING_POSITION_REFRESH_ATTRS = new Set([
  "hidden",
  "aria-hidden",
  "open"
]);
// Record Separator keeps the composite suppression fingerprint separate from
// the selector fingerprint's Unit Separator without colliding with selector text.
const SELECTOR_CACHE_SCOPE_FINGERPRINT_SEPARATOR = "\u001e";

let silentHighlightingUrlTimer = 0;

const PROPERTY_LOCK_BANNER_ID = "unfluffify-lock-banner";
const PROPERTY_LOCK_BANNER_STYLE_ID = "unfluffify-lock-banner-style";
const PROPERTY_LOCK_RECONNECT_DELAY_MS = 150;

let propertyLockPort = null;
let propertyLockState = null;
let propertyLockBannerMode = "no_banner";
let propertyLockBannerCountdownTimer = 0;
let propertyLockBannerCountdownValue = 0;
let propertyLockBannerElement = null;
let propertyLockBannerVisible = false;
let propertyLockSuggestionId = "";
let propertyLockSuggestionFromName = "";
let propertyLockLastBlockedToastAt = 0;
let propertyLockAutoTakeAttempted = false;
let propertyLockConnectedSiteId = null;
let propertyLockSyncToken = 0;
let propertyLockReconnectTimer = 0;
let silentHighlightingObserver = null;
let silentHighlightingLayoutShiftObserver = null;
let silentHighlightingRefreshTimer = 0;
let silentHighlightingRefreshDueAt = 0;
let lastSilentHighlightingRefreshAt = 0;
let lastSilentHighlightingRenderKey = "";
let lastSilentHighlightingsActive = false;
let silentHighlightingPositionRefreshPending = false;
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
let lastTrackedUrlPath = "";
let lastTrackedUrlHostname = "";
let silentHighlightLegacyAttrsCleaned = false;
let silentSelectorAnnotatedNodes = new Set();
let aiPreviewClickableNodes = new Set();
let aiComputeLockReleaseTimer = 0;
let deviceEmulationHotkeyBusy = false;
const silentSelectorOriginalTitles = new WeakMap();

function createAiPreviewState() {
  return {
    active: false,
    mode: "",
    items: [],
    itemXpathSet: new Set(),
    focusedXpath: "",
    previousEnabled: false,
    previousBaseUrl: "",
    previousPageUrl: "",
    previousDraftEntry: null,
    previousSavedEntry: null,
    previousAutoSeededPendingSavePageUrl: ""
  };
}

let aiPreviewState = createAiPreviewState();
const REMOTE_SUPPORT_TERMINATE_BUTTON_ID = "unfluffify-remote-support-terminate";
const REMOTE_SUPPORT_TERMINATE_STYLE_ID = "unfluffify-remote-support-terminate-style";
const REMOTE_SUPPORT_SUPPORT_PAGE_META_SELECTOR = 'meta[name="unfluffify-remote-support-page"][content="support"]';
const REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID = "unfluffify-support-page-app";
const REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID = "unfluffify-remote-support-page-root";
const REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID = "unfluffify-remote-support-page-style";
const REMOTE_SUPPORT_SUPPORT_PAGE_FALLBACK_ID = "unfluffify-support-page-fallback";
const REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_FRAME_ID = "uf-support-page-viewer";
const REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH = "remote-support-viewer.html";
const REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_REQUEST_TIMEOUT_MS = 10000;
const PAGE_TELEMETRY_SCRIPT_ID = "unfluffify-page-telemetry-script";
const PAGE_TELEMETRY_MESSAGE_MARKER = "unfluffify-page-telemetry";
const PAGE_TELEMETRY_CONTROL_MARKER = "unfluffify-page-telemetry-control";

let remoteSupportMode = "inactive";
let remoteSupportRole = "";
let remoteSupportIncludePayloads = false;
let remoteSupportTerminatePending = false;
let remoteSupportSupportPageTabId = null;
let remoteSupportSupportPageState = createRemoteSupportSupportPageState();
let remoteSupportSupportPageLastFrame = "";
let remoteSupportSupportPageRenderedFrame = "";
let remoteSupportSupportPageElements = null;
let remoteSupportSupportPageViewerPort = null;
let remoteSupportSupportPageViewerReady = false;
let remoteSupportSupportPageViewerReadyWaiters = [];
let remoteSupportSupportPageViewerRequestId = 0;
let remoteSupportSupportPageViewerPendingRequests = new Map();
let remoteSupportSupportPageViewerIntrinsicWidth = 0;
let remoteSupportSupportPageViewerIntrinsicHeight = 0;
let remoteSupportSupportPageViewerVideoActive = false;
let remoteSupportSupportPageFullscreenActive = false;
let remoteSupportMediaQuietingActive = false;
let remoteSupportMediaQuietObserver = null;
const remoteSupportQuietedMediaElements = new Map();
let pageTelemetryBridgeListenerBound = false;

function createRemoteSupportSupportPageState(tabId = null) {
  return {
    active: false,
    mode: "inactive",
    role: "",
    tabId: Number.isFinite(tabId) ? Math.trunc(tabId) : null,
    sessionId: "",
    supportCode: "",
    expiresAt: "",
    connected: false,
    partnerConnected: false,
    streaming: false,
    includePayloads: false,
    dockState: REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
    error: "",
    lastActivityAt: 0,
    inactivityCountdownActive: false,
    inactivitySecondsRemaining: 0
  };
}

function normalizeRemoteSupportSupportPageState(stateLike, fallbackTabId = remoteSupportSupportPageTabId) {
  const normalized = {
    ...createRemoteSupportSupportPageState(fallbackTabId),
    ...(stateLike && typeof stateLike === "object" ? stateLike : {})
  };

  normalized.active = Boolean(normalized.active);
  normalized.connected = Boolean(normalized.connected);
  normalized.partnerConnected = Boolean(normalized.partnerConnected);
  normalized.streaming = Boolean(normalized.streaming);
  normalized.includePayloads = Boolean(normalized.includePayloads);
  normalized.dockState = normalizeRemoteSupportDockState(normalized.dockState);
  normalized.inactivityCountdownActive = Boolean(normalized.inactivityCountdownActive);
  normalized.inactivitySecondsRemaining = Math.max(0, Math.trunc(Number(normalized.inactivitySecondsRemaining) || 0));
  normalized.tabId = Number.isFinite(Number(normalized.tabId))
    ? Math.trunc(Number(normalized.tabId))
    : (Number.isFinite(fallbackTabId) ? Math.trunc(fallbackTabId) : null);

  return normalized;
}

function getRemoteSupportSupportPageViewerOrigin() {
  try {
    return new URL(chrome.runtime.getURL(REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH)).origin;
  } catch (error) {
    return "*";
  }
}

function resolveRemoteSupportSupportPageViewerWaiters(result) {
  if (!remoteSupportSupportPageViewerReadyWaiters.length) {
    return;
  }

  const waiters = remoteSupportSupportPageViewerReadyWaiters.slice();
  remoteSupportSupportPageViewerReadyWaiters = [];
  waiters.forEach((waiter) => {
    try {
      waiter(Boolean(result));
    } catch (error) {
      // Ignore waiter resolution failures.
    }
  });
}

function clearRemoteSupportSupportPageViewerPendingRequests(errorMessage = "Remote support viewer unavailable") {
  if (!remoteSupportSupportPageViewerPendingRequests.size) {
    return;
  }

  for (const pendingRequest of remoteSupportSupportPageViewerPendingRequests.values()) {
    window.clearTimeout(pendingRequest.timeoutId);
    pendingRequest.resolve({ ok: false, error: errorMessage });
  }
  remoteSupportSupportPageViewerPendingRequests.clear();
}

function syncRemoteSupportSupportPageViewerVisibility() {
  const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
  if (!elements || !elements.viewer) {
    return;
  }

  elements.viewer.hidden = !(remoteSupportSupportPageState.active && remoteSupportSupportPageViewerVideoActive);
}

function updateRemoteSupportSupportPageViewerVideoState({ active = false, width = 0, height = 0 } = {}) {
  remoteSupportSupportPageViewerVideoActive = Boolean(active);
  remoteSupportSupportPageViewerIntrinsicWidth = Number.isFinite(Number(width)) ? Math.max(0, Math.trunc(Number(width))) : 0;
  remoteSupportSupportPageViewerIntrinsicHeight = Number.isFinite(Number(height)) ? Math.max(0, Math.trunc(Number(height))) : 0;
  syncRemoteSupportSupportPageViewerVisibility();
  syncRemoteSupportSupportPageFrame();
}

function isRemoteSupportFrameBitmap(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.close === "function"
  );
}

function closeRemoteSupportFrameBitmap(bitmap) {
  if (!bitmap || typeof bitmap.close !== "function") {
    return;
  }

  try {
    bitmap.close();
  } catch (error) {
    // Ignore decoded frame cleanup mismatches.
  }
}

function resetRemoteSupportSupportPageViewerConnection(errorMessage = "Remote support viewer unavailable") {
  if (remoteSupportSupportPageViewerPort) {
    try {
      remoteSupportSupportPageViewerPort.onmessage = null;
      remoteSupportSupportPageViewerPort.close();
    } catch (error) {
      // Ignore viewer port shutdown races.
    }
  }

  remoteSupportSupportPageViewerPort = null;
  remoteSupportSupportPageViewerReady = false;
  resolveRemoteSupportSupportPageViewerWaiters(false);
  clearRemoteSupportSupportPageViewerPendingRequests(errorMessage);
  updateRemoteSupportSupportPageViewerVideoState({ active: false, width: 0, height: 0 });
}

function handleRemoteSupportSupportPageViewerPortMessage(event) {
  const message = event && event.data && typeof event.data === "object"
    ? event.data
    : null;
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "ready") {
    remoteSupportSupportPageViewerReady = true;
    resolveRemoteSupportSupportPageViewerWaiters(true);
    return;
  }

  if (message.type === "response") {
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    const pendingRequest = requestId ? remoteSupportSupportPageViewerPendingRequests.get(requestId) : null;
    if (!pendingRequest) {
      return;
    }

    remoteSupportSupportPageViewerPendingRequests.delete(requestId);
    window.clearTimeout(pendingRequest.timeoutId);
    pendingRequest.resolve(message.response && typeof message.response === "object" ? message.response : { ok: false });
    return;
  }

  if (message.type === "transport-event") {
    chrome.runtime.sendMessage({
      type: "remoteSupportTransportEvent",
      source: "remoteSupportViewer",
      event: message.event && typeof message.event === "object" ? message.event : {}
    }).then().catch(() => {
      // Ignore transport event delivery failures while the background reloads.
    });
    return;
  }

  if (message.type === "video-state") {
    updateRemoteSupportSupportPageViewerVideoState({
      active: Boolean(message.active),
      width: message.width,
      height: message.height
    });
    chrome.runtime.sendMessage({
      type: "remoteSupportTransportEvent",
      source: "remoteSupportViewer",
      event: {
        type: "video-state",
        sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
        active: Boolean(message.active)
      }
    }).then().catch(() => {
      // Ignore transport event delivery failures while the background reloads.
    });
    return;
  }
}

function initializeRemoteSupportSupportPageViewer(viewerFrame) {
  if (!viewerFrame || viewerFrame.dataset.ufRemoteSupportViewerInitialized === "true") {
    return;
  }

  viewerFrame.dataset.ufRemoteSupportViewerInitialized = "true";
  viewerFrame.src = chrome.runtime.getURL(REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH);
  viewerFrame.addEventListener("load", () => {
    resetRemoteSupportSupportPageViewerConnection();

    if (!viewerFrame.contentWindow || typeof MessageChannel !== "function") {
      return;
    }

    const channel = new MessageChannel();
    remoteSupportSupportPageViewerPort = channel.port1;
    remoteSupportSupportPageViewerPort.onmessage = handleRemoteSupportSupportPageViewerPortMessage;
    if (typeof remoteSupportSupportPageViewerPort.start === "function") {
      remoteSupportSupportPageViewerPort.start();
    }

    try {
      viewerFrame.contentWindow.postMessage(
        { type: "unfluffify:remote-support-viewer-init" },
        getRemoteSupportSupportPageViewerOrigin(),
        [channel.port2]
      );
    } catch (error) {
      resetRemoteSupportSupportPageViewerConnection();
    }
  });
}

async function waitForRemoteSupportSupportPageViewerReady(timeoutMs = 4000) {
  if (remoteSupportSupportPageViewerReady && remoteSupportSupportPageViewerPort) {
    return true;
  }

  const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
  if (!elements || !elements.viewer) {
    return false;
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      remoteSupportSupportPageViewerReadyWaiters = remoteSupportSupportPageViewerReadyWaiters.filter(
        (waiter) => waiter !== handleReady
      );
      resolve(false);
    }, timeoutMs);

    const handleReady = (ready) => {
      window.clearTimeout(timeoutId);
      resolve(Boolean(ready));
    };

    remoteSupportSupportPageViewerReadyWaiters.push(handleReady);
  });
}

async function sendRemoteSupportSupportPageViewerRequest(requestType, payload = {}) {
  const ready = await waitForRemoteSupportSupportPageViewerReady();
  if (!ready || !remoteSupportSupportPageViewerPort) {
    return {
      ok: false,
      error: "Remote support viewer unavailable"
    };
  }

  const requestId = `viewer-${Date.now()}-${(remoteSupportSupportPageViewerRequestId += 1)}`;
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      remoteSupportSupportPageViewerPendingRequests.delete(requestId);
      resolve({ ok: false, error: "Remote support viewer timed out" });
    }, REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_REQUEST_TIMEOUT_MS);

    remoteSupportSupportPageViewerPendingRequests.set(requestId, {
      resolve,
      timeoutId
    });

    try {
      remoteSupportSupportPageViewerPort.postMessage({
        type: "request",
        requestId,
        requestType,
        ...payload
      });
    } catch (error) {
      remoteSupportSupportPageViewerPendingRequests.delete(requestId);
      window.clearTimeout(timeoutId);
      resolve({ ok: false, error: "Remote support viewer unavailable" });
    }
  });
}

function isBeingSupportedMode() {
  return remoteSupportMode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED;
}

function restoreRemoteSupportQuietedVideo(video) {
  const quietedState = remoteSupportQuietedMediaElements.get(video);
  if (!quietedState) {
    return;
  }

  remoteSupportQuietedMediaElements.delete(video);
  if (quietedState.wasPaused || typeof video.play !== "function") {
    return;
  }

  try {
    const playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => {});
    }
  } catch (error) {
    // Ignore autoplay policy failures while restoring paused media.
  }
}

function quietRemoteSupportVideo(video) {
  if (!video || video.nodeType !== 1 || String(video.tagName || "").toLowerCase() !== "video") {
    return;
  }
  if (!remoteSupportMediaQuietingActive) {
    return;
  }

  if (!remoteSupportQuietedMediaElements.has(video)) {
    if (video.paused) {
      return;
    }
    remoteSupportQuietedMediaElements.set(video, { wasPaused: false });
  }

  if (!video.paused && typeof video.pause === "function") {
    try {
      video.pause();
    } catch (error) {
      // Ignore transient media state changes while the page is loading.
    }
  }
}

function quietRemoteSupportVideos(root = document) {
  if (!remoteSupportMediaQuietingActive || !root) {
    return;
  }

  if (root.nodeType === 1 && String(root.tagName || "").toLowerCase() === "video") {
    quietRemoteSupportVideo(root);
  }
  if (typeof root.querySelectorAll !== "function") {
    return;
  }
  root.querySelectorAll("video").forEach((video) => {
    quietRemoteSupportVideo(video);
  });
}

function handleRemoteSupportMediaPlay(event) {
  if (!event || !remoteSupportMediaQuietingActive) {
    return;
  }
  quietRemoteSupportVideo(event.target);
}

function handleRemoteSupportMediaQuietMutations(mutations) {
  if (!remoteSupportMediaQuietingActive || !Array.isArray(mutations)) {
    return;
  }
  mutations.forEach((mutation) => {
    if (!mutation) {
      return;
    }
    if (mutation.type === "attributes") {
      quietRemoteSupportVideo(mutation.target);
      return;
    }
    (mutation.addedNodes || []).forEach((node) => {
      quietRemoteSupportVideos(node);
    });
  });
}

function startRemoteSupportMediaQuieting() {
  if (remoteSupportMediaQuietingActive) {
    quietRemoteSupportVideos(document);
    return;
  }

  remoteSupportMediaQuietingActive = true;
  quietRemoteSupportVideos(document);
  document.addEventListener("play", handleRemoteSupportMediaPlay, true);
  const root = document.documentElement || document.body;
  if (!root || typeof MutationObserver !== "function") {
    return;
  }

  remoteSupportMediaQuietObserver = new MutationObserver(handleRemoteSupportMediaQuietMutations);
  remoteSupportMediaQuietObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["autoplay", "controls", "loop", "muted", "src", "style", "class"]
  });
}

function stopRemoteSupportMediaQuieting() {
  if (
    !remoteSupportMediaQuietingActive &&
    !remoteSupportMediaQuietObserver &&
    remoteSupportQuietedMediaElements.size === 0
  ) {
    return;
  }

  remoteSupportMediaQuietingActive = false;
  document.removeEventListener("play", handleRemoteSupportMediaPlay, true);
  if (remoteSupportMediaQuietObserver) {
    remoteSupportMediaQuietObserver.disconnect();
    remoteSupportMediaQuietObserver = null;
  }

  Array.from(remoteSupportQuietedMediaElements.keys()).forEach((video) => {
    restoreRemoteSupportQuietedVideo(video);
  });
  remoteSupportQuietedMediaElements.clear();
}

function applyRemoteSupportSessionState(remoteSupportStateLike) {
  const remoteSupportState =
    remoteSupportStateLike && typeof remoteSupportStateLike === "object"
      ? remoteSupportStateLike
      : {};
  const active = Boolean(
    typeof remoteSupportState.active === "boolean"
      ? remoteSupportState.active
      : String(remoteSupportState.mode || "inactive") !== "inactive"
  );

  remoteSupportMode = active ? String(remoteSupportState.mode || "inactive") : "inactive";
  remoteSupportRole = active ? String(remoteSupportState.role || "") : "";
  remoteSupportIncludePayloads = active ? Boolean(remoteSupportState.includePayloads) : false;

  if (isBeingSupportedMode()) {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    startRemoteSupportMediaQuieting();
  } else {
    stopRemoteSupportMediaQuieting();
  }

  syncPageTelemetryControl();
  syncRemoteSupportTerminateButton();
}

function forwardPageTelemetryMessage(message) {
  if (
    !message ||
    typeof message !== "object" ||
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== "function"
  ) {
    return;
  }

  Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => {});
}

function handlePageTelemetryWindowMessage(event) {
  if (!event || event.source !== window) {
    return;
  }

  const data = event.data && typeof event.data === "object" ? event.data : null;
  if (!data || data.__unfluffifyTelemetry !== PAGE_TELEMETRY_MESSAGE_MARKER) {
    return;
  }

  const message = data.message && typeof data.message === "object" ? data.message : null;
  if (!message || message.type !== "remoteSupportExtensionTelemetry") {
    return;
  }

  forwardPageTelemetryMessage(message);
}

function syncPageTelemetryControl() {
  if (typeof window === "undefined" || typeof window.postMessage !== "function") {
    return;
  }

  window.postMessage({
    __unfluffifyTelemetry: PAGE_TELEMETRY_CONTROL_MARKER,
    includePayloads: remoteSupportIncludePayloads
  }, "*");
}

function ensurePageTelemetryBridge() {
  if (
    typeof window === "undefined" ||
    typeof document !== "object" ||
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.getURL !== "function"
  ) {
    return;
  }

  if (!pageTelemetryBridgeListenerBound) {
    window.addEventListener("message", handlePageTelemetryWindowMessage);
    pageTelemetryBridgeListenerBound = true;
  }

  const existingScript = document.getElementById(PAGE_TELEMETRY_SCRIPT_ID);
  if (existingScript) {
    syncPageTelemetryControl();
    return;
  }

  const parent = document.head || document.documentElement;
  if (!parent || typeof document.createElement !== "function") {
    return;
  }

  const script = document.createElement("script");
  script.id = PAGE_TELEMETRY_SCRIPT_ID;
  script.type = "module";
  script.src = chrome.runtime.getURL("common/page-telemetry.js");
  script.addEventListener("load", () => {
    syncPageTelemetryControl();
  }, { once: true });
  parent.appendChild(script);
}

async function syncRemoteSupportSessionStateFromBackground() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "getRemoteSupportState"
    });
    if (!response || !response.ok) {
      return;
    }

    applyRemoteSupportSessionState(response.state || null);
  } catch (error) {
    // Ignore initial sync failures caused by transient background reloads.
  }
}

function isRemoteSupportSupportPage() {
  return Boolean(document.querySelector(REMOTE_SUPPORT_SUPPORT_PAGE_META_SELECTOR));
}

function ensureRemoteSupportTerminateButton() {
  if (!document.body) {
    return null;
  }

  let style = document.getElementById(REMOTE_SUPPORT_TERMINATE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = REMOTE_SUPPORT_TERMINATE_STYLE_ID;
    style.setAttribute("data-uf-extension-ui", "true");
    style.textContent = `
      #${REMOTE_SUPPORT_TERMINATE_BUTTON_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        padding: 10px 14px;
        border: 0;
        border-radius: 999px;
        background: #cf2338;
        color: #ffffff;
        font: 600 13px/1.1 "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
        box-shadow: 0 12px 32px rgba(126, 14, 27, 0.35);
        cursor: pointer;
      }
      #${REMOTE_SUPPORT_TERMINATE_BUTTON_ID}:hover {
        background: #b91d31;
      }
      #${REMOTE_SUPPORT_TERMINATE_BUTTON_ID}:disabled {
        cursor: wait;
        opacity: 0.8;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  let button = document.getElementById(REMOTE_SUPPORT_TERMINATE_BUTTON_ID);
  if (!button) {
    button = document.createElement("button");
    button.id = REMOTE_SUPPORT_TERMINATE_BUTTON_ID;
    button.type = "button";
    button.textContent = "Terminate session";
    button.setAttribute("data-uf-extension-ui", "true");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (remoteSupportTerminatePending) {
        return;
      }

      remoteSupportTerminatePending = true;
      syncRemoteSupportTerminateButton();
      chrome.runtime.sendMessage({
        type: "remoteSupportEnd"
      }).catch(() => {
        // Ignore transport teardown races.
      }).finally(() => {
        remoteSupportTerminatePending = false;
        syncRemoteSupportTerminateButton();
      });
    });
    (document.body || document.documentElement).appendChild(button);
  }

  return button;
}

function syncRemoteSupportTerminateButton() {
  if (isBeingSupportedMode() && !document.body && document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", syncRemoteSupportTerminateButton, { once: true });
    return;
  }

  const button = isBeingSupportedMode() ? ensureRemoteSupportTerminateButton() : document.getElementById(REMOTE_SUPPORT_TERMINATE_BUTTON_ID);
  if (!button) {
    return;
  }

  button.hidden = !isBeingSupportedMode();
  button.disabled = remoteSupportTerminatePending;
}

function ensureRemoteSupportSupportPageStyles() {
  let style = document.getElementById(REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID);
  if (style) {
    return style;
  }

  style = document.createElement("style");
  style.id = REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID;
  style.setAttribute("data-uf-extension-ui", "true");
  style.textContent = `
    html[data-uf-remote-support-page="true"],
    body[data-uf-remote-support-page="true"] {
      margin: 0;
      min-height: 100vh;
      background: #09111d;
    }

    body[data-uf-remote-support-page="true"] {
      display: block;
      padding: 0;
    }

    body[data-uf-remote-support-page="true"] > #${REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID} {
      display: block;
      min-height: 100vh;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} {
      min-height: 100vh;
      color: #e8edf6;
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} * {
      box-sizing: border-box;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page {
      min-height: 100vh;
      width: 100vw;
      display: grid;
      place-items: center;
      padding: 16px;
      background:
        radial-gradient(circle at top left, rgba(84, 132, 212, 0.26), transparent 32%),
        linear-gradient(180deg, #09111d 0%, #101a2b 100%);
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__hero {
      display: none;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 10px;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__eyebrow {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(108, 169, 255, 0.16);
      color: #9dc7ff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__title {
      margin: 14px 0 10px;
      font-size: clamp(32px, 5vw, 54px);
      line-height: 1.02;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__lede,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__caption,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__status {
      margin: 0;
      max-width: 64rem;
      color: #b7c6dd;
      font-size: 16px;
      line-height: 1.6;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__layout {
      display: grid;
      width: min(1480px, 100%);
      gap: 18px;
      align-items: start;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only {
      padding: 0;
      background: #04080f;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__hero,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__connect-card,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__caption {
      display: none;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__layout {
      display: block;
      gap: 0;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page--viewer-only .uf-support-page__surface {
      min-height: 100vh;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      background: #04080f;
      backdrop-filter: none;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__connect-card {
      min-width: 0;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage {
      display: grid;
      gap: 14px;
      width: min(1280px, 100%);
      justify-self: center;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__connect-card {
      width: min(360px, 100%);
      justify-self: start;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__card,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface {
      border: 1px solid rgba(182, 209, 246, 0.14);
      border-radius: 24px;
      background: rgba(8, 16, 27, 0.84);
      box-shadow: 0 24px 60px rgba(5, 10, 19, 0.35);
      backdrop-filter: blur(18px);
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__card {
      padding: 20px;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__connect-card {
      display: grid;
      gap: 12px;
      align-content: start;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__sidebar-brand {
      margin: 0;
      color: #ffffff;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__meta {
      display: grid;
      gap: 14px;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__meta-label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7ea4d4;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__meta-value {
      margin-top: 6px;
      color: #ffffff;
      font-size: 18px;
      font-weight: 600;
      word-break: break-word;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface:focus-visible {
      outline: 2px solid #6ca9ff;
      outline-offset: 2px;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      gap: 8px;
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button {
      background: #6ca9ff;
      color: #08111c;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__button--compact {
      margin-left: auto;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface {
      position: relative;
      min-height: 70vh;
      overflow: hidden;
      display: grid;
      place-items: stretch;
      padding: 0;
      user-select: none;
      cursor: auto;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface.is-disabled {
      opacity: 0.9;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__viewer,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      border: 0;
      object-fit: contain;
      background: #04080f;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__viewer {
      pointer-events: none;
      z-index: 2;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface img {
      z-index: 1;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface .uf-support-page__placeholder {
      visibility: visible;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface.is-disabled .uf-support-page__placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 32px;
      text-align: center;
      color: #c4d1e3;
      font-size: 18px;
      line-height: 1.6;
      background:
        radial-gradient(circle at top, rgba(108, 169, 255, 0.18), transparent 36%),
        linear-gradient(180deg, rgba(7, 12, 20, 0.92), rgba(7, 12, 20, 0.98));
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(207, 35, 56, 0.14);
      border: 1px solid rgba(236, 88, 107, 0.24);
      color: #ffc3cb;
      line-height: 1.5;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss {
      position: relative;
      width: 28px;
      height: 28px;
      margin: -4px -6px -4px 4px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #ffc3cb;
      cursor: pointer;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::before,
    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: 14px;
      height: 2px;
      border-radius: 999px;
      background: currentColor;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::before {
      transform: translate(-50%, -50%) rotate(45deg);
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss::after {
      transform: translate(-50%, -50%) rotate(-45deg);
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss:hover {
      background: rgba(236, 88, 107, 0.18);
      color: #ffffff;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__notice-dismiss:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 2px;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__caption {
      margin-top: 14px;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage-copy {
      display: grid;
      gap: 8px;
    }

    @media (max-width: 1080px) {
      #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__layout {
        width: 100%;
      }

      #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__hero {
        flex-direction: column;
      }

      #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__stage-toolbar {
        flex-direction: column;
        align-items: stretch;
      }

      #${REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID} .uf-support-page__surface {
        min-height: 56vh;
      }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

function buildRemoteSupportSupportPageStatusText() {
  if (!remoteSupportSupportPageState.active) {
    return "Enter the six-digit support code to turn this page into the live remote view.";
  }

  if (remoteSupportSupportPageState.mode === "supporting") {
    return remoteSupportSupportPageState.connected
      ? "Connected."
      : "Support session started. Waiting for the requester to finish connecting.";
  }

  if (remoteSupportSupportPageState.mode === "being_supported") {
    return "This page is currently being supported remotely.";
  }

  return "Remote support is active.";
}

function buildRemoteSupportSupportPageSurfaceText() {
  if (!remoteSupportSupportPageState.active) {
    return "Start or join a support session to make this page mirror the remote tab.";
  }

  if (!remoteSupportSupportPageState.connected) {
    return "Waiting for the remote page to connect...";
  }

  return "Connected. Waiting for the live remote surface...";
}

function getRemoteSupportSupportPageSurfaceRect(surface, frame, options = {}) {
  const fallbackRect = surface.getBoundingClientRect();
  const intrinsicWidth = Number.isFinite(Number(options.intrinsicWidth))
    ? Math.max(0, Math.trunc(Number(options.intrinsicWidth)))
    : remoteSupportSupportPageViewerVideoActive
      ? remoteSupportSupportPageViewerIntrinsicWidth
      : (frame && !frame.hidden ? (frame.naturalWidth || frame.width || 0) : 0);
  const intrinsicHeight = Number.isFinite(Number(options.intrinsicHeight))
    ? Math.max(0, Math.trunc(Number(options.intrinsicHeight)))
    : remoteSupportSupportPageViewerVideoActive
      ? remoteSupportSupportPageViewerIntrinsicHeight
      : (frame && !frame.hidden ? (frame.naturalHeight || frame.height || 0) : 0);

  if (!intrinsicWidth || !intrinsicHeight) {
    return fallbackRect;
  }

  const containerWidth = Math.max(1, fallbackRect.width || 1);
  const containerHeight = Math.max(1, fallbackRect.height || 1);
  const imageAspectRatio = intrinsicWidth / intrinsicHeight;
  const containerAspectRatio = containerWidth / containerHeight;

  let renderedWidth = containerWidth;
  let renderedHeight = containerHeight;
  if (containerAspectRatio > imageAspectRatio) {
    renderedHeight = containerHeight;
    renderedWidth = renderedHeight * imageAspectRatio;
  } else {
    renderedWidth = containerWidth;
    renderedHeight = renderedWidth / imageAspectRatio;
  }

  const left = fallbackRect.left + ((containerWidth - renderedWidth) / 2);
  const top = fallbackRect.top + ((containerHeight - renderedHeight) / 2);

  return {
    left,
    top,
    width: renderedWidth,
    height: renderedHeight
  };
}

async function handleRemoteSupportSupportPageEnd() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "remoteSupportEnd",
      sessionId: typeof remoteSupportSupportPageState.sessionId === "string"
        ? remoteSupportSupportPageState.sessionId
        : ""
    });

    if (response && response.ok) {
      applyRemoteSupportSupportPageState(response.state || null);
      return;
    }
  } catch (error) {
    // Fall through to a state refresh.
  }

  await refreshRemoteSupportSupportPageState();
}

async function dismissRemoteSupportSupportPageError() {
  remoteSupportSupportPageState = normalizeRemoteSupportSupportPageState({
    ...remoteSupportSupportPageState,
    error: ""
  });
  renderRemoteSupportSupportPage();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "remoteSupportDismissError",
      tabId: Number.isFinite(remoteSupportSupportPageTabId) ? remoteSupportSupportPageTabId : undefined,
      sessionId: remoteSupportSupportPageState.active && typeof remoteSupportSupportPageState.sessionId === "string"
        ? remoteSupportSupportPageState.sessionId
        : ""
    });

    if (response && response.ok) {
      applyRemoteSupportSupportPageState(response.state || null);
    }
  } catch (error) {
    // Keep the local dismissal if the background snapshot was already cleared.
  }
}

async function syncRemoteSupportSupportPageDockState(dockState) {
  if (!remoteSupportSupportPageState.active) {
    return;
  }
  const normalizedDockState = normalizeRemoteSupportDockState(dockState);
  remoteSupportSupportPageState = normalizeRemoteSupportSupportPageState({
    ...remoteSupportSupportPageState,
    dockState: normalizedDockState
  });
  renderRemoteSupportSupportPage();
  await chrome.runtime.sendMessage({
    type: "remoteSupportSetDockState",
    tabId: Number.isFinite(remoteSupportSupportPageTabId) ? remoteSupportSupportPageTabId : undefined,
    sessionId: remoteSupportSupportPageState.sessionId || "",
    dockState: normalizedDockState
  }).catch(() => {});
  sendRemoteSupportSupportPageViewerRequest("remoteSupportUpdateDockState", {
    dockState: normalizedDockState
  }).then();
}

function syncRemoteSupportSupportPageFullscreenState() {
  const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
  remoteSupportSupportPageFullscreenActive = Boolean(
    elements &&
      elements.surface &&
      document.fullscreenElement === elements.surface
  );
  if (elements && elements.fullscreenButton) {
    elements.fullscreenButton.textContent = remoteSupportSupportPageFullscreenActive
      ? "Exit fullscreen"
      : "Enter fullscreen";
  }
  if (remoteSupportSupportPageState.active) {
    syncRemoteSupportSupportPageDockState(
      remoteSupportSupportPageFullscreenActive
        ? REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE
        : REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED
    ).then();
  }
}

async function toggleRemoteSupportSupportPageFullscreen() {
  const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
  if (!elements || !elements.surface) {
    return;
  }
  if (document.fullscreenElement === elements.surface) {
    await document.exitFullscreen?.();
    return;
  }
  if (typeof elements.surface.requestFullscreen === "function") {
    await elements.surface.requestFullscreen();
  }
}

function ensureRemoteSupportSupportPageUi() {
  if (!isRemoteSupportSupportPage() || !document.body) {
    return null;
  }

  ensureRemoteSupportSupportPageStyles();
  document.documentElement.setAttribute("data-uf-remote-support-page", "true");
  document.body.setAttribute("data-uf-remote-support-page", "true");

  const fallback = document.getElementById(REMOTE_SUPPORT_SUPPORT_PAGE_FALLBACK_ID);
  if (fallback) {
    fallback.hidden = true;
  }

  let appHost = document.getElementById(REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID);
  if (!appHost) {
    appHost = document.createElement("div");
    appHost.id = REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID;
    appHost.setAttribute("data-uf-extension-ui", "true");
    document.body.prepend(appHost);
  }

  let root = document.getElementById(REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID;
    root.setAttribute("data-uf-extension-ui", "true");
    root.innerHTML = `
      <div class="uf-support-page" data-uf-extension-ui="true">
        <section class="uf-support-page__layout" data-uf-extension-ui="true">
          <div class="uf-support-page__stage" data-uf-extension-ui="true">
            <div class="uf-support-page__stage-toolbar" data-uf-extension-ui="true">
              <div class="uf-support-page__stage-copy" data-uf-extension-ui="true">
                <h1 class="uf-support-page__sidebar-brand" data-uf-extension-ui="true">Unfluffify Support</h1>
                <p id="uf-support-page-passive-state" class="uf-support-page__status" data-uf-extension-ui="true">Join a support session from the Unfluffify extension popup while this /support tab stays focused on viewing.</p>
              </div>
              <button id="uf-support-page-fullscreen" class="uf-support-page__button uf-support-page__button--compact" type="button" data-uf-extension-ui="true">Enter fullscreen</button>
            </div>
              <div id="uf-support-page-surface" class="uf-support-page__surface is-disabled" tabindex="0" aria-disabled="true" data-uf-extension-ui="true">
              <iframe id="uf-support-page-viewer" class="uf-support-page__viewer" title="Live remote support viewer" hidden data-uf-extension-ui="true"></iframe>
              <img id="uf-support-page-frame" alt="Live remote page reflection" hidden data-uf-extension-ui="true">
              <div id="uf-support-page-placeholder" class="uf-support-page__placeholder" data-uf-extension-ui="true"></div>
            </div>
            <p class="uf-support-page__caption" data-uf-extension-ui="true">Live Chrome window stream. Remote control is disabled.</p>
          </div>
          <div class="uf-support-page__card uf-support-page__connect-card" data-uf-extension-ui="true">
            <div class="uf-support-page__meta-label" data-uf-extension-ui="true">Support page</div>
            <p class="uf-support-page__status" data-uf-extension-ui="true">Use the extension popup to join. The page surface stays dedicated to the shared screen.</p>
            <div id="uf-support-page-error" class="uf-support-page__notice" hidden data-uf-extension-ui="true">
              <span id="uf-support-page-error-text" data-uf-extension-ui="true"></span>
              <button id="uf-support-page-error-dismiss" class="uf-support-page__notice-dismiss" type="button" aria-label="Dismiss notice" title="Dismiss notice" data-uf-extension-ui="true"></button>
            </div>
          </div>
        </section>
      </div>
    `;
    appHost.replaceChildren(root);

    remoteSupportSupportPageElements = {
      root,
      error: root.querySelector("#uf-support-page-error"),
      errorText: root.querySelector("#uf-support-page-error-text"),
      errorDismiss: root.querySelector("#uf-support-page-error-dismiss"),
      controlButton: null,
      endButton: null,
      passiveState: root.querySelector("#uf-support-page-passive-state"),
      fullscreenButton: root.querySelector("#uf-support-page-fullscreen"),
      surface: root.querySelector("#uf-support-page-surface"),
      viewer: root.querySelector("#uf-support-page-viewer"),
      frame: root.querySelector("#uf-support-page-frame"),
      placeholder: root.querySelector("#uf-support-page-placeholder")
    };

    remoteSupportSupportPageElements.frame.decoding = "async";
    initializeRemoteSupportSupportPageViewer(remoteSupportSupportPageElements.viewer);

    remoteSupportSupportPageElements.errorDismiss.addEventListener("click", (event) => {
      event.preventDefault();
      dismissRemoteSupportSupportPageError().then();
    });
    remoteSupportSupportPageElements.fullscreenButton.addEventListener("click", (event) => {
      event.preventDefault();
      toggleRemoteSupportSupportPageFullscreen().then();
    });
    remoteSupportSupportPageElements.surface.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
  }

  return remoteSupportSupportPageElements;
}

function syncRemoteSupportSupportPageFrame() {
  const elements = remoteSupportSupportPageElements || ensureRemoteSupportSupportPageUi();
  if (!elements) {
    return;
  }

  syncRemoteSupportSupportPageViewerVisibility();

  if (remoteSupportSupportPageViewerVideoActive) {
    remoteSupportSupportPageRenderedFrame = "";
    elements.frame.hidden = true;
    if (elements.frame.getAttribute("src")) {
      elements.frame.removeAttribute("src");
    }
    elements.placeholder.hidden = true;
    return;
  }

  const nextFrame = remoteSupportSupportPageState.active ? remoteSupportSupportPageLastFrame : "";
  if (nextFrame) {
    if (remoteSupportSupportPageRenderedFrame !== nextFrame) {
      remoteSupportSupportPageRenderedFrame = nextFrame;
      if (elements.frame.getAttribute("src") !== nextFrame) {
        elements.frame.setAttribute("src", nextFrame);
      }
    }
    elements.frame.hidden = false;
    elements.placeholder.hidden = true;
    return;
  }

  remoteSupportSupportPageRenderedFrame = "";
  elements.frame.hidden = true;
  if (elements.frame.getAttribute("src")) {
    elements.frame.removeAttribute("src");
  }
  elements.placeholder.hidden = false;
  elements.placeholder.textContent = buildRemoteSupportSupportPageSurfaceText();
}

function scheduleRemoteSupportSupportPageFrameRender() {
  syncRemoteSupportSupportPageFrame();
}

function renderRemoteSupportSupportPage() {
  const elements = ensureRemoteSupportSupportPageUi();
  if (!elements) {
    return;
  }

  const active = Boolean(remoteSupportSupportPageState.active);
  const errorText = typeof remoteSupportSupportPageState.error === "string"
    ? remoteSupportSupportPageState.error.trim()
    : "";

  elements.root.classList.remove("uf-support-page--viewer-only");
  elements.error.hidden = !errorText;
  if (elements.errorText) {
    elements.errorText.textContent = errorText;
  }
  if (elements.passiveState) {
    const inactivityCountdownText = Boolean(remoteSupportSupportPageState.inactivityCountdownActive)
      ? ` Session will end in ${formatRemoteSupportCountdown(remoteSupportSupportPageState.inactivitySecondsRemaining)} due to requester inactivity.`
      : "";
    elements.passiveState.textContent = active
      ? `The support session is live. Use the dock or the extension popup to manage the connection.${inactivityCountdownText}`
      : "Join a support session from the Unfluffify extension popup while this /support tab stays focused on viewing.";
  }
  if (elements.fullscreenButton) {
    elements.fullscreenButton.hidden = !active;
    elements.fullscreenButton.textContent = remoteSupportSupportPageFullscreenActive
      ? "Exit fullscreen"
      : "Enter fullscreen";
  }

  elements.surface.classList.toggle("is-disabled", true);
  elements.surface.setAttribute("aria-disabled", "true");
  elements.surface.tabIndex = -1;
  syncRemoteSupportSupportPageViewerVisibility();

  scheduleRemoteSupportSupportPageFrameRender({ immediate: true });
}

function applyRemoteSupportSupportPageState(nextState) {
  remoteSupportSupportPageState = normalizeRemoteSupportSupportPageState(nextState);
  if (Number.isFinite(remoteSupportSupportPageState.tabId)) {
    remoteSupportSupportPageTabId = remoteSupportSupportPageState.tabId;
  }
  if (!remoteSupportSupportPageState.active) {
    remoteSupportSupportPageLastFrame = "";
    updateRemoteSupportSupportPageViewerVideoState({ active: false, width: 0, height: 0 });
    remoteSupportSupportPageFullscreenActive = false;
  }
  renderRemoteSupportSupportPage();
  sendRemoteSupportSupportPageViewerRequest("remoteSupportUpdateDockState", {
    dockState: remoteSupportSupportPageFullscreenActive
      ? REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE
      : remoteSupportSupportPageState.dockState
  }).then();
}

async function refreshRemoteSupportSupportPageState() {
  if (!isRemoteSupportSupportPage()) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "getRemoteSupportState"
    });

    if (!response || !response.ok) {
      applyRemoteSupportSupportPageState({
        ...remoteSupportSupportPageState,
        error: "Unable to load the current remote support state."
      });
      return;
    }

    applyRemoteSupportSupportPageState(response.state || null);
  } catch (error) {
    applyRemoteSupportSupportPageState({
      ...remoteSupportSupportPageState,
      error: error && error.message ? error.message : "Unable to load the current remote support state."
    });
  }
}

function initializeRemoteSupportSupportPage() {
  if (!isRemoteSupportSupportPage()) {
    return;
  }

  if (!document.body) {
    window.addEventListener("DOMContentLoaded", initializeRemoteSupportSupportPage, { once: true });
    return;
  }

  ensureRemoteSupportSupportPageUi();
  renderRemoteSupportSupportPage();
  document.addEventListener("fullscreenchange", syncRemoteSupportSupportPageFullscreenState);
  refreshRemoteSupportSupportPageState().then();
}

async function loadGlobalAiSettingsForContent() {
  const stored = await utils.storageGet(chrome.storage.sync, {
    globalStageBase: "",
    globalToken: "",
    globalConfigEndpoint: ""
  });
  return {
    stageBaseValue: typeof stored.globalStageBase === "string" ? stored.globalStageBase.trim() : "",
    tokenValue: typeof stored.globalToken === "string" ? stored.globalToken.trim() : "",
    configEndpointValue: typeof stored.globalConfigEndpoint === "string" ? stored.globalConfigEndpoint.trim() : ""
  };
}

async function resolveSiteIdFromGraphql(options = {}) {
  const {
    stageBase = "",
    pageUrl = "",
    tokenValue = ""
  } = options;
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBase);
  if (!graphqlEndpoint || !pageUrl) {
    return null;
  }
  const response = await fetch(graphqlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {})
    },
    body: JSON.stringify({
      query: URL_SEARCH_INFO_QUERY,
      variables: {
        url: pageUrl,
        includePageInfo: false
      }
    })
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok || !payload || Array.isArray(payload.errors)) {
    return null;
  }
  return normalizeSiteIdValue(
    payload &&
      payload.data &&
      payload.data.urlSearchInfo &&
      payload.data.urlSearchInfo.domainId
  );
}

function extractUrlPathAndHostname(url = location.href) {
  try {
    const parsed = new URL(url);
    return {
      hostname: (parsed.hostname || "").toLowerCase(),
      path: (parsed.pathname || "/").replace(/\/+$/, "") || "/"
    };
  } catch {
    return { hostname: "", path: "" };
  }
}

function isSignificantUrlPathChange(currentUrl, lastPath, lastHostname) {
  const current = extractUrlPathAndHostname(currentUrl);
  if (!current.hostname) {
    return false;
  }
  // Different hostname = not just a path change
  if (current.hostname !== lastHostname) {
    return false;
  }
  // Same path = no change
  if (current.path === lastPath) {
    return false;
  }
  // Path changed on same domain
  return true;
}

async function recheckSiteIdForCurrentUrlPath(tabState) {
  if (!tabState || !tabState.baseUrl) {
    return null;
  }
  const currentUrl = location.href;
  const { stageBaseValue, tokenValue } = await loadGlobalAiSettingsForContent();
  if (!normalizeStageBaseValue(stageBaseValue) || !tokenValue) {
    return null;
  }
  const newSiteId = await resolveSiteIdFromGraphql({
    stageBase: stageBaseValue,
    pageUrl: currentUrl,
    tokenValue
  });
  if (!newSiteId) {
    return null;
  }
  const currentConfigs = await config.getConfigs();
  const normalizedBaseUrl = utils.normalizeBaseUrl(tabState.baseUrl) || tabState.baseUrl;
  const currentConfig = config.normalizeConfig(normalizedBaseUrl, currentConfigs[normalizedBaseUrl]).config;
  const oldSiteId = normalizeSiteIdValue(currentConfig.siteId);
  if (oldSiteId && oldSiteId !== newSiteId) {
    // Site ID changed for this URL path, need to update
    return { newSiteId, currentUrl, oldSiteId };
  }
  if (!oldSiteId && newSiteId) {
    // No previous site ID, now we have one
    return { newSiteId, currentUrl, oldSiteId: null };
  }
  return null;
}

async function fetchPropertyPageTypesForSiteId(siteId, stageBaseValue, tokenValue) {
  const graphqlEndpoint = buildGraphqlEndpointFromStageBase(stageBaseValue);
  const response = await fetch(graphqlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenValue}`
    },
    body: JSON.stringify({
      query: PROPERTY_PAGE_TYPES_QUERY,
      variables: {
        domainId: siteId
      }
    })
  });
  await maybeUpdateStoredTokenFromResponse(response, tokenValue);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok || !payload || Array.isArray(payload.errors)) {
    return {
      ok: false,
      pageTypes: [],
      reason: "Unable to verify Live Page candidates."
    };
  }
  const normalized = normalizePropertyPageTypes(
    payload && payload.data
      ? payload.data.propertyPageTypes
      : null
  );
  return {
    ok: true,
    pageTypes: normalized.pageTypes || []
  };
}

async function resolveCurrentLivePageTarget(baseUrl, options = {}) {
  const pageUrl = typeof options.pageUrl === "string" && options.pageUrl
    ? options.pageUrl
    : location.href;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !pageUrl || !utils.isPageWithinBaseUrl(pageUrl, normalizedBaseUrl)) {
    return { ok: false, reason: "Set Base Page URL in the Unfluffify popup first." };
  }

  const { stageBaseValue, tokenValue } = await loadGlobalAiSettingsForContent();
  if (!normalizeStageBaseValue(stageBaseValue) || !tokenValue) {
    return { ok: false, reason: "Open the Unfluffify popup first." };
  }

  const currentConfigs = await config.getConfigs();
  const normalizedConfig = config.normalizeConfig(
    normalizedBaseUrl,
    currentConfigs[normalizedBaseUrl]
  ).config;
  const storedSiteId = normalizeSiteIdValue(normalizedConfig.siteId);
  let siteId = storedSiteId;
  if (Boolean(options.forceSiteIdRefresh) || !siteId) {
    const resolvedSiteId = await resolveSiteIdFromGraphql({
      stageBase: stageBaseValue,
      pageUrl,
      tokenValue
    });
    if (resolvedSiteId) {
      siteId = resolvedSiteId;
      if (siteId !== storedSiteId) {
        await config.updateConfig(normalizedBaseUrl, (targetConfig) => {
          targetConfig.siteId = siteId;
        });
      }
    }
  }
  if (!siteId) {
    return { ok: false, reason: "Open the Unfluffify popup first." };
  }

  const propertyPageTypesResult = await fetchPropertyPageTypesForSiteId(
    siteId,
    stageBaseValue,
    tokenValue
  );
  if (!propertyPageTypesResult.ok) {
    return {
      ok: false,
      reason: propertyPageTypesResult.reason || "Unable to verify Live Page candidates."
    };
  }

  const candidateState = getCurrentPageCandidateState(pageUrl, propertyPageTypesResult.pageTypes);
  if (candidateState.status === "empty") {
    return { ok: false, reason: "Live Pages are not prepared for this site yet." };
  }
  if (candidateState.status === "duplicate") {
    return { ok: false, reason: "This page is listed under multiple Live Page types and cannot be marked." };
  }
  if (candidateState.status !== "candidate" || !candidateState.pageTypeKey) {
    return { ok: false, reason: "This page is not a current Live Page candidate." };
  }

  return {
    ok: true,
    baseUrl: normalizedBaseUrl,
    siteId,
    pageType: candidateState.pageTypeKey,
    candidateState
  };
}

async function resolveCurrentPropertyLockConnectionTarget(baseUrl, options = {}) {
  const pageUrl = typeof options.pageUrl === "string" && options.pageUrl
    ? options.pageUrl
    : location.href;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !pageUrl || !utils.isPageWithinBaseUrl(pageUrl, normalizedBaseUrl)) {
    return { ok: false, reason: "not_in_base_url" };
  }

  const { stageBaseValue, tokenValue } = await loadGlobalAiSettingsForContent();
  if (!normalizeStageBaseValue(stageBaseValue) || !tokenValue) {
    return { ok: false, reason: "missing_lock_settings" };
  }

  const currentConfigs = await config.getConfigs();
  const normalizedConfig = config.normalizeConfig(
    normalizedBaseUrl,
    currentConfigs[normalizedBaseUrl]
  ).config;
  const storedSiteId = normalizeSiteIdValue(normalizedConfig.siteId);
  let siteId = storedSiteId;
  if (Boolean(options.forceSiteIdRefresh) || !siteId) {
    const resolvedSiteId = await resolveSiteIdFromGraphql({
      stageBase: stageBaseValue,
      pageUrl,
      tokenValue
    });
    if (resolvedSiteId) {
      siteId = resolvedSiteId;
      if (siteId !== storedSiteId) {
        await config.updateConfig(normalizedBaseUrl, (targetConfig) => {
          targetConfig.siteId = siteId;
        });
      }
    }
  }
  if (!siteId) {
    return { ok: false, reason: "missing_site_id" };
  }
  return {
    ok: true,
    baseUrl: normalizedBaseUrl,
    pageUrl,
    siteId,
    stageBaseValue,
    tokenValue
  };
}

async function resolvePropertyLockCandidateState(target) {
  if (!target || !target.ok) {
    return { ok: false, candidate: false };
  }
  const propertyPageTypesResult = await fetchPropertyPageTypesForSiteId(
    target.siteId,
    target.stageBaseValue,
    target.tokenValue
  );
  if (!propertyPageTypesResult.ok) {
    return { ok: false, candidate: true, reason: propertyPageTypesResult.reason || "" };
  }
  const candidateState = getCurrentPageCandidateState(target.pageUrl, propertyPageTypesResult.pageTypes);
  return {
    ok: true,
    candidate: candidateState.status === "candidate" && Boolean(candidateState.pageTypeKey),
    candidateState
  };
}

async function resolveCurrentPageTypeForMarking(baseUrl, pageUrl = location.href) {
  const target = await resolveCurrentLivePageTarget(baseUrl, { pageUrl });
  if (!target.ok || !target.pageType) {
    return { ok: false, reason: target.reason || "This page is not a current Live Page candidate." };
  }
  return { ok: true, pageType: target.pageType };
}

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

async function resolveBaseUrlForCurrentPage() {
  let baseUrl = state.baseUrl || "";
  if (!baseUrl || !utils.isPageWithinBaseUrl(location.href, baseUrl)) {
    const tabState = await utils.sendRuntimeMessage({ type: "getTabState" });
    baseUrl = tabState && tabState.baseUrl ? tabState.baseUrl : "";
  }
  if (!baseUrl || !utils.isPageWithinBaseUrl(location.href, baseUrl)) {
    const configs = await config.getConfigs();
    baseUrl = utils.findMatchingBaseUrl(location.href, configs);
  }
  return baseUrl && utils.isPageWithinBaseUrl(location.href, baseUrl) ? baseUrl : "";
}

async function isEnableHotkeyAllowedOnPage() {
  const currentlyEnabled = Boolean(state.enabled);
  if (currentlyEnabled) {
    return { allowed: true, baseUrl: state.baseUrl || "", pageType: state.currentPageType || "" };
  }
  const baseUrl = await resolveBaseUrlForCurrentPage();
  if (!baseUrl) {
    return { allowed: false, baseUrl: "", pageType: "" };
  }
  const baseConfig = await config.ensureConfig(baseUrl);
  if (!config.isRenderModeConfirmed(baseConfig)) {
    return { allowed: false, baseUrl, pageType: "" };
  }
  const pageTypeResult = await resolveCurrentPageTypeForMarking(baseUrl, location.href);
  if (!pageTypeResult.ok || !pageTypeResult.pageType) {
    return { allowed: false, baseUrl, pageType: "" };
  }
  return { allowed: true, baseUrl, pageType: pageTypeResult.pageType };
}

function hasSavedPageDataForHotkey(entry) {
  return Boolean(
    entry &&
      ((Array.isArray(entry.xpaths) && entry.xpaths.length > 0) ||
        (Array.isArray(entry.includeXpaths) && entry.includeXpaths.length > 0) ||
        (Array.isArray(entry.consentXpaths) && entry.consentXpaths.length > 0) ||
        (typeof entry.renderedHtml === "string" && entry.renderedHtml.length > 0))
  );
}

function hasSavedAiSnapshotForHotkey(entry) {
  return Boolean(
    entry &&
      typeof entry.renderedHtml === "string" &&
      entry.renderedHtml.length > 0 &&
      Array.isArray(entry.submissionXpaths) &&
      entry.submissionXpaths.length > 0
  );
}

async function isPageSaveHotkeyAllowedOnPage() {
  if (!state.enabled || !state.baseUrl || !state.config) {
    return false;
  }
  const pageUrl = location.href;
  const draftEntry = core.getDraftPageEntry(pageUrl);
  if (!draftEntry) {
    return false;
  }
  const savedEntry = core.getSavedPageEntry(pageUrl);
  const hasSavedPageData = hasSavedPageDataForHotkey(savedEntry);
  const needsAiSnapshotBackfill = hasSavedPageData && !hasSavedAiSnapshotForHotkey(savedEntry);
  const mobileSimulationActive = await isMobileSimulationActiveForCurrentTab();
  return Boolean(
    mobileSimulationActive &&
    (core.isPageDraftDirty(pageUrl) || !hasSavedPageData || needsAiSnapshotBackfill)
  );
}

async function toggleDeviceEmulationFromPage() {
  if (deviceEmulationHotkeyBusy) {
    return;
  }
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
  deviceEmulationHotkeyBusy = true;
  let result = null;
  try {
    result = await utils.sendRuntimeMessage(request);
  } finally {
    deviceEmulationHotkeyBusy = false;
  }
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
  const { baseUrl, pageType = "", showToast = false } = options || {};
  const resolvedPageType = typeof pageType === "string" && pageType ? pageType : state.currentPageType || "";
  const targetBaseUrl = baseUrl || state.baseUrl || "";
  if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
    if (showToast) {
      showPageToast("Enable marking to save this page.");
    }
    return { ok: false };
  }
  const pageUrl = location.href;
  const savedEntry = core.getSavedPageEntry(pageUrl);
  const draftEntry = core.getDraftPageEntry(pageUrl);
  const draftEntryChanged = !core.areEntriesEquivalent(draftEntry, savedEntry);
  const reconciliation = core.getPageSaveReconciliationState(pageUrl);
  const reconciliationPending = Boolean(reconciliation);
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
    !draftEntryChanged &&
    !reconciliationPending &&
    hasSavedEntry &&
    savedEntryHasAiSubmissionData &&
    savedEntryMatchesCurrentSnapshot
  ) {
    if (showToast) {
      showPageToast("No changes to save");
    }
    return { ok: true, saved: false, dirty: false };
  }
  if (
    reconciliationPending &&
    !draftEntryChanged &&
    hasSavedEntry &&
    savedEntryHasAiSubmissionData &&
    savedEntryMatchesCurrentSnapshot
  ) {
    if (showToast) {
      showPageToast("Server sync pending");
    }
    return { ok: true, saved: true, dirty: true, reconciliationPending: true };
  }
  const hadReconciliationPending = reconciliationPending;
  if (!hadReconciliationPending) {
    await core.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, { reason: "saving" });
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
  entry.pageType = resolvedPageType || entry.pageType;
  entry.submissionXpaths = currentSubmissionXpaths;
  core.touchPageEntryTimestamp(entry);
  state.config.pageMarkings[pageUrl] = entry;
  try {
    await core.saveConfig(targetBaseUrl, state.config);
  } catch (error) {
    if (!hadReconciliationPending) {
      await core.clearPageSaveReconciliation(targetBaseUrl, pageUrl);
    }
    if (showToast) {
      showPageToast("Unable to save page");
    }
    return { ok: false };
  }
  core.setSavedPageEntry(pageUrl, entry);
  await core.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, { reason: "pending" });
  core.scheduleRender();
  core.notifyDraftStatus(pageUrl);
  if (showToast) {
    showPageToast("Page saved locally; server sync pending");
  }
  return {
    ok: true,
    saved: true,
    dirty: true,
    reconciliationPending: true
  };
}

async function toggleEnabledFromPage(options = {}) {
  const { gate = null, showDisabledToast = true } = options || {};
  const tabState = await utils.sendRuntimeMessage({ type: "getTabState" });
  const currentlyEnabled = Boolean(state.enabled || (tabState && tabState.enabled));
  const gateResult = gate || await isEnableHotkeyAllowedOnPage();
  const baseUrl = gateResult.baseUrl || state.baseUrl || (tabState && tabState.baseUrl ? tabState.baseUrl : "");
  if (!baseUrl || !utils.isPageWithinBaseUrl(location.href, baseUrl)) {
    if (showDisabledToast) {
      showPageToast("Set Base Page URL in the Unfluffify popup first.");
    }
    return;
  }
  if (!gateResult.allowed) {
    return;
  }
  if (currentlyEnabled) {
    if (core.isPageSaveReconciliationPending(location.href)) {
      showPageToast("Finish server sync before editing");
      return;
    }
    state.currentPageType = "";
    core.disable();
    await utils.sendRuntimeMessage({
      type: "setTabState",
      enabled: false,
      baseUrl,
      pageType: ""
    });
    refreshSilentHighlightings().then();
    return;
  }
  state.currentPageType = gateResult.pageType || "";
  await utils.sendRuntimeMessage({
    type: "setTabState",
    enabled: true,
    baseUrl,
    pageType: state.currentPageType
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
  overlay.querySelectorAll(".uf-silent-layer[data-layer]").forEach((layer) => {
    if (!SILENT_HIGHLIGHT_LAYER_KEYS.includes(layer.dataset.layer || "")) {
      layer.remove();
    }
  });
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
  if (hidden && isBeingSupportedMode()) {
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
  const excludedNodes = Array.from(collections.excludedNodes || []);
  const contentLayerState = beginSilentLayerRender("content");
  const excludedLayerState = beginSilentLayerRender("excluded");

  contentNodes.forEach((node) => {
    drawSilentRectsForNode(contentLayerState, node, "uf-silent-content");
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
  finalizeSilentLayerRender(excludedLayerState);
  applySilentSelectorAnnotations(collections);
  silentHighlightCollections = {
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
    `[${SILENT_CONTENT_HIGHLIGHTING_ATTR}], [${SILENT_CONTENT_EXCLUDED_ATTR}]`
  );
  marked.forEach((node) => {
    const title = node.getAttribute("title") || "";
    if (title.startsWith("Unfluffify selector:")) {
      node.removeAttribute("title");
    }
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
      if (mutation.type !== "attributes") {
        needsFullRefresh = true;
        break;
      }
      const attributeName = mutation.attributeName || "";
      if (SILENT_HIGHLIGHTING_POSITION_REFRESH_ATTRS.has(attributeName)) {
        if (mutationTargetTouchesSilentCollections(mutation.target)) {
          needsPositionRefresh = true;
        }
        continue;
      }
      needsFullRefresh = true;
      break;
    }

    if (needsFullRefresh) {
      invalidateSharedSelectorCache({ domStructure: true });
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
      syncPropertyLockConnection({
        pageUrl: lastUrl,
        forceSiteIdRefresh: true
      }).then();
      refreshSilentHighlightings().then();
    }
  }, 800);
}

function resetAiPreviewState() {
  if (aiComputeLockReleaseTimer) {
    window.clearTimeout(aiComputeLockReleaseTimer);
    aiComputeLockReleaseTimer = 0;
  }
  clearAiPreviewClickableTargets();
  aiPreviewState = createAiPreviewState();
}

function clearAiPreviewState() {
  if (!aiPreviewState.active) {
    return false;
  }
  resetAiPreviewState();
  return true;
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
}

function scheduleAiComputeLockRelease(expiresAt) {
  if (aiComputeLockReleaseTimer) {
    window.clearTimeout(aiComputeLockReleaseTimer);
    aiComputeLockReleaseTimer = 0;
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    exitAiPreviewMode().then();
    return;
  }
  aiComputeLockReleaseTimer = window.setTimeout(() => {
    aiComputeLockReleaseTimer = 0;
    if (aiPreviewState.active && aiPreviewState.mode === "compute_lock") {
      exitAiPreviewMode().then();
    }
  }, Math.max(0, Math.ceil(expiresAt - Date.now())));
}

async function enterAiPreviewMode(options = {}) {
  const nextMode = typeof options.mode === "string" ? options.mode : "preview";
  if (!aiPreviewState.active) {
    const previousPageUrl = location.href;
    aiPreviewState = {
      active: true,
      mode: nextMode,
      items: [],
      itemXpathSet: new Set(),
      focusedXpath: "",
      previousEnabled: Boolean(state.enabled),
      previousBaseUrl: state.baseUrl || "",
      previousPageUrl,
      previousDraftEntry: core.clonePageEntry(core.getDraftPageEntry(previousPageUrl)),
      previousSavedEntry: core.getSavedPageEntry(previousPageUrl),
      previousAutoSeededPendingSavePageUrl: state.autoSeededPendingSavePageUrl || ""
    };
  } else {
    aiPreviewState.mode = nextMode;
  }

  if (nextMode !== "compute_lock" && aiComputeLockReleaseTimer) {
    window.clearTimeout(aiComputeLockReleaseTimer);
    aiComputeLockReleaseTimer = 0;
  }

  if (aiPreviewState.previousEnabled && state.enabled) {
    core.disable();
  }

  await refreshSilentHighlightings();
}

async function exitAiPreviewMode() {
  if (!aiPreviewState.active) {
    return;
  }

  const restoreState = aiPreviewState;
  resetAiPreviewState();

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

function getSelectorSuppressedXpaths(baseConfig, pageUrl = location.href) {
  const pageMarkings = baseConfig && typeof baseConfig === "object"
    ? baseConfig.pageMarkings
    : null;
  const entry = core.findPageMarkingEntry({ pageMarkings }, pageUrl, state.baseUrl || "");
  return Array.isArray(entry && entry.selectorSuppressedXpaths)
    ? entry.selectorSuppressedXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
}

function getEffectiveAiSelectorSet(baseConfig) {
  const storedSelectors = getStoredAiSelectorSet(baseConfig);
  const suppressedXpaths = getSelectorSuppressedXpaths(baseConfig);
  if (!suppressedXpaths.length) {
    return storedSelectors;
  }
  return {
    ...storedSelectors,
    suppressedXpaths
  };
}

function resolveSuppressedSelectorBoundaries(suppressedXpaths) {
  const xpaths = Array.isArray(suppressedXpaths)
    ? suppressedXpaths.filter((xpath) => typeof xpath === "string" && xpath)
    : [];
  return {
    xpaths,
    elements: xpaths
      .map((xpath) => core.getElementFromXPath(xpath))
      .filter((element) => element && element.nodeType === 1)
  };
}

function isSuppressedSelectorNode(node, suppressedBoundaries) {
  if (!node || node.nodeType !== 1 || !suppressedBoundaries || !suppressedBoundaries.xpaths.length) {
    return false;
  }
  for (const element of suppressedBoundaries.elements) {
    if (element === node || element.contains(node)) {
      return true;
    }
  }
  const xpath = core.getXPath(node);
  if (!xpath) {
    return false;
  }
  return suppressedBoundaries.xpaths.some((suppressedXpath) =>
    suppressedXpath === xpath || core.isXPathDescendant(suppressedXpath, xpath)
  );
}

function getSuppressedSelectorFingerprint(suppressedXpaths) {
  if (!Array.isArray(suppressedXpaths)) {
    return "";
  }
  return suppressedXpaths
    .filter((xpath) => typeof xpath === "string" && xpath)
    .slice()
    .sort()
    .join(SELECTOR_LIST_DELIMITER);
}

function collectNodesFromSelectors(selectors, options = {}) {
  const suppressedBoundaries = resolveSuppressedSelectorBoundaries(options.suppressedXpaths);
  return collectCachedSelectorMatches({
    root: document,
    selectors,
    pageUrl: location.href,
    scope: "silent-highlight-selectors",
    suppressionFingerprint: [
      getSelectorFingerprint(selectors),
      getSuppressedSelectorFingerprint(options.suppressedXpaths)
    ].join(SELECTOR_CACHE_SCOPE_FINGERPRINT_SEPARATOR),
    includeSelectorByNode: true,
    shouldIncludeNode: (node) =>
      !isExtensionUiNode(node) &&
      !isSuppressedSelectorNode(node, suppressedBoundaries)
  });
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
  const suppressedXpaths = Array.isArray(selectorSet && selectorSet.suppressedXpaths)
    ? selectorSet.suppressedXpaths
    : [];
  const excludedMatches = collectNodesFromSelectors(normalized.exclusionSelectors, {
    suppressedXpaths
  });
  const includedMatches = collectNodesFromSelectors(normalized.inclusionSelectors, {
    suppressedXpaths
  });
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
    if (isAiSubmissionDocumentRootXpath(xpath)) {
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
    if (isAiSubmissionDocumentRootXpath(xpath)) {
      continue;
    }
    const explicitlyExcluded = explicitExcludedXpaths.has(xpath);
    const explicitlyIncluded = explicitIncludedXpaths.has(xpath);
    const insideExcludedAncestorRow = hasExcludedAncestorRow(xpath);
    const withinConsentBoundary = isWithinConsentBoundary(node);
    let visibleToUser = false;
    let hiddenToggleableRoot = false;
    let immutableExcludedRoot = false;
    let isMarkableTextual = false;
    if (!explicitlyExcluded) {
      visibleToUser = core.isVisibleForSubmission(node);
      immutableExcludedRoot = core.isImmutableExcludedElement(node);
      hiddenToggleableRoot = core.isDefaultToggleableExcludedElement(node) &&
        !visibleToUser;
      if (
        visibleToUser &&
        !explicitlyIncluded &&
        !insideExcludedAncestorRow &&
        !withinConsentBoundary &&
        !immutableExcludedRoot &&
        !hiddenToggleableRoot
      ) {
        isMarkableTextual = core.isMarkableElement(node, state.config, {
          allowParent: false,
          allowImmutableChildren: false
        });
      }
    }
    const submissionRow = resolveAiSubmissionRowState({
      explicitlyExcluded,
      explicitlyIncluded,
      insideExcludedAncestor: insideExcludedAncestorRow,
      visibleToUser,
      consentExcludedRoot: withinConsentBoundary &&
        node.hasAttribute(core.CONSENT_HIDDEN_ATTR),
      immutableExcludedRoot,
      hiddenToggleableRoot,
      markableTextual: isMarkableTextual
    });
    if (!submissionRow.shouldSubmit) {
      continue;
    }
    pushRow(xpath, submissionRow.excluded);
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
  const storedEntry = core.findPageMarkingEntry({ pageMarkings }, pageUrl, baseUrl);
  const storedConsentXpaths =
    storedEntry && Array.isArray(storedEntry.consentXpaths)
      ? storedEntry.consentXpaths
      : null;
  const newlyHiddenConsentCount = core.hideConsentElements(storedConsentXpaths);
  const hasHiddenConsent =
    newlyHiddenConsentCount > 0 ||
    Boolean(document.querySelector(`[${core.CONSENT_HIDDEN_ATTR}]`));
  const shouldObserve = hasSelectorHighlights || hasHiddenConsent;
  if (!shouldObserve) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  let contentNodes = [];
  let excludedNodes = [];
  let explicitIncludeSelectorByRenderNode = new Map();
  let excludedSelectorByRenderNode = new Map();
  if (hasSelectorHighlights) {
    try {
      const contentMarking = collectIncludedNodesFromSelectorSet(
        effectiveSelectorSet
      );
      const excludedSourcesForSilentOverlay = Array.isArray(contentMarking.excluded)
        ? contentMarking.excluded
        : [];
      contentNodes = toRenderableNodeList(contentMarking.included);
      const explicitIncludedSources = Array.isArray(contentMarking.explicitIncluded)
        ? contentMarking.explicitIncluded
        : [];
      const explicitIncludedRenderable = toRenderableNodeListWithSelectors(
        explicitIncludedSources,
        (node) => resolveSelectorForNode(node, contentMarking.inclusionSelectorByNode, false)
      );
      explicitIncludeSelectorByRenderNode = explicitIncludedRenderable.selectorByNode;
      const excludedRenderable = toRenderableNodeListWithSelectors(
        excludedSourcesForSilentOverlay,
        (node) => resolveSelectorForNode(node, contentMarking.exclusionSelectorByNode, true)
      );
      excludedNodes = excludedRenderable.nodes;
      excludedSelectorByRenderNode = excludedRenderable.selectorByNode;
    } catch {
      // Keep other silent highlighting features active even if selector processing fails.
      contentNodes = [];
      excludedNodes = [];
      explicitIncludeSelectorByRenderNode = new Map();
      excludedSelectorByRenderNode = new Map();
    }
  }
  const shouldBeActive = contentNodes.length > 0 || excludedNodes.length > 0;
  const renderKey = buildSilentHighlightingRenderKey(
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

/**
 * Check if marking interactions should be blocked due to property lock.
 */
function isMarkingBlockedByPropertyLock() {
  return propertyLockBannerVisible &&
    propertyLockBannerMode !== "no_banner" &&
    propertyLockState &&
    !propertyLockState.isEditor;
}

function showPropertyLockBlockedToast() {
  const now = Date.now();
  if (now - propertyLockLastBlockedToastAt < 1200) {
    return;
  }
  propertyLockLastBlockedToastAt = now;
  const editorName = propertyLockState?.editorName || "Someone";
  showPageToast(propertyLockText.lockedInteractionBlockedToast(editorName));
}

function checkPropertyLockBlocksMarking() {
  if (!isMarkingBlockedByPropertyLock()) {
    return true;
  }
  showPropertyLockBlockedToast();
  return false;
}

function handleBlockedPropertyLockInteraction(event) {
  if (!isMarkingBlockedByPropertyLock() || !event || !event.isTrusted) {
    return;
  }

  const target = event.target && event.target.nodeType === 1 ? event.target : null;
  if (target && typeof target.closest === "function" && target.closest('[data-uf-extension-ui="true"]')) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  showPropertyLockBlockedToast();
}

function resetPropertyLockUiState() {
  propertyLockState = null;
  propertyLockSuggestionId = "";
  propertyLockSuggestionFromName = "";
  propertyLockAutoTakeAttempted = false;
  propertyLockBannerCountdownValue = 0;
  updatePropertyLockBannerMode();
  renderPropertyLockBanner();
}

function clearPropertyLockReconnectTimer() {
  if (!propertyLockReconnectTimer) {
    return;
  }
  window.clearTimeout(propertyLockReconnectTimer);
  propertyLockReconnectTimer = 0;
}

function schedulePropertyLockReconnect(options = {}) {
  const forceSiteIdRefresh = Boolean(options.forceSiteIdRefresh);
  if (propertyLockReconnectTimer) {
    return;
  }
  propertyLockReconnectTimer = window.setTimeout(() => {
    propertyLockReconnectTimer = 0;
    syncPropertyLockConnection({ forceSiteIdRefresh }).then();
  }, PROPERTY_LOCK_RECONNECT_DELAY_MS);
}

function disconnectPropertyLockPort(options = {}) {
  const { notifyBackground = true } = options || {};
  clearPropertyLockReconnectTimer();
  const currentPort = propertyLockPort;
  const currentSiteId = propertyLockConnectedSiteId;
  propertyLockPort = null;
  propertyLockConnectedSiteId = null;

  if (currentPort) {
    if (notifyBackground && currentSiteId) {
      try {
        currentPort.postMessage({
          type: PROPERTY_LOCK_CONTENT_DISCONNECT,
          siteId: currentSiteId
        });
      } catch (error) {
        // Background may already have torn down the port.
      }
    }
    try {
      currentPort.disconnect();
    } catch (error) {
      // Port may already be disconnected.
    }
  }

  resetPropertyLockUiState();
}

async function syncPropertyLockConnection(options = {}) {
  const syncToken = ++propertyLockSyncToken;
  clearPropertyLockReconnectTimer();
  const pageUrl = typeof options.pageUrl === "string" && options.pageUrl
    ? options.pageUrl
    : location.href;
  const forceSiteIdRefresh = Boolean(options.forceSiteIdRefresh);
  const baseUrl = await resolveBaseUrlForCurrentPage();
  const target = baseUrl
    ? await resolveCurrentPropertyLockConnectionTarget(baseUrl, {
      pageUrl,
      forceSiteIdRefresh
    })
    : null;

  if (syncToken !== propertyLockSyncToken || pageUrl !== location.href) {
    return;
  }

  if (!target || !target.ok || !target.siteId) {
    disconnectPropertyLockPort();
    return;
  }

  const siteId = target.siteId;
  if (!(propertyLockPort && propertyLockConnectedSiteId === siteId)) {
    if (propertyLockPort) {
      disconnectPropertyLockPort();
    }

    if (propertyLockConnectedSiteId !== siteId) {
      propertyLockAutoTakeAttempted = false;
    }
    propertyLockConnectedSiteId = siteId;

    try {
      const nextPort = chrome.runtime.connect({ name: PROPERTY_LOCK_PORT_NAME });
      propertyLockPort = nextPort;
      nextPort.onMessage.addListener(handlePropertyLockPortMessage);
      nextPort.onDisconnect.addListener(() => {
        if (propertyLockPort !== nextPort) {
          return;
        }
        propertyLockPort = null;
        propertyLockConnectedSiteId = null;
        resetPropertyLockUiState();
        schedulePropertyLockReconnect();
      });
      nextPort.postMessage({
        type: PROPERTY_LOCK_CONTENT_CONNECT,
        siteId
      });
    } catch (error) {
      propertyLockPort = null;
      propertyLockConnectedSiteId = null;
      resetPropertyLockUiState();
      schedulePropertyLockReconnect({ forceSiteIdRefresh });
      return;
    }
  }

  const candidateState = await resolvePropertyLockCandidateState(target);
  if (syncToken !== propertyLockSyncToken || pageUrl !== location.href) {
    return;
  }
  if (candidateState.ok && !candidateState.candidate) {
    disconnectPropertyLockPort();
  }
}

function handlePropertyLockPortMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  const { type, message: serverMessage } = message;
  if (type !== PROPERTY_LOCK_BACKGROUND_STATE_UPDATE || !serverMessage || typeof serverMessage !== "object") {
    return;
  }

  applyPropertyLockServerMessage(serverMessage);
}

function sendPropertyLockActivity() {
  if (!propertyLockPort) {
    schedulePropertyLockReconnect();
    return;
  }
  try {
    propertyLockPort.postMessage({ type: PROPERTY_LOCK_CONTENT_ACTIVITY });
  } catch (error) {
    propertyLockPort = null;
    propertyLockConnectedSiteId = null;
    resetPropertyLockUiState();
    schedulePropertyLockReconnect();
  }
}

function sendPropertyLockMessage(type, payload = {}) {
  if (!propertyLockPort) {
    schedulePropertyLockReconnect();
    return;
  }
  try {
    propertyLockPort.postMessage({ type, ...payload });
  } catch (error) {
    propertyLockPort = null;
    propertyLockConnectedSiteId = null;
    resetPropertyLockUiState();
    schedulePropertyLockReconnect();
  }
}

function addSelectorSuppressedXpath(entry, xpath) {
  if (!entry || typeof entry !== "object") {
    return;
  }
  const currentXpaths = Array.isArray(entry.selectorSuppressedXpaths)
    ? entry.selectorSuppressedXpaths.filter((value) => typeof value === "string" && value)
    : [];
  if (!xpath) {
    entry.selectorSuppressedXpaths = currentXpaths;
    return;
  }
  if (currentXpaths.some((existingXpath) =>
    existingXpath === xpath || core.isXPathDescendant(existingXpath, xpath)
  )) {
    entry.selectorSuppressedXpaths = currentXpaths;
    return;
  }
  entry.selectorSuppressedXpaths = currentXpaths
    .filter((existingXpath) => !core.isXPathDescendant(xpath, existingXpath))
    .concat(xpath);
}

function clearSelectorSuppressedXpathsWithin(entry, xpath) {
  if (!entry || typeof entry !== "object") {
    return;
  }
  const currentXpaths = Array.isArray(entry.selectorSuppressedXpaths)
    ? entry.selectorSuppressedXpaths.filter((value) => typeof value === "string" && value)
    : [];
  if (!xpath) {
    entry.selectorSuppressedXpaths = currentXpaths;
    return;
  }
  entry.selectorSuppressedXpaths = currentXpaths.filter((existingXpath) =>
    existingXpath !== xpath && !core.isXPathDescendant(xpath, existingXpath)
  );
}

function applyPropertyLockServerMessage(serverMessage) {
  const type = typeof serverMessage.type === "string" ? serverMessage.type : "";
  const secondsRemaining = typeof serverMessage.secondsRemaining === "number"
    ? Math.max(0, Math.ceil(serverMessage.secondsRemaining))
    : null;

  if (type === PROPERTY_LOCK_WS_LOCK_STATE) {
    propertyLockState = serverMessage;
    propertyLockSuggestionId = "";
    propertyLockSuggestionFromName = "";
    if (
      serverMessage.state === PROPERTY_LOCK_STATE_UNLOCKED &&
      !serverMessage.isEditor &&
      !propertyLockAutoTakeAttempted
    ) {
      propertyLockAutoTakeAttempted = true;
      updatePropertyLockBannerMode();
      renderPropertyLockBanner();
      sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
      return;
    }
    updatePropertyLockBannerMode();
    renderPropertyLockBanner();
    return;
  }

  if (type === PROPERTY_LOCK_WS_DISCONNECT_WARNING) {
    propertyLockBannerMode = "editor_disconnect_countdown";
    propertyLockBannerCountdownValue = secondsRemaining || 0;
    restartPropertyLockBannerCountdown();
    renderPropertyLockBanner();
    return;
  }

  if (type === PROPERTY_LOCK_WS_INACTIVITY_WARNING) {
    propertyLockBannerMode = "editor_inactivity_warning";
    propertyLockBannerCountdownValue = secondsRemaining || 0;
    restartPropertyLockBannerCountdown();
    renderPropertyLockBanner();
    return;
  }

  if (type === PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION) {
    propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    propertyLockSuggestionFromName = String(serverMessage.fromName || "Someone");
    propertyLockBannerMode = propertyLockSuggestionId ? "editor_takeover_suggestion" : "no_banner";
    renderPropertyLockBanner();
    return;
  }

  if (type === PROPERTY_LOCK_WS_SUGGESTION_PENDING) {
    propertyLockSuggestionId = String(serverMessage.suggestionId || "");
    propertyLockBannerMode = "passive_suggestion_pending";
    renderPropertyLockBanner();
    return;
  }

  if (type === PROPERTY_LOCK_WS_SUGGESTION_RESPONSE) {
    if (serverMessage.accepted === false) {
      propertyLockBannerMode = "passive_suggestion_rejected";
      renderPropertyLockBanner();
    }
    return;
  }

  if (type === PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED || type === PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN) {
    propertyLockBannerMode = "editor_transfer_countdown";
    propertyLockBannerCountdownValue = secondsRemaining || propertyLockBannerCountdownValue || 10;
    restartPropertyLockBannerCountdown();
    renderPropertyLockBanner();
    return;
  }

  if (type === PROPERTY_LOCK_WS_ERROR) {
    showPageToast(String(serverMessage.reason || "Property lock request failed"));
  }
}

function updatePropertyLockBannerMode() {
  if (!propertyLockState) {
    propertyLockBannerMode = "no_banner";
    clearPropertyLockBannerCountdown();
    return;
  }

  const { state: lockState, isEditor, secondsRemaining } = propertyLockState;
  clearPropertyLockBannerCountdown();

  if (lockState === PROPERTY_LOCK_STATE_UNLOCKED) {
    propertyLockBannerMode = "no_banner";
    return;
  }

  if (lockState === PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE) {
    propertyLockBannerMode = "takeover_available";
    return;
  }

  if (lockState === PROPERTY_LOCK_STATE_TRANSFER) {
    propertyLockBannerMode = "editor_transfer_countdown";
    propertyLockBannerCountdownValue = secondsRemaining || 10;
    restartPropertyLockBannerCountdown();
    return;
  }

  if (isEditor && lockState === PROPERTY_LOCK_STATE_EXPIRY_WARNING) {
    propertyLockBannerMode = "editor_inactivity_warning";
    propertyLockBannerCountdownValue = secondsRemaining || 60;
    restartPropertyLockBannerCountdown();
    return;
  }

  if (!isEditor && lockState === PROPERTY_LOCK_STATE_EXPIRY_WARNING) {
    propertyLockBannerMode = "passive_expiry_countdown";
    propertyLockBannerCountdownValue = secondsRemaining || 60;
    restartPropertyLockBannerCountdown();
    return;
  }

  propertyLockBannerMode = isEditor || lockState !== PROPERTY_LOCK_STATE_LOCKED
    ? "no_banner"
    : "passive_locked";
}

function ensurePropertyLockBannerStyle() {
  if (document.getElementById(PROPERTY_LOCK_BANNER_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = PROPERTY_LOCK_BANNER_STYLE_ID;
  style.textContent = `
    #${PROPERTY_LOCK_BANNER_ID} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      padding: 12px 16px;
      background: #fff3cd;
      border-bottom: 1px solid #d39e00;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      color: #4d3900;
      z-index: 2147483645;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
    }
    #${PROPERTY_LOCK_BANNER_ID}.uf-lock-banner-hidden {
      display: none;
    }
    #${PROPERTY_LOCK_BANNER_ID} .uf-lock-banner-content {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      line-height: 1.35;
    }
    #${PROPERTY_LOCK_BANNER_ID} .uf-lock-banner-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    #${PROPERTY_LOCK_BANNER_ID} button {
      padding: 6px 12px;
      background: #f8b400;
      border: 1px solid #bf8500;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: #2f2200;
    }
    #${PROPERTY_LOCK_BANNER_ID} button:hover {
      background: #e6a700;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function createPropertyLockBannerButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderPropertyLockBanner() {
  const shouldShow = propertyLockBannerMode !== "no_banner";
  ensurePropertyLockBannerStyle();

  if (!propertyLockBannerElement) {
    propertyLockBannerElement = document.createElement("div");
    propertyLockBannerElement.id = PROPERTY_LOCK_BANNER_ID;
    propertyLockBannerElement.setAttribute("data-uf-extension-ui", "true");
    (document.body || document.documentElement).insertBefore(
      propertyLockBannerElement,
      (document.body || document.documentElement).firstChild
    );
  }

  if (!shouldShow) {
    propertyLockBannerElement.classList.add("uf-lock-banner-hidden");
    propertyLockBannerElement.replaceChildren();
    propertyLockBannerVisible = false;
    clearPropertyLockBannerCountdown();
    return;
  }

  propertyLockBannerElement.classList.remove("uf-lock-banner-hidden");
  propertyLockBannerVisible = true;
  propertyLockBannerElement.replaceChildren();

  const editorName = propertyLockState?.editorName || "Someone";
  const content = document.createElement("div");
  const actions = document.createElement("div");
  content.className = "uf-lock-banner-content";
  actions.className = "uf-lock-banner-actions";

  switch (propertyLockBannerMode) {
    case "passive_locked":
      content.textContent = propertyLockText.passiveLockedMessage(editorName);
      actions.appendChild(createPropertyLockBannerButton(propertyLockText.takeoverSuggestButton, "uf-lock-banner-suggest", () => {
        sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_SUGGEST);
      }));
      break;
    case "passive_expiry_countdown":
      content.textContent = propertyLockText.passiveExpiryCountdownMessage(editorName, propertyLockBannerCountdownValue);
      actions.appendChild(createPropertyLockBannerButton(propertyLockText.takeoverSuggestButton, "uf-lock-banner-suggest", () => {
        sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_SUGGEST);
      }));
      break;
    case "passive_suggestion_pending":
      content.textContent = propertyLockText.passiveSuggestionPendingMessage(editorName);
      break;
    case "passive_suggestion_rejected":
      content.textContent = propertyLockText.passiveSuggestionRejectedMessage(editorName);
      actions.appendChild(createPropertyLockBannerButton(propertyLockText.okButton, "uf-lock-banner-ok", () => {
        updatePropertyLockBannerMode();
        renderPropertyLockBanner();
      }));
      break;
    case "takeover_available": {
      content.textContent = propertyLockText.takeoverAvailableMessage;
      const label = propertyLockState?.isRecentEditor
        ? propertyLockText.startEditingAgainButton
        : propertyLockText.takeoverButton;
      actions.appendChild(createPropertyLockBannerButton(label, "uf-lock-banner-takeover", () => {
        sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
      }));
      break;
    }
    case "editor_disconnect_countdown":
      content.textContent = propertyLockText.editorDisconnectCountdownMessage(propertyLockBannerCountdownValue);
      break;
    case "editor_inactivity_warning":
      content.textContent = propertyLockText.editorInactivityWarningMessage(propertyLockBannerCountdownValue);
      actions.appendChild(createPropertyLockBannerButton(propertyLockText.continueEditingButton, "uf-lock-banner-continue-editing", () => {
        sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_CONTINUE);
      }));
      break;
    case "editor_takeover_suggestion":
      content.textContent = propertyLockText.takeoverSuggestionMessage(propertyLockSuggestionFromName || "Someone");
      actions.appendChild(createPropertyLockBannerButton(propertyLockText.acceptButton, "uf-lock-banner-accept", () => {
        sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_RESPOND, {
          suggestionId: propertyLockSuggestionId,
          accept: true
        });
      }));
      actions.appendChild(createPropertyLockBannerButton(propertyLockText.rejectButton, "uf-lock-banner-reject", () => {
        sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_RESPOND, {
          suggestionId: propertyLockSuggestionId,
          accept: false
        });
        updatePropertyLockBannerMode();
        renderPropertyLockBanner();
      }));
      break;
    case "editor_transfer_countdown":
      content.textContent = propertyLockText.editorTransferCountdownMessage(propertyLockBannerCountdownValue);
      break;
  }

  propertyLockBannerElement.append(content, actions);
}

function clearPropertyLockBannerCountdown() {
  if (propertyLockBannerCountdownTimer) {
    clearInterval(propertyLockBannerCountdownTimer);
    propertyLockBannerCountdownTimer = 0;
  }
}

function restartPropertyLockBannerCountdown() {
  clearPropertyLockBannerCountdown();
  if (propertyLockBannerCountdownValue <= 0) {
    return;
  }
  propertyLockBannerCountdownTimer = setInterval(() => {
    propertyLockBannerCountdownValue = Math.max(0, propertyLockBannerCountdownValue - 1);
    renderPropertyLockBanner();
    if (propertyLockBannerCountdownValue <= 0) {
      clearPropertyLockBannerCountdown();
    }
  }, 1000);
}


export function main() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;

  installExtensionTelemetry({
    source: "content",
    getIncludePayloads: () => remoteSupportIncludePayloads
  });
  ensurePageTelemetryBridge();

  initializeRemoteSupportSupportPage();
  syncRemoteSupportSessionStateFromBackground().then();

  core.refreshFromTabState().then(async () => {
    // Check if URL path changed (e.g., language change on same domain)
    // and if so, re-verify the site ID is still correct
    if (state.enabled && state.baseUrl) {
      const urlInfo = extractUrlPathAndHostname(location.href);
      if (lastTrackedUrlHostname && isSignificantUrlPathChange(location.href, lastTrackedUrlPath, lastTrackedUrlHostname)) {
        const siteIdCheckResult = await recheckSiteIdForCurrentUrlPath({
          baseUrl: state.baseUrl
        });
        if (siteIdCheckResult && siteIdCheckResult.newSiteId) {
          // Site ID changed or was missing, update config
          const normBaseUrl = utils.normalizeCanonicalBaseUrl(siteIdCheckResult.currentUrl) ||
                              utils.normalizeBaseUrl(siteIdCheckResult.currentUrl) ||
                              state.baseUrl;
          const configs = await config.getConfigs();
          configs[normBaseUrl] = configs[normBaseUrl] || {};
          await config.updateConfig(normBaseUrl, (targetConfig) => {
            targetConfig.siteId = siteIdCheckResult.newSiteId;
          });
          state.baseUrl = normBaseUrl;
        }
      }
      lastTrackedUrlPath = urlInfo.path;
      lastTrackedUrlHostname = urlInfo.hostname;
    }
    
    syncPropertyLockConnection({
      forceSiteIdRefresh: !state.enabled || !state.baseUrl
    }).then();
    refreshEnabledAiHighlights();
    refreshSilentHighlightings().then();
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
    if (key === "s" && !checkPropertyLockBlocksMarking()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (key === "e") {
      isEnableHotkeyAllowedOnPage().then((result) => {
        if (!result.allowed) {
          return;
        }
        toggleEnabledFromPage({ gate: result, showDisabledToast: false }).then();
      });
      return;
    }
    if (key === "m") {
      if (deviceEmulationHotkeyBusy) {
        return;
      }
      toggleDeviceEmulationFromPage().then();
      return;
    }
    isPageSaveHotkeyAllowedOnPage().then((allowed) => {
      if (!allowed) {
        return;
      }
      saveCurrentPageDraft({ showToast: true }).then((result) => {
        if (result && result.ok) {
          sendPropertyLockActivity();
        }
      });
    });
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
  document.addEventListener("mousedown", handleBlockedPropertyLockInteraction, true);
  document.addEventListener("mouseup", handleBlockedPropertyLockInteraction, true);
  document.addEventListener("click", handleBlockedPropertyLockInteraction, true);
  document.addEventListener("wheel", handleBlockedPropertyLockInteraction, true);
  document.addEventListener("keydown", handleBlockedPropertyLockInteraction, true);
  document.addEventListener("keyup", handleBlockedPropertyLockInteraction, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (isRemoteSupportSupportPage() && message.type === "remoteSupportViewerTransportStart") {
      sendRemoteSupportSupportPageViewerRequest("remoteSupportTransportStart", {
        session: message.session && typeof message.session === "object" ? message.session : null
      }).then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      });
      return true;
    }

    if (isRemoteSupportSupportPage() && message.type === "remoteSupportViewerTransportStop") {
      sendRemoteSupportSupportPageViewerRequest("remoteSupportTransportStop", {
        sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
        reason: typeof message.reason === "string" ? message.reason : "Session ended",
        notifyPeer: Boolean(message.notifyPeer)
      }).then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      });
      return true;
    }

    if (isRemoteSupportSupportPage() && message.type === "remoteSupportViewerTransportSendData") {
      sendRemoteSupportSupportPageViewerRequest("remoteSupportTransportSendData", {
        sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
        messageType: typeof message.messageType === "string" ? message.messageType : "",
        payload: message.payload,
        channelKey: typeof message.channelKey === "string" ? message.channelKey : ""
      }).then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      });
      return true;
    }

    if (isRemoteSupportSupportPage() && message.type === "remoteSupportStateChanged") {
      if (
        Number.isFinite(remoteSupportSupportPageTabId) &&
        Number.isFinite(message.tabId) &&
        Math.trunc(message.tabId) !== remoteSupportSupportPageTabId
      ) {
        return;
      }

      applyRemoteSupportSupportPageState(message.state || null);
      sendResponse({ ok: true });
      return;
    }

    if (isRemoteSupportSupportPage() && message.type === "remoteSupportFrame") {
      if (
        Number.isFinite(remoteSupportSupportPageTabId) &&
        Number.isFinite(message.tabId) &&
        Math.trunc(message.tabId) !== remoteSupportSupportPageTabId
      ) {
        return;
      }

      remoteSupportSupportPageLastFrame = typeof message.frame === "string"
        ? message.frame
        : (message.frame && typeof message.frame.dataUrl === "string" ? message.frame.dataUrl : "");
      scheduleRemoteSupportSupportPageFrameRender();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "setEnabled") {
      if (message.enabled) {
        state.currentPageType = typeof message.pageType === "string" ? message.pageType : state.currentPageType || "";
        stopSilentHighlightingObserver();
        clearSilentHighlightingMarks();
        setSilentHighlightingsActive(false);
        core.enableForBaseUrl(message.baseUrl)
          .then(() => {
            refreshEnabledAiHighlights();
            sendResponse({ ok: true });
          })
          .catch(() => {
            sendResponse({ ok: false });
          });
        return true;
      }
      state.currentPageType = "";
      clearAiPreviewState();
      core.disable();
      refreshSilentHighlightings().then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "hideConsentForInspection") {
      const hiddenCount = core.hideConsentElements();
      sendResponse({ ok: true, hiddenCount });
      return;
    }

    if (message.type === "remoteSupportState" || message.type === "remoteSupportModeChanged") {
      const remoteSupportState =
        message.type === "remoteSupportState" && message.state && typeof message.state === "object"
          ? message.state
          : message;
      applyRemoteSupportSessionState(remoteSupportState || null);
      sendResponse({
        ok: true,
        mode: remoteSupportMode,
        role: remoteSupportRole
      });
      return;
    }

    if (message.type === "getAiPreviewState") {
      sendResponse({
        ok: true,
        active: aiPreviewState.active,
        mode: aiPreviewState.mode || "",
        items: aiPreviewState.items.map((item) => ({
          xpath: item.xpath,
          text: item.text
        })),
        focusedXpath: aiPreviewState.focusedXpath
      });
      return;
    }

    if (message.type === "setAiComputeLock") {
      (async () => {
        if (message.active) {
          await enterAiPreviewMode({ mode: "compute_lock" });
          setAiPreviewItems([]);
          scheduleAiComputeLockRelease(Number(message.expiresAt) || 0);
          sendResponse({ ok: true, active: true });
          return;
        }
        if (aiPreviewState.active && aiPreviewState.mode === "compute_lock") {
          await exitAiPreviewMode();
        } else if (aiComputeLockReleaseTimer) {
          window.clearTimeout(aiComputeLockReleaseTimer);
          aiComputeLockReleaseTimer = 0;
        }
        sendResponse({ ok: true, active: false });
      })().catch(() => {
        sendResponse({ ok: false });
      });
      return true;
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
      syncPropertyLockConnection({ forceSiteIdRefresh: true }).then();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "forceRefresh") {
      core.refreshFromTabState().then(() => {
        refreshEnabledAiHighlights();
        syncPropertyLockConnection({ forceSiteIdRefresh: true }).then();
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
      if (shouldPersist && !checkPropertyLockBlocksMarking()) {
        sendResponse({ ok: false, locked: true });
        return;
      }
      if (shouldPersist && core.isPageSaveReconciliationPending(location.href)) {
        sendResponse({ ok: false, reconciliationPending: true });
        return;
      }

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
        entry.pageType =
          (typeof message.pageType === "string" && message.pageType) ||
          state.currentPageType ||
          entry.pageType;
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
        if (shouldPersist) {
          sendPropertyLockActivity();
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
      const reconciliation = core.getPageSaveReconciliationState(pageUrl);
      const submissionXpathsStale = Boolean(
        hasEntry &&
        entry &&
        !submissionXpathsEqual(
          entry.submissionXpaths,
          collectAiSubmissionXpathsForCurrentPage()
        )
      );
      sendResponse({
        ok: true,
        entry: entry ? core.clonePageEntry(entry) : null,
        savedEntry,
        dirty: core.isPageDraftDirty(pageUrl) || submissionXpathsStale,
        reconciliation,
        reconciliationPending: Boolean(reconciliation)
      });
      return;
    }

    if (message.type === "setPageSaveReconciliationPending") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const pageUrl = typeof message.pageUrl === "string" && message.pageUrl
        ? message.pageUrl
        : location.href;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || pageUrl !== location.href) {
        sendResponse({ ok: false });
        return;
      }
      core.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, {
        reason: typeof message.reason === "string" ? message.reason : "pending"
      }).then((reconciliation) => {
        sendResponse({ ok: true, reconciliation });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    if (message.type === "clearPageSaveReconciliation") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      const pageUrl = typeof message.pageUrl === "string" && message.pageUrl
        ? message.pageUrl
        : location.href;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || pageUrl !== location.href) {
        sendResponse({ ok: false });
        return;
      }
      (async () => {
        const currentPageUrl = location.href;
        const previousSavedEntry = core.getSavedPageEntry(currentPageUrl);
        const previousDraftEntry = core.getDraftPageEntry(currentPageUrl);
        await core.clearPageSaveReconciliation(targetBaseUrl, pageUrl);
        await core.refreshPageSaveReconciliation(targetBaseUrl, currentPageUrl);
        const refreshedConfig = await core.loadConfig(targetBaseUrl);
        let storedEntry =
          refreshedConfig.pageMarkings && refreshedConfig.pageMarkings[currentPageUrl]
            ? refreshedConfig.pageMarkings[currentPageUrl]
            : null;
        if (!storedEntry && (previousSavedEntry || previousDraftEntry)) {
          // Keep the confirmed local snapshot as the current saved baseline when
          // the immediate post-save remote reload omits this page entry.
          const fallbackEntry = previousSavedEntry || previousDraftEntry;
          if (!refreshedConfig.pageMarkings || typeof refreshedConfig.pageMarkings !== "object") {
            refreshedConfig.pageMarkings = {};
          }
          refreshedConfig.pageMarkings[currentPageUrl] = core.clonePageEntry(fallbackEntry);
          storedEntry = refreshedConfig.pageMarkings[currentPageUrl];
          await core.saveConfig(targetBaseUrl, refreshedConfig);
        }
        state.config = refreshedConfig;
        core.setSavedPageEntry(currentPageUrl, storedEntry || previousSavedEntry || previousDraftEntry || null);
        core.scheduleRender();
        core.notifyDraftStatus(currentPageUrl);
        sendResponse({ ok: true, entry: storedEntry ? core.clonePageEntry(storedEntry) : null });
      })().catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    if (message.type === "setExplicitExclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      if (!checkPropertyLockBlocksMarking()) {
        sendResponse({ ok: false, locked: true });
        return;
      }
      if (core.isPageSaveReconciliationPending(location.href)) {
        sendResponse({ ok: false, reconciliationPending: true });
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
        if (excluded) {
          clearSelectorSuppressedXpathsWithin(entry, xpath);
        } else {
          addSelectorSuppressedXpath(entry, xpath);
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
      sendPropertyLockActivity();
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "setExplicitInclude") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      if (!checkPropertyLockBlocksMarking()) {
        sendResponse({ ok: false, locked: true });
        return;
      }
      if (core.isPageSaveReconciliationPending(location.href)) {
        sendResponse({ ok: false, reconciliationPending: true });
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
      if (included) {
        clearSelectorSuppressedXpathsWithin(entry, xpath);
      } else {
        addSelectorSuppressedXpath(entry, xpath);
      }
      entry.includeXpaths = includeXpaths;
      core.touchPageEntryTimestamp(entry);
      core.normalizePageEntryXpaths(entry);
      state.config.pageMarkings[location.href] = entry;
      core.scheduleRender();
      core.scheduleSnapshotSave();
      core.notifyDraftStatus(location.href);
      core.scheduleDraftPersist(targetBaseUrl);
      sendPropertyLockActivity();
      sendResponse({ ok: true, dirty: core.isPageDraftDirty(location.href) });
      return;
    }

    if (message.type === "savePageDraft") {
      const targetBaseUrl = message.baseUrl || state.baseUrl;
      if (!targetBaseUrl || !matchesActiveBaseUrl(targetBaseUrl) || !state.config) {
        sendResponse({ ok: false });
        return;
      }
      if (!checkPropertyLockBlocksMarking()) {
        sendResponse({ ok: false, locked: true });
        return;
      }
      saveCurrentPageDraft({
        baseUrl: targetBaseUrl,
        pageType: typeof message.pageType === "string" ? message.pageType : ""
      }).then((result) => {
        if (result && result.ok) {
          sendPropertyLockActivity();
        }
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
      if (!checkPropertyLockBlocksMarking()) {
        sendResponse({ ok: false, locked: true });
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
        await enterAiPreviewMode({ mode: "preview" });
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
    syncPropertyLockConnection({ forceSiteIdRefresh: true }).then();
    refreshSilentHighlightings().then();
  });

  refreshSilentHighlightings().then();
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
      core.handleScroll(event, { hideDuringScroll: !isBeingSupportedMode() });
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
