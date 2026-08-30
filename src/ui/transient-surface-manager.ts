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
  modal?: boolean;
  initialFocus?: () => EventTarget | null;
  returnFocus?: () => EventTarget | null;
  dismiss(reason: TransientDismissReason): void;
}>;

export type TransientSurfacePatch = Partial<Pick<
  TransientSurfaceSpec,
  "root" | "outside" | "escape" | "modal" | "initialFocus" | "returnFocus"
>>;

export type TransientSurfaceHandle = Readonly<{
  update(patch: TransientSurfacePatch): void;
  close(reason?: TransientDismissReason): void;
  /** Removes a declarative registration whose owner already closed. */
  unregister(): void;
}>;

export type TransientEscapeResult = "dismissed" | "preview-exit" | "blocked" | "trapped" | "unhandled";

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
  handleKeyDown(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault" | "stopImmediatePropagation">): TransientEscapeResult;
  setPreviewContext(context: Readonly<{ active: boolean; restoring: boolean }>): void;
  closeAll(reason: TransientDismissReason): void;
  snapshot(): readonly TransientSurfaceSnapshot[];
  dispose(): void;
}>;

type SurfaceRecord = {
  token: number;
  spec: TransientSurfaceSpec;
  returnFocus: EventTarget | null;
  releaseModal: (() => void) | null;
};

const EPHEMERAL_KINDS = new Set<TransientSurfaceKind>(["tooltip", "menu"]);

