import { mdiCodeBlockTags, mdiSnowflake } from "@mdi/js";
import { defineContentScript } from "wxt/utils/define-content-script";

import { browser, getInstalledBrowserApi } from "../common/browser";
import { createActivationGate } from "../content/activation";
import {
  authorityFromLockState,
  ContentLockStateSchema,
  createContentCommandRouter,
  createDefaultContentAuthority,
  type ContentAuthorityState,
} from "../content/command-router";
import { createConsentLifecycle } from "../content/consent-lifecycle";
import {
  createContentTransientSurfaces,
  type ContentTransientSurfaces,
} from "../content/transient-surfaces";
import { createContentToastLifecycle } from "../content/toast-lifecycle";
import { shouldBlockPageInput } from "../content/input-firewall";
import {
  createInteractionShield,
  MAXIMUM_DOCUMENT_Z_INDEX,
  OPEN_SHADOW_ATTACHED_EVENT,
  type InteractionShieldController,
} from "../content/interaction-shield";
import { normalizedDocumentPageUrl, sameDocumentPageUrl } from "../content/page-url";
import {
  createRenderInspectionCurtain,
  type AdoptedRenderInspectionSession,
  type RenderInspectionCurtainController,
  type RenderInspectionIdentity,
} from "../content/render-inspection-curtain";
import {
  createMarkingEngine,
} from "../content/marking";
import { markingHoverNeedsLeadingPaint } from "../content/marking/hover-scheduling";
import { retireSupersededMarkingRoots } from "../content/marking/root-authority";
import { createPhysicalActionDeduper, openMarkingContextMenu } from "../content/marking/interaction";
import { presentationClockFor } from "../content/presentation-clock";
import { createPreviewController } from "../content/preview-controller";
import { createSignalScheduler } from "../content/signal-scheduler";
import {
  INITIAL_CONTENT_STATE,
  memoryForContent,
  transitionContentState,
  type ContentPresentation,
  type ContentState,
} from "../content/organ";
import {
  createFreezeController,
  createRevealVisitController,
  createSpaGuard,
  createViewportScrollRestorationLedger,
  isComposedCaptureExcluded,
  resolveViewportScrollOwner,
  runReveal,
  smoothScrollOwnerTo,
  type RevealRunResult,
  waitForRevealQuiet,
} from "../content/stabilization";
import type { BrainSignal } from "../domain/schema/signals";
import type { LockActionKind } from "../domain/schema/facts";
import type { CommandEnvelope } from "../messaging/contracts";
import type {
  ShieldPostureClearReason,
  ShieldPostureProjection,
  ShieldPostureUpdate,
} from "../messaging/shield-posture";
import type { RenderInspectionSession } from "../messaging/render-inspection";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import { pullRewriteSignals, type RewriteSignalBus } from "../messaging/rewrite-signals";
import type { SelectorSet } from "../storage/config";
import type { TransientSurfaceHandle } from "../ui/transient-surface-manager";

const activation = createActivationGate();
const contentPresentationClock = presentationClockFor(
  typeof window === "undefined" ? null : window,
);
const freezeController = createFreezeController();
const revealController = createRevealVisitController({
  isVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  waitUntilVisible: () => new Promise((resolve) => {
    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      resolve();
      return;
    }
    const onVisible = (): void => {
      if (document.visibilityState === "hidden") {
        return;
      }
      document.removeEventListener("visibilitychange", onVisible, true);
      resolve();
    };
    document.addEventListener("visibilitychange", onVisible, true);
  }),
});
const spaGuard = createSpaGuard((url) => {
  if (typeof location !== "undefined" && location.href !== url) {
    location.assign(url);
  }
});
let markingEngine: ReturnType<typeof createMarkingEngine> | null = null;

function createAuthoritativeMarkingEngine(
  ...args: Parameters<typeof createMarkingEngine>
): ReturnType<typeof createMarkingEngine> {
  retireSupersededMarkingRoots(typeof document === "undefined" ? null : document);
  return createMarkingEngine(...args);
}

let markingActive = false;
/** Counts the operator's toggles, and nothing else. The page mutates on its own,
 *  so any measure derived from the live row count would drift: rows the page grows
 *  would read as an edit, and a toggle that removes rows would not. One toggle is
 *  one change, which is the only definition that holds on a dynamic page. */
let userToggleCount = 0;
/** Canonical decision identity acknowledged as clean by activation or the last
 * successful AI result. Unlike a toggle counter, this makes an exact clear of a
 * temporary mark genuinely reversible. */
let cleanMarkingFingerprint: string | null = null;
/** Brain-facing event cursor. AI cleanup resets userToggleCount because the
 * current decisions are no longer dirty, but it must not reset this sequence:
 * the next operator edit still has to advance past the last observed fact. */
let markingToggleSeq = 0;
let markingInteractionsPaused = false;
/** Explicit transport pause (Save/capture) is distinct from a derived lock or
 * organ block. Derived availability must be able to recover even when no prior
 * pause command set the legacy flag. */
let markingInteractionPauseRequested = false;
let spacePassthroughActive = false;
/** Key repeat refreshes this while Space is physically held. If a platform or
 * focus transition drops keyup without delivering blur/visibilitychange, the
 * bounded lease restores marking instead of leaving the page permanently
 * pointer-transparent. */
const SPACE_PASSTHROUGH_WATCHDOG_MS = 1_200;
let spacePassthroughWatchdog: ReturnType<typeof setTimeout> | null = null;
let altIncludeActive = false;
let removeMarkingListeners: (() => void) | null = null;
let removePreviewPageListener: (() => void) | null = null;
let removeSilentDebugCopyListener: (() => void) | null = null;
let navigationWatcherInstalled = false;
let lastKnownPageUrl = typeof location !== "undefined" ? location.href : "";
let contentBus: RewriteSignalBus | null = null;
let pageWorldSessionNonce = "";
let pageWorldLifecycleEpoch = 0;
let pageWorldDestroyInFlight: Readonly<{
  nonce: string;
  epoch: number;
  promise: Promise<void>;
}> | null = null;
let pageWorldCleanupFenceNonce = "";
let pageWorldDestroyRetryNonce = "";
let pageWorldDestroyRetryAttempt = 0;
let pageWorldDestroyRetryHandle: ReturnType<Window["setTimeout"]> | null = null;
let contentState: ContentState = INITIAL_CONTENT_STATE;
let contentPresentation: ContentPresentation = memoryForContent(contentState);
let contentAuthority: ContentAuthorityState = createDefaultContentAuthority(lastKnownPageUrl);
let contentSignalPollHandle: ReturnType<Window["setInterval"]> | null = null;
let signalsAvailableUnsubscribe: (() => void) | null = null;
let pageUrlChangedUnsubscribe: (() => void) | null = null;
const CONTENT_SIGNAL_POLL_MS = 500;
const MARKING_CURSOR_STYLE_ID = "unfluffify-marking-cursor-style";
const MARKING_CURSOR_CLASSES = [
  "uf-cursor-exclude",
  "uf-cursor-include",
  "uf-cursor-passthrough",
  "uf-cursor-disabled",
] as const;
/** Chrome may discard a decoded cursor whose only Image wrapper has already
 * been collected. Retain both preload objects for this content-realm lifetime. */
const markingCursorPreloads: HTMLImageElement[] = [];
type MarkingCursorMode = "exclude" | "include" | "passthrough" | "disabled";
/** Selectors seed a clean session once and then stop mattering; this guards the
 *  "once" across re-activations of the same session. */
let selectorsSeeded = false;
let removeNavigationGate: (() => void) | null = null;
const consentLifecycle = createConsentLifecycle({
  async registerSuppression(tabId) {
    let response;
    try {
      response = await getContentBus().request(
        "consent.suppression.register",
        { tabId },
        { target: "background" },
      );
    } catch {
      return "error";
    }
    return response.ok ? response.data.status : "error";
  },
  onHidden(count) {
    console.debug(`[Unfluffify][rewrite] Hid ${count} consent element(s)`);
  },
});
/** The page URL the background has already been asked about, so one page load costs
 *  one question. Cleared on navigation, and on a failed ask so it can be retried. */
let pageContextProbedUrl = "";
/** Registration and the exact page-context reprobe form one restoration
 * boundary. Serializing the whole bridge prevents a second command from seeing
 * consent resumed before property/shield authority has been re-established. */
let consentResumeQueue: Promise<unknown> = Promise.resolve();
type PageVisitRitualIdentity = Readonly<{
  pageUrl: string;
  documentNonce: string;
  lifecycleGeneration: number;
  routeGeneration: number;
}>;
type PageVisitRitualOutcome = PageVisitRitualIdentity & Readonly<{
  status: "prepared" | "stale" | "failed";
  reason: string;
  lazyExpansions: number;
  frozenAtBottom: boolean;
}>;
type PendingPageVisitRitual = Readonly<{
  identity: PageVisitRitualIdentity;
  promise: Promise<PageVisitRitualOutcome>;
}>;
/** One successful exact-document occurrence and one joinable in-flight
 * occurrence. URL strings alone are insufficient because a reload can replace
 * the document while retaining the same address. */
let completedPageVisitRitual: PageVisitRitualOutcome | null = null;
let pendingPageVisitRitual: PendingPageVisitRitual | null = null;
/** How long to wait for a load event before walking anyway. */
const RITUAL_READY_TIMEOUT_MS = 8000;
let contentSurfaceRoot: HTMLElement | null = null;
let contentSurfaceInputBoundaryActive = false;
const contentSurfacePrivilegedTargets = new Set<HTMLElement>();
let lastContentSurfaceSignature = "";
let contentTransientSurfaces: ContentTransientSurfaces | null = null;
let contentLockConfirmation: TransientSurfaceHandle | null = null;
let pageInspectionActive = false;
let silentInteractionShieldActive = false;
const contentToasts = createContentToastLifecycle();
let interactionShield: InteractionShieldController | null = null;
let renderInspectionCurtain: RenderInspectionCurtainController | null = null;
let renderInspectionAdoptionGeneration = 0;
let pendingRenderInspectionAdoptionGeneration: number | null = null;
let provisionalBfcacheRenderInspectionFence = false;
const RENDER_INSPECTION_DOCUMENT_NONCE = globalThis.crypto?.randomUUID?.()
  ?? `render-inspection-${Date.now()}-${Math.random()}`;
// Fail closed until page.context establishes a managed property or re-adopts a
// validated durable property lease. Popup commands are intent, not authority.
let interactionShieldAuthorityActive = false;
let durablePostureShieldActive = false;
let currentShieldPosture: ShieldPostureProjection = { status: "inactive", revision: 0 };
let durableSilentAdoptionGeneration = 0;
let shieldPostureMutationGeneration = 0;
let contentLifecycleGeneration = 0;
let documentLifecycleGeneration = 0;
let pendingNavigationBoundary: Readonly<{ pageUrl: string; afterSeq: number }> | null = null;
let lastConsumedNavigation: Readonly<{
  fromUrl: string;
  toUrl: string;
  seq: number;
}> | null = null;
let lastHandledNavigationSeq = 0;
let shieldPostureQueue: Promise<unknown> = Promise.resolve();
let pageContextBindQueue: Promise<unknown> = Promise.resolve();
let shieldRootReadyListenerInstalled = false;
const CONTENT_SURFACE_STYLE_ID = "unfluffify-content-surface-style";
const SILENT_SHIELD_REASON = "silent-highlights";
const PREVIEW_SHIELD_REASON = "preview";
const BLOCKED_ORGAN_SHIELD_REASON = "blocked-organ";
const DURABLE_POSTURE_SHIELD_REASON = "durable-posture";
const RENDER_INSPECTION_SHIELD_REASON = "render-inspection";
const BF_CACHE_RENDER_INSPECTION_SHIELD_REASON = "bfcache-render-inspection";
const PAGE_VISIT_INSPECTION_SHIELD_REASON = "page-visit-inspection";

const CONTENT_LOCK_ACTION_LABEL: Readonly<Record<LockActionKind, string>> = {
  "continue-here": "Continue here",
  "suggest-takeover": "Ask to take over",
  "accept-takeover": "Accept takeover",
  "reject-takeover": "Keep editing",
  "take-over": "Take over",
};

function readMarkingDecisionFingerprint(): string | null {
  const readFingerprint = markingEngine?.decisionFingerprint;
  return typeof readFingerprint === "function"
    ? readFingerprint.call(markingEngine)
    : null;
}

function isUserMarkingDirty(): boolean {
  const current = readMarkingDecisionFingerprint();
  return cleanMarkingFingerprint === null || current === null
    ? userToggleCount > 0
    : current !== cleanMarkingFingerprint;
}

function currentMarkingFingerprint(): string {
  return readMarkingDecisionFingerprint() ?? "";
}

function currentPageUrl(): string {
  return typeof location !== "undefined" ? location.href : "";
}

function baseUrlFor(url: string): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function selectorSetFrom(payload: Record<string, unknown>): SelectorSet | null {
  const raw = payload.selectors;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as { inclusionSelectors?: unknown; exclusionSelectors?: unknown };
  const inclusionSelectors = Array.isArray(candidate.inclusionSelectors)
    ? candidate.inclusionSelectors.filter((value): value is string => typeof value === "string")
    : [];
  const exclusionSelectors = Array.isArray(candidate.exclusionSelectors)
    ? candidate.exclusionSelectors.filter((value): value is string => typeof value === "string")
    : [];
  return inclusionSelectors.length === 0 && exclusionSelectors.length === 0
    ? null
    : { inclusionSelectors, exclusionSelectors };
}

/** Markings never outlive the marking session, so leaving the page throws them
 *  away. The native gate is the only thing that can interrupt a navigation the
 *  operator started, so it is armed exactly while there is something to lose. */
function armNavigationGate(): void {
  if (removeNavigationGate || typeof window === "undefined") {
    return;
  }
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!markingActive || !isUserMarkingDirty()) {
      return;
    }
    event.preventDefault();
    // Chrome shows its own wording; a non-empty returnValue is what triggers it.
    event.returnValue = "Leaving this page discards your unsaved markings.";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  removeNavigationGate = () => {
    window.removeEventListener("beforeunload", onBeforeUnload);
    removeNavigationGate = null;
  };
}

function contentRowsFromEngine(): Array<{ xpath: string; classification: "included" | "excluded" }> {
  return (markingEngine?.rows() ?? []).map((row) => ({
    xpath: row.xpath,
    classification: row.excluded ? "excluded" : "included",
  }));
}

const previewController = createPreviewController({
  currentPageUrl,
  currentEngine: () => markingEngine,
  ensureEngine: () => {
    if (markingEngine) {
      return markingEngine;
    }
    if (typeof document === "undefined" || !document.documentElement) {
      return null;
    }
    markingEngine = createAuthoritativeMarkingEngine(document.documentElement);
    return markingEngine;
  },
  interactionActive: previewInteractionActive,
});

function getRuntimeBrowser() {
  return getInstalledBrowserApi() ?? browser;
}

function extensionAssetUrl(path: string): string {
  try {
    const runtime = getRuntimeBrowser().runtime as typeof browser.runtime & {
      getURL?: (relativePath: string) => string;
    };
    return typeof runtime.getURL === "function" ? runtime.getURL(path) : path;
  } catch {
    return path;
  }
}

function ensureMarkingCursorStyles(): void {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  const documentWithOptionalDom = document as Document & {
    createElement?: (tagName: string) => HTMLElement;
    getElementById?: (id: string) => HTMLElement | null;
  };
  if (documentWithOptionalDom.getElementById?.(MARKING_CURSOR_STYLE_ID) || typeof documentWithOptionalDom.createElement !== "function") {
    return;
  }
  const excludeUrl = extensionAssetUrl("cursors/exclude.svg");
  const includeUrl = extensionAssetUrl("cursors/include.svg");
  const style = documentWithOptionalDom.createElement("style");
  style.id = MARKING_CURSOR_STYLE_ID;
  style.setAttribute("data-uf-extension-ui", "true");
  style.textContent = `
html.uf-cursor-exclude,
html.uf-cursor-exclude * { cursor: url(${JSON.stringify(excludeUrl)}) 4 3, crosshair !important; }
html.uf-cursor-include,
html.uf-cursor-include * { cursor: url(${JSON.stringify(includeUrl)}) 4 3, copy !important; }
html.uf-cursor-passthrough { cursor: unset !important; }
html.uf-cursor-disabled,
html.uf-cursor-disabled * { cursor: progress !important; }
`;
  document.documentElement.appendChild(style);

  const ImageConstructor = (globalThis as typeof globalThis & { Image?: typeof Image }).Image;
  if (typeof ImageConstructor === "function") {
    for (const url of [excludeUrl, includeUrl]) {
      const image = new ImageConstructor();
      image.src = url;
      markingCursorPreloads.push(image);
      void image.decode?.().catch(() => undefined);
    }
  }
}

function currentMarkingCursorMode(): MarkingCursorMode | null {
  if (!markingActive) {
    return null;
  }
  if (markingInteractionsPaused || contentAuthority.lockBlocked || contentPresentation.markingEditsBlocked) {
    return "disabled";
  }
  if (spacePassthroughActive) {
    return "passthrough";
  }
  return altIncludeActive ? "include" : "exclude";
}

function syncMarkingCursor(): void {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  const mode = currentMarkingCursorMode();
  if (mode) {
    ensureMarkingCursorStyles();
  }
  const root = document.documentElement as HTMLElement;
  const classes = new Set(String(root.className ?? "").split(/\s+/).filter(Boolean));
  for (const className of MARKING_CURSOR_CLASSES) {
    classes.delete(className);
  }
  if (mode) {
    classes.add(`uf-cursor-${mode}`);
  }
  root.className = [...classes].join(" ");
}

function getContentBus(): RewriteSignalBus {
  if (!contentBus) {
    contentBus = createRealmBus({
      realm: "content",
      transport: createRuntimeTransport(getRuntimeBrowser().runtime),
    });
  }
  return contentBus;
}

function renderInspectionIdentity(
  session: Pick<RenderInspectionSession, "token" | "generation" | "documentNonce">,
): RenderInspectionIdentity | null {
  return session.documentNonce
    ? {
        token: session.token,
        generation: session.generation,
        documentNonce: session.documentNonce,
      }
    : null;
}

function isCurrentRenderInspection(identity: RenderInspectionIdentity): boolean {
  const current = renderInspectionCurtain?.current() ?? null;
  return current !== null &&
    current.token === identity.token &&
    current.generation === identity.generation &&
    current.documentNonce === identity.documentNonce;
}

function ensureRenderInspectionCurtain(): RenderInspectionCurtainController | null {
  if (
    renderInspectionCurtain ||
    typeof document === "undefined" ||
    typeof window === "undefined"
  ) {
    return renderInspectionCurtain;
  }
  renderInspectionCurtain = createRenderInspectionCurtain({
    document,
    window,
    schedulePaintFallback(session, callback) {
      let cancelled = false;
      void getContentBus().request("renderInspection.paintFallbackTick", {
        token: session.token,
        generation: session.generation,
        pageUrl: session.pageUrl,
        documentNonce: session.documentNonce,
      }, { target: "background" }).then((response) => {
        if (!cancelled && response.ok && response.data.status === "ready") {
          callback();
        }
      }).catch(() => undefined);
      return () => {
        cancelled = true;
      };
    },
    onPaintReady(session) {
      void acknowledgeRenderInspectionPaint(session);
    },
    onFailure(session, reason) {
      void reportRenderInspectionFailure(session, reason);
    },
    onLifecycleStage(session, stage) {
      if (__UF_DEBUG_BUILD__) {
        console.debug("[Unfluffify][render-inspection] Curtain lifecycle", {
          stage,
          generation: session.generation,
          documentId: session.documentId,
          javascriptEnabled: session.javascriptEnabled,
        });
      }
    },
    onSurfaceChanged() {
      // The durable inspection is its own background-authorized lease and can
      // arrive before ordinary page.context establishes P15 property authority.
      // Synchronizing here both identity-orders the trusted curtain and mounts
      // the lower shield that neutralizes page-owned HTML top-layer surfaces.
      syncInteractionShield();
    },
  });
  return renderInspectionCurtain;
}

