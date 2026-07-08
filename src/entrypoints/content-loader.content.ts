import { defineContentScript } from "wxt/utils/define-content-script";

import { browser, getInstalledBrowserApi } from "../common/browser";
import { createActivationGate } from "../content/activation";
import { createMarkingEngine } from "../content/marking";
import { createFreezeController, createRevealVisitController, createSpaGuard } from "../content/stabilization";
import type { BrainSignal } from "../domain/schema/signals";
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
let userMarkingDirty = false;
let spacePassthroughActive = false;
let removeMarkingListeners: (() => void) | null = null;
let navigationWatcherInstalled = false;
let lastKnownPageUrl = typeof location !== "undefined" ? location.href : "";
let contentBus: RewriteSignalBus | null = null;
let pageWorldSessionNonce = "";

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

function emitMarkingChanged(): void {
  emitContentBrainSignal("markings.changed", "content-click", {
    pageUrl: typeof location !== "undefined" ? location.href : "",
    markedCount: userMarkingDirty ? markingEngine?.rows().length ?? 0 : 0,
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

function ensureMarkingListeners(): void {
  if (removeMarkingListeners || typeof document === "undefined") {
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
    userMarkingDirty = true;
    emitMarkingChanged();
  };
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
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);
  if (typeof window !== "undefined") {
    window.addEventListener("blur", resetPassthrough);
  }
  document.addEventListener("visibilitychange", resetPassthrough, true);
  removeMarkingListeners = () => {
    document.removeEventListener("click", handleClick, true);
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
  userMarkingDirty = false;
  spaGuard.disarm();
  destroyPageWorldSession();
  removeMarkingListeners?.();
  markingEngine?.dispose();
  markingEngine = null;
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
  userMarkingDirty = false;
  lastKnownPageUrl = typeof location !== "undefined" ? location.href : lastKnownPageUrl;
  markingEngine.refresh();
  markingEngine.renderReadOnly();
  markingActive = true;
  ensureMarkingListeners();
  return true;
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    installNavigationWatcher();
    const runtimeBrowser = getRuntimeBrowser();
    runtimeBrowser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        return false;
      }
      const request = message as { type?: unknown; pageUrl?: unknown; realEditorActivation?: unknown; signal?: unknown };
      if (request.type === "activateContentMain") {
        const requestPageUrl = typeof request.pageUrl === "string" ? request.pageUrl : "";
        const currentPageUrl = typeof location !== "undefined" ? location.href : "";
        if (requestPageUrl && currentPageUrl && requestPageUrl !== currentPageUrl) {
          sendResponse({ ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" });
          return true;
        }
        activation.arm(
          requestPageUrl || currentPageUrl,
          request.realEditorActivation !== false,
        );
        runActivationStabilization(requestPageUrl || currentPageUrl);
        if (typeof document !== "undefined" && document.documentElement) {
          lastKnownPageUrl = requestPageUrl || currentPageUrl || lastKnownPageUrl;
          if (!markingActive) {
            userMarkingDirty = false;
          }
          markingEngine ??= createMarkingEngine(document.documentElement);
          markingEngine.refresh();
          markingEngine.renderReadOnly();
          markingActive = true;
          ensureMarkingListeners();
        }
        sendResponse({ ok: true, initialized: true, tree: "rewrite" });
        return true;
      }
      if (request.type === "getContentMainStatus") {
        sendResponse({
          ok: true,
          active: markingActive,
          dirty: userMarkingDirty,
          pageUrl: typeof location !== "undefined" ? location.href : "",
          markedCount: userMarkingDirty ? markingEngine?.rows().length ?? 0 : 0,
          tree: "rewrite",
        });
        return true;
      }
      if (request.type === "deactivateContentMain") {
        deactivateMarking();
        sendResponse({ ok: true, initialized: false, tree: "rewrite" });
        return true;
      }
      if (request.type === "resetContentMain") {
        sendResponse({ ok: resetMarking(), initialized: true, tree: "rewrite" });
        return true;
      }
      return false;
    });
  },
});
