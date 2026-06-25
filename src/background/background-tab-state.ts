export const tabLifecycleStateByTabId = new Map<number, unknown>();
export const tabSpinnerQueueByTabId = new Map<number, unknown>();
export const tabWorldTraceStateByTabId = new Map<number, unknown>();
export const aiComputeLockExpiresAtByTabId = new Map<number, number>();
export const pageMotionFreezeControlQueueByTarget = new Map<string, unknown>();

function normalizeTabId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function disposeTabState(tabId: unknown): void {
  const normalizedTabId = normalizeTabId(tabId);
  if (!normalizedTabId) {
    return;
  }
  tabLifecycleStateByTabId.delete(normalizedTabId);
  tabSpinnerQueueByTabId.delete(normalizedTabId);
  tabWorldTraceStateByTabId.delete(normalizedTabId);
  aiComputeLockExpiresAtByTabId.delete(normalizedTabId);

  const queuePrefix = `${normalizedTabId}:`;
  for (const queueKey of pageMotionFreezeControlQueueByTarget.keys()) {
    if (typeof queueKey === "string" && queueKey.startsWith(queuePrefix)) {
      pageMotionFreezeControlQueueByTarget.delete(queueKey);
    }
  }
}