function adoptAuthoritativeRenderInspection(
  session: RenderInspectionSession,
): boolean {
  if (
    session.phase !== "adopted" ||
    !sameDocumentPageUrl(session.pageUrl, currentPageUrl()) ||
    session.documentNonce !== RENDER_INSPECTION_DOCUMENT_NONCE
  ) {
    return false;
  }
  return ensureRenderInspectionCurtain()?.adopt(session) ?? false;
}

function reconcileRenderInspectionMutation(
  identity: RenderInspectionIdentity,
  response: Readonly<{
    status: "inactive" | "ok" | "stale";
    session?: RenderInspectionSession;
  }>,
): void {
  // A reply from an older paint/failure attempt has no authority over a newer
  // local adoption, even when the background helpfully includes its session.
  if (!isCurrentRenderInspection(identity)) {
    return;
  }
  if (
    response.session?.phase === "adopted" &&
    response.session.documentNonce === RENDER_INSPECTION_DOCUMENT_NONCE &&
    sameDocumentPageUrl(response.session.pageUrl, currentPageUrl())
  ) {
    adoptAuthoritativeRenderInspection(response.session);
    return;
  }
  if (response.status === "ok" && response.session) {
    const responseIdentity = renderInspectionIdentity(response.session);
    if (
      responseIdentity &&
      responseIdentity.token === identity.token &&
      responseIdentity.generation === identity.generation &&
      responseIdentity.documentNonce === identity.documentNonce &&
      response.session.phase === "terminal"
    ) {
      renderInspectionCurtain?.clearMatching(identity);
    }
    return;
  }
  // The exact document-fenced request was authoritative, but the session is no
  // longer active. Fail open only for the still-current local identity.
  renderInspectionCurtain?.failOpenMatching(identity);
}

async function acknowledgeRenderInspectionPaint(
  session: AdoptedRenderInspectionSession,
): Promise<void> {
  const identity = renderInspectionIdentity(session);
  if (!identity || !isCurrentRenderInspection(identity)) {
    return;
  }
  const pageUrl = session.pageUrl;
  if (!sameDocumentPageUrl(pageUrl, currentPageUrl())) {
    await reportRenderInspectionFailure(session, "same-document-navigation");
    renderInspectionCurtain?.failOpenMatching(identity);
    return;
  }
  const lifecycleGeneration = contentLifecycleGeneration;
  const routeGeneration = documentLifecycleGeneration;
  try {
    const response = await getContentBus().request("renderInspection.ackPaint", {
      token: identity.token,
      generation: identity.generation,
      pageUrl,
      documentNonce: identity.documentNonce,
    }, { target: "background" });
    if (
      !isCurrentRenderInspection(identity) ||
      lifecycleGeneration !== contentLifecycleGeneration ||
      routeGeneration !== documentLifecycleGeneration ||
      !sameDocumentPageUrl(pageUrl, currentPageUrl())
    ) {
      return;
    }
    if (!response.ok) {
      await reportRenderInspectionFailure(session, "paint-acknowledgement-rejected");
      return;
    }
    reconcileRenderInspectionMutation(identity, response.data);
  } catch {
    await reportRenderInspectionFailure(session, "paint-acknowledgement-unavailable");
  }
}

async function reportRenderInspectionFailure(
  session: AdoptedRenderInspectionSession,
  reason: string,
): Promise<void> {
  const identity = renderInspectionIdentity(session);
  if (!identity || !isCurrentRenderInspection(identity)) {
    return;
  }
  // The durable session's URL is part of its exact fence. During a same-document
  // navigation location.href already names the new route, while the session that
  // must be failed still owns the previous one.
  const pageUrl = session.pageUrl;
  try {
    const response = await getContentBus().request("renderInspection.fail", {
      token: identity.token,
      generation: identity.generation,
      pageUrl,
      documentNonce: identity.documentNonce,
      reason,
    }, { target: "background" });
    if (!isCurrentRenderInspection(identity)) {
      return;
    }
    if (response.ok) {
      reconcileRenderInspectionMutation(identity, response.data);
    } else {
      renderInspectionCurtain?.failOpenMatching(identity);
    }
  } catch {
    // The curtain is an operator aid, never a permanent page lock. If even the
    // fenced failure report cannot reach the worker, the current session fails
    // open and the durable background deadline remains the final cleanup path.
    renderInspectionCurtain?.failOpenMatching(identity);
  }
}

async function adoptRenderInspectionSession(): Promise<void> {
  const pageUrl = currentPageUrl();
  if (!pageUrl) {
    provisionalBfcacheRenderInspectionFence = false;
    syncInteractionShield();
    return;
  }
  const adoptionGeneration = ++renderInspectionAdoptionGeneration;
  pendingRenderInspectionAdoptionGeneration = adoptionGeneration;
  const lifecycleGeneration = contentLifecycleGeneration;
  const routeGeneration = documentLifecycleGeneration;
  let response;
  try {
    response = await getContentBus().request("renderInspection.adopt", {
      pageUrl,
      documentNonce: RENDER_INSPECTION_DOCUMENT_NONCE,
    }, { target: "background" });
  } catch {
    if (pendingRenderInspectionAdoptionGeneration === adoptionGeneration) {
      pendingRenderInspectionAdoptionGeneration = null;
    }
    if (adoptionGeneration === renderInspectionAdoptionGeneration) {
      provisionalBfcacheRenderInspectionFence = false;
      syncInteractionShield();
    }
    return;
  }
  if (
    adoptionGeneration !== renderInspectionAdoptionGeneration ||
    lifecycleGeneration !== contentLifecycleGeneration ||
    routeGeneration !== documentLifecycleGeneration ||
    !sameDocumentPageUrl(pageUrl, currentPageUrl())
  ) {
    if (pendingRenderInspectionAdoptionGeneration === adoptionGeneration) {
      pendingRenderInspectionAdoptionGeneration = null;
    }
    return;
  }
  if (pendingRenderInspectionAdoptionGeneration === adoptionGeneration) {
    pendingRenderInspectionAdoptionGeneration = null;
  }
  if (response.ok && response.data.status === "adopt") {
    adoptAuthoritativeRenderInspection(response.data.session);
    provisionalBfcacheRenderInspectionFence = false;
    syncInteractionShield();
    return;
  }
  const current = renderInspectionCurtain?.current() ?? null;
  const identity = current ? renderInspectionIdentity(current) : null;
  if (identity) {
    // inactive/terminal/stale is the background's current answer for this exact
    // document request; it may fail open this local generation, but cannot touch
    // a later adoption because adoptionGeneration fences the continuation.
    renderInspectionCurtain?.failOpenMatching(identity);
  }
  provisionalBfcacheRenderInspectionFence = false;
  syncInteractionShield();
}

function releaseLocalRenderInspectionForPageHide(): void {
  // A BFCache hide keeps this content realm alive, so invalidate both an
  // in-flight adoption response and the curtain controller's queued paint
  // callbacks before the hidden document can be restored later.
  const current = renderInspectionCurtain?.current() ?? null;
  const identity = current ? renderInspectionIdentity(current) : null;
  // The retained realm knows synchronously that this document owned an active
  // inspection. Preserve a shield-only provisional lease across BFCache while
  // the fresh background adoption is pending; the curtain itself remains
  // absent until exact document authority is re-proven.
  provisionalBfcacheRenderInspectionFence = provisionalBfcacheRenderInspectionFence ||
    identity !== null || pendingRenderInspectionAdoptionGeneration !== null;
  pendingRenderInspectionAdoptionGeneration = null;
  renderInspectionAdoptionGeneration += 1;
  if (identity) {
    renderInspectionCurtain?.failOpenMatching(identity);
  }
}

function applyContentSignal(signal: BrainSignal): boolean {
  if (!interactionShieldAuthorityActive) {
    // Do not consume a signal while page ownership is unresolved or terminal.
    // The signal log can replay it after a managed page.context re-establishes
    // authority; consuming it here could recreate terminal UI/posture later.
    return false;
  }
  const nextState = transitionContentState(contentState, signal);
  if (nextState === contentState) {
    return false;
  }
  const previousStateName = contentState.name;
  const completesPreviewExit = signal.name === "preview.exit.requested" && nextState.name === "exit_restoring";
  const leavesPreviewInteraction = (
    contentState.name === "preview_open" || contentState.name === "silent_preview"
  ) && nextState.name !== "preview_open" && nextState.name !== "silent_preview";
  if (leavesPreviewInteraction) {
    // Preview targeting is content-owned physical state. Remove it while the
    // page is still interaction-blocked, before preview.exited can resume page
    // interactions and expose authority or hover from the prior occurrence.
    previewController.retireProjection();
  }
  contentState = nextState;
  if (signal.name === "session.navigated") {
    const toUrl = typeof signal.payload.pageUrl === "string"
      ? signal.payload.pageUrl
      : typeof signal.payload.toUrl === "string"
        ? signal.payload.toUrl
        : "";
    const fromUrl = typeof signal.payload.fromUrl === "string"
      ? signal.payload.fromUrl
      : "";
    if (toUrl) {
      lastConsumedNavigation = { fromUrl, toUrl, seq: signal.seq };
    }
  }
  contentPresentation = memoryForContent(nextState);
  syncContentTransientPreviewContext();
  reconcileMarkingInteractionAvailability();
  renderContentSurface();
  persistDocumentShieldPosture(signal, previousStateName);
  if (completesPreviewExit) {
    // This is the single completion point. The popup owns the request; content
    // owns the fact that its page posture has finished restoring. Reporting the
    // falling previewActive edge lets the brain birth preview.exited for both
    // organs, while resetting the request readies the next preview cycle.
    void reportContentFact("preview-exited", {
      previewActive: false,
      previewExitRequested: false,
    }).catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to report preview restoration", error);
    });
  }
  return true;
}

async function runContentSignalPull(): Promise<void> {
    const routeGeneration = documentLifecycleGeneration;
    const pageUrl = currentPageUrl();
    const response = await pullRewriteSignals(getContentBus(), {
      // Runtime transport supplies the real sender tab to the background. A
      // content script cannot discover its Chrome tab id itself.
      tabId: 0,
      afterSeq: contentState.lastConsumedSeq,
    });
    if (!response.ok) {
      return;
    }
    if (
      routeGeneration !== documentLifecycleGeneration ||
      pageUrl !== currentPageUrl() ||
      !interactionShieldAuthorityActive
    ) {
      // This slice belongs to an older route. Leave the cursor untouched so a
      // fresh pull can consume it together with the navigation boundary.
      return;
    }
    // fact.reported is an event: a fresh pull can reach the background before
    // that event has been folded into session.navigated. Until the matching
    // current-route boundary appears, consume nothing from the prior document.
    const pendingBoundary = pendingNavigationBoundary;
    let requiredNavigationIndex = -1;
    if (pendingBoundary && pendingBoundary.pageUrl === currentPageUrl()) {
      for (let index = response.data.length - 1; index >= 0; index -= 1) {
        const signal = response.data[index];
        if (
          signal?.name === "session.navigated" &&
          signal.seq > pendingBoundary.afterSeq &&
          (signal.payload.pageUrl === pendingBoundary.pageUrl || signal.payload.toUrl === pendingBoundary.pageUrl)
        ) {
          requiredNavigationIndex = index;
          break;
        }
      }
      if (requiredNavigationIndex < 0) {
        return;
      }
      if (pendingNavigationBoundary === pendingBoundary) {
        pendingNavigationBoundary = null;
        lastHandledNavigationSeq = Math.max(
          lastHandledNavigationSeq,
          response.data[requiredNavigationIndex]?.seq ?? 0,
        );
      }
    }
    // A pull started on route A can be replayed after route B has emitted its
    // navigation boundary. Applying the old prefix would briefly persist an A
    // blocked/preview posture on B; a realm crash between that set and the
    // following clear would make the stale posture durable. The last navigation
    // signal subsumes every older document signal in the same batch.
    let lastNavigationIndex = -1;
    for (let index = response.data.length - 1; index >= 0; index -= 1) {
      if (response.data[index]?.name === "session.navigated") {
        lastNavigationIndex = index;
        break;
      }
    }
    const boundaryIndex = Math.max(lastNavigationIndex, requiredNavigationIndex);
    const applicableSignals = boundaryIndex >= 0
      ? response.data.slice(boundaryIndex)
      : response.data;
    for (const signal of applicableSignals) {
      applyContentSignal(signal);
    }
}

const contentSignalScheduler = createSignalScheduler(runContentSignalPull);

function pullContentSignals(): Promise<void> {
  return contentSignalScheduler.request();
}

function ensureContentSignalPolling(): void {
  void pullContentSignals().catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Unable to pull content signals", error);
  });
  if (
    contentSignalPollHandle !== null ||
    typeof window === "undefined" ||
    typeof window.setInterval !== "function"
  ) {
    return;
  }
  contentSignalPollHandle = window.setInterval(() => {
    void pullContentSignals().catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to pull content signals", error);
    });
  }, CONTENT_SIGNAL_POLL_MS);
}

type StabilizationPageCommand =
  | "ARM"
  | "RECONCILE"
  | "SET_LAZY_LOADING_SUPPRESSED"
  | "SET_MOTION_PAUSED"
  | "DESTROY";
type StabilizationPageCommandError = Error & Readonly<{
  command: StabilizationPageCommand;
  requestNonce: string;
}>;
let stabilizationPageRequestSequence = 0;

function stabilizationCommandError(
  command: StabilizationPageCommand,
  requestNonce: string,
  message: string,
): StabilizationPageCommandError {
  return Object.assign(new Error(message), { command, requestNonce });
}

function stabilizationCommandTimeout(command: StabilizationPageCommand): number {
  return command === "SET_MOTION_PAUSED" ? 15_000 : command === "DESTROY" ? 5_000 : 3_000;
}

async function requestStabilizationPageCommand(
  command: StabilizationPageCommand,
  payload: Record<string, unknown>,
  sessionNonce = "",
): Promise<{ nonce: string; payload: Record<string, unknown> }> {
  stabilizationPageRequestSequence += 1;
  const nonce = `rewrite-stabilization-${Date.now()}-${stabilizationPageRequestSequence}`;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(stabilizationCommandError(
        command,
        nonce,
        `Page-world command timed out: ${command}`,
      ));
    }, stabilizationCommandTimeout(command));
  });
  try {
    const response = await Promise.race([
      getContentBus().request("pageWorld.command", {
        pageUrl: currentPageUrl(),
        nonce,
        sessionNonce: command === "ARM" || command === "RECONCILE" ? undefined : sessionNonce,
        command,
        payload,
      }, { target: "background" }),
      timeout,
    ]);
    if (!response.ok) {
      throw stabilizationCommandError(command, nonce, response.failure.message);
    }
    if (response.data.status !== "ok") {
      throw stabilizationCommandError(command, nonce, `Page-world command unavailable: ${response.data.reason}`);
    }
    if (!response.data.result.ok) {
      throw stabilizationCommandError(
        command,
        nonce,
        response.data.result.failure?.message ?? `Page-world command failed: ${command}`,
      );
    }
    return {
      nonce,
      payload: response.data.result.payload ?? {},
    };
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

function requireStabilizationPageState(
  command: StabilizationPageCommand,
  response: Readonly<{ nonce: string; payload: Record<string, unknown> }>,
  expected: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (response.payload[key] !== value) {
      throw stabilizationCommandError(
        command,
        response.nonce,
        `Page-world ${command} acknowledgement did not prove ${key}=${String(value)}`,
      );
    }
  }
}

function currentViewportScrollExtent(): number {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return 0;
  }
  const owner = resolveViewportScrollOwner(document, window);
  return owner.maximumOffset() + owner.viewportExtent();
}

function revealRectSignature(owner: ReturnType<typeof resolveViewportScrollOwner> | null): string {
  if (typeof document === "undefined" || typeof window === "undefined") return "";
  const elements: Element[] = [];
  const seen = new Set<Element>();
  const include = (element: Element | null | undefined): void => {
    if (!element || seen.has(element) || isComposedCaptureExcluded(element)) return;
    seen.add(element);
    elements.push(element);
  };
  include(owner?.element);
  include(document.documentElement);
  include(document.body);
  try {
    for (const [x, y] of [
      [window.innerWidth * 0.5, window.innerHeight * 0.5],
      [window.innerWidth * 0.15, window.innerHeight * 0.15],
      [window.innerWidth * 0.85, window.innerHeight * 0.15],
      [window.innerWidth * 0.15, window.innerHeight * 0.85],
      [window.innerWidth * 0.85, window.innerHeight * 0.85],
    ] as const) {
      for (const element of document.elementsFromPoint?.(x, y) ?? []) include(element);
    }
  } catch {
    // Geometry proof retains the owner/root probes in restricted documents.
  }
  const quarter = (value: number): number => Math.round(value * 4) / 4;
  return elements.slice(0, 24).map((element) => {
    try {
      const rect = element.getBoundingClientRect();
      return [rect.left, rect.top, rect.right, rect.bottom].map(quarter).join(",");
    } catch {
      return "unmeasurable";
    }
  }).join("|");
}

function revealResourceSignature(): string {
  if (typeof document === "undefined") return "";
  let hash = 2_166_136_261;
  const mix = (value: unknown): void => {
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  };
  const images = document.images;
  let imageCount = 0;
  let completeImages = 0;
  for (let index = 0; index < images.length; index += 1) {
    const image = images.item(index);
    if (!image || isComposedCaptureExcluded(image)) continue;
    imageCount += 1;
    if (image.complete) completeImages += 1;
    mix(image.currentSrc || image.src);
    mix(image.complete);
    mix(image.naturalWidth);
    mix(image.naturalHeight);
  }
  let mediaCount = 0;
  try {
    for (const node of document.querySelectorAll<HTMLMediaElement | HTMLSourceElement>(
      "video, audio, source",
    )) {
      if (isComposedCaptureExcluded(node)) continue;
      mediaCount += 1;
      mix(node.getAttribute("src"));
      mix(node.getAttribute("srcset"));
      mix("readyState" in node ? node.readyState : "");
    }
  } catch {
    // Image and performance evidence remains available.
  }
  // Do not fold the process-global PerformanceResourceTiming count into this
  // proof. Analytics and application polling are allowed to continue while a
  // capture-relevant image/media set is stable; a monotonic request count would
  // make those properties impossible to settle.
  return `${imageCount}:${completeImages}:${mediaCount}:${hash >>> 0}`;
}

function revealMotionSignature(includeTimeline: boolean): string {
  if (typeof document === "undefined" || typeof document.getAnimations !== "function") return "0";
  try {
    const states: string[] = [];
    for (const animation of document.getAnimations()) {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (target instanceof Element && isComposedCaptureExcluded(target)) continue;
      // A carousel/spinner is expected to advance during the visible top/middle
      // reveal walk. Its clock is proof only after the page-world freeze has
      // acknowledged; before that boundary, membership/play state is stable
      // evidence and clock progression must not starve the ritual.
      const timeline = includeTimeline
        ? typeof animation.currentTime === "number"
          ? `:${Math.round(animation.currentTime)}`
          : `:${String(animation.currentTime ?? "")}`
        : "";
      states.push(`${animation.playState}${timeline}`);
    }
    return `${states.length}:${states.sort().join("|")}`;
  } catch {
    return "unknown";
  }
}

