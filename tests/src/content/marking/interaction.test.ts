import { describe, expect, it, vi } from "vitest";

import {
  createPhysicalActionDeduper,
  openMarkingContextMenu,
} from "../../../../src/content/marking/interaction";
import { createTransientSurfaceManager } from "../../../../src/ui/transient-surface-manager";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, (event: Event) => void>();
  readonly ownerDocument: { activeElement: FakeElement | null };
  type = "";
  disabled = false;
  hidden = false;
  tabIndex = 0;
  id = "";
  textContent = "";
  removed = false;
  constructor(ownerDocument: { activeElement: FakeElement | null } = { activeElement: null }) {
    this.ownerDocument = ownerDocument;
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  addEventListener(type: string, listener: (event: Event) => void): void { this.listeners.set(type, listener); }
  querySelectorAll(selector: string): FakeElement[] {
    const role = selector.match(/\[role="([^"]+)"\]/)?.[1];
    return this.children.filter((child) => !role || child.attributes.get("role") === role);
  }
  focus(): void { this.ownerDocument.activeElement = this; }
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
      createElement: () => new FakeElement(documentElement.ownerDocument),
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
    expect(menu.attributes.get("aria-label")).toBe("Marking actions");
    expect(menu.style.left).toBe("466px");
    expect(menu.style.top).toBe("306px");
    expect(menu.children.map((button) => button.attributes.get("data-uf-marking-menu-action")))
      .toEqual(["include", "exclude", "widen", "clear"]);
    expect(menu.children[1]?.disabled).toBe(true);
    expect(menu.children.every((button) => button.tabIndex === -1)).toBe(true);
    expect(documentElement.ownerDocument.activeElement).toBe(menu.children[0]);

    const keyboardEvent = (key: string) => ({
      key,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    const arrowDown = keyboardEvent("ArrowDown");
    menu.listeners.get("keydown")?.(arrowDown as unknown as Event);
    expect(documentElement.ownerDocument.activeElement).toBe(menu.children[2]);
    expect(arrowDown.preventDefault).toHaveBeenCalledOnce();
    const end = keyboardEvent("End");
    menu.listeners.get("keydown")?.(end as unknown as Event);
    expect(documentElement.ownerDocument.activeElement).toBe(menu.children[3]);
    const home = keyboardEvent("Home");
    menu.listeners.get("keydown")?.(home as unknown as Event);
    expect(documentElement.ownerDocument.activeElement).toBe(menu.children[0]);

    const syntheticPreventDefault = vi.fn();
    const syntheticStopPropagation = vi.fn();
    menu.children[0]?.listeners.get("click")?.({
      isTrusted: false,
      preventDefault: syntheticPreventDefault,
      stopPropagation: syntheticStopPropagation,
    } as unknown as Event);
    expect(run).not.toHaveBeenCalled();
    expect(menu.removed).toBe(false);
    expect(syntheticPreventDefault).not.toHaveBeenCalled();
    expect(syntheticStopPropagation).not.toHaveBeenCalled();

    menu.children[0]?.listeners.get("click")?.({
      isTrusted: true,
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
      createElement: () => new FakeElement(documentElement.ownerDocument),
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
