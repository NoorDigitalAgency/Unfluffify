export type NativeActivationTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Binds a critical popup action directly to its physical control. React's root
 * delegation can miss the first click immediately after Chrome foregrounds a
 * side panel and a concurrent list-focus render commits. A target-owned listener
 * keeps native pointer and keyboard click semantics without dispatching twice.
 */
export function bindNativeClickActivation(
  target: NativeActivationTarget,
  activate: () => void,
): () => void {
  const listener: EventListener = () => activate();
  target.addEventListener("click", listener);
  return () => target.removeEventListener("click", listener);
}
