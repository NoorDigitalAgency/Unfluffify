import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import {
  AUTH_TOKEN_CHECK_ALARM,
  AUTH_TOKEN_CHECK_PERIOD_MINUTES,
  createAuthTokenMonitor
} from "../src/background/auth-token-monitor.js";

function build(overrides = {}) {
  const calls = { created: [], validated: 0, notified: 0 };
  const deps = {
    createAlarm: (name, info) => {
      calls.created.push({ name, info });
    },
    validateAuthToken: async () => ({ ok: true, valid: true }),
    notifyTokenInvalid: () => {
      calls.notified += 1;
    },
    ...overrides
  };
  return { monitor: createAuthTokenMonitor(deps), calls };
}

test("start schedules the periodic auth-token alarm", async () => {
  const { monitor, calls } = build();
  await monitor.start();
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].name, AUTH_TOKEN_CHECK_ALARM);
  assert.equal(calls.created[0].info.periodInMinutes, AUTH_TOKEN_CHECK_PERIOD_MINUTES);
});

test("handleAlarm notifies the popup only when the token is invalid", async () => {
  const { monitor, calls } = build({
    validateAuthToken: async () => ({ ok: true, valid: false })
  });
  const handled = await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
  assert.equal(handled, true);
  assert.equal(calls.notified, 1);
});

test("handleAlarm does not notify when the token is still valid", async () => {
  const { monitor, calls } = build();
  await monitor.handleAlarm({ name: AUTH_TOKEN_CHECK_ALARM });
  assert.equal(calls.notified, 0);
});

test("handleAlarm ignores foreign alarms", async () => {
  const { monitor, calls } = build({
    validateAuthToken: async () => ({ ok: true, valid: false })
  });
  const handled = await monitor.handleAlarm({ name: "some-other-alarm" });
  assert.equal(handled, false);
  assert.equal(calls.notified, 0);
});
