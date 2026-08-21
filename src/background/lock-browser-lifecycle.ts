import type { PropertyLockPresence } from "../lock";

export type LockTabTerminationReason = "navigation" | "tab-closed";

export type MainDocumentCommit = Readonly<{
  documentId: string | null;
  pageUrl: string | null;
}>;

type BrowserEvent<TListener> = Readonly<{
  addListener(listener: TListener): void;
}>;

type LockBrowserTab = Readonly<{
  id?: number;
  windowId?: number;
  active?: boolean;
}>;

export type LockBrowserApi = Readonly<{
  tabs?: Readonly<{
    query?(queryInfo: Readonly<{ active: boolean }>): Promise<LockBrowserTab[]>;
    onActivated?: BrowserEvent<(activeInfo: Readonly<{ tabId: number; windowId: number }>) => void>;
    onUpdated?: BrowserEvent<(
      tabId: number,
      changeInfo: Readonly<{ status?: string; url?: string }>,
      tab: LockBrowserTab,
    ) => void>;
    onRemoved?: BrowserEvent<(tabId: number) => void>;
  }>;
  windows?: Readonly<{
    getLastFocused?(): Promise<Readonly<{ id?: number }>>;
    onFocusChanged?: BrowserEvent<(windowId: number) => void>;
  }>;
  idle?: Readonly<{
    setDetectionInterval?(seconds: number): void;
    queryState?(seconds: number): Promise<"active" | "idle" | "locked">;
    onStateChanged?: BrowserEvent<(state: "active" | "idle" | "locked") => void>;
  }>;
  webNavigation?: Readonly<{
    onBeforeNavigate?: BrowserEvent<(details: Readonly<{
      tabId: number;
      frameId: number;
      url?: string;
    }>) => void>;
    onCommitted?: BrowserEvent<(details: Readonly<{
      tabId: number;
      frameId: number;
      documentId?: string;
      url?: string;
    }>) => void>;
    onHistoryStateUpdated?: BrowserEvent<(details: Readonly<{
      tabId: number;
      frameId: number;
      documentId?: string;
      url?: string;
    }>) => void>;
    onReferenceFragmentUpdated?: BrowserEvent<(details: Readonly<{
      tabId: number;
      frameId: number;
      documentId?: string;
      url?: string;
    }>) => void>;
    onErrorOccurred?: BrowserEvent<(details: Readonly<{
      tabId: number;
      frameId: number;
      url?: string;
      error?: string;
    }>) => void>;
  }>;
}>;

const IDLE_DETECTION_SECONDS = 60;

function suspensionReason(presence: Omit<PropertyLockPresence, "suspensionReason">): string | undefined {
  if (!presence.visible) {
    return "tab-hidden";
  }
  if (!presence.focusedWindow) {
    return "window-unfocused";
  }
  if (presence.browserIdle) {
    return "browser-idle";
  }
  return undefined;
}

/** Browser lifecycle is observed in the service worker, where it survives the
 * side panel. Unknown state fails closed: until the active tab, focused window,
 * and idle state have all been observed, no lock heartbeat can qualify. */
