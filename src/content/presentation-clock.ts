export const PRESENTATION_FRAME_FALLBACK_MS = 20;

export type PresentationClockSource = Readonly<{
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout?: (callback: () => void, delay?: number) => number;
  clearTimeout?: (handle: number) => void;
  performance?: Readonly<{ now?: () => number }>;
}>;

export type PresentationClock = Readonly<{
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  pendingCount(): number;
  dispose(): void;
}>;

type PendingPresentationFrame = {
  settled: boolean;
  animationHandle?: unknown;
  fallbackHandle?: unknown;
};

/**
 * Extension-owned presentation scheduling.
 *
 * The source methods are captured and bound when the clock is created, before
 * reveal/freeze can replace or starve the page-facing scheduling surface. rAF
 * remains the primary paint-aligned path. A bounded task races it so a frozen
 * document can never leave a coalescing handle armed forever.
 */
export function createPresentationClock(source: PresentationClockSource | null): PresentationClock {
  const capturedRequestAnimationFrame = source?.requestAnimationFrame;
  const capturedCancelAnimationFrame = source?.cancelAnimationFrame;
  const capturedSetTimeout = source?.setTimeout;
  const capturedClearTimeout = source?.clearTimeout;
  const requestAnimationFrame = typeof capturedRequestAnimationFrame === "function"
    ? capturedRequestAnimationFrame.bind(source)
    : null;
  const cancelAnimationFrame = typeof capturedCancelAnimationFrame === "function"
    ? (handle: unknown) => capturedCancelAnimationFrame.call(source, handle as number)
    : null;
  const scheduleFallback = typeof capturedSetTimeout === "function"
    ? (callback: () => void, delay?: number) => capturedSetTimeout.call(source, callback, delay)
    : (callback: () => void, delay?: number) => globalThis.setTimeout(callback, delay);
  const cancelFallback = typeof capturedClearTimeout === "function"
    ? (handle: unknown) => capturedClearTimeout.call(source, handle as number)
    : (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  const now = typeof source?.performance?.now === "function"
    ? source.performance.now.bind(source.performance)
    : () => globalThis.performance?.now?.() ?? Date.now();
  const pending = new Map<number, PendingPresentationFrame>();
  let nextHandle = 0;
  let disposed = false;

  const cancelNativeBranches = (frame: PendingPresentationFrame): void => {
    if (frame.animationHandle !== undefined) {
      try {
        cancelAnimationFrame?.(frame.animationHandle);
      } catch {
        // A realm may reject a handle after its callback has already won.
      }
      frame.animationHandle = undefined;
    }
    if (frame.fallbackHandle !== undefined) {
      try {
        cancelFallback(frame.fallbackHandle);
      } catch {
        // Cancellation is best effort after exactly-once arbitration.
      }
      frame.fallbackHandle = undefined;
    }
  };

  return {
    requestFrame(callback): number {
      if (disposed) {
        return 0;
      }
      nextHandle += 1;
      const logicalHandle = nextHandle;
      const frame: PendingPresentationFrame = { settled: false };
      pending.set(logicalHandle, frame);
      const finish = (timestamp: number): void => {
        const current = pending.get(logicalHandle);
        if (!current || current !== frame || current.settled || disposed) {
          return;
        }
        current.settled = true;
        pending.delete(logicalHandle);
        cancelNativeBranches(current);
        callback(timestamp);
      };

      if (requestAnimationFrame) {
        try {
          const animationHandle = requestAnimationFrame(finish);
          if (frame.settled || disposed) {
            try {
              cancelAnimationFrame?.(animationHandle);
            } catch {
              // Synchronous test realms can settle before returning a handle.
            }
          } else {
            frame.animationHandle = animationHandle;
          }
        } catch {
          // The bounded fallback remains authoritative when rAF is unavailable.
        }
      }
      if (!frame.settled && !disposed) {
        const fallbackHandle = scheduleFallback(
          () => finish(now()),
          PRESENTATION_FRAME_FALLBACK_MS,
        );
        if (frame.settled || disposed) {
          try {
            cancelFallback(fallbackHandle);
          } catch {
            // Synchronous timer fakes may settle before returning a handle.
          }
        } else {
          frame.fallbackHandle = fallbackHandle;
        }
      }
      return pending.has(logicalHandle) ? logicalHandle : 0;
    },
    cancelFrame(handle): void {
      const frame = pending.get(handle);
      if (!frame) {
        return;
      }
      frame.settled = true;
      pending.delete(handle);
      cancelNativeBranches(frame);
    },
    pendingCount(): number {
      return pending.size;
    },
    dispose(): void {
      disposed = true;
      for (const [handle, frame] of pending) {
        frame.settled = true;
        pending.delete(handle);
        cancelNativeBranches(frame);
      }
    },
  };
}

const initiallyCapturedWindow = typeof window === "undefined" ? null : window;
const initiallyCapturedClock = initiallyCapturedWindow
  ? createPresentationClock(initiallyCapturedWindow)
  : null;
const clocksBySource = new WeakMap<object, PresentationClock>();
let fallbackClock: PresentationClock | null = null;

/**
 * Returns the clock captured at content-module evaluation for the production
 * window. Tests and foreign document realms receive a clock bound to their own
 * source without weakening the production capture timing.
 */
export function presentationClockFor(
  source: PresentationClockSource | null | undefined,
): PresentationClock {
  if (source && source === initiallyCapturedWindow && initiallyCapturedClock) {
    return initiallyCapturedClock;
  }
  if (source && typeof source === "object") {
    const existing = clocksBySource.get(source);
    if (existing) {
      return existing;
    }
    const created = createPresentationClock(source);
    clocksBySource.set(source, created);
    return created;
  }
  fallbackClock ??= createPresentationClock(null);
  return fallbackClock;
}
