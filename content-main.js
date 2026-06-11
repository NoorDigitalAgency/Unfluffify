import * as core from "./content/core.js";
import * as config from "./common/config.js";
import {
  FEATURE_DISABLED_REASON,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "./common/feature-flags.js";
import * as utils from "./common/utilities.js";
import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS,
  EXTENSION_UI_FONT_STACK
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
  getCurrentPageCandidateState,
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
  shouldRetainIncludedSource,
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
  PROPERTY_LOCK_CONTENT_DRAFT_STATUS,
  PROPERTY_LOCK_CONTENT_TAKE_LOCK,
  PROPERTY_LOCK_CONTENT_RELEASE,
  PROPERTY_LOCK_CONTENT_SUGGEST,
  PROPERTY_LOCK_CONTENT_RESPOND,
  PROPERTY_LOCK_CONTENT_CONTINUE,
  PROPERTY_LOCK_BACKGROUND_GET_STATE,
  PROPERTY_LOCK_BACKGROUND_STATE_UPDATE,
  PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
  PROPERTY_LOCK_CONNECTION_CONNECTED,
  PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
  PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
  PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
  PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
  PROPERTY_LOCK_WS_LOCK_STATE,
  PROPERTY_LOCK_WS_DISCONNECT_WARNING,
  PROPERTY_LOCK_WS_INACTIVITY_WARNING,
  PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
  PROPERTY_LOCK_WS_SUGGESTION_PENDING,
  PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
  PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
  PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN,
  PROPERTY_LOCK_WS_ERROR,
  normalizePropertyLockClientId,
  createPropertyLockClientId
} from "./common/property-lock.js";
import { propertyLockText } from "./common/text.js";
import {
  CONTENT_MODES,
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  WORLD_MESSAGE_TYPES
} from "./common/world-messaging-contract.js";
import {
  dispatchContentCommand,
  registerContentCommand
} from "./content/content-command-router.js";
import { createAiPreviewCloseHandler } from "./content/ai-preview-close-handler.js";
import { createAiPreviewComputeLockHandler } from "./content/ai-preview-compute-lock-handler.js";
import { createAiPreviewExpandedModeHandler } from "./content/ai-preview-expanded-mode-handler.js";
import { createAiPreviewStateResponseBuilder } from "./content/ai-preview-state-response.js";
import { createInspectionStatusResolver } from "./content/inspection-status.js";
import { initializePageWorldRelay } from "./content/page-world-relay.js";
import { createPageToast } from "./content/page-toast.js";
import { createRenderModeInspectionClient } from "./content/render-mode-inspection-client.js";
import { createRenderModeInspectionHandlers } from "./content/render-mode-inspection-handlers.js";
import {
  clearPropertyLockBannerCountdown as clearPropertyLockBannerCountdownOperation,
  ensurePropertyLockBannerStyle as ensurePropertyLockBannerStyleOperation,
  renderPropertyLockBanner as renderPropertyLockBannerOperation,
  restartPropertyLockBannerCountdown as restartPropertyLockBannerCountdownOperation
} from "./content/property-lock-banner.js";
import { updatePropertyLockBannerMode as updatePropertyLockBannerModeOperation } from "./content/property-lock-banner-mode.js";
import { createPropertyLockPortClient } from "./content/property-lock-port-client.js";
import { createPropertyLockStateMachine } from "./content/property-lock-state-machine.js";
import { createRemoteSupportClient } from "./content/remote-support-client.js";
import { createRemoteSupportStateHandler } from "./content/remote-support-state-handler.js";
import { createRemoteSupportViewerClient } from "./content/remote-support-viewer-client.js";
import { createRemoteSupportSupportPage } from "./content/remote-support-support-page.js";
import {
  ensurePageTelemetryBridge as ensurePageTelemetryBridgeOperation,
  handlePageTelemetryWindowMessage as handlePageTelemetryWindowMessageOperation,
  syncPageTelemetryControl as syncPageTelemetryControlOperation
} from "./content/page-telemetry-bridge.js";
import {
  MESSAGE_ERROR_CODES,
  MESSAGE_TARGETS,
  createFailureEnvelope,
  isRequestEnvelope
} from "./common/message-protocol.js";
import { getGlobalAiSettings } from "./common/settings-store.js";

const { state } = core;

const SILENT_CONTENT_HIGHLIGHTING_ATTR = "data-uf-silent-content-highlighting";
const SILENT_CONTENT_EXCLUDED_ATTR = "data-uf-silent-content-excluded";
const SILENT_HIGHLIGHTINGS_ACTIVE_ATTR = "data-uf-silent-highlightings";
const SILENT_CONTENT_POSITION_ATTR = "data-uf-silent-content-position";
const SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR = "data-uf-silent-selector-include";
const SILENT_SELECTOR_EXCLUDE_ATTR = "data-uf-silent-selector-exclude";
const SILENT_TITLE_COPY_ATTR = "data-uf-silent-title-copy";
const AI_PREVIEW_CLICKABLE_ATTR = "data-uf-ai-preview-clickable";
const SILENT_SELECTOR_TITLE_PREFIX = "Unfluffify selector: ";
const PAGE_SAVE_MOBILE_SIMULATION_REQUIRED_MESSAGE =
  "Mobile simulation must be enabled to save markings.";
const PAGE_TOAST_ID = "unfluffify-page-toast";
const PAGE_TOAST_STYLE_ID = "unfluffify-page-toast-style";
const PROPERTY_LOCK_CLIENT_SESSION_KEY = "unfluffify:propertyLockClientId";
const URL_CHANGED_EVENT = "unfluffify:url-changed";
const SILENT_HIGHLIGHT_OVERLAY_ID = "unfluffify-silent-highlight-overlay";
const SILENT_HIGHLIGHT_STYLE_ID = "unfluffify-silent-highlightings-style";
const SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON = "silent-highlighting";
const SILENT_HIGHLIGHTING_PREPARATION_REASON = "editor_preparing";
const RENDER_MODE_INSPECTION_SESSION_KEY = "unfluffify:render-mode-inspection-active";
// Self-healing bound for render-mode inspection. The flag is persisted in
// sessionStorage so it survives the deliberate inspection reload, but if the
// driving popup never delivers `renderModeInspectionEnd` (popup closed, message
// port dropped after the reload), the flag would otherwise stick forever and
// permanently gate editor reveal while holding the page frozen. The window must
// exceed the popup begin->reveal gap (load timeout 8s + content-ready retries).
const RENDER_MODE_INSPECTION_WATCHDOG_MS = 30000;
const SILENT_HIGHLIGHT_LAYER_KEYS = ["immutable", "content", "excluded"];
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
  "open",
  // Inline style mutations are typically transform/visibility updates from
  // animations or layout-driven JS. They affect rects, not selector matches,
  // so the reposition path is sufficient and avoids a full-refresh stampede
  // on animation-heavy pages.
  "style"
]);
// Record Separator keeps the composite suppression fingerprint separate from
// the selector fingerprint's Unit Separator without colliding with selector text.
const SELECTOR_CACHE_SCOPE_FINGERPRINT_SEPARATOR = "\u001e";

let silentHighlightingUrlTimer = 0;

const PROPERTY_LOCK_BANNER_ID = "unfluffify-lock-banner";
const PROPERTY_LOCK_BANNER_STYLE_ID = "unfluffify-lock-banner-style";
const PROPERTY_LOCK_RECONNECT_DELAY_MS = 150;

let propertyLockState = null;
let propertyLockBannerMode = "no_banner";
let propertyLockBannerCountdownTimer = 0;
let propertyLockBannerCountdownValue = 0;
let propertyLockOffCandidateDeadlineAt = 0;
let propertyLockRecoverySiteId = null;
let propertyLockRecoveryBaseUrl = "";
let propertyLockRecoveryClientId = "";
let propertyLockRecoveryDeadlineAt = 0;
let propertyLockRecoveryReleaseTimer = 0;
let propertyLockBannerElement = null;
let propertyLockBannerVisible = false;
let propertyLockSuggestionId = "";
let propertyLockSuggestionFromName = "";
let propertyLockLastBlockedToastAt = 0;
let propertyLockConnectedSiteId = null;
let propertyLockConnectedBaseUrl = "";
// Debounce timer for page-level activity pings (mouse/keyboard/scroll).
// General page interactions reset the 30-min inactivity window per spec.
let propertyLockPageActivityTimer = 0;
let propertyLockEditorClaimPending = false;
let propertyLockSyncToken = 0;
let propertyLockSyncInFlight = false;
let propertyLockQueuedSyncOptions = null;
let propertyLockClientId = "";
let extensionContextInvalidated = false;
let silentHighlightingObserver = null;
let silentHighlightingLayoutShiftObserver = null;
let silentHighlightingRefreshTimer = 0;
let silentHighlightingRefreshDueAt = 0;
let silentHighlightingRefreshGeneration = 0;
let lastSilentHighlightingRefreshAt = 0;
let lastSilentHighlightingRenderKey = "";
let lastSilentHighlightingsActive = false;
let silentHighlightingPositionRefreshPending = false;
let silentHighlightOverlay = null;
let silentHighlightLayers = {};
let silentHighlightLayerBoxes = {};
let silentHighlightCollections = null;
let silentHighlightRenderTargetCache = new Map();
let silentHighlightTrackedNodeIndex = null;
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
let silentHighlightEditorRevealInFlight = 0;
let silentHighlightEditorRevealKey = "";
let silentHighlightEditorActivationPromise = null;
let silentHighlightEditorActivationQueued = false;
let silentHighlightEditorActivationIdCounter = 0;
let renderModeInspectionActive = false;
let renderModeInspectionWatchdogTimer = 0;
let lifecycleOperationCounter = 0;
let silentSelectorAnnotatedNodes = new Set();
let aiPreviewClickableNodes = new Set();

function isWorldTraceEnabled() {
  return isDebugFlagEnabled("worldTraceEnabled");
}

function isFullWorldMessagingLoggingEnabled() {
  return isDebugFlagEnabled("fullWorldMessagingLogging");
}

function isPropertyLockCollaborationEnabled() {
  return isFeatureEnabled("propertyLockCollaboration");
}

function resetDisabledPropertyLockRuntimeState() {
  clearPropertyLockReconnectTimer();
  clearPropertyLockBannerCountdown();
  clearPropertyLockRecoveryReleaseTimer();
  if (propertyLockPageActivityTimer) {
    window.clearTimeout(propertyLockPageActivityTimer);
    propertyLockPageActivityTimer = 0;
  }
  if (propertyLockPortClient) {
    propertyLockPortClient.disconnect({ notifyBackground: false });
  }
  propertyLockConnectedSiteId = null;
  propertyLockConnectedBaseUrl = "";
  propertyLockEditorClaimPending = false;
  propertyLockSyncToken += 1;
  propertyLockSyncInFlight = false;
  propertyLockQueuedSyncOptions = null;
  propertyLockState = null;
  propertyLockSuggestionId = "";
  propertyLockSuggestionFromName = "";
  propertyLockOffCandidateDeadlineAt = 0;
  propertyLockRecoverySiteId = null;
  propertyLockRecoveryBaseUrl = "";
  propertyLockRecoveryClientId = "";
  propertyLockRecoveryDeadlineAt = 0;
  propertyLockBannerMode = "no_banner";
  propertyLockBannerCountdownValue = 0;
  propertyLockBannerVisible = false;
  propertyLockLastBlockedToastAt = 0;
  if (propertyLockBannerElement) {
    propertyLockBannerElement.classList.add("uf-lock-banner-hidden");
    propertyLockBannerElement.replaceChildren();
  }
  setSilentHighlightingPageMotionPaused(false);
}

function ensurePropertyLockCollaborationActive() {
  if (isPropertyLockCollaborationEnabled()) {
    return true;
  }
  const hasPort = propertyLockPortClient ? propertyLockPortClient.hasPort() : false;
  const hasReconnectTimer = propertyLockPortClient ? propertyLockPortClient.hasReconnectTimer() : false;
  if (
    hasPort ||
    propertyLockState ||
    propertyLockBannerMode !== "no_banner" ||
    propertyLockOffCandidateDeadlineAt ||
    propertyLockRecoveryDeadlineAt ||
    hasReconnectTimer ||
    propertyLockPageActivityTimer ||
    propertyLockRecoveryReleaseTimer ||
    propertyLockSyncInFlight ||
    propertyLockQueuedSyncOptions
  ) {
    resetDisabledPropertyLockRuntimeState();
  }
  return false;
}
let aiComputeLockReleaseTimer = 0;
let deviceEmulationHotkeyBusy = false;
const silentSelectorOriginalTitles = new WeakMap();
const aiPreviewOriginalTitles = new WeakMap();
const AI_PREVIEW_KIND_EXCLUDED = "excluded";
const AI_PREVIEW_KIND_EXPLICIT_INCLUDED = "explicit_included";
const AI_PREVIEW_KIND_IMPLICIT_INCLUDED = "implicit_included";
const AI_PREVIEW_KIND_UNDETECTED = "undetected";
const AI_PREVIEW_KINDS = new Set([
  AI_PREVIEW_KIND_EXCLUDED,
  AI_PREVIEW_KIND_EXPLICIT_INCLUDED,
  AI_PREVIEW_KIND_IMPLICIT_INCLUDED,
  AI_PREVIEW_KIND_UNDETECTED
]);

