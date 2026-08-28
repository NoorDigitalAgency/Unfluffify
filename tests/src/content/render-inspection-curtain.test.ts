import { describe, expect, it, vi } from "vitest";

import {
  RENDER_INSPECTION_CURTAIN_ATTRIBUTE,
  RENDER_INSPECTION_DOCUMENT_NONCE_ATTRIBUTE,
  RENDER_INSPECTION_GENERATION_ATTRIBUTE,
  RENDER_INSPECTION_TOKEN_ATTRIBUTE,
  createRenderInspectionCurtain,
  type AdoptedRenderInspectionSession,
} from "../../../src/content/render-inspection-curtain";

type Listener = EventListenerOrEventListenerObject;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener | null): void {
    if (!listener) {
      return;
    }
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (listener) {
      this.listeners.get(type)?.delete(listener);
    }
  }

  dispatch(type: string): void {
    const event = { type } as Event;
    for (const listener of [...this.listeners.get(type) ?? []]) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

class FakeStyle {
  private readonly values = new Map<string, Readonly<{ value: string; priority: string }>>();

  getPropertyValue(property: string): string {
    return this.values.get(property)?.value ?? "";
  }

  getPropertyPriority(property: string): string {
    return this.values.get(property)?.priority ?? "";
  }

  setProperty(property: string, value: string, priority = ""): void {
    this.values.set(property, { value, priority });
  }
}

function rootOf(element: FakeElement): FakeElement {
  let candidate = element;
  while (candidate.parentElement) {
    candidate = candidate.parentElement;
  }
  return candidate;
}

class FakeElement extends FakeEventTarget {
  readonly style = new FakeStyle();
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent = "";

  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string) {
    super();
  }

  get isConnected(): boolean {
    return rootOf(this) === this.ownerDocument.documentElement;
  }

  get lastElementChild(): FakeElement | null {
    return this.children.at(-1) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild<T extends FakeElement>(element: T): T {
    element.remove();
    this.children.push(element);
    element.parentElement = this;
    return element;
  }

  replaceChildren(...elements: FakeElement[]): void {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children.length = 0;
    for (const element of elements) {
      this.appendChild(element);
    }
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    const index = parent.children.indexOf(this);
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 412,
      bottom: 960,
      width: 412,
      height: 960,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

class FakeDocument extends FakeEventTarget {
  documentElement: FakeElement | null = null;
  defaultView: FakeWindow | null = null;
  visibilityState: DocumentVisibilityState = "visible";

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName.toUpperCase());
  }

  replaceRoot(): FakeElement {
    const root = this.createElement("html");
    this.documentElement = root;
    return root;
  }
}

class FakeWindow extends FakeEventTarget {
  private frameCallbacks: FrameRequestCallback[] = [];
  private nextTimer = 1;
  private readonly timers = new Map<number, { callback: VoidFunction; delay: number }>();
  innerWidth = 412;
  innerHeight = 960;
  visualViewport: Pick<VisualViewport, "height" | "offsetLeft" | "offsetTop" | "width"> | null = null;

  requestAnimationFrame(callback: FrameRequestCallback): number {
    this.frameCallbacks.push(callback);
    return this.frameCallbacks.length;
  }

  flushFrame(): void {
    const callbacks = this.frameCallbacks;
    this.frameCallbacks = [];
    for (const callback of callbacks) {
      callback(0);
    }
  }

  pendingFrames(): number {
    return this.frameCallbacks.length;
  }

  queueMicrotask(callback: VoidFunction): void {
    queueMicrotask(callback);
  }

  setTimeout(callback: TimerHandler, delay = 0): number {
    const id = this.nextTimer++;
    if (typeof callback === "function") {
      this.timers.set(id, { callback, delay });
    }
    return id;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  flushTimer(delay: number): void {
    const match = [...this.timers.entries()].find(([, timer]) => timer.delay === delay);
    if (!match) {
      return;
    }
    const [id, timer] = match;
    this.timers.delete(id);
    timer.callback();
  }

  getComputedStyle(element: FakeElement): CSSStyleDeclaration {
    return {
      position: element.style.getPropertyValue("position"),
      display: element.style.getPropertyValue("display"),
      visibility: element.style.getPropertyValue("visibility") || "visible",
      pointerEvents: element.style.getPropertyValue("pointer-events"),
      zIndex: element.style.getPropertyValue("z-index"),
      opacity: element.style.getPropertyValue("opacity") || "1",
    } as CSSStyleDeclaration;
  }
}

class FakeMutationObserver {
  constructor(private readonly callback: MutationCallback) {}

  observe(): void {}
  disconnect(): void {}

  trigger(): void {
    this.callback([], this as unknown as MutationObserver);
  }
}

function session(
  token: string,
  generation: number,
  documentNonce: string,
): AdoptedRenderInspectionSession {
  return {
    token,
    generation,
    phase: "adopted",
    property: {
      environmentKey: "production",
      siteId: 42,
      baseUrl: "https://example.com",
    },
    pageUrl: "https://example.com/property",
    javascriptEnabled: true,
    documentId: `document-${generation}`,
    documentNonce,
    startedAt: 0,
    updatedAt: 0,
    deadlineAt: 5_000,
    terminalReason: null,
  };
}

function harness(
  rootReady = true,
  schedulePaintFallback?: NonNullable<
    Parameters<typeof createRenderInspectionCurtain>[0]["schedulePaintFallback"]
  >,
) {
  const document = new FakeDocument();
  const window = new FakeWindow();
  document.defaultView = window;
  if (rootReady) {
    document.replaceRoot();
  }
  const observers: FakeMutationObserver[] = [];
  const painted = vi.fn();
  const failed = vi.fn();
  const surfaceChanged = vi.fn();
  const lifecycleStage = vi.fn();
  const controller = createRenderInspectionCurtain({
    document: document as unknown as Document,
    window: window as unknown as Window,
    createMutationObserver(callback) {
      const observer = new FakeMutationObserver(callback);
      observers.push(observer);
      return observer as unknown as MutationObserver;
    },
    schedulePaintFallback,
    onPaintReady: painted,
    onFailure: failed,
    onSurfaceChanged: surfaceChanged,
    onLifecycleStage: lifecycleStage,
    now: () => 0,
  });
  return { controller, document, window, observers, painted, failed, surfaceChanged, lifecycleStage };
}

async function flushMutation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("render inspection replacement-document curtain", () => {
  it("waits for a document-start null root, mounts there, and acknowledges only after two animation frames", async () => {
    const { controller, document, window, observers, painted } = harness(false);
    const adopted = session("token-a", 1, "nonce-a");

    expect(controller.adopt(adopted)).toBe(true);
    expect(controller.element()).toBeNull();
    expect(painted).not.toHaveBeenCalled();

    const root = document.replaceRoot();
    observers[0]?.trigger();
    await flushMutation();

    const curtain = controller.element() as unknown as FakeElement;
    expect(curtain.parentElement).toBe(root);
    expect(curtain.getAttribute(RENDER_INSPECTION_CURTAIN_ATTRIBUTE)).toBe("true");
    expect(curtain.getAttribute(RENDER_INSPECTION_TOKEN_ATTRIBUTE)).toBe("token-a");
    expect(curtain.getAttribute(RENDER_INSPECTION_GENERATION_ATTRIBUTE)).toBe("1");
    expect(curtain.getAttribute(RENDER_INSPECTION_DOCUMENT_NONCE_ATTRIBUTE)).toBe("nonce-a");
    expect(window.pendingFrames()).toBe(1);

    window.flushFrame();
    expect(painted).not.toHaveBeenCalled();
    expect(window.pendingFrames()).toBe(1);
    window.flushFrame();
    expect(painted).toHaveBeenCalledTimes(1);
    expect(painted).toHaveBeenCalledWith(adopted);
  });

  it("keeps an adopted curtain connected across documentElement replacement", async () => {
    const { controller, document, observers } = harness();
    controller.adopt(session("token-a", 1, "nonce-a"));
    const curtain = controller.element() as unknown as FakeElement;

    const replacementRoot = document.replaceRoot();
    expect(curtain.isConnected).toBe(false);
    observers[0]?.trigger();
    await flushMutation();

    expect(controller.element()).toBe(curtain);
    expect(curtain.parentElement).toBe(replacementRoot);
    expect(curtain.isConnected).toBe(true);
  });

  it("uses a guarded visible-curtain fallback when animation frames are starved", () => {
    const { controller, window, painted, failed, lifecycleStage } = harness();
    const adopted = { ...session("token-static", 2, "nonce-static"), javascriptEnabled: false };
    controller.adopt(adopted);

    expect(window.pendingFrames()).toBe(1);
    window.flushTimer(1_000);

    expect(painted).toHaveBeenCalledOnce();
    expect(painted).toHaveBeenCalledWith(adopted);
    expect(failed).not.toHaveBeenCalled();
    expect(lifecycleStage.mock.calls.map(([, stage]) => stage)).toEqual([
      "adopted",
      "mounted",
      "fallback",
      "acknowledged",
    ]);
    window.flushFrame();
    window.flushFrame();
    expect(painted).toHaveBeenCalledOnce();
  });

  it("proves visual-viewport coverage when emulation reports larger inner dimensions", () => {
    const { controller, window, painted, failed } = harness();
    window.innerWidth = 424;
    window.innerHeight = 988;
    window.visualViewport = {
      width: 412,
      height: 960,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const adopted = { ...session("token-emulated", 4, "nonce-emulated"), javascriptEnabled: true };

    controller.adopt(adopted);
    window.flushTimer(1_000);

    expect(painted).toHaveBeenCalledOnce();
    expect(painted).toHaveBeenCalledWith(adopted);
    expect(failed).not.toHaveBeenCalled();
  });

  it("can source the starvation wake-up outside the page timer realm", () => {
    let wake: VoidFunction | undefined;
    const cancel = vi.fn();
    const externalScheduler = vi.fn((_session, callback, delayMs) => {
      expect(delayMs).toBe(1_000);
      wake = callback;
      return cancel;
    });
    const { controller, window, painted } = harness(true, externalScheduler);
    const adopted = { ...session("token-worker-clock", 3, "nonce-worker-clock"), javascriptEnabled: false };

    controller.adopt(adopted);
    expect(externalScheduler).toHaveBeenCalledWith(adopted, expect.any(Function), 1_000);
    expect(window.pendingFrames()).toBe(1);

    wake?.();

    expect(painted).toHaveBeenCalledOnce();
    expect(painted).toHaveBeenCalledWith(adopted);
    expect(cancel).not.toHaveBeenCalled();
    window.flushFrame();
    window.flushFrame();
    expect(painted).toHaveBeenCalledOnce();
  });

  it("waits for visibility before using the starvation fallback", async () => {
    const { controller, document, window, painted } = harness();
    document.visibilityState = "hidden";
    controller.adopt(session("token-hidden", 3, "nonce-hidden"));

    window.flushTimer(1_000);
    expect(painted).not.toHaveBeenCalled();

    document.visibilityState = "visible";
    document.dispatch("visibilitychange");
    await flushMutation();
    window.flushTimer(1_000);
    expect(painted).toHaveBeenCalledOnce();
  });

  it("does not acknowledge when visibility becomes hidden between frame proofs", async () => {
    const { controller, document, window, painted } = harness();
    controller.adopt(session("token-hidden-frame", 6, "nonce-hidden-frame"));

    window.flushFrame();
    document.visibilityState = "hidden";
    window.flushFrame();
    expect(painted).not.toHaveBeenCalled();

    document.visibilityState = "visible";
    document.dispatch("visibilitychange");
    await flushMutation();
    window.flushFrame();
    window.flushFrame();
    expect(painted).toHaveBeenCalledOnce();
  });

  it("rejects a near-transparent curtain as starvation-fallback proof", async () => {
    const { controller, window, painted, failed } = harness();
    controller.adopt(session("token-transparent", 7, "nonce-transparent"));
    const curtain = controller.element() as unknown as FakeElement;
    curtain.style.setProperty("opacity", "0.001", "important");

    window.flushTimer(1_000);
    await flushMutation();

    expect(painted).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("requires full visible coverage on the normal second-frame proof", async () => {
    const { controller, window, painted } = harness();
    controller.adopt(session("token-frame-coverage", 8, "nonce-frame-coverage"));
    const curtain = controller.element() as unknown as FakeElement;

    window.flushFrame();
    curtain.style.setProperty("opacity", "0.001", "important");
    window.flushFrame();
    expect(painted).not.toHaveBeenCalled();

    curtain.style.setProperty("opacity", "1", "important");
    await flushMutation();
    window.flushFrame();
    window.flushFrame();
    expect(painted).toHaveBeenCalledOnce();
  });

  it("restarts the two-frame proof when the root is replaced between paint opportunities", async () => {
    const { controller, document, window, painted } = harness();
    controller.adopt(session("token-a", 1, "nonce-a"));
    window.flushFrame();
    document.replaceRoot();

    window.flushFrame();
    await flushMutation();
    expect(painted).not.toHaveBeenCalled();
    expect(window.pendingFrames()).toBe(1);

    window.flushFrame();
    window.flushFrame();
    expect(painted).toHaveBeenCalledOnce();
  });

  it("never lets stale token, generation, nonce, or queued paint work clear or acknowledge a newer session", () => {
    const { controller, window, painted } = harness();
    const first = session("token-a", 1, "nonce-a");
    const second = session("token-b", 2, "nonce-b");
    controller.adopt(first);
    controller.adopt(second);

    expect(controller.clearMatching({ token: "token-a", generation: 2, documentNonce: "nonce-b" })).toBe(false);
    expect(controller.clearMatching({ token: "token-b", generation: 1, documentNonce: "nonce-b" })).toBe(false);
    expect(controller.clearMatching({ token: "token-b", generation: 2, documentNonce: "nonce-a" })).toBe(false);
    expect(controller.current()).toBe(second);

    window.flushFrame();
    expect(painted).not.toHaveBeenCalled();
    window.flushFrame();
    expect(painted).toHaveBeenCalledTimes(1);
    expect(painted).toHaveBeenCalledWith(second);
    expect(controller.current()).toBe(second);
  });

  it("terminally clears without permitting a late re-adoption", () => {
    const { controller } = harness();
    controller.adopt(session("token-a", 1, "nonce-a"));

    controller.terminate();

    expect(controller.current()).toBeNull();
    expect(controller.element()).toBeNull();
    expect(controller.adopt(session("token-b", 2, "nonce-b"))).toBe(false);
  });

  it("can clear one exact session and re-adopt a later generation", () => {
    const { controller, window, painted } = harness();
    const first = session("token-a", 1, "nonce-a");
    const second = session("token-b", 2, "nonce-b");
    controller.adopt(first);

    expect(controller.clearMatching(first)).toBe(true);
    expect(controller.current()).toBeNull();
    expect(controller.adopt(second)).toBe(true);
    window.flushFrame();
    window.flushFrame();

    expect(controller.current()).toBe(second);
    expect(painted).toHaveBeenCalledTimes(1);
    expect(painted).toHaveBeenCalledWith(second);
  });
});
