import { describe, expect, it, vi } from "vitest";

import type { RenderInspectionSession } from "../../../src/messaging/render-inspection";
import {
  EMPTY_RENDER_INSPECTION_PROJECTION,
  projectInactiveRenderInspection,
  projectRenderInspectionSession,
  projectRenderInspectionWatchdog,
  watchRenderModeInspection,
} from "../../../src/popup/render-mode-inspection";

const BINDING = {
  pageUrl: "https://example.com/page",
  property: {
    environmentKey: "example.com",
    siteId: 1,
    baseUrl: "https://example.com",
  },
} as const;

function session(
  overrides: Partial<RenderInspectionSession> = {},
): RenderInspectionSession {
  return {
    token: "inspection-1",
    generation: 1,
    phase: "arming",
    property: BINDING.property,
    pageUrl: BINDING.pageUrl,
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

describe("render-mode inspection watchdog", () => {
  it("settles normally and clears its watchdog", async () => {
    vi.useFakeTimers();
    try {
      await expect(watchRenderModeInspection(async () => "ok", 50))
        .resolves.toEqual({ status: "settled", value: "ok" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases a stalled UI for retry and leaves no stale timer", async () => {
    vi.useFakeTimers();
    try {
      const result = watchRenderModeInspection(() => new Promise(() => undefined), 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toEqual({ status: "timeout" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("projects active work without inferring a view, then adopts the mode-specific acknowledgement", () => {
    const active = projectRenderInspectionSession(
      EMPTY_RENDER_INSPECTION_PROJECTION,
      session(),
      BINDING,
    );
    expect(active).toMatchObject({
      status: "updated",
      refreshLock: false,
      projection: { busy: true, view: "unknown", detail: "" },
    });

    const successful = projectRenderInspectionSession(
      active.projection,
      session({
        phase: "terminal",
        updatedAt: 20,
        terminalReason: "paint-acknowledged",
      }),
      BINDING,
    );
    expect(successful).toMatchObject({
      status: "updated",
      refreshLock: true,
      projection: {
        busy: false,
        view: "without_javascript",
        detail: "",
        watchdogReleased: false,
      },
    });

    const javascriptReload = projectRenderInspectionSession(
      EMPTY_RENDER_INSPECTION_PROJECTION,
      session({
        phase: "terminal",
        updatedAt: 21,
        terminalReason: "reload-acknowledged",
        javascriptEnabled: true,
      }),
      BINDING,
    );
    expect(javascriptReload).toMatchObject({
      status: "updated",
      refreshLock: true,
      projection: { busy: false, view: "with_javascript", detail: "" },
    });

    const impossibleStaticReload = projectRenderInspectionSession(
      EMPTY_RENDER_INSPECTION_PROJECTION,
      session({
        phase: "terminal",
        updatedAt: 22,
        terminalReason: "reload-acknowledged",
        javascriptEnabled: false,
      }),
      BINDING,
    );
    expect(impossibleStaticReload).toMatchObject({
      status: "updated",
      refreshLock: false,
      projection: { busy: false, view: "unknown" },
    });
    expect(impossibleStaticReload.projection.detail).not.toBe("");
  });

  it.each([
    "cancelled",
    "start-failed",
    "content-failed",
    "unexpected-navigation",
    "timeout",
    "unregistered",
    "tab-closed",
    "extension-invalidated",
  ] as const)("keeps the prior view for retryable terminal %s", (terminalReason) => {
    const previous = {
      ...EMPTY_RENDER_INSPECTION_PROJECTION,
      view: "with_javascript" as const,
      busy: true,
    };
    const result = projectRenderInspectionSession(
      previous,
      session({ phase: "terminal", updatedAt: 20, terminalReason }),
      BINDING,
    );

    expect(result.refreshLock).toBe(false);
    expect(result.projection.busy).toBe(false);
    expect(result.projection.view).toBe("with_javascript");
    expect(result.projection.detail).not.toBe("");
  });

  it("ignores stale generations, token collisions, phase regression, and another binding", () => {
    const terminal = projectRenderInspectionSession(
      EMPTY_RENDER_INSPECTION_PROJECTION,
      session({
        token: "inspection-2",
        generation: 2,
        phase: "terminal",
        updatedAt: 30,
        terminalReason: "paint-acknowledged",
      }),
      BINDING,
    ).projection;

    const candidates = [
      session({ generation: 1, updatedAt: 100 }),
      session({ token: "forged-same-generation", generation: 2, updatedAt: 100 }),
      session({ token: "inspection-2", generation: 2, updatedAt: 100 }),
      session({
        token: "inspection-3",
        generation: 3,
        pageUrl: "https://example.com/elsewhere",
      }),
      session({
        token: "inspection-3",
        generation: 3,
        property: { ...BINDING.property, siteId: 9 },
      }),
    ];

    for (const candidate of candidates) {
      const result = projectRenderInspectionSession(terminal, candidate, BINDING);
      expect(result.status).toBe("ignored");
      expect(result.projection).toBe(terminal);
    }
  });

  it("surfaces the one authoritative terminal successor without losing the confirmed view", () => {
    const painted = projectRenderInspectionSession(
      EMPTY_RENDER_INSPECTION_PROJECTION,
      session({
        token: "inspection-2",
        generation: 2,
        phase: "terminal",
        updatedAt: 30,
        terminalReason: "paint-acknowledged",
      }),
      BINDING,
    ).projection;

    for (const rejected of [
      session({
        token: "inspection-2",
        generation: 2,
        phase: "terminal",
        updatedAt: 30,
        terminalReason: "unexpected-navigation",
      }),
      session({
        token: "inspection-2",
        generation: 2,
        phase: "terminal",
        javascriptEnabled: true,
        updatedAt: 31,
        terminalReason: "paint-acknowledged",
      }),
    ]) {
      const result = projectRenderInspectionSession(painted, rejected, BINDING);
      expect(result.status).toBe("ignored");
      expect(result.projection).toBe(painted);
    }

    const invalidated = projectRenderInspectionSession(
      painted,
      session({
        token: "inspection-2",
        generation: 2,
        phase: "terminal",
        updatedAt: 31,
        terminalReason: "unexpected-navigation",
      }),
      BINDING,
    );

    expect(invalidated).toMatchObject({
      status: "updated",
      refreshLock: false,
      projection: {
        busy: false,
        view: "without_javascript",
        watchdogReleased: false,
      },
    });
    expect(invalidated.projection.detail).toContain("navigated somewhere else");

    for (const rejected of [
      session({
        token: "inspection-2",
        generation: 2,
        phase: "terminal",
        updatedAt: 32,
        terminalReason: "paint-acknowledged",
      }),
      session({
        token: "inspection-2",
        generation: 2,
        phase: "terminal",
        updatedAt: 32,
        terminalReason: "content-failed",
      }),
    ]) {
      const result = projectRenderInspectionSession(invalidated.projection, rejected, BINDING);
      expect(result.status).toBe("ignored");
      expect(result.projection).toBe(invalidated.projection);
    }
  });

  it("keeps watchdog release popup-local and lets a later terminal snapshot win", () => {
    const active = projectRenderInspectionSession(
      EMPTY_RENDER_INSPECTION_PROJECTION,
      session(),
      BINDING,
    ).projection;
    const released = projectRenderInspectionWatchdog(active);

    expect(released).toMatchObject({
      session: active.session,
      busy: false,
      view: "unknown",
      watchdogReleased: true,
    });
    const stillActive = projectRenderInspectionSession(
      released,
      session({ phase: "awaiting_document", updatedAt: 11 }),
      BINDING,
    ).projection;
    expect(stillActive).toMatchObject({ busy: false, watchdogReleased: true });

    const terminal = projectRenderInspectionSession(
      stillActive,
      session({
        phase: "terminal",
        updatedAt: 12,
        terminalReason: "reload-acknowledged",
        javascriptEnabled: true,
      }),
      BINDING,
    ).projection;
    expect(terminal).toMatchObject({
      busy: false,
      watchdogReleased: false,
      view: "with_javascript",
    });
  });

  it("clears every active and successful inference on authoritative inactivity", () => {
    const prior = projectRenderInspectionSession(
      EMPTY_RENDER_INSPECTION_PROJECTION,
      session({
        phase: "terminal",
        terminalReason: "paint-acknowledged",
      }),
      BINDING,
    ).projection;

    expect(prior.view).toBe("without_javascript");
    expect(projectInactiveRenderInspection()).toEqual(EMPTY_RENDER_INSPECTION_PROJECTION);
  });
});