type FocusElement = EventTarget & {
  focus(options?: FocusOptions): void;
  isConnected?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  parentElement?: FocusElement | null;
  children?: ArrayLike<FocusElement>;
  ownerDocument?: { activeElement?: EventTarget | null };
  contains?(target: EventTarget | null): boolean;
  querySelectorAll?(selectors: string): ArrayLike<FocusElement>;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  hasAttribute?(name: string): boolean;
  inert?: boolean;
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusElement(value: EventTarget | null | undefined): FocusElement | null {
  return value && typeof (value as FocusElement).focus === "function"
    ? value as FocusElement
    : null;
}

function canReceiveFocus(element: FocusElement | null): element is FocusElement {
  return Boolean(
    element &&
    element.isConnected !== false &&
    element.disabled !== true &&
    element.hidden !== true &&
    element.getAttribute?.("aria-hidden") !== "true" &&
    !element.hasAttribute?.("inert"),
  );
}

function focusableWithin(root: FocusElement): FocusElement[] {
  const candidates = root.querySelectorAll?.(FOCUSABLE_SELECTOR);
  return candidates
    ? Array.from(candidates).filter((candidate) => canReceiveFocus(candidate))
    : [];
}

type InertSnapshot = Readonly<{
  element: FocusElement;
  inert: boolean | undefined;
  inertAttribute: boolean;
  ariaHidden: string | null;
}>;

function captureInert(element: FocusElement): InertSnapshot {
  return {
    element,
    inert: element.inert,
    inertAttribute: element.hasAttribute?.("inert") === true,
    ariaHidden: element.getAttribute?.("aria-hidden") ?? null,
  };
}

function setInert(element: FocusElement, inert: boolean): void {
  if ("inert" in element) {
    element.inert = inert;
  }
  if (inert) {
    element.setAttribute?.("inert", "");
    element.setAttribute?.("aria-hidden", "true");
  } else {
    element.removeAttribute?.("inert");
    element.removeAttribute?.("aria-hidden");
  }
}

function restoreInert(snapshot: InertSnapshot): void {
  if (snapshot.inert !== undefined && "inert" in snapshot.element) {
    snapshot.element.inert = snapshot.inert;
  }
  if (snapshot.inertAttribute) snapshot.element.setAttribute?.("inert", "");
  else snapshot.element.removeAttribute?.("inert");
  if (snapshot.ariaHidden === null) snapshot.element.removeAttribute?.("aria-hidden");
  else snapshot.element.setAttribute?.("aria-hidden", snapshot.ariaHidden);
}

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

  const currentActiveElement = (spec: TransientSurfaceSpec): EventTarget | null => {
    const root = spec.root() as FocusElement | null;
    return root?.ownerDocument?.activeElement ??
      (typeof document === "undefined" ? null : document.activeElement);
  };

  const activateModal = (record: SurfaceRecord): void => {
    if (!record.spec.modal) {
      return;
    }
    const root = focusElement(record.spec.root());
    if (!root) {
      return;
    }
    const snapshots: InertSnapshot[] = [];
    const parent = root.parentElement;
    if (parent?.children) {
      for (const sibling of Array.from(parent.children)) {
        snapshots.push(captureInert(sibling));
        setInert(sibling, sibling !== root);
      }
    } else {
      snapshots.push(captureInert(root));
      setInert(root, false);
    }
    const hadTabIndex = root.hasAttribute?.("tabindex") === true;
    const previousTabIndex = root.getAttribute?.("tabindex") ?? null;
    if (!hadTabIndex) {
      root.setAttribute?.("tabindex", "-1");
    }
    const requested = focusElement(record.spec.initialFocus?.());
    const initial = canReceiveFocus(requested)
      ? requested
      : focusableWithin(root)[0] ?? root;
    initial.focus({ preventScroll: true });
    record.releaseModal = () => {
      for (const snapshot of snapshots.reverse()) {
        restoreInert(snapshot);
      }
      if (!hadTabIndex) root.removeAttribute?.("tabindex");
      else if (previousTabIndex !== null) root.setAttribute?.("tabindex", previousTabIndex);
    };
  };

  const deactivateSurface = (record: SurfaceRecord): void => {
    record.releaseModal?.();
    record.releaseModal = null;
    const explicitReturn = focusElement(record.spec.returnFocus?.());
    const fallbackReturn = focusElement(record.returnFocus);
    const target = canReceiveFocus(explicitReturn)
      ? explicitReturn
      : canReceiveFocus(fallbackReturn) ? fallbackReturn : null;
    target?.focus({ preventScroll: true });
  };

  const removeSilentlyFrom = (index: number): void => {
    const removed = stack.splice(index).reverse();
    for (const record of removed) {
      deactivateSurface(record);
    }
  };

  const dismissFrom = (index: number, reason: TransientDismissReason): void => {
    const dismissed = stack.splice(index).reverse();
    for (const record of dismissed) {
      deactivateSurface(record);
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

      const record: SurfaceRecord = {
        token: nextToken++,
        spec,
        returnFocus: spec.returnFocus?.() ?? currentActiveElement(spec),
        releaseModal: null,
      };
      stack.push(record);
      activateModal(record);
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
    handleKeyDown(event) {
      if (event.key === "Escape") {
        return manager.handleEscape(event);
      }
      if (event.key !== "Tab") {
        return "unhandled";
      }
      const top = stack.at(-1);
      if (!top?.spec.modal) {
        return "unhandled";
      }
      const root = focusElement(top.spec.root());
      if (!root) {
        return "unhandled";
      }
      const focusables = focusableWithin(root);
      const active = root.ownerDocument?.activeElement ??
        (typeof document === "undefined" ? null : document.activeElement);
      const activeIndex = focusables.findIndex((candidate) => candidate === active);
      const movingBackward = event.shiftKey === true;
      const target = focusables.length === 0
        ? root
        : movingBackward
          ? activeIndex <= 0 ? focusables.at(-1)! : focusables[activeIndex - 1]!
          : activeIndex < 0 || activeIndex >= focusables.length - 1
            ? focusables[0]!
            : focusables[activeIndex + 1]!;
      event.preventDefault();
      event.stopImmediatePropagation();
      target.focus({ preventScroll: true });
      return "trapped";
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
    manager.handleKeyDown(event as KeyboardEvent);
  };
  options.eventTarget?.addEventListener("pointerdown", pointerListener, true);
  options.eventTarget?.addEventListener("keydown", keyListener, true);

  return manager;
}