function revealRowSignature(includeCaptureContent: boolean): string {
  if (typeof document === "undefined" || !document.documentElement) return "0:0:0";
  const maximumElements = 2_048;
  const stack: Element[] = [document.documentElement];
  let visited = 0;
  let shadowRoots = 0;
  let hash = 2_166_136_261;
  const mix = (value: unknown): void => {
    const text = String(value ?? "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  };
  while (stack.length > 0 && visited < maximumElements) {
    const element = stack.pop()!;
    if (isComposedCaptureExcluded(element)) continue;
    visited += 1;
    mix(element.localName || element.tagName);
    mix(element.childElementCount);
    mix(element.getAttribute?.("hidden") !== null);
    mix(element.getAttribute?.("aria-hidden"));
    mix(element.getAttribute?.("open") !== null);
    mix(element.getAttribute?.("src"));
    mix(element.getAttribute?.("srcset"));
    if (includeCaptureContent) {
      // After freeze, prove the capture-bearing row content—not merely its
      // shape. Bound both attributes and direct text so a very large article
      // cannot turn the 50 ms sampler into a full serialization pass.
      for (const attribute of Array.from(element.attributes ?? []).slice(0, 16)) {
        mix(attribute.name);
        mix(attribute.value.slice(0, 256));
      }
      for (const child of Array.from(element.childNodes ?? [])) {
        if (child.nodeType === 3) {
          mix((child.nodeValue ?? "").slice(0, 512));
        }
      }
    }
    const shadow = element.shadowRoot;
    if (shadow) {
      shadowRoots += 1;
      const shadowChildren = Array.from(shadow.children);
      for (let index = shadowChildren.length - 1; index >= 0; index -= 1) {
        stack.push(shadowChildren[index]!);
      }
    }
    const children = Array.from(element.children);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }
  return `${visited}:${shadowRoots}:${stack.length > 0 ? "bounded" : "complete"}:${hash >>> 0}`;
}

function revealAccessibleShadowRoots(): ShadowRoot[] {
  if (typeof document === "undefined" || !document.documentElement) return [];
  const result: ShadowRoot[] = [];
  const roots: ParentNode[] = [document];
  const seen = new Set<ShadowRoot>();
  while (roots.length > 0) {
    const root = roots.shift()!;
    let walker: TreeWalker;
    try {
      walker = document.createTreeWalker(root, 1);
    } catch {
      continue;
    }
    let node = walker.nextNode();
    while (node) {
      const element = node as Element;
      if (!isComposedCaptureExcluded(element)) {
        const shadow = element.shadowRoot;
        if (shadow && shadow.mode === "open" && !seen.has(shadow)) {
          seen.add(shadow);
          result.push(shadow);
          roots.push(shadow);
        }
      }
      node = walker.nextNode();
    }
  }
  return result;
}

async function runActivationStabilization(pageUrl: string): Promise<RevealRunResult | null> {
  try {
    return await revealController.runTask(async () => {
      if (!interactionShieldAuthorityActive) {
        return {
          skipped: true,
          lazyExpansions: 0,
          frozenAtBottom: false,
          reason: "authority-unavailable",
        };
      }
      const lifecycleGeneration = contentLifecycleGeneration;
      const routeGeneration = documentLifecycleGeneration;
      spaGuard.arm(pageUrl);
      await reconcilePageWorldSessionAndWait();
      pageInspectionActive = true;
      lastContentSurfaceSignature = "";
      renderContentSurface();
      const scrollRestoration = createViewportScrollRestorationLedger();
      const initialScrollOwner = typeof window !== "undefined" && typeof document !== "undefined"
        ? scrollRestoration.observe(resolveViewportScrollOwner(document, window))
        : null;
      let scrollOwner = initialScrollOwner;
      let zeroRangeReproofUsed = false;
      const scrollOwnerIsUsable = (owner: typeof scrollOwner): boolean => Boolean(
        owner &&
        owner.element.isConnected !== false &&
        owner.viewportExtent() > 0
      );
      const refreshScrollOwner = (force = false): typeof scrollOwner => {
        if (typeof window === "undefined" || typeof document === "undefined") {
          return scrollOwner;
        }
        // Owner discovery deliberately reads and movement-probes a bounded
        // viewport candidate corpus. It is authority work, not a quiet-sample
        // measurement: keep the proved owner for the complete ritual unless it
        // becomes unusable or a real movement stalls.
        if (!force && scrollOwnerIsUsable(scrollOwner)) {
          return scrollOwner;
        }
        scrollOwner = scrollRestoration.observe(resolveViewportScrollOwner(document, window));
        return scrollOwner;
      };
      const currentScrollExtent = (): number => {
        let owner = refreshScrollOwner();
        if (
          owner &&
          owner.maximumOffset() <= 2 &&
          !zeroRangeReproofUsed
        ) {
          // Lazy materialization can introduce a nested viewport owner after
          // the initial proof. Permit one explicit no-range re-proof without
          // turning every quiet poll back into a document-scale owner search.
          zeroRangeReproofUsed = true;
          owner = refreshScrollOwner(true);
        }
        return owner
          ? owner.maximumOffset() + owner.viewportExtent()
          : currentViewportScrollExtent();
      };
      const isStale = (): boolean => !interactionShieldAuthorityActive ||
        lifecycleGeneration !== contentLifecycleGeneration ||
        routeGeneration !== documentLifecycleGeneration ||
        !sameDocumentPageUrl(
          pageUrl,
          typeof location !== "undefined" ? location.href : pageUrl,
        );
      const waitForSettle = async (phase: "step" | "post-freeze"): Promise<boolean> => {
        if (typeof window === "undefined" || typeof document === "undefined") {
          return false;
        }
        const proof = await waitForRevealQuiet({
          document,
          window,
          isStale,
          measureExtent: currentScrollExtent,
          measureRects: () => revealRectSignature(scrollOwner),
          measureResources: revealResourceSignature,
          measureMotion: () => revealMotionSignature(phase === "post-freeze"),
          measureRows: () => revealRowSignature(phase === "post-freeze"),
          ...(phase === "post-freeze" ? {
            resetOnCaptureMutation: true,
            additionalMutationRoots: revealAccessibleShadowRoots(),
            shadowRootAttachedEventName: OPEN_SHADOW_ATTACHED_EVENT,
          } : {}),
          ...(phase === "post-freeze" ? { quietMs: 2_000, timeoutMs: 4_000 } : {}),
        });
        return proof.quiet;
      };
      let attemptedPageWorldSessionNonce = "";
      try {
        const armed = await requestStabilizationPageCommand("ARM", {});
        attemptedPageWorldSessionNonce = armed.nonce;
        requireStabilizationPageState("ARM", armed, {
          armed: true,
          paused: false,
          lazySuppressed: false,
          sessionNonce: armed.nonce,
          phase: "armed",
        });
        if (isStale()) {
          await destroyPageWorldSessionAndWait(armed.nonce);
          return {
            skipped: true,
            lazyExpansions: 0,
            frozenAtBottom: false,
            reason: "page-world-session-stale",
          };
        }
        pageWorldSessionNonce = armed.nonce;
        const result = await runReveal({
          hasVerticalScrollRoom: (initialScrollOwner?.maximumOffset() ?? 0) > 2,
          activationStale: isStale,
          initialScrollHeight: scrollOwner
            ? scrollOwner.maximumOffset() + scrollOwner.viewportExtent()
            : 0,
          measureExpandedScrollHeight: currentScrollExtent,
          async scrollTo(position, measuredScrollHeight) {
            if (typeof window === "undefined" || isStale()) {
              return { reached: false, progressed: false };
            }
            if (position === "restore") {
              let allReached = true;
              let anyProgress = false;
              for (const origin of scrollRestoration.positionsForRestore()) {
                if (isStale()) {
                  return { reached: false, progressed: anyProgress };
                }
                const beforeOffset = origin.owner.currentOffset();
                const scroll = await smoothScrollOwnerTo(
                  origin.owner,
                  origin.top,
                  isStale,
                  window,
                  origin.left,
                );
                const afterOffset = origin.owner.currentOffset();
                allReached = allReached && scroll.reached;
                anyProgress = anyProgress || scroll.reached ||
                  Math.abs(afterOffset - beforeOffset) > 2;
              }
              return { reached: allReached, progressed: anyProgress };
            }
            let resolvedOwner = refreshScrollOwner();
            if (!resolvedOwner) {
              return { reached: false, progressed: false };
            }
            scrollOwner = resolvedOwner;
            const targetForOwner = (owner: NonNullable<typeof resolvedOwner>): number => {
              const bottomOffset = Math.min(
                owner.maximumOffset(),
                Math.max(0, measuredScrollHeight - owner.viewportExtent()),
              );
              return position === "top"
                ? 0
                : position === "lazy-threshold"
                  ? Math.round(bottomOffset * 0.5)
                  : bottomOffset;
            };
            let beforeOffset = resolvedOwner.currentOffset();
            let targetOffset = targetForOwner(resolvedOwner);
            // The visible walk is driven by bounded extension-owned frames.
            // Native smooth scrolling can remain queued after freeze, while a
            // one-shot auto write would recreate the old mechanical teleport.
            let scroll = await smoothScrollOwnerTo(
              resolvedOwner,
              targetOffset,
              isStale,
              window,
            );
            let afterOffset = resolvedOwner.currentOffset();
            let progressed = scroll.reached || Math.abs(afterOffset - beforeOffset) > 2;
            if (!scroll.stale && !progressed) {
              const reprovedOwner = refreshScrollOwner(true);
              if (reprovedOwner && reprovedOwner.element !== resolvedOwner.element) {
                resolvedOwner = reprovedOwner;
                scrollOwner = reprovedOwner;
                beforeOffset = reprovedOwner.currentOffset();
                targetOffset = targetForOwner(reprovedOwner);
                scroll = await smoothScrollOwnerTo(
                  reprovedOwner,
                  targetOffset,
                  isStale,
                  window,
                );
                afterOffset = reprovedOwner.currentOffset();
                progressed = scroll.reached || Math.abs(afterOffset - beforeOffset) > 2;
              }
            }
            if (position !== "bottom") {
              return { reached: scroll.reached, progressed };
            }
            // The document can grow while a smooth scroll is in flight. A fixed
            // target reached against the old height is not the true bottom.
            const maximumOffset = resolvedOwner.maximumOffset();
            const visualBottomReached = maximumOffset <= 2 ||
              resolvedOwner.currentOffset() >= maximumOffset * 0.995;
            return {
              reached: !scroll.stale && visualBottomReached,
              progressed,
            };
          },
          waitForSettle,
          async suppressLazyLoading() {
            if (isStale()) {
              return;
            }
            // The visible reveal walk owns site materialization. Extension-side
            // data-* promotion would fabricate DOM and contaminate capture, so
            // suppression is acknowledged without mutating media attributes.
            const response = await requestStabilizationPageCommand(
              "SET_LAZY_LOADING_SUPPRESSED",
              { suppressed: true },
              pageWorldSessionNonce,
            );
            requireStabilizationPageState("SET_LAZY_LOADING_SUPPRESSED", response, {
              armed: true,
              lazySuppressed: true,
              sessionNonce: pageWorldSessionNonce,
            });
          },
          async restoreLazyLoading() {
            if (!pageWorldSessionNonce) {
              return;
            }
            const response = await requestStabilizationPageCommand(
              "SET_LAZY_LOADING_SUPPRESSED",
              { suppressed: false },
              pageWorldSessionNonce,
            );
            requireStabilizationPageState("SET_LAZY_LOADING_SUPPRESSED", response, {
              armed: true,
              lazySuppressed: false,
              sessionNonce: pageWorldSessionNonce,
            });
          },
          async freezeAtBottom() {
            if (isStale()) {
              return;
            }
            const response = await requestStabilizationPageCommand(
              "SET_MOTION_PAUSED",
              { paused: true },
              pageWorldSessionNonce,
            );
            requireStabilizationPageState("SET_MOTION_PAUSED", response, {
              armed: true,
              paused: true,
              lazySuppressed: true,
              sessionNonce: pageWorldSessionNonce,
              phase: "frozen",
              initialDiscoveryComplete: true,
            });
            if (isStale()) {
              return;
            }
            freezeController.pause("page-visit");
            lastContentSurfaceSignature = "";
            renderContentSurface();
          },
        });
        if (isStale() || !result.frozenAtBottom) {
          await destroyPageWorldSessionAndWait();
          return {
            skipped: true,
            lazyExpansions: result.lazyExpansions,
            frozenAtBottom: false,
            reason: result.reason ?? "activation-stale",
          };
        }
        return result;
      } catch (error) {
        const requestNonce = error && typeof error === "object" && "requestNonce" in error
          ? String((error as { requestNonce?: unknown }).requestNonce ?? "")
          : "";
        // This task may finish after a newer reveal has adopted its own exact
        // session. Reconcile only the lease this task armed; never tear down the
        // module-global newer session in an old task's catch path.
        const cleanupNonce = attemptedPageWorldSessionNonce || pageWorldSessionNonce || requestNonce;
        if (cleanupNonce) {
          await destroyPageWorldSessionAndWait(cleanupNonce).catch((cleanupError: unknown) => {
            console.error("[Unfluffify][rewrite] Unable to reconcile failed page-world posture", cleanupError);
          });
        }
        throw error;
      } finally {
        if (
          lifecycleGeneration === contentLifecycleGeneration &&
          pageWorldCleanupFenceNonce === ""
        ) {
          pageInspectionActive = false;
          lastContentSurfaceSignature = "";
          renderContentSurface();
        }
      }
    }, { scopeStrength: 1 });
  } catch (error) {
    console.error("[Unfluffify][rewrite] Page stabilization failed", error);
    return null;
  }
}

async function requestPageWorldSessionDestroy(sessionNonce: string): Promise<boolean> {
  if (!sessionNonce || typeof window === "undefined") {
    return true;
  }
  const response = await requestStabilizationPageCommand("DESTROY", {}, sessionNonce);
  requireStabilizationPageState("DESTROY", response, {
    armed: false,
    paused: false,
    lazySuppressed: false,
    sessionNonce: "",
    phase: "idle",
  });
  return true;
}

async function reconcilePageWorldSessionAndWait(): Promise<void> {
  if (typeof window === "undefined") {
    freezeController.lift();
    pageWorldSessionNonce = "";
    return;
  }
  const previousNonce = pageWorldSessionNonce;
  const reconcileEpoch = ++pageWorldLifecycleEpoch;
  if (pageWorldDestroyRetryHandle !== null) clearTimeout(pageWorldDestroyRetryHandle);
  pageWorldDestroyRetryHandle = null;
  pageWorldDestroyRetryNonce = "";
  pageWorldDestroyRetryAttempt = 0;
  // An older request cannot be cancelled at the transport boundary, but its
  // continuation is epoch-fenced below and must not be reused by this owner.
  pageWorldDestroyInFlight = null;
  const response = await requestStabilizationPageCommand("RECONCILE", {});
  requireStabilizationPageState("RECONCILE", response, {
    armed: false,
    paused: false,
    lazySuppressed: false,
    sessionNonce: "",
    phase: "idle",
  });
  if (reconcileEpoch !== pageWorldLifecycleEpoch) return;
  freezeController.lift();
  pageWorldSessionNonce = "";
  if (previousNonce) clearPageWorldCleanupFence(previousNonce);
}

function retainPageWorldCleanupFence(nonce: string): void {
  if (!nonce) {
    return;
  }
  pageWorldCleanupFenceNonce = nonce;
  pageInspectionActive = true;
  lastContentSurfaceSignature = "";
  renderContentSurface();
}

function clearPageWorldCleanupFence(nonce: string): void {
  if (pageWorldDestroyRetryNonce === nonce) {
    if (pageWorldDestroyRetryHandle !== null) {
      clearTimeout(pageWorldDestroyRetryHandle);
    }
    pageWorldDestroyRetryHandle = null;
    pageWorldDestroyRetryNonce = "";
    pageWorldDestroyRetryAttempt = 0;
  }
  if (pageWorldCleanupFenceNonce !== nonce) {
    return;
  }
  pageWorldCleanupFenceNonce = "";
  pageInspectionActive = false;
  lastContentSurfaceSignature = "";
  renderContentSurface();
  if (!interactionShieldAuthorityActive) {
    disposeInteractionShield();
  }
}

function failOpenPageWorldCleanupFenceLocally(): void {
  if (pageWorldDestroyRetryHandle !== null) {
    clearTimeout(pageWorldDestroyRetryHandle);
  }
  pageWorldDestroyRetryHandle = null;
  pageWorldDestroyRetryNonce = "";
  pageWorldDestroyRetryAttempt = 0;
  pageWorldCleanupFenceNonce = "";
  pageInspectionActive = false;
}

function schedulePageWorldDestroyRetry(nonce: string): void {
  if (!nonce || typeof window === "undefined") {
    return;
  }
  if (pageWorldDestroyRetryNonce && pageWorldDestroyRetryNonce !== nonce) {
    return;
  }
  pageWorldDestroyRetryNonce = nonce;
  if (pageWorldDestroyRetryHandle !== null) {
    return;
  }
  const delay = Math.min(2_000, 100 * (2 ** Math.min(pageWorldDestroyRetryAttempt, 5)));
  pageWorldDestroyRetryHandle = window.setTimeout(() => {
    pageWorldDestroyRetryHandle = null;
    pageWorldDestroyRetryAttempt += 1;
    void destroyPageWorldSessionAndWait(nonce).catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Page-world teardown retry remains pending", error);
    });
  }, delay);
}

async function destroyPageWorldSessionAndWait(explicitNonce = ""): Promise<void> {
  const wasPaused = freezeController.isPaused();
  const ownedNonce = explicitNonce || pageWorldSessionNonce;
  if (!ownedNonce || typeof window === "undefined") {
    freezeController.lift();
    if (!explicitNonce || pageWorldSessionNonce === explicitNonce) {
      pageWorldSessionNonce = "";
    }
    if (wasPaused) {
      lastContentSurfaceSignature = "";
      renderContentSurface();
    }
    return;
  }
  if (explicitNonce && pageWorldSessionNonce && pageWorldSessionNonce !== explicitNonce) {
    // A late task is attempting to reconcile a superseded lease. The current
    // exact session is authoritative and must not be fenced or destroyed.
    return;
  }
  // Teardown is an acknowledgement boundary. Acquire the physical cleanup
  // fence before the first request, not after two timeouts, so the page is
  // never interactive while its page-world posture is uncertain.
  retainPageWorldCleanupFence(ownedNonce);
  if (pageWorldDestroyInFlight?.nonce === ownedNonce) {
    return pageWorldDestroyInFlight.promise;
  }
  const destroyEpoch = ++pageWorldLifecycleEpoch;
  const promise = (async (): Promise<void> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await requestPageWorldSessionDestroy(ownedNonce);
        if (destroyEpoch !== pageWorldLifecycleEpoch) return;
        lastError = null;
        break;
      } catch (error) {
        if (destroyEpoch !== pageWorldLifecycleEpoch) return;
        lastError = error;
      }
    }
    if (lastError) {
      // The command may have applied even when its response was lost. Preserve
      // the exact lease so the next activation/terminal retry can issue the same
      // idempotent DESTROY instead of orphaning a frozen page world.
      if (destroyEpoch === pageWorldLifecycleEpoch &&
        (!pageWorldSessionNonce || pageWorldSessionNonce === ownedNonce)) {
        pageWorldSessionNonce = ownedNonce;
        retainPageWorldCleanupFence(ownedNonce);
        schedulePageWorldDestroyRetry(ownedNonce);
      }
      throw lastError;
    }
    // A newer exact session must never be cleared by an older teardown reply.
    if (destroyEpoch === pageWorldLifecycleEpoch &&
      (!pageWorldSessionNonce || pageWorldSessionNonce === ownedNonce)) {
      freezeController.lift();
      pageWorldSessionNonce = "";
      clearPageWorldCleanupFence(ownedNonce);
      if (wasPaused) {
        lastContentSurfaceSignature = "";
        renderContentSurface();
      }
    }
  })();
  pageWorldDestroyInFlight = { nonce: ownedNonce, epoch: destroyEpoch, promise };
  try {
    await promise;
  } finally {
    if (pageWorldDestroyInFlight?.promise === promise) {
      pageWorldDestroyInFlight = null;
    }
  }
}

function destroyPageWorldSession(): Promise<void> {
  const teardown = destroyPageWorldSessionAndWait();
  void teardown.catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Unable to confirm page-world teardown", error);
  });
  return teardown;
}

function setSpacePassthrough(event: KeyboardEvent, active: boolean): void {
  if (event.code === "Space" || event.key === " ") {
    if (spacePassthroughWatchdog !== null) {
      clearTimeout(spacePassthroughWatchdog);
      spacePassthroughWatchdog = null;
    }
    const wasActive = spacePassthroughActive;
    spacePassthroughActive = active;
    markingEngine?.setPassthrough?.(active);
    syncMarkingCursor();
    if (!wasActive && active) {
      contentToasts.show({ message: "Page interaction mode", tone: "success" });
    }
    if (active) {
      spacePassthroughWatchdog = setTimeout(() => {
        spacePassthroughWatchdog = null;
        if (!spacePassthroughActive) {
          return;
        }
        spacePassthroughActive = false;
        markingEngine?.setPassthrough?.(false);
        syncMarkingCursor();
      }, SPACE_PASSTHROUGH_WATCHDOG_MS);
    }
  }
}

