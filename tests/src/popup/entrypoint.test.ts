import { afterEach, describe, expect, it, vi } from "vitest";
import { createRewriteBrain } from "../../../src/background/rewrite-brain";
import type { BusFrame } from "../../../src/messaging/contract";
import type { BrainSensation } from "../../../src/background/brain/fold";
import type { ConfigSnapshot } from "../../../src/storage/config";
import type { RenderInspectionSession } from "../../../src/messaging/render-inspection";
import { SIGNAL_PULL_TIMEOUT_MS } from "../../../src/messaging/rewrite-signals";

function backendConfig(): ConfigSnapshot {
  const page = (pageKey: string) => ({
    timestamp: "2026-08-17T10:00:00Z",
    pageType: "detail",
    renderedHtml: `<html>${pageKey}</html>`,
    rows: [],
  });
  return {
    version: 2,
    environmentKey: "example.com",
    siteId: 1,
    baseUrl: "https://example.com",
    propertyRevision: 4,
    feedRevision: 2,
    membershipFingerprint: "membership",
    assignmentFingerprint: "assignment",
    renderMode: "rendered",
    renderModeUpdatedAt: "2026-08-17T10:00:00Z",
    selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    selectorsUpdatedAt: "2026-08-17T10:00:00Z",
    submittedSelectorsFingerprint: "selectors",
    pages: { "/": page("/"), "/page": page("/page"), "/a": page("/a"), "/b": page("/b") },
    reconciliation: {
      revision: 2,
      feedFingerprint: "feed",
      removedPageKeys: [],
      relabelledPages: [],
    },
  };
}

function renderInspectionSession(
  overrides: Partial<RenderInspectionSession> = {},
): RenderInspectionSession {
  return {
    token: "inspection-1",
    generation: 1,
    phase: "arming",
    property: {
      environmentKey: "example.com",
      siteId: 1,
      baseUrl: "https://example.com",
    },
    pageUrl: "https://example.com/page",
    javascriptEnabled: false,
    documentId: null,
    documentNonce: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    deadlineAt: Date.now() + 30_000,
    terminalReason: null,
    ...overrides,
  };
}

function installEntrypointDom(href: string): void {
  Object.defineProperty(globalThis, "__UF_DEBUG_BUILD__", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: { dataset: {}, style: {} },
      getElementById: vi.fn(() => ({ id: "root", dataset: {}, isConnected: true })),
      body: {
        appendChild: vi.fn(() => ({ id: "root", dataset: {}, isConnected: true })),
      },
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      // Discarding markings asks first; default to accepting so the existing
      // flows read as an operator who confirmed.
      confirm: vi.fn(() => true),
    },
  });
}

function createReactRenderProbe() {
  const render = vi.fn((node: unknown) => {
    const element = node as {
      props?: { children?: unknown; onRecover?: unknown; onError?: unknown };
    };
    if (
      typeof element.props?.onRecover === "function" &&
      typeof element.props?.onError === "function"
    ) {
      const currentCall = render.mock.calls.at(-1);
      if (currentCall) {
        currentCall[0] = element.props.children;
      }
    }
  });
  return render;
}

/** Establishing the render mode is two acts, as legacy had it: pick, then
 *  confirm. Tests that only need a mode in force before doing something else say
 *  so through this rather than repeating both calls. */
async function confirmRenderMode(
  render: { mock: { calls: { at(index: number): [{ props: Record<string, (value?: unknown) => void> }] | undefined } } },
  mode: "rendered" | "static" = "rendered",
): Promise<void> {
  const props = () => render.mock.calls.at(-1)?.[0].props;
  props()?.onRenderModePick(mode);
  props()?.onRenderModeCommit();
  await waitFor(
    () => (props()?.presentation as unknown as { temporarilyDisabledOverlay?: boolean })?.temporarilyDisabledOverlay !== true,
    "render mode Set completion",
  );
}