function createAiPreviewState() {
  return {
    active: false,
    mode: "",
    items: [],
    defaultItems: [],
    expandedItems: [],
    showAllCategories: false,
    itemXpathSet: new Set(),
    focusedXpath: "",
    previousEnabled: false,
    restoreMarkingOnExit: false,
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
const PAGE_TELEMETRY_NONCE_BYTES = 16;

let remoteSupportClient = null;
let remoteSupportViewerClient = null;
let remoteSupportSupportPage = null;
let pageToastClient = null;
let renderModeInspectionClient = null;
let renderModeInspectionHandlers = null;
let inspectionStatusResolver = null;
let aiPreviewCloseHandler = null;
let aiPreviewComputeLockHandler = null;
let aiPreviewExpandedModeHandler = null;
let aiPreviewStateResponseBuilder = null;
let propertyLockPortClient = null;
let propertyLockStateMachine = null;
let remoteSupportStateHandler = null;
let pageTelemetryBridgeListenerBound = false;
let pageTelemetryBridgeNonce = "";
// Private MessageChannel port for the page-world telemetry stream. When
// available, steady-state telemetry travels over this port instead of being
// broadcast on window.postMessage, so other page scripts cannot passively
// observe (or, without racing the one-time port handshake, forge) the stream.
let pageTelemetryBridgePort = null;

function getRemoteSupportViewerClient() {
  if (!remoteSupportViewerClient) {
    remoteSupportViewerClient = createRemoteSupportViewerClient({
      getViewerOrigin: () => {
        try {
          return new URL(chrome.runtime.getURL(REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH)).origin;
        } catch (error) {
          return "*";
        }
      },
      getViewerFrame: () => {
        const supportPage = getRemoteSupportSupportPage();
        return supportPage.getViewerElement();
      },
      getViewerElement: () => {
        const supportPage = getRemoteSupportSupportPage();
        return supportPage.getViewerElement();
      },
      isSupportPageActive: () => getRemoteSupportSupportPage().isActive(),
      onFrameMessage: (framePayload) => {
        getRemoteSupportSupportPage().handleFramePayload(framePayload);
      },
      renderFrame: () => {
        getRemoteSupportSupportPage().render();
      },
      sendRuntimeMessageSafely,
      updateStateFromBackground: () => getRemoteSupportSupportPage().refreshState(),
      REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH,
      REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_REQUEST_TIMEOUT_MS
    });
  }

  return remoteSupportViewerClient;
}

function getRemoteSupportSupportPage() {
  if (!remoteSupportSupportPage) {
    remoteSupportSupportPage = createRemoteSupportSupportPage({
      isRemoteSupportFeatureEnabled: () => isFeatureEnabled("remoteSupport"),
      getViewerClient: () => getRemoteSupportViewerClient(),
      sendRuntimeMessageSafely,
      formatRemoteSupportCountdown,
      normalizeRemoteSupportDockState,
      REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
      REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE,
      EXTENSION_UI_FONT_STACK,
      REMOTE_SUPPORT_SUPPORT_PAGE_META_SELECTOR,
      REMOTE_SUPPORT_SUPPORT_PAGE_APP_ID,
      REMOTE_SUPPORT_SUPPORT_PAGE_ROOT_ID,
      REMOTE_SUPPORT_SUPPORT_PAGE_STYLE_ID,
      REMOTE_SUPPORT_SUPPORT_PAGE_FALLBACK_ID,
      REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_FRAME_ID
    });
  }

  return remoteSupportSupportPage;
}

function sendRuntimeMessageSafely(message) {
  if (
    extensionContextInvalidated ||
    !message ||
    typeof message !== "object" ||
    !globalThis.chrome ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== "function"
  ) {
    return Promise.resolve(null);
  }

  return Promise.resolve()
    .then(() => {
      if (isWorldTraceEnabled() || isFullWorldMessagingLoggingEnabled()) {
        try {
          console.debug("[world-trace][content] runtime:send", {
            type: message && message.type ? message.type : ""
          });
        } catch {
          // Ignore trace logging failures.
        }
      }
    })
    .then(() => utils.sendRuntimeMessage(message))
    .then((response) => {
      if (isWorldTraceEnabled() || isFullWorldMessagingLoggingEnabled()) {
        try {
          console.debug("[world-trace][content] runtime:response", {
            type: message && message.type ? message.type : "",
            ok: Boolean(response && response.ok)
          });
        } catch {
          // Ignore trace logging failures.
        }
      }
      if (response && response.contextInvalidated) {
        markExtensionContextInvalidated(
          response.error || "Extension context invalidated."
        );
        return null;
      }
      return response;
    })
    .catch((error) => {
      if (markExtensionContextInvalidated(error)) {
        return null;
      }
      return null;
    });
}

function getPageToastClient() {
  if (!pageToastClient) {
    pageToastClient = createPageToast(createPageToastDeps());
  }
  return pageToastClient;
}

function getRenderModeInspectionClient() {
  if (!renderModeInspectionClient) {
    renderModeInspectionClient = createRenderModeInspectionClient(createRenderModeInspectionClientDeps());
  }
  return renderModeInspectionClient;
}

function getRenderModeInspectionHandlers() {
  if (!renderModeInspectionHandlers) {
    renderModeInspectionHandlers = createRenderModeInspectionHandlers(createRenderModeInspectionHandlersDeps());
  }
  return renderModeInspectionHandlers;
}

function getInspectionStatusResolver() {
  if (!inspectionStatusResolver) {
    inspectionStatusResolver = createInspectionStatusResolver(createInspectionStatusDeps());
  }
  return inspectionStatusResolver;
}

function getAiPreviewStateResponseBuilder() {
  if (!aiPreviewStateResponseBuilder) {
    aiPreviewStateResponseBuilder = createAiPreviewStateResponseBuilder(createAiPreviewStateResponseDeps());
  }
  return aiPreviewStateResponseBuilder;
}

function getAiPreviewCloseHandler() {
  if (!aiPreviewCloseHandler) {
    aiPreviewCloseHandler = createAiPreviewCloseHandler(createAiPreviewCloseHandlerDeps());
  }
  return aiPreviewCloseHandler;
}

function getAiPreviewComputeLockHandler() {
  if (!aiPreviewComputeLockHandler) {
    aiPreviewComputeLockHandler = createAiPreviewComputeLockHandler(createAiPreviewComputeLockHandlerDeps());
  }
  return aiPreviewComputeLockHandler;
}

function getAiPreviewExpandedModeHandler() {
  if (!aiPreviewExpandedModeHandler) {
    aiPreviewExpandedModeHandler = createAiPreviewExpandedModeHandler(createAiPreviewExpandedModeHandlerDeps());
  }
  return aiPreviewExpandedModeHandler;
}

function getPropertyLockPortClient() {
  if (!propertyLockPortClient) {
    propertyLockPortClient = createPropertyLockPortClient(createPropertyLockPortClientDeps());
  }
  return propertyLockPortClient;
}

function getPropertyLockStateMachine() {
  if (!propertyLockStateMachine) {
    propertyLockStateMachine = createPropertyLockStateMachine(createPropertyLockStateMachineDeps());
  }
  return propertyLockStateMachine;
}

function getRemoteSupportClient() {
  if (!remoteSupportClient) {
    remoteSupportClient = createRemoteSupportClient({
      isRemoteSupportFeatureEnabled: () => isFeatureEnabled("remoteSupport"),
      requestRemoteSupportState: () => chrome.runtime.sendMessage({
        type: "getRemoteSupportState"
      }),
      sendRuntimeMessageSafely,
      syncPageTelemetryBridgeLifecycle,
      EXTENSION_UI_FONT_STACK,
      REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
      REMOTE_SUPPORT_TERMINATE_BUTTON_ID,
      REMOTE_SUPPORT_TERMINATE_STYLE_ID
    });
  }

  return remoteSupportClient;
}

const getRemoteSupportMode = () => getRemoteSupportClient().getMode();
const getRemoteSupportRole = () => getRemoteSupportClient().getRole();
const getRemoteSupportIncludePayloads = () => getRemoteSupportClient().getIncludePayloads();
const isBeingSupportedMode = () => getRemoteSupportClient().isBeingSupportedMode();
const applyRemoteSupportSessionState = (remoteSupportStateLike) => {
  getRemoteSupportClient().applySessionState(remoteSupportStateLike);
};
const syncRemoteSupportSessionStateFromBackground = () => {
  return getRemoteSupportClient().syncSessionStateFromBackground();
};
const syncRemoteSupportTerminateButton = () => {
  getRemoteSupportClient().syncTerminateButton();
};

function getRemoteSupportStateHandler() {
  if (!remoteSupportStateHandler) {
    remoteSupportStateHandler = createRemoteSupportStateHandler(createRemoteSupportStateHandlerDeps());
  }
  return remoteSupportStateHandler;
}

function createLifecycleOperationId(kind) {
  lifecycleOperationCounter += 1;
  return `${kind || "operation"}:${Date.now()}:${lifecycleOperationCounter}`;
}

function isPageBlockerDebugEnabled() {
  if (isDebugFlagEnabled("ufDebugSpinnerQueue")) {
    return true;
  }
  try {
    return Boolean(window && window.localStorage && window.localStorage.getItem("ufDebugSpinnerQueue") === "1");
  } catch {
    return false;
  }
}

function normalizePageBlockingReason(event = {}) {
  if (typeof event.reason === "string" && event.reason.trim()) {
    return event.reason.trim();
  }
  if (typeof event.kind === "string" && event.kind.trim()) {
    return `lifecycle:${event.kind.trim()}`;
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return `message:${event.message.trim()}`;
  }
  return "page-lifecycle-blocker";
}

function logPageBlockerReason(event = {}) {
  if (!isPageBlockerDebugEnabled()) {
    return;
  }
  const hasBusy = Object.prototype.hasOwnProperty.call(event || {}, "busy");
  if (!hasBusy) {
    return;
  }
  try {
    console.debug("[page-blocker]", event.busy ? "start-or-update" : "clear", {
      reason: normalizePageBlockingReason(event),
      source: typeof event.source === "string" && event.source ? event.source : "content-lifecycle",
      kind: event && event.kind ? event.kind : "",
      phase: event && event.phase ? event.phase : "",
      operationId: event && event.operationId ? event.operationId : "",
      message: event && event.message ? event.message : "",
      pageUrl: location.href
    });
  } catch {
    // Debug logging must never break page behavior.
  }
}

function emitLifecycleEvent(event = {}) {
  const normalizedEvent = {
    ...event,
    reason: normalizePageBlockingReason(event),
    source: typeof event.source === "string" && event.source ? event.source : "content-lifecycle"
  };
  logPageBlockerReason(normalizedEvent);
  if (isWorldTraceEnabled()) {
    try {
      console.debug("[world-trace][content] lifecycle:emit", {
        kind: normalizedEvent && normalizedEvent.kind ? normalizedEvent.kind : "",
        phase: normalizedEvent && normalizedEvent.phase ? normalizedEvent.phase : "",
        operationId: normalizedEvent && normalizedEvent.operationId ? normalizedEvent.operationId : "",
        busy: Object.prototype.hasOwnProperty.call(normalizedEvent || {}, "busy")
          ? Boolean(normalizedEvent.busy)
          : undefined,
        reason: normalizedEvent.reason || "",
        source: normalizedEvent.source || ""
      });
    } catch {
      // Ignore trace logging failures.
    }
  }
  void sendRuntimeMessageSafely({
    type: WORLD_MESSAGE_TYPES.LIFECYCLE_EVENT,
    event: {
      contentMode: state.enabled ? CONTENT_MODES.MARKING : CONTENT_MODES.SILENT,
      markingEnabled: Boolean(state.enabled),
      pageUrl: location.href,
      ...normalizedEvent
    }
  });
}

function logContentDiagnostic(level, ...args) {
  if (!isWorldTraceEnabled()) {
    return;
  }
  try {
    const logger = level === "error" ? console.error : console.warn;
    logger(...args);
  } catch {
    // Ignore logging failures.
  }
}

function forwardPageTelemetryMessage(message) {
  if (!isFeatureEnabled("remoteSupport")) {
    return;
  }
  if (!message || typeof message !== "object") {
    return;
  }

  const channel = message.channel === "network"
    ? "network"
    : message.channel === "console"
      ? "console"
      : "";
  if (!channel) {
    return;
  }

  void sendRuntimeMessageSafely({
    type: "remoteSupportExtensionTelemetry",
    channel,
    entry: message.entry && typeof message.entry === "object" && !Array.isArray(message.entry)
      ? { ...message.entry }
      : {}
  });
}

const handlePageTelemetryWindowMessage = (event) => {
  return handlePageTelemetryWindowMessageOperation({
    isExtensionContextInvalidated: () => extensionContextInvalidated,
    getRemoteSupportMode,
    getPageTelemetryBridgeNonce: () => pageTelemetryBridgeNonce,
    REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    PAGE_TELEMETRY_MESSAGE_MARKER,
    forwardPageTelemetryMessage
  }, event);
};

// Telemetry delivered over the private MessageChannel port. The port itself is
// the capability — only a holder of the transferred port can post here — so no
// per-message nonce is required, but the marker/shape are still validated and
// the active-session guard still applies.
function handlePageTelemetryPortMessage(event) {
  if (
    extensionContextInvalidated ||
    getRemoteSupportMode() !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED
  ) {
    return;
  }

  const data = event && event.data && typeof event.data === "object" ? event.data : null;
  if (!data || data.__unfluffifyTelemetry !== PAGE_TELEMETRY_MESSAGE_MARKER) {
    return;
  }

  const message = data.message && typeof data.message === "object" ? data.message : null;
  if (!message || message.type !== "remoteSupportExtensionTelemetry") {
    return;
  }

  forwardPageTelemetryMessage(message);
}

function closePageTelemetryBridgePort() {
  if (pageTelemetryBridgePort) {
    try {
      pageTelemetryBridgePort.onmessage = null;
      pageTelemetryBridgePort.close();
    } catch (error) {
      // Best-effort teardown; never block disable on a failed port close.
    }
    pageTelemetryBridgePort = null;
  }
}

function createPageTelemetryBridgeNonce() {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.getRandomValues === "function") {
    const bytes = new Uint8Array(PAGE_TELEMETRY_NONCE_BYTES);
    cryptoObject.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function getPageTelemetryBridgeNonce() {
  if (!pageTelemetryBridgeNonce) {
    pageTelemetryBridgeNonce = createPageTelemetryBridgeNonce();
  }
  return pageTelemetryBridgeNonce;
}

const syncPageTelemetryControl = () => {
  return syncPageTelemetryControlOperation({
    getRemoteSupportMode,
    getOrCreatePageTelemetryBridgeNonce: getPageTelemetryBridgeNonce,
    getPageTelemetryBridgeNonce: () => pageTelemetryBridgeNonce,
    getRemoteSupportIncludePayloads,
    getPageTelemetryBridgePort: () => pageTelemetryBridgePort,
    setPageTelemetryBridgePort: (port) => {
      pageTelemetryBridgePort = port;
    },
    handlePageTelemetryPortMessage,
    REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    PAGE_TELEMETRY_CONTROL_MARKER
  });
};

function teardownPageTelemetryBridge() {
  if (
    pageTelemetryBridgeNonce &&
    typeof window !== "undefined" &&
    typeof window.postMessage === "function"
  ) {
    window.postMessage({
      __unfluffifyTelemetry: PAGE_TELEMETRY_CONTROL_MARKER,
      nonce: pageTelemetryBridgeNonce,
      enabled: false,
      includePayloads: false
    }, "*");
  }

  if (
    pageTelemetryBridgeListenerBound &&
    typeof window !== "undefined" &&
    typeof window.removeEventListener === "function"
  ) {
    window.removeEventListener("message", handlePageTelemetryWindowMessage);
    pageTelemetryBridgeListenerBound = false;
  }

  closePageTelemetryBridgePort();

  const existingScript = typeof document === "object"
    ? document.getElementById(PAGE_TELEMETRY_SCRIPT_ID)
    : null;
  if (existingScript && typeof existingScript.remove === "function") {
    existingScript.remove();
  } else if (existingScript && existingScript.parentNode) {
    existingScript.parentNode.removeChild(existingScript);
  }

  pageTelemetryBridgeNonce = "";
}

const ensurePageTelemetryBridge = () => {
  return ensurePageTelemetryBridgeOperation({
    isExtensionContextInvalidated: () => extensionContextInvalidated,
    getRemoteSupportMode,
    isPageTelemetryBridgeListenerBound: () => pageTelemetryBridgeListenerBound,
    setPageTelemetryBridgeListenerBound: (value) => {
      pageTelemetryBridgeListenerBound = Boolean(value);
    },
    handlePageTelemetryWindowMessage,
    syncPageTelemetryControl,
    REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    PAGE_TELEMETRY_SCRIPT_ID
  });
};

function syncPageTelemetryBridgeLifecycle() {
  if (getRemoteSupportMode() === REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    ensurePageTelemetryBridge();
  } else {
    teardownPageTelemetryBridge();
  }
}

async function loadGlobalAiSettingsForContent() {
  const settings = await getGlobalAiSettings();
  return {
    stageBaseValue: settings.stageBaseValue,
    tokenValue: settings.tokenValue,
    configEndpointValue: settings.configEndpointValue
  };
}

async function resolveSiteIdFromGraphql(options = {}) {
  const {
    stageBase = "",
    pageUrl = ""
  } = options;
  if (!stageBase || !pageUrl) {
    return null;
  }
  let response = null;
  try {
    response = await utils.sendRuntimeMessage({
      type: "resolveLivePageSiteId",
      stageBase,
      pageUrl
    });
  } catch (error) {
    return null;
  }
  if (!response || !response.ok) {
    return null;
  }
  return normalizeSiteIdValue(response.siteId);
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
  void tokenValue;
  const response = await utils.sendRuntimeMessage({
    type: "fetchLivePagePropertyPageTypes",
    siteId,
    stageBase: stageBaseValue
  });
  if (!response || !response.ok) {
    return {
      ok: false,
      pageTypes: [],
      reason:
        response && typeof response.reason === "string"
          ? response.reason
          : "Unable to verify Live Page candidates."
    };
  }
  return {
    ok: true,
    pageTypes: Array.isArray(response.pageTypes) ? response.pageTypes : []
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

async function resolveCurrentPropertyLockConnectionTarget(options = {}) {
  const pageUrl = typeof options.pageUrl === "string" && options.pageUrl
    ? options.pageUrl
    : location.href;
  if (!pageUrl) {
    return { ok: false, reason: "missing_page_url" };
  }

  const { stageBaseValue, tokenValue } = await loadGlobalAiSettingsForContent();
  if (!normalizeStageBaseValue(stageBaseValue) || !tokenValue) {
    return { ok: false, reason: "missing_lock_settings" };
  }

  const currentConfigs = await config.getConfigs();
  const matchingBaseUrl = utils.findMatchingBaseUrl(pageUrl, currentConfigs);
  const normalizedBaseUrl = utils.normalizeBaseUrl(matchingBaseUrl) || matchingBaseUrl || "";
  const normalizedConfig = normalizedBaseUrl
    ? config.normalizeConfig(
      normalizedBaseUrl,
      currentConfigs[normalizedBaseUrl]
    ).config
    : null;
  const storedSiteId = normalizeSiteIdValue(normalizedConfig && normalizedConfig.siteId);
  let siteId = storedSiteId;
  if (Boolean(options.forceSiteIdRefresh) || !siteId) {
    const resolvedSiteId = await resolveSiteIdFromGraphql({
      stageBase: stageBaseValue,
      pageUrl,
      tokenValue
    });
    if (resolvedSiteId) {
      siteId = resolvedSiteId;
      if (normalizedBaseUrl && siteId !== storedSiteId) {
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

async function resolveCurrentPageTypeForMarking(baseUrl, pageUrl = location.href) {
  const target = await resolveCurrentLivePageTarget(baseUrl, { pageUrl });
  if (!target.ok || !target.pageType) {
    return { ok: false, reason: target.reason || "This page is not a current Live Page candidate." };
  }
  return { ok: true, pageType: target.pageType };
}

async function syncPropertyLockOffCandidateWarning(baseUrl, pageUrl = location.href) {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (!baseUrl || !pageUrl || !utils.isPageWithinBaseUrl(pageUrl, baseUrl)) {
    clearPropertyLockOffCandidateWarning();
    return;
  }
  const pageTypeResult = await resolveCurrentPageTypeForMarking(baseUrl, pageUrl);
  if (pageTypeResult.ok && pageTypeResult.pageType) {
    clearPropertyLockOffCandidateWarning();
    return;
  }
  if (propertyLockState && propertyLockState.isEditor) {
    startPropertyLockOffCandidateWarning();
    return;
  }
  clearPropertyLockOffCandidateWarning();
}

function normalizeAiPreviewItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      xpath: typeof item.xpath === "string" ? item.xpath : "",
      text: typeof item.text === "string" ? item.text : "",
      title: typeof item.title === "string" && item.title
        ? item.title
        : (typeof item.xpath === "string" ? item.xpath : ""),
      kind: AI_PREVIEW_KINDS.has(item.kind) ? item.kind : ""
    }))
    .filter((item) => item.xpath);
}

function mapAiPreviewItemsToRenderableTargets(items) {
  const normalized = normalizeAiPreviewItems(items);
  const rows = [];
  const seenXpaths = new Set();
  normalized.forEach((item) => {
    const sourceXpath = typeof item.xpath === "string" ? item.xpath : "";
    if (!sourceXpath) {
      return;
    }
    const sourceNode = core.getElementFromXPath(sourceXpath);
    if (!sourceNode || sourceNode.nodeType !== 1 || isExtensionUiNode(sourceNode)) {
      return;
    }
    const renderTargets = collectSilentHighlightRenderTargets(sourceNode, {
      keepShallowestOnly: true
    });
    const targets = renderTargets.length
      ? renderTargets
      : hasRenderableClientBox(sourceNode)
        ? [sourceNode]
        : [];
    targets.forEach((target) => {
      if (!target || target.nodeType !== 1 || isExtensionUiNode(target)) {
        return;
      }
      const xpath = core.getXPath(target);
      if (!xpath || seenXpaths.has(xpath)) {
        return;
      }
      const text = typeof item.text === "string" && item.text
        ? item.text
        : core.getElementLabel(target);
      if (!text) {
        return;
      }
      const rect = target.getBoundingClientRect();
      rows.push({
        xpath,
        text,
        title: typeof item.title === "string" && item.title ? item.title : sourceXpath,
        kind: AI_PREVIEW_KINDS.has(item.kind) ? item.kind : "",
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX
      });
      seenXpaths.add(xpath);
    });
  });
  rows.sort((left, right) => {
    if (left.top === right.top) {
      return left.left - right.left;
    }
    return left.top - right.top;
  });
  return rows.map(({ xpath, text, title, kind }) => ({ xpath, text, title, kind }));
}

function setAiPreviewItems(items, options = {}) {
  const normalized = normalizeAiPreviewItems(items);
  const previousFocusedXpath = aiPreviewState.focusedXpath;
  const nextItemXpathSet = new Set(normalized.map((item) => item.xpath));
  const preserveFocusedXpath = Boolean(options.preserveFocusedXpath);
  const keepFocusedXpath = Boolean(
    preserveFocusedXpath &&
      previousFocusedXpath &&
      nextItemXpathSet.has(previousFocusedXpath)
  );
  aiPreviewState.items = normalized;
  aiPreviewState.itemXpathSet = nextItemXpathSet;
  aiPreviewState.focusedXpath = keepFocusedXpath ? previousFocusedXpath : "";
  if (!keepFocusedXpath && previousFocusedXpath) {
    core.clearFocusHighlight();
    notifyAiPreviewFocusChanged("");
  }
  syncAiPreviewClickableTargets(normalized);
}

function setAiPreviewItemSets(defaultItems, expandedItems, options = {}) {
  aiPreviewState.defaultItems = mapAiPreviewItemsToRenderableTargets(defaultItems);
  aiPreviewState.expandedItems = mapAiPreviewItemsToRenderableTargets(expandedItems);
  aiPreviewState.showAllCategories = Boolean(options.showAllCategories);
  setAiPreviewItems(
    aiPreviewState.showAllCategories
      ? aiPreviewState.expandedItems
      : aiPreviewState.defaultItems,
    { preserveFocusedXpath: true }
  );
}

function setAiPreviewExpandedMode(active) {
  if (!isFeatureEnabled("previewExpandedStates")) {
    aiPreviewState.showAllCategories = false;
    setAiPreviewItems(aiPreviewState.defaultItems, { preserveFocusedXpath: true });
    return false;
  }
  if (!aiPreviewState.active || aiPreviewState.mode !== "preview") {
    return false;
  }
  aiPreviewState.showAllCategories = Boolean(active);
  setAiPreviewItems(
    aiPreviewState.showAllCategories
      ? aiPreviewState.expandedItems
      : aiPreviewState.defaultItems,
    { preserveFocusedXpath: true }
  );
  return true;
}

function setAiPreviewClickableTitle(node, title) {
  if (!node || node.nodeType !== 1 || typeof title !== "string" || !title) {
    return;
  }
  const previous = aiPreviewOriginalTitles.get(node);
  if (!previous || typeof previous !== "object") {
    const hadTitle = node.hasAttribute("title");
    aiPreviewOriginalTitles.set(node, {
      hadTitle,
      title: hadTitle ? (node.getAttribute("title") || "") : "",
      previewTitle: title
    });
  } else {
    aiPreviewOriginalTitles.set(node, {
      hadTitle: Boolean(previous.hadTitle),
      title: typeof previous.title === "string" ? previous.title : "",
      previewTitle: title
    });
  }
  node.setAttribute("title", title);
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
    const originalTitleState = aiPreviewOriginalTitles.get(node);
    if (originalTitleState && typeof originalTitleState === "object") {
      if (originalTitleState.hadTitle) {
        node.setAttribute("title", originalTitleState.title || "");
      } else if (node.getAttribute("title") === originalTitleState.previewTitle) {
        node.removeAttribute("title");
      }
      aiPreviewOriginalTitles.delete(node);
    }
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
    const title = item && typeof item.title === "string" && item.title
      ? item.title
      : xpath;
    if (!xpath) {
      return;
    }
    const node = core.getElementFromXPath(xpath);
    if (!node || node.nodeType !== 1 || isExtensionUiNode(node)) {
      return;
    }
    node.setAttribute(AI_PREVIEW_CLICKABLE_ATTR, "on");
    setAiPreviewClickableTitle(node, title);
    aiPreviewClickableNodes.add(node);
  });
}

function notifyAiPreviewFocusChanged(xpath) {
  void sendRuntimeMessageSafely({
    type: "aiPreviewFocusChanged",
    baseUrl: state.baseUrl || "",
    pageUrl: location.href,
    xpath: typeof xpath === "string" ? xpath : ""
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
    copyTextToClipboard(target.element.getAttribute("title") || target.xpath).then();
    core.focusPreviewElement(target.element, { center: false });
    setAiPreviewFocusedXpath(target.xpath);
    return true;
  }
  core.clearFocusHighlight();
  setAiPreviewFocusedXpath("");
  return true;
}

function resolveAiPreviewSelectorForNode(node, selectorByNode) {
  if (!node || node.nodeType !== 1 || !(selectorByNode instanceof Map) || !selectorByNode.size) {
    return "";
  }
  if (selectorByNode.has(node)) {
    return selectorByNode.get(node) || "";
  }
  let nearestAncestorDistance = Number.POSITIVE_INFINITY;
  let nearestAncestorSelector = "";
  let nearestDescendantDistance = Number.POSITIVE_INFINITY;
  let nearestDescendantSelector = "";
  for (const [matchedNode, selector] of selectorByNode.entries()) {
    if (!matchedNode || matchedNode.nodeType !== 1 || typeof selector !== "string" || !selector) {
      continue;
    }
    if (matchedNode.contains(node)) {
      let distance = 0;
      let current = node;
      while (current && current !== matchedNode) {
        distance += 1;
        current = current.parentElement;
      }
      if (distance < nearestAncestorDistance) {
        nearestAncestorDistance = distance;
        nearestAncestorSelector = selector;
      }
      continue;
    }
    if (node.contains(matchedNode)) {
      let distance = 0;
      let current = matchedNode;
      while (current && current !== node) {
        distance += 1;
        current = current.parentElement;
      }
      if (distance < nearestDescendantDistance) {
        nearestDescendantDistance = distance;
        nearestDescendantSelector = selector;
      }
    }
  }
  return nearestAncestorSelector || nearestDescendantSelector;
}

function isWithinTrackedPreviewNode(node, trackedNodes) {
  for (const trackedNode of trackedNodes) {
    if (trackedNode === node || trackedNode.contains(node)) {
      return true;
    }
  }
  return false;
}

function hasTrackedPreviewDescendant(node, trackedNodes) {
  for (const trackedNode of trackedNodes) {
    if (trackedNode !== node && node.contains(trackedNode)) {
      return true;
    }
  }
  return false;
}

function collectUndetectedAiPreviewNodes(trackedNodes) {
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
    if (isWithinTrackedPreviewNode(node, trackedNodes)) {
      continue;
    }
    const containsTrackedDescendant = hasTrackedPreviewDescendant(node, trackedNodes);
    const isVisibleMarkable = core.isVisible(node) && core.isMarkableElement(node, state.config, {
      allowParent: false,
      allowImmutableChildren: false
    });
    if (isVisibleMarkable && !containsTrackedDescendant) {
      results.push(node);
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return results.sort(compareNodeOrder);
}

function buildAiPreviewItemsWithCategories(selectorSet, defaultItems = []) {
  const defaultPreviewItems = normalizeAiPreviewItems(defaultItems);
  const defaultTextByXpath = new Map(
    defaultPreviewItems.map((item) => [item.xpath, item.text])
  );
  const collections = core.withElementComputationCache(() =>
    collectIncludedNodesFromSelectorSet(selectorSet)
  );
  const explicitIncludedSet = new Set(collections.explicitIncluded || []);
  const implicitIncluded = (collections.included || []).filter((node) => !explicitIncludedSet.has(node));
  const trackedNodes = [
    ...(collections.excluded || []),
    ...(collections.included || [])
  ].filter((node) => node && node.nodeType === 1);
  const rows = [];
  const seenXpaths = new Set();

  function pushRow(node, kind, selector = "") {
    if (!node || node.nodeType !== 1) {
      return;
    }
    const xpath = core.getXPath(node);
    if (!xpath || seenXpaths.has(xpath)) {
      return;
    }
    const text = defaultTextByXpath.get(xpath) || core.getElementLabel(node);
    if (!text) {
      return;
    }
    const rect = node.getBoundingClientRect();
    rows.push({
      xpath,
      text,
      kind,
      title:
        kind === AI_PREVIEW_KIND_EXCLUDED || kind === AI_PREVIEW_KIND_EXPLICIT_INCLUDED
          ? buildSilentHighlightTitle(selector, xpath)
          : xpath,
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX
    });
    seenXpaths.add(xpath);
  }

  (collections.excluded || []).forEach((node) => {
    pushRow(
      node,
      AI_PREVIEW_KIND_EXCLUDED,
      resolveAiPreviewSelectorForNode(node, collections.exclusionSelectorByNode)
    );
  });
  (collections.explicitIncluded || []).forEach((node) => {
    pushRow(
      node,
      AI_PREVIEW_KIND_EXPLICIT_INCLUDED,
      resolveAiPreviewSelectorForNode(node, collections.inclusionSelectorByNode)
    );
  });
  implicitIncluded.forEach((node) => {
    pushRow(node, AI_PREVIEW_KIND_IMPLICIT_INCLUDED);
  });
  collectUndetectedAiPreviewNodes(trackedNodes).forEach((node) => {
    pushRow(node, AI_PREVIEW_KIND_UNDETECTED);
  });

  rows.sort((left, right) => {
    if (left.top === right.top) {
      return left.left - right.left;
    }
    return left.top - right.top;
  });
  return rows.map(({ xpath, text, title, kind }) => ({ xpath, text, title, kind }));
}

const SILENT_HIGHLIGHTING_INTERNAL_ATTRS = new Set([
  SILENT_CONTENT_HIGHLIGHTING_ATTR,
  SILENT_CONTENT_EXCLUDED_ATTR,
  SILENT_HIGHLIGHTINGS_ACTIVE_ATTR,
  SILENT_CONTENT_POSITION_ATTR,
  SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR,
  SILENT_SELECTOR_EXCLUDE_ATTR,
  SILENT_TITLE_COPY_ATTR,
  core.CONSENT_HIDDEN_ATTR
]);

function showPageToast(message) {
  getPageToastClient().show(message);
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

function getCurrentPageSnapshotOptions() {
  return {
    renderMode: getConfiguredRenderMode(),
    extraStripSelectors: [
      ...getPageToastClient().getStripSelectors(),
      `#${SILENT_HIGHLIGHT_OVERLAY_ID}`,
      `#${SILENT_HIGHLIGHT_STYLE_ID}`
    ],
    titlePrefix: SILENT_SELECTOR_TITLE_PREFIX
  };
}

function createCurrentPageSnapshot() {
  core.refreshPageMotionPause();
  return core.createSanitizedPageSnapshot(getCurrentPageSnapshotOptions());
}

function getCurrentPageSnapshotXPath(node) {
  return core.getSnapshotXPath(node, getCurrentPageSnapshotOptions());
}

function readRenderModeInspectionActive() {
  return getRenderModeInspectionClient().readActiveFlag();
}

function setRenderModeInspectionActive(active) {
  renderModeInspectionActive = Boolean(active);
  getRenderModeInspectionClient().writeActiveFlag(renderModeInspectionActive);
  if (renderModeInspectionActive) {
    armRenderModeInspectionWatchdog();
  } else {
    clearRenderModeInspectionWatchdog();
  }
}

function isRenderModeInspectionActive() {
  return renderModeInspectionActive || readRenderModeInspectionActive();
}

function clearRenderModeInspectionWatchdog() {
  getRenderModeInspectionClient().clearWatchdog();
  renderModeInspectionWatchdogTimer = 0;
}

function armRenderModeInspectionWatchdog() {
  getRenderModeInspectionClient().armWatchdog({
    timeoutMs: RENDER_MODE_INSPECTION_WATCHDOG_MS,
    onTimeout: () => {
      renderModeInspectionWatchdogTimer = 0;
      recoverFromStuckRenderModeInspection();
    }
  });
  renderModeInspectionWatchdogTimer = 1;
}

// Force-clear a render-mode inspection that never received its terminating
// `renderModeInspectionEnd` (popup closed / port dropped after the reload).
// Clears the persisted flag, releases the inspection UI, emits a terminal
// lifecycle event so any owning spinner can settle, and restores the correct
// silent-highlighting / editor-reveal posture for the current role.
function recoverFromStuckRenderModeInspection() {
  if (!isRenderModeInspectionActive()) {
    return;
  }
  const inspectionUiWasActive = core.isPageInspectionUiActive();
  setRenderModeInspectionActive(false);
  if (silentHighlightEditorRevealInFlight) {
    silentHighlightEditorRevealInFlight = 0;
  }
  silentHighlightEditorRevealKey = "";
  core.finishPageInspectionUi();
  if (propertyLockBannerMode === "editor_inspection_reconnecting") {
    updatePropertyLockBannerMode();
    renderPropertyLockBanner();
  }
  // Do not emit a fresh operationId here. Background intentionally ignores
  // terminal lifecycle events whose operationId differs from the active one.
  // Recovery is fail-open cleanup for the currently-active (possibly stale)
  // inspection operation, so omit operationId and let background apply this
  // terminal event to the current lifecycle state.
  emitLifecycleEvent({
    kind: LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
    phase: LIFECYCLE_PHASES.FAILED,
    busy: false,
    message: ""
  });
  if (inspectionUiWasActive && propertyLockState && propertyLockState.isEditor) {
    runEditorSilentHighlightingActivation().catch(() => {});
  } else {
    refreshSilentHighlightings().then().catch(() => {});
  }
}

function cancelSilentHighlightEditorActivation() {
  silentHighlightEditorActivationQueued = false;
  silentHighlightEditorRevealInFlight = ++silentHighlightEditorActivationIdCounter;
}

function isRenderModeConfirmedForBaseUrl(baseUrl, configs) {
  if (!baseUrl || !configs || !Object.prototype.hasOwnProperty.call(configs, baseUrl)) {
    return false;
  }
  const normalized = config.normalizeConfig(baseUrl, configs[baseUrl]).config;
  return config.isRenderModeConfirmed(normalized);
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
  if (!isFeatureEnabled("deviceEmulationToggle")) {
    return;
  }
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
  await core.refreshSavedPageEntryFromBackendCache(targetBaseUrl, pageUrl);
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
  core.hideConsentElements();
  const immutableExcluded = core.collectImmutableElements();
  const syncResult = core.syncPageMarkings(state.config, pageUrl, immutableExcluded, {
    allowCreate: true,
    persist: true
  });
  const entry = core.getPageMarkingEntry(state.config, pageUrl);
  const currentSnapshot = createCurrentPageSnapshot();
  const currentRenderedHtml = currentSnapshot.renderedHtml;
  const currentSubmissionXpaths = collectAiSubmissionXpathsForCurrentPage();
  const currentRawHtml = await fetchCurrentPageRawHtml(pageUrl);
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
    !syncResult.changed &&
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
    !syncResult.changed &&
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
  try {
    if (!hadReconciliationPending) {
      await core.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, { reason: "saving" });
    }
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
    await core.saveConfig(targetBaseUrl, state.config);
  } catch (error) {
    if (!hadReconciliationPending) {
      try {
        await core.clearPageSaveReconciliation(targetBaseUrl, pageUrl);
      } catch (clearError) {
        logContentDiagnostic(
          "warn",
          "Failed to clear page-save reconciliation after save failure",
          clearError
        );
      }
    }
    if (showToast) {
      showPageToast("Unable to save page");
    }
    return { ok: false };
  }
  core.setSavedPageEntry(pageUrl, entry);
  try {
    await core.setPageSaveReconciliationPending(targetBaseUrl, pageUrl, { reason: "pending" });
  } catch (error) {
    if (showToast) {
      showPageToast("Unable to track server sync for saved page");
    }
    return { ok: false };
  }
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
  if (!currentlyEnabled && isPropertyLockInteractionBlocked()) {
    showPropertyLockBlockedToast();
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
  sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
  try {
    await core.enableForBaseUrl(baseUrl, { skipInitialReveal: true });
  } catch (error) {
    logContentDiagnostic("error", "Failed to enable marking from page:", error);
    state.currentPageType = "";
    core.disable();
    await utils.sendRuntimeMessage({
      type: "setTabState",
      enabled: false,
      baseUrl,
      pageType: ""
    });
    sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_RELEASE);
    showPageToast("Unable to activate on this page");
    return;
  }
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
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-immutable {
        border: 1px dashed rgba(156, 107, 107, 0.45);
        background: transparent;
      }
      #${SILENT_HIGHLIGHT_OVERLAY_ID} .uf-silent-content-ghost {
        border: 1px dotted rgba(68, 181, 50, 0.45);
        background: transparent;
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

function setSilentHighlightingPageMotionPaused(paused) {
  if (paused) {
    core.pausePageMotion(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON);
  } else {
    core.resumePageMotion(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON);
  }
}

function getSilentHighlightEditorRevealKey(baseUrl, pageUrl) {
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !pageUrl) {
    return "";
  }
  return `${normalizedBaseUrl}|${pageUrl}`;
}

async function runEditorSilentHighlightingActivation() {
  if (silentHighlightEditorActivationPromise) {
    silentHighlightEditorActivationQueued = true;
    return silentHighlightEditorActivationPromise;
  }

  const runActivationLoop = async () => {
    do {
      silentHighlightEditorActivationQueued = false;
      await runEditorSilentHighlightingActivationOnce();
    } while (
      silentHighlightEditorActivationQueued &&
      Boolean(propertyLockState && propertyLockState.isEditor)
    );
  };

  silentHighlightEditorActivationPromise = runActivationLoop().finally(() => {
    silentHighlightEditorActivationPromise = null;
  });

  return silentHighlightEditorActivationPromise;
}

async function runEditorSilentHighlightingActivationOnce() {
  if (!propertyLockState || !propertyLockState.isEditor) {
    return;
  }
  if (isRenderModeInspectionActive()) {
    // Inspection activity has priority. Do not re-arm the inspection flag from
    // unrelated editor-lock refreshes; the dedicated inspection phases already
    // arm the watchdog and this avoids delayed post-inspection reveals.
    return;
  }
  const activationId = ++silentHighlightEditorActivationIdCounter;
  silentHighlightEditorRevealInFlight = activationId;
  let shouldRefreshAfterActivation = false;
  try {
    const pageUrl = location.href;
    const configs = await config.getConfigs();
    const baseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
    if (!baseUrl) {
      return;
    }
    if (!isRenderModeConfirmedForBaseUrl(baseUrl, configs)) {
      return;
    }
    const revealKey = getSilentHighlightEditorRevealKey(baseUrl, pageUrl);
    if (revealKey && revealKey === silentHighlightEditorRevealKey) {
      shouldRefreshAfterActivation = true;
      return;
    }
    const previousReconciliation = core.getPageSaveReconciliationState(pageUrl);
    const isStillCurrent = () =>
      silentHighlightEditorRevealInFlight === activationId &&
      Boolean(propertyLockState && propertyLockState.isEditor) &&
      location.href === pageUrl &&
      utils.isPageWithinBaseUrl(location.href, baseUrl);
    await core.setPageSaveReconciliationPending(baseUrl, pageUrl, {
      reason: SILENT_HIGHLIGHTING_PREPARATION_REASON
    });
    const prepared = await core.warmupSilentHighlightingBeforeMotionPause(
      baseUrl,
      pageUrl,
      SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON,
      { keepUiActive: true }
    );
    if (isStillCurrent() && prepared && revealKey) {
      silentHighlightEditorRevealKey = revealKey;
    }
    shouldRefreshAfterActivation = true;
    if (previousReconciliation) {
      await core.setPageSaveReconciliationPending(baseUrl, pageUrl, {
        reason: previousReconciliation.reason || "pending"
      }).catch(() => {
        // Best-effort reconciliation restoration.
      });
    } else {
      await core.clearPageSaveReconciliation(baseUrl, pageUrl).catch(() => {
        // Best-effort reconciliation cleanup.
      });
    }
  } finally {
    if (silentHighlightEditorRevealInFlight === activationId) {
      silentHighlightEditorRevealInFlight = 0;
    }
  }
  if (shouldRefreshAfterActivation) {
    try {
      await refreshSilentHighlightings();
    } finally {
      core.finishPageInspectionUi();
    }
    return;
  }
  core.finishPageInspectionUi();
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
  silentHighlightRenderTargetCache = new Map();
  silentHighlightTrackedNodeIndex = null;
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

function cloneSilentHighlightNodes(nodes) {
  return Array.from(nodes || []).filter((node) => node && node.nodeType === 1);
}

function cloneSilentHighlightNodeValueMap(valueByNode) {
  return valueByNode instanceof Map ? new Map(valueByNode) : new Map();
}

function buildSilentHighlightRenderableCollections(collections) {
  const sourceImmutableNodes = cloneSilentHighlightNodes(
    Array.isArray(collections && collections.sourceImmutableNodes)
      ? collections.sourceImmutableNodes
      : collections && collections.immutableNodes
  );
  const sourceContentNodes = cloneSilentHighlightNodes(
    Array.isArray(collections && collections.sourceContentNodes)
      ? collections.sourceContentNodes
      : collections && collections.contentNodes
  );
  const sourceExcludedNodes = cloneSilentHighlightNodes(
    Array.isArray(collections && collections.sourceExcludedNodes)
      ? collections.sourceExcludedNodes
      : collections && collections.excludedNodes
  );
  const fallbackExplicitIncludeNodes =
    collections && collections.explicitIncludeXpathByNode instanceof Map
      ? Array.from(collections.explicitIncludeXpathByNode.keys())
      : [];
  const sourceExplicitIncludeNodes = cloneSilentHighlightNodes(
    Array.isArray(collections && collections.sourceExplicitIncludeNodes)
      ? collections.sourceExplicitIncludeNodes
      : fallbackExplicitIncludeNodes
  );
  const sourceHiddenExplicitIncludeNodes = cloneSilentHighlightNodes(
    Array.isArray(collections && collections.sourceHiddenExplicitIncludeNodes)
      ? collections.sourceHiddenExplicitIncludeNodes
      : []
  );
  const sourceInclusionSelectorByNode = cloneSilentHighlightNodeValueMap(
    collections && collections.sourceInclusionSelectorByNode instanceof Map
      ? collections.sourceInclusionSelectorByNode
      : collections && collections.explicitIncludeSelectorByNode
  );
  const sourceExclusionSelectorByNode = cloneSilentHighlightNodeValueMap(
    collections && collections.sourceExclusionSelectorByNode instanceof Map
      ? collections.sourceExclusionSelectorByNode
      : collections && collections.excludedSelectorByNode
  );
  const immutableNodes = toRenderableNodeList(sourceImmutableNodes);
  const contentNodes = toRenderableNodeList(sourceContentNodes);
  const explicitIncludedRenderable = toRenderableNodeListWithSelectors(
    sourceExplicitIncludeNodes,
    (node) => resolveSelectorForNode(node, sourceInclusionSelectorByNode, false)
  );
  const sourceHiddenExplicitIncludeSet = new Set(sourceHiddenExplicitIncludeNodes);
  const explicitIncludeSelectorByNode = explicitIncludedRenderable.selectorByNode;
  const explicitIncludeXpathByNode = buildSilentHighlightXpathByNode(
    explicitIncludedRenderable.nodes
  );
  const ghostContentNodes = explicitIncludedRenderable.nodes.filter((node) =>
    sourceHiddenExplicitIncludeSet.has(explicitIncludedRenderable.sourceByTarget.get(node))
  );
  const excludedRenderable = toRenderableNodeListWithSelectors(
    sourceExcludedNodes,
    (node) => resolveSelectorForNode(node, sourceExclusionSelectorByNode, true)
  );
  const excludedNodes = excludedRenderable.nodes;
  const excludedSelectorByNode = excludedRenderable.selectorByNode;
  const excludedXpathByNode = buildSilentHighlightXpathByNode(excludedNodes);
  const implicitIncludeXpathByNode = buildSilentHighlightXpathByNode(
    contentNodes.filter((node) => !explicitIncludeXpathByNode.has(node))
  );
  return {
    immutableNodes,
    contentNodes,
    excludedNodes,
    sourceImmutableNodes,
    sourceContentNodes,
    sourceExcludedNodes,
    sourceExplicitIncludeNodes,
    sourceHiddenExplicitIncludeNodes,
    sourceInclusionSelectorByNode,
    sourceExclusionSelectorByNode,
    ghostContentNodes,
    explicitIncludeSelectorByNode,
    excludedSelectorByNode,
    explicitIncludeXpathByNode,
    excludedXpathByNode,
    implicitIncludeXpathByNode
  };
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

function renderSilentHighlightOverlay(collections, options = {}) {
  const overlay = ensureSilentHighlightOverlay();
  if (!overlay) {
    return;
  }
  // keepVisible (in-place reposition) leaves the overlay's current visibility
  // untouched: boxes are reused DOM nodes whose positions update atomically in
  // this synchronous pass, so there is no half-built frame to hide. The
  // hide->reveal cycle is reserved for full rebuilds and scroll repositions.
  const keepVisible = Boolean(options.keepVisible);
  if (!keepVisible) {
    setSilentHighlightOverlayHidden(true);
  }
  const immutableNodes = Array.from(collections.immutableNodes || []);
  const contentNodes = Array.from(collections.contentNodes || []);
  const ghostContentNodeSet = new Set(collections.ghostContentNodes || []);
  const excludedNodes = Array.from(collections.excludedNodes || []);
  const immutableLayerState = beginSilentLayerRender("immutable");
  const contentLayerState = beginSilentLayerRender("content");
  const excludedLayerState = beginSilentLayerRender("excluded");

  immutableNodes.forEach((node) => {
    drawSilentRectsForNode(immutableLayerState, node, "uf-silent-immutable");
  });
  contentNodes.forEach((node) => {
    drawSilentRectsForNode(
      contentLayerState,
      node,
      ghostContentNodeSet.has(node)
        ? "uf-silent-content uf-silent-content-ghost"
        : "uf-silent-content"
    );
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

  finalizeSilentLayerRender(immutableLayerState);
  finalizeSilentLayerRender(contentLayerState);
  finalizeSilentLayerRender(excludedLayerState);
  applySilentSelectorAnnotations(collections);
  // Settle/reposition resamples the SAME source nodes many times per second; only
  // the source-node → render-target map changes when collections are rebuilt.
  silentHighlightRenderTargetCache = new Map();
  silentHighlightTrackedNodeIndex = null;
  silentHighlightCollections = {
    immutableNodes,
    contentNodes,
    excludedNodes,
    sourceImmutableNodes: cloneSilentHighlightNodes(collections.sourceImmutableNodes),
    sourceContentNodes: cloneSilentHighlightNodes(collections.sourceContentNodes),
    sourceExcludedNodes: cloneSilentHighlightNodes(collections.sourceExcludedNodes),
    sourceExplicitIncludeNodes: cloneSilentHighlightNodes(collections.sourceExplicitIncludeNodes),
    sourceHiddenExplicitIncludeNodes: cloneSilentHighlightNodes(
      collections.sourceHiddenExplicitIncludeNodes
    ),
    sourceInclusionSelectorByNode: cloneSilentHighlightNodeValueMap(
      collections.sourceInclusionSelectorByNode
    ),
    sourceExclusionSelectorByNode: cloneSilentHighlightNodeValueMap(
      collections.sourceExclusionSelectorByNode
    ),
    ghostContentNodes: cloneSilentHighlightNodes(collections.ghostContentNodes),
    explicitIncludeSelectorByNode:
      collections.explicitIncludeSelectorByNode instanceof Map
        ? new Map(collections.explicitIncludeSelectorByNode)
        : new Map(),
    excludedSelectorByNode:
      collections.excludedSelectorByNode instanceof Map
        ? new Map(collections.excludedSelectorByNode)
        : new Map()
    ,
    explicitIncludeXpathByNode:
      collections.explicitIncludeXpathByNode instanceof Map
        ? new Map(collections.explicitIncludeXpathByNode)
        : new Map(),
    excludedXpathByNode:
      collections.excludedXpathByNode instanceof Map
        ? new Map(collections.excludedXpathByNode)
        : new Map(),
    implicitIncludeXpathByNode:
      collections.implicitIncludeXpathByNode instanceof Map
        ? new Map(collections.implicitIncludeXpathByNode)
        : new Map()
  };
  if (!keepVisible) {
    scheduleSilentHighlightOverlayReveal();
  }
}

function repositionSilentHighlightOverlay(options = {}) {
  if (!lastSilentHighlightingsActive || state.enabled || !silentHighlightCollections) {
    return;
  }
  // keepVisible repositions (settle/layout-shift/mutation) update rect boxes in
  // place without the hide->reveal cycle, which is what produced the periodic
  // silent-highlight blink (#1). Scroll/resize repositions still hide first
  // because their viewport-fixed rects go stale during the gesture.
  const keepVisible = Boolean(options.keepVisible);
  if (!keepVisible) {
    setSilentHighlightOverlayHidden(true);
  }
  const nextCollections = buildSilentHighlightRenderableCollections(silentHighlightCollections);
  renderSilentHighlightOverlay(nextCollections, { keepVisible });
}

function buildSilentHighlightPositionSignature(collections = silentHighlightCollections) {
  if (!collections) {
    return "";
  }
  const entries = [];
  const appendNodes = (nodes, prefix) => {
    (nodes || []).forEach((node, nodeIndex) => {
      let targets = silentHighlightRenderTargetCache.get(node);
      if (!targets) {
        targets = collectSilentHighlightRenderTargets(node, {
          keepShallowestOnly: true
        });
        silentHighlightRenderTargetCache.set(node, targets);
      }
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
  appendNodes(collections.immutableNodes, "immutable");
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
      repositionSilentHighlightOverlay({ keepVisible: true });
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
  if (options && options.waitForSettle) {
    // Settle-driven repositions (layout-shift / DOM mutation) keep the overlay
    // visible and reposition in place when settled, so they do not blink. Only
    // scroll/resize repositions (the else branch) hide up front.
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
  setSilentHighlightOverlayHidden(true);
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
    node.removeAttribute(SILENT_TITLE_COPY_ATTR);
    const originalTitleState = silentSelectorOriginalTitles.get(node);
    if (originalTitleState && typeof originalTitleState === "object") {
      if (originalTitleState.hadTitle) {
        node.setAttribute("title", originalTitleState.title || "");
      } else if (
        node.getAttribute("title") === originalTitleState.annotationTitle ||
        (node.getAttribute("title") || "").startsWith(SILENT_SELECTOR_TITLE_PREFIX)
      ) {
        node.removeAttribute("title");
      }
      silentSelectorOriginalTitles.delete(node);
    } else if ((node.getAttribute("title") || "").startsWith(SILENT_SELECTOR_TITLE_PREFIX)) {
      node.removeAttribute("title");
    }
  }
  silentSelectorAnnotatedNodes.clear();
}

function buildSilentHighlightTitle(selector, xpath) {
  const normalizedSelector = typeof selector === "string"
    ? selector
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n")
    : "";
  const normalizedXpath = typeof xpath === "string" ? xpath.trim() : "";
  if (normalizedSelector && normalizedXpath) {
    const selectorLines = normalizedSelector.split("\n").filter(Boolean);
    if (selectorLines.length > 1) {
      return [
        "Matched CSS selectors:",
        ...selectorLines,
        "XPath:",
        normalizedXpath
      ].join("\n");
    }
    return [
      `Matched CSS selector: ${selectorLines[0]}`,
      `XPath: ${normalizedXpath}`
    ].join("\n");
  }
  return normalizedXpath || normalizedSelector;
}

function setSilentSelectorAnnotation(node, kind, selector = "", xpath = "") {
  if (!node || node.nodeType !== 1) {
    return;
  }
  const normalizedSelector = typeof selector === "string" ? selector.trim() : "";
  const normalizedXpath = typeof xpath === "string" ? xpath.trim() : "";
  const title = buildSilentHighlightTitle(normalizedSelector, normalizedXpath);
  if (!title) {
    return;
  }
  const attrName = kind === "excluded"
    ? SILENT_SELECTOR_EXCLUDE_ATTR
    : kind === "included"
      ? SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR
      : "";
  const previousTitleState = silentSelectorOriginalTitles.get(node);
  if (!previousTitleState || typeof previousTitleState !== "object") {
    const hadTitle = node.hasAttribute("title");
    silentSelectorOriginalTitles.set(node, {
      hadTitle,
      title: hadTitle ? (node.getAttribute("title") || "") : "",
      annotationTitle: title
    });
  } else {
    silentSelectorOriginalTitles.set(node, {
      hadTitle: Boolean(previousTitleState.hadTitle),
      title: typeof previousTitleState.title === "string" ? previousTitleState.title : "",
      annotationTitle: title
    });
  }
  if (attrName && normalizedSelector) {
    node.setAttribute(attrName, normalizedSelector);
  }
  node.setAttribute(SILENT_TITLE_COPY_ATTR, "on");
  node.setAttribute("title", title);
  silentSelectorAnnotatedNodes.add(node);
}

function buildSilentHighlightXpathByNode(nodes) {
  const xpathByNode = new Map();
  for (const node of nodes || []) {
    if (!node || node.nodeType !== 1) {
      continue;
    }
    const xpath = core.getXPath(node);
    if (typeof xpath === "string" && xpath) {
      xpathByNode.set(node, xpath);
    }
  }
  return xpathByNode;
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
  const explicitIncludeXpathByNode =
    collections.explicitIncludeXpathByNode instanceof Map
      ? collections.explicitIncludeXpathByNode
      : new Map();
  const excludedXpathByNode =
    collections.excludedXpathByNode instanceof Map
      ? collections.excludedXpathByNode
      : new Map();
  const implicitIncludeXpathByNode =
    collections.implicitIncludeXpathByNode instanceof Map
      ? collections.implicitIncludeXpathByNode
      : new Map();
  explicitIncludeXpathByNode.forEach((xpath, node) => {
    setSilentSelectorAnnotation(
      node,
      "included",
      explicitIncludeSelectorByNode.get(node) || "",
      xpath
    );
  });
  excludedXpathByNode.forEach((xpath, node) => {
    setSilentSelectorAnnotation(
      node,
      "excluded",
      excludedSelectorByNode.get(node) || "",
      xpath
    );
  });
  implicitIncludeXpathByNode.forEach((xpath, node) => {
    setSilentSelectorAnnotation(node, "implicit", "", xpath);
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
  const annotated = target.closest(`[${SILENT_TITLE_COPY_ATTR}]`);
  if (!annotated || isExtensionUiNode(annotated)) {
    return;
  }
  const title = annotated.getAttribute("title") || "";
  if (!title) {
    return;
  }
  copyTextToClipboard(title).then();
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

function buildSilentHighlightTrackedNodeIndex() {
  // tracked: every node the silent overlay cares about, by reference.
  // ancestors: every ancestor of any tracked node, so we can detect a mutation
  //   whose target is an ancestor of a tracked node (target.contains(tracked))
  //   in O(1) instead of O(N).
  const tracked = new Set();
  const ancestors = new Set();
  if (!silentHighlightCollections) {
    return { tracked, ancestors };
  }
  const groups = [
    silentHighlightCollections.sourceImmutableNodes,
    silentHighlightCollections.sourceContentNodes,
    silentHighlightCollections.sourceExcludedNodes,
    silentHighlightCollections.sourceExplicitIncludeNodes,
    silentHighlightCollections.immutableNodes,
    silentHighlightCollections.contentNodes,
    silentHighlightCollections.excludedNodes
  ];
  for (const group of groups) {
    if (!group) continue;
    for (const node of group) {
      if (!node || node.nodeType !== 1 || tracked.has(node)) {
        continue;
      }
      tracked.add(node);
      let cursor = node.parentNode;
      while (cursor && cursor.nodeType === 1) {
        if (ancestors.has(cursor)) break;
        ancestors.add(cursor);
        cursor = cursor.parentNode;
      }
    }
  }
  return { tracked, ancestors };
}

function mutationTargetTouchesSilentCollections(target) {
  if (!target || target.nodeType !== 1 || !silentHighlightCollections) {
    return false;
  }
  if (!silentHighlightTrackedNodeIndex) {
    silentHighlightTrackedNodeIndex = buildSilentHighlightTrackedNodeIndex();
  }
  const { tracked, ancestors } = silentHighlightTrackedNodeIndex;
  // Case A: mutation target is itself tracked.
  if (tracked.has(target)) return true;
  // Case B: mutation target is an ancestor of a tracked node.
  if (ancestors.has(target)) return true;
  // Case C: mutation target sits inside a tracked subtree — walk its ancestor
  //   chain and look for a tracked node above it. O(depth), no N scan.
  let cursor = target.parentNode;
  while (cursor && cursor.nodeType === 1) {
    if (tracked.has(cursor)) return true;
    cursor = cursor.parentNode;
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
      // Class mutations on nodes that don't touch the tracked subtree can only
      // affect tracked overlays through far-reaching CSS cascade rules; the
      // reposition path picks up any resulting layout shift. Keep the full
      // refresh for tracked-touching targets where the change can flip
      // selector-match membership.
      if (attributeName === "class") {
        if (mutationTargetTouchesSilentCollections(mutation.target)) {
          needsFullRefresh = true;
          break;
        }
        needsPositionRefresh = true;
        continue;
      }
      needsFullRefresh = true;
      break;
    }

if (needsFullRefresh) {
      invalidateSharedSelectorCache({ domStructure: true });
      silentHighlightingPositionRefreshPending = true;
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
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      silentHighlightEditorRevealKey = "";
      runPropertyLockSync({
        pageUrl: lastUrl,
        forceSiteIdRefresh: true
      });
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
  if (
    !restoreState ||
    !(restoreState.previousEnabled || restoreState.restoreMarkingOnExit) ||
    !state.config
  ) {
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
  core.state.autoSeedSuppressedPageUrl = previousDraftEntry ? "" : pageUrl;
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

function beginAiPreviewMode(options = {}) {
  const nextMode = typeof options.mode === "string" ? options.mode : "preview";
  const restoreMarkingOnExit = nextMode === "compute_lock";
  if (!aiPreviewState.active) {
    const previousPageUrl = location.href;
    aiPreviewState = {
      active: true,
      mode: nextMode,
      items: [],
      defaultItems: [],
      expandedItems: [],
      showAllCategories: false,
      itemXpathSet: new Set(),
      focusedXpath: "",
      previousEnabled: Boolean(state.enabled),
      restoreMarkingOnExit,
      previousBaseUrl: state.baseUrl || "",
      previousPageUrl,
      previousDraftEntry: core.clonePageEntry(core.getDraftPageEntry(previousPageUrl)),
      previousSavedEntry: core.getSavedPageEntry(previousPageUrl),
      previousAutoSeededPendingSavePageUrl: state.autoSeededPendingSavePageUrl || ""
    };
  } else {
    aiPreviewState.mode = nextMode;
    if (restoreMarkingOnExit) {
      aiPreviewState.restoreMarkingOnExit = true;
    }
  }

  if (nextMode !== "compute_lock" && aiComputeLockReleaseTimer) {
    window.clearTimeout(aiComputeLockReleaseTimer);
    aiComputeLockReleaseTimer = 0;
  }

  if (aiPreviewState.previousEnabled && state.enabled) {
    core.disable();
  }
  if (aiPreviewState.restoreMarkingOnExit) {
    const lockedBaseUrl = aiPreviewState.previousBaseUrl || state.baseUrl || "";
    if (lockedBaseUrl) {
      void utils.sendRuntimeMessage({
        type: "setTabState",
        enabled: true,
        baseUrl: lockedBaseUrl,
        pageType: state.currentPageType || ""
      }).catch(() => null);
    }
  }
}

async function enterAiPreviewMode(options = {}) {
  beginAiPreviewMode(options);
  await refreshSilentHighlightings();
}

async function exitAiPreviewMode() {
  if (!aiPreviewState.active) {
    return;
  }

  const restoreState = aiPreviewState;
  const shouldRestoreMarking = Boolean(
    restoreState.previousEnabled || restoreState.restoreMarkingOnExit
  );
  let restoredBaseUrl = restoreState.previousBaseUrl || state.baseUrl || "";
  if (
    shouldRestoreMarking &&
    (!restoredBaseUrl || !utils.isPageWithinBaseUrl(location.href, restoredBaseUrl))
  ) {
    restoredBaseUrl = await resolveBaseUrlForCurrentPage();
  }

  if (shouldRestoreMarking && restoredBaseUrl) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    let restoredMarking = false;
    try {
      await core.enableForBaseUrl(restoredBaseUrl, {
        skipInitialReveal: true
      });
      restoredMarking = true;
    } catch {
      try {
        state.config = await core.loadConfig(restoredBaseUrl);
        await core.enableForBaseUrl(restoredBaseUrl, {
          skipInitialReveal: true
        });
        restoredMarking = true;
      } catch {
        // Keep the restore intent alive for immediately-following preview
        // transitions when a transient enable race happens.
        state.baseUrl = restoredBaseUrl;
        state.enabled = true;
      }
    }
    restoreAiPreviewDraftState(restoreState);
    if (restoredMarking) {
      refreshEnabledAiHighlights();
    }
    resetAiPreviewState();
    void utils.sendRuntimeMessage({
      type: "setTabState",
      enabled: true,
      baseUrl: restoredBaseUrl,
      pageType: state.currentPageType || ""
    }).catch(() => null);
    return;
  }

  await refreshSilentHighlightings();
  resetAiPreviewState();
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

function collectImmutableDefaultExcludedNodes(includedNodes) {
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
    if (matchesImmutableDefaultSelector(node)) {
      if (!isWithinNodeSet(node, includedNodes) && core.isVisible(node)) {
        results.push(node);
      }
      continue;
    }
    if (isWithinNodeSet(node, includedNodes)) {
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
  // Per-call visibility memo. `isIncludedNodeAvailableForUser` is invoked
  // across the explicit-include filter, the final include filter, and inside
  // `shouldRetainIncludedSource(...)`, so the same node can be queried several
  // times in one collection pass. The WeakMap is scoped to this invocation
  // and discarded with the closure, so there is no staleness window.
  const visibilityMemo = new WeakMap();
  const memoIsVisible = (node) => {
    if (!node || node.nodeType !== 1) return false;
    const cached = visibilityMemo.get(node);
    if (cached !== undefined) return cached;
    const visible = core.isVisible(node);
    visibilityMemo.set(node, visible);
    return visible;
  };
  const isIncludedNodeAvailableForUser = (node) =>
    memoIsVisible(node) || !isDefinitelyHiddenSubtreeNode(node);
  const explicitIncludedSet = new Set(explicitIncluded);
  const hiddenExplicitIncluded = explicitIncluded.filter((node) =>
    !isIncludedNodeAvailableForUser(node)
  );
  const explicitIncludedContextSet = buildInclusionContextSet(explicitIncludedSet);
  const immutableExcluded = collectImmutableDefaultExcludedNodes(explicitIncludedSet);
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
    shouldRetainIncludedSource({
      explicitlyIncluded: explicitIncludedSet.has(node),
      visibleToUser: isIncludedNodeAvailableForUser(node)
    }) &&
    (
      explicitIncludedSet.has(node) ||
      hasRenderableTextForHighlight(
        node,
        excludedNodes,
        includedNodes,
        inclusionContextSet,
        inclusionSelectionOptions
      )
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
    immutableExcluded,
    explicitIncluded,
    hiddenExplicitIncluded,
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
  immutableNodes,
  contentNodes,
  excludedNodes,
  ghostContentNodes = [],
  explicitIncludeSelectorByNode = null,
  excludedSelectorByNode = null,
  explicitIncludeXpathByNode = null,
  excludedXpathByNode = null,
  implicitIncludeXpathByNode = null
) {
  const immutableIds = immutableNodes
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
  const ghostContentIds = ghostContentNodes
    .map(getSilentRenderNodeId)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const buildNodeValueKey = (valueByNode) => JSON.stringify(
    (valueByNode instanceof Map ? Array.from(valueByNode.entries()) : [])
      .map(([node, value]) => [getSilentRenderNodeId(node), value || ""])
      .filter(([id, value]) => id && value)
      .sort((left, right) => {
        if (left[0] !== right[0]) {
          return left[0] - right[0];
        }
        return String(left[1]).localeCompare(String(right[1]));
      })
  );
  const explicitIncludeSelectorKey = buildNodeValueKey(explicitIncludeSelectorByNode);
  const excludedSelectorKey = buildNodeValueKey(excludedSelectorByNode);
  const explicitIncludeXpathKey = buildNodeValueKey(explicitIncludeXpathByNode);
  const excludedXpathKey = buildNodeValueKey(excludedXpathByNode);
  const implicitIncludeXpathKey = buildNodeValueKey(implicitIncludeXpathByNode);
  return [
    immutableIds.join(","),
    contentIds.join(","),
    excludedIds.join(","),
    ghostContentIds.join(","),
    explicitIncludeSelectorKey,
    excludedSelectorKey,
    explicitIncludeXpathKey,
    excludedXpathKey,
    implicitIncludeXpathKey
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
  const sourceByTarget = new Map();
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
      sourceByTarget.set(node, node);
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
      sourceByTarget.set(target, node);
      appendSelector(target, selector);
    }
  }
  return { nodes: results, selectorByNode, sourceByTarget };
}

function toRenderableNodeList(nodes) {
  return toRenderableNodeListWithSelectors(nodes).nodes;
}

function collectAiSubmissionXpathsForCurrentPage(sourceConfig = state.config) {
  core.refreshPageMotionPause();
  const configValue = sourceConfig || state.config;
  if (!configValue) {
    return [];
  }
  const pageUrl = location.href;
  const entry = core.getPageMarkingEntry(configValue, pageUrl, {
    create: false,
    persist: false
  });
  const explicitExcludedXpaths = new Set();
  const explicitIncludedXpaths = new Set();
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
  const isWithinImmutableExcludedBoundary = (element) => {
    let current = element;
    while (current && current.nodeType === 1) {
      if (core.isImmutableExcludedElement(current)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };
  const toSnapshotXPath = (value) => {
    const xpath = normalizeXPath(value);
    if (!xpath) {
      return "";
    }
    const element = core.getElementFromXPath(xpath);
    if (!element) {
      return "";
    }
    if (isWithinImmutableExcludedBoundary(element)) {
      return "";
    }
    return getCurrentPageSnapshotXPath(element);
  };
  const explicitRows = Array.isArray(entry && entry.xpaths) ? entry.xpaths : [];
  explicitRows.forEach((item) => {
    if (!item || typeof item.xpath !== "string" || !item.excluded) {
      return;
    }
    const element = core.getElementFromXPath(item.xpath);
    if (!element || isWithinImmutableExcludedBoundary(element)) {
      return;
    }
    const xpath = getCurrentPageSnapshotXPath(element);
    if (!xpath) {
      return;
    }
    if (item.excluded) {
      explicitExcludedXpaths.add(xpath);
    }
  });
  (Array.isArray(entry && entry.includeXpaths) ? entry.includeXpaths : []).forEach((xpath) => {
    const normalized = toSnapshotXPath(xpath);
    if (normalized) {
      explicitIncludedXpaths.add(normalized);
    }
  });

  explicitExcludedXpaths.forEach((xpath) => pushRow(xpath, true));

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
  const stack = [{ node: document.body, insideImmutableExcluded: false }];
  while (stack.length) {
    const stackItem = stack.pop();
    const node = stackItem && stackItem.node;
    const insideImmutableExcluded = Boolean(stackItem && stackItem.insideImmutableExcluded);
    if (!node || node.nodeType !== 1) {
      continue;
    }
    const xpath = getCurrentPageSnapshotXPath(node);
    if (!xpath) {
      continue;
    }
    const immutableExcludedRoot = core.isImmutableExcludedElement(node);
    if (insideImmutableExcluded || immutableExcludedRoot) {
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push({
        node: node.children[i],
        insideImmutableExcluded: immutableExcludedRoot
      });
    }
    if (isAiSubmissionDocumentRootXpath(xpath)) {
      continue;
    }
    const explicitlyExcluded = explicitExcludedXpaths.has(xpath);
    const explicitlyIncluded = explicitIncludedXpaths.has(xpath);
    const insideExcludedAncestorRow = hasExcludedAncestorRow(xpath);
    let visibleToUser = false;
    let isMarkableTextual = false;
    if (!explicitlyExcluded) {
      visibleToUser = core.isVisibleForSubmission(node);
      if (
        !explicitlyIncluded &&
        !insideExcludedAncestorRow
      ) {
        isMarkableTextual = core.isMarkableElement(node, configValue, {
          allowParent: false,
          allowImmutableChildren: false,
          allowConsentElements: true,
          ignoreVisibilityForInclusionDetection: true
        });
      }
    }
    const submissionRow = resolveAiSubmissionRowState({
      explicitlyExcluded,
      explicitlyIncluded,
      insideExcludedAncestor: insideExcludedAncestorRow,
      visibleToUser,
      immutableExcludedRoot: false,
      hiddenToggleableRoot: false,
      markableTextual: isMarkableTextual
    });
    if (!submissionRow.shouldSubmit) {
      continue;
    }
    // Phase B ancestor guard: an implicit `markableTextual && !visibleToUser`
    // ancestor row must not over-promote a broad wrapper to excluded when a
    // visible descendant inside the same branch is already the canonical
    // content carrier. Without this guard, structural shells (article wrappers,
    // sticky columns, multi-line inlines whose primary bounding rect anchors
    // off-bounds) would be sent as `excluded: true` while their visible
    // descendant rows remain included, which is the failure shape observed in
    // field reproduction on long-form article layouts.
    if (
      submissionRow.excluded &&
      !explicitlyExcluded &&
      !insideExcludedAncestorRow &&
      hasVisibleMarkableTextualSubmissionDescendant(node, configValue)
    ) {
      continue;
    }
    pushRow(xpath, submissionRow.excluded);
  }
  return rows;
}

function hasVisibleMarkableTextualSubmissionDescendant(root, configValue) {
  if (!root || root.nodeType !== 1) {
    return false;
  }
  const children = root.children;
  if (!children || children.length === 0) {
    return false;
  }
  const stack = [];
  for (let i = 0; i < children.length; i += 1) {
    stack.push(children[i]);
  }
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (core.isImmutableExcludedElement(node)) {
      continue;
    }
    if (core.isVisibleForSubmission(node)) {
      const markable = core.isMarkableElement(node, configValue, {
        allowParent: false,
        allowImmutableChildren: false,
        allowConsentElements: true,
        ignoreVisibilityForInclusionDetection: true
      });
      if (markable) {
        return true;
      }
    }
    const childList = node.children;
    if (!childList || childList.length === 0) {
      continue;
    }
    for (let i = 0; i < childList.length; i += 1) {
      stack.push(childList[i]);
    }
  }
  return false;
}

function refreshEnabledAiHighlights() {
  if (!state.enabled || !state.baseUrl || !state.config) {
    return;
  }
  setSilentHighlightingPageMotionPaused(false);
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
  // Bump the generation token so any older refresh that is still awaiting an
  // async step can detect it has been superseded and bail out before mutating
  // observers, overlays, or render-key state with stale data.
  const refreshGeneration = ++silentHighlightingRefreshGeneration;
  if (state.enabled) {
    setSilentHighlightingPageMotionPaused(false);
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    refreshEnabledAiHighlights();
    return;
  }
  const pageUrl = location.href;
  const configs = await config.getConfigs();
  if (refreshGeneration !== silentHighlightingRefreshGeneration) {
    return;
  }
  const baseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  if (!baseUrl) {
    silentHighlightEditorRevealKey = "";
    setSilentHighlightingPageMotionPaused(false);
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);
    return;
  }
  const holdSilentMotionPause = Boolean(
    propertyLockState &&
    propertyLockState.isEditor &&
    !silentHighlightEditorRevealInFlight
  );
  setSilentHighlightingPageMotionPaused(holdSilentMotionPause);
  const normalized = config.normalizeConfig(baseUrl, configs[baseUrl]);
  const baseConfig = normalized.config || {};
  if (normalized.changed) {
    configs[baseUrl] = baseConfig;
    await config.saveConfigs(configs);
    if (refreshGeneration !== silentHighlightingRefreshGeneration) {
      return;
    }
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
  const newlyHiddenConsentCount = core.hideConsentElements();
  const hasHiddenConsent =
    newlyHiddenConsentCount > 0 ||
    Boolean(document.querySelector(`[${core.CONSENT_HIDDEN_ATTR}]`));
  const shouldObserve = hasSelectorHighlights || hasHiddenConsent;
  if (!shouldObserve) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(holdSilentMotionPause);
    return;
  }
  let contentNodes = [];
  let excludedNodes = [];
  let immutableNodes = [];
  let renderCollections = buildSilentHighlightRenderableCollections({
    sourceImmutableNodes: [],
    sourceContentNodes: [],
    sourceExcludedNodes: [],
    sourceExplicitIncludeNodes: [],
    sourceInclusionSelectorByNode: new Map(),
    sourceExclusionSelectorByNode: new Map()
  });
  if (hasSelectorHighlights) {
    try {
      // Run the (synchronous) source-set collection inside the shared
      // element-computation cache so the deep helper graph
      // (collectImplicitIncludedNodesOutsideExplicit, hasRenderableTextForHighlight,
      // isInclusionEligibleNode, ...) memoizes visibility / text / immutable
      // lookups per pass instead of recomputing them per node. Scoped to this
      // synchronous call only — no awaits inside — so cached layout cannot go
      // stale across a yield. (Plan item 50 sub-6; also cuts sub-2 blocking time.)
      const contentMarking = core.withElementComputationCache(() =>
        collectIncludedNodesFromSelectorSet(effectiveSelectorSet)
      );
      // Yield to the event loop between source-set computation and renderable
      // expansion so a long page can break up the synchronous work. The next
      // task re-checks the generation token; a newer refresh that started
      // while we were computing source nodes wins and this older call bails.
      await new Promise((resolve) => {
        if (typeof window.setTimeout !== "function") {
          resolve();
          return;
        }
        window.setTimeout(resolve, 0);
      });
      if (refreshGeneration !== silentHighlightingRefreshGeneration) {
        return;
      }
      const excludedSourcesForSilentOverlay = Array.isArray(contentMarking.excluded)
        ? contentMarking.excluded
        : [];
      const immutableSourcesForSilentOverlay = Array.isArray(contentMarking.immutableExcluded)
        ? contentMarking.immutableExcluded
        : [];
      const explicitIncludedSources = Array.isArray(contentMarking.explicitIncluded)
        ? contentMarking.explicitIncluded
        : [];
      renderCollections = buildSilentHighlightRenderableCollections({
        sourceImmutableNodes: immutableSourcesForSilentOverlay,
        sourceContentNodes: contentMarking.included,
        sourceExcludedNodes: excludedSourcesForSilentOverlay,
        sourceExplicitIncludeNodes: explicitIncludedSources,
        sourceHiddenExplicitIncludeNodes: contentMarking.hiddenExplicitIncluded,
        sourceInclusionSelectorByNode: contentMarking.inclusionSelectorByNode,
        sourceExclusionSelectorByNode: contentMarking.exclusionSelectorByNode
      });
      immutableNodes = renderCollections.immutableNodes;
      contentNodes = renderCollections.contentNodes;
      excludedNodes = renderCollections.excludedNodes;
    } catch {
      // Keep other silent highlighting features active even if selector processing fails.
      immutableNodes = [];
      contentNodes = [];
      excludedNodes = [];
      renderCollections = buildSilentHighlightRenderableCollections({
        sourceImmutableNodes: [],
        sourceContentNodes: [],
        sourceExcludedNodes: [],
        sourceExplicitIncludeNodes: [],
        sourceInclusionSelectorByNode: new Map(),
        sourceExclusionSelectorByNode: new Map()
      });
    }
  }
  const shouldBeActive =
    immutableNodes.length > 0 || contentNodes.length > 0 || excludedNodes.length > 0;
  const renderKey = buildSilentHighlightingRenderKey(
    immutableNodes,
    contentNodes,
    excludedNodes,
    renderCollections.ghostContentNodes,
    renderCollections.explicitIncludeSelectorByNode,
    renderCollections.excludedSelectorByNode,
    renderCollections.explicitIncludeXpathByNode,
    renderCollections.excludedXpathByNode,
    renderCollections.implicitIncludeXpathByNode
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
  // Yield to the browser before the overlay DOM write so paint/layout work that
  // queued up during source collection can flush. The previous overlay stays in
  // place during the yield, and a newer refresh that bumps the generation token
  // mid-yield will cause this stale call to bail without mutating anything.
  const applyOverlayUpdate = () => {
    if (refreshGeneration !== silentHighlightingRefreshGeneration) {
      return;
    }
    if (shouldRenderOverlay) {
      // Updating an already-live overlay (it was active and stays active) keeps
      // it visible and repaints rects in place: boxes are reused DOM nodes whose
      // positions/membership update atomically in this synchronous rAF pass, so
      // there is no half-built frame to hide. Running the hide->reveal cycle on
      // every full refresh - including the common case where a DOM mutation
      // re-runs the pipeline with identical output - is what blinked the overlay.
      // Only the initial paint (inactive -> active, or no overlay yet) uses the
      // hide->reveal transition so the first reveal is correctly scheduled.
      const overlayAlreadyLive =
        lastSilentHighlightingsActive && shouldBeActive && Boolean(silentHighlightOverlay);
      renderSilentHighlightOverlay(renderCollections, { keepVisible: overlayAlreadyLive });
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
  };
  if (!shouldRenderOverlay && !renderChanged) {
    applyOverlayUpdate();
    return;
  }
  await new Promise((resolve) => {
    if (typeof window.requestAnimationFrame !== "function") {
      applyOverlayUpdate();
      resolve();
      return;
    }
    window.requestAnimationFrame(() => {
      applyOverlayUpdate();
      resolve();
    });
  });
}

/**
 * Check if marking interactions should be blocked due to property lock.
 */
function isMarkingBlockedByPropertyLock() {
  if (!isPropertyLockCollaborationEnabled()) {
    return false;
  }
  return propertyLockBannerVisible &&
    propertyLockBannerMode !== "no_banner" &&
    propertyLockState &&
    !propertyLockState.isEditor;
}

function isPropertyLockDisconnectedForInteractionBlock() {
  if (!isPropertyLockCollaborationEnabled()) {
    return false;
  }
  return propertyLockBannerVisible && propertyLockBannerMode === "editor_disconnect_countdown";
}

function isPropertyLockInactivityWarningForInteractionBlock() {
  if (!isPropertyLockCollaborationEnabled()) {
    return false;
  }
  return propertyLockBannerVisible && propertyLockBannerMode === "editor_inactivity_warning";
}

function isPropertyLockInteractionBlocked() {
  if (!isPropertyLockCollaborationEnabled()) {
    return false;
  }
  return isMarkingBlockedByPropertyLock() ||
    isPropertyLockDisconnectedForInteractionBlock() ||
    isPropertyLockInactivityWarningForInteractionBlock();
}

function showPropertyLockBlockedToast() {
  if (!isPropertyLockCollaborationEnabled()) {
    return;
  }
  const now = Date.now();
  if (now - propertyLockLastBlockedToastAt < 1200) {
    return;
  }
  propertyLockLastBlockedToastAt = now;
  if (isPropertyLockDisconnectedForInteractionBlock()) {
    showPageToast(propertyLockText.disconnectedInteractionBlockedToast);
    return;
  }
  if (isPropertyLockInactivityWarningForInteractionBlock()) {
    showPageToast(propertyLockText.inactivityInteractionBlockedToast);
    return;
  }
  const editorName = propertyLockState?.editorName || "Someone";
  showPageToast(propertyLockText.lockedInteractionBlockedToast(editorName));
}

function checkPropertyLockBlocksMarking() {
  if (!isPropertyLockCollaborationEnabled()) {
    return true;
  }
  if (!isPropertyLockInteractionBlocked()) {
    return true;
  }
  showPropertyLockBlockedToast();
  return false;
}

function getPropertyLockClientId() {
  if (propertyLockClientId) {
    return propertyLockClientId;
  }
  try {
    const existing = window.sessionStorage.getItem(PROPERTY_LOCK_CLIENT_SESSION_KEY);
    if (existing && typeof existing === "string") {
      const normalizedExisting = normalizePropertyLockClientId(existing);
      if (normalizedExisting) {
        propertyLockClientId = normalizedExisting;
        return propertyLockClientId;
      }
    }
  } catch (error) {
    // sessionStorage can be unavailable on some pages; fall back to memory.
  }
  return setPropertyLockClientId(createPropertyLockClientId());
}

function setPropertyLockClientId(nextClientId) {
  const normalizedClientId = normalizePropertyLockClientId(nextClientId);
  if (!normalizedClientId) {
    return propertyLockClientId || "";
  }
  propertyLockClientId = normalizedClientId;
  try {
    window.sessionStorage.setItem(PROPERTY_LOCK_CLIENT_SESSION_KEY, normalizedClientId);
  } catch (error) {
    // In-memory fallback remains valid for the current content-script lifetime.
  }
  return propertyLockClientId;
}

function getPropertyLockDraftStatusPayload() {
  const pageUrl = location.href;
  return {
    clientId: getPropertyLockClientId(),
    pageUrl,
    hasUnsavedChanges: Boolean(state.enabled && core.isPageDraftDirty(pageUrl))
  };
}

function sendPropertyLockDraftStatus() {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  const portClient = getPropertyLockPortClient();
  if (!portClient.hasPort()) {
    return;
  }
  try {
    portClient.postMessage({
      type: PROPERTY_LOCK_CONTENT_DRAFT_STATUS,
      ...getPropertyLockDraftStatusPayload()
    });
  } catch (error) {
    // Activity/reconnect paths will repair the port if it has already closed.
  }
}

function handleBlockedPropertyLockInteraction(event) {
  if (!isPropertyLockCollaborationEnabled()) {
    return;
  }
  const blockDuringDisconnect = isPropertyLockDisconnectedForInteractionBlock();
  const blockDuringInactivityWarning = isPropertyLockInactivityWarningForInteractionBlock();
  const blockDuringEditorWarning =
    blockDuringDisconnect ||
    blockDuringInactivityWarning;
  if ((!blockDuringEditorWarning && !isMarkingBlockedByPropertyLock()) || !event || !event.isTrusted) {
    return;
  }

  const target = event.target && event.target.nodeType === 1 ? event.target : null;
  const isInactivityRescueControl = Boolean(
    blockDuringInactivityWarning &&
    target &&
    typeof target.closest === "function" &&
    target.closest(`#${PROPERTY_LOCK_BANNER_ID} .uf-lock-banner-continue-editing`)
  );
  if (isInactivityRescueControl) {
    return;
  }
  if (
    !blockDuringEditorWarning &&
    target &&
    typeof target.closest === "function" &&
    target.closest('[data-uf-extension-ui="true"]')
  ) {
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
  propertyLockOffCandidateDeadlineAt = 0;
  propertyLockBannerCountdownValue = 0;
  if (isPropertyLockCollaborationEnabled()) {
    void utils.sendRuntimeMessage({
      type: "setTabState",
      scope: "initial",
      state: {
        active: true,
        propertyLockOffCandidateDeadlineAt: 0
      }
    }).catch(() => null);
  }
  updatePropertyLockBannerMode();
  renderPropertyLockBanner();
}

function normalizePropertyLockRecoveryTabState(tabState) {
  return getPropertyLockStateMachine().normalizeRecoveryTabState(tabState);
}

function loadPropertyLockRecoveryTabState() {
  if (!isPropertyLockCollaborationEnabled()) {
    return Promise.resolve(normalizePropertyLockRecoveryTabState(null));
  }
  return utils.sendRuntimeMessage({
    type: "getTabState",
    scope: "initial",
    nullIfMissing: true
  }).then((tabState) => normalizePropertyLockRecoveryTabState(tabState)).catch(() =>
    normalizePropertyLockRecoveryTabState(null)
  );
}

function persistPropertyLockRecoveryState({ siteId = null, baseUrl = "", clientId = "", deadlineAt = 0 } = {}) {
  return getPropertyLockStateMachine().persistRecoveryState({
    siteId,
    baseUrl,
    clientId,
    deadlineAt
  });
}

function persistPropertyLockOffCandidateDeadline(deadlineAt) {
  return getPropertyLockStateMachine().persistOffCandidateDeadline(deadlineAt);
}

function clearPropertyLockOffCandidateWarning() {
  return getPropertyLockStateMachine().clearOffCandidateWarning();
}

function clearPropertyLockRecoveryReleaseTimer() {
  if (!propertyLockRecoveryReleaseTimer) {
    return;
  }
  window.clearTimeout(propertyLockRecoveryReleaseTimer);
  propertyLockRecoveryReleaseTimer = 0;
}

function clearPropertyLockCrossPropertyWarning(options = {}) {
  return getPropertyLockStateMachine().clearCrossPropertyWarning(options);
}

function armPropertyLockCrossPropertyRelease() {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  clearPropertyLockRecoveryReleaseTimer();
  if (
    !propertyLockRecoverySiteId ||
    !propertyLockRecoveryClientId ||
    propertyLockRecoveryDeadlineAt <= Date.now()
  ) {
    return;
  }
  propertyLockRecoveryReleaseTimer = window.setTimeout(() => {
    propertyLockRecoveryReleaseTimer = 0;
    if (
      !propertyLockRecoverySiteId ||
      !propertyLockRecoveryClientId ||
      propertyLockRecoveryDeadlineAt <= 0 ||
      propertyLockRecoveryDeadlineAt > Date.now()
    ) {
      return;
    }
    const recoverySiteId = propertyLockRecoverySiteId;
    const recoveryClientId = propertyLockRecoveryClientId;
    clearPropertyLockCrossPropertyWarning();
    void utils.sendRuntimeMessage({
      type: PROPERTY_LOCK_CONTENT_RELEASE,
      siteId: recoverySiteId,
      clientId: recoveryClientId
    }).catch(() => null);
    runPropertyLockSync({ forceSiteIdRefresh: true });
  }, Math.max(1, propertyLockRecoveryDeadlineAt - Date.now() + 100));
}

function startPropertyLockCrossPropertyWarning(recoveryState) {
  return getPropertyLockStateMachine().startCrossPropertyWarning(recoveryState);
}

function startPropertyLockOffCandidateWarning() {
  return getPropertyLockStateMachine().startOffCandidateWarning();
}

function clearPropertyLockReconnectTimer() {
  getPropertyLockPortClient().clearReconnectTimer();
}

function schedulePropertyLockReconnect(options = {}) {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  getPropertyLockPortClient().scheduleReconnect(options);
}

function disconnectPropertyLockPort(options = {}) {
  const { notifyBackground = true } = options || {};
  getPropertyLockPortClient().disconnect({ notifyBackground });
  resetPropertyLockUiState();
}

function markExtensionContextInvalidated(error) {
  if (!utils.isExtensionContextInvalidatedError(error)) {
    return false;
  }
  extensionContextInvalidated = true;
  teardownPageTelemetryBridge();
  propertyLockSyncToken += 1;
  disconnectPropertyLockPort({ notifyBackground: false });
  return true;
}

function handlePropertyLockSyncError(error, options = {}) {
  if (markExtensionContextInvalidated(error)) {
    return;
  }
  logContentDiagnostic("warn", "[Unfluffify] Property lock sync failed; retrying.", error);
  disconnectPropertyLockPort({ notifyBackground: false });
  schedulePropertyLockReconnect(options);
}

function queuePropertyLockEditorClaim() {
  if (!isPropertyLockCollaborationEnabled()) {
    return;
  }
  propertyLockEditorClaimPending = true;
}

function mergePropertyLockSyncOptions(currentOptions = {}, incomingOptions = {}) {
  const mergedOptions = {};
  const currentPageUrl = typeof currentOptions.pageUrl === "string" && currentOptions.pageUrl
    ? currentOptions.pageUrl
    : "";
  const incomingPageUrl = typeof incomingOptions.pageUrl === "string" && incomingOptions.pageUrl
    ? incomingOptions.pageUrl
    : "";
  const mergedPageUrl = incomingPageUrl || currentPageUrl;
  if (mergedPageUrl) {
    mergedOptions.pageUrl = mergedPageUrl;
  }
  if (Boolean(currentOptions.forceSiteIdRefresh) || Boolean(incomingOptions.forceSiteIdRefresh)) {
    mergedOptions.forceSiteIdRefresh = true;
  }
  return mergedOptions;
}

function flushQueuedPropertyLockEditorClaim() {
  if (!ensurePropertyLockCollaborationActive()) {
    propertyLockEditorClaimPending = false;
    return;
  }
  if (!propertyLockEditorClaimPending) {
    return;
  }
  if (propertyLockState && propertyLockState.isEditor) {
    propertyLockEditorClaimPending = false;
    return;
  }
  propertyLockEditorClaimPending = false;
  sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
}

function runPropertyLockSync(options = {}) {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (extensionContextInvalidated) {
    return;
  }
  const nextOptions = mergePropertyLockSyncOptions({}, options);
  if (propertyLockSyncInFlight) {
    propertyLockQueuedSyncOptions = mergePropertyLockSyncOptions(
      propertyLockQueuedSyncOptions || {},
      nextOptions
    );
    return;
  }

  propertyLockSyncInFlight = true;
  (async () => {
    let activeOptions = nextOptions;
    while (!extensionContextInvalidated) {
      try {
        await syncPropertyLockConnection(activeOptions);
      } catch (error) {
        handlePropertyLockSyncError(error, activeOptions);
      }
      if (!propertyLockQueuedSyncOptions) {
        break;
      }
      activeOptions = propertyLockQueuedSyncOptions;
      propertyLockQueuedSyncOptions = null;
    }
    propertyLockSyncInFlight = false;
    if (propertyLockQueuedSyncOptions && !extensionContextInvalidated) {
      const queuedOptions = propertyLockQueuedSyncOptions;
      propertyLockQueuedSyncOptions = null;
      runPropertyLockSync(queuedOptions);
    }
  })();
}

async function syncPropertyLockConnection(options = {}) {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (extensionContextInvalidated) {
    return;
  }
  const syncToken = ++propertyLockSyncToken;
  clearPropertyLockReconnectTimer();
  const pageUrl = typeof options.pageUrl === "string" && options.pageUrl
    ? options.pageUrl
    : location.href;
  const forceSiteIdRefresh = Boolean(options.forceSiteIdRefresh);
  const recoveryState = await loadPropertyLockRecoveryTabState();
  if (recoveryState.clientId && recoveryState.baseUrl && utils.isPageWithinBaseUrl(pageUrl, recoveryState.baseUrl)) {
    setPropertyLockClientId(recoveryState.clientId);
    propertyLockRecoverySiteId = recoveryState.siteId;
    propertyLockRecoveryBaseUrl = recoveryState.baseUrl;
    propertyLockRecoveryClientId = recoveryState.clientId;
    propertyLockRecoveryDeadlineAt = recoveryState.deadlineAt;
    clearPropertyLockCrossPropertyWarning({ preserveSession: true });
  } else if (recoveryState.offCandidateDeadlineAt > Date.now()) {
    propertyLockOffCandidateDeadlineAt = recoveryState.offCandidateDeadlineAt;
  }

  if (
    recoveryState.siteId &&
    recoveryState.baseUrl &&
    recoveryState.clientId &&
    !utils.isPageWithinBaseUrl(pageUrl, recoveryState.baseUrl)
  ) {
    if (getPropertyLockPortClient().hasPort()) {
      disconnectPropertyLockPort();
    }
    startPropertyLockCrossPropertyWarning(recoveryState);
    return;
  }

  let target = null;
  try {
    target = await resolveCurrentPropertyLockConnectionTarget({
      pageUrl,
      forceSiteIdRefresh
    });
  } catch (error) {
    if (markExtensionContextInvalidated(error)) {
      return;
    }
    throw error;
  }

  if (extensionContextInvalidated || syncToken !== propertyLockSyncToken) {
    return;
  }

  if (pageUrl !== location.href) {
    runPropertyLockSync({
      pageUrl: location.href,
      forceSiteIdRefresh: true
    });
    return;
  }

  if (!target || !target.ok || !target.siteId) {
    disconnectPropertyLockPort();
    return;
  }

  const siteId = target.siteId;
  propertyLockConnectedBaseUrl = target.baseUrl || "";
  const portClient = getPropertyLockPortClient();
  if (!(portClient.hasPort() && propertyLockConnectedSiteId === siteId)) {
    if (portClient.hasPort()) {
      disconnectPropertyLockPort();
    }

    propertyLockConnectedSiteId = siteId;
    propertyLockConnectedBaseUrl = target.baseUrl || "";

    try {
      portClient.connect({
        connectPayload: {
          type: PROPERTY_LOCK_CONTENT_CONNECT,
          siteId,
          ...getPropertyLockDraftStatusPayload()
        },
        onMessage: handlePropertyLockPortMessage,
        onDisconnect: (disconnectReason) => {
          propertyLockConnectedSiteId = null;
          propertyLockConnectedBaseUrl = "";
          propertyLockEditorClaimPending = false;
          resetPropertyLockUiState();
          if (markExtensionContextInvalidated(disconnectReason)) {
            return;
          }
          schedulePropertyLockReconnect();
        }
      });
      queuePropertyLockEditorClaim();
    } catch (error) {
      if (markExtensionContextInvalidated(error)) {
        return;
      }
      propertyLockConnectedSiteId = null;
      propertyLockConnectedBaseUrl = "";
      propertyLockEditorClaimPending = false;
      resetPropertyLockUiState();
      schedulePropertyLockReconnect({ forceSiteIdRefresh });
      return;
    }
    return;
  }

  // Same-property navigations can keep the existing lock connection alive.
  // Re-run activation/refresh so reveal+freeze still executes per visited page.
  clearPropertyLockCrossPropertyWarning({ preserveSession: true });
  sendPropertyLockActivity();
  let shouldRunEditorActivation = Boolean(propertyLockState && propertyLockState.isEditor);
  if (!shouldRunEditorActivation) {
    const snapshot = await fetchPropertyLockStateSnapshot(siteId);
    if (
      extensionContextInvalidated ||
      syncToken !== propertyLockSyncToken ||
      pageUrl !== location.href
    ) {
      return;
    }
    const snapshotState = snapshot && snapshot.state && typeof snapshot.state === "object"
      ? snapshot.state
      : null;
    if (snapshotState) {
      propertyLockState = snapshotState;
      updatePropertyLockBannerMode();
      renderPropertyLockBanner();
      shouldRunEditorActivation = Boolean(snapshotState.isEditor);
    }
  }
  if (shouldRunEditorActivation) {
    await syncPropertyLockOffCandidateWarning(target.baseUrl || "", pageUrl);
    runEditorSilentHighlightingActivation().catch(() => {
      // Best-effort activation refresh for same-site navigation sync.
    });
    return;
  }
  await syncPropertyLockOffCandidateWarning(target.baseUrl || "", pageUrl);
  refreshSilentHighlightings().then();
}

function handlePropertyLockPortMessage(message) {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (!message || typeof message !== "object") {
    return;
  }

  if (typeof message.clientId === "string" && message.clientId) {
    setPropertyLockClientId(message.clientId);
  }

  if (
    message.type === PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS &&
    message.connectionStatus === PROPERTY_LOCK_CONNECTION_CONNECTED
  ) {
    flushQueuedPropertyLockEditorClaim();
    return;
  }

  const { type, message: serverMessage } = message;
  if (type !== PROPERTY_LOCK_BACKGROUND_STATE_UPDATE || !serverMessage || typeof serverMessage !== "object") {
    return;
  }

  applyPropertyLockServerMessage(serverMessage);
  if (serverMessage.type === PROPERTY_LOCK_WS_LOCK_STATE) {
    flushQueuedPropertyLockEditorClaim();
  }
}

function sendPropertyLockActivity() {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (extensionContextInvalidated) {
    return;
  }
  const portClient = getPropertyLockPortClient();
  if (!portClient.hasPort()) {
    schedulePropertyLockReconnect();
    return;
  }
  try {
    portClient.postMessage({
      type: PROPERTY_LOCK_CONTENT_ACTIVITY,
      ...getPropertyLockDraftStatusPayload()
    });
  } catch (error) {
    if (markExtensionContextInvalidated(error)) {
      return;
    }
    propertyLockConnectedSiteId = null;
    propertyLockConnectedBaseUrl = "";
    propertyLockEditorClaimPending = false;
    resetPropertyLockUiState();
    schedulePropertyLockReconnect();
  }
}

function sendPropertyLockMessage(type, payload = {}) {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (extensionContextInvalidated) {
    return;
  }
  const portClient = getPropertyLockPortClient();
  if (!portClient.hasPort()) {
    schedulePropertyLockReconnect();
    return;
  }
  try {
    portClient.postMessage({
      type,
      ...getPropertyLockDraftStatusPayload(),
      ...payload
    });
  } catch (error) {
    if (markExtensionContextInvalidated(error)) {
      return;
    }
    propertyLockConnectedSiteId = null;
    propertyLockConnectedBaseUrl = "";
    propertyLockEditorClaimPending = false;
    resetPropertyLockUiState();
    schedulePropertyLockReconnect();
  }
}

async function fetchPropertyLockStateSnapshot(siteId) {
  if (!ensurePropertyLockCollaborationActive()) {
    return null;
  }
  const normalizedSiteId = normalizeSiteIdValue(siteId);
  if (!normalizedSiteId) {
    return null;
  }
  try {
    return await utils.sendRuntimeMessage({
      type: PROPERTY_LOCK_BACKGROUND_GET_STATE,
      siteId: normalizedSiteId,
      clientId: getPropertyLockClientId()
    });
  } catch {
    return null;
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

function createXPathElementCache() {
  const cache = new Map();
  return (xpath) => {
    if (!xpath) {
      return null;
    }
    if (!cache.has(xpath)) {
      cache.set(xpath, core.getElementFromXPath(xpath));
    }
    return cache.get(xpath);
  };
}

function isSameOrDescendantByElementOrXPath(parentXpath, parentElement, childXpath, childElement) {
  if (!parentXpath || !childXpath) {
    return false;
  }
  if (parentXpath === childXpath) {
    return true;
  }
  if (parentElement && childElement) {
    return parentElement.contains(childElement);
  }
  return core.isXPathDescendant(parentXpath, childXpath);
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
  return getPropertyLockStateMachine().applyServerMessage(serverMessage);
}

function createPropertyLockStateMachineDeps() {
  return {
    armPropertyLockCrossPropertyRelease,
    clearPropertyLockBannerCountdown,
    clearPropertyLockRecoveryReleaseTimer,
    clearSilentHighlightEditorRevealKey: () => {
      silentHighlightEditorRevealKey = "";
    },
    ensurePropertyLockCollaborationActive,
    getBaseUrl: () => state.baseUrl,
    getCurrentUrl: () => location.href,
    getPropertyLockBannerCountdownTimer: () => propertyLockBannerCountdownTimer,
    getPropertyLockBannerCountdownValue: () => propertyLockBannerCountdownValue,
    getPropertyLockBannerMode: () => propertyLockBannerMode,
    getPropertyLockClientId: () => getPropertyLockClientId(),
    getPropertyLockConnectedBaseUrl: () => propertyLockConnectedBaseUrl,
    getPropertyLockConnectedSiteId: () => propertyLockConnectedSiteId,
    getPropertyLockOffCandidateDeadlineAt: () => propertyLockOffCandidateDeadlineAt,
    getPropertyLockRecoveryBaseUrl: () => propertyLockRecoveryBaseUrl,
    getPropertyLockRecoveryClientId: () => propertyLockRecoveryClientId,
    getPropertyLockRecoveryDeadlineAt: () => propertyLockRecoveryDeadlineAt,
    getPropertyLockRecoverySiteId: () => propertyLockRecoverySiteId,
    getPropertyLockState: () => propertyLockState,
    getPropertyLockSuggestionFromName: () => propertyLockSuggestionFromName,
    getPropertyLockSuggestionId: () => propertyLockSuggestionId,
    getTimerHost: () => window,
    isPropertyLockCollaborationEnabled,
    isRenderModeInspectionActive,
    normalizePropertyLockClientId,
    propertyLockText,
    refreshSilentHighlightings,
    renderPropertyLockBanner,
    restartPropertyLockBannerCountdown,
    runEditorSilentHighlightingActivation,
    sendPropertyLockMessage,
    sendRuntimeMessage: (message) => utils.sendRuntimeMessage(message),
    setPropertyLockBannerCountdownValue: (value) => {
      propertyLockBannerCountdownValue = value;
    },
    setPropertyLockBannerMode: (mode) => {
      propertyLockBannerMode = mode;
    },
    setPropertyLockOffCandidateDeadlineAt: (deadlineAt) => {
      propertyLockOffCandidateDeadlineAt = deadlineAt;
    },
    setPropertyLockRecoveryBaseUrl: (baseUrl) => {
      propertyLockRecoveryBaseUrl = baseUrl;
    },
    setPropertyLockRecoveryClientId: (clientId) => {
      propertyLockRecoveryClientId = clientId;
    },
    setPropertyLockRecoveryDeadlineAt: (deadlineAt) => {
      propertyLockRecoveryDeadlineAt = deadlineAt;
    },
    setPropertyLockRecoverySiteId: (siteId) => {
      propertyLockRecoverySiteId = siteId;
    },
    setPropertyLockState: (nextState) => {
      propertyLockState = nextState;
    },
    setPropertyLockSuggestionFromName: (fromName) => {
      propertyLockSuggestionFromName = fromName;
    },
    setPropertyLockSuggestionId: (suggestionId) => {
      propertyLockSuggestionId = suggestionId;
    },
    showPageToast,
    syncPropertyLockOffCandidateWarning,
    updatePropertyLockBannerMode,
    PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS,
    PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS,
    PROPERTY_LOCK_CONNECTION_UNAVAILABLE,
    PROPERTY_LOCK_CONTENT_RELEASE,
    PROPERTY_LOCK_CROSS_PROPERTY_COOLDOWN_TIMEOUT_MS,
    PROPERTY_LOCK_OFF_CANDIDATE_WARNING_TIMEOUT_MS,
    PROPERTY_LOCK_WS_DISCONNECT_WARNING,
    PROPERTY_LOCK_WS_ERROR,
    PROPERTY_LOCK_WS_INACTIVITY_WARNING,
    PROPERTY_LOCK_WS_LOCK_STATE,
    PROPERTY_LOCK_WS_SUGGESTION_ACCEPTED,
    PROPERTY_LOCK_WS_SUGGESTION_PENDING,
    PROPERTY_LOCK_WS_SUGGESTION_RESPONSE,
    PROPERTY_LOCK_WS_TAKEOVER_SUGGESTION,
    PROPERTY_LOCK_WS_TRANSFER_COUNTDOWN
  };
}

function updatePropertyLockBannerMode() {
  return updatePropertyLockBannerModeOperation(createPropertyLockBannerModeDeps());
}

function createPropertyLockBannerModeDeps() {
  return {
    isPropertyLockCollaborationEnabled,
    clearPropertyLockBannerCountdown,
    restartPropertyLockBannerCountdown,
    clearPropertyLockCrossPropertyWarning,
    clearPropertyLockOffCandidateWarning,
    getPropertyLockRecoveryDeadlineAt: () => propertyLockRecoveryDeadlineAt,
    getPropertyLockOffCandidateDeadlineAt: () => propertyLockOffCandidateDeadlineAt,
    getPropertyLockState: () => propertyLockState,
    getPropertyLockBannerMode: () => propertyLockBannerMode,
    setPropertyLockBannerMode: (mode) => {
      propertyLockBannerMode = mode;
    },
    getPropertyLockBannerCountdownValue: () => propertyLockBannerCountdownValue,
    setPropertyLockBannerCountdownValue: (value) => {
      propertyLockBannerCountdownValue = value;
    },
    PROPERTY_LOCK_STATE_UNLOCKED,
    PROPERTY_LOCK_STATE_LOCKED,
    PROPERTY_LOCK_STATE_EXPIRY_WARNING,
    PROPERTY_LOCK_STATE_TAKEOVER_AVAILABLE,
    PROPERTY_LOCK_STATE_TRANSFER,
    PROPERTY_LOCK_CONNECTION_LOSS_TIMEOUT_MS
  };
}

function createPageToastDeps() {
  return {
    EXTENSION_UI_FONT_STACK,
    PAGE_TOAST_ID,
    PAGE_TOAST_STYLE_ID,
    TOAST_VISIBLE_MS: 3000,
    getDocument: () => document,
    getWindow: () => window
  };
}

function createRenderModeInspectionClientDeps() {
  return {
    RENDER_MODE_INSPECTION_SESSION_KEY,
    getWindow: () => window
  };
}

function createInspectionStatusDeps() {
  return {
    getCurrentContentMode,
    getPageSaveReconciliationState: (pageUrl) => core.getPageSaveReconciliationState(pageUrl),
    getPageUrl: () => location.href,
    getPropertyLockEditorClaimPending: () => propertyLockEditorClaimPending,
    getSilentHighlightEditorActivationPromise: () => silentHighlightEditorActivationPromise,
    isMarkingEnabled: () => Boolean(state.enabled),
    isPageInspectionUiActive: () => core.isPageInspectionUiActive(),
    isPageSaveReconciliationPending: (pageUrl) => core.isPageSaveReconciliationPending(pageUrl),
    isRenderModeInspectionActive,
    SILENT_HIGHLIGHTING_PREPARATION_REASON
  };
}

function createAiPreviewStateResponseDeps() {
  return {
    FEATURE_DISABLED_REASON,
    getAiPreviewState: () => aiPreviewState,
    isPreviewExpandedStatesEnabled: () => isFeatureEnabled("previewExpandedStates")
  };
}

function createAiPreviewCloseHandlerDeps() {
  return {
    exitAiPreviewMode,
    hasAiPopover: () => core.hasAiPopover(),
    isAiPreviewActive: () => aiPreviewState.active,
    requestAiPopoverClose: () => core.requestAiPopoverClose()
  };
}

function createAiPreviewComputeLockHandlerDeps() {
  return {
    beginAiPreviewMode,
    clearComputeLockReleaseTimer: () => {
      if (aiComputeLockReleaseTimer) {
        window.clearTimeout(aiComputeLockReleaseTimer);
        aiComputeLockReleaseTimer = 0;
      }
    },
    exitAiPreviewMode,
    hasComputeLockReleaseTimer: () => Boolean(aiComputeLockReleaseTimer),
    isComputeLockPreviewActive: () => aiPreviewState.active && aiPreviewState.mode === "compute_lock",
    refreshSilentHighlightings,
    scheduleAiComputeLockRelease,
    setAiPreviewItems
  };
}

function createAiPreviewExpandedModeHandlerDeps() {
  return {
    buildExpandedModeDisabledResponse: () =>
      getAiPreviewStateResponseBuilder().buildExpandedModeDisabledResponse(),
    buildExpandedModeResponse: (ok) =>
      getAiPreviewStateResponseBuilder().buildExpandedModeResponse(ok),
    isPreviewExpandedStatesEnabled: () => isFeatureEnabled("previewExpandedStates"),
    setAiPreviewExpandedMode
  };
}

function createRemoteSupportStateHandlerDeps() {
  return {
    applyRemoteSupportSessionState,
    getRemoteSupportMode,
    getRemoteSupportRole
  };
}

function createRenderModeInspectionHandlersDeps() {
  return {
    armRenderModeInspectionWatchdog,
    cancelSilentHighlightEditorActivation,
    createCurrentPageSnapshot,
    createLifecycleOperationId,
    emitLifecycleEvent,
    fetchCurrentPageRawHtml,
    finishPageInspectionUi: () => core.finishPageInspectionUi(),
    getPageUrl: () => location.href,
    getPropertyLockBannerMode: () => propertyLockBannerMode,
    getSilentHighlightEditorRevealInFlight: () => silentHighlightEditorRevealInFlight,
    hideConsentElements: () => core.hideConsentElements(),
    isPageWithinBaseUrl: (pageUrl, baseUrl) => utils.isPageWithinBaseUrl(pageUrl, baseUrl),
    isRenderModeInspectionActive,
    isRenderModeInspectionFlagSet: () => renderModeInspectionActive,
    nextRevealId: () => ++silentHighlightEditorActivationIdCounter,
    renderPropertyLockBanner,
    resolveBaseUrlForCurrentPage,
    setRenderModeInspectionActive,
    setSilentHighlightEditorRevealInFlight: (value) => {
      silentHighlightEditorRevealInFlight = value;
    },
    updatePropertyLockBannerMode,
    warmupSilentHighlightingBeforeMotionPause: (baseUrl, pageUrl, reason, options) =>
      core.warmupSilentHighlightingBeforeMotionPause(baseUrl, pageUrl, reason, options),
    LIFECYCLE_KINDS,
    LIFECYCLE_PHASES,
    SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON
  };
}

function createPropertyLockPortClientDeps() {
  return {
    connectRuntimePort: (options) => chrome.runtime.connect(options),
    consumeRuntimeLastErrorMessage: () => {
      try {
        if (!globalThis.chrome || !chrome.runtime) {
          return "";
        }
        const lastError = chrome.runtime.lastError;
        return lastError && typeof lastError.message === "string" ? lastError.message : "";
      } catch (error) {
        if (utils.isExtensionContextInvalidatedError(error)) {
          return error && error.message ? error.message : "Extension context invalidated.";
        }
        throw error;
      }
    },
    getClientId: () => getPropertyLockClientId(),
    getConnectedSiteId: () => propertyLockConnectedSiteId,
    getTimerHost: () => window,
    onPortCleared: () => {
      propertyLockConnectedSiteId = null;
      propertyLockConnectedBaseUrl = "";
      propertyLockEditorClaimPending = false;
    },
    shouldSkipReconnect: () => extensionContextInvalidated,
    runSync: ({ forceSiteIdRefresh = false } = {}) => {
      runPropertyLockSync({ forceSiteIdRefresh });
    },
    PROPERTY_LOCK_CONTENT_DISCONNECT,
    PROPERTY_LOCK_PORT_NAME,
    PROPERTY_LOCK_RECONNECT_DELAY_MS
  };
}

function createPropertyLockBannerDeps() {
  return {
    isPropertyLockCollaborationEnabled,
    clearPropertyLockBannerCountdown,
    renderPropertyLockBanner,
    updatePropertyLockBannerMode,
    sendPropertyLockMessage,
    respondToPropertyLockTakeoverSuggestion,
    getPropertyLockBannerElement: () => propertyLockBannerElement,
    setPropertyLockBannerElement: (element) => {
      propertyLockBannerElement = element;
    },
    getPropertyLockBannerMode: () => propertyLockBannerMode,
    getPropertyLockBannerCountdownTimer: () => propertyLockBannerCountdownTimer,
    setPropertyLockBannerCountdownTimer: (timer) => {
      propertyLockBannerCountdownTimer = timer;
    },
    getPropertyLockBannerCountdownValue: () => propertyLockBannerCountdownValue,
    setPropertyLockBannerCountdownValue: (value) => {
      propertyLockBannerCountdownValue = value;
    },
    setPropertyLockBannerVisible: (visible) => {
      propertyLockBannerVisible = Boolean(visible);
    },
    getPropertyLockState: () => propertyLockState,
    getPropertyLockSuggestionFromName: () => propertyLockSuggestionFromName,
    propertyLockText,
    EXTENSION_UI_FONT_STACK,
    PROPERTY_LOCK_BANNER_ID,
    PROPERTY_LOCK_BANNER_STYLE_ID,
    PROPERTY_LOCK_CONTENT_CONTINUE,
    PROPERTY_LOCK_CONTENT_SUGGEST,
    PROPERTY_LOCK_CONTENT_TAKE_LOCK
  };
}

function ensurePropertyLockBannerStyle() {
  return ensurePropertyLockBannerStyleOperation(createPropertyLockBannerDeps());
}

async function respondToPropertyLockTakeoverSuggestion(accept) {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (!propertyLockSuggestionId) {
    return;
  }
  let discardUnsaved = false;
  if (accept && state.enabled && core.isPageDraftDirty(location.href)) {
    const shouldDiscard = window.confirm(propertyLockText.transferDiscardBeforeAcceptConfirm);
    if (!shouldDiscard) {
      showPageToast(propertyLockText.transferSaveBeforeAcceptToast);
      return;
    }
    discardUnsaved = true;
  }
  sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_RESPOND, {
    suggestionId: propertyLockSuggestionId,
    accept,
    discardUnsaved
  });
  if (!accept) {
    updatePropertyLockBannerMode();
    renderPropertyLockBanner();
  }
}

function renderPropertyLockBanner() {
  return renderPropertyLockBannerOperation(createPropertyLockBannerDeps());
}

function clearPropertyLockBannerCountdown() {
  return clearPropertyLockBannerCountdownOperation(createPropertyLockBannerDeps());
}

function restartPropertyLockBannerCountdown() {
  return restartPropertyLockBannerCountdownOperation(createPropertyLockBannerDeps());
}

let contentCommandHandlersRegistered = false;

function getCurrentContentMode() {
  return state.enabled ? CONTENT_MODES.MARKING : CONTENT_MODES.SILENT;
}

async function handleSetEnabledCommand(message = {}) {
  if (message.enabled) {
    if (isPropertyLockInteractionBlocked()) {
      return { ok: false, locked: true };
    }
    const operationId = typeof message.operationId === "string" && message.operationId
      ? message.operationId
      : createLifecycleOperationId(LIFECYCLE_KINDS.ACTIVATION);
    emitLifecycleEvent({
      operationId,
      kind: LIFECYCLE_KINDS.ACTIVATION,
      phase: LIFECYCLE_PHASES.STARTED,
      busy: true,
      message: "Inspecting page..."
    });
    sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
    state.currentPageType = typeof message.pageType === "string" ? message.pageType : state.currentPageType || "";
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);

    try {
      const skipInitialReveal = !Boolean(message.performInitialReveal);
      const reconciliation = core.getPageSaveReconciliationState(location.href);
      if (reconciliation && reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON) {
        await core.clearPageSaveReconciliation(message.baseUrl || state.baseUrl || "", location.href);
      }
      await core.enableForBaseUrl(message.baseUrl, { skipInitialReveal });
      refreshEnabledAiHighlights();
      emitLifecycleEvent({
        operationId,
        kind: LIFECYCLE_KINDS.ACTIVATION,
        phase: LIFECYCLE_PHASES.FINISHED,
        busy: false,
        message: "",
        contentMode: getCurrentContentMode(),
        markingEnabled: Boolean(state.enabled)
      });
      return { ok: true };
    } catch {
      emitLifecycleEvent({
        operationId,
        kind: LIFECYCLE_KINDS.ACTIVATION,
        phase: LIFECYCLE_PHASES.FAILED,
        busy: false,
        message: "",
        contentMode: getCurrentContentMode(),
        markingEnabled: Boolean(state.enabled)
      });
      return { ok: false };
    }
  }

  state.currentPageType = "";
  clearAiPreviewState();
  core.disable();
  emitLifecycleEvent({
    operationId: createLifecycleOperationId(LIFECYCLE_KINDS.MODE),
    kind: LIFECYCLE_KINDS.MODE,
    phase: LIFECYCLE_PHASES.FINISHED,
    busy: false,
    message: "",
    contentMode: CONTENT_MODES.SILENT,
    markingEnabled: false
  });
  await refreshSilentHighlightings();
  return { ok: true };
}

function handleGetInspectionStatusCommand() {
  return getInspectionStatusResolver().resolve();
}

function handleRenderModeInspectionBeginCommand(message = {}) {
  return getRenderModeInspectionHandlers().begin(message);
}

async function handleRunRenderModeRevealOnceCommand(message = {}) {
  return getRenderModeInspectionHandlers().revealOnce(message);
}

async function handleCaptureRenderModeInspectionHtmlCommand(message = {}) {
  return getRenderModeInspectionHandlers().captureHtml(message);
}

function handleRenderModeInspectionEndCommand(message = {}) {
  return getRenderModeInspectionHandlers().end(message);
}

function handleHideConsentForInspectionCommand() {
  return getRenderModeInspectionHandlers().hideConsent();
}

function registerContentCommandHandlersOnce() {
  if (contentCommandHandlersRegistered) {
    return;
  }
  contentCommandHandlersRegistered = true;

  registerContentCommand("activateContentMain", async () => ({
    ok: true,
    initialized: Boolean(state.initialized)
  }));
  registerContentCommand("setEnabled", async (_context, payload) => handleSetEnabledCommand(payload));
  registerContentCommand("getInspectionStatus", async () => handleGetInspectionStatusCommand());
  registerContentCommand("renderModeInspectionBegin", async (_context, payload) => handleRenderModeInspectionBeginCommand(payload));
  registerContentCommand("runRenderModeRevealOnce", async (_context, payload) => handleRunRenderModeRevealOnceCommand(payload));
  registerContentCommand("captureRenderModeInspectionHtml", async (_context, payload) => handleCaptureRenderModeInspectionHtmlCommand(payload));
  registerContentCommand("renderModeInspectionEnd", async (_context, payload) => handleRenderModeInspectionEndCommand(payload));
  registerContentCommand("hideConsentForInspection", async () => handleHideConsentForInspectionCommand());
}


export function main() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  registerContentCommandHandlersOnce();

  initializePageWorldRelay().catch(() => {
    // Best-effort initialization. Core operations keep a background relay
    // fallback if page-world relay handshakes are unavailable.
  });

  // A render-mode inspection flag persisted in sessionStorage survives the
  // inspection reload. If this document booted with it already set, arm the
  // self-healing watchdog so a flag left stuck by a closed/disconnected popup
  // cannot permanently gate editor reveal or hold the page frozen.
  if (isRenderModeInspectionActive()) {
    armRenderModeInspectionWatchdog();
  }

  installExtensionTelemetry({
    source: "content",
    getIncludePayloads: getRemoteSupportIncludePayloads
  });

  if (isFeatureEnabled("remoteSupport")) {
    getRemoteSupportSupportPage().initialize();
    syncRemoteSupportSessionStateFromBackground().then();
  }
  if (isPropertyLockCollaborationEnabled()) {
    runPropertyLockSync({ forceSiteIdRefresh: true });
  } else {
    resetDisabledPropertyLockRuntimeState();
  }

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
    
    if (isPropertyLockCollaborationEnabled()) {
      runPropertyLockSync({
        forceSiteIdRefresh: !state.enabled || !state.baseUrl
      });
    } else {
      resetDisabledPropertyLockRuntimeState();
    }
    refreshEnabledAiHighlights();
    refreshSilentHighlightings().then();
    emitLifecycleEvent({
      kind: LIFECYCLE_KINDS.CONTENT_READY,
      phase: LIFECYCLE_PHASES.FINISHED,
      message: ""
    });
  });

  document.addEventListener("keydown", (event) => {
    const primaryModifier = event.ctrlKey || event.metaKey;
    if (!primaryModifier || event.altKey || event.shiftKey || event.repeat) {
      return;
    }
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (key !== "e" && key !== "m") {
      return;
    }
    if (key === "m" && !isFeatureEnabled("deviceEmulationToggle")) {
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
    }
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
    if (isWorldTraceEnabled() || isFullWorldMessagingLoggingEnabled()) {
      try {
        console.debug("[world-trace][content] runtime:inbound", {
          type: message.type,
          pageUrl: location.href
        });
      } catch {
        // Ignore trace logging failures.
      }
    }

    if (isRequestEnvelope(message) && message.target === MESSAGE_TARGETS.CONTENT) {
      const expectsReply = message.expectsReply !== false;
      const dispatchPromise = dispatchContentCommand(message, _sender, {
        pageUrl: () => location.href,
        mode: () => getCurrentContentMode()
      });
      if (!expectsReply) {
        dispatchPromise.catch(() => {});
        return;
      }
      dispatchPromise
        .then((reply) => sendResponse(reply))
        .catch((error) => {
          sendResponse(createFailureEnvelope(
            message,
            MESSAGE_ERROR_CODES.HANDLER_FAILED,
            (error && error.message) || "Content command failed"
          ));
        });
      return true;
    }

    if (getRemoteSupportSupportPage().isSupportPage() && message.type === "remoteSupportViewerTransportStart") {
      getRemoteSupportSupportPage().sendViewerRequest("remoteSupportTransportStart", {
        session: message.session && typeof message.session === "object" ? message.session : null
      }).then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      });
      return true;
    }

    if (getRemoteSupportSupportPage().isSupportPage() && message.type === "remoteSupportViewerTransportStop") {
      getRemoteSupportSupportPage().sendViewerRequest("remoteSupportTransportStop", {
        sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
        reason: typeof message.reason === "string" ? message.reason : "Session ended",
        notifyPeer: Boolean(message.notifyPeer)
      }).then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      });
      return true;
    }

    if (getRemoteSupportSupportPage().isSupportPage() && message.type === "remoteSupportViewerTransportSendData") {
      getRemoteSupportSupportPage().sendViewerRequest("remoteSupportTransportSendData", {
        sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
        messageType: typeof message.messageType === "string" ? message.messageType : "",
        payload: message.payload,
        channelKey: typeof message.channelKey === "string" ? message.channelKey : ""
      }).then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      });
      return true;
    }

    if (getRemoteSupportSupportPage().isSupportPage() && message.type === "remoteSupportStateChanged") {
      if (
        Number.isFinite(getRemoteSupportSupportPage().getTabId()) &&
        Number.isFinite(message.tabId) &&
        Math.trunc(message.tabId) !== getRemoteSupportSupportPage().getTabId()
      ) {
        return;
      }

      getRemoteSupportSupportPage().applyState(message.state || null);
      sendResponse({ ok: true });
      return;
    }

    if (getRemoteSupportSupportPage().isSupportPage() && message.type === "remoteSupportFrame") {
      if (!getRemoteSupportSupportPage().handleFrameMessage(message)) {
        return;
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "setEnabled") {
      handleSetEnabledCommand(message)
        .then((response) => {
          sendResponse(response && typeof response === "object" ? response : { ok: false });
        })
        .catch(() => {
          sendResponse({ ok: false });
        });
      return true;
    }

    if (message.type === "getInspectionStatus") {
      sendResponse(handleGetInspectionStatusCommand());
      return;
    }

    if (message.type === "renderModeInspectionBegin") {
      sendResponse(handleRenderModeInspectionBeginCommand(message));
      return;
    }

    if (message.type === "runRenderModeRevealOnce") {
      handleRunRenderModeRevealOnceCommand(message)
        .then((response) => {
          sendResponse(response && typeof response === "object" ? response : { ok: false });
        })
        .catch(() => {
          sendResponse({ ok: false });
        });
      return true;
    }

    if (message.type === "captureRenderModeInspectionHtml") {
      handleCaptureRenderModeInspectionHtmlCommand(message)
        .then((response) => {
          sendResponse(response && typeof response === "object" ? response : { ok: false });
        })
        .catch(() => {
          sendResponse({ ok: false });
        });
      return true;
    }

    if (message.type === "renderModeInspectionEnd") {
      sendResponse(handleRenderModeInspectionEndCommand(message));
      return;
    }

    if (message.type === "hideConsentForInspection") {
      sendResponse(handleHideConsentForInspectionCommand());
      return;
    }

    if (message.type === "remoteSupportState" || message.type === "remoteSupportModeChanged") {
      const response = getRemoteSupportStateHandler().handleMessage(message);
      sendResponse(response && typeof response === "object" ? response : { ok: false });
      return;
    }

    if (message.type === "getAiPreviewState") {
      sendResponse(getAiPreviewStateResponseBuilder().buildGetStateResponse());
      return;
    }

    if (message.type === "setAiPreviewExpandedMode") {
      try {
        const response = getAiPreviewExpandedModeHandler().handleMessage(message);
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      } catch {
        sendResponse({ ok: false });
      }
      return;
    }

    if (message.type === "setAiComputeLock") {
      getAiPreviewComputeLockHandler().handleMessage(message)
        .then((response) => {
          sendResponse(response && typeof response === "object" ? response : { ok: false });
        })
        .catch(() => {
          sendResponse({ ok: false });
        });
      return true;
    }

    if (message.type === "closeAiPreview") {
      getAiPreviewCloseHandler().handleMessage()
        .then((response) => {
          sendResponse(response && typeof response === "object" ? response : { ok: false });
        })
        .catch(() => {
          sendResponse({ ok: false });
        });
      return true;
    }

    if (message.type === "configUpdated") {
      if (aiPreviewState.active) {
        if (message.baseUrl) {
          core.loadConfig(message.baseUrl).then((loadedConfig) => {
            state.config = loadedConfig;
            sendResponse({ ok: true });
          }).catch(() => {
            sendResponse({ ok: false });
          });
          return true;
        }
        sendResponse({ ok: true });
        return;
      }
      if (state.enabled && utils.sameBaseUrl(message.baseUrl, state.baseUrl)) {
        const pageUrl = location.href;
        const draftEntry = core.getDraftPageEntry(pageUrl);
        const savedEntry = core.getSavedPageEntry(pageUrl);
        const forceReloadPageEntry = Boolean(message.forceReloadPageEntry);
        // Respond only AFTER the draft merge/reseed has fully settled so the
        // popup's follow-up getPageDraftStatus reads the final markings entry.
        // Responding early (while this work runs in a detached .then) made the
        // post-AI-run fingerprint capture race the reshaped entry, which broke
        // State C (Run AI wrongly re-enabled, Save/Show List disabled).
        core.loadConfig(state.baseUrl).then(async (loadedConfig) => {
          const backendSavedPageMarkings = await config.getBackendSavedPageMarkings(state.baseUrl);
          const backendEntry = core.findPageMarkingEntry(
            { pageMarkings: backendSavedPageMarkings },
            pageUrl,
            state.baseUrl
          );
          const loadedEntry = core.findPageMarkingEntry(loadedConfig, pageUrl, state.baseUrl);
          if (!forceReloadPageEntry) {
            core.mergeDraftEntry(loadedConfig, pageUrl, draftEntry, savedEntry);
          } else {
            const reloadedEntry = backendEntry || loadedEntry || null;
            core.setSavedPageEntry(pageUrl, reloadedEntry);
            state.currentPageType = (reloadedEntry && reloadedEntry.pageType) || state.currentPageType || "";
          }
          if (!forceReloadPageEntry) {
            core.setSavedPageEntry(pageUrl, backendEntry || null);
          }
          state.config = loadedConfig;
          refreshEnabledAiHighlights();
          if (forceReloadPageEntry) {
            core.scheduleRender();
            core.notifyDraftStatus(pageUrl);
          }
        }).then(() => {
          runPropertyLockSync({ forceSiteIdRefresh: true });
          sendResponse({ ok: true });
        }).catch(() => {
          runPropertyLockSync({ forceSiteIdRefresh: true });
          sendResponse({ ok: true });
        });
        return true;
      }
      clearAiPreviewState();
      core.disable();
      refreshSilentHighlightings().then();
      runPropertyLockSync({ forceSiteIdRefresh: true });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "forceRefresh") {
      core.refreshFromTabState().then(() => {
        refreshEnabledAiHighlights();
        runPropertyLockSync({ forceSiteIdRefresh: true });
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
        entry.submissionXpaths = collectAiSubmissionXpathsForCurrentPage(config);
        core.touchPageEntryTimestamp(entry);
        config.pageMarkings[location.href] = entry;

        if (shouldPersist) {
          await core.saveConfig(targetBaseUrl, config);
        }

        if (matchesActiveBaseUrl(targetBaseUrl)) {
          state.config = config;
          if (shouldPersist) {
            await core.refreshSavedPageEntryFromBackendCache(targetBaseUrl, location.href);
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
      (async () => {
        const pageUrl = location.href;
        await core.refreshSavedPageEntryFromBackendCache(targetBaseUrl, pageUrl);
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
        // Submission-xpath staleness only signals a discardable change when the
        // entry already carries submission data from a prior AI run/save. On a
        // freshly enabled page the entry has no submissionXpaths yet, while the
        // live page always reports submittable xpaths; comparing the two would
        // otherwise mark the pristine page dirty and wrongly enable Discard.
        const entrySubmissionXpaths =
          entry && Array.isArray(entry.submissionXpaths) ? entry.submissionXpaths : [];
        const submissionXpathsStale = Boolean(
          hasEntry &&
          entry &&
          entrySubmissionXpaths.length > 0 &&
          !submissionXpathsEqual(
            entrySubmissionXpaths,
            collectAiSubmissionXpathsForCurrentPage()
          )
        );
        sendResponse({
          ok: true,
          entry: entry ? core.clonePageEntry(entry) : null,
          savedEntry,
          dirty: core.isPageDraftDirty(pageUrl) || submissionXpathsStale,
          reconciliation,
          reconciliationPending: core.isPageSaveReconciliationPending(pageUrl)
        });
      })().catch(() => {
        sendResponse({ ok: false });
      });
      return true;
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
        await core.clearPageSaveReconciliation(targetBaseUrl, pageUrl);
        await core.refreshPageSaveReconciliation(targetBaseUrl, currentPageUrl);
        const refreshedConfig = await core.loadConfig(targetBaseUrl);
        const backendSavedPageMarkings = await config.getBackendSavedPageMarkings(targetBaseUrl);
        const storedEntry = core.findPageMarkingEntry(
          { pageMarkings: backendSavedPageMarkings },
          currentPageUrl,
          targetBaseUrl
        );
        state.config = refreshedConfig;
        core.setSavedPageEntry(currentPageUrl, storedEntry || null);
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
        targetItem = excluded
          ? { xpath, excluded: true, explicit: true }
          : { xpath, excluded: false };
        items.push(targetItem);
      } else {
        targetItem.excluded = excluded;
        if (excluded) {
          targetItem.explicit = true;
        } else {
          delete targetItem.explicit;
        }
      }
      const getElement = createXPathElementCache();
      const target = getElement(xpath);
      const cleanupDescendantIncludeOverrides = (currentXPath, currentTarget = null) => {
        const boundaryTarget = currentTarget && currentTarget.nodeType === 1
          ? currentTarget
          : getElement(currentXPath);
        for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
          const includeXPath = includeXpaths[i];
          if (!includeXPath || includeXPath === currentXPath) {
            continue;
          }
          const includeEl = getElement(includeXPath);
          if (isSameOrDescendantByElementOrXPath(currentXPath, boundaryTarget, includeXPath, includeEl)) {
            includeXpaths.splice(i, 1);
          }
        }
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (!item || !item.xpath || item.excluded || item.xpath === currentXPath) {
            continue;
          }
          const itemEl = getElement(item.xpath);
          if (isSameOrDescendantByElementOrXPath(currentXPath, boundaryTarget, item.xpath, itemEl)) {
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
          const existingEl = getElement(item.xpath);
          if (isSameOrDescendantByElementOrXPath(xpath, target, item.xpath, existingEl)) {
            items.splice(i, 1);
            continue;
          }
          if (
            item.excluded &&
            isSameOrDescendantByElementOrXPath(item.xpath, existingEl, xpath, target)
          ) {
            cleanupDescendantIncludeOverrides(item.xpath, existingEl);
            if (existingEl && core.isDefaultToggleableExcludedElement(existingEl)) {
              item.excluded = false;
              delete item.explicit;
            } else {
              items.splice(i, 1);
            }
          }
        }
        for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
          const includeXPath = includeXpaths[i];
          if (!includeXPath) {
            continue;
          }
          const includeEl = getElement(includeXPath);
          if (
            includeXPath === xpath ||
            isSameOrDescendantByElementOrXPath(includeXPath, includeEl, xpath, target) ||
            isSameOrDescendantByElementOrXPath(xpath, target, includeXPath, includeEl)
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
      const getElement = createXPathElementCache();
      if (included) {
        const target = getElement(xpath);
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
          const existingEl = getElement(item.xpath);
          if (isSameOrDescendantByElementOrXPath(xpath, target, item.xpath, existingEl)) {
            items.splice(i, 1);
          }
        }
        entry.xpaths = items;
        for (let i = includeXpaths.length - 1; i >= 0; i -= 1) {
          const childXpath = includeXpaths[i];
          if (!childXpath || childXpath === xpath) {
            continue;
          }
          const existingEl = getElement(childXpath);
          if (isSameOrDescendantByElementOrXPath(xpath, target, childXpath, existingEl)) {
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
        let defaultItems = [];
        let expandedItems = [];
        try {
          defaultItems = core.collectPreviewItems(selectorSet);
          expandedItems = buildAiPreviewItemsWithCategories(selectorSet, defaultItems);
        } catch {
          defaultItems = [];
          expandedItems = [];
        }
        await enterAiPreviewMode({ mode: "preview" });
        setAiPreviewItemSets(defaultItems, expandedItems, { showAllCategories: false });
        core.showAiPopover(defaultItems, {
          onClose: () => exitAiPreviewMode()
        });
        sendResponse({ ok: true, count: defaultItems.length });
      })().catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }
  });

  window.addEventListener(URL_CHANGED_EVENT, () => {
    silentHighlightEditorRevealKey = "";
    runPropertyLockSync({ forceSiteIdRefresh: true });
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

  // Per-spec: any page input (mouse/keyboard/scroll) resets the 30-minute
  // property-lock inactivity window. Debounce to at most once per 10 seconds
  // so we don't flood the background on busy pages.
  const handlePageActivity = () => {
    if (!getPropertyLockPortClient().hasPort() || propertyLockPageActivityTimer) {
      return;
    }
    propertyLockPageActivityTimer = window.setTimeout(() => {
      propertyLockPageActivityTimer = 0;
      sendPropertyLockActivity();
    }, 10_000);
  };
  window.addEventListener("mousemove", handlePageActivity, { passive: true, capture: false });
  window.addEventListener("keydown", handlePageActivity, { passive: true, capture: false });
  window.addEventListener("pointerdown", handlePageActivity, { passive: true, capture: false });
  window.addEventListener("scroll", handlePageActivity, { passive: true, capture: false });
}
