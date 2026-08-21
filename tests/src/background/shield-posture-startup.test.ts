import { afterEach, describe, expect, it, vi } from "vitest";

import type { BusFrame } from "../../../src/messaging/contract";

const CONFIG = {
  version: 2,
  environmentKey: "stage.example.com",
  siteId: 42,
  baseUrl: "https://example.com",
  propertyRevision: 1,
  feedRevision: 1,
  membershipFingerprint: "membership",
  assignmentFingerprint: "assignment",
  renderMode: "rendered",
  renderModeUpdatedAt: "2026-08-21T10:00:00Z",
  selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
  selectorsUpdatedAt: "2026-08-21T10:00:00Z",
  submittedSelectorsFingerprint: "selectors",
  pages: {},
  reconciliation: {
    revision: 1,
    feedFingerprint: "feed",
    removedPageKeys: [],
    relabelledPages: [],
  },
};

describe("P15 shipped background shield messaging", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("atomically binds page.context, accepts fenced updates, and re-adopts silent selectors after navigation", async () => {
    const originalFetch = globalThis.fetch;
    let navigationCommitted: ((details: {
      tabId: number;
      frameId: number;
      documentId?: string;
    }) => void) | undefined;
    let configExists = true;
    let contextFailure: "authentication_required" | "access_denied" | "upstream_unavailable" | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/account/login")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      if (url.endsWith("/context")) {
        if (contextFailure) {
          return new Response(JSON.stringify({
            status: contextFailure,
            environmentKey: "stage.example.com",
            siteId: null,
            baseUrl: null,
            pageKey: null,
            pageTypes: [],
            membershipFingerprint: null,
            assignmentFingerprint: null,
            conflicts: [],
            upstreamCode: null,
          }), { status: 401 });
        }
        return new Response(JSON.stringify({
          status: "managed_non_candidate",
          environmentKey: "stage.example.com",
          siteId: 42,
          baseUrl: "https://example.com",
          pageKey: "/jobs/1",
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
        }), { status: 200 });
      }
      if (url.endsWith("/load")) {
        return configExists
          ? new Response(JSON.stringify(CONFIG), { status: 200 })
          : new Response("{}", { status: 404 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const addMessageListener = vi.fn();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: addMessageListener },
      },
      action: { onClicked: { addListener: vi.fn() } },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
      webNavigation: {
        onCommitted: {
          addListener(listener: (details: {
            tabId: number;
            frameId: number;
            documentId?: string;
          }) => void) {
            navigationCommitted = listener;
          },
        },
      },
    } as unknown as typeof chrome;

    try {
      const { startRewriteBackground } = await import("../../../src/background/index");
      startRewriteBackground();
      const listener = addMessageListener.mock.calls[0]?.[0] as (
        frame: BusFrame,
        sender: { tab?: { id?: number }; frameId?: number; documentId?: string },
        sendResponse: (reply: BusFrame) => void,
      ) => boolean;
      let seq = 0;
      const call = (
        name: string,
        payload: unknown,
        source: "content" | "popup",
        documentId?: string,
      ): Promise<BusFrame> => new Promise((resolve) => {
        seq += 1;
        const keepOpen = listener({
          kind: "uf-bus/1",
          frameType: "request",
          id: `request-${seq}`,
          seq,
          name,
          source,
          sourceInstance: `${source}:test`,
          target: "background",
          payload,
        }, source === "content"
          ? { tab: { id: 7 }, frameId: 0, documentId }
          : {}, resolve);
        expect(keepOpen).toBe(true);
      });

      await call("settings.save", {
        stageBase: "stage.example.com",
        configEndpoint: "https://hub.example.com",
      }, "popup");
      await call("accounts.login", { email: "user@example.com", password: "pw" }, "popup");

      const firstContext = await call("page.context", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-a");
      expect(firstContext).toMatchObject({
        ok: true,
        payload: {
          status: "managed_non_candidate",
          shieldPosture: {
            status: "inactive",
            revision: 1,
            scope: {
              environmentKey: "stage.example.com",
              siteId: 42,
              pageUrl: "https://example.com/jobs/1",
            },
          },
        },
      });
      const firstPosture = (firstContext.payload as {
        shieldPosture: { revision: number; scope: Record<string, unknown> };
      }).shieldPosture;
      const setSilent = await call("shield.posture.set", {
        expected: { ...firstPosture.scope, revision: firstPosture.revision },
        posture: { kind: "silent-selectors", selectors: CONFIG.selectors },
      }, "content", "doc-a");
      expect(setSilent).toMatchObject({
        ok: true,
        payload: {
          status: "ok",
          posture: {
            status: "active",
            directive: { organ: { state: "silent" }, silentSelectors: CONFIG.selectors },
          },
        },
      });

      navigationCommitted?.({ tabId: 7, frameId: 0, documentId: "doc-b" });
      for (let tick = 0; tick < 10; tick += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const reloadedContext = await call("page.context", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-b");
      expect(reloadedContext).toMatchObject({
        ok: true,
        payload: {
          shieldPosture: {
            status: "active",
            directive: { organ: { state: "silent" }, silentSelectors: CONFIG.selectors },
          },
        },
      });

      const staleSet = await call("shield.posture.set", {
        expected: { ...firstPosture.scope, revision: firstPosture.revision },
        posture: { kind: "preview", origin: "silent" },
      }, "content", "doc-a");
      expect(staleSet).toMatchObject({
        ok: true,
        payload: { status: "stale" },
      });

      for (const [upstreamStatus, projectedStatus] of [
        ["authentication_required", "authentication_required"],
        ["access_denied", "access_denied"],
        ["upstream_unavailable", "unavailable"],
      ] as const) {
        contextFailure = upstreamStatus;
        await expect(call("page.context", {
          pageUrl: "https://example.com/jobs/1",
          refresh: true,
        }, "content", "doc-b")).resolves.toMatchObject({
          ok: true,
          payload: {
            status: projectedStatus,
            draftDisposition: "preserve",
            shieldPosture: {
              status: "active",
              directive: { organ: { state: "silent" }, silentSelectors: CONFIG.selectors },
            },
          },
        });
      }

      const beforeRemoval = await call("shield.posture.current", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-b");
      const removalFence = (beforeRemoval.payload as {
        revision: number;
        scope: Record<string, unknown>;
      });

      configExists = false;
      await expect(call("config.load", { siteId: 42 }, "popup")).resolves.toMatchObject({
        ok: true,
        payload: { status: "not_found" },
      });
      await expect(call("shield.posture.current", {
        pageUrl: "https://example.com/jobs/1",
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unavailable", reason: "config-removed" },
      });
      await expect(call("shield.posture.set", {
        expected: { ...removalFence.scope, revision: removalFence.revision },
        posture: { kind: "silent-selectors", selectors: CONFIG.selectors },
      }, "content", "doc-b")).resolves.toMatchObject({
        ok: true,
        payload: { status: "unbound", reason: "config-removed" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
