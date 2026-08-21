import {
  createToastController,
  type ToastClock,
  type ToastTone,
  type TransientToast,
} from "../ui/toast-controller";

const CONTENT_TOAST_FENCE = Symbol("content-toast-fence");

type FenceIdentity = Readonly<{
  owner: object;
  generation: number;
}>;

/** An opaque snapshot of one content-toast lifecycle generation. */
export type ContentToastFence = Readonly<{
  [CONTENT_TOAST_FENCE]: FenceIdentity;
}>;

export type ContentToastInput = Readonly<{
  message: string;
  tone: ToastTone;
}>;

export type ContentToastLifecycle = Readonly<{
  current(): TransientToast | null;
  show(input: ContentToastInput): TransientToast | null;
  captureFence(): ContentToastFence;
  showIfCurrent(fence: ContentToastFence, input: ContentToastInput): TransientToast | null;
  dismiss(id: number): boolean;
  retire(): void;
  suspend(): void;
  resume(): void;
  subscribe(listener: (toast: TransientToast | null) => void): () => void;
  dispose(): void;
}>;

/**
 * Owns content-realm toast policy while leaving occurrence IDs and deadlines to
 * the shared toast controller. A fence lets asynchronous producers prove that
 * the page/lifecycle occurrence they started in is still current.
 */
export function createContentToastLifecycle(
  options: Readonly<{ clock?: ToastClock }> = {},
): ContentToastLifecycle {
  const controller = createToastController(options);
  const owner = {};
  let generation = 0;
  let suspended = false;
  let disposed = false;

  const show = (input: ContentToastInput): TransientToast | null => {
    if (disposed || suspended) {
      return null;
    }
    return controller.show(input);
  };

  return {
    current: () => controller.current(),
    show,
    captureFence: () => ({
      [CONTENT_TOAST_FENCE]: { owner, generation },
    }),
    showIfCurrent(fence, input) {
      const identity = fence[CONTENT_TOAST_FENCE];
      if (identity.owner !== owner || identity.generation !== generation) {
        return null;
      }
      return show(input);
    },
    dismiss: (id) => controller.dismiss(id),
    retire() {
      if (disposed) {
        return;
      }
      generation += 1;
      controller.clear();
    },
    suspend() {
      if (disposed) {
        return;
      }
      generation += 1;
      suspended = true;
      controller.clear();
    },
    resume() {
      if (!disposed) {
        suspended = false;
      }
    },
    subscribe: (listener) => controller.subscribe(listener),
    dispose() {
      if (disposed) {
        return;
      }
      generation += 1;
      suspended = true;
      disposed = true;
      controller.dispose();
    },
  };
}

export type { ToastClock, ToastTone, TransientToast } from "../ui/toast-controller";
