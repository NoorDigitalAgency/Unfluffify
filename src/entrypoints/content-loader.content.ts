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
  type InteractionShieldController,
} from "../content/interaction-shield";
import {
  createRenderInspectionCurtain,
  type AdoptedRenderInspectionSession,
  type RenderInspectionCurtainController,
  type RenderInspectionIdentity,
} from "../content/render-inspection-curtain";
import { createMarkingEngine } from "../content/marking";
import { createPhysicalActionDeduper, openMarkingContextMenu } from "../content/marking/interaction";
import { createPreviewController } from "../content/preview-controller";
import {
  INITIAL_CONTENT_STATE,
  memoryForContent,
  transitionContentState,
  type ContentPresentation,
  type ContentState,
} from "../content/organ";
import { createFreezeController, createRevealVisitController, createSpaGuard, runReveal } from "../content/stabilization";
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
let markingActive = false;
/** Counts the operator's toggles, and nothing else. The page mutates on its own,
 *  so any measure derived from the live row count would drift: rows the page grows
 *  would read as an edit, and a toggle that removes rows would not. One toggle is
 *  one change, which is the only definition that holds on a dynamic page. */
let userToggleCount = 0;
let markingInteractionsPaused = false;
let spacePassthroughActive = false;
let altIncludeActive = false;
let removeMarkingListeners: (() => void) | null = null;
let removeSilentDebugCopyListener: (() => void) | null = null;
let navigationWatcherInstalled = false;
let lastKnownPageUrl = typeof location !== "undefined" ? location.href : "";
let contentBus: RewriteSignalBus | null = null;
let pageWorldSessionNonce = "";
let contentState: ContentState = INITIAL_CONTENT_STATE;
let contentPresentation: ContentPresentation = memoryForContent(contentState);
let contentAuthority: ContentAuthorityState = createDefaultContentAuthority(lastKnownPageUrl);
let contentSignalQueue: Promise<unknown> = Promise.resolve();
let contentSignalPollHandle: ReturnType<Window["setInterval"]> | null = null;
const CONTENT_SIGNAL_POLL_MS = 500;
const MARKING_CURSOR_STYLE_ID = "unfluffify-marking-cursor-style";
const MARKING_CURSOR_CLASSES = [
  "uf-cursor-exclude",
  "uf-cursor-include",
  "uf-cursor-passthrough",
  "uf-cursor-disabled",
] as const;
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
/** The page URL the reveal/freeze ritual has RUN for. One visit, one ritual — and
 *  set only once it actually ran, never when it skipped. */
let ritualRanForUrl = "";
/** The page URL a ritual is waiting on the load event for, so a second trigger in
 *  the meantime does not queue a second walk of the same page. */
let ritualPendingForUrl = "";
/** How long to wait for a load event before walking anyway. */
const RITUAL_READY_TIMEOUT_MS = 8000;
let contentSurfaceRoot: HTMLElement | null = null;
let lastContentSurfaceSignature = "";
let contentTransientSurfaces: ContentTransientSurfaces | null = null;
let contentLockConfirmation: TransientSurfaceHandle | null = null;
let pageInspectionActive = false;
let silentInteractionShieldActive = false;
const contentToasts = createContentToastLifecycle();
let interactionShield: InteractionShieldController | null = null;
let renderInspectionCurtain: RenderInspectionCurtainController | null = null;
let renderInspectionAdoptionGeneration = 0;
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

const CONTENT_LOCK_ACTION_LABEL: Readonly<Record<LockActionKind, string>> = {
  "continue-here": "Continue here",
  "suggest-takeover": "Ask to take over",
  "accept-takeover": "Accept takeover",
  "reject-takeover": "Keep editing",
  "take-over": "Take over",
};

