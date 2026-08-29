export type NativeActivationTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Binds a critical popup action directly to its physical control. React's root
 * delegation can miss the first click immediately after Chrome foregrounds a
 * side panel and a concurrent list-focus render commits. Capture on the target
 * runs before delegated or bubbling work can replace the control or stop the
 * event, while keeping native pointer and keyboard click semantics without
 * dispatching twice.
 */
export function bindNativeClickActivation(
  target: NativeActivationTarget,
  activate: () => void,
): () => void {
  const options = { capture: true } as const;
  const listener: EventListener = () => activate();
  target.addEventListener("click", listener, options);
  return () => target.removeEventListener("click", listener, options);
}
