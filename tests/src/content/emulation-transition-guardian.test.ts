import { describe, expect, it, vi } from "vitest";

import {
  EMULATION_TRANSITION_GUARD_ATTRIBUTE,
  EMULATION_TRANSITION_GENERATION_ATTRIBUTE,
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

  writeCount = 0;

  constructor(
    private readonly onChange: () => void = () => undefined,
    private readonly normalizeZeroLengths = false,
  ) {}

  getPropertyValue(property: string): string {
    return this.values.get(property)?.value ?? "";
  }

  getPropertyPriority(property: string): string {
    return this.values.get(property)?.priority ?? "";
  }

  setProperty(property: string, value: string, priority = ""): void {
    const normalized = this.normalizeZeroLengths && value === "0" && [
      "inset",
      "margin",
      "padding",
      "border",
    ].includes(property)
      ? "0px"
      : value;
    const previous = this.values.get(property);
    if (previous?.value === normalized && previous.priority === priority) return;
    this.values.set(property, { value: normalized, priority });
    this.writeCount += 1;
    this.onChange();
  }

  clear(): void {
    if (this.values.size === 0) return;
    this.values.clear();
    this.writeCount += 1;
    this.onChange();
  }

  serialize(): string {
    return [...this.values]
      .map(([property, { value, priority }]) =>
        `${property}: ${value}${priority ? ` !${priority}` : ""};`)
      .join(" ");
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
  readonly styleImplementation: FakeStyle;
  readonly style: CSSStyleDeclaration;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  clientWidth = 412;
  clientHeight = 960;

  constructor(readonly ownerDocument: FakeDocument) {
    super();
    const style = new FakeStyle(
      () => {
        const serialized = style.serialize();
        if (serialized) this.attributes.set("style", serialized);
        else this.attributes.delete("style");
        this.ownerDocument.onStyleMutation(this);
      },
      ownerDocument.normalizeStyleZeros,
    );
    this.styleImplementation = style;
    this.style = style as unknown as CSSStyleDeclaration;
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
    if (name === "style") {
      this.styleImplementation.clear();
      this.attributes.delete(name);
      return;
    }
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
  onStyleMutation: (element: FakeElement) => void = () => undefined;

  constructor(readonly normalizeStyleZeros = false) {
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

  observesAttribute(target: FakeElement, attributeName: string): boolean {
    return this.connected && this.observations.some(({ target: observed, options }) =>
      observed === target as unknown as Node &&
      options.attributes === true &&
      (!options.attributeFilter || options.attributeFilter.includes(attributeName))
    );
  }
}

function fixture(timing: Readonly<{
  enterTransitionMs?: number;
  retireTransitionMs?: number;
  paintTimeoutMs?: number;
  requestFrame?: (callback: FrameRequestCallback) => number | void;
  normalizeStyleZeros?: boolean;
  autoStyleMutationLimit?: number;
}> = {}) {
  const document = new FakeDocument(timing.normalizeStyleZeros === true);
  const window = new FakeWindow();
  document.defaultView = window;
  let observer: FakeMutationObserver | null = null;
  let styleMutationQueued = false;
  let styleMutationDeliveries = 0;
  document.onStyleMutation = (element) => {
    const limit = timing.autoStyleMutationLimit ?? 0;
    if (
      limit <= 0 ||
      styleMutationQueued ||
      styleMutationDeliveries >= limit ||
      !observer?.observesAttribute(element, "style")
    ) {
      return;
    }
    styleMutationQueued = true;
    queueMicrotask(() => {
      styleMutationQueued = false;
      if (
        styleMutationDeliveries >= limit ||
        !observer?.observesAttribute(element, "style")
      ) {
        return;
      }
      styleMutationDeliveries += 1;
      observer.mutate();
    });
  };
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
    styleMutationDeliveries: () => styleMutationDeliveries,
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
      phase: "begin",
      generation: 3,
      mode: "mobile",
      cause: "panel-suspend",
    })).toEqual({
      phase: "begin",
      generation: 3,
      mode: "mobile",
      cause: "panel-suspend",
    });
    expect(parseEmulationTransitionRequest({
      phase: "abort",
      generation: 3,
      cause: "restore",
    })).toEqual({ phase: "abort", generation: 3, cause: "restore" });
    expect(parseEmulationTransitionRequest({
      phase: "begin",
      generation: 4,
      mode: "mobile",
      cause: "refit",
      adoptExistingRefitGuard: true,
    })).toEqual({
      phase: "begin",
      generation: 4,
      mode: "mobile",
      cause: "refit",
      adoptExistingRefitGuard: true,
    });
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
      paintProof: "frame-two",
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

  it("adopts an active physical viewport guard when a refit worker missed its generation", async () => {
    const { guardian } = fixture();
    await guardian.handle(beginMobile);
    await guardian.handle(settleMobile);
    const physicalGuard = guardian.guardPhysicalViewportChange("mobile");

    expect(physicalGuard).toMatchObject({
      ok: true,
      generation: 2,
      stage: "guarding",
      guarded: true,
    });
    await expect(guardian.handle({
      phase: "begin",
      generation: 100,
      mode: "mobile",
      cause: "refit",
      adoptExistingRefitGuard: true,
    })).resolves.toMatchObject({
      ok: true,
      generation: 2,
      mode: "mobile",
      stage: "paint-proven",
      guarded: true,
      reason: "adopted-active-refit-guard",
    });
    expect(guardian.element()?.getAttribute(EMULATION_TRANSITION_GENERATION_ATTRIBUTE))
      .toBe("2");

    await expect(guardian.handle({
      phase: "settle",
      generation: 2,
      mode: "mobile",
      cause: "refit",
    })).resolves.toMatchObject({
      ok: true,
      generation: 2,
      stage: "idle",
      guarded: false,
    });
    expect(guardian.guardPhysicalViewportChange("mobile")).toMatchObject({
      ok: true,
      generation: 101,
      stage: "guarding",
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

  it("lets durable suspension supersede a lost guard and waits two native paint turns", async () => {
    let requestedFrames = 0;
    const { guardian } = fixture({
      requestFrame(callback) {
        requestedFrames += 1;
        queueMicrotask(() => callback(Date.now()));
        return requestedFrames;
      },
    });
    await guardian.handle({ ...beginMobile, cause: "panel-suspend" });
    const framesAfterBegin = requestedFrames;

    await expect(guardian.handle({
      phase: "release",
      generation: 2,
      cause: "panel-suspend",
    })).resolves.toMatchObject({
      ok: true,
      generation: 2,
      mode: null,
      stage: "released",
      guarded: false,
      coverage: false,
    });
    expect(requestedFrames - framesAfterBegin).toBe(2);
    expect(guardian.element()).toBeNull();
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

  it("admits a browser-owned physical guard synchronously and reuses its generation", async () => {
    const { document, guardian, onUnexpectedViewportChange } = fixture();
    await guardian.handle(beginMobile);
    await guardian.handle(settleMobile);
    const guard = guardian.element() as unknown as FakeElement;
    const hostile = document.createElement();
    document.documentElement.appendChild(hostile);

    expect(guardian.guardPhysicalViewportChange("mobile")).toMatchObject({
      ok: true,
      generation: 2,
      mode: "mobile",
      stage: "guarding",
      guarded: true,
      coverage: true,
      paintProof: "none",
      reason: "physical-viewport-guarded",
    });
    expect(document.documentElement.lastElementChild).toBe(guard);
    expect(guard.style.getPropertyValue("opacity")).toBe("1");
    expect(guard.style.getPropertyValue("pointer-events")).toBe("auto");
    expect(onUnexpectedViewportChange).not.toHaveBeenCalled();

    expect(guardian.guardPhysicalViewportChange("mobile")).toMatchObject({
      ok: true,
      generation: 2,
      stage: "guarding",
      guarded: true,
      coverage: true,
      reason: "already-guarded",
    });
    expect(guardian.guardPhysicalViewportChange("desktop")).toMatchObject({
      ok: false,
      generation: 2,
      mode: "mobile",
      reason: "mode-mismatch",
      guarded: true,
      coverage: true,
    });
  });

  it("invalidates an older settle epoch without allowing it to fade the physical guard", async () => {
    const { guardian } = fixture();
    await guardian.handle(beginMobile);

    const staleSettle = guardian.handle(settleMobile);
    const admitted = guardian.guardPhysicalViewportChange("mobile");
    expect(admitted).toMatchObject({
      ok: true,
      generation: 2,
      stage: "guarding",
      guarded: true,
      coverage: true,
    });
    await expect(staleSettle).resolves.toMatchObject({
      ok: false,
      reason: "stale-generation",
      generation: 2,
      stage: "guarding",
      guarded: true,
      coverage: true,
    });
    expect(guardian.element()?.style.getPropertyValue("opacity")).toBe("1");
    expect(guardian.element()?.style.getPropertyValue("pointer-events")).toBe("auto");
  });

  it("absorbs viewport echoes while the current transition already owns the guard", async () => {
    const { guardian, window, onUnexpectedViewportChange } = fixture();
    await guardian.handle(beginMobile);
    expect(guardian.isGuarding()).toBe(true);

    window.visualViewport.height = 945;
    window.visualViewport.dispatch("resize");
    await Promise.resolve();

    expect(onUnexpectedViewportChange).not.toHaveBeenCalled();
    expect(guardian.current()).toMatchObject({
      generation: 1,
      stage: "paint-proven",
      guarded: true,
    });
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

  it("uses the strict guarded fallback when a visible renderer starves animation frames", async () => {
    vi.useFakeTimers();
    try {
      const { guardian } = fixture({
        paintTimeoutMs: 100,
        requestFrame: () => undefined,
      });
      let resolved = false;
      const pending = guardian.handle(beginMobile);
      void pending.then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(99);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(21);

      await expect(pending).resolves.toMatchObject({
        ok: true,
        stage: "paint-proven",
        guarded: true,
        coverage: true,
        paintProof: "guarded-fallback",
      });

      const settling = guardian.handle(settleMobile);
      await vi.advanceTimersByTimeAsync(120);
      await expect(settling).resolves.toMatchObject({
        ok: true,
        stage: "idle",
        guarded: false,
        exactGeometry: true,
        paintProof: "guarded-fallback",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a starved fallback whose guard does not cover the viewport", async () => {
    vi.useFakeTimers();
    try {
      const { guardian } = fixture({
        paintTimeoutMs: 100,
        requestFrame: () => undefined,
      });
      const pending = guardian.handle(beginMobile);
      const guard = guardian.element()!;
      vi.spyOn(guard, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 411,
        bottom: 959,
        width: 411,
        height: 959,
        toJSON: () => ({}),
      } as DOMRect);

      await vi.advanceTimersByTimeAsync(120);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        stage: "rejected",
        reason: "guard-paint-proof-failed",
        guarded: true,
        coverage: false,
        paintProof: "none",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a starved fallback mask inexact settled geometry", async () => {
    vi.useFakeTimers();
    try {
      const { guardian, window } = fixture({
        paintTimeoutMs: 100,
        requestFrame: () => undefined,
      });
      const beginning = guardian.handle(beginMobile);
      await vi.advanceTimersByTimeAsync(120);
      await expect(beginning).resolves.toMatchObject({
        ok: true,
        paintProof: "guarded-fallback",
      });

      window.visualViewport.scale = 1.01;
      const settling = guardian.handle(settleMobile);
      await vi.advanceTimersByTimeAsync(120);

      await expect(settling).resolves.toMatchObject({
        ok: false,
        stage: "rejected",
        reason: "settle-proof-failed",
        guarded: true,
        coverage: true,
        exactGeometry: false,
        paintProof: "none",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never grants the starvation fallback while the document is hidden", async () => {
    vi.useFakeTimers();
    try {
      const { document, guardian } = fixture({
        paintTimeoutMs: 100,
        requestFrame: () => undefined,
      });
      document.visibilityState = "hidden";
      const pending = guardian.handle(beginMobile);

      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        stage: "rejected",
        reason: "guard-paint-proof-failed",
        guarded: true,
        coverage: false,
        paintProof: "none",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot let an older starved proof acknowledge a newer generation", async () => {
    vi.useFakeTimers();
    try {
      const { guardian } = fixture({
        paintTimeoutMs: 100,
        requestFrame: () => undefined,
      });
      const older = guardian.handle(beginMobile);
      await vi.advanceTimersByTimeAsync(40);
      const newer = guardian.handle({ ...beginMobile, generation: 2 });

      await vi.advanceTimersByTimeAsync(130);

      await expect(older).resolves.toMatchObject({
        ok: false,
        reason: "stale-generation",
        generation: 2,
        paintProof: "none",
      });
      await expect(newer).resolves.toMatchObject({
        ok: true,
        generation: 2,
        stage: "paint-proven",
        paintProof: "guarded-fallback",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not roll back exact settle when only the retire frame is starved", async () => {
    vi.useFakeTimers();
    try {
      let requestedFrames = 0;
      const { guardian } = fixture({
        retireTransitionMs: 96,
        requestFrame(callback) {
          requestedFrames += 1;
          if (requestedFrames <= 4) callback(Date.now());
          return requestedFrames;
        },
      });
      await expect(guardian.handle(beginMobile)).resolves.toMatchObject({
        ok: true,
        paintProof: "frame-two",
      });

      const settling = guardian.handle(settleMobile);
      await vi.advanceTimersByTimeAsync(116);

      await expect(settling).resolves.toMatchObject({
        ok: true,
        stage: "idle",
        guarded: false,
        exactGeometry: true,
        paintProof: "frame-two",
      });
      expect(guardian.element()?.style.getPropertyValue("opacity")).toBe("0");
      expect(guardian.element()?.style.getPropertyValue("pointer-events")).toBe("none");
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

  it("does not recurse when CSSOM normalizes zero-length declarations", async () => {
    const { guardian, styleMutationDeliveries } = fixture({
      enterTransitionMs: 1,
      normalizeStyleZeros: true,
      autoStyleMutationLimit: 32,
    });

    await expect(guardian.handle(beginMobile)).resolves.toMatchObject({
      ok: true,
      stage: "paint-proven",
      coverage: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    const style = (guardian.element() as unknown as FakeElement).styleImplementation;
    const writesAfterBegin = style.writeCount;
    guardian.refresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(style.getPropertyValue("inset")).toBe("0px");
    expect(style.writeCount).toBe(writesAfterBegin);
    expect(styleMutationDeliveries()).toBeLessThan(4);
  });

  it("repairs hostile inline style through one self-suppressed observer delivery", async () => {
    const { guardian, styleMutationDeliveries } = fixture({
      normalizeStyleZeros: true,
      autoStyleMutationLimit: 32,
    });
    await guardian.handle(beginMobile);
    await Promise.resolve();
    const guard = guardian.element() as unknown as FakeElement;
    const deliveriesBeforeTamper = styleMutationDeliveries();

    guard.styleImplementation.setProperty("opacity", "0", "important");
    guard.styleImplementation.setProperty("top", "100px", "important");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(styleMutationDeliveries() - deliveriesBeforeTamper).toBe(1);
    expect(guard.styleImplementation.getPropertyValue("opacity")).toBe("1");
    expect(guard.styleImplementation.getPropertyValue("top")).toBe("");
    expect(guardian.current()).toMatchObject({
      stage: "paint-proven",
      guarded: true,
      coverage: true,
    });
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

  it("settles exact mobile geometry when classic scrollbars enlarge window.inner dimensions", async () => {
    const { document, guardian, window } = fixture();
    window.innerWidth = 417;
    window.innerHeight = 972;
    document.documentElement.clientWidth = 412;
    document.documentElement.clientHeight = 960;

    await expect(guardian.handle(beginMobile)).resolves.toMatchObject({ ok: true });
    await expect(guardian.handle(settleMobile)).resolves.toMatchObject({
      ok: true,
      exactGeometry: true,
      guarded: false,
      measured: {
        innerWidth: 417,
        innerHeight: 972,
        documentClientWidth: 412,
        documentClientHeight: 960,
        visualViewportWidth: 412,
        visualViewportHeight: 960,
      },
    });
  });

  it.each([
    ["document-client width", ({ document }: ReturnType<typeof fixture>) => {
      document.documentElement.clientWidth = 411;
    }],
    ["visual viewport height", ({ window }: ReturnType<typeof fixture>) => {
      window.visualViewport.height = 959;
    }],
    ["screen width", ({ window }: ReturnType<typeof fixture>) => {
      window.screen = { width: 411, height: 960 };
    }],
    ["page scale", ({ window }: ReturnType<typeof fixture>) => {
      window.visualViewport.scale = 1.01;
    }],
  ])("rejects mobile settle with inexact %s", async (_label, makeInexact) => {
    const current = fixture({ paintTimeoutMs: 100 });
    current.window.innerWidth = 417;
    current.window.innerHeight = 972;
    makeInexact(current);

    await expect(current.guardian.handle(beginMobile)).resolves.toMatchObject({ ok: true });
    await expect(current.guardian.handle(settleMobile)).resolves.toMatchObject({
      ok: false,
      reason: "settle-proof-failed",
      exactGeometry: false,
      guarded: true,
      coverage: true,
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
