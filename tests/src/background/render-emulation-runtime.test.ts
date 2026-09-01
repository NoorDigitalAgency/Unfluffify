import { describe, expect, it, vi } from "vitest";

import { createRenderEmulationRuntime } from "../../../src/background/render-emulation-runtime";

const REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function fakeDebugger(options: Readonly<{
  keepDocumentIdentityStale?: boolean;
  mobileInnerViewportOffset?: Readonly<{ width: number; height: number }>;
}> = {}) {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const attaches: number[] = [];
  const detaches: number[] = [];
  let width = 1920;
  let height = 1080;
  let devicePixelRatio = 1;
  let visualViewportScale = 1;
  let maxTouchPoints = 0;
  let documentUserAgent = REAL_UA;
  let overrideUserAgent = REAL_UA;
  let mismatchedProofsRemaining = 0;
  let rejectedAttachesRemaining = 0;
  let media = {
    pointerCoarse: false,
    pointerFine: true,
    hoverNone: false,
    hoverHover: true,
    anyPointerCoarse: false,
    anyPointerFine: true,
    anyHoverNone: false,
    anyHoverHover: true,
  };
  let onDetach: ((source: { tabId?: number }, reason?: string) => void) | null = null;
  let deferredCommand: Readonly<{
    method: string;
    started(): void;
    setCallback(callback: ((result?: unknown) => void) | undefined): void;
  }> | null = null;
  return {
    sent,
    attaches,
    detaches,
    documentReloaded() {
      documentUserAgent = overrideUserAgent;
    },
    mismatchNextProofs(count: number) {
      mismatchedProofsRemaining = count;
    },
    rejectNextAttaches(count: number) {
      rejectedAttachesRemaining = count;
    },
    detach(tabId: number, reason?: string) {
      onDetach?.({ tabId }, reason);
    },
    deferNextCommand(method: string) {
      let markStarted: (() => void) | null = null;
      let callback: ((result?: unknown) => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      deferredCommand = {
        method,
        started() {
          markStarted?.();
        },
        setCallback(next) {
          callback = next;
        },
      };
      return {
        started,
        release() {
          callback?.(method === "Runtime.evaluate" ? { result: { value: REAL_UA } } : {});
        },
      };
    },
    api: {
      attach(target: { tabId?: number }, _version: string, callback?: () => void) {
        attaches.push(target.tabId ?? -1);
        if (rejectedAttachesRemaining > 0) {
          rejectedAttachesRemaining -= 1;
          return Promise.reject(new Error("Debugger is temporarily unavailable"));
        }
        callback?.();
      },
      detach(target: { tabId?: number }, callback?: () => void) {
        detaches.push(target.tabId ?? -1);
        callback?.();
      },
      sendCommand(_target: { tabId?: number }, method: string, params?: Record<string, unknown>, callback?: (result?: unknown) => void) {
        sent.push({ method, params });
        if (method === deferredCommand?.method) {
          const deferred = deferredCommand;
          deferredCommand = null;
          deferred.setCallback(callback);
          deferred.started();
          return;
        }
        if (method === "Emulation.setDeviceMetricsOverride") {
          width = Number(params?.width ?? width);
          height = Number(params?.height ?? height);
          devicePixelRatio = Number(params?.deviceScaleFactor ?? devicePixelRatio);
        } else if (method === "Emulation.setPageScaleFactor") {
          visualViewportScale = Number(params?.pageScaleFactor ?? visualViewportScale);
        } else if (method === "Emulation.setTouchEmulationEnabled") {
          maxTouchPoints = params?.enabled === true ? Number(params.maxTouchPoints ?? 1) : 0;
        } else if (method === "Emulation.setEmulatedMedia") {
          const features = Array.isArray(params?.features) ? params.features as Array<{ name?: string; value?: string }> : [];
          const value = (name: string): string | undefined => features.find((feature) => feature.name === name)?.value;
          media = {
            pointerCoarse: value("pointer") === "coarse",
            pointerFine: value("pointer") === "fine",
            hoverNone: value("hover") === "none",
            hoverHover: value("hover") === "hover",
            anyPointerCoarse: value("any-pointer") === "coarse",
            anyPointerFine: value("any-pointer") === "fine",
            anyHoverNone: value("any-hover") === "none",
            anyHoverHover: value("any-hover") === "hover",
          };
        } else if (method === "Emulation.setUserAgentOverride") {
          overrideUserAgent = String(params?.userAgent ?? "");
          if (!options.keepDocumentIdentityStale) {
            documentUserAgent = overrideUserAgent;
          }
        }
        if (method === "Runtime.evaluate") {
          const expression = String(params?.expression ?? "");
          if (expression.includes("__unfluffifyEmulationProof")) {
            const measuredWidth = mismatchedProofsRemaining > 0 ? width + 1 : width;
            mismatchedProofsRemaining = Math.max(0, mismatchedProofsRemaining - 1);
            const mobileInnerOffset = media.pointerCoarse ? options.mobileInnerViewportOffset : undefined;
            callback?.({
              result: {
                value: {
                  innerWidth: measuredWidth + (mobileInnerOffset?.width ?? 0),
                  innerHeight: height + (mobileInnerOffset?.height ?? 0),
                  documentClientWidth: measuredWidth,
                  documentClientHeight: height,
                  visualViewportWidth: measuredWidth,
                  visualViewportHeight: height,
                  devicePixelRatio,
                  visualViewportScale,
                  maxTouchPoints,
                  userAgent: documentUserAgent,
                  ...media,
                },
              },
            });
            return;
          }
          if (expression.includes("requestAnimationFrame")) {
            callback?.({ result: { value: true } });
            return;
          }
          callback?.({ result: { value: documentUserAgent } });
          return;
        }
        callback?.({});
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
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
  }
}

describe("render emulation runtime", () => {
  it("fits the entire mobile and desktop screens to the visible tab viewport", async () => {
    const debuggerApi = fakeDebugger();
    const viewport = { width: 800, height: 700, windowId: 4 };
    const tabs = {
      get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
      reload: vi.fn((_tabId, _options, callback) => callback?.()),
      sendMessage: vi.fn(),
    };
    const runtime = createRenderEmulationRuntime({ debuggerApi: debuggerApi.api, tabs });

    const mobile = await runtime.apply(7, "mobile", 1);
    expect(mobile).toMatchObject({ width: 412, height: 960, active: true });
    expect(mobile.scale).toBeCloseTo(700 / 960);
    expect(mobile.width * mobile.scale).toBeLessThanOrEqual(viewport.width);
    expect(mobile.height * mobile.scale).toBeLessThanOrEqual(viewport.height);

    const desktop = await runtime.apply(7, "desktop", 1);
    expect(desktop).toMatchObject({ width: 1920, height: 1080, active: true });
    expect(desktop.scale).toBeCloseTo(800 / 1920);
    expect(desktop.width * desktop.scale).toBeLessThanOrEqual(viewport.width);
    expect(desktop.height * desktop.scale).toBeLessThanOrEqual(viewport.height);
  });

  it("proves an exact same-mode posture without rewriting device metrics", async () => {
    const debuggerApi = fakeDebugger();
    const viewport = { width: 900, height: 720, windowId: 4 };
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });
    await runtime.apply(7, "mobile", 1);
    debuggerApi.sent.length = 0;

    await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({
      mode: "mobile",
      scale: 0.75,
      active: true,
    });
    expect(debuggerApi.sent.some((call) => call.method === "Emulation.setDeviceMetricsOverride"))
      .toBe(false);
  });

  it("re-fits the held mode after committed window bounds without an opposite-mode flash", async () => {
    const debuggerApi = fakeDebugger();
    const viewport = { width: 900, height: 720, windowId: 4 };
    let boundsChanged: ((window: { id?: number }) => void) | undefined;
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
      windows: {
        onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
      },
    });
    await runtime.apply(7, "mobile", 1);
    debuggerApi.sent.length = 0;
    viewport.height = 480;

    boundsChanged?.({ id: 4 });
    await flush();

    const metrics = debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride");
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.params).toMatchObject({ width: 412, height: 960, mobile: true });
    expect(metrics[0]?.params?.scale).toBeCloseTo(0.5);
    expect(metrics.some((call) => call.params?.mobile === false)).toBe(false);
  });

  it("re-establishes the posture when the operator dismisses the debugger", async () => {
    // Detaching drops every override at once — viewport and identity together — so a
    // dismissed debugging banner silently returns the tab to a desktop-shaped page
    // that the operator may still be marking against. The posture is a state the tab
    // is supposed to be in, not a request that was granted once.
    const debuggerApi = fakeDebugger();
    const viewport = { width: 900, height: 720, windowId: 4 };
    const tabs = {
      get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
      reload: vi.fn((_tabId, _options, callback) => callback?.()),
      sendMessage: vi.fn(),
    };
    const runtime = createRenderEmulationRuntime({ debuggerApi: debuggerApi.api, tabs });

    await runtime.apply(7, "mobile", 1);
    const before = debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride").length;
    viewport.height = 480;

    debuggerApi.detach(7, "canceled_by_user");
    await flush();

    const after = debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride").length;
    expect(after).toBe(before + 1);
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride").at(-1)?.params)
      .toMatchObject({ width: 412, height: 960, mobile: true, scale: 0.5 });
    // The identity goes back with it: half a posture is not the posture.
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setUserAgentOverride").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("reasserts rather than forgetting a held posture when DevTools replaces the debugger", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });
    await runtime.apply(7, "desktop", 1);
    debuggerApi.sent.length = 0;

    debuggerApi.detach(7, "replaced_with_devtools");
    await flush();

    expect(runtime.heldMode(7)).toBe("desktop");
    expect(debuggerApi.sent.find((call) => call.method === "Emulation.setDeviceMetricsOverride")?.params)
      .toMatchObject({ mobile: false, width: 1920, height: 1080 });
  });

  it("retains and retries the exact held target through transient debugger ownership conflicts", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
      });
      await runtime.apply(7, "desktop", 1);
      debuggerApi.sent.length = 0;
      // Each reassert probes the current UA twice before its first metrics
      // write, so three refused attaches represent one complete transient
      // ownership conflict. Fail the immediate attempt and the first retry.
      debuggerApi.rejectNextAttaches(6);

      debuggerApi.detach(7, "replaced_with_devtools");
      await flush();
      expect(runtime.heldMode(7)).toBe("desktop");
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(100);
      await flush();
      expect(runtime.heldMode(7)).toBe("desktop");
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(250);
      await flush();
      expect(runtime.heldMode(7)).toBe("desktop");
      expect(debuggerApi.sent.find((call) => call.method === "Emulation.setDeviceMetricsOverride")?.params)
        .toMatchObject({ mobile: false, width: 1920, height: 1080 });
      expect(debuggerApi.sent.some((call) => call.params?.mobile === true)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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

  it("retries one frame-late viewport once and proves the replacement after its own frame", async () => {
    const debuggerApi = fakeDebugger();
    debuggerApi.mismatchNextProofs(1);
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });

    await expect(runtime.apply(7, "mobile", 1, false)).resolves.toMatchObject({
      mode: "mobile",
      width: 412,
      height: 960,
      active: true,
      identityStale: false,
    });
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"))
      .toHaveLength(2);
    expect(debuggerApi.sent.filter((call) =>
      call.method === "Runtime.evaluate" &&
      String(call.params?.expression ?? "").includes("requestAnimationFrame")
    )).toHaveLength(2);
  });

  it("accepts an exact mobile visual viewport when Chrome inflates window.inner dimensions", async () => {
    const debuggerApi = fakeDebugger({
      mobileInnerViewportOffset: { width: 12, height: 28 },
    });
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });

    await expect(runtime.apply(7, "mobile", 1, false)).resolves.toMatchObject({
      mode: "mobile",
      width: 412,
      height: 960,
      active: true,
      identityStale: false,
    });
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"))
      .toHaveLength(1);
  });

  it("waits through a bounded multi-frame layout transition without rewriting again", async () => {
    const debuggerApi = fakeDebugger();
    debuggerApi.mismatchNextProofs(3);
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });

    await expect(runtime.apply(7, "mobile", 1, false)).resolves.toMatchObject({
      mode: "mobile",
      width: 412,
      height: 960,
      active: true,
      identityStale: false,
    });
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"))
      .toHaveLength(2);
    expect(debuggerApi.sent.filter((call) =>
      call.method === "Runtime.evaluate" &&
      String(call.params?.expression ?? "").includes("requestAnimationFrame")
    )).toHaveLength(4);
  });

  it("rolls a persistent proof mismatch back to the last exact posture", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });
    await runtime.apply(7, "mobile", 1, false);
    debuggerApi.mismatchNextProofs(5);

    await expect(runtime.apply(7, "desktop", 1, false)).resolves.toMatchObject({
      mode: "desktop",
      active: false,
      failureReason: "viewport_mismatch",
    });
    expect(runtime.heldMode(7)).toBe("mobile");
    expect(debuggerApi.sent.findLast((call) => call.method === "Emulation.setDeviceMetricsOverride")?.params)
      .toMatchObject({ width: 412, height: 960, mobile: true });
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
    expect(runtime.heldMode(7)).toBe("mobile");
    await runtime.clear(7);
    expect(runtime.heldMode(7)).toBeNull();
    debuggerApi.sent.length = 0;
    debuggerApi.detach(7, "canceled_by_user");
    await flush();

    expect(debuggerApi.sent).toEqual([]);
  });

  it("serializes clear after an in-flight detach override so clear is the final writer", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });
    await runtime.apply(7, "mobile", 1);

    const deferred = debuggerApi.deferNextCommand("Emulation.setDeviceMetricsOverride");
    debuggerApi.detach(7, "canceled_by_user");
    await deferred.started;
    const clearing = runtime.clear(7);
    let clearSettled = false;
    void clearing.finally(() => {
      clearSettled = true;
    });
    await flush();
    expect(clearSettled).toBe(false);

    deferred.release();
    await clearing;
    expect(runtime.heldMode(7)).toBeNull();
    const lastSet = debuggerApi.sent.findLastIndex((call) => call.method === "Emulation.setDeviceMetricsOverride");
    const lastClear = debuggerApi.sent.findLastIndex((call) => call.method === "Emulation.clearDeviceMetricsOverride");
    expect(lastSet).toBeGreaterThanOrEqual(0);
    expect(lastClear).toBeGreaterThan(lastSet);
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
      "Emulation.setPageScaleFactor",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
      "Emulation.setUserAgentOverride",
      "Runtime.evaluate",
    ]);
    expect(debuggerApi.sent[1]?.params).toEqual({ pageScaleFactor: 1 });
    expect(debuggerApi.sent[2]?.params).toEqual({ enabled: true, maxTouchPoints: 1 });
    expect(debuggerApi.sent[3]?.params).toMatchObject({
      features: expect.arrayContaining([
        { name: "pointer", value: "coarse" },
        { name: "hover", value: "none" },
      ]),
    });
    expect(debuggerApi.sent[4]?.params).toMatchObject({
      userAgent: expect.stringContaining("Googlebot/2.1"),
      userAgentMetadata: expect.objectContaining({ mobile: true, model: "Nexus 5X" }),
    });
  });

  it("reloads only when asked, and only when the document's identity is stale", async () => {
    // Chrome fixes navigator.userAgent per document, so the override governs the
    // next load. The reload is what makes it real — and it is the popup's call,
    // because only it knows whether a marking session would lose work.
    const stale = fakeDebugger({ keepDocumentIdentityStale: true });
    const staleTabs = { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() };
    const runtime = createRenderEmulationRuntime({ debuggerApi: stale.api, tabs: staleTabs });

    // The fake always answers the real desktop UA, so a mobile posture is stale.
    const withoutPermission = await runtime.apply(7, "mobile", 1, false);
    expect(withoutPermission.identityStale).toBe(true);
    expect(staleTabs.reload).not.toHaveBeenCalled();

    await expect(runtime.apply(7, "mobile", 1, true)).resolves.toMatchObject({
      active: false,
      identityStale: true,
      reloadRequired: true,
      failureReason: "identity_mismatch",
    });
    expect(staleTabs.reload).toHaveBeenCalledTimes(1);
    stale.documentReloaded();
    await expect(runtime.apply(7, "mobile", 1, false)).resolves.toMatchObject({
      active: true,
      identityStale: false,
    });
  });

  it("provides script-mode and reload primitives without declaring inspection success", async () => {
    const debuggerApi = fakeDebugger();
    const reload = vi.fn((_tabId, _options, callback) => callback?.());
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload, sendMessage: vi.fn() },
    });

    await runtime.setJavascriptEnabled(7, false);
    await runtime.reload(7);

    expect(debuggerApi.sent).toContainEqual({
      method: "Emulation.setScriptExecutionDisabled",
      params: { value: true },
    });
    expect(reload).toHaveBeenCalledWith(7, { bypassCache: true }, expect.any(Function));
  });

  it("times out a wedged debugger command, releases the posture, and admits a later operation", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
        apiTimeoutMs: 50,
      });
      const deferred = debuggerApi.deferNextCommand("Emulation.setDeviceMetricsOverride");
      const applying = runtime.apply(7, "mobile", 1, true);
      const rejection = expect(applying).rejects.toThrow(
        "Debugger command Emulation.setDeviceMetricsOverride timed out",
      );
      await deferred.started;
      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(runtime.heldMode(7)).toBeNull();

      await expect(runtime.apply(7, "desktop", 1, false)).resolves.toMatchObject({
        mode: "desktop",
        active: true,
      });
      expect(runtime.heldMode(7)).toBe("desktop");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the last exact posture when a replacement CDP write throws", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
      apiTimeoutMs: 50,
    });
    await runtime.apply(7, "mobile", 1, false);

    vi.useFakeTimers();
    try {
      const deferred = debuggerApi.deferNextCommand("Emulation.setDeviceMetricsOverride");
      const applying = runtime.apply(7, "desktop", 1, false);
      const rejection = expect(applying).rejects.toThrow(
        "Debugger command Emulation.setDeviceMetricsOverride timed out",
      );
      await deferred.started;
      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(runtime.heldMode(7)).toBe("mobile");
      expect(debuggerApi.sent.findLast((call) => call.method === "Emulation.setDeviceMetricsOverride")?.params)
        .toMatchObject({ width: 412, height: 960, mobile: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues after a missing touch-emulation acknowledgement", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
        apiTimeoutMs: 50,
      });
      const deferred = debuggerApi.deferNextCommand("Emulation.setTouchEmulationEnabled");
      const applying = runtime.apply(7, "mobile", 1, false);
      const result = expect(applying).resolves.toMatchObject({
        mode: "mobile",
        width: 412,
        height: 960,
        active: true,
      });
      await deferred.started;
      await vi.advanceTimersByTimeAsync(50);

      await result;
      expect(debuggerApi.sent.map((call) => call.method)).toContain("Emulation.setEmulatedMedia");
      expect(debuggerApi.sent.map((call) => call.method)).toContain("Emulation.setUserAgentOverride");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses promise-only debugger APIs without supplying legacy callbacks", async () => {
    const sent: string[] = [];
    let width = 1920;
    let height = 1080;
    let mobile = false;
    let maxTouchPoints = 0;
    const debuggerApi = {
      attach: vi.fn(async (_target: { tabId?: number }, _version: string, callback?: () => void) => {
        expect(callback).toBeUndefined();
      }),
      detach: vi.fn(async (_target: { tabId?: number }, callback?: () => void) => {
        expect(callback).toBeUndefined();
      }),
      sendCommand: vi.fn(async (
        _target: { tabId?: number },
        method: string,
        params?: Record<string, unknown>,
        callback?: (result?: unknown) => void,
      ) => {
        expect(callback).toBeUndefined();
        sent.push(method);
        if (method === "Emulation.setDeviceMetricsOverride") {
          width = Number(params?.width ?? width);
          height = Number(params?.height ?? height);
          mobile = params?.mobile === true;
        }
        if (method === "Emulation.setTouchEmulationEnabled") {
          maxTouchPoints = params?.enabled === true ? Number(params.maxTouchPoints ?? 1) : 0;
        }
        if (method !== "Runtime.evaluate") {
          return {};
        }
        const expression = String(params?.expression ?? "");
        if (expression.includes("__unfluffifyEmulationProof")) {
          return {
            result: {
              value: {
                innerWidth: width,
                innerHeight: height,
                documentClientWidth: width,
                documentClientHeight: height,
                visualViewportWidth: width,
                visualViewportHeight: height,
                devicePixelRatio: 1,
                visualViewportScale: 1,
                maxTouchPoints,
                userAgent: REAL_UA,
                pointerCoarse: mobile,
                pointerFine: !mobile,
                hoverNone: mobile,
                hoverHover: !mobile,
                anyPointerCoarse: mobile,
                anyPointerFine: !mobile,
                anyHoverNone: mobile,
                anyHoverHover: !mobile,
              },
            },
          };
        }
        return expression.includes("requestAnimationFrame")
          ? { result: { value: true } }
          : { result: { value: REAL_UA } };
      }),
    };
    const reload = vi.fn(async (_tabId: number, _options?: Record<string, unknown>, callback?: () => void) => {
      expect(callback).toBeUndefined();
    });
    const runtime = createRenderEmulationRuntime({
      debuggerApi,
      tabs: { reload, sendMessage: vi.fn() },
      apiMode: "promise",
    });

    await expect(runtime.apply(7, "mobile", 1, true)).resolves.toMatchObject({
      active: false,
      reloadRequired: true,
      failureReason: "identity_mismatch",
    });
    expect(sent).toContain("Emulation.setDeviceMetricsOverride");
    expect(reload).toHaveBeenCalledOnce();
    await expect(runtime.clear(7)).resolves.toMatchObject({ active: false });
    expect(debuggerApi.detach).toHaveBeenCalledOnce();
  });

  it("attempts physical detach even when the local attachment cache was already cleared", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: { reload: vi.fn((_t, _o, cb) => cb?.()), sendMessage: vi.fn() },
    });

    await runtime.clear(7);
    expect(debuggerApi.detaches).toEqual([7]);
    debuggerApi.detach(7, "canceled_by_user");
    await flush();
    expect(runtime.heldMode(7)).toBeNull();
  });

});
