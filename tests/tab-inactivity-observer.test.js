import test from "node:test";
import assert from "node:assert/strict";

import { createTabInactivityObserver } from "../background/tab-inactivity-observer.js";

test("tab inactivity observer schedules scoped alarms and emits inactive events", async () => {
  const createdAlarms = [];
  const clearedAlarms = [];
  const events = [];
  const observer = createTabInactivityObserver({
    alarmPrefix: "test-inactivity:",
    defaultTimeoutMs: 30000,
    now: () => 1000,
    chromeRef: {
      alarms: {
        async create(name, options) {
          createdAlarms.push({ name, options });
        },
        async clear(name) {
          clearedAlarms.push(name);
          return true;
        }
      }
    }
  });

  observer.subscribe((event) => {
    events.push(event);
  });

  await observer.scheduleInactive(42, {
    scope: "render-mode-no-js",
    reason: "held-inactive",
    timeoutMs: 25000
  });
  await observer.recordActivity(42, {
    source: "content",
    pageUrl: "https://example.test/page"
  });
  await observer.handleAlarm({ name: "test-inactivity:render-mode-no-js:42" });
  await observer.clearTab(42, { scope: "render-mode-no-js" });

  assert.deepEqual(createdAlarms, [
    {
      name: "test-inactivity:render-mode-no-js:42",
      options: { when: 26000 }
    }
  ]);
  assert.deepEqual(clearedAlarms, ["test-inactivity:render-mode-no-js:42"]);
  assert.deepEqual(
    events.map((event) => ({
      type: event.type,
      tabId: event.tabId,
      scope: event.scope,
      reason: event.reason || "",
      source: event.source || "",
      pageUrl: event.pageUrl || ""
    })),
    [
      {
        type: "scheduled",
        tabId: 42,
        scope: "render-mode-no-js",
        reason: "held-inactive",
        source: "",
        pageUrl: ""
      },
      {
        type: "activity",
        tabId: 42,
        scope: "default",
        reason: "",
        source: "content",
        pageUrl: "https://example.test/page"
      },
      {
        type: "inactive",
        tabId: 42,
        scope: "render-mode-no-js",
        reason: "held-inactive",
        source: "",
        pageUrl: ""
      }
    ]
  );
});

test("tab inactivity observer anchors the deadline and ignores repeat schedules", async () => {
  const createdAlarms = [];
  let nowValue = 1000;
  const stored = new Map();
  const observer = createTabInactivityObserver({
    alarmPrefix: "test-inactivity:",
    defaultTimeoutMs: 30000,
    now: () => nowValue,
    chromeRef: {
      alarms: {
        async create(name, options) {
          createdAlarms.push({ name, options });
          stored.set(name, { name, ...options });
        },
        async clear(name) {
          stored.delete(name);
          return true;
        },
        async get(name) {
          return stored.get(name) || null;
        }
      }
    }
  });

  await observer.scheduleInactive(7, { scope: "render-mode-no-js", timeoutMs: 30000 });
  // Unrelated focus events re-run the watch; the deadline must not move.
  nowValue = 12000;
  await observer.scheduleInactive(7, { scope: "render-mode-no-js", timeoutMs: 30000 });
  // Simulate a service-worker restart that loses the in-memory schedule map but
  // keeps the persisted alarm. The existing alarm must still be respected.
  const restarted = createTabInactivityObserver({
    alarmPrefix: "test-inactivity:",
    defaultTimeoutMs: 30000,
    now: () => 20000,
    chromeRef: {
      alarms: {
        async create(name, options) {
          createdAlarms.push({ name, options });
          stored.set(name, { name, ...options });
        },
        async clear(name) {
          stored.delete(name);
          return true;
        },
        async get(name) {
          return stored.get(name) || null;
        }
      }
    }
  });
  await restarted.scheduleInactive(7, { scope: "render-mode-no-js", timeoutMs: 30000 });

  assert.deepEqual(createdAlarms, [
    { name: "test-inactivity:render-mode-no-js:7", options: { when: 31000 } }
  ]);

  // An explicit refresh re-anchors the deadline to the current time.
  nowValue = 40000;
  await observer.scheduleInactive(7, { scope: "render-mode-no-js", timeoutMs: 30000, refresh: true });
  assert.deepEqual(createdAlarms[1], {
    name: "test-inactivity:render-mode-no-js:7",
    options: { when: 70000 }
  });
});

test("tab inactivity observer ignores unrelated alarms and invalid tab IDs", async () => {
  let eventCount = 0;
  const observer = createTabInactivityObserver({
    alarmPrefix: "test-inactivity:",
    chromeRef: {
      alarms: {
        async create() {},
        async clear() {
          return true;
        }
      }
    }
  });
  observer.subscribe(() => {
    eventCount += 1;
  });

  assert.equal(await observer.scheduleInactive(0), false);
  assert.equal(await observer.recordActivity(null), false);
  assert.equal(await observer.handleAlarm({ name: "other:default:1" }), false);
  assert.equal(await observer.handleAlarm({ name: "test-inactivity:default:not-a-tab" }), false);
  assert.equal(eventCount, 0);
});
