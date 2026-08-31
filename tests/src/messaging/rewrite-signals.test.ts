import { describe, expect, it, vi } from "vitest";

import type { RewriteSignalBus } from "../../../src/messaging/rewrite-signals";
import {
  pullRewriteSignals,
  SIGNAL_PULL_TIMEOUT_MS,
} from "../../../src/messaging/rewrite-signals";

describe("rewrite signal pull deadlines", () => {
  it("uses the short signal deadline by default", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, data: [] });
    const bus = { request } as unknown as RewriteSignalBus;

    await pullRewriteSignals(bus, { tabId: 7, afterSeq: 12 });

    expect(request).toHaveBeenCalledWith(
      "signals.pull",
      { tabId: 7, afterSeq: 12 },
      { target: "background", timeoutMs: SIGNAL_PULL_TIMEOUT_MS },
    );
  });

  it("accepts the remaining whole-operation budget for occurrence-local pulls", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      failure: { code: "REQUEST_TIMEOUT", message: "timed out" },
    });
    const bus = { request } as unknown as RewriteSignalBus;

    await expect(pullRewriteSignals(bus, { tabId: 7, afterSeq: 12 }, 375)).resolves.toMatchObject({
      ok: false,
      failure: { code: "REQUEST_TIMEOUT" },
    });
    expect(request).toHaveBeenCalledWith(
      "signals.pull",
      { tabId: 7, afterSeq: 12 },
      { target: "background", timeoutMs: 375 },
    );
  });
});
