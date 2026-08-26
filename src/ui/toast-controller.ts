export type ToastTone = "success" | "warning" | "danger";

export type ToastOccurrence = Readonly<{
  id: number;
  message: string;
  tone: ToastTone;
}>;

export type TransientToast = ToastOccurrence;

export const TOAST_DURATION_MS: Readonly<Record<ToastTone, number>> = {
  success: 1_800,
  warning: 4_000,
  danger: 6_000,
};

export type ToastClock = Readonly<{
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

export type ToastController = Readonly<{
  current(): ToastOccurrence | null;
  show(input: Readonly<{ message: string; tone: ToastTone; persistent?: boolean }>): ToastOccurrence | null;
  dismiss(id: number): boolean;
  clear(): void;
  subscribe(listener: (toast: ToastOccurrence | null) => void): () => void;
  dispose(): void;
}>;

const defaultClock: ToastClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Owns one notification occurrence. Ordinary outcomes retain their fixed
 * deadline; an explicitly persistent operator failure has no deadline and is
 * replaced or dismissed through the same occurrence fence.
 */
export function createToastController(
  options: Readonly<{ clock?: ToastClock }> = {},
): ToastController {
  const clock = options.clock ?? defaultClock;
  const listeners = new Set<(toast: ToastOccurrence | null) => void>();
  let nextId = 1;
  let toast: ToastOccurrence | null = null;
  let clearHandle: unknown = null;
  let disposed = false;

  const cancelDeadline = (): void => {
    if (clearHandle === null) {
      return;
    }
    clock.clearTimeout(clearHandle);
    clearHandle = null;
  };

  const publish = (): void => {
    for (const listener of [...listeners]) {
      listener(toast);
    }
  };

  const clearCurrent = (): void => {
    cancelDeadline();
    if (toast === null) {
      return;
    }
    toast = null;
    publish();
  };

  return {
    current: () => toast,
    show(input) {
      if (disposed || input.message.length === 0) {
        return null;
      }
      cancelDeadline();
      const occurrence: ToastOccurrence = {
        id: nextId,
        message: input.message,
        tone: input.tone,
      };
      nextId += 1;
      toast = occurrence;
      if (input.persistent !== true) {
        clearHandle = clock.setTimeout(() => {
          if (toast?.id !== occurrence.id) {
            return;
          }
          clearHandle = null;
          toast = null;
          publish();
        }, TOAST_DURATION_MS[input.tone]);
      }
      publish();
      return occurrence;
    },
    dismiss(id) {
      if (toast?.id !== id) {
        return false;
      }
      clearCurrent();
      return true;
    },
    clear: clearCurrent,
    subscribe(listener) {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearCurrent();
      listeners.clear();
    },
  };
}