function isUserMarkingDirty(): boolean {
  return userToggleCount > 0;
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
    markingEngine = createMarkingEngine(document.documentElement);
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
    onPaintReady(session) {
      void acknowledgeRenderInspectionPaint(session);
    },
    onFailure(session, reason) {
      void reportRenderInspectionFailure(session, reason);
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
    session.pageUrl !== currentPageUrl() ||
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
    response.session.pageUrl === currentPageUrl()
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
  if (pageUrl !== currentPageUrl()) {
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
      pageUrl !== currentPageUrl()
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
    return;
  }
  const adoptionGeneration = ++renderInspectionAdoptionGeneration;
  const lifecycleGeneration = contentLifecycleGeneration;
  const routeGeneration = documentLifecycleGeneration;
  let response;
  try {
    response = await getContentBus().request("renderInspection.adopt", {
      pageUrl,
      documentNonce: RENDER_INSPECTION_DOCUMENT_NONCE,
    }, { target: "background" });
  } catch {
    return;
  }
  if (
    adoptionGeneration !== renderInspectionAdoptionGeneration ||
    lifecycleGeneration !== contentLifecycleGeneration ||
    routeGeneration !== documentLifecycleGeneration ||
    pageUrl !== currentPageUrl()
  ) {
    return;
  }
  if (response.ok && response.data.status === "adopt") {
    adoptAuthoritativeRenderInspection(response.data.session);
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
}

function releaseLocalRenderInspectionForPageHide(): void {
  // A BFCache hide keeps this content realm alive, so invalidate both an
  // in-flight adoption response and the curtain controller's queued paint
  // callbacks before the hidden document can be restored later.
  renderInspectionAdoptionGeneration += 1;
  const current = renderInspectionCurtain?.current() ?? null;
  const identity = current ? renderInspectionIdentity(current) : null;
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
  const previousPresentation = contentPresentation;
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
  if (contentPresentation.markingEditsBlocked) {
    pauseMarkingInteractions();
  } else if (previousPresentation.markingEditsBlocked && markingInteractionsPaused) {
    resumeMarkingInteractions();
  }
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

async function pullContentSignals(): Promise<number> {
  const run = async (): Promise<number> => {
    const routeGeneration = documentLifecycleGeneration;
    const pageUrl = currentPageUrl();
    const response = await pullRewriteSignals(getContentBus(), {
      // Runtime transport supplies the real sender tab to the background. A
      // content script cannot discover its Chrome tab id itself.
      tabId: 0,
      afterSeq: contentState.lastConsumedSeq,
    });
    if (!response.ok) {
      return 0;
    }
    if (
      routeGeneration !== documentLifecycleGeneration ||
      pageUrl !== currentPageUrl() ||
      !interactionShieldAuthorityActive
    ) {
      // This slice belongs to an older route. Leave the cursor untouched so a
      // fresh pull can consume it together with the navigation boundary.
      return 0;
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
        return 0;
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
    let applied = 0;
    for (const signal of applicableSignals) {
      if (applyContentSignal(signal)) {
        applied += 1;
      }
    }
    return applied;
  };
  const queued = contentSignalQueue.then(run, run);
  contentSignalQueue = queued.catch(() => undefined);
  return await queued;
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

type StabilizationPageCommand = "ARM" | "SET_LAZY_LOADING_SUPPRESSED" | "SET_MOTION_PAUSED";
let stabilizationPageRequestSequence = 0;

async function requestStabilizationPageCommand(
  command: StabilizationPageCommand,
  payload: Record<string, unknown>,
  sessionNonce = "",
): Promise<{ nonce: string; payload: Record<string, unknown> }> {
  if (typeof window === "undefined") {
    throw new Error(`Page-world command unavailable: ${command}`);
  }
  stabilizationPageRequestSequence += 1;
  const nonce = `rewrite-stabilization-${Date.now()}-${stabilizationPageRequestSequence}`;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      result?: { nonce: string; payload: Record<string, unknown> },
      error?: Error,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      window.removeEventListener("message", handleMessage);
      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      }
    };
    const handleMessage = (event: MessageEvent): void => {
      if (event.source && event.source !== window) {
        return;
      }
      const response = event.data as {
        kind?: string;
        type?: string;
        nonce?: string;
        command?: string;
        ok?: boolean;
        payload?: unknown;
        failure?: { message?: string };
      } | null;
      if (
        !response ||
        response.kind !== "uf-page-bus/1" ||
        response.type !== "response" ||
        response.nonce !== nonce ||
        response.command !== command
      ) {
        return;
      }
      if (!response.ok) {
        finish(undefined, new Error(response.failure?.message ?? `Page-world command failed: ${command}`));
        return;
      }
      finish({
        nonce,
        payload: response.payload && typeof response.payload === "object"
          ? response.payload as Record<string, unknown>
          : {},
      });
    };
    const timeoutHandle = setTimeout(() => {
      finish(undefined, new Error(`Page-world command timed out: ${command}`));
    }, 3_000);
    window.addEventListener("message", handleMessage);
    window.postMessage?.({
      kind: "uf-page-bus/1",
      type: "request",
      nonce,
      sessionNonce: command === "ARM" ? undefined : sessionNonce,
      command,
      payload,
    }, "*");
  });
}

function currentDocumentScrollHeight(): number {
  if (typeof document === "undefined") {
    return 0;
  }
  return Math.max(
    document.documentElement?.scrollHeight ?? 0,
    document.body?.scrollHeight ?? 0,
    document.documentElement?.offsetHeight ?? 0,
    document.body?.offsetHeight ?? 0,
  );
}

function waitForWindowScrollEnd(targetY: number, isStale: () => boolean): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let reachedAt = Math.abs(window.scrollY - targetY) <= 2 ? startedAt : 0;
    let rafHandle = 0;
    let timerHandle: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (rafHandle && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafHandle);
      }
      if (timerHandle !== null) {
        clearTimeout(timerHandle);
      }
      resolve();
    };
    const sample = (): void => {
      if (isStale() || Date.now() - startedAt >= 8_000) {
        finish();
        return;
      }
      if (Math.abs(window.scrollY - targetY) <= 2) {
        reachedAt ||= Date.now();
        if (Date.now() - reachedAt >= 220) {
          finish();
          return;
        }
      } else {
        reachedAt = 0;
      }
      if (typeof window.requestAnimationFrame === "function") {
        rafHandle = window.requestAnimationFrame(sample);
      } else {
        timerHandle = setTimeout(sample, 16);
      }
    };
    sample();
  });
}

