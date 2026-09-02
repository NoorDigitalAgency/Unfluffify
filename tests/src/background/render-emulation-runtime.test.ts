import { describe, expect, it, vi } from "vitest";

import {
  createRenderEmulationRuntime as createRenderEmulationRuntimeImplementation,
  type EmulationTransitionDelivery,
} from "../../../src/background/render-emulation-runtime";
import type {
  EmulationTransitionRequest,
  EmulationTransitionResult,
} from "../../../src/content/emulation-transition-guardian";
import {
  createEmulationPostureRepo,
  createMemoryStore,
} from "../../../src/storage";

const REAL_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function fakeDebugger(options: Readonly<{
  keepDocumentIdentityStale?: boolean;
  mobileInnerViewportOffset?: Readonly<{ width: number; height: number }>;
  onMetricsCommand?: (params: Record<string, unknown> | undefined) => void;
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
  let attached = false;
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
  const dropOverrides = () => {
    width = 1920;
    height = 1080;
    devicePixelRatio = 1;
    visualViewportScale = 1;
    maxTouchPoints = 0;
    documentUserAgent = REAL_UA;
    overrideUserAgent = REAL_UA;
    media = {
      pointerCoarse: false,
      pointerFine: true,
      hoverNone: false,
      hoverHover: true,
      anyPointerCoarse: false,
      anyPointerFine: true,
      anyHoverNone: false,
      anyHoverHover: true,
    };
  };
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
    loseAttachmentSilently() {
      attached = false;
      dropOverrides();
    },
    detach(tabId: number, reason?: string) {
      attached = false;
      dropOverrides();
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
        attached = true;
        callback?.();
      },
      detach(target: { tabId?: number }, callback?: () => void) {
        detaches.push(target.tabId ?? -1);
        attached = false;
        dropOverrides();
        callback?.();
      },
      getTargets(callback?: (targets?: readonly { tabId?: number; attached?: boolean }[]) => void) {
        callback?.([{ tabId: 7, attached }]);
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
          options.onMetricsCommand?.(params);
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

type TestPhysicalViewport = {
  width: number;
  height: number;
  windowId: number;
};

function tabsWithViewport(
  viewport: TestPhysicalViewport = { width: 1_920, height: 1_080, windowId: 4 },
) {
  return {
    get: vi.fn((
      _tabId: number,
      callback?: (tab: TestPhysicalViewport) => void,
    ) => callback?.(viewport)),
    reload: vi.fn((
      _tabId: number,
      _options?: Record<string, unknown>,
      callback?: () => void,
    ) => callback?.()),
    sendMessage: vi.fn(),
  };
}

function transitionAcknowledgement(
  request: EmulationTransitionRequest,
): EmulationTransitionResult {
  const mode = request.phase === "release" || request.phase === "abort" ? null : request.mode;
  const preset = mode === "mobile"
    ? { width: 412, height: 960 }
    : { width: 1920, height: 1080 };
  return {
    ok: true,
    generation: request.generation,
    mode,
    stage: request.phase === "begin"
      ? "paint-proven"
      : request.phase === "settle" ? "idle" : "released",
    guarded: request.phase === "begin",
    coverage: request.phase === "begin",
    exactGeometry: request.phase === "settle",
    paintProof: request.phase === "begin" || request.phase === "settle"
      ? "frame-two"
      : "none",
    reason: "",
    measured: {
      innerWidth: preset.width,
      innerHeight: preset.height,
      documentClientWidth: preset.width,
      documentClientHeight: preset.height,
      screenWidth: preset.width,
      screenHeight: preset.height,
      visualViewportWidth: preset.width,
      visualViewportHeight: preset.height,
      visualViewportScale: 1,
    },
  };
}

function transitionPresenter(
  override?: (
    request: EmulationTransitionRequest,
  ) => Promise<EmulationTransitionDelivery> | EmulationTransitionDelivery,
) {
  const requests: EmulationTransitionRequest[] = [];
  const presentTransition = vi.fn(async (
    _tabId: number,
    request: EmulationTransitionRequest,
  ): Promise<EmulationTransitionDelivery> => {
    requests.push(request);
    return override?.(request) ?? {
      status: "ready",
      result: transitionAcknowledgement(request),
    };
  });
  return { requests, presentTransition };
}

type RenderEmulationRuntimeInput = Parameters<
  typeof createRenderEmulationRuntimeImplementation
>[0];

/** Production has no unguarded runtime constructor. Most focused tests are not
 * about the presentation transport, so their harness supplies an exact guardian
 * acknowledgement while the failure/ordering cases inject their own presenter. */
function createRenderEmulationRuntime(
  input: Omit<RenderEmulationRuntimeInput, "presentTransition"> &
    Partial<Pick<RenderEmulationRuntimeInput, "presentTransition">>,
) {
  return createRenderEmulationRuntimeImplementation({
    ...input,
    presentTransition: input.presentTransition ?? transitionPresenter().presentTransition,
  });
}

describe("render emulation runtime", () => {
  it("paint-proves the transition guard before debugger attachment or metrics mutation", async () => {
    const events: string[] = [];
    let acknowledgeBegin: (() => void) | null = null;
    const beginGate = new Promise<void>((resolve) => {
      acknowledgeBegin = resolve;
    });
    const presenter = transitionPresenter(async (request) => {
      events.push(`${request.phase}:requested`);
      if (request.phase === "begin") {
        await beginGate;
        events.push("begin:paint-proven");
      }
      return { status: "ready", result: transitionAcknowledgement(request) };
    });
    const debuggerApi = fakeDebugger({
      onMetricsCommand() {
        events.push("metrics");
      },
    });
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
      presentTransition: presenter.presentTransition,
    });

    const applying = runtime.apply(7, "mobile", 1);
    await flush();
    expect(debuggerApi.attaches).toHaveLength(0);
    expect(debuggerApi.sent).toHaveLength(0);

    acknowledgeBegin?.();
    await expect(applying).resolves.toMatchObject({ active: true, mode: "mobile" });
    expect(events.indexOf("begin:paint-proven")).toBeLessThan(events.indexOf("metrics"));
    expect(events).toContain("settle:requested");
  });

  it("fails closed without touching the debugger when no transition guard answers", async () => {
    const presenter = transitionPresenter(() => ({
      status: "no_receiver",
      reason: "no content receiver",
    }));
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(),
      presentTransition: presenter.presentTransition,
    });

    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({
      active: false,
      failureReason: "presentation_unavailable",
    });
    expect(debuggerApi.attaches).toHaveLength(0);
    expect(debuggerApi.sent).toHaveLength(0);
    expect(presenter.requests.map((request) => request.phase)).toEqual(["begin", "abort"]);
  });

  it("rejects an unproved transition response before debugger mutation", async () => {
    const presenter = transitionPresenter((request) => ({
      status: "ready",
      result: {
        ...transitionAcknowledgement(request),
        paintProof: "none",
      },
    }));
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(),
      presentTransition: presenter.presentTransition,
    });

    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({
      active: false,
      failureReason: "presentation_unavailable",
    });
    expect(debuggerApi.attaches).toHaveLength(0);
    expect(debuggerApi.sent).toHaveLength(0);
    expect(presenter.requests.map((request) => request.phase)).toEqual(["begin", "abort"]);
  });

  it("refuses to clear or detach a held posture without a paint-proven guard", async () => {
    let refuseClear = false;
    const presenter = transitionPresenter((request) => refuseClear && request.cause === "clear"
      ? { status: "no_receiver", reason: "no content receiver" }
      : { status: "ready", result: transitionAcknowledgement(request) });
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(),
      presentTransition: presenter.presentTransition,
    });
    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({ active: true });
    const callsBeforeClear = debuggerApi.sent.length;
    const detachesBeforeClear = debuggerApi.detaches.length;
    refuseClear = true;

    await expect(runtime.clear(7)).rejects.toThrow(/presentation unavailable/i);

    expect(runtime.heldMode(7)).toBe("mobile");
    expect(debuggerApi.sent).toHaveLength(callsBeforeClear);
    expect(debuggerApi.detaches).toHaveLength(detachesBeforeClear);
    expect(presenter.requests.slice(-2)).toMatchObject([
      { phase: "begin", cause: "clear", mode: "mobile" },
      { phase: "abort", cause: "clear" },
    ]);
  });

  it("paint-proves even an untracked neutral clear before its first debugger write", async () => {
    const presenter = transitionPresenter(() => ({
      status: "no_receiver",
      reason: "no content receiver",
    }));
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(),
      presentTransition: presenter.presentTransition,
    });

    await expect(runtime.clear(7)).rejects.toThrow(/presentation unavailable/i);

    expect(debuggerApi.attaches).toHaveLength(0);
    expect(debuggerApi.sent).toHaveLength(0);
    expect(debuggerApi.detaches).toHaveLength(0);
  });

  it("keeps the proven held posture when durable clear storage refuses the transition", async () => {
    const baseRepo = createEmulationPostureRepo(createMemoryStore());
    let refuseClear = false;
    const postureRepo = {
      load: baseRepo.load,
      list: baseRepo.list,
      save: baseRepo.save,
      clear: vi.fn(async (tabId: number) => {
        if (refuseClear) throw new Error("durable clear refused");
        await baseRepo.clear(tabId);
      }),
    };
    const presenter = transitionPresenter();
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
      postureRepo,
      presentTransition: presenter.presentTransition,
    });
    await runtime.apply(7, "mobile", 1);
    const sentBeforeClear = debuggerApi.sent.length;
    const detachesBeforeClear = debuggerApi.detaches.length;
    presenter.requests.length = 0;
    refuseClear = true;

    await expect(runtime.clear(7)).rejects.toThrow("durable clear refused");

    expect(runtime.heldMode(7)).toBe("mobile");
    expect(debuggerApi.sent).toHaveLength(sentBeforeClear);
    expect(debuggerApi.detaches).toHaveLength(detachesBeforeClear);
    await expect(baseRepo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { mode: "mobile" },
    });
    expect(presenter.requests.map((request) => request.phase)).toEqual(["begin", "settle"]);
  });

  it("never detaches into browser-default geometry when durable rollback cannot commit", async () => {
    const baseRepo = createEmulationPostureRepo(createMemoryStore());
    let refuseMutations = false;
    const postureRepo = {
      load: baseRepo.load,
      list: baseRepo.list,
      save: vi.fn(async (record: Parameters<typeof baseRepo.save>[0]) => {
        if (refuseMutations) throw new Error("durable save refused");
        await baseRepo.save(record);
      }),
      clear: vi.fn(async (tabId: number) => {
        if (refuseMutations) throw new Error("durable clear refused");
        await baseRepo.clear(tabId);
      }),
    };
    const presenter = transitionPresenter();
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
      postureRepo,
      presentTransition: presenter.presentTransition,
    });
    await runtime.apply(7, "mobile", 1);
    const sentBeforeTransition = debuggerApi.sent.length;
    const detachesBeforeTransition = debuggerApi.detaches.length;
    presenter.requests.length = 0;
    refuseMutations = true;

    await expect(runtime.apply(7, "desktop", 1)).rejects.toThrow("durable save refused");

    expect(runtime.heldMode(7)).toBe("mobile");
    expect(debuggerApi.sent).toHaveLength(sentBeforeTransition);
    expect(debuggerApi.detaches).toHaveLength(detachesBeforeTransition);
    expect(presenter.requests).toMatchObject([{
      phase: "begin",
      mode: "mobile",
      cause: "restore",
    }]);
  });

  it("keeps an already-safe non-content refit read-only", async () => {
    const presenter = transitionPresenter();
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
      presentTransition: presenter.presentTransition,
    });
    await runtime.apply(7, "mobile", 1);
    presenter.requests.length = 0;
    debuggerApi.sent.length = 0;

    await runtime.refit(7);

    expect(presenter.requests).toEqual([]);
    expect(debuggerApi.sent.some((call) =>
      call.method === "Emulation.setDeviceMetricsOverride")).toBe(false);
  });

  it("keeps a real physical-shrink refit guarded from before metrics through exact settle", async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const viewport = { width: 900, height: 720, windowId: 4 };
      const presenter = transitionPresenter((request) => {
        events.push(`present:${request.phase}`);
        return { status: "ready", result: transitionAcknowledgement(request) };
      });
      const debuggerApi = fakeDebugger({
        onMetricsCommand() {
          events.push("metrics");
        },
      });
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "mobile", 1);
      events.length = 0;
      debuggerApi.sent.length = 0;
      viewport.height = 480;

      await runtime.refit(7);

      expect(events).toEqual(["present:begin", "metrics"]);
      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(events).toEqual(["present:begin", "metrics", "present:settle"]);
      expect(debuggerApi.sent.filter((call) => call.method.startsWith("Emulation.")))
        .toMatchObject([{
          method: "Emulation.setDeviceMetricsOverride",
          params: { width: 412, height: 960, mobile: true, scale: 0.5 },
        }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reasserts a canceled mobile lease inside a debugger-detach presentation occurrence", async () => {
    const presenter = transitionPresenter();
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
      presentTransition: presenter.presentTransition,
    });
    await runtime.apply(7, "mobile", 1);
    presenter.requests.length = 0;
    debuggerApi.sent.length = 0;

    debuggerApi.detach(7, "canceled_by_user");
    for (let attempt = 0; attempt < 10 &&
      !presenter.requests.some((request) => request.phase === "settle"); attempt += 1) {
      await flush();
    }

    expect(presenter.requests[0]).toMatchObject({
      phase: "begin",
      cause: "debugger-detach",
      mode: "mobile",
    });
    expect(presenter.requests.at(-1)).toMatchObject({ phase: "settle", mode: "mobile" });
    expect(debuggerApi.sent.find((call) =>
      call.method === "Emulation.setDeviceMetricsOverride")?.params).toMatchObject({
      width: 412,
      height: 960,
      mobile: true,
    });
  });

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

  it("allows the physical safety fit below the preference floor", async () => {
    const debuggerApi = fakeDebugger();
    const viewport = { width: 100, height: 120, windowId: 4 };
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    const mobile = await runtime.apply(7, "mobile", 1);
    expect(mobile.scale).toBeCloseTo(0.125);
    expect(mobile.width * mobile.scale).toBeLessThanOrEqual(viewport.width);
    expect(mobile.height * mobile.scale).toBeLessThanOrEqual(viewport.height);
  });

  it("fails closed before the first metrics write when physical geometry is unavailable", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({
      mode: "mobile",
      active: false,
      failureReason: "physical_fit_mismatch",
    });
    expect(debuggerApi.sent.some((call) =>
      call.method === "Emulation.setDeviceMetricsOverride"
    )).toBe(false);

    await runtime.clear(7);
  });

  it("requires both transition samples before allowing the first metrics write", async () => {
    const debuggerApi = fakeDebugger();
    let viewportReads = 0;
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: TestPhysicalViewport) => void) => {
          viewportReads += 1;
          callback?.(viewportReads === 2
            ? { width: 0, height: 0, windowId: 4 }
            : { width: 900, height: 720, windowId: 4 });
        }),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({
      active: false,
      failureReason: "physical_fit_mismatch",
    });
    expect(viewportReads).toBe(2);
    expect(debuggerApi.sent.some((call) =>
      call.method === "Emulation.setDeviceMetricsOverride"
    )).toBe(false);

    await runtime.clear(7);
  });

  it("does not reuse an active cache when the physical viewport becomes unreadable", async () => {
    const debuggerApi = fakeDebugger();
    let readable = true;
    const viewport = { width: 900, height: 720, windowId: 4 };
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: TestPhysicalViewport) => void) => {
          callback?.(readable ? viewport : { width: 0, height: 0, windowId: 4 });
        }),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({ active: true });
    readable = false;
    await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({
      active: false,
      failureReason: "physical_fit_mismatch",
    });
    readable = true;
    await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({ active: true });
  });

  it("never returns the stale active posture when geometry disappears during a shrink refit", async () => {
    let readable = true;
    let destabilizeOnMetrics = false;
    const viewport = { width: 900, height: 720, windowId: 4 };
    const debuggerApi = fakeDebugger({
      onMetricsCommand() {
        if (destabilizeOnMetrics) readable = false;
      },
    });
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: TestPhysicalViewport) => void) => {
          callback?.(readable ? viewport : { width: 0, height: 0, windowId: 4 });
        }),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({
      active: true,
      scale: 0.75,
    });
    viewport.height = 480;
    destabilizeOnMetrics = true;
    await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({
      active: false,
      failureReason: "physical_fit_mismatch",
    });

    destabilizeOnMetrics = false;
    readable = true;
    await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({
      active: true,
      scale: 0.5,
    });
  });

  it("recomputes before acknowledgement when the physical tab shrinks during a transition", async () => {
    const debuggerApi = fakeDebugger();
    let viewportReads = 0;
    const large = { width: 900, height: 720, windowId: 4 };
    const small = { width: 100, height: 120, windowId: 4 };
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: typeof large) => void) => {
          viewportReads += 1;
          callback?.(viewportReads === 1 ? large : small);
        }),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    const mobile = await runtime.apply(7, "mobile", 1);
    expect(mobile.scale).toBeCloseTo(0.125);
    expect(mobile.width * mobile.scale).toBeLessThanOrEqual(small.width);
    expect(mobile.height * mobile.scale).toBeLessThanOrEqual(small.height);
    // The second pre-write sample sees the smaller rectangle, so the unsafe
    // large metrics frame is never emitted and no corrective second write is
    // needed.
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"))
      .toHaveLength(1);
    expect(debuggerApi.sent.find((call) => call.method === "Emulation.setDeviceMetricsOverride")?.params)
      .toMatchObject({ scale: 0.125 });
  });

  it("intersects the popup's non-emulated visible height with tabs.get before the first metrics write", async () => {
    const debuggerApi = fakeDebugger();
    const viewport = { width: 900, height: 800, windowId: 4 };
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    const mobile = await runtime.apply(7, "mobile", 1, false, { height: 420 });

    expect(mobile).toMatchObject({ mode: "mobile", width: 412, height: 960, active: true });
    expect(mobile.scale).toBeCloseTo(420 / 960);
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"))
      .toEqual([expect.objectContaining({
        params: expect.objectContaining({ scale: 420 / 960 }),
      })]);
  });

  it("corrects a physical shrink that lands after the first metrics acknowledgement before returning active", async () => {
    const viewport = { width: 900, height: 720, windowId: 4 };
    let metricsWrites = 0;
    const debuggerApi = fakeDebugger({
      onMetricsCommand() {
        metricsWrites += 1;
        if (metricsWrites === 1) viewport.height = 480;
      },
    });
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });

    const mobile = await runtime.apply(7, "mobile", 1);
    const metrics = debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride");

    expect(mobile).toMatchObject({ mode: "mobile", scale: 0.5, active: true });
    expect(metrics).toHaveLength(2);
    expect(metrics[0]?.params?.scale).toBeCloseTo(720 / 960);
    expect(metrics[1]?.params).toMatchObject({
      width: 412,
      height: 960,
      mobile: true,
      scale: 0.5,
    });
    expect(mobile.height * mobile.scale).toBeLessThanOrEqual(viewport.height);
  });

  it("hydrates and reasserts the exact durable desktop posture after a cold worker restart", async () => {
    const store = createMemoryStore();
    const repo = createEmulationPostureRepo(store);
    const viewport = { width: 900, height: 720, windowId: 4 };
    const tabs = {
      get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
      reload: vi.fn((_tabId, _options, callback) => callback?.()),
      sendMessage: vi.fn(),
    };
    const firstDebugger = fakeDebugger();
    const first = createRenderEmulationRuntime({
      debuggerApi: firstDebugger.api,
      tabs,
      postureRepo: repo,
    });
    const firstState = await first.apply(7, "desktop", 1);
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: {
        mode: "desktop",
        maximumScale: 1,
        fittedScale: firstState.scale,
      },
    });

    // A cold worker must reinforce the last proven compositor fit first. It may
    // grow only through the later stable refit path, even if the current window
    // is now larger.
    viewport.width = 1_800;
    viewport.height = 1_000;

    const coldDebugger = fakeDebugger();
    const cold = createRenderEmulationRuntime({
      debuggerApi: coldDebugger.api,
      tabs,
      postureRepo: createEmulationPostureRepo(store),
    });
    await cold.hydrate(7);
    await flush();

    expect(cold.heldMode(7)).toBe("desktop");
    expect(coldDebugger.sent.find((call) => call.method === "Emulation.setDeviceMetricsOverride")?.params)
      .toMatchObject({
        width: 1920,
        height: 1080,
        mobile: false,
        scale: firstState.scale,
      });
    expect(coldDebugger.sent.some((call) => call.params?.mobile === true)).toBe(false);
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
    expect(debuggerApi.sent).toEqual([]);
  });

  it("reasserts the complete posture when browser attachment truth disagrees with the cache", async () => {
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

    // Chromium does not emit onDetach for the extension's own detach call. The
    // browser target list is therefore the independent fence that prevents a
    // later scale-only refit from accepting a viewport-only half posture.
    debuggerApi.loseAttachmentSilently();

    await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({
      mode: "mobile",
      width: 412,
      height: 960,
      active: true,
    });
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"))
      .toHaveLength(1);
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setTouchEmulationEnabled"))
      .toHaveLength(1);
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setEmulatedMedia"))
      .toHaveLength(1);
    expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setUserAgentOverride"))
      .toHaveLength(1);
  });

  it.each([
    { mode: "mobile" as const, width: 412, height: 960, scale: 0.75 },
    { mode: "desktop" as const, width: 1_920, height: 1_080, scale: 900 / 1_920 },
  ])("autonomously repairs a silently lost $mode debugger lease while the tab is idle", async ({
    mode,
    width,
    height,
    scale,
  }) => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const presenter = transitionPresenter();
      const repo = createEmulationPostureRepo(createMemoryStore());
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
        postureRepo: repo,
        leaseWatchdogMs: 50,
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, mode, 1);
      debuggerApi.sent.length = 0;
      presenter.requests.length = 0;
      const attachesBeforeLoss = debuggerApi.attaches.length;

      // This is the Chromium path that has no onDetach notification. No popup
      // current/refit/apply call follows it.
      debuggerApi.loseAttachmentSilently();
      await vi.advanceTimersByTimeAsync(50);
      await flush();

      expect(debuggerApi.attaches.length).toBeGreaterThan(attachesBeforeLoss);
      expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"))
        .toHaveLength(1);
      expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setTouchEmulationEnabled"))
        .toHaveLength(1);
      expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setEmulatedMedia"))
        .toHaveLength(1);
      expect(debuggerApi.sent.filter((call) => call.method === "Emulation.setUserAgentOverride"))
        .toHaveLength(1);
      expect(presenter.requests[0]).toMatchObject({
        phase: "begin",
        cause: "lease-recovery",
        mode,
      });
      expect(presenter.requests.at(-1)).toMatchObject({ phase: "settle", mode });
      await expect(runtime.current(7, mode, 1)).resolves.toMatchObject({
        active: true,
        mode,
        width,
        height,
      });
      expect((await runtime.current(7, mode, 1))?.scale).toBeCloseTo(scale);
      await runtime.clear(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an exact idle lease read-only and cancels it before clear", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const presenter = transitionPresenter();
      const repo = createEmulationPostureRepo(createMemoryStore());
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
        postureRepo: repo,
        leaseWatchdogMs: 50,
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "desktop", 1);
      debuggerApi.sent.length = 0;
      presenter.requests.length = 0;

      await vi.advanceTimersByTimeAsync(250);
      await flush();
      expect(debuggerApi.sent).toEqual([]);
      expect(presenter.requests).toEqual([]);

      await runtime.clear(7);
      debuggerApi.sent.length = 0;
      await vi.advanceTimersByTimeAsync(250);
      await flush();
      expect(runtime.heldMode(7)).toBeNull();
      expect(debuggerApi.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the idle lease only for an immediate physical shrink, never growth or full churn", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const repo = createEmulationPostureRepo(createMemoryStore());
      const viewport = { width: 900, height: 720, windowId: 4 };
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        postureRepo: repo,
        leaseWatchdogMs: 50,
      });
      await runtime.apply(7, "mobile", 1);
      debuggerApi.sent.length = 0;

      viewport.height = 480;
      await vi.advanceTimersByTimeAsync(50);
      await flush();

      const metrics = debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride");
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.params).toMatchObject({
        width: 412,
        height: 960,
        mobile: true,
        scale: 0.5,
      });
      expect(debuggerApi.sent.some((call) =>
        call.method === "Emulation.setTouchEmulationEnabled" ||
        call.method === "Emulation.setEmulatedMedia" ||
        call.method === "Emulation.setUserAgentOverride"
      )).toBe(false);

      debuggerApi.sent.length = 0;
      viewport.height = 720;
      await vi.advanceTimersByTimeAsync(250);
      await flush();
      expect(debuggerApi.sent).toEqual([]);
      await runtime.clear(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the idle lease when the tab is removed and never resurrects its posture", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const repo = createEmulationPostureRepo(createMemoryStore());
      let onRemoved: ((tabId: number) => void) | undefined;
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: {
          ...tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
          onRemoved: { addListener(listener) { onRemoved = listener; } },
        },
        postureRepo: repo,
        leaseWatchdogMs: 50,
      });
      await runtime.apply(7, "mobile", 1);
      debuggerApi.sent.length = 0;
      const attachesBeforeRemoval = debuggerApi.attaches.length;

      onRemoved?.(7);
      await flush();
      await vi.advanceTimersByTimeAsync(250);
      await flush();

      expect(runtime.heldMode(7)).toBeNull();
      await expect(repo.load(7)).resolves.toEqual({ ok: true, value: null });
      expect(debuggerApi.attaches).toHaveLength(attachesBeforeRemoval);
      expect(debuggerApi.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes an idle lease tick behind a mode transition without a stale-mode write", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const repo = createEmulationPostureRepo(createMemoryStore());
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
        postureRepo: repo,
        leaseWatchdogMs: 50,
      });
      await runtime.apply(7, "mobile", 1);
      debuggerApi.sent.length = 0;

      const deferred = debuggerApi.deferNextCommand("Emulation.setPageScaleFactor");
      const transition = runtime.apply(7, "desktop", 1);
      await deferred.started;
      await vi.advanceTimersByTimeAsync(50);
      deferred.release();
      await expect(transition).resolves.toMatchObject({
        active: true,
        mode: "desktop",
        width: 1_920,
        height: 1_080,
      });
      await flush();

      const metrics = debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride");
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.params).toMatchObject({
        width: 1_920,
        height: 1_080,
        mobile: false,
      });
      expect(runtime.heldMode(7)).toBe("desktop");
      await runtime.clear(7);
    } finally {
      vi.useRealTimers();
    }
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
    expect(debuggerApi.sent.filter((call) => call.method.startsWith("Emulation.")).map((call) => call.method))
      .toEqual(["Emulation.setDeviceMetricsOverride"]);
  });

  it("paint-proves an unsafe bounds shrink before a delayed physical tab read", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const outer = { id: 4, width: 1_200, height: 900 };
      let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
      let delayTabReads = false;
      let releaseTabRead: (() => void) | null = null;
      let markTabReadStarted: (() => void) | null = null;
      const tabReadStarted = new Promise<void>((resolve) => {
        markTabReadStarted = resolve;
      });
      let releaseTargetRead: (() => void) | null = null;
      let markTargetReadStarted: (() => void) | null = null;
      const targetReadStarted = new Promise<void>((resolve) => {
        markTargetReadStarted = resolve;
      });
      const guardPhysicalViewport = vi.fn(async () => null);
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: {
          get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => {
            if (!delayTabReads) {
              callback?.(viewport);
              return;
            }
            markTabReadStarted?.();
            return new Promise<void>((resolve) => {
              releaseTabRead = () => {
                delayTabReads = false;
                callback?.(viewport);
                resolve();
              };
            });
          }),
          reload: vi.fn((_tabId, _options, callback) => callback?.()),
          sendMessage: vi.fn(),
        },
        windows: {
          get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
            callback?.(outer);
          }),
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
        guardPhysicalViewport,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;
      let delayTargetReads = true;
      debuggerApi.api.getTargets = vi.fn((callback) => {
        if (!delayTargetReads) {
          callback?.([{ tabId: 7, attached: true }]);
          return;
        }
        markTargetReadStarted?.();
        releaseTargetRead = () => {
          delayTargetReads = false;
          callback?.([{ tabId: 7, attached: true }]);
        };
      });

      delayTabReads = true;
      viewport.height = 480;
      outer.height = 660;
      boundsChanged?.({ ...outer });
      await targetReadStarted;
      await flush();

      expect(guardPhysicalViewport).toHaveBeenCalledWith(7, "mobile");
      expect(presenter.requests.map((request) => request.phase)).toEqual(["begin"]);
      expect(debuggerApi.sent).toEqual([]);

      releaseTargetRead?.();
      await tabReadStarted;
      await flush();

      expect(presenter.requests.map((request) => request.phase)).toEqual(["begin"]);
      expect(debuggerApi.sent).toEqual([]);

      releaseTabRead?.();
      await flush();
      const metrics = debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      );
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.params).toMatchObject({
        width: 412,
        height: 960,
        mobile: true,
        scale: 0.5,
      });

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(new Set(presenter.requests.map((request) => request.generation)).size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("admits an unsafe physical guard outside a stalled tab queue and adopts its generation", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const outer = { id: 4, width: 1_200, height: 900 };
      let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
      const tabs = {
        get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) =>
          callback?.(viewport)),
        reload: vi.fn((_tabId: number, _options: unknown, callback?: () => void) => callback?.()),
        sendMessage: vi.fn(),
      };
      const admissionEvents: string[] = [];
      const guardPhysicalViewport = vi.fn(async () => {
        admissionEvents.push("guarded");
        return 88;
      });
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs,
        windows: {
          get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
            callback?.(outer);
          }),
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
        guardPhysicalViewport,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      let releaseTargetRead: (() => void) | null = null;
      let markTargetReadStarted: (() => void) | null = null;
      const targetReadStarted = new Promise<void>((resolve) => {
        markTargetReadStarted = resolve;
      });
      let delayTargetReads = true;
      debuggerApi.api.getTargets = vi.fn((callback) => {
        if (!delayTargetReads) {
          callback?.([{ tabId: 7, attached: true }]);
          return;
        }
        markTargetReadStarted?.();
        releaseTargetRead = () => {
          delayTargetReads = false;
          callback?.([{ tabId: 7, attached: true }]);
        };
      });
      const stalled = runtime.refit(7, { source: "popup" });
      await targetReadStarted;

      viewport.height = 480;
      outer.height = 660;
      boundsChanged?.({ ...outer });

      expect(admissionEvents).toEqual(["guarded"]);
      expect(guardPhysicalViewport).toHaveBeenCalledWith(7, "mobile");
      expect(presenter.requests).toEqual([]);
      expect(debuggerApi.sent).toEqual([]);

      releaseTargetRead?.();
      await stalled;
      await flush();

      const metrics = debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      );
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.params).toMatchObject({
        width: 412,
        height: 960,
        mobile: true,
        scale: 0.5,
      });
      expect(presenter.requests).toEqual([
        expect.objectContaining({
          phase: "begin",
          generation: 88,
          mode: "mobile",
          cause: "refit",
        }),
      ]);

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(new Set(presenter.requests.map((request) => request.generation))).toEqual(
        new Set([88]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes a popup-delivered content generation to an already-running refit", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      let releaseTargetRead: (() => void) | null = null;
      let markTargetReadStarted: (() => void) | null = null;
      const targetReadStarted = new Promise<void>((resolve) => {
        markTargetReadStarted = resolve;
      });
      let delayTargetReads = true;
      debuggerApi.api.getTargets = vi.fn((callback) => {
        if (!delayTargetReads) {
          callback?.([{ tabId: 7, attached: true }]);
          return;
        }
        markTargetReadStarted?.();
        releaseTargetRead = () => {
          delayTargetReads = false;
          callback?.([{ tabId: 7, attached: true }]);
        };
      });
      const running = runtime.refit(7, { source: "popup" });
      await targetReadStarted;

      viewport.height = 480;
      const retained = runtime.refit(7, {
        source: "content",
        presentationGeneration: 88,
      });
      releaseTargetRead?.();
      await Promise.all([running, retained]);
      await flush();

      expect(presenter.requests).toEqual([
        expect.objectContaining({ phase: "begin", generation: 88 }),
      ]);
      expect(debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      )).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(new Set(presenter.requests.map((request) => request.generation)))
        .toEqual(new Set([88]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a later content generation wake an executor awaiting a slow bounds guard", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const outer = { id: 4, width: 1_200, height: 900 };
      let boundsChanged: ((window: {
        id?: number;
        width?: number;
        height?: number;
      }) => void) | undefined;
      let resolveSlowGuard: ((generation: number | null) => void) | null = null;
      const slowGuard = new Promise<number | null>((resolve) => {
        resolveSlowGuard = resolve;
      });
      const guardPhysicalViewport = vi.fn(() => slowGuard);
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        windows: {
          get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
            callback?.(outer);
          }),
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
        guardPhysicalViewport,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      viewport.height = 480;
      outer.height = 660;
      boundsChanged?.({ ...outer });
      await flush();
      expect(guardPhysicalViewport).toHaveBeenCalledTimes(1);
      expect(presenter.requests).toEqual([]);

      const retained = runtime.refit(7, {
        source: "content",
        presentationGeneration: 88,
      });
      await retained;
      await flush();

      expect(presenter.requests).toEqual([
        expect.objectContaining({ phase: "begin", generation: 88 }),
      ]);
      expect(debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      )).toHaveLength(1);

      resolveSlowGuard?.(99);
      await flush();
      expect(new Set(presenter.requests.map((request) => request.generation)))
        .toEqual(new Set([88]));

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(new Set(presenter.requests.map((request) => request.generation)))
        .toEqual(new Set([88]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts the document's active viewport generation when a refit fallback adopts it", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter((request) => {
        const acknowledgement = transitionAcknowledgement(request);
        return {
          status: "ready",
          result: request.phase === "begin" &&
              request.cause === "refit" &&
              request.adoptExistingRefitGuard === true
            ? {
                ...acknowledgement,
                generation: 88,
                reason: "adopted-active-refit-guard",
              }
            : acknowledgement,
        };
      });
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      viewport.height = 480;
      await runtime.refit(7, {
        source: "window-bounds",
        physicalBoundsChanged: true,
      });
      await flush();

      expect(presenter.requests[0]).toMatchObject({
        phase: "begin",
        mode: "mobile",
        cause: "refit",
        adoptExistingRefitGuard: true,
      });
      expect(presenter.requests[0]?.generation).not.toBe(88);
      expect(debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      )).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.at(-1)).toMatchObject({
        phase: "settle",
        generation: 88,
        mode: "mobile",
        cause: "refit",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed before a delayed tab read when no bounds baseline exists", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
      let delayTabReads = false;
      let releaseTabRead: (() => void) | null = null;
      let markTabReadStarted: (() => void) | null = null;
      const tabReadStarted = new Promise<void>((resolve) => {
        markTabReadStarted = resolve;
      });
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: {
          get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => {
            if (!delayTabReads) {
              callback?.(viewport);
              return;
            }
            markTabReadStarted?.();
            return new Promise<void>((resolve) => {
              releaseTabRead = () => {
                delayTabReads = false;
                callback?.(viewport);
                resolve();
              };
            });
          }),
          reload: vi.fn((_tabId, _options, callback) => callback?.()),
          sendMessage: vi.fn(),
        },
        windows: {
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      delayTabReads = true;
      viewport.height = 480;
      boundsChanged?.({ id: 4, width: 1_200, height: 660 });
      await tabReadStarted;
      await flush();

      expect(presenter.requests.map((request) => request.phase)).toEqual(["begin"]);
      expect(debuggerApi.sent).toEqual([]);

      releaseTabRead?.();
      await flush();
      expect(debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      )).toEqual([expect.objectContaining({
        params: expect.objectContaining({ scale: 0.5 }),
      })]);

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses an unsafe projection only to guard when the browser measurement still fits", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const outer = { id: 4, width: 1_200, height: 900 };
      let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        windows: {
          get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
            callback?.(outer);
          }),
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      outer.height = 660;
      boundsChanged?.({ ...outer });
      await flush();

      expect(presenter.requests.map((request) => request.phase)).toEqual(["begin"]);
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(debuggerApi.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an identical complete bounds event without a guard or metrics write", async () => {
    const presenter = transitionPresenter();
    const debuggerApi = fakeDebugger();
    const viewport = { width: 900, height: 720, windowId: 4 };
    const outer = { id: 4, width: 1_200, height: 900 };
    const guardPhysicalViewport = vi.fn(async () => 88);
    let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(viewport),
      windows: {
        get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
          callback?.(outer);
        }),
        onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
      },
      presentTransition: presenter.presentTransition,
      guardPhysicalViewport,
    });
    await runtime.apply(7, "mobile", 1);
    presenter.requests.length = 0;
    debuggerApi.sent.length = 0;

    boundsChanged?.({ ...outer });
    await flush();

    expect(presenter.requests).toEqual([]);
    expect(debuggerApi.sent).toEqual([]);
    expect(guardPhysicalViewport).not.toHaveBeenCalled();
  });

  it("does not pre-guard a bounds change whose projected viewport still fits", async () => {
    const presenter = transitionPresenter();
    const debuggerApi = fakeDebugger();
    const viewport = { width: 900, height: 720, windowId: 4 };
    const outer = { id: 4, width: 1_200, height: 900 };
    const guardPhysicalViewport = vi.fn(async () => 88);
    let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(viewport),
      windows: {
        get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
          callback?.(outer);
        }),
        onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
      },
      presentTransition: presenter.presentTransition,
      guardPhysicalViewport,
    });
    await runtime.apply(7, "mobile", 1);
    presenter.requests.length = 0;
    debuggerApi.sent.length = 0;

    viewport.width = 800;
    outer.width = 1_100;
    boundsChanged?.({ ...outer });
    await flush();

    expect(presenter.requests).toEqual([]);
    expect(debuggerApi.sent).toEqual([]);
    expect(guardPhysicalViewport).not.toHaveBeenCalled();
  });

  it("uses fresh tab geometry across a window handoff and retires the old window cache", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const outers = new Map([
        [4, { id: 4, width: 1_200, height: 900 }],
        [5, { id: 5, width: 1_200, height: 780 }],
      ]);
      let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        windows: {
          get: vi.fn((windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: { id: number; width: number; height: number }) => void) => {
            callback?.(outers.get(windowId));
          }),
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      viewport.windowId = 5;
      viewport.height = 600;
      const oldWindow = outers.get(4)!;
      oldWindow.height = 660;
      boundsChanged?.({ ...oldWindow });
      await flush();

      const metrics = debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      );
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.params?.scale).toBeCloseTo(600 / 960);
      expect(presenter.requests.map((request) => request.phase)).toEqual(["begin"]);

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);

      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;
      oldWindow.height = 620;
      boundsChanged?.({ ...oldWindow });
      await flush();
      expect(presenter.requests).toEqual([]);
      expect(debuggerApi.sent).toEqual([]);

      await runtime.clear(7);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;
      const newWindow = outers.get(5)!;
      newWindow.height = 740;
      boundsChanged?.({ ...newWindow });
      await flush();
      expect(presenter.requests).toEqual([]);
      expect(debuggerApi.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains an unsafe projection when bounds observations coalesce", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const outer = { id: 4, width: 1_200, height: 900 };
      let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
      let releaseTargetRead: (() => void) | null = null;
      let markTargetReadStarted: (() => void) | null = null;
      const targetReadStarted = new Promise<void>((resolve) => {
        markTargetReadStarted = resolve;
      });
      const guardPhysicalViewport = vi.fn()
        .mockRejectedValueOnce(new Error("first guard reply was lost"))
        .mockResolvedValue(88);
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        windows: {
          get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
            callback?.(outer);
          }),
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
        guardPhysicalViewport,
      });
      await runtime.apply(7, "mobile", 1);
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      let delayTargetReads = true;
      debuggerApi.api.getTargets = vi.fn((callback) => {
        if (!delayTargetReads) {
          callback?.([{ tabId: 7, attached: true }]);
          return;
        }
        markTargetReadStarted?.();
        releaseTargetRead = () => {
          delayTargetReads = false;
          callback?.([{ tabId: 7, attached: true }]);
        };
      });
      const processing = runtime.refit(7, { source: "popup" });
      await targetReadStarted;

      outer.height = 660;
      boundsChanged?.({ ...outer });
      outer.height = 600;
      boundsChanged?.({ ...outer });
      outer.height = 900;
      boundsChanged?.({ ...outer });
      releaseTargetRead?.();
      await processing;
      await flush();

      expect(presenter.requests.map((request) => request.phase)).toEqual(["begin"]);
      expect(presenter.requests[0]).toMatchObject({ generation: 88 });
      expect(guardPhysicalViewport).toHaveBeenCalledTimes(2);
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(240);
      await flush();
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(new Set(presenter.requests.map((request) => request.generation)).size).toBe(1);
      expect(new Set(presenter.requests.map((request) => request.generation))).toEqual(
        new Set([88]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces resize expansion bursts and applies one trailing scale-only refit", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 480, windowId: 4 };
      const outer = { id: 4, width: 1_200, height: 900 };
      const guardPhysicalViewport = vi.fn(async () => 88);
      let boundsChanged: ((window: { id?: number; width?: number; height?: number }) => void) | undefined;
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: {
          get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
          reload: vi.fn((_tabId, _options, callback) => callback?.()),
          sendMessage: vi.fn(),
        },
        windows: {
          get: vi.fn((_windowId: number, _getInfo?: Record<string, unknown>, callback?: (window?: typeof outer) => void) => {
            callback?.(outer);
          }),
          onBoundsChanged: { addListener(listener) { boundsChanged = listener; } },
        },
        presentTransition: presenter.presentTransition,
        guardPhysicalViewport,
      });
      await runtime.apply(7, "mobile", 1);
      debuggerApi.sent.length = 0;
      presenter.requests.length = 0;
      viewport.height = 700;
      outer.height = 1_120;

      boundsChanged?.({ ...outer });
      boundsChanged?.({ ...outer });
      boundsChanged?.({ ...outer });
      await flush();
      expect(guardPhysicalViewport).toHaveBeenCalledTimes(1);
      expect(presenter.requests).toEqual([
        expect.objectContaining({ phase: "begin", generation: 88 }),
      ]);
      expect(debuggerApi.sent.some((call) => call.method === "Emulation.setDeviceMetricsOverride"))
        .toBe(false);

      await vi.advanceTimersByTimeAsync(239);
      await flush();
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      const emulationCalls = debuggerApi.sent.filter((call) => call.method.startsWith("Emulation."));
      expect(emulationCalls).toHaveLength(1);
      expect(emulationCalls[0]).toMatchObject({
        method: "Emulation.setDeviceMetricsOverride",
        params: { width: 412, height: 960, mobile: true, scale: 700 / 960 },
      });
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(new Set(presenter.requests.map((request) => request.generation)))
        .toEqual(new Set([88]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("owns a multi-source shrink/grow burst with one guard lease and one final fade", async () => {
    vi.useFakeTimers();
    try {
      const presenter = transitionPresenter();
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 720, windowId: 4 };
      const runtime = createRenderEmulationRuntime({
        debuggerApi: debuggerApi.api,
        tabs: tabsWithViewport(viewport),
        presentTransition: presenter.presentTransition,
      });
      await runtime.apply(7, "mobile", 1);
      const retainedGeneration = presenter.requests.at(-1)?.generation ?? 1;
      presenter.requests.length = 0;
      debuggerApi.sent.length = 0;

      viewport.height = 480;
      await runtime.refit(7, { source: "window-bounds" });
      const burstGeneration = presenter.requests[0]?.generation;
      await runtime.refit(7, {
        source: "content",
        presentationGeneration: burstGeneration ?? retainedGeneration,
      });
      expect(presenter.requests.map((request) => request.phase)).toEqual(["begin"]);
      expect(debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      )).toHaveLength(1);

      viewport.height = 700;
      await Promise.all([
        runtime.refit(7, { source: "window-bounds" }),
        runtime.refit(7, {
          source: "popup",
          physicalViewportHint: { height: 700 },
        }),
      ]);
      await vi.advanceTimersByTimeAsync(239);
      await flush();
      expect(debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      )).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      const metrics = debuggerApi.sent.filter((call) =>
        call.method === "Emulation.setDeviceMetricsOverride"
      );
      expect(metrics).toHaveLength(2);
      expect(metrics.map((call) => call.params?.scale)).toEqual([
        0.5,
        700 / 960,
      ]);
      expect(presenter.requests.map((request) => request.phase)).toEqual([
        "begin",
        "settle",
      ]);
      expect(new Set(presenter.requests.map((request) => request.generation)).size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles an already-opaque content no-op using its retained generation", async () => {
    const presenter = transitionPresenter();
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport({ width: 900, height: 720, windowId: 4 }),
      presentTransition: presenter.presentTransition,
    });
    await runtime.apply(7, "mobile", 1);
    const generation = (presenter.requests.at(-1)?.generation ?? 1) + 1;
    presenter.requests.length = 0;
    debuggerApi.sent.length = 0;

    await runtime.refit(7, {
      source: "content",
      presentationGeneration: generation,
    });

    expect(presenter.requests.map((request) => request.phase)).toEqual([
      "begin",
      "settle",
    ]);
    expect(presenter.requests.every((request) => request.generation === generation)).toBe(true);
    expect(debuggerApi.sent).toEqual([]);
  });

  it("invalidates a pending expansion when a newer physical generation arrives", async () => {
    vi.useFakeTimers();
    try {
      const debuggerApi = fakeDebugger();
      const viewport = { width: 900, height: 480, windowId: 4 };
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

      viewport.height = 700;
      boundsChanged?.({ id: 4 });
      await flush();
      await vi.advanceTimersByTimeAsync(200);

      viewport.height = 600;
      boundsChanged?.({ id: 4 });
      await flush();
      await vi.advanceTimersByTimeAsync(40);
      await flush();
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(199);
      await flush();
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(debuggerApi.sent.filter((call) => call.method.startsWith("Emulation.")))
        .toEqual([expect.objectContaining({
          method: "Emulation.setDeviceMetricsOverride",
          params: expect.objectContaining({ scale: 600 / 960 }),
        })]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps verification shrink immediate but defers verification growth until geometry is stable", async () => {
    vi.useFakeTimers();
    try {
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

      viewport.height = 480;
      await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({
        mode: "mobile",
        scale: 0.5,
        active: true,
      });
      expect(debuggerApi.sent.filter((call) => call.method.startsWith("Emulation.")))
        .toEqual([expect.objectContaining({
          method: "Emulation.setDeviceMetricsOverride",
          params: expect.objectContaining({ width: 412, height: 960, mobile: true, scale: 0.5 }),
        })]);

      debuggerApi.sent.length = 0;
      viewport.height = 700;
      await expect(runtime.current(7, "mobile", 1)).resolves.toMatchObject({
        mode: "mobile",
        scale: 0.5,
        active: true,
      });
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(239);
      await flush();
      expect(debuggerApi.sent).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(debuggerApi.sent.filter((call) => call.method.startsWith("Emulation.")))
        .toEqual([expect.objectContaining({
          method: "Emulation.setDeviceMetricsOverride",
          params: expect.objectContaining({ width: 412, height: 960, mobile: true, scale: 700 / 960 }),
        })]);
    } finally {
      vi.useRealTimers();
    }
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

  it("reasserts a canceled debugger at the last proven safe scale instead of opportunistically growing", async () => {
    const debuggerApi = fakeDebugger();
    const viewport = { width: 900, height: 480, windowId: 4 };
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        get: vi.fn((_tabId: number, callback?: (tab: typeof viewport) => void) => callback?.(viewport)),
        reload: vi.fn((_tabId, _options, callback) => callback?.()),
        sendMessage: vi.fn(),
      },
    });
    await expect(runtime.apply(7, "mobile", 1)).resolves.toMatchObject({ scale: 0.5 });
    debuggerApi.sent.length = 0;

    viewport.height = 720;
    debuggerApi.detach(7, "canceled_by_user");
    await flush();

    const metrics = debuggerApi.sent.filter((call) => call.method === "Emulation.setDeviceMetricsOverride");
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.params).toMatchObject({
      width: 412,
      height: 960,
      mobile: true,
      scale: 0.5,
    });
    expect(debuggerApi.sent.some((call) => call.params?.mobile === false)).toBe(false);
  });

  it("reasserts rather than forgetting a held posture when DevTools replaces the debugger", async () => {
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(),
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
        tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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

  it("rolls durable intent back with the last exact posture and removes it on clear", async () => {
    const debuggerApi = fakeDebugger();
    const repo = createEmulationPostureRepo(createMemoryStore());
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(),
      postureRepo: repo,
    });
    await runtime.apply(7, "desktop", 1, false);
    debuggerApi.mismatchNextProofs(5);

    await expect(runtime.apply(7, "mobile", 1, false)).resolves.toMatchObject({
      mode: "mobile",
      active: false,
      failureReason: "viewport_mismatch",
    });
    await expect(repo.load(7)).resolves.toMatchObject({
      ok: true,
      value: { mode: "desktop" },
    });

    await runtime.clear(7);
    await expect(repo.load(7)).resolves.toEqual({ ok: true, value: null });
  });

  it("does not chase a tab that is closing", async () => {
    // Nothing to restore, and re-attaching to a dying target only produces errors.
    const debuggerApi = fakeDebugger();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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
    const tabs = tabsWithViewport();
    const runtime = createRenderEmulationRuntime({
      debuggerApi: debuggerApi.api,
      tabs: {
        ...tabs,
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
    const staleTabs = tabsWithViewport();
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
        tabs: tabsWithViewport(),
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
      tabs: tabsWithViewport(),
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
        tabs: tabsWithViewport(),
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
      tabs: {
        get: vi.fn(async (
          _tabId: number,
          callback?: (tab: TestPhysicalViewport) => void,
        ) => {
          expect(callback).toBeUndefined();
          return { width: 1_920, height: 1_080, windowId: 4 };
        }),
        reload,
        sendMessage: vi.fn(),
      },
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
