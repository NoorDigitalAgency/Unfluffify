export type FreezeReason = "marking" | "silent-highlight" | "render-mode" | "page-visit";

export function createFreezeController() {
  const activeReasons = new Set<FreezeReason>();
  const deferredCallbacks: Array<() => void> = [];
  return {
    pause(reason: FreezeReason): void {
      activeReasons.add("page-visit");
      activeReasons.add(reason);
    },
    resume(reason: FreezeReason): void {
      activeReasons.delete(reason);
      if (activeReasons.size === 1 && activeReasons.has("page-visit")) {
        const callbacks = deferredCallbacks.splice(0);
        callbacks.forEach((callback) => callback());
      }
    },
    lift(): void {
      activeReasons.clear();
      const callbacks = deferredCallbacks.splice(0);
      callbacks.forEach((callback) => callback());
    },
    defer(callback: () => void): void {
      deferredCallbacks.push(callback);
    },
    isPaused(): boolean {
      return activeReasons.size > 0;
    },
    reasons(): readonly FreezeReason[] {
      return [...activeReasons];
    },
  };
}
