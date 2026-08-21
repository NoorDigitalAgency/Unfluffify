import { describe, expect, it, vi } from "vitest";

import { createContentToastLifecycle } from "../../../src/content/toast-lifecycle";
import type { ToastClock } from "../../../src/ui/toast-controller";

function createFakeClock() {
  let now = 0;
  let nextHandle = 1;
  const tasks = new Map<number, Readonly<{ callback: () => void; deadline: number }>>();
  const clock: ToastClock = {
    setTimeout(callback, delayMs) {
      const handle = nextHandle;
      nextHandle += 1;
      tasks.set(handle, { callback, deadline: now + delayMs });
      return handle;
    },
    clearTimeout(handle) {
      tasks.delete(handle as number);
    },
  };

  return {
    clock,
    advanceBy(durationMs: number): void {
      now += durationMs;
      while (true) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.deadline <= now)
          .sort((left, right) => left[1].deadline - right[1].deadline || left[0] - right[0])[0];
        if (!due) {
          return;
        }
        tasks.delete(due[0]);
        due[1].callback();
      }
    },
    pending: () => tasks.size,
  };
}

describe("content toast lifecycle", () => {
  it("delegates the exact occurrence deadline without resetting it on projection reads", () => {
    const fake = createFakeClock();
    const lifecycle = createContentToastLifecycle({ clock: fake.clock });
    const listener = vi.fn();
    lifecycle.subscribe(listener);

    const occurrence = lifecycle.show({ message: "Still working", tone: "warning" });
    expect(occurrence).toMatchObject({ id: 1, message: "Still working", tone: "warning" });
    expect(lifecycle.current()).toBe(occurrence);
    expect(lifecycle.current()).toBe(occurrence);

    fake.advanceBy(3_999);
    expect(lifecycle.current()).toBe(occurrence);
    fake.advanceBy(1);
    expect(lifecycle.current()).toBeNull();
    expect(fake.pending()).toBe(0);
    expect(listener).toHaveBeenNthCalledWith(1, occurrence);
    expect(listener).toHaveBeenNthCalledWith(2, null);
  });

  it("fences delayed producers across every retirement, even without a current toast", () => {
    const fake = createFakeClock();
    const lifecycle = createContentToastLifecycle({ clock: fake.clock });
    const firstFence = lifecycle.captureFence();

    lifecycle.retire();
    const betweenRetirements = lifecycle.captureFence();
    lifecycle.retire();

    expect(lifecycle.showIfCurrent(firstFence, { message: "Late first", tone: "success" })).toBeNull();
    expect(lifecycle.showIfCurrent(betweenRetirements, {
      message: "Late second",
      tone: "danger",
    })).toBeNull();
    const currentFence = lifecycle.captureFence();
    expect(lifecycle.showIfCurrent(currentFence, {
      message: "Current result",
      tone: "success",
    })).toMatchObject({ id: 1, message: "Current result" });
    expect(fake.pending()).toBe(1);
  });

  it("rejects a fence captured by another lifecycle occurrence", () => {
    const first = createContentToastLifecycle();
    const second = createContentToastLifecycle();
    const foreignFence = first.captureFence();

    expect(second.showIfCurrent(foreignFence, {
      message: "Wrong realm occurrence",
      tone: "warning",
    })).toBeNull();

    first.dispose();
    second.dispose();
  });

  it("suspends across BFCache without resetting the delegated occurrence identity", () => {
    const fake = createFakeClock();
    const lifecycle = createContentToastLifecycle({ clock: fake.clock });
    const first = lifecycle.show({ message: "Before hide", tone: "success" });
    const oldFence = lifecycle.captureFence();

    lifecycle.suspend();
    lifecycle.retire();
    expect(lifecycle.current()).toBeNull();
    expect(lifecycle.show({ message: "While hidden", tone: "danger" })).toBeNull();
    expect(lifecycle.showIfCurrent(oldFence, { message: "Late copy", tone: "success" })).toBeNull();
    expect(fake.pending()).toBe(0);

    lifecycle.resume();
    const second = lifecycle.show({ message: "After restore", tone: "warning" });
    expect(first?.id).toBe(1);
    expect(second?.id).toBe(2);
    expect(lifecycle.showIfCurrent(oldFence, { message: "Still late", tone: "danger" })).toBeNull();
  });

  it("makes disposal terminal for timers, fences, dismissal, and resume", () => {
    const fake = createFakeClock();
    const lifecycle = createContentToastLifecycle({ clock: fake.clock });
    const listener = vi.fn();
    lifecycle.subscribe(listener);
    const fence = lifecycle.captureFence();
    const occurrence = lifecycle.show({ message: "Before disposal", tone: "danger" });

    lifecycle.dispose();
    lifecycle.resume();

    expect(lifecycle.current()).toBeNull();
    expect(lifecycle.dismiss(occurrence!.id)).toBe(false);
    expect(lifecycle.show({ message: "After disposal", tone: "success" })).toBeNull();
    expect(lifecycle.showIfCurrent(fence, { message: "Delayed", tone: "danger" })).toBeNull();
    expect(fake.pending()).toBe(0);
    expect(listener).toHaveBeenLastCalledWith(null);
  });
});