function setAltInclude(event: Pick<KeyboardEvent, "code" | "key">, active: boolean): void {
  if (event.key !== "Alt" && event.code !== "AltLeft" && event.code !== "AltRight") {
    return;
  }
  altIncludeActive = active;
  syncMarkingCursor();
}

function markModeForClick(event: MouseEvent): "passthrough" | "include" | "exclude" {
  if (spacePassthroughActive) {
    return "passthrough";
  }
  return event.altKey ? "include" : "exclude";
}

/** Reports the toggle as a fact and nothing more. The brain is the only producer
 *  of markings.changed: an organ that also emitted it would be a second source of
 *  truth for one decision, and the two could disagree. Rows are display data and
 *  are fetched from getContentMainStatus when the popup wants them, rather than
 *  riding a signal. */
function reportMarkingToggle(): void {
  void reportContentFact("marking-toggle", {
    markingToggleSeq,
    markingDirty: isUserMarkingDirty(),
    markingFingerprint: currentMarkingFingerprint(),
  })
    .catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to report a marking toggle", error);
    });
}

async function reportContentFact(reason: string, facts: Record<string, unknown>): Promise<void> {
  const tabId = 0;
  await getContentBus().emit("fact.reported", {
    kind: "uf-fact/1",
    sensation: {
      tabId,
      source: "content",
      reason,
      facts: {
        tabId,
        pageUrl: currentPageUrl() || undefined,
        baseUrl: baseUrlFor(currentPageUrl()) || undefined,
        markingEnabled: markingActive,
        // Startup is a consumer handshake, not a new lock observation. Omitting
        // authority here preserves the background's existing lock facts until
        // the lock organ reports a genuine state.
        ...(reason === "content-started" ? {} : {
          lockRole: contentAuthority.lockRole,
          configPresent: contentAuthority.configPresent,
        }),
        reconciliationPending: contentPresentation.reconciliationPending,
        reconciliationReason: contentState.reconciliationReason || undefined,
        ...facts,
      },
    },
  }, { target: "background" });
  // Pull immediately after reporting so the content organ does not have to wait
  // for the periodic correctness poll to observe the brain's decided edge.
  void pullContentSignals().catch(() => undefined);
}

function contentPreviewContext(): Readonly<{ active: boolean; restoring: boolean }> {
  const active = contentState.name === "preview_open" ||
    contentState.name === "silent_preview" ||
    contentState.name === "exit_restoring";
  return {
    active,
    restoring: contentState.name === "exit_restoring",
  };
}

function ensureContentTransientSurfaces(): ContentTransientSurfaces {
  if (contentTransientSurfaces) {
    return contentTransientSurfaces;
  }
  contentTransientSurfaces = createContentTransientSurfaces({
    async requestPreviewExit() {
      const context = contentPreviewContext();
      if (!context.active || context.restoring || !interactionShieldAuthorityActive) {
        return false;
      }
      await reportContentFact("preview-escape-requested", {
        previewExitRequested: true,
      });
      return true;
    },
    onPreviewExitError(error) {
      console.error("[Unfluffify][rewrite] Unable to request preview restoration", error);
    },
  });
  contentTransientSurfaces.syncPreviewContext(contentPreviewContext());
  return contentTransientSurfaces;
}

function syncContentTransientPreviewContext(): void {
  contentTransientSurfaces?.syncPreviewContext(contentPreviewContext());
}

async function pingContentActivity(_command: CommandEnvelope): Promise<void> {
  try {
    await reportContentFact("activity-ping", {
      candidate: true,
      markingEnabled: markingActive,
      pageUrl: currentPageUrl() || undefined,
      baseUrl: baseUrlFor(currentPageUrl()) || undefined,
    });
  } catch (error) {
    console.error("[Unfluffify][rewrite] Unable to report content activity", error);
  }
}

function ensureContentSurfaceStyles(): void {
  if (
    typeof document === "undefined"
    || !document.documentElement
    || typeof document.createElement !== "function"
  ) {
    return;
  }
  if (document.getElementById?.(CONTENT_SURFACE_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = CONTENT_SURFACE_STYLE_ID;
  style.setAttribute("data-uf-extension-ui", "true");
  style.textContent = `
@keyframes uf-content-surface-spin { to { transform: rotate(360deg); } }
@keyframes uf-content-toast-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
[data-uf-content-banner="true"] {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-sizing: border-box;
  padding: 12px 16px;
  border-bottom: 1px solid #d39e00;
  background: #fff3cd;
  color: #4d3900;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  pointer-events: auto;
  font: 600 14px/1.35 "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
[data-uf-content-banner-copy="true"] {
  flex: 1;
  min-width: 0;
}
[data-uf-content-banner-actions="true"] {
  display: flex;
  gap: 8px;
  pointer-events: auto;
}
[data-uf-content-lock-action="true"],
[data-uf-content-lock-confirm="discard"],
[data-uf-content-lock-confirm-cancel="true"] {
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.82);
  color: inherit;
  cursor: pointer;
  font: inherit;
}
[data-uf-content-curtain="true"] {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: auto;
  cursor: progress;
  background: rgba(16, 20, 28, 0.2);
}
[data-uf-content-curtain-card="true"] {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(460px, calc(100vw - 32px));
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 12px;
  background: rgba(22, 26, 34, 0.96);
  color: white;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
  font: 650 14px/1.35 Inter, system-ui, sans-serif;
}
[data-uf-content-curtain-spinner="true"] {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  box-sizing: border-box;
  border: 2px solid rgba(255, 255, 255, 0.28);
  border-top-color: white;
  border-radius: 999px;
  animation: uf-content-surface-spin 0.8s linear infinite;
}
[data-uf-motion-pause-indicator="true"] {
  position: fixed;
  top: max(10px, calc(env(safe-area-inset-top) + 10px));
  right: max(10px, calc(env(safe-area-inset-right) + 10px));
  display: flex;
  width: 48px;
  height: 30px;
  align-items: center;
  justify-content: center;
  gap: 2px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 7px;
  background: rgba(17, 24, 39, 0.78);
  color: white;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(6px);
  pointer-events: none;
}
[data-uf-content-surface-icon="true"] {
  display: block;
  width: 18px;
  height: 18px;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}
[data-uf-content-toast="true"] {
  position: fixed;
  left: 50%;
  bottom: max(14px, calc(env(safe-area-inset-bottom) + 14px));
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 28px));
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-left-width: 4px;
  border-radius: 10px;
  background: rgba(47, 42, 36, 0.9);
  color: #fdf6ed;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  transform: translateX(-50%);
  font: 500 12px/1.4 Inter, system-ui, sans-serif;
  animation: uf-content-toast-in 0.2s ease both;
}
[data-uf-content-toast-tone="success"] { border-left-color: #5cc98a; }
[data-uf-content-toast-tone="warning"] { border-left-color: #f0bd4f; }
[data-uf-content-toast-tone="danger"] { border-left-color: #ef6b73; }
[data-uf-content-toast-copy="true"] {
  min-width: 0;
  overflow-wrap: anywhere;
}
[data-uf-content-toast-close="true"] {
  display: inline-grid;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.38);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  cursor: pointer;
  pointer-events: auto;
  font: 700 18px/1 Inter, system-ui, sans-serif;
}
[data-uf-content-toast-close="true"]:focus-visible {
  outline: 2px solid white;
  outline-offset: 2px;
}
[data-uf-marking-paused-notice="true"] {
  position: fixed;
  top: max(14px, calc(env(safe-area-inset-top) + 14px));
  left: 50%;
  max-width: min(420px, calc(100vw - 28px));
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: rgba(35, 39, 47, 0.94);
  color: white;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  pointer-events: none;
  transform: translateX(-50%);
  font: 650 13px/1.35 Inter, system-ui, sans-serif;
}
@media (prefers-reduced-motion: reduce) {
  [data-uf-content-curtain-spinner="true"],
  [data-uf-content-toast="true"] { animation: none; }
}
`;
  document.documentElement.appendChild(style);
}

function createContentSurfaceIcon(pathData: string): HTMLElement {
  const icon = document.createElement("span");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${pathData}"/></svg>`;
  const maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("data-uf-content-surface-icon", "true");
  icon.style.maskImage = maskImage;
  icon.style.webkitMaskImage = maskImage;
  return icon;
}

function pausedNoticeCopy(reason: string): string {
  if (reason === "saving") {
    return "Saving page... marking paused";
  }
  if (reason === "syncing" || reason === "sync_pending") {
    return "Save sync pending... marking paused";
  }
  return "Marking temporarily paused";
}

contentToasts.subscribe(() => {
  if (typeof document !== "undefined") {
    lastContentSurfaceSignature = "";
    renderContentSurface();
  }
});

function extensionSurfacesForShield(): HTMLElement[] {
  const surfaces: HTMLElement[] = [];
  const markingRoot = markingEngine?.overlayRoot?.();
  if (markingRoot) {
    surfaces.push(markingRoot);
  }
  if (contentSurfaceRoot) {
    surfaces.push(contentSurfaceRoot);
  }
  const inspectionRoot = renderInspectionCurtain?.element();
  if (inspectionRoot) {
    surfaces.push(inspectionRoot);
  }
  return surfaces;
}

function inputBoundarySurfacesForShield(): HTMLElement[] {
  const surfaces: HTMLElement[] = [];
  if (contentSurfaceRoot && contentSurfaceInputBoundaryActive) {
    surfaces.push(contentSurfaceRoot);
  }
  const inspectionRoot = renderInspectionCurtain?.element();
  if (inspectionRoot && renderInspectionCurtain?.current()) {
    surfaces.push(inspectionRoot);
  }
  return surfaces;
}

function privilegedExtensionTargetsForShield(): HTMLElement[] {
  return [...contentSurfacePrivilegedTargets].filter((target) => target.isConnected !== false);
}

function inspectionOwnsScroll(): boolean {
  return pageInspectionActive || provisionalBfcacheRenderInspectionFence ||
    (renderInspectionCurtain?.current() ?? null) !== null;
}

function ensureInteractionShield(): InteractionShieldController | null {
  if (interactionShield || typeof document === "undefined" || typeof window === "undefined") {
    return interactionShield;
  }
  if (!document.documentElement) {
    if (!shieldRootReadyListenerInstalled) {
      shieldRootReadyListenerInstalled = true;
      document.addEventListener("DOMContentLoaded", () => {
        shieldRootReadyListenerInstalled = false;
        syncInteractionShield();
      }, { once: true });
    }
  }
  interactionShield = createInteractionShield({
    document,
    window,
    extensionSurfaces: extensionSurfacesForShield,
    inputBoundarySurfaces: inputBoundarySurfacesForShield,
    privilegedExtensionTargets: privilegedExtensionTargetsForShield,
    blockNativeScroll: inspectionOwnsScroll,
    onShieldInput: (event) => {
      if (event.isTrusted === false) {
        return;
      }
      if (event.type === "click") {
        handlePreviewPageClick(event as MouseEvent);
      }
    },
  });
  return interactionShield;
}

/** Synchronizes independent shield leases without exposing the page between them.
 * Acquire the replacement lease before releasing the old one; on the final release,
 * restore marking input before removing the physical target beneath it. */
function syncInteractionShield(): void {
  const previewActive = previewInteractionActive();
  const silentActive = silentInteractionShieldActive;
  const blockedOrganActive = contentPresentation.pageInputBlocked && !previewActive;
  const inspectionActive = (renderInspectionCurtain?.current() ?? null) !== null;
  const bfcacheInspectionActive = provisionalBfcacheRenderInspectionFence;
  const pageVisitInspectionActive =
    pageWorldCleanupFenceNonce !== "" ||
    (pageInspectionActive && interactionShieldAuthorityActive);
  const shouldBeActive = inspectionActive || bfcacheInspectionActive || pageVisitInspectionActive || (
    interactionShieldAuthorityActive &&
    (silentActive || previewActive || blockedOrganActive || durablePostureShieldActive)
  );
  if (!shouldBeActive) {
    markingEngine?.setInputTransparent?.(false);
    interactionShield?.setActive(SILENT_SHIELD_REASON, false);
    interactionShield?.setActive(PREVIEW_SHIELD_REASON, false);
    interactionShield?.setActive(BLOCKED_ORGAN_SHIELD_REASON, false);
    interactionShield?.setActive(DURABLE_POSTURE_SHIELD_REASON, false);
    interactionShield?.setActive(RENDER_INSPECTION_SHIELD_REASON, false);
    interactionShield?.setActive(BF_CACHE_RENDER_INSPECTION_SHIELD_REASON, false);
    interactionShield?.setActive(PAGE_VISIT_INSPECTION_SHIELD_REASON, false);
    return;
  }
  const controller = ensureInteractionShield();
  if (!controller) {
    return;
  }
  if (silentActive) {
    controller.setActive(SILENT_SHIELD_REASON, true);
  }
  if (previewActive) {
    controller.setActive(PREVIEW_SHIELD_REASON, true);
  }
  if (blockedOrganActive) {
    controller.setActive(BLOCKED_ORGAN_SHIELD_REASON, true);
  }
  if (durablePostureShieldActive) {
    controller.setActive(DURABLE_POSTURE_SHIELD_REASON, true);
  }
  if (inspectionActive) {
    controller.setActive(RENDER_INSPECTION_SHIELD_REASON, true);
  }
  if (bfcacheInspectionActive) {
    controller.setActive(BF_CACHE_RENDER_INSPECTION_SHIELD_REASON, true);
  }
  if (pageVisitInspectionActive) {
    controller.setActive(PAGE_VISIT_INSPECTION_SHIELD_REASON, true);
  }
  markingEngine?.setInputTransparent?.(true);
  controller.setActive(SILENT_SHIELD_REASON, silentActive);
  controller.setActive(PREVIEW_SHIELD_REASON, previewActive);
  controller.setActive(BLOCKED_ORGAN_SHIELD_REASON, blockedOrganActive);
  controller.setActive(DURABLE_POSTURE_SHIELD_REASON, durablePostureShieldActive);
  controller.setActive(RENDER_INSPECTION_SHIELD_REASON, inspectionActive);
  controller.setActive(BF_CACHE_RENDER_INSPECTION_SHIELD_REASON, bfcacheInspectionActive);
  controller.setActive(PAGE_VISIT_INSPECTION_SHIELD_REASON, pageVisitInspectionActive);
  controller.refresh();
}

function disposeInteractionShield(): void {
  if (pageWorldCleanupFenceNonce) {
    // Terminal authority can retire every other surface immediately, but the
    // exact teardown fence owns this physical boundary until idle proof.
    syncInteractionShield();
    return;
  }
  markingEngine?.setInputTransparent?.(false);
  interactionShield?.dispose();
  interactionShield = null;
}

function disposeTerminalContentSurfaces(): void {
  removeSilentDebugCopyListener?.();
  removeMarkingListeners?.();
  removeNavigationGate?.();
  markingEngine?.dispose();
  markingEngine = null;
  markingActive = false;
  userToggleCount = 0;
  cleanMarkingFingerprint = null;
  selectorsSeeded = false;
  markingInteractionsPaused = false;
  pageInspectionActive = false;
  contentToasts.retire();
  spaGuard.disarm();
  destroyPageWorldSession();
  syncMarkingCursor();
  contentSurfaceRoot?.remove();
  contentSurfaceRoot = null;
  contentSurfaceInputBoundaryActive = false;
  contentSurfacePrivilegedTargets.clear();
  if (typeof document !== "undefined") {
    // A terminal boundary must clean every extension-owned renderer occurrence,
    // including an older instance that lost the module pointer during an
    // overlapping silent/adoption transition. Normal presentation parking may
    // retain a root for fast re-entry; unregister/property-exit/invalidation may
    // not retain even an empty layer.
    for (const root of Array.from(document.querySelectorAll?.(
      '.uf-marking-layer-root[data-uf-extension-ui="true"]',
    ) ?? [])) {
      root.remove();
    }
    document.getElementById?.(MARKING_CURSOR_STYLE_ID)?.remove();
    document.getElementById?.(CONTENT_SURFACE_STYLE_ID)?.remove();
  }
  lastContentSurfaceSignature = "";
}

function terminateInteractionShieldAuthority(
  options: Readonly<{ failOpenCleanupFence?: boolean }> = {},
): void {
  contentLifecycleGeneration += 1;
  // Authority termination is also the terminal boundary for the current
  // reveal/freeze presentation lease. The content realm can survive render
  // inspection and ordinary deactivation, so leaving either cache intact here
  // makes a later same-document activation reuse a historical outcome while
  // the reveal controller rejects the replacement walk as already completed.
  completedPageVisitRitual = null;
  pendingPageVisitRitual = null;
  revealController.resetForPresentationLeaseLoss();
  renderInspectionAdoptionGeneration += 1;
  pendingRenderInspectionAdoptionGeneration = null;
  provisionalBfcacheRenderInspectionFence = false;
  shieldPostureMutationGeneration += 1;
  interactionShieldAuthorityActive = false;
  silentInteractionShieldActive = false;
  durablePostureShieldActive = false;
  durableSilentAdoptionGeneration += 1;
  pendingNavigationBoundary = null;
  currentShieldPosture = { status: "inactive", revision: 0 };
  renderInspectionCurtain?.terminate();
  disposeTerminalContentSurfaces();
  if (options.failOpenCleanupFence) {
    // The extension realm is about to disappear, so it cannot own a durable DOM
    // shield or retry loop. DESTROY was already posted best-effort above; remove
    // local layers synchronously rather than orphaning a blocking element.
    failOpenPageWorldCleanupFenceLocally();
  }
  disposeInteractionShield();
}

function resumeInteractionShieldAuthority(): void {
  interactionShieldAuthorityActive = true;
}

function releaseDurablePostureLocally(): void {
  durablePostureShieldActive = false;
  durableSilentAdoptionGeneration += 1;
}

function shieldMutationFence() {
  if (!currentShieldPosture.scope) {
    return null;
  }
  return {
    ...currentShieldPosture.scope,
    revision: currentShieldPosture.revision,
  };
}

function currentShieldPropertyKey(): string | null {
  const scope = currentShieldPosture.scope;
  return scope
    ? `${scope.environmentKey}\u0000${scope.siteId}\u0000${scope.baseUrl}`
    : null;
}

function setCurrentShieldPosture(posture: ShieldPostureProjection): void {
  currentShieldPosture = posture;
  durablePostureShieldActive = posture.status === "active";
  syncInteractionShield();
}

function enqueueShieldPostureOperation(
  operation: (stillCurrent: () => boolean) => Promise<void>,
): void {
  const generation = shieldPostureMutationGeneration;
  const run = (): Promise<void> => operation(
    () => generation === shieldPostureMutationGeneration,
  );
  const queued = shieldPostureQueue.then(run, run);
  shieldPostureQueue = queued.catch(() => undefined);
}

async function refreshCurrentShieldPosture(
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  const pageUrl = currentPageUrl();
  if (!pageUrl) {
    return false;
  }
  const response = await getContentBus().request(
    "shield.posture.current",
    { pageUrl },
    { target: "background" },
  );
  if (!response.ok || response.data.status === "unavailable" || !stillCurrent()) {
    return false;
  }
  setCurrentShieldPosture(response.data);
  return true;
}

function persistShieldPosture(posture: ShieldPostureUpdate): void {
  const routeGeneration = documentLifecycleGeneration;
  const pageUrl = currentPageUrl();
  const documentScoped = posture.kind !== "silent-selectors";
  let propertyKey = currentShieldPropertyKey();
  enqueueShieldPostureOperation(async (queueStillCurrent) => {
    const stillCurrent = (): boolean => {
      if (!queueStillCurrent()) {
        return false;
      }
      if (
        (documentScoped || propertyKey === null) &&
        (
          routeGeneration !== documentLifecycleGeneration ||
          pageUrl !== currentPageUrl()
        )
      ) {
        return false;
      }
      return propertyKey === null || currentShieldPropertyKey() === propertyKey;
    };
    const adoptRefreshedProperty = (): void => {
      propertyKey ??= currentShieldPropertyKey();
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!stillCurrent()) {
        return;
      }
      const expected = shieldMutationFence();
      if (!expected) {
        if (attempt === 0 && await refreshCurrentShieldPosture(stillCurrent)) {
          adoptRefreshedProperty();
          continue;
        }
        return;
      }
      const response = await getContentBus().request(
        "shield.posture.set",
        { expected, posture },
        { target: "background" },
      );
      if (!stillCurrent()) {
        return;
      }
      if (response.ok && response.data.status === "ok") {
        setCurrentShieldPosture(response.data.posture);
        return;
      }
      if (
        attempt === 0 &&
        response.ok &&
        (response.data.status === "stale" || response.data.status === "unbound") &&
        await refreshCurrentShieldPosture(stillCurrent)
      ) {
        adoptRefreshedProperty();
        continue;
      }
      return;
    }
  });
}

function clearPersistedShieldPosture(reason: ShieldPostureClearReason): void {
  const routeGeneration = documentLifecycleGeneration;
  const pageUrl = currentPageUrl();
  const documentScoped = reason !== "silent-cleared";
  let propertyKey = currentShieldPropertyKey();
  enqueueShieldPostureOperation(async (queueStillCurrent) => {
    const stillCurrent = (): boolean => {
      if (!queueStillCurrent()) {
        return false;
      }
      if (
        (documentScoped || propertyKey === null) &&
        (
          routeGeneration !== documentLifecycleGeneration ||
          pageUrl !== currentPageUrl()
        )
      ) {
        return false;
      }
      return propertyKey === null || currentShieldPropertyKey() === propertyKey;
    };
    const adoptRefreshedProperty = (): void => {
      propertyKey ??= currentShieldPropertyKey();
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!stillCurrent()) {
        return;
      }
      const expected = shieldMutationFence();
      if (!expected) {
        if (attempt === 0 && await refreshCurrentShieldPosture(stillCurrent)) {
          adoptRefreshedProperty();
          continue;
        }
        return;
      }
      const response = await getContentBus().request(
        "shield.posture.clear",
        { expected, reason },
        { target: "background" },
      );
      if (!stillCurrent()) {
        return;
      }
      if (response.ok && response.data.status === "ok") {
        setCurrentShieldPosture(response.data.posture);
        return;
      }
      if (
        attempt === 0 &&
        response.ok &&
        (response.data.status === "stale" || response.data.status === "unbound") &&
        await refreshCurrentShieldPosture(stillCurrent)
      ) {
        adoptRefreshedProperty();
        continue;
      }
      return;
    }
  });
}

