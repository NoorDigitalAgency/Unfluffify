export function createManagedTimeoutGroup() {
  const handles = new Set<ReturnType<typeof setTimeout>>();

  function clear(handle: ReturnType<typeof setTimeout> | null | undefined): void {
    if (!handle) {
      return;
    }
    clearTimeout(handle);
    handles.delete(handle);
  }

  function set(fn: () => void, ms: unknown): ReturnType<typeof setTimeout> {
    const numericMs = typeof ms === "number" ? ms : Number(ms);
    const timeoutMs = Number.isFinite(numericMs) && numericMs >= 0 ? Math.trunc(numericMs) : 0;
    const handle = setTimeout(() => {
      handles.delete(handle);
      fn();
    }, timeoutMs);
    handles.add(handle);
    return handle;
  }

  function clearAll() {
    for (const handle of handles) {
      clearTimeout(handle);
    }
    handles.clear();
  }

  return {
    set,
    clear,
    clearAll
  };
}
