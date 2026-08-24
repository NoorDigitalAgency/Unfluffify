const WINDOW_SCROLL_TIMEOUT_MS = 8_000;
const WINDOW_SCROLL_STABLE_MS = 220;

/**
 * Waits for a smooth window scroll to reach its target, without trusting paint
 * callbacks to deliver the timeout. The page is deliberately motion-frozen in
 * silent mode, and that posture can starve requestAnimationFrame completely.
 */
export function waitForWindowScrollEnd(
  targetY: number,
  isStale: () => boolean,
): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let reachedAt = Math.abs(window.scrollY - targetY) <= 2 ? startedAt : 0;
    let rafHandle = 0;
    let sampleTimerHandle: ReturnType<typeof setTimeout> | null = null;
    let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (rafHandle && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafHandle);
      }
      if (sampleTimerHandle !== null) {
        clearTimeout(sampleTimerHandle);
      }
      if (deadlineHandle !== null) {
        clearTimeout(deadlineHandle);
      }
      resolve();
    };
    const sample = (): void => {
      if (isStale() || Date.now() - startedAt >= WINDOW_SCROLL_TIMEOUT_MS) {
        finish();
        return;
      }
      if (Math.abs(window.scrollY - targetY) <= 2) {
        reachedAt ||= Date.now();
        if (Date.now() - reachedAt >= WINDOW_SCROLL_STABLE_MS) {
          finish();
          return;
        }
      } else {
        reachedAt = 0;
      }
      if (typeof window.requestAnimationFrame === "function") {
        rafHandle = window.requestAnimationFrame(sample);
      } else {
        sampleTimerHandle = setTimeout(sample, 16);
      }
    };
    // This must be scheduled independently of requestAnimationFrame. A frozen
    // page may never deliver another frame, but activation must still fail open.
    deadlineHandle = setTimeout(finish, WINDOW_SCROLL_TIMEOUT_MS);
    sample();
  });
}
