import { describe, expect, it, vi } from "vitest";

import {
  EMULATION_TRANSITION_GUARD_ATTRIBUTE,
  EMULATION_TRANSITION_STAGE_ATTRIBUTE,
  createEmulationTransitionGuardian,
  parseEmulationTransitionRequest,
} from "../../../src/content/emulation-transition-guardian";
import { MAXIMUM_DOCUMENT_Z_INDEX } from "../../../src/content/interaction-shield";

type Listener = EventListenerOrEventListenerObject;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (listener) this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    const event = { type } as Event;
    for (const listener of [...this.listeners.get(type) ?? []]) {
      if (typeof listener === "function") listener.call(this, event);
      else listener.handleEvent(event);
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

class FakeVisualViewport extends FakeEventTarget {
  width = 412;
  height = 960;
  scale = 1;
  offsetLeft = 0;
  offsetTop = 0;
}

class FakeElement extends FakeEventTarget {
  readonly style = new FakeStyle() as unknown as CSSStyleDeclaration;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;

  constructor(readonly ownerDocument: FakeDocument) {
    super();
  }

  get isConnected(): boolean {
    let parent = this.parentElement;
    while (parent?.parentElement) parent = parent.parentElement;
    return (parent ?? this) === this.ownerDocument.documentElement;
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

  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parentElement = null;
  }

  getBoundingClientRect(): DOMRect {
    const view = this.ownerDocument.defaultView;
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: view.innerWidth,
      bottom: view.innerHeight,
      width: view.innerWidth,
      height: view.innerHeight,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

class FakeDocument extends FakeEventTarget {
  readonly documentElement: FakeElement;
  visibilityState: DocumentVisibilityState = "visible";
  defaultView!: FakeWindow;

  constructor() {
    super();
    this.documentElement = new FakeElement(this);
  }

  createElement(): FakeElement {
    return new FakeElement(this);
  }
}

class FakeWindow extends FakeEventTarget {
  innerWidth = 412;
  innerHeight = 960;
  screen = { width: 412, height: 960 };
  readonly visualViewport = new FakeVisualViewport();
  readonly MutationObserver = undefined;

  requestAnimationFrame(callback: FrameRequestCallback): number {
    setTimeout(() => callback(Date.now()), 0);
    return 1;
  }

  setTimeout(callback: TimerHandler, timeout?: number): number {
    return setTimeout(callback as () => void, timeout) as unknown as number;
  }

  clearTimeout(handle?: number): void {
    clearTimeout(handle);
  }

  getComputedStyle(element: FakeElement): CSSStyleDeclaration {
    const style = element.style;
    return new Proxy(style, {
      get(target, property) {
        if (typeof property === "string" && !(property in target)) {
          return target.getPropertyValue(
            property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
          );
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
}

class FakeMutationObserver {
  readonly observations: Array<Readonly<{
    target: Node;
    options: MutationObserverInit;
  }>> = [];
  connected = false;

  constructor(readonly callback: MutationCallback) {}
  observe(target: Node, options: MutationObserverInit): void {
    this.connected = true;
    this.observations.push({ target, options });
  }
  disconnect(): void {
    this.connected = false;
  }
  mutate(): void {
    this.callback([], this as unknown as MutationObserver);
  }
}

function fixture(timing: Readonly<{
  enterTransitionMs?: number;
  retireTransitionMs?: number;
  paintTimeoutMs?: number;
  requestFrame?: (callback: FrameRequestCallback) => number | void;
}> = {}) {
  const document = new FakeDocument();
  const window = new FakeWindow();
  document.defaultView = window;
  let observer: FakeMutationObserver | null = null;
  const beforeSettle = vi.fn();
  const onGuardingChanged = vi.fn();
  const onUnexpectedViewportChange = vi.fn();
  const guardian = createEmulationTransitionGuardian({
    document: document as unknown as Document,
    window: window as unknown as Window,
    paintTimeoutMs: timing.paintTimeoutMs ?? 250,
    enterTransitionMs: timing.enterTransitionMs ?? 0,
    retireTransitionMs: timing.retireTransitionMs ?? 0,
    requestFrame: timing.requestFrame,
    createMutationObserver(callback) {
      observer = new FakeMutationObserver(callback);
      return observer as unknown as MutationObserver;
    },
    beforeSettle,
    onGuardingChanged,
    onUnexpectedViewportChange,
  });
  return {
    document,
    window,
    guardian,
    beforeSettle,
    onGuardingChanged,
    onUnexpectedViewportChange,
    observer: () => observer,
  };
}

const beginMobile = {
  phase: "begin",
  generation: 1,
  mode: "mobile",
  cause: "apply",
} as const;
const settleMobile = { ...beginMobile, phase: "settle" } as const;

describe("emulation transition guardian", () => {
  it("parses only complete typed lifecycle requests", () => {
    expect(parseEmulationTransitionRequest(beginMobile)).toEqual(beginMobile);
    expect(parseEmulationTransitionRequest({ ...beginMobile, generation: 0 })).toBeNull();
    expect(parseEmulationTransitionRequest({ ...beginMobile, mode: "tablet" })).toBeNull();
    expect(parseEmulationTransitionRequest({
      phase: "release",
      generation: 2,
      cause: "clear",
    })).toEqual({ phase: "release", generation: 2, cause: "clear" });
    expect(parseEmulationTransitionRequest({
      phase: "abort",
      generation: 3,
      cause: "restore",
    })).toEqual({ phase: "abort", generation: 3, cause: "restore" });
  });

  it("paint-proves an opaque interactive last-root guard before acknowledging begin", async () => {
    const { document, guardian, onGuardingChanged } = fixture();
    const response = await guardian.handle(beginMobile);
    const element = guardian.element() as unknown as FakeElement;

    expect(response).toMatchObject({
      ok: true,
      generation: 1,
      mode: "mobile",
      stage: "paint-proven",
      guarded: true,
      coverage: true,
    });
    expect(document.documentElement.lastElementChild).toBe(element);
    expect(element.getAttribute(EMULATION_TRANSITION_GUARD_ATTRIBUTE)).toBe("true");
    expect(element.getAttribute(EMULATION_TRANSITION_STAGE_ATTRIBUTE)).toBe("paint-proven");
    expect(element.style.getPropertyValue("position")).toBe("fixed");
    expect(element.style.getPropertyValue("opacity")).toBe("1");
    expect(element.style.getPropertyValue("pointer-events")).toBe("auto");
    expect(element.style.getPropertyValue("z-index")).toBe(MAXIMUM_DOCUMENT_Z_INDEX);
    expect(onGuardingChanged).toHaveBeenCalledWith(true);
  });

  it("never fades an already-opaque guard away when rollback adopts a newer generation", async () => {
    const { guardian } = fixture({ enterTransitionMs: 72 });
    await guardian.handle(beginMobile);

    const restoring = guardian.handle({
      phase: "begin",
      generation: 2,
      mode: "desktop",
      cause: "restore",
    });

    expect(guardian.element()?.style.getPropertyValue("opacity")).toBe("1");
    await expect(restoring).resolves.toMatchObject({
      ok: true,
      generation: 2,
      mode: "desktop",
      coverage: true,
    });
  });

  it("restores an older opaque safety guard when a newer begin handshake is aborted", async () => {
    const { guardian } = fixture();
    await guardian.handle(beginMobile);
    await guardian.handle({
      phase: "begin",
      generation: 2,
      mode: "desktop",
      cause: "restore",
    });

    await expect(guardian.handle({
      phase: "abort",
      generation: 2,
      cause: "restore",
    })).resolves.toMatchObject({
      ok: true,
      generation: 1,
      mode: "mobile",
      stage: "paint-proven",
      guarded: true,
      coverage: true,
      reason: "restored-prior",
    });
    expect(guardian.element()?.style.getPropertyValue("opacity")).toBe("1");
  });

  it("rejects a speculative future release instead of tearing down the current guard", async () => {
    const { guardian } = fixture();
    await guardian.handle(beginMobile);

    await expect(guardian.handle({
      phase: "release",
      generation: 2,
      cause: "clear",
    })).resolves.toMatchObject({
      ok: false,
      reason: "generation-mismatch",
      generation: 1,
      guarded: true,
      coverage: true,
    });
    expect(guardian.element()?.isConnected).toBe(true);
  });

  it("keeps coverage when Chrome exposes the intermediate 1.025 mobile frame", async () => {
    const { guardian, window, beforeSettle } = fixture();
    await guardian.handle(beginMobile);
    window.visualViewport.width = 401.95123291015625;
    window.visualViewport.height = 936.5853881835938;
    window.visualViewport.scale = 1.024999976158142;

    await expect(guardian.handle(settleMobile)).resolves.toMatchObject({
      ok: false,
      reason: "settle-proof-failed",
      guarded: true,
      exactGeometry: false,
    });
    expect(beforeSettle).toHaveBeenCalledTimes(1);
    expect(guardian.isGuarding()).toBe(true);

    window.visualViewport.width = 412;
    window.visualViewport.height = 960;
    window.visualViewport.scale = 1;
    await expect(guardian.handle(settleMobile)).resolves.toMatchObject({
      ok: true,
      stage: "idle",
      guarded: false,
      exactGeometry: true,
    });
  });

  it("arms synchronously on unexpected viewport change and stays covered for repair", async () => {
    const { guardian, window, onUnexpectedViewportChange } = fixture();
    await guardian.handle(beginMobile);
    await guardian.handle(settleMobile);
    expect(guardian.isGuarding()).toBe(false);

    window.visualViewport.height = 945;
    window.visualViewport.dispatch("resize");
    expect(guardian.isGuarding()).toBe(true);
    expect(guardian.element()?.style.getPropertyValue("opacity")).toBe("1");
    await Promise.resolve();
    expect(onUnexpectedViewportChange).toHaveBeenCalledWith("mobile", 1);
  });

  it("rejects a stale release without tearing down a newer covered generation", async () => {
    const { guardian } = fixture();
    await guardian.handle({ ...beginMobile, generation: 2 });
    await expect(guardian.handle({
      phase: "release",
      generation: 1,
      cause: "clear",
    })).resolves.toMatchObject({
      ok: false,
      reason: "stale-generation",
      guarded: true,
      generation: 2,
    });
    expect(guardian.element()?.isConnected).toBe(true);
  });

  it("waits for a hidden document before granting paint proof", async () => {
    const { document, guardian } = fixture();
    document.visibilityState = "hidden";
    let resolved = false;
    const pending = guardian.handle(beginMobile).then((value) => {
      resolved = true;
      return value;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    document.visibilityState = "visible";
    document.dispatch("visibilitychange");
    await expect(pending).resolves.toMatchObject({ ok: true, coverage: true });
  });

  it("fails closed in bounded time when a visible renderer starves animation frames", async () => {
    vi.useFakeTimers();
    try {
      const { guardian } = fixture({
        paintTimeoutMs: 100,
        requestFrame: () => undefined,
      });
      const pending = guardian.handle(beginMobile);

      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        stage: "rejected",
        reason: "guard-paint-proof-failed",
        guarded: true,
        coverage: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("repairs hostile DOM reordering while guarding", async () => {
    const { document, guardian, observer } = fixture();
    await guardian.handle(beginMobile);
    const guard = guardian.element() as unknown as FakeElement;
    const hostile = document.createElement();
    document.documentElement.appendChild(hostile);
    observer()?.mutate();
    await Promise.resolve();
    expect(document.documentElement.lastElementChild).toBe(guard);
  });

  it("does not observe unrelated page-subtree mutations while retained", async () => {
    const { document, guardian, observer } = fixture();
    await guardian.handle(beginMobile);

    const observations = observer()?.observations ?? [];
    expect(observations.some(({ target, options }) =>
      target === document as unknown as Node && options.childList === true && !options.subtree
    )).toBe(true);
    expect(observations.some(({ target, options }) =>
      target === document.documentElement as unknown as Node &&
      options.childList === true &&
      !options.subtree
    )).toBe(true);
    expect(observations.some(({ target, options }) =>
      target !== guardian.element() && options.subtree === true
    )).toBe(false);
  });

  it("disconnects mutation observation while exact and transparently idle", async () => {
    const { guardian, observer } = fixture();
    await guardian.handle(beginMobile);
    expect(observer()?.connected).toBe(true);

    await guardian.handle(settleMobile);

    expect(observer()?.connected).toBe(false);
    expect(guardian.element()?.isConnected).toBe(true);
    expect(guardian.element()?.style.getPropertyValue("opacity")).toBe("0");
  });

  it("settles desktop from its inner 1920x1080 device while tolerating scrollbars", async () => {
    const { guardian, window } = fixture();
    window.innerWidth = 1920;
    window.innerHeight = 1080;
    window.screen = { width: 1920, height: 1080 };
    window.visualViewport.width = 1905;
    window.visualViewport.height = 1065;
    const begin = {
      phase: "begin",
      generation: 3,
      mode: "desktop",
      cause: "restore",
    } as const;
    await expect(guardian.handle(begin)).resolves.toMatchObject({ ok: true });
    await expect(guardian.handle({ ...begin, phase: "settle" })).resolves.toMatchObject({
      ok: true,
      exactGeometry: true,
      guarded: false,
    });
  });

  it("keeps desktop covered when its visual viewport is smaller than a scrollbar strip", async () => {
    const { guardian, window } = fixture({ paintTimeoutMs: 100 });
    window.innerWidth = 1920;
    window.innerHeight = 1080;
    window.screen = { width: 1920, height: 1080 };
    window.visualViewport.width = 1600;
    window.visualViewport.height = 900;
    const begin = {
      phase: "begin",
      generation: 4,
      mode: "desktop",
      cause: "restore",
    } as const;
    await expect(guardian.handle(begin)).resolves.toMatchObject({ ok: true });
    await expect(guardian.handle({ ...begin, phase: "settle" })).resolves.toMatchObject({
      ok: false,
      reason: "settle-proof-failed",
      exactGeometry: false,
      guarded: true,
      coverage: true,
    });
  });
});
