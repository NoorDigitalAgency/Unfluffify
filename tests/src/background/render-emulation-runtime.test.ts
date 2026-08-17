import { describe, expect, it, vi } from "vitest";

import { createRenderEmulationRuntime } from "../../../src/background/render-emulation-runtime";

const REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function fakeDebugger() {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const attaches: number[] = [];
  let onDetach: ((source: { tabId?: number }, reason?: string) => void) | null = null;
  return {
    sent,
    attaches,
    detach(tabId: number, reason?: string) {
      onDetach?.({ tabId }, reason);
    },
    api: {
      attach(target: { tabId?: number }, _version: string, callback?: () => void) {
        attaches.push(target.tabId ?? -1);
        callback?.();
      },
      detach(_target: { tabId?: number }, callback?: () => void) {
        callback?.();
      },
      sendCommand(_target: { tabId?: number }, method: string, params?: Record<string, unknown>, callback?: (result?: unknown) => void) {
        sent.push({ method, params });
        callback?.(method === "Runtime.evaluate" ? { result: { value: REAL_UA } } : {});
      },
      onDetach: {
        addListener(listener: (source: { tabId?: number }, reason?: string) => void) {
          onDetach = listener;
        },
      },
    },
  };
}

/** Waits for the fire-and-forget re-assertion the detach listener starts. */
async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

describe("render emulation runtime", () => {
  it("re-establishes the posture when the operator dismisses the debugger", async () => {
    // Detaching drops every override at once — viewport and identity together — so a
    // dismissed debugging banner silently returns the tab to a desktop-shaped page
    // that the operator may still be marking against. The posture is a state the tab
    // is supposed to be in, not a request that was granted once.
    const debuggerApi = fakeDebugger();
    const tabs = { reload: vi.fn((_tabId, _options, callback) => callback?.()), sendMessage: vi.fn() };
    const runtime = createRenderEmulationRuntime({ debuggerApi: debuggerApi.api, tabs });

    await runtime.apply(7, "mobile", 1);
    const before = debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride").length;

    debuggerApi.detach(7, "canceled_by_user");
    await flush();

    const after = debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride").length;
    expect(after).toBe(before + 1);
    // The identity goes back with it: half a posture is not the posture.
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setUserAgentOverride").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("re-establishes the same mode that was held, not a default", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });

    await runtime.apply(7, "desktop", 1);
    debuggerApi.sent.length = 0;
    debuggerApi.detach(7, "canceled_by_user");
    await flush();

    const metrics = debuggerApi.sent.find((call) => call.method === "Emulation.setDeviceMetricsOverride");
    expect(metrics?.params).toMatchObject({ mobile: false, width: 1920 });
  });

  it("does not chase a tab that is closing", async () => {
    // Nothing to restore, and re-attaching to a dying target only produces errors.
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });

    await runtime.apply(7, "mobile", 1);
    debuggerApi.sent.length = 0;
    debuggerApi.detach(7, "target_closed");
    await flush();

    expect(debuggerApi.sent).toEqual([]);
  });

  it("stops holding a posture once the tab is released", async () => {
    // clear() is the operator leaving; a detach after that is not a dismissal.
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });

    await runtime.apply(7, "mobile", 1);
    await runtime.clear(7);
    debuggerApi.sent.length = 0;
    debuggerApi.detach(7, "canceled_by_user");
    await flush();

    expect(debuggerApi.sent).toEqual([]);
  });

  it("re-asserts the complete Googlebot posture when navigation begins", async () => {
    const debuggerApi = fakeDebugger();
    let onUpdated: ((tabId: number, changeInfo: { status?: string }) => void) | undefined;
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        reload: vi.fn((_t, _o, cb) => cb?.()),
        sendMessage: vi.fn(),
        onUpdated: { addListener(listener) { onUpdated = listener; } },
      },
    });
    await runtime.apply(7, "mobile", 0.85);
    debuggerApi.sent.length = 0;

    onUpdated?.(7, { status: "loading" });
    await flush();

    expect(debuggerApi.sent.map((call) => call.method)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
      "Emulation.setUserAgentOverride",
    ]);
    expect(debuggerApi.sent[1]?.params).toEqual({ enabled: true, maxTouchPoints: 1 });
    expect(debuggerApi.sent[2]?.params).toMatchObject({
      features: expect.arrayContaining([
        { name: "pointer", value: "coarse" },
        { name: "hover", value: "none" },
      ]),
    });
    expect(debuggerApi.sent[3]?.params).toMatchObject({
      userAgent: expect.stringContaining("Googlebot/2.1"),
      userAgentMetadata: expect.objectContaining({ mobile: true, model: "Nexus 5X" }),
    });
  });

  it("reloads only when asked, and only when the document's identity is stale", async () => {
    // Chrome fixes navigator.userAgent per document, so the override governs the
    // next load. The reload is what makes it real — and it is the popup's call,
    // because only it knows whether a marking session would lose work.
    const stale = fakeDebugger();
    const staleTabs = { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() };
    const runtime = createRenderEmulationRuntime({ debuggerApi: stale.api, tabs: staleTabs });

    // The fake always answers the real desktop UA, so a mobile posture is stale.
    const withoutPermission = await runtime.apply(7, "mobile", 1, false);
    expect(withoutPermission.identityStale).toBe(true);
    expect(staleTabs.reload).not.toHaveBeenCalled();

    await runtime.apply(7, "mobile", 1, true);
    expect(staleTabs.reload).toHaveBeenCalledTimes(1);
  });
});
