// Per-tab "Without JavaScript" render-mode hold state, persisted in
// chrome.storage.session so it survives service-worker restarts and is readable
// from the popup. A tab is "no-JS held" when a render-mode "Without JavaScript"
// inspection has left it running with JavaScript disabled for inspection. The
// hold is cleared on "With JavaScript", render-mode exit, a genuine navigation,
// or tab close.

const RENDER_MODE_NO_JS_HELD_PREFIX = "renderModeNoJsHeld:";

function normalizeTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function getSessionArea() {
  try {
    return globalThis.chrome && chrome.storage && chrome.storage.session
      ? chrome.storage.session
      : null;
  } catch {
    return null;
  }
}

export function renderModeNoJsHeldStorageKey(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  return normalizedTabId ? `${RENDER_MODE_NO_JS_HELD_PREFIX}${normalizedTabId}` : "";
}

export async function setRenderModeNoJsHeld(tabId, held) {
  const key = renderModeNoJsHeldStorageKey(tabId);
  const session = getSessionArea();
  if (!key || !session) {
    return;
  }
  try {
    if (held) {
      await session.set({ [key]: true });
    } else {
      await session.remove(key);
    }
  } catch {
    // Ignore — session storage may be unavailable during teardown.
  }
}

export async function clearRenderModeNoJsHeld(tabId) {
  await setRenderModeNoJsHeld(tabId, false);
}

export async function isRenderModeNoJsHeld(tabId) {
  const key = renderModeNoJsHeldStorageKey(tabId);
  const session = getSessionArea();
  if (!key || !session) {
    return false;
  }
  try {
    const data = await session.get(key);
    return Boolean(data && data[key]);
  } catch {
    return false;
  }
}

export async function listRenderModeNoJsHeldTabIds() {
  const session = getSessionArea();
  if (!session) {
    return [];
  }
  try {
    const data = await session.get(null);
    return Object.keys(data || {})
      .filter((key) => key.startsWith(RENDER_MODE_NO_JS_HELD_PREFIX) && data[key])
      .map((key) => normalizeTabId(key.slice(RENDER_MODE_NO_JS_HELD_PREFIX.length)))
      .filter(Boolean);
  } catch {
    return [];
  }
}
