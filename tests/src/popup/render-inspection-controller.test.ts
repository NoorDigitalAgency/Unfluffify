import { describe, expect, it, vi } from "vitest";

import {
  RENDER_INSPECTION_DURABLE_TIMEOUT_MS,
  type RenderInspectionCurrentResponse,
  type RenderInspectionMutationResponse,
  type RenderInspectionSession,
  type RenderInspectionStartResponse,
} from "../../../src/messaging/render-inspection";
import {
  RENDER_MODE_INSPECTION_WATCHDOG_MS,
  watchRenderModeInspection,
} from "../../../src/popup/render-mode-inspection";
import {
  createPopupRenderInspectionController,
  type PopupRenderInspectionOwner,
  type PopupRenderInspectionPorts,
  type RenderInspectionPortResult,
} from "../../../src/popup/render-inspection-controller";

const PROPERTY = {
  environmentKey: "stage.example.com",
  siteId: 42,
  baseUrl: "https://example.com",
} as const;

const OWNER_A: PopupRenderInspectionOwner = {
  tabId: 77,
  requestKey: "77:https://example.com/a",
  pageUrl: "https://example.com/a",
};

function session(overrides: Partial<RenderInspectionSession> = {}): RenderInspectionSession {
  return {
    token: "inspection-1",
    generation: 1,
    phase: "arming",
    property: PROPERTY,
    pageUrl: OWNER_A.pageUrl,
    javascriptEnabled: false,
    documentId: null,
    documentNonce: null,
    startedAt: 10,
    updatedAt: 10,
    deadlineAt: 30_000,
    terminalReason: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(overrides: Partial<PopupRenderInspectionPorts> = {}) {
  let currentRequestKey = OWNER_A.requestKey;
  const current = vi.fn(async (): Promise<RenderInspectionPortResult<RenderInspectionCurrentResponse>> => ({
    ok: true,
    data: { status: "inactive" },
  }));
  const start = vi.fn(async (): Promise<RenderInspectionPortResult<RenderInspectionStartResponse>> => ({
    ok: true,
    data: { status: "started", session: session() },
  }));
  const cancel = vi.fn(async (): Promise<RenderInspectionPortResult<RenderInspectionMutationResponse>> => ({
    ok: true,
    data: { status: "inactive" },
  }));
  const refreshAfterPaint = vi.fn(async () => undefined);
  const recordActivity = vi.fn();
  const onChange = vi.fn();
  const onError = vi.fn();
  const ports: PopupRenderInspectionPorts = {
    current,
    start,
    cancel,
    isCurrent: (owner) => owner.requestKey === currentRequestKey,
    refreshAfterPaint,
    recordActivity,
    onChange,
    onError,
    now: () => 20,
    waitForPoll: async () => undefined,
    watch: async (run) => ({ status: "settled", value: await run() }),
    ...overrides,
  };
  return {
    controller: createPopupRenderInspectionController(ports),
    current,
    start,
    cancel,
    refreshAfterPaint,
    recordActivity,
    onChange,
    onError,
    setCurrentRequestKey(value: string) {
      currentRequestKey = value;
    },
  };
}

describe("popup render-inspection controller", () => {
  it("adopts only a matching terminal paint and detaches reconciliation", async () => {
    const terminal = session({
      phase: "terminal",
      updatedAt: 20,
      terminalReason: "paint-acknowledged",
    });
    const harness = createHarness({
      current: vi.fn(async () => ({
        ok: true as const,
        data: { status: "terminal" as const, session: terminal },
      })),
    });

    await expect(harness.controller.observe(OWNER_A, PROPERTY)).resolves.toBe("terminal");
    expect(harness.controller.snapshot()).toMatchObject({
      session: terminal,
      view: "without_javascript",
      busy: false,
      detail: "",
    });
    expect(harness.recordActivity).toHaveBeenCalledWith(
      "Render-mode view loaded",
      "without JavaScript",
      "success",
    );
    expect(harness.refreshAfterPaint).toHaveBeenCalledWith(OWNER_A);
  });

  it("treats an authoritative mismatched current session as inactive", async () => {
    const harness = createHarness({
      current: vi.fn(async () => ({
        ok: true as const,
        data: {
          status: "active" as const,
          session: session({ pageUrl: "https://example.com/other" }),
        },
      })),
    });

    await expect(harness.controller.observe(OWNER_A, PROPERTY)).resolves.toBe("inactive");
    expect(harness.controller.snapshot()).toMatchObject({
      session: null,
      view: "unknown",
      busy: false,
    });
  });

  it("fences a delayed old current read across binding reset and replacement adoption", async () => {
    const oldRead = deferred<RenderInspectionPortResult<RenderInspectionCurrentResponse>>();
    const ownerB: PopupRenderInspectionOwner = {
      tabId: 77,
      requestKey: "77:https://example.com/b",
      pageUrl: "https://example.com/b",
    };
    const replacement = session({
      token: "inspection-b",
      generation: 2,
      pageUrl: ownerB.pageUrl,
      phase: "terminal",
      updatedAt: 30,
      terminalReason: "reload-acknowledged",
      javascriptEnabled: true,
    });
    const current = vi.fn()
      .mockImplementationOnce(async () => await oldRead.promise)
      .mockResolvedValueOnce({
        ok: true,
        data: { status: "terminal", session: replacement },
      });
    const harness = createHarness({ current });

    const stale = harness.controller.observe(OWNER_A, PROPERTY);
    await vi.waitFor(() => expect(current).toHaveBeenCalledOnce());
    harness.controller.bindingChanged();
    harness.setCurrentRequestKey(ownerB.requestKey);
    await expect(harness.controller.observe(ownerB, PROPERTY)).resolves.toBe("terminal");
    oldRead.resolve({ ok: true, data: { status: "inactive" } });

    await expect(stale).resolves.toBe("stale");
    expect(harness.controller.snapshot()).toMatchObject({
      session: replacement,
      view: "with_javascript",
    });
  });

  it("starts one generation and polls it through terminal acknowledgement", async () => {
    const active = session();
    const terminal = session({
      phase: "terminal",
      updatedAt: 20,
      terminalReason: "reload-acknowledged",
      javascriptEnabled: true,
    });
    const harness = createHarness({
      start: vi.fn(async () => ({
        ok: true as const,
        data: { status: "started" as const, session: active },
      })),
      current: vi.fn(async () => ({
        ok: true as const,
        data: { status: "terminal" as const, session: terminal },
      })),
    });

    await expect(harness.controller.start(OWNER_A, PROPERTY, true)).resolves.toBe("terminal");
    expect(harness.controller.snapshot()).toMatchObject({
      session: terminal,
      view: "with_javascript",
      busy: false,
    });
  });

  it("adopts a terminal reload after the former popup deadline but before durable authority expires", async () => {
    vi.useFakeTimers();
    try {
      expect(RENDER_MODE_INSPECTION_WATCHDOG_MS)
        .toBeGreaterThan(RENDER_INSPECTION_DURABLE_TIMEOUT_MS);
      const lateTerminalMs = RENDER_INSPECTION_DURABLE_TIMEOUT_MS - 1_000;
      expect(lateTerminalMs).toBeGreaterThan(20_000);
      const terminal = session({
        phase: "terminal",
        updatedAt: lateTerminalMs,
        deadlineAt: RENDER_INSPECTION_DURABLE_TIMEOUT_MS,
        terminalReason: "reload-acknowledged",
        javascriptEnabled: true,
      });
      const harness = createHarness({
        start: vi.fn(async () => await new Promise<RenderInspectionPortResult<RenderInspectionStartResponse>>(
          (resolve) => {
            setTimeout(() => resolve({
              ok: true,
              data: { status: "started", session: terminal },
            }), lateTerminalMs);
          },
        )),
        watch: watchRenderModeInspection,
      });

      const outcome = harness.controller.start(OWNER_A, PROPERTY, true);
      expect(harness.controller.snapshot()).toMatchObject({ busy: true, view: "unknown" });
      await vi.advanceTimersByTimeAsync(20_001);
      expect(harness.controller.snapshot()).toMatchObject({
        busy: true,
        view: "unknown",
        detail: "",
      });

      await vi.advanceTimersByTimeAsync(lateTerminalMs - 20_001);
      await expect(outcome).resolves.toBe("terminal");
      expect(harness.controller.snapshot()).toMatchObject({
        busy: false,
        view: "with_javascript",
        detail: "",
        watchdogReleased: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("projects an already-active start conflict without cancelling background authority", async () => {
    const active = session({ javascriptEnabled: false });
    const harness = createHarness({
      start: vi.fn(async () => ({
        ok: true as const,
        data: {
          status: "error" as const,
          reason: "inspection-already-active",
          session: active,
        },
      })),
    });

    await expect(harness.controller.start(OWNER_A, PROPERTY, true)).resolves.toBe("conflict");
    expect(harness.controller.snapshot()).toMatchObject({
      session: active,
      busy: false,
      watchdogReleased: true,
    });
    expect(harness.recordActivity).toHaveBeenCalledWith(
      "Render-mode view not started",
      "another inspection is already active",
      "warn",
    );
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("cancels only the exact active token and adopts its terminal successor", async () => {
    const active = session({ phase: "adopted", documentId: "doc", documentNonce: "nonce" });
    const cancelled = session({
      phase: "terminal",
      updatedAt: 21,
      terminalReason: "cancelled",
    });
    const current = vi.fn(async () => ({
      ok: true as const,
      data: { status: "active" as const, session: active },
    }));
    const cancel = vi.fn(async () => ({
      ok: true as const,
      data: { status: "ok" as const, session: cancelled },
    }));
    const harness = createHarness({ current, cancel });
    await harness.controller.observe(OWNER_A, PROPERTY);

    await harness.controller.cancel(OWNER_A);
    expect(cancel).toHaveBeenCalledWith({
      tabId: OWNER_A.tabId,
      token: active.token,
      generation: active.generation,
    });
    expect(harness.controller.snapshot()).toMatchObject({
      session: cancelled,
      busy: false,
    });
    expect(harness.controller.snapshot().detail).toContain("cancelled");
  });
});
