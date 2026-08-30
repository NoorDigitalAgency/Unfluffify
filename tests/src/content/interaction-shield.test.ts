import { describe, expect, it, vi } from "vitest";

import {
  EXTENSION_UI_ATTRIBUTE,
  INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE,
  INTERACTION_SHIELD_ATTRIBUTE,
  MAXIMUM_DOCUMENT_Z_INDEX,
  OPEN_SHADOW_ATTACHED_EVENT,
  createInteractionShield,
} from "../../../src/content/interaction-shield";
import {
  restoreInteractionShieldInertForCapture,
  restoreInteractionShieldStyleForCapture,
} from "../../../src/content/interaction-shield-capture";
import { CONTENT_INPUT_EVENTS } from "../../../src/content/input-firewall";

type ListenerRecord = Readonly<{
  listener: EventListenerOrEventListenerObject;
  capture: boolean;
}>;

function captureOf(options?: boolean | AddEventListenerOptions): boolean {
  return typeof options === "boolean" ? options : options?.capture === true;
}

class FakeEventTarget {
  private readonly listeners = new Map<string, ListenerRecord[]>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!listener) {
      return;
    }
    const records = this.listeners.get(type) ?? [];
    if (!records.some((record) =>
      record.listener === listener && record.capture === captureOf(options)
    )) {
      records.push({ listener, capture: captureOf(options) });
      this.listeners.set(type, records);
    }
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (!listener) {
      return;
    }
    const capture = captureOf(options);
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((record) =>
      record.listener !== listener || record.capture !== capture
    ));
  }

  dispatch(type: string, event: Event): void {
    for (const { listener } of [...this.listeners.get(type) ?? []]) {
      if (typeof listener === "function") {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

class FakeStyle {
  private readonly values = new Map<string, Readonly<{ value: string; priority: string }>>();
  setPropertyCount = 0;

  constructor(private readonly onMutation: (cssText: string) => void) {}

  private commit(): void {
    this.onMutation([...this.values].map(([property, declaration]) =>
      `${property}: ${declaration.value}${declaration.priority ? ` !${declaration.priority}` : ""}`
    ).join("; "));
  }

  getPropertyValue(property: string): string {
    if (property === "all" && [...this.values.keys()].some((key) => key !== "all")) {
      return "";
    }
    return this.values.get(property)?.value ?? "";
  }

  getPropertyPriority(property: string): string {
    if (property === "all" && [...this.values.keys()].some((key) => key !== "all")) {
      return this.values.get(property)?.priority ?? "";
    }
    return this.values.get(property)?.priority ?? "";
  }

  setProperty(property: string, value: string, priority = ""): void {
    this.setPropertyCount += 1;
    if (property === "all") {
      this.values.clear();
    }
    this.values.set(property, { value, priority });
    this.commit();
  }

  removeProperty(property: string): string {
    const previous = this.getPropertyValue(property);
    this.values.delete(property);
    this.commit();
    return previous;
  }
}

class FakeElement extends FakeEventTarget {
  readonly nodeType = 1;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: FakeStyle;
  parentElement: FakeElement | null = null;
  clientWidth = 1_024;
  clientHeight = 768;
  scrollWidth = 1_024;
  scrollHeight = 2_000;
  scrollLeft = 0;
  scrollTop = 0;
  shadowRoot: FakeElement | null = null;
  fullscreenElement: FakeElement | null = null;
  mode: ShadowRootMode = "open";
  host: FakeElement | null = null;
  hitTestElements: FakeElement[] = [];

  constructor(readonly tagName: string) {
    super();
    this.style = new FakeStyle((cssText) => this.attributes.set("style", cssText));
  }

  get isConnected(): boolean {
    if (this.tagName === "HTML") {
      return true;
    }
    let parent = this.parentElement;
    while (parent) {
      if (parent.tagName === "HTML") {
        return true;
      }
      if (parent.tagName === "#SHADOW-ROOT") {
        return parent.host?.isConnected === true;
      }
      parent = parent.parentElement;
    }
    return false;
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

  attachShadow(): FakeElement {
    const root = new FakeElement("#SHADOW-ROOT");
    root.host = this;
    this.shadowRoot = root;
    return root;
  }

  getRootNode(): FakeElement {
    return this.parentElement?.getRootNode() ?? this;
  }

  elementsFromPoint(): FakeElement[] {
    return this.hitTestElements;
  }

  contains(candidate: FakeElement): boolean {
    if (candidate === this) {
      return true;
    }
    return this.children.some((child) => child.contains(candidate));
  }

  remove(): void {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  scrollTo(options: ScrollToOptions): void {
    this.scrollLeft = Number(options.left ?? this.scrollLeft);
    this.scrollTop = Number(options.top ?? this.scrollTop);
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: this.clientHeight,
      height: this.clientHeight,
      left: 0,
      right: this.clientWidth,
      top: 0,
      width: this.clientWidth,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const match = /^\[([^=]+)="([^"]+)"\]$/.exec(selector);
    const found: FakeElement[] = [];
    for (const child of this.children) {
      const pseudoMatch = selector === ":popover-open"
        ? child.getAttribute("data-fake-popover-open") === "true"
        : selector === "dialog:modal"
          ? child.tagName === "DIALOG" && child.getAttribute("data-fake-modal-open") === "true"
          : false;
      if (selector === "*" || (match && child.getAttribute(match[1]!) === match[2]) || pseudoMatch) {
        found.push(child);
      }
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
}

class FakeVisualViewport extends FakeEventTarget {
  offsetLeft = 0;
  offsetTop = 0;
  width = 390;
  height = 844;
}

class FakeWindow extends FakeEventTarget {
  innerWidth = 1_024;
  innerHeight = 768;
  visualViewport: FakeVisualViewport | undefined = new FakeVisualViewport();
  private animationFrames: FrameRequestCallback[] = [];
  private tasks: Array<() => void> = [];

  queueMicrotask(callback: VoidFunction): void {
    queueMicrotask(callback);
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    this.animationFrames.push(callback);
    return this.animationFrames.length;
  }

  flushAnimationFrames(): void {
    const frames = this.animationFrames.splice(0);
    for (const callback of frames) {
      callback(0);
    }
  }

  setTimeout(callback: () => void): number {
    this.tasks.push(callback);
    return this.tasks.length;
  }

  getComputedStyle(element: FakeElement): Pick<CSSStyleDeclaration, "overflowY"> {
    return { overflowY: element.getAttribute("data-fake-overflow-y") ?? "visible" };
  }

  flushTasks(): void {
    const tasks = this.tasks.splice(0);
    for (const callback of tasks) {
      callback();
    }
  }
}

class FakeDocument extends FakeEventTarget {
  readonly documentElement = new FakeElement("HTML");
  readonly scrollingElement = this.documentElement;
  hitTestElements: FakeElement[] = [];
  fullscreenElement: FakeElement | null = null;

  constructor(readonly defaultView: FakeWindow) {
    super();
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toUpperCase());
  }

  querySelectorAll<T extends Element>(selector: string): T[] {
    return this.documentElement.querySelectorAll(selector) as unknown as T[];
  }

  elementsFromPoint(): FakeElement[] {
    return this.hitTestElements;
  }
}

class FakeMutationObserver {
  readonly observations: Array<Readonly<{ target: Node; options: MutationObserverInit }>> = [];
  disconnectCount = 0;

  constructor(private readonly callback: MutationCallback) {}

  observe(target: Node, options: MutationObserverInit): void {
    this.observations.push({ target, options });
  }

  disconnect(): void {
    this.disconnectCount += 1;
    this.observations.length = 0;
  }

  trigger(records: MutationRecord[] = []): void {
    this.callback(records, this as unknown as MutationObserver);
  }
}

type Harness = Readonly<{
  document: FakeDocument;
  window: FakeWindow;
  observers: FakeMutationObserver[];
  createElement: (tagName?: string) => FakeElement;
}>;

function harness(): Harness {
  const window = new FakeWindow();
  const document = new FakeDocument(window);
  const observers: FakeMutationObserver[] = [];
  return {
    document,
    window,
    observers,
    createElement: (tagName = "div") => document.createElement(tagName),
  };
}

function asDocument(document: FakeDocument): Document {
  return document as unknown as Document;
}

function asWindow(window: FakeWindow): Window {
  return window as unknown as Window;
}

function asElement(element: FakeElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function styleOf(element: FakeElement, property: string): readonly [string, string] {
  return [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)];
}

function inputEvent(
  type: string,
  path: readonly FakeEventTarget[],
  options: Readonly<{
    cancelable?: boolean;
    pointerType?: string;
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    pointerId?: number;
    clientX?: number;
    clientY?: number;
    isTrusted?: boolean;
    touches?: ReadonlyArray<Readonly<{
      identifier: number;
      clientX: number;
      clientY: number;
    }>>;
    changedTouches?: ReadonlyArray<Readonly<{
      identifier: number;
      clientX: number;
      clientY: number;
    }>>;
  }> = {},
) {
  return {
    type,
    cancelable: options.cancelable ?? true,
    pointerType: options.pointerType,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    pointerId: options.pointerId ?? 1,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    isTrusted: options.isTrusted ?? true,
    touches: options.touches ?? [],
    changedTouches: options.changedTouches ?? [],
    target: path[0] ?? null,
    composedPath: () => path,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

describe("interaction shield controller", () => {
  it("holds idempotent reason leases and tears every listener down explicitly", () => {
    const context = harness();
    const body = context.createElement("body");
    context.document.documentElement.appendChild(body);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });

    expect(controller.activate("silent-highlighting")).toBe(true);
    expect(controller.activate("silent-highlighting")).toBe(false);
    expect(controller.activate("preview")).toBe(true);
    expect(controller.reasons()).toEqual(["silent-highlighting", "preview"]);
    expect(controller.isActive()).toBe(true);
    expect(context.observers).toHaveLength(1);
    for (const type of CONTENT_INPUT_EVENTS) {
      expect(context.window.listenerCount(type)).toBe(1);
    }

    const shield = controller.element() as unknown as FakeElement;
    expect(shield.getAttribute(INTERACTION_SHIELD_ATTRIBUTE)).toBe("true");
    expect(shield.getAttribute(EXTENSION_UI_ATTRIBUTE)).toBe("true");
    expect(shield.getAttribute("aria-hidden")).toBe("true");
    expect(shield.getAttribute("role")).toBeNull();
    expect(shield.getAttribute("tabindex")).toBeNull();
    expect(styleOf(shield, "position")).toEqual(["fixed", "important"]);
    expect(styleOf(shield, "all")).toEqual(["", ""]);
    expect(styleOf(shield, "pointer-events")).toEqual(["auto", "important"]);
    expect(styleOf(shield, "max-width")).toEqual(["none", "important"]);
    expect(styleOf(shield, "max-height")).toEqual(["none", "important"]);
    expect(styleOf(shield, "transform")).toEqual(["none", "important"]);
    expect(styleOf(shield, "clip-path")).toEqual(["none", "important"]);
    expect(styleOf(shield, "touch-action")).toEqual(["pan-x pan-y pinch-zoom", "important"]);
    expect(styleOf(shield, "z-index")).toEqual([MAXIMUM_DOCUMENT_Z_INDEX, "important"]);

    expect(controller.deactivate("missing")).toBe(false);
    expect(controller.deactivate("silent-highlighting")).toBe(true);
    expect(controller.element()).toBe(asElement(shield));
    const disconnectsBeforeRelease = context.observers[0]!.disconnectCount;
    expect(controller.deactivate("preview")).toBe(true);
    expect(controller.isActive()).toBe(false);
    expect(controller.element()).toBeNull();
    expect(shield.isConnected).toBe(false);
    // The capture firewall stays registered—but inert—between leases so a page
    // cannot install an earlier window listener before the next activation.
    for (const type of CONTENT_INPUT_EVENTS) {
      expect(context.window.listenerCount(type)).toBe(1);
    }
    expect(context.window.listenerCount("resize")).toBe(0);
    expect(context.window.listenerCount("orientationchange")).toBe(0);
    expect(context.observers[0]!.disconnectCount).toBe(disconnectsBeforeRelease + 1);
    expect(context.observers[0]!.observations).toEqual([]);

    controller.dispose();
    controller.dispose();
    for (const type of CONTENT_INPUT_EVENTS) {
      expect(context.window.listenerCount(type)).toBe(0);
    }
    expect(controller.activate("after-dispose")).toBe(false);
    expect(controller.registerExtensionSurface(asElement(context.createElement()))).toBeTypeOf("function");
    expect(controller.isActive()).toBe(false);
  });

  it("installs the inert capture firewall before later page listeners", () => {
    const context = harness();
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });
    const pageListener = vi.fn();
    context.window.addEventListener("click", pageListener as EventListener, true);
    controller.activate("preview");
    const shield = controller.element() as unknown as FakeElement;
    const click = inputEvent("click", [shield, context.document.documentElement, context.window]);

    context.window.dispatch("click", click as unknown as Event);

    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(click.stopImmediatePropagation.mock.invocationCallOrder[0])
      .toBeLessThan(pageListener.mock.invocationCallOrder[0]!);

    controller.suspend();
    expect(controller.element()).toBeNull();
    expect(context.window.listenerCount("click")).toBe(2);
    controller.refresh();
    const restoredShield = controller.element() as unknown as FakeElement;
    const restoredClick = inputEvent(
      "click",
      [restoredShield, context.document.documentElement, context.window],
    );
    context.window.dispatch("click", restoredClick as unknown as Event);
    expect(restoredClick.stopImmediatePropagation.mock.invocationCallOrder[0])
      .toBeLessThan(pageListener.mock.invocationCallOrder.at(-1)!);
  });

  it("tracks visualViewport resize and scroll without retaining listeners after release", () => {
    const context = harness();
    const viewport = context.window.visualViewport!;
    viewport.offsetLeft = 12;
    viewport.offsetTop = 34;
    viewport.width = 360;
    viewport.height = 640;
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });
    controller.activate("preview");
    const shield = controller.element() as unknown as FakeElement;

    expect(styleOf(shield, "left")).toEqual(["12px", "important"]);
    expect(styleOf(shield, "top")).toEqual(["34px", "important"]);
    expect(styleOf(shield, "width")).toEqual(["360px", "important"]);
    expect(styleOf(shield, "height")).toEqual(["640px", "important"]);
    expect(viewport.listenerCount("resize")).toBe(1);
    expect(viewport.listenerCount("scroll")).toBe(1);

    viewport.offsetLeft = 20;
    viewport.offsetTop = 55;
    viewport.width = 320;
    viewport.height = 580;
    viewport.dispatch("scroll", { type: "scroll" } as Event);
    expect(styleOf(shield, "left")).toEqual(["20px", "important"]);
    expect(styleOf(shield, "top")).toEqual(["55px", "important"]);
    viewport.dispatch("resize", { type: "resize" } as Event);
    expect(styleOf(shield, "width")).toEqual(["320px", "important"]);
    expect(styleOf(shield, "height")).toEqual(["580px", "important"]);

    controller.deactivate("preview");
    expect(viewport.listenerCount("resize")).toBe(0);
    expect(viewport.listenerCount("scroll")).toBe(0);
    viewport.width = 100;
    viewport.dispatch("resize", { type: "resize" } as Event);
    expect(styleOf(shield, "width")).toEqual(["320px", "important"]);
  });

  it("remeasures an active shield when emulation changes without a viewport event", () => {
    const context = harness();
    const viewport = context.window.visualViewport!;
    viewport.width = 412;
    viewport.height = 960;
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;

    expect(styleOf(shield, "width")).toEqual(["412px", "important"]);
    expect(styleOf(shield, "height")).toEqual(["960px", "important"]);

    // CDP has changed the viewport, but neither resize listener fired.
    viewport.width = 1_920;
    viewport.height = 1_080;
    expect(styleOf(shield, "width")).toEqual(["412px", "important"]);
    expect(styleOf(shield, "height")).toEqual(["960px", "important"]);

    controller.refresh();
    expect(styleOf(shield, "width")).toEqual(["1920px", "important"]);
    expect(styleOf(shield, "height")).toEqual(["1080px", "important"]);

    viewport.width = 412;
    viewport.height = 960;
    controller.refresh();
    expect(styleOf(shield, "width")).toEqual(["412px", "important"]);
    expect(styleOf(shield, "height")).toEqual(["960px", "important"]);
  });

  it("keeps stable shield styling idempotent and ignores root presentation churn", async () => {
    const context = harness();
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;
    const observer = context.observers[0]!;
    const writesAfterMount = shield.style.setPropertyCount;

    controller.refresh();
    expect(shield.style.setPropertyCount).toBe(writesAfterMount);

    const disconnectsAfterRefresh = observer.disconnectCount;
    observer.trigger([{
      type: "attributes",
      target: context.document.documentElement,
      attributeName: "class",
    } as MutationRecord]);
    await Promise.resolve();
    expect(observer.disconnectCount).toBe(disconnectsAfterRefresh);
    expect(shield.style.setPropertyCount).toBe(writesAfterMount);
  });

  it("retains an active lease until a document-start root becomes available", () => {
    const context = harness();
    const root = context.document.documentElement;
    (context.document as unknown as { documentElement: FakeElement | null }).documentElement = null;
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });

    expect(controller.activate("durable-posture")).toBe(true);
    expect(controller.isActive()).toBe(true);
    expect(controller.element()).toBeNull();

    (context.document as unknown as { documentElement: FakeElement | null }).documentElement = root;
    controller.refresh();
    expect(controller.element()).not.toBeNull();
    expect((controller.element() as unknown as FakeElement).isConnected).toBe(true);
  });

  it("blocks page and shield input, preserves native pan, and isolates extension controls", () => {
    const context = harness();
    const page = context.createElement("main");
    const extension = context.createElement();
    const extensionControl = context.createElement("button");
    extension.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    extension.appendChild(extensionControl);
    context.document.documentElement.appendChild(page);
    context.document.documentElement.appendChild(extension);
    const onShieldInput = vi.fn();
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => [asElement(extension)],
      onShieldInput,
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;

    for (const target of [page, shield]) {
      const click = inputEvent("click", [target, context.document.documentElement, context.window]);
      context.window.dispatch("click", click as unknown as Event);
      expect(click.preventDefault).toHaveBeenCalledOnce();
      expect(click.stopPropagation).toHaveBeenCalledOnce();
      expect(click.stopImmediatePropagation).toHaveBeenCalledOnce();
    }
    expect(onShieldInput).toHaveBeenCalledOnce();
    expect(onShieldInput).toHaveBeenCalledWith(expect.objectContaining({ type: "click" }));

    onShieldInput.mockClear();
    const syntheticShieldClick = inputEvent(
      "click",
      [shield, context.document.documentElement, context.window],
      { isTrusted: false },
    );
    context.window.dispatch("click", syntheticShieldClick as unknown as Event);
    expect(onShieldInput).not.toHaveBeenCalled();
    expect(syntheticShieldClick.preventDefault).toHaveBeenCalledOnce();
    expect(syntheticShieldClick.stopImmediatePropagation).toHaveBeenCalledOnce();

    context.document.scrollingElement.scrollTop = 100;
    const syntheticWheel = inputEvent(
      "wheel",
      [shield, context.document.documentElement, context.window],
      { deltaY: 240, isTrusted: false },
    );
    context.window.dispatch("wheel", syntheticWheel as unknown as Event);
    context.window.flushTasks();
    expect(context.document.scrollingElement.scrollTop).toBe(100);

    const wheel = inputEvent(
      "wheel",
      [shield, context.document.documentElement, context.window],
      { deltaY: 240 },
    );
    context.window.dispatch("wheel", wheel as unknown as Event);
    expect(wheel.preventDefault).not.toHaveBeenCalled();
    expect(wheel.stopPropagation).toHaveBeenCalledOnce();
    expect(wheel.stopImmediatePropagation).toHaveBeenCalledOnce();
    context.window.flushTasks();
    expect(context.document.scrollingElement.scrollTop).toBe(340);

    const nativeWheel = inputEvent(
      "wheel",
      [shield, context.document.documentElement, context.window],
      { deltaY: 240 },
    );
    context.window.dispatch("wheel", nativeWheel as unknown as Event);
    context.document.scrollingElement.scrollTop = 580;
    context.window.flushTasks();
    expect(context.document.scrollingElement.scrollTop).toBe(580);

    const touchPointer = inputEvent(
      "pointermove",
      [shield, context.document.documentElement, context.window],
      { pointerType: "touch" },
    );
    context.window.dispatch("pointermove", touchPointer as unknown as Event);
    expect(touchPointer.preventDefault).not.toHaveBeenCalled();
    expect(touchPointer.stopPropagation).toHaveBeenCalledOnce();

    const extensionClick = inputEvent(
      "click",
      [extensionControl, extension, context.document.documentElement, context.window],
    );
    context.window.dispatch("click", extensionClick as unknown as Event);
    expect(extensionClick.preventDefault).not.toHaveBeenCalled();
    expect(extensionClick.stopPropagation).not.toHaveBeenCalled();
    expect(extensionClick.stopImmediatePropagation).not.toHaveBeenCalled();
    extension.dispatch("click", extensionClick as unknown as Event);
    expect(extensionClick.stopPropagation).toHaveBeenCalledOnce();
    expect(extensionClick.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(extensionClick.preventDefault).not.toHaveBeenCalled();

    const syntheticExtensionClick = inputEvent(
      "click",
      [extensionControl, extension, context.document.documentElement, context.window],
      { isTrusted: false },
    );
    context.window.dispatch("click", syntheticExtensionClick as unknown as Event);
    expect(syntheticExtensionClick.preventDefault).toHaveBeenCalledOnce();
    expect(syntheticExtensionClick.stopPropagation).toHaveBeenCalledOnce();
    expect(syntheticExtensionClick.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("privileges trusted controls nested inside a passive input boundary", () => {
    const context = harness();
    const boundary = context.createElement();
    const passiveCard = context.createElement();
    const trustedButton = context.createElement("button");
    boundary.appendChild(passiveCard);
    boundary.appendChild(trustedButton);
    context.document.documentElement.appendChild(boundary);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => [asElement(boundary)],
      inputBoundarySurfaces: () => [asElement(boundary)],
      privilegedExtensionTargets: () => [asElement(trustedButton)],
    });
    controller.activate("page-visit-inspection");

    for (const type of ["click", "keydown"] as const) {
      const trusted = inputEvent(type, [
        trustedButton,
        boundary,
        context.document.documentElement,
        context.window,
      ]);
      context.window.dispatch(type, trusted as unknown as Event);
      expect(trusted.preventDefault).not.toHaveBeenCalled();
      expect(trusted.stopImmediatePropagation).not.toHaveBeenCalled();

      const passive = inputEvent(type, [
        passiveCard,
        boundary,
        context.document.documentElement,
        context.window,
      ]);
      context.window.dispatch(type, passive as unknown as Event);
      expect(passive.stopImmediatePropagation).toHaveBeenCalledOnce();
    }

    const syntheticClick = inputEvent("click", [
      trustedButton,
      boundary,
      context.document.documentElement,
      context.window,
    ], { isTrusted: false });
    context.window.dispatch("click", syntheticClick as unknown as Event);
    expect(syntheticClick.preventDefault).toHaveBeenCalledOnce();
    expect(syntheticClick.stopImmediatePropagation).toHaveBeenCalledOnce();

    controller.dispose();
  });

  it("blocks native wheel and touch movement only while an inspection owns scroll", () => {
    const context = harness();
    context.document.documentElement.appendChild(context.createElement("main"));
    let inspectionActive = true;
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      blockNativeScroll: () => inspectionActive,
    });
    controller.activate("page-visit-inspection");
    const shield = controller.element() as unknown as FakeElement;
    context.document.scrollingElement.scrollTop = 100;

    const blockedWheel = inputEvent(
      "wheel",
      [shield, context.document.documentElement, context.window],
      { deltaY: 240 },
    );
    context.window.dispatch("wheel", blockedWheel as unknown as Event);
    context.window.flushTasks();
    expect(blockedWheel.preventDefault).toHaveBeenCalledOnce();
    expect(context.document.scrollingElement.scrollTop).toBe(100);

    const blockedTouch = inputEvent(
      "pointermove",
      [shield, context.document.documentElement, context.window],
      { pointerType: "touch" },
    );
    context.window.dispatch("pointermove", blockedTouch as unknown as Event);
    expect(blockedTouch.preventDefault).toHaveBeenCalledOnce();

    inspectionActive = false;
    const allowedWheel = inputEvent(
      "wheel",
      [shield, context.document.documentElement, context.window],
      { deltaY: 240 },
    );
    context.window.dispatch("wheel", allowedWheel as unknown as Event);
    context.window.flushTasks();
    expect(allowedWheel.preventDefault).not.toHaveBeenCalled();
    expect(context.document.scrollingElement.scrollTop).toBe(340);
  });

  it("applies shield input policy to passive curtain surfaces above the shield", () => {
    const context = harness();
    const curtain = context.createElement("section");
    const spinner = context.createElement("span");
    curtain.appendChild(spinner);
    context.document.documentElement.appendChild(curtain);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => [asElement(curtain)],
      inputBoundarySurfaces: () => [asElement(curtain)],
      blockNativeScroll: () => true,
    });
    controller.activate("page-visit-inspection");
    context.document.scrollingElement.scrollTop = 100;

    expect(curtain.getAttribute(INTERACTION_SHIELD_INPUT_BOUNDARY_ATTRIBUTE)).toBe("true");
    const wheel = inputEvent(
      "wheel",
      [spinner, curtain, context.document.documentElement, context.window],
      { deltaY: 200 },
    );
    context.window.dispatch("wheel", wheel as unknown as Event);
    context.window.flushTasks();
    expect(wheel.preventDefault).toHaveBeenCalledOnce();
    expect(context.document.scrollingElement.scrollTop).toBe(100);

    const touch = inputEvent(
      "pointermove",
      [spinner, curtain, context.document.documentElement, context.window],
      { pointerType: "touch", pointerId: 3, clientY: 200 },
    );
    context.window.dispatch("pointermove", touch as unknown as Event);
    expect(touch.preventDefault).toHaveBeenCalledOnce();
    expect(touch.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("neutralizes page-owned top layers opened before or after activation and restores authored input", async () => {
    const context = harness();
    const extensionRoot = context.createElement();
    const extensionPopover = context.createElement();
    extensionPopover.setAttribute("data-fake-popover-open", "true");
    extensionRoot.attachShadow().appendChild(extensionPopover);
    const existingPopover = context.createElement();
    existingPopover.setAttribute("data-fake-popover-open", "true");
    existingPopover.style.setProperty("display", "grid", "important");
    existingPopover.style.setProperty("pointer-events", "auto", "important");
    context.document.documentElement.appendChild(existingPopover);
    context.document.documentElement.appendChild(extensionRoot);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => [asElement(extensionRoot)],
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });

    controller.activate("preview");
    expect(styleOf(existingPopover, "display")).toEqual(["none", "important"]);
    expect(styleOf(existingPopover, "pointer-events")).toEqual(["none", "important"]);
    expect(existingPopover.getAttribute("inert")).toBe("");
    expect(restoreInteractionShieldStyleForCapture(
      existingPopover as unknown as Element,
      "display: none !important; pointer-events: none !important",
    )).toBe("display: grid !important; pointer-events: auto !important");
    expect(restoreInteractionShieldInertForCapture(existingPopover as unknown as Element)).toBeNull();
    expect(styleOf(extensionPopover, "pointer-events")).toEqual(["", ""]);
    expect(context.document.listenerCount("beforetoggle")).toBe(1);
    expect(context.document.listenerCount("toggle")).toBe(1);

    const latePopover = context.createElement();
    latePopover.setAttribute("data-fake-popover-open", "true");
    context.document.documentElement.appendChild(latePopover);
    context.document.dispatch("beforetoggle", {
      type: "beforetoggle",
      target: latePopover,
      newState: "open",
    } as unknown as Event);
    await Promise.resolve();
    expect(styleOf(latePopover, "display")).toEqual(["none", "important"]);
    expect(styleOf(latePopover, "pointer-events")).toEqual(["none", "important"]);
    expect(latePopover.getAttribute("inert")).toBe("");

    latePopover.style.setProperty("display", "flex", "important");
    latePopover.style.setProperty("pointer-events", "auto", "important");
    latePopover.setAttribute("inert", "page-authored");
    context.observers[0]!.trigger();
    await Promise.resolve();
    expect(styleOf(latePopover, "display")).toEqual(["none", "important"]);
    expect(styleOf(latePopover, "pointer-events")).toEqual(["none", "important"]);
    expect(latePopover.getAttribute("inert")).toBe("page-authored");
    expect(restoreInteractionShieldStyleForCapture(
      latePopover as unknown as Element,
      "display: none !important; pointer-events: none !important",
    )).toBe("display: flex !important; pointer-events: auto !important");
    expect(restoreInteractionShieldInertForCapture(latePopover as unknown as Element))
      .toBe("page-authored");

    existingPopover.setAttribute("data-fake-popover-open", "false");
    context.document.dispatch("toggle", {
      type: "toggle",
      target: existingPopover,
      newState: "closed",
    } as unknown as Event);
    await Promise.resolve();
    expect(styleOf(existingPopover, "display")).toEqual(["grid", "important"]);
    expect(styleOf(existingPopover, "pointer-events")).toEqual(["auto", "important"]);
    expect(existingPopover.getAttribute("inert")).toBeNull();

    controller.dispose();
    expect(styleOf(latePopover, "display")).toEqual(["flex", "important"]);
    expect(styleOf(latePopover, "pointer-events")).toEqual(["auto", "important"]);
    expect(latePopover.hasAttribute("style")).toBe(true);
    expect(latePopover.getAttribute("inert")).toBe("page-authored");
    expect(context.document.listenerCount("beforetoggle")).toBe(0);
    expect(context.document.listenerCount("toggle")).toBe(0);
  });

  it("neutralizes accessible shadow and fullscreen top layers", async () => {
    const context = harness();
    const shadowHost = context.createElement();
    const shadowRoot = shadowHost.attachShadow();
    const shadowPopover = context.createElement();
    shadowPopover.setAttribute("data-fake-popover-open", "true");
    shadowRoot.appendChild(shadowPopover);
    const shadowFullscreen = context.createElement("figure");
    shadowRoot.appendChild(shadowFullscreen);
    shadowRoot.fullscreenElement = shadowFullscreen;
    const fullscreen = context.createElement("section");
    context.document.fullscreenElement = fullscreen;
    context.document.documentElement.appendChild(shadowHost);
    context.document.documentElement.appendChild(fullscreen);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });

    controller.activate("preview");
    expect(styleOf(shadowPopover, "display")).toEqual(["none", "important"]);
    expect(styleOf(shadowPopover, "pointer-events")).toEqual(["none", "important"]);
    expect(shadowPopover.getAttribute("inert")).toBe("");
    expect(styleOf(shadowFullscreen, "display")).toEqual(["none", "important"]);
    expect(styleOf(shadowFullscreen, "pointer-events")).toEqual(["none", "important"]);
    expect(styleOf(fullscreen, "display")).toEqual(["none", "important"]);
    expect(styleOf(fullscreen, "pointer-events")).toEqual(["none", "important"]);
    expect(fullscreen.getAttribute("inert")).toBe("");

    const lateHost = context.createElement();
    context.document.documentElement.appendChild(lateHost);
    const lateRoot = lateHost.attachShadow();
    const latePopover = context.createElement();
    latePopover.setAttribute("data-fake-popover-open", "true");
    lateRoot.appendChild(latePopover);
    context.document.dispatch(OPEN_SHADOW_ATTACHED_EVENT, {
      type: OPEN_SHADOW_ATTACHED_EVENT,
      target: lateHost,
    } as unknown as Event);
    await Promise.resolve();
    expect(styleOf(latePopover, "display")).toEqual(["none", "important"]);
    expect(styleOf(latePopover, "pointer-events")).toEqual(["none", "important"]);
    expect(latePopover.getAttribute("inert")).toBe("");

    controller.dispose();
    expect(styleOf(shadowPopover, "display")).toEqual(["", ""]);
    expect(styleOf(shadowPopover, "pointer-events")).toEqual(["", ""]);
    expect(shadowPopover.getAttribute("inert")).toBeNull();
    expect(styleOf(shadowFullscreen, "display")).toEqual(["", ""]);
    expect(styleOf(shadowFullscreen, "pointer-events")).toEqual(["", ""]);
    expect(styleOf(fullscreen, "display")).toEqual(["", ""]);
    expect(styleOf(fullscreen, "pointer-events")).toEqual(["", ""]);
    expect(fullscreen.getAttribute("inert")).toBeNull();
    expect(styleOf(latePopover, "display")).toEqual(["", ""]);
    expect(styleOf(latePopover, "pointer-events")).toEqual(["", ""]);
    expect(latePopover.getAttribute("inert")).toBeNull();
  });

  it("reasserts the trusted max-z suffix after page mutations and restores surface styles", async () => {
    const context = harness();
    const page = context.createElement("body");
    const providerSurface = context.createElement();
    const registeredSurface = context.createElement();
    providerSurface.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    providerSurface.style.setProperty("z-index", "17");
    registeredSurface.style.setProperty("z-index", "23", "important");
    context.document.documentElement.appendChild(page);
    context.document.documentElement.appendChild(providerSurface);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => [asElement(providerSurface)],
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });
    const unregister = controller.registerExtensionSurface(asElement(registeredSurface));
    controller.activate("preview");
    const shield = controller.element() as unknown as FakeElement;

    expect(context.document.documentElement.children.slice(-3)).toEqual([
      shield,
      providerSurface,
      registeredSurface,
    ]);
    expect(styleOf(providerSurface, "z-index")).toEqual([MAXIMUM_DOCUMENT_Z_INDEX, "important"]);
    expect(styleOf(registeredSurface, "z-index")).toEqual([MAXIMUM_DOCUMENT_Z_INDEX, "important"]);
    expect(registeredSurface.getAttribute(EXTENSION_UI_ATTRIBUTE)).toBe("true");
    expect(providerSurface.listenerCount("click")).toBe(1);
    expect(registeredSurface.listenerCount("click")).toBe(1);

    const lateMaximumPageLayer = context.createElement("aside");
    lateMaximumPageLayer.style.setProperty("z-index", MAXIMUM_DOCUMENT_Z_INDEX, "important");
    context.document.documentElement.appendChild(lateMaximumPageLayer);
    context.observers[0]!.trigger();
    await Promise.resolve();
    expect(context.document.documentElement.children.slice(-3)).toEqual([
      shield,
      providerSurface,
      registeredSurface,
    ]);
    expect(context.document.documentElement.children.indexOf(lateMaximumPageLayer)).toBeLessThan(
      context.document.documentElement.children.indexOf(shield),
    );

    shield.style.setProperty("pointer-events", "none");
    shield.style.setProperty("max-width", "1px", "important");
    shield.style.setProperty("transform", "scale(0)", "important");
    shield.style.setProperty("clip-path", "inset(100%)", "important");
    shield.removeAttribute(INTERACTION_SHIELD_ATTRIBUTE);
    shield.removeAttribute(EXTENSION_UI_ATTRIBUTE);
    shield.setAttribute("role", "button");
    shield.setAttribute("tabindex", "0");
    providerSurface.style.setProperty("z-index", "0");
    providerSurface.removeAttribute(EXTENSION_UI_ATTRIBUTE);
    registeredSurface.removeAttribute(EXTENSION_UI_ATTRIBUTE);
    shield.remove();
    const orphanedShield = context.createElement();
    orphanedShield.setAttribute(INTERACTION_SHIELD_ATTRIBUTE, "true");
    context.document.documentElement.appendChild(orphanedShield);
    context.observers[0]!.trigger();
    await Promise.resolve();
    expect(shield.isConnected).toBe(true);
    expect(orphanedShield.isConnected).toBe(false);
    expect(shield.getAttribute(INTERACTION_SHIELD_ATTRIBUTE)).toBe("true");
    expect(shield.getAttribute(EXTENSION_UI_ATTRIBUTE)).toBe("true");
    expect(shield.getAttribute("role")).toBeNull();
    expect(shield.getAttribute("tabindex")).toBeNull();
    expect(styleOf(shield, "pointer-events")).toEqual(["auto", "important"]);
    expect(styleOf(shield, "max-width")).toEqual(["none", "important"]);
    expect(styleOf(shield, "transform")).toEqual(["none", "important"]);
    expect(styleOf(shield, "clip-path")).toEqual(["none", "important"]);
    expect(styleOf(providerSurface, "z-index")).toEqual([MAXIMUM_DOCUMENT_Z_INDEX, "important"]);
    expect(providerSurface.getAttribute(EXTENSION_UI_ATTRIBUTE)).toBe("true");
    expect(registeredSurface.getAttribute(EXTENSION_UI_ATTRIBUTE)).toBe("true");
    expect(context.document.documentElement.children.slice(-3)).toEqual([
      shield,
      providerSurface,
      registeredSurface,
    ]);

    unregister();
    unregister();
    expect(styleOf(registeredSurface, "z-index")).toEqual(["23", "important"]);
    expect(registeredSurface.getAttribute(EXTENSION_UI_ATTRIBUTE)).toBeNull();
    expect(registeredSurface.listenerCount("click")).toBe(0);
    expect(context.document.documentElement.children.at(-2)).toBe(shield);
    expect(context.document.documentElement.children.at(-1)).toBe(providerSurface);
    controller.dispose();
    expect(styleOf(providerSurface, "z-index")).toEqual(["17", ""]);
    expect(providerSurface.getAttribute(EXTENSION_UI_ATTRIBUTE)).toBe("true");
    expect(styleOf(registeredSurface, "z-index")).toEqual(["23", "important"]);
    expect(providerSurface.listenerCount("click")).toBe(0);
    expect(shield.isConnected).toBe(false);
  });

  it("moves the owned shield and trusted surfaces to a replacement document root", async () => {
    const context = harness();
    const oldRoot = context.document.documentElement;
    const surface = context.createElement();
    oldRoot.appendChild(surface);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => [asElement(surface)],
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });
    controller.activate("preview");
    const shield = controller.element() as unknown as FakeElement;
    const replacementRoot = context.createElement("html");

    (context.document as unknown as { documentElement: FakeElement }).documentElement = replacementRoot;
    context.observers[0]!.trigger();
    await Promise.resolve();

    expect(replacementRoot.children).toEqual([shield, surface]);
    expect(shield.parentElement).toBe(replacementRoot);
    expect(surface.parentElement).toBe(replacementRoot);
    expect(oldRoot.children).toEqual([]);
    expect(context.observers[0]!.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: context.document,
        options: { childList: true },
      }),
      expect.objectContaining({ target: replacementRoot, options: { childList: true } }),
    ]));
  });

  it("removes orphaned shield artifacts without adopting them and refreshes trusted surfaces", () => {
    const context = harness();
    const stale = context.createElement();
    const duplicate = context.createElement();
    stale.setAttribute(INTERACTION_SHIELD_ATTRIBUTE, "true");
    duplicate.setAttribute(INTERACTION_SHIELD_ATTRIBUTE, "true");
    context.document.documentElement.appendChild(stale);
    context.document.documentElement.appendChild(duplicate);
    let callbackSurfaces: HTMLElement[] = [];
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => callbackSurfaces,
    });
    controller.activate("preview");
    const ownedShield = controller.element() as unknown as FakeElement;
    expect(ownedShield).not.toBe(stale);
    expect(ownedShield).not.toBe(duplicate);
    expect(stale.isConnected).toBe(false);
    expect(duplicate.isConnected).toBe(false);

    const callbackSurface = context.createElement();
    callbackSurfaces = [asElement(callbackSurface)];
    controller.refresh();
    expect(context.document.documentElement.children.slice(-2)).toEqual([
      ownedShield,
      callbackSurface,
    ]);
    callbackSurfaces = [];
    controller.refresh();
    expect(callbackSurface.style.getPropertyValue("z-index")).toBe("");
    expect(context.document.documentElement.children.at(-1)).toBe(ownedShield);
  });

  it("does not grant a page surface extension privileges from the public marker", () => {
    const context = harness();
    const spoofedSurface = context.createElement();
    spoofedSurface.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    spoofedSurface.style.setProperty("z-index", "9");
    context.document.documentElement.appendChild(spoofedSurface);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });
    controller.activate("preview");
    const shield = controller.element() as unknown as FakeElement;

    expect(context.document.documentElement.children).toEqual([spoofedSurface, shield]);
    expect(styleOf(spoofedSurface, "z-index")).toEqual(["9", ""]);
    expect(spoofedSurface.listenerCount("click")).toBe(0);

    const click = inputEvent("click", [
      spoofedSurface,
      context.document.documentElement,
      context.window,
    ]);
    context.window.dispatch("click", click as unknown as Event);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("makes provider order authoritative for shield, marking, then content controls", () => {
    const context = harness();
    const contentRoot = context.createElement();
    const markingRoot = context.createElement();
    const transientMenu = context.createElement();
    for (const surface of [contentRoot, markingRoot, transientMenu]) {
      surface.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
      context.document.documentElement.appendChild(surface);
    }
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      extensionSurfaces: () => [asElement(markingRoot), asElement(contentRoot)],
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;

    expect(context.document.documentElement.children.slice(-3)).toEqual([
      shield,
      markingRoot,
      contentRoot,
    ]);
    expect(context.document.documentElement.children.indexOf(transientMenu)).toBeLessThan(
      context.document.documentElement.children.indexOf(shield),
    );
    expect(styleOf(transientMenu, "z-index")).toEqual(["", ""]);
    expect(styleOf(markingRoot, "z-index")).toEqual([MAXIMUM_DOCUMENT_Z_INDEX, "important"]);
    expect(styleOf(contentRoot, "z-index")).toEqual([MAXIMUM_DOCUMENT_Z_INDEX, "important"]);
  });

  it("coalesces wheel packets and preserves touch panning for a nested viewport owner", () => {
    const context = harness();
    context.document.documentElement.clientHeight = 768;
    context.document.documentElement.scrollHeight = 768;
    const scrollShell = context.createElement("main");
    scrollShell.clientWidth = 1_024;
    scrollShell.clientHeight = 768;
    scrollShell.scrollHeight = 3_000;
    scrollShell.setAttribute("data-fake-overflow-y", "auto");
    context.document.documentElement.appendChild(scrollShell);
    context.document.hitTestElements = [scrollShell];
    const computedStyle = vi.spyOn(context.window, "getComputedStyle");
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;
    // The expensive viewport-owner proof is primed in a separate task. The
    // first physical wheel packet must consume it without computed-style work.
    context.window.flushTasks();
    const ownerDiscoveryStyleReads = computedStyle.mock.calls.length;
    expect(ownerDiscoveryStyleReads).toBeGreaterThan(0);
    expect(styleOf(shield, "touch-action")).toEqual(["pinch-zoom", "important"]);

    for (const [deltaX, deltaY] of [[20, 100], [25, 140]] as const) {
      context.window.dispatch("wheel", inputEvent(
        "wheel",
        [shield, context.document.documentElement, context.window],
        { deltaX, deltaY },
      ) as unknown as Event);
    }
    expect(computedStyle).toHaveBeenCalledTimes(ownerDiscoveryStyleReads);
    context.window.flushTasks();
    expect(scrollShell.scrollTop).toBe(240);
    expect(scrollShell.scrollLeft).toBe(45);

    context.window.dispatch("wheel", inputEvent(
      "wheel",
      [shield, context.document.documentElement, context.window],
      { deltaY: 60 },
    ) as unknown as Event);
    expect(computedStyle).toHaveBeenCalledTimes(ownerDiscoveryStyleReads);
    context.window.flushTasks();
    expect(scrollShell.scrollTop).toBe(300);

    const pointerDown = inputEvent(
      "pointerdown",
      [shield, context.document.documentElement, context.window],
      { pointerType: "touch", pointerId: 9, clientX: 500, clientY: 600 },
    );
    context.window.dispatch("pointerdown", pointerDown as unknown as Event);
    expect(pointerDown.preventDefault).toHaveBeenCalledOnce();
    expect(styleOf(shield, "touch-action")).toEqual(["pinch-zoom", "important"]);
    const gestureOwnerStyleReads = computedStyle.mock.calls.length;
    expect(gestureOwnerStyleReads).toBeGreaterThan(ownerDiscoveryStyleReads);
    context.window.dispatch("pointermove", inputEvent(
      "pointermove",
      [shield, context.document.documentElement, context.window],
      { pointerType: "touch", pointerId: 9, clientX: 450, clientY: 400 },
    ) as unknown as Event);
    expect(computedStyle).toHaveBeenCalledTimes(gestureOwnerStyleReads);
    context.window.flushTasks();
    expect(scrollShell.scrollTop).toBe(500);
    expect(scrollShell.scrollLeft).toBe(95);

    // Native movement remains primary; the fallback must not double-advance.
    context.window.dispatch("pointermove", inputEvent(
      "pointermove",
      [shield, context.document.documentElement, context.window],
      { pointerType: "touch", pointerId: 9, clientX: 425, clientY: 300 },
    ) as unknown as Event);
    scrollShell.scrollTop = 600;
    context.window.flushTasks();
    expect(scrollShell.scrollTop).toBe(600);
    context.window.dispatch("pointerup", inputEvent(
      "pointerup",
      [shield, context.document.documentElement, context.window],
      { pointerType: "touch", pointerId: 9, clientY: 300 },
    ) as unknown as Event);
  });

  it("routes fallback scrolling through an open-shadow owner and re-resolves its replacement", () => {
    const context = harness();
    context.document.documentElement.clientHeight = 768;
    context.document.documentElement.scrollHeight = 768;
    const host = context.createElement("section");
    const shadow = host.attachShadow();
    context.document.documentElement.appendChild(host);
    context.document.hitTestElements = [host];
    const makeOwner = (): Readonly<{ owner: FakeElement; probe: FakeElement }> => {
      const owner = context.createElement("main");
      owner.clientWidth = 1_024;
      owner.clientHeight = 768;
      owner.scrollHeight = 3_000;
      owner.setAttribute("data-fake-overflow-y", "auto");
      const probe = context.createElement("article");
      probe.clientWidth = 1_024;
      probe.clientHeight = 100;
      probe.getBoundingClientRect = () => ({
        left: 0,
        top: 100 - owner.scrollTop,
        right: 1_024,
        bottom: 200 - owner.scrollTop,
        width: 1_024,
        height: 100,
        x: 0,
        y: 100 - owner.scrollTop,
        toJSON: () => ({}),
      } as DOMRect);
      owner.appendChild(probe);
      shadow.appendChild(owner);
      return { owner, probe };
    };
    const first = makeOwner();
    shadow.hitTestElements = [first.probe];
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;
    expect(context.observers[0]!.observations.some(({ target, options }) =>
      target === shadow && options.subtree === true
    )).toBe(true);
    const wheel = (deltaY: number): void => {
      context.window.dispatch("wheel", inputEvent(
        "wheel",
        [shield, context.document.documentElement, context.window],
        { deltaY },
      ) as unknown as Event);
      context.window.flushTasks();
    };

    wheel(180);
    expect(first.owner.scrollTop).toBe(180);
    const replacement = makeOwner();
    shadow.hitTestElements = [replacement.probe];
    context.observers[0]!.trigger([{
      type: "childList",
      target: shadow,
      addedNodes: [replacement.owner],
      removedNodes: [],
    } as unknown as MutationRecord]);
    wheel(220);

    expect(first.owner.scrollTop).toBe(180);
    expect(replacement.owner.scrollTop).toBe(220);
  });

  it("continues nested touch fallback through Chromium pointercancel ownership transfer", () => {
    const context = harness();
    context.document.documentElement.clientHeight = 768;
    context.document.documentElement.scrollHeight = 768;
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;
    const path = [shield, context.document.documentElement, context.window];
    // Prime the initial document proof, then mount the practical viewport in
    // the same turn as input without delivering a MutationObserver callback.
    // Gesture start must refresh that stale proof before Chromium owns panning.
    context.window.flushTasks();
    const scrollShell = context.createElement("main");
    scrollShell.clientWidth = 1_024;
    scrollShell.clientHeight = 768;
    scrollShell.scrollHeight = 3_000;
    scrollShell.setAttribute("data-fake-overflow-y", "auto");
    context.document.documentElement.appendChild(scrollShell);
    context.document.hitTestElements = [scrollShell];

    const pointerDown = inputEvent(
      "pointerdown",
      path,
      { pointerType: "touch", pointerId: 17, clientX: 500, clientY: 600 },
    );
    context.window.dispatch("pointerdown", pointerDown as unknown as Event);
    expect(pointerDown.preventDefault).toHaveBeenCalledOnce();
    context.document.scrollingElement.scrollTop = 300;
    context.window.dispatch("scroll", { type: "scroll" } as Event);
    expect(context.document.scrollingElement.scrollTop).toBe(0);
    const touchStart = inputEvent(
      "touchstart",
      path,
      { touches: [{ identifier: 91, clientX: 500, clientY: 600 }] },
    );
    context.window.dispatch("touchstart", touchStart as unknown as Event);
    expect(touchStart.preventDefault).toHaveBeenCalledOnce();
    const cancelled = inputEvent(
      "pointercancel",
      path,
      { pointerType: "touch", pointerId: 17, clientX: 500, clientY: 580 },
    );
    context.window.dispatch("pointercancel", cancelled as unknown as Event);
    expect(cancelled.preventDefault).not.toHaveBeenCalled();
    expect(cancelled.stopImmediatePropagation).toHaveBeenCalledOnce();

    // Chromium no longer promises pointermove after pointercancel. The same
    // physical contact continues only through TouchEvents.
    const touchMove = inputEvent(
      "touchmove",
      path,
      { touches: [{ identifier: 91, clientX: 450, clientY: 400 }] },
    );
    context.window.dispatch("touchmove", touchMove as unknown as Event);
    expect(touchMove.preventDefault).toHaveBeenCalledOnce();
    context.window.flushTasks();
    expect(scrollShell.scrollTop).toBe(200);
    expect(scrollShell.scrollLeft).toBe(50);

    context.window.dispatch("touchend", inputEvent(
      "touchend",
      path,
      {
        touches: [],
        changedTouches: [{ identifier: 91, clientX: 450, clientY: 400 }],
      },
    ) as unknown as Event);
    // Chromium may deliver a final compositor-owned document scroll after the
    // physical contact ended. The guard remains authoritative until the
    // terminal scroll stream has been quiet for its release window, even when
    // no scroll event arrives before the next paint.
    context.document.scrollingElement.scrollTop = 520;
    context.window.flushAnimationFrames();
    expect(context.document.scrollingElement.scrollTop).toBe(0);
    context.window.dispatch("touchmove", inputEvent(
      "touchmove",
      path,
      { touches: [{ identifier: 91, clientX: 400, clientY: 200 }] },
    ) as unknown as Event);
    context.window.flushTasks();
    expect(scrollShell.scrollTop).toBe(200);
    context.document.scrollingElement.scrollTop = 640;
    context.window.dispatch("scroll", { type: "scroll" } as Event);
    expect(context.document.scrollingElement.scrollTop).toBe(640);
  });

  it("re-resolves a replacement SPA viewport owner while the old owner remains connected", async () => {
    const context = harness();
    context.document.documentElement.clientHeight = 768;
    context.document.documentElement.scrollHeight = 768;
    const makeOwner = (): FakeElement => {
      const owner = context.createElement("main");
      owner.clientWidth = 1_024;
      owner.clientHeight = 768;
      owner.scrollHeight = 3_000;
      owner.setAttribute("data-fake-overflow-y", "auto");
      return owner;
    };
    const oldOwner = makeOwner();
    context.document.documentElement.appendChild(oldOwner);
    context.document.hitTestElements = [oldOwner];
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;
    const queueWheel = (deltaY: number): void => {
      context.window.dispatch("wheel", inputEvent(
        "wheel",
        [shield, context.document.documentElement, context.window],
        { deltaY },
      ) as unknown as Event);
    };
    const wheel = (deltaY: number): void => {
      queueWheel(deltaY);
      context.window.flushTasks();
    };
    wheel(100);
    expect(oldOwner.scrollTop).toBe(100);

    const replacementOwner = makeOwner();
    queueWheel(140);
    context.document.documentElement.appendChild(replacementOwner);
    context.document.hitTestElements = [replacementOwner];
    context.observers[0]!.trigger([{
      type: "childList",
      target: context.document.documentElement,
      addedNodes: [replacementOwner],
      removedNodes: [],
    } as unknown as MutationRecord]);
    await Promise.resolve();
    context.window.flushTasks();
    expect(oldOwner.isConnected).toBe(true);
    expect(oldOwner.scrollHeight - oldOwner.clientHeight).toBeGreaterThan(2);
    // The packet was already bound to the old identity when the replacement
    // appeared; dirtying future discovery must not drop that physical input.
    expect(oldOwner.scrollTop).toBe(240);

    wheel(60);
    expect(oldOwner.scrollTop).toBe(240);
    expect(replacementOwner.scrollTop).toBe(60);
  });

  it("retains cached-owner packets and discovery across unrelated subtree churn", () => {
    const context = harness();
    context.document.documentElement.clientHeight = 768;
    context.document.documentElement.scrollHeight = 768;
    const owner = context.createElement("main");
    owner.clientWidth = 1_024;
    owner.clientHeight = 768;
    owner.scrollHeight = 3_000;
    owner.setAttribute("data-fake-overflow-y", "auto");
    context.document.documentElement.appendChild(owner);
    context.document.hitTestElements = [owner];
    const styleReads = vi.spyOn(context.window, "getComputedStyle");
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;
    const path = [shield, context.document.documentElement, context.window];
    context.window.dispatch("wheel", inputEvent("wheel", path, { deltaY: 100 }) as unknown as Event);
    const discoveryReads = styleReads.mock.calls.length;
    expect(discoveryReads).toBeGreaterThan(0);

    for (let index = 0; index < 8; index += 1) {
      const leaf = context.createElement("span");
      leaf.clientWidth = 20;
      leaf.clientHeight = 20;
      leaf.scrollHeight = 20;
      owner.appendChild(leaf);
      context.observers[0]!.trigger([{
        type: "childList",
        target: owner,
        addedNodes: [leaf],
        removedNodes: [],
      } as unknown as MutationRecord]);
    }
    context.window.flushTasks();
    expect(owner.scrollTop).toBe(100);

    context.window.dispatch("pointerdown", inputEvent(
      "pointerdown",
      path,
      { pointerType: "touch", pointerId: 7, clientX: 500, clientY: 600 },
    ) as unknown as Event);
    const gestureDiscoveryReads = styleReads.mock.calls.length;
    expect(gestureDiscoveryReads).toBeGreaterThan(discoveryReads);
    context.window.dispatch("pointermove", inputEvent(
      "pointermove",
      path,
      { pointerType: "touch", pointerId: 7, clientX: 500, clientY: 400 },
    ) as unknown as Event);
    const anotherLeaf = context.createElement("span");
    anotherLeaf.clientHeight = 20;
    anotherLeaf.scrollHeight = 20;
    owner.appendChild(anotherLeaf);
    context.observers[0]!.trigger([{
      type: "childList",
      target: owner,
      addedNodes: [anotherLeaf],
      removedNodes: [],
    } as unknown as MutationRecord]);
    context.window.flushTasks();
    expect(owner.scrollTop).toBe(300);

    context.window.dispatch("wheel", inputEvent("wheel", path, { deltaY: 50 }) as unknown as Event);
    expect(styleReads).toHaveBeenCalledTimes(gestureDiscoveryReads);
    context.window.flushTasks();
    expect(owner.scrollTop).toBe(350);
  });

  it("bounds replacement-owner mutation scans and prunes extension and consent subtrees", () => {
    const context = harness();
    context.document.documentElement.clientHeight = 768;
    context.document.documentElement.scrollHeight = 768;
    const owner = context.createElement("main");
    owner.clientWidth = 1_024;
    owner.clientHeight = 768;
    owner.scrollHeight = 3_000;
    owner.setAttribute("data-fake-overflow-y", "auto");
    context.document.documentElement.appendChild(owner);
    context.document.hitTestElements = [owner];
    const styleReads = vi.spyOn(context.window, "getComputedStyle");
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
      createMutationObserver: (callback) => {
        const observer = new FakeMutationObserver(callback);
        context.observers.push(observer);
        return observer;
      },
    });
    controller.activate("silent-highlighting");
    const shield = controller.element() as unknown as FakeElement;
    context.window.dispatch("wheel", inputEvent(
      "wheel",
      [shield, context.document.documentElement, context.window],
      { deltaY: 1 },
    ) as unknown as Event);
    context.window.flushTasks();

    const inserted = context.createElement("section");
    const extensionSubtree = context.createElement("div");
    extensionSubtree.setAttribute(EXTENSION_UI_ATTRIBUTE, "true");
    const consentSubtree = context.createElement("div");
    consentSubtree.setAttribute("data-uf-consent-hidden", "true");
    inserted.appendChild(extensionSubtree);
    inserted.appendChild(consentSubtree);
    for (let index = 0; index < 2_000; index += 1) {
      const extensionChild = context.createElement("span");
      extensionChild.setAttribute("data-fake-overflow-y", "auto");
      extensionSubtree.appendChild(extensionChild);
      const consentChild = context.createElement("span");
      consentChild.setAttribute("data-fake-overflow-y", "auto");
      consentSubtree.appendChild(consentChild);
      inserted.appendChild(context.createElement("span"));
    }
    const queryAll = vi.spyOn(inserted, "querySelectorAll");
    const readsBeforeMutation = styleReads.mock.calls.length;
    context.document.documentElement.appendChild(inserted);
    context.observers[0]!.trigger([{
      type: "childList",
      target: context.document.documentElement,
      addedNodes: [inserted],
      removedNodes: [],
    } as unknown as MutationRecord]);

    expect(queryAll).not.toHaveBeenCalled();
    expect(styleReads.mock.calls.length - readsBeforeMutation).toBeLessThanOrEqual(64);
    expect(styleReads.mock.calls.slice(readsBeforeMutation).some(([element]) =>
      element === extensionSubtree || element === consentSubtree
    )).toBe(false);
  });

  it("resumes bounded shadow discovery fairly beyond the light-DOM cap and through nested roots", () => {
    const context = harness();
    const lateHost = context.createElement("section");
    const lateRoot = lateHost.attachShadow();
    const nestedHost = context.createElement("article");
    const nestedRoot = nestedHost.attachShadow();
    lateRoot.appendChild(nestedHost);
    for (let index = 0; index < 1_600; index += 1) {
      context.document.documentElement.appendChild(context.createElement("span"));
    }
    context.document.documentElement.appendChild(lateHost);
    const controller = createInteractionShield({
      document: asDocument(context.document),
      window: asWindow(context.window),
    });

    controller.activate("silent-highlighting");
    expect(lateRoot.listenerCount("toggle")).toBe(0);
    expect(nestedRoot.listenerCount("toggle")).toBe(0);

    context.window.flushAnimationFrames();
    expect(lateRoot.listenerCount("beforetoggle")).toBe(1);
    expect(lateRoot.listenerCount("toggle")).toBe(1);
    expect(nestedRoot.listenerCount("beforetoggle")).toBe(1);
    expect(nestedRoot.listenerCount("toggle")).toBe(1);
  });
});
