import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewProjectionSchema, type PreviewProjection } from "../src/domain/schema/preview";
import type { BusFrame } from "../src/messaging/contract";

const REPO_ROOT = resolve(import.meta.dirname, "..");
let commandSeq = 0;

const shieldHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    setActive: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    extensionSurfaces: () => HTMLElement[];
  }>,
  create: vi.fn(),
}));

const inspectionCurtainHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    adopt: ReturnType<typeof vi.fn>;
    clearMatching: ReturnType<typeof vi.fn>;
    failOpenMatching: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    current: ReturnType<typeof vi.fn>;
    element: ReturnType<typeof vi.fn>;
    paint: (session: unknown) => void;
    fail: (session: unknown, reason: string) => void;
  }>,
  create: vi.fn(),
}));

vi.mock("../src/content/interaction-shield", () => {
  shieldHarness.create.mockImplementation((options: { extensionSurfaces?: () => HTMLElement[] }) => {
    const reasons = new Set<string>();
    const instance = {
      activate: vi.fn((reason: string) => {
        const added = !reasons.has(reason);
        reasons.add(reason);
        return added;
      }),
      deactivate: vi.fn((reason: string) => reasons.delete(reason)),
      setActive: vi.fn((reason: string, active: boolean) => {
        if (active) {
          const added = !reasons.has(reason);
          reasons.add(reason);
          return added;
        }
        return reasons.delete(reason);
      }),
      isActive: vi.fn(() => reasons.size > 0),
      reasons: vi.fn(() => [...reasons]),
      element: vi.fn(() => null),
      registerExtensionSurface: vi.fn(() => vi.fn()),
      refresh: vi.fn(),
      dispose: vi.fn(() => reasons.clear()),
      extensionSurfaces: options.extensionSurfaces ?? (() => []),
    };
    shieldHarness.instances.push(instance);
    return instance;
  });
  return {
    createInteractionShield: shieldHarness.create,
    MAXIMUM_DOCUMENT_Z_INDEX: "2147483647",
  };
});

vi.mock("../src/content/render-inspection-curtain", () => {
  inspectionCurtainHarness.create.mockImplementation((options: {
    onPaintReady: (session: unknown) => void;
    onFailure?: (session: unknown, reason: string) => void;
    onSurfaceChanged?: () => void;
  }) => {
    let active: Record<string, unknown> | null = null;
    let terminated = false;
    const root = { marker: "render-inspection-curtain" };
    const matches = (identity: Record<string, unknown>): boolean => active !== null &&
      active.token === identity.token &&
      active.generation === identity.generation &&
      active.documentNonce === identity.documentNonce;
    const clear = vi.fn((identity: Record<string, unknown>) => {
      if (!matches(identity)) {
        return false;
      }
      active = null;
      options.onSurfaceChanged?.();
      return true;
    });
    const instance = {
      adopt: vi.fn((session: Record<string, unknown>) => {
        if (terminated) {
          return false;
        }
        active = session;
        options.onSurfaceChanged?.();
        return true;
      }),
      clearMatching: clear,
      failOpenMatching: vi.fn((identity: Record<string, unknown>) => clear(identity)),
      terminate: vi.fn(() => {
        active = null;
        options.onSurfaceChanged?.();
        terminated = true;
      }),
      refresh: vi.fn(),
      current: vi.fn(() => active),
      element: vi.fn(() => active ? root : null),
      paint: options.onPaintReady,
      fail: options.onFailure ?? (() => undefined),
    };
    inspectionCurtainHarness.instances.push(instance);
    return instance;
  });
  return { createRenderInspectionCurtain: inspectionCurtainHarness.create };
});

type TestListenerRegistry = Map<string, Set<EventListener>>;

function addTestListener(registry: TestListenerRegistry, type: string, listener: EventListener): void {
  const listeners = registry.get(type) ?? new Set<EventListener>();
  listeners.add(listener);
  registry.set(type, listeners);
}

function removeTestListener(registry: TestListenerRegistry, type: string, listener: EventListener): void {
  const listeners = registry.get(type);
  listeners?.delete(listener);
  if (listeners?.size === 0) {
    registry.delete(type);
  }
}

function dispatchTestEvent(registry: TestListenerRegistry, type: string, event: Event): void {
  for (const listener of [...(registry.get(type) ?? [])]) {
    listener(event);
  }
}

function mockFastRevealVisit(): void {
  vi.doMock("../src/content/stabilization", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/content/stabilization")>();
    return {
      ...actual,
      async runReveal(input: {
        suppressLazyLoading: () => Promise<void>;
        freezeAtBottom: () => Promise<void>;
      }) {
        await input.suppressLazyLoading();
        await input.freezeAtBottom();
        return { skipped: false, lazyExpansions: 0, frozenAtBottom: true };
      },
      createRevealVisitController: () => ({
        resetForNavigation: vi.fn(),
        async runTask(task: () => Promise<{ skipped: boolean; lazyExpansions: number; frozenAtBottom: boolean }>) {
          return task();
        },
        async run(input: {
          suppressLazyLoading: () => Promise<void>;
          freezeAtBottom: () => Promise<void>;
        }) {
          await input.suppressLazyLoading();
          await input.freezeAtBottom();
          return { skipped: false, lazyExpansions: 0, frozenAtBottom: true };
        },
      }),
    };
  });
}

function commandFrame(name: string, payload: Record<string, unknown> = {}, tabId = 77): BusFrame {
  commandSeq += 1;
  return {
    kind: "uf-bus/1",
    frameType: "request",
    id: `test-${name}-${Math.random()}`,
    seq: commandSeq,
    name: "command.dispatch",
    source: "popup",
    sourceInstance: "popup:test",
    target: "content",
    payload: {
      kind: "uf-command/1",
      name,
      tabId,
      payload,
    },
  };
}

function typedCommandFrame(name: string, payload: unknown): BusFrame {
  commandSeq += 1;
  return {
    kind: "uf-bus/1",
    frameType: "request",
    id: `test-${name}-${Math.random()}`,
    seq: commandSeq,
    name,
    source: "popup",
    sourceInstance: "popup:test",
    target: "content",
    payload,
  };
}

function replyFrame(request: BusFrame, payload: unknown): BusFrame {
  return {
    kind: "uf-bus/1",
    frameType: "reply",
    id: request.id,
    seq: request.seq,
    name: request.name,
    source: request.target === "broadcast" ? request.source : request.target,
    target: request.source,
    payload,
    ok: true,
  };
}

async function dispatchContentCommand(
  listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown,
  name: string,
  payload: Record<string, unknown> = {},
) {
  const pageBound = name === "activateContentMain" ||
    name === "captureSubmissionSnapshot" ||
    name === "resetContentMain" ||
    name === "enterSilentContentMain" ||
    name === "applySilentSelectors";
  const routedPayload = pageBound && typeof payload.pageUrl !== "string"
    ? { ...payload, pageUrl: location.href }
    : payload;
  const response = vi.fn();
  expect(listener(commandFrame(name, routedPayload), {}, response)).toBe(true);
  for (let index = 0; index < 20 && response.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const reply = response.mock.calls.at(-1)?.[0] as BusFrame;
  expect(reply).toMatchObject({ frameType: "reply", ok: true });
  return reply.payload as { ok: boolean; data?: unknown; failure?: unknown };
}

async function dispatchTypedContentCommand(
  listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown,
  name: string,
  payload: unknown,
): Promise<BusFrame> {
  const request = typedCommandFrame(name, payload);
  const response = vi.fn();
  expect(listener(request, {}, response)).toBe(true);
  for (let index = 0; index < 20 && response.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const reply = response.mock.calls.at(-1)?.[0] as BusFrame;
  expect(reply).toMatchObject({
    frameType: "reply",
    id: request.id,
    name,
  });
  return reply;
}

async function applyLockState(
  listener: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown,
  patch: Record<string, unknown> = {},
) {
  const banner = patch.banner && typeof patch.banner === "object" ? patch.banner : {};
  return await dispatchContentCommand(listener, "lock.state.changed", {
    baseUrl: "https://example.com",
    configPresent: true,
    lockRole: "editor",
    canEdit: true,
    blockedReason: "editor",
    ...patch,
    banner: { visible: false, reason: "editor", ...banner },
  });
}

function installTestLocation(pageUrl = "https://example.com/page"): { href: string } {
  const locationValue = { href: pageUrl };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: locationValue,
  });
  return locationValue;
}

function managedPageContextReply(request: BusFrame, pageUrl: string): BusFrame {
  const url = new URL(pageUrl);
  const baseUrl = url.origin;
  const environmentKey = url.hostname;
  return replyFrame(request, {
    status: "managed_non_candidate",
    generation: 1,
    observedUrl: pageUrl,
    draftDisposition: "preserve",
    environmentKey,
    siteId: 1,
    baseUrl,
    pageKey: url.pathname,
    pageTypes: [],
    membershipFingerprint: "membership",
    assignmentFingerprint: "assignment",
    conflicts: [],
    upstreamCode: null,
    consentSuppressionAllowed: true,
    renderModeSet: false,
    todo: { covered: 0, actionable: 0, pageTypes: [] },
    shieldPosture: {
      status: "inactive",
      revision: 1,
      scope: {
        environmentKey,
        siteId: 1,
        baseUrl,
        contextGeneration: 1,
        pageUrl,
        documentKey: `test-document:${pageUrl}`,
      },
    },
  });
}

function adoptedInspectionSession(
  pageUrl: string,
  documentNonce: string,
  generation = 1,
  token = `inspection-${generation}`,
) {
  return {
    token,
    generation,
    phase: "adopted" as const,
    property: {
      environmentKey: "example.com",
      siteId: 1,
      baseUrl: "https://example.com",
    },
    pageUrl,
    javascriptEnabled: true,
    documentId: `document-${generation}`,
    documentNonce,
    startedAt: 1,
    updatedAt: 2,
    deadlineAt: Date.now() + 30_000,
    terminalReason: null,
  };
}

function installMinimalContentDom() {
  type Surface = {
    id: string;
    style: Record<string, string>;
    children: Surface[];
    attributes: Record<string, string>;
    textContent: string;
    title: string;
    isConnected: boolean;
    setAttribute: (name: string, value: string) => void;
    appendChild: (child: Surface) => Surface;
    replaceChildren: (...children: Surface[]) => void;
    remove: () => void;
    addEventListener: () => void;
  };
  const elements: Surface[] = [];
  const createElement = (): Surface => {
    const element: Surface = {
      id: "",
      style: {},
      children: [],
      attributes: {},
      textContent: "",
      title: "",
      isConnected: false,
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      appendChild(child) {
        child.isConnected = true;
        this.children.push(child);
        return child;
      },
      replaceChildren(...children) {
        this.children = children;
        for (const child of children) {
          child.isConnected = true;
        }
      },
      remove() {
        this.isConnected = false;
      },
      addEventListener: vi.fn(),
    };
    elements.push(element);
    return element;
  };
  const documentElement = createElement();
  documentElement.isConnected = true;
  Object.assign(documentElement, { className: "", nodeType: 1, tagName: "HTML" });
  const documentListeners: TestListenerRegistry = new Map();
  const windowListeners: TestListenerRegistry = new Map();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      readyState: "complete",
      visibilityState: "visible",
      documentElement,
      body: { nodeType: 1, scrollHeight: 0, offsetHeight: 0 },
      createElement,
      getElementById: (id: string) => elements.find((element) => element.id === id && element.isConnected) ?? null,
      querySelectorAll: () => [],
      addEventListener: (type: string, listener: EventListener) => addTestListener(documentListeners, type, listener),
      removeEventListener: (type: string, listener: EventListener) => removeTestListener(documentListeners, type, listener),
    },
  });
  const windowObject = {
    innerHeight: 800,
    scrollY: 0,
    addEventListener: (type: string, listener: EventListener) => addTestListener(windowListeners, type, listener),
    removeEventListener: (type: string, listener: EventListener) => removeTestListener(windowListeners, type, listener),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout,
    clearTimeout,
    postMessage: vi.fn(),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowObject,
  });
  return { documentElement, documentListeners, elements, windowListeners, windowObject };
}

