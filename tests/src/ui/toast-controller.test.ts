import { describe, expect, it, vi } from "vitest";

import {
  createToastController,
  TOAST_DURATION_MS,
  type ToastClock,
  type ToastTone,
} from "../../../src/ui/toast-controller";

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

describe("toast controller", () => {
  it.each([
    ["success", 1_800],
    ["warning", 4_000],
    ["danger", 6_000],
  ] as const)("expires %s at exactly %i ms", (tone, durationMs) => {
    const fake = createFakeClock();
    const controller = createToastController({ clock: fake.clock });

    const occurrence = controller.show({ message: `${tone} result`, tone });
    expect(TOAST_DURATION_MS[tone]).toBe(durationMs);
    expect(controller.current()).toEqual(occurrence);

    fake.advanceBy(durationMs - 1);
    expect(controller.current()).toEqual(occurrence);

    fake.advanceBy(1);
    expect(controller.current()).toBeNull();
    expect(fake.pending()).toBe(0);
  });

  it("replaces in place with a fresh monotonic occurrence and full deadline", () => {
    const fake = createFakeClock();
    const controller = createToastController({ clock: fake.clock });

    const first = controller.show({ message: "Same copy", tone: "success" });
    fake.advanceBy(1_000);
    const second = controller.show({ message: "Same copy", tone: "warning" });

    expect(first?.id).toBe(1);
    expect(second?.id).toBe(2);
    expect(controller.current()).toEqual(second);
    expect(fake.pending()).toBe(1);

    fake.advanceBy(3_999);
    expect(controller.current()).toEqual(second);
    fake.advanceBy(1);
    expect(controller.current()).toBeNull();
  });

  it("does not restart an occurrence deadline when a surface reprojects it", () => {
    const fake = createFakeClock();
    const controller = createToastController({ clock: fake.clock });
    const occurrence = controller.show({ message: "Stable deadline", tone: "success" });

    fake.advanceBy(900);
    // DOM renderers only read current(). Re-reading it during an unrelated
    // banner/surface rebuild must not schedule a fresh 1.8-second lifetime.
    expect(controller.current()).toBe(occurrence);
    expect(controller.current()).toBe(occurrence);

    fake.advanceBy(899);
    expect(controller.current()).toBe(occurrence);
    fake.advanceBy(1);
    expect(controller.current()).toBeNull();
  });

  it("fences stale deadlines and stale dismissals even when cancellation loses a race", () => {
    let nextHandle = 1;
    const callbacks = new Map<number, () => void>();
    const clearTimeout = vi.fn();
    const clock: ToastClock = {
      setTimeout(callback) {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, callback);
        return handle;
      },
      // Deliberately retain the callback to model a deadline already queued by
      // the host when replacement tries to cancel it.
      clearTimeout,
    };
    const controller = createToastController({ clock });
    const first = controller.show({ message: "First", tone: "success" });
    const second = controller.show({ message: "Second", tone: "danger" });

    expect(clearTimeout).toHaveBeenCalledWith(1);
    expect(controller.dismiss(first!.id)).toBe(false);
    callbacks.get(1)?.();
    expect(controller.current()).toEqual(second);

    callbacks.get(2)?.();
    expect(controller.current()).toBeNull();
  });

  it("manual close clears the exact occurrence and leaves no late notification", () => {
    const fake = createFakeClock();
    const controller = createToastController({ clock: fake.clock });
    const listener = vi.fn();
    controller.subscribe(listener);
    const occurrence = controller.show({ message: "Close me", tone: "warning" });

    expect(controller.dismiss(occurrence!.id + 1)).toBe(false);
    expect(controller.dismiss(occurrence!.id)).toBe(true);
    expect(controller.current()).toBeNull();
    expect(fake.pending()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);

    fake.advanceBy(TOAST_DURATION_MS.warning);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps an explicitly persistent occurrence until dismissal or replacement", () => {
    const fake = createFakeClock();
    const controller = createToastController({ clock: fake.clock });
    const persistent = controller.show({
      message: "AI result request failed",
      tone: "danger",
      persistent: true,
    });

    expect(fake.pending()).toBe(0);
    fake.advanceBy(60_000);
    expect(controller.current()).toEqual(persistent);

    const replacement = controller.show({ message: "AI completed", tone: "success" });
    expect(controller.current()).toEqual(replacement);
    expect(fake.pending()).toBe(1);
  });

  it("clears on demand and permanently fences late work after disposal", () => {
    const fake = createFakeClock();
    const controller = createToastController({ clock: fake.clock });
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.show({ message: "First", tone: "success" });
    controller.clear();
    const second = controller.show({ message: "Second", tone: "danger" });
    expect(second?.id).toBe(2);

    controller.dispose();
    expect(controller.current()).toBeNull();
    expect(fake.pending()).toBe(0);
    expect(controller.show({ message: "Late", tone: "success" })).toBeNull();
    unsubscribe();
    fake.advanceBy(TOAST_DURATION_MS.danger);
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it("does not schedule empty messages", () => {
    const fake = createFakeClock();
    const controller = createToastController({ clock: fake.clock });

    expect(controller.show({ message: "", tone: "success" })).toBeNull();
    expect(controller.current()).toBeNull();
    expect(fake.pending()).toBe(0);
  });

  it("exports an exhaustive duration for every tone", () => {
    const tones: ToastTone[] = ["success", "warning", "danger"];
    expect(tones.map((tone) => TOAST_DURATION_MS[tone])).toEqual([1_800, 4_000, 6_000]);
  });
});