function requestTerminalShieldClear(reason: ShieldPostureClearReason): void {
  shieldPostureMutationGeneration += 1;
  const pageUrl = currentPageUrl();
  const run = async (): Promise<void> => {
    if (!pageUrl) {
      return;
    }
    // A document-start bind may still be advancing the durable revision while a
    // terminal event fires. Let that bind settle, then re-read/retry so terminal
    // cleanup cannot lose to a stale fence and leave a reload-adoptable posture.
    await pageContextBindQueue.catch(() => undefined);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await getContentBus().request(
        "shield.posture.current",
        { pageUrl },
        { target: "background" },
      );
      if (!current.ok || current.data.status === "unavailable" || !current.data.scope) {
        return;
      }
      const cleared = await getContentBus().request(
        "shield.posture.clear",
        {
          expected: { ...current.data.scope, revision: current.data.revision },
          reason,
        },
        { target: "background" },
      );
      if (!cleared.ok || cleared.data.status === "ok") {
        return;
      }
      if (cleared.data.status !== "stale" && cleared.data.status !== "unbound") {
        return;
      }
    }
  };
  const queued = shieldPostureQueue.then(run, run);
  shieldPostureQueue = queued.catch(() => undefined);
}

function scheduleDurableSilentAdoption(selectors: SelectorSet): void {
  durableSilentAdoptionGeneration += 1;
  const generation = durableSilentAdoptionGeneration;
  const adopt = (): void => {
    if (
      generation !== durableSilentAdoptionGeneration ||
      currentShieldPosture.status !== "active" ||
      markingActive
    ) {
      return;
    }
    applySilentSelectors({ selectors }, { persist: false });
  };
  if (typeof document === "undefined") {
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", adopt, { once: true });
    return;
  }
  queueMicrotask(adopt);
}

function adoptShieldPosture(posture: ShieldPostureProjection): void {
  durableSilentAdoptionGeneration += 1;
  setCurrentShieldPosture(posture);
  if (posture.status !== "active") {
    if (!markingActive && silentInteractionShieldActive) {
      clearSilentSelectors({ persist: false });
    }
    return;
  }
  if (posture.directive.silentSelectors) {
    scheduleDurableSilentAdoption(posture.directive.silentSelectors);
  }
}

function documentShieldPostureForState(): ShieldPostureUpdate | null {
  if (contentState.name === "silent_preview") {
    return { kind: "preview", origin: "silent" };
  }
  if (contentState.name === "preview_open") {
    return { kind: "preview", origin: "post_ai" };
  }
  if (
    contentState.name === "running" ||
    contentState.name === "exit_restoring" ||
    contentState.name === "inspecting" ||
    contentState.name === "reconciling"
  ) {
    return {
      kind: "blocked-organ",
      organState: contentState.name,
      blockedReason: contentPresentation.blockedReason || contentState.reconciliationReason || contentState.name,
    };
  }
  return null;
}

function stateHasDocumentShieldPosture(state: ContentState["name"]): boolean {
  return state === "silent_preview" || state === "preview_open" || state === "running" ||
    state === "exit_restoring" || state === "inspecting" || state === "reconciling";
}

function persistDocumentShieldPosture(signal: BrainSignal, previousState: ContentState["name"]): void {
  const posture = documentShieldPostureForState();
  if (posture) {
    persistShieldPosture(posture);
    return;
  }
  if (!stateHasDocumentShieldPosture(previousState)) {
    return;
  }
  const reason: ShieldPostureClearReason = signal.name === "session.navigated"
    ? "navigation"
    : signal.name === "session.saved"
      ? "save"
      : signal.name === "session.discarded"
        ? "discard"
    : signal.name === "run.failed"
      ? "failure"
      : "cancel";
  clearPersistedShieldPosture(reason);
}

function ensureContentSurfaceRoot(): HTMLElement | null {
  if (
    typeof document === "undefined"
    || !document.documentElement
    || typeof document.createElement !== "function"
  ) {
    return null;
  }
  if (contentSurfaceRoot?.isConnected) {
    return contentSurfaceRoot;
  }
  ensureContentSurfaceStyles();
  contentSurfaceRoot = document.createElement("div");
  contentSurfaceRoot.setAttribute("data-uf-extension-ui", "true");
  contentSurfaceRoot.setAttribute("data-uf-content-surface-root", "true");
  contentSurfaceRoot.style.position = "fixed";
  contentSurfaceRoot.style.inset = "0";
  contentSurfaceRoot.style.pointerEvents = "none";
  contentSurfaceRoot.style.zIndex = MAXIMUM_DOCUMENT_Z_INDEX;
  document.documentElement.appendChild(contentSurfaceRoot);
  lastContentSurfaceSignature = "";
  interactionShield?.refresh();
  return contentSurfaceRoot;
}

function renderContentSurface(): void {
  if (!interactionShieldAuthorityActive) {
    contentSurfaceRoot?.remove();
    contentSurfaceRoot = null;
    contentSurfaceInputBoundaryActive = false;
    contentSurfacePrivilegedTargets.clear();
    lastContentSurfaceSignature = "";
    return;
  }
  const blockedReason = contentPresentation.blockedReason;
  const dictatedCurtain = contentPresentation.curtain;
  const curtain = dictatedCurtain.visible
    ? dictatedCurtain
    : pageInspectionActive
    ? { visible: true, text: "Inspecting page... it will be ready soon" }
    : dictatedCurtain;
  const banner = contentAuthority.banner;
  const motionPaused = freezeController.isPaused();
  const pausedNotice = markingActive && (contentPresentation.markingEditsBlocked || markingInteractionsPaused)
    ? pausedNoticeCopy(contentPresentation.blockedReason || "paused")
    : "";
  const effectiveBlockedReason = blockedReason || (pageInspectionActive ? "page-inspection" : "");
  const pageInputBlocked = shouldBlockPageInput(contentPresentation, silentInteractionShieldActive);
  const contentToast = contentToasts.current();
  const signature = JSON.stringify({ effectiveBlockedReason, curtain, banner, motionPaused, pausedNotice, contentToast, pageInputBlocked });
  const root = ensureContentSurfaceRoot();
  if (!root) {
    return;
  }
  root.style.pointerEvents = curtain.visible ? "auto" : "none";
  contentSurfaceInputBoundaryActive = curtain.visible;
  syncInteractionShield();
  if (
    !interactionShield?.isActive() &&
    document.documentElement.lastElementChild !== root
  ) {
    // The marking plane uses the maximum document z-index and is commonly
    // mounted after this retained surface root. Equal-z siblings are ordered by
    // DOM position, so move the pointer-transparent root above marking whenever
    // it reprojects. Only its explicitly interactive descendants receive hits;
    // empty points continue through to the marking layer below.
    document.documentElement.appendChild(root);
  }
  if (signature === lastContentSurfaceSignature) {
    return;
  }
  lastContentSurfaceSignature = signature;
  contentLockConfirmation?.unregister();
  contentLockConfirmation = null;
  contentSurfacePrivilegedTargets.clear();
  root.replaceChildren();
  if (curtain.visible) {
    const curtainElement = document.createElement("section");
    curtainElement.setAttribute("role", "status");
    curtainElement.setAttribute("aria-live", "assertive");
    curtainElement.setAttribute("data-uf-content-curtain", "true");
    const card = document.createElement("div");
    card.setAttribute("data-uf-content-curtain-card", "true");
    const spinner = document.createElement("span");
    spinner.setAttribute("aria-hidden", "true");
    spinner.setAttribute("data-uf-content-curtain-spinner", "true");
    const copy = document.createElement("span");
    copy.setAttribute("data-uf-content-curtain-copy", "true");
    copy.textContent = curtain.text || effectiveBlockedReason;
    card.appendChild(spinner);
    card.appendChild(copy);
    curtainElement.appendChild(card);
    root.appendChild(curtainElement);
  }
  if (banner.visible) {
    const bannerElement = document.createElement("aside");
    bannerElement.setAttribute("role", "status");
    bannerElement.setAttribute("aria-live", banner.reason === "disconnect-warning" ? "assertive" : "polite");
    bannerElement.setAttribute("data-uf-content-banner", "true");
    bannerElement.setAttribute("data-uf-lock-reason", banner.reason);
    bannerElement.setAttribute("data-uf-lock-role", contentAuthority.lockRole);
    if (typeof banner.countdownSeconds === "number") {
      bannerElement.setAttribute("data-uf-lock-countdown-seconds", String(banner.countdownSeconds));
    }
    const bannerCopy = document.createElement("span");
    bannerCopy.setAttribute("data-uf-content-banner-copy", "true");
    bannerCopy.textContent = banner.text;
    bannerElement.appendChild(bannerCopy);
    if (banner.actions?.length) {
      const actions = document.createElement("span");
      actions.setAttribute("data-uf-content-banner-actions", "true");
      for (const action of banner.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-uf-content-lock-action", "true");
        button.setAttribute("data-uf-lock-action-kind", action.kind);
        contentSurfacePrivilegedTargets.add(button);
        button.textContent = action.confirmDiscard
          ? `${CONTENT_LOCK_ACTION_LABEL[action.kind]} anyway`
          : CONTENT_LOCK_ACTION_LABEL[action.kind];
        button.addEventListener("click", (event) => {
          if (event.isTrusted === false) return;
          event.preventDefault();
          event.stopPropagation();
          if (action.confirmDiscard) {
            actions.replaceChildren();
            const prompt = document.createElement("span");
            prompt.setAttribute("role", "alert");
            prompt.setAttribute("data-uf-content-lock-confirmation", "discard");
            prompt.textContent = "Discard unsaved work in the current editor session?";
            const confirm = document.createElement("button");
            confirm.type = "button";
            confirm.setAttribute("data-uf-content-lock-confirm", "discard");
            contentSurfacePrivilegedTargets.add(confirm);
            confirm.textContent = "Discard and continue";
            confirm.addEventListener("click", (confirmEvent) => {
              if (confirmEvent.isTrusted === false) return;
              confirmEvent.preventDefault();
              confirmEvent.stopPropagation();
              contentLockConfirmation?.close("context-change");
              void getContentBus().request("lock.action", action, { target: "background" });
            });
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.setAttribute("data-uf-content-lock-confirm-cancel", "true");
            contentSurfacePrivilegedTargets.add(cancel);
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", (cancelEvent) => {
              if (cancelEvent.isTrusted === false) return;
              cancelEvent.preventDefault();
              cancelEvent.stopPropagation();
              contentLockConfirmation?.close("context-change");
            });
            actions.appendChild(prompt);
            actions.appendChild(confirm);
            actions.appendChild(cancel);
            contentLockConfirmation = ensureContentTransientSurfaces().manager.open({
              id: "content-lock-confirmation",
              kind: "confirmation",
              root: () => actions,
              outside: "ignore",
              escape: "dismiss",
              dismiss: () => {
                contentLockConfirmation = null;
                lastContentSurfaceSignature = "";
                renderContentSurface();
              },
            });
            return;
          }
          void getContentBus().request("lock.action", action, { target: "background" });
        });
        actions.appendChild(button);
      }
      bannerElement.appendChild(actions);
    }
    root.appendChild(bannerElement);
  }
  if (motionPaused) {
    const indicator = document.createElement("aside");
    indicator.setAttribute("data-uf-motion-pause-indicator", "true");
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-label", "Page motion paused");
    indicator.title = "Page motion paused";
    const snowflake = createContentSurfaceIcon(mdiSnowflake);
    const codeTags = createContentSurfaceIcon(mdiCodeBlockTags);
    indicator.appendChild(snowflake);
    indicator.appendChild(codeTags);
    root.appendChild(indicator);
  }
  if (pausedNotice) {
    const notice = document.createElement("aside");
    notice.setAttribute("data-uf-marking-paused-notice", "true");
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.textContent = pausedNotice;
    root.appendChild(notice);
  }
  if (contentToast) {
    const toast = document.createElement("aside");
    toast.setAttribute("data-uf-content-toast", "true");
    toast.setAttribute("data-uf-content-toast-tone", contentToast.tone);
    toast.setAttribute("data-uf-content-toast-id", String(contentToast.id));
    toast.setAttribute("role", contentToast.tone === "danger" ? "alert" : "status");
    toast.setAttribute("aria-live", contentToast.tone === "danger" ? "assertive" : "polite");
    const copy = document.createElement("span");
    copy.setAttribute("data-uf-content-toast-copy", "true");
    copy.textContent = contentToast.message;
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("data-uf-content-toast-close", "true");
    contentSurfacePrivilegedTargets.add(close);
    close.setAttribute("aria-label", "Close notification");
    close.title = "Close notification";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      if (event.isTrusted === false) return;
      event.preventDefault();
      event.stopPropagation();
      contentToasts.dismiss(contentToast.id);
    });
    toast.appendChild(copy);
    toast.appendChild(close);
    root.appendChild(toast);
  }
}

function terminateConsentSuppression(options: Readonly<{ terminal?: boolean }> = {}): number {
  return options.terminal === true
    ? consentLifecycle.terminate()
    : consentLifecycle.releaseProperty();
}

function resumeConsentSuppression(
  tabId: number,
  expectedLifecycleGeneration: number,
): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    // Command dispatch can race the document-start probe. Wait for that bind even
    // when consent is already active; otherwise an older inactive context response
    // can arrive after silent highlighting and erase its engine/posture.
    await pageContextBindQueue;
    if (expectedLifecycleGeneration !== contentLifecycleGeneration) {
      return false;
    }
    const resumed = await consentLifecycle.resume(
      tabId,
      () => expectedLifecycleGeneration === contentLifecycleGeneration,
    );
    if (resumed.status === "rejected") {
      return false;
    }
    if (resumed.reprobe) {
      pageContextProbedUrl = "";
      await establishPageContext();
    }
    return expectedLifecycleGeneration === contentLifecycleGeneration;
  };
  const queued = consentResumeQueue.then(run, run);
  consentResumeQueue = queued.catch(() => undefined);
  return queued;
}

function applyConsentPropertyAuthority(input: Readonly<{
  environmentKey: string | null;
  siteId: number;
  baseUrl: string | null;
}>): void {
  consentLifecycle.adoptProperty(input);
}

/** Re-adopts a persisted silent-page shield before the remote page-context/config
 *  round trip. The background accepts this only for the same-origin retained
 *  property with a local authoritative config and the exact replacement Chrome
 *  document, so mounting here is fail-closed rather than trusting page state. */
async function adoptRetainedShieldPosture(): Promise<void> {
  const pageUrl = currentPageUrl();
  if (!pageUrl) {
    return;
  }
  const lifecycleGeneration = contentLifecycleGeneration;
  const routeGeneration = documentLifecycleGeneration;
  let response;
  try {
    response = await getContentBus().request(
      "shield.posture.adoptRetained",
      { pageUrl },
      { target: "background" },
    );
  } catch {
    return;
  }
  if (
    !response.ok ||
    response.data.status !== "active" ||
    currentPageUrl() !== pageUrl ||
    lifecycleGeneration !== contentLifecycleGeneration ||
    routeGeneration !== documentLifecycleGeneration ||
    consentLifecycle.isTerminal()
  ) {
    return;
  }
  resumeInteractionShieldAuthority();
  adoptShieldPosture(response.data);
}

/** Asks the background what this page is, and acts on the answer. Runs at document
 *  start and once per page URL — waiting for a popup to open would be too late for
 *  both behaviours it gates.
 *
 *  Consent hiding is gated on ONE thing: this being a property page. Not the render
 *  mode, not candidacy. An operator browsing a property must never be able to
 *  dismiss a consent dialog by accident, because that records a decision which
 *  changes what every later load of that property looks like.
 *
 *  The reveal/freeze ritual is gated further, and on what the ritual is for: it
 *  prepares a page to be marked, so it needs a property whose render mode is
 *  established (marks under an unestablished one describe a page nobody has looked
 *  at) and a page the crawler actually wants. For a property with no render mode
 *  yet, the popup asks for the ritual once the operator sets one and leaves the
 *  inspection — there is nothing useful to prepare before that. */
async function resolvePageContext(options: Readonly<{ ritualRequiresCandidate?: boolean }> = {}): Promise<void> {
  const requireCandidate = options.ritualRequiresCandidate !== false;
  const pageUrl = currentPageUrl();
  if (!pageUrl || pageContextProbedUrl === pageUrl) {
    return;
  }
  pageContextProbedUrl = pageUrl;
  const lifecycleGeneration = contentLifecycleGeneration;
  const routeGeneration = documentLifecycleGeneration;
  let response;
  try {
    response = await getContentBus().request("page.context", { pageUrl }, { target: "background" });
  } catch {
    // A worker that is not up yet: let the next trigger re-probe.
    pageContextProbedUrl = "";
    return;
  }
  if (!response.ok) {
    pageContextProbedUrl = "";
    return;
  }
  if (currentPageUrl() !== pageUrl) {
    // Navigated while asking; the answer describes a page that is gone.
    return;
  }
  if (
    lifecycleGeneration !== contentLifecycleGeneration ||
    routeGeneration !== documentLifecycleGeneration ||
    consentLifecycle.isTerminal()
  ) {
    // Unregister/config removal/invalidation won while the background request
    // was in flight. A late managed answer must not revive DOM authority.
    return;
  }
  if (!response.data.consentSuppressionAllowed) {
    terminateConsentSuppression({ terminal: true });
    terminateInteractionShieldAuthority();
    return;
  }
  // A transient answer may carry the last valid canonical context for this exact
  // page. A null site id means there is no trustworthy property fact to act on.
  if (response.data.siteId === null) {
    const definitiveExit = response.data.status === "unmanaged" ||
      response.data.status === "environment_not_registered" ||
      response.data.draftDisposition === "terminate";
    if (definitiveExit) {
      if (consentLifecycle.hasAuthority()) {
        terminateConsentSuppression();
      }
      terminateInteractionShieldAuthority();
    } else if (response.data.shieldPosture.status === "active") {
      // A cold MV3 worker can recover a validated property-scoped silent lease
      // even when the fresh Hub request is transient and therefore has no siteId.
      resumeInteractionShieldAuthority();
      adoptShieldPosture(response.data.shieldPosture);
      renderContentSurface();
    } else if (!consentLifecycle.hasAuthority() && currentShieldPosture.status !== "active") {
      // No resolved property fact exists in this content lifetime. Preserve an
      // established local property on transient failures, but do not let a stale
      // popup command invent authority for a cold, unbound document.
      interactionShieldAuthorityActive = false;
    }
    // Authentication/access/unavailability are transient. If this document
    // already has property authority, its observer and hidden UI remain intact.
    return;
  }
  const nextConsentProperty = {
    environmentKey: response.data.environmentKey,
    siteId: response.data.siteId,
    baseUrl: response.data.baseUrl,
  };
  if (consentLifecycle.propertyRelation(nextConsentProperty) === "different") {
    terminateInteractionShieldAuthority();
  }
  resumeInteractionShieldAuthority();
  adoptShieldPosture(response.data.shieldPosture);
  applyConsentPropertyAuthority(nextConsentProperty);
  renderContentSurface();
  // The ritual prepares pages the crawler wants, so a stored marking record is what
  // picks them out — but only where the property HAS records. One with none has no
  // way to say which pages matter, and requiring a record of it would mean such a
  // property is never prepared on any load, which is the same trap as demanding one
  // the moment a render mode is first established.
  const hasPageRecords = response.data.pageTypes.some((pageType) => pageType.pages.length > 0);
  const preservedCandidate = response.data.pageKey !== null && response.data.pageTypes.some(
    (pageType) => pageType.pages.some((page) => page.pageKey === response.data.pageKey),
  );
  const candidate = response.data.status === "managed_candidate" || (
    (response.data.status === "authentication_required" ||
      response.data.status === "access_denied" ||
      response.data.status === "unavailable") &&
    preservedCandidate
  );
  const wanted = candidate || !hasPageRecords;
  const suspended = response.data.status === "suspended_candidate_removed" ||
    response.data.status === "suspended_candidate_feed_conflict";
  if (
    response.data.renderModeSet &&
    wanted &&
    !suspended &&
    // Inspection owns this document's scroll and may reload it again. Starting
    // the page-load ritual underneath that exact curtain creates a doomed
    // occurrence that a later real activation can accidentally join. The
    // terminal inspection path explicitly calls preparePageVisit instead.
    !inspectionOwnsScroll()
  ) {
    void runPageVisitRitual(pageUrl, requireCandidate ? "page-load" : "render-mode-established");
  }
}

