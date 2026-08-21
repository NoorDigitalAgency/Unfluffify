import { describe, expect, it, vi } from "vitest";

import {
  createPhysicalActionDeduper,
  openMarkingContextMenu,
} from "../../../../src/content/marking/interaction";
import { createGeometryStabilizer } from "../../../../src/content/marking/stabilizer";
import { createTransientSurfaceManager } from "../../../../src/ui/transient-surface-manager";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, (event: Event) => void>();
  type = "";
  disabled = false;
  textContent = "";
  removed = false;
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, listener: (event: Event) => void): void { this.listeners.set(type, listener); }
  contains(target: unknown): boolean { return target === this || this.children.includes(target as FakeElement); }
  remove(): void { this.removed = true; }
}

describe("marking interaction controls", () => {
  it("deduplicates one physical gesture without swallowing a rapid distinct gesture", () => {
    const deduper = createPhysicalActionDeduper();
    expect(deduper.accept(41, "/main[1]/p[1]", "exclude")).toBe(true);
    expect(deduper.accept(41, "/main[1]/p[1]", "exclude")).toBe(false);
    expect(deduper.accept(42, "/main[1]/p[1]", "exclude")).toBe(true);
    expect(deduper.accept(41, "/main[1]/p[1]", "include")).toBe(true);
  });

  it("renders the four right-click actions and commits only the chosen enabled action", () => {
    const documentElement = new FakeElement();
    Object.assign(documentElement, { clientWidth: 640, clientHeight: 480 });
    const documentListeners = new Map<string, (event: Event) => void>();
    const document = {
      documentElement,
      createElement: () => new FakeElement(),
      addEventListener: (type: string, listener: (event: Event) => void) => documentListeners.set(type, listener),
      removeEventListener: (type: string) => documentListeners.delete(type),
    } as unknown as Document;
    const run = vi.fn();

    openMarkingContextMenu({
      document,
      manager: createTransientSurfaceManager(),
      x: 620,
      y: 460,
      actions: [
        { id: "include", label: "Include", enabled: true, run },
        { id: "exclude", label: "Exclude", enabled: false, run },
        { id: "widen", label: "Widen exclusion", enabled: true, run },
        { id: "clear", label: "Clear mark", enabled: true, run },
      ],
    });

    const menu = documentElement.children[0]!;
    expect(menu.attributes.get("role")).toBe("menu");
    expect(menu.style.left).toBe("466px");
    expect(menu.style.top).toBe("306px");
    expect(menu.children.map((button) => button.attributes.get("data-uf-marking-menu-action")))
      .toEqual(["include", "exclude", "widen", "clear"]);
    expect(menu.children[1]?.disabled).toBe(true);

    menu.children[0]?.listeners.get("click")?.({
      preventDefault() {},
      stopPropagation() {},
    } as unknown as Event);
    expect(run).toHaveBeenCalledTimes(1);
    expect(menu.removed).toBe(true);
    expect(documentListeners.size).toBe(0);
  });

  it("replaces and dismisses the right-click menu without running a marking action", () => {
    const documentElement = new FakeElement();
    Object.assign(documentElement, { clientWidth: 640, clientHeight: 480 });
    const document = {
      documentElement,
      createElement: () => new FakeElement(),
    } as unknown as Document;
    const manager = createTransientSurfaceManager();
    const run = vi.fn();
    const open = () => openMarkingContextMenu({
      document,
      manager,
      x: 100,
      y: 100,
      actions: [{ id: "include", label: "Include", enabled: true, run }],
    });

    const closeFirst = open();
    const first = documentElement.children.at(-1)!;
    closeFirst();
    open();
    const second = documentElement.children.at(-1)!;
    expect(first.removed).toBe(true);
    expect(second.removed).toBe(false);
    expect(manager.snapshot()).toEqual([{ id: "marking-context-menu", kind: "menu" }]);

    const escape = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    };
    expect(manager.handleEscape(escape)).toBe("dismissed");
    expect(second.removed).toBe(true);
    expect(run).not.toHaveBeenCalled();

    open();
    const third = documentElement.children.at(-1)!;
    expect(manager.handlePointerDown({ composedPath: () => [new EventTarget()] } as PointerEvent)).toBe(true);
    expect(third.removed).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("bounded geometry stabilization", () => {
  it("coalesces storms and stops after two equal layout samples", () => {
    const frames: FrameRequestCallback[] = [];
    const samples = ["100:100", "120:100", "120:100"];
    const onSample = vi.fn();
    const onSettled = vi.fn();
    const stabilizer = createGeometryStabilizer({
      sample: () => samples.shift() ?? "120:100",
      onSample,
      onSettled,
      requestFrame(callback) { frames.push(callback); return frames.length; },
      cancelFrame() {},
      maxSamples: 4,
      requiredStableSamples: 2,
    });

    stabilizer.request();
    stabilizer.request();
    expect(frames).toHaveLength(1);
    while (frames.length > 0) {
      frames.shift()?.(0);
    }
    expect(onSample).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("caps an endlessly changing page", () => {
    const frames: FrameRequestCallback[] = [];
    let sample = 0;
    const onSample = vi.fn();
    const stabilizer = createGeometryStabilizer({
      sample: () => String(sample++),
      onSample,
      requestFrame(callback) { frames.push(callback); return frames.length; },
      cancelFrame() {},
      maxSamples: 4,
      requiredStableSamples: 2,
    });
    stabilizer.request();
    while (frames.length > 0) {
      frames.shift()?.(0);
    }
    expect(onSample).toHaveBeenCalledTimes(4);
  });
});