/** Waits for work the entrypoint kicked off without awaiting — the standing
 *  emulation posture is applied fire-and-forget on binding, so a fixed number of
 *  flushes cannot be relied on to have seen it. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let index = 0; index < 50 && !condition(); index += 1) {
    await flushEntrypointWork();
  }
  if (!condition()) {
    throw new Error(`timed out waiting for ${what}`);
  }
}

async function flushEntrypointWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function replyFrame(frame: BusFrame, payload: unknown): BusFrame {
  return {
    ...frame,
    frameType: "reply",
    source: "background",
    target: frame.source,
    ok: true,
    payload,
  };
}

function failedReplyFrame(frame: BusFrame, code: string): BusFrame {
  return {
    ...frame,
    frameType: "reply",
    source: "background",
    target: frame.source,
    ok: false,
    payload: null,
    failure: { code, message: code },
  };
}

function contentReplyFrame(frame: BusFrame, data: unknown): BusFrame {
  return {
    ...frame,
    frameType: "reply",
    source: "content",
    target: frame.source,
    ok: true,
    payload: { ok: true, data },
  };
}

function directContentReplyFrame(frame: BusFrame, data: unknown): BusFrame {
  return {
    ...frame,
    frameType: "reply",
    source: "content",
    target: frame.source,
    ok: true,
    payload: data,
  };
}

function contentCommand(name: string, payload?: unknown) {
  return expect.objectContaining({
    kind: "uf-bus/1",
    frameType: "request",
    name: "command.dispatch",
    target: "content",
    payload: expect.objectContaining({
      kind: "uf-command/1",
      name,
      ...(payload === undefined ? {} : { payload }),
    }),
  });
}

function previewCommand(name: "preview.project" | "preview.emphasize" | "preview.activate", payload: unknown) {
  return expect.objectContaining({
    kind: "uf-bus/1",
    frameType: "request",
    name,
    target: "content",
    payload,
  });
}

function reportedFactFrame(
  source: "content" | "popup",
  reason: string,
  facts: Record<string, unknown>,
  id: string,
): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "event",
    id,
    seq: 0,
    name: "fact.reported",
    source,
    sourceInstance: `${source}:77`,
    target: "background",
    payload: {
      kind: "uf-fact/1",
      sensation: {
        tabId: 77,
        source,
        reason,
        facts: {
          tabId: 77,
          pageUrl: "https://example.com/page",
          ...facts,
        },
      },
    },
  };
}

function contentPreviewExitedFrame(markingEnabled: boolean, id = "content-preview-exited"): BusFrame {
  return reportedFactFrame("content", "preview-exited", {
    markingEnabled,
    previewActive: false,
    previewExitRequested: false,
  }, id);
}

function makeTabsSendMessage(
  handler: (tabId: number, message: { type?: string } & Record<string, unknown>) => Promise<unknown> | unknown,
) {
  return vi.fn(async (tabId: number, message: unknown) => {
    const frame = message as BusFrame;
    if (frame?.kind === "uf-bus/1" && frame.name === "command.dispatch") {
      const command = frame.payload as { name: string; payload?: Record<string, unknown> };
      const rawData = await handler(tabId, { type: command.name, ...(command.payload ?? {}) });
      const acknowledged = rawData &&
        typeof rawData === "object" &&
        (rawData as { ok?: unknown }).ok === true;
      const data = command.name === "activateContentMain" && acknowledged
        ? {
            interactionsReady: true,
            ritual: { status: "prepared", frozenAtBottom: true },
            ...rawData as Record<string, unknown>,
          }
        : command.name === "enterRenderModeView" && acknowledged
          ? { suspended: true, ...rawData as Record<string, unknown> }
          : command.name === "preparePageVisit" && acknowledged
            ? {
                prepared: true,
                ritual: { status: "prepared", frozenAtBottom: true },
                ...rawData as Record<string, unknown>,
              }
            : rawData;
      return contentReplyFrame(frame, data);
    }
    if (frame?.kind === "uf-bus/1" && frame.frameType === "request" && frame.target === "content") {
      const payload = frame.payload && typeof frame.payload === "object"
        ? frame.payload as Record<string, unknown>
        : {};
      const data = await handler(tabId, { type: frame.name, ...payload });
      return directContentReplyFrame(frame, data);
    }
    return await handler(tabId, message as { type?: string } & Record<string, unknown>);
  });
}

function makeRuntime(
  handler: (frame: BusFrame) => Promise<unknown> | unknown,
  renderMode: "rendered" | "static" = "rendered",
  options: Readonly<{
    configLoad?: (frame: BusFrame) => Promise<BusFrame> | BusFrame;
    emulationApply?: (frame: BusFrame) => Promise<BusFrame> | BusFrame;
    emulationCurrent?: (frame: BusFrame) => Promise<BusFrame> | BusFrame;
    renderInspectionCurrent?: (frame: BusFrame) => Promise<BusFrame> | BusFrame;
    lockDirective?: (frame: BusFrame) => Promise<BusFrame> | BusFrame;
    pageContextStatus?: "managed_candidate" | "managed_non_candidate";
    delegatePageContextToHandler?: boolean;
    deferReconciliationFactAvailability?: boolean;
    deferFactAvailabilityReasons?: readonly string[];
  }> = {},
) {
  const factBrain = createRewriteBrain(77);
  const factSignals: Array<ReturnType<typeof factBrain.observe>[number]> = [];
  let deliveredSignalSeq = 0;
  let availabilitySeq = 0;
  let emulationMode: "mobile" | "desktop" | null = null;
  const runtimeListeners = new Set<(
    message: unknown,
    sender: unknown,
    sendResponse: (value: unknown) => void,
  ) => unknown>();

  const b2SignalNames = new Set([
    "run.started",
    "run.completed",
    "run.failed",
    "preview.opened",
    "preview.exit.requested",
    "preview.exited",
    "session.saved",
    "session.discarded",
    "reconciliation.started",
    "reconciliation.ended",
  ]);

  const adoptScriptedB2State = (signal: Record<string, unknown>): void => {
    const payload = signal.payload as Record<string, unknown> | undefined;
    const common = {
      tabId: 77,
      source: "popup" as const,
      reason: "scripted-test-state",
    };
    if (signal.name === "run.started") {
      factBrain.observe({ ...common, facts: {
        tabId: 77,
        runPhase: "running",
        runSessionId: typeof payload?.sessionId === "string" ? payload.sessionId : undefined,
        runDeadlineAt: typeof payload?.deadlineAt === "number" ? payload.deadlineAt : undefined,
      } });
    } else if (signal.name === "run.completed" || signal.name === "run.failed") {
      factBrain.observe({ ...common, facts: {
        tabId: 77,
        runPhase: signal.name === "run.completed" ? "completed" : "failed",
        runSessionId: typeof payload?.sessionId === "string" ? payload.sessionId : undefined,
      } });
    }
  };

  return {
    sendMessage: vi.fn(async (message: unknown) => {
      const frame = message as BusFrame;
      if (frame.name === "fact.reported") {
        const sensation = (frame.payload as { sensation?: BrainSensation }).sensation;
        const observe = (): void => {
          if (!sensation) {
            return;
          }
          factSignals.push(...factBrain.observe(sensation).filter((signal) => b2SignalNames.has(signal.name)));
        };
        if (
          (options.deferReconciliationFactAvailability &&
            sensation?.reason.startsWith("save-reconciliation-")) ||
          (sensation !== undefined && options.deferFactAvailabilityReasons?.includes(sensation.reason))
        ) {
          const handled = await handler(frame);
          setTimeout(() => {
            observe();
            availabilitySeq += 1;
            const event: BusFrame = {
              kind: "uf-bus/1",
              frameType: "event",
              id: `signals-available-${availabilitySeq}`,
              seq: availabilitySeq,
              name: "signals.available",
              source: "background",
              sourceInstance: "background:test",
              target: "popup",
              payload: { tabId: 77 },
            };
            for (const listener of runtimeListeners) {
              listener(event, {}, () => undefined);
            }
          }, 5);
          return handled;
        }
        observe();
        return await handler(frame);
      }
      if (frame.name === "signals.pull") {
        const handled = await handler(frame) as BusFrame;
        const scripted = handled?.ok === true && Array.isArray(handled.payload) ? handled.payload : [];
        scripted.forEach((signal) => adoptScriptedB2State(signal as Record<string, unknown>));
        const queued = factSignals.splice(0);
        const afterSeq = Number((frame.payload as { afterSeq?: number }).afterSeq ?? 0);
        deliveredSignalSeq = Math.max(deliveredSignalSeq, afterSeq);
        const signals = [...scripted, ...queued].map((signal) => ({
          ...(signal as Record<string, unknown>),
          seq: ++deliveredSignalSeq,
          source: (signal as { source?: string }).source ?? "brain",
        }));
        return replyFrame(frame, signals);
      }
      if (frame.name === "lock.directive") {
        if (options.lockDirective) {
          return await options.lockDirective(frame);
        }
        return replyFrame(frame, {
          status: "ok",
          baseUrl: "https://example.com",
          siteId: 1,
          lockRole: "editor",
          configPresent: true,
          canEdit: true,
          blockedReason: "editor",
          authority: {
            environmentKey: "example.com",
            editorSessionId: "editor-1",
            lockToken: "lock-1",
            propertyRevision: 4,
            feedRevision: 2,
          },
          lockBanner: { visible: false, reason: "editor" },
        });
      }
      if (frame.name === "emulation.apply") {
        const requestedMode = (frame.payload as { mode?: unknown }).mode;
        if (options.emulationApply) {
          const response = await options.emulationApply(frame);
          const responsePayload = response.payload as { active?: unknown } | undefined;
          emulationMode = response.ok === true && responsePayload?.active === true &&
            (requestedMode === "mobile" || requestedMode === "desktop")
            ? requestedMode
            : null;
          return response;
        }
        emulationMode = requestedMode === "desktop" ? "desktop" : "mobile";
        return replyFrame(frame, {
          mode: emulationMode,
          width: emulationMode === "desktop" ? 1920 : 412,
          height: emulationMode === "desktop" ? 1080 : 960,
          scale: 1,
          active: true,
        });
      }
      if (frame.name === "emulation.current") {
        if (options.emulationCurrent) {
          return await options.emulationCurrent(frame);
        }
        const requestedMode = (frame.payload as { mode?: unknown }).mode;
        return replyFrame(frame, requestedMode === emulationMode && emulationMode !== null
          ? {
              mode: emulationMode,
              width: emulationMode === "desktop" ? 1920 : 412,
              height: emulationMode === "desktop" ? 1080 : 960,
              scale: 1,
              active: true,
            }
          : null);
      }
      if (frame.name === "emulation.clear") {
        emulationMode = null;
        return replyFrame(frame, { status: "ok" });
      }
      if (frame.name === "emulation.refit") {
        return replyFrame(frame, { status: "ok" });
      }
      if (frame.name === "settings.load") {
        return replyFrame(frame, {
          settings: {
            configEndpoint: "https://config.example.com",
            aiEndpoint: "https://ai.example.com",
            stageBase: "example.com",
          },
          hasToken: true,
        });
      }
      if (frame.name === "accounts.status") {
        return replyFrame(frame, { state: "valid", checkedAt: 1 });
      }
      if (frame.name === "offscreen.refineXpaths") {
        const payload = frame.payload as { rows?: unknown };
        return replyFrame(frame, { rows: Array.isArray(payload.rows) ? payload.rows : [] });
      }
      if (frame.name === "page.context" && !options.delegatePageContextToHandler) {
        const pageUrl = String((frame.payload as { pageUrl?: unknown }).pageUrl ?? "");
        const url = new URL(pageUrl);
        const status = options.pageContextStatus ?? "managed_candidate";
        const pageKey = status === "managed_candidate" ? url.pathname || "/" : null;
        return replyFrame(frame, {
          status,
          generation: 1,
          observedUrl: pageUrl,
          draftDisposition: "preserve",
          environmentKey: url.hostname,
          siteId: 1,
          baseUrl: url.origin,
          pageKey,
          pageTypes: [],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
          renderModeSet: true,
          todo: { covered: 0, actionable: 0, pageTypes: [] },
        });
      }
      if (frame.name === "config.load") {
        if (options.configLoad) {
          return await options.configLoad(frame);
        }
        return replyFrame(frame, {
          status: "ok",
          config: { ...backendConfig(), renderMode },
          renderMode,
          renderModeSource: "backend",
        });
      }
      if (frame.name === "renderInspection.current") {
        return options.renderInspectionCurrent
          ? await options.renderInspectionCurrent(frame)
          : replyFrame(frame, { status: "inactive" });
      }
      return await handler(frame);
    }),
    onMessage: {
      addListener: vi.fn((listener) => runtimeListeners.add(listener)),
      removeListener: vi.fn((listener) => runtimeListeners.delete(listener)),
    },
  };
}

async function startDirtyMarkingSession(options: Readonly<{
  emulationApply?: (
    frame: BusFrame,
    state: { resetSeen: boolean },
  ) => Promise<BusFrame> | BusFrame;
}> = {}) {
  installEntrypointDom("chrome-extension://extension-id/popup.html");
  const render = createReactRenderProbe();
  vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
  const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
  const state = { resetSeen: false };
  const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
    if (message.type === "resetContentMain") {
      state.resetSeen = true;
    }
    return { ok: true, initialized: true, tree: "rewrite" };
  });
  let dirtyPending = false;
  let signalSeq = 0;
  const markingSignals: Array<Record<string, unknown>> = [];
  const runtime = makeRuntime(async (message) => {
    if (message.name === "fact.reported") {
      const sensation = (message.payload as {
        sensation?: { facts?: { markingEnabled?: unknown } };
      }).sensation;
      if (typeof sensation?.facts?.markingEnabled === "boolean") {
        signalSeq += 1;
        markingSignals.push({
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: sensation.facts.markingEnabled ? "marking.enabled" : "marking.disabled",
          source: "brain",
          cause: "fact-fold",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page" },
        });
      }
      return replyFrame(message, []);
    }
    if (message.name === "signals.emit") {
      const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
      signalSeq += 1;
      return replyFrame(message, [{
        kind: "uf-signal/1",
        tabId: request.tabId,
        seq: signalSeq,
        name: request.signal?.name,
        source: "brain",
        cause: "test",
        at: signalSeq,
        payload: request.signal?.payload ?? {},
      }]);
    }
    if (message.name === "signals.pull" && (dirtyPending || markingSignals.length > 0)) {
      const signals = markingSignals.splice(0);
      if (dirtyPending) {
        dirtyPending = false;
        signalSeq += 1;
        signals.push({
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
        });
      }
      return replyFrame(message, signals);
    }
    return replyFrame(message, []);
  }, "rendered", {
    emulationApply: options.emulationApply
      ? (frame) => options.emulationApply?.(frame, state) as Promise<BusFrame> | BusFrame
      : undefined,
  });
  globalThis.chrome = {
    runtime: { ...runtime },
    tabs: { query, sendMessage: tabsSendMessage },
  } as unknown as typeof chrome;

  await import("../../../src/entrypoints/popup/main.tsx");
  const props = () => render.mock.calls.at(-1)?.[0].props;
  await confirmRenderMode(render);
  props().onEnableChange(true);
  await waitFor(
    () => props().diagnostics.contentActive === true && props().diagnostics.stateName === "pre_ai_clean",
    "marking activation",
  );
  dirtyPending = true;
  for (const [poll] of globalThis.window.setInterval.mock.calls as Array<[() => void]>) {
    poll();
  }
  props().onRefresh();
  await waitFor(() => props().diagnostics.stateName === "pre_ai_dirty", "dirty marking session");
  return { props, render, runtime, tabsSendMessage, state };
}

describe("rewrite popup entrypoint", () => {
  afterEach(() => {
    vi.doUnmock("../../../src/popup/emulation-reload-transition");
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "__UF_DEBUG_BUILD__");
  });

  it("keeps the tab in mobile simulation from the moment it is bound", async () => {
    // Mobile is the standing posture, not something marking switches on: the
    // crawler reads the mobile render, so that is the render every decision has to
    // be made against. Before, emulation only arrived with an armed session.
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    // makeRuntime answers emulation itself, before the per-test handler, so the
    // record of what was asked for is the shared mock's own call log.
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;
    const emulationFrames = () => runtime.sendMessage.mock.calls
      .map(([frame]) => frame as { name?: string; payload?: unknown })
      .filter((frame) => frame.name === "emulation.apply" || frame.name === "emulation.clear");

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => emulationFrames().length > 0, "the standing emulation posture");

    // No marking, no render mode, no session — and the tab is already mobile.
    // allowReload is true here because no marking session is armed: establishing a
    // spoofed identity needs a load, and there is nothing to lose to one yet.
    expect(emulationFrames()).toEqual([
      { name: "emulation.apply", payload: { tabId: 77, mode: "mobile", scale: 1, allowReload: true } },
    ].map((expected) => expect.objectContaining(expected)));
  });

  it("reprojects silent selectors when the same tab and URL receive a new document", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    let clock = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let documentNonce = "document-a";
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => message.type === "getContentMainStatus"
      ? {
        ok: true,
        active: false,
        dirty: false,
        pageUrl: "https://example.com/page",
        documentNonce,
        contentRows: [],
      }
      : {
        ok: true,
        initialized: true,
        tree: "rewrite",
        ...(message.type === "applySilentSelectors" ? { presentationAcknowledged: true } : {}),
      });
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    const silentProjectionCount = () => tabsSendMessage.mock.calls.filter(([, frame]) =>
      (frame as BusFrame).name === "command.dispatch" &&
      ((frame as BusFrame).payload as { name?: string }).name === "applySilentSelectors"
    ).length;
    await waitFor(() => render.mock.calls.length > 0, "the initial popup render");
    props().onRefresh();
    await waitFor(() => silentProjectionCount() === 1, "the first silent selector projection");
    expect(props().presentation).toMatchObject({
      silentModeActive: true,
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    });

    const poll = globalThis.window.setInterval.mock.calls
      .find(([, delay]) => delay === 500)?.[0] as (() => void) | undefined;
    expect(poll).toEqual(expect.any(Function));
    clock += 15_000;
    poll?.();
    await flushEntrypointWork();
    expect(silentProjectionCount()).toBe(1);

    documentNonce = "document-b";
    clock += 15_000;
    poll?.();
    await waitFor(() => silentProjectionCount() === 2, "the replacement document projection");
    dateNow.mockRestore();
  });

  it("projects only explicit operator outcomes as replaceable toast occurrences", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })) },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    expect(props().toast).toBeNull();

    // This is a final, user-triggered refusal. It appears in Activity and as one
    // concise transient occurrence.
    props().onCandidateNavigate("//invalid-cross-origin-page-key");
    expect(props().presentation).toMatchObject({
      curtainVisible: true,
      curtainText: "Opening candidate page",
      temporarilyDisabledOverlay: true,
    });
    await waitFor(
      () => props().toast?.message === "Candidate navigation blocked: invalid relative page key",
      "navigation refusal toast",
    );
    const occurrence = props().toast;
    expect(occurrence).toMatchObject({
      id: expect.any(Number),
      tone: "warning",
      message: "Candidate navigation blocked: invalid relative page key",
    });
    expect(props().diagnostics.log).toContainEqual(expect.objectContaining({
      label: "Candidate navigation blocked",
      tone: "warn",
    }));

    props().onToastDismiss(occurrence.id);
    await waitFor(() => props().toast === null, "manual toast dismissal");
    // A later informational Activity entry must not reconstruct the dismissed
    // notification from history.
    props().onRenderModePick("rendered");
    expect(props().diagnostics.log).toContainEqual(expect.objectContaining({
      label: "Candidate navigation blocked",
      tone: "warn",
    }));
    expect(props().toast).toBeNull();
  });

  it("fences a delayed tab-A result across B and a same-key A rebind", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    let activeUrl = "https://example.com/a";
    const query = vi.fn(async () => [{ id: 77, url: activeUrl }]);
    const get = vi.fn(async () => ({ id: 77, url: activeUrl }));
    let releaseActivation: ((value: unknown) => void) | null = null;
    let activationRequested = false;
    const delayedActivation = new Promise<unknown>((resolve) => {
      releaseActivation = resolve;
    });
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "activateContentMain") {
        activationRequested = true;
        return delayedActivation;
      }
      if (message.type === "getContentMainStatus") {
        return { ok: true, active: false, dirty: false, pageUrl: activeUrl, contentRows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, get, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.activateDirectMode();
    props().onEnableChange(true);
    await waitFor(() => activationRequested, "the delayed tab-A activation");
    // A stale physical edge can race the render that disables the toggle. It
    // must leave a visible reason instead of silently disappearing at admission.
    props().onEnableChange(true);
    expect(props().toast).toMatchObject({
      tone: "warning",
      message: "Enable marking unavailable: another action is still finishing",
    });

    activeUrl = "https://example.com/b";
    props().onRefresh();
    await waitFor(() => props().diagnostics.pageUrl === activeUrl, "the tab-B binding");
    activeUrl = "https://example.com/a";
    props().onRefresh();
    await waitFor(() => props().diagnostics.pageUrl === activeUrl, "the new tab-A binding occurrence");

    releaseActivation?.({ ok: true, initialized: true, tree: "rewrite" });
    await flushEntrypointWork();

    expect(props().toast).toBeNull();
    expect(props().diagnostics.contentActive).toBe(false);
    expect(props().diagnostics.log.map((entry: { label: string }) => entry.label)).not.toContain(
      "Direct marking enabled",
    );
  });

  it("restores silent content when activation builds a blocked marking layer", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "activateContentMain") {
        return {
          ok: false,
          initialized: true,
          interactionsReady: false,
          interactionsReason: "property-lock",
          reason: "property-lock",
          tree: "rewrite",
        };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.activateDirectMode();
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();

    const commandNames = tabsSendMessage.mock.calls.map(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name);
    expect(commandNames.indexOf("activateContentMain")).toBeGreaterThanOrEqual(0);
    expect(commandNames.lastIndexOf("enterSilentContentMain"))
      .toBeGreaterThan(commandNames.indexOf("activateContentMain"));
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.contentActive).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.toast).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("property-lock"),
    });
  });

  it("routes lock banner actions through the background-owned transfer path", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const runtime = makeRuntime(async (message) => replyFrame(message, message.name === "lock.action"
      ? { status: "ok" }
      : []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })) },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    render.mock.calls.at(-1)?.[0].props.onLockAction({
      kind: "continue-here",
      confirmDiscard: true,
    });
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "lock.action"),
      "lock action dispatch",
    );
    // App dispatches this callback only after its inline confirmation; the
    // entrypoint must not open a blocking native dialog.
    expect(window.confirm).not.toHaveBeenCalled();
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "lock.action",
      target: "background",
      payload: { kind: "continue-here", confirmDiscard: true, tabId: 77 },
    }));
  });

  it("loads, applies, persists, and live-syncs the global appearance", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    let storageListener: ((
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => void) | null = null;
    const storageGet = vi.fn((_keys: string[], callback: (value: Record<string, unknown>) => void) => {
      callback({ globalTheme: "plum", globalThemeMode: "dark" });
    });
    const storageSet = vi.fn((_value: Record<string, unknown>, callback: () => void) => callback());
    const storageAddListener = vi.fn((listener) => {
      storageListener = listener;
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })) },
      storage: {
        sync: { get: storageGet, set: storageSet },
        onChanged: { addListener: storageAddListener },
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(
      () => document.documentElement.dataset.theme === "plum",
      "stored appearance",
    );
    expect(document.documentElement.dataset).toMatchObject({ theme: "plum", themeMode: "dark" });
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(render.mock.calls.at(-1)?.[0].props.appearance).toEqual({ theme: "plum", mode: "dark" });

    render.mock.calls.at(-1)?.[0].props.onThemeChange("ocean");
    await flushEntrypointWork();
    expect(document.documentElement.dataset.theme).toBe("ocean");
    expect(storageSet).toHaveBeenCalledWith({ globalTheme: "ocean", globalThemeMode: "dark" }, expect.any(Function));

    render.mock.calls.at(-1)?.[0].props.onThemeModeChange("light");
    await flushEntrypointWork();
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(storageSet).toHaveBeenCalledWith({ globalTheme: "ocean", globalThemeMode: "light" }, expect.any(Function));

    storageListener?.({
      globalTheme: { newValue: "neutral" },
      globalThemeMode: { newValue: "system" },
    }, "sync");
    expect(document.documentElement.dataset).toMatchObject({ theme: "neutral", themeMode: "system" });
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("returns the tab to mobile when marking ends rather than releasing it", async () => {
    // Leaving marking does not end the extension's presence on the tab, so the
    // posture holds. Releasing emulation there left the page at desktop width while
    // the operator was still looking at it through the extension.
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    let signalSeq = 0;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1", tabId: request.tabId, seq: signalSeq, name: request.signal?.name,
          source: "brain", cause: "test", at: signalSeq, payload: request.signal?.payload ?? {},
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;
    const emulationNames = () => runtime.sendMessage.mock.calls
      .map(([frame]) => frame as { name?: string; payload?: { mode?: string } })
      .filter((frame) => frame.name === "emulation.apply" || frame.name === "emulation.clear")
      .map((frame) => (frame.name === "emulation.clear" ? "cleared" : String(frame.payload?.mode)));

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    await waitFor(() => emulationNames().length > 0, "the initial posture");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onEnableChange(false);
    await flushEntrypointWork();

    // Assert the evidence exists before asserting what it says: `every` on an empty
    // array is vacuously true and would pass with emulation removed altogether.
    expect(emulationNames().length).toBeGreaterThan(0);
    expect(emulationNames()).not.toContain("cleared");
    expect(emulationNames().every((mode) => mode === "mobile")).toBe(true);
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("enterSilentContentMain", {
      pageUrl: "https://example.com",
    }));
  });

  it("serializes desktop-silent to marking-mobile to desktop-silent transitions", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    let signalSeq = 0;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1", tabId: request.tabId, seq: signalSeq, name: request.signal?.name,
          source: "brain", cause: "test", at: signalSeq, payload: request.signal?.payload ?? {},
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;
    const emulationModes = () => runtime.sendMessage.mock.calls
      .map(([frame]) => frame as { name?: string; payload?: { mode?: string } })
      .filter((frame) => frame.name === "emulation.apply")
      .map((frame) => frame.payload?.mode);

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await confirmRenderMode(render);
    await waitFor(() => emulationModes().length > 0, "initial emulation posture");
    props().onDesktopPreviewChange(true);
    await waitFor(() => emulationModes().at(-1) === "desktop", "desktop silent posture");

    props().onEnableChange(true);
    await waitFor(
      () => tabsSendMessage.mock.calls.some(([, frame]) =>
        ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "activateContentMain"),
      "marking activation",
    );
    expect(emulationModes().at(-1)).toBe("mobile");
    const viewportRefreshesAfterMobile = tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "refreshInteractionShieldViewport");
    expect(viewportRefreshesAfterMobile.length).toBeGreaterThan(0);

    props().onEnableChange(false);
    await waitFor(() => emulationModes().at(-1) === "desktop", "restored desktop silent posture");
    expect(emulationModes().slice(-3)).toEqual(["desktop", "mobile", "desktop"]);

    const enterSilentCall = tabsSendMessage.mock.calls.findIndex(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "enterSilentContentMain");
    const finalDesktopCall = runtime.sendMessage.mock.calls.findLastIndex(([frame]) =>
      frame.name === "emulation.apply" && frame.payload.mode === "desktop");
    expect(enterSilentCall).toBeGreaterThanOrEqual(0);
    expect(finalDesktopCall).toBeGreaterThanOrEqual(0);
    expect(tabsSendMessage.mock.invocationCallOrder[enterSilentCall]!)
      .toBeLessThan(runtime.sendMessage.mock.invocationCallOrder[finalDesktopCall]!);
    const finalViewportRefresh = tabsSendMessage.mock.calls.findLastIndex(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "refreshInteractionShieldViewport");
    expect(finalViewportRefresh).toBeGreaterThanOrEqual(0);
    expect(runtime.sendMessage.mock.invocationCallOrder[finalDesktopCall]!)
      .toBeLessThan(tabsSendMessage.mock.invocationCallOrder[finalViewportRefresh]!);
  });

  it("rechecks background posture when a popup-local mode looks exact", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    let backgroundExact = true;
    const runtime = makeRuntime(async (message) => replyFrame(message, []), "rendered", {
      emulationCurrent: (frame) => replyFrame(frame, backgroundExact
        ? { mode: "mobile", width: 412, height: 960, scale: 1, active: true }
        : null),
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "emulation.apply"),
      "initial emulation",
    );
    const before = runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "emulation.apply").length;
    backgroundExact = false;
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await waitFor(
      () => runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "emulation.apply").length > before,
      "authoritative posture recovery",
    );

    const names = runtime.sendMessage.mock.calls.map(([frame]) => frame.name);
    expect(names.lastIndexOf("emulation.current")).toBeLessThan(names.lastIndexOf("emulation.apply"));
  });

  it("requests a background refit when side-panel geometry changes without reapplying a mode", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    let resizeListener: (() => void) | null = null;
    Object.assign(window, {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: vi.fn((name: string, listener: () => void) => {
        if (name === "resize") resizeListener = listener;
      }),
      removeEventListener: vi.fn(),
    });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: makeTabsSendMessage(() => ({ ok: true, tree: "rewrite" })) },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "emulation.refit"),
      "initial side-panel fit",
    );
    const applyCount = runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "emulation.apply").length;
    const refitCount = runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "emulation.refit").length;
    resizeListener?.();
    await waitFor(
      () => runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "emulation.refit").length > refitCount,
      "resized side-panel fit",
    );

    expect(runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "emulation.apply"))
      .toHaveLength(applyCount);
  });

  it("acknowledges silent mode only after a desktop replacement document paints selectors", async () => {
    let documentNonce = "document-a";
    let releaseReplacement!: () => void;
    const replacementGate = new Promise<void>((resolve) => { releaseReplacement = resolve; });
    const replacementChecks: boolean[] = [];
    vi.doMock("../../../src/popup/emulation-reload-transition", async () => {
      const actual = await vi.importActual<typeof import("../../../src/popup/emulation-reload-transition")>(
        "../../../src/popup/emulation-reload-transition",
      );
      return {
        ...actual,
        waitForReloadTransition: vi.fn(async (options: {
          original: { tabId: number; url: string };
          contentReady: (context: { tabId: number; url: string }) => Promise<boolean>;
        }) => {
          replacementChecks.push(await options.contentReady(options.original));
          await replacementGate;
          documentNonce = "document-b";
          replacementChecks.push(await options.contentReady(options.original));
          return { status: "ready" as const, context: options.original };
        }),
      };
    });
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let markingActive = false;
    let silentTransitionStarted = false;
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "getContentMainStatus") {
        return {
          ok: true,
          active: markingActive,
          dirty: false,
          pageUrl: "https://example.com/page",
          documentNonce,
          authority: { environmentKey: "example.com", siteId: 1, lockBlocked: false },
          contentRows: [],
        };
      }
      if (message.type === "activateContentMain") {
        markingActive = true;
      } else if (message.type === "enterSilentContentMain") {
        markingActive = false;
        silentTransitionStarted = true;
      }
      return {
        ok: true,
        initialized: true,
        tree: "rewrite",
        ...(message.type === "applySilentSelectors" ? { presentationAcknowledged: true } : {}),
      };
    });
    const runtime = makeRuntime(async (message) => replyFrame(message, []), "rendered", {
      emulationApply: (frame) => {
        const payload = frame.payload as { mode: "mobile" | "desktop"; allowReload?: boolean };
        const mode = payload.mode;
        const reloadRequired = silentTransitionStarted && mode === "desktop" && payload.allowReload !== false;
        return replyFrame(frame, {
          mode,
          width: mode === "desktop" ? 1920 : 412,
          height: mode === "desktop" ? 1080 : 960,
          scale: 1,
          active: !reloadRequired,
          identityStale: reloadRequired,
          reloadRequired,
          ...(reloadRequired ? { failureReason: "identity_mismatch" } : {}),
        });
      },
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await confirmRenderMode(render);
    props().onRefresh();
    await waitFor(
      () => props().presentation.selectors?.inclusionSelectors?.includes("main") === true,
      "stored selectors",
    );
    props().onDesktopPreviewChange(true);
    await waitFor(() => runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "emulation.apply" &&
      (frame.payload as { mode?: string }).mode === "desktop"), "initial desktop posture");
    props().onEnableChange(true);
    await waitFor(() => props().diagnostics.contentActive === true, "marking activation");
    const projectionsBeforeDisable = tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "applySilentSelectors"
    ).length;

    props().onEnableChange(false);
    await waitFor(() => replacementChecks.length === 1, "old-document replacement check");
    expect(replacementChecks).toEqual([false]);
    expect(props().presentation.temporarilyDisabledOverlay).toBe(true);
    expect(tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "applySilentSelectors"
    )).toHaveLength(projectionsBeforeDisable);

    releaseReplacement();
    await waitFor(
      () => replacementChecks.length === 2 && props().presentation.temporarilyDisabledOverlay === false,
      "replacement silent presentation acknowledgement",
    );
    expect(replacementChecks).toEqual([false, true]);
    expect(props().diagnostics).toMatchObject({ contentActive: false, stateName: "silent" });
    expect(tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "applySilentSelectors"
    )).toHaveLength(projectionsBeforeDisable + 1);
  });

  it("drains an explicit refresh before starting a desktop-to-mobile transition", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let holdNextConfigLoad = false;
    let releaseConfigLoad!: () => void;
    let reportHeldConfigLoad!: () => void;
    const configLoadGate = new Promise<void>((resolve) => { releaseConfigLoad = resolve; });
    const heldConfigLoad = new Promise<void>((resolve) => { reportHeldConfigLoad = resolve; });
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    const runtime = makeRuntime(async (message) => replyFrame(message, []), "rendered", {
      configLoad: async (frame) => {
        if (holdNextConfigLoad) {
          holdNextConfigLoad = false;
          reportHeldConfigLoad();
          await configLoadGate;
        }
        return replyFrame(frame, {
          status: "ok",
          config: backendConfig(),
          renderMode: "rendered",
          renderModeSource: "backend",
        });
      },
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;
    const emulationModes = () => runtime.sendMessage.mock.calls
      .map(([frame]) => frame as { name?: string; payload?: { mode?: string } })
      .filter((frame) => frame.name === "emulation.apply")
      .map((frame) => frame.payload?.mode);
    const activationCount = () => tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "activateContentMain"
    ).length;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await confirmRenderMode(render);
    props().onDesktopPreviewChange(true);
    await waitFor(() => emulationModes().at(-1) === "desktop", "desktop silent posture");

    holdNextConfigLoad = true;
    props().onRefresh();
    await heldConfigLoad;
    expect(props().refreshBusy).toBe(true);
    const mobileCallsBeforeActivation = emulationModes().filter((mode) => mode === "mobile").length;
    props().onEnableChange(true);
    await flushEntrypointWork();

    expect(activationCount()).toBe(0);
    expect(emulationModes().filter((mode) => mode === "mobile")).toHaveLength(mobileCallsBeforeActivation);

    releaseConfigLoad();
    await waitFor(() => activationCount() === 1, "serialized marking activation");
    expect(emulationModes().at(-1)).toBe("mobile");
    expect(props().diagnostics.contentActive).toBe(true);
    expect(props().refreshBusy).toBe(false);
  });

  it("keeps authority refresh single-flight and no more frequent than every 15 seconds", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    let lockCalls = 0;
    let firstLockFrame: BusFrame | null = null;
    let resolveFirstLock: ((frame: BusFrame) => void) | null = null;
    const firstLock = new Promise<BusFrame>((resolve) => { resolveFirstLock = resolve; });
    const lockPayload = {
      status: "ok",
      baseUrl: "https://example.com",
      siteId: 1,
      lockRole: "editor",
      configPresent: true,
      canEdit: true,
      blockedReason: "editor",
      authority: {
        environmentKey: "example.com",
        editorSessionId: "editor-1",
        lockToken: "lock-1",
        propertyRevision: 4,
        feedRevision: 2,
      },
      lockBanner: { visible: false, reason: "editor" },
    };
    const runtime = makeRuntime(async (message) => replyFrame(message, []), "rendered", {
      lockDirective: async (frame) => {
        lockCalls += 1;
        if (lockCalls === 1) {
          firstLockFrame = frame;
          return await firstLock;
        }
        return replyFrame(frame, lockPayload);
      },
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" })) },
    } as unknown as typeof chrome;

    try {
      await import("../../../src/entrypoints/popup/main.tsx");
      await waitFor(() => render.mock.calls.at(-1)?.[0].props.diagnostics.settingsLoaded, "stored settings");
      const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
      poll();
      await waitFor(() => lockCalls === 1, "first authority request");

      now += 15_000;
      poll();
      poll();
      poll();
      await flushEntrypointWork();
      expect(lockCalls).toBe(1);

      resolveFirstLock?.(replyFrame(firstLockFrame!, lockPayload));
      await waitFor(() => lockCalls === 2, "one coalesced trailing authority request");
      await flushEntrypointWork();
      expect(runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "config.load")).toHaveLength(1);

      poll();
      await flushEntrypointWork();
      expect(lockCalls).toBe(2);
      now += 14_999;
      poll();
      await flushEntrypointWork();
      expect(lockCalls).toBe(2);
      now += 1;
      poll();
      await waitFor(() => lockCalls === 3, "next scheduled authority request");
      expect(runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "config.load")).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("does not adopt a render mode until the operator confirms it", async () => {
    // Picking edits a pending value; only the CTA decides. Otherwise a stray
    // click relabels every later capture, and there is no way to look at both
    // loads before committing.
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    const remembered: unknown[] = [];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "renderMode.remember") {
        remembered.push(message.payload);
        return replyFrame(message, { stored: true });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;

    props().onRenderModePick("static");
    await flushEntrypointWork();
    // Pending, not in force — and nothing has been asked to remember it.
    expect(props().diagnostics.renderModePending).toBe("static");
    expect(props().diagnostics.renderMode).toBe(null);
    expect(remembered).toEqual([]);

    // Cancelling drops the pick and leaves the mode unset.
    props().onRenderModeCancel();
    await flushEntrypointWork();
    expect(props().diagnostics.renderModePending).toBe(null);
    expect(props().diagnostics.renderMode).toBe(null);
    expect(remembered).toEqual([]);

    // Confirming is what adopts it.
    props().onRenderModePick("static");
    props().onRenderModeCommit();
    await flushEntrypointWork();
    expect(props().diagnostics.renderMode).toBe("static");
    expect(props().diagnostics.renderModePending).toBe(null);
    // Local persistence is a separate question — it needs a resolved site id,
    // which this test deliberately does not set up, so the point being made here
    // is only that the pick alone never reached the background at all.
    expect(remembered).toEqual([]);
  });

  it("starts an exactly bound durable inspection and adopts only paint acknowledgment", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const runtime = makeRuntime(async (message) => {
      if (message.name === "renderInspection.start") {
        const request = message.payload as { javascriptEnabled: boolean };
        return replyFrame(message, {
          status: "started",
          session: renderInspectionSession({
            phase: "terminal",
            javascriptEnabled: request.javascriptEnabled,
            updatedAt: Date.now() + 1,
            terminalReason: "paint-acknowledged",
          }),
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    const lockCallsBefore = runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "lock.directive").length;
    render.mock.calls.at(-1)?.[0].props.onInspectRenderMode(false);
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeView === "without_javascript",
      "paint-acknowledged static view",
    );

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderInspection.start",
      target: "background",
      payload: {
        tabId: 77,
        property: {
          environmentKey: "example.com",
          siteId: 1,
          baseUrl: "https://example.com",
        },
        pageUrl: "https://example.com/page",
        javascriptEnabled: false,
      },
    }));
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics).toMatchObject({
      renderModeView: "without_javascript",
      renderModeBusy: false,
      renderModeDetail: "",
    });
    expect(runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "lock.directive").length).toBeGreaterThan(lockCallsBefore);
    expect(runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderMode.inspect")).toBe(false);
    expect(runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "fact.reported")
      .some(([frame]) => JSON.stringify(frame.payload).includes("inspectionPending"))).toBe(false);
    // Disposal has no authority path: nothing implicitly cancelled this terminal
    // generation after the popup finished projecting it.
    expect(runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.cancel")).toBe(false);
  });

  it("keeps an operator-started inspection open across delayed startup config adoption", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let pendingConfigFrame: BusFrame | null = null;
    let releaseConfig!: (frame: BusFrame) => void;
    const delayedConfig = new Promise<BusFrame>((resolve) => {
      releaseConfig = resolve;
    });
    const runtime = makeRuntime(
      async (message) => {
        if (message.name === "renderInspection.start") {
          const request = message.payload as { javascriptEnabled: boolean };
          return replyFrame(message, {
            status: "started",
            session: renderInspectionSession({
              phase: "terminal",
              javascriptEnabled: request.javascriptEnabled,
              updatedAt: Date.now() + 1,
              terminalReason: "paint-acknowledged",
            }),
          });
        }
        return replyFrame(message, []);
      },
      "rendered",
      {
        configLoad: async (frame) => {
          pendingConfigFrame = frame;
          return await delayedConfig;
        },
      },
    );
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored settings");
    const poll = globalThis.window.setInterval.mock.calls
      .find(([, delay]) => delay === 500)?.[0] as (() => void) | undefined;
    expect(poll).toEqual(expect.any(Function));
    poll?.();
    await waitFor(() => pendingConfigFrame !== null, "the deferred startup config load");
    expect(props().view).toBe("render-mode");
    expect(props().diagnostics.renderMode).toBeNull();

    props().onInspectRenderMode(true);
    await waitFor(
      () => props().diagnostics.renderModeView === "with_javascript",
      "the paint-acknowledged JavaScript inspection",
    );
    expect(props().view).toBe("render-mode");

    releaseConfig(replyFrame(pendingConfigFrame!, {
      status: "ok",
      config: { ...backendConfig(), renderMode: "rendered" },
      renderMode: "rendered",
      renderModeSource: "backend",
    }));
    await waitFor(() => props().diagnostics.configStatus === "ok", "authoritative config adoption");

    expect(props()).toMatchObject({
      view: "render-mode",
      diagnostics: {
        configStatus: "ok",
        renderMode: "rendered",
        renderModeSource: "backend",
        renderModeView: "with_javascript",
        renderModeBusy: false,
      },
    });
  });

  it("keeps confirmed paint authoritative while post-paint lock refresh exceeds the popup watchdog", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let holdNextLockRefresh = false;
    let heldLockFrame: BusFrame | null = null;
    let releaseLockRefresh!: (frame: BusFrame) => void;
    const delayedLockRefresh = new Promise<BusFrame>((resolve) => {
      releaseLockRefresh = resolve;
    });
    const editableLockReply = (message: BusFrame) => replyFrame(message, {
      status: "ok",
      baseUrl: "https://example.com",
      siteId: 1,
      lockRole: "editor",
      configPresent: true,
      canEdit: true,
      blockedReason: "editor",
      authority: {
        environmentKey: "example.com",
        editorSessionId: "editor-1",
        lockToken: "lock-1",
        propertyRevision: 4,
        feedRevision: 2,
      },
      lockBanner: { visible: false, reason: "editor" },
    });
    const runtime = makeRuntime(
      async (message) => {
        if (message.name === "renderInspection.start") {
          const request = message.payload as { javascriptEnabled: boolean };
          return replyFrame(message, {
            status: "started",
            session: renderInspectionSession({
              phase: "terminal",
              javascriptEnabled: request.javascriptEnabled,
              updatedAt: Date.now() + 1,
              terminalReason: "paint-acknowledged",
            }),
          });
        }
        return replyFrame(message, []);
      },
      "rendered",
      {
        lockDirective: (message) => {
          if (!holdNextLockRefresh) {
            return editableLockReply(message);
          }
          holdNextLockRefresh = false;
          heldLockFrame = message;
          return delayedLockRefresh;
        },
      },
    );
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    const props = () => render.mock.calls.at(-1)?.[0].props;

    vi.useFakeTimers();
    try {
      holdNextLockRefresh = true;
      props().onInspectRenderMode(false);
      for (let index = 0; index < 100; index += 1) {
        await Promise.resolve();
      }

      expect(heldLockFrame).not.toBeNull();
      expect(props().diagnostics).toMatchObject({
        renderModeView: "without_javascript",
        renderModeBusy: false,
        renderModeDetail: "",
      });

      await vi.advanceTimersByTimeAsync(20_000);
      for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
      }

      // The watchdog belongs to the inspection observation, which already
      // settled. A slow lock refresh cannot demote exact paint success.
      expect(props().diagnostics).toMatchObject({
        renderModeView: "without_javascript",
        renderModeBusy: false,
        renderModeDetail: "",
      });

      releaseLockRefresh(editableLockReply(heldLockFrame as BusFrame));
      for (let index = 0; index < 30; index += 1) {
        await Promise.resolve();
      }
      expect(props().diagnostics).toMatchObject({
        renderModeView: "without_javascript",
        renderModeBusy: false,
        renderModeDetail: "",
      });
      expect(runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.cancel")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("inspects a managed non-candidate page without borrowing edit-lock authority", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/off-candidate" }]);
    const lockDirective = vi.fn((message: BusFrame) => replyFrame(message, {
      status: "not_candidate",
      baseUrl: "https://example.com",
      siteId: null,
      lockRole: "unknown",
      configPresent: true,
      canEdit: false,
      blockedReason: "not-candidate",
      lockBanner: { visible: true, reason: "not-candidate" },
    }));
    const runtime = makeRuntime(
      async (message) => {
        if (message.name === "renderInspection.start") {
          return replyFrame(message, {
            status: "started",
            session: renderInspectionSession({
              phase: "terminal",
              pageUrl: "https://example.com/off-candidate",
              javascriptEnabled: false,
              updatedAt: Date.now() + 1,
              terminalReason: "paint-acknowledged",
            }),
          });
        }
        return replyFrame(message, []);
      },
      "rendered",
      {
        lockDirective,
        pageContextStatus: "managed_non_candidate",
      },
    );
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    render.mock.calls.at(-1)?.[0].props.onInspectRenderMode(false);
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeView === "without_javascript",
      "off-candidate inspection paint",
    );

    expect(lockDirective).toHaveBeenCalled();
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderInspection.start",
      payload: {
        tabId: 77,
        property: {
          environmentKey: "example.com",
          siteId: 1,
          baseUrl: "https://example.com",
        },
        pageUrl: "https://example.com/off-candidate",
        javascriptEnabled: false,
      },
    }));
  });

  it("reconstructs active and terminal inspection state when the popup reopens", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let current = renderInspectionSession({
      token: "reopened-inspection",
      phase: "awaiting_document",
      updatedAt: Date.now(),
      deadlineAt: Date.now() + 30_000,
    });
    const lockDirective = vi.fn((message: BusFrame) => replyFrame(message, {
      status: "not_candidate",
      baseUrl: "https://example.com",
      siteId: null,
      lockRole: "unknown",
      configPresent: true,
      canEdit: false,
      blockedReason: "not-candidate",
      lockBanner: { visible: true, reason: "not-candidate" },
    }));
    const runtime = makeRuntime(
      async (message) => replyFrame(message, []),
      "rendered",
      {
        renderInspectionCurrent: (message) => replyFrame(message, {
          status: current.phase === "terminal" ? "terminal" : "active",
          session: current,
        }),
        pageContextStatus: "managed_non_candidate",
        lockDirective,
      },
    );
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeBusy === true,
      "reopened active inspection",
    );
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics).toMatchObject({
      renderModeBusy: true,
      renderModeView: "unknown",
    });
    expect(runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.start")).toBe(false);

    current = renderInspectionSession({
      ...current,
      phase: "terminal",
      javascriptEnabled: false,
      updatedAt: current.updatedAt + 1,
      terminalReason: "paint-acknowledged",
    });
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as (() => void) | undefined;
    poll?.();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeView === "without_javascript",
      "reopened terminal inspection",
    );
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics).toMatchObject({
      renderModeBusy: false,
      renderModeView: "without_javascript",
      renderModeDetail: "",
    });

    current = renderInspectionSession({
      ...current,
      phase: "terminal",
      updatedAt: current.updatedAt + 1,
      terminalReason: "unexpected-navigation",
    });
    // Inspection is slow-lane authority and therefore does not re-fetch on a
    // second 500 ms backstop tick. Explicit Refresh is its immediate retry.
    render.mock.calls.at(-1)?.[0].props.onRefresh();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeDetail !== "",
      "same-generation navigation invalidation",
    );
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics).toMatchObject({
      renderModeBusy: false,
      renderModeView: "without_javascript",
    });
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeDetail)
      .toContain("navigated somewhere else");
    expect(runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.cancel")).toBe(false);
  });

  it("keeps the last painted view when a newer durable inspection fails", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let generation = 0;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "renderInspection.start") {
        generation += 1;
        const request = message.payload as { javascriptEnabled: boolean };
        return replyFrame(message, {
          status: generation === 1 ? "started" : "error",
          ...(generation === 2 ? { reason: "content did not acknowledge paint" } : {}),
          session: renderInspectionSession({
            token: `inspection-${generation}`,
            generation,
            phase: "terminal",
            javascriptEnabled: request.javascriptEnabled,
            updatedAt: Date.now() + generation,
            terminalReason: generation === 1 ? "paint-acknowledged" : "content-failed",
          }),
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    render.mock.calls.at(-1)?.[0].props.onInspectRenderMode(true);
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeView === "with_javascript",
      "first painted inspection",
    );
    render.mock.calls.at(-1)?.[0].props.onInspectRenderMode(false);
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeDetail !== "",
      "retryable failed inspection",
    );

    expect(render.mock.calls.at(-1)?.[0].props.diagnostics).toMatchObject({
      renderModeBusy: false,
      renderModeView: "with_javascript",
    });
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeDetail).toContain("could not confirm");
  });

  it("projects an already-active opposite view as a retryable conflict", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const existing = renderInspectionSession({
      token: "existing-javascript-inspection",
      generation: 7,
      phase: "awaiting_document",
      javascriptEnabled: true,
      updatedAt: Date.now(),
      deadlineAt: Date.now() + 30_000,
    });
    const runtime = makeRuntime(async (message) => {
      if (message.name === "renderInspection.start") {
        return replyFrame(message, {
          status: "error",
          reason: "inspection-already-active",
          session: existing,
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    props().onInspectRenderMode(false);
    await waitFor(
      () => props().diagnostics.renderModeDetail.includes("already loading"),
      "already-active inspection conflict",
    );

    expect(props().diagnostics).toMatchObject({
      renderModeBusy: false,
      renderModeView: "unknown",
    });
    expect(props().diagnostics.renderModeDetail).toContain("with JavaScript");
    expect(props().diagnostics.renderModeDetail).toContain("retry this view");
  });

  it("does not open connection settings until the static tab confirms JavaScript paint", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const staticTerminal = renderInspectionSession({
      token: "static-inspection",
      generation: 1,
      phase: "terminal",
      javascriptEnabled: false,
      updatedAt: Date.now(),
      terminalReason: "paint-acknowledged",
    });
    let javascriptStartFrame: BusFrame | null = null;
    let resolveJavascriptStart: ((frame: BusFrame) => void) | null = null;
    const javascriptStart = new Promise<BusFrame>((resolve) => {
      resolveJavascriptStart = resolve;
    });
    const runtime = makeRuntime(
      async (message) => {
        if (message.name === "renderInspection.start") {
          javascriptStartFrame = message;
          return await javascriptStart;
        }
        return replyFrame(message, []);
      },
      "static",
      {
        renderInspectionCurrent: (message) => replyFrame(message, {
          status: "terminal",
          session: staticTerminal,
        }),
      },
    );
    let holdExitSilentProjection = false;
    let releaseExitSilentProjection: (() => void) | null = null;
    const tabsSendMessage = makeTabsSendMessage(async (_tabId, message) => {
      if (message.type === "applySilentSelectors") {
        if (holdExitSilentProjection) {
          await new Promise<void>((resolve) => { releaseExitSilentProjection = resolve; });
        }
        return {
          ok: true,
          applied: true,
          presentationAcknowledged: true,
          tree: "rewrite",
        };
      }
      if (message.type === "getContentMainStatus") {
        return { ok: true, active: false, documentNonce: "render-exit-document" };
      }
      return { ok: true, active: false };
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(
      () => props().diagnostics.renderModeView === "without_javascript",
      "authoritative static terminal",
    );
    props().onRefresh();
    await waitFor(
      () => props().diagnostics.configStatus === "ok" && props().diagnostics.stateName === "silent",
      "selector-bearing silent authority behind Render mode",
    );
    props().onOpenRenderMode();
    await waitFor(() => props().view === "render-mode", "the explicit Render mode view");

    props().onOpenConfiguration();
    await waitFor(() => javascriptStartFrame !== null, "JavaScript restoration start");
    const commandsBeforeJavascriptPaint = tabsSendMessage.mock.calls.map(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name,
    );

    expect(props().view).toBe("render-mode");
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderInspection.start",
      payload: expect.objectContaining({ javascriptEnabled: true }),
    }));
    expect(tabsSendMessage.mock.calls.some(([, message]) =>
      JSON.stringify(message).includes("activateContentMain"))).toBe(false);
    expect(commandsBeforeJavascriptPaint).not.toContain("preparePageVisit");

    holdExitSilentProjection = true;

    const startFrame = javascriptStartFrame as BusFrame;
    resolveJavascriptStart?.(replyFrame(startFrame, {
      status: "started",
      session: renderInspectionSession({
        token: "javascript-inspection",
        generation: 2,
        phase: "terminal",
        javascriptEnabled: true,
        updatedAt: staticTerminal.updatedAt + 1,
        terminalReason: "paint-acknowledged",
      }),
    }));
    await waitFor(
      () => tabsSendMessage.mock.calls.some(([, frame]) =>
        ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "preparePageVisit"),
      "reveal/freeze request after JavaScript paint",
    );
    await waitFor(
      () => releaseExitSilentProjection !== null,
      "silent selector projection after reveal/freeze",
    );
    expect(props().view).toBe("render-mode");
    const exitCommands = tabsSendMessage.mock.calls.map(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name,
    );
    expect(exitCommands.indexOf("preparePageVisit")).toBeGreaterThanOrEqual(0);
    expect(exitCommands.indexOf("preparePageVisit")).toBeLessThan(exitCommands.lastIndexOf("applySilentSelectors"));

    holdExitSilentProjection = false;
    releaseExitSilentProjection?.();
    await waitFor(() => props().view === "configuration", "connection settings after JavaScript paint");

    expect(props().diagnostics).toMatchObject({
      renderModeBusy: false,
      renderModeView: "with_javascript",
    });
  });

  it("does not infer JavaScript restoration when reopened current authority times out", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const neverCurrent = new Promise<BusFrame>(() => undefined);
    const runtime = makeRuntime(
      async (message) => replyFrame(message, []),
      "static",
      { renderInspectionCurrent: async () => await neverCurrent },
    );
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, active: false }));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    vi.useFakeTimers();
    try {
      await import("../../../src/entrypoints/popup/main.tsx");
      const props = () => render.mock.calls.at(-1)?.[0].props;
      props().onOpenConfiguration();
      for (let index = 0; index < 50; index += 1) {
        await Promise.resolve();
      }

      // The popup-open reconstruction and the explicit exit each require their
      // own authoritative current read. Neither timeout can mean "inactive".
      await vi.advanceTimersByTimeAsync(20_000);
      for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
      }
      await vi.advanceTimersByTimeAsync(20_000);
      for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
      }

      expect(props().view).toBe("render-mode");
      expect(props().diagnostics).toMatchObject({
        renderModeBusy: false,
        renderModeView: "unknown",
      });
      expect(runtime.sendMessage.mock.calls.some(([frame]) =>
        frame.name === "renderInspection.start")).toBe(false);
      expect(tabsSendMessage.mock.calls.some(([, message]) =>
        JSON.stringify(message).includes("preparePageVisit"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits render mode when current authority belongs to the prior document", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const pageUrl = "https://example.com/off-candidate";
    const query = vi.fn().mockResolvedValue([{ id: 77, url: pageUrl }]);
    const runtime = makeRuntime(
      async (message) => replyFrame(message, []),
      "rendered",
      {
        renderInspectionCurrent: (message) => replyFrame(message, {
          status: "active",
          session: renderInspectionSession({
            pageUrl: "https://example.com/prior-candidate",
            phase: "awaiting_document",
          }),
        }),
      },
    );
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, active: false }));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await confirmRenderMode(render);
    await waitFor(() => props().view === "silent", "the established session view");
    expect(props().diagnostics.renderMode).toBe("rendered");
    props().onOpenRenderMode();
    expect(props().view).toBe("render-mode");

    props().onRenderModeCancel();
    await waitFor(() => props().view === "silent", "render-mode cancellation");

    expect(props().diagnostics).toMatchObject({
      renderModeBusy: false,
      renderModeView: "unknown",
    });
    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "renderInspection.start")).toBe(false);
  });

  it.each(["timeout", "content-failed"] as const)(
    "keeps render-mode open when authoritative terminal %s cannot restore JavaScript",
    async (terminalReason) => {
      installEntrypointDom("chrome-extension://extension-id/popup.html");
      const render = createReactRenderProbe();
      vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
      const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
      const priorFailure = renderInspectionSession({
        token: "prior-failed-inspection",
        generation: 3,
        phase: "terminal",
        updatedAt: Date.now(),
        terminalReason,
      });
      const runtime = makeRuntime(
        async (message) => {
          if (message.name === "renderInspection.start") {
            return replyFrame(message, {
              status: "error",
              reason: "restoration-failed",
              session: renderInspectionSession({
                token: "failed-javascript-restoration",
                generation: 4,
                phase: "terminal",
                javascriptEnabled: true,
                updatedAt: priorFailure.updatedAt + 1,
                terminalReason,
              }),
            });
          }
          return replyFrame(message, []);
        },
        "static",
        {
          renderInspectionCurrent: (message) => replyFrame(message, {
            status: "terminal",
            session: priorFailure,
          }),
        },
      );
      const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, active: false }));
      globalThis.chrome = {
        runtime: { ...runtime },
        tabs: { query, sendMessage: tabsSendMessage },
      } as unknown as typeof chrome;

      await import("../../../src/entrypoints/popup/main.tsx");
      const props = () => render.mock.calls.at(-1)?.[0].props;
      await waitFor(
        () => props().diagnostics.renderModeDetail !== "",
        "authoritative failed terminal",
      );
      props().onOpenConfiguration();
      await waitFor(
        () => runtime.sendMessage.mock.calls.some(([frame]) =>
          frame.name === "renderInspection.start"),
        "JavaScript restoration attempt",
      );
      await flushEntrypointWork();

      expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        name: "renderInspection.start",
        payload: expect.objectContaining({ javascriptEnabled: true }),
      }));
      expect(props().view).toBe("render-mode");
      expect(props().diagnostics).toMatchObject({
        renderModeBusy: false,
        renderModeView: "unknown",
      });
      expect(props().diagnostics.renderModeDetail).not.toBe("");
      expect(tabsSendMessage.mock.calls.some(([, message]) =>
        JSON.stringify(message).includes("preparePageVisit"))).toBe(false);
    },
  );

  it("uses exact token and generation only for explicit active-view cancellation", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const active = renderInspectionSession({
      token: "cancel-me",
      generation: 7,
      phase: "awaiting_document",
      updatedAt: Date.now(),
      deadlineAt: Date.now() + 30_000,
    });
    const runtime = makeRuntime(
      async (message) => {
        if (message.name === "renderInspection.cancel") {
          return replyFrame(message, {
            status: "ok",
            session: renderInspectionSession({
              ...active,
              phase: "terminal",
              updatedAt: active.updatedAt + 1,
              terminalReason: "cancelled",
            }),
          });
        }
        return replyFrame(message, []);
      },
      "rendered",
      {
        renderInspectionCurrent: (message) => replyFrame(message, {
          status: "active",
          session: active,
        }),
      },
    );
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeBusy === true,
      "active inspection",
    );
    render.mock.calls.at(-1)?.[0].props.onRenderModeCancel();
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.cancel"),
      "explicit inspection cancellation",
    );

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "renderInspection.cancel",
      target: "background",
      payload: { tabId: 77, token: "cancel-me", generation: 7 },
    }));
  });

  it("does not let an older inactive current completion erase a newer start", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let resolveOldCurrent: ((frame: BusFrame) => void) | null = null;
    const oldCurrent = new Promise<BusFrame>((resolve) => {
      resolveOldCurrent = resolve;
    });
    let currentCalls = 0;
    const runtime = makeRuntime(
      async (message) => {
        if (message.name === "renderInspection.start") {
          return replyFrame(message, {
            status: "started",
            session: renderInspectionSession({
              phase: "terminal",
              javascriptEnabled: false,
              updatedAt: Date.now() + 1,
              terminalReason: "paint-acknowledged",
            }),
          });
        }
        return replyFrame(message, []);
      },
      "rendered",
      {
        renderInspectionCurrent: (message) => {
          currentCalls += 1;
          return currentCalls === 1 ? oldCurrent : replyFrame(message, { status: "inactive" });
        },
      },
    );
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render while current is pending");
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.current"),
      "older current inspection request",
    );
    render.mock.calls.at(-1)?.[0].props.onInspectRenderMode(false);
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeView === "without_javascript",
      "newer started generation",
    );
    const oldRequest = runtime.sendMessage.mock.calls
      .map(([frame]) => frame as BusFrame)
      .find((frame) => frame.name === "renderInspection.current");
    expect(oldRequest).toBeDefined();
    resolveOldCurrent?.(replyFrame(oldRequest as BusFrame, { status: "inactive" }));
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.diagnostics).toMatchObject({
      renderModeView: "without_javascript",
      renderModeBusy: false,
    });
  });

  it("releases only popup UI when its durable start watchdog expires", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const runtime = makeRuntime(async (message) => {
      if (message.name === "renderInspection.start") {
        return await new Promise<BusFrame>(() => undefined);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(() => render.mock.calls.length > 0, "popup render");
    vi.useFakeTimers();
    try {
      render.mock.calls.at(-1)?.[0].props.onInspectRenderMode(false);
      for (
        let index = 0;
        index < 100 && !runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.start");
        index += 1
      ) {
        // The bus deadline adds one deliberate asynchronous terminality boundary
        // to each request. Flush both queued microtasks and due-now tasks without
        // consuming the inspection watchdog being tested below.
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.start")).toBe(true);
      await vi.advanceTimersByTimeAsync(20_000);
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }

      expect(render.mock.calls.at(-1)?.[0].props.diagnostics).toMatchObject({
        renderModeBusy: false,
        renderModeView: "unknown",
      });
      expect(render.mock.calls.at(-1)?.[0].props.diagnostics.renderModeDetail).toContain("background");
      expect(runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "renderInspection.cancel")).toBe(false);
      expect(runtime.sendMessage.mock.calls
        .filter(([frame]) => frame.name === "fact.reported")
        .some(([frame]) => JSON.stringify(frame.payload).includes("inspectionPending"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a dirty disable callback as already confirmed and never opens a native dialog", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, dirty: true, tree: "rewrite" }));
    let signalSeq = 0;
    let pulledDirty = false;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1", tabId: request.tabId, seq: signalSeq, name: request.signal?.name,
          source: "brain", cause: "test", at: signalSeq, payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "signals.pull" && !pulledDirty && (message.payload as { afterSeq?: number }).afterSeq !== 0) {
        const request = message.payload as { tabId: number };
        pulledDirty = true;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1", tabId: request.tabId, seq: signalSeq, name: "markings.changed",
          source: "content", cause: "content-click", at: signalSeq,
          payload: { pageUrl: "https://example.com", markedCount: 1 },
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();

    const commandsBefore = tabsSendMessage.mock.calls
      .map(([, m]) => (m as { payload?: { name?: string } }).payload?.name);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(false);
    await flushEntrypointWork();
    const commandsAfter = tabsSendMessage.mock.calls
      .map(([, m]) => (m as { payload?: { name?: string } }).payload?.name);

    expect((globalThis.window as unknown as { confirm: ReturnType<typeof vi.fn> }).confirm).not.toHaveBeenCalled();
    // App is the only caller and invokes this callback only from the explicit
    // manager-owned confirmation action. The entrypoint therefore crosses the
    // deactivation boundary exactly once and has no Escape/native-dialog path.
    expect(commandsAfter.filter((name) => name === "enterSilentContentMain")).toHaveLength(
      commandsBefore.filter((name) => name === "enterSilentContentMain").length + 1,
    );
  });

  it("binds production popup toggles to the active tab and returns content to silent mode on disable", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    let signalSeq = 0;
    let pulledDirty = false;
    let decidedFromFact: Record<string, unknown>[] = [];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const sensation = (message.payload as { sensation: { tabId: number; facts: { markingEnabled?: boolean } } }).sensation;
        if (typeof sensation.facts.markingEnabled === "boolean") {
          signalSeq += 1;
          decidedFromFact.push({
            kind: "uf-signal/1",
            tabId: sensation.tabId,
            seq: signalSeq,
            name: sensation.facts.markingEnabled ? "marking.enabled" : "marking.disabled",
            source: "brain",
            cause: "fact-fold",
            at: signalSeq,
            payload: { pageUrl: "https://example.com" },
          });
          if (sensation.facts.markingEnabled && !pulledDirty) {
            pulledDirty = true;
            signalSeq += 1;
            decidedFromFact.push({
              kind: "uf-signal/1",
              tabId: sensation.tabId,
              seq: signalSeq,
              name: "markings.changed",
              source: "brain",
              cause: "content-click",
              at: signalSeq,
              payload: { pageUrl: "https://example.com", markedCount: 1 },
            });
          }
        }
        return undefined;
      }
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: request.signal?.payload ?? {},
          }]);
      }
      if (message.name === "signals.pull" && decidedFromFact.length > 0) {
        const pending = decidedFromFact;
        decidedFromFact = [];
        return replyFrame(message, pending);
      }
      return replyFrame(message, []);
    }, "rendered", {
      // The production background can acknowledge the event transport before
      // the brain has published its signal. Discard must remain fenced until
      // the resulting session.discarded projection is actually consumable.
      deferFactAvailabilityReasons: ["session-discarded"],
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    expect(globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState().stateName).toBe("pre_ai_dirty");
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
    expect(globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState().buttons.compute).toEqual({
      disabled: false,
      blockedReason: "",
    });
    render.mock.calls.at(-1)?.[0].props.onDiscard();
    await waitFor(
      () => globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState().stateName === "pre_ai_clean" &&
        render.mock.calls.at(-1)?.[0].props.presentation.temporarilyDisabledOverlay === false,
      "delayed discard acknowledgement",
    );
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(true);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(false);
    await flushEntrypointWork();

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    // The popup reports facts and commands actions. It never composes the content
    // organ's surface; content consumes the brain signal stream independently.
    const sentCommandNames = tabsSendMessage.mock.calls.map(
      ([, message]) => (message as { payload?: { name?: string } }).payload?.name,
    );
    expect(sentCommandNames).toContain("getContentMainStatus");
    expect(sentCommandNames).not.toContain("directive.content");
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("activateContentMain", {
      baseUrl: "https://example.com",
      pageUrl: "https://example.com",
      realEditorActivation: true,
    }));
    expect(sentCommandNames.indexOf("activateContentMain"))
      .toBeLessThan(sentCommandNames.indexOf("resetContentMain"));
    const runtimeFrames = runtime.sendMessage.mock.calls.map(([frame]) => frame as {
      name?: string;
      payload?: { signal?: { name?: string }; sensation?: { reason?: string } };
    });
    expect(runtimeFrames.filter(
      (frame) => frame.name === "fact.reported" && frame.payload?.sensation?.reason === "marking-activated",
    )).toHaveLength(1);
    expect(runtimeFrames.filter((frame) => frame.name === "signals.emit").map((frame) => frame.payload?.signal?.name))
      .not.toEqual(expect.arrayContaining(["marking.enabled", "marking.disabled"]));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("resetContentMain", {
      baseUrl: "https://example.com",
      pageUrl: "https://example.com",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "session-discarded",
          facts: expect.objectContaining({ discardedSeq: expect.any(Number) }),
        }),
      }),
      target: "background",
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("enterSilentContentMain", {
      pageUrl: "https://example.com",
    }));
    // Disabling comes last: the reset happens while marking is still armed.
    expect(sentCommandNames.lastIndexOf("resetContentMain"))
      .toBeLessThan(tabsSendMessage.mock.calls
        .map(([, m]) => (m as { payload?: { name?: string } }).payload?.name)
        .lastIndexOf("enterSilentContentMain"));
  });

  it("does not acknowledge Discard when the exact mobile posture fails", async () => {
    const { props, runtime } = await startDirtyMarkingSession({
      emulationApply(frame, state) {
        const mode = (frame.payload as { mode: "mobile" | "desktop" }).mode;
        return replyFrame(frame, {
          mode,
          width: mode === "desktop" ? 1920 : 412,
          height: mode === "desktop" ? 1080 : 960,
          scale: 1,
          active: !(state.resetSeen && mode === "mobile"),
        });
      },
    });
    props().onDesktopPreviewChange(true);
    await waitFor(() => runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "emulation.apply" &&
      (frame.payload as { mode?: string }).mode === "desktop"), "opposite desktop posture");

    props().onDiscard();
    await waitFor(
      () => props().toast?.message.includes("Discard needs device recovery") === true,
      "discard posture failure",
    );

    expect(props().diagnostics).toMatchObject({ stateName: "pre_ai_dirty", contentDirty: false });
    expect(props().presentation.saveDisabled).toBe(true);
    expect(props().toast).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("required mobile session posture could not be restored"),
    });
    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "fact.reported" &&
      (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "session-discarded"
    )).toBe(false);
  });

  it("serializes Discard behind a concurrent opposite posture before acknowledging it", async () => {
    let desktopFrame: BusFrame | null = null;
    let releaseDesktop!: (frame: BusFrame) => void;
    const desktopPending = new Promise<BusFrame>((resolve) => {
      releaseDesktop = resolve;
    });
    const { props, runtime, state } = await startDirtyMarkingSession({
      async emulationApply(frame) {
        const mode = (frame.payload as { mode: "mobile" | "desktop" }).mode;
        if (mode === "desktop" && desktopFrame === null) {
          desktopFrame = frame;
          return await desktopPending;
        }
        return replyFrame(frame, {
          mode,
          width: mode === "desktop" ? 1920 : 412,
          height: mode === "desktop" ? 1080 : 960,
          scale: 1,
          active: true,
        });
      },
    });

    props().onDesktopPreviewChange(true);
    await waitFor(() => desktopFrame !== null, "pending opposite desktop posture");
    props().onDiscard();
    await waitFor(() => state.resetSeen, "discard reset before posture reconciliation");
    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "fact.reported" &&
      (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "session-discarded"
    )).toBe(false);

    releaseDesktop(replyFrame(desktopFrame as BusFrame, {
      mode: "desktop",
      width: 1920,
      height: 1080,
      scale: 1,
      active: true,
    }));
    await waitFor(
      () => props().diagnostics.stateName === "pre_ai_clean" &&
        props().presentation.temporarilyDisabledOverlay === false,
      "serialized mobile Discard completion",
    );

    const postureModes = runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "emulation.apply")
      .map(([frame]) => (frame.payload as { mode?: string }).mode);
    expect(postureModes.lastIndexOf("desktop")).toBeLessThan(postureModes.lastIndexOf("mobile"));
    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "fact.reported" &&
      (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "session-discarded"
    )).toBe(true);
    expect(props().toast).toMatchObject({
      tone: "success",
      message: expect.stringContaining("Markings discarded"),
    });
  });

  it("fetches static source HTML before running AI, previewing, and saving", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const rawSource = "<html><body><aside id=\"cookie-banner\">cookie secret</aside><main>server source</main></body></html>";
    vi.stubGlobal("DOMParser", class {
      parseFromString(html: string) {
        let serialized = html;
        const cookie = {
          remove() {
            serialized = serialized.replace(/<aside id="cookie-banner">[\s\S]*?<\/aside>/i, "");
          },
        };
        return {
          doctype: null,
          querySelectorAll(selector: string) {
            return selector.includes("id*='cookie'") ? [cookie] : [];
          },
          documentElement: {
            get outerHTML() {
              return serialized;
            },
          },
        };
      }
    });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let projectedRunSessionId = "";
    let projectedRunPhase: "idle" | "running" | "terminal" = "idle";
    let projectedPreviewOrgan: "preview_open" | "silent_preview" | null = null;
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "static",
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"],
      pages: [{
        url: "https://example.com/page",
        renderedHtml: "<html></html>",
        rawHtml: rawSource,
        renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      }],
    };
    let deferPostSaveSilentPresentation = false;
    let releasePostSaveSilentPresentation!: (value: unknown) => void;
    const postSaveSilentPresentation = new Promise<unknown>((resolve) => {
      releasePostSaveSilentPresentation = resolve;
    });
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "syncContentSignals") {
        return {
          ok: true,
          organName: projectedPreviewOrgan ?? (projectedRunPhase === "running" ? "running" : "post_ai_clean"),
          runSessionId: projectedRunPhase === "running" ? projectedRunSessionId : "",
          lastConsumedSeq: Number.MAX_SAFE_INTEGER,
          tree: "rewrite",
        };
      }
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "included" }] };
      }
      if (message.type === "preview.project") {
        return {
          projectionId: "projection-1",
          revision: 1,
          pageUrl: "https://example.com/page",
          rows: [{
            id: "row-main",
            classification: "explicit-included",
            text: "Main article",
            xpath: "/html[1]/body[1]/main[1]",
            selector: "main",
            shadow: "light",
          }],
        };
      }
      if (message.type === "preview.emphasize" || message.type === "preview.activate") {
        return { targeted: true };
      }
      if (message.type === "applySilentSelectors") {
        if (deferPostSaveSilentPresentation) {
          deferPostSaveSilentPresentation = false;
          return await postSaveSilentPresentation;
        }
        return { ok: true, applied: true, presentationAcknowledged: true, tree: "rewrite" };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const facts = (message.payload as { sensation?: { facts?: Record<string, unknown> } }).sensation?.facts;
        if (facts?.runPhase === "running" && typeof facts.runSessionId === "string") {
          projectedRunSessionId = facts.runSessionId;
          projectedRunPhase = "running";
        } else if (facts?.runPhase === "completed" || facts?.runPhase === "failed") {
          projectedRunPhase = "terminal";
        }
        if (facts?.previewActive === true) {
          projectedPreviewOrgan = facts.previewOrigin === "silent" ? "silent_preview" : "preview_open";
        }
      }
      if (
        message.name === "fact.reported" &&
        (message.payload as { sensation?: { reason?: string } }).sensation?.reason === "preview-exit-requested"
      ) {
        // Model content's single exit-routine completion. The popup click owns
        // only the request and must not claim that the page has restored.
        await runtime.sendMessage(contentPreviewExitedFrame(true));
      }
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "staticHtml.fetch") {
        return replyFrame(message, {
          ok: true,
          status: 200,
          url: "https://example.com/page",
          html: rawSource,
        });
      }
      if (message.name === "transferPayload.put") {
        const payload = message.payload as { scope: string; value: string };
        return replyFrame(message, {
          handle: {
            id: payload.value === "<html></html>" ? "rendered-1" : "raw-1",
            scope: payload.scope,
            sha256: (payload.value === "<html></html>" ? "a" : "b").repeat(64),
            byteLength: new TextEncoder().encode(payload.value).byteLength,
          },
        });
      }
      if (message.name === "offscreen.refineXpaths") {
        return replyFrame(message, {
          rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
        });
      }
      if (message.name === "transferPayload.release") {
        return replyFrame(message, { released: 2 });
      }
      if (message.name === "config.save") {
        return replyFrame(message, { status: "ok", config: backendConfig() });
      }
      return replyFrame(message, []);
    }, "static", {
      // Production can deliver the typed signal-availability edge after the
      // fact-report request returns. Auto-open must wait for that terminal
      // projection instead of sampling the still-running store once.
      deferFactAvailabilityReasons: ["ai-run-completed"],
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render, "static");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    const emulationApplyCountBeforeAi = runtime.sendMessage.mock.calls
      .filter(([message]) => message.name === "emulation.apply").length;
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.stateName === "preview_open" &&
        render.mock.calls.at(-1)?.[0].props.presentation.previewProjection?.rows.length === 1 &&
        render.mock.calls.at(-1)?.[0].props.presentation.curtainVisible === false,
      "post-AI Preview auto-open",
    );

    expect(runtime.sendMessage.mock.calls.filter(([message]) => message.name === "emulation.apply"))
      .toHaveLength(emulationApplyCountBeforeAi);

    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("captureSubmissionSnapshot", {
      baseUrl: "https://example.com",
      renderMode: "static",
      pageUrl: "https://example.com/page",
      rawHtml: rawSource,
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "staticHtml.fetch",
      payload: { url: "https://example.com/page" },
      target: "background",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "offscreen.refineXpaths",
      payload: expect.objectContaining({
        renderedHtmlRef: expect.objectContaining({ id: "rendered-1", sha256: "a".repeat(64) }),
        rawHtmlRef: expect.objectContaining({ id: "raw-1", sha256: "b".repeat(64) }),
        rows: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      }),
      target: "background",
    }));
    const refinementFrame = runtime.sendMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.name === "offscreen.refineXpaths");
    expect(refinementFrame?.payload).not.toHaveProperty("renderedHtml");
    expect(refinementFrame?.payload).not.toHaveProperty("rawHtml");
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "ai.run",
      payload: expect.objectContaining({
        tabId: 77,
        siteId: 1,
        pageKey: "/page",
        clientRunId: expect.any(String),
        snapshot: {
          ...snapshot,
          pages: [{
            ...snapshot.pages[0],
            rawHtml: rawSource,
          }],
        },
      }),
      target: "background",
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors).toEqual({
      inclusionSelectors: ["main"],
      exclusionSelectors: [".ad"],
    });
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("markContentMainClean", {}));
    const aiCommandNames = tabsSendMessage.mock.calls.map(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name);
    const syncIndexes = aiCommandNames.flatMap((name, index) => name === "syncContentSignals" ? [index] : []);
    expect(syncIndexes).toHaveLength(3);
    expect(syncIndexes[0]).toBeLessThan(aiCommandNames.indexOf("captureSubmissionSnapshot"));
    expect(syncIndexes[1]).toBeGreaterThan(aiCommandNames.indexOf("markContentMainClean"));
    expect(syncIndexes[2]).toBeGreaterThan(aiCommandNames.indexOf("preview.project"));

    expect(render.mock.calls.at(-1)?.[0].props.presentation).toMatchObject({
      previewVisible: true,
      temporarilyDisabledOverlay: true,
      curtainVisible: false,
      previewProjection: expect.objectContaining({ projectionId: "projection-1" }),
    });
    expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(true);

    render.mock.calls.at(-1)?.[0].props.onPreviewRowHover("row-main", true);
    render.mock.calls.at(-1)?.[0].props.onPreviewRowHover("row-main", false);
    render.mock.calls.at(-1)?.[0].props.onPreviewRowActivate("row-main");
    await flushEntrypointWork();
    expect(tabsSendMessage).toHaveBeenCalledWith(77, previewCommand("preview.project", {
      pageUrl: "https://example.com/page",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, previewCommand("preview.emphasize", {
      pageUrl: "https://example.com/page",
      projectionId: "projection-1",
      rowId: "row-main",
      active: true,
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, previewCommand("preview.emphasize", {
      pageUrl: "https://example.com/page",
      projectionId: "projection-1",
      rowId: "row-main",
      active: false,
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, previewCommand("preview.activate", {
      pageUrl: "https://example.com/page",
      projectionId: "projection-1",
      rowId: "row-main",
    }));

    const previewDraft = {
      selectors: render.mock.calls.at(-1)?.[0].props.presentation.selectors,
      markingRows: render.mock.calls.at(-1)?.[0].props.presentation.markingRows,
    };
    render.mock.calls.at(-1)?.[0].props.onExitPreview();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.stateName).toBe("post_ai_clean");
    expect(render.mock.calls.at(-1)?.[0].props.presentation).toMatchObject(previewDraft);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      source: "popup",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "preview-exit-requested",
          facts: expect.objectContaining({ previewExitRequestSeq: expect.any(Number) }),
        }),
      }),
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      source: "content",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "preview-exited",
          facts: expect.objectContaining({ previewActive: false, previewExitRequested: false }),
        }),
      }),
    }));

    deferPostSaveSilentPresentation = true;
    render.mock.calls.at(-1)?.[0].props.onSave();
    await waitFor(() => !deferPostSaveSilentPresentation, "post-Save silent presentation request");
    expect(render.mock.calls.at(-1)?.[0].props.presentation).toMatchObject({
      curtainVisible: true,
      temporarilyDisabledOverlay: true,
    });
    releasePostSaveSilentPresentation({
      ok: true,
      applied: true,
      presentationAcknowledged: true,
      tree: "rewrite",
    });
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.stateName === "silent" &&
        render.mock.calls.at(-1)?.[0].props.presentation.curtainVisible === false,
      "paint-acknowledged post-Save silent completion",
    );
    expect(runtime.sendMessage.mock.calls
      .map(([frame]) => frame)
      .filter((frame) => frame.name === "lock.directive")
      .every((frame) => !("hasUnsavedChanges" in frame.payload))).toBe(true);
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("enterSilentContentMain", {
      pageUrl: "https://example.com/page",
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("applySilentSelectors", {
      pageUrl: "https://example.com/page",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "config.save",
      target: "background",
      payload: expect.objectContaining({
        environmentKey: "example.com",
        siteId: 1,
        page: expect.objectContaining({ pageKey: "/page", pageType: "detail" }),
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      }),
    }));
  });

  it("retires an overlapping authority failure until successful AI opens Content List", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{
        url: "https://example.com/page",
        renderedHtml: "<html><body><main>AI page</main></body></html>",
        renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      }],
    };
    let projectedRunSessionId = "";
    let projectedRunPhase: "idle" | "running" | "terminal" = "idle";
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "syncContentSignals") {
        return {
          ok: true,
          organName: projectedRunPhase === "running" ? "running" : "post_ai_clean",
          runSessionId: projectedRunPhase === "running" ? projectedRunSessionId : "",
          lastConsumedSeq: Number.MAX_SAFE_INTEGER,
          tree: "rewrite",
        };
      }
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      if (message.type === "preview.project") {
        return {
          projectionId: "authority-race-preview",
          revision: 1,
          pageUrl: "https://example.com/page",
          rows: [{
            id: "authority-race-main",
            classification: "explicit-included",
            text: "AI page",
            xpath: "/html[1]/body[1]/main[1]",
            selector: "main",
            shadow: "light",
          }],
        };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    const contextResponse = (status: "managed_candidate" | "unavailable") => ({
      status,
      generation: 1,
      observedUrl: "https://example.com/page",
      draftDisposition: "preserve" as const,
      environmentKey: "example.com",
      siteId: 1,
      baseUrl: "https://example.com",
      pageKey: "/page",
      pageTypes: [],
      membershipFingerprint: "membership",
      assignmentFingerprint: "assignment",
      conflicts: [],
      upstreamCode: status === "unavailable" ? 503 : null,
      renderModeSet: true,
      todo: { covered: 0, actionable: 0, pageTypes: [] },
    });
    let contextCalls = 0;
    let holdNextContext = false;
    let releaseStaleContext: (() => void) | null = null;
    let staleContextWindow = false;
    let staleLockAdoptions = 0;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const facts = (message.payload as { sensation?: { facts?: Record<string, unknown> } }).sensation?.facts;
        if (facts?.runPhase === "running" && typeof facts.runSessionId === "string") {
          projectedRunSessionId = facts.runSessionId;
          projectedRunPhase = "running";
        } else if (facts?.runPhase === "completed" || facts?.runPhase === "failed") {
          projectedRunPhase = "terminal";
        }
      }
      if (message.name === "page.context") {
        contextCalls += 1;
        if (holdNextContext) {
          holdNextContext = false;
          return await new Promise<BusFrame>((resolve) => {
            releaseStaleContext = () => {
              staleContextWindow = true;
              resolve(replyFrame(message, contextResponse("unavailable")));
            };
          });
        }
        // A generation-safe trailing pass reaches fresh authority before its
        // lock read. The retired pass would instead read the stale failure now.
        staleContextWindow = false;
        return replyFrame(message, contextResponse("managed_candidate"));
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "authority-race-ai",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "transferPayload.put") {
        const value = String((message.payload as { value?: unknown }).value ?? "");
        return replyFrame(message, {
          handle: {
            id: "authority-race-rendered",
            scope: "ai-refinement-rendered",
            sha256: "a".repeat(64),
            byteLength: new TextEncoder().encode(value).byteLength,
          },
        });
      }
      if (message.name === "transferPayload.release") {
        return replyFrame(message, { released: 1 });
      }
      return replyFrame(message, []);
    }, "rendered", {
      delegatePageContextToHandler: true,
      lockDirective(message) {
        if (staleContextWindow) {
          staleLockAdoptions += 1;
          return replyFrame(message, {
            status: "unavailable",
            baseUrl: "https://example.com",
            siteId: 1,
            lockRole: "unknown",
            configPresent: true,
            canEdit: false,
            blockedReason: "unavailable",
            lockBanner: { visible: true, reason: "unavailable" },
          });
        }
        return replyFrame(message, {
          status: "ok",
          baseUrl: "https://example.com",
          siteId: 1,
          lockRole: "editor",
          configPresent: true,
          canEdit: true,
          blockedReason: "editor",
          authority: {
            environmentKey: "example.com",
            editorSessionId: "editor-1",
            lockToken: "lock-1",
            propertyRevision: 4,
            feedRevision: 2,
          },
          lockBanner: { visible: false, reason: "editor" },
        });
      },
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await confirmRenderMode(render);
    props().onEnableChange(true);
    await waitFor(() => props().diagnostics.contentActive === true, "marking activation");

    holdNextContext = true;
    props().onRefresh();
    await waitFor(() => releaseStaleContext !== null, "overlapping authority request");
    props().onRunAi();
    await waitFor(
      () => props().diagnostics.stateName === "preview_open" &&
        props().presentation.previewProjection?.projectionId === "authority-race-preview",
      "successful AI Content List projection",
    );

    releaseStaleContext?.();
    await waitFor(() => contextCalls >= 3, "fresh trailing authority request");
    await flushEntrypointWork();

    expect(staleLockAdoptions).toBe(0);
    expect(props().diagnostics.stateName).toBe("preview_open");
    expect(props().presentation.selectors).toEqual({
      inclusionSelectors: ["main"],
      exclusionSelectors: [".ad"],
    });
    expect(props().presentation.previewProjection).toMatchObject({
      projectionId: "authority-race-preview",
      rows: [expect.objectContaining({ id: "authority-race-main" })],
    });
  });

  it("keeps the fast navigation fence live while slow authority is paused for AI", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    let activeUrl = "https://example.com/a";
    const query = vi.fn().mockResolvedValue([{ id: 77, url: activeUrl }]);
    const get = vi.fn(async () => ({ id: 77, url: activeUrl }));
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{
        url: "https://example.com/a",
        renderedHtml: "<html><body><main>Page A</main></body></html>",
        renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      }],
    };
    let projectedRunSessionId = "";
    let projectedRunPhase: "idle" | "running" | "terminal" = "idle";
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "syncContentSignals") {
        return {
          ok: true,
          organName: projectedRunPhase === "running" ? "running" : "post_ai_clean",
          runSessionId: projectedRunPhase === "running" ? projectedRunSessionId : "",
          lastConsumedSeq: Number.MAX_SAFE_INTEGER,
          tree: "rewrite",
        };
      }
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let releaseAi: (() => void) | null = null;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const facts = (message.payload as { sensation?: { facts?: Record<string, unknown> } }).sensation?.facts;
        if (facts?.runPhase === "running" && typeof facts.runSessionId === "string") {
          projectedRunSessionId = facts.runSessionId;
          projectedRunPhase = "running";
        } else if (facts?.runPhase === "completed" || facts?.runPhase === "failed") {
          projectedRunPhase = "terminal";
        }
      }
      if (message.name === "ai.run") {
        return await new Promise<BusFrame>((resolve) => {
          releaseAi = () => resolve(replyFrame(message, {
            status: "ok",
            sessionId: "stale-page-a-ai",
            selectors: { inclusionSelectors: ["main.page-a"], exclusionSelectors: [".ad"] },
          }));
        });
      }
      if (message.name === "transferPayload.put") {
        const value = String((message.payload as { value?: unknown }).value ?? "");
        return replyFrame(message, {
          handle: {
            id: "navigation-fence-rendered",
            scope: "ai-refinement-rendered",
            sha256: "b".repeat(64),
            byteLength: new TextEncoder().encode(value).byteLength,
          },
        });
      }
      if (message.name === "transferPayload.release") {
        return replyFrame(message, { released: 1 });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, get, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await confirmRenderMode(render);
    props().onEnableChange(true);
    await waitFor(() => props().diagnostics.contentActive === true, "marking activation");
    props().onRunAi();
    await waitFor(() => releaseAi !== null, "in-flight AI request");

    activeUrl = "https://example.com/b";
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await waitFor(
      () => tabsSendMessage.mock.calls.some(([, frame]) =>
        ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "deactivateContentMain"),
      "navigation deactivation fence",
    );
    releaseAi?.();
    await waitFor(
      () => props().presentation.temporarilyDisabledOverlay === false,
      "stale AI action release",
    );

    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "fact.reported" &&
      (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "ai-run-completed"
    )).toBe(false);
    expect(tabsSendMessage.mock.calls.some(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "markContentMainClean"
    )).toBe(false);
    expect(tabsSendMessage.mock.calls.some(([, frame]) =>
      (frame as BusFrame).name === "preview.project"
    )).toBe(false);
    expect(props().presentation.selectors.inclusionSelectors).not.toContain("main.page-a");
  });

  it.each(["rejected", "no_receiver"] as const)(
    "keeps AI freshness fenced when the content clean acknowledgement is %s",
    async (cleanOutcome) => {
      installEntrypointDom("chrome-extension://extension-id/popup.html");
      const render = createReactRenderProbe();
      vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
      const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
      const snapshot = {
        baseUrl: "https://example.com",
        renderMode: "rendered" as const,
        defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
        pages: [{
          url: "https://example.com/page",
          renderedHtml: "<html><body><main>AI page</main></body></html>",
          renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
        }],
      };
      const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
        if (message.type === "captureSubmissionSnapshot") {
          return { ok: true, snapshot, rows: [] };
        }
        if (message.type === "markContentMainClean") {
          if (cleanOutcome === "no_receiver") {
            throw new Error("Could not establish connection. Receiving end does not exist.");
          }
          return { ok: false, initialized: true, tree: "rewrite", reason: "generation-rejected" };
        }
        return { ok: true, initialized: true, tree: "rewrite" };
      });
      const runtime = makeRuntime(async (message) => {
        if (message.name === "ai.run") {
          return replyFrame(message, {
            status: "ok",
            sessionId: `clean-${cleanOutcome}`,
            selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
          });
        }
        if (message.name === "transferPayload.put") {
          const value = String((message.payload as { value?: unknown }).value ?? "");
          return replyFrame(message, {
            handle: {
              id: `clean-${cleanOutcome}-rendered`,
              scope: "ai-refinement-rendered",
              sha256: "a".repeat(64),
              byteLength: new TextEncoder().encode(value).byteLength,
            },
          });
        }
        if (message.name === "transferPayload.release") {
          return replyFrame(message, { released: 1 });
        }
        return replyFrame(message, []);
      }, "rendered");
      globalThis.chrome = {
        runtime: { ...runtime },
        tabs: { query, sendMessage: tabsSendMessage },
      } as unknown as typeof chrome;

      await import("../../../src/entrypoints/popup/main.tsx");
      const props = () => render.mock.calls.at(-1)?.[0].props;
      await confirmRenderMode(render);
      props().onEnableChange(true);
      await waitFor(() => props().diagnostics.contentActive === true, "marking activation");
      props().onRunAi();
      await waitFor(
        () => props().toast?.message.includes("Run AI failed") === true &&
          props().presentation.temporarilyDisabledOverlay === false,
        `${cleanOutcome} AI clean failure`,
      );

      expect(props().diagnostics.contentDirty).toBe(true);
      expect(props().presentation).toMatchObject({
        saveDisabled: true,
        showPreviewDisabled: true,
        selectors: { inclusionSelectors: [], exclusionSelectors: [] },
      });
      expect(props().toast).toMatchObject({
        tone: "danger",
        message: expect.stringContaining(cleanOutcome === "no_receiver"
          ? "could not receive the completed AI result"
          : "did not accept the completed AI result as current"),
      });
      expect(runtime.sendMessage.mock.calls.some(([frame]) =>
        frame.name === "fact.reported" &&
        (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "ai-run-completed"
      )).toBe(false);
      expect(runtime.sendMessage.mock.calls.some(([frame]) =>
        frame.name === "fact.reported" &&
        (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "ai-run-content-clean-failed"
      )).toBe(true);
      expect(tabsSendMessage.mock.calls.some(([, frame]) =>
        (frame as BusFrame).name === "preview.project"
      )).toBe(false);
    },
  );

  it("commits one first configuration then adopts only the distinct Load authority", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{
        url: "https://example.com/page",
        renderedHtml: "<html><body><main>first configuration</main></body></html>",
        renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      }],
    };
    let mutationAuthorityCurrent = false;
    let releaseSave!: () => void;
    const saveRelease = new Promise<void>((resolve) => { releaseSave = resolve; });
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "included" }] };
      }
      if (message.type === "pauseContentMainInteractions") {
        // Simulate a recovery rotating the lease while the popup is preparing
        // Save. The singular mutation must use the late authoritative fence.
        mutationAuthorityCurrent = true;
      }
      if (message.type === "getContentMainStatus") {
        return {
          ok: true,
          pageUrl: "https://example.com/page",
          authority: { environmentKey: "example.com", siteId: 1, lockBlocked: false },
        };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    const saveRequests: BusFrame[] = [];
    let saveCommitted = false;
    const loadedAfterSave: ConfigSnapshot = {
      ...backendConfig(),
      propertyRevision: 6,
      feedRevision: 4,
      selectors: { inclusionSelectors: ["article"], exclusionSelectors: [".latest-ad"] },
      selectorsUpdatedAt: "2026-08-31T16:00:00Z",
    };
    const runtime = makeRuntime(async (message) => {
      if (message.name === "page.context") {
        return replyFrame(message, {
          status: "managed_candidate",
          generation: 1,
          observedUrl: "https://example.com/page",
          draftDisposition: "preserve",
          environmentKey: "example.com",
          siteId: 1,
          baseUrl: "https://example.com",
          pageKey: "/page",
          pageTypes: [{
            pageType: "detail",
            pages: [{ pageKey: "/page", wordsCount: 100 }],
          }],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
          renderModeSet: true,
          todo: {
            covered: 0,
            actionable: 1,
            pageTypes: [{
              pageType: "detail",
              markedCount: 0,
              current: true,
              candidates: [{ pageKey: "/page", wordsCount: 100, marked: false, current: true }],
            }],
          },
        });
      }
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1", tabId: request.tabId, seq: signalSeq, name: request.signal?.name,
          source: "brain", cause: "test", at: signalSeq, payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "first-config-ai",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "transferPayload.put") {
        const value = String((message.payload as { value?: unknown }).value ?? "");
        return replyFrame(message, {
          handle: {
            id: "first-config-rendered",
            scope: "ai-refinement-rendered",
            sha256: "a".repeat(64),
            byteLength: new TextEncoder().encode(value).byteLength,
          },
        });
      }
      if (message.name === "transferPayload.release") {
        return replyFrame(message, { released: 1 });
      }
      if (message.name === "config.save") {
        saveRequests.push(message);
        await saveRelease;
        saveCommitted = true;
        return replyFrame(message, { status: "ok", config: backendConfig() });
      }
      return replyFrame(message, []);
    }, "rendered", {
      delegatePageContextToHandler: true,
      deferReconciliationFactAvailability: true,
      configLoad: (frame) => saveCommitted
        ? replyFrame(frame, {
            status: "ok",
            config: loadedAfterSave,
            renderMode: "rendered",
            renderModeSource: "backend",
          })
        : replyFrame(frame, {
            status: "not_found",
            renderMode: "rendered",
            renderModeSource: "local",
          }),
      emulationApply: (frame) => replyFrame(frame, {
        mode: (frame.payload as { mode: "mobile" | "desktop" }).mode,
        width: (frame.payload as { mode: string }).mode === "desktop" ? 1920 : 412,
        height: (frame.payload as { mode: string }).mode === "desktop" ? 1080 : 960,
        scale: 1,
        active: true,
        identityStale: mutationAuthorityCurrent &&
          (frame.payload as { mode: string }).mode === "desktop",
      }),
      lockDirective: (frame) => replyFrame(frame, {
        status: "ok",
        baseUrl: "https://example.com",
        siteId: 1,
        lockRole: "editor",
        configPresent: true,
        canEdit: true,
        blockedReason: "editor",
        authority: {
          environmentKey: "example.com",
          editorSessionId: "editor-1",
          lockToken: mutationAuthorityCurrent ? "lock-current" : "lock-before-save",
          propertyRevision: mutationAuthorityCurrent ? 5 : 4,
          feedRevision: mutationAuthorityCurrent ? 3 : 2,
        },
        lockBanner: { visible: false, reason: "editor" },
      }),
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await waitFor(() => props().diagnostics.configStatus === "not_found", "first-config baseline");
    expect(props().diagnostics).toMatchObject({
      renderMode: "rendered",
      renderModeSource: "local",
    });
    expect(tabsSendMessage.mock.calls.filter(([, frame]) =>
      (frame as BusFrame).name === "command.dispatch"
      && ((frame as BusFrame).payload as { name?: string }).name === "clearSilentSelectors"
    )).toHaveLength(1);

    props().onDesktopPreviewChange(true);
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) =>
        frame.name === "emulation.apply" && (frame.payload as { mode?: string }).mode === "desktop"),
      "initial desktop preview posture",
    );

    poll();
    poll();
    poll();
    await flushEntrypointWork();
    expect(runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "config.load")).toHaveLength(1);

    props().onEnableChange(true);
    await waitFor(() => props().diagnostics.contentActive === true, "first-config marking activation");
    props().onRunAi();
    await waitFor(() => props().presentation.saveDisabled === false, "fresh first-config AI result");
    const contextCallsBeforeSave = runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "page.context").length;
    props().onSave();
    props().onSave();
    await waitFor(() => saveRequests.length === 1, "single first-config save request");
    poll();
    poll();
    await flushEntrypointWork();
    expect(runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "page.context")).toHaveLength(contextCallsBeforeSave);
    releaseSave();
    await waitFor(() => props().diagnostics.configStatus === "ok", "authoritative first-config adoption");
    await waitFor(
      () => runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "page.context").length > contextCallsBeforeSave,
      "one post-save authority refresh",
    );
    await flushEntrypointWork();

    expect(saveRequests).toHaveLength(1);
    expect(saveRequests[0]).toMatchObject({
      name: "config.save",
      payload: {
        environmentKey: "example.com",
        siteId: 1,
        editorSessionId: "editor-1",
        lockToken: "lock-current",
        expectedPropertyRevision: 5,
        expectedFeedRevision: 3,
        page: expect.objectContaining({ pageKey: "/page", pageType: "detail" }),
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      },
    });
    const mutationFenceRequests = runtime.sendMessage.mock.calls
      .map(([frame]) => frame)
      .filter((frame) => frame.name === "lock.directive" &&
        (frame.payload as { refreshFence?: boolean }).refreshFence === true);
    expect(mutationFenceRequests).toHaveLength(1);
    expect(runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "page.context")).toHaveLength(contextCallsBeforeSave + 1);
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("getContentMainStatus", {}));
    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "emulation.apply" &&
      (frame.payload as { mode?: string }).mode === "desktop" &&
      (frame.payload as { allowReload?: boolean }).allowReload === true)).toBe(true);
    expect(runtime.sendMessage.mock.calls.filter(([frame]) => frame.name === "config.load")).toHaveLength(2);
    expect(props().diagnostics).toMatchObject({
      configStatus: "ok",
      renderMode: "rendered",
      renderModeSource: "backend",
    });
    expect(props().presentation.selectors).toEqual(loadedAfterSave.selectors);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flushEntrypointWork();
  });

  it("keeps the old marking engine fenced when silent entry fails after Hub commits Save", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{
        url: "https://example.com/page",
        renderedHtml: "<html><body><main>committed page</main></body></html>",
        renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      }],
    };
    let markingActive = false;
    let saveCommitted = false;
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "activateContentMain") {
        markingActive = true;
      }
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      if (message.type === "getContentMainStatus") {
        return {
          ok: true,
          active: markingActive,
          dirty: false,
          pageUrl: "https://example.com/page",
          contentRows: [],
        };
      }
      if (message.type === "enterSilentContentMain" && saveCommitted) {
        return { ok: false, initialized: true, tree: "rewrite", reason: "consent-registration-failed" };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    const saveRequests: BusFrame[] = [];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "page.context") {
        return replyFrame(message, {
          status: "managed_candidate",
          generation: 1,
          observedUrl: "https://example.com/page",
          draftDisposition: "preserve",
          environmentKey: "example.com",
          siteId: 1,
          baseUrl: "https://example.com",
          pageKey: "/page",
          pageTypes: [{
            pageType: "detail",
            pages: [{ pageKey: "/page", wordsCount: 100 }],
          }],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
          renderModeSet: true,
          todo: {
            covered: 0,
            actionable: 1,
            pageTypes: [{
              pageType: "detail",
              markedCount: 0,
              current: true,
              candidates: [{ pageKey: "/page", wordsCount: 100, marked: false, current: true }],
            }],
          },
        });
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "committed-save-ai",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "transferPayload.put") {
        const value = String((message.payload as { value?: unknown }).value ?? "");
        return replyFrame(message, {
          handle: {
            id: "committed-save-rendered",
            scope: "ai-refinement-rendered",
            sha256: "a".repeat(64),
            byteLength: new TextEncoder().encode(value).byteLength,
          },
        });
      }
      if (message.name === "transferPayload.release") {
        return replyFrame(message, { released: 1 });
      }
      if (message.name === "config.save") {
        saveRequests.push(message);
        saveCommitted = true;
        return replyFrame(message, { status: "ok", config: backendConfig() });
      }
      return replyFrame(message, []);
    }, "rendered", {
      delegatePageContextToHandler: true,
      deferReconciliationFactAvailability: true,
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await confirmRenderMode(render);
    props().onEnableChange(true);
    await waitFor(() => props().diagnostics.contentActive === true, "marking activation");
    props().onRunAi();
    await waitFor(() => props().presentation.saveDisabled === false, "fresh AI result");
    const resumesBeforeSave = tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "resumeContentMainInteractions"
    ).length;

    props().onSave();
    await waitFor(
      () => props().presentation.blockedReason === "page-recovery-required",
      "post-commit page recovery fence",
    );

    const commandNames = tabsSendMessage.mock.calls.map(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name);
    expect(saveRequests).toHaveLength(1);
    expect(commandNames).toContain("pauseContentMainInteractions");
    expect(commandNames).toContain("enterSilentContentMain");
    expect(commandNames.filter((name) => name === "resumeContentMainInteractions")).toHaveLength(resumesBeforeSave);
    expect(props().diagnostics.contentActive).toBe(true);
    expect(props().presentation).toMatchObject({
      curtainVisible: true,
      curtainText: "Reload the page to finish Save",
      saveDisabled: true,
      discardDisabled: true,
      showPreviewDisabled: true,
    });
    expect(props().toast).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("Save committed; page recovery required"),
    });
    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "fact.reported" &&
      (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "session-saved"
    )).toBe(false);

    props().onSave();
    await flushEntrypointWork();
    expect(saveRequests).toHaveLength(1);
  });

  it.each(["timed_out", "identity_changed"] as const)(
    "requires reload when the exact silent posture is %s after Hub commits Save",
    async (transitionStatus) => {
      vi.doMock("../../../src/popup/emulation-reload-transition", async () => {
        const actual = await vi.importActual<typeof import("../../../src/popup/emulation-reload-transition")>(
          "../../../src/popup/emulation-reload-transition",
        );
        return {
          ...actual,
          waitForReloadTransition: vi.fn(async (options: {
            original: { tabId: number; url: string };
          }) => ({
            status: transitionStatus,
            context: transitionStatus === "identity_changed"
              ? { ...options.original, url: "https://replacement.example/page" }
              : options.original,
          })),
        };
      });
      installEntrypointDom("chrome-extension://extension-id/popup.html");
      const render = createReactRenderProbe();
      vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
      const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
      const snapshot = {
        baseUrl: "https://example.com",
        renderMode: "rendered" as const,
        defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
        pages: [{
          url: "https://example.com/page",
          renderedHtml: "<html><body><main>committed page</main></body></html>",
          renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
        }],
      };
      let markingActive = false;
      let saveCommitted = false;
      const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
        if (message.type === "activateContentMain") {
          markingActive = true;
        }
        if (message.type === "captureSubmissionSnapshot") {
          return { ok: true, snapshot, rows: [] };
        }
        if (message.type === "getContentMainStatus") {
          return {
            ok: true,
            active: markingActive,
            dirty: false,
            pageUrl: "https://example.com/page",
            authority: { environmentKey: "example.com", siteId: 1, lockBlocked: false },
            contentRows: [],
          };
        }
        if (message.type === "enterSilentContentMain") {
          markingActive = false;
        }
        return { ok: true, initialized: true, tree: "rewrite" };
      });
      const saveRequests: BusFrame[] = [];
      const runtime = makeRuntime(async (message) => {
        if (message.name === "ai.run") {
          return replyFrame(message, {
            status: "ok",
            sessionId: `posture-${transitionStatus}`,
            selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
          });
        }
        if (message.name === "transferPayload.put") {
          const value = String((message.payload as { value?: unknown }).value ?? "");
          return replyFrame(message, {
            handle: {
              id: `posture-${transitionStatus}-rendered`,
              scope: "ai-refinement-rendered",
              sha256: "a".repeat(64),
              byteLength: new TextEncoder().encode(value).byteLength,
            },
          });
        }
        if (message.name === "transferPayload.release") {
          return replyFrame(message, { released: 1 });
        }
        if (message.name === "config.save") {
          saveRequests.push(message);
          saveCommitted = true;
          return replyFrame(message, { status: "ok", config: backendConfig() });
        }
        return replyFrame(message, []);
      }, "rendered", {
        deferReconciliationFactAvailability: true,
        emulationApply: (frame) => {
          const payload = frame.payload as { mode: "mobile" | "desktop"; allowReload?: boolean };
          const mode = payload.mode;
          const reloadRequired = saveCommitted && mode === "desktop" && payload.allowReload !== false;
          return replyFrame(frame, {
            mode,
            width: mode === "desktop" ? 1920 : 412,
            height: mode === "desktop" ? 1080 : 960,
            scale: 1,
            active: !reloadRequired,
            identityStale: reloadRequired,
            reloadRequired,
            ...(reloadRequired ? { failureReason: "identity_mismatch" } : {}),
          });
        },
      });
      globalThis.chrome = {
        runtime: { ...runtime },
        tabs: { query, sendMessage: tabsSendMessage },
      } as unknown as typeof chrome;

      await import("../../../src/entrypoints/popup/main.tsx");
      const props = () => render.mock.calls.at(-1)?.[0].props;
      await confirmRenderMode(render);
      props().onDesktopPreviewChange(true);
      await waitFor(() => runtime.sendMessage.mock.calls.some(([frame]) =>
        frame.name === "emulation.apply" &&
        (frame.payload as { mode?: string }).mode === "desktop"), "desktop preview posture");
      props().onEnableChange(true);
      await waitFor(() => props().diagnostics.contentActive === true, "marking activation");
      props().onRunAi();
      await waitFor(() => props().presentation.saveDisabled === false, "fresh AI result");

      props().onSave();
      await waitFor(
        () => props().presentation.blockedReason === "page-recovery-required",
        `${transitionStatus} post-commit recovery fence`,
      );
      expect(saveRequests).toHaveLength(1);
      expect(props().presentation).toMatchObject({
        curtainVisible: true,
        curtainText: "Reload the page to finish Save",
        saveDisabled: true,
        discardDisabled: true,
        showPreviewDisabled: true,
      });
      expect(props().toast).toMatchObject({
        tone: "danger",
        message: expect.stringContaining("Save committed; page recovery required"),
      });
      expect(runtime.sendMessage.mock.calls.some(([frame]) =>
        frame.name === "fact.reported" &&
        (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "session-saved"
      )).toBe(false);

      const statusChecksBeforeRefresh = tabsSendMessage.mock.calls.filter(([, frame]) =>
        ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "getContentMainStatus"
      ).length;
      props().onRefresh();
      await waitFor(() => tabsSendMessage.mock.calls.filter(([, frame]) =>
        ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "getContentMainStatus"
      ).length > statusChecksBeforeRefresh, "posture recovery status check");
      expect(props().presentation.blockedReason).toBe("page-recovery-required");
      expect(runtime.sendMessage.mock.calls.some(([frame]) =>
        frame.name === "fact.reported" &&
        (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "session-saved"
      )).toBe(false);

      props().onSave();
      await flushEntrypointWork();
      expect(saveRequests).toHaveLength(1);
    },
  );

  it("surfaces a background-completed AI run when the side panel opens again", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "getContentMainStatus") {
        return {
          ok: true,
          active: true,
          dirty: true,
          markedCount: 0,
          pageUrl: "https://example.com/page",
          contentRows: [],
        };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let deliveredStarted = false;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.pull" && !deliveredStarted) {
        deliveredStarted = true;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: 1,
          name: "run.started",
          source: "brain",
          cause: "popup-closed-mid-run",
          at: 1,
          payload: {
            pageUrl: "https://example.com/page",
            sessionId: "popup-run-1",
            deadlineAt: 480_000,
          },
        }]);
      }
      if (message.name === "signals.emit") {
        const signal = (message.payload as { signal: { name: string; payload: unknown } }).signal;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: 2,
          name: signal.name,
          source: "brain",
          cause: "resumed-run",
          at: 2,
          payload: signal.payload,
        }]);
      }
      if (message.name === "ai.resume") {
        return replyFrame(message, {
          status: "fresh",
          sessionId: "backend-run-1",
          clientRunId: "popup-run-1",
          selectors: { inclusionSelectors: ["article"], exclusionSelectors: [".sponsor"] },
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(
      () => globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__?.getViewState().stateName === "running",
      "the reopened panel to recover the running brain state",
    );
    render.mock.calls.at(-1)?.[0].props.onRefresh();
    await waitFor(
      () => globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__?.getViewState().stateName === "post_ai_clean",
      "the reopened panel to surface the durable AI result",
    );

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "ai.resume",
      target: "background",
      payload: {
        tabId: 77,
        siteId: 1,
        pageKey: "/page",
        clientRunId: "popup-run-1",
        editorSessionId: "editor-1",
      },
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors).toEqual({
      inclusionSelectors: ["article"],
      exclusionSelectors: [".sponsor"],
    });
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("markContentMainClean", {}));
    const contentCommands = tabsSendMessage.mock.calls.map(
      ([, frame]) => (frame as { payload?: { name?: string } }).payload?.name,
    );
    expect(contentCommands).not.toContain("applySilentSelectors");
  });

  it("does not reuse a captured AI snapshot after rebinding to another page", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a" }]);
    const snapshotA = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/a", renderedHtml: "<html>a</html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const snapshotB = {
      ...snapshotA,
      pages: [{ url: "https://example.com/b", renderedHtml: "<html>b</html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[2]", excluded: false }] }],
    };
    let activeUrl = "https://example.com/a";
    const get = vi.fn(async () => ({ id: 77, url: activeUrl }));
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot: activeUrl.endsWith("/b") ? snapshotB : snapshotA, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let rehydratedB = false;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "config.save") {
        return replyFrame(message, { status: "ok", config: backendConfig() });
      }
      if (message.name === "signals.pull" && activeUrl === "https://example.com/b" && !rehydratedB) {
        rehydratedB = true;
        signalSeq += 3;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq - 2,
          name: "marking.enabled",
          source: "brain",
          cause: "rehydrate",
          at: signalSeq - 2,
          payload: { pageUrl: "https://example.com/b" },
        }, {
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq - 1,
          name: "run.started",
          source: "brain",
          cause: "rehydrate",
          at: signalSeq - 1,
          payload: { pageUrl: "https://example.com/b", sessionId: "ai-b-local" },
        }, {
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "run.completed",
          source: "brain",
          cause: "rehydrate",
          at: signalSeq,
          payload: {
            pageUrl: "https://example.com/b",
            sessionId: "ai-b-local",
            aiSessionId: "ai-b",
            selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
          },
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        get,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    activeUrl = "https://example.com/b";
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "config.save",
      payload: expect.objectContaining({
        page: expect.objectContaining({
          pageKey: "/b",
          renderedHtml: "<html>b</html>",
        }),
      }),
    }));
  });

  it("drains pending dirty signals and aborts stale Save", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let dirtyReady = false;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    dirtyReady = true;
    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();

    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ name: "config.save" }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.toast).toMatchObject({
      tone: "warning",
      message: expect.stringContaining("Save blocked:"),
    });
  });

  it("fences a successful Save when an in-flight dirty signal arrives after Hub commits", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let dirtyOnSaveTail = false;
    const saveRequests: BusFrame[] = [];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, { status: "ok", sessionId: "ai-1", selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] } });
      }
      if (message.name === "config.save") {
        saveRequests.push(message);
        dirtyOnSaveTail = true;
        return replyFrame(message, { status: "ok", config: backendConfig() });
      }
      if (message.name === "signals.pull" && dirtyOnSaveTail) {
        dirtyOnSaveTail = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    const props = () => render.mock.calls.at(-1)?.[0].props;
    const resumesBeforeSave = tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "resumeContentMainInteractions"
    ).length;
    props().onSave();
    await waitFor(
      () => props().presentation.blockedReason === "page-recovery-required",
      "post-commit dirty recovery fence",
    );

    expect(saveRequests).toHaveLength(1);
    expect(props().presentation).toMatchObject({
      curtainVisible: true,
      curtainText: "Reload the page to finish Save",
      saveDisabled: true,
      discardDisabled: true,
      showPreviewDisabled: true,
    });
    expect(props().toast).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("Save committed; page review required"),
    });
    expect(tabsSendMessage).not.toHaveBeenCalledWith(77, contentCommand("enterSilentContentMain", {
      pageUrl: "https://example.com/page",
    }));
    expect(tabsSendMessage.mock.calls.filter(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name === "resumeContentMainInteractions"
    )).toHaveLength(resumesBeforeSave);
    expect(runtime.sendMessage.mock.calls.some(([frame]) =>
      frame.name === "fact.reported" &&
      (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "session-saved"
    )).toBe(false);

    props().onSave();
    await flushEntrypointWork();
    expect(saveRequests).toHaveLength(1);
  });

  it("does not enable Save when markings change during AI snapshot capture", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    let dirtyReady = false;
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        dirtyReady = true;
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("does not treat already-pending dirty signals as edits during the AI run", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let dirtyReady = false;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1, contentRows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "excluded" }] },
        }]);
      }
      if (message.name === "ai.run") {
        return replyFrame(message, {
          status: "ok",
          sessionId: "ai-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    dirtyReady = true;
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors).toEqual({
      inclusionSelectors: ["main"],
      exclusionSelectors: [".ad"],
    });
  });

  it("does not let an older AI run clear a newer active run", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) =>
      message.type === "captureSubmissionSnapshot"
        ? { ok: true, snapshot, rows: [] }
        : { ok: true, initialized: true, tree: "rewrite" }
    );
    let signalSeq = 0;
    const aiResolvers: Array<(frame: BusFrame) => void> = [];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "ai.run") {
        return await new Promise<BusFrame>((resolve) => aiResolvers.push(resolve));
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(runtime.sendMessage.mock.calls.filter(([frame]) => (frame as BusFrame).name === "ai.run")).toHaveLength(1);
    aiResolvers[0]?.(replyFrame(runtime.sendMessage.mock.calls.find(([frame]) => (frame as BusFrame).name === "ai.run")?.[0] as BusFrame, {
      status: "ok",
      sessionId: "ai-1",
      selectors: { inclusionSelectors: ["only"], exclusionSelectors: [] },
    }));
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors.inclusionSelectors).toEqual(["only"]);
  });

  it("opens silent preview with silent origin", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    let pollCurrentTab: (() => void) | null = null;
    vi.mocked(window.setInterval).mockImplementation((handler) => {
      if (typeof handler === "function") {
        pollCurrentTab = () => { handler(); };
      }
      return 1;
    });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let releasePreviewOpenedFact: (() => void) | null = null;
    let holdPreviewOpenedFact = false;
    let previewExitCount = 0;
    let stallNextSignalPull = false;
    let projectedPreviewOrgan: "silent" | "silent_preview" = "silent";
    let holdPreviewContentSync = false;
    let releasePreviewContentSync: (() => void) | null = null;
    let rejectNextPreviewContentSync = false;
    let holdStalePreviewContentSeq = false;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.pull" && stallNextSignalPull) {
        stallNextSignalPull = false;
        return await new Promise<BusFrame>(() => undefined);
      }
      if (message.name === "page.context") {
        return replyFrame(message, {
          status: "managed_candidate",
          generation: 1,
          observedUrl: "https://example.com/page",
          draftDisposition: "preserve",
          environmentKey: "example.com",
          siteId: 1,
          baseUrl: "https://example.com",
          pageKey: "/page",
          pageTypes: [{ pageType: "detail", pages: [{ pageKey: "/page", wordsCount: 42 }] }],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
          renderModeSet: true,
          todo: {
            covered: 1,
            actionable: 1,
            pageTypes: [{
              pageType: "detail",
              markedCount: 1,
              current: true,
              candidates: [{ pageKey: "/page", wordsCount: 42, marked: true, current: true }],
            }],
          },
        });
      }
      if (
        message.name === "fact.reported" &&
        (message.payload as { sensation?: { reason?: string } }).sensation?.reason === "preview-exit-requested"
      ) {
        previewExitCount += 1;
        projectedPreviewOrgan = "silent";
        await runtime.sendMessage(contentPreviewExitedFrame(false, `content-silent-preview-exited-${previewExitCount}`));
      }
      if (
        message.name === "fact.reported" &&
        (message.payload as { sensation?: { reason?: string } }).sensation?.reason === "preview-opened"
      ) {
        projectedPreviewOrgan = "silent_preview";
      }
      if (
        message.name === "fact.reported" &&
        holdPreviewOpenedFact &&
        (message.payload as { sensation?: { reason?: string } }).sensation?.reason === "preview-opened"
      ) {
        return await new Promise<BusFrame>((resolve) => {
          releasePreviewOpenedFact = () => resolve(replyFrame(message, []));
        });
      }
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: 1,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: 1,
          payload: request.signal?.payload ?? {},
        }]);
      }
      return replyFrame(message, []);
    }, "rendered", { delegatePageContextToHandler: true });
    const projection = (
      revision: number,
      text: string,
      xpath: string,
      projectionId = "silent-projection-a",
    ) => ({
      projectionId,
      revision,
      pageUrl: "https://example.com/page",
      rows: [{
        id: "silent-row",
        classification: "implicit-included" as const,
        text,
        xpath,
        selector: "main",
        shadow: "light" as const,
      }],
    });
    let previewProjectCount = 0;
    let projectionOccurrenceId = "silent-projection-a";
    let raceProjectionRequests = false;
    let raceProjectionRequestCount = 0;
    let resolveDelayedRevision: ((value: ReturnType<typeof projection>) => void) | null = null;
    let delayProjectionUntilAfterExit = false;
    let resolvePostExitProjection: ((value: ReturnType<typeof projection>) => void) | null = null;
    let delayPreviewActivation = false;
    let resolveDelayedActivation: ((value: { targeted: boolean }) => void) | null = null;
    let delayPreviewEmphasis = false;
    let resolveDelayedEmphasis: ((value: null) => void) | null = null;
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "syncContentSignals") {
        if (rejectNextPreviewContentSync && projectedPreviewOrgan === "silent_preview") {
          rejectNextPreviewContentSync = false;
          return { ok: true };
        }
        const response = {
          ok: true,
          organName: projectedPreviewOrgan,
          runSessionId: "",
          lastConsumedSeq: holdStalePreviewContentSeq ? 0 : Number.MAX_SAFE_INTEGER,
          tree: "rewrite",
        };
        if (holdPreviewContentSync && projectedPreviewOrgan === "silent_preview") {
          return new Promise<typeof response>((resolve) => {
            releasePreviewContentSync = () => resolve(response);
          });
        }
        return response;
      }
      if (message.type === "preview.project") {
        previewProjectCount += 1;
        if (delayProjectionUntilAfterExit) {
          return new Promise<ReturnType<typeof projection>>((resolve) => {
            resolvePostExitProjection = resolve;
          });
        }
        if (raceProjectionRequests) {
          raceProjectionRequestCount += 1;
          if (raceProjectionRequestCount === 1) {
            return new Promise<ReturnType<typeof projection>>((resolve) => {
              resolveDelayedRevision = resolve;
            });
          }
          return projection(3, "Article after mutation", "/html[1]/body[1]/main[2]", projectionOccurrenceId);
        }
        return projection(
          holdPreviewOpenedFact && previewProjectCount > 1 ? 1 : 0,
          holdPreviewOpenedFact && previewProjectCount > 1 ? "Poll winner" : "Saved article",
          "/html[1]/body[1]/main[1]",
          projectionOccurrenceId,
        );
      }
      if (message.type === "preview.activate" && delayPreviewActivation) {
        return new Promise<{ targeted: boolean }>((resolve) => {
          resolveDelayedActivation = resolve;
        });
      }
      if (message.type === "preview.emphasize" && delayPreviewEmphasis) {
        return new Promise<null>((resolve) => {
          resolveDelayedEmphasis = resolve;
        });
      }
      return { ok: true, active: false, pageUrl: "https://example.com/page" };
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const popupRuntimeListener = runtime.onMessage.addListener.mock.calls.at(-1)?.[0] as ((
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown) | undefined;
    expect(popupRuntimeListener).toBeTypeOf("function");
    const emitPreviewFocused = (id: string): void => {
      popupRuntimeListener?.({
        kind: "uf-bus/1",
        frameType: "event",
        id,
        seq: 0,
        name: "preview.focused",
        source: "content",
        sourceInstance: "content:77",
        target: "popup",
        payload: {
          pageUrl: "https://example.com/page",
          projectionId: projectionOccurrenceId,
          rowId: "silent-row",
        },
      } satisfies BusFrame, {}, () => undefined);
    };
    await runtime.sendMessage(reportedFactFrame("content", "seed-silent-preview-marking", {
      markingEnabled: true,
    }, "seed-silent-preview-marking"));
    await runtime.sendMessage(reportedFactFrame("popup", "seed-silent-preview-run", {
      markingEnabled: true,
      runPhase: "running",
      runSessionId: "seed-run",
    }, "seed-silent-preview-run"));
    await runtime.sendMessage(reportedFactFrame("popup", "seed-silent-preview-complete", {
      markingEnabled: true,
      runPhase: "completed",
      runSessionId: "seed-run",
      // Deliberately leave the transient brain presentation empty. The silent
      // UI and Preview action must both use the authoritative saved property
      // selectors loaded from backendConfig(), which is the headed regression.
      runSelectors: { inclusionSelectors: [], exclusionSelectors: [] },
    }, "seed-silent-preview-complete"));
    await runtime.sendMessage(reportedFactFrame("popup", "seed-silent-preview-saved", {
      savedSeq: 1,
    }, "seed-silent-preview-saved"));
    render.mock.calls.at(-1)?.[0].props.onRefresh();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.stateName === "silent" &&
        render.mock.calls.at(-1)?.[0].props.presentation.selectors.inclusionSelectors.length > 0,
      "selector-bearing silent state",
    );
    holdPreviewOpenedFact = true;
    holdPreviewContentSync = true;
    render.mock.calls.at(-1)?.[0].props.onPreview();
    await waitFor(() => releasePreviewOpenedFact !== null, "the delayed preview-opened fact response");

    // The opening request (E1) is waiting for its fact acknowledgement, while a
    // poll consumes the queued Preview signal and adopts a newer projection E2.
    // Completing E1 must not clear the E2 winner.
    expect(pollCurrentTab).not.toBeNull();
    pollCurrentTab?.();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.presentation.previewProjection?.revision === 1,
      "the fast polling projection during the delayed open fact",
    );
    await waitFor(() => releasePreviewContentSync !== null, "the delayed content Preview acknowledgement");
    expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(false);
    const rejectedFocusOccurrence = render.mock.calls.at(-1)?.[0].props.focusedPreviewRowOccurrence;
    emitPreviewFocused("preview-focus-before-content-ready");
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.focusedPreviewRowId).toBeNull();
    expect(render.mock.calls.at(-1)?.[0].props.focusedPreviewRowOccurrence).toBe(rejectedFocusOccurrence);
    const targetCommandCountWhilePreparing = tabsSendMessage.mock.calls.filter(([, frame]) => {
      const name = ((frame as BusFrame).payload as { name?: string } | undefined)?.name;
      return name === "preview.activate" || name === "preview.emphasize";
    }).length;
    render.mock.calls.at(-1)?.[0].props.onPreviewRowHover("silent-row", true);
    render.mock.calls.at(-1)?.[0].props.onPreviewRowActivate("silent-row");
    await flushEntrypointWork();
    expect(tabsSendMessage.mock.calls.filter(([, frame]) => {
      const name = ((frame as BusFrame).payload as { name?: string } | undefined)?.name;
      return name === "preview.activate" || name === "preview.emphasize";
    })).toHaveLength(targetCommandCountWhilePreparing);
    holdPreviewOpenedFact = false;
    holdPreviewContentSync = false;
    releasePreviewOpenedFact?.();
    releasePreviewContentSync?.();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.previewProjection).toMatchObject({
      projectionId: "silent-projection-a",
      revision: 1,
      rows: [{ text: "Poll winner" }],
    });
    emitPreviewFocused("preview-focus-current-1");
    await flushEntrypointWork();
    const firstFocusOccurrence = render.mock.calls.at(-1)?.[0].props.focusedPreviewRowOccurrence;
    expect(render.mock.calls.at(-1)?.[0].props.focusedPreviewRowId).toBe("silent-row");
    emitPreviewFocused("preview-focus-current-2");
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.focusedPreviewRowId).toBe("silent-row");
    expect(render.mock.calls.at(-1)?.[0].props.focusedPreviewRowOccurrence).toBe(firstFocusOccurrence + 1);

    expect(tabsSendMessage).toHaveBeenCalledWith(77, previewCommand("preview.project", {
      pageUrl: "https://example.com/page",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    }));
    const openingProjectionRequests = tabsSendMessage.mock.calls
      .map(([, frame]) => frame as BusFrame)
      .filter((frame) => frame.name === "preview.project");
    expect(openingProjectionRequests.length).toBeGreaterThanOrEqual(2);
    for (const request of openingProjectionRequests) {
      expect(request.payload).toMatchObject({
        pageUrl: "https://example.com/page",
        selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
      });
    }
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "preview-opened",
          facts: expect.objectContaining({ previewActive: true, previewOrigin: "silent" }),
        }),
      }),
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.enableToggleChecked).toBe(false);
    const contentCommandsAfterSilentOpen = tabsSendMessage.mock.calls.map(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name,
    );
    expect(contentCommandsAfterSilentOpen).toContain("applySilentSelectors");
    expect(contentCommandsAfterSilentOpen).not.toContain("clearSilentSelectors");

    // The open preview is re-projected on the normal popup poll. A second tick
    // while revision 2 is pending coalesces into exactly one trailing request;
    // after revision 2 settles, that trailing request observes the DOM mutation.
    raceProjectionRequests = true;
    pollCurrentTab?.();
    await waitFor(() => resolveDelayedRevision !== null, "the delayed revision-one projection request");
    pollCurrentTab?.();
    resolveDelayedRevision?.(projection(2, "Stale article", "/html[1]/body[1]/main[1]", projectionOccurrenceId));
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.presentation.previewProjection?.revision === 3,
      "the mutation-driven revision-three projection",
    );
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.presentation.previewProjection).toMatchObject({
      projectionId: "silent-projection-a",
      revision: 3,
      rows: [{
        id: "silent-row",
        text: "Article after mutation",
        xpath: "/html[1]/body[1]/main[2]",
      }],
    });

    // A delayed target response belongs to this exact Preview occurrence. Exit
    // and reopen before it replies; cycle B must neither log cycle A's failure
    // nor clear/reproject its new projection.
    delayPreviewActivation = true;
    delayPreviewEmphasis = true;
    render.mock.calls.at(-1)?.[0].props.onPreviewRowActivate("silent-row");
    render.mock.calls.at(-1)?.[0].props.onPreviewRowHover("silent-row", true);
    await waitFor(() => resolveDelayedActivation !== null, "the delayed cycle-A activation response");
    await waitFor(() => resolveDelayedEmphasis !== null, "the delayed cycle-A emphasis response");
    stallNextSignalPull = true;
    vi.useFakeTimers();
    try {
      render.mock.calls.at(-1)?.[0].props.onExitPreview();
      for (let index = 0; index < 100 && stallNextSignalPull; index += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(stallNextSignalPull).toBe(false);
      await vi.advanceTimersByTimeAsync(SIGNAL_PULL_TIMEOUT_MS);
      for (
        let index = 0;
        index < 100 && render.mock.calls.at(-1)?.[0].props.diagnostics.stateName !== "silent";
        index += 1
      ) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(render.mock.calls.at(-1)?.[0].props.diagnostics.stateName).toBe("silent");
    } finally {
      vi.useRealTimers();
    }
    projectionOccurrenceId = "silent-projection-b";
    raceProjectionRequests = false;
    delayPreviewActivation = false;
    delayPreviewEmphasis = false;
    rejectNextPreviewContentSync = true;
    render.mock.calls.at(-1)?.[0].props.onPreview();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.presentation.previewProjection?.projectionId === "silent-projection-b",
      "cycle B preview projection",
    );
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.toast?.message.includes("Content List is still preparing") === true,
      "the exact readiness warning",
    );
    expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(false);
    pollCurrentTab?.();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.previewInteractionReady === true,
      "the retried content Preview acknowledgement",
    );
    expect(render.mock.calls.at(-1)?.[0].props.toast).toBeNull();
    const projectCountBeforeStaleActivation = previewProjectCount;
    resolveDelayedActivation?.({ targeted: false });
    resolveDelayedEmphasis?.(null);
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.presentation.previewProjection).toMatchObject({
      projectionId: "silent-projection-b",
      revision: 0,
    });
    expect(previewProjectCount).toBe(projectCountBeforeStaleActivation);
    const postReopenLogLabels = render.mock.calls.at(-1)?.[0].props.diagnostics.log
      .map((entry: { label: string }) => entry.label);
    expect(postReopenLogLabels).not.toContain("Preview row changed");
    expect(postReopenLogLabels).not.toContain("Preview row unavailable");

    delayProjectionUntilAfterExit = true;
    pollCurrentTab?.();
    await waitFor(() => resolvePostExitProjection !== null, "the projection request held across Preview exit");
    render.mock.calls.at(-1)?.[0].props.onExitPreview();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.stateName).toBe("silent");
    expect(render.mock.calls.at(-1)?.[0].props.presentation.enableToggleChecked).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.previewProjection).toBeNull();

    resolvePostExitProjection?.(projection(1, "Too late", "/html[1]/body[1]/main[3]", projectionOccurrenceId));
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.stateName).toBe("silent");
    expect(render.mock.calls.at(-1)?.[0].props.presentation.previewProjection).toBeNull();

    // Reusing the same organ name is not proof that content consumed this open
    // occurrence. Keep rows inert while its signal sequence is stale, then let
    // the local backstop recover and dismiss only this occurrence's warning.
    delayProjectionUntilAfterExit = false;
    resolvePostExitProjection = null;
    holdStalePreviewContentSeq = true;
    vi.useFakeTimers();
    try {
      render.mock.calls.at(-1)?.[0].props.onPreview();
      for (
        let index = 0;
        index < 100 && render.mock.calls.at(-1)?.[0].props.diagnostics.stateName !== "silent_preview";
        index += 1
      ) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(render.mock.calls.at(-1)?.[0].props.diagnostics.stateName).toBe("silent_preview");
      expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(false);
      await vi.advanceTimersByTimeAsync(2_100);
      for (
        let index = 0;
        index < 100 && render.mock.calls.at(-1)?.[0].props.toast?.message
          .includes("Content List is still preparing") !== true;
        index += 1
      ) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(render.mock.calls.at(-1)?.[0].props.toast?.message)
        .toContain("Content List is still preparing");
      expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(false);
      holdStalePreviewContentSeq = false;
      pollCurrentTab?.();
      for (
        let index = 0;
        index < 100 && render.mock.calls.at(-1)?.[0].props.previewInteractionReady !== true;
        index += 1
      ) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(true);
      expect(render.mock.calls.at(-1)?.[0].props.toast).toBeNull();
    } finally {
      holdStalePreviewContentSeq = false;
      vi.useRealTimers();
    }
    render.mock.calls.at(-1)?.[0].props.onExitPreview();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.stateName === "silent",
      "silent restoration after same-name sequence recovery",
    );

    // A content-organ acknowledgement belongs to the Preview cycle that
    // requested it. If that cycle exits while the command is delayed, its old
    // `silent_preview` reply must not unlock rows in the restored silent view.
    releasePreviewContentSync = null;
    holdPreviewContentSync = true;
    render.mock.calls.at(-1)?.[0].props.onPreview();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.stateName === "silent_preview" &&
        releasePreviewContentSync !== null,
      "the delayed stale Preview acknowledgement",
    );
    expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(false);
    render.mock.calls.at(-1)?.[0].props.onExitPreview();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.diagnostics.stateName === "silent",
      "silent restoration before the old acknowledgement",
    );
    holdPreviewContentSync = false;
    releasePreviewContentSync?.();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.stateName).toBe("silent");
    expect(render.mock.calls.at(-1)?.[0].props.previewInteractionReady).toBe(false);
  });

  it("drains pending dirty signals and aborts stale Preview", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    let dirtyReady = false;
    let signalSeq = 0;
    let decidedFromFact: Record<string, unknown> | null = null;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const sensation = (message.payload as { sensation: { tabId: number; facts: { markingEnabled?: boolean } } }).sensation;
        if (sensation.facts.markingEnabled === true) {
          signalSeq += 1;
          decidedFromFact = {
            kind: "uf-signal/1",
            tabId: sensation.tabId,
            seq: signalSeq,
            name: "marking.enabled",
            source: "brain",
            cause: "fact-fold",
            at: signalSeq,
            payload: { pageUrl: "https://example.com/page" },
          };
        }
        return undefined;
      }
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "signals.pull" && decidedFromFact) {
        const pending = decidedFromFact;
        decidedFromFact = null;
        return replyFrame(message, [pending]);
      }
      if (message.name === "signals.pull" && dirtyReady) {
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 1 },
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, active: false, pageUrl: "https://example.com/page" })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    await (runtime.sendMessage as ReturnType<typeof vi.fn>)({
      kind: "uf-bus/1",
      frameType: "request",
      id: "seed",
      seq: 0,
      name: "signals.emit",
      source: "test" as never,
      target: "background",
      payload: {
        tabId: 77,
        signal: {
          name: "marking.enabled",
          source: "popup",
          cause: "test",
          payload: { pageUrl: "https://example.com/page" },
        },
      },
    });
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi?.();
    await flushEntrypointWork();
    dirtyReady = true;
    const fastPoll = globalThis.window.setInterval.mock.calls
      .find(([, delay]) => delay === 500)?.[0] as (() => void) | undefined;
    fastPoll?.();
    await waitFor(
      () => render.mock.calls.at(-1)?.[0].props.presentation.showPreviewDisabled === true,
      "dirty signal projection",
    );
    render.mock.calls.at(-1)?.[0].props.onPreview();
    await flushEntrypointWork();

    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: expect.objectContaining({
        signal: expect.objectContaining({ name: "preview.opened" }),
      }),
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.showPreviewDisabled).toBe(true);
  });

  it("does not enable Save when markings change while an AI run is in flight", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "rendered" as const,
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"] as const,
      pages: [{ url: "https://example.com/page", renderedHtml: "<html></html>", renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }] }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let releaseAi: ((value: BusFrame) => void) | null = null;
    let dirtyReady = false;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      if (message.name === "signals.pull") {
        if (!dirtyReady) {
          return replyFrame(message, []);
        }
        dirtyReady = false;
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: 77,
          seq: signalSeq,
          name: "markings.changed",
          source: "content",
          cause: "content-click",
          at: signalSeq,
          payload: { pageUrl: "https://example.com/page", markedCount: 2 },
        }]);
      }
      if (message.name === "ai.run") {
        dirtyReady = true;
        return await new Promise<BusFrame>((resolve) => {
          releaseAi = resolve;
        });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    releaseAi?.(replyFrame(runtime.sendMessage.mock.calls.find(([frame]) => (frame as BusFrame).name === "ai.run")?.[0] as BusFrame, {
      status: "ok",
      sessionId: "ai-1",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
    }));
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("reconciles startup state from active content when the signal log is empty", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({
      ok: true,
      active: true,
      dirty: true,
      pageUrl: "https://example.com",
      markedCount: 2,
      tree: "rewrite",
    }));
    let signalSeq = 0;
    // markings.changed has exactly one producer now — the brain — so the stub has
    // to play that part: it folds the relayed toggle fact and decides the signal,
    // which is what the real decide.ts does.
    let decidedFromFact: Record<string, unknown>[] = [];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const envelope = message.payload as { sensation?: { tabId?: number; facts?: { markingEnabled?: boolean; markingToggleSeq?: number } } };
        if (envelope.sensation?.facts?.markingEnabled === true) {
          signalSeq += 1;
          decidedFromFact.push({
            kind: "uf-signal/1",
            tabId: envelope.sensation?.tabId ?? 77,
            seq: signalSeq,
            name: "marking.enabled",
            source: "brain",
            cause: "activate-ok",
            at: signalSeq,
            payload: { pageUrl: "https://example.com" },
          });
        }
        const seq = envelope.sensation?.facts?.markingToggleSeq ?? 0;
        if (seq > 0) {
          signalSeq += 1;
          decidedFromFact.push({
            kind: "uf-signal/1",
            tabId: envelope.sensation?.tabId ?? 77,
            seq: signalSeq,
            name: "markings.changed",
            source: "brain",
            cause: "marking-toggle",
            at: signalSeq,
            payload: { pageUrl: "https://example.com", markedCount: seq },
          });
        }
        return undefined;
      }
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: request.signal?.payload ?? {},
          }]);
      }
      if (message.name === "signals.pull" && decidedFromFact.length > 0) {
        const pending = decidedFromFact;
        decidedFromFact = [];
        return replyFrame(message, pending);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    await flushEntrypointWork();

    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("getContentMainStatus", {}));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "content-reconciliation",
          facts: expect.objectContaining({ markingEnabled: true }),
        }),
      }),
    }));
    // The popup relays what it observed as a fact and never mints the signal.
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          source: "popup",
          reason: "marking-toggle-observed",
          facts: expect.objectContaining({ markingToggleSeq: 2 }),
        }),
      }),
    }));
    const emittedSignalNames = runtime.sendMessage.mock.calls
      .map(([frame]) => frame as { name?: string; payload?: { signal?: { name?: string } } })
      .filter((frame) => frame.name === "signals.emit")
      .map((frame) => frame.payload?.signal?.name);
    expect(emittedSignalNames).not.toContain("markings.changed");
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("reconciles clean active content without marking it dirty", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({
      ok: true,
      active: true,
      dirty: false,
      pageUrl: "https://example.com",
      markedCount: 25,
      tree: "rewrite",
    }));
    let signalSeq = 0;
    let decidedFromFact: Record<string, unknown> | null = null;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const sensation = (message.payload as { sensation: { tabId: number; facts: { markingEnabled?: boolean } } }).sensation;
        if (sensation.facts.markingEnabled === true) {
          signalSeq += 1;
          decidedFromFact = {
            kind: "uf-signal/1",
            tabId: sensation.tabId,
            seq: signalSeq,
            name: "marking.enabled",
            source: "brain",
            cause: "activate-ok",
            at: signalSeq,
            payload: { pageUrl: "https://example.com" },
          };
        }
        return undefined;
      }
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: signalSeq,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: signalSeq,
            payload: request.signal?.payload ?? {},
          }]);
      }
      if (message.name === "signals.pull" && decidedFromFact) {
        const pending = decidedFromFact;
        decidedFromFact = null;
        return replyFrame(message, [pending]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "content-reconciliation",
          facts: expect.objectContaining({ markingEnabled: true }),
        }),
      }),
    }));
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.emit",
      payload: expect.objectContaining({
        signal: expect.objectContaining({ name: "markings.changed" }),
      }),
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(true);
  });

  it("retires a stale Preview occurrence when replacement content is silent", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({
      ok: true,
      active: false,
      dirty: false,
      pageUrl: "https://example.com",
      markedCount: 0,
      sessionState: { name: "silent", lastConsumedSeq: 0 },
      tree: "rewrite",
    }));
    let signalSeq = 4;
    let pendingSignals: Record<string, unknown>[] = [
      {
        kind: "uf-signal/1", tabId: 77, seq: 1, name: "marking.enabled",
        source: "brain", cause: "activate-ok", at: 1,
        payload: { pageUrl: "https://example.com" },
      },
      {
        kind: "uf-signal/1", tabId: 77, seq: 2, name: "run.started",
        source: "brain", cause: "ai-run", at: 2,
        payload: { pageUrl: "https://example.com", sessionId: "run-1" },
      },
      {
        kind: "uf-signal/1", tabId: 77, seq: 3, name: "run.completed",
        source: "brain", cause: "ai-run", at: 3,
        payload: {
          pageUrl: "https://example.com",
          sessionId: "run-1",
          selectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
        },
      },
      {
        kind: "uf-signal/1", tabId: 77, seq: 4, name: "preview.opened",
        source: "brain", cause: "preview", at: 4,
        payload: { pageUrl: "https://example.com", origin: "post_ai" },
      },
    ];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "fact.reported") {
        const facts = (message.payload as {
          sensation?: { facts?: { markingEnabled?: boolean; previewActive?: boolean } };
        }).sensation?.facts;
        if (facts?.markingEnabled === false && facts.previewActive === false) {
          pendingSignals.push(
            {
              kind: "uf-signal/1", tabId: 77, seq: ++signalSeq, name: "marking.disabled",
              source: "brain", cause: "deactivate-ok", at: signalSeq,
              payload: { pageUrl: "https://example.com" },
            },
            {
              kind: "uf-signal/1", tabId: 77, seq: ++signalSeq, name: "preview.exited",
              source: "brain", cause: "preview", at: signalSeq,
              payload: { pageUrl: "https://example.com", restored: false },
            },
          );
        }
        return undefined;
      }
      if (message.name === "signals.pull") {
        const pending = pendingSignals;
        pendingSignals = [];
        return replyFrame(message, pending);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    await flushEntrypointWork();

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "content-reconciliation",
          facts: expect.objectContaining({
            markingEnabled: false,
            previewActive: false,
            previewExitRequested: false,
          }),
        }),
      }),
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation).toMatchObject({
      silentModeActive: true,
      temporarilyDisabledOverlay: false,
      previewVisible: false,
    });
  });

  it("does not call a seeded session dirty, however many rows it has", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    // A clean session seeded from the AI selectors: hundreds of rows, no toggles.
    // Dirtiness follows the operator's toggle count and nothing else, so a row
    // count — however large — must not imply an edit.
    const tabsSendMessage = makeTabsSendMessage(() => ({
      ok: true,
      active: true,
      dirty: false,
      pageUrl: "https://example.com",
      markedCount: 0,
      contentRows: Array.from({ length: 300 }, (_, index) => ({
        xpath: `/html[1]/body[1]/div[1]/p[${index + 1}]`,
        classification: index % 2 === 0 ? "included" : "excluded",
      })),
      tree: "rewrite",
    }));
    let signalSeq = 0;
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        signalSeq += 1;
        return replyFrame(message, [{
          kind: "uf-signal/1",
          tabId: request.tabId,
          seq: signalSeq,
          name: request.signal?.name,
          source: "brain",
          cause: "test",
          at: signalSeq,
          payload: request.signal?.payload ?? {},
        }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    await flushEntrypointWork();

    const frames = runtime.sendMessage.mock.calls.map(([frame]) => frame as {
      name?: string;
      payload?: { signal?: { name?: string }; sensation?: { reason?: string } };
    });
    // No signal minted, and no toggle fact relayed: nothing was toggled.
    expect(frames.filter((f) => f.name === "signals.emit").map((f) => f.payload?.signal?.name))
      .not.toContain("markings.changed");
    expect(frames.filter((f) => f.name === "fact.reported").map((f) => f.payload?.sensation?.reason))
      .not.toContain("marking-toggle-observed");
    // The rows still show, because they are display data.
    const props = render.mock.calls.at(-1)?.[0].props;
    expect(props.presentation.markingRows).toHaveLength(300);
    expect(props.presentation.discardDisabled).toBe(true);
  });

  it("deactivates content and emits navigation when the bound tab URL changes", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a" }]);
    let activeUrl = "https://example.com/a";
    const get = vi.fn(async () => ({ id: 77, url: activeUrl }));
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: false, tree: "rewrite" }));
    const runtime = makeRuntime(async (message) => {
      if (message.name === "signals.emit") {
        const request = message.payload as { tabId: number; signal: { name?: string; payload?: unknown } };
        return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: request.tabId,
            seq: 1,
            name: request.signal?.name,
            source: "brain",
            cause: "test",
            at: 1,
            payload: request.signal?.payload ?? {},
          }]);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        get,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    activeUrl = "https://example.com/b";
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await flushEntrypointWork();

    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "fact.reported",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          reason: "navigation-observed",
          facts: expect.objectContaining({ pageUrl: "https://example.com/b" }),
        }),
      }),
      target: "background",
    }));
    const emulationNames = runtime.sendMessage.mock.calls
      .map(([frame]) => (frame as { name?: string }).name)
      .filter((name) => name === "emulation.apply" || name === "emulation.clear");
    expect(emulationNames.slice(-2)).toEqual(["emulation.clear", "emulation.apply"]);
  });

  it("keeps observing the opening tab when browser focus moves elsewhere", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a" }]);
    const get = vi.fn().mockResolvedValue({ id: 77, url: "https://example.com/a" });
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: false, tree: "rewrite" }));
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, get, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "emulation.apply"),
      "initial tab binding",
    );
    const queriesAfterBinding = query.mock.calls.length;
    query.mockResolvedValue([{ id: 88, url: "https://elsewhere.example.net/" }]);
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await waitFor(() => get.mock.calls.length > 0, "sticky tab lookup");

    expect(query).toHaveBeenCalledTimes(queriesAfterBinding);
    expect(get).toHaveBeenLastCalledWith(77);
    expect(tabsSendMessage.mock.calls.every(([tabId]) => tabId === 77)).toBe(true);
    expect(runtime.sendMessage.mock.calls
      .filter(([frame]) => frame.name === "lock.directive")
      .every(([frame]) => frame.payload.tabId === 77)).toBe(true);
  });

  it("terminates the bound session and stays in onboarding after definitive configuration deletion", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    const runtime = makeRuntime(async (message) => {
      if (message.name === "settings.save") {
        return replyFrame(message, { status: "ok", settings: {}, hasToken: false });
      }
      if (message.name === "session.unregister") {
        return replyFrame(message, { status: "ok" });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");
    props().onSettingsChange("configEndpoint", "");
    props().onSettingsChange("aiEndpoint", "");
    props().onSettingsChange("stageBase", "");
    props().onSettingsSave();
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "session.unregister"),
      "terminal session cleanup",
    );

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "settings.save",
      payload: {},
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "session.unregister",
      payload: { tabId: 77 },
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("terminateConsentSuppression", {}));
    expect(props().view).toBe("configuration");
    expect(props().diagnostics).toMatchObject({
      configurationComplete: false,
      settingsSaved: false,
      authState: "signed_out",
      contentActive: false,
      contentDirty: false,
    });
  });

  it("clears only the bound domain and explicitly unregisters then reloads the opening tab", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const close = vi.fn();
    Object.assign(globalThis.window, { close });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a?x=1" }]);
    const get = vi.fn().mockResolvedValue({ id: 77, url: "https://example.com/a?x=1" });
    const reload = vi.fn((_tabId: number, _options: object, callback: () => void) => callback());
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    const runtime = makeRuntime(async (message) => {
      if (message.name === "cache.clearDomain") {
        return replyFrame(message, { status: "ok", origin: "https://example.com" });
      }
      if (message.name === "session.unregister") {
        return replyFrame(message, { status: "ok" });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, get, reload, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");

    props().onEmptyDomainCache();
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "cache.clearDomain"),
      "domain cache command",
    );
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "cache.clearDomain",
      payload: { origin: "https://example.com" },
    }));
    expect(reload).toHaveBeenCalledWith(77, {}, expect.any(Function));
    expect(props().diagnostics).toMatchObject({
      maintenanceBusy: false,
      maintenanceTone: "success",
    });

    props().onUnregisterTab();
    await waitFor(() => close.mock.calls.length === 1, "unregister completion");
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "session.unregister",
      payload: { tabId: 77 },
    }));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("terminateConsentSuppression", {}));
    expect(reload).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("drops a delayed cache result when the live tab navigates before polling observes it", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    let tabUrl = "https://a.example/page";
    const query = vi.fn(async () => [{ id: 77, url: tabUrl }]);
    const get = vi.fn(async () => ({ id: 77, url: tabUrl }));
    const reload = vi.fn((_tabId: number, _options: object, callback: () => void) => callback());
    let resolveClear!: (value: { status: "ok"; origin: string }) => void;
    const clearResult = new Promise<{ status: "ok"; origin: string }>((resolve) => {
      resolveClear = resolve;
    });
    const runtime = makeRuntime(async (message) => {
      if (message.name === "cache.clearDomain") {
        return replyFrame(message, await clearResult);
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        get,
        reload,
        sendMessage: makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");

    props().onEmptyDomainCache();
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "cache.clearDomain"),
      "delayed cache command",
    );
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "cache.clearDomain",
      payload: { origin: "https://a.example" },
    }));

    // No popup poll has run. The controller must consult the authoritative live
    // tab again instead of letting the still-cached A binding authorize B.
    tabUrl = "https://b.example/replacement";
    resolveClear({ status: "ok", origin: "https://a.example" });
    await waitFor(() => props().diagnostics.maintenanceBusy === false, "stale cache retirement");

    expect(reload).not.toHaveBeenCalled();
    expect(props().diagnostics).toMatchObject({
      pageUrl: "https://a.example/page",
      maintenanceMessage: "",
      maintenanceTone: "info",
    });
    expect(props().diagnostics.log).not.toContainEqual(expect.objectContaining({
      label: "Domain cache cleared",
    }));
  });

  it("orders explicit unregister termination before background cleanup, reload, and close", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const order: string[] = [];
    const close = vi.fn(() => { order.push("close"); });
    Object.assign(globalThis.window, { close });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const tab = { id: 77, url: "https://example.com/a" };
    const tabsSendMessage = makeTabsSendMessage((_tabId, message) => {
      if (message.type === "deactivateContentMain") {
        order.push("deactivate");
      } else if (message.type === "terminateConsentSuppression") {
        order.push("suppress");
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    const reload = vi.fn((_tabId: number, _options: object, callback: () => void) => {
      order.push("reload");
      callback();
    });
    const runtime = makeRuntime(async (message) => {
      if (message.name === "session.unregister") {
        order.push("unregister");
        return replyFrame(message, { status: "ok" });
      }
      return replyFrame(message, []);
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query: vi.fn().mockResolvedValue([tab]),
        get: vi.fn().mockResolvedValue(tab),
        reload,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");
    order.length = 0;

    props().onUnregisterTab();
    await waitFor(() => close.mock.calls.length === 1, "ordered unregister completion");

    expect(order).toEqual(["deactivate", "suppress", "unregister", "reload", "close"]);
  });

  it("keeps a failed unregister connected and does not reload or close", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const close = vi.fn();
    Object.assign(globalThis.window, { close });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const tab = { id: 77, url: "https://example.com/a" };
    const reload = vi.fn();
    const runtime = makeRuntime(async (message) => message.name === "session.unregister"
      ? failedReplyFrame(message, "HANDLER_FAILED")
      : replyFrame(message, []));
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query: vi.fn().mockResolvedValue([tab]),
        get: vi.fn().mockResolvedValue(tab),
        reload,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");
    props().onUnregisterTab();
    await waitFor(
      () => props().diagnostics.maintenanceMessage.includes("remains connected"),
      "failed unregister result",
    );

    expect(reload).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(props().diagnostics).toMatchObject({ maintenanceBusy: false, maintenanceTone: "danger" });
    expect(props().diagnostics.log[0]).toMatchObject({
      label: "Tab unregister failed",
      detail: "HANDLER_FAILED",
      tone: "danger",
    });
  });

  it("does not suppress consent or unregister after rebinding during content deactivation", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const close = vi.fn();
    Object.assign(globalThis.window, { close });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    let tabUrl = "https://example.com/a";
    const query = vi.fn(async () => [{ id: 77, url: tabUrl }]);
    const get = vi.fn(async () => ({ id: 77, url: tabUrl }));
    let releaseFirstDeactivate!: (value: unknown) => void;
    const firstDeactivate = new Promise<unknown>((resolve) => {
      releaseFirstDeactivate = resolve;
    });
    let deferDeactivate = true;
    const tabsSendMessage = makeTabsSendMessage(async (_tabId, message) => {
      if (message.type === "deactivateContentMain" && deferDeactivate) {
        deferDeactivate = false;
        return await firstDeactivate;
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    const runtime = makeRuntime(async (message) => replyFrame(message, []));
    const reload = vi.fn();
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, get, reload, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");
    props().onUnregisterTab();
    await waitFor(
      () => tabsSendMessage.mock.calls.some(([, frame]) =>
        (frame as BusFrame).name === "command.dispatch" &&
        ((frame as BusFrame).payload as { name?: string }).name === "deactivateContentMain"),
      "pending content deactivation",
    );

    tabUrl = "https://example.com/b";
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await waitFor(() => props().diagnostics.pageUrl === tabUrl, "replacement binding");
    releaseFirstDeactivate({ ok: true, initialized: true, tree: "rewrite" });
    await flushEntrypointWork();

    const terminalCommands = tabsSendMessage.mock.calls.map(([, frame]) =>
      ((frame as BusFrame).payload as { name?: string } | undefined)?.name);
    expect(terminalCommands).toContain("deactivateContentMain");
    expect(terminalCommands).not.toContain("terminateConsentSuppression");
    expect(runtime.sendMessage.mock.calls).not.toContainEqual([
      expect.objectContaining({ name: "session.unregister" }),
    ]);
    expect(reload).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("does not let a pre-unregister config poll command the replacement document", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const close = vi.fn();
    Object.assign(globalThis.window, { close });
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const tab = { id: 77, url: "https://example.com/a" };
    const query = vi.fn().mockResolvedValue([tab]);
    const get = vi.fn().mockResolvedValue(tab);
    let finishReload: (() => void) | null = null;
    const reload = vi.fn((_tabId: number, _options: object, callback: () => void) => {
      finishReload = callback;
    });
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    let resolveConfig: ((frame: BusFrame) => void) | null = null;
    const configResponse = new Promise<BusFrame>((resolve) => {
      resolveConfig = resolve;
    });
    const runtime = makeRuntime(async (message) => {
      if (message.name === "session.unregister") {
        return replyFrame(message, { status: "ok" });
      }
      return replyFrame(message, []);
    }, "rendered", {
      configLoad: async () => await configResponse,
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, get, reload, sendMessage: tabsSendMessage },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");

    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "config.load"),
      "deferred config load",
    );

    props().onUnregisterTab();
    await waitFor(
      () => runtime.sendMessage.mock.calls.some(([frame]) => frame.name === "session.unregister"),
      "terminal unregister",
    );
    await waitFor(() => reload.mock.calls.length === 1, "replacement document reload");

    resolveConfig?.(replyFrame(
      runtime.sendMessage.mock.calls.find(([frame]) => frame.name === "config.load")?.[0] as BusFrame,
      {
        status: "ok",
        config: backendConfig(),
        renderMode: "rendered",
        renderModeSource: "backend",
      },
    ));
    await flushEntrypointWork();
    poll();
    await flushEntrypointWork();

    const contentCommands = tabsSendMessage.mock.calls.map(([, message]) => {
      const frame = message as BusFrame;
      return (frame.payload as { name?: string } | undefined)?.name;
    });
    expect(contentCommands).toContain("deactivateContentMain");
    expect(contentCommands).toContain("terminateConsentSuppression");
    expect(contentCommands).not.toContain("applySilentSelectors");
    expect(contentCommands).not.toContain("clearSilentSelectors");

    finishReload?.();
    await waitFor(() => close.mock.calls.length === 1, "unregister completion");
  });

  it("adopts property config only for the exact A to B to A binding occurrence", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    let tab = { id: 77, url: "https://example.com/a" };
    const query = vi.fn(async () => [tab]);
    const get = vi.fn(async () => tab);
    const requests: Array<{
      frame: BusFrame;
      resolve(reply: BusFrame): void;
    }> = [];
    const runtime = makeRuntime(async (message) => replyFrame(message, []), "rendered", {
      configLoad: async (frame) => await new Promise<BusFrame>((resolve) => {
        requests.push({ frame, resolve });
      }),
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: {
        query,
        get,
        reload: vi.fn(),
        sendMessage: makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" })),
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    await waitFor(() => props().diagnostics.settingsLoaded, "stored connection profile");
    const poll = globalThis.window.setInterval.mock.calls[0]?.[0] as () => void;
    poll();
    await waitFor(() => requests.length === 1, "initial A config candidate");

    tab = { id: 77, url: "https://example.com/b" };
    poll();
    await flushEntrypointWork();
    // Authority refreshes are single-flight. The B binding queues one trailing
    // pass while the initial A load is pending; A's response is fenced because
    // its binding occurrence is no longer current.
    expect(requests).toHaveLength(1);
    requests[0].resolve(replyFrame(requests[0].frame, {
      status: "ok",
      config: { ...backendConfig(), renderMode: "rendered" },
      renderMode: "rendered",
      renderModeSource: "backend",
    }));
    await waitFor(() => requests.length === 2, "B config candidate");
    requests[1].resolve(replyFrame(requests[1].frame, {
      status: "ok",
      config: { ...backendConfig(), renderMode: "static" },
      renderMode: "static",
      renderModeSource: "backend",
    }));
    await waitFor(() => props().diagnostics.renderMode === "static", "B config adoption");

    tab = { id: 77, url: "https://example.com/a" };
    poll();
    await waitFor(() => requests.length === 3, "replacement A config candidate");
    requests[2].resolve(replyFrame(requests[2].frame, {
      status: "ok",
      config: { ...backendConfig(), renderMode: "rendered" },
      renderMode: "rendered",
      renderModeSource: "backend",
    }));
    await waitFor(() => props().diagnostics.renderMode === "rendered", "replacement A adoption");

    expect(props().diagnostics).toMatchObject({
      pageUrl: "https://example.com/a",
      renderMode: "rendered",
      renderModeSource: "backend",
      configStatus: "ok",
    });
  });

  it("retries a publication-unknown outcome with the exact same fenced Hub operation", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({ createRoot: vi.fn(() => ({ render })) }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com" }]);
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    const publishRequests: Array<Record<string, unknown>> = [];
    const runtime = makeRuntime(async (message) => {
      if (message.name === "page.context") {
        return replyFrame(message, {
          status: "managed_candidate",
          generation: 1,
          observedUrl: "https://example.com",
          draftDisposition: "preserve",
          environmentKey: "example.com",
          siteId: 1,
          baseUrl: "https://example.com",
          pageKey: "/",
          pageTypes: [{ pageType: "detail", pages: [{ pageKey: "/", wordsCount: 100 }] }],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
          renderModeSet: true,
          todo: {
            covered: 1,
            actionable: 1,
            pageTypes: [{
              pageType: "detail",
              markedCount: 1,
              current: true,
              candidates: [{ pageKey: "/", wordsCount: 100, marked: true, current: true }],
            }],
          },
        });
      }
      if (message.name === "config.publish") {
        publishRequests.push(message.payload as Record<string, unknown>);
        if (publishRequests.length === 1) {
          return replyFrame(message, {
            status: "publication_unknown",
            httpStatus: 409,
            reason: "mutation response lost",
          });
        }
        const expectedFingerprint = String(publishRequests[0].expectedSelectorsFingerprint);
        return replyFrame(message, {
          status: "published",
          httpStatus: 200,
          config: {
            ...backendConfig(),
            submittedSelectorsFingerprint: expectedFingerprint,
            operation: { operationId: String(publishRequests[0].operationId), status: "published" },
          },
        });
      }
      return replyFrame(message, []);
    }, "rendered", { delegatePageContextToHandler: true });
    const tabsUpdate = vi.fn();
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage, update: tabsUpdate },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
    props().onCandidateNavigate("/detail/next");
    await waitFor(() => tabsUpdate.mock.calls.length > 0, "candidate navigation");
    expect(tabsUpdate).toHaveBeenCalledWith(77, { url: "https://example.com/detail/next" });
    props().onOpenLynxChecklist();
    await waitFor(() => props().lynxChecklist.phase === "ready", "publication checklist readiness");

    props().onSendToLynx();
    await waitFor(() => props().lynxChecklist.phase === "unknown", "unknown publication outcome");
    expect(props().lynxChecklist.message).toContain("Retry uses the same operation");
    expect(publishRequests).toHaveLength(1);
    expect(publishRequests[0]).toMatchObject({
      environmentKey: "example.com",
      siteId: 1,
      editorSessionId: "editor-1",
      lockToken: "lock-1",
      expectedPropertyRevision: 4,
      expectedFeedRevision: 2,
      expectedSelectorsFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    props().onSendToLynx();
    await waitFor(() => props().lynxChecklist.phase === "published", "definitive publication outcome");
    expect(publishRequests).toHaveLength(2);
    expect(publishRequests[1]).toEqual(publishRequests[0]);
    expect(props().lynxChecklist.message).toContain("confirmed by Hub");
  });

  it("keeps debugTabId as an explicit live-browser override", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html?debugTabId=123");
    const render = createReactRenderProbe();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn();
    const tabsSendMessage = makeTabsSendMessage(() => ({ ok: true, initialized: true, tree: "rewrite" }));
    const runtime = makeRuntime((message) => replyFrame(message, []));
    globalThis.chrome = {
      runtime: {
        ...runtime,
      },
      tabs: {
        query,
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();

    expect(query).not.toHaveBeenCalled();
    expect(tabsSendMessage).toHaveBeenCalledWith(123, contentCommand("activateContentMain", {
      baseUrl: "https://example.com",
      pageUrl: "",
      realEditorActivation: true,
    }));
  });
});
