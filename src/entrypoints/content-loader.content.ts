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
import { hideConsentOverlays } from "../content/consent";
import { createMarkingEngine } from "../content/marking";
import {
  INITIAL_CONTENT_STATE,
  memoryForContent,
  transitionContentState,
  type ContentPresentation,
  type ContentState,
} from "../content/organ";
import { createFreezeController, createRevealVisitController, createSpaGuard } from "../content/stabilization";
import type { BrainSignal } from "../domain/schema/signals";
import type { CommandEnvelope } from "../messaging/contracts";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import { pullRewriteSignals, type RewriteSignalBus } from "../messaging/rewrite-signals";

const activation = createActivationGate();
const freezeController = createFreezeController();
const revealController = createRevealVisitController();
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
let removeMarkingListeners: (() => void) | null = null;
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
/** Selectors seed a clean session once and then stop mattering; this guards the
 *  "once" across re-activations of the same session. */
let selectorsSeeded = false;
let removeNavigationGate: (() => void) | null = null;
/** Watches for consent chrome injected after the first sweep, which is the norm:
 *  most frameworks mount their dialog once their own script has loaded. */
let consentObserver: MutationObserver | null = null;
/** The page URL the background has already been asked about, so one page load costs
 *  one question. Cleared on navigation, and on a failed ask so it can be retried. */
let pageContextProbedUrl = "";
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

