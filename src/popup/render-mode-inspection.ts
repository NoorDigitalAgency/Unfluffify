export const RENDER_MODE_INSPECTION_WATCHDOG_MS = 20_000;

export type WatchedInspection<T> =
  | Readonly<{ status: "settled"; value: T }>
  | Readonly<{ status: "timeout" }>;

/** The browser API can strand a reload callback. This watchdog owns only the UI
 * wait: the background has its own shorter recovery timeout that restores
 * JavaScript. Clearing this timer on every exit keeps a retry from inheriting
 * stale teardown work. */
export async function watchRenderModeInspection<T>(
  run: () => Promise<T>,
  timeoutMs = RENDER_MODE_INSPECTION_WATCHDOG_MS,
): Promise<WatchedInspection<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      run().then((value) => ({ status: "settled" as const, value })),
      new Promise<Readonly<{ status: "timeout" }>>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
