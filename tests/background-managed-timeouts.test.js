import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createManagedTimeoutGroup } from "../src/background/managed-timeouts.js";

function waitFor(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("managed timeout group set schedules callbacks", async () => {
  const group = createManagedTimeoutGroup();
  let fired = false;
  group.set(() => {
    fired = true;
  }, 5);

  await waitFor(25);
  assert.equal(fired, true);
});

test("managed timeout group clear cancels a specific timeout", async () => {
  const group = createManagedTimeoutGroup();
  let fired = false;
  const handle = group.set(() => {
    fired = true;
  }, 20);

  group.clear(handle);
  await waitFor(40);
  assert.equal(fired, false);
});

test("managed timeout group clearAll cancels all pending timeouts", async () => {
  const group = createManagedTimeoutGroup();
  let firedCount = 0;
  group.set(() => {
    firedCount += 1;
  }, 20);
  group.set(() => {
    firedCount += 1;
  }, 30);

  group.clearAll();
  await waitFor(60);
  assert.equal(firedCount, 0);
});