function selectorSetFrom(payload: Record<string, unknown>): { inclusionSelectors: string[]; exclusionSelectors: string[] } | null {
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

function getRuntimeBrowser() {
  return getInstalledBrowserApi() ?? browser;
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

function applyContentSignal(signal: BrainSignal): boolean {
  const nextState = transitionContentState(contentState, signal);
  if (nextState === contentState) {
    return false;
  }
  const completesPreviewExit = signal.name === "preview.exit.requested" && nextState.name === "exit_restoring";
  const previousPresentation = contentPresentation;
  contentState = nextState;
  contentPresentation = memoryForContent(nextState);
  if (contentPresentation.markingEditsBlocked) {
    pauseMarkingInteractions();
  } else if (previousPresentation.markingEditsBlocked && markingInteractionsPaused) {
    resumeMarkingInteractions();
  }
  renderContentSurface();
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
    const response = await pullRewriteSignals(getContentBus(), {
      // Runtime transport supplies the real sender tab to the background. A
      // content script cannot discover its Chrome tab id itself.
      tabId: 0,
      afterSeq: contentState.lastConsumedSeq,
    });
    if (!response.ok) {
      return 0;
    }
    let applied = 0;
    for (const signal of response.data) {
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

function refreshActiveMarking(): void {
  if (!markingActive || !markingEngine) {
    return;
  }
  markingEngine.refresh();
  markingEngine.renderReadOnly();
}

async function runActivationStabilization(pageUrl: string): Promise<{ skipped: boolean } | null> {
  spaGuard.arm(pageUrl);
  destroyPageWorldSession();
  const sessionNonce = `rewrite-stabilization-${Date.now()}`;
  pageWorldSessionNonce = sessionNonce;
  const initialScrollY = typeof window !== "undefined" ? window.scrollY : 0;
  const postPageCommand = (command: "ARM" | "SET_LAZY_LOADING_SUPPRESSED" | "SET_MOTION_PAUSED", payload: Record<string, unknown>): void => {
    if (typeof window === "undefined") {
      return;
    }
    window.postMessage?.({
      kind: "uf-page-bus/1",
      type: "request",
      nonce: sessionNonce,
      sessionNonce: command === "ARM" ? undefined : sessionNonce,
      command,
      payload,
    }, "*");
  };
  const waitForPaint = (): Promise<void> => new Promise((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    let settled = false;
    const fallback = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, 100);
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(fallback);
      resolve();
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
  });
  postPageCommand("ARM", {});
  return await revealController.run({
    hasVerticalScrollRoom: typeof document !== "undefined" && typeof window !== "undefined"
      ? document.documentElement.scrollHeight > window.innerHeight
      : false,
    activationStale: pageUrl !== (typeof location !== "undefined" ? location.href : pageUrl),
    initialScrollHeight: typeof document !== "undefined" ? document.documentElement.scrollHeight : 0,
    measureExpandedScrollHeight: () => typeof document !== "undefined"
      ? document.documentElement.scrollHeight
      : 0,
    scrollTo(position, measuredScrollHeight) {
      if (typeof window === "undefined") {
        return;
      }
      if (position === "top") window.scrollTo(0, 0);
      if (position === "half") window.scrollTo(0, Math.floor(measuredScrollHeight / 2));
      if (position === "bottom") window.scrollTo(0, measuredScrollHeight);
      if (position === "restore") window.scrollTo(0, initialScrollY);
    },
    waitForPaint,
    suppressLazyLoading() {
      postPageCommand("SET_LAZY_LOADING_SUPPRESSED", { suppressed: true });
    },
    freezeAtBottom() {
      freezeController.pause("page-visit");
      postPageCommand("SET_MOTION_PAUSED", { paused: true });
    },
  }).catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Page stabilization failed", error);
    return null;
  });
}

function destroyPageWorldSession(): void {
  if (!pageWorldSessionNonce || typeof window === "undefined") {
    freezeController.lift();
    pageWorldSessionNonce = "";
    return;
  }
  window.postMessage?.({
    kind: "uf-page-bus/1",
    type: "request",
    nonce: pageWorldSessionNonce,
    sessionNonce: pageWorldSessionNonce,
    command: "DESTROY",
    payload: {},
  }, "*");
  freezeController.lift();
  pageWorldSessionNonce = "";
}

function setSpacePassthrough(event: KeyboardEvent, active: boolean): void {
  if (event.code === "Space" || event.key === " ") {
    const wasActive = spacePassthroughActive;
    spacePassthroughActive = active;
    if (wasActive && !active) {
      refreshActiveMarking();
    }
  }
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

function ensureContentSurfaceRoot(): HTMLElement | null {
  if (typeof document === "undefined" || !document.documentElement) {
    return null;
  }
  if (contentSurfaceRoot?.isConnected) {
    return contentSurfaceRoot;
  }
  contentSurfaceRoot = document.createElement("div");
  contentSurfaceRoot.setAttribute("data-uf-extension-ui", "true");
  contentSurfaceRoot.setAttribute("data-uf-content-surface-root", "true");
  contentSurfaceRoot.style.position = "fixed";
  contentSurfaceRoot.style.inset = "0";
  contentSurfaceRoot.style.pointerEvents = "none";
  contentSurfaceRoot.style.zIndex = "2147483646";
  document.documentElement.appendChild(contentSurfaceRoot);
  lastContentSurfaceSignature = "";
  return contentSurfaceRoot;
}

function renderContentSurface(): void {
  const lockBlocked = contentAuthority.lockBlocked;
  const blockedReason = lockBlocked
    ? contentAuthority.blockedReason || "property-lock"
    : contentPresentation.blockedReason;
  const curtain = lockBlocked
    ? { visible: true, text: contentAuthority.banner.text || "Property locked" }
    : contentPresentation.curtain;
  const banner = contentAuthority.banner;
  const signature = JSON.stringify({ blockedReason, curtain, banner });
  const root = ensureContentSurfaceRoot();
  if (!root) {
    return;
  }
  if (signature === lastContentSurfaceSignature) {
    return;
  }
  lastContentSurfaceSignature = signature;
  root.replaceChildren();
  if (curtain.visible) {
    const curtainElement = document.createElement("section");
    curtainElement.setAttribute("role", "status");
    curtainElement.setAttribute("data-uf-content-curtain", "true");
    curtainElement.textContent = curtain.text || blockedReason;
    curtainElement.style.position = "absolute";
    curtainElement.style.inset = "0";
    curtainElement.style.display = "grid";
    curtainElement.style.placeItems = "center";
    curtainElement.style.background = "rgba(15, 23, 42, 0.18)";
    curtainElement.style.color = "#0f172a";
    root.appendChild(curtainElement);
  }
  if (banner.visible || blockedReason) {
    const bannerElement = document.createElement("aside");
    bannerElement.setAttribute("role", "status");
    bannerElement.setAttribute("data-uf-content-banner", "true");
    bannerElement.textContent = banner.text || blockedReason;
    bannerElement.style.position = "fixed";
    bannerElement.style.left = "16px";
    bannerElement.style.right = "16px";
    bannerElement.style.bottom = "16px";
    bannerElement.style.padding = "8px 12px";
    bannerElement.style.borderRadius = "8px";
    bannerElement.style.background = "rgba(15, 23, 42, 0.92)";
    bannerElement.style.color = "white";
    root.appendChild(bannerElement);
  }
}

/** Legacy's durable contract: consent hiding runs on every property page,
 *  decoupled from candidacy, marking mode, stored selectors and the reveal/freeze
 *  directives — and it runs BEFORE any of them can bail out. A directive arriving
 *  is what says this tab is in scope; nothing about its contents gates this.
 *
 *  A consent dialog covers the content being marked, ruins a render-mode
 *  comparison, and can be dismissed by a stray click — which records a consent
 *  decision that changes what every later load looks like. */
function sweepConsentOverlays(): void {
  if (typeof document === "undefined") {
    return;
  }
  const result = hideConsentOverlays(document);
  if (result.hidden > 0) {
    console.debug(`[Unfluffify][rewrite] Hid ${result.hidden} consent element(s)`);
  }
  observeLateConsentOverlays();
}

/** Re-sweeps on DOM growth. Cheap by construction: the sweep skips everything it
 *  has already hidden, so a busy page costs a query and no writes. */
function observeLateConsentOverlays(): void {
  if (consentObserver !== null || typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return;
  }
  const target = document.documentElement ?? document.body;
  if (!target) {
    return;
  }
  consentObserver = new MutationObserver(() => {
    hideConsentOverlays(document);
  });
  consentObserver.observe(target, { childList: true, subtree: true });
}

function stopConsentObserver(): void {
  consentObserver?.disconnect();
  consentObserver = null;
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
async function establishPageContext(options: Readonly<{ ritualRequiresCandidate?: boolean }> = {}): Promise<void> {
  const requireCandidate = options.ritualRequiresCandidate !== false;
  const pageUrl = currentPageUrl();
  if (!pageUrl || pageContextProbedUrl === pageUrl) {
    return;
  }
  pageContextProbedUrl = pageUrl;
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
  // A transient answer may carry the last valid canonical context for this exact
  // page. A null site id means there is no trustworthy property fact to act on.
  if (response.data.siteId === null) {
    return;
  }
  sweepConsentOverlays();
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
    ritualPendingForUrl = "";
    if (pageUrl && currentPageUrl() !== pageUrl) {
      // The page moved on while waiting; this ritual describes a document that is
      // no longer here, and the new one has its own trigger.
      return;
    }
    // Started synchronously so the page-world bridge is armed before anything else
    // this tick can look for it; the walk's outcome settles later.
    void runActivationStabilization(pageUrl).then((result) => {
      if (result && !result.skipped) {
        ritualRanForUrl = pageUrl;
        console.debug(`[Unfluffify][rewrite] Page-visit reveal/freeze ran (${cause})`);
        return;
      }
      console.debug(`[Unfluffify][rewrite] Page-visit reveal/freeze skipped (${cause}) — attempt kept`);
    }).catch(() => {
      // A failed walk has not prepared the page either, so the attempt stays free.
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
  void establishPageContext();
  contentAuthority = authorityFromLockState(parsed.data);
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
  const handleClick = (event: MouseEvent): void => {
    if (!markingActive || !markingEngine) {
      return;
    }
    const mode = markModeForClick(event);
    if (mode === "passthrough") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = markingEngine.resolveAtPoint(event.clientX, event.clientY, mode, event.shiftKey);
    if (!target) {
      return;
    }
    markingEngine.toggle(target, mode);
    userToggleCount += 1;
    reportMarkingToggle();
  };
  const handleMouseMove = (event: MouseEvent): void => {
    if (!markingActive || !markingEngine) {
      return;
    }
    markingEngine.hoverAtPoint(event.clientX, event.clientY);
  };
  const handleMouseLeave = (): void => markingEngine?.clearHover();
  const handleKeyDown = (event: KeyboardEvent): void => setSpacePassthrough(event, true);
  const handleKeyUp = (event: KeyboardEvent): void => setSpacePassthrough(event, false);
  const resetPassthrough = (): void => {
    const wasActive = spacePassthroughActive;
    spacePassthroughActive = false;
    if (wasActive) {
      refreshActiveMarking();
    }
  };
  document.addEventListener("click", handleClick, true);
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("mouseleave", handleMouseLeave, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);
  if (typeof window !== "undefined") {
    window.addEventListener("blur", resetPassthrough);
  }
  document.addEventListener("visibilitychange", resetPassthrough, true);
  removeMarkingListeners = () => {
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("mouseleave", handleMouseLeave, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keyup", handleKeyUp, true);
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", resetPassthrough);
    }
    document.removeEventListener("visibilitychange", resetPassthrough, true);
    removeMarkingListeners = null;
    spacePassthroughActive = false;
  };
}

function deactivateMarking(): void {
  markingActive = false;
  userToggleCount = 0;
  selectorsSeeded = false;
  removeNavigationGate?.();
  markingInteractionsPaused = false;
  spaGuard.disarm();
  destroyPageWorldSession();
  removeMarkingListeners?.();
  markingEngine?.dispose();
  markingEngine = null;
}

function pauseMarkingInteractions(): boolean {
  markingInteractionsPaused = true;
  if (!markingActive) {
    return false;
  }
  removeMarkingListeners?.();
  return true;
}

function resumeMarkingInteractions(): boolean {
  if (contentAuthority.lockBlocked || contentPresentation.markingEditsBlocked) {
    return false;
  }
  markingInteractionsPaused = false;
  if (!markingActive) {
    return false;
  }
  ensureMarkingListeners();
  return true;
}

function handleUrlChanged(nextUrl?: string): void {
  const currentUrl = nextUrl || (typeof location !== "undefined" ? location.href : "");
  if (!currentUrl || currentUrl === lastKnownPageUrl) {
    return;
  }
  const previousUrl = lastKnownPageUrl;
  lastKnownPageUrl = currentUrl;
  spaGuard.onUrlChange(currentUrl);
  // A same-document navigation keeps this script alive, so the sweep has to be
  // re-armed for the new URL — the next page's consent chrome is a fresh mount and
  // the observer is watching a document that has been rewritten underneath it.
  stopConsentObserver();
  pageContextProbedUrl = "";
  ritualRanForUrl = "";
  ritualPendingForUrl = "";
  revealController.resetForNavigation();
  void establishPageContext();
  if (!markingActive) {
    return;
  }
  deactivateMarking();
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
  markingEngine?.dispose();
  destroyPageWorldSession();
  markingEngine = createMarkingEngine(document.documentElement);
  userToggleCount = 0;
  selectorsSeeded = false;
  lastKnownPageUrl = typeof location !== "undefined" ? location.href : lastKnownPageUrl;
  markingEngine.refresh();
  markingEngine.renderReadOnly();
  if (activation.state().silentHighlightArmed) {
    markingEngine.renderSilentHighlights?.();
  }
  markingActive = true;
  ensureMarkingListeners();
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
    lastKnownPageUrl = nextPageUrl || lastKnownPageUrl;
    if (!markingActive) {
      userToggleCount = 0;
    }
    markingEngine ??= createMarkingEngine(document.documentElement);
    markingEngine.refresh();
    // A clean session starts from the defaults with the AI selectors laid over
    // them. Only once, and only while the operator has not marked anything: after
    // this the selectors play no further part.
    const selectors = selectorSetFrom(request);
    if (selectors && !selectorsSeeded && !isUserMarkingDirty()) {
      selectorsSeeded = markingEngine.seedFromSelectors(selectors);
    }
    markingEngine.renderReadOnly();
    if (activation.state().silentHighlightArmed) {
      markingEngine.renderSilentHighlights?.();
    }
    markingActive = true;
    ensureMarkingListeners();
    armNavigationGate();
  }
  return { ok: true, initialized: true, tree: "rewrite" };
}

/** Silent mode: show what the stored selectors keep, without arming marking.
 *  Read-only by construction — no listeners, no dirty flag, no navigation gate —
 *  so nothing here is a user marking. */
function applySilentSelectors(payload: unknown): Record<string, unknown> {
  if (typeof document === "undefined" || !document.documentElement) {
    return { ok: false, reason: "no-document", tree: "rewrite" };
  }
  if (markingActive) {
    // A live session owns the overlay; overwriting it would discard real marks.
    return { ok: false, reason: "marking-active", tree: "rewrite" };
  }
  const selectors = selectorSetFrom(payloadObject(payload));
  markingEngine?.dispose();
  markingEngine = createMarkingEngine(document.documentElement);
  markingEngine.refresh();
  const seeded = selectors ? markingEngine.seedFromSelectors(selectors) : false;
  const highlighted = markingEngine.renderSilentHighlights();
  return { ok: true, seeded, highlighted: highlighted.length, tree: "rewrite" };
}

function clearSilentSelectors(): Record<string, unknown> {
  if (markingActive) {
    return { ok: false, reason: "marking-active", tree: "rewrite" };
  }
  markingEngine?.clearOverlays();
  markingEngine?.dispose();
  markingEngine = null;
  return { ok: true, tree: "rewrite" };
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
      activateContentMain,
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
      resetContentMain: () => ({ ok: resetMarking(), initialized: true, tree: "rewrite" }),
      applySilentSelectors,
      clearSilentSelectors: () => clearSilentSelectors(),
      /** Asked for by the popup when a render mode has just been established and the
       *  operator has left the inspection: until then there was nothing worth
       *  preparing, and the inspection's own reloads would have wasted the one
       *  ritual this visit gets. Re-probes first, because setting the mode is
       *  exactly what changes the answer the page-load probe got. */
      preparePageVisit: async () => {
        pageContextProbedUrl = "";
        await establishPageContext({ ritualRequiresCandidate: false });
        return { ok: true, prepared: ritualRanForUrl === currentPageUrl() };
      },
    },
    pingActivity: pingContentActivity,
  });
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    installNavigationWatcher();
    getContentBus().onCommand("command.dispatch", (command) => createContentRouter().dispatch(command));
    ensureContentSignalPolling();
    // A content script can be reinjected while the tab's lock state is unchanged.
    // Announce the new consumer so background can replay its current authority
    // once, without restoring the popup's old 500ms presentation push.
    void reportContentFact("content-started", {}).catch((error: unknown) => {
      console.error("[Unfluffify][rewrite] Unable to announce content consumer", error);
    });
    // Page-load behaviours, asked for at page load rather than when a popup opens.
    void establishPageContext();
  },
});
