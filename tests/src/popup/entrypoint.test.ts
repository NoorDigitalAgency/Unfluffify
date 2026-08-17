import { afterEach, describe, expect, it, vi } from "vitest";
import { createRewriteBrain } from "../../../src/background/rewrite-brain";
import type { BusFrame } from "../../../src/messaging/contract";
import type { BrainSensation } from "../../../src/background/brain/fold";
import type { ConfigSnapshot } from "../../../src/storage/config";

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

function installEntrypointDom(href: string): void {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: { dataset: {}, style: {} },
      getElementById: vi.fn(() => ({ id: "root" })),
      body: {
        appendChild: vi.fn(() => ({ id: "root" })),
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

/** Establishing the render mode is two acts, as legacy had it: pick, then
 *  confirm. Tests that only need a mode in force before doing something else say
 *  so through this rather than repeating both calls. */
function confirmRenderMode(
  render: { mock: { calls: { at(index: number): [{ props: Record<string, (value?: unknown) => void> }] | undefined } } },
  mode: "rendered" | "static" = "rendered",
): void {
  const props = () => render.mock.calls.at(-1)?.[0].props;
  props()?.onRenderModePick(mode);
  props()?.onRenderModeCommit();
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
      const data = await handler(tabId, { type: command.name, ...(command.payload ?? {}) });
      return contentReplyFrame(frame, data);
    }
    return await handler(tabId, message as { type?: string } & Record<string, unknown>);
  });
}

function makeRuntime(
  handler: (frame: BusFrame) => Promise<unknown> | unknown,
  renderMode: "rendered" | "static" = "rendered",
) {
  const factBrain = createRewriteBrain(77);
  const factSignals: Array<ReturnType<typeof factBrain.observe>[number]> = [];
  let deliveredSignalSeq = 0;

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
        if (sensation) {
          factSignals.push(...factBrain.observe(sensation).filter((signal) => b2SignalNames.has(signal.name)));
        }
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
        return replyFrame(frame, {
          mode: "mobile",
          width: 412,
          height: 960,
          scale: 1,
          active: true,
        });
      }
      if (frame.name === "emulation.clear") {
        return replyFrame(frame, { status: "ok" });
      }
      if (frame.name === "offscreen.refineXpaths") {
        const payload = frame.payload as { rows?: unknown };
        return replyFrame(frame, { rows: Array.isArray(payload.rows) ? payload.rows : [] });
      }
      if (frame.name === "config.load") {
        return replyFrame(frame, {
          status: "ok",
          config: { ...backendConfig(), renderMode },
          renderMode,
          renderModeSource: "backend",
        });
      }
      return await handler(frame);
    }),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}

