// @ts-nocheck
export function createManagedTimeoutGroup() {
  const handles = new Set();

  function clear(handle) {
    if (!handle) {
      return;
    }
    clearTimeout(handle);
    handles.delete(handle);
  }

  function set(fn, ms) {
    const timeoutMs = Number.isFinite(ms) && ms >= 0 ? Math.trunc(ms) : 0;
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