function establishPageContext(
  options: Readonly<{ ritualRequiresCandidate?: boolean }> = {},
): Promise<void> {
  const run = (): Promise<void> => resolvePageContext(options);
  const queued = pageContextBindQueue.then(run, run);
  pageContextBindQueue = queued.catch(() => undefined);
  return queued;
}

/** THE REVEAL/FREEZE CONTRACT, ported from legacy (architect, 2026-07-03): one full
 *  ritual per page visit — scroll to top, walk to the true bottom with the
 *  lazyloader capped so at most one lazy expansion happens for the whole ritual,
 *  then freeze; the return scroll happens under the freeze.
 *
 *  Once and only once per page load is the whole point. The walk triggers every
 *  scroll-linked animation and lazy image on the way down, and a second walk over
 *  an already-revealed page would find nothing to reveal while costing the operator
 *  another full scroll of their page. */
/** Whether there is a document worth walking yet.
 *
 *  This gate is why the ritual appeared not to run at all on a page load. The probe
 *  that triggers it happens at document_start, where the document is still empty:
 *  scrollHeight is a viewport or less, so the walk finds no scroll room and skips —
 *  and the skip was being recorded as a completed ritual, which then blocked the
 *  real one for the rest of the visit.
 *
 *  An absent readyState means an environment that does not model loading at all, so
 *  there is nothing to wait for. */
function readyToWalk(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const state = document.readyState;
  return state === undefined || state === "complete";
}

function pageVisitRitualIdentity(pageUrl: string): PageVisitRitualIdentity {
  return {
    pageUrl: normalizedDocumentPageUrl(pageUrl),
    documentNonce: RENDER_INSPECTION_DOCUMENT_NONCE,
    lifecycleGeneration: contentLifecycleGeneration,
    routeGeneration: documentLifecycleGeneration,
  };
}

function samePageVisitRitualIdentity(
  left: PageVisitRitualIdentity,
  right: PageVisitRitualIdentity,
): boolean {
  return left.pageUrl === right.pageUrl &&
    left.documentNonce === right.documentNonce &&
    left.lifecycleGeneration === right.lifecycleGeneration &&
    left.routeGeneration === right.routeGeneration;
}

function pageVisitRitualIdentityIsCurrent(identity: PageVisitRitualIdentity): boolean {
  return samePageVisitRitualIdentity(identity, pageVisitRitualIdentity(currentPageUrl())) &&
    interactionShieldAuthorityActive;
}

function waitForPageWalkReadiness(identity: PageVisitRitualIdentity): Promise<boolean> {
  if (readyToWalk()) {
    return Promise.resolve(pageVisitRitualIdentityIsCurrent(identity));
  }
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("load", onReady);
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      resolve(pageVisitRitualIdentityIsCurrent(identity));
    };
    const onReady = (): void => finish();
    window.addEventListener("load", onReady, { once: true });
    // A page whose load event never fires — an aborted subresource is enough —
    // still gets one bounded exact-document attempt.
    timeout = setTimeout(finish, RITUAL_READY_TIMEOUT_MS);
  });
}

async function executePageVisitRitual(
  identity: PageVisitRitualIdentity,
  cause: string,
): Promise<PageVisitRitualOutcome> {
  const ready = await waitForPageWalkReadiness(identity);
  if (!ready || !pageVisitRitualIdentityIsCurrent(identity)) {
    return {
      ...identity,
      status: "stale",
      reason: "page-visit-identity-changed",
      lazyExpansions: 0,
      frozenAtBottom: false,
    };
  }
  const result = await runActivationStabilization(identity.pageUrl);
  if (!pageVisitRitualIdentityIsCurrent(identity)) {
    console.debug(`[Unfluffify][rewrite] Page-visit reveal/freeze skipped (${cause}) — identity changed`);
    return {
      ...identity,
      status: "stale",
      reason: "page-visit-identity-changed",
      lazyExpansions: result?.lazyExpansions ?? 0,
      frozenAtBottom: false,
    };
  }
  if (!result) {
    return {
      ...identity,
      status: "failed",
      reason: "page-visit-stabilization-failed",
      lazyExpansions: 0,
      frozenAtBottom: false,
    };
  }
  // A no-scroll page is intentionally reported as skipped by runReveal, but it
  // still freezes at its only position and is fully prepared.
  if (result.frozenAtBottom) {
    const outcome: PageVisitRitualOutcome = {
      ...identity,
      status: "prepared",
      reason: result.skipped ? "no-scroll-room" : "",
      lazyExpansions: result.lazyExpansions,
      frozenAtBottom: true,
    };
    completedPageVisitRitual = outcome;
    console.debug(`[Unfluffify][rewrite] Page-visit reveal/freeze prepared (${cause})`);
    return outcome;
  }
  console.debug(`[Unfluffify][rewrite] Page-visit reveal/freeze skipped (${cause}) — attempt kept`);
  const stabilizationReason = result.reason ?? "skipped";
  return {
    ...identity,
    status: "failed",
    reason: `page-visit-stabilization-${stabilizationReason}`,
    lazyExpansions: result.lazyExpansions,
    frozenAtBottom: false,
  };
}

/** Runs the ritual once for the exact current document and returns the shared
 * occurrence promise to every page-load, preparation, or activation caller. */
function runPageVisitRitual(pageUrl: string, cause: string): Promise<PageVisitRitualOutcome> {
  const identity = pageVisitRitualIdentity(pageUrl);
  const matchingPreparedRitual = completedPageVisitRitual?.status === "prepared" &&
    samePageVisitRitualIdentity(completedPageVisitRitual, identity)
    ? completedPageVisitRitual
    : null;
  if (
    matchingPreparedRitual &&
    // "Prepared" describes a live presentation lease, not a historical walk.
    // Terminal deactivation destroys the page-world session and lifts the
    // freeze while retaining this content realm. Reusing the old outcome after
    // that point would acknowledge a reactivation with motion/lazy loading
    // already released.
    pageWorldSessionNonce !== "" &&
    freezeController.isPaused()
  ) {
    return Promise.resolve(matchingPreparedRitual);
  }
  if (matchingPreparedRitual) {
    // The page-load ritual completed, but a later render inspection or terminal
    // deactivation released its freeze/page-world lease. The higher-level
    // outcome already refuses to reuse that stale posture; also reopen the
    // reveal controller's completion fence so this same-document reactivation
    // can establish a replacement lease.
    completedPageVisitRitual = null;
    revealController.resetForPresentationLeaseLoss();
  }
  if (pendingPageVisitRitual && samePageVisitRitualIdentity(pendingPageVisitRitual.identity, identity)) {
    return pendingPageVisitRitual.promise;
  }
  const promise = executePageVisitRitual(identity, cause);
  pendingPageVisitRitual = { identity, promise };
  void promise.then(
    () => {
      if (pendingPageVisitRitual?.promise === promise) {
        pendingPageVisitRitual = null;
      }
    },
    () => {
      if (pendingPageVisitRitual?.promise === promise) {
        pendingPageVisitRitual = null;
      }
    },
  );
  return promise;
}

function applyContentLockState(payload: unknown): Record<string, unknown> {
  const parsed = ContentLockStateSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-lock-state", tree: "rewrite" };
  }
  if (consentLifecycle.isTerminal()) {
    return { ok: false, reason: "property-authority-unavailable", tree: "rewrite" };
  }
  contentAuthority = authorityFromLockState(parsed.data);
  void establishPageContext();
  if (!interactionShieldAuthorityActive) {
    return { ok: true, state: contentAuthority, tree: "rewrite" };
  }
  reconcileMarkingInteractionAvailability();
  renderContentSurface();
  void pullContentSignals().catch(() => undefined);
  return { ok: true, state: contentAuthority, tree: "rewrite" };
}

function ensureMarkingListeners(): void {
  if (
    contentAuthority.lockBlocked ||
    contentPresentation.markingEditsBlocked ||
    markingInteractionsPaused ||
    removeMarkingListeners ||
    typeof document === "undefined"
  ) {
    return;
  }
  let lastPointer: Readonly<{
    x: number;
    y: number;
    altKey: boolean;
    shiftKey: boolean;
    overlayXpath: string;
    eventTarget: EventTarget | null;
  }> | null = null;
  let hoverFrame = 0;
  let shiftHeld = false;
  let physicalSequence = 0;
  let lastPointerDown: Readonly<{
    id: number;
    x: number;
    y: number;
    button: number;
    at: number;
  }> | null = null;
  let closeMarkingMenu: (() => void) | null = null;
  type ResolvedMarkingTarget = NonNullable<
    ReturnType<NonNullable<typeof markingEngine>["resolveAtPoint"]>
  >;
  type PendingMarkingMutation = Readonly<{
    physicalId: number;
    target: ResolvedMarkingTarget;
    mode: "include" | "exclude" | "clear";
    x: number;
    y: number;
  }>;
  let markingMutationActive = false;
  let markingMutationFrame = 0;
  let markingMutationTask: ReturnType<typeof setTimeout> | null = null;
  let trailingMarkingMutation: PendingMarkingMutation | null = null;
  const deduper = createPhysicalActionDeduper();
  const reportMarkingGestureStage = (
    stage: "resolved" | "queued" | "acknowledged" | "rejected" | "applied",
    detail: Readonly<Record<string, unknown>>,
  ): void => {
    if (typeof __UF_DEBUG_BUILD__ === "undefined" || !__UF_DEBUG_BUILD__) {
      return;
    }
    console.debug("[Unfluffify][marking-gesture]", JSON.stringify({ stage, ...detail }));
  };
  const isTrustedMarkingInput = (event: Event): boolean => event.isTrusted !== false;
  const overlayXpathFromTarget = (target: EventTarget | null): string => {
    const candidate = target as (Element & {
      closest?: (selector: string) => Element | null;
    }) | null;
    const overlay = candidate?.closest?.("[data-uf-overlay-xpath]");
    if (!overlay?.closest?.(".uf-marking-layer-root")) {
      return "";
    }
    return overlay.getAttribute("data-uf-overlay-xpath") ?? "";
  };
  const resolveAtPoint = (
    x: number,
    y: number,
    mode: "include" | "exclude",
    shiftActive: boolean,
    overlayXpath: string,
  ) => overlayXpath
    ? markingEngine?.resolveAtPoint(x, y, mode, shiftActive, { overlayXpath }) ?? null
    : markingEngine?.resolveAtPoint(x, y, mode, shiftActive) ?? null;
  const physicalIdFor = (event: MouseEvent): number => {
    const down = lastPointerDown;
    if (
      down &&
      down.button === event.button &&
      Math.abs(down.x - event.clientX) <= 2 &&
      Math.abs(down.y - event.clientY) <= 2 &&
      Math.abs(down.at - event.timeStamp) <= 1_000
    ) {
      return down.id;
    }
    physicalSequence += 1;
    return physicalSequence;
  };
  const commit = (
    physicalId: number,
    target: ResolvedMarkingTarget,
    mode: "include" | "exclude" | "clear",
    x: number,
    y: number,
  ): void => {
    if (!markingEngine || !deduper.accept(physicalId, target.xpath, mode)) {
      return;
    }
    const mutation: PendingMarkingMutation = { physicalId, target, mode, x, y };
    reportMarkingGestureStage("queued", {
      physicalId,
      mode,
      targetKey: target.key,
      targetXpath: target.xpath,
    });
    const scheduleMutation = (next: PendingMarkingMutation): void => {
      const owner = markingEngine;
      if (!owner) {
        return;
      }
      const applyMutation = (): void => {
        if (!markingActive || markingEngine !== owner) {
          return;
        }
        const changed = next.mode === "clear"
          ? owner.clear?.(next.target) ?? false
          : owner.toggle(next.target, next.mode);
        reportMarkingGestureStage(changed === false ? "rejected" : "applied", {
          boundary: "mutation",
          physicalId: next.physicalId,
          mode: next.mode,
          targetKey: next.target.key,
          targetXpath: next.target.xpath,
        });
        if (changed === false) {
          owner.rejectAtPoint?.(next.x, next.y);
          return;
        }
        userToggleCount += 1;
        markingToggleSeq += 1;
        reportMarkingToggle();
      };
      const finish = (): void => {
        markingMutationActive = false;
        markingMutationTask = null;
        const trailing = trailingMarkingMutation;
        trailingMarkingMutation = null;
        if (trailing) {
          markingMutationActive = true;
          scheduleMutation(trailing);
        }
      };
      // Test doubles and older injected engines have no split acknowledgement.
      // Preserve their synchronous seam; production always takes the painted
      // acknowledgement path below.
      if (typeof owner.acknowledge !== "function") {
        try {
          applyMutation();
        } finally {
          finish();
        }
        return;
      }
      const acknowledge = (): void => {
        markingMutationFrame = 0;
        const activeOwner = markingActive && markingEngine === owner;
        const acknowledged = activeOwner && Boolean(owner.acknowledge?.(next.target, next.mode));
        reportMarkingGestureStage(acknowledged ? "acknowledged" : "rejected", {
          boundary: "paint",
          physicalId: next.physicalId,
          mode: next.mode,
          targetKey: next.target.key,
          targetXpath: next.target.xpath,
          activeOwner,
        });
        if (!acknowledged) {
          finish();
          return;
        }
        // A task posted from a presentation frame runs after that frame has had
        // an opportunity to paint. Canonical evaluation can then be expensive
        // without delaying the physical gesture acknowledgement.
        markingMutationTask = setTimeout(() => {
          try {
            applyMutation();
          } finally {
            finish();
          }
        }, 0);
      };
      markingMutationFrame = contentPresentationClock.requestFrame(acknowledge);
    };
    if (markingMutationActive) {
      // Coalesce physical repeats but never drop the most recent distinct,
      // already-resolved valid gesture.
      trailingMarkingMutation = mutation;
      return;
    }
    markingMutationActive = true;
    scheduleMutation(mutation);
  };
  const runHover = (): void => {
    hoverFrame = 0;
    const pointer = lastPointer;
    if (!markingActive || !markingEngine || !pointer) {
      return;
    }
    const mode = spacePassthroughActive
      ? "passthrough"
      : pointer.altKey
        ? "include"
        : "exclude";
    if (pointer.overlayXpath) {
      markingEngine.hoverAtPoint(
        pointer.x,
        pointer.y,
        mode,
        pointer.shiftKey,
        { overlayXpath: pointer.overlayXpath },
      );
    } else {
      markingEngine.hoverAtPoint(pointer.x, pointer.y, mode, pointer.shiftKey);
    }
  };
  const scheduleHover = (leading = false): void => {
    if (!lastPointer || typeof window === "undefined") {
      return;
    }
    if (leading) {
      if (hoverFrame) {
        contentPresentationClock.cancelFrame(hoverFrame);
        hoverFrame = 0;
      }
      // Paint a newly entered target or modifier mode in the physical input
      // task. Subsequent movement inside the same semantic boundary remains
      // frame-coalesced, retaining bounded work without a one-frame first-use
      // penalty.
      runHover();
      return;
    }
    if (hoverFrame) return;
    hoverFrame = contentPresentationClock.requestFrame(runHover);
  };
  const handleClick = (event: MouseEvent): void => {
    if (!isTrustedMarkingInput(event)) {
      return;
    }
    if (!markingActive || !markingEngine) {
      return;
    }
    const eventTarget = event.target as Element | null;
    if (
      eventTarget?.closest?.('[data-uf-extension-ui="true"]') &&
      !eventTarget.closest?.(".uf-marking-layer-root")
    ) {
      return;
    }
    closeMarkingMenu?.();
    closeMarkingMenu = null;
    altIncludeActive = event.altKey;
    syncMarkingCursor();
    const mode = markModeForClick(event);
    if (mode === "passthrough") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = resolveAtPoint(
      event.clientX,
      event.clientY,
      mode,
      event.shiftKey,
      overlayXpathFromTarget(event.target),
    );
    reportMarkingGestureStage("resolved", {
      mode,
      shiftActive: event.shiftKey,
      targetKey: target?.key ?? null,
      targetXpath: target?.xpath ?? null,
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
    });
    if (!target) {
      // Plain exclude mode is intentionally an unmark-only gesture. A miss on
      // an already-included area is a valid no-op; Shift is required to create
      // or widen an exclusion, so do not flash an error for ordinary browsing.
      if (mode === "exclude" && !event.shiftKey) {
        return;
      }
      markingEngine.rejectAtPoint?.(event.clientX, event.clientY);
      const debugDetail = typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__
        ? ` (${Math.round(event.clientX)}, ${Math.round(event.clientY)})`
        : "";
      contentToasts.show({
        message: `That area can't be marked${debugDetail}.`,
        tone: "warning",
      });
      return;
    }
    const mutationMode = mode === "exclude" && !event.shiftKey && markingEngine.hasExplicitMark?.(target)
      ? "clear"
      : mode;
    commit(physicalIdFor(event), target, mutationMode, event.clientX, event.clientY);
  };
  const handlePointerDown = (event: PointerEvent): void => {
    if (!isTrustedMarkingInput(event)) {
      return;
    }
    physicalSequence += 1;
    lastPointerDown = {
      id: physicalSequence,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      at: event.timeStamp,
    };
  };
  const handleContextMenu = (event: MouseEvent): void => {
    if (!isTrustedMarkingInput(event)) {
      return;
    }
    if (!markingActive || !markingEngine || spacePassthroughActive) {
      return;
    }
    const eventTarget = event.target as Element | null;
    if (
      eventTarget?.closest?.('[data-uf-extension-ui="true"]') &&
      !eventTarget.closest?.(".uf-marking-layer-root")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeMarkingMenu?.();
    const physicalId = physicalIdFor(event);
    const overlayXpath = overlayXpathFromTarget(event.target);
    const contextTargets = markingEngine.resolveContextAtPoint?.(
      event.clientX,
      event.clientY,
      overlayXpath ? { overlayXpath } : undefined,
    );
    // Retain the old injected-engine seam for unit fixtures. Production owns
    // the atomic path above and never independently re-hits the moving page.
    const include = contextTargets
      ? contextTargets.include
      : resolveAtPoint(event.clientX, event.clientY, "include", false, overlayXpath);
    const existingExclude = contextTargets
      ? contextTargets.existingExclude
      : resolveAtPoint(event.clientX, event.clientY, "exclude", false, overlayXpath);
    const shiftedExclude = contextTargets
      ? contextTargets.shiftedExclude
      : resolveAtPoint(event.clientX, event.clientY, "exclude", true, overlayXpath);
    const clearTarget = existingExclude ?? include;
    if (!include && !existingExclude && !shiftedExclude) {
      markingEngine.rejectAtPoint?.(event.clientX, event.clientY);
      contentToasts.show({ message: "That area can't be marked.", tone: "warning" });
      return;
    }
    closeMarkingMenu = openMarkingContextMenu({
      document,
      manager: ensureContentTransientSurfaces().manager,
      x: event.clientX,
      y: event.clientY,
      actions: [
        {
          id: "include",
          label: "Include",
          enabled: Boolean(include),
          run: () => include && commit(physicalId, include, "include", event.clientX, event.clientY),
        },
        {
          id: "exclude",
          label: "Exclude",
          enabled: Boolean(!existingExclude && shiftedExclude),
          run: () => shiftedExclude && commit(
            physicalId,
            shiftedExclude,
            "exclude",
            event.clientX,
            event.clientY,
          ),
        },
        {
          id: "widen",
          label: "Widen exclusion",
          enabled: Boolean(existingExclude && shiftedExclude && shiftedExclude.xpath !== existingExclude.xpath),
          run: () => shiftedExclude && commit(
            physicalId,
            shiftedExclude,
            "exclude",
            event.clientX,
            event.clientY,
          ),
        },
        {
          id: "clear",
          label: "Clear mark",
          enabled: Boolean(clearTarget && markingEngine?.hasExplicitMark?.(clearTarget)),
          run: () => clearTarget && commit(
            physicalId,
            clearTarget,
            "clear",
            event.clientX,
            event.clientY,
          ),
        },
      ],
    });
  };
  const handleMouseMove = (event: MouseEvent): void => {
    if (!isTrustedMarkingInput(event)) {
      return;
    }
    if (!markingActive || !markingEngine) {
      return;
    }
    if (altIncludeActive !== event.altKey) {
      altIncludeActive = event.altKey;
      syncMarkingCursor();
    }
    shiftHeld = event.shiftKey;
    const overlayXpath = overlayXpathFromTarget(event.target);
    const eventTarget = event.target ?? null;
    const nextPointer = {
      x: event.clientX,
      y: event.clientY,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      overlayXpath,
      eventTarget,
    };
    const leading = markingHoverNeedsLeadingPaint(lastPointer, nextPointer);
    lastPointer = nextPointer;
    scheduleHover(leading);
  };
  const handleMouseLeave = (event: MouseEvent): void => {
    if (!isTrustedMarkingInput(event)) {
      return;
    }
    lastPointer = null;
    markingEngine?.clearHover();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isTrustedMarkingInput(event)) {
      return;
    }
    setAltInclude(event, true);
    setSpacePassthrough(event, true);
    if (event.key === "Shift") {
      shiftHeld = true;
    }
    if (lastPointer) {
      const leading = lastPointer.altKey !== altIncludeActive ||
        lastPointer.shiftKey !== shiftHeld;
      lastPointer = { ...lastPointer, altKey: altIncludeActive, shiftKey: shiftHeld };
      scheduleHover(leading);
    }
  };
  const handleKeyUp = (event: KeyboardEvent): void => {
    if (!isTrustedMarkingInput(event)) {
      return;
    }
    setAltInclude(event, false);
    setSpacePassthrough(event, false);
    if (event.key === "Shift") {
      shiftHeld = false;
    }
    if (lastPointer) {
      const leading = lastPointer.altKey !== altIncludeActive ||
        lastPointer.shiftKey !== shiftHeld;
      lastPointer = { ...lastPointer, altKey: altIncludeActive, shiftKey: shiftHeld };
      scheduleHover(leading);
    }
  };
  const resetModifiers = (event?: Event): void => {
    if (event && !isTrustedMarkingInput(event)) {
      return;
    }
    if (spacePassthroughWatchdog !== null) {
      clearTimeout(spacePassthroughWatchdog);
      spacePassthroughWatchdog = null;
    }
    const refreshNeeded = spacePassthroughActive;
    spacePassthroughActive = false;
    altIncludeActive = false;
    shiftHeld = false;
    if (lastPointer) {
      lastPointer = { ...lastPointer, altKey: false, shiftKey: false };
    }
    syncMarkingCursor();
    if (refreshNeeded) {
      markingEngine?.setPassthrough?.(false);
    }
  };
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("mouseleave", handleMouseLeave, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);
  if (typeof window !== "undefined") {
    window.addEventListener("blur", resetModifiers);
  }
  document.addEventListener("visibilitychange", resetModifiers, true);
  syncMarkingCursor();
  removeMarkingListeners = () => {
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("contextmenu", handleContextMenu, true);
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("mouseleave", handleMouseLeave, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keyup", handleKeyUp, true);
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", resetModifiers);
    }
    document.removeEventListener("visibilitychange", resetModifiers, true);
    if (hoverFrame && typeof window !== "undefined") {
      contentPresentationClock.cancelFrame(hoverFrame);
      hoverFrame = 0;
    }
    if (markingMutationFrame) {
      contentPresentationClock.cancelFrame(markingMutationFrame);
      markingMutationFrame = 0;
    }
    if (markingMutationTask !== null) {
      clearTimeout(markingMutationTask);
      markingMutationTask = null;
    }
    markingMutationActive = false;
    trailingMarkingMutation = null;
    lastPointer = null;
    lastPointerDown = null;
    closeMarkingMenu?.();
    closeMarkingMenu = null;
    removeMarkingListeners = null;
    if (spacePassthroughWatchdog !== null) {
      clearTimeout(spacePassthroughWatchdog);
      spacePassthroughWatchdog = null;
    }
    spacePassthroughActive = false;
    markingEngine?.setPassthrough?.(false);
    altIncludeActive = false;
    syncMarkingCursor();
  };
}

