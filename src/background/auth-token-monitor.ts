// Background auth-token readiness monitor. Replaces the popup's 10-minute
// `setInterval` token-validation poll with a browser alarms schedule so the
// check is MV3 suspension-safe (the alarm wakes the worker) and runs even when
// the popup is closed. On an invalid token the monitor notifies the popup, which
// locks configuration and shows the existing toast.

export const AUTH_TOKEN_CHECK_ALARM = "uf-auth-token-check";
export const AUTH_TOKEN_CHECK_PERIOD_MINUTES = 10;

type AuthTokenValidationResult = { ok?: boolean; valid?: boolean } | null;

type AuthTokenMonitorDeps = {
  createAlarm: (name: string, info: { periodInMinutes: number }) => Promise<void> | void;
  validateAuthToken: () => Promise<AuthTokenValidationResult>;
  notifyTokenInvalid: () => Promise<void> | void;
};

export function createAuthTokenMonitor(deps: AuthTokenMonitorDeps) {
  async function start(): Promise<void> {
    await deps.createAlarm(AUTH_TOKEN_CHECK_ALARM, {
      periodInMinutes: AUTH_TOKEN_CHECK_PERIOD_MINUTES
    });
  }

  async function handleAlarm(alarm: { name?: string } | null | undefined): Promise<boolean> {
    if (!alarm || alarm.name !== AUTH_TOKEN_CHECK_ALARM) {
      return false;
    }
    const result = await deps.validateAuthToken();
    if (result && result.ok === true && result.valid === false) {
      await deps.notifyTokenInvalid();
    }
    return true;
  }

  return { start, handleAlarm };
}
