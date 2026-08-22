import {
  createTransientSurfaceManager,
  type TransientDismissReason,
  type TransientSurfaceManager,
} from "../ui/transient-surface-manager";

export type ContentPreviewTransientContext = Readonly<{
  active: boolean;
  restoring: boolean;
}>;

export type ContentTransientEventTarget = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export type ContentTransientSurfaces = Readonly<{
  manager: TransientSurfaceManager;
  attach(eventTarget: ContentTransientEventTarget): void;
  syncPreviewContext(context: ContentPreviewTransientContext): void;
  closeAll(reason: TransientDismissReason): void;
  dispose(): void;
}>;

export type ContentTransientSurfaceOptions = Readonly<{
  requestPreviewExit(): Promise<boolean>;
  onPreviewExitError?(error: unknown): void;
}>;

type DismissedPointer = Readonly<{
  x: number;
  y: number;
  at: number;
}>;

/**
 * Owns one content realm's transient manager, Preview Escape latch, capture
 * listeners, and outside-pointer click suppression. Brain state and the actual
 * Preview exit fact remain injected by the content entrypoint.
 */
export function createContentTransientSurfaces(
  options: ContentTransientSurfaceOptions,
): ContentTransientSurfaces {
  let currentPreview: ContentPreviewTransientContext = { active: false, restoring: false };
  let previewRequestPending = false;
  let dismissedPointer: DismissedPointer | null = null;
  let attachedTarget: ContentTransientEventTarget | null = null;
  let disposed = false;

  const resetPreviewLatch = (): void => {
    previewRequestPending = false;
    // The shared manager deliberately latches one Preview fallback per active
    // occurrence. Toggle through inactive only when the injected request was
    // refused or failed so a later Escape may make a fresh attempt.
    manager.setPreviewContext({ active: false, restoring: false });
    manager.setPreviewContext(currentPreview);
  };

  const requestPreviewExit = (): void => {
    if (disposed || previewRequestPending || !currentPreview.active || currentPreview.restoring) {
      return;
    }
    previewRequestPending = true;
    manager.setPreviewContext({ active: true, restoring: true });
    void Promise.resolve()
      .then(options.requestPreviewExit)
      .then((accepted) => {
        if (!disposed && !accepted) {
          resetPreviewLatch();
        }
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        resetPreviewLatch();
        options.onPreviewExitError?.(error);
      });
  };

  const manager = createTransientSurfaceManager({ onPreviewExit: requestPreviewExit });

  const handleKeyDown: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    manager.handleEscape({
      key: keyboardEvent.key,
      preventDefault: () => keyboardEvent.preventDefault?.(),
      stopImmediatePropagation: () => keyboardEvent.stopImmediatePropagation?.(),
    });
  };

  const handlePointerDown: EventListener = (event) => {
    const pointerEvent = event as PointerEvent;
    if (
      typeof pointerEvent.composedPath !== "function" ||
      !manager.handlePointerDown(pointerEvent)
    ) {
      return;
    }
    dismissedPointer = {
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
      at: pointerEvent.timeStamp,
    };
    pointerEvent.preventDefault?.();
    pointerEvent.stopImmediatePropagation?.();
  };

  const suppressDismissalClick: EventListener = (event) => {
    const mouseEvent = event as MouseEvent;
    const dismissed = dismissedPointer;
    dismissedPointer = null;
    if (
      !dismissed ||
      Math.abs(dismissed.x - mouseEvent.clientX) > 2 ||
      Math.abs(dismissed.y - mouseEvent.clientY) > 2 ||
      Math.abs(dismissed.at - mouseEvent.timeStamp) > 1_000
    ) {
      return;
    }
    mouseEvent.preventDefault?.();
    mouseEvent.stopImmediatePropagation?.();
  };

  const detach = (): void => {
    attachedTarget?.removeEventListener("keydown", handleKeyDown, true);
    attachedTarget?.removeEventListener("pointerdown", handlePointerDown, true);
    attachedTarget?.removeEventListener("click", suppressDismissalClick, true);
    attachedTarget = null;
    dismissedPointer = null;
  };

  return {
    manager,
    attach(eventTarget) {
      if (disposed || attachedTarget === eventTarget) {
        return;
      }
      detach();
      attachedTarget = eventTarget;
      // Install before the interaction shield. Escape is extension authority;
      // the shield must never swallow it as page input while Preview is open.
      eventTarget.addEventListener("keydown", handleKeyDown, true);
      eventTarget.addEventListener("pointerdown", handlePointerDown, true);
      eventTarget.addEventListener("click", suppressDismissalClick, true);
    },
    syncPreviewContext(context) {
      if (disposed) {
        return;
      }
      currentPreview = context;
      if (!context.active) {
        previewRequestPending = false;
      }
      manager.setPreviewContext({
        active: context.active,
        restoring: context.restoring || previewRequestPending,
      });
    },
    closeAll(reason) {
      if (!disposed) {
        manager.closeAll(reason);
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      detach();
      manager.dispose();
      previewRequestPending = false;
      currentPreview = { active: false, restoring: false };
    },
  };
}
