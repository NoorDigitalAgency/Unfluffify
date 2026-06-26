import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { DIAGNOSTIC_REQUEST_TYPES } from "../src/common/bus/contracts/index.js";
import { POPUP_STATE_REQUEST_TYPES } from "../src/common/bus/contracts/popup-state.js";
import { REALMS } from "../src/common/bus/realms.js";
import { requestPopupView, runPopupBusSelfTest } from "../src/popup/layers/popup-bus-client.js";

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
      spinnerQueue: [],
      activeSpinnerLease: null,
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
    const source = readFileSync(new URL("../src/popup/layers/popup-bus-client.ts", import.meta.url), "utf8");
    const mutationBody = source.match(
      /async function requestPopupSpinnerMutation<Payload>\([\s\S]*?\): Promise<SpinnerMutationReply \| null> \{([\s\S]*?)\n\}/
    )?.[1];

    expect(mutationBody).toBeTruthy();
    expect(mutationBody).toMatch(/if \(!tabId \|\| !popupBus\) \{/);
    expect(mutationBody).not.toMatch(/popupBusTabId !== tabId/);
    expect(mutationBody).toMatch(/\{ target: REALMS\.BACKGROUND, tab: tabId, timeoutMs: 3000 \}/);
  });

  it("routes popup consent-hide requests directly to the content realm", () => {
    const source = readFileSync(new URL("../src/popup/layers/popup-bus-client.ts", import.meta.url), "utf8");
    const helperBody = source.match(
      /export function requestPopupRenderModeHideConsent\([\s\S]*?\): Promise<RenderModeContentHideConsentReply> \{([\s\S]*?)\n\}/
    )?.[1];

    expect(helperBody).toBeTruthy();
    expect(helperBody).toMatch(/RENDER_MODE_REQUEST_TYPES\.CONTENT_HIDE_CONSENT/);
    expect(helperBody).toMatch(/REALMS\.CONTENT/);
  });

  it("routes popup render-mode HTML capture requests directly to the content realm", () => {
    const source = readFileSync(new URL("../src/popup/layers/popup-bus-client.ts", import.meta.url), "utf8");
    const helperBody = source.match(
      /export function requestPopupRenderModeCaptureHtml\([\s\S]*?\): Promise<RenderModeContentCaptureHtmlReply> \{([\s\S]*?)\n\}/
    )?.[1];

    expect(helperBody).toBeTruthy();
    expect(helperBody).toMatch(/RENDER_MODE_REQUEST_TYPES\.CONTENT_CAPTURE_HTML/);
    expect(helperBody).toMatch(/REALMS\.CONTENT/);
  });
});