async function runActivationStabilization(pageUrl: string): Promise<{ skipped: boolean } | null> {
  try {
    return await revealController.runTask(async () => {
      if (!interactionShieldAuthorityActive) {
        return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
      }
      const lifecycleGeneration = contentLifecycleGeneration;
      const routeGeneration = documentLifecycleGeneration;
      spaGuard.arm(pageUrl);
      destroyPageWorldSession();
      pageInspectionActive = true;
      lastContentSurfaceSignature = "";
      renderContentSurface();
      const initialScrollY = typeof window !== "undefined" ? window.scrollY : 0;
      const isStale = (): boolean => !interactionShieldAuthorityActive ||
        lifecycleGeneration !== contentLifecycleGeneration ||
        routeGeneration !== documentLifecycleGeneration ||
        pageUrl !== (typeof location !== "undefined" ? location.href : pageUrl);
      const waitForSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1_000));
      try {
        const armed = await requestStabilizationPageCommand("ARM", {});
        if (isStale()) {
          requestPageWorldSessionDestroy(armed.nonce);
          return { skipped: true, lazyExpansions: 0, frozenAtBottom: false };
        }
        pageWorldSessionNonce = armed.nonce;
        const result = await runReveal({
          hasVerticalScrollRoom: typeof document !== "undefined" && typeof window !== "undefined"
            ? currentDocumentScrollHeight() > window.innerHeight + 2
            : false,
          activationStale: isStale,
          initialScrollHeight: currentDocumentScrollHeight(),
          measureExpandedScrollHeight: currentDocumentScrollHeight,
          async scrollTo(position, measuredScrollHeight) {
            if (typeof window === "undefined" || isStale()) {
              return;
            }
            const bottomY = Math.max(0, measuredScrollHeight - window.innerHeight);
            const targetY = position === "top"
              ? 0
              : position === "lazy-threshold"
                ? Math.round(bottomY * 0.5)
                : position === "bottom"
                  ? bottomY
                  : initialScrollY;
            window.scrollTo({ top: targetY, behavior: "smooth" });
            await waitForWindowScrollEnd(targetY, isStale);
          },
          waitForSettle,
          async suppressLazyLoading() {
            if (isStale()) {
              return;
            }
            await requestStabilizationPageCommand(
              "SET_LAZY_LOADING_SUPPRESSED",
              { suppressed: true },
              pageWorldSessionNonce,
            );
          },
          async restoreLazyLoading() {
            if (!pageWorldSessionNonce) {
              return;
            }
            await requestStabilizationPageCommand(
              "SET_LAZY_LOADING_SUPPRESSED",
              { suppressed: false },
              pageWorldSessionNonce,
            );
          },
          async freezeAtBottom() {
            if (isStale()) {
              return;
            }
            await requestStabilizationPageCommand(
              "SET_MOTION_PAUSED",
              { paused: true },
              pageWorldSessionNonce,
            );
            if (isStale()) {
              return;
            }
            freezeController.pause("page-visit");
            lastContentSurfaceSignature = "";
            renderContentSurface();
          },
        });
        return isStale()
          ? { skipped: true, lazyExpansions: 0, frozenAtBottom: false }
          : result;
      } finally {
        if (lifecycleGeneration === contentLifecycleGeneration) {
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

function requestPageWorldSessionDestroy(sessionNonce: string): void {
  if (!sessionNonce || typeof window === "undefined") {
    return;
  }
  window.postMessage?.({
    kind: "uf-page-bus/1",
    type: "request",
    nonce: sessionNonce,
    sessionNonce,
    command: "DESTROY",
    payload: {},
  }, "*");
}

function destroyPageWorldSession(): void {
  const wasPaused = freezeController.isPaused();
  if (!pageWorldSessionNonce || typeof window === "undefined") {
    freezeController.lift();
    pageWorldSessionNonce = "";
    if (wasPaused) {
      lastContentSurfaceSignature = "";
      renderContentSurface();
    }
    return;
  }
  requestPageWorldSessionDestroy(pageWorldSessionNonce);
  freezeController.lift();
  pageWorldSessionNonce = "";
  if (wasPaused) {
    lastContentSurfaceSignature = "";
    renderContentSurface();
  }
}

function setSpacePassthrough(event: KeyboardEvent, active: boolean): void {
  if (event.code === "Space" || event.key === " ") {
    const wasActive = spacePassthroughActive;
    spacePassthroughActive = active;
    markingEngine?.setPassthrough?.(active);
    syncMarkingCursor();
    if (!wasActive && active) {
      contentToasts.show({ message: "Page interaction mode", tone: "success" });
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
  void reportContentFact("marking-toggle", { markingToggleSeq: userToggleCount })
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
@font-face {
  font-family: "Unfluffify Material Design Icons";
  src: url(${JSON.stringify(extensionAssetUrl("assets/materialdesignicons-webfont.woff2"))}) format("woff2");
  font-display: block;
}
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
  font: 18px/1 "Unfluffify Material Design Icons";
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
    return null;
  }
  interactionShield = createInteractionShield({
    document,
    window,
    extensionSurfaces: extensionSurfacesForShield,
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
  const shouldBeActive = inspectionActive || (
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
  markingEngine?.setInputTransparent?.(true);
  controller.setActive(SILENT_SHIELD_REASON, silentActive);
  controller.setActive(PREVIEW_SHIELD_REASON, previewActive);
  controller.setActive(BLOCKED_ORGAN_SHIELD_REASON, blockedOrganActive);
  controller.setActive(DURABLE_POSTURE_SHIELD_REASON, durablePostureShieldActive);
  controller.setActive(RENDER_INSPECTION_SHIELD_REASON, inspectionActive);
  controller.refresh();
}

function disposeInteractionShield(): void {
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
  selectorsSeeded = false;
  markingInteractionsPaused = false;
  pageInspectionActive = false;
  contentToasts.retire();
  spaGuard.disarm();
  destroyPageWorldSession();
  syncMarkingCursor();
  contentSurfaceRoot?.remove();
  contentSurfaceRoot = null;
  if (typeof document !== "undefined") {
    document.getElementById?.(MARKING_CURSOR_STYLE_ID)?.remove();
    document.getElementById?.(CONTENT_SURFACE_STYLE_ID)?.remove();
  }
  lastContentSurfaceSignature = "";
}

function terminateInteractionShieldAuthority(): void {
  contentLifecycleGeneration += 1;
  renderInspectionAdoptionGeneration += 1;
  shieldPostureMutationGeneration += 1;
  interactionShieldAuthorityActive = false;
  silentInteractionShieldActive = false;
  durablePostureShieldActive = false;
  durableSilentAdoptionGeneration += 1;
  pendingNavigationBoundary = null;
  currentShieldPosture = { status: "inactive", revision: 0 };
  renderInspectionCurtain?.terminate();
  disposeTerminalContentSurfaces();
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
        (routeGeneration !== documentLifecycleGeneration || pageUrl !== currentPageUrl())
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
        (routeGeneration !== documentLifecycleGeneration || pageUrl !== currentPageUrl())
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
        button.textContent = action.confirmDiscard
          ? `${CONTENT_LOCK_ACTION_LABEL[action.kind]} anyway`
          : CONTENT_LOCK_ACTION_LABEL[action.kind];
        button.addEventListener("click", (event) => {
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
            confirm.textContent = "Discard and continue";
            confirm.addEventListener("click", (confirmEvent) => {
              confirmEvent.preventDefault();
              confirmEvent.stopPropagation();
              contentLockConfirmation?.close("context-change");
              void getContentBus().request("lock.action", action, { target: "background" });
            });
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.setAttribute("data-uf-content-lock-confirm-cancel", "true");
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", (cancelEvent) => {
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
    const snowflake = document.createElement("span");
    snowflake.setAttribute("aria-hidden", "true");
    snowflake.textContent = String.fromCodePoint(0xF0717);
    const codeTags = document.createElement("span");
    codeTags.setAttribute("aria-hidden", "true");
    codeTags.textContent = String.fromCodePoint(0xF1C86);
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
    close.setAttribute("aria-label", "Close notification");
    close.title = "Close notification";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
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
  if (response.data.renderModeSet && wanted && !suspended) {
    runPageVisitRitual(pageUrl, requireCandidate ? "page-load" : "render-mode-established");
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

/** Runs the ritual, once a page has actually loaded and once per visit.
 *
 *  Latches on a real run only. A skip — no scroll room yet, or an activation that
 *  has been overtaken by a navigation — leaves the attempt available, because the
 *  page still has not been prepared and something later will ask again. */
function runPageVisitRitual(pageUrl: string, cause: string): void {
  // Only a real URL can be deduplicated against. Comparing empty strings would
  // make the very first ritual on a page with no resolvable URL look like a repeat.
  if (pageUrl && (ritualRanForUrl === pageUrl || ritualPendingForUrl === pageUrl)) {
    return;
  }
  const attempt = (): void => {
    if (pageUrl && currentPageUrl() !== pageUrl) {
      // The page moved on while waiting; this ritual describes a document that is
      // no longer here, and the new one has its own trigger.
      ritualPendingForUrl = "";
      return;
    }
    // Started synchronously so the page-world bridge is armed before anything else
    // this tick can look for it; the walk's outcome settles later.
    ritualPendingForUrl = pageUrl;
    void runActivationStabilization(pageUrl).then((result) => {
      if (result && !result.skipped) {
        ritualRanForUrl = pageUrl;
        console.debug(`[Unfluffify][rewrite] Page-visit reveal/freeze ran (${cause})`);
        return;
      }
      console.debug(`[Unfluffify][rewrite] Page-visit reveal/freeze skipped (${cause}) — attempt kept`);
    }).catch(() => {
      // A failed walk has not prepared the page either, so the attempt stays free.
    }).finally(() => {
      if (ritualPendingForUrl === pageUrl) {
        ritualPendingForUrl = "";
      }
    });
  };
  if (readyToWalk()) {
    attempt();
    return;
  }
  if (typeof window === "undefined") {
    return;
  }
  // Wait for the load event rather than giving up: a reload triggers this at
  // document_start every time, and that is exactly when the ritual is due.
  ritualPendingForUrl = pageUrl;
  let settled = false;
  const onReady = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    window.removeEventListener("load", onReady);
    attempt();
  };
  window.addEventListener("load", onReady, { once: true });
  // A page whose load event never fires — an aborted subresource is enough — must
  // not strand the ritual for the whole visit.
  setTimeout(onReady, RITUAL_READY_TIMEOUT_MS);
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
  if (contentAuthority.lockBlocked || contentPresentation.markingEditsBlocked) {
    pauseMarkingInteractions();
  } else if (markingInteractionsPaused) {
    resumeMarkingInteractions();
  }
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
  let lastPointer: Readonly<{ x: number; y: number; altKey: boolean; shiftKey: boolean }> | null = null;
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
  const deduper = createPhysicalActionDeduper();
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
    target: NonNullable<ReturnType<NonNullable<typeof markingEngine>["resolveAtPoint"]>>,
    mode: "include" | "exclude" | "clear",
  ): void => {
    if (!markingEngine || !deduper.accept(physicalId, target.xpath, mode)) {
      return;
    }
    const changed = mode === "clear"
      ? markingEngine.clear?.(target) ?? false
      : markingEngine.toggle(target, mode);
    if (changed === false) {
      markingEngine.rejectAtPoint?.(lastPointer?.x ?? 0, lastPointer?.y ?? 0);
      return;
    }
    userToggleCount += 1;
    reportMarkingToggle();
  };
  const scheduleHover = (): void => {
    if (hoverFrame || !lastPointer || typeof window === "undefined") {
      return;
    }
    const run = (): void => {
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
      markingEngine.hoverAtPoint(pointer.x, pointer.y, mode, pointer.shiftKey);
    };
    hoverFrame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 0);
  };
  const handleClick = (event: MouseEvent): void => {
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
    const target = markingEngine.resolveAtPoint(event.clientX, event.clientY, mode, event.shiftKey);
    if (!target) {
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
    commit(physicalIdFor(event), target, mode);
  };
  const handlePointerDown = (event: PointerEvent): void => {
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
    const include = markingEngine.resolveAtPoint(event.clientX, event.clientY, "include", false);
    const exclude = markingEngine.resolveAtPoint(event.clientX, event.clientY, "exclude", false);
    const widen = markingEngine.resolveAtPoint(event.clientX, event.clientY, "exclude", true);
    const clearTarget = exclude ?? include;
    if (!include && !exclude) {
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
        { id: "include", label: "Include", enabled: Boolean(include), run: () => include && commit(physicalId, include, "include") },
        { id: "exclude", label: "Exclude", enabled: Boolean(exclude), run: () => exclude && commit(physicalId, exclude, "exclude") },
        {
          id: "widen",
          label: "Widen exclusion",
          enabled: Boolean(widen && widen.xpath !== exclude?.xpath),
          run: () => widen && commit(physicalId, widen, "exclude"),
        },
        {
          id: "clear",
          label: "Clear mark",
          enabled: Boolean(clearTarget && markingEngine?.hasExplicitMark?.(clearTarget)),
          run: () => clearTarget && commit(physicalId, clearTarget, "clear"),
        },
      ],
    });
  };
  const handleMouseMove = (event: MouseEvent): void => {
    if (!markingActive || !markingEngine) {
      return;
    }
    if (altIncludeActive !== event.altKey) {
      altIncludeActive = event.altKey;
      syncMarkingCursor();
    }
    shiftHeld = event.shiftKey;
    lastPointer = {
      x: event.clientX,
      y: event.clientY,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    };
    scheduleHover();
  };
  const handleMouseLeave = (): void => {
    lastPointer = null;
    markingEngine?.clearHover();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    setAltInclude(event, true);
    setSpacePassthrough(event, true);
    if (event.key === "Shift") {
      shiftHeld = true;
    }
    if (lastPointer) {
      lastPointer = { ...lastPointer, altKey: altIncludeActive, shiftKey: shiftHeld };
      scheduleHover();
    }
  };
  const handleKeyUp = (event: KeyboardEvent): void => {
    setAltInclude(event, false);
    setSpacePassthrough(event, false);
    if (event.key === "Shift") {
      shiftHeld = false;
    }
    if (lastPointer) {
      lastPointer = { ...lastPointer, altKey: altIncludeActive, shiftKey: shiftHeld };
      scheduleHover();
    }
  };
  const resetModifiers = (): void => {
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
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(hoverFrame);
      } else {
        window.clearTimeout(hoverFrame);
      }
      hoverFrame = 0;
    }
    lastPointer = null;
    lastPointerDown = null;
    closeMarkingMenu?.();
    closeMarkingMenu = null;
    removeMarkingListeners = null;
    spacePassthroughActive = false;
    markingEngine?.setPassthrough?.(false);
    altIncludeActive = false;
    syncMarkingCursor();
  };
}

type MarkingDeactivationMode = "terminal" | "silent";

function deactivateMarking(mode: MarkingDeactivationMode = "terminal"): void {
  markingActive = false;
  userToggleCount = 0;
  selectorsSeeded = false;
  removeNavigationGate?.();
  markingInteractionsPaused = false;
  if (mode === "terminal") {
    silentInteractionShieldActive = false;
    spaGuard.disarm();
    destroyPageWorldSession();
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
}

function pauseMarkingInteractions(): boolean {
  markingInteractionsPaused = true;
  const previewVisible = contentState.name === "preview_open" || contentState.name === "silent_preview";
  // Preview is read-only, but it is not a disabled/error state: retain the
  // canonical classification colors while removing every marking listener.
  markingEngine?.setSuspended?.(!previewVisible);
  if (!markingActive) {
    syncMarkingCursor();
    return false;
  }
  removeMarkingListeners?.();
  syncMarkingCursor();
  lastContentSurfaceSignature = "";
  renderContentSurface();
  return true;
}

function resumeMarkingInteractions(): boolean {
  if (contentAuthority.lockBlocked || contentPresentation.markingEditsBlocked) {
    return false;
  }
  markingInteractionsPaused = false;
  markingEngine?.setSuspended?.(false);
  if (!markingActive) {
    return false;
  }
  ensureMarkingListeners();
  lastContentSurfaceSignature = "";
  renderContentSurface();
  return true;
}

function handleUrlChanged(nextUrl?: string): void {
  const currentUrl = nextUrl || (typeof location !== "undefined" ? location.href : "");
  if (!currentUrl || currentUrl === lastKnownPageUrl) {
    return;
  }
  const previousUrl = lastKnownPageUrl;
  contentTransientSurfaces?.closeAll("context-change");
  contentTransientSurfaces?.syncPreviewContext({ active: false, restoring: false });
  contentLockConfirmation = null;
  renderInspectionAdoptionGeneration += 1;
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
  ritualRanForUrl = "";
  ritualPendingForUrl = "";
  revealController.resetForNavigation();
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
  const handlePageWorldMessage = (event: MessageEvent): void => {
    if (event.source !== window || !event.data || typeof event.data !== "object") {
      return;
    }
    const data = event.data as { kind?: unknown; toUrl?: unknown };
    if (data.kind === "uf-page-url-changed/1" && typeof data.toUrl === "string") {
      handleUrlChanged();
    }
  };
  window.addEventListener("popstate", () => handleUrlChanged());
  window.addEventListener("hashchange", () => handleUrlChanged());
  window.addEventListener("message", handlePageWorldMessage);
}

function resetMarking(): boolean {
  if (typeof document === "undefined" || !document.documentElement) {
    return false;
  }
  markingEngine?.setInputTransparent?.(false);
  markingEngine?.dispose();
  removeSilentDebugCopyListener?.();
  destroyPageWorldSession();
  markingEngine = createMarkingEngine(document.documentElement, { render: true });
  userToggleCount = 0;
  selectorsSeeded = false;
  lastKnownPageUrl = typeof location !== "undefined" ? location.href : lastKnownPageUrl;
  if (activation.state().silentHighlightArmed) {
    markingEngine.renderSilentHighlights?.();
  }
  silentInteractionShieldActive = false;
  releaseDurablePostureLocally();
  markingActive = true;
  ensureMarkingListeners();
  lastContentSurfaceSignature = "";
  renderContentSurface();
  clearPersistedShieldPosture("silent-cleared");
  return true;
}

function activateContentMain(payload: unknown): Record<string, unknown> {
  const request = payloadObject(payload);
  const requestPageUrl = typeof request.pageUrl === "string" ? request.pageUrl : "";
  const pageUrl = currentPageUrl();
  if (requestPageUrl && pageUrl && requestPageUrl !== pageUrl) {
    return { ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" };
  }
  const nextPageUrl = requestPageUrl || pageUrl;
  activation.arm(
    nextPageUrl,
    request.realEditorActivation !== false,
  );
  // Through the same guard as the page-load path: a page prepared at load must not
  // be walked again because marking was then armed on it.
  runPageVisitRitual(nextPageUrl, "marking-activation");
  if (typeof document !== "undefined" && document.documentElement) {
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
      markingEngine = createMarkingEngine(document.documentElement, {
        render: true,
        selectors: selectorsForInitialization,
      });
      if (selectorsForInitialization) {
        selectorsSeeded = markingEngine.lastInitializationSeededSelectors();
      }
    } else {
      const seeded = markingEngine.refresh({
        render: true,
        selectors: selectorsForInitialization,
      });
      if (selectorsForInitialization) {
        selectorsSeeded = seeded;
      }
    }
    if (activation.state().silentHighlightArmed) {
      markingEngine.renderSilentHighlights?.();
    }
    silentInteractionShieldActive = false;
    releaseDurablePostureLocally();
    markingActive = true;
    ensureMarkingListeners();
    lastContentSurfaceSignature = "";
    renderContentSurface();
    clearPersistedShieldPosture("silent-cleared");
    armNavigationGate();
  }
  return { ok: true, initialized: true, tree: "rewrite" };
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
  markingEngine?.dispose();
  markingEngine = createMarkingEngine(document.documentElement, { selectors });
  const seeded = markingEngine.lastInitializationSeededSelectors();
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
  markingEngine?.clearOverlays();
  removeSilentDebugCopyListener?.();
  markingEngine?.setInputTransparent?.(false);
  markingEngine?.dispose();
  markingEngine = null;
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
  return {
    ok: true,
    active: markingActive,
    dirty: isUserMarkingDirty(),
    pageUrl: currentPageUrl(),
    markedCount: userToggleCount,
    contentRows: contentRowsFromEngine(),
    sessionState: contentState,
    authority: contentAuthority,
    presentation: contentPresentation,
    tree: "rewrite",
  };
}

function markContentClean(): Record<string, unknown> {
  userToggleCount = 0;
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
      pauseContentMainInteractions: () => ({ ok: pauseMarkingInteractions(), active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite" }),
      resumeContentMainInteractions: () => contentAuthority.lockBlocked || contentPresentation.markingEditsBlocked
        ? { ok: false, active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite", reason: "session-blocked" }
        : { ok: resumeMarkingInteractions(), active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite" },
      markContentMainClean: () => markContentClean(),
      captureSubmissionSnapshot,
      deactivateContentMain: () => {
        deactivateMarking();
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
        return applySilentSelectors(payload);
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
        return { ok: true, prepared: ritualRanForUrl === currentPageUrl() };
      },
    },
    pingActivity: pingContentActivity,
  });
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main(ctx) {
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
      disposeInteractionShield();
    };
    const unloadLocalSurfaces = (): void => {
      suspendLocalSurfaces();
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
      terminateInteractionShieldAuthority();
      transientSurfaces.dispose();
      contentTransientSurfaces = null;
      contentToasts.dispose();
      if (contentSignalPollHandle !== null && typeof window !== "undefined") {
        window.clearInterval(contentSignalPollHandle);
        contentSignalPollHandle = null;
      }
    });
    const bus = getContentBus();
    bus.onCommand("command.dispatch", (command) => createContentRouter().dispatch(command));
    bus.onCommand("preview.project", (request) => previewController.project(request));
    bus.onCommand("preview.emphasize", (request) => previewController.emphasize(request));
    bus.onCommand("preview.activate", (request) => previewController.activate(request));
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
    void establishPageContext().finally(() => ensureContentSignalPolling());
    // A content script can be reinjected while the tab's lock state is unchanged.
    // Announce the new consumer so background can replay its current authority
    // once, without restoring the popup's old 500ms presentation push.
    void reportContentFact("content-started", {}).catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to announce content consumer", error);
    });
  },
});
