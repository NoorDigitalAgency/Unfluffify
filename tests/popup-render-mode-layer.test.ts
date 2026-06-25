import { describe, expect, it, vi } from "vitest";

import { createPopupRenderModeInspectionLayer } from "../popup/layers/modes/render-mode-inspection.js";

describe("popup render-mode layer", () => {
  it("wraps a successful bus-backed inspection reply in the legacy popup shape", async () => {
    const layer = createPopupRenderModeInspectionLayer({
      requestRunInspection: vi.fn().mockResolvedValue({
        ok: true,
        tabId: 7,
        operationId: "render-mode:7:1",
        kind: "render-mode-inspection",
        timedOut: false,
        cancelled: false,
        error: "",
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        result: {
          ok: true,
          tabId: 7,
          operationId: "render-mode:7:1",
          loadStarted: true,
          reloadResult: { ok: true },
          followUpCompleted: true,
          followUpError: "",
          inspectionSnapshot: null,
          endAcknowledged: true,
        },
      }),
      requestEndInspection: vi.fn(),
    });

    await expect(layer.requestRunInspection(7, {
      baseUrl: "https://example.com",
      javaScriptDisabled: false,
      operationId: "render-mode:7:1",
    })).resolves.toMatchObject({
      ok: true,
      result: {
        result: {
          tabId: 7,
          operationId: "render-mode:7:1",
          followUpCompleted: true,
        },
      },
    });
  });

  it("preserves the fail-open end-cleanup behavior when inspection start fails", async () => {
    const requestEndInspection = vi.fn().mockResolvedValue({
      ok: true,
      tabId: 7,
      operationId: "render-mode:7:1",
      endAcknowledged: true,
    });
    const layer = createPopupRenderModeInspectionLayer({
      requestRunInspection: vi.fn().mockRejectedValue(Object.assign(new Error("inspection failed"), {
        code: "handler_failed",
      })),
      requestEndInspection,
    });

    await expect(layer.requestRunInspection(7, {
      baseUrl: "https://example.com",
      javaScriptDisabled: true,
      operationId: "render-mode:7:1",
    })).resolves.toMatchObject({
      ok: false,
      code: "handler_failed",
      error: "inspection failed",
    });
    expect(requestEndInspection).toHaveBeenCalledWith(7, {
      operationId: "render-mode:7:1",
    }, 5000);
  });

  it("cleans up when the background resolves a failed operation envelope", async () => {
    const requestEndInspection = vi.fn().mockResolvedValue({
      ok: true,
      tabId: 7,
      operationId: "render-mode:7:1",
      endAcknowledged: true,
    });
    const layer = createPopupRenderModeInspectionLayer({
      requestRunInspection: vi.fn().mockResolvedValue({
        ok: false,
        tabId: 7,
        operationId: "render-mode:7:1",
        kind: "render-mode-inspection",
        timedOut: false,
        cancelled: false,
        error: "Unable to reload page for render mode inspection",
        startedAt: 1,
        finishedAt: 2,
        durationMs: 1,
        result: {
          ok: false,
          tabId: 7,
          operationId: "render-mode:7:1",
          loadStarted: false,
          reloadResult: { ok: false, error: "Unable to reload page for render mode inspection" },
          followUpCompleted: false,
          followUpError: "Unable to reload page for render mode inspection",
          inspectionSnapshot: null,
          endAcknowledged: false,
        },
      }),
      requestEndInspection,
    });

    await expect(layer.requestRunInspection(7, {
      baseUrl: "https://example.com",
      javaScriptDisabled: true,
      operationId: "render-mode:7:1",
    })).resolves.toMatchObject({
      ok: false,
      error: "Unable to reload page for render mode inspection",
    });
    expect(requestEndInspection).toHaveBeenCalledWith(7, {
      operationId: "render-mode:7:1",
    }, 5000);
  });
});
