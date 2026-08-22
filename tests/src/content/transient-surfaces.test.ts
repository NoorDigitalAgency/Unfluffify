import { describe, expect, it, vi } from "vitest";

import {
  createContentTransientSurfaces,
  type ContentTransientEventTarget,
} from "../../../src/content/transient-surfaces";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createEventTargetHarness() {
  const listeners = new Map<string, EventListener[]>();
  const added: string[] = [];
  const removed: string[] = [];
  const target: ContentTransientEventTarget = {
    addEventListener(type, listener) {
      added.push(type);
      const callback = typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    },
    removeEventListener(type, listener) {
      removed.push(type);
      const callbacks = listeners.get(type) ?? [];
      listeners.set(type, callbacks.filter((callback) => callback !== listener));
    },
  };
  const dispatch = (type: string, event: Event): void => {
    for (const listener of [...(listeners.get(type) ?? [])]) {
      listener(event);
    }
  };
  return { target, added, removed, dispatch };
}

async function flushPromises(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
  }
}

describe("content transient surfaces", () => {
  it("owns one Preview Escape request until the authoritative context exits", async () => {
    const exit = deferred<boolean>();
    const requestPreviewExit = vi.fn(async () => await exit.promise);
    const surfaces = createContentTransientSurfaces({ requestPreviewExit });
    const target = createEventTargetHarness();
    surfaces.attach(target.target);
    surfaces.syncPreviewContext({ active: true, restoring: false });
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const escape = {
      key: "Escape",
      preventDefault,
      stopImmediatePropagation,
    } as unknown as KeyboardEvent;

    target.dispatch("keydown", escape);
    await flushPromises();
    target.dispatch("keydown", escape);
    expect(requestPreviewExit).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(2);

    exit.resolve(true);
    await flushPromises();
    target.dispatch("keydown", escape);
    expect(requestPreviewExit).toHaveBeenCalledOnce();

    surfaces.syncPreviewContext({ active: false, restoring: false });
    surfaces.syncPreviewContext({ active: true, restoring: false });
    target.dispatch("keydown", escape);
    await flushPromises();
    expect(requestPreviewExit).toHaveBeenCalledTimes(2);
  });

  it("resets the Preview latch after a refused or failed request", async () => {
    const onPreviewExitError = vi.fn();
    const requestPreviewExit = vi.fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("fact transport unavailable"))
      .mockResolvedValueOnce(true);
    const surfaces = createContentTransientSurfaces({
      requestPreviewExit,
      onPreviewExitError,
    });
    const target = createEventTargetHarness();
    surfaces.attach(target.target);
    surfaces.syncPreviewContext({ active: true, restoring: false });
    const escape = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    target.dispatch("keydown", escape);
    await flushPromises();
    target.dispatch("keydown", escape);
    await flushPromises();
    expect(onPreviewExitError).toHaveBeenCalledWith(expect.objectContaining({
      message: "fact transport unavailable",
    }));
    target.dispatch("keydown", escape);
    await flushPromises();

    expect(requestPreviewExit).toHaveBeenCalledTimes(3);
  });

  it("suppresses only the physical click paired with an outside dismissal", () => {
    const surfaces = createContentTransientSurfaces({ requestPreviewExit: async () => true });
    const target = createEventTargetHarness();
    surfaces.attach(target.target);
    const root = {} as EventTarget;
    const dismiss = vi.fn();
    surfaces.manager.open({
      id: "marking-menu",
      kind: "menu",
      root: () => root,
      outside: "dismiss",
      escape: "dismiss",
      dismiss,
    });
    const pointerPrevented = vi.fn();
    const pointerStopped = vi.fn();
    target.dispatch("pointerdown", {
      clientX: 40,
      clientY: 50,
      timeStamp: 100,
      composedPath: () => [{}],
      preventDefault: pointerPrevented,
      stopImmediatePropagation: pointerStopped,
    } as unknown as PointerEvent);

    expect(dismiss).toHaveBeenCalledWith("outside-pointer");
    expect(pointerPrevented).toHaveBeenCalledOnce();
    expect(pointerStopped).toHaveBeenCalledOnce();

    const matchingPrevented = vi.fn();
    const matchingStopped = vi.fn();
    target.dispatch("click", {
      clientX: 41,
      clientY: 49,
      timeStamp: 500,
      preventDefault: matchingPrevented,
      stopImmediatePropagation: matchingStopped,
    } as unknown as MouseEvent);
    expect(matchingPrevented).toHaveBeenCalledOnce();
    expect(matchingStopped).toHaveBeenCalledOnce();

    const laterPrevented = vi.fn();
    target.dispatch("click", {
      clientX: 41,
      clientY: 49,
      timeStamp: 501,
      preventDefault: laterPrevented,
      stopImmediatePropagation: vi.fn(),
    } as unknown as MouseEvent);
    expect(laterPrevented).not.toHaveBeenCalled();
  });

  it("does not dismiss a menu for an inside pointer", () => {
    const surfaces = createContentTransientSurfaces({ requestPreviewExit: async () => true });
    const target = createEventTargetHarness();
    surfaces.attach(target.target);
    const root = {} as EventTarget;
    const dismiss = vi.fn();
    surfaces.manager.open({
      id: "marking-menu",
      kind: "menu",
      root: () => root,
      outside: "dismiss",
      escape: "dismiss",
      dismiss,
    });
    const preventDefault = vi.fn();
    target.dispatch("pointerdown", {
      clientX: 1,
      clientY: 2,
      timeStamp: 3,
      composedPath: () => [root],
      preventDefault,
      stopImmediatePropagation: vi.fn(),
    } as unknown as PointerEvent);

    expect(dismiss).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(surfaces.manager.snapshot()).toEqual([{ id: "marking-menu", kind: "menu" }]);
  });

  it("attaches once and removes every capture listener on terminal disposal", async () => {
    const rejected = deferred<boolean>();
    const onPreviewExitError = vi.fn();
    const surfaces = createContentTransientSurfaces({
      requestPreviewExit: async () => await rejected.promise,
      onPreviewExitError,
    });
    const target = createEventTargetHarness();
    surfaces.attach(target.target);
    surfaces.attach(target.target);
    expect(target.added).toEqual(["keydown", "pointerdown", "click"]);

    surfaces.syncPreviewContext({ active: true, restoring: false });
    target.dispatch("keydown", {
      key: "Escape",
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent);
    await flushPromises();
    surfaces.dispose();
    surfaces.dispose();
    rejected.reject(new Error("late failure"));
    await flushPromises();

    expect(target.removed).toEqual(["keydown", "pointerdown", "click"]);
    expect(surfaces.manager.snapshot()).toEqual([]);
    expect(onPreviewExitError).not.toHaveBeenCalled();
  });
});
