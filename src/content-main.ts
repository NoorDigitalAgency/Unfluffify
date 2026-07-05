import * as core from "./content/core";
import { browser, type Browser } from "./common/browser";
import type { Config, SelectorSet, XpathEntry } from "./types/config.ts";
import {
  addBusEnvelopeListener,
  addRequestEnvelopeListener
} from "./common/extension-messaging";
import * as config from "./common/config";
import { initPageTypeTaxonomy } from "./common/page-type-taxonomy";
import {
  FEATURE_DISABLED_REASON,
  isDebugFlagEnabled,
  isFeatureEnabled
} from "./common/feature-flags";
import * as utils from "./common/utilities";
import {
  DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS,
  DEFAULT_EXCLUDED_TOGGLEABLE_SELECTORS,
  EXTENSION_UI_FONT_STACK
} from "./common/constants";
import {
  normalizeAiSelectorSet,
  combineAiSelectorSet,
  isWithinAncestorSet as isWithinNodeSet,
  buildInclusionContextSet,
  getNormalizedTextContent as getNormalizedNodeText,
  canUseCollapsedTextFallback as canUseCollapsedTextFallbackNode
} from "./content/shared-inclusion";


import {
  getCurrentPageCandidateState,
  normalizeSiteIdValue,
  normalizeStageBase as normalizeStageBaseValue
} from "./common/lynx-live-pages";
import {
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS,
  DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES,
  shouldCollectSilentExcludedSource,
  shouldRetainIncludedSource,
  shouldRenderSilentHighlightOverlay,
  sampleSettledSilentHighlightPosition
} from "./content/silent-highlight-rules";
import {
  collectCachedSelectorMatches,
  SELECTOR_LIST_DELIMITER,
  getSelectorFingerprint,
  invalidateSharedSelectorCache
} from "./content/shared-selector-cache";
import {
  isAiSubmissionDocumentRootXpath,
  resolveAiSubmissionRowState
} from "./content/submission-rules";

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
} from "./common/property-lock";
import { propertyLockText } from "./common/text";
import {
  CONTENT_MODES,
  LIFECYCLE_KINDS,
  LIFECYCLE_PHASES,
  WORLD_MESSAGE_TYPES
} from "./common/world-messaging-contract";
import {
  dispatchContentCommand,
  registerContentCommand
} from "./content/content-command-router";
import { createContentMainServiceRegistry } from "./content/content-main-service-registry";
import { handleRuntimeMessage } from "./content/runtime-message-handler";
import { createAiPreviewCloseHandler } from "./content/ai-preview-close-handler";
import { createAiPreviewComputeLockHandler } from "./content/ai-preview-compute-lock-handler";
import { createAiPreviewExpandedModeHandler } from "./content/ai-preview-expanded-mode-handler";
import { createAiPreviewGetStateHandler } from "./content/ai-preview-get-state-handler";
import { createAiPreviewShowHandler } from "./content/ai-preview-show-handler";
import { createAiPreviewStateResponseBuilder } from "./content/ai-preview-state-response";
import { createAiSubmissionXpathsHandler } from "./content/ai-submission-xpaths-handler";
import { createCollectPageDataHandler } from "./content/collect-page-data-handler";
import { createCapturePageSnapshotHandler } from "./content/capture-page-snapshot-handler";
import { createConfigUpdatedHandler } from "./content/config-updated-handler";
import { createDefaultExclusionsHandler } from "./content/default-exclusions-handler";
import { createDescribeXpathsHandler } from "./content/describe-xpaths-handler";
import { createExplicitMarkingHandler } from "./content/explicit-marking-handler";
import { createFocusHandler } from "./content/focus-handler";
import { createForceRefreshHandler } from "./content/force-refresh-handler";
import { createInvisibleXpathsHandler } from "./content/invisible-xpaths-handler";
import { createInspectionStatusResolver } from "./content/inspection-status";
import { createPageDraftStatusHandler } from "./content/page-draft-status-handler";
import { createPageDraftRevertHandler } from "./content/page-draft-revert-handler";
import { createPageDraftSaveHandler } from "./content/page-draft-save-handler";
import { createPageSaveReconciliationClearHandler } from "./content/page-save-reconciliation-clear-handler";
import { createPageSaveReconciliationPendingHandler } from "./content/page-save-reconciliation-pending-handler";
import { initializePageWorldRelay } from "./content/page-world-relay";
import { createPageToast } from "./content/page-toast";
import { emitContentSignal, handleContentBusMessage, publishContentSessionFacts, startContentBusClient } from "./content/layers/content-bus-client";
import { normalizePageSaveReconciliationReason } from "./common/bus/contracts/session-state";
import { SIGNAL_NAMES } from "./common/bus/contracts/signals";
import {
  CONTENT_MARKING_MACHINE_INITIAL,
  resolveContentExitDestination,
  stepContentMarkingMachine,
  type ContentMarkingStep
} from "./content/marking-machine";
import {
  addContentDirectiveListener,
  isPageRevealFreezeActiveByDirective,
  isSilentHighlightActiveByDirective
} from "./content/layers/layer-host";
import { createRenderModeInspectionClient } from "./content/render-mode-inspection-client";
import { createRenderModeInspectionHandlers } from "./content/render-mode-inspection-handlers";
import { createVisibleXpathsHandler } from "./content/visible-xpaths-handler";
import {
  clearPropertyLockBannerCountdown as clearPropertyLockBannerCountdownOperation,
  renderPropertyLockBanner as renderPropertyLockBannerOperation,
  restartPropertyLockBannerCountdown as restartPropertyLockBannerCountdownOperation
} from "./content/property-lock-banner";
import { updatePropertyLockBannerMode as updatePropertyLockBannerModeOperation } from "./content/property-lock-banner-mode";
import { createPropertyLockPortClient } from "./content/property-lock-port-client";
import { createPropertyLockStateMachine } from "./content/property-lock-state-machine";


import { getGlobalAiSettings } from "./common/settings-store";
import { routeInboundContentRequestMessage } from "./content/inbound-content-request-dispatch";
import type { RuntimeMessage } from "./types/messaging.ts";

const { state } = core;

type LooseRuntimeMessage = Partial<RuntimeMessage>;
type PageToastDeps = Parameters<typeof createPageToast>[0];
type PageSaveReconciliationClearDeps = Parameters<typeof createPageSaveReconciliationClearHandler>[0];
type PageSaveReconciliationPendingDeps = Parameters<typeof createPageSaveReconciliationPendingHandler>[0];
type RenderModeInspectionClientDeps = Parameters<typeof createRenderModeInspectionClient>[0];
type RenderModeInspectionDeps = Parameters<typeof createRenderModeInspectionHandlers>[0];
type InspectionStatusDeps = Parameters<typeof createInspectionStatusResolver>[0];
type PageDraftRevertDeps = Parameters<typeof createPageDraftRevertHandler>[0];
type PageDraftSaveDeps = Parameters<typeof createPageDraftSaveHandler>[0];
type ExplicitMarkingDeps = Parameters<typeof createExplicitMarkingHandler>[0];
type PageDraftStatusDeps = Parameters<typeof createPageDraftStatusHandler>[0];
type AiPreviewShowHandlerDeps = Parameters<typeof createAiPreviewShowHandler>[0];
type CapturePageSnapshotDeps = Parameters<typeof createCapturePageSnapshotHandler>[0];
type ConfigUpdatedHandlerDeps = Parameters<typeof createConfigUpdatedHandler>[0];
type CollectPageDataHandlerDeps = Parameters<typeof createCollectPageDataHandler>[0];
type DescribeXpathsDeps = Parameters<typeof createDescribeXpathsHandler>[0];
type FocusHandlerDeps = Parameters<typeof createFocusHandler>[0];
type InvisibleXpathsDeps = Parameters<typeof createInvisibleXpathsHandler>[0];
type VisibleXpathsDeps = Parameters<typeof createVisibleXpathsHandler>[0];
type PropertyLockPortClientDeps = Parameters<typeof createPropertyLockPortClient>[0];
type PropertyLockStateMachineDeps = Parameters<typeof createPropertyLockStateMachine>[0];
type PropertyLockBannerDeps = Parameters<typeof renderPropertyLockBannerOperation>[0];
type PropertyLockBannerModeDeps = Parameters<typeof updatePropertyLockBannerModeOperation>[0];
type PropertyLockPortClient = ReturnType<typeof createPropertyLockPortClient>;
type PropertyLockStateMachine = ReturnType<typeof createPropertyLockStateMachine>;
type PropertyLockRecoveryTabStateInput =
  | Parameters<PropertyLockStateMachine["normalizeRecoveryTabState"]>[0]
  | null;
type PropertyLockRecoveryStateInput = {
  siteId?: number | null;
  baseUrl?: string | null;
  clientId?: string;
  deadlineAt: number;
  offCandidateDeadlineAt?: number;
} | null | undefined;
type PropertyLockServerMessage = Parameters<PropertyLockStateMachine["applyServerMessage"]>[0];
type RenderModeInspectionHandlers = ReturnType<typeof createRenderModeInspectionHandlers>;
type InspectionStatusResolver = ReturnType<typeof createInspectionStatusResolver>;
type PageToastClient = ReturnType<typeof createPageToast>;
type RenderModeInspectionClient = ReturnType<typeof createRenderModeInspectionClient>;
type SiteIdValue = ReturnType<typeof normalizeSiteIdValue>;
type CurrentPageCandidateState = ReturnType<typeof getCurrentPageCandidateState>;
type PropertyPageTypes = NonNullable<Parameters<typeof getCurrentPageCandidateState>[1]>;
type PageActivityListener = () => void;
type SilentHighlightAnnotationKind = "included" | "excluded" | "implicit";
type SilentHighlightTitleState = {
  hadTitle: boolean;
  title: string;
  annotationTitle: string;
};
type AiPreviewTitleState = {
  hadTitle: boolean;
  title: string;
  previewTitle: string;
};
type AiPreviewItem = {
  xpath: string;
  text: string;
  title: string;
  kind: string;
};
type AiPreviewItemWithPosition = AiPreviewItem & {
  top: number;
  left: number;
};
type AiPreviewState = {
  active: boolean;
  mode: string;
  items: AiPreviewItem[];
  defaultItems: AiPreviewItem[];
  expandedItems: AiPreviewItem[];
  itemsPending: boolean;
  showAllCategories: boolean;
  itemXpathSet: Set<string>;
  focusedXpath: string;
  previousEnabled: boolean;
  restoreMarkingOnExit: boolean;
  previousBaseUrl: string;
  previousPageUrl: string;
  previousConfig: Config | null;
  previousDraftEntry: ContentPageEntry | null;
  previousSavedEntry: ContentPageEntry | null;
  previousAutoSeededPendingSavePageUrl: string;
};
type FetchPropertyPageTypesResult =
  | { ok: false; pageTypes: PropertyPageTypes; reason: string }
  | { ok: true; pageTypes: PropertyPageTypes };
type LivePageTargetResult =
  | { ok: false; reason: string }
  | {
    ok: true;
    baseUrl: string;
    siteId: number;
    pageType: string;
    candidateState: CurrentPageCandidateState;
  };
type PropertyLockConnectionTargetResult =
  | { ok: false; reason: string }
  | {
    ok: true;
    baseUrl: string;
    pageUrl: string;
    siteId: number;
    stageBaseValue: string;
    tokenValue: string;
  };
type AiPreviewItemSetOptions = {
  showAllCategories?: boolean;
};
type AiPreviewStateUpdateOptions = {
  notify?: boolean;
  preserveFocusedXpath?: boolean;
};
type SilentHighlightOverlayOptions = {
  keepVisible?: boolean;
};
type SilentHighlightRefreshScheduleOptions = {
  debounceMs?: unknown;
  minIntervalMs?: unknown;
};
type ContentSessionFactsPatch = Parameters<typeof publishContentSessionFacts>[0];
type SilentHighlightLayerState =
  | {
    layer: HTMLElement;
    map: Map<string, HTMLElement>;
    used: Set<string>;
  }
  | null;
type PropertyLockPortEnvelope = {
  clientId?: unknown;
  connectionStatus?: unknown;
  message?: unknown;
  type?: unknown;
};
type ContentPropertyLockState = {
  state?: string;
  isEditor?: boolean;
  isSameUserEditor?: boolean;
  editorName?: string;
  otherTabHasUnsavedChanges?: boolean;
  transferFromName?: string;
  transferToName?: string;
  secondsRemaining?: number | null;
  [key: string]: unknown;
};
type PropertyLockSyncOptions = {
  pageUrl?: string;
  forceSiteIdRefresh?: boolean;
};
type PageBlockerEvent = {
  busy?: unknown;
  kind?: unknown;
  message?: unknown;
  operationId?: unknown;
  phase?: unknown;
  reason?: unknown;
  source?: unknown;
  [key: string]: unknown;
};
type EnableHotkeyGateResult = Awaited<ReturnType<typeof isEnableHotkeyAllowedOnPage>>;
type ToggleEnabledFromPageOptions = {
  gate?: EnableHotkeyGateResult | null;
  showDisabledToast?: boolean;
};
type SilentHighlightLayerMap = Record<string, HTMLElement>;
type SilentHighlightLayerBoxMap = Record<string, Map<string, HTMLElement>>;
type SilentHighlightCollections = {
  immutableNodes: Element[];
  contentNodes: Element[];
  excludedNodes: Element[];
  sourceImmutableNodes: Element[];
  sourceContentNodes: Element[];
  sourceExcludedNodes: Element[];
  sourceExplicitIncludeNodes: Element[];
  sourceHiddenExplicitIncludeNodes: Element[];
  ghostContentNodes: Element[];
  sourceInclusionSelectorByNode: Map<Element, string>;
  sourceExclusionSelectorByNode: Map<Element, string>;
  explicitIncludeSelectorByNode: Map<Element, string>;
  excludedSelectorByNode: Map<Element, string>;
  explicitIncludeXpathByNode: Map<Element, string>;
  excludedXpathByNode: Map<Element, string>;
  implicitIncludeXpathByNode: Map<Element, string>;
};
type SilentHighlightConfigSnapshot = {
  effectiveSelectorSet: EffectiveSelectorSet;
  hasSelectorHighlights: boolean;
  holdSilentMotionPause: boolean;
};
type SilentHighlightConfigLoadResult = {
  snapshot: SilentHighlightConfigSnapshot | null;
  facts: ContentSessionFactsPatch;
};
type SilentHighlightSourceState = {
  shouldObserve: boolean;
  renderCollections: SilentHighlightCollections;
  immutableNodes: Element[];
  contentNodes: Element[];
  excludedNodes: Element[];
};
type SilentHighlightOverlayUpdate = {
  renderCollections: SilentHighlightCollections;
  shouldBeActive: boolean;
  renderKey: string;
  renderChanged: boolean;
  shouldRenderOverlay: boolean;
};
type SilentHighlightTrackedNodeIndex = {
  tracked: Set<Node>;
  ancestors: Set<Node>;
};
type ContentPageEntry = NonNullable<Config["pageMarkings"][string]>;
type EffectiveSelectorSet = SelectorSet & {
  suppressedXpaths?: string[];
};
type SelectorSetInput = {
  exclusionSelectors?: unknown;
  inclusionSelectors?: unknown;
  suppressedXpaths?: unknown;
};
type SuppressedSelectorBoundaries = {
  xpaths: string[];
  elements: Element[];
};
type SelectorCollectionOptions = {
  suppressedXpaths?: unknown;
};
type InclusionSelectionOptions = {
  ignoreVisibilityForInclusionDetection?: boolean;
  preserveNestedExplicitIncludedDescendants?: boolean;
  keepAllExplicitMatches?: boolean;
};
type SilentHighlightRenderTargetOptions = {
  keepShallowestOnly?: boolean;
};
type RenderableNodeListOptions = {
  dedupeTargets?: boolean;
  keepShallowestFallbackTargets?: boolean;
};
type IncludedSelectorSetResult = {
  included: Element[];
  excluded: Element[];
  immutableExcluded: Element[];
  explicitIncluded: Element[];
  hiddenExplicitIncluded: Element[];
  inclusionSelectorByNode: Map<Element, string>;
  exclusionSelectorByNode: Map<Element, string>;
};
type RenderableNodeListResult = {
  nodes: Element[];
  selectorByNode: Map<Element, string>;
  sourceByTarget: Map<Element, Element>;
};
type SnapshotTraversalItem = {
  node: Element;
  insideImmutableExcluded: boolean;
};
type LifecyclePhase = typeof LIFECYCLE_PHASES[keyof typeof LIFECYCLE_PHASES];

const SILENT_CONTENT_HIGHLIGHTING_ATTR = "data-uf-silent-content-highlighting";
const SILENT_CONTENT_EXCLUDED_ATTR = "data-uf-silent-content-excluded";
const SILENT_HIGHLIGHTINGS_ACTIVE_ATTR = "data-uf-silent-highlightings";
const SILENT_CONTENT_POSITION_ATTR = "data-uf-silent-content-position";
const SILENT_SELECTOR_EXPLICIT_INCLUDE_ATTR = "data-uf-silent-selector-include";
const SILENT_SELECTOR_EXCLUDE_ATTR = "data-uf-silent-selector-exclude";
const SILENT_TITLE_COPY_ATTR = "data-uf-silent-title-copy";
const AI_PREVIEW_CLICKABLE_ATTR = "data-uf-ai-preview-clickable";
const SILENT_SELECTOR_TITLE_PREFIX = "Unfluffify selector: ";
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

function isElementNode(node: unknown): node is Element {
  return Boolean(
    node &&
      typeof node === "object" &&
      "nodeType" in node &&
      (node as { nodeType?: unknown }).nodeType === 1
  );
}

function pushChildElementsReverse(stack: Element[], parent: Element): void {
  for (let i = parent.children.length - 1; i >= 0; i -= 1) {
    const child = parent.children.item(i);
    if (child) {
      stack.push(child);
    }
  }
}

function pushChildElementsForward(stack: Element[], parent: Element): void {
  for (let i = 0; i < parent.children.length; i += 1) {
    const child = parent.children.item(i);
    if (child) {
      stack.push(child);
    }
  }
}

function toElementArray(nodes: Iterable<unknown> | null | undefined): Element[] {
  const elements: Element[] = [];
  for (const node of nodes || []) {
    if (isElementNode(node)) {
      elements.push(node);
    }
  }
  return elements;
}