type MarkingInteractionAvailability = Readonly<{
  ready: boolean;
  reason: string;
}>;

function currentMarkingInteractionAvailability(): MarkingInteractionAvailability {
  if (!markingActive) {
    return { ready: false, reason: "marking-inactive" };
  }
  if (!markingEngine) {
    return { ready: false, reason: "marking-engine-unavailable" };
  }
  if (contentAuthority.lockBlocked) {
    return { ready: false, reason: contentAuthority.blockedReason || "property-lock" };
  }
  if (contentPresentation.markingEditsBlocked) {
    return { ready: false, reason: contentPresentation.blockedReason || "session-blocked" };
  }
  if (markingInteractionPauseRequested) {
    return { ready: false, reason: "interaction-pause-requested" };
  }
  return { ready: true, reason: "" };
}

/** Single owner for the physical marking posture. Lock, organ and explicit
 * transport pauses only provide inputs; this reconciler installs/removes the
 * one listener set and makes the engine suspension match those inputs. */
function reconcileMarkingInteractionAvailability(): MarkingInteractionAvailability {
  const availability = currentMarkingInteractionAvailability();
  if (!availability.ready) {
    markingInteractionsPaused = markingActive;
    const previewVisible = contentState.name === "preview_open" || contentState.name === "silent_preview";
    markingEngine?.setSuspended?.(markingActive && !previewVisible);
    removeMarkingListeners?.();
    syncMarkingCursor();
    lastContentSurfaceSignature = "";
    return availability;
  }
  markingInteractionsPaused = false;
  markingEngine?.setSuspended?.(false);
  ensureMarkingListeners();
  syncMarkingCursor();
  lastContentSurfaceSignature = "";
  return {
    ready: removeMarkingListeners !== null,
    reason: removeMarkingListeners === null ? "marking-listeners-unavailable" : "",
  };
}

type MarkingDeactivationMode = "terminal" | "silent";

function deactivateMarking(mode: MarkingDeactivationMode = "terminal"): Promise<void> | null {
  let terminalTeardown: Promise<void> | null = null;
  markingActive = false;
  userToggleCount = 0;
  cleanMarkingFingerprint = null;
  selectorsSeeded = false;
  removeNavigationGate?.();
  markingInteractionsPaused = false;
  markingInteractionPauseRequested = false;
  if (mode === "terminal") {
    silentInteractionShieldActive = false;
    spaGuard.disarm();
    terminalTeardown = destroyPageWorldSession();
  } else {
    // Freeze before disposing the interactive engine. The selector-application
    // command arrives separately, so retaining this lease is what prevents a
    // visible click/hover gap between those two commands. Explicit clear,
    // reactivation, or terminal teardown owns its release.
    silentInteractionShieldActive = true;
    syncInteractionShield();
  }
  removeSilentDebugCopyListener?.();
  removeMarkingListeners?.();
  markingEngine?.setInputTransparent?.(false);
  markingEngine?.dispose();
  markingEngine = null;
  contentToasts.retire();
  syncMarkingCursor();
  lastContentSurfaceSignature = "";
  renderContentSurface();
  return terminalTeardown;
}

function pauseMarkingInteractions(): boolean {
  markingInteractionPauseRequested = true;
  const wasActive = markingActive;
  reconcileMarkingInteractionAvailability();
  renderContentSurface();
  return wasActive;
}

function resumeMarkingInteractions(): boolean {
  markingInteractionPauseRequested = false;
  const availability = reconcileMarkingInteractionAvailability();
  renderContentSurface();
  return availability.ready;
}

function handleUrlChanged(nextUrl?: string): void {
  const currentUrl = nextUrl || (typeof location !== "undefined" ? location.href : "");
  if (!currentUrl || currentUrl === lastKnownPageUrl) {
    return;
  }
  const previousUrl = lastKnownPageUrl;
  if (sameDocumentPageUrl(previousUrl, currentUrl)) {
    // Fragment-only History API/hash changes retain the exact document,
    // inspection generation, lock, freeze, and overlays. Keep the latest href
    // for diagnostics without manufacturing a navigation boundary or asking
    // Hub to classify a fragment as a different property page.
    lastKnownPageUrl = currentUrl;
    return;
  }
  contentTransientSurfaces?.closeAll("context-change");
  contentTransientSurfaces?.syncPreviewContext({ active: false, restoring: false });
  contentLockConfirmation = null;
  renderInspectionAdoptionGeneration += 1;
  pendingRenderInspectionAdoptionGeneration = null;
  provisionalBfcacheRenderInspectionFence = false;
  const activeInspection = renderInspectionCurtain?.current() ?? null;
  const activeInspectionIdentity = activeInspection
    ? renderInspectionIdentity(activeInspection)
    : null;
  if (activeInspection && activeInspectionIdentity) {
    void reportRenderInspectionFailure(activeInspection, "same-document-navigation");
    renderInspectionCurtain?.failOpenMatching(activeInspectionIdentity);
  }
  const shouldReportNavigation = markingActive ||
    interactionShieldAuthorityActive ||
    stateHasDocumentShieldPosture(contentState.name) ||
    durablePostureShieldActive ||
    silentInteractionShieldActive;
  lastKnownPageUrl = currentUrl;
  documentLifecycleGeneration += 1;
  const matchingNavigationAlreadyConsumed = lastConsumedNavigation !== null &&
    lastConsumedNavigation.fromUrl === previousUrl &&
    lastConsumedNavigation.toUrl === currentUrl &&
    lastConsumedNavigation.seq > lastHandledNavigationSeq;
  if (matchingNavigationAlreadyConsumed && lastConsumedNavigation) {
    // A navigation signal can beat the page-world URL watcher. Consume that
    // exact occurrence once; an identical B -> A edge later needs its own newer
    // boundary rather than reusing this historical transition.
    lastHandledNavigationSeq = lastConsumedNavigation.seq;
  }
  pendingNavigationBoundary = shouldReportNavigation && !matchingNavigationAlreadyConsumed
    ? { pageUrl: currentUrl, afterSeq: contentState.lastConsumedSeq }
    : null;
  spaGuard.onUrlChange(currentUrl);
  // Keep the current property observer alive while the new URL is being resolved.
  // This closes the gap in which a same-property SPA could mount clickable consent
  // chrome. establishPageContext ends it only on a definitive property exit.
  pageContextProbedUrl = "";
  completedPageVisitRitual = null;
  pendingPageVisitRitual = null;
  revealController.resetForNavigation();
  // A real path/query boundary invalidates the frozen document posture even
  // when the page-load ritual ran without an interactive marking engine.
  // DESTROY is acknowledged and retry-safe; fragment-only changes returned above.
  destroyPageWorldSession();
  // A toast describes an occurrence on the old URL. Retire it synchronously at
  // the boundary even when no marking engine happens to be mounted.
  contentToasts.retire();
  void establishPageContext();
  if (markingActive) {
    deactivateMarking();
  } else if (markingEngine) {
    // Preview projection can create an engine without a marking session. A
    // same-document URL edge must synchronously retire that old DOM bridge so
    // an immediate projection for the new URL cannot reuse pre-navigation
    // elements, row membership, or hover state.
    markingEngine.clearHover();
    markingEngine.setInputTransparent?.(false);
    markingEngine.dispose();
    markingEngine = null;
    removeSilentDebugCopyListener?.();
  }
  if (!shouldReportNavigation) {
    return;
  }
  void reportContentFact("content-url-change", {
    fromUrl: previousUrl,
    toUrl: currentUrl,
    pageUrl: currentUrl,
    markingEnabled: false,
  }).catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Unable to report content navigation", error);
  });
}

function installNavigationWatcher(): void {
  if (navigationWatcherInstalled || typeof window === "undefined") {
    return;
  }
  navigationWatcherInstalled = true;
  lastKnownPageUrl = typeof location !== "undefined" ? location.href : "";
  window.addEventListener("popstate", () => handleUrlChanged());
  window.addEventListener("hashchange", () => handleUrlChanged());
}

function resetMarking(): boolean {
  if (typeof document === "undefined" || !document.documentElement) {
    return false;
  }
  markingEngine?.setInputTransparent?.(false);
  markingEngine?.dispose();
  removeSilentDebugCopyListener?.();
  destroyPageWorldSession();
  markingEngine = createAuthoritativeMarkingEngine(document.documentElement, { render: true });
  userToggleCount = 0;
  cleanMarkingFingerprint = readMarkingDecisionFingerprint();
  selectorsSeeded = false;
  lastKnownPageUrl = typeof location !== "undefined" ? location.href : lastKnownPageUrl;
  silentInteractionShieldActive = false;
  releaseDurablePostureLocally();
  markingActive = true;
  markingInteractionPauseRequested = false;
  reconcileMarkingInteractionAvailability();
  lastContentSurfaceSignature = "";
  renderContentSurface();
  clearPersistedShieldPosture("silent-cleared");
  return true;
}

