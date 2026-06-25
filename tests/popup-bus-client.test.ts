import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { DIAGNOSTIC_REQUEST_TYPES } from "../common/bus/contracts/index.js";
import { POPUP_STATE_REQUEST_TYPES } from "../common/bus/contracts/popup-state.js";
import { REALMS } from "../common/bus/realms.js";
import { requestPopupView, runPopupBusSelfTest } from "../popup/layers/popup-bus-client.js";

describe("popup bus self-test", () => {
  it("requests background and content diag.ping round-trips and logs passes", async () => {
    const log = vi.fn<(eventName: string, details?: Record<string, unknown>) => void>();
    const request = vi.fn()
      .mockImplementationOnce((_type: string, payload: { nonce: string }) => Promise.resolve({
        nonce: payload.nonce,
        realm: REALMS.BACKGROUND,
      }))
      .mockImplementationOnce((_type: string, payload: { nonce: string }) => Promise.resolve({
        nonce: payload.nonce,
        realm: REALMS.CONTENT,
      }));

    await runPopupBusSelfTest({
      request,
      tryRequest: vi.fn(),
      registerHandler: vi.fn(),
      publish: vi.fn(),
      subscribe: vi.fn(),
    }, 7, log);

    expect(request).toHaveBeenNthCalledWith(
      1,
      DIAGNOSTIC_REQUEST_TYPES.PING,
      expect.objectContaining({ nonce: expect.stringContaining("background") }),
      { target: REALMS.BACKGROUND, tab: 7, timeoutMs: 2000 },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      DIAGNOSTIC_REQUEST_TYPES.PING,
      expect.objectContaining({ nonce: expect.stringContaining("content") }),
      { target: REALMS.CONTENT, tab: 7, timeoutMs: 2000 },
    );
    expect(log).toHaveBeenCalledWith("bus-self-test:start", { tabId: 7 });
    expect(log).toHaveBeenCalledWith(
      "bus-self-test:pass",
      expect.objectContaining({ tabId: 7, target: REALMS.BACKGROUND, realm: REALMS.BACKGROUND }),
    );
    expect(log).toHaveBeenCalledWith(
      "bus-self-test:pass",
      expect.objectContaining({ tabId: 7, target: REALMS.CONTENT, realm: REALMS.CONTENT }),
    );
  });

  it("logs failure and stops after the first failed target", async () => {
    const log = vi.fn<(eventName: string, details?: Record<string, unknown>) => void>();
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("background failed"));

    await runPopupBusSelfTest({
      request,
      tryRequest: vi.fn(),
      registerHandler: vi.fn(),
      publish: vi.fn(),
      subscribe: vi.fn(),
    }, 9, log);

    expect(request).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "bus-self-test:fail",
      expect.objectContaining({ tabId: 9, target: REALMS.BACKGROUND, error: "background failed" }),
    );
  });

  it("requests the popup view from the background realm over the bus", async () => {
    const request = vi.fn().mockResolvedValue({
      version: 3,
      tabId: 11,
      traceEnabled: true,
      traceEvents: [],
      lifecycle: null,
      legacySpinnerQueue: [],
      legacyActiveSpinnerLease: null,
    });

    await expect(requestPopupView({
      request,
      tryRequest: vi.fn(),
      registerHandler: vi.fn(),
      publish: vi.fn(),
      subscribe: vi.fn(),
    }, 11)).resolves.toMatchObject({
      version: 3,
      tabId: 11,
    });

    expect(request).toHaveBeenCalledWith(
      POPUP_STATE_REQUEST_TYPES.GET,
      {},
      { target: REALMS.BACKGROUND, tab: 11, timeoutMs: 3000 },
    );
  });

  it("allows spinner mutation requests to target an explicit tab after the popup bus retargets", () => {
    const source = readFileSync(new URL("../popup/layers/popup-bus-client.ts", import.meta.url), "utf8");
    const mutationBody = source.match(
      /async function requestPopupSpinnerMutation<Payload>\([\s\S]*?\): Promise<SpinnerMutationReply \| null> \{([\s\S]*?)\n\}/
    )?.[1];

    expect(mutationBody).toBeTruthy();
    expect(mutationBody).toMatch(/if \(!tabId \|\| !popupBus\) \{/);
    expect(mutationBody).not.toMatch(/popupBusTabId !== tabId/);
    expect(mutationBody).toMatch(/\{ target: REALMS\.BACKGROUND, tab: tabId, timeoutMs: 3000 \}/);
  });
});