describe("C4 rewrite content entrypoints", () => {
  afterEach(() => {
    vi.doUnmock("../src/content/stabilization");
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    shieldHarness.instances.splice(0);
    inspectionCurtainHarness.instances.splice(0);
    delete globalThis.chrome;
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "location");
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "MutationObserver");
  });

  it("registers the rewrite activation bridge without loading legacy content-main", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation();
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage: vi.fn(async (message: BusFrame) => message.name === "page.context"
          ? managedPageContextReply(message, pageUrl.href)
          : undefined),
      },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as {
      matches: string[];
      runAt: string;
      main: () => void;
    };

    expect(contentScript.matches).toEqual(["<all_urls>"]);
    expect(contentScript.runAt).toBe("document_start");
    contentScript.main();
    expect(addListener).toHaveBeenCalledTimes(1);

    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    await applyLockState(listener);
    const response = await dispatchContentCommand(listener, "activateContentMain");
    expect(response).toEqual({ ok: true, data: { ok: true, initialized: true, tree: "rewrite" } });
  });

  it("registers typed preview rows and retires their hover and bridge across exit and A-to-B navigation", async () => {
    const pageUrl = "https://example.com/page";
    const nextPageUrl = "https://example.com/next";
    const addListener = vi.fn();
    const locationValue = installTestLocation(pageUrl);
    const { windowListeners } = installMinimalContentDom();

    const projection = {
      projectionId: "projection-p17",
      revision: 7,
      pageUrl,
      rows: [
        {
          id: "row-explicit",
          classification: "explicit-included",
          text: "Explicit",
          xpath: "/html[1]/body[1]/x-force-open[1]",
          selector: ".p17-explicit",
          shadow: "force-open-closed",
        },
        {
          id: "row-implicit",
          classification: "implicit-included",
          text: "Implicit",
          xpath: "/html[1]/body[1]/x-force-open[1]/p[1]",
          selector: ".p17-explicit",
          shadow: "force-open-closed",
        },
        {
          id: "row-excluded",
          classification: "excluded",
          text: "Excluded",
          xpath: "/html[1]/body[1]/nav[1]",
          selector: ".p17-excluded",
          shadow: "light",
        },
        {
          id: "row-undetected",
          classification: "undetected",
          text: "Undetected",
          xpath: "/html[1]/body[1]/main[1]",
          shadow: "light",
        },
        {
          id: "row-immutable",
          classification: "immutable",
          text: "Immutable image",
          xpath: "/html[1]/body[1]/img[1]",
          shadow: "light",
        },
        {
          id: "row-closed-shadow",
          classification: "closed-shadow",
          text: "Closed component",
          xpath: "/html[1]/body[1]/x-closed[1]",
          shadow: "inaccessible-closed",
        },
      ],
    } as const satisfies PreviewProjection;
    const reopenedProjection: PreviewProjection = {
      ...projection,
      projectionId: "projection-p17-cycle-2",
      revision: 8,
    };
    const nextProjection: PreviewProjection = {
      ...projection,
      projectionId: "projection-p17-next",
      revision: 1,
      pageUrl: nextPageUrl,
      rows: projection.rows.map((row) => ({ ...row, id: `next-${row.id}` })),
    };
    let activeProjection: PreviewProjection = projection;
    const targetExists = (projectionId: string, rowId: string): boolean =>
      projectionId === activeProjection.projectionId && activeProjection.rows.some((row) => row.id === rowId);
    const clearHover = vi.fn();
    const engine = {
      projectPreview: vi.fn(() => activeProjection),
      retirePreviewProjection: vi.fn(() => {
        activeProjection = reopenedProjection;
        clearHover();
      }),
      emphasizePreviewRow: vi.fn((projectionId: string, rowId: string) => targetExists(projectionId, rowId)),
      activatePreviewRow: vi.fn((projectionId: string, rowId: string) => targetExists(projectionId, rowId)),
      rows: vi.fn(() => []),
      clearHover,
      setSuspended: vi.fn(),
      setInputTransparent: vi.fn(),
      dispose: vi.fn(),
    };
    const nextEngine = {
      projectPreview: vi.fn(() => nextProjection),
      retirePreviewProjection: vi.fn(),
      emphasizePreviewRow: vi.fn(() => false),
      activatePreviewRow: vi.fn(() => false),
      rows: vi.fn(() => []),
      clearHover: vi.fn(),
      setSuspended: vi.fn(),
      setInputTransparent: vi.fn(),
      dispose: vi.fn(),
    };
    const createMarkingEngine = vi.fn()
      .mockReturnValueOnce(engine)
      .mockReturnValueOnce(nextEngine);
    let pendingSignals: Array<Record<string, unknown>> = [];
    const previewSignals: Array<Record<string, unknown>> = [
      {
        kind: "uf-signal/1",
        tabId: 77,
        seq: 1,
        name: "marking.disabled",
        source: "brain",
        cause: "test",
        at: 1,
        payload: {},
      },
      {
        kind: "uf-signal/1",
        tabId: 77,
        seq: 2,
        name: "preview.opened",
        source: "brain",
        cause: "test",
        at: 2,
        payload: { origin: "silent" },
      },
    ];
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        const requestedPageUrl = (message.payload as { pageUrl?: string }).pageUrl ?? pageUrl;
        return managedPageContextReply(message, requestedPageUrl);
      }
      if (message.name === "signals.pull") {
        const signals = pendingSignals;
        pendingSignals = [];
        return replyFrame(message, signals);
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({ createMarkingEngine }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown;

    // First establish the document's managed property authority. Then publish
    // the preview signals and use the ordinary lock-state edge to request the
    // next signal batch, matching the production startup/reconciliation path.
    await applyLockState(listener);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (sendMessage.mock.calls.some(([frame]) => (frame as BusFrame).name === "page.context")) {
        break;
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    pendingSignals = previewSignals;
    await applyLockState(listener);

    let stateName = "";
    for (let attempt = 0; attempt < 20 && stateName !== "silent_preview"; attempt += 1) {
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      stateName = (status.data as { sessionState?: { name?: string } })?.sessionState?.name ?? "";
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(stateName).toBe("silent_preview");

    const selectors = {
      inclusionSelectors: [".p17-explicit"],
      exclusionSelectors: [".p17-excluded"],
    };
    const projected = await dispatchTypedContentCommand(listener, "preview.project", { pageUrl, selectors });
    expect(projected.ok).toBe(true);
    expect(PreviewProjectionSchema.parse(projected.payload)).toEqual(projection);
    expect(projection.rows.map((row) => row.classification)).toEqual([
      "explicit-included",
      "implicit-included",
      "excluded",
      "undetected",
      "immutable",
      "closed-shadow",
    ]);
    expect(engine.projectPreview).toHaveBeenCalledWith(pageUrl, selectors);

    const emphasis = await dispatchTypedContentCommand(listener, "preview.emphasize", {
      pageUrl,
      projectionId: projection.projectionId,
      rowId: "row-implicit",
      active: true,
    });
    expect(emphasis).toMatchObject({ ok: true, payload: { targeted: true } });
    expect(engine.emphasizePreviewRow).toHaveBeenLastCalledWith(
      projection.projectionId,
      "row-implicit",
      true,
    );

    const activation = await dispatchTypedContentCommand(listener, "preview.activate", {
      pageUrl,
      projectionId: projection.projectionId,
      rowId: "row-immutable",
    });
    expect(activation).toMatchObject({ ok: true, payload: { targeted: true } });
    expect(engine.activatePreviewRow).toHaveBeenLastCalledWith(
      projection.projectionId,
      "row-immutable",
    );

    const staleProjection = await dispatchTypedContentCommand(listener, "preview.emphasize", {
      pageUrl,
      projectionId: "projection-stale",
      rowId: "row-implicit",
      active: true,
    });
    expect(staleProjection).toMatchObject({ ok: true, payload: { targeted: false } });
    expect(engine.emphasizePreviewRow).toHaveBeenLastCalledWith(
      "projection-stale",
      "row-implicit",
      true,
    );

    const unknownRow = await dispatchTypedContentCommand(listener, "preview.activate", {
      pageUrl,
      projectionId: projection.projectionId,
      rowId: "row-unknown",
    });
    expect(unknownRow).toMatchObject({ ok: true, payload: { targeted: false } });
    expect(engine.activatePreviewRow).toHaveBeenLastCalledWith(
      projection.projectionId,
      "row-unknown",
    );

    const emphasisCallsBeforeWrongPage = engine.emphasizePreviewRow.mock.calls.length;
    const wrongPageTarget = await dispatchTypedContentCommand(listener, "preview.emphasize", {
      pageUrl: "https://example.com/stale",
      projectionId: projection.projectionId,
      rowId: "row-implicit",
      active: true,
    });
    expect(wrongPageTarget).toMatchObject({ ok: true, payload: { targeted: false } });
    expect(engine.emphasizePreviewRow).toHaveBeenCalledTimes(emphasisCallsBeforeWrongPage);

    const projectCallsBeforeWrongPage = engine.projectPreview.mock.calls.length;
    const wrongPageProjection = await dispatchTypedContentCommand(listener, "preview.project", {
      pageUrl: "https://example.com/stale",
      selectors,
    });
    expect(wrongPageProjection).toMatchObject({
      ok: false,
      failure: { code: "HANDLER_FAILED" },
    });
    expect(engine.projectPreview).toHaveBeenCalledTimes(projectCallsBeforeWrongPage);

    pendingSignals = [{
      kind: "uf-signal/1",
      tabId: 77,
      seq: 3,
      name: "preview.exit.requested",
      source: "brain",
      cause: "test",
      at: 3,
      payload: { restore: true },
    }];
    await applyLockState(listener);
    let exitState = "";
    for (let attempt = 0; attempt < 20 && exitState !== "exit_restoring"; attempt += 1) {
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      expect(status.ok, JSON.stringify(status)).toBe(true);
      exitState = (status.data as { sessionState?: { name?: string } })?.sessionState?.name ?? "";
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(exitState).toBe("exit_restoring");
    expect(engine.retirePreviewProjection).toHaveBeenCalledTimes(1);
    expect(engine.clearHover).toHaveBeenCalledTimes(1);
    const hoverClearedAt = engine.clearHover.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;

    pendingSignals = [{
      kind: "uf-signal/1",
      tabId: 77,
      seq: 4,
      name: "preview.exited",
      source: "brain",
      cause: "test",
      at: 4,
      payload: { restored: true },
    }];
    await applyLockState(listener);
    let restoredState = "";
    for (let attempt = 0; attempt < 20 && restoredState !== "silent"; attempt += 1) {
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      restoredState = (status.data as { sessionState?: { name?: string } })?.sessionState?.name ?? "";
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(restoredState).toBe("silent");
    const interactionsResumedAt = engine.setSuspended.mock.invocationCallOrder.find((order, index) =>
      engine.setSuspended.mock.calls[index]?.[0] === false && order > hoverClearedAt
    ) ?? 0;
    expect(hoverClearedAt).toBeLessThan(interactionsResumedAt);

    pendingSignals = [{
      kind: "uf-signal/1",
      tabId: 77,
      seq: 5,
      name: "preview.opened",
      source: "brain",
      cause: "test",
      at: 5,
      payload: { origin: "silent" },
    }];
    await applyLockState(listener);
    let reopenedState = "";
    for (let attempt = 0; attempt < 20 && reopenedState !== "silent_preview"; attempt += 1) {
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      reopenedState = (status.data as { sessionState?: { name?: string } })?.sessionState?.name ?? "";
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(reopenedState).toBe("silent_preview");

    const cycleTwoProjected = await dispatchTypedContentCommand(listener, "preview.project", {
      pageUrl,
      selectors,
    });
    expect(cycleTwoProjected).toMatchObject({ ok: true, payload: reopenedProjection });
    expect(reopenedProjection.projectionId).not.toBe(projection.projectionId);
    expect(reopenedProjection.rows.map((row) => row.id)).toEqual(projection.rows.map((row) => row.id));
    expect(createMarkingEngine).toHaveBeenCalledTimes(1);

    const delayedCycleOneEmphasis = await dispatchTypedContentCommand(listener, "preview.emphasize", {
      pageUrl,
      projectionId: projection.projectionId,
      rowId: "row-implicit",
      active: true,
    });
    const delayedCycleOneActivation = await dispatchTypedContentCommand(listener, "preview.activate", {
      pageUrl,
      projectionId: projection.projectionId,
      rowId: "row-implicit",
    });
    expect(delayedCycleOneEmphasis).toMatchObject({ ok: true, payload: { targeted: false } });
    expect(delayedCycleOneActivation).toMatchObject({ ok: true, payload: { targeted: false } });

    const cycleTwoEmphasis = await dispatchTypedContentCommand(listener, "preview.emphasize", {
      pageUrl,
      projectionId: reopenedProjection.projectionId,
      rowId: "row-implicit",
      active: true,
    });
    const cycleTwoActivation = await dispatchTypedContentCommand(listener, "preview.activate", {
      pageUrl,
      projectionId: reopenedProjection.projectionId,
      rowId: "row-implicit",
    });
    expect(cycleTwoEmphasis).toMatchObject({ ok: true, payload: { targeted: true } });
    expect(cycleTwoActivation).toMatchObject({ ok: true, payload: { targeted: true } });

    // The URL watcher is synchronous: an immediate B projection must construct
    // a new engine/bridge rather than retagging the projection from route A.
    locationValue.href = nextPageUrl;
    dispatchTestEvent(windowListeners, "message", {
      source: window,
      data: { kind: "uf-page-url-changed/1", toUrl: nextPageUrl },
    } as unknown as MessageEvent);
    expect(engine.clearHover).toHaveBeenCalledTimes(2);
    expect(engine.dispose).toHaveBeenCalledTimes(1);

    const nextProjected = await dispatchTypedContentCommand(listener, "preview.project", {
      pageUrl: nextPageUrl,
      selectors,
    });
    expect(nextProjected).toMatchObject({ ok: true, payload: nextProjection });
    expect(createMarkingEngine).toHaveBeenCalledTimes(2);
    expect(nextEngine.projectPreview).toHaveBeenCalledWith(nextPageUrl, selectors);
    expect(engine.projectPreview).not.toHaveBeenCalledWith(nextPageUrl, expect.anything());
  });

  it("adopts durable inspection before page context and fences paint completion from generic and stale work", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation("https://example.com/replacement");
    installMinimalContentDom();
    const requestNames: string[] = [];
    let adopted: ReturnType<typeof adoptedInspectionSession> | null = null;
    let firstAck = true;
    let releaseFirstAck: (() => void) | undefined;
    const firstAckGate = new Promise<void>((resolve) => { releaseFirstAck = resolve; });
    const sendMessage = vi.fn(async (message: BusFrame) => {
      requestNames.push(message.name);
      if (message.name === "renderInspection.adopt") {
        const nonce = (message.payload as { documentNonce: string }).documentNonce;
        adopted = adoptedInspectionSession(pageUrl.href, nonce);
        return replyFrame(message, { status: "adopt", session: adopted });
      }
      if (message.name === "page.context") {
        return managedPageContextReply(message, pageUrl.href);
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, [
          {
            kind: "uf-signal/1",
            tabId: 77,
            seq: 1,
            name: "inspection.started",
            source: "brain",
            cause: "legacy-true",
            at: 1,
            payload: { pageUrl: pageUrl.href, active: true },
          },
          {
            kind: "uf-signal/1",
            tabId: 77,
            seq: 2,
            name: "inspection.ended",
            source: "brain",
            cause: "legacy-false",
            at: 2,
            payload: { pageUrl: pageUrl.href, active: false },
          },
        ]);
      }
      if (message.name === "renderInspection.ackPaint") {
        const current = adopted!;
        if (firstAck) {
          firstAck = false;
          await firstAckGate;
        }
        return replyFrame(message, {
          status: "ok",
          session: {
            ...current,
            phase: "terminal",
            updatedAt: 3,
            terminalReason: "paint-acknowledged",
          },
        });
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    for (let attempt = 0; attempt < 30 && !requestNames.includes("signals.pull"); attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(requestNames[0]).toBe("renderInspection.adopt");
    expect(requestNames.indexOf("page.context")).toBeGreaterThan(requestNames.indexOf("renderInspection.adopt"));
    const curtain = inspectionCurtainHarness.instances.at(-1);
    expect(curtain?.adopt).toHaveBeenCalledWith(adopted);
    expect(curtain?.clearMatching).not.toHaveBeenCalled();
    expect(curtain?.failOpenMatching).not.toHaveBeenCalled();
    expect(curtain?.terminate).not.toHaveBeenCalled();
    expect(shieldHarness.instances.at(-1)?.extensionSurfaces()).toContain(curtain?.element());
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("render-inspection", true);

    // The old generation's exact ack starts, then a newer durable generation is
    // adopted before its response. That late response cannot clear generation 2.
    curtain?.paint(adopted);
    for (let attempt = 0; attempt < 20 && !requestNames.includes("renderInspection.ackPaint"); attempt += 1) {
      await Promise.resolve();
    }
    const newer = adoptedInspectionSession(
      pageUrl.href,
      adopted!.documentNonce,
      2,
      "inspection-2",
    );
    curtain?.adopt(newer);
    adopted = newer;
    releaseFirstAck?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(curtain?.current()).toBe(newer);
    expect(curtain?.clearMatching).not.toHaveBeenCalled();

    curtain?.paint(newer);
    for (let attempt = 0; attempt < 20 && curtain?.current() !== null; attempt += 1) {
      await Promise.resolve();
    }
    expect(curtain?.clearMatching).toHaveBeenCalledWith({
      token: "inspection-2",
      generation: 2,
      documentNonce: newer.documentNonce,
    });
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("render-inspection", false);
  });

  it("fails open on pagehide and does not revive a terminal inspection on pageshow", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation("https://example.com/bfcache-terminal");
    const { windowListeners } = installMinimalContentDom();
    let adoptionRequests = 0;
    let adopted: ReturnType<typeof adoptedInspectionSession> | null = null;
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "renderInspection.adopt") {
        adoptionRequests += 1;
        const nonce = (message.payload as { documentNonce: string }).documentNonce;
        adopted ??= adoptedInspectionSession(pageUrl.href, nonce);
        if (adoptionRequests === 1) {
          return replyFrame(message, { status: "adopt", session: adopted });
        }
        return replyFrame(message, {
          status: "terminal",
          session: {
            ...adopted,
            phase: "terminal",
            updatedAt: 3,
            terminalReason: "cancelled",
          },
        });
      }
      if (message.name === "page.context") {
        return managedPageContextReply(message, pageUrl.href);
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: { onMessage: { addListener }, sendMessage },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    for (let attempt = 0; attempt < 20 && inspectionCurtainHarness.instances.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    const curtain = inspectionCurtainHarness.instances.at(-1);
    expect(curtain?.current()).toEqual(adopted);

    dispatchTestEvent(windowListeners, "pagehide", {} as Event);

    expect(curtain?.failOpenMatching).toHaveBeenCalledWith({
      token: adopted!.token,
      generation: adopted!.generation,
      documentNonce: adopted!.documentNonce,
    });
    expect(curtain?.current()).toBeNull();
    expect(shieldHarness.instances.at(-1)?.dispose).toHaveBeenCalledOnce();

    // Queued paint work from the hidden page has lost its local identity and
    // therefore cannot acknowledge after pagehide.
    curtain?.paint(adopted);
    await Promise.resolve();
    expect(sendMessage.mock.calls.some(([frame]) =>
      (frame as BusFrame).name === "renderInspection.ackPaint")).toBe(false);

    dispatchTestEvent(windowListeners, "pageshow", {} as Event);
    for (let attempt = 0; attempt < 20 && adoptionRequests < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect(adoptionRequests).toBe(2);
    expect(curtain?.refresh).not.toHaveBeenCalled();
    expect(curtain?.adopt).toHaveBeenCalledTimes(1);
    expect(curtain?.current()).toBeNull();
  });

  it("waits for fresh same-document authority before re-adopting after BFCache restore", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation("https://example.com/bfcache-active");
    const { windowListeners } = installMinimalContentDom();
    let adoptionRequests = 0;
    let adopted: ReturnType<typeof adoptedInspectionSession> | null = null;
    let releaseRestore: (() => void) | undefined;
    const restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve; });
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "renderInspection.adopt") {
        adoptionRequests += 1;
        const nonce = (message.payload as { documentNonce: string }).documentNonce;
        adopted ??= adoptedInspectionSession(pageUrl.href, nonce);
        if (adoptionRequests > 1) {
          await restoreGate;
        }
        return replyFrame(message, { status: "adopt", session: adopted });
      }
      if (message.name === "page.context") {
        return managedPageContextReply(message, pageUrl.href);
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: { onMessage: { addListener }, sendMessage },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    for (let attempt = 0; attempt < 20 && inspectionCurtainHarness.instances.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    const curtain = inspectionCurtainHarness.instances.at(-1);
    expect(curtain?.current()).toEqual(adopted);

    // The initial (non-BFCache) pageshow must not duplicate document-start
    // adoption; only a pagehide/pageshow restoration pair needs reconciliation.
    dispatchTestEvent(windowListeners, "pageshow", {} as Event);
    await Promise.resolve();
    expect(adoptionRequests).toBe(1);

    dispatchTestEvent(windowListeners, "pagehide", {} as Event);
    dispatchTestEvent(windowListeners, "pageshow", {} as Event);
    for (let attempt = 0; attempt < 20 && adoptionRequests < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect(adoptionRequests).toBe(2);
    expect(curtain?.current()).toBeNull();
    expect(curtain?.refresh).not.toHaveBeenCalled();
    expect(curtain?.adopt).toHaveBeenCalledTimes(1);

    releaseRestore?.();
    for (let attempt = 0; attempt < 20 && curtain?.current() === null; attempt += 1) {
      await Promise.resolve();
    }

    expect(curtain?.adopt).toHaveBeenCalledTimes(2);
    expect(curtain?.current()).toEqual(adopted);
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("render-inspection", true);
  });

  it("does not revive a delayed bootstrap adoption after terminal invalidation", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation("https://example.com/replacement");
    installMinimalContentDom();
    let invalidate: (() => void) | undefined;
    let releaseAdoption: (() => void) | undefined;
    const adoptionGate = new Promise<void>((resolve) => { releaseAdoption = resolve; });
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "renderInspection.adopt") {
        const nonce = (message.payload as { documentNonce: string }).documentNonce;
        await adoptionGate;
        return replyFrame(message, {
          status: "adopt",
          session: adoptedInspectionSession(pageUrl.href, nonce),
        });
      }
      if (message.name === "page.context") {
        return managedPageContextReply(message, pageUrl.href);
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: { onMessage: { addListener }, sendMessage },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as {
      main: (context: { onInvalidated: (handler: () => void) => void }) => void;
    }).main({ onInvalidated: (handler) => { invalidate = handler; } });
    invalidate?.();
    releaseAdoption?.();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }

    expect(inspectionCurtainHarness.create).not.toHaveBeenCalled();
  });

  it("terminal invalidation disposes an already adopted inspection curtain", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation("https://example.com/replacement");
    installMinimalContentDom();
    let invalidate: (() => void) | undefined;
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "renderInspection.adopt") {
        const nonce = (message.payload as { documentNonce: string }).documentNonce;
        return replyFrame(message, {
          status: "adopt",
          session: adoptedInspectionSession(pageUrl.href, nonce),
        });
      }
      if (message.name === "page.context") {
        return managedPageContextReply(message, pageUrl.href);
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: { onMessage: { addListener }, sendMessage },
    } as unknown as typeof chrome;
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as {
      main: (context: { onInvalidated: (handler: () => void) => void }) => void;
    }).main({ onInvalidated: (handler) => { invalidate = handler; } });
    for (let attempt = 0; attempt < 20 && inspectionCurtainHarness.instances.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    const curtain = inspectionCurtainHarness.instances.at(-1);
    expect(curtain?.current()).not.toBeNull();

    invalidate?.();

    expect(curtain?.terminate).toHaveBeenCalledOnce();
    expect(curtain?.current()).toBeNull();
  });

  it("mounts a retained silent shield before the remote page context settles", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation("https://example.com/reloaded");
    let releaseContext: (() => void) | undefined;
    const contextGate = new Promise<void>((resolve) => { releaseContext = resolve; });
    let contextStarted = false;
    const scope = {
      environmentKey: "example.com",
      siteId: 1,
      baseUrl: "https://example.com",
      contextGeneration: 1,
      pageUrl: pageUrl.href,
      documentKey: "document-reloaded",
    };
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "shield.posture.adoptRetained") {
        return replyFrame(message, {
          status: "active",
          revision: 2,
          scope,
          directive: {
            silentSelectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
            organ: { state: "silent" },
          },
        });
      }
      if (message.name === "page.context") {
        contextStarted = true;
        await contextGate;
        return managedPageContextReply(message, pageUrl.href);
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        readyState: "loading",
        documentElement: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    for (let attempt = 0; attempt < 20 && !contextStarted; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(contextStarted).toBe(true);
    expect(shieldHarness.create).toHaveBeenCalledOnce();
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("durable-posture", true);
    expect(sendMessage.mock.calls.map(([frame]) => (frame as BusFrame).name)).toEqual(
      expect.arrayContaining(["shield.posture.adoptRetained", "page.context"]),
    );
    const adoptionIndex = sendMessage.mock.calls.findIndex(
      ([frame]) => (frame as BusFrame).name === "shield.posture.adoptRetained",
    );
    const contextIndex = sendMessage.mock.calls.findIndex(
      ([frame]) => (frame as BusFrame).name === "page.context",
    );
    expect(adoptionIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeGreaterThan(adoptionIndex);

    releaseContext?.();
    await Promise.resolve();
  });

  it("serializes silent application behind the initial document-context bind", async () => {
    const addListener = vi.fn();
    const pageUrl = "https://example.com/jobs/1";
    let resolveInitialContext: (() => void) | undefined;
    const initialContextGate = new Promise<void>((resolve) => {
      resolveInitialContext = resolve;
    });
    let contextRequests = 0;
    let postureSetRequests = 0;
    let postureClearRequests = 0;
    let durableRevision = 1;
    let durableSelectors = { inclusionSelectors: [] as string[], exclusionSelectors: [] as string[] };
    let delayedSetGate: Promise<void> | null = null;
    const scope = {
      environmentKey: "stage.example.com",
      siteId: 42,
      baseUrl: "https://example.com",
      contextGeneration: 1,
      pageUrl,
      documentKey: "document-a",
    };
    const pageContextPayload = (revision: number) => ({
      status: "managed_non_candidate",
      generation: 1,
      observedUrl: pageUrl,
      draftDisposition: "preserve",
      environmentKey: "stage.example.com",
      siteId: 42,
      baseUrl: "https://example.com",
      pageKey: "/jobs/1",
      pageTypes: [],
      membershipFingerprint: "membership",
      assignmentFingerprint: "assignment",
      conflicts: [],
      upstreamCode: null,
      consentSuppressionAllowed: true,
      renderModeSet: false,
      todo: { covered: 0, actionable: 0, pageTypes: [] },
      shieldPosture: { status: "inactive", revision, scope },
    });
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        contextRequests += 1;
        if (contextRequests === 1) {
          await initialContextGate;
        }
        return replyFrame(message, pageContextPayload(contextRequests));
      }
      if (message.name === "consent.suppression.register") {
        return replyFrame(message, { status: "ok" });
      }
      if (message.name === "shield.posture.set") {
        postureSetRequests += 1;
        const request = message.payload as {
          expected: typeof scope & { revision: number };
          posture: { kind: "silent-selectors"; selectors: Record<string, string[]> };
        };
        if (delayedSetGate) {
          await delayedSetGate;
        }
        durableRevision = request.expected.revision + 1;
        durableSelectors = {
          inclusionSelectors: [...request.posture.selectors.inclusionSelectors ?? []],
          exclusionSelectors: [...request.posture.selectors.exclusionSelectors ?? []],
        };
        return replyFrame(message, {
          status: "ok",
          posture: {
            status: "active",
            revision: durableRevision,
            scope,
            directive: {
              silentSelectors: request.posture.selectors,
              organ: { state: "silent" },
            },
          },
        });
      }
      if (message.name === "shield.posture.current") {
        return replyFrame(message, {
          status: "active",
          revision: durableRevision,
          scope,
          directive: {
            silentSelectors: durableSelectors,
            organ: { state: "silent" },
          },
        });
      }
      if (message.name === "shield.posture.clear") {
        postureClearRequests += 1;
        durableRevision += 1;
        return replyFrame(message, {
          status: "ok",
          posture: { status: "inactive", revision: durableRevision, scope },
        });
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { href: pageUrl },
    });
    type ElementLike = {
      id: string;
      isConnected: boolean;
      style: Record<string, string>;
      children: ElementLike[];
      className?: string;
      scrollHeight?: number;
      nodeType?: number;
      tagName?: string;
      setAttribute: (name: string, value: string) => void;
      appendChild: (child: ElementLike) => ElementLike;
      replaceChildren: (...children: ElementLike[]) => void;
      remove: () => void;
    };
    const elements: ElementLike[] = [];
    const createElement = (): ElementLike => {
      const element: ElementLike = {
        id: "",
        isConnected: true,
        style: {},
        children: [],
        setAttribute: vi.fn(),
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        replaceChildren(...children) {
          this.children = children;
        },
        remove() {
          this.isConnected = false;
        },
      };
      elements.push(element);
      return element;
    };
    const documentElement = createElement();
    Object.assign(documentElement, {
      nodeType: 1,
      tagName: "HTML",
      className: "",
      scrollHeight: 500,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        readyState: "complete",
        body: { nodeType: 1 },
        documentElement,
        createElement,
        getElementById: (id: string) => elements.find((element) => element.id === id) ?? null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        innerHeight: 800,
        scrollY: 0,
        scrollTo: vi.fn(),
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const engine = {
      dispose: vi.fn(),
      overlayRoot: vi.fn(() => null),
      rows: vi.fn(() => []),
      lastInitializationSeededSelectors: vi.fn(() => true),
      renderSilentHighlights: vi.fn(() => ["/html[1]/body[1]/main[1]"]),
      setInputTransparent: vi.fn(),
      setSilentDebugAnnotations: vi.fn(),
    };
    const createMarkingEngine = vi.fn(() => engine);
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    let invalidate: (() => void) | undefined;
    (entrypoint.default as {
      main: (ctx: { onInvalidated(callback: () => void): void }) => void;
    }).main({ onInvalidated: (callback) => { invalidate = callback; } });
    for (let attempt = 0; attempt < 20 && contextRequests === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(contextRequests).toBe(1);
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown;
    const selectors = { inclusionSelectors: ["main"], exclusionSelectors: ["nav"] };
    const applying = dispatchContentCommand(listener, "applySilentSelectors", { selectors });
    await Promise.resolve();
    await Promise.resolve();
    expect(createMarkingEngine).not.toHaveBeenCalled();

    resolveInitialContext?.();
    const result = await applying;
    expect(result).toMatchObject({ ok: true, data: { ok: true, highlighted: 1 } });
    for (let attempt = 0; attempt < 20 && postureSetRequests < 1; attempt += 1) {
      await Promise.resolve();
    }
    expect(postureSetRequests).toBe(1);
    expect(contextRequests).toBe(1);
    expect(createMarkingEngine).toHaveBeenCalledTimes(1);
    expect(engine.dispose).not.toHaveBeenCalled();
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("silent-highlights", true);
    const postureNames = sendMessage.mock.calls
      .map(([frame]) => (frame as BusFrame).name)
      .filter((name) => name === "page.context" || name === "shield.posture.set");
    expect(postureNames).toEqual(["page.context", "shield.posture.set"]);

    let releaseDelayedSet: (() => void) | undefined;
    delayedSetGate = new Promise<void>((resolve) => { releaseDelayedSet = resolve; });
    await dispatchContentCommand(listener, "applySilentSelectors", { selectors });
    for (let attempt = 0; attempt < 20 && postureSetRequests < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(postureSetRequests).toBe(2);
    invalidate?.();
    expect(engine.dispose).toHaveBeenCalledTimes(2);
    expect(shieldHarness.instances.at(-1)?.dispose).toHaveBeenCalledOnce();
    releaseDelayedSet?.();
    for (let attempt = 0; attempt < 20 && postureClearRequests < 1; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(postureClearRequests).toBe(1);
    expect(sendMessage.mock.calls.map(([frame]) => (frame as BusFrame).name).slice(-2)).toEqual([
      "shield.posture.current",
      "shield.posture.clear",
    ]);
  });

  it("does not revive terminal page authority from an older page-context reply", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation();
    let releaseContext: (() => void) | undefined;
    const contextGate = new Promise<void>((resolve) => { releaseContext = resolve; });
    let contextStarted = false;
    let terminalClearRequests = 0;
    let consentRegisterRequests = 0;
    const terminalScope = {
      environmentKey: "example.com",
      siteId: 1,
      baseUrl: "https://example.com",
      contextGeneration: 1,
      pageUrl: pageUrl.href,
      documentKey: `test-document:${pageUrl.href}`,
    };
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        contextStarted = true;
        await contextGate;
        return managedPageContextReply(message, pageUrl.href);
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      if (message.name === "consent.suppression.register") {
        consentRegisterRequests += 1;
        return replyFrame(message, { status: "ok" });
      }
      if (message.name === "shield.posture.current") {
        return replyFrame(message, {
          status: "active",
          revision: 2,
          scope: terminalScope,
          directive: {
            silentSelectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
            organ: { state: "silent" },
          },
        });
      }
      if (message.name === "shield.posture.clear") {
        terminalClearRequests += 1;
        return replyFrame(message, {
          status: "ok",
          posture: { status: "inactive", revision: 3, scope: terminalScope },
        });
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1, tagName: "HTML", scrollHeight: 0 },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getElementById: vi.fn(() => null),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        setInterval: vi.fn(() => 1),
        clearInterval: vi.fn(),
      },
    });
    const createMarkingEngine = vi.fn();
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    let invalidate: (() => void) | undefined;
    (entrypoint.default as {
      main: (ctx: { onInvalidated(callback: () => void): void }) => void;
    }).main({ onInvalidated: (callback) => { invalidate = callback; } });
    for (let attempt = 0; attempt < 20 && !contextStarted; attempt += 1) {
      await Promise.resolve();
    }
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown;
    await applyLockState(listener);
    const staleApply = dispatchContentCommand(listener, "applySilentSelectors", {
      pageUrl: pageUrl.href,
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
    });
    invalidate?.();
    releaseContext?.();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }

    const reset = await dispatchContentCommand(listener, "resetContentMain");
    expect(reset).toEqual({
      ok: true,
      data: {
        ok: false,
        initialized: false,
        tree: "rewrite",
        reason: "property-authority-unavailable",
      },
    });
    expect(createMarkingEngine).not.toHaveBeenCalled();
    expect(shieldHarness.create).not.toHaveBeenCalled();
    expect(terminalClearRequests).toBe(1);
    await expect(staleApply).resolves.toMatchObject({
      ok: true,
      data: { ok: false, reason: "consent-registration-failed" },
    });
    expect(consentRegisterRequests).toBe(0);
  });

  it("rechecks silent command URLs after terminal registration and context rebinding", async () => {
    const addListener = vi.fn();
    const locationValue = installTestLocation("https://example.com/a");
    let registerGate: Promise<void> | null = null;
    let releaseRegister: (() => void) | undefined;
    let registerRequests = 0;
    let contextRequests = 0;
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        contextRequests += 1;
        return managedPageContextReply(message, locationValue.href);
      }
      if (message.name === "consent.suppression.register") {
        registerRequests += 1;
        await registerGate;
        return replyFrame(message, { status: "ok" });
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      if (message.name === "shield.posture.current") {
        return replyFrame(message, { status: "unavailable", reason: "document-unbound" });
      }
      return replyFrame(message, { status: "ok" });
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        readyState: "complete",
        documentElement: { nodeType: 1, tagName: "HTML", scrollHeight: 500 },
        body: { nodeType: 1 },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        innerHeight: 800,
        scrollY: 0,
        scrollTo: vi.fn(),
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const createMarkingEngine = vi.fn();
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown;
    for (let attempt = 0; attempt < 20 && contextRequests < 1; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(contextRequests).toBe(1);

    await dispatchContentCommand(listener, "terminateConsentSuppression");
    registerGate = new Promise<void>((resolve) => { releaseRegister = resolve; });
    const entering = dispatchContentCommand(listener, "enterSilentContentMain", {
      pageUrl: "https://example.com/a",
    });
    for (let attempt = 0; attempt < 20 && registerRequests < 1; attempt += 1) {
      await Promise.resolve();
    }
    locationValue.href = "https://example.com/b";
    releaseRegister?.();
    await expect(entering).resolves.toEqual({
      ok: true,
      data: { ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" },
    });

    await dispatchContentCommand(listener, "terminateConsentSuppression");
    registerGate = new Promise<void>((resolve) => { releaseRegister = resolve; });
    const applying = dispatchContentCommand(listener, "applySilentSelectors", {
      pageUrl: "https://example.com/b",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
    });
    for (let attempt = 0; attempt < 20 && registerRequests < 2; attempt += 1) {
      await Promise.resolve();
    }
    locationValue.href = "https://example.com/c";
    releaseRegister?.();
    await expect(applying).resolves.toEqual({
      ok: true,
      data: { ok: false, applied: false, tree: "rewrite", reason: "page-url-mismatch" },
    });
    expect(contextRequests).toBe(3);
    expect(createMarkingEngine).not.toHaveBeenCalled();
  });

  it("keeps the MAIN-world page-world entrypoint bound to the new program", () => {
    const pageWorldEntrypointSource = readFileSync(
      resolve(REPO_ROOT, "src", "entrypoints", "page-world.content.ts"),
      "utf8",
    );
    expect(pageWorldEntrypointSource).toContain('import "../page-world/program.js";');
  });

  it("sweeps a managed non-candidate before render-mode gates and re-sweeps late insertions", async () => {
    const hideConsentOverlays = vi.fn(() => ({ hidden: 0, bypassInstalled: false }));
    const restoreConsentOverlays = vi.fn(() => 1);
    vi.doMock("../src/content/consent", async (importOriginal) => ({
      ...await importOriginal<typeof import("../src/content/consent")>(),
      hideConsentOverlays,
      restoreConsentOverlays,
    }));
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));

    let onMutation: MutationCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: class {
        constructor(callback: MutationCallback) {
          onMutation = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    });
    const locationValue = { href: "https://example.com/not-a-candidate" };
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: locationValue,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: { nodeType: 1 }, body: { nodeType: 1 } },
    });
    const windowListeners: TestListenerRegistry = new Map();
    const windowObject = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        addTestListener(windowListeners, type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        removeTestListener(windowListeners, type, listener);
      }),
      setInterval: vi.fn(() => 1),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowObject,
    });
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        const pageUrl = (message.payload as { pageUrl?: string }).pageUrl ?? locationValue.href;
        if (pageUrl.endsWith("/outside")) {
          return replyFrame(message, {
            status: "unmanaged",
            generation: 3,
            observedUrl: pageUrl,
            draftDisposition: "terminate",
            environmentKey: "example.com",
            siteId: null,
            baseUrl: null,
            pageKey: null,
            pageTypes: [],
            membershipFingerprint: null,
            assignmentFingerprint: null,
            conflicts: [],
            upstreamCode: null,
            renderModeSet: false,
            todo: { covered: 0, actionable: 0, pageTypes: [] },
          });
        }
        return replyFrame(message, {
          status: "managed_non_candidate",
          generation: 1,
          observedUrl: pageUrl,
          draftDisposition: "preserve",
          environmentKey: "example.com",
          siteId: 1,
          baseUrl: "https://example.com",
          pageKey: new URL(pageUrl).pathname,
          pageTypes: [{
            pageType: "detail",
            pages: [{ pageKey: "/candidate", wordsCount: 42 }],
          }],
          membershipFingerprint: "membership",
          assignmentFingerprint: "assignment",
          conflicts: [],
          upstreamCode: null,
          renderModeSet: false,
          todo: {
            covered: 1,
            actionable: 1,
            pageTypes: [{
              pageType: "detail",
              markedCount: 1,
              current: false,
              candidates: [{ pageKey: "/candidate", wordsCount: 42, marked: true, current: false }],
            }],
          },
        });
      }
      if (message.name === "signals.pull") {
        return replyFrame(message, []);
      }
      return undefined;
    });
    const addListener = vi.fn();
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const onInvalidated = vi.fn();
    const contentScript = entrypoint.default as {
      main: (ctx?: { onInvalidated(callback: () => void): void }) => void;
    };
    contentScript.main({ onInvalidated });
    expect(onInvalidated).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 20 && hideConsentOverlays.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(hideConsentOverlays).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "class", "id", "role", "aria-modal", "aria-label"],
    });

    onMutation?.([], {} as MutationObserver);

    expect(hideConsentOverlays).toHaveBeenCalledTimes(2);

    locationValue.href = "https://example.com/another-page";
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: locationValue.href },
    } as unknown as Event);
    for (let index = 0; index < 20 && hideConsentOverlays.mock.calls.length < 3; index += 1) {
      await Promise.resolve();
    }

    expect(hideConsentOverlays).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    expect(restoreConsentOverlays).not.toHaveBeenCalled();

    locationValue.href = "https://example.com/outside";
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: locationValue.href },
    } as unknown as Event);
    for (let index = 0; index < 20 && restoreConsentOverlays.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(restoreConsentOverlays).toHaveBeenCalledTimes(1);

    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    const terminal = await dispatchContentCommand(listener, "terminateConsentSuppression");

    expect(terminal).toEqual({
      ok: true,
      data: { ok: true, restored: 1, tree: "rewrite" },
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(restoreConsentOverlays).toHaveBeenCalledTimes(2);
    expect(restoreConsentOverlays).toHaveBeenCalledWith(document);
  });

  it("uses one transaction for marking and silent-selector entrypoints and disposes overlays", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation();
    const documentListeners = new Map<string, EventListener>();
    const windowListeners: TestListenerRegistry = new Map();
    const markingOverlay = {
      className: "uf-marking-layer-root",
      style: { pointerEvents: "auto", zIndex: "2147483647" },
    } as unknown as HTMLElement;
    const engine = {
      refresh: vi.fn(),
      renderReadOnly: vi.fn(),
      dispose: vi.fn(),
      resolveAtPoint: vi.fn(() => ({ xpath: "/html[1]/body[1]/p[1]" })),
      toggle: vi.fn(),
      setPassthrough: vi.fn(),
      setInputTransparent: vi.fn(),
      setSuspended: vi.fn(),
      clearHover: vi.fn(),
      rejectAtPoint: vi.fn(),
      rows: vi.fn(() => [{ xpath: "/html[1]/body[1]/p[1]", excluded: true }]),
      lastInitializationSeededSelectors: vi.fn(() => true),
      renderSilentHighlights: vi.fn(() => ["/html[1]/body[1]/p[1]"]),
      setSilentDebugAnnotations: vi.fn(),
      overlayRoot: vi.fn(() => markingOverlay),
    };
    const createMarkingEngine = vi.fn(() => {
      document.documentElement.appendChild(markingOverlay);
      return engine;
    });
    const sendMessage = vi.fn(async (message: BusFrame) => message.name === "page.context"
      ? managedPageContextReply(message, pageUrl.href)
      : { ok: true });
    type SurfaceElement = {
      id: string;
      attributes: Record<string, string>;
      style: Record<string, string>;
      children: SurfaceElement[];
      textContent: string;
      isConnected: boolean;
      title: string;
      listeners: Map<string, EventListener[]>;
      setAttribute: (name: string, value: string) => void;
      addEventListener: (name: string, listener: EventListener) => void;
      appendChild: (child: SurfaceElement) => SurfaceElement;
      replaceChildren: (...children: SurfaceElement[]) => void;
      remove: () => void;
    };
    const contentElements: SurfaceElement[] = [];
    const createElement = vi.fn(() => {
      const element: SurfaceElement = {
        id: "",
        attributes: {},
        style: {},
        children: [],
        textContent: "",
        isConnected: true,
        title: "",
        listeners: new Map(),
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
        addEventListener(name: string, listener: EventListener) {
          this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
        },
        appendChild(child: SurfaceElement) {
          this.children.push(child);
          return child;
        },
        replaceChildren(...children: SurfaceElement[]) {
          this.children = children;
        },
        remove() {
          this.isConnected = false;
        },
      };
      contentElements.push(element);
      return element;
    });
    const getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
        getURL,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: { nodeType: 1 },
        documentElement: {
          nodeType: 1,
          tagName: "HTML",
          scrollHeight: 1000,
          className: "page-shell",
          appendChild: vi.fn((element: SurfaceElement) => element),
        },
        createElement,
        getElementById: vi.fn((id: string) => contentElements.find((element) => element.id === id) ?? null),
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          documentListeners.set(type, listener);
        }),
        removeEventListener: vi.fn((type: string) => {
          documentListeners.delete(type);
        }),
      },
    });
    const scrollTo = vi.fn();
    const requestAnimationFrame = vi.fn();
    const windowObject = {
      innerHeight: 500,
      scrollY: 123,
      scrollTo,
      requestAnimationFrame,
      postMessage: vi.fn((message: {
        kind?: string;
        type?: string;
        nonce?: string;
        command?: string;
      }) => {
        if (message.kind !== "uf-page-bus/1" || message.type !== "request") {
          return;
        }
        queueMicrotask(() => dispatchTestEvent(windowListeners, "message", {
          source: windowObject,
          data: {
            kind: "uf-page-bus/1",
            type: "response",
            nonce: message.nonce,
            command: message.command,
            ok: true,
            payload: {},
          },
        } as unknown as Event));
      }),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        addTestListener(windowListeners, type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        removeTestListener(windowListeners, type, listener);
      }),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowObject,
    });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));
    mockFastRevealVisit();

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as {
      main: (ctx?: { onInvalidated(callback: () => void): void }) => void;
    };
    let invalidate: (() => void) | undefined;
    contentScript.main({ onInvalidated: (callback) => { invalidate = callback; } });
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;

    await applyLockState(listener);
    const initialSelectors = {
      inclusionSelectors: ["main p"],
      exclusionSelectors: ["header"],
    };
    await dispatchContentCommand(listener, "activateContentMain", { selectors: initialSelectors });
    for (let index = 0; index < 20 && !windowObject.postMessage.mock.calls.some(
      ([message]) => message.command === "SET_MOTION_PAUSED"
    ); index += 1) {
      await Promise.resolve();
    }
    const contentRoot = contentElements.find((element) => element.attributes["data-uf-content-surface-root"] === "true");
    const currentToast = (): SurfaceElement | undefined => contentRoot?.children.find((element) =>
      element.attributes["data-uf-content-toast"] === "true"
    );
    const toastCopy = (toast: SurfaceElement | undefined): string | undefined => toast?.children.find((element) =>
      element.attributes["data-uf-content-toast-copy"] === "true"
    )?.textContent;
    const pauseIndicator = contentRoot?.children.find((element) =>
      element.attributes["data-uf-motion-pause-indicator"] === "true"
    );
    expect(pauseIndicator?.attributes["aria-label"]).toBe("Page motion paused");
    expect(pauseIndicator?.title).toBe("Page motion paused");
    expect(pauseIndicator?.children.map((element) => element.textContent)).toEqual([
      String.fromCodePoint(0xF0717),
      String.fromCodePoint(0xF1C86),
    ]);
    expect(contentElements.some((element) =>
      element.attributes["data-uf-content-curtain-copy"] === "true"
      && element.textContent === "Inspecting page... it will be ready soon"
    )).toBe(true);
    // Escape safety is installed at document_start, ahead of the interaction
    // shield, so Preview can always request its normal restoration path even
    // before marking listeners exist.
    expect(windowListeners.has("keydown")).toBe(true);
    await dispatchContentCommand(listener, "activateContentMain");
    const status = await dispatchContentCommand(listener, "getContentMainStatus");
    expect(status.data).toMatchObject({
      ok: true,
      active: true,
      dirty: false,
      pageUrl: pageUrl.href,
      markedCount: 0,
      contentRows: [{ xpath: "/html[1]/body[1]/p[1]", classification: "excluded" }],
      sessionState: { name: "boot" },
      authority: { configPresent: true, lockRole: "editor", lockBlocked: false },
      presentation: { markingEditsBlocked: false, pageInputBlocked: false },
      tree: "rewrite",
    });
    expect(inspectionCurtainHarness.instances).toHaveLength(0);
    expect(shieldHarness.instances.some((instance) => instance.setActive.mock.calls.some(
      ([reason, active]) => reason === "render-inspection" && active === true,
    ))).toBe(false);
    expect(engine.setInputTransparent).toHaveBeenLastCalledWith(false);
    expect(createMarkingEngine).toHaveBeenCalledTimes(1);
    expect(createMarkingEngine).toHaveBeenCalledWith(document.documentElement, {
      render: true,
      selectors: initialSelectors,
    });
    expect(engine.lastInitializationSeededSelectors).toHaveBeenCalledTimes(1);
    expect(engine.refresh).toHaveBeenCalledTimes(1);
    expect(engine.refresh).toHaveBeenCalledWith({ render: true, selectors: undefined });
    expect(engine.renderReadOnly).not.toHaveBeenCalled();
    expect((document.documentElement as HTMLElement).className).toBe("page-shell uf-cursor-exclude");
    expect(getURL).toHaveBeenCalledWith("cursors/exclude.svg");
    expect(getURL).toHaveBeenCalledWith("cursors/include.svg");
    const cursorStyle = contentElements.find((element) => element.id === "unfluffify-marking-cursor-style");
    expect(cursorStyle?.textContent).toContain(
      'cursor: url("chrome-extension://test/cursors/exclude.svg") 4 3, crosshair !important',
    );
    expect(cursorStyle?.textContent).toContain(
      'cursor: url("chrome-extension://test/cursors/include.svg") 4 3, copy !important',
    );
    expect(contentElements.find((element) => element.id === "unfluffify-content-surface-style")?.textContent)
      .toContain('chrome-extension://test/assets/materialdesignicons-webfont.woff2');
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "ARM",
      sessionNonce: undefined,
    }), "*");
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "SET_LAZY_LOADING_SUPPRESSED",
      sessionNonce: expect.stringMatching(/^rewrite-stabilization-/),
    }), "*");
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "SET_MOTION_PAUSED",
      sessionNonce: expect.stringMatching(/^rewrite-stabilization-/),
    }), "*");
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    documentListeners.get("keydown")?.({ code: "AltLeft", key: "Alt" } as unknown as Event);
    expect((document.documentElement as HTMLElement).className).toBe("page-shell uf-cursor-include");
    documentListeners.get("keyup")?.({ code: "AltLeft", key: "Alt" } as unknown as Event);
    expect((document.documentElement as HTMLElement).className).toBe("page-shell uf-cursor-exclude");
    documentListeners.get("keydown")?.({ code: "Space" } as unknown as Event);
    expect((document.documentElement as HTMLElement).className).toBe("page-shell uf-cursor-passthrough");
    const spaceToast = currentToast();
    expect(toastCopy(spaceToast)).toBe("Page interaction mode");
    expect(spaceToast?.attributes).toMatchObject({
      "data-uf-content-toast-tone": "success",
      role: "status",
      "aria-live": "polite",
    });
    const documentChildrenInAppendOrder = (
      document.documentElement.appendChild as ReturnType<typeof vi.fn>
    ).mock.calls.map(([element]) => element);
    expect(documentChildrenInAppendOrder.lastIndexOf(contentRoot))
      .toBeGreaterThan(documentChildrenInAppendOrder.lastIndexOf(markingOverlay));
    expect(contentRoot?.style).toMatchObject({
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    expect(markingOverlay.style.pointerEvents).toBe("auto");
    expect(contentElements.find((element) => element.id === "unfluffify-content-surface-style")?.textContent)
      .toMatch(/\[data-uf-content-toast-close="true"\]\s*\{[^}]*pointer-events:\s*auto;/s);
    const closeToast = spaceToast?.children.find((element) =>
      element.attributes["data-uf-content-toast-close"] === "true"
    );
    expect(closeToast?.attributes["aria-label"]).toBe("Close notification");
    expect(closeToast?.title).toBe("Close notification");
    const closeEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    for (const closeListener of closeToast?.listeners.get("click") ?? []) {
      closeListener(closeEvent as unknown as Event);
    }
    expect(currentToast()).toBeUndefined();
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(closeEvent.stopPropagation).toHaveBeenCalledOnce();
    documentListeners.get("keyup")?.({ code: "Space" } as unknown as Event);
    expect((document.documentElement as HTMLElement).className).toBe("page-shell uf-cursor-exclude");
    documentListeners.get("keydown")?.({ code: "Space" } as unknown as Event);
    dispatchTestEvent(windowListeners, "blur", {} as Event);
    expect((document.documentElement as HTMLElement).className).toBe("page-shell uf-cursor-exclude");
    expect(engine.refresh).toHaveBeenCalledTimes(1);
    expect(engine.renderReadOnly).not.toHaveBeenCalled();
    expect(engine.setPassthrough).toHaveBeenNthCalledWith(1, true);
    expect(engine.setPassthrough).toHaveBeenNthCalledWith(2, false);
    expect(engine.setPassthrough).toHaveBeenNthCalledWith(3, true);
    expect(engine.setPassthrough).toHaveBeenNthCalledWith(4, false);
    await dispatchContentCommand(listener, "pauseContentMainInteractions");
    expect(engine.setSuspended).toHaveBeenCalledWith(true);
    expect(contentRoot?.children.some((element) =>
      element.attributes["data-uf-marking-paused-notice"] === "true"
      && element.textContent === "Marking temporarily paused"
    )).toBe(true);
    await dispatchContentCommand(listener, "resumeContentMainInteractions");
    expect(engine.setSuspended).toHaveBeenCalledWith(false);
    const click = {
      clientX: 10,
      clientY: 20,
      altKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    documentListeners.get("click")?.(click as unknown as Event);
    expect(engine.resolveAtPoint).toHaveBeenCalledWith(10, 20, "exclude", true);
    expect(engine.toggle).toHaveBeenCalledWith({ xpath: "/html[1]/body[1]/p[1]" }, "exclude");
    engine.resolveAtPoint.mockReturnValueOnce(null);
    documentListeners.get("click")?.({
      clientX: 15,
      clientY: 25,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event);
    expect(engine.rejectAtPoint).toHaveBeenCalledWith(15, 25);
    const invalidToast = currentToast();
    expect(toastCopy(invalidToast)).toBe("That area can't be marked (15, 25).");
    expect(invalidToast?.attributes).toMatchObject({
      "data-uf-content-toast-tone": "warning",
      role: "status",
      "aria-live": "polite",
    });
    expect(click.preventDefault).toHaveBeenCalledTimes(1);
    // bus.emit defers its transport send by a microtask, unlike bus.request which
    // sends synchronously, so the fact needs a flush before it is observable.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The toggle reports a fact and nothing else. markings.changed has exactly one
    // producer — the brain — so an organ emitting it too would be a second source
    // of truth for one decision.
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "uf-bus/1",
      name: "fact.reported",
      target: "background",
      source: "content",
      payload: expect.objectContaining({
        kind: "uf-fact/1",
        sensation: expect.objectContaining({
          source: "content",
          reason: "marking-toggle",
          facts: expect.objectContaining({ markingToggleSeq: 1 }),
        }),
      }),
    }));
    const emittedSignalNames = sendMessage.mock.calls
      .map(([frame]) => frame as { name?: string; payload?: { signal?: { name?: string } } })
      .filter((frame) => frame.name === "signals.emit")
      .map((frame) => frame.payload?.signal?.name);
    expect(emittedSignalNames).not.toContain("markings.changed");
    engine.resolveAtPoint.mockReturnValueOnce(null);
    const unresolvedClick = {
      clientX: 1,
      clientY: 2,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    documentListeners.get("click")?.(unresolvedClick as unknown as Event);
    expect(unresolvedClick.preventDefault).toHaveBeenCalledTimes(1);
    expect(unresolvedClick.stopPropagation).toHaveBeenCalledTimes(1);
    expect(engine.toggle).toHaveBeenCalledTimes(1);
    const destroyCallsBeforeSilent = window.postMessage.mock.calls.filter(([message]) =>
      (message as { command?: string }).command === "DESTROY"
    ).length;
    const enterSilent = await dispatchContentCommand(listener, "enterSilentContentMain");
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(window.postMessage.mock.calls.filter(([message]) =>
      (message as { command?: string }).command === "DESTROY"
    )).toHaveLength(destroyCallsBeforeSilent);
    expect(contentRoot?.children.some((element) =>
      element.attributes["data-uf-motion-pause-indicator"] === "true"
    )).toBe(true);
    expect(documentListeners.has("click")).toBe(false);
    expect(windowListeners.has("blur")).toBe(false);
    expect((document.documentElement as HTMLElement).className).toBe("page-shell");
    expect(enterSilent).toEqual({ ok: true, data: { ok: true, initialized: false, tree: "rewrite" } });
    const handoffShield = shieldHarness.instances.at(-1);
    expect(handoffShield).toBeDefined();
    expect(handoffShield?.setActive).toHaveBeenCalledWith("silent-highlights", true);

    const silentSelectors = {
      inclusionSelectors: ["article"],
      exclusionSelectors: ["nav"],
    };
    engine.renderSilentHighlights.mockClear();
    engine.setInputTransparent.mockClear();
    const applySilent = await dispatchContentCommand(listener, "applySilentSelectors", { selectors: silentSelectors });
    expect(createMarkingEngine).toHaveBeenCalledTimes(2);
    expect(createMarkingEngine).toHaveBeenNthCalledWith(2, document.documentElement, {
      selectors: silentSelectors,
    });
    expect(engine.lastInitializationSeededSelectors).toHaveBeenCalledTimes(2);
    expect(engine.renderSilentHighlights).toHaveBeenCalledTimes(1);
    expect(engine.refresh).toHaveBeenCalledTimes(1);
    expect(engine.renderReadOnly).not.toHaveBeenCalled();
    expect(applySilent).toEqual({
      ok: true,
      data: { ok: true, seeded: true, highlighted: 1, tree: "rewrite" },
    });
    const shield = shieldHarness.instances.at(-1);
    expect(shield).toBeDefined();
    expect(shield?.setActive).toHaveBeenCalledWith("silent-highlights", true);
    expect(engine.setInputTransparent).toHaveBeenCalledWith(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const debugCopyEvent = {
      target: {
        closest: vi.fn(() => ({
          getAttribute: (name: string) => name === "data-uf-silent-highlight"
            ? "/html[1]/body[1]/p[1]"
            : null,
        })),
      },
      clientX: 10,
      clientY: 20,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    documentListeners.get("click")?.(debugCopyEvent as unknown as Event);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("XPath: /html[1]/body[1]/p[1]");
    expect(debugCopyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(debugCopyEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(toastCopy(currentToast())).toBe("Highlight details copied.");
    expect(currentToast()?.attributes["data-uf-content-toast-tone"]).toBe("success");
    const copiedToastId = Number(currentToast()?.attributes["data-uf-content-toast-id"]);
    writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
    documentListeners.get("click")?.(debugCopyEvent as unknown as Event);
    await Promise.resolve();
    await Promise.resolve();
    expect(toastCopy(currentToast())).toBe("Unable to copy highlight details.");
    expect(currentToast()?.attributes).toMatchObject({
      "data-uf-content-toast-tone": "danger",
      role: "alert",
      "aria-live": "assertive",
    });
    expect(Number(currentToast()?.attributes["data-uf-content-toast-id"])).toBeGreaterThan(copiedToastId);
    expect(contentRoot?.children.filter((element) =>
      element.attributes["data-uf-content-toast"] === "true"
    )).toHaveLength(1);
    let resolveDelayedCopy: (() => void) | undefined;
    writeText.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveDelayedCopy = resolve;
    }));
    documentListeners.get("click")?.(debugCopyEvent as unknown as Event);
    await Promise.resolve();
    dispatchTestEvent(windowListeners, "pagehide", { type: "pagehide" } as Event);
    expect(currentToast()).toBeUndefined();
    resolveDelayedCopy?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(currentToast()).toBeUndefined();
    dispatchTestEvent(windowListeners, "pageshow", { type: "pageshow" } as Event);

    const deactivate = await dispatchContentCommand(listener, "deactivateContentMain");
    expect(currentToast()).toBeUndefined();
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("silent-highlights", false);
    expect(engine.setInputTransparent).toHaveBeenCalledWith(false);
    expect(window.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "DESTROY",
      sessionNonce: expect.stringMatching(/^rewrite-stabilization-/),
    }), "*");
    expect(deactivate).toEqual({ ok: true, data: { ok: true, initialized: false, tree: "rewrite" } });

    await dispatchContentCommand(listener, "applySilentSelectors", { selectors: silentSelectors });
    expect(contentRoot?.isConnected).toBe(true);
    writeText.mockResolvedValueOnce(undefined);
    documentListeners.get("click")?.(debugCopyEvent as unknown as Event);
    await Promise.resolve();
    expect(toastCopy(currentToast())).toBe("Highlight details copied.");
    pageUrl.href = "https://example.com/next";
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: pageUrl.href },
    } as unknown as Event);
    expect(currentToast()).toBeUndefined();
    await applyLockState(listener);
    await dispatchContentCommand(listener, "applySilentSelectors", { selectors: silentSelectors });
    let resolveInvalidatedCopy: (() => void) | undefined;
    writeText.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInvalidatedCopy = resolve;
    }));
    documentListeners.get("click")?.(debugCopyEvent as unknown as Event);
    await Promise.resolve();
    invalidate?.();
    resolveInvalidatedCopy?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.dispose).toHaveBeenCalledTimes(4);
    expect(contentRoot?.isConnected).toBe(false);
    expect(currentToast()).toBeUndefined();
    expect(shield?.dispose).toHaveBeenCalledOnce();
  });

  it("fences delayed stabilization and signal work after terminal invalidation", async () => {
    type RevealInput = Readonly<{
      suppressLazyLoading: () => Promise<void>;
      freezeAtBottom: () => Promise<void>;
      scrollTo: (position: "top" | "lazy-threshold" | "bottom" | "restore", height: number) => Promise<void>;
    }>;
    vi.doMock("../src/content/stabilization", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/content/stabilization")>();
      return {
        ...actual,
        async runReveal(input: RevealInput) {
          await input.suppressLazyLoading();
          await input.freezeAtBottom();
          // Exercise the library's post-freeze restore even after terminal state
          // wins while SET_MOTION_PAUSED is in flight.
          await input.scrollTo("restore", 1_000);
          return { skipped: false, lazyExpansions: 0, frozenAtBottom: true };
        },
      };
    });
    const addListener = vi.fn();
    const pageUrl = installTestLocation();
    const documentListeners = new Map<string, EventListener>();
    const windowListeners: TestListenerRegistry = new Map();
    type SurfaceElement = {
      id: string;
      attributes: Record<string, string>;
      style: Record<string, string>;
      children: SurfaceElement[];
      textContent: string;
      isConnected: boolean;
      title: string;
      setAttribute: (name: string, value: string) => void;
      addEventListener: (name: string, listener: EventListener) => void;
      appendChild: (child: SurfaceElement) => SurfaceElement;
      replaceChildren: (...children: SurfaceElement[]) => void;
      remove: () => void;
    };
    const elements: SurfaceElement[] = [];
    const createElement = vi.fn(() => {
      const element: SurfaceElement = {
        id: "",
        attributes: {},
        style: {},
        children: [],
        textContent: "",
        isConnected: true,
        title: "",
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        addEventListener: vi.fn(),
        appendChild(child) {
          child.isConnected = true;
          this.children.push(child);
          return child;
        },
        replaceChildren(...children) {
          this.children = children;
        },
        remove() {
          this.isConnected = false;
        },
      };
      elements.push(element);
      return element;
    });
    const documentElement = createElement();
    Object.assign(documentElement, {
      nodeType: 1,
      tagName: "HTML",
      scrollHeight: 1_000,
      offsetHeight: 1_000,
      className: "",
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        readyState: "complete",
        body: { nodeType: 1, scrollHeight: 1_000, offsetHeight: 1_000 },
        documentElement,
        createElement,
        getElementById: (id: string) => elements.find((element) => element.id === id && element.isConnected) ?? null,
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          documentListeners.set(type, listener);
        }),
        removeEventListener: vi.fn((type: string) => {
          documentListeners.delete(type);
        }),
      },
    });
    let pendingMotion: { nonce: string; command: string } | null = null;
    const posted: Array<Record<string, unknown>> = [];
    const scrollTo = vi.fn();
    const windowObject = {
      innerHeight: 500,
      scrollY: 0,
      scrollTo,
      postMessage: vi.fn((message: Record<string, unknown>) => {
        posted.push(message);
        if (message.type !== "request" || typeof message.nonce !== "string") {
          return;
        }
        if (message.command === "SET_MOTION_PAUSED") {
          pendingMotion = { nonce: message.nonce, command: message.command };
          return;
        }
        if (message.command === "ARM" || message.command === "SET_LAZY_LOADING_SUPPRESSED") {
          queueMicrotask(() => dispatchTestEvent(windowListeners, "message", {
            source: windowObject,
            data: {
              kind: "uf-page-bus/1",
              type: "response",
              nonce: message.nonce,
              command: message.command,
              ok: true,
              payload: {},
            },
          } as unknown as Event));
        }
      }),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        addTestListener(windowListeners, type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        removeTestListener(windowListeners, type, listener);
      }),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowObject,
    });
    let releaseSignals: (() => void) | undefined;
    let delaySignals = false;
    const signalGate = new Promise<void>((resolve) => { releaseSignals = resolve; });
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        return managedPageContextReply(message, pageUrl.href);
      }
      if (message.name === "signals.pull") {
        if (delaySignals) {
          await signalGate;
          return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: 77,
            seq: 1,
            name: "run.started",
            source: "brain",
            cause: "late-terminal-test",
            at: 1,
            payload: { sessionId: "late-run" },
          }]);
        }
        return replyFrame(message, []);
      }
      if (message.name === "shield.posture.current") {
        return replyFrame(message, { status: "unavailable", reason: "document-unbound" });
      }
      return undefined;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
    } as unknown as typeof chrome;
    const engine = {
      refresh: vi.fn(),
      renderReadOnly: vi.fn(),
      dispose: vi.fn(),
      rows: vi.fn(() => []),
      renderSilentHighlights: vi.fn(() => []),
      setInputTransparent: vi.fn(),
      setSilentDebugAnnotations: vi.fn(),
    };
    const createMarkingEngine = vi.fn(() => engine);
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    let invalidate: (() => void) | undefined;
    (entrypoint.default as {
      main: (ctx: { onInvalidated(callback: () => void): void }) => void;
    }).main({ onInvalidated: (callback) => { invalidate = callback; } });
    for (let attempt = 0; attempt < 20 && !elements.some((element) =>
      element.attributes["data-uf-content-surface-root"] === "true"
    ); attempt += 1) {
      await Promise.resolve();
    }
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown;
    delaySignals = true;
    await applyLockState(listener);
    await dispatchContentCommand(listener, "activateContentMain", { pageUrl: pageUrl.href });
    for (let attempt = 0; attempt < 20 && pendingMotion === null; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(pendingMotion).not.toBeNull();
    const contentRoot = elements.find((element) =>
      element.attributes["data-uf-content-surface-root"] === "true"
    );
    expect(contentRoot?.isConnected).toBe(true);

    invalidate?.();
    expect(engine.dispose).toHaveBeenCalledOnce();
    releaseSignals?.();
    const motion = pendingMotion as { nonce: string; command: string } | null;
    expect(motion).not.toBeNull();
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: {
        kind: "uf-page-bus/1",
        type: "response",
        nonce: motion!.nonce,
        command: motion!.command,
        ok: true,
        payload: {},
      },
    } as unknown as Event);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(scrollTo).not.toHaveBeenCalled();
    expect(posted).toContainEqual(expect.objectContaining({
      command: "DESTROY",
      sessionNonce: expect.any(String),
    }));
    expect(contentRoot?.isConnected).toBe(false);
    expect(elements.filter((element) =>
      element.isConnected && element.attributes["data-uf-content-surface-root"] === "true"
    )).toEqual([]);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("reveal/freeze skipped"));
    await expect(applyLockState(listener)).resolves.toMatchObject({
      ok: true,
      data: { ok: false, reason: "property-authority-unavailable" },
    });
  });

  it("pauses and resumes marking interactions without clearing dirty state", async () => {
    const addListener = vi.fn();
    const pageUrl = installTestLocation();
    const documentListeners = new Map<string, EventListener>();
    const engine = {
      refresh: vi.fn(),
      renderReadOnly: vi.fn(),
      dispose: vi.fn(),
      resolveAtPoint: vi.fn(() => ({ xpath: "/html[1]/body[1]/p[1]" })),
      toggle: vi.fn(),
      rows: vi.fn(() => [{ xpath: "/html[1]/body[1]/p[1]", excluded: true }]),
    };
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage: vi.fn(async (message: BusFrame) => message.name === "page.context"
          ? managedPageContextReply(message, pageUrl.href)
          : { ok: true }),
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1, tagName: "HTML", scrollHeight: 1000 },
        addEventListener: vi.fn((type: string, listener: EventListener) => documentListeners.set(type, listener)),
        removeEventListener: vi.fn((type: string) => documentListeners.delete(type)),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { innerHeight: 500, scrollY: 0, scrollTo: vi.fn(), postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({ defineContentScript: (config: unknown) => config }));
    vi.doMock("../src/content/marking", () => ({ createMarkingEngine: vi.fn(() => engine), installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()) }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

    await applyLockState(listener);
    await dispatchContentCommand(listener, "activateContentMain");
    documentListeners.get("click")?.({ clientX: 1, clientY: 1, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
    const paused = await dispatchContentCommand(listener, "pauseContentMainInteractions");
    expect(documentListeners.has("click")).toBe(false);
    expect((document.documentElement as HTMLElement).className).toContain("uf-cursor-disabled");
    expect(paused).toEqual({ ok: true, data: { ok: true, active: true, dirty: true, tree: "rewrite" } });
    const clean = await dispatchContentCommand(listener, "markContentMainClean");
    expect(clean).toEqual({ ok: true, data: { ok: true, active: true, dirty: false, tree: "rewrite" } });
    await applyLockState(listener, {
      canEdit: false,
      blockedReason: "locked",
      banner: { visible: false, reason: "locked" },
    });
    await expect(dispatchContentCommand(listener, "resetContentMain")).resolves.toMatchObject({
      ok: true,
      data: { ok: true, initialized: true, tree: "rewrite" },
    });
    await applyLockState(listener);
    await dispatchContentCommand(listener, "resumeContentMainInteractions");
    expect(documentListeners.has("click")).toBe(true);
    expect((document.documentElement as HTMLElement).className).toContain("uf-cursor-exclude");
  });

  it("rejects stale activation requests whose pageUrl no longer matches the page", async () => {
    const addListener = vi.fn();
    const createMarkingEngine = vi.fn();
    const pageUrl = installTestLocation("https://example.com/current");
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage: vi.fn(async (message: BusFrame) => message.name === "page.context"
          ? managedPageContextReply(message, pageUrl.href)
          : undefined),
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1 },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as { main: () => void };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;

    await applyLockState(listener);
    const response = await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/old" });
    expect(createMarkingEngine).not.toHaveBeenCalled();
    expect(response).toMatchObject({ ok: false, failure: { code: "page-url-mismatch" } });
    await expect(dispatchContentCommand(listener, "enterSilentContentMain", {
      pageUrl: "https://example.com/old",
    })).resolves.toEqual({
      ok: true,
      data: { ok: false, initialized: false, tree: "rewrite", reason: "page-url-mismatch" },
    });
    await expect(dispatchContentCommand(listener, "applySilentSelectors", {
      pageUrl: "https://example.com/old",
      selectors: { inclusionSelectors: ["main"], exclusionSelectors: [] },
    })).resolves.toEqual({
      ok: true,
      data: { ok: false, applied: false, tree: "rewrite", reason: "page-url-mismatch" },
    });
    await expect(dispatchContentCommand(listener, "captureSubmissionSnapshot", {
      pageUrl: "https://example.com/old",
      baseUrl: "https://example.com",
      renderMode: "rendered",
    })).resolves.toMatchObject({
      ok: false,
      failure: { code: "page-url-mismatch" },
    });
    await expect(dispatchContentCommand(listener, "resetContentMain", {
      pageUrl: "https://example.com/old",
    })).resolves.toMatchObject({
      ok: false,
      failure: { code: "page-url-mismatch" },
    });
    expect(createMarkingEngine).not.toHaveBeenCalled();
  });

  it("deactivates active marking on same-document URL changes without popup polling", async () => {
    const addListener = vi.fn();
    const windowListeners: TestListenerRegistry = new Map();
    const engine = {
      refresh: vi.fn(),
      renderReadOnly: vi.fn(),
      dispose: vi.fn(),
      rows: vi.fn(() => []),
    };
    const createMarkingEngine = vi.fn(() => engine);
    const locationValue = installTestLocation("https://example.com/a");
    let deferSignalPull = false;
    let signalPullStarted = false;
    let releaseSignalPull: (() => void) | undefined;
    const signalPullGate = new Promise<void>((resolve) => { releaseSignalPull = resolve; });
    let postureSetRequests = 0;
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        return managedPageContextReply(
          message,
          (message.payload as { pageUrl?: string }).pageUrl ?? locationValue.href,
        );
      }
      if (message.name === "signals.pull") {
        if (deferSignalPull) {
          signalPullStarted = true;
          await signalPullGate;
          return replyFrame(message, [{
            kind: "uf-signal/1",
            tabId: 77,
            seq: 1,
            name: "run.started",
            source: "brain",
            cause: "old-route-pull",
            at: 1,
            payload: { sessionId: "old-route-run" },
          }]);
        }
        return replyFrame(message, []);
      }
      if (message.name === "shield.posture.set") {
        postureSetRequests += 1;
        return replyFrame(message, { status: "unavailable", reason: "unexpected-old-route-posture" });
      }
      return { ok: true };
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1 },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const windowObject = {
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        addTestListener(windowListeners, type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        removeTestListener(windowListeners, type, listener);
      }),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowObject,
    });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine,
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    const contentScript = entrypoint.default as { main: () => void };
    contentScript.main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => unknown;
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: "https://example.com/b" },
    } as unknown as Event);
    await applyLockState(listener);
    await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/a" });
    deferSignalPull = true;
    await applyLockState(listener);
    for (let attempt = 0; attempt < 20 && !signalPullStarted; attempt += 1) {
      await Promise.resolve();
    }
    expect(signalPullStarted).toBe(true);
    locationValue.href = "https://example.com/b";
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: "https://example.com/b" },
    } as unknown as Event);
    releaseSignalPull?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "uf-bus/1",
      frameType: "event",
      name: "fact.reported",
      target: "background",
      source: "content",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          source: "content",
          reason: "content-url-change",
          facts: expect.objectContaining({
            pageUrl: "https://example.com/b",
            markingEnabled: false,
          }),
        }),
      }),
    }));
    expect(windowListeners.has("popstate")).toBe(true);
    expect(windowListeners.has("hashchange")).toBe(true);
    expect(postureSetRequests).toBe(0);
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "boot", lastConsumedSeq: 0 },
    });
  });

  it("drops old idle-route signals before applying the navigation boundary", async () => {
    const addListener = vi.fn();
    const windowListeners: TestListenerRegistry = new Map();
    const locationValue = installTestLocation("https://example.com/a");
    let deferNextPull = false;
    let deferredPullStarted = false;
    let releaseDeferredPull: (() => void) | undefined;
    const deferredPullGate = new Promise<void>((resolve) => { releaseDeferredPull = resolve; });
    let navigationReported = false;
    let navigationFolded = false;
    let signalPullRequests = 0;
    let overrideSignals: Array<Record<string, unknown>> | null = null;
    let postureSetRequests = 0;
    const runStarted = {
      kind: "uf-signal/1",
      tabId: 77,
      seq: 1,
      name: "run.started",
      source: "brain",
      cause: "old-route-run",
      at: 1,
      payload: { sessionId: "old-route-run" },
    };
    const navigated = {
      kind: "uf-signal/1",
      tabId: 77,
      seq: 2,
      name: "session.navigated",
      source: "brain",
      cause: "route-boundary",
      at: 2,
      payload: { pageUrl: "https://example.com/b" },
    };
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        return managedPageContextReply(
          message,
          (message.payload as { pageUrl?: string }).pageUrl ?? locationValue.href,
        );
      }
      if (message.name === "fact.reported") {
        const reason = (message.payload as { sensation?: { reason?: string } }).sensation?.reason;
        if (reason === "content-url-change") {
          navigationReported = true;
        }
        return replyFrame(message, { status: "ok" });
      }
      if (message.name === "signals.pull") {
        signalPullRequests += 1;
        if (deferNextPull) {
          deferNextPull = false;
          deferredPullStarted = true;
          await deferredPullGate;
          return replyFrame(message, [runStarted]);
        }
        return replyFrame(
          message,
          overrideSignals ?? (navigationReported
            ? navigationFolded ? [runStarted, navigated] : [runStarted]
            : []),
        );
      }
      if (message.name === "shield.posture.set") {
        postureSetRequests += 1;
        return replyFrame(message, { status: "unavailable", reason: "unexpected-old-route-posture" });
      }
      return replyFrame(message, { status: "unavailable", reason: "not-needed" });
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: { nodeType: 1 },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const windowObject = {
      history: { pushState: vi.fn(), replaceState: vi.fn() },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        addTestListener(windowListeners, type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        removeTestListener(windowListeners, type, listener);
      }),
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: windowObject });
    vi.doMock("wxt/utils/define-content-script", () => ({
      defineContentScript: (config: unknown) => config,
    }));
    vi.doMock("../src/content/marking", () => ({
      createMarkingEngine: vi.fn(),
      installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()),
    }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown;
    for (let attempt = 0; attempt < 20 && !sendMessage.mock.calls.some(
      ([frame]) => (frame as BusFrame).name === "page.context"
    ); attempt += 1) {
      await Promise.resolve();
    }
    deferNextPull = true;
    await applyLockState(listener);
    for (let attempt = 0; attempt < 20 && !deferredPullStarted; attempt += 1) {
      await Promise.resolve();
    }
    expect(deferredPullStarted).toBe(true);

    locationValue.href = "https://example.com/b";
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: locationValue.href },
    } as unknown as Event);
    for (let attempt = 0; attempt < 20 && !navigationReported; attempt += 1) {
      await Promise.resolve();
    }
    expect(navigationReported).toBe(true);
    releaseDeferredPull?.();
    for (let attempt = 0; attempt < 40 && signalPullRequests < 3; attempt += 1) {
      await Promise.resolve();
    }
    expect(signalPullRequests).toBeGreaterThanOrEqual(3);
    expect(postureSetRequests).toBe(0);
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "boot", lastConsumedSeq: 0 },
    });

    navigationFolded = true;
    await applyLockState(listener);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await Promise.resolve();
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      if ((status.data as { sessionState?: { lastConsumedSeq?: number } }).sessionState?.lastConsumedSeq === 2) {
        break;
      }
    }

    expect(postureSetRequests).toBe(0);
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "silent", lastConsumedSeq: 2 },
    });

    // A brain boundary can arrive before the page-world URL watcher. When the
    // late watcher observes the same URL, it must not wait for a duplicate
    // session.navigated that the brain correctly will not emit.
    locationValue.href = "https://example.com/c";
    overrideSignals = [{
      ...navigated,
      seq: 3,
      at: 3,
      payload: {
        fromUrl: "https://example.com/b",
        pageUrl: locationValue.href,
        toUrl: locationValue.href,
      },
    }];
    await applyLockState(listener);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      if ((status.data as { sessionState?: { lastConsumedSeq?: number } }).sessionState?.lastConsumedSeq === 3) {
        break;
      }
    }
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: locationValue.href },
    } as unknown as Event);
    overrideSignals = [{
      kind: "uf-signal/1",
      tabId: 77,
      seq: 4,
      name: "lock.acquired",
      source: "brain",
      cause: "current-route-lock",
      at: 4,
      payload: { pageUrl: locationValue.href },
    }];
    await applyLockState(listener);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      if ((status.data as { sessionState?: { lastConsumedSeq?: number } }).sessionState?.lastConsumedSeq === 4) {
        break;
      }
    }
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "silent", lastConsumedSeq: 4 },
    });

    // Even the same from/to pair is occurrence-sensitive. B -> C was consumed
    // above before its watcher. Repeat C -> B -> C, hold both new URL-change
    // facts, then expose only the intermediate C -> B boundary/run. The current
    // C route must not reuse the historical B -> C signal; it waits for seq 7.
    overrideSignals = [];
    locationValue.href = "https://example.com/b";
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: locationValue.href },
    } as unknown as Event);
    locationValue.href = "https://example.com/c";
    dispatchTestEvent(windowListeners, "message", {
      source: windowObject,
      data: { kind: "uf-page-url-changed/1", toUrl: locationValue.href },
    } as unknown as Event);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
    const bBoundary = {
      ...navigated,
      seq: 5,
      at: 5,
      payload: {
        fromUrl: "https://example.com/c",
        pageUrl: "https://example.com/b",
        toUrl: "https://example.com/b",
      },
    };
    const bRunStarted = {
      ...runStarted,
      seq: 6,
      at: 6,
      payload: { pageUrl: "https://example.com/b", sessionId: "route-b-run" },
    };
    overrideSignals = [bBoundary, bRunStarted];
    await applyLockState(listener);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
    expect(postureSetRequests).toBe(0);
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "silent", lastConsumedSeq: 4 },
    });

    overrideSignals = [bBoundary, bRunStarted, {
      ...navigated,
      seq: 7,
      at: 7,
      payload: {
        fromUrl: "https://example.com/b",
        pageUrl: "https://example.com/c",
        toUrl: "https://example.com/c",
      },
    }];
    await applyLockState(listener);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
      const status = await dispatchContentCommand(listener, "getContentMainStatus");
      if ((status.data as { sessionState?: { lastConsumedSeq?: number } }).sessionState?.lastConsumedSeq === 7) {
        break;
      }
    }
    expect(postureSetRequests).toBe(0);
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "silent", lastConsumedSeq: 7 },
    });
  });

  it("consumes brain signals into local surface memory and gates commands with lock authority", async () => {
    const addListener = vi.fn();
    const windowListeners = new Map<string, EventListener>();
    const elements: Array<{
      tag: string;
      attributes: Record<string, string>;
      style: Record<string, string>;
      children: unknown[];
      textContent: string;
      isConnected: boolean;
      listeners: Map<string, EventListener>;
      setAttribute: (name: string, value: string) => void;
      addEventListener: (name: string, listener: EventListener) => void;
      appendChild: (child: unknown) => unknown;
      replaceChildren: (...children: unknown[]) => void;
      remove: () => void;
    }> = [];
    const createElement = vi.fn((tag: string) => {
      const element = {
        tag,
        attributes: {} as Record<string, string>,
        style: {} as Record<string, string>,
        children: [] as unknown[],
        textContent: "",
        isConnected: true,
        listeners: new Map<string, EventListener>(),
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
        addEventListener(name: string, listener: EventListener) {
          this.listeners.set(name, listener);
        },
        appendChild(child: unknown) {
          this.children.push(child);
          return child;
        },
        replaceChildren(...children: unknown[]) {
          this.children = children;
        },
        remove() {
          this.isConnected = false;
        },
      };
      elements.push(element);
      return element;
    });
    const createMarkingEngine = vi.fn();
    let signalSeq = 0;
    let pendingSignals: Array<Record<string, unknown>> = [];
    let deferDocumentPostureSet = false;
    let deferredDocumentPostureStarted = false;
    let releaseDocumentPostureSet: (() => void) | undefined;
    const documentPostureGate = new Promise<void>((resolve) => {
      releaseDocumentPostureSet = resolve;
    });
    const postureSetRequests: Array<{
      expected: { pageUrl: string };
      posture: { kind: string };
    }> = [];
    const queueSignal = (name: string, payload: Record<string, unknown> = {}): void => {
      signalSeq += 1;
      pendingSignals.push({
        kind: "uf-signal/1",
        tabId: 77,
        seq: signalSeq,
        name,
        source: "brain",
        cause: "test",
        at: signalSeq,
        payload,
      });
    };
    const sendMessage = vi.fn(async (message: BusFrame) => {
      if (message.name === "page.context") {
        const pageUrl = (message.payload as { pageUrl?: string }).pageUrl ?? "https://example.com/page";
        return managedPageContextReply(message, pageUrl);
      }
      if (message.name === "shield.posture.set") {
        const request = message.payload as typeof postureSetRequests[number];
        postureSetRequests.push(request);
        if (
          deferDocumentPostureSet &&
          request.posture.kind !== "silent-selectors" &&
          !deferredDocumentPostureStarted
        ) {
          deferredDocumentPostureStarted = true;
          await documentPostureGate;
          return replyFrame(message, {
            status: "stale",
            reason: "route-generation-advanced",
          });
        }
        return replyFrame(message, {
          status: "unavailable",
          reason: "test-does-not-persist-unrelated-posture",
        });
      }
      if (message.name === "shield.posture.clear") {
        return replyFrame(message, {
          status: "unavailable",
          reason: "test-does-not-persist-unrelated-posture",
        });
      }
      if (message.name !== "signals.pull") {
        return undefined;
      }
      const signals = pendingSignals;
      pendingSignals = [];
      return {
        ...message,
        frameType: "reply",
        source: "background",
        sourceInstance: "background:test",
        target: "content",
        ok: true,
        payload: signals,
      } satisfies BusFrame;
    });
    globalThis.chrome = {
      runtime: {
        onMessage: { addListener },
        sendMessage,
      },
    } as unknown as typeof chrome;
    const locationValue = { href: "https://example.com/page" };
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: locationValue,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: {
          nodeType: 1,
          tagName: "HTML",
          scrollHeight: 1000,
          appendChild: vi.fn((child: unknown) => child),
        },
        createElement,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        innerHeight: 500,
        scrollY: 0,
        scrollTo: vi.fn(),
        postMessage: vi.fn(),
        addEventListener: vi.fn((type: string, listener: EventListener) => windowListeners.set(type, listener)),
        removeEventListener: vi.fn((type: string) => windowListeners.delete(type)),
        confirm: vi.fn(() => true),
      },
    });
    vi.doMock("wxt/utils/define-content-script", () => ({ defineContentScript: (config: unknown) => config }));
    vi.doMock("../src/content/marking", () => ({ createMarkingEngine, installClosedShadowHostInstrumentation: vi.fn(() => vi.fn()) }));

    const entrypoint = await import("../src/entrypoints/content-loader.content.ts");
    (entrypoint.default as { main: () => void }).main();
    const listener = addListener.mock.calls[0]?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => unknown;

    const configBlocked = await applyLockState(listener, {
      configPresent: false,
      canEdit: false,
      blockedReason: "not-configured",
      banner: { visible: true, reason: "not-configured" },
    });
    expect(configBlocked).toMatchObject({ ok: true, data: { ok: true } });
    expect(elements.find((element) => element.attributes["data-uf-content-surface-root"] === "true")?.attributes)
      .toMatchObject({ "data-uf-extension-ui": "true" });
    const contentRoot = elements.find((element) => element.attributes["data-uf-content-surface-root"] === "true");
    const lockBanner = contentRoot?.children.find((element) =>
      (element as typeof elements[number]).attributes["data-uf-content-banner"] === "true"
    ) as typeof elements[number] | undefined;
    expect(contentRoot?.children.some((element) =>
      (element as typeof elements[number]).attributes["data-uf-content-curtain"] === "true"
    )).toBe(false);
    expect(lockBanner?.attributes).toMatchObject({
      "data-uf-lock-reason": "not-configured",
      "data-uf-lock-role": "editor",
      "aria-live": "polite",
    });
    expect((lockBanner?.children[0] as typeof elements[number]).textContent).toBe("Property lock not configured");
    const pageInput = {
      type: "keydown",
      cancelable: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    windowListeners.get("keydown")?.(pageInput as unknown as Event);
    expect(pageInput.preventDefault).not.toHaveBeenCalled();
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "config-missing" },
    });

    await applyLockState(listener, {
      lockRole: "passive",
      canEdit: false,
      blockedReason: "locked",
      banner: { visible: true, reason: "locked", editorName: "Dana", countdownSeconds: 42 },
    });
    const countdownBanner = contentRoot?.children.find((element) =>
      (element as typeof elements[number]).attributes["data-uf-content-banner"] === "true"
    ) as typeof elements[number] | undefined;
    expect(countdownBanner?.attributes).toMatchObject({
      "data-uf-lock-reason": "locked",
      "data-uf-lock-role": "passive",
      "data-uf-lock-countdown-seconds": "42",
    });
    expect((countdownBanner?.children[0] as typeof elements[number]).textContent)
      .toBe("This property will be released for editing in 42s");
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "property-lock" },
    });

    const transitions = [
      {
        blockedReason: "transfer",
        banner: { visible: true, reason: "transfer", fromName: "Dana", toName: "Kai", countdownSeconds: 12 },
        expected: "Editing is being transferred from Dana to Kai (12s).",
        live: "polite",
      },
      {
        blockedReason: "disconnect-warning",
        banner: { visible: true, reason: "disconnect-warning", countdownSeconds: 70 },
        expected: "Connection lost. You will lose the editor role in 70s unless the connection recovers.",
        live: "assertive",
      },
      {
        blockedReason: "takeover-suggested",
        banner: {
          visible: true,
          reason: "takeover-suggested",
          fromName: "Kai",
          actions: [
            { kind: "accept-takeover", suggestionId: "suggestion-1", confirmDiscard: true },
            { kind: "reject-takeover", suggestionId: "suggestion-1" },
          ],
        },
        expected: "Kai would like to edit this property",
        live: "polite",
      },
    ] as const;
    for (const transition of transitions) {
      await applyLockState(listener, {
        lockRole: "passive",
        canEdit: false,
        blockedReason: transition.blockedReason,
        banner: transition.banner,
      });
      const transitionBanner = contentRoot?.children.find((element) =>
        (element as typeof elements[number]).attributes["data-uf-content-banner"] === "true"
      ) as typeof elements[number] | undefined;
      expect(transitionBanner?.attributes).toMatchObject({
        "data-uf-lock-reason": transition.banner.reason,
        "aria-live": transition.live,
      });
      expect((transitionBanner?.children[0] as typeof elements[number]).textContent).toBe(transition.expected);
    }
    const acceptButton = elements.find((element) =>
      element.attributes["data-uf-lock-action-kind"] === "accept-takeover"
    );
    acceptButton?.listeners.get("click")?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ name: "lock.action" }));
    const inlineConfirmation = elements.find((element) =>
      element.attributes["data-uf-content-lock-confirmation"] === "discard"
    );
    const confirmButton = elements.find((element) =>
      element.attributes["data-uf-content-lock-confirm"] === "discard"
    );
    expect(inlineConfirmation?.textContent).toBe("Discard unsaved work in the current editor session?");
    const lockEscape = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    windowListeners.get("keydown")?.(lockEscape as unknown as Event);
    expect(lockEscape.preventDefault).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ name: "lock.action" }));

    // Escape only dismissed the confirmation. The canonical action remains
    // available and runs exactly once after an explicit reopen + confirm.
    const reopenedAccept = elements.filter((element) =>
      element.attributes["data-uf-lock-action-kind"] === "accept-takeover"
    ).at(-1);
    reopenedAccept?.listeners.get("click")?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event);
    const reopenedConfirm = elements.filter((element) =>
      element.attributes["data-uf-content-lock-confirm"] === "discard"
    ).at(-1) ?? confirmButton;
    reopenedConfirm?.listeners.get("click")?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Event);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "lock.action",
      target: "background",
      payload: {
        kind: "accept-takeover",
        suggestionId: "suggestion-1",
        confirmDiscard: true,
      },
    }));
    await applyLockState(listener);
    expect(contentRoot?.children.some((element) =>
      (element as typeof elements[number]).attributes["data-uf-content-banner"] === "true"
    )).toBe(false);

    queueSignal("reconciliation.started", { reason: "saving" });
    await applyLockState(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "reconciliation-pending" },
    });

    queueSignal("reconciliation.ended", { reason: "saved" });
    queueSignal("marking.enabled");
    queueSignal("run.started", { sessionId: "run-1" });
    deferDocumentPostureSet = true;
    await applyLockState(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "post_ai" },
    });
    expect(elements.some((element) =>
      element.attributes["data-uf-content-curtain-copy"] === "true"
      && element.textContent === "Computing selectors"
    )).toBe(true);
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("blocked-organ", true);

    await applyLockState(listener, {
      baseUrl: "https://other.example",
    });
    expect(await dispatchContentCommand(listener, "activateContentMain", { pageUrl: "https://example.com/page" })).toMatchObject({
      ok: false,
      failure: { code: "base-url-mismatch" },
    });
    expect(createMarkingEngine).not.toHaveBeenCalled();

    const status = await dispatchContentCommand(listener, "getContentMainStatus");
    expect(status.data).toMatchObject({
      sessionState: { name: "running", lastConsumedSeq: signalSeq },
      presentation: {
        markingEditsBlocked: true,
        blockedReason: "post_ai",
      },
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      name: "signals.pull",
      payload: expect.objectContaining({ tabId: 0 }),
    }));
    const startupFrame = sendMessage.mock.calls
      .map(([frame]) => frame)
      .find((frame) => frame.name === "fact.reported" && (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "content-started");
    const startupFacts = (startupFrame?.payload as { sensation?: { facts?: Record<string, unknown> } }).sensation?.facts;
    expect(startupFacts).toBeDefined();
    expect(startupFacts).not.toHaveProperty("lockRole");
    expect(startupFacts).not.toHaveProperty("configPresent");

    queueSignal("run.completed", { sessionId: "run-1" });
    queueSignal("preview.opened", { origin: "post_ai" });
    await applyLockState(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const previewEscape = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    windowListeners.get("keydown")?.(previewEscape as unknown as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const previewEscapeFacts = () => sendMessage.mock.calls.filter(([frame]) =>
      frame.name === "fact.reported" &&
      (frame.payload as { sensation?: { reason?: string } }).sensation?.reason === "preview-escape-requested"
    );
    expect(previewEscape.preventDefault).toHaveBeenCalledOnce();
    expect(previewEscape.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(previewEscapeFacts()).toHaveLength(1);
    expect(previewEscapeFacts()[0]?.[0]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          facts: expect.objectContaining({ previewExitRequested: true }),
        }),
      }),
    }));
    // The local occurrence fence blocks a second physical Escape while the
    // brain-owned restoration edge is in flight.
    windowListeners.get("keydown")?.(previewEscape as unknown as Event);
    expect(previewEscapeFacts()).toHaveLength(1);

    queueSignal("preview.exit.requested", { restore: true });
    await applyLockState(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The surface only requested the exit. Content owns the one completion fact,
    // after it has consumed the request and entered its restoring posture.
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "uf-bus/1",
      frameType: "event",
      name: "fact.reported",
      target: "background",
      source: "content",
      payload: expect.objectContaining({
        sensation: expect.objectContaining({
          source: "content",
          reason: "preview-exited",
          facts: expect.objectContaining({
            previewActive: false,
            previewExitRequested: false,
          }),
        }),
      }),
    }));
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "exit_restoring" },
      presentation: { markingEditsBlocked: true, blockedReason: "post_ai" },
    });
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("preview", true);

    queueSignal("preview.exited", { restored: true });
    await applyLockState(listener);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await dispatchContentCommand(listener, "getContentMainStatus")).data).toMatchObject({
      sessionState: { name: "post_ai_clean" },
      presentation: { markingEditsBlocked: false, blockedReason: "" },
    });
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("preview", false);
    expect(shieldHarness.instances.at(-1)?.setActive)
      .toHaveBeenCalledWith("blocked-organ", false);

    for (let attempt = 0; attempt < 20 && !deferredDocumentPostureStarted; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(deferredDocumentPostureStarted).toBe(true);
    const setCountBeforeNavigation = postureSetRequests.length;
    locationValue.href = "https://example.com/next";
    windowListeners.get("message")?.({
      source: window,
      data: { kind: "uf-page-url-changed/1", toUrl: locationValue.href },
    } as unknown as Event);
    queueSignal("session.navigated", { pageUrl: locationValue.href });
    await applyLockState(listener);
    releaseDocumentPostureSet?.();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(postureSetRequests).toHaveLength(setCountBeforeNavigation);
    expect(postureSetRequests.some((request) =>
      request.expected.pageUrl === "https://example.com/next"
    )).toBe(false);
  });
});
