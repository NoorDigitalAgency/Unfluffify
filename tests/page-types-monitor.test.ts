import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";
import {
  PAGE_TYPES_REFRESH_ALARM,
  PAGE_TYPES_REFRESH_PERIOD_MINUTES,
  createPageTypesMonitor
} from "../src/background/page-types-monitor.js";

function build(overrides = {}) {
  const calls = { created: [], notified: 0 };
  const deps = {
    createAlarm: (name, info) => {
      calls.created.push({ name, info });
    },
    notifyRefreshDue: () => {
      calls.notified += 1;
    },
    ...overrides
  };
  return { monitor: createPageTypesMonitor(deps), calls };
}

test("start schedules the periodic page-types refresh alarm", async () => {
  const { monitor, calls } = build();
  await monitor.start();
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].name, PAGE_TYPES_REFRESH_ALARM);
  assert.equal(calls.created[0].info.periodInMinutes, PAGE_TYPES_REFRESH_PERIOD_MINUTES);
});

test("handleAlarm pushes a refresh-due notice for its alarm", async () => {
  const { monitor, calls } = build();
  const handled = await monitor.handleAlarm({ name: PAGE_TYPES_REFRESH_ALARM });
  assert.equal(handled, true);
  assert.equal(calls.notified, 1);
});

test("handleAlarm ignores foreign alarms", async () => {
  const { monitor, calls } = build();
  const handled = await monitor.handleAlarm({ name: "some-other-alarm" });
  assert.equal(handled, false);
  assert.equal(calls.notified, 0);
});
