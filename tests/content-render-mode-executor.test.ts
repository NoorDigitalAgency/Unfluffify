import { describe, expect, it, vi } from "vitest";

import { createRenderModeInspectionExecutor } from "../content/layers/modes/render-mode-inspection-executor.js";

describe("content render-mode executor", () => {
  it("dispatches content begin through the legacy content command router", async () => {
    const dispatchContentCommandMessage = vi.fn().mockResolvedValue({
      id: "req-1",
      ok: true,
      result: { ok: true },
    });
    const executor = createRenderModeInspectionExecutor({ dispatchContentCommandMessage });

    await expect(executor.handleBegin({ operationId: "render-mode:5:1" }, { tab: 5 })).resolves.toEqual({ ok: true });
    expect(dispatchContentCommandMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renderModeInspectionBegin",
        source: "background",
        target: "content",
        tabId: 5,
        payload: { operationId: "render-mode:5:1" },
      }),
      undefined,
    );
  });

  it("unwraps captured HTML replies from the legacy content command router", async () => {
    const dispatchContentCommandMessage = vi.fn().mockResolvedValue({
      id: "req-2",
      ok: true,
      result: {
        ok: true,
        pageUrl: "https://example.com/page",
        renderedHtml: "<html>rendered</html>",
        rawHtml: "<html>raw</html>",
        renderMode: "rendered",
        hiddenCount: 1,
      },
    });
    const executor = createRenderModeInspectionExecutor({ dispatchContentCommandMessage });

    await expect(executor.handleCaptureHtml({
      baseUrl: "https://example.com",
      operationId: "render-mode:5:1",
    }, { tab: 5 })).resolves.toMatchObject({
      ok: true,
      pageUrl: "https://example.com/page",
      hiddenCount: 1,
    });
  });
});