async function activateContentMain(payload: unknown): Promise<Record<string, unknown>> {
  const request = payloadObject(payload);
  const requestPageUrl = typeof request.pageUrl === "string" ? request.pageUrl : "";
  const pageUrl = currentPageUrl();
  if (requestPageUrl && pageUrl && requestPageUrl !== pageUrl) {
    return { ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" };
  }
  if (typeof document === "undefined" || !document.documentElement) {
    return {
      ok: false,
      initialized: false,
      interactionsReady: false,
      interactionsReason: "no-document",
      tree: "rewrite",
      reason: "no-document",
    };
  }
  const nextPageUrl = requestPageUrl || pageUrl;
  activation.arm(
    nextPageUrl,
    request.realEditorActivation !== false,
  );
  // Join the page-load occurrence when it already owns preparation. A successful
  // activation is not acknowledged while its curtain can still own pointer input.
  const ritual = await runPageVisitRitual(nextPageUrl, "marking-activation");
  if (
    ritual.status !== "prepared" ||
    !pageVisitRitualIdentityIsCurrent(ritual) ||
    pageInspectionActive
  ) {
    activation.disarm();
    return {
      ok: false,
      initialized: false,
      interactionsReady: false,
      interactionsReason: ritual.reason || "page-visit-not-prepared",
      ritual,
      tree: "rewrite",
      reason: ritual.reason || "page-visit-not-prepared",
    };
  }
  if (document.documentElement) {
    const startingCleanSession = !markingActive;
    removeSilentDebugCopyListener?.();
    lastKnownPageUrl = nextPageUrl || lastKnownPageUrl;
    if (!markingActive) {
      userToggleCount = 0;
    }
    // A clean session starts from the defaults with the AI selectors laid over
    // them. Only once, and only while the operator has not marked anything: after
    // this the selectors play no further part.
    const selectors = selectorSetFrom(request);
    const selectorsForInitialization = selectors && !selectorsSeeded && !isUserMarkingDirty()
      ? selectors
      : undefined;
    if (!markingEngine) {
      markingEngine = createAuthoritativeMarkingEngine(document.documentElement, {
        render: true,
        selectors: selectorsForInitialization,
      });
      if (selectorsForInitialization) {
        selectorsSeeded = markingEngine.lastInitializationSeededSelectors();
      }
    } else if (selectorsForInitialization) {
      const seeded = markingEngine.refresh({
        render: true,
        selectors: selectorsForInitialization,
      });
      selectorsSeeded = seeded;
    } else {
      // Silent preview already keeps this bridge current through its observers.
      // Switching presentation must not synchronously rebuild the entire page.
      markingEngine.renderMarking();
    }
    if (startingCleanSession) {
      cleanMarkingFingerprint = readMarkingDecisionFingerprint();
    }
    silentInteractionShieldActive = false;
    releaseDurablePostureLocally();
    markingActive = true;
    markingInteractionPauseRequested = false;
    const interactions = reconcileMarkingInteractionAvailability();
    lastContentSurfaceSignature = "";
    renderContentSurface();
    clearPersistedShieldPosture("silent-cleared");
    // Do not acknowledge activation while the reveal/restore scroll can still
    // leave one frame of page-owned sticky-header geometry ahead of the marking
    // layer. The engine uses its extension-captured presentation clock and a
    // bounded fallback, so a starved page cannot hang this acknowledgement.
    await markingEngine.settlePresentation?.();
    armNavigationGate();
    return {
      ok: interactions.ready,
      initialized: true,
      interactionsReady: interactions.ready,
      interactionsReason: interactions.reason,
      ritual,
      tree: "rewrite",
      ...(interactions.ready ? {} : { reason: interactions.reason }),
    };
  }
  return {
    ok: false,
    initialized: false,
    interactionsReady: false,
    interactionsReason: "no-document",
    ritual,
    tree: "rewrite",
    reason: "no-document",
  };
}

function installSilentDebugCopy(): void {
  removeSilentDebugCopyListener?.();
  removeSilentDebugCopyListener = null;
  const debugBuild = typeof __UF_DEBUG_BUILD__ !== "undefined" && __UF_DEBUG_BUILD__;
  markingEngine?.setSilentDebugAnnotations(debugBuild);
  if (!debugBuild || typeof document === "undefined") {
    return;
  }
  const handleCopy = (event: MouseEvent): void => {
    const copyTarget = (event.target as Element | null)?.closest?.('[data-uf-silent-copy="true"]');
    if (!copyTarget || !markingEngine) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // The transparent shield intentionally becomes the first physical page hit.
    // The clicked debug overlay already carries the renderer's canonical XPath,
    // so re-hit-testing through the shield would hide the bridge target and make
    // this extension-owned interaction a no-op.
    const xpath = copyTarget.getAttribute("data-uf-silent-highlight");
    if (!xpath) {
      return;
    }
    const toastFence = contentToasts.captureFence();
    void navigator.clipboard.writeText(`XPath: ${xpath}`).then(() => {
      contentToasts.showIfCurrent(toastFence, {
        message: "Highlight details copied.",
        tone: "success",
      });
    }).catch(() => {
      contentToasts.showIfCurrent(toastFence, {
        message: "Unable to copy highlight details.",
        tone: "danger",
      });
    });
  };
  document.addEventListener("click", handleCopy, true);
  removeSilentDebugCopyListener = () => {
    document.removeEventListener("click", handleCopy, true);
    removeSilentDebugCopyListener = null;
  };
}

/** Silent mode: show what the stored selectors keep, without arming marking.
 *  Read-only by construction — no listeners, no dirty flag, no navigation gate —
 *  so nothing here is a user marking. */
function applySilentSelectors(
  payload: unknown,
  options: Readonly<{ persist?: boolean }> = {},
): Record<string, unknown> {
  if (typeof document === "undefined" || !document.documentElement) {
    return { ok: false, reason: "no-document", tree: "rewrite" };
  }
  if (markingActive) {
    // A live session owns the overlay; overwriting it would discard real marks.
    return { ok: false, reason: "marking-active", tree: "rewrite" };
  }
  const selectors = selectorSetFrom(payloadObject(payload));
  markingEngine?.setInputTransparent?.(false);
  const seeded = markingEngine
    ? markingEngine.replaceSelectors(selectors)
    : (() => {
      markingEngine = createAuthoritativeMarkingEngine(document.documentElement, { selectors });
      return markingEngine.lastInitializationSeededSelectors();
    })();
  selectorsSeeded = seeded;
  const highlighted = markingEngine.renderSilentHighlights();
  silentInteractionShieldActive = true;
  lastContentSurfaceSignature = "";
  renderContentSurface();
  installSilentDebugCopy();
  if (options.persist !== false) {
    persistShieldPosture({
      kind: "silent-selectors",
      selectors: selectors ?? { inclusionSelectors: [], exclusionSelectors: [] },
    });
  }
  return { ok: true, seeded, highlighted: highlighted.length, tree: "rewrite" };
}

function clearSilentSelectors(
  options: Readonly<{ persist?: boolean }> = {},
): Record<string, unknown> {
  if (markingActive) {
    return { ok: false, reason: "marking-active", tree: "rewrite" };
  }
  removeSilentDebugCopyListener?.();
  if (!markingEngine && typeof document !== "undefined" && document.documentElement) {
    // The initial not_found baseline is awaited by the popup authority refresh.
    // Prepare the expensive DOM bridge here so the operator's first toggle only
    // has to paint the already-current marking presentation.
    markingEngine = createAuthoritativeMarkingEngine(document.documentElement);
  }
  markingEngine?.parkPresentation();
  selectorsSeeded = false;
  silentInteractionShieldActive = false;
  if (currentShieldPosture.status === "active" && currentShieldPosture.directive.organ.state === "silent") {
    releaseDurablePostureLocally();
  }
  lastContentSurfaceSignature = "";
  renderContentSurface();
  if (options.persist !== false) {
    clearPersistedShieldPosture("silent-cleared");
  }
  return { ok: true, tree: "rewrite" };
}

function previewInteractionActive(): boolean {
  return contentState.name === "preview_open" || contentState.name === "silent_preview";
}

function handlePreviewPageClick(event: MouseEvent): void {
  if (event.isTrusted === false) {
    return;
  }
  if (!previewInteractionActive() || !markingEngine) {
    return;
  }
  const eventTarget = event.target as Element | null;
  const extensionSurface = eventTarget?.closest?.('[data-uf-extension-ui="true"]');
  const interactionShield = eventTarget?.closest?.('[data-uf-interaction-shield="true"]');
  if (extensionSurface && !interactionShield) {
    return;
  }
  const target = markingEngine.previewRowAtPoint?.(event.clientX, event.clientY);
  if (!target) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  markingEngine.emphasizePreviewRow?.(target.projectionId, target.rowId, true);
  void getContentBus().emit("preview.focused", {
    pageUrl: currentPageUrl(),
    projectionId: target.projectionId,
    rowId: target.rowId,
  }, { target: "popup" });
}

function ensurePreviewPageListener(): void {
  if (
    removePreviewPageListener ||
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) {
    return;
  }
  document.addEventListener("click", handlePreviewPageClick, true);
  removePreviewPageListener = () => {
    document.removeEventListener("click", handlePreviewPageClick, true);
    removePreviewPageListener = null;
  };
}

function emphasizePreviewRow(payload: unknown): Record<string, unknown> {
  if (!previewInteractionActive()) {
    return { ok: false, reason: "preview-not-open", tree: "rewrite" };
  }
  const xpath = payloadObject(payload).xpath;
  if (typeof xpath !== "string" || xpath === "") {
    markingEngine?.clearHover();
    return { ok: true, targeted: false, tree: "rewrite" };
  }
  return { ok: true, targeted: markingEngine?.emphasizeXpath(xpath) ?? false, tree: "rewrite" };
}

function activatePreviewRow(payload: unknown): Record<string, unknown> {
  if (!previewInteractionActive()) {
    return { ok: false, reason: "preview-not-open", tree: "rewrite" };
  }
  const xpath = payloadObject(payload).xpath;
  if (typeof xpath !== "string" || xpath === "") {
    return { ok: false, reason: "invalid-xpath", tree: "rewrite" };
  }
  return { ok: true, targeted: markingEngine?.scrollXpathIntoView(xpath) ?? false, tree: "rewrite" };
}

function contentStatus(): Record<string, unknown> {
  const interactions = currentMarkingInteractionAvailability();
  const contentRows = contentRowsFromEngine();
  const listenerReady = interactions.ready && !markingInteractionsPaused && removeMarkingListeners !== null;
  return {
    ok: true,
    // This realm-scoped nonce changes on every real document replacement even
    // when Chrome keeps the same tab and URL. Popup-side silent-projection
    // caching uses it to distinguish a still-painted document from a freshly
    // loaded document whose local overlay layer no longer exists.
    documentNonce: RENDER_INSPECTION_DOCUMENT_NONCE,
    active: markingActive,
    dirty: isUserMarkingDirty(),
    pageUrl: currentPageUrl(),
    markedCount: userToggleCount,
    decisionRowCount: contentRows.length,
    markingToggleSeq,
    markingFingerprint: currentMarkingFingerprint(),
    cleanMarkingFingerprint: cleanMarkingFingerprint ?? "",
    contentRows,
    sessionState: contentState,
    authority: contentAuthority,
    presentation: contentPresentation,
    interactionsReady: listenerReady,
    interactionsReason: interactions.reason || (markingInteractionsPaused ? "interactions-paused" : ""),
    presentationPhase: pageInspectionActive
      ? "preparing"
      : listenerReady
        ? "interactive"
        : markingActive
          ? "blocked"
          : "silent",
    ritual: pendingPageVisitRitual
      ? { status: "pending", ...pendingPageVisitRitual.identity }
      : completedPageVisitRitual,
    tree: "rewrite",
  };
}

function markContentClean(): Record<string, unknown> {
  userToggleCount = 0;
  cleanMarkingFingerprint = readMarkingDecisionFingerprint();
  return { ok: true, active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite" };
}

function captureSubmissionSnapshot(payload: unknown): Record<string, unknown> {
  if (!markingEngine) {
    return { ok: false, reason: "marking-inactive", tree: "rewrite" };
  }
  const capture = payloadObject(payload);
  const pageUrl = typeof capture.pageUrl === "string" ? capture.pageUrl : currentPageUrl();
  const baseUrl = typeof capture.baseUrl === "string" ? capture.baseUrl : baseUrlFor(pageUrl);
  const renderMode = capture.renderMode === "static" ? "static" : "rendered";
  return {
    ok: true,
    snapshot: markingEngine.buildSubmission({
      baseUrl,
      renderMode,
      pageUrl,
      rawHtml: typeof capture.rawHtml === "string" ? capture.rawHtml : undefined,
    }),
    rows: contentRowsFromEngine(),
    tree: "rewrite",
  };
}

function createContentRouter() {
  return createContentCommandRouter({
    currentContext() {
      return {
        pageUrl: currentPageUrl(),
        baseUrl: baseUrlFor(currentPageUrl()),
        authority: contentAuthority,
        presentation: contentPresentation,
      };
    },
    handlers: {
      "lock.state.changed": (payload) => applyContentLockState(payload),
      activateContentMain: async (payload, command) => {
        const lifecycleGeneration = contentLifecycleGeneration;
        if (!await resumeConsentSuppression(command.tabId, lifecycleGeneration)) {
          return { ok: false, initialized: false, tree: "rewrite", reason: "consent-registration-failed" };
        }
        if (!interactionShieldAuthorityActive) {
          return { ok: false, initialized: false, tree: "rewrite", reason: "property-authority-unavailable" };
        }
        return activateContentMain(payload);
      },
      getContentMainStatus: () => contentStatus(),
      syncContentSignals: async () => {
        await contentSignalScheduler.drain();
        return {
          ok: true,
          organName: contentState.name,
          runSessionId: contentState.runSessionId ?? "",
          lastConsumedSeq: contentState.lastConsumedSeq,
          tree: "rewrite",
        };
      },
      refreshInteractionShieldViewport: (payload) => {
        // DevTools device metrics do not consistently dispatch a viewport event
        // into an already-running isolated world. Emulation therefore asks the
        // content owner for one explicit, synchronous remeasurement after CDP
        // confirms the new target posture.
        interactionShield?.refresh();
        if (
          payloadObject(payload).repaintSilent === true &&
          !markingActive &&
          silentInteractionShieldActive &&
          markingEngine
        ) {
          // Same-document metrics changes need a synchronous geometry repaint.
          // Responsive identity changes take the reload path in the popup, where
          // a fresh content document rebuilds selector ownership. The explicit
          // flag prevents an expensive duplicate paint on that new document.
          markingEngine.renderSilentHighlights();
        }
        const viewport = window.visualViewport;
        return {
          ok: true,
          active: interactionShield?.isActive() ?? false,
          width: viewport?.width ?? window.innerWidth ?? document.documentElement?.clientWidth ?? 0,
          height: viewport?.height ?? window.innerHeight ?? document.documentElement?.clientHeight ?? 0,
          tree: "rewrite",
        };
      },
      pauseContentMainInteractions: () => ({ ok: pauseMarkingInteractions(), active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite" }),
      resumeContentMainInteractions: () => contentAuthority.lockBlocked || contentPresentation.markingEditsBlocked
        ? { ok: false, active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite", reason: "session-blocked" }
        : { ok: resumeMarkingInteractions(), active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite" },
      markContentMainClean: () => markContentClean(),
      captureSubmissionSnapshot,
      deactivateContentMain: async () => {
        const terminalTeardown = deactivateMarking();
        await terminalTeardown;
        return { ok: true, initialized: false, tree: "rewrite" };
      },
      terminateConsentSuppression: () => {
        const restored = terminateConsentSuppression({ terminal: true });
        terminateInteractionShieldAuthority();
        return { ok: true, restored, tree: "rewrite" };
      },
      enterSilentContentMain: async (payload, command) => {
        const lifecycleGeneration = contentLifecycleGeneration;
        const requestPageUrl = payloadObject(payload).pageUrl;
        if (
          typeof requestPageUrl !== "string" ||
          !currentPageUrl() ||
          requestPageUrl !== currentPageUrl()
        ) {
          return { ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" };
        }
        if (!await resumeConsentSuppression(command.tabId, lifecycleGeneration)) {
          return { ok: false, initialized: false, tree: "rewrite", reason: "consent-registration-failed" };
        }
        if (
          typeof requestPageUrl !== "string" ||
          !currentPageUrl() ||
          requestPageUrl !== currentPageUrl()
        ) {
          return { ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" };
        }
        if (!interactionShieldAuthorityActive) {
          return { ok: false, initialized: false, tree: "rewrite", reason: "property-authority-unavailable" };
        }
        deactivateMarking("silent");
        return { ok: true, initialized: false, tree: "rewrite" };
      },
      resetContentMain: () => interactionShieldAuthorityActive
        ? { ok: resetMarking(), initialized: true, tree: "rewrite" }
        : {
          ok: false,
          initialized: false,
          tree: "rewrite",
          reason: "property-authority-unavailable",
        },
      applySilentSelectors: async (payload, command) => {
        const lifecycleGeneration = contentLifecycleGeneration;
        const requestPageUrl = payloadObject(payload).pageUrl;
        if (
          typeof requestPageUrl !== "string" ||
          !currentPageUrl() ||
          requestPageUrl !== currentPageUrl()
        ) {
          return { ok: false, applied: false, tree: "rewrite", reason: "page-url-mismatch" };
        }
        if (!await resumeConsentSuppression(command.tabId, lifecycleGeneration)) {
          return { ok: false, applied: false, tree: "rewrite", reason: "consent-registration-failed" };
        }
        if (
          typeof requestPageUrl !== "string" ||
          !currentPageUrl() ||
          requestPageUrl !== currentPageUrl()
        ) {
          return { ok: false, applied: false, tree: "rewrite", reason: "page-url-mismatch" };
        }
        if (!interactionShieldAuthorityActive) {
          return { ok: false, applied: false, tree: "rewrite", reason: "property-authority-unavailable" };
        }
        const applied = applySilentSelectors(payload);
        const presentationEngine = markingEngine;
        if (applied.ok !== true || !presentationEngine) {
          return applied;
        }
        await presentationEngine.settlePresentation?.();
        const presentationCurrent =
          lifecycleGeneration === contentLifecycleGeneration &&
          presentationEngine === markingEngine &&
          !markingActive &&
          silentInteractionShieldActive &&
          requestPageUrl === currentPageUrl();
        const canInspectPresentation = typeof document.querySelector === "function";
        const rendererRoot = canInspectPresentation
          ? document.querySelector(".uf-marking-layer-root")
          : null;
        const interactionShield = canInspectPresentation
          ? document.querySelector('[data-uf-interaction-shield="true"]')
          : null;
        if (
          !presentationCurrent ||
          (canInspectPresentation && rendererRoot?.isConnected !== true) ||
          (canInspectPresentation && interactionShield?.isConnected !== true)
        ) {
          return {
            ok: false,
            applied: false,
            tree: "rewrite",
            reason: presentationCurrent ? "silent-presentation-not-connected" : "silent-presentation-stale",
          };
        }
        return {
          ...applied,
          applied: true,
          presentationAcknowledged: true,
          documentNonce: RENDER_INSPECTION_DOCUMENT_NONCE,
        };
      },
      clearSilentSelectors: () => clearSilentSelectors(),
      emphasizePreviewRow,
      activatePreviewRow,
      /** Asked for by the popup when a render mode has just been established and the
       *  operator has left the inspection: until then there was nothing worth
       *  preparing, and the inspection's own reloads would have wasted the one
       *  ritual this visit gets. Re-probes first, because setting the mode is
       *  exactly what changes the answer the page-load probe got. */
      preparePageVisit: async (_payload, command) => {
        const lifecycleGeneration = contentLifecycleGeneration;
        if (!await resumeConsentSuppression(command.tabId, lifecycleGeneration)) {
          return { ok: false, prepared: false, reason: "consent-registration-failed" };
        }
        pageContextProbedUrl = "";
        await establishPageContext({ ritualRequiresCandidate: false });
        if (!interactionShieldAuthorityActive) {
          return { ok: false, prepared: false, reason: "property-authority-unavailable" };
        }
        const ritual = await runPageVisitRitual(currentPageUrl(), "render-mode-established");
        return {
          ok: ritual.status === "prepared",
          prepared: ritual.status === "prepared",
          reason: ritual.reason,
          ritual,
        };
      },
    },
    pingActivity: pingContentActivity,
  });
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: false,
  main(ctx) {
    // Construct the inert input firewall at document_start. Once a shield lease
    // activates, this already-registered capture listener precedes page-owned
    // window listeners instead of racing them after authority resolution.
    ensureInteractionShield();
    // A replaced isolated realm has lost its old nonce, while the MAIN-world
    // runtime and its freeze can survive. Reconcile only when the DOM exposes
    // an active posture; normal documents pay no command or timeout overhead.
    const documentElement = typeof document !== "undefined" ? document.documentElement : null;
    const orphanedPageWorldPosture = Boolean(
      documentElement?.hasAttribute?.("data-uf-page-motion-paused") ||
      documentElement?.hasAttribute?.("data-uf-lazy-loading-suppressed")
    );
    const transientSurfaces = ensureContentTransientSurfaces();
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      transientSurfaces.attach(window);
    }
    installNavigationWatcher();
    let localSurfacesSuspended = false;
    const suspendLocalSurfaces = (): void => {
      localSurfacesSuspended = true;
      transientSurfaces.closeAll("context-change");
      contentToasts.suspend();
      releaseLocalRenderInspectionForPageHide();
      // BFCache retains the page realm and all page listeners. Remove only the
      // physical layers; keep the document_start firewall registered so it
      // still precedes page listeners when pageshow remounts retained leases.
      interactionShield?.suspend();
    };
    const unloadLocalSurfaces = (): void => {
      suspendLocalSurfaces();
      disposeInteractionShield();
      transientSurfaces.dispose();
      contentTransientSurfaces = null;
      contentToasts.dispose();
    };
    if (typeof window !== "undefined") {
      // BFCache can hide/show the same document more than once. Keep this
      // listener for the lifetime of the content realm. Every hide drops both
      // local physical layers without revoking their durable background leases.
      window.addEventListener("pagehide", suspendLocalSurfaces);
      window.addEventListener("unload", unloadLocalSurfaces, { once: true });
      window.addEventListener("pageshow", () => {
        // Start a new exact document-fenced reconciliation before rebuilding
        // local surfaces. Only an authoritative `adopt` response may remount
        // the inspection curtain; terminal/inactive answers leave it fail-open.
        if (localSurfacesSuspended) {
          localSurfacesSuspended = false;
          contentToasts.resume();
          syncContentTransientPreviewContext();
          void adoptRenderInspectionSession();
        }
        // Ordinary P15 reasons remain locally retained across BFCache. They can
        // remount immediately because pagehide already removed inspection state.
        syncInteractionShield();
      });
    }
    ctx?.onInvalidated?.(() => {
      requestTerminalShieldClear("extension-invalidation");
      terminateConsentSuppression({ terminal: true });
      terminateInteractionShieldAuthority({ failOpenCleanupFence: true });
      transientSurfaces.dispose();
      contentTransientSurfaces = null;
      contentToasts.dispose();
      if (contentSignalPollHandle !== null && typeof window !== "undefined") {
        window.clearInterval(contentSignalPollHandle);
        contentSignalPollHandle = null;
      }
      signalsAvailableUnsubscribe?.();
      signalsAvailableUnsubscribe = null;
      pageUrlChangedUnsubscribe?.();
      pageUrlChangedUnsubscribe = null;
      removePreviewPageListener?.();
      contentSignalScheduler.dispose();
    });
    const bus = getContentBus();
    signalsAvailableUnsubscribe?.();
    signalsAvailableUnsubscribe = bus.on("signals.available", () => {
      void contentSignalScheduler.request().catch((error: unknown) => {
        console.error("[Unfluffify][rewrite] Unable to pull available content signals", error);
      });
    });
    pageUrlChangedUnsubscribe?.();
    pageUrlChangedUnsubscribe = bus.on("page.urlChanged", () => {
      handleUrlChanged();
    });
    bus.onCommand("command.dispatch", (command) => createContentRouter().dispatch(command));
    bus.onCommand("preview.project", (request) => previewController.project(request));
    bus.onCommand("preview.emphasize", (request) => previewController.emphasize(request));
    bus.onCommand("preview.activate", (request) => previewController.activate(request));
    ensurePreviewPageListener();
    // Ask for the durable render-inspection session before page.context, signal
    // polling, or any other ordinary remote work. A replacement document can
    // then paint its independently fenced curtain at document_start.
    const inspectionAdoption = adoptRenderInspectionSession();
    // Also mount any locally validated retained silent posture. This closes the
    // replacement-document interaction gap while the ordinary page-context call
    // performs remote classification/config validation. The latter remains the
    // final authority and can retain or tear this provisional adoption down.
    const retainedAdoption = adoptRetainedShieldPosture();
    pageContextBindQueue = Promise.allSettled([inspectionAdoption, retainedAdoption]).then(() => undefined);
    // Bind and adopt the authoritative current posture before consuming signals.
    // A rehydrated worker can have a signal head without replayable history.
    void establishPageContext().then(async () => {
      if (orphanedPageWorldPosture) {
        await reconcilePageWorldSessionAndWait();
      }
    }).catch((error: unknown) => {
      if (orphanedPageWorldPosture) {
        console.error("[Unfluffify][rewrite] Unable to reconcile orphaned page-world posture", error);
      }
    }).finally(() => ensureContentSignalPolling());
    // A content script can be reinjected while the tab's lock state is unchanged.
    // Announce the new consumer so background can replay its current authority
    // once, without restoring the popup's old 500ms presentation push.
    void reportContentFact("content-started", {}).catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to announce content consumer", error);
    });
  },
});
