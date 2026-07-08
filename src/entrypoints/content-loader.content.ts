import { defineContentScript } from "wxt/utils/define-content-script";

import { browser, getInstalledBrowserApi } from "../common/browser";
import { createActivationGate } from "../content/activation";
import { createContentOrgan } from "../content/runtime";
import { createMarkingEngine } from "../content/marking";

const activation = createActivationGate();
const organ = createContentOrgan();
let markingEngine: ReturnType<typeof createMarkingEngine> | null = null;
let markingActive = false;
let userMarkingDirty = false;
let spacePassthroughActive = false;
let removeMarkingListeners: (() => void) | null = null;
let navigationWatcherInstalled = false;
let lastKnownPageUrl = typeof location !== "undefined" ? location.href : "";

function refreshActiveMarking(): void {
  if (!markingActive || !markingEngine) {
    return;
  }
  markingEngine.refresh();
  markingEngine.renderReadOnly();
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

function emitContentBrainSignal(name: string, cause: string, payload: Record<string, unknown>): void {
  const runtimeBrowser = getInstalledBrowserApi() ?? browser;
  if (typeof runtimeBrowser.runtime.sendMessage !== "function") {
    return;
  }
  void runtimeBrowser.runtime.sendMessage({
    type: "uf.rewriteBrain.emit",
    tabId: 0,
    signal: {
      name,
      source: "content",
      cause,
      payload,
    },
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
    const runtimeBrowser = getInstalledBrowserApi() ?? browser;
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
      if (request.type === "uf.rewrite.content.signal" && request.signal && typeof request.signal === "object") {
        organ.transition(request.signal as Parameters<typeof organ.transition>[0]);
        sendResponse({ ok: true, state: organ.state(), presentation: organ.render() });
        return true;
      }
      return false;
    });
  },
});
