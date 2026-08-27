import { describe, expect, it, vi } from "vitest";

import {
  EXTENSION_UI_ATTRIBUTE,
  INTERACTION_SHIELD_ATTRIBUTE,
  MAXIMUM_DOCUMENT_Z_INDEX,
  createInteractionShield,
} from "../../../src/content/interaction-shield";
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

  getPropertyValue(property: string): string {
    return this.values.get(property)?.value ?? "";
  }

  getPropertyPriority(property: string): string {
    return this.values.get(property)?.priority ?? "";
  }

  setProperty(property: string, value: string, priority = ""): void {
    this.values.set(property, { value, priority });
  }

  removeProperty(property: string): string {
    const previous = this.getPropertyValue(property);
    this.values.delete(property);
    return previous;
  }
}

class FakeElement extends FakeEventTarget {
  readonly style = new FakeStyle();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  parentElement: FakeElement | null = null;
  clientWidth = 1_024;
  clientHeight = 768;
  scrollWidth = 1_024;
  scrollHeight = 2_000;
  scrollLeft = 0;
  scrollTop = 0;

  constructor(readonly tagName: string) {
    super();
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

  querySelectorAll(selector: string): FakeElement[] {
    const match = /^\[([^=]+)="([^"]+)"\]$/.exec(selector);
    const found: FakeElement[] = [];
    for (const child of this.children) {
      const pseudoMatch = selector === ":popover-open"
        ? child.getAttribute("data-fake-popover-open") === "true"
        : selector === "dialog:modal"
          ? child.tagName === "DIALOG" && child.getAttribute("data-fake-modal-open") === "true"
          : false;
      if ((match && child.getAttribute(match[1]!) === match[2]) || pseudoMatch) {
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

  constructor(readonly defaultView: FakeWindow) {
    super();
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toUpperCase());
  }

  querySelectorAll<T extends Element>(selector: string): T[] {
    return this.documentElement.querySelectorAll(selector) as unknown as T[];
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

  trigger(): void {
    this.callback([], this as unknown as MutationObserver);
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
  }> = {},
) {
  return {
    type,
    cancelable: options.cancelable ?? true,
    pointerType: options.pointerType,
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
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
    expect(styleOf(shield, "all")).toEqual(["initial", "important"]);
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
    for (const type of CONTENT_INPUT_EVENTS) {
      expect(context.window.listenerCount(type)).toBe(0);
    }
    expect(context.window.listenerCount("resize")).toBe(0);
    expect(context.window.listenerCount("orientationchange")).toBe(0);
    expect(context.observers[0]!.disconnectCount).toBe(disconnectsBeforeRelease + 1);
    expect(context.observers[0]!.observations).toEqual([]);

    controller.dispose();
    controller.dispose();
    expect(controller.activate("after-dispose")).toBe(false);
    expect(controller.registerExtensionSurface(asElement(context.createElement()))).toBeTypeOf("function");
    expect(controller.isActive()).toBe(false);
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

    context.document.scrollingElement.scrollTop = 100;
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
  });

  it("neutralizes page-owned top layers opened before or after activation and restores authored input", async () => {
    const context = harness();
    const extensionRoot = context.createElement();
    const extensionPopover = context.createElement();
    extensionPopover.setAttribute("data-fake-popover-open", "true");
    extensionRoot.appendChild(extensionPopover);
    const existingPopover = context.createElement();
    existingPopover.setAttribute("data-fake-popover-open", "true");
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
    expect(styleOf(existingPopover, "pointer-events")).toEqual(["none", "important"]);
    expect(existingPopover.getAttribute("inert")).toBe("");
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
    expect(styleOf(latePopover, "pointer-events")).toEqual(["none", "important"]);
    expect(latePopover.getAttribute("inert")).toBe("");

    latePopover.style.setProperty("pointer-events", "auto", "important");
    latePopover.removeAttribute("inert");
    context.observers[0]!.trigger();
    await Promise.resolve();
    expect(styleOf(latePopover, "pointer-events")).toEqual(["none", "important"]);
    expect(latePopover.getAttribute("inert")).toBe("");

    existingPopover.setAttribute("data-fake-popover-open", "false");
    context.document.dispatch("toggle", {
      type: "toggle",
      target: existingPopover,
      newState: "closed",
    } as unknown as Event);
    await Promise.resolve();
    expect(styleOf(existingPopover, "pointer-events")).toEqual(["auto", "important"]);
    expect(existingPopover.getAttribute("inert")).toBeNull();

    controller.dispose();
    expect(styleOf(latePopover, "pointer-events")).toEqual(["", ""]);
    expect(latePopover.getAttribute("inert")).toBeNull();
    expect(context.document.listenerCount("beforetoggle")).toBe(0);
    expect(context.document.listenerCount("toggle")).toBe(0);
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
        options: {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["open", "popover"],
        },
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
});