describe("rewrite popup entrypoint", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Reflect.deleteProperty(globalThis, "chrome");
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
    Reflect.deleteProperty(globalThis, "window");
  });

  it("keeps the tab in mobile simulation from the moment it is bound", async () => {
    // Mobile is the standing posture, not something marking switches on: the
    // crawler reads the mobile render, so that is the render every decision has to
    // be made against. Before, emulation only arrived with an armed session.
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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

  it("routes lock banner actions through the background-owned transfer path", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    const render = vi.fn();
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
    const render = vi.fn();
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
    confirmRenderMode(render);
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
  });

  it("does not adopt a render mode until the operator confirms it", async () => {
    // Picking edits a pending value; only the CTA decides. Otherwise a stray
    // click relabels every later capture, and there is no way to look at both
    // loads before committing.
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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

  it("asks before discarding markings and keeps them when the operator declines", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    // The operator says no to the discard prompt.
    (globalThis.window as unknown as { confirm: () => boolean }).confirm = vi.fn(() => false);
    const render = vi.fn();
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
    confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();

    const commandsBefore = tabsSendMessage.mock.calls
      .map(([, m]) => (m as { payload?: { name?: string } }).payload?.name);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(false);
    await flushEntrypointWork();
    const commandsAfter = tabsSendMessage.mock.calls
      .map(([, m]) => (m as { payload?: { name?: string } }).payload?.name);

    expect((globalThis.window as unknown as { confirm: ReturnType<typeof vi.fn> }).confirm).toHaveBeenCalled();
    // Declining must not deactivate, because deactivating is the wipe.
    expect(commandsAfter.filter((name) => name === "deactivateContentMain"))
      .toEqual(commandsBefore.filter((name) => name === "deactivateContentMain"));
  });

  it("binds production popup toggles to the active tab and clears content on disable", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    expect(globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState().stateName).toBe("pre_ai_dirty");
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
    expect(globalThis.window.__UNFLUFFIFY_POPUP_DEBUG__.getViewState().buttons.compute).toEqual({
      disabled: false,
      blockedReason: "",
    });
    render.mock.calls.at(-1)?.[0].props.onDiscard();
    await flushEntrypointWork();
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
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("resetContentMain", {}));
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
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
    // Disabling comes last: the reset happens while marking is still armed.
    expect(sentCommandNames.lastIndexOf("resetContentMain"))
      .toBeLessThan(tabsSendMessage.mock.calls
        .map(([, m]) => (m as { payload?: { name?: string } }).payload?.name)
        .lastIndexOf("deactivateContentMain"));
  });

  it("fetches static source HTML before running AI, previewing, and saving", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
    const snapshot = {
      baseUrl: "https://example.com",
      renderMode: "static",
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"],
      pages: [{
        url: "https://example.com/page",
        renderedHtml: "<html></html>",
        rawHtml: "<html><body>server source</body></html>",
        renderedXPaths: [{ xpath: "/html[1]/body[1]/main[1]", excluded: false }],
      }],
    };
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot, rows: [{ xpath: "/html[1]/body[1]/main[1]", classification: "included" }] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    const runtime = makeRuntime(async (message) => {
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
          html: "<html><body>server source</body></html>",
        });
      }
      if (message.name === "config.save") {
        return replyFrame(message, { status: "ok", config: backendConfig() });
      }
      return replyFrame(message, []);
    }, "static");
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
    confirmRenderMode(render, "static");
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("captureSubmissionSnapshot", {
      baseUrl: "https://example.com",
      renderMode: "static",
      pageUrl: "https://example.com/page",
      rawHtml: "<html><body>server source</body></html>",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "staticHtml.fetch",
      payload: { url: "https://example.com/page" },
      target: "background",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "ai.run",
      payload: expect.objectContaining({
        tabId: 77,
        siteId: 1,
        pageKey: "/page",
        clientRunId: expect.any(String),
        snapshot,
      }),
      target: "background",
    }));
    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(false);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.selectors).toEqual({
      inclusionSelectors: ["main"],
      exclusionSelectors: [".ad"],
    });
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("markContentMainClean", {}));

    render.mock.calls.at(-1)?.[0].props.onPreview();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.presentation.temporarilyDisabledOverlay).toBe(true);

    const previewDraft = {
      selectors: render.mock.calls.at(-1)?.[0].props.presentation.selectors,
      contentRows: render.mock.calls.at(-1)?.[0].props.presentation.contentRows,
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
          facts: expect.objectContaining({ previewExitRequested: true }),
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

    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();
    expect(runtime.sendMessage.mock.calls
      .map(([frame]) => frame)
      .filter((frame) => frame.name === "lock.directive")
      .every((frame) => !("hasUnsavedChanges" in frame.payload))).toBe(true);
    expect(tabsSendMessage).toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
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

  it("surfaces a background-completed AI run when the side panel opens again", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
      payload: { tabId: 77, siteId: 1, pageKey: "/page" },
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
    const render = vi.fn();
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
    const tabsSendMessage = makeTabsSendMessage(async (_tabId: number, message) => {
      if (message.type === "captureSubmissionSnapshot") {
        return { ok: true, snapshot: query.mock.calls.length > 1 ? snapshotB : snapshotA, rows: [] };
      }
      return { ok: true, initialized: true, tree: "rewrite" };
    });
    let signalSeq = 0;
    let activeUrl = "https://example.com/a";
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
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    query.mockResolvedValue([{ id: 77, url: "https://example.com/b" }]);
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
    const render = vi.fn();
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
    confirmRenderMode(render);
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
  });

  it("does not let session.saved skip an intervening dirty signal", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onSave();
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
    expect(tabsSendMessage).not.toHaveBeenCalledWith(77, contentCommand("deactivateContentMain", {}));
  });

  it("does not enable Save when markings change during AI snapshot capture", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi();
    await flushEntrypointWork();

    expect(render.mock.calls.at(-1)?.[0].props.presentation.saveDisabled).toBe(true);
    expect(render.mock.calls.at(-1)?.[0].props.presentation.discardDisabled).toBe(false);
  });

  it("does not treat already-pending dirty signals as edits during the AI run", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    confirmRenderMode(render);
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
    const render = vi.fn();
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
    confirmRenderMode(render);
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
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/page" }]);
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
        await runtime.sendMessage(contentPreviewExitedFrame(false, "content-silent-preview-exited"));
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
      runSelectors: { inclusionSelectors: ["main"], exclusionSelectors: [".ad"] },
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
    render.mock.calls.at(-1)?.[0].props.onPreview();
    await flushEntrypointWork();

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

    render.mock.calls.at(-1)?.[0].props.onExitPreview();
    await flushEntrypointWork();
    expect(render.mock.calls.at(-1)?.[0].props.diagnostics.stateName).toBe("silent");
    expect(render.mock.calls.at(-1)?.[0].props.presentation.enableToggleChecked).toBe(false);
  });

  it("drains pending dirty signals and aborts stale Preview", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();
    render.mock.calls.at(-1)?.[0].props.onRunAi?.();
    await flushEntrypointWork();
    dirtyReady = true;
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
    const render = vi.fn();
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
    confirmRenderMode(render);
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
    const render = vi.fn();
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
    const render = vi.fn();
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

  it("does not call a seeded session dirty, however many rows it has", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    expect(props.presentation.contentRows).toHaveLength(300);
    expect(props.presentation.discardDisabled).toBe(true);
  });

  it("deactivates content and emits navigation when the bound tab URL changes", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
    vi.doMock("react-dom/client", () => ({
      createRoot: vi.fn(() => ({ render })),
    }));
    const query = vi.fn().mockResolvedValue([{ id: 77, url: "https://example.com/a" }]);
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
        sendMessage: tabsSendMessage,
      },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    await flushEntrypointWork();
    query.mockResolvedValue([{ id: 77, url: "https://example.com/b" }]);
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
  });

  it("retries a publication-unknown outcome with the exact same fenced Hub operation", async () => {
    installEntrypointDom("chrome-extension://extension-id/popup.html");
    const render = vi.fn();
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
    });
    globalThis.chrome = {
      runtime: { ...runtime },
      tabs: { query, sendMessage: tabsSendMessage, update: vi.fn() },
    } as unknown as typeof chrome;

    await import("../../../src/entrypoints/popup/main.tsx");
    const props = () => render.mock.calls.at(-1)?.[0].props;
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
    const render = vi.fn();
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
    confirmRenderMode(render);
    render.mock.calls.at(-1)?.[0].props.onEnableChange(true);
    await flushEntrypointWork();

    expect(query).not.toHaveBeenCalled();
    expect(tabsSendMessage).toHaveBeenCalledWith(123, contentCommand("activateContentMain", {
      pageUrl: "",
      realEditorActivation: true,
    }));
  });
});
