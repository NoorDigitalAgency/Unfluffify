import type { AuthValidateResult } from "../lynx/accounts";

/** Token validity is polled on a browser alarm rather than a timer so the check
 *  survives MV3 suspension and still runs with the popup closed. Without it an
 *  expired token is only discovered when a call 401s mid-run. */
export const AUTH_TOKEN_CHECK_ALARM = "uf-rewrite-auth-token-check";
export const AUTH_TOKEN_CHECK_PERIOD_MINUTES = 10;

export type AuthTokenState = "unknown" | "valid" | "invalid";

export type AuthTokenStatus = Readonly<{
  state: AuthTokenState;
  checkedAt: number;
}>;

export type AuthTokenMonitorHost = Readonly<{
  validate: () => Promise<AuthValidateResult>;
  createAlarm?: (name: string, info: { periodInMinutes: number }) => void | Promise<void>;
  clearAlarm?: (name: string) => void | Promise<void>;
  now?: () => number;
  onInvalid?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}>;

export function createAuthTokenMonitor(host: AuthTokenMonitorHost) {
  const now = host.now ?? (() => Date.now());
  let state: AuthTokenState = "unknown";
  let checkedAt = 0;

  /** Folds a validation outcome into the cached verdict. Deliberately narrow:
   *  only a definitive `invalid` means "signed out". `skipped` means there was
   *  nothing to check, and `error` means the check itself failed — treating
   *  either as a rejection would sign the operator out over a 5xx or a cleared
   *  stage base. */
  const adopt = (result: AuthValidateResult): AuthValidateResult => {
    if (result.status === "valid") {
      state = "valid";
      checkedAt = now();
    } else if (result.status === "invalid") {
      state = "invalid";
      checkedAt = now();
    } else if (result.status === "skipped") {
      // No token or no stage base: any earlier verdict is stale, not wrong.
      state = "unknown";
      checkedAt = now();
    }
    return result;
  };

  const check = async (): Promise<AuthValidateResult> => {
    const previous = state;
    const result = adopt(await host.validate());
    if (result.status === "invalid" && previous !== "invalid") {
      await host.onInvalid?.();
    }
    return result;
  };

  return {
    alarmName: AUTH_TOKEN_CHECK_ALARM,
    periodInMinutes: AUTH_TOKEN_CHECK_PERIOD_MINUTES,
    async start(): Promise<void> {
      await host.createAlarm?.(AUTH_TOKEN_CHECK_ALARM, {
        periodInMinutes: AUTH_TOKEN_CHECK_PERIOD_MINUTES,
      });
    },
    async stop(): Promise<void> {
      await host.clearAlarm?.(AUTH_TOKEN_CHECK_ALARM);
    },
    status(): AuthTokenStatus {
      return { state, checkedAt };
    },
    /** Shared by the alarm and the popup's manual check so the two can never
     *  disagree about the current verdict. */
    check,
    async handleAlarm(alarm: { name?: string } | null | undefined): Promise<boolean> {
      if (!alarm || alarm.name !== AUTH_TOKEN_CHECK_ALARM) {
        return false;
      }
      try {
        await check();
      } catch (error) {
        host.onError?.(error);
      }
      return true;
    },
  };
}