export function createLockBrowserLifecycle(input: Readonly<{
  api: LockBrowserApi;
  onPresenceChanged(tabId: number, presence: PropertyLockPresence): void;
  onMainDocumentNavigationStarted?(tabId: number, pageUrl: string | null): void;
  onMainDocumentNavigationFailed?(tabId: number, pageUrl: string | null): void;
  onMainDocumentCommitted?(tabId: number, documentId: string | null, pageUrl: string | null): void;
  onMainDocumentHistoryChanged?(tabId: number, documentId: string | null, pageUrl: string | null): void;
  onTabTerminated(
    tabId: number,
    reason: LockTabTerminationReason,
    commit?: MainDocumentCommit,
  ): Promise<void> | void;
}>) {
  const tabWindowById = new Map<number, number>();
  const activeTabByWindow = new Map<number, number>();
  const lastPresenceByTab = new Map<number, string>();
  let focusedWindowId: number | null = null;
  let browserIdle = true;
  let started = false;
  let tabEventVersion = 0;
  let focusEventVersion = 0;
  let idleEventVersion = 0;

  const presenceFor = (tabId: number): PropertyLockPresence => {
    const windowId = tabWindowById.get(tabId);
    const base = {
      visible: windowId !== undefined && activeTabByWindow.get(windowId) === tabId,
      focusedWindow: windowId !== undefined && focusedWindowId === windowId,
      browserIdle,
    };
    const reason = suspensionReason(base);
    return { ...base, ...(reason ? { suspensionReason: reason } : {}) };
  };

  const publish = (tabId: number): void => {
    const presence = presenceFor(tabId);
    const serialized = JSON.stringify(presence);
    if (lastPresenceByTab.get(tabId) === serialized) {
      return;
    }
    lastPresenceByTab.set(tabId, serialized);
    input.onPresenceChanged(tabId, presence);
  };

  const terminate = (
    tabId: number,
    reason: LockTabTerminationReason,
    commit?: MainDocumentCommit,
  ): void => {
    void Promise.resolve(input.onTabTerminated(tabId, reason, commit)).catch((error) => {
      console.error("[Unfluffify][rewrite] Unable to terminate tab-scoped lock state", error);
    });
  };

  return {
    presenceFor,
    async start(): Promise<void> {
      if (started) {
        return;
      }
      started = true;
      const { tabs, windows, idle, webNavigation } = input.api;

      tabs?.onActivated?.addListener(({ tabId, windowId }) => {
        tabEventVersion += 1;
        const previous = activeTabByWindow.get(windowId);
        activeTabByWindow.set(windowId, tabId);
        tabWindowById.set(tabId, windowId);
        if (previous !== undefined && previous !== tabId) {
          publish(previous);
        }
        publish(tabId);
      });
      tabs?.onUpdated?.addListener((tabId, _changeInfo, tab) => {
        tabEventVersion += 1;
        if (typeof tab.windowId === "number") {
          tabWindowById.set(tabId, tab.windowId);
          if (tab.active) {
            const previous = activeTabByWindow.get(tab.windowId);
            activeTabByWindow.set(tab.windowId, tabId);
            if (previous !== undefined && previous !== tabId) {
              publish(previous);
            }
          }
          publish(tabId);
        }
      });
      tabs?.onRemoved?.addListener((tabId) => {
        tabEventVersion += 1;
        const windowId = tabWindowById.get(tabId);
        tabWindowById.delete(tabId);
        lastPresenceByTab.delete(tabId);
        if (windowId !== undefined && activeTabByWindow.get(windowId) === tabId) {
          activeTabByWindow.delete(windowId);
        }
        terminate(tabId, "tab-closed");
      });
      windows?.onFocusChanged?.addListener((windowId) => {
        focusEventVersion += 1;
        const previousWindowId = focusedWindowId;
        focusedWindowId = windowId < 0 ? null : windowId;
        if (previousWindowId !== null) {
          const previousTabId = activeTabByWindow.get(previousWindowId);
          if (previousTabId !== undefined) publish(previousTabId);
        }
        if (focusedWindowId !== null) {
          const focusedTabId = activeTabByWindow.get(focusedWindowId);
          if (focusedTabId !== undefined) publish(focusedTabId);
        }
      });
      idle?.onStateChanged?.addListener((state) => {
        idleEventVersion += 1;
        browserIdle = state !== "active";
        for (const tabId of tabWindowById.keys()) {
          publish(tabId);
        }
      });
      webNavigation?.onBeforeNavigate?.addListener(({ tabId, frameId, url }) => {
        if (frameId === 0) {
          input.onMainDocumentNavigationStarted?.(
            tabId,
            typeof url === "string" && url ? url : null,
          );
        }
      });
      webNavigation?.onErrorOccurred?.addListener(({ tabId, frameId, url }) => {
        if (frameId === 0) {
          input.onMainDocumentNavigationFailed?.(
            tabId,
            typeof url === "string" && url ? url : null,
          );
        }
      });
      webNavigation?.onCommitted?.addListener(({ tabId, frameId, documentId, url }) => {
        if (frameId === 0) {
          // This event is Chrome's authoritative document boundary. Publish it
          // synchronously before any asynchronous cleanup so an old content
          // realm cannot present itself as the replacement document while the
          // cleanup operation is queued.
          const commit = {
            documentId: typeof documentId === "string" && documentId ? documentId : null,
            pageUrl: typeof url === "string" && url ? url : null,
          };
          input.onMainDocumentCommitted?.(tabId, commit.documentId, commit.pageUrl);
          terminate(tabId, "navigation", commit);
        }
      });
      const observeSameDocumentNavigation = ({
        tabId,
        frameId,
        documentId,
        url,
      }: Readonly<{
        tabId: number;
        frameId: number;
        documentId?: string;
        url?: string;
      }>): void => {
        if (frameId === 0) {
          const commit = {
            documentId: typeof documentId === "string" && documentId ? documentId : null,
            pageUrl: typeof url === "string" && url ? url : null,
          };
          input.onMainDocumentHistoryChanged?.(tabId, commit.documentId, commit.pageUrl);
          terminate(tabId, "navigation", commit);
        }
      };
      webNavigation?.onHistoryStateUpdated?.addListener(observeSameDocumentNavigation);
      webNavigation?.onReferenceFragmentUpdated?.addListener(observeSameDocumentNavigation);

      idle?.setDetectionInterval?.(IDLE_DETECTION_SECONDS);
      const initialTabVersion = tabEventVersion;
      const initialFocusVersion = focusEventVersion;
      const initialIdleVersion = idleEventVersion;
      const [activeTabsResult, focusedWindowResult, idleStateResult] = await Promise.allSettled([
        tabs?.query?.({ active: true }) ?? Promise.resolve([]),
        windows?.getLastFocused?.() ?? Promise.resolve({}),
        idle?.queryState?.(IDLE_DETECTION_SECONDS) ?? Promise.resolve("locked" as const),
      ]);
      if (
        focusedWindowResult.status === "fulfilled" &&
        focusEventVersion === initialFocusVersion &&
        "id" in focusedWindowResult.value &&
        typeof focusedWindowResult.value.id === "number"
      ) {
        focusedWindowId = focusedWindowResult.value.id;
      }
      if (idleStateResult.status === "fulfilled" && idleEventVersion === initialIdleVersion) {
        browserIdle = idleStateResult.value !== "active";
      }
      if (activeTabsResult.status === "fulfilled" && tabEventVersion === initialTabVersion) {
        for (const tab of activeTabsResult.value) {
          if (typeof tab.id !== "number" || typeof tab.windowId !== "number") {
            continue;
          }
          tabWindowById.set(tab.id, tab.windowId);
          activeTabByWindow.set(tab.windowId, tab.id);
        }
        for (const tab of activeTabsResult.value) {
          if (typeof tab.id === "number") publish(tab.id);
        }
      }
    },
  };
}
