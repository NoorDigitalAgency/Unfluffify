import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PRESENTATION_FRAME_FALLBACK_MS,
  createPresentationClock,
} from "../../../src/content/presentation-clock";

type FrameHost = Pick<
  Window,
  "requestAnimationFrame" | "cancelAnimationFrame" | "setTimeout" | "clearTimeout"
>;

function createHost() {
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  const cancelAnimationFrame = vi.fn((handle: number) => {
    frames.delete(handle);
  });
  const host = {
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout: ((callback: TimerHandler, delay?: number) =>
      setTimeout(callback, delay)) as Window["setTimeout"],
    clearTimeout: ((handle?: number) => clearTimeout(handle)) as Window["clearTimeout"],
  } satisfies FrameHost;
  return { host, frames, requestAnimationFrame, cancelAnimationFrame };
}

describe("content presentation clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses native rAF as the primary path and cancels its fallback", () => {
    vi.useFakeTimers();
    const { host, frames } = createHost();
    const clock = createPresentationClock(host);
    const callback = vi.fn();

    clock.requestFrame(callback);
    expect(frames).toHaveLength(1);
    frames.get(1)?.(12.5);
    vi.advanceTimersByTime(PRESENTATION_FRAME_FALLBACK_MS);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(12.5);
    expect(clock.pendingCount()).toBe(0);
  });

  it("delivers exactly once through the bounded fallback when rAF starves", () => {
    vi.useFakeTimers();
    const { host, frames, cancelAnimationFrame } = createHost();
    const clock = createPresentationClock(host);
    const callback = vi.fn();

    clock.requestFrame(callback);
    vi.advanceTimersByTime(PRESENTATION_FRAME_FALLBACK_MS - 1);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

    frames.get(1)?.(33);
    expect(callback).toHaveBeenCalledOnce();
    expect(clock.pendingCount()).toBe(0);
  });

  it("cancels both native scheduling branches and never calls user work", () => {
    vi.useFakeTimers();
    const { host, frames, cancelAnimationFrame } = createHost();
    const clock = createPresentationClock(host);
    const callback = vi.fn();

    const handle = clock.requestFrame(callback);
    clock.cancelFrame(handle);
    vi.advanceTimersByTime(PRESENTATION_FRAME_FALLBACK_MS);
    frames.get(1)?.(40);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(callback).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("keeps the primitives captured before a later page-world patch", () => {
    vi.useFakeTimers();
    const { host, frames, requestAnimationFrame } = createHost();
    const clock = createPresentationClock(host);
    host.requestAnimationFrame = vi.fn(() => {
      throw new Error("patched rAF must not be consulted");
    });
    host.setTimeout = vi.fn(() => {
      throw new Error("patched timer must not be consulted");
    }) as Window["setTimeout"];
    const callback = vi.fn();

    clock.requestFrame(callback);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    frames.get(1)?.(50);

    expect(callback).toHaveBeenCalledWith(50);
  });

  it("disposes all pending frames deterministically", () => {
    vi.useFakeTimers();
    const { host, frames } = createHost();
    const clock = createPresentationClock(host);
    const first = vi.fn();
    const second = vi.fn();

    clock.requestFrame(first);
    clock.requestFrame(second);
    expect(clock.pendingCount()).toBe(2);
    clock.dispose();
    vi.advanceTimersByTime(PRESENTATION_FRAME_FALLBACK_MS);
    for (const frame of frames.values()) {
      frame(60);
    }

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(0);
  });

  it("returns no armed handle when a test realm delivers rAF synchronously", () => {
    const callback = vi.fn();
    const clock = createPresentationClock({
      requestAnimationFrame(frame) {
        frame(70);
        return 4;
      },
      cancelAnimationFrame: vi.fn(),
    });

    expect(clock.requestFrame(callback)).toBe(0);
    expect(callback).toHaveBeenCalledWith(70);
    expect(clock.pendingCount()).toBe(0);
  });
});
