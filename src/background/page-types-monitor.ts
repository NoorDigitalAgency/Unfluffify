// Background property page-types refresh monitor. Replaces the popup's 2-minute
// `setInterval` page-types poll with a browser alarms schedule so the cadence is
// owned by the background worker instead of a popup-local timer. On each tick the
// monitor pushes a `pageTypesRefreshDue` event; the popup re-checks page types
// only while it is open and a property site is active.

export const PAGE_TYPES_REFRESH_ALARM = "uf-page-types-refresh";
export const PAGE_TYPES_REFRESH_PERIOD_MINUTES = 2;

type PageTypesMonitorDeps = {
  createAlarm: (name: string, info: { periodInMinutes: number }) => Promise<void> | void;
  notifyRefreshDue: () => Promise<void> | void;
};

export function createPageTypesMonitor(deps: PageTypesMonitorDeps) {
  async function start(): Promise<void> {
    await deps.createAlarm(PAGE_TYPES_REFRESH_ALARM, {
      periodInMinutes: PAGE_TYPES_REFRESH_PERIOD_MINUTES
    });
  }

  async function handleAlarm(alarm: { name?: string } | null | undefined): Promise<boolean> {
    if (!alarm || alarm.name !== PAGE_TYPES_REFRESH_ALARM) {
      return false;
    }
    await deps.notifyRefreshDue();
    return true;
  }

  return { start, handleAlarm };
}
