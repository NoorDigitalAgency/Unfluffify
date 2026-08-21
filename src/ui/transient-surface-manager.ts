export type TransientSurfaceKind =
  | "tooltip"
  | "menu"
  | "confirmation"
  | "dialog"
  | "checklist"
  | "busy";

export type TransientDismissReason =
  | "replace"
  | "outside-pointer"
  | "escape"
  | "context-change"
  | "dispose";

export type TransientSurfaceSpec = Readonly<{
  id: string;
  kind: TransientSurfaceKind;
  parentId?: string;
  root: () => EventTarget | null;
  outside: "dismiss" | "ignore";
  escape: "dismiss" | "block";
  dismiss(reason: TransientDismissReason): void;
}>;

export type TransientSurfacePatch = Partial<Pick<
  TransientSurfaceSpec,
  "root" | "outside" | "escape"
>>;

export type TransientSurfaceHandle = Readonly<{
  update(patch: TransientSurfacePatch): void;
  close(reason?: TransientDismissReason): void;
  /** Removes a declarative registration whose owner already closed. */
  unregister(): void;
}>;

export type TransientEscapeResult = "dismissed" | "preview-exit" | "blocked" | "unhandled";

export type TransientEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export type TransientSurfaceSnapshot = Readonly<{
  id: string;
  kind: TransientSurfaceKind;
  parentId?: string;
}>;

export type TransientSurfaceManager = Readonly<{
  open(spec: TransientSurfaceSpec): TransientSurfaceHandle;
  handlePointerDown(event: Pick<PointerEvent, "composedPath">): boolean;
  handleEscape(event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopImmediatePropagation">): TransientEscapeResult;
  setPreviewContext(context: Readonly<{ active: boolean; restoring: boolean }>): void;
  closeAll(reason: TransientDismissReason): void;
  snapshot(): readonly TransientSurfaceSnapshot[];
  dispose(): void;
}>;

type SurfaceRecord = {
  token: number;
  spec: TransientSurfaceSpec;
};

const EPHEMERAL_KINDS = new Set<TransientSurfaceKind>(["tooltip", "menu"]);

/**
 * Owns the dismissal order for one DOM realm. Popup and content each create one
 * instance: sharing policy is useful, sharing DOM state across realms is not.
 */
export function createTransientSurfaceManager(options: Readonly<{
  eventTarget?: TransientEventTarget;
  onPreviewExit?: () => void;
}> = {}): TransientSurfaceManager {
  const stack: SurfaceRecord[] = [];
  let nextToken = 1;
  let previewActive = false;
  let previewRestoring = false;
  let previewExitRequested = false;

  const removeSilentlyFrom = (index: number): void => {
    stack.splice(index);
  };

  const dismissFrom = (index: number, reason: TransientDismissReason): void => {
    const dismissed = stack.splice(index).reverse();
    for (const record of dismissed) {
      record.spec.dismiss(reason);
    }
  };

  const closeAll = (reason: TransientDismissReason): void => {
    dismissFrom(0, reason);
  };

  const manager: TransientSurfaceManager = {
    open(spec) {
      const existingIndex = stack.findIndex((record) => record.spec.id === spec.id);
      if (existingIndex >= 0) {
        const record = stack[existingIndex]!;
        record.spec = spec;
        return createHandle(record);
      }

      if (spec.parentId) {
        const parentIndex = stack.findIndex((record) => record.spec.id === spec.parentId);
        if (parentIndex >= 0) {
          dismissFrom(parentIndex + 1, "replace");
        } else {
          closeAll("replace");
        }
      } else if (EPHEMERAL_KINDS.has(spec.kind)) {
        for (let index = stack.length - 1; index >= 0; index -= 1) {
          if (EPHEMERAL_KINDS.has(stack[index]!.spec.kind)) {
            dismissFrom(index, "replace");
          }
        }
      } else {
        closeAll("replace");
      }

      const record: SurfaceRecord = { token: nextToken++, spec };
      stack.push(record);
      return createHandle(record);
    },
    handlePointerDown(event) {
      const top = stack.at(-1);
      if (!top || top.spec.outside !== "dismiss") {
        return false;
      }
      const root = top.spec.root();
      if (root && event.composedPath().includes(root)) {
        return false;
      }
      dismissFrom(stack.length - 1, "outside-pointer");
      return true;
    },
    handleEscape(event) {
      if (event.key !== "Escape") {
        return "unhandled";
      }
      const top = stack.at(-1);
      if (top) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (top.spec.escape === "block") {
          return "blocked";
        }
        dismissFrom(stack.length - 1, "escape");
        return "dismissed";
      }
      if (!previewActive) {
        return "unhandled";
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (previewRestoring || previewExitRequested) {
        return "blocked";
      }
      previewExitRequested = true;
      options.onPreviewExit?.();
      return "preview-exit";
    },
    setPreviewContext(context) {
      if (context.active !== previewActive) {
        previewExitRequested = false;
        closeAll("context-change");
      } else if (!context.active) {
        previewExitRequested = false;
      }
      previewActive = context.active;
      previewRestoring = context.restoring;
    },
    closeAll,
    snapshot() {
      return stack.map(({ spec }) => ({
        id: spec.id,
        kind: spec.kind,
        ...(spec.parentId ? { parentId: spec.parentId } : {}),
      }));
    },
    dispose() {
      closeAll("dispose");
      options.eventTarget?.removeEventListener("pointerdown", pointerListener, true);
      options.eventTarget?.removeEventListener("keydown", keyListener, true);
      previewActive = false;
      previewRestoring = false;
      previewExitRequested = false;
    },
  };

  const createHandle = (record: SurfaceRecord): TransientSurfaceHandle => ({
    update(patch) {
      const current = stack.find((candidate) => candidate.token === record.token);
      if (current) {
        current.spec = { ...current.spec, ...patch };
      }
    },
    close(reason = "context-change") {
      const index = stack.findIndex((candidate) => candidate.token === record.token);
      if (index >= 0) {
        dismissFrom(index, reason);
      }
    },
    unregister() {
      const index = stack.findIndex((candidate) => candidate.token === record.token);
      if (index >= 0) {
        removeSilentlyFrom(index);
      }
    },
  });

  const pointerListener: EventListener = (event) => {
    manager.handlePointerDown(event as PointerEvent);
  };
  const keyListener: EventListener = (event) => {
    manager.handleEscape(event as KeyboardEvent);
  };
  options.eventTarget?.addEventListener("pointerdown", pointerListener, true);
  options.eventTarget?.addEventListener("keydown", keyListener, true);

  return manager;
}
