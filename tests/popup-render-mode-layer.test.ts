import { describe, expect, it, vi } from "vitest";

import { createPopupRenderModeInspectionLayer } from "../popup/layers/modes/render-mode-inspection.js";

describe("popup render-mode layer", () => {
  it("wraps a successful bus-backed inspection reply in the legacy popup shape", async () => {
    const layer = createPopupRenderModeInspectionLayer({
      requestRunInspection: vi.fn().mockResolvedValue({
        ok: true,
        tabId: 7,
        operationId: "render-mode:7:1",
        loadStarted: true,
        reloadResult: { ok: true },
        followUpCompleted: true,
        followUpError: "",
        inspectionSnapshot: null,
        endAcknowledged: true,
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
        tabId: 7,
        operationId: "render-mode:7:1",
        followUpCompleted: true,
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
});
