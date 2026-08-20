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
import { createPhysicalActionDeduper, openMarkingContextMenu } from "../content/marking/interaction";
import {
  INITIAL_CONTENT_STATE,
  memoryForContent,
  transitionContentState,
  type ContentPresentation,
  type ContentState,
} from "../content/organ";
import { createFreezeController, createRevealVisitController, createSpaGuard } from "../content/stabilization";
import type { BrainSignal } from "../domain/schema/signals";
import type { LockActionKind } from "../domain/schema/facts";
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
let pageInspectionActive = false;
let contentToastText = "";
let contentToastClearHandle: ReturnType<typeof setTimeout> | null = null;
let contentInputBlockedReason = "";
let removeContentInputBlocker: (() => void) | null = null;
const CONTENT_SURFACE_STYLE_ID = "unfluffify-content-surface-style";
const CONTENT_INPUT_EVENTS = [
  "click",
  "auxclick",
  "dblclick",
  "contextmenu",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "pointermove",
  "keydown",
  "keyup",
  "keypress",
  "beforeinput",
  "input",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
  "dragstart",
  "dragover",
  "drop",
  "submit",
] as const;

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
  spaGuard.arm(pageUrl);
  destroyPageWorldSession();
  pageInspectionActive = true;
  lastContentSurfaceSignature = "";
  renderContentSurface();
  const initialScrollY = typeof window !== "undefined" ? window.scrollY : 0;
  const isStale = (): boolean => pageUrl !== (typeof location !== "undefined" ? location.href : pageUrl);
  const waitForSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1_000));
  try {
    const armed = await requestStabilizationPageCommand("ARM", {});
    pageWorldSessionNonce = armed.nonce;
    return await revealController.run({
      hasVerticalScrollRoom: typeof document !== "undefined" && typeof window !== "undefined"
        ? currentDocumentScrollHeight() > window.innerHeight + 2
        : false,
      activationStale: isStale,
      initialScrollHeight: currentDocumentScrollHeight(),
      measureExpandedScrollHeight: currentDocumentScrollHeight,
      async scrollTo(position, measuredScrollHeight) {
        if (typeof window === "undefined") {
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
        await requestStabilizationPageCommand(
          "SET_MOTION_PAUSED",
          { paused: true },
          pageWorldSessionNonce,
        );
        freezeController.pause("page-visit");
        lastContentSurfaceSignature = "";
        renderContentSurface();
      },
    });
  } catch (error) {
    console.error("[Unfluffify][rewrite] Page stabilization failed", error);
    return null;
  } finally {
    pageInspectionActive = false;
    lastContentSurfaceSignature = "";
    renderContentSurface();
  }
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
      showContentToast("Page interaction mode");
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
  max-width: min(560px, calc(100vw - 28px));
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(47, 42, 36, 0.9);
  color: #fdf6ed;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.2);
  pointer-events: none;
  font: 500 12px/1.4 Inter, system-ui, sans-serif;
  animation: uf-content-toast-in 0.2s ease both;
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

function blockedToastCopy(reason: string): string {
  return reason === "saving" || reason === "syncing" || reason === "sync_pending"
    ? "Finish server sync before editing"
    : "Marking temporarily paused";
}

function showContentToast(text: string): void {
  if (!text) {
    return;
  }
  contentToastText = text;
  if (contentToastClearHandle !== null) {
    clearTimeout(contentToastClearHandle);
  }
  lastContentSurfaceSignature = "";
  renderContentSurface();
  contentToastClearHandle = setTimeout(() => {
    contentToastClearHandle = null;
    contentToastText = "";
    lastContentSurfaceSignature = "";
    renderContentSurface();
  }, 1800);
}

function setContentInputBlocked(blocked: boolean, reason: string): void {
  contentInputBlockedReason = blocked ? reason : "";
  if (!blocked) {
    removeContentInputBlocker?.();
    return;
  }
  if (removeContentInputBlocker || typeof window === "undefined") {
    return;
  }
  const blockInput = (event: Event): void => {
    const target = event.target;
    if (
      target &&
      contentSurfaceRoot &&
      (target === contentSurfaceRoot || contentSurfaceRoot.contains(target as Node))
    ) {
      return;
    }
    if (event.cancelable !== false) {
      event.preventDefault();
    }
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (event.type === "click" && markingActive) {
      showContentToast(blockedToastCopy(contentInputBlockedReason));
    }
  };
  for (const type of CONTENT_INPUT_EVENTS) {
    window.addEventListener(type, blockInput, { capture: true, passive: false });
  }
  removeContentInputBlocker = () => {
    for (const type of CONTENT_INPUT_EVENTS) {
      window.removeEventListener(type, blockInput, true);
    }
    removeContentInputBlocker = null;
  };
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
  contentSurfaceRoot.style.zIndex = "2147483646";
  document.documentElement.appendChild(contentSurfaceRoot);
  lastContentSurfaceSignature = "";
  return contentSurfaceRoot;
}

function renderContentSurface(): void {
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
  const signature = JSON.stringify({ effectiveBlockedReason, curtain, banner, motionPaused, pausedNotice, contentToastText });
  const root = ensureContentSurfaceRoot();
  if (!root) {
    return;
  }
  root.style.pointerEvents = curtain.visible ? "auto" : "none";
  setContentInputBlocked(curtain.visible, effectiveBlockedReason);
  if (signature === lastContentSurfaceSignature) {
    return;
  }
  lastContentSurfaceSignature = signature;
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
              void getContentBus().request("lock.action", action, { target: "background" });
            });
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.setAttribute("data-uf-content-lock-confirm-cancel", "true");
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", (cancelEvent) => {
              cancelEvent.preventDefault();
              cancelEvent.stopPropagation();
              lastContentSurfaceSignature = "";
              renderContentSurface();
            });
            actions.appendChild(prompt);
            actions.appendChild(confirm);
            actions.appendChild(cancel);
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
  if (contentToastText) {
    const toast = document.createElement("aside");
    toast.setAttribute("data-uf-content-toast", "true");
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = contentToastText;
    root.appendChild(toast);
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
      showContentToast(`That area can't be marked${debugDetail}.`);
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
      showContentToast("That area can't be marked.");
      return;
    }
    closeMarkingMenu = openMarkingContextMenu({
      document,
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

function deactivateMarking(): void {
  markingActive = false;
  userToggleCount = 0;
  selectorsSeeded = false;
  removeNavigationGate?.();
  markingInteractionsPaused = false;
  spaGuard.disarm();
  destroyPageWorldSession();
  removeSilentDebugCopyListener?.();
  removeMarkingListeners?.();
  markingEngine?.dispose();
  markingEngine = null;
  if (contentToastClearHandle !== null) {
    clearTimeout(contentToastClearHandle);
    contentToastClearHandle = null;
  }
  contentToastText = "";
  syncMarkingCursor();
  lastContentSurfaceSignature = "";
  renderContentSurface();
}

function pauseMarkingInteractions(): boolean {
  markingInteractionsPaused = true;
  markingEngine?.setSuspended?.(true);
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
  removeSilentDebugCopyListener?.();
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
  lastContentSurfaceSignature = "";
  renderContentSurface();
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
    lastContentSurfaceSignature = "";
    renderContentSurface();
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
    const inspected = markingEngine.inspectAtPoint(event.clientX, event.clientY);
    if (!inspected) {
      return;
    }
    void navigator.clipboard.writeText(inspected.annotation).then(() => {
      showContentToast("Highlight details copied.");
    }).catch(() => {
      showContentToast("Unable to copy highlight details.");
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
  installSilentDebugCopy();
  return { ok: true, seeded, highlighted: highlighted.length, tree: "rewrite" };
}

function clearSilentSelectors(): Record<string, unknown> {
  if (markingActive) {
    return { ok: false, reason: "marking-active", tree: "rewrite" };
  }
  markingEngine?.clearOverlays();
  removeSilentDebugCopyListener?.();
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
