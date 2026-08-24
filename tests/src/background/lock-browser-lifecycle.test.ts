import { describe, expect, it, vi } from "vitest";

import {
  createLockBrowserLifecycle,
  type LockBrowserApi,
  type LockTabTerminationReason,
} from "../../../src/background/lock-browser-lifecycle";
import type { PropertyLockPresence } from "../../../src/lock";

function event<TListener>() {
  let listener: TListener | null = null;
  return {
    api: {
      addListener(next: TListener) {
        listener = next;
      },
    },
    emit(...args: unknown[]) {
      (listener as ((...values: unknown[]) => void) | null)?.(...args);
    },
  };
}

describe("background property-lock browser lifecycle", () => {
  it("derives qualifying presence only for the selected tab in the focused, active browser", async () => {
    const activated = event<(info: { tabId: number; windowId: number }) => void>();
    const updated = event<(tabId: number, change: { status?: string; url?: string }, tab: { id: number; windowId: number; active: boolean }) => void>();
    const removed = event<(tabId: number) => void>();
    const focusChanged = event<(windowId: number) => void>();
    const idleChanged = event<(state: "active" | "idle" | "locked") => void>();
    const committed = event<(details: { tabId: number; frameId: number; documentId?: string }) => void>();
    const presences = new Map<number, PropertyLockPresence>();
    const presenceHistory: Array<{ tabId: number; presence: PropertyLockPresence }> = [];
    const terminations: Array<{ tabId: number; reason: LockTabTerminationReason }> = [];
    const committedDocuments: Array<{ tabId: number; documentId: string | null }> = [];
    const setDetectionInterval = vi.fn();
    const api: LockBrowserApi = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 11, windowId: 1, active: true },
          { id: 22, windowId: 2, active: true },
        ]),
        onActivated: activated.api,
        onUpdated: updated.api,
        onRemoved: removed.api,
      },
      windows: {
        getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
        onFocusChanged: focusChanged.api,
      },
      idle: {
        setDetectionInterval,
        queryState: vi.fn().mockResolvedValue("active"),
        onStateChanged: idleChanged.api,
      },
      webNavigation: { onCommitted: committed.api },
    };
    const lifecycle = createLockBrowserLifecycle({
      api,
      onPresenceChanged(tabId, presence) {
        presences.set(tabId, presence);
        presenceHistory.push({ tabId, presence });
      },
      onMainDocumentCommitted(tabId, documentId) {
        committedDocuments.push({ tabId, documentId });
      },
      onTabTerminated(tabId, reason) {
        terminations.push({ tabId, reason });
      },
    });

    await lifecycle.start();

    expect(setDetectionInterval).toHaveBeenCalledWith(60);
    expect(presences.get(11)).toEqual({
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });
    expect(presences.get(22)).toEqual({
      visible: true,
      focusedWindow: false,
      browserIdle: false,
      suspensionReason: "window-unfocused",
    });

    activated.emit({ tabId: 12, windowId: 1 });
    expect(presences.get(11)).toMatchObject({ visible: false, suspensionReason: "tab-hidden" });
    expect(presences.get(12)).toEqual({
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });

    focusChanged.emit(2);
    expect(presences.get(12)).toMatchObject({ focusedWindow: false, suspensionReason: "window-unfocused" });
    expect(presences.get(22)).toEqual({
      visible: true,
      focusedWindow: true,
      browserIdle: false,
    });

    idleChanged.emit("idle");
    expect(presences.get(22)).toMatchObject({ browserIdle: true, suspensionReason: "browser-idle" });
    expect(presenceHistory.length).toBeGreaterThan(4);

    updated.emit(22, { status: "loading" }, { id: 22, windowId: 2, active: true });
    committed.emit({ tabId: 22, frameId: 1 });
    committed.emit({ tabId: 22, frameId: 0, documentId: "document-b" });
    removed.emit(12);
    expect(committedDocuments).toEqual([{ tabId: 22, documentId: "document-b" }]);
    expect(terminations).toEqual([
      { tabId: 22, reason: "navigation" },
      { tabId: 12, reason: "tab-closed" },
    ]);
  });

  it("fails closed when browser presence APIs cannot establish state", async () => {
    const observed: PropertyLockPresence[] = [];
    const lifecycle = createLockBrowserLifecycle({
      api: {
        tabs: {
          query: vi.fn().mockResolvedValue([{ id: 7, windowId: 3, active: true }]),
        },
        windows: {
          getLastFocused: vi.fn().mockRejectedValue(new Error("unavailable")),
        },
        idle: {
          queryState: vi.fn().mockRejectedValue(new Error("unavailable")),
        },
      },
      onPresenceChanged(_tabId, presence) {
        observed.push(presence);
      },
      onTabTerminated() {},
    });

    await lifecycle.start();

    expect(observed).toEqual([{
      visible: true,
      focusedWindow: false,
      browserIdle: true,
      suspensionReason: "window-unfocused",
    }]);
  });

  it("ignores no-op same-document URL notifications but fences real route changes", async () => {
    const committed = event<(details: {
      tabId: number;
      frameId: number;
      documentId?: string;
      url?: string;
    }) => void>();
    const historyChanged = event<(details: {
      tabId: number;
      frameId: number;
      documentId?: string;
      url?: string;
    }) => void>();
    const fragmentChanged = event<(details: {
      tabId: number;
      frameId: number;
      documentId?: string;
      url?: string;
    }) => void>();
    const observed: Array<{ documentId: string | null; pageUrl: string | null }> = [];
    const terminations: Array<{ reason: LockTabTerminationReason; pageUrl: string | null }> = [];
    const lifecycle = createLockBrowserLifecycle({
      api: {
        webNavigation: {
          onCommitted: committed.api,
          onHistoryStateUpdated: historyChanged.api,
          onReferenceFragmentUpdated: fragmentChanged.api,
        },
      },
      onPresenceChanged() {},
      onMainDocumentHistoryChanged(_tabId, documentId, pageUrl) {
        observed.push({ documentId, pageUrl });
      },
      onTabTerminated(_tabId, reason, commit) {
        terminations.push({ reason, pageUrl: commit?.pageUrl ?? null });
      },
    });
    await lifecycle.start();

    committed.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-a",
      url: "https://www.dpj.se/",
    });
    terminations.length = 0;

    historyChanged.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-a",
      url: "https://www.dpj.se/",
    });
    fragmentChanged.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-a",
      url: "https://www.dpj.se/#products",
    });
    expect(observed).toEqual([]);
    expect(terminations).toEqual([]);

    historyChanged.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-a",
      url: "https://www.dpj.se/search?q=desk",
    });
    expect(observed).toEqual([{
      documentId: "document-a",
      pageUrl: "https://www.dpj.se/search?q=desk",
    }]);
    expect(terminations).toEqual([{
      reason: "navigation",
      pageUrl: "https://www.dpj.se/search?q=desk",
    }]);
  });
});
