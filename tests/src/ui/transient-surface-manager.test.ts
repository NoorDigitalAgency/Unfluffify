import { describe, expect, it, vi } from "vitest";

import {
  createTransientSurfaceManager,
  type TransientDismissReason,
  type TransientEventTarget,
  type TransientSurfaceKind,
} from "../../../src/ui/transient-surface-manager";

function escapeEvent() {
  return {
    key: "Escape",
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

function surface(
  id: string,
  kind: TransientSurfaceKind,
  dismissed: Array<readonly [string, TransientDismissReason]>,
  overrides: Partial<{
    parentId: string;
    root: EventTarget;
    outside: "dismiss" | "ignore";
    escape: "dismiss" | "block";
  }> = {},
) {
  return {
    id,
    kind,
    ...(overrides.parentId ? { parentId: overrides.parentId } : {}),
    root: () => overrides.root ?? null,
    outside: overrides.outside ?? (kind === "menu" || kind === "tooltip" ? "dismiss" : "ignore"),
    escape: overrides.escape ?? (kind === "busy" ? "block" : "dismiss"),
    dismiss(reason: TransientDismissReason) {
      dismissed.push([id, reason]);
    },
  } as const;
}

describe("transient surface manager", () => {
  it("mutually excludes menus and closes only the outside top menu", () => {
    const dismissed: Array<readonly [string, TransientDismissReason]> = [];
    const manager = createTransientSurfaceManager();
    const themeRoot = new EventTarget();

    manager.open(surface("header-menu", "menu", dismissed));
    manager.open(surface("theme-menu", "menu", dismissed, { root: themeRoot }));

    expect(manager.snapshot()).toEqual([{ id: "theme-menu", kind: "menu" }]);
    expect(dismissed).toEqual([["header-menu", "replace"]]);
    expect(manager.handlePointerDown({ composedPath: () => [themeRoot] } as PointerEvent)).toBe(false);
    expect(manager.handlePointerDown({ composedPath: () => [new EventTarget()] } as PointerEvent)).toBe(true);
    expect(dismissed).toEqual([
      ["header-menu", "replace"],
      ["theme-menu", "outside-pointer"],
    ]);
  });

  it("dismisses a nested checklist confirmation before its parent", () => {
    const dismissed: Array<readonly [string, TransientDismissReason]> = [];
    const manager = createTransientSurfaceManager();
    manager.open(surface("lynx-checklist", "checklist", dismissed));
    manager.open(surface("candidate-confirmation", "confirmation", dismissed, {
      parentId: "lynx-checklist",
    }));

    expect(manager.snapshot()).toEqual([
      { id: "lynx-checklist", kind: "checklist" },
      { id: "candidate-confirmation", kind: "confirmation", parentId: "lynx-checklist" },
    ]);
    expect(manager.handleEscape(escapeEvent())).toBe("dismissed");
    expect(manager.snapshot()).toEqual([{ id: "lynx-checklist", kind: "checklist" }]);
    expect(manager.handleEscape(escapeEvent())).toBe("dismissed");
    expect(manager.snapshot()).toEqual([]);
    expect(dismissed).toEqual([
      ["candidate-confirmation", "escape"],
      ["lynx-checklist", "escape"],
    ]);
  });

  it("blocks Escape on busy work without invoking any irreversible action", () => {
    const dismissed: Array<readonly [string, TransientDismissReason]> = [];
    const save = vi.fn();
    const discard = vi.fn();
    const disable = vi.fn();
    const send = vi.fn();
    const manager = createTransientSurfaceManager();
    manager.open(surface("lynx-checklist", "checklist", dismissed, { escape: "block" }));

    const event = escapeEvent();
    expect(manager.handleEscape(event)).toBe("blocked");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(manager.snapshot()).toEqual([{ id: "lynx-checklist", kind: "checklist" }]);
    expect(dismissed).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks busy maintenance and a busy checklist only after dismissing a nested candidate", () => {
    const dismissed: Array<readonly [string, TransientDismissReason]> = [];
    const checklist = createTransientSurfaceManager();
    checklist.open(surface("lynx-checklist", "checklist", dismissed, { escape: "block" }));
    checklist.open(surface("candidate-confirmation", "confirmation", dismissed, {
      parentId: "lynx-checklist",
    }));

    expect(checklist.handleEscape(escapeEvent())).toBe("dismissed");
    expect(checklist.handleEscape(escapeEvent())).toBe("blocked");
    expect(checklist.snapshot()).toEqual([{ id: "lynx-checklist", kind: "checklist" }]);

    const maintenance = createTransientSurfaceManager();
    maintenance.open(surface("maintenance-confirmation", "dialog", dismissed, { escape: "block" }));
    expect(maintenance.handleEscape(escapeEvent())).toBe("blocked");
    expect(maintenance.snapshot()).toEqual([{ id: "maintenance-confirmation", kind: "dialog" }]);
    expect(dismissed).toEqual([["candidate-confirmation", "escape"]]);
  });

  it("dismisses confirmations without performing their confirmed action", () => {
    for (const id of [
      "lock-confirmation",
      "candidate-confirmation",
      "maintenance-confirmation",
      "marking-disable-confirmation",
    ]) {
      const dismissed: Array<readonly [string, TransientDismissReason]> = [];
      const confirmed = vi.fn();
      const manager = createTransientSurfaceManager();
      manager.open(surface(id, "confirmation", dismissed));

      expect(manager.handleEscape(escapeEvent())).toBe("dismissed");
      expect(dismissed).toEqual([[id, "escape"]]);
      expect(confirmed).not.toHaveBeenCalled();
    }
  });

  it("uses Preview only as an empty-stack fallback and requests each exit once", () => {
    const exitPreview = vi.fn();
    const manager = createTransientSurfaceManager({ onPreviewExit: exitPreview });
    manager.setPreviewContext({ active: true, restoring: false });

    expect(manager.handleEscape(escapeEvent())).toBe("preview-exit");
    expect(manager.handleEscape(escapeEvent())).toBe("blocked");
    expect(exitPreview).toHaveBeenCalledOnce();

    manager.setPreviewContext({ active: true, restoring: true });
    expect(manager.handleEscape(escapeEvent())).toBe("blocked");
    expect(exitPreview).toHaveBeenCalledOnce();

    manager.setPreviewContext({ active: false, restoring: false });
    manager.setPreviewContext({ active: true, restoring: false });
    expect(manager.handleEscape(escapeEvent())).toBe("preview-exit");
    expect(exitPreview).toHaveBeenCalledTimes(2);
  });

  it("retires the prior realm's surfaces on both Preview boundaries", () => {
    const dismissed: Array<readonly [string, TransientDismissReason]> = [];
    const manager = createTransientSurfaceManager();
    manager.open(surface("header-menu", "menu", dismissed));
    manager.setPreviewContext({ active: true, restoring: false });
    manager.open(surface("preview-hover", "tooltip", dismissed));
    manager.setPreviewContext({ active: false, restoring: false });

    expect(manager.snapshot()).toEqual([]);
    expect(dismissed).toEqual([
      ["header-menu", "context-change"],
      ["preview-hover", "context-change"],
    ]);
  });

  it("routes capture listeners and removes them on disposal", () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, listener as EventListener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    } as TransientEventTarget;
    const dismissed: Array<readonly [string, TransientDismissReason]> = [];
    const manager = createTransientSurfaceManager({ eventTarget: target });
    manager.open(surface("header-menu", "menu", dismissed));

    listeners.get("keydown")?.(escapeEvent() as unknown as Event);
    expect(dismissed).toEqual([["header-menu", "escape"]]);
    expect(listeners.has("pointerdown")).toBe(true);
    expect(listeners.has("keydown")).toBe(true);

    manager.dispose();
    expect(listeners.size).toBe(0);
  });
});
