import { describe, expect, it, vi } from "vitest";

import { createRenderModeInspectionExecutor } from "../src/content/layers/modes/render-mode-inspection-executor.js";

describe("content render-mode executor", () => {
  it("calls the begin handler directly through the bus executor", async () => {
    const beginInspection = vi.fn().mockReturnValue({ ok: true });
    const executor = createRenderModeInspectionExecutor({
      handlers: {
        beginInspection,
        hideConsent: vi.fn(),
        captureHtml: vi.fn(),
        endInspection: vi.fn(),
      },
    });

    expect(executor.handleBegin({ operationId: "render-mode:5:1" })).toEqual({ ok: true });
    expect(beginInspection).toHaveBeenCalledWith({ operationId: "render-mode:5:1" });
  });

  it("returns the capture-html handler result directly", async () => {
    const captureHtml = vi.fn().mockResolvedValue({
      ok: true,
      pageUrl: "https://example.com/page",
      renderedHtml: "<html>rendered</html>",
      rawHtml: "<html>raw</html>",
      renderMode: "rendered",
      hiddenCount: 1,
    });
    const executor = createRenderModeInspectionExecutor({
      handlers: {
        beginInspection: vi.fn(),
        hideConsent: vi.fn(),
        captureHtml,
        endInspection: vi.fn(),
      },
    });

    await expect(executor.handleCaptureHtml({
      baseUrl: "https://example.com",
      operationId: "render-mode:5:1",
    })).resolves.toMatchObject({
      ok: true,
      pageUrl: "https://example.com/page",
      hiddenCount: 1,
    });
    expect(captureHtml).toHaveBeenCalledWith({
      baseUrl: "https://example.com",
      operationId: "render-mode:5:1",
    });
  });
});
