const DEFAULT_ALARM_PREFIX = "unfluffify-tab-inactivity:";
const DEFAULT_INACTIVITY_TIMEOUT_MS = 30_000;

function normalizeTabId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function normalizeScope(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "default";
}

function getAlarmsApi(chromeRef: typeof chrome | null): typeof chrome.alarms | null {
  return chromeRef && chromeRef.alarms && typeof chromeRef.alarms.create === "function"
    ? chromeRef.alarms
    : null;
}

type TabInactivityObserverOptions = {
  chromeRef?: typeof chrome | null;
  alarmPrefix?: unknown;
  defaultTimeoutMs?: unknown;
  now?: () => number;
};

export function createTabInactivityObserver(options: TabInactivityObserverOptions = {}) {
  const chromeRef = options.chromeRef || globalThis.chrome || null;
  const alarmPrefix = typeof options.alarmPrefix === "string" && options.alarmPrefix
    ? options.alarmPrefix
    : DEFAULT_ALARM_PREFIX;
  const defaultTimeoutMsValue = options.defaultTimeoutMs;
  const defaultTimeoutMs = Number.isFinite(defaultTimeoutMsValue) && (defaultTimeoutMsValue as number) > 0
    ? Math.trunc(defaultTimeoutMsValue as number)
    : DEFAULT_INACTIVITY_TIMEOUT_MS;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const listeners = new Set<(event: Record<string, unknown>) => unknown>();
  const scheduledByKey = new Map<string, Record<string, unknown>>();

  function buildKey(tabId: unknown, scope: unknown): string {
    const normalizedTabId = normalizeTabId(tabId);
    return normalizedTabId ? `${normalizeScope(scope)}:${normalizedTabId}` : "";
  }

  function buildAlarmName(tabId: unknown, scope: unknown): string {
    const key = buildKey(tabId, scope);
    return key ? `${alarmPrefix}${key}` : "";
  }

  function parseAlarmName(alarmName: unknown): { key: string; scope: string; tabId: number } | null {
    if (typeof alarmName !== "string" || !alarmName.startsWith(alarmPrefix)) {
      return null;
    }
    const key = alarmName.slice(alarmPrefix.length);
    const separatorIndex = key.lastIndexOf(":");
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
      return null;
    }
    const tabId = normalizeTabId(key.slice(separatorIndex + 1));
    if (!tabId) {
      return null;
    }
    return {
      key,
      scope: normalizeScope(key.slice(0, separatorIndex)),
      tabId
    };
  }

  async function notify(event: Record<string, unknown>): Promise<void> {
    const normalizedEvent = {
      observedAt: now(),
      ...event
    };
    for (const listener of listeners) {
      await Promise.resolve(listener(normalizedEvent));
    }
  }

  async function clearTab(tabId: unknown, options: { scope?: unknown } = {}): Promise<boolean> {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return false;
    }
    const scope = normalizeScope(options.scope);
    const key = buildKey(normalizedTabId, scope);
    scheduledByKey.delete(key);
    const alarms = getAlarmsApi(chromeRef);
    if (alarms && typeof alarms.clear === "function") {
      await alarms.clear(buildAlarmName(normalizedTabId, scope)).catch(() => false);
    }
    return true;
  }

  async function hasPendingSchedule(key: string, alarmName: string): Promise<boolean> {
    if (scheduledByKey.has(key)) {
      return true;
    }
    const alarms = getAlarmsApi(chromeRef);
    if (alarms && typeof alarms.get === "function") {
      const existing = await alarms.get(alarmName).catch(() => null);
      if (existing) {
        return true;
      }
    }
    return false;
  }

  async function scheduleInactive(
    tabId: unknown,
    options: { scope?: unknown; refresh?: unknown; timeoutMs?: unknown; reason?: unknown } = {}
  ): Promise<boolean> {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return false;
    }
    const scope = normalizeScope(options.scope);
    const key = buildKey(normalizedTabId, scope);
    const alarmName = buildAlarmName(normalizedTabId, scope);
    // Anchor the inactivity deadline to when the tab first became inactive. The
    // watch is re-evaluated on unrelated tab/window focus events (and again after
    // the service worker restarts and replays them); without this guard each
    // re-evaluation would recreate the alarm with a fresh deadline and the
    // restore could be postponed indefinitely.
    if (!options.refresh && (await hasPendingSchedule(key, alarmName))) {
      return true;
    }
    const timeoutMsValue = options.timeoutMs;
    const timeoutMs = Number.isFinite(timeoutMsValue) && (timeoutMsValue as number) > 0
      ? Math.trunc(timeoutMsValue as number)
      : defaultTimeoutMs;
    const deadlineAt = now() + timeoutMs;
    scheduledByKey.set(key, {
      deadlineAt,
      reason: typeof options.reason === "string" ? options.reason : "",
      scope,
      tabId: normalizedTabId
    });
    const alarms = getAlarmsApi(chromeRef);
    if (alarms) {
      await alarms.create(alarmName, { when: deadlineAt });
    }
    await notify({
      type: "scheduled",
      tabId: normalizedTabId,
      scope,
      reason: typeof options.reason === "string" ? options.reason : "",
      deadlineAt
    });
    return true;
  }

  async function recordActivity(
    tabId: unknown,
    options: { scope?: unknown; source?: unknown; pageUrl?: unknown } = {}
  ): Promise<boolean> {
    const normalizedTabId = normalizeTabId(tabId);
    if (!normalizedTabId) {
      return false;
    }
    await notify({
      type: "activity",
      tabId: normalizedTabId,
      scope: normalizeScope(options.scope),
      source: typeof options.source === "string" ? options.source : "",
      pageUrl: typeof options.pageUrl === "string" ? options.pageUrl : ""
    });
    return true;
  }

  async function handleAlarm(alarm: { name?: unknown } | null | undefined): Promise<boolean> {
    const parsed = parseAlarmName(alarm && alarm.name);
    if (!parsed) {
      return false;
    }
    const scheduled = scheduledByKey.get(parsed.key) || {};
    scheduledByKey.delete(parsed.key);
    await notify({
      type: "inactive",
      tabId: parsed.tabId,
      scope: parsed.scope,
      reason: typeof scheduled.reason === "string" ? scheduled.reason : "",
      deadlineAt: Number.isFinite(scheduled.deadlineAt) ? scheduled.deadlineAt : 0,
      alarmName: alarm?.name
    });
    return true;
  }

  function subscribe(listener: unknown): () => void {
    if (typeof listener !== "function") {
      return () => {};
    }
    const normalizedListener = listener as (event: Record<string, unknown>) => unknown;
    listeners.add(normalizedListener);
    return () => {
      listeners.delete(normalizedListener);
    };
  }

  return {
    buildAlarmName,
    clearTab,
    handleAlarm,
    parseAlarmName,
    recordActivity,
    scheduleInactive,
    subscribe
  };
}
