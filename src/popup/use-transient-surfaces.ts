import React from "react";

import {
  createTransientSurfaceManager,
  type TransientSurfaceSpec,
  type TransientSurfaceManager,
} from "../ui/transient-surface-manager";

export function useTransientSurfaceManager(options: Readonly<{
  previewActive: boolean;
  previewRestoring: boolean;
  onPreviewExit?: () => void;
}>): TransientSurfaceManager {
  const previewExitRef = React.useRef(options.onPreviewExit);
  previewExitRef.current = options.onPreviewExit;
  const managerRef = React.useRef<TransientSurfaceManager | null>(null);
  if (managerRef.current === null) {
    managerRef.current = createTransientSurfaceManager({
      onPreviewExit: () => previewExitRef.current?.(),
    });
  }
  const manager = managerRef.current;

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      manager.handlePointerDown(event);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      manager.handleKeyDown(event);
    };
    // Capture first so an Escape safety action is decided before a focused
    // control or page bridge can interpret the same physical key press.
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      manager.dispose();
    };
  }, [manager]);

  React.useEffect(() => {
    manager.setPreviewContext({
      active: options.previewActive,
      restoring: options.previewRestoring,
    });
  }, [manager, options.previewActive, options.previewRestoring]);

  return manager;
}

/**
 * Keeps React's declarative surface state synchronized with the realm manager.
 * The wrapper reads the latest callbacks and policies without unregistering a
 * parent (and accidentally dropping a still-rendered child) on every render.
 */
export function useTransientSurfaceRegistration(
  manager: TransientSurfaceManager,
  active: boolean,
  spec: TransientSurfaceSpec,
): void {
  const latestSpec = React.useRef(spec);
  latestSpec.current = spec;
  const handleRef = React.useRef<ReturnType<TransientSurfaceManager["open"]> | null>(null);

  React.useEffect(() => {
    if (!active) {
      return;
    }
    const handle = manager.open({
      ...spec,
      root: () => latestSpec.current.root(),
      dismiss: (reason) => latestSpec.current.dismiss(reason),
    });
    handleRef.current = handle;
    return () => {
      handle.unregister();
      if (handleRef.current === handle) {
        handleRef.current = null;
      }
    };
  }, [active, manager, spec.id, spec.kind, spec.parentId]);

  React.useEffect(() => {
    handleRef.current?.update({
      root: () => latestSpec.current.root(),
      outside: spec.outside,
      escape: spec.escape,
      modal: spec.modal,
      initialFocus: () => latestSpec.current.initialFocus?.() ?? null,
      returnFocus: () => latestSpec.current.returnFocus?.() ?? null,
    });
  }, [spec.escape, spec.modal, spec.outside]);
}
