import { defineContentScript } from "wxt/utils/define-content-script";

import { browser, getInstalledBrowserApi } from "../common/browser";
import { createActivationGate } from "../content/activation";
import {
  createContentCommandRouter,
  createDefaultContentDirective,
  mergeContentDirective,
  type ContentDirectivePatch,
  type ContentDirectiveState,
} from "../content/command-router";
import { createMarkingEngine } from "../content/marking";
import { createFreezeController, createRevealVisitController, createSpaGuard } from "../content/stabilization";
import type { BrainSignal } from "../domain/schema/signals";
import type { CommandEnvelope } from "../messaging/contracts";
import { createRealmBus } from "../messaging/realms";
import { createRuntimeTransport } from "../messaging/transports/runtime";
import { emitRewriteSignal, type RewriteSignalBus } from "../messaging/rewrite-signals";

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
let contentDirective: ContentDirectiveState = createDefaultContentDirective(lastKnownPageUrl);
/** Selectors seed a clean session once and then stop mattering; this guards the
 *  "once" across re-activations of the same session. */
let selectorsSeeded = false;
let removeNavigationGate: (() => void) | null = null;
let directiveRoot: HTMLElement | null = null;

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

function refreshActiveMarking(): void {
  if (!markingActive || !markingEngine) {
    return;
  }
  markingEngine.refresh();
  markingEngine.renderReadOnly();
}

function runActivationStabilization(pageUrl: string): void {
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
  postPageCommand("ARM", {});
  void revealController.run({
    hasVerticalScrollRoom: typeof document !== "undefined" && typeof window !== "undefined"
      ? document.documentElement.scrollHeight > window.innerHeight
      : false,
    activationStale: pageUrl !== (typeof location !== "undefined" ? location.href : pageUrl),
    initialScrollHeight: typeof document !== "undefined" ? document.documentElement.scrollHeight : 0,
    expandedScrollHeight: typeof document !== "undefined" ? document.documentElement.scrollHeight : undefined,
    scrollTo(position) {
      if (typeof window === "undefined") {
        return;
      }
      if (position === "top") window.scrollTo(0, 0);
      if (position === "half") window.scrollTo(0, Math.floor((document.documentElement.scrollHeight || 0) / 2));
      if (position === "bottom") window.scrollTo(0, document.documentElement.scrollHeight || 0);
      if (position === "restore") window.scrollTo(0, initialScrollY);
    },
    suppressLazyLoading() {
      postPageCommand("SET_LAZY_LOADING_SUPPRESSED", { suppressed: true });
    },
    freezeAtBottom() {
      freezeController.pause("page-visit");
      postPageCommand("SET_MOTION_PAUSED", { paused: true });
    },
  }).catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Page stabilization failed", error);
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

function emitContentBrainSignal(name: BrainSignal["name"], cause: string, payload: BrainSignal["payload"]): void {
  void emitRewriteSignal(getContentBus(), 0, {
      name,
      source: "content",
      cause,
      payload,
  }).catch((error: unknown) => {
    console.error("[Unfluffify][rewrite] Unable to emit content signal", error);
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
        lockRole: contentDirective.lockRole,
        configPresent: contentDirective.configPresent,
        reconciliationPending: contentDirective.reconciliationPending,
        ...facts,
      },
    },
  }, { target: "background" });
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

function ensureDirectiveRoot(): HTMLElement | null {
  if (typeof document === "undefined" || !document.documentElement) {
    return null;
  }
  if (directiveRoot?.isConnected) {
    return directiveRoot;
  }
  directiveRoot = document.createElement("div");
  directiveRoot.setAttribute("data-uf-content-directive-root", "true");
  directiveRoot.style.position = "fixed";
  directiveRoot.style.inset = "0";
  directiveRoot.style.pointerEvents = "none";
  directiveRoot.style.zIndex = "2147483646";
  document.documentElement.appendChild(directiveRoot);
  return directiveRoot;
}

function renderDirectiveSurface(): void {
  const root = ensureDirectiveRoot();
  if (!root) {
    return;
  }
  root.replaceChildren();
  const blockedReason = contentDirective.content.blockedReason;
  const curtain = contentDirective.content.curtain;
  const banner = contentDirective.content.banner;
  const showCurtain = curtain.visible || contentDirective.content.markingEditsBlocked;
  if (showCurtain) {
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

function applyContentDirective(patch: ContentDirectivePatch): ContentDirectiveState {
  contentDirective = mergeContentDirective(contentDirective, patch);
  if (contentDirective.content.markingEditsBlocked) {
    pauseMarkingInteractions();
  } else if (markingInteractionsPaused) {
    resumeMarkingInteractions();
  }
  renderDirectiveSurface();
  return contentDirective;
}

function ensureMarkingListeners(): void {
  if (contentDirective.content.markingEditsBlocked || markingInteractionsPaused || removeMarkingListeners || typeof document === "undefined") {
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
  directiveRoot?.remove();
  directiveRoot = null;
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
  if (contentDirective.content.markingEditsBlocked) {
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
  if (!markingActive) {
    return;
  }
  deactivateMarking();
  emitContentBrainSignal("session.navigated", "content-url-change", {
    fromUrl: previousUrl,
    toUrl: currentUrl,
    pageUrl: currentUrl,
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
  runActivationStabilization(nextPageUrl);
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
    directive: contentDirective,
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
  const renderMode = capture.renderMode === "static" ? "static" : contentDirective.content.renderMode;
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
        directive: contentDirective,
      };
    },
    handlers: {
      activateContentMain,
      getContentMainStatus: () => contentStatus(),
      pauseContentMainInteractions: () => ({ ok: pauseMarkingInteractions(), active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite" }),
      resumeContentMainInteractions: () => contentDirective.content.markingEditsBlocked
        ? { ok: false, active: markingActive, dirty: isUserMarkingDirty(), tree: "rewrite", reason: "directive-blocked" }
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
    },
    applyDirective: applyContentDirective,
    pingActivity: pingContentActivity,
  });
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    installNavigationWatcher();
    getContentBus().onCommand("command.dispatch", (command) => createContentRouter().dispatch(command));
  },
});
