import { describe, expect, it, vi } from "vitest";

import {
  AUTH_TOKEN_CHECK_ALARM,
  AUTH_TOKEN_CHECK_PERIOD_MINUTES,
  createAuthTokenMonitor,
} from "../../../src/background/auth-token-monitor";
import type { AuthValidateResult } from "../../../src/lynx/accounts";

function monitorWith(results: AuthValidateResult[]) {
  let index = 0;
  const createAlarm = vi.fn();
  const clearAlarm = vi.fn();
  const onInvalid = vi.fn();
  const onError = vi.fn();
  const validate = vi.fn(async () => results[Math.min(index++, results.length - 1)]);
  const monitor = createAuthTokenMonitor({
    validate,
    createAlarm,
    clearAlarm,
    onInvalid,
    onError,
    now: () => 1_700_000_000_000,
  });
  return { monitor, createAlarm, clearAlarm, onInvalid, onError, validate };
}

describe("auth token monitor alarm", () => {
  it("registers a 10-minute alarm rather than a timer", async () => {
    const { monitor, createAlarm } = monitorWith([{ status: "skipped" }]);

    await monitor.start();

    expect(createAlarm).toHaveBeenCalledExactlyOnceWith(AUTH_TOKEN_CHECK_ALARM, {
      periodInMinutes: AUTH_TOKEN_CHECK_PERIOD_MINUTES,
    });
    expect(AUTH_TOKEN_CHECK_PERIOD_MINUTES).toBe(10);
  });

  it("clears its alarm on stop", async () => {
    const { monitor, clearAlarm } = monitorWith([{ status: "skipped" }]);

    await monitor.stop();

    expect(clearAlarm).toHaveBeenCalledExactlyOnceWith(AUTH_TOKEN_CHECK_ALARM);
  });

  it("only answers to its own alarm", async () => {
    const { monitor, validate } = monitorWith([{ status: "valid", httpStatus: 200 }]);

    await expect(monitor.handleAlarm({ name: "uf-rewrite-brain-keepalive" })).resolves.toBe(false);
    await expect(monitor.handleAlarm(null)).resolves.toBe(false);
    await expect(monitor.handleAlarm(undefined)).resolves.toBe(false);
    expect(validate).not.toHaveBeenCalled();

    await expect(monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM })).resolves.toBe(true);
    expect(validate).toHaveBeenCalledOnce();
  });

  it("reports a validation crash without letting it escape the alarm", async () => {
    const onError = vi.fn();
    const monitor = createAuthTokenMonitor({
      validate: async () => { throw new Error("transport exploded"); },
      onError,
    });

    await expect(monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM })).resolves.toBe(true);
    expect(onError).toHaveBeenCalledOnce();
    expect(monitor.status().state).toBe("unknown");
  });
});

describe("auth token monitor verdict", () => {
  it("starts unknown with no check recorded", () => {
    const { monitor } = monitorWith([{ status: "valid", httpStatus: 200 }]);

    expect(monitor.status()).toEqual({ state: "unknown", checkedAt: 0 });
  });

  it("records a valid token and stamps the check", async () => {
    const { monitor, onInvalid } = monitorWith([{ status: "valid", httpStatus: 200 }]);

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });

    expect(monitor.status()).toEqual({ state: "valid", checkedAt: 1_700_000_000_000 });
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("notifies once when a token turns invalid, not on every later check", async () => {
    const { monitor, onInvalid } = monitorWith([
      { status: "invalid", httpStatus: 401 },
      { status: "invalid", httpStatus: 401 },
    ]);

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });

    expect(monitor.status().state).toBe("invalid");
    expect(onInvalid).toHaveBeenCalledOnce();
  });

  it("notifies again after the token recovers and is rejected anew", async () => {
    const { monitor, onInvalid } = monitorWith([
      { status: "invalid", httpStatus: 401 },
      { status: "valid", httpStatus: 200 },
      { status: "invalid", httpStatus: 403 },
    ]);

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });

    expect(monitor.status().state).toBe("invalid");
    expect(onInvalid).toHaveBeenCalledTimes(2);
  });

  it("never signs out on a skipped check — there was nothing to validate", async () => {
    const { monitor, onInvalid } = monitorWith([
      { status: "valid", httpStatus: 200 },
      { status: "skipped" },
    ]);

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });

    // The earlier verdict is stale once there is no token, but not a rejection.
    expect(monitor.status().state).toBe("unknown");
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("never signs out on a server error — the check failed, not the token", async () => {
    const { monitor, onInvalid } = monitorWith([
      { status: "valid", httpStatus: 200 },
      { status: "error", httpStatus: 500 },
    ]);

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });

    // A 5xx must leave the last known-good verdict standing.
    expect(monitor.status().state).toBe("valid");
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("keeps an invalid verdict standing through a later server error", async () => {
    const { monitor, onInvalid } = monitorWith([
      { status: "invalid", httpStatus: 401 },
      { status: "error", httpStatus: 503 },
    ]);

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });

    expect(monitor.status().state).toBe("invalid");
    expect(onInvalid).toHaveBeenCalledOnce();
  });

  it("shares one verdict between the manual check and the alarm", async () => {
    const { monitor, onInvalid } = monitorWith([{ status: "invalid", httpStatus: 401 }]);

    // The popup's "Check token" button goes through the same entry point, so the
    // two can never disagree about the current state.
    await expect(monitor.check()).resolves.toEqual({ status: "invalid", httpStatus: 401 });
    expect(monitor.status().state).toBe("invalid");

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
    expect(onInvalid).toHaveBeenCalledOnce();
  });

  it("does not poll the network when nothing is stored to check", async () => {
    // services.accounts.validate() short-circuits to `skipped` without a request
    // when no token is held; the monitor must accept that rather than force one.
    const { monitor, validate } = monitorWith([{ status: "skipped" }]);

    await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });

    expect(validate).toHaveBeenCalledOnce();
    expect(monitor.status().state).toBe("unknown");
  });
});
