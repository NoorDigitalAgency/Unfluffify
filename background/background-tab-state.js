export const tabLifecycleStateByTabId = new Map();
export const tabSpinnerQueueByTabId = new Map();
export const popupStatePortsByTabId = new Map();
export const tabWorldTraceStateByTabId = new Map();
export const aiComputeLockExpiresAtByTabId = new Map();
export const pageMotionFreezeControlQueueByTarget = new Map();

function normalizeTabId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function disposeTabState(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  tabLifecycleStateByTabId.delete(normalizedTabId);
  tabSpinnerQueueByTabId.delete(normalizedTabId);
  popupStatePortsByTabId.delete(normalizedTabId);
  tabWorldTraceStateByTabId.delete(normalizedTabId);
  aiComputeLockExpiresAtByTabId.delete(normalizedTabId);

  const queuePrefix = `${normalizedTabId}:`;
  for (const queueKey of pageMotionFreezeControlQueueByTarget.keys()) {
    if (typeof queueKey === "string" && queueKey.startsWith(queuePrefix)) {
      pageMotionFreezeControlQueueByTarget.delete(queueKey);
    }
  }
}