function getSuppressedXpathList(suppressedXpaths: unknown): string[] {
  return Array.isArray(suppressedXpaths)
    ? suppressedXpaths.filter((xpath): xpath is string => typeof xpath === "string" && Boolean(xpath))
    : [];
}

const PROPERTY_LOCK_BANNER_ID = "unfluffify-lock-banner";
const PROPERTY_LOCK_BANNER_STYLE_ID = "unfluffify-lock-banner-style";
const PROPERTY_LOCK_RECONNECT_DELAY_MS = 150;

let propertyLockState: ContentPropertyLockState | null = null;
let propertyLockBannerMode = "no_banner";
let propertyLockBannerCountdownTimer = 0;
let propertyLockBannerCountdownValue = 0;
let propertyLockOffCandidateDeadlineAt = 0;
let propertyLockRecoverySiteId: number | null = null;
let propertyLockRecoveryBaseUrl = "";
let propertyLockRecoveryClientId = "";
let propertyLockRecoveryDeadlineAt = 0;
let propertyLockRecoveryReleaseTimer = 0;
let propertyLockBannerElement: HTMLElement | null = null;
let propertyLockBannerVisible = false;
let propertyLockSuggestionId = "";
let propertyLockSuggestionFromName = "";
let propertyLockLastBlockedToastAt = 0;
let propertyLockConnectedSiteId: number | null = null;
let propertyLockConnectedBaseUrl = "";
// Debounce timer for central page-level activity pings (mouse/keyboard/scroll).
// Property lock and background inactivity observers subscribe to this signal.
let pageActivityTimer = 0;
const pageActivitySubscribers = new Set<PageActivityListener>();
let propertyLockEditorClaimPending = false;
let propertyLockSyncToken = 0;
let propertyLockSyncInFlight = false;
let propertyLockQueuedSyncOptions: PropertyLockSyncOptions | null = null;
let propertyLockClientId = "";
let extensionContextInvalidated = false;
let silentHighlightingObserver: MutationObserver | null = null;
let silentHighlightingLayoutShiftObserver: PerformanceObserver | null = null;
let silentHighlightingRefreshTimer = 0;
let silentHighlightingRefreshDueAt = 0;
let silentHighlightingRefreshGeneration = 0;
let lastSilentHighlightingRefreshAt = 0;
let lastSilentHighlightSessionFactsKey = "";
let lastSilentHighlightingRenderKey = "";
let lastSilentHighlightingsActive = false;
let silentHighlightingPositionRefreshPending = false;
let silentHighlightOverlay: HTMLElement | null = null;
let silentHighlightLayers: SilentHighlightLayerMap = {};
let silentHighlightLayerBoxes: SilentHighlightLayerBoxMap = {};
let silentHighlightCollections: SilentHighlightCollections | null = null;
let silentHighlightRenderTargetCache = new Map<Element, Element[]>();
let silentHighlightTrackedNodeIndex: SilentHighlightTrackedNodeIndex | null = null;
let silentHighlightScrollTimer = 0;
let silentHighlightRepositionRaf = 0;
let silentHighlightSettleTimer = 0;
let silentHighlightSettleStartedAt = 0;
let silentHighlightSettleStableSamples = 0;
let silentHighlightLastPositionSignature = "";
let silentHighlightRevealRaf = 0;
let silentHighlightLegacyAttrsCleaned = false;
let silentHighlightEditorRevealInFlight = 0;
let silentHighlightEditorRevealKey = "";
let pageVisitRevealFreezeAttemptKey = "";
let silentHighlightEditorActivationPromise: Promise<unknown> | null = null;
let silentHighlightEditorActivationQueued = false;
let silentHighlightEditorActivationIdCounter = 0;
let renderModeInspectionActive = false;
let lifecycleOperationCounter = 0;
const silentSelectorAnnotatedNodes = new Set<Element>();
const aiPreviewClickableNodes = new Set<Element>();

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
  getPropertyLockPortClient().disconnect({ notifyBackground: false });
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
  const portClient = getPropertyLockPortClient();
  const hasPort = portClient.hasPort();
  const hasReconnectTimer = portClient.hasReconnectTimer();
  if (
    hasPort ||
    propertyLockState ||
    propertyLockBannerMode !== "no_banner" ||
    propertyLockOffCandidateDeadlineAt ||
    propertyLockRecoveryDeadlineAt ||
    hasReconnectTimer ||
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
const silentSelectorOriginalTitles = new WeakMap<Element, SilentHighlightTitleState>();
const aiPreviewOriginalTitles = new WeakMap<Element, AiPreviewTitleState>();
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

function createAiPreviewState(): AiPreviewState {
  return {
    active: false,
    mode: "",
    items: [],
    defaultItems: [],
    expandedItems: [],
    itemsPending: false,
    showAllCategories: false,
    itemXpathSet: new Set<string>(),
    focusedXpath: "",
    previousEnabled: false,
    restoreMarkingOnExit: false,
    previousBaseUrl: "",
    previousPageUrl: "",
    previousConfig: null as Config | null,
    previousDraftEntry: null,
    previousSavedEntry: null,
    previousAutoSeededPendingSavePageUrl: ""
  };
}

let aiPreviewState = createAiPreviewState();

// REFLEX-ARC P3 §3.2: the content marking machine — the executor-side record
// of which routine owns the page (silent|marking|preview|compute_lock|
// restoring) with the exit destination memorized at routine entry. It steps
// at content's own routine boundaries; aiPreviewState keeps the presentation
// data (items/xpaths) while the machine is the record of the ROUTINE. The
// reader swap (facts/response builders reading the machine instead of the
// loose flags) is the next §3.2 slice.
let contentMarkingMachine = CONTENT_MARKING_MACHINE_INITIAL;

function stepContentMachine(
  step: ContentMarkingStep,
  detail: { enabledAtEntry?: boolean } = {}
): void {
  const transition = stepContentMarkingMachine(contentMarkingMachine, step, detail);
  if (transition.moved) {
    contentMarkingMachine = transition.machine;
    // P4 step 4.1: machine states own the marking-paused overlay policy, and
    // steps happen outside any directive delivery — re-render on every move.
    core.refreshMarkingTemporarilyDisabledUi();
  }
}

// P4 step 4.1: core's page-overlay renderers (pageCurtain content, the
// marking-paused class) resolve presentation from the machine's overlay
// memory — hand them the live machine state.
core.setContentOverlayMachineStateResolver(() => contentMarkingMachine.state);

// P4 step 4.4: the machine is the record of the preview ROUTINE — facts and
// response builders (and the routine's own guards) read it, never the loose
// aiPreviewState flags; aiPreviewState keeps only presentation data.
function machineOwnsPreviewRoutine(): boolean {
  return contentMarkingMachine.state === "preview" || contentMarkingMachine.state === "compute_lock";
}

const contentMainServiceRegistry = createContentMainServiceRegistry({
  createPageToastClient: () => createPageToast(createPageToastDeps()),
  createPageSaveReconciliationClearHandler: () => createPageSaveReconciliationClearHandler(
    createPageSaveReconciliationClearHandlerDeps()
  ),
  createPageSaveReconciliationPendingHandler: () => createPageSaveReconciliationPendingHandler(
    createPageSaveReconciliationPendingHandlerDeps()
  ),
  createRenderModeInspectionClient: () => createRenderModeInspectionClient(
    createRenderModeInspectionClientDeps()
  ),
  createRenderModeInspectionHandlers: () => createRenderModeInspectionHandlers(
    createRenderModeInspectionHandlersDeps()
  ),
  createInspectionStatusResolver: () => createInspectionStatusResolver(createInspectionStatusDeps()),
  createPageDraftRevertHandler: () => createPageDraftRevertHandler(createPageDraftRevertHandlerDeps()),
  createPageDraftSaveHandler: () => createPageDraftSaveHandler(createPageDraftSaveHandlerDeps()),
  createExplicitMarkingHandler: () => createExplicitMarkingHandler(createExplicitMarkingHandlerDeps()),
  createPageDraftStatusHandler: () => createPageDraftStatusHandler(createPageDraftStatusHandlerDeps()),
  createAiPreviewStateResponseBuilder: () => createAiPreviewStateResponseBuilder(
    createAiPreviewStateResponseDeps()
  ),
  createAiPreviewCloseHandler: () => createAiPreviewCloseHandler(createAiPreviewCloseHandlerDeps()),
  createAiPreviewComputeLockHandler: () => createAiPreviewComputeLockHandler(
    createAiPreviewComputeLockHandlerDeps()
  ),
  createAiPreviewExpandedModeHandler: () => createAiPreviewExpandedModeHandler(
    createAiPreviewExpandedModeHandlerDeps()
  ),
  createAiPreviewGetStateHandler: () => createAiPreviewGetStateHandler(createAiPreviewGetStateHandlerDeps()),
  createAiPreviewShowHandler: () => createAiPreviewShowHandler(createAiPreviewShowHandlerDeps()),
  createAiSubmissionXpathsHandler: () => createAiSubmissionXpathsHandler(createAiSubmissionXpathsHandlerDeps()),
  createCapturePageSnapshotHandler: () => createCapturePageSnapshotHandler(createCapturePageSnapshotHandlerDeps()),
  createConfigUpdatedHandler: () => createConfigUpdatedHandler(createConfigUpdatedHandlerDeps()),
  createCollectPageDataHandler: () => createCollectPageDataHandler(createCollectPageDataHandlerDeps()),
  createDefaultExclusionsHandler: () => createDefaultExclusionsHandler(createDefaultExclusionsHandlerDeps()),
  createDescribeXpathsHandler: () => createDescribeXpathsHandler(createDescribeXpathsHandlerDeps()),
  createFocusHandler: () => createFocusHandler(createFocusHandlerDeps()),
  createForceRefreshHandler: () => createForceRefreshHandler(createForceRefreshHandlerDeps()),
  createInvisibleXpathsHandler: () => createInvisibleXpathsHandler(createInvisibleXpathsHandlerDeps()),
  createVisibleXpathsHandler: () => createVisibleXpathsHandler(createVisibleXpathsHandlerDeps()),
  createPropertyLockPortClient: () => createPropertyLockPortClient(createPropertyLockPortClientDeps()),
  createPropertyLockStateMachine: () => createPropertyLockStateMachine(createPropertyLockStateMachineDeps())
});

function sendRuntimeMessageSafely(message: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (
    extensionContextInvalidated ||
    !message ||
    typeof message !== "object"
  ) {
    return Promise.resolve(null);
  }

  try {
    if (typeof browser.runtime.sendMessage !== "function") {
      return Promise.resolve(null);
    }
  } catch {
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

function getPageToastClient(): PageToastClient {
  return contentMainServiceRegistry.getPageToastClient() as PageToastClient;
}

function getPageSaveReconciliationClearHandler() {
  return contentMainServiceRegistry.getPageSaveReconciliationClearHandler();
}

function getPageSaveReconciliationPendingHandler() {
  return contentMainServiceRegistry.getPageSaveReconciliationPendingHandler();
}

function getRenderModeInspectionClient(): RenderModeInspectionClient {
  return contentMainServiceRegistry.getRenderModeInspectionClient() as RenderModeInspectionClient;
}

function getRenderModeInspectionHandlers() {
  return contentMainServiceRegistry.getRenderModeInspectionHandlers() as RenderModeInspectionHandlers;
}

function getInspectionStatusResolver() {
  return contentMainServiceRegistry.getInspectionStatusResolver() as InspectionStatusResolver;
}

function getPageDraftRevertHandler() {
  return contentMainServiceRegistry.getPageDraftRevertHandler();
}

function getPageDraftSaveHandler() {
  return contentMainServiceRegistry.getPageDraftSaveHandler();
}

function getExplicitMarkingHandler() {
  return contentMainServiceRegistry.getExplicitMarkingHandler();
}

function getPageDraftStatusHandler() {
  return contentMainServiceRegistry.getPageDraftStatusHandler();
}

type AiPreviewStateResponseBuilder = {
  buildGetStateResponse: () => Record<string, unknown>;
  buildExpandedModeDisabledResponse: () => Record<string, unknown>;
  buildExpandedModeResponse: (ok: boolean) => Record<string, unknown>;
};

function getAiPreviewStateResponseBuilder(): AiPreviewStateResponseBuilder {
  return contentMainServiceRegistry.getAiPreviewStateResponseBuilder() as AiPreviewStateResponseBuilder;
}

function getAiPreviewCloseHandler() {
  return contentMainServiceRegistry.getAiPreviewCloseHandler();
}

function getAiPreviewComputeLockHandler() {
  return contentMainServiceRegistry.getAiPreviewComputeLockHandler();
}

function getAiPreviewExpandedModeHandler() {
  return contentMainServiceRegistry.getAiPreviewExpandedModeHandler();
}

function getAiPreviewGetStateHandler() {
  return contentMainServiceRegistry.getAiPreviewGetStateHandler();
}

function getAiPreviewShowHandler() {
  return contentMainServiceRegistry.getAiPreviewShowHandler();
}

function getAiSubmissionXpathsHandler() {
  return contentMainServiceRegistry.getAiSubmissionXpathsHandler();
}

function getCapturePageSnapshotHandler() {
  return contentMainServiceRegistry.getCapturePageSnapshotHandler();
}

function getConfigUpdatedHandler() {
  return contentMainServiceRegistry.getConfigUpdatedHandler();
}

function getCollectPageDataHandler() {
  return contentMainServiceRegistry.getCollectPageDataHandler();
}

function getDefaultExclusionsHandler() {
  return contentMainServiceRegistry.getDefaultExclusionsHandler();
}

function getDescribeXpathsHandler() {
  return contentMainServiceRegistry.getDescribeXpathsHandler();
}

function getFocusHandler() {
  return contentMainServiceRegistry.getFocusHandler();
}

function getForceRefreshHandler() {
  return contentMainServiceRegistry.getForceRefreshHandler();
}

function getInvisibleXpathsHandler() {
  return contentMainServiceRegistry.getInvisibleXpathsHandler();
}

function getVisibleXpathsHandler() {
  return contentMainServiceRegistry.getVisibleXpathsHandler();
}

function getPropertyLockPortClient() {
  return contentMainServiceRegistry.getPropertyLockPortClient() as PropertyLockPortClient;
}

function getPropertyLockStateMachine() {
  return contentMainServiceRegistry.getPropertyLockStateMachine() as PropertyLockStateMachine;
}

function createLifecycleOperationId(kind: string) {
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

export function exposeDebugSpinnerQueueTabId() {
  if (!isPageBlockerDebugEnabled()) {
    return;
  }
  try {
    browser.runtime.sendMessage({ type: "getTabState" }).then((response) => {
      if (
        response &&
        Number.isFinite(response.tabId) &&
        typeof document !== "undefined" &&
        document.documentElement
      ) {
        document.documentElement.dataset.ufDebugTabId = String(response.tabId);
      }
    }).catch(() => {});
  } catch {
    // Best-effort debug hook; never block normal extension operation.
  }
}

function normalizePageBlockingReason(event: PageBlockerEvent = {}) {
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

function logPageBlockerReason(event: PageBlockerEvent = {}) {
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

function emitLifecycleEvent(event: PageBlockerEvent = {}) {
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

function logContentDiagnostic(level: "error" | "warn", ...args: unknown[]) {
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

async function loadGlobalAiSettingsForContent() {
  const settings = await getGlobalAiSettings();
  return {
    stageBaseValue: settings.stageBaseValue,
    tokenValue: settings.tokenValue,
    configEndpointValue: settings.configEndpointValue
  };
}

async function fetchPropertyPageTypesForSiteId(
  siteId: SiteIdValue,
  stageBaseValue: string,
  tokenValue: string
): Promise<FetchPropertyPageTypesResult> {
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

async function resolveCurrentLivePageTarget(
  baseUrl: unknown,
  options: { pageUrl?: unknown; forceSiteIdRefresh?: unknown } = {}
): Promise<LivePageTargetResult> {
  const pageUrl = typeof options.pageUrl === "string" && options.pageUrl
    ? options.pageUrl
    : location.href;
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || (typeof baseUrl === "string" ? baseUrl : "");
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
  const siteId = normalizeSiteIdValue(normalizedConfig.siteId);
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

async function resolveCurrentPropertyLockConnectionTarget(
  options: { pageUrl?: unknown; forceSiteIdRefresh?: unknown } = {}
): Promise<PropertyLockConnectionTargetResult> {
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
  const siteId = normalizeSiteIdValue(normalizedConfig && normalizedConfig.siteId);
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

async function resolveCurrentPageTypeForMarking(baseUrl: unknown, pageUrl = location.href) {
  const target = await resolveCurrentLivePageTarget(baseUrl, { pageUrl });
  if (!target.ok) {
    return { ok: false, reason: target.reason || "This page is not a current Live Page candidate." };
  }
  return { ok: true, pageType: target.pageType };
}

async function syncPropertyLockOffCandidateWarning(baseUrl: string, pageUrl = location.href): Promise<void> {
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

function normalizeAiPreviewItems(items: unknown): AiPreviewItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      xpath: typeof item.xpath === "string" ? item.xpath : "",
      text: typeof item.text === "string" ? item.text : "",
      title: typeof item.title === "string" && item.title
        ? item.title
        : (typeof item.xpath === "string" ? item.xpath : ""),
      kind: typeof item.kind === "string" && AI_PREVIEW_KINDS.has(item.kind) ? item.kind : ""
    }))
    .filter((item) => item.xpath);
}

function mapAiPreviewItemsToRenderableTargets(items: unknown): AiPreviewItem[] {
  const normalized = normalizeAiPreviewItems(items);
  const rows: AiPreviewItemWithPosition[] = [];
  const seenXpaths = new Set<string>();
  normalized.forEach((item) => {
    const sourceXpath = typeof item.xpath === "string" ? item.xpath : "";
    if (!sourceXpath) {
      return;
    }
    const sourceNode = core.getElementFromXPath(sourceXpath);
    if (!isElementNode(sourceNode) || isExtensionUiNode(sourceNode)) {
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
        kind: typeof item.kind === "string" && AI_PREVIEW_KINDS.has(item.kind) ? item.kind : "",
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

function setAiPreviewItems(items: unknown, options: AiPreviewStateUpdateOptions = {}): void {
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

function setAiPreviewItemSets(
  defaultItems: unknown,
  expandedItems: unknown,
  options: AiPreviewItemSetOptions = {}
): void {
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

function setAiPreviewItemsPending(pending: boolean) {
  aiPreviewState.itemsPending = Boolean(pending);
}

function publishAiPreviewSessionFacts() {
  const previewOpen = contentMarkingMachine.state === "preview";
  void publishContentSessionFacts({
    previewActive: previewOpen,
    previewBlocked: previewOpen,
    previewItemsPending: previewOpen && aiPreviewState.itemsPending
  });
}

function setAiPreviewExpandedMode(active: unknown): boolean {
  if (!isFeatureEnabled("previewExpandedStates")) {
    aiPreviewState.showAllCategories = false;
    setAiPreviewItems(aiPreviewState.defaultItems, { preserveFocusedXpath: true });
    return false;
  }
  if (contentMarkingMachine.state !== "preview") {
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

function setAiPreviewClickableTitle(node: Element | null | undefined, title: string): void {
  if (!node || !title) {
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

function syncAiPreviewClickableTargets(items: AiPreviewItem[]): void {
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
    if (!isElementNode(node) || isExtensionUiNode(node)) {
      return;
    }
    node.setAttribute(AI_PREVIEW_CLICKABLE_ATTR, "on");
    setAiPreviewClickableTitle(node, title);
    aiPreviewClickableNodes.add(node);
  });
}

function notifyAiPreviewFocusChanged(xpath: string): void {
  void sendRuntimeMessageSafely({
    type: "aiPreviewFocusChanged",
    baseUrl: state.baseUrl || "",
    pageUrl: location.href,
    xpath: typeof xpath === "string" ? xpath : ""
  });
}

function setAiPreviewFocusedXpath(xpath: unknown, options: AiPreviewStateUpdateOptions = {}): boolean {
  if (!machineOwnsPreviewRoutine()) {
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

function getAiPreviewClickTarget(eventTarget: EventTarget | null | undefined) {
  let node: Element | null =
    isElementNode(eventTarget)
      ? eventTarget
      : eventTarget instanceof Node && isElementNode(eventTarget.parentElement)
        ? eventTarget.parentElement
        : null;
  while (node) {
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

function handleAiPreviewClick(event: MouseEvent | null | undefined): boolean {
  if (!machineOwnsPreviewRoutine() || !event || event.button !== 0) {
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

function resolveAiPreviewSelectorForNode(
  node: Element | null | undefined,
  selectorByNode: Map<Element, string> | null | undefined
): string {
  if (!node || !(selectorByNode instanceof Map) || !selectorByNode.size) {
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
      let current: Element | null = node;
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
      let current: Element | null = matchedNode;
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

function isWithinTrackedPreviewNode(node: Element, trackedNodes: readonly Element[]): boolean {
  for (const trackedNode of trackedNodes) {
    if (trackedNode === node || trackedNode.contains(node)) {
      return true;
    }
  }
  return false;
}

function hasTrackedPreviewDescendant(node: Element, trackedNodes: readonly Element[]): boolean {
  for (const trackedNode of trackedNodes) {
    if (trackedNode !== node && node.contains(trackedNode)) {
      return true;
    }
  }
  return false;
}

function collectUndetectedAiPreviewNodes(trackedNodes: readonly Element[]): Element[] {
  if (!document.body) {
    return [];
  }
  const markabilityConfig = aiPreviewState.previousConfig || state.config;
  const results: Element[] = [];
  const stack: Element[] = [document.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (isExtensionUiNode(node) || isWithinConsentBoundary(node)) {
      continue;
    }
    if (isWithinTrackedPreviewNode(node, trackedNodes)) {
      continue;
    }
    const containsTrackedDescendant = hasTrackedPreviewDescendant(node, trackedNodes);
    const isVisibleMarkable = core.isVisible(node) && core.isMarkableElement(node, markabilityConfig, {
      allowParent: false,
      allowImmutableChildren: false
    });
    if (isVisibleMarkable && !containsTrackedDescendant) {
      results.push(node);
      continue;
    }
    pushChildElementsReverse(stack, node);
  }
  return results.sort(compareNodeOrder);
}

function buildAiPreviewItemsWithCategories(
  selectorSet: SelectorSetInput | null | undefined,
  defaultItems: unknown[] = []
): AiPreviewItem[] {
  const defaultPreviewItems = normalizeAiPreviewItems(defaultItems);
  const defaultTextByXpath = new Map<string, string>(
    defaultPreviewItems.map((item) => [item.xpath, item.text])
  );
  const collections = core.withElementComputationCache(() =>
    collectIncludedNodesFromSelectorSet(selectorSet)
  );
  const explicitIncludedSet = new Set<Element>(collections.explicitIncluded || []);
  const implicitIncluded: Element[] = (collections.included || []).filter(
    (node: unknown): node is Element => isElementNode(node) && !explicitIncludedSet.has(node)
  );
  const trackedNodes: Element[] = [
    ...(collections.excluded || []),
    ...(collections.included || [])
  ].filter(isElementNode);
  const rows: AiPreviewItemWithPosition[] = [];
  const seenXpaths = new Set<string>();

  function pushRow(node: Element | null | undefined, kind: string, selector = ""): void {
    if (!node) {
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

  (collections.excluded || []).forEach((node: Element) => {
    pushRow(
      node,
      AI_PREVIEW_KIND_EXCLUDED,
      resolveAiPreviewSelectorForNode(node, collections.exclusionSelectorByNode)
    );
  });
  (collections.explicitIncluded || []).forEach((node: Element) => {
    pushRow(
      node,
      AI_PREVIEW_KIND_EXPLICIT_INCLUDED,
      resolveAiPreviewSelectorForNode(node, collections.inclusionSelectorByNode)
    );
  });
  implicitIncluded.forEach((node: Element) => {
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

function showPageToast(message: string): void {
  getPageToastClient().show(message);
}

function submissionXpathsEqual(left: unknown, right: unknown): boolean {
  const leftXpaths = Array.isArray(left) ? left as XpathEntry[] : null;
  const rightXpaths = Array.isArray(right) ? right as XpathEntry[] : null;
  if (left === right) {
    return true;
  }
  if (!leftXpaths || !rightXpaths || leftXpaths.length !== rightXpaths.length) {
    return false;
  }
  for (let i = 0; i < leftXpaths.length; i += 1) {
    const leftItem = leftXpaths[i];
    const rightItem = rightXpaths[i];
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

function getCurrentPageSnapshotXPath(node: Node | null | undefined) {
  return isElementNode(node) ? core.getSnapshotXPath(node, getCurrentPageSnapshotOptions()) : "";
}

function readRenderModeInspectionActive() {
  return getRenderModeInspectionClient().readActiveFlag();
}

function setRenderModeInspectionActive(active: unknown): void {
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
}

function armRenderModeInspectionWatchdog() {
  getRenderModeInspectionClient().armWatchdog({
    timeoutMs: RENDER_MODE_INSPECTION_WATCHDOG_MS,
    onTimeout: () => {
      recoverFromStuckRenderModeInspection();
    }
  });
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
  resetPageVisitRevealFreezeKeys();
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

function isRenderModeConfirmedForBaseUrl(baseUrl: string, configs: Record<string, Config> | null | undefined): boolean {
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
  } catch (_error) {
    return null;
  }
}

function matchesActiveBaseUrl(baseUrl: unknown): boolean {
  return Boolean(
    typeof baseUrl === "string" &&
      baseUrl &&
      state.baseUrl &&
      utils.sameBaseUrl(baseUrl, state.baseUrl)
  );
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
  } catch (_error) {
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
  let result: Awaited<ReturnType<typeof utils.sendRuntimeMessage>>;
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

async function toggleEnabledFromPage(options: ToggleEnabledFromPageOptions = {}) {
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

function setSilentHighlightingsActive(active: boolean): void {
  if (active) {
    document.documentElement.setAttribute(SILENT_HIGHLIGHTINGS_ACTIVE_ATTR, "on");
  } else {
    document.documentElement.removeAttribute(SILENT_HIGHLIGHTINGS_ACTIVE_ATTR);
  }
}

function setSilentHighlightingPageMotionPaused(paused: boolean): void {
  if (paused) {
    core.pausePageMotion(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON);
  } else {
    core.resumePageMotion(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON);
  }
}

function getSilentHighlightEditorRevealKey(
  baseUrl: string | null | undefined,
  pageUrl: string | null | undefined
): string {
  const normalizedBaseUrl = utils.normalizeBaseUrl(baseUrl) || baseUrl;
  if (!normalizedBaseUrl || !pageUrl) {
    return "";
  }
  return `${normalizedBaseUrl}|${pageUrl}`;
}

function getPageVisitRevealFreezeKey(
  baseUrl: string | null | undefined,
  pageUrl: string | null | undefined
): string {
  return getSilentHighlightEditorRevealKey(baseUrl, pageUrl);
}

function consumePageVisitRevealFreezeAttempt(
  baseUrl: string | null | undefined,
  pageUrl: string | null | undefined
): boolean {
  const revealKey = getPageVisitRevealFreezeKey(baseUrl, pageUrl);
  if (!revealKey || !baseUrl || !utils.isPageWithinBaseUrl(pageUrl, baseUrl)) {
    return false;
  }
  if (pageVisitRevealFreezeAttemptKey === revealKey) {
    return false;
  }
  pageVisitRevealFreezeAttemptKey = revealKey;
  return true;
}

function markSilentHighlightEditorRevealPrepared(
  baseUrl: string | null | undefined,
  pageUrl: string | null | undefined
): void {
  const revealKey = getSilentHighlightEditorRevealKey(baseUrl, pageUrl);
  if (!revealKey) {
    return;
  }
  pageVisitRevealFreezeAttemptKey = revealKey;
  silentHighlightEditorRevealKey = revealKey;
}

function resetPageVisitRevealFreezeKeys() {
  silentHighlightEditorRevealKey = "";
  pageVisitRevealFreezeAttemptKey = "";
}

function shouldRunSilentHighlightEditorActivation() {
  if (state.enabled) {
    return false;
  }
  if (isRenderModeInspectionActive()) {
    return false;
  }
  // Brain-dictated page-prep gate: reveal/freeze runs for any render-mode-confirmed
  // candidate page (marking off), even with no stored selectors yet. The silent
  // overlay still requires isSilentHighlightActiveByDirective() (stored selectors).
  if (!isPageRevealFreezeActiveByDirective()) {
    return false;
  }
  if (!isPropertyLockCollaborationEnabled()) {
    return true;
  }
  return Boolean(propertyLockState && propertyLockState.isEditor);
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
      shouldRunSilentHighlightEditorActivation()
    );
  };

  silentHighlightEditorActivationPromise = runActivationLoop().finally(() => {
    silentHighlightEditorActivationPromise = null;
    // The silent-highlight editor reveal/freeze is a component of the content
    // inspection `pending` fact (see createInspectionStatusResolver:
    // editorPreparationPending). It clears here, AFTER the page-inspection UI
    // already settled and fired its one inspectionSettled event, so without this
    // second signal the popup keeps a stale "Preparing page content..." curtain
    // (its last poll saw pending=true and nothing re-triggers a refresh). Notify
    // so the popup re-polls the now-settled status.
    notifyInspectionSettled();
  });

  return silentHighlightEditorActivationPromise;
}

async function runEditorSilentHighlightingActivationOnce() {
  if (!shouldRunSilentHighlightEditorActivation()) {
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
  let shouldRefreshAfterActivation: boolean | undefined;
  let lifecycleOperationId = "";
  let lifecycleStarted = false;
  let lifecycleFinished = false;
  let lifecyclePhase: LifecyclePhase = LIFECYCLE_PHASES.FINISHED;
  const emitSilentHighlightLifecycle = (
    phase: LifecyclePhase,
    busy: boolean,
    message = ""
  ): void => {
    if (!lifecycleOperationId) {
      lifecycleOperationId = createLifecycleOperationId(LIFECYCLE_KINDS.SILENT_HIGHLIGHTING);
    }
    emitLifecycleEvent({
      operationId: lifecycleOperationId,
      kind: LIFECYCLE_KINDS.SILENT_HIGHLIGHTING,
      phase,
      busy,
      message
    });
  };
  const finishSilentHighlightLifecycle = () => {
    if (!lifecycleStarted || lifecycleFinished) {
      return;
    }
    lifecycleFinished = true;
    emitSilentHighlightLifecycle(lifecyclePhase, false, "");
  };
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
    const pageTypeResult = await resolveCurrentPageTypeForMarking(baseUrl, pageUrl);
    if (!pageTypeResult.ok || !pageTypeResult.pageType) {
      resetPageVisitRevealFreezeKeys();
      shouldRefreshAfterActivation = true;
      return;
    }
    state.currentPageType = pageTypeResult.pageType;
    const revealKey = getSilentHighlightEditorRevealKey(baseUrl, pageUrl);
    if (revealKey && revealKey === silentHighlightEditorRevealKey) {
      shouldRefreshAfterActivation = true;
      return;
    }
    if (!consumePageVisitRevealFreezeAttempt(baseUrl, pageUrl)) {
      shouldRefreshAfterActivation = true;
      return;
    }
    const previousReconciliation = core.getPageSaveReconciliationState(pageUrl);
    const isStillCurrent = () =>
      silentHighlightEditorRevealInFlight === activationId &&
      (isSilentHighlightActiveByDirective() ||
        isPageRevealFreezeActiveByDirective() ||
        core.isPageSaveReconciliationPending(pageUrl)) &&
      location.href === pageUrl &&
      utils.isPageWithinBaseUrl(location.href, baseUrl);
    lifecycleStarted = true;
    emitSilentHighlightLifecycle(
      LIFECYCLE_PHASES.REVEAL_STARTED,
      true,
      "Inspecting page..."
    );
    await core.setPageSaveReconciliationPending(baseUrl, pageUrl, {
      reason: SILENT_HIGHLIGHTING_PREPARATION_REASON
    });
    // THE REVEAL/FREEZE CONTRACT (architect, 2026-07-03): one full ritual per
    // page visit — smooth-scroll to top, walk to the true bottom with the
    // lazyloader frozen at 50% of the initial height (max ONE lazy expansion
    // for the whole ritual), then freeze. Concurrent warmups JOIN the ritual
    // (see core.warmupSilentHighlightingBeforeMotionPause).
    const prepared = await core.warmupSilentHighlightingBeforeMotionPause(
      baseUrl,
      pageUrl,
      SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON,
      { keepUiActive: true }
    );
    if (isStillCurrent() && prepared && revealKey) {
      markSilentHighlightEditorRevealPrepared(baseUrl, pageUrl);
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
  } catch (error) {
    lifecyclePhase = LIFECYCLE_PHASES.FAILED;
    core.finishPageInspectionUi();
    finishSilentHighlightLifecycle();
    throw error;
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
      finishSilentHighlightLifecycle();
    }
    return;
  }
  core.finishPageInspectionUi();
  finishSilentHighlightLifecycle();
}

function ensureSilentHighlightOverlay() {
  ensureSilentHighlightingStyles();
  let overlay = document.getElementById(SILENT_HIGHLIGHT_OVERLAY_ID) as HTMLElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = SILENT_HIGHLIGHT_OVERLAY_ID;
    overlay.setAttribute("data-uf-extension-ui", "true");
    const createdOverlay = overlay;
    SILENT_HIGHLIGHT_LAYER_KEYS.forEach((key) => {
      const layer = document.createElement("div");
      layer.className = "uf-silent-layer";
      layer.dataset.layer = key;
      createdOverlay.appendChild(layer);
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
  overlay.querySelectorAll<HTMLElement>(".uf-silent-layer[data-layer]").forEach((layer) => {
    if (!SILENT_HIGHLIGHT_LAYER_KEYS.includes(layer.dataset.layer || "")) {
      layer.remove();
    }
  });
  SILENT_HIGHLIGHT_LAYER_KEYS.forEach((key) => {
    let layer = overlay.querySelector<HTMLElement>(`[data-layer="${key}"]`);
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

function setSilentHighlightOverlayHidden(hidden: boolean): void {
  if (!silentHighlightOverlay) {
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

function beginSilentLayerRender(key: string): SilentHighlightLayerState {
  const layer = silentHighlightLayers[key];
  if (!layer) {
    return null;
  }
  const map = silentHighlightLayerBoxes[key] || new Map<string, HTMLElement>();
  silentHighlightLayerBoxes[key] = map;
  return { layer, map, used: new Set<string>() };
}

function finalizeSilentLayerRender(layerState: SilentHighlightLayerState): void {
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

function collectSilentHighlightRects(node: Element | null | undefined) {
  if (!node || !core.isVisible(node)) {
    return [];
  }
  const rects: Array<{ top: number; left: number; width: number; height: number }> = [];
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

function cloneSilentHighlightNodes(nodes: Iterable<unknown> | null | undefined): Element[] {
  return Array.from(nodes || []).filter(isElementNode);
}

function cloneSilentHighlightNodeValueMap(
  valueByNode: Map<Element, string> | Map<unknown, string> | null | undefined
): Map<Element, string> {
  return valueByNode instanceof Map ? new Map(valueByNode as Map<Element, string>) : new Map();
}

function buildSilentHighlightRenderableCollections(
  collections: Partial<SilentHighlightCollections> | null | undefined
): SilentHighlightCollections {
  const sourceCollections = collections || {};
  const sourceImmutableNodes = cloneSilentHighlightNodes(
    Array.isArray(sourceCollections.sourceImmutableNodes)
      ? sourceCollections.sourceImmutableNodes
      : sourceCollections.immutableNodes
  );
  const sourceContentNodes = cloneSilentHighlightNodes(
    Array.isArray(sourceCollections.sourceContentNodes)
      ? sourceCollections.sourceContentNodes
      : sourceCollections.contentNodes
  );
  const sourceExcludedNodes = cloneSilentHighlightNodes(
    Array.isArray(sourceCollections.sourceExcludedNodes)
      ? sourceCollections.sourceExcludedNodes
      : sourceCollections.excludedNodes
  );
  const fallbackExplicitIncludeNodes =
    sourceCollections.explicitIncludeXpathByNode instanceof Map
      ? Array.from(sourceCollections.explicitIncludeXpathByNode.keys())
      : [];
  const sourceExplicitIncludeNodes = cloneSilentHighlightNodes(
    Array.isArray(sourceCollections.sourceExplicitIncludeNodes)
      ? sourceCollections.sourceExplicitIncludeNodes
      : fallbackExplicitIncludeNodes
  );
  const sourceHiddenExplicitIncludeNodes = cloneSilentHighlightNodes(
    Array.isArray(sourceCollections.sourceHiddenExplicitIncludeNodes)
      ? sourceCollections.sourceHiddenExplicitIncludeNodes
      : []
  );
  const sourceInclusionSelectorByNode = cloneSilentHighlightNodeValueMap(
    sourceCollections.sourceInclusionSelectorByNode instanceof Map
      ? sourceCollections.sourceInclusionSelectorByNode
      : sourceCollections.explicitIncludeSelectorByNode
  );
  const sourceExclusionSelectorByNode = cloneSilentHighlightNodeValueMap(
    sourceCollections.sourceExclusionSelectorByNode instanceof Map
      ? sourceCollections.sourceExclusionSelectorByNode
      : sourceCollections.excludedSelectorByNode
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
  const ghostContentNodes = explicitIncludedRenderable.nodes.filter((node) => {
    const sourceNode = explicitIncludedRenderable.sourceByTarget.get(node);
    return Boolean(sourceNode && sourceHiddenExplicitIncludeSet.has(sourceNode));
  });
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

function drawSilentRectsForNode(
  layerState: SilentHighlightLayerState,
  node: Element | null | undefined,
  className: string,
  keySalt = ""
): void {
  if (!layerState || !node || !className) {
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

function renderSilentHighlightOverlay(
  collections: SilentHighlightCollections,
  options: SilentHighlightOverlayOptions = {}
): void {
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

function repositionSilentHighlightOverlay(options: SilentHighlightOverlayOptions = {}) {
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

function buildSilentHighlightPositionSignature(
  collections: SilentHighlightCollections | null = silentHighlightCollections
): string {
  if (!collections) {
    return "";
  }
  const entries: string[] = [];
  const appendNodes = (nodes: Element[] | null | undefined, prefix: string) => {
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
        if (!target) {
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

function scheduleSilentHighlightReposition(options: { waitForSettle?: boolean } = {}): void {
  // Every reposition trigger (scroll, resize, layout shift, DOM mutation) is a
  // page-environment change: invalidate core's persisted per-element caches so
  // the silent redraw reclassifies against CURRENT geometry instead of values
  // cached during an earlier marking pass or scroll moment (debug round S3).
  core.notifyPageEnvironmentChanged();
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

function isViewportScrollEvent(
  event: Event | { target?: EventTarget | null; currentTarget?: EventTarget | null } | null | undefined
): boolean {
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

function buildSilentHighlightTitle(selector: unknown, xpath: unknown): string {
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

function setSilentSelectorAnnotation(
  node: Element | null | undefined,
  kind: SilentHighlightAnnotationKind,
  selector = "",
  xpath = ""
): void {
  if (!node) {
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

function buildSilentHighlightXpathByNode(nodes: Iterable<unknown> | null | undefined): Map<Element, string> {
  const xpathByNode = new Map<Element, string>();
  for (const node of nodes || []) {
    if (!isElementNode(node)) {
      continue;
    }
    const xpath = core.getXPath(node);
    if (typeof xpath === "string" && xpath) {
      xpathByNode.set(node, xpath);
    }
  }
  return xpathByNode;
}

function applySilentSelectorAnnotations(collections: SilentHighlightCollections | null | undefined): void {
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

async function copyTextToClipboard(text: unknown): Promise<boolean> {
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

function handleSilentSelectorClickCopy(event: MouseEvent | null | undefined): void {
  if (!event || event.defaultPrevented || event.button !== 0) {
    return;
  }
  const target =
    isElementNode(event.target)
      ? event.target
      : event.target instanceof Node && isElementNode(event.target.parentElement)
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

function scheduleSilentHighlightingsRefresh(options: SilentHighlightRefreshScheduleOptions = {}): void {
  const debounceMsValue = options && options.debounceMs;
  const minIntervalMsValue = options && options.minIntervalMs;
  const debounceMs = Number.isFinite(debounceMsValue)
    ? Math.max(0, Math.trunc(Number(debounceMsValue)))
    : SILENT_HIGHLIGHTING_MUTATION_DEBOUNCE_MS;
  const minIntervalMs = Number.isFinite(minIntervalMsValue)
    ? Math.max(0, Math.trunc(Number(minIntervalMsValue)))
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

function isExtensionUiNode(node: Element | null | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node.getAttribute("data-uf-extension-ui") === "true") {
    return true;
  }
  return Boolean(node.closest("[data-uf-extension-ui=\"true\"]"));
}

function shouldRefreshForSilentMutation(mutation: MutationRecord | null | undefined): boolean {
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
    return !(isElementNode(mutation.target) && isExtensionUiNode(mutation.target));
  }
  if (mutation.type !== "childList") {
    return false;
  }
  if (isElementNode(mutation.target) && isExtensionUiNode(mutation.target)) {
    return false;
  }
  for (const node of mutation.addedNodes || []) {
    if (isElementNode(node) && !isExtensionUiNode(node)) {
      return true;
    }
  }
  for (const node of mutation.removedNodes || []) {
    if (isElementNode(node) && !isExtensionUiNode(node)) {
      return true;
    }
  }
  return false;
}

function buildSilentHighlightTrackedNodeIndex(): SilentHighlightTrackedNodeIndex {
  // tracked: every node the silent overlay cares about, by reference.
  // ancestors: every ancestor of any tracked node, so we can detect a mutation
  //   whose target is an ancestor of a tracked node (target.contains(tracked))
  //   in O(1) instead of O(N).
  const tracked = new Set<Node>();
  const ancestors = new Set<Node>();
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
    for (const candidate of group) {
      if (!(candidate instanceof Node) || candidate.nodeType !== 1 || tracked.has(candidate)) {
        continue;
      }
      const node = candidate;
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

function mutationTargetTouchesSilentCollections(target: Node | null | undefined): boolean {
  if (!target || target.nodeType !== 1 || !silentHighlightCollections) {
    return false;
  }
  const nodeIndex =
    silentHighlightTrackedNodeIndex ||
    (silentHighlightTrackedNodeIndex = buildSilentHighlightTrackedNodeIndex());
  const { tracked, ancestors } = nodeIndex;
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
          entry && typeof (entry as PerformanceEntry & { value?: unknown }).value === "number"
            ? Number((entry as PerformanceEntry & { value?: number }).value) > 0
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
  // Event-based: install the shared in-page navigation notifier (history patch +
  // popstate/hashchange) so the `unfluffify:url-changed` listener fires on SPA
  // navigation in silent mode too, without an 800ms polling timer.
  core.ensureNavigationNotifierInstalled();
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
  // Every preview-state teardown must republish the preview session facts.
  // The brain heartbeat re-serves the content STATE_GET snapshot every second,
  // so a silent reset (force-disable / out-of-scope configUpdated) leaves a
  // sticky previewActive:true that the heartbeat re-folds forever, flapping
  // markingEditsBlocked against the popup's previewActive:false reports.
  publishAiPreviewSessionFacts();
  return true;
}

function pageDraftEntryHasSaveableMarkings(entry: ContentPageEntry | null | undefined): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const candidate = entry as {
    xpaths?: unknown;
    includeXpaths?: unknown;
    submissionXpaths?: unknown;
    renderedHtml?: unknown;
  };
  return (
    (Array.isArray(candidate.xpaths) && candidate.xpaths.length > 0) ||
    (Array.isArray(candidate.includeXpaths) && candidate.includeXpaths.length > 0) ||
    (Array.isArray(candidate.submissionXpaths) && candidate.submissionXpaths.length > 0) ||
    (typeof candidate.renderedHtml === "string" && candidate.renderedHtml.length > 0)
  );
}

function restoreAiPreviewDraftState(
  restoreState: AiPreviewState,
  freshAiSnapshotEntry: ContentPageEntry | null = null
): void {
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
  // Prefer the AI run's freshly captured snapshot (complete, with rendered HTML)
  // when it carries saveable markings; otherwise restore the pre-AI draft. A
  // fresh candidate has no pre-AI draft, so without the snapshot the just-computed
  // markings the pending Save must upload would be discarded.
  const restoredEntry = pageDraftEntryHasSaveableMarkings(freshAiSnapshotEntry)
    ? core.clonePageEntry(freshAiSnapshotEntry)
    : previousDraftEntry;
  if (restoredEntry) {
    state.config.pageMarkings[pageUrl] = restoredEntry;
  } else {
    delete state.config.pageMarkings[pageUrl];
  }
  core.setSavedPageEntry(pageUrl, restoreState.previousSavedEntry || null);
  core.state.autoSeedSuppressedPageUrl = restoredEntry ? "" : pageUrl;
  state.autoSeededPendingSavePageUrl =
    restoreState.previousAutoSeededPendingSavePageUrl || "";
}

function scheduleAiComputeLockRelease(expiresAt: number) {
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
    if (contentMarkingMachine.state === "compute_lock") {
      exitAiPreviewMode().then();
    }
  }, Math.max(0, Math.ceil(expiresAt - Date.now())));
}

function beginAiPreviewMode(options = {}) {
  const previewOptions = options as { mode?: unknown };
  const nextMode = typeof previewOptions.mode === "string" ? previewOptions.mode : "preview";
  const restoreMarkingOnExit = nextMode === "compute_lock";
  // Machine step at the routine boundary — BEFORE core.disable() below so the
  // entry memory captures whether marking was enabled at entry.
  stepContentMachine(
    nextMode === "compute_lock" ? "compute-lock-begun" : "preview-opened",
    { enabledAtEntry: Boolean(state.enabled) }
  );
  if (!aiPreviewState.active) {
    const previousPageUrl = location.href;
    aiPreviewState = {
      active: true,
      mode: nextMode,
      items: [],
      defaultItems: [],
      expandedItems: [],
      itemsPending: false,
      showAllCategories: false,
      itemXpathSet: new Set(),
      focusedXpath: "",
      previousEnabled: Boolean(state.enabled),
      restoreMarkingOnExit,
      previousBaseUrl: state.baseUrl || "",
      previousPageUrl,
      previousConfig: state.config,
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

  if (contentMarkingMachine.previousEnabled && state.enabled) {
    core.disable();
  }
  if (contentMarkingMachine.restoreMarkingOnExit) {
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

void enterAiPreviewMode;

function buildCurrentPageDraftStatusSnapshot(pageUrl = location.href) {
  if (!state.config) {
    return null;
  }
  const draftEntry = core.getDraftPageEntry(pageUrl);
  const savedEntry = core.getSavedPageEntry(pageUrl);
  return {
    ok: true,
    entry: draftEntry ? core.clonePageEntry(draftEntry) : null,
    savedEntry: savedEntry ? core.clonePageEntry(savedEntry) : null,
    dirty: Boolean(core.isPageDraftDirty(pageUrl)),
    reconciliation: core.getPageSaveReconciliationState(pageUrl) || null,
    reconciliationPending: Boolean(core.isPageSaveReconciliationPending(pageUrl))
  };
}

function buildAiPreviewStateSnapshot() {
  return getAiPreviewStateResponseBuilder().buildGetStateResponse();
}

function notifyAiPreviewStateChanged() {
  publishAiPreviewSessionFacts();
  void sendRuntimeMessageSafely({
    type: "aiPreviewStateChanged",
    baseUrl: state.baseUrl || "",
    pageUrl: location.href,
    ...buildAiPreviewStateSnapshot()
  });
}

function notifyInspectionSettled() {
  void sendRuntimeMessageSafely({
    type: "inspectionSettled",
    baseUrl: state.baseUrl || "",
    pageUrl: location.href
  });
}

async function exitAiPreviewMode() {
  // P4 step 4.4: the machine owns the routine record — a re-entrant exit
  // during the restore (machine already in `restoring`) must no-op instead
  // of running the restore twice.
  if (!machineOwnsPreviewRoutine()) {
    return {
      active: false,
      markingEnabled: Boolean(state.enabled),
      baseUrl: state.baseUrl || "",
      pageUrl: location.href,
      pageType: state.currentPageType || "",
      draftStatus: buildCurrentPageDraftStatusSnapshot()
    };
  }

  const restoreState = aiPreviewState;
  // The machine memorized the exit destination at routine entry (compute_lock
  // always restores; preview inherits the lock's memory).
  const shouldRestoreMarking = resolveContentExitDestination(contentMarkingMachine) === "marking";
  stepContentMachine("exit-begun");
  // REFLEX-ARC P3 §3.2: 'preview.exited' is born HERE — the restoring
  // routine's return points are the only place that knows the exit actually
  // settled and whether marking was restored. (The brain's EXITED ai-run
  // event no longer doubles as this signal's birthplace.)
  const emitPreviewExited = (restored: boolean) => {
    stepContentMachine("exit-settled");
    void emitContentSignal({
      name: SIGNAL_NAMES.PREVIEW_EXITED,
      source: "content",
      cause: "exit-routine",
      payload: { restored, pageUrl: location.href }
    });
  };
  let restoredBaseUrl = restoreState.previousBaseUrl || state.baseUrl || "";
  if (
    shouldRestoreMarking &&
    (!restoredBaseUrl || !utils.isPageWithinBaseUrl(location.href, restoredBaseUrl))
  ) {
    restoredBaseUrl = await resolveBaseUrlForCurrentPage();
  }

  if (shouldRestoreMarking && restoredBaseUrl) {
    // Read the AI run's freshly persisted snapshot before re-enabling marking
    // discards the current page draft. enableForBaseUrl wipes the entry and the
    // restore below only updates in-memory state, so without re-persisting the
    // snapshot the Save (which reads the stored config) uploads an empty page.
    let persistedAiSnapshotEntry: ContentPageEntry | null = null;
    if (location.href === (restoreState.previousPageUrl || location.href)) {
      try {
        const persistedConfig = await core.loadConfig(restoredBaseUrl);
        persistedAiSnapshotEntry = core.clonePageEntry(
          core.findPageMarkingEntry(persistedConfig, location.href, restoredBaseUrl)
        );
      } catch {
        persistedAiSnapshotEntry = null;
      }
    }
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
    restoreAiPreviewDraftState(restoreState, persistedAiSnapshotEntry);
    if (
      restoredMarking &&
      state.config &&
      pageDraftEntryHasSaveableMarkings(core.getDraftPageEntry(location.href))
    ) {
      // Persist the restored/preserved draft so the pending Save uploads the
      // AI-computed markings instead of an empty page. Persistence is best-effort:
      // a rejected idbSet (transaction abort, or invalidated content context)
      // must NOT skip resetAiPreviewState()/setTabState below, or the content
      // stays wedged in "preview active" after marking was already re-enabled.
      try {
        await core.saveConfig(restoredBaseUrl, state.config);
      } catch {
        // Keep the exit flow going; the draft still lives in memory and the
        // next capture/persist re-writes it.
      }
    }
    if (restoredMarking) {
      refreshEnabledAiHighlights();
    }
    resetAiPreviewState();
    publishAiPreviewSessionFacts();
    void utils.sendRuntimeMessage({
      type: "setTabState",
      enabled: true,
      baseUrl: restoredBaseUrl,
      pageType: state.currentPageType || ""
    }).catch(() => null);
    emitPreviewExited(true);
    return {
      active: false,
      markingEnabled: Boolean(state.enabled),
      baseUrl: restoredBaseUrl,
      pageUrl: location.href,
      pageType: state.currentPageType || "",
      draftStatus: buildCurrentPageDraftStatusSnapshot()
    };
  }

  // Keep the preview-open motion-pause bridge through this refresh. Clearing the
  // preview state first would drop the only local hold before the brain publishes
  // previewActive=false and re-projects the settled silent/reveal directive.
  await refreshSilentHighlightings();
  resetAiPreviewState();
  publishAiPreviewSessionFacts();
  emitPreviewExited(false);
  return {
    active: false,
    markingEnabled: Boolean(state.enabled),
    baseUrl: state.baseUrl || "",
    pageUrl: location.href,
    pageType: state.currentPageType || "",
    draftStatus: buildCurrentPageDraftStatusSnapshot()
  };
}

function getStoredAiSelectorSet(baseConfig: unknown): SelectorSet {
  if (!baseConfig || typeof baseConfig !== "object") {
    return { exclusionSelectors: [], inclusionSelectors: [] };
  }
  return config.getNewestConfigSelectorSet(baseConfig).selectorSet;
}

function getSelectorSuppressedXpaths(baseConfig: unknown, pageUrl = location.href): string[] {
  const pageMarkings = baseConfig && typeof baseConfig === "object"
    ? (baseConfig as { pageMarkings?: unknown }).pageMarkings
    : null;
  const entry = core.findPageMarkingEntry({ pageMarkings }, pageUrl, state.baseUrl || "");
  return getSuppressedXpathList(entry?.selectorSuppressedXpaths);
}

function getEffectiveAiSelectorSet(baseConfig: unknown): EffectiveSelectorSet {
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

function hasStoredAiSelectorHighlights(baseConfig: unknown): boolean {
  return combineAiSelectorSet(getStoredAiSelectorSet(baseConfig)).length > 0;
}

function resolveSuppressedSelectorBoundaries(suppressedXpaths: unknown): SuppressedSelectorBoundaries {
  const xpaths = getSuppressedXpathList(suppressedXpaths);
  return {
    xpaths,
    elements: xpaths
      .map((xpath) => core.getElementFromXPath(xpath))
      .filter(isElementNode)
  };
}

function isSuppressedSelectorNode(
  node: Element | null | undefined,
  suppressedBoundaries: SuppressedSelectorBoundaries | null | undefined
): boolean {
  if (!node || !suppressedBoundaries || !suppressedBoundaries.xpaths.length) {
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

function getSuppressedSelectorFingerprint(suppressedXpaths: unknown): string {
  return getSuppressedXpathList(suppressedXpaths)
    .slice()
    .sort()
    .join(SELECTOR_LIST_DELIMITER);
}

function collectNodesFromSelectors(selectors: unknown, options: SelectorCollectionOptions = {}) {
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

function resolveSelectorForNode(
  node: Element | null | undefined,
  selectorByNode: Map<Element, string> | null | undefined,
  allowAncestorMatch = false
): string {
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

function isWithinConsentBoundary(node: Element | null | undefined): boolean {
  return Boolean(
    node &&
    typeof node.closest === "function" &&
    node.closest(`[${core.CONSENT_HIDDEN_ATTR}]`)
  );
}

function hasDirectRenderableText(node: Element | null | undefined): boolean {
  if (!node) {
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

function isDefinitelyHiddenSubtreeNode(node: Element | null | undefined): boolean {
  if (!node) {
    return true;
  }
  if ("hidden" in node && node.hidden === true) {
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

function matchesImmutableDefaultSelector(node: Element | null | undefined): boolean {
  if (!node) {
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

function matchesToggleableDefaultSelector(node: Element | null | undefined): boolean {
  if (!node) {
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

function matchesAutoToggleableDefaultSelector(node: Element | null | undefined): boolean {
  // F1 LOCKED (deliberate 052c deviation, see marking-widening-review.md):
  // auto-exclusion follows the taxonomy tag unconditionally — kept in lockstep
  // with core's matchesAutoToggleableDefaultExcluded, whose former
  // visible-immutable-descendant suppression (and its rule-1/2 bypasses)
  // collapsed to the plain tag match.
  return matchesToggleableDefaultSelector(node);
}

function isWithinImmutableDefaultNode(node: Element | null | undefined): boolean {
  let current = node;
  while (current && current.nodeType === 1) {
    if (matchesImmutableDefaultSelector(current)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isToggleableDefaultExcludedNode(
  node: Element | null | undefined,
  includedNodes: Set<Element> | null | undefined
): boolean {
  return matchesAutoToggleableDefaultSelector(node) && !isWithinNodeSet(node, includedNodes);
}

function isWithinToggleableDefaultExcludedNode(
  node: Element | null | undefined,
  includedNodes: Set<Element> | null | undefined
): boolean {
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

function isRawSelectorExcludedNode(
  node: Element | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined
): boolean {
  return isWithinNodeSet(node, excludedNodes) && !isWithinNodeSet(node, includedNodes);
}

function isSelectorExcludedNode(
  node: Element | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  _inclusionContextSet: Set<Element> | null | undefined
): boolean {
  return isRawSelectorExcludedNode(node, excludedNodes, includedNodes);
}

function isExcludedNatureNode(
  node: Element | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined
): boolean {
  return matchesImmutableDefaultSelector(node) ||
    isToggleableDefaultExcludedNode(node, includedNodes) ||
    isSelectorExcludedNode(node, excludedNodes, includedNodes, inclusionContextSet);
}

function isInclusionEligibleNode(
  node: Element | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined,
  options: InclusionSelectionOptions = {}
): boolean {
  const ignoreVisibilityForInclusionDetection = Boolean(options.ignoreVisibilityForInclusionDetection);
  if (!node) {
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

function isTextualContainerForInclusion(
  node: Element | null | undefined,
  options: InclusionSelectionOptions = {}
): boolean {
  const ignoreVisibilityForInclusionDetection = Boolean(options.ignoreVisibilityForInclusionDetection);
  if (!node) {
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
    const nestedText = (
      (node instanceof HTMLElement ? node.innerText : node.textContent) || ""
    ).replace(/\s+/g, " ").trim();
    return Boolean(nestedText);
  }
  return Boolean(getNormalizedNodeText(node));
}

function hasTextualDescendantForInclusion(
  node: Element | null | undefined,
  options: InclusionSelectionOptions = {}
): boolean {
  if (!node) {
    return false;
  }
  const stack = Array.from(node.children);
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
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
    pushChildElementsReverse(stack, current);
  }
  return false;
}

function hasTextualImmutableDescendantForInclusion(
  node: Element | null | undefined,
  options: InclusionSelectionOptions = {}
): boolean {
  if (!node) {
    return false;
  }
  const stack = Array.from(node.children);
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
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
    pushChildElementsReverse(stack, current);
  }
  return false;
}

function isSelfMarkableInclusionNode(
  node: Element | null | undefined,
  options: InclusionSelectionOptions = {}
): boolean {
  if (!isTextualContainerForInclusion(node, options)) {
    return false;
  }
  // Keep ancestor/descendant self-markable decisions stable even when
  // inclusion detection ignores visibility (used by silent highlight/preview).
  // Otherwise hidden responsive descendants can suppress a visible ancestor.
  const descendantShapeOptions: InclusionSelectionOptions = options.ignoreVisibilityForInclusionDetection
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
  node: Element | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined,
  options: InclusionSelectionOptions = {}
): boolean {
  const ignoreVisibilityForInclusionDetection = Boolean(options.ignoreVisibilityForInclusionDetection);
  if (!node) {
    return false;
  }
  const stack: Element[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
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
    pushChildElementsReverse(stack, current);
  }
  return false;
}

function hasRenderableTextForHighlight(
  node: Element | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined,
  options: InclusionSelectionOptions = {}
): boolean {
  if (!node) {
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
  node: Element | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  _inclusionContextSet: Set<Element> | null | undefined
): boolean {
  if (!node) {
    return false;
  }
  if (hasDirectRenderableText(node)) {
    return true;
  }
  const stack: Element[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
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
    pushChildElementsReverse(stack, current);
  }
  return false;
}

function getNodeDepth(node: Element | null | undefined): number {
  let depth = 0;
  let current = node;
  while (current && current.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function collapseToShallowest(nodes: Iterable<unknown> | null | undefined): Element[] {
  const sorted = toElementArray(nodes).sort((left, right) => {
    const depthDiff = getNodeDepth(left) - getNodeDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return 0;
  });
  const kept: Element[] = [];
  sorted.forEach((node) => {
    const hasAncestor = kept.some((ancestor) => ancestor.contains(node));
    if (!hasAncestor) {
      kept.push(node);
    }
  });
  return kept;
}

function collapseToShallowestWithOppositeBoundary(
  nodes: Iterable<unknown> | null | undefined,
  oppositeNodes: Iterable<unknown> | null | undefined
): Element[] {
  const oppositeSet = new Set(toElementArray(oppositeNodes));
  const sorted = Array.from(new Set(toElementArray(nodes))).sort((left, right) => {
    const depthDiff = getNodeDepth(left) - getNodeDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareNodeOrder(left, right);
  });
  const kept: Element[] = [];
  const keptSet = new Set<Element>();
  sorted.forEach((node) => {
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

function collapseToShallowestPreservingExplicitNodes(
  nodes: Iterable<unknown> | null | undefined,
  explicitNodes: Iterable<unknown> | null | undefined
): Element[] {
  const explicitSet = new Set(toElementArray(explicitNodes));
  const sorted = Array.from(new Set(toElementArray(nodes))).sort((left, right) => {
    const depthDiff = getNodeDepth(left) - getNodeDepth(right);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return compareNodeOrder(left, right);
  });
  const kept: Element[] = [];
  const keptSet = new Set<Element>();
  sorted.forEach((node) => {
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

function compareNodeOrder(left: Element, right: Element): number {
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

function collectExcludedChildrenInsideIncludedParents(
  includedParents: Iterable<unknown> | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined
): Element[] {
  const marked: Element[] = [];
  const seen = new Set<Element>();
  toElementArray(includedParents).forEach((parent) => {
    const stack = Array.from(parent.children);
    while (stack.length) {
      const node = stack.pop();
      if (!node) {
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
      pushChildElementsReverse(stack, node);
    }
  });
  return marked;
}

function collectSelectorExcludedNodes(
  excludedNodes: Iterable<unknown> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined
): Element[] {
  const marked = new Set<Element>();
  for (const node of toElementArray(excludedNodes)) {
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

function collectToggleableDefaultExcludedNodes(includedNodes: Set<Element> | null | undefined): Element[] {
  if (!document.body) {
    return [];
  }
  const results: Element[] = [];
  const stack: Element[] = [document.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
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
    pushChildElementsReverse(stack, node);
  }
  return results.sort(compareNodeOrder);
}

function collectImmutableDefaultExcludedNodes(includedNodes: Set<Element> | null | undefined): Element[] {
  if (!document.body) {
    return [];
  }
  const results: Element[] = [];
  const stack: Element[] = [document.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
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
    pushChildElementsReverse(stack, node);
  }
  return results.sort(compareNodeOrder);
}

function collectExplicitIncludedNodes(
  explicitIncludedMatches: Iterable<unknown> | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined,
  options: InclusionSelectionOptions = {}
): Element[] {
  const keepAllExplicitMatches = Boolean(options.keepAllExplicitMatches);
  const preserveNestedExplicitIncludedDescendants = Boolean(
    options.preserveNestedExplicitIncludedDescendants
  );
  const selected = new Set<Element>();
  const ordered = preserveNestedExplicitIncludedDescendants
    ? Array.from(new Set(toElementArray(explicitIncludedMatches))).sort(compareNodeOrder)
    : collapseToShallowest(explicitIncludedMatches);
  ordered.forEach((node) => {
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
  explicitIncluded: Iterable<unknown> | null | undefined,
  excludedNodes: Set<Element> | null | undefined,
  includedNodes: Set<Element> | null | undefined,
  inclusionContextSet: Set<Element> | null | undefined,
  options: InclusionSelectionOptions = {}
): Element[] {
  const explicitIncludedSet = new Set(toElementArray(explicitIncluded));
  const baseSelected = new Set<Element>();
  const stack: Element[] = document.body ? [document.body] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
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
    pushChildElementsReverse(stack, node);
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

function collectIncludedNodesFromSelectorSet(
  selectorSet: SelectorSetInput | null | undefined
): IncludedSelectorSetResult {
  // Silent highlighting inclusion selection is visibility-agnostic:
  // implicit non-excluded content + all explicit inclusion selector matches.
  const inclusionSelectionOptions: InclusionSelectionOptions = {
    ignoreVisibilityForInclusionDetection: true,
    preserveNestedExplicitIncludedDescendants: true,
    keepAllExplicitMatches: true
  };
  const normalized = normalizeAiSelectorSet(selectorSet);
  const suppressedXpaths = getSuppressedXpathList(selectorSet?.suppressedXpaths);
  const excludedMatches = collectNodesFromSelectors(normalized.exclusionSelectors, {
    suppressedXpaths
  });
  const includedMatches = collectNodesFromSelectors(normalized.inclusionSelectors, {
    suppressedXpaths
  });
  const filteredIncludedNodes = new Set<Element>();
  const filteredInclusionSelectorByNode = new Map<Element, string>();
  for (const node of includedMatches.nodes || []) {
    if (!node || isWithinConsentBoundary(node)) {
      continue;
    }
    filteredIncludedNodes.add(node);
    if (includedMatches.selectorByNode.has(node)) {
      const selector = includedMatches.selectorByNode.get(node);
      if (selector) {
        filteredInclusionSelectorByNode.set(node, selector);
      }
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
  const visibilityMemo = new WeakMap<Element, boolean>();
  const memoIsVisible = (node: Element | null | undefined): boolean => {
    if (!node) return false;
    const cached = visibilityMemo.get(node);
    if (cached !== undefined) return cached;
    const visible = core.isVisible(node);
    visibilityMemo.set(node, visible);
    return visible;
  };
  const isIncludedNodeAvailableForUser = (node: Element | null | undefined): boolean =>
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

function getSilentRenderNodeId(node: Element | null | undefined): number {
  if (!node) {
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
  immutableNodes: Element[],
  contentNodes: Element[],
  excludedNodes: Element[],
  ghostContentNodes: Element[] = [],
  explicitIncludeSelectorByNode: Map<Element, string> | null = null,
  excludedSelectorByNode: Map<Element, string> | null = null,
  explicitIncludeXpathByNode: Map<Element, string> | null = null,
  excludedXpathByNode: Map<Element, string> | null = null,
  implicitIncludeXpathByNode: Map<Element, string> | null = null
): string {
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
  const buildNodeValueKey = (valueByNode: Map<Element, string> | null) => JSON.stringify(
    (valueByNode instanceof Map ? Array.from(valueByNode.entries()) : [])
      .map(([node, value]): [number, string] => [getSilentRenderNodeId(node), value || ""])
      .filter(([id, value]) => Boolean(id && value))
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

function hasRenderableClientBox(node: Element | null | undefined): boolean {
  if (!node) {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function collectSilentHighlightRenderTargets(
  node: Element | null | undefined,
  options: SilentHighlightRenderTargetOptions = {}
): Element[] {
  const keepShallowestOnly = options.keepShallowestOnly !== false;
  if (!node) {
    return [];
  }
  if (hasRenderableClientBox(node)) {
    return [node];
  }
  const targets: Element[] = [];
  const stack = Array.from(node.children);
  let inspected = 0;
  const MAX_INSPECTED = 400;
  while (stack.length && inspected < MAX_INSPECTED) {
    const current = stack.shift();
    inspected += 1;
    if (!current) {
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
    pushChildElementsForward(stack, current);
  }
  return targets;
}

function toRenderableNodeListWithSelectors(
  nodes: Iterable<unknown> | null | undefined,
  selectorResolver: ((node: Element) => string) | null = null,
  options: RenderableNodeListOptions = {}
): RenderableNodeListResult {
  const dedupeTargets = options.dedupeTargets !== false;
  const keepShallowestFallbackTargets =
    options.keepShallowestFallbackTargets !== false;
  const results: Element[] = [];
  const seen = new Set<Element>();
  const selectorByNode = new Map<Element, string>();
  const sourceByTarget = new Map<Element, Element>();
  const appendSelector = (targetNode: Element | null | undefined, selector: string) => {
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
  for (const node of toElementArray(nodes)) {
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

function toRenderableNodeList(nodes: Iterable<unknown> | null | undefined): Element[] {
  return toRenderableNodeListWithSelectors(nodes).nodes;
}

function collectAiSubmissionXpathsForCurrentPage(sourceConfig: Config | null = state.config): XpathEntry[] {
  core.refreshPageMotionPause();
  const configValue = sourceConfig || state.config;
  if (!configValue) {
    return [];
  }
  return core.withElementComputationCache(() => {
    const submissionMarkOptions = {
      allowParent: false,
      allowImmutableChildren: false,
      allowConsentElements: true,
      ignoreVisibilityForInclusionDetection: true
    };
    const visMemo = new WeakMap<Element, boolean>();
    const xpathMemo = new WeakMap<Node, string>();
    const markMemo = new WeakMap<Element, boolean>();
    const memoVisible = (element: Element): boolean => {
      if (visMemo.has(element)) {
        return visMemo.get(element) ?? false;
      }
      const visible = core.isVisibleForSubmission(element);
      visMemo.set(element, visible);
      return visible;
    };
    const memoXPath = (node: Node | null | undefined): string => {
      if (!node) {
        return "";
      }
      if (xpathMemo.has(node)) {
        return xpathMemo.get(node) || "";
      }
      const xpath = getCurrentPageSnapshotXPath(node);
      xpathMemo.set(node, xpath);
      return xpath;
    };
    const memoMarkable = (element: Element): boolean => {
      if (markMemo.has(element)) {
        return markMemo.get(element) ?? false;
      }
      const markable = core.isMarkableElement(element, configValue, submissionMarkOptions);
      markMemo.set(element, markable);
      return markable;
    };
    const pageUrl = location.href;
    const entry = core.getPageMarkingEntry(configValue, pageUrl, {
      create: false,
      persist: false
    });
    const explicitExcludedXpaths = new Set<string>();
    const explicitIncludedXpaths = new Set<string>();
    const rowIndexByXpath = new Map<string, number>();
    const excludedRowXpaths: string[] = [];
    const excludedRowXpathSet = new Set();
    const rows: XpathEntry[] = [];
    const pushRow = (xpath: string, excluded: boolean): void => {
      if (typeof xpath !== "string" || !xpath) {
        return;
      }
      if (isAiSubmissionDocumentRootXpath(xpath)) {
        return;
      }
      const existingIndex = rowIndexByXpath.get(xpath) ?? -1;
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
    const normalizeXPath = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
    const isWithinImmutableExcludedBoundary = (element: Element | null | undefined): boolean => {
      let current = element;
      while (current && current.nodeType === 1) {
        if (core.isImmutableExcludedElement(current)) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    };
    const toSnapshotXPath = (value: unknown): string => {
      const xpath = normalizeXPath(value);
      if (!xpath) {
        return "";
      }
      const element = core.getElementFromXPath(xpath);
      if (!isElementNode(element)) {
        return "";
      }
      if (isWithinImmutableExcludedBoundary(element)) {
        return "";
      }
      return memoXPath(element);
    };
    const explicitRows = Array.isArray(entry && entry.xpaths) ? entry.xpaths as XpathEntry[] : [];
    explicitRows.forEach((item: XpathEntry) => {
      if (!item || typeof item.xpath !== "string" || !item.excluded) {
        return;
      }
      const element = core.getElementFromXPath(item.xpath);
      if (!isElementNode(element) || isWithinImmutableExcludedBoundary(element)) {
        return;
      }
      const xpath = memoXPath(element);
      if (!xpath) {
        return;
      }
      if (item.excluded) {
        explicitExcludedXpaths.add(xpath);
      }
    });
    (Array.isArray(entry && entry.includeXpaths) ? entry.includeXpaths as string[] : []).forEach((xpath: string) => {
      const normalized = toSnapshotXPath(xpath);
      if (normalized) {
        explicitIncludedXpaths.add(normalized);
      }
    });

    explicitExcludedXpaths.forEach((xpath) => pushRow(xpath, true));

    const hasExcludedAncestorRow = (xpath: string): boolean => {
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
    const stack: SnapshotTraversalItem[] = [{ node: document.body, insideImmutableExcluded: false }];
    while (stack.length) {
      const stackItem = stack.pop();
      const node = stackItem?.node;
      const insideImmutableExcluded = Boolean(stackItem?.insideImmutableExcluded);
      if (!node) {
        continue;
      }
      const xpath = memoXPath(node);
      if (!xpath) {
        continue;
      }
      const immutableExcludedRoot = core.isImmutableExcludedElement(node) === true;
      if (insideImmutableExcluded || immutableExcludedRoot) {
        continue;
      }
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children.item(i);
        if (!child) {
          continue;
        }
        stack.push({
          node: child,
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
        visibleToUser = memoVisible(node);
        if (
          !explicitlyIncluded &&
          !insideExcludedAncestorRow
        ) {
          isMarkableTextual = memoMarkable(node);
        }
      }
      const submissionRow = resolveAiSubmissionRowState({
        explicitlyExcluded,
        explicitlyIncluded,
        insideExcludedAncestor: insideExcludedAncestorRow,
        visibleToUser,
        immutableExcludedRoot: false,
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
        hasVisibleMarkableTextualSubmissionDescendant(node, memoVisible, memoMarkable)
      ) {
        continue;
      }
      pushRow(xpath, submissionRow.excluded);
    }
    return rows;
  });
}

function hasVisibleMarkableTextualSubmissionDescendant(
  root: Element | null | undefined,
  memoVisible: (element: Element) => boolean,
  memoMarkable: (element: Element) => boolean
): boolean {
  if (!root) {
    return false;
  }
  const children = root.children;
  if (!children || children.length === 0) {
    return false;
  }
  const stack: Element[] = [];
  pushChildElementsForward(stack, root);
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (core.isImmutableExcludedElement(node)) {
      continue;
    }
    if (memoVisible(node) && memoMarkable(node)) {
      return true;
    }
    const childList = node.children;
    if (!childList || childList.length === 0) {
      continue;
    }
    pushChildElementsForward(stack, node);
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
  core.scheduleRender(undefined);
}

function deactivateSilentHighlightings(): void {
  setSilentHighlightingPageMotionPaused(false);
  stopSilentHighlightingObserver();
  clearSilentHighlightingMarks();
  setSilentHighlightingsActive(false);
}

function publishSilentHighlightSessionFacts(facts: ContentSessionFactsPatch): void {
  const factsKey = JSON.stringify(
    Object.keys(facts)
      .sort()
      .map((key) => [key, facts[key as keyof ContentSessionFactsPatch]])
  );
  if (factsKey === lastSilentHighlightSessionFactsKey) {
    return;
  }
  lastSilentHighlightSessionFactsKey = factsKey;
  void publishContentSessionFacts(facts);
}

async function loadAndNormalizeConfigs(pageUrl: string): Promise<SilentHighlightConfigLoadResult> {
  const configs = await config.getConfigs();
  const baseUrl = utils.findMatchingBaseUrl(pageUrl, configs);
  if (!baseUrl) {
    return {
      snapshot: null,
      facts: {
        baseUrlReady: false,
        siteIdReady: false,
        renderModeReady: false,
        isEnabled: state.enabled,
        silentModeActive: false,
        hasStoredSelectors: false
      }
    };
  }
  const normalized = config.normalizeConfig(baseUrl, configs[baseUrl]);
  const baseConfig = (normalized.config || {}) as Config;
  if (normalized.changed) {
    configs[baseUrl] = baseConfig;
    await config.saveConfigs(configs);
  }
  const currentSilentRevealKey = getSilentHighlightEditorRevealKey(baseUrl, pageUrl);
  const previewPreservesMotionPause = Boolean(
    contentMarkingMachine.state === "preview" &&
      core.hasPageMotionPauseReason(SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON)
  );
  const holdSilentMotionPause = Boolean(
    previewPreservesMotionPause ||
      (
        shouldRunSilentHighlightEditorActivation() &&
        !silentHighlightEditorRevealInFlight &&
        currentSilentRevealKey &&
        currentSilentRevealKey === silentHighlightEditorRevealKey
      )
  );
  const storedSelectors = getStoredAiSelectorSet(baseConfig);
  const hasSelectorHighlights = combineAiSelectorSet(storedSelectors).length > 0;
  return {
    snapshot: {
      effectiveSelectorSet: getEffectiveAiSelectorSet(baseConfig),
      hasSelectorHighlights,
      holdSilentMotionPause
    },
    facts: {
      baseUrlReady: true,
      siteIdReady: Boolean(normalizeSiteIdValue(baseConfig.siteId)),
      renderModeReady: config.isRenderModeConfirmed(baseConfig),
      isEnabled: state.enabled,
      silentModeActive: !state.enabled,
      hasStoredSelectors: hasSelectorHighlights
    }
  };
}

async function collectSilentHighlightSources(
  snapshot: SilentHighlightConfigSnapshot,
  refreshGeneration: number
): Promise<SilentHighlightSourceState | null> {
  const newlyHiddenConsentCount = core.hideConsentElements();
  const hasHiddenConsent =
    newlyHiddenConsentCount > 0 ||
    Boolean(document.querySelector(`[${core.CONSENT_HIDDEN_ATTR}]`));
  const shouldObserve = snapshot.hasSelectorHighlights || hasHiddenConsent;
  let renderCollections = buildSilentHighlightRenderableCollections(null);
  let contentNodes: Element[] = [];
  let excludedNodes: Element[] = [];
  let immutableNodes: Element[] = [];
  if (!shouldObserve) {
    return {
      shouldObserve,
      renderCollections,
      immutableNodes,
      contentNodes,
      excludedNodes
    };
  }
  if (snapshot.hasSelectorHighlights) {
    try {
      // Run the synchronous source-set collection inside the shared cache so the
      // deep helper graph memoizes visibility / text / immutable lookups per pass.
      const contentMarking = core.withElementComputationCache(() =>
        collectIncludedNodesFromSelectorSet(snapshot.effectiveSelectorSet)
      );
      // Yield before renderable expansion so long pages can break up work; the
      // generation token prevents stale async passes from mutating the page.
      await new Promise<void>((resolve) => {
        if (typeof window.setTimeout !== "function") {
          resolve();
          return;
        }
        window.setTimeout(resolve, 0);
      });
      if (refreshGeneration !== silentHighlightingRefreshGeneration) {
        return null;
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
      // Keep consent hiding and observer mechanics active if selector processing fails.
      renderCollections = buildSilentHighlightRenderableCollections(null);
      immutableNodes = [];
      contentNodes = [];
      excludedNodes = [];
    }
  }
  return {
    shouldObserve,
    renderCollections,
    immutableNodes,
    contentNodes,
    excludedNodes
  };
}

function buildOverlayUpdate(
  renderCollections: SilentHighlightCollections,
  immutableNodes: Element[],
  contentNodes: Element[],
  excludedNodes: Element[]
): SilentHighlightOverlayUpdate {
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
  return {
    renderCollections,
    shouldBeActive,
    renderKey,
    renderChanged,
    shouldRenderOverlay
  };
}

function applySilentHighlightOverlayUpdate(
  refreshGeneration: number,
  update: SilentHighlightOverlayUpdate
): void {
  if (refreshGeneration !== silentHighlightingRefreshGeneration) {
    return;
  }
  if (update.shouldRenderOverlay) {
    // Updating an already-live overlay keeps it visible and repaints rects in
    // place; only the initial paint needs the hide->reveal transition.
    const overlayAlreadyLive =
      lastSilentHighlightingsActive && update.shouldBeActive && Boolean(silentHighlightOverlay);
    renderSilentHighlightOverlay(update.renderCollections, { keepVisible: overlayAlreadyLive });
  } else if (update.renderChanged) {
    clearSilentHighlightOverlay();
  }
  if (update.renderChanged) {
    lastSilentHighlightingRenderKey = update.renderKey;
    lastSilentHighlightingsActive = update.shouldBeActive;
  }
  silentHighlightingPositionRefreshPending = false;
  setSilentHighlightingsActive(update.shouldBeActive);
  startSilentHighlightingObserver();
}

async function scheduleOverlayApply(
  refreshGeneration: number,
  update: SilentHighlightOverlayUpdate
): Promise<void> {
  if (!update.shouldRenderOverlay && !update.renderChanged) {
    applySilentHighlightOverlayUpdate(refreshGeneration, update);
    return;
  }
  // Yield to the browser before the overlay DOM write so paint/layout work that
  // queued up during source collection can flush.
  await new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame !== "function") {
      applySilentHighlightOverlayUpdate(refreshGeneration, update);
      resolve();
      return;
    }
    window.requestAnimationFrame(() => {
      applySilentHighlightOverlayUpdate(refreshGeneration, update);
      resolve();
    });
  });
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
  // Content reflects the brain silent-highlight directive rather than re-deriving
  // the block from local marking state. In practice a displaying preview already
  // sets content state.enabled=false (beginAiPreviewMode calls core.disable()), so
  // this path is reached with marking off during a preview; gating the enabled
  // early-bail on !isSilentHighlightActiveByDirective() is a defensive
  // brain-authority alignment (#8) so silent overlays are never torn down while the
  // directive is active, independent of the disable/broadcast ordering. It does not
  // change normal marking-mode rendering (there the directive is false).
  if (state.enabled && !isSilentHighlightActiveByDirective()) {
    publishSilentHighlightSessionFacts({
      isEnabled: true,
      silentModeActive: false,
      hasStoredSelectors: hasStoredAiSelectorHighlights(state.config)
    });
    deactivateSilentHighlightings();
    refreshEnabledAiHighlights();
    return;
  }
  const pageUrl = location.href;
  const loadResult = await loadAndNormalizeConfigs(pageUrl);
  if (refreshGeneration !== silentHighlightingRefreshGeneration || location.href !== pageUrl) {
    return;
  }
  publishSilentHighlightSessionFacts(loadResult.facts);
  const snapshot = loadResult.snapshot;
  if (!snapshot) {
    resetPageVisitRevealFreezeKeys();
    deactivateSilentHighlightings();
    return;
  }
  // No stored-selector overlays for this page. If the page-prep reveal/freeze was
  // prepared for a render-mode-confirmed candidate (holdSilentMotionPause), keep
  // going so the motion pause is HELD (the !shouldObserve branch below renders no
  // overlays but holds the freeze); otherwise deactivate and resume page motion.
  if (!isSilentHighlightActiveByDirective() && !snapshot.holdSilentMotionPause) {
    deactivateSilentHighlightings();
    return;
  }
  setSilentHighlightingPageMotionPaused(snapshot.holdSilentMotionPause);
  ensureSilentHighlightingStyles();
  clearLegacySilentHighlightingAttributes();
  const sources = await collectSilentHighlightSources(snapshot, refreshGeneration);
  if (!sources || refreshGeneration !== silentHighlightingRefreshGeneration) {
    return;
  }
  if (!sources.shouldObserve) {
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(snapshot.holdSilentMotionPause);
    return;
  }
  await scheduleOverlayApply(
    refreshGeneration,
    buildOverlayUpdate(
      sources.renderCollections,
      sources.immutableNodes,
      sources.contentNodes,
      sources.excludedNodes
    )
  );
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
  } catch (_error) {
    // sessionStorage can be unavailable on some pages; fall back to memory.
  }
  return setPropertyLockClientId(createPropertyLockClientId());
}

function setPropertyLockClientId(nextClientId: string | null | undefined): string {
  const normalizedClientId = normalizePropertyLockClientId(nextClientId);
  if (!normalizedClientId) {
    return propertyLockClientId || "";
  }
  propertyLockClientId = normalizedClientId;
  try {
    window.sessionStorage.setItem(PROPERTY_LOCK_CLIENT_SESSION_KEY, normalizedClientId);
  } catch (_error) {
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

function handleBlockedPropertyLockInteraction(event: Event | null | undefined): void {
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

  const target = isElementNode(event.target) ? event.target : null;
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

function normalizePropertyLockRecoveryTabState(tabState: PropertyLockRecoveryTabStateInput) {
  return getPropertyLockStateMachine().normalizeRecoveryTabState(
    (tabState ?? {}) as Parameters<PropertyLockStateMachine["normalizeRecoveryTabState"]>[0]
  );
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

void persistPropertyLockRecoveryState;

function persistPropertyLockOffCandidateDeadline(deadlineAt: number) {
  return getPropertyLockStateMachine().persistOffCandidateDeadline(deadlineAt);
}

void persistPropertyLockOffCandidateDeadline;

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

function startPropertyLockCrossPropertyWarning(recoveryState: PropertyLockRecoveryStateInput) {
  if (!recoveryState) {
    return getPropertyLockStateMachine().startCrossPropertyWarning(recoveryState);
  }
  return getPropertyLockStateMachine().startCrossPropertyWarning({
    ...recoveryState,
    baseUrl: recoveryState.baseUrl || undefined
  });
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

function disconnectPropertyLockPort(options: { notifyBackground?: boolean } = {}) {
  const { notifyBackground = true } = options || {};
  getPropertyLockPortClient().disconnect({ notifyBackground });
  resetPropertyLockUiState();
}

function markExtensionContextInvalidated(error: unknown): boolean {
  if (!utils.isExtensionContextInvalidatedError(error)) {
    return false;
  }
  extensionContextInvalidated = true;
  propertyLockSyncToken += 1;
  disconnectPropertyLockPort({ notifyBackground: false });
  return true;
}

function handlePropertyLockSyncError(error: unknown, options: PropertyLockSyncOptions = {}): void {
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

function mergePropertyLockSyncOptions(
  currentOptions: PropertyLockSyncOptions = {},
  incomingOptions: PropertyLockSyncOptions = {}
) {
  const mergedOptions: PropertyLockSyncOptions = {};
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

function runPropertyLockSync(options: PropertyLockSyncOptions = {}) {
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

async function syncPropertyLockConnection(options: PropertyLockSyncOptions = {}) {
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

  let target: Awaited<ReturnType<typeof resolveCurrentPropertyLockConnectionTarget>>;
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
      ? snapshot.state as ContentPropertyLockState
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

function handlePropertyLockPortMessage(
  message: unknown,
  _port?: Browser.runtime.Port
): void {
  if (!ensurePropertyLockCollaborationActive()) {
    return;
  }
  if (!message || typeof message !== "object") {
    return;
  }
  const envelope = message as PropertyLockPortEnvelope;

  if (typeof envelope.clientId === "string" && envelope.clientId) {
    setPropertyLockClientId(envelope.clientId);
  }

  if (
    envelope.type === PROPERTY_LOCK_BACKGROUND_CONNECTION_STATUS &&
    envelope.connectionStatus === PROPERTY_LOCK_CONNECTION_CONNECTED
  ) {
    flushQueuedPropertyLockEditorClaim();
    return;
  }

  const { type, message: serverMessage } = envelope;
  if (type !== PROPERTY_LOCK_BACKGROUND_STATE_UPDATE || !serverMessage || typeof serverMessage !== "object") {
    return;
  }

  const serverStateMessage = serverMessage as PropertyLockServerMessage;
  applyPropertyLockServerMessage(serverStateMessage);
  if (serverStateMessage.type === PROPERTY_LOCK_WS_LOCK_STATE) {
    flushQueuedPropertyLockEditorClaim();
  }
}

function subscribePageActivity(listener: PageActivityListener | null | undefined): void {
  if (typeof listener === "function") {
    pageActivitySubscribers.add(listener);
  }
}

function sendPageActivityObserved() {
  if (extensionContextInvalidated) {
    return;
  }
  try {
    browser.runtime.sendMessage({
      type: "pageActivityObserved",
      pageUrl: location.href,
      observedAt: Date.now()
    }).catch((error) => {
      markExtensionContextInvalidated(error);
    });
  } catch (error) {
    markExtensionContextInvalidated(error);
  }
}

function publishPageActivity() {
  sendPageActivityObserved();
  for (const listener of pageActivitySubscribers) {
    listener();
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

function sendPropertyLockMessage(type: string, payload: Record<string, unknown> = {}): void {
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

async function fetchPropertyLockStateSnapshot(siteId: unknown): Promise<Record<string, unknown> | null> {
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

function applyPropertyLockServerMessage(serverMessage: PropertyLockServerMessage) {
  return getPropertyLockStateMachine().applyServerMessage(serverMessage);
}

function createPropertyLockStateMachineDeps(): PropertyLockStateMachineDeps {
  return {
    armPropertyLockCrossPropertyRelease,
    clearPropertyLockBannerCountdown,
    clearPropertyLockRecoveryReleaseTimer,
    clearSilentHighlightEditorRevealKey: () => {
      resetPageVisitRevealFreezeKeys();
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
    getPropertyLockState: () => propertyLockState || {},
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
    setPropertyLockState: (nextState: Record<string, unknown>) => {
      propertyLockState = nextState as ContentPropertyLockState;
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

function createPropertyLockBannerModeDeps(): PropertyLockBannerModeDeps {
  return {
    isPropertyLockCollaborationEnabled,
    clearPropertyLockBannerCountdown,
    restartPropertyLockBannerCountdown,
    clearPropertyLockCrossPropertyWarning,
    clearPropertyLockOffCandidateWarning,
    getPropertyLockRecoveryDeadlineAt: () => propertyLockRecoveryDeadlineAt,
    getPropertyLockOffCandidateDeadlineAt: () => propertyLockOffCandidateDeadlineAt,
    getPropertyLockState: () => {
      if (!propertyLockState) {
        return null;
      }
      return {
        state: typeof propertyLockState.state === "string" ? propertyLockState.state : "",
        isEditor: Boolean(propertyLockState.isEditor),
        secondsRemaining:
          typeof propertyLockState.secondsRemaining === "number" ||
          propertyLockState.secondsRemaining === null
            ? propertyLockState.secondsRemaining
            : null
      };
    },
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

function createPageToastDeps(): PageToastDeps {
  return {
    EXTENSION_UI_FONT_STACK,
    PAGE_TOAST_ID,
    PAGE_TOAST_STYLE_ID,
    TOAST_VISIBLE_MS: 3000,
    getDocument: () => document,
    getWindow: () => window
  };
}

function createRenderModeInspectionClientDeps(): RenderModeInspectionClientDeps {
  return {
    RENDER_MODE_INSPECTION_SESSION_KEY,
    getWindow: () => window
  };
}

function createInspectionStatusDeps(): InspectionStatusDeps {
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
    isAiPreviewActive: () => machineOwnsPreviewRoutine(),
    requestAiPopoverClose: (options = {}) => core.requestAiPopoverClose(options)
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
    isComputeLockPreviewActive: () => contentMarkingMachine.state === "compute_lock",
    refreshSilentHighlightings,
    scheduleAiComputeLockRelease,
    setAiPreviewItems
  };
}

function createAiPreviewExpandedModeHandlerDeps() {
  return {
    buildExpandedModeDisabledResponse: () =>
      getAiPreviewStateResponseBuilder().buildExpandedModeDisabledResponse(),
    buildExpandedModeResponse: (ok: unknown) =>
      getAiPreviewStateResponseBuilder().buildExpandedModeResponse(Boolean(ok)),
    isPreviewExpandedStatesEnabled: () => isFeatureEnabled("previewExpandedStates"),
    setAiPreviewExpandedMode
  };
}

function createAiPreviewGetStateHandlerDeps() {
  return {
    buildGetStateResponse: () => getAiPreviewStateResponseBuilder().buildGetStateResponse()
  };
}

function createAiPreviewShowHandlerDeps(): AiPreviewShowHandlerDeps {
  return {
    beginAiPreviewMode,
    buildAiPreviewItemsWithCategories: (selectorSet: unknown, defaultItems: unknown[]) =>
      buildAiPreviewItemsWithCategories(
        selectorSet as Parameters<typeof buildAiPreviewItemsWithCategories>[0],
        defaultItems as Parameters<typeof buildAiPreviewItemsWithCategories>[1]
      ),
    collectPreviewItems: (selectorSet: unknown) => core.collectPreviewItems(selectorSet),
    exitAiPreviewMode,
    isAiPreviewActive: () => machineOwnsPreviewRoutine(),
    buildPreviewState: () => buildAiPreviewStateSnapshot(),
    normalizeAiSelectorSet: (value: unknown) =>
      normalizeAiSelectorSet(value as Parameters<typeof normalizeAiSelectorSet>[0]),
    notifyPreviewStateChanged: notifyAiPreviewStateChanged,
    refreshSilentHighlightings,
    schedulePreviewItemsHydration: (callback: () => void) => {
      window.setTimeout(callback, 0);
    },
    setAiPreviewItemSets,
    setPreviewItemsPending: setAiPreviewItemsPending,
    showAiPopover: (items: unknown[], options: { onClose: () => Promise<unknown> | void }) =>
      core.showAiPopover(items, options)
  };
}

function createAiSubmissionXpathsHandlerDeps() {
  return {
    collectAiSubmissionXpathsForCurrentPage
  };
}

function createCapturePageSnapshotHandlerDeps(): CapturePageSnapshotDeps {
  return {
    collectAiSubmissionXpathsForCurrentPage: (configValue: Parameters<CapturePageSnapshotDeps["collectAiSubmissionXpathsForCurrentPage"]>[0]) =>
      collectAiSubmissionXpathsForCurrentPage(configValue as Config),
    collectImmutableElements: () => core.collectImmutableElements(),
    createCurrentPageSnapshot,
    fetchCurrentPageRawHtml,
    getActiveConfig: () => state.config,
    getCurrentPageType: () => state.currentPageType,
    getDocumentTitle: () => document.title,
    getPageMarkingEntry: (
      configValue: Parameters<CapturePageSnapshotDeps["getPageMarkingEntry"]>[0],
      pageUrl: string
    ) => core.getPageMarkingEntry(configValue as Config, pageUrl, undefined),
    getPageUrl: () => location.href,
    hasPageMarkingEntry: (
      configValue: Parameters<CapturePageSnapshotDeps["hasPageMarkingEntry"]>[0],
      pageUrl: string
    ) => core.hasPageMarkingEntry(configValue as Config, pageUrl),
    loadConfig: (baseUrl: unknown) => core.loadConfig(baseUrl as string | undefined),
    matchesActiveBaseUrl,
    refreshSavedPageEntryFromBackendCache: async (baseUrl: unknown, pageUrl: string) => {
      await core.refreshSavedPageEntryFromBackendCache(baseUrl as string | undefined, pageUrl);
    },
    clearUserMarkingEdit: (pageUrl: string) => core.clearUserMarkingEdit(pageUrl),
    saveConfig: (
      baseUrl: unknown,
      configValue: Parameters<CapturePageSnapshotDeps["saveConfig"]>[1]
    ) => core.saveConfig(baseUrl as string, configValue as Config),
    sendPropertyLockActivity,
    setConfig: (configValue: Parameters<CapturePageSnapshotDeps["setConfig"]>[0]) => {
      state.config = configValue as Config;
    },
    syncPageMarkings: (
      configValue: Parameters<CapturePageSnapshotDeps["syncPageMarkings"]>[0],
      pageUrl: string,
      immutableExcluded: unknown,
      options: { allowCreate: boolean; persist: boolean }
    ) =>
      core.syncPageMarkings(configValue as Config, pageUrl, immutableExcluded as Set<Element>, options),
    touchPageEntryTimestamp: (entry: Parameters<CapturePageSnapshotDeps["touchPageEntryTimestamp"]>[0]) =>
      core.touchPageEntryTimestamp(entry as ContentPageEntry)
  };
}

function createConfigUpdatedHandlerDeps(): ConfigUpdatedHandlerDeps {
  return {
    clearAiPreviewState,
    disable: () => core.disable(),
    reportMarkingDisabled: (cause: string) => {
      void emitContentSignal({
        name: SIGNAL_NAMES.MARKING_DISABLED,
        source: "content",
        cause,
        payload: { pageUrl: location.href }
      });
    },
    findPageMarkingEntry: (
      configValue: Parameters<ConfigUpdatedHandlerDeps["findPageMarkingEntry"]>[0],
      pageUrl: string,
      baseUrl: string
    ) => core.findPageMarkingEntry(configValue as Config, pageUrl, baseUrl),
    getBackendSavedPageMarkings: (baseUrl: string) => config.getBackendSavedPageMarkings(baseUrl),
    getBaseUrl: () => state.baseUrl,
    clearPageSaveReconciliation: (baseUrl: string, pageUrl: string) =>
      core.clearPageSaveReconciliation(baseUrl, pageUrl),
    clearPageDraftBaseline: (pageUrl: string) => core.clearPageDraftBaseline(pageUrl),
    getCurrentPageType: () => state.currentPageType,
    getDraftPageEntry: (pageUrl: string) => core.getDraftPageEntry(pageUrl),
    getPageUrl: () => location.href,
    getSavedPageEntry: (pageUrl: string) => core.getSavedPageEntry(pageUrl),
    isAiPreviewActive: () => machineOwnsPreviewRoutine(),
    isEnabled: () => state.enabled,
    loadConfig: (baseUrl: string) => core.loadConfig(baseUrl),
    mergeDraftEntry: (
      configValue: Parameters<ConfigUpdatedHandlerDeps["mergeDraftEntry"]>[0],
      pageUrl: string,
      draftEntry: unknown,
      savedEntry: unknown
    ) => core.mergeDraftEntry(configValue as Config, pageUrl, draftEntry, savedEntry),
    notifyDraftStatus: (pageUrl: string) => core.notifyDraftStatus(pageUrl),
    refreshPageSaveReconciliation: (baseUrl: string, pageUrl: string) =>
      core.refreshPageSaveReconciliation(baseUrl, pageUrl),
    refreshEnabledAiHighlights,
    refreshSilentHighlightings,
    runPropertyLockSync,
    sameBaseUrl: (left: unknown, right: unknown) => utils.sameBaseUrl(left, right),
    scheduleRender: () => core.scheduleRender(undefined),
    setConfig: (configValue: Parameters<ConfigUpdatedHandlerDeps["setConfig"]>[0]) => {
      state.config = configValue as Config;
    },
    setCurrentPageType: (pageType: string) => {
      state.currentPageType = pageType;
    },
    setSavedPageEntry: (
      pageUrl: string,
      entry: Parameters<ConfigUpdatedHandlerDeps["setSavedPageEntry"]>[1]
    ) => core.setSavedPageEntry(pageUrl, entry as ContentPageEntry | null)
  };
}

function createCollectPageDataHandlerDeps(): CollectPageDataHandlerDeps {
  return {
    createCurrentPageSnapshot,
    getBaseUrl: () => state.baseUrl,
    getImmutableSelectors: () => DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.slice(),
    getPageMarkingEntry: (
      configValue: Parameters<CollectPageDataHandlerDeps["getPageMarkingEntry"]>[0],
      pageUrl: string,
      options: { create: boolean; persist: boolean }
    ) =>
      core.getPageMarkingEntry(configValue as Config, pageUrl, options),
    getPageUrl: () => location.href,
    loadConfig: (baseUrl: string) => core.loadConfig(baseUrl)
  };
}

function createDefaultExclusionsHandlerDeps() {
  return {
    getImmutableSelectors: () => DEFAULT_EXCLUDED_IMMUTABLE_SELECTORS.slice()
  };
}

function getXPathElement(xpath: string): Element | null {
  const element = core.getElementFromXPath(xpath);
  return element instanceof Element ? element : null;
}

function createVisibleXpathsHandlerDeps(): VisibleXpathsDeps {
  return {
    getElementFromXPath: getXPathElement,
    isVisible: (element: Element) => core.isVisible(element)
  };
}

function createInvisibleXpathsHandlerDeps(): InvisibleXpathsDeps {
  return {
    getElementFromXPath: getXPathElement,
    isVisible: (element: Element) => core.isVisible(element)
  };
}

function createDescribeXpathsHandlerDeps(): DescribeXpathsDeps {
  return {
    getElementFromXPath: getXPathElement,
    getElementLabel: (element: Element) => core.getElementLabel(element),
    isVisible: (element: Element) => core.isVisible(element)
  };
}

function createFocusHandlerDeps(): FocusHandlerDeps {
  return {
    clearFocusHighlight: () => core.clearFocusHighlight(),
    focusPreviewElement: (element: Element) => {
      core.focusPreviewElement(element);
    },
    getElementFromXPath: getXPathElement,
    isAiPreviewActive: () => machineOwnsPreviewRoutine(),
    setAiPreviewFocusedXpath
  };
}

function createForceRefreshHandlerDeps() {
  return {
    refreshFromTabState: () => core.refreshFromTabState(),
    refreshEnabledAiHighlights,
    refreshSilentHighlightings,
    runPropertyLockSync
  };
}

function createExplicitMarkingHandlerDeps(): ExplicitMarkingDeps {
  return {
    canApplyExplicitInclude: (
      target: Element,
      configValue: Parameters<ExplicitMarkingDeps["canApplyExplicitInclude"]>[1],
      pageUrl: string,
      entry: Parameters<ExplicitMarkingDeps["canApplyExplicitInclude"]>[3]
    ) =>
      (core.canApplyExplicitInclude as unknown as (
        target: Element,
        configValue: Config,
        pageUrl: string,
        entryOverride: ContentPageEntry
      ) => boolean)(target, configValue as Config, pageUrl, entry as ContentPageEntry),
    getConfig: () => state.config as Config,
    getElementFromXPath: getXPathElement,
    getPageMarkingEntry: (
      configValue: Parameters<ExplicitMarkingDeps["getPageMarkingEntry"]>[0],
      pageUrl: string
    ) => core.getPageMarkingEntry(configValue as Config, pageUrl, undefined),
    getPageUrl: () => location.href,
    isDefaultToggleableExcludedElement: (element: Element | null) => core.isDefaultToggleableExcludedElement(element),
    isPageDraftDirty: (pageUrl: string) => core.isPageDraftDirty(pageUrl),
    isXPathDescendant: (parentXpath: string, childXpath: string) => core.isXPathDescendant(parentXpath, childXpath),
    normalizePageEntryXpaths: (entry: Parameters<ExplicitMarkingDeps["normalizePageEntryXpaths"]>[0]) =>
      core.normalizePageEntryXpaths(entry as ContentPageEntry),
    notifyDraftStatus: (pageUrl: string) => core.notifyDraftStatus(pageUrl),
    scheduleDraftPersist: (baseUrl: string) => core.scheduleDraftPersist(baseUrl),
    scheduleRender: () => core.scheduleRender(undefined),
    scheduleSnapshotSave: () => core.scheduleSnapshotSave(),
    touchPageEntryTimestamp: (entry: Parameters<ExplicitMarkingDeps["touchPageEntryTimestamp"]>[0]) =>
      core.touchPageEntryTimestamp(entry as ContentPageEntry),
    recordScopedRebuildCandidate: (target: Element | null) =>
      core.recordScopedRebuildCandidate(target)
  };
}

function createPageSaveReconciliationPendingHandlerDeps(): PageSaveReconciliationPendingDeps {
  return {
    setPageSaveReconciliationPending: (
      baseUrl: Parameters<PageSaveReconciliationPendingDeps["setPageSaveReconciliationPending"]>[0],
      pageUrl: Parameters<PageSaveReconciliationPendingDeps["setPageSaveReconciliationPending"]>[1],
      options: Parameters<PageSaveReconciliationPendingDeps["setPageSaveReconciliationPending"]>[2]
    ) => core.setPageSaveReconciliationPending(baseUrl as string, pageUrl as string, options)
  };
}

function createPageSaveReconciliationClearHandlerDeps(): PageSaveReconciliationClearDeps {
  return {
    clearPageSaveReconciliation: (baseUrl: unknown, pageUrl: unknown) =>
      core.clearPageSaveReconciliation(baseUrl as string | undefined, pageUrl as string | undefined),
    clonePageEntry: (entry: unknown) => core.clonePageEntry((entry as ContentPageEntry | null | undefined) ?? null),
    findPageMarkingEntry: (configValue: { pageMarkings: unknown }, pageUrl: string, baseUrl: unknown) =>
      core.findPageMarkingEntry(configValue as Config, pageUrl, baseUrl as string | undefined),
    getBackendSavedPageMarkings: (baseUrl: unknown) => config.getBackendSavedPageMarkings(baseUrl as string | undefined),
    getPageUrl: () => location.href,
    loadConfig: (baseUrl: unknown) => core.loadConfig(baseUrl as string | undefined),
    notifyDraftStatus: (pageUrl: string) => core.notifyDraftStatus(pageUrl),
    refreshPageSaveReconciliation: async (baseUrl: unknown, pageUrl: string) => {
      await core.refreshPageSaveReconciliation(baseUrl as string | undefined, pageUrl);
    },
    scheduleRender: () => core.scheduleRender(undefined),
    setConfig: (nextConfig: Parameters<PageSaveReconciliationClearDeps["setConfig"]>[0]) => {
      state.config = nextConfig as Config;
    },
    setSavedPageEntry: (pageUrl: string, entry: unknown) =>
      core.setSavedPageEntry(pageUrl, (entry as ContentPageEntry | null | undefined) ?? null)
  };
}

function createPageDraftRevertHandlerDeps(): PageDraftRevertDeps {
  return {
    collectImmutableElements: () => core.collectImmutableElements(),
    getPageUrl: () => location.href,
    getSavedPageEntry: (pageUrl: string) => core.getSavedPageEntry(pageUrl),
    isPageDraftDirty: (pageUrl: string) => core.isPageDraftDirty(pageUrl),
    loadConfig: (baseUrl: unknown) => core.loadConfig(baseUrl as string | undefined),
    notifyDraftStatus: (pageUrl: string) => core.notifyDraftStatus(pageUrl),
    scheduleRender: () => core.scheduleRender(undefined),
    setBaseUrl: (baseUrl: unknown) => {
      state.baseUrl = typeof baseUrl === "string" ? baseUrl : "";
    },
    setConfig: (configValue: Parameters<PageDraftRevertDeps["setConfig"]>[0]) => {
      state.config = configValue as Config;
    },
    clearUserMarkingEdit: (pageUrl: string) => core.clearUserMarkingEdit(pageUrl),
    setSavedPageEntry: (pageUrl: string, entry: unknown) =>
      core.setSavedPageEntry(pageUrl, (entry as ContentPageEntry | null | undefined) ?? null),
    syncPageMarkings: (
      configValue: unknown,
      pageUrl: string,
      immutableExcluded: unknown,
      options: { allowCreate: boolean; persist: boolean }
    ) =>
      core.syncPageMarkings(configValue as Config, pageUrl, immutableExcluded as Set<Element>, options)
  };
}

function createPageDraftSaveHandlerDeps(): PageDraftSaveDeps {
  return {
    areEntriesEquivalent: (left: unknown, right: unknown) =>
      core.areEntriesEquivalent(
        (left as ContentPageEntry | null | undefined) ?? null,
        (right as ContentPageEntry | null | undefined) ?? null
      ),
    clearPageSaveReconciliation: (baseUrl: string, pageUrl: string) =>
      core.clearPageSaveReconciliation(baseUrl, pageUrl),
    collectAiSubmissionXpathsForCurrentPage,
    collectImmutableElements: () => core.collectImmutableElements(),
    createCurrentPageSnapshot,
    fetchCurrentPageRawHtml,
    getBaseUrl: () => state.baseUrl,
    getConfig: () => state.config,
    getCurrentPageType: () => state.currentPageType,
    getDocumentTitle: () => document.title,
    getDraftPageEntry: (pageUrl: string) => core.getDraftPageEntry(pageUrl),
    getPageMarkingEntry: (
      configValue: Parameters<PageDraftSaveDeps["getPageMarkingEntry"]>[0],
      pageUrl: string
    ) => core.getPageMarkingEntry(configValue as Config, pageUrl, undefined),
    getPageSaveReconciliationState: (pageUrl: string) => core.getPageSaveReconciliationState(pageUrl),
    getPageUrl: () => location.href,
    getSavedPageEntry: (pageUrl: string) => core.getSavedPageEntry(pageUrl),
    hideConsentElements: () => core.hideConsentElements(),
    logContentDiagnostic: (level: string, message: string, error: unknown) =>
      logContentDiagnostic(level === "error" ? "error" : "warn", message, error),
    matchesActiveBaseUrl,
    notifyDraftStatus: (pageUrl: string) => core.notifyDraftStatus(pageUrl),
    refreshSavedPageEntryFromBackendCache: async (baseUrl: string, pageUrl: string) => {
      await core.refreshSavedPageEntryFromBackendCache(baseUrl, pageUrl);
    },
    saveConfig: (
      baseUrl: string,
      configValue: Parameters<PageDraftSaveDeps["saveConfig"]>[1]
    ) => core.saveConfig(baseUrl, configValue as Config),
    scheduleRender: () => core.scheduleRender(undefined),
    setPageSaveReconciliationPending: (
      baseUrl: string,
      pageUrl: string,
      options: { reason: string }
    ) => core.setPageSaveReconciliationPending(baseUrl, pageUrl, options).then(() => undefined),
    setSavedPageEntry: (
      pageUrl: string,
      entry: Parameters<PageDraftSaveDeps["setSavedPageEntry"]>[1]
    ) => core.setSavedPageEntry(pageUrl, entry as ContentPageEntry),
    showPageToast,
    submissionXpathsEqual,
    syncPageMarkings: (
      configValue: Parameters<PageDraftSaveDeps["syncPageMarkings"]>[0],
      pageUrl: string,
      immutableExcluded: unknown,
      options: { allowCreate: boolean; persist: boolean }
    ) =>
      core.syncPageMarkings(configValue as Config, pageUrl, immutableExcluded as Set<Element>, options),
    touchPageEntryTimestamp: (entry: Parameters<PageDraftSaveDeps["touchPageEntryTimestamp"]>[0]) =>
      core.touchPageEntryTimestamp(entry as ContentPageEntry)
  };
}

function createPageDraftStatusHandlerDeps(): PageDraftStatusDeps {
  return {
    areEntriesEquivalent: (left: unknown, right: unknown) =>
      core.areEntriesEquivalent(
        (left as ContentPageEntry | null | undefined) ?? null,
        (right as ContentPageEntry | null | undefined) ?? null
      ),
    clonePageEntry: (entry: Parameters<PageDraftStatusDeps["clonePageEntry"]>[0]) =>
      core.clonePageEntry(entry as ContentPageEntry),
    collectAiSubmissionXpathsForCurrentPage,
    collectImmutableElements: () => core.collectImmutableElements(),
    getConfig: () => state.config,
    getDraftPageEntry: (pageUrl: string) => core.getDraftPageEntry(pageUrl),
    getPageDraftDirty: (pageUrl: string) => core.isPageDraftDirty(pageUrl),
    getPageSaveReconciliationPending: (pageUrl: string) => core.isPageSaveReconciliationPending(pageUrl),
    getPageSaveReconciliationState: (pageUrl: string) => core.getPageSaveReconciliationState(pageUrl),
    getPageUrl: () => location.href,
    getSavedPageEntry: (pageUrl: string) => core.getSavedPageEntry(pageUrl),
    hasPageMarkingEntry: (configValue: unknown, pageUrl: string) => core.hasPageMarkingEntry(configValue, pageUrl),
    refreshSavedPageEntryFromBackendCache: async (baseUrl: unknown, pageUrl: string) => {
      await core.refreshSavedPageEntryFromBackendCache(baseUrl as string | undefined, pageUrl);
    },
    setSavedPageEntry: (
      pageUrl: string,
      entry: Parameters<PageDraftStatusDeps["setSavedPageEntry"]>[1]
    ) => core.setSavedPageEntry(pageUrl, entry as ContentPageEntry),
    submissionXpathsEqual,
    syncPageMarkings: (
      configValue: unknown,
      pageUrl: string,
      immutableExcluded: unknown,
      options: { allowCreate: boolean; persist: boolean }
    ) =>
      core.syncPageMarkings(configValue as Config, pageUrl, immutableExcluded as Set<Element>, options)
  };
}

function createRenderModeInspectionHandlersDeps(): RenderModeInspectionDeps {
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
    isPageWithinBaseUrl: (pageUrl: string, baseUrl: string) => utils.isPageWithinBaseUrl(pageUrl, baseUrl),
    isRenderModeInspectionActive,
    isRenderModeInspectionFlagSet: () => renderModeInspectionActive,
    consumePageVisitRevealFreezeAttempt,
    markSilentHighlightEditorRevealPrepared,
    nextRevealId: () => ++silentHighlightEditorActivationIdCounter,
    renderPropertyLockBanner,
    resolveBaseUrlForCurrentPage,
    setRenderModeInspectionActive,
    setSilentHighlightEditorRevealInFlight: (value: number) => {
      silentHighlightEditorRevealInFlight = value;
    },
    updatePropertyLockBannerMode,
    warmupSilentHighlightingBeforeMotionPause: (
      baseUrl: string,
      pageUrl: string,
      reason: string,
      options: { keepUiActive: boolean; onRevealProgress: () => void }
    ) =>
      core.warmupSilentHighlightingBeforeMotionPause(baseUrl, pageUrl, reason, options),
    LIFECYCLE_KINDS,
    LIFECYCLE_PHASES,
    SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON
  };
}

function createPropertyLockPortClientDeps(): PropertyLockPortClientDeps {
  return {
    connectRuntimePort: (options: Parameters<PropertyLockPortClientDeps["connectRuntimePort"]>[0]) =>
      browser.runtime.connect(options),
    consumeRuntimeLastErrorMessage: () => {
      try {
        if (!browser.runtime) {
          return "";
        }
        const lastError = browser.runtime.lastError;
        return lastError && typeof lastError.message === "string" ? lastError.message : "";
      } catch (error) {
        if (utils.isExtensionContextInvalidatedError(error)) {
          return error instanceof Error && error.message ? error.message : "Extension context invalidated.";
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
    runSync: ({ forceSiteIdRefresh }: Parameters<PropertyLockPortClientDeps["runSync"]>[0]) => {
      runPropertyLockSync({ forceSiteIdRefresh });
    },
    PROPERTY_LOCK_CONTENT_DISCONNECT,
    PROPERTY_LOCK_PORT_NAME,
    PROPERTY_LOCK_RECONNECT_DELAY_MS
  };
}

function createPropertyLockBannerDeps(): PropertyLockBannerDeps {
  return {
    isPropertyLockCollaborationEnabled,
    clearPropertyLockBannerCountdown,
    renderPropertyLockBanner,
    updatePropertyLockBannerMode,
    sendPropertyLockMessage,
    respondToPropertyLockTakeoverSuggestion,
    getPropertyLockBannerElement: () => propertyLockBannerElement,
    setPropertyLockBannerElement: (element: HTMLElement) => {
      propertyLockBannerElement = element;
    },
    getPropertyLockBannerMode: () => propertyLockBannerMode,
    getPropertyLockBannerCountdownTimer: () => propertyLockBannerCountdownTimer,
    setPropertyLockBannerCountdownTimer: (timer: Parameters<PropertyLockBannerDeps["setPropertyLockBannerCountdownTimer"]>[0]) => {
      propertyLockBannerCountdownTimer = timer;
    },
    getPropertyLockBannerCountdownValue: () => propertyLockBannerCountdownValue,
    setPropertyLockBannerCountdownValue: (value: Parameters<PropertyLockBannerDeps["setPropertyLockBannerCountdownValue"]>[0]) => {
      propertyLockBannerCountdownValue = value;
    },
    setPropertyLockBannerVisible: (visible: boolean) => {
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

async function respondToPropertyLockTakeoverSuggestion(accept: boolean) {
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

async function handleSetEnabledCommand(message: LooseRuntimeMessage = {}) {
  const enabled = Boolean(message.enabled);
  const baseUrl = typeof message.baseUrl === "string" ? message.baseUrl : "";
  const operationId = typeof message.operationId === "string" && message.operationId
    ? message.operationId
    : createLifecycleOperationId(LIFECYCLE_KINDS.ACTIVATION);
  const pageType = typeof message.pageType === "string" ? message.pageType : state.currentPageType || "";
  if (enabled) {
    if (isPropertyLockInteractionBlocked()) {
      return { ok: false, locked: true };
    }
    emitLifecycleEvent({
      operationId,
      kind: LIFECYCLE_KINDS.ACTIVATION,
      phase: LIFECYCLE_PHASES.STARTED,
      busy: true,
      message: "Inspecting page..."
    });
    sendPropertyLockMessage(PROPERTY_LOCK_CONTENT_TAKE_LOCK);
    state.currentPageType = pageType;
    stopSilentHighlightingObserver();
    clearSilentHighlightingMarks();
    setSilentHighlightingsActive(false);

    try {
      const shouldPerformInitialReveal = Boolean(
        message.performInitialReveal &&
          consumePageVisitRevealFreezeAttempt(baseUrl, location.href)
      );
      const skipInitialReveal = !shouldPerformInitialReveal;
      const reconciliation = core.getPageSaveReconciliationState(location.href);
      if (reconciliation && reconciliation.reason === SILENT_HIGHLIGHTING_PREPARATION_REASON) {
        await core.clearPageSaveReconciliation(baseUrl || state.baseUrl || "", location.href);
      }
      await core.enableForBaseUrl(baseUrl, { skipInitialReveal });
      if (shouldPerformInitialReveal) {
        markSilentHighlightEditorRevealPrepared(baseUrl, location.href);
      }
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

function handleSetPopupBusyOnPageCommand(message: LooseRuntimeMessage = {}) {
  return core.setPopupBusyOnPage(
    Boolean(message.active),
    typeof message.message === "string" ? message.message : "",
    {
      operationId: typeof message.operationId === "string" ? message.operationId : "",
      operationKind: typeof message.operationKind === "string" ? message.operationKind : "",
      operationPhase: typeof message.operationPhase === "string" ? message.operationPhase : "",
      releaseBy: Number.isFinite(message.releaseBy) ? Number(message.releaseBy) : 0
    }
  );
}

function handleRenderModeInspectionBeginCommand(message: LooseRuntimeMessage = {}) {
  return getRenderModeInspectionHandlers().begin(message);
}

async function handleRunRenderModeRevealOnceCommand(message: LooseRuntimeMessage = {}) {
  return getRenderModeInspectionHandlers().revealOnce(message);
}

async function handleCaptureRenderModeInspectionHtmlCommand(message: LooseRuntimeMessage = {}) {
  return getRenderModeInspectionHandlers().captureHtml(message);
}

function handleRenderModeInspectionEndCommand(message: LooseRuntimeMessage = {}) {
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
  registerContentCommand("setEnabled", async (_context, payload) =>
    handleSetEnabledCommand(payload as LooseRuntimeMessage | undefined)
  );
  registerContentCommand("getInspectionStatus", async () => handleGetInspectionStatusCommand());
  registerContentCommand("setPopupBusyOnPage", async (_context, payload) =>
    handleSetPopupBusyOnPageCommand(payload as LooseRuntimeMessage | undefined)
  );
  registerContentCommand("runRenderModeRevealOnce", async (_context, payload) =>
    handleRunRenderModeRevealOnceCommand(payload as LooseRuntimeMessage | undefined)
  );
}

function createRuntimeMessageHandlerDeps() {
  return {
    handleSetEnabledCommand,
    handleGetInspectionStatusCommand,
    handleSetPopupBusyOnPageCommand,
    handleRunRenderModeRevealOnceCommand,
    getAiPreviewGetStateHandler,
    getAiPreviewExpandedModeHandler,
    getAiPreviewComputeLockHandler,
    getAiPreviewCloseHandler,
    getConfigUpdatedHandler,
    getForceRefreshHandler,
    getDefaultExclusionsHandler,
    getCollectPageDataHandler,
    getVisibleXpathsHandler,
    getAiSubmissionXpathsHandler,
    getInvisibleXpathsHandler,
    getDescribeXpathsHandler,
    getFocusHandler,
    getCapturePageSnapshotHandler,
    getPageDraftStatusHandler,
    getPageSaveReconciliationPendingHandler,
    getPageSaveReconciliationClearHandler,
    getExplicitMarkingHandler,
    getPageDraftSaveHandler,
    getPageDraftRevertHandler,
    getAiPreviewShowHandler,
    state,
    matchesActiveBaseUrl,
    checkPropertyLockBlocksMarking,
    sendPropertyLockActivity,
    locationHref: () => location.href,
    isPageSaveReconciliationPending: (pageUrl: string) => core.isPageSaveReconciliationPending(pageUrl)
  };
}


export function main() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  void initPageTypeTaxonomy();
  registerContentCommandHandlersOnce();
  subscribePageActivity(sendPropertyLockActivity);
  core.setPageInspectionUiSettledListener(notifyInspectionSettled);
  core.setPageSaveReconciliationFactReporter((pending, reason) => {
    void publishContentSessionFacts({
      pageSaveReconciliationPending: pending,
      pageSaveReconciliationReason: normalizePageSaveReconciliationReason(reason)
    });
  });
  startContentBusClient({
    renderModeHandlers: {
      beginInspection: handleRenderModeInspectionBeginCommand,
      hideConsent: handleHideConsentForInspectionCommand,
      captureHtml: async (payload) => {
        const result = await handleCaptureRenderModeInspectionHtmlCommand(payload as LooseRuntimeMessage | undefined);
        return {
          hiddenCount:
            result && typeof result === "object" && "hiddenCount" in result && typeof result.hiddenCount === "number"
              ? result.hiddenCount
              : 0,
          ...(result as Record<string, unknown>)
        } as import("./common/bus/contracts/render-mode.ts").RenderModeContentCaptureHtmlReply;
      },
      endInspection: handleRenderModeInspectionEndCommand,
    },
  });
  let lastSilentHighlightDirectiveActive = isSilentHighlightActiveByDirective();
  let lastPageRevealFreezeActive = isPageRevealFreezeActiveByDirective();
  addContentDirectiveListener((directive) => {
    const nextSilentHighlightDirectiveActive = Boolean(directive && directive.silentHighlightActive === true);
    const nextPageRevealFreezeActive = Boolean(directive && directive.pageRevealFreezeActive === true);
    if (
      nextSilentHighlightDirectiveActive === lastSilentHighlightDirectiveActive &&
      nextPageRevealFreezeActive === lastPageRevealFreezeActive
    ) {
      return;
    }
    const revealChanged = nextPageRevealFreezeActive !== lastPageRevealFreezeActive;
    lastSilentHighlightDirectiveActive = nextSilentHighlightDirectiveActive;
    lastPageRevealFreezeActive = nextPageRevealFreezeActive;
    // N2 (debug round): while marking is ACTIVELY enabled (state.enabled), silent
    // highlighting is not rendered — marking shows its own overlays — so a
    // silentHighlightActive flap is a no-op for the visible output. A stuck
    // previewActive oscillation (a post-exit preview ghost, #5/#14 interleaving)
    // flapped this directive ~1/sec, and each edge re-ran refreshSilentHighlightings:
    // a full O(document) marking render on the false edge (via refreshEnabledAiHighlights)
    // and a full silent source collection + render on the true edge — pegging the
    // CPU for as long as the oscillation lasted. Skip the refresh when only
    // silentHighlightActive changed and marking is enabled; a reveal/freeze change
    // still runs it (that governs the editor reveal/freeze, which is relevant while
    // marking, and never flaps on the previewActive ghost).
    if (state.enabled && !revealChanged) {
      return;
    }
    refreshSilentHighlightings().then(() => {});
    // Run the editor reveal/freeze when the page-prep directive is active (covers
    // fresh candidates with no stored selectors) or when silent highlighting is
    // active (saved pages). The activation itself dedupes per page visit.
    if (nextPageRevealFreezeActive || nextSilentHighlightDirectiveActive) {
      runEditorSilentHighlightingActivation().catch(() => {
        refreshSilentHighlightings().then(() => {});
      });
    }
  });

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

  if (isPropertyLockCollaborationEnabled()) {
    runPropertyLockSync({ forceSiteIdRefresh: true });
  } else {
    resetDisabledPropertyLockRuntimeState();
  }

  core.refreshFromTabState().then(async () => {
    if (isPropertyLockCollaborationEnabled()) {
      runPropertyLockSync({
        forceSiteIdRefresh: !state.enabled || !state.baseUrl
      });
    } else {
      resetDisabledPropertyLockRuntimeState();
    }
    refreshEnabledAiHighlights();
    runEditorSilentHighlightingActivation().catch(() => {
      refreshSilentHighlightings().then();
    });
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

  addBusEnvelopeListener((message, sender) => handleContentBusMessage(message, sender));
  addRequestEnvelopeListener((message, sender) => {
    const routed = routeInboundContentRequestMessage(message, sender, dispatchContentCommandMessage);
    return routed.handled ? routed.reply : undefined;
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && typeof message === "object" && (message as { p?: unknown }).p === "uf-bus/1") {
      handleContentBusMessage(message, _sender)
        .then((reply) => sendResponse(reply))
        .catch(() => sendResponse(undefined));
      return true;
    }

    const routed = routeInboundContentRequestMessage(message, _sender, dispatchContentCommandMessage);
    if (routed.handled) {
      if (!routed.reply) {
        return;
      }
      routed.reply
        .then((reply) => sendResponse(reply))
        .catch(() => sendResponse(undefined));
      return true;
    }

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

    return handleRuntimeMessage(
      message,
      _sender,
      sendResponse,
      createRuntimeMessageHandlerDeps() as Parameters<typeof handleRuntimeMessage>[3]
    );
  });

  function dispatchContentCommandMessage(message: Parameters<typeof dispatchContentCommand>[0], sender: Browser.runtime.MessageSender | undefined): Promise<unknown> {
    return dispatchContentCommand(message, sender, {
      pageUrl: () => location.href,
      mode: () => getCurrentContentMode()
    });
  }

  window.addEventListener(URL_CHANGED_EVENT, () => {
    resetPageVisitRevealFreezeKeys();
    runPropertyLockSync({ forceSiteIdRefresh: true });
    // A navigation tears every routine down; the machine returns to silent
    // (the activation flow re-enters marking on its own).
    stepContentMachine("navigated");
  });

  // REFLEX-ARC P3 §3.2: the machine steps at core's enable/disable
  // completion points (same injected-reporter pattern as the marking-edit
  // provenance hook).
  core.setMarkingLifecycleReporter((event) => {
    stepContentMachine(event === "enabled" ? "marking-enabled" : "marking-disabled");
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
  const handleSilentOrMarkingScroll = (event: Event) => {
    if (state.enabled) {
      core.handleScroll(event, { hideDuringScroll: true });
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

  // Per-spec: any page input (mouse/keyboard/scroll) is a central activity
  // signal. Debounce to at most once per 10 seconds so busy pages do not flood
  // the background or feature-specific subscribers.
  const handlePageActivity = () => {
    // Only emit the debounced activity signal when a content-side consumer is
    // actually listening (property-lock collaboration has a live port). The
    // background no-JS inactivity watch is driven by tab/window focus events, so
    // pinging from every injected page would wake the service worker for no gain.
    if (pageActivityTimer || !getPropertyLockPortClient().hasPort()) {
      return;
    }
    pageActivityTimer = window.setTimeout(() => {
      pageActivityTimer = 0;
      publishPageActivity();
    }, 10_000);
  };
  window.addEventListener("mousemove", handlePageActivity, { passive: true, capture: false });
  window.addEventListener("keydown", handlePageActivity, { passive: true, capture: false });
  window.addEventListener("pointerdown", handlePageActivity, { passive: true, capture: false });
  window.addEventListener("scroll", handlePageActivity, { passive: true, capture: false });
}
