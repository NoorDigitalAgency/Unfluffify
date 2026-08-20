import { describe, expect, it, vi } from "vitest";

import { createPanelScrollLock } from "../../../src/popup/scroll-lock";

describe("panel scroll lock", () => {
  it("is idempotent and restores the captured panel position on every terminal path", () => {
    const classes = new Set<string>();
    const scrollTo = vi.fn();
    const lock = createPanelScrollLock({
      body: {
        classList: {
          add: (value) => classes.add(value),
          remove: (value) => classes.delete(value),
          contains: (value) => classes.has(value),
        },
      },
      viewport: { scrollX: 12, scrollY: 340, scrollTo },
    });

    lock.lock();
    lock.lock();
    expect(classes.has("is-busy")).toBe(true);
    lock.dispose();
    expect(classes.has("is-busy")).toBe(false);
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith(12, 340);
    lock.unlock();
    expect(scrollTo).toHaveBeenCalledOnce();
  });
});
