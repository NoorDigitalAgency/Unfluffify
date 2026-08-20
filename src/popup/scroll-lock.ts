export type PanelScrollLockTarget = Readonly<{
  body: Readonly<{
    classList: Pick<DOMTokenList, "add" | "remove" | "contains">;
  }>;
  viewport: Readonly<{
    scrollX: number;
    scrollY: number;
    scrollTo: (x: number, y: number) => void;
  }>;
}>;

export type PanelScrollLock = Readonly<{
  lock: () => void;
  unlock: () => void;
  dispose: () => void;
}>;

/** Popup-only scroll lock. It never reaches the inspected tab, and every exit
 * restores the exact panel position captured when the blocker appeared. */
export function createPanelScrollLock(target: PanelScrollLockTarget): PanelScrollLock {
  let heldPosition: Readonly<{ x: number; y: number }> | null = null;

  const unlock = (): void => {
    if (!heldPosition && !target.body.classList.contains("is-busy")) {
      return;
    }
    const restore = heldPosition;
    heldPosition = null;
    target.body.classList.remove("is-busy");
    if (restore) {
      target.viewport.scrollTo(restore.x, restore.y);
    }
  };

  return {
    lock() {
      if (heldPosition) {
        return;
      }
      heldPosition = { x: target.viewport.scrollX, y: target.viewport.scrollY };
      target.body.classList.add("is-busy");
    },
    unlock,
    dispose: unlock,
  };
}
