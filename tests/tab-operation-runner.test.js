import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { createTabOperationRunner } from "../background/tab-operation-runner.js";
import { LIFECYCLE_PHASES } from "../common/world-messaging-contract.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness() {
  const lifecycle = [];
  const spinners = [];
  const updates = [];
  const runner = createTabOperationRunner({
    updateLifecycleState(tabId, event) {
      lifecycle.push({ tabId, event });
    },
    async withTabSpinner(tabId, descriptor, work) {
      spinners.push({ phase: "set", tabId, descriptor });
      try {
        return await work({
          // deno-lint-ignore require-await -- preserves existing promise/callback contract.
          update: async (patch) => {
            updates.push({ tabId, patch });
            return { ok: true };
          }
        });
      } finally {
        spinners.push({ phase: "remove", tabId, key: descriptor.key });
      }
    }
  });
  return { lifecycle, runner, spinners, updates };
}

test("tab operation runner returns a normalized successful result", async () => {
  const { lifecycle, runner, spinners, updates } = createHarness();

  const result = await runner.runTabOperation(7, {
    kind: "render-mode-inspection",
    operationId: "op:7",
    message: "Inspecting page...",
    timeoutMs: 100,
    spinner: { key: "render-mode:7" }
  }, async ({ update }) => {
    await update({ message: "Reloading..." });
    return { ok: true, value: 42 };
  });

  assert.equal(result.ok, true);
  assert.equal(result.operationId, "op:7");
  assert.equal(result.kind, "render-mode-inspection");
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.result, { ok: true, value: 42 });
  assert.deepEqual(spinners.map((entry) => entry.phase), ["set", "remove"]);
  assert.deepEqual(updates, [{ tabId: 7, patch: { message: "Reloading..." } }]);
  assert.equal(lifecycle[0].event.phase, LIFECYCLE_PHASES.STARTED);
  assert.equal(lifecycle.at(-1).event.phase, LIFECYCLE_PHASES.FINISHED);
  assert.equal(lifecycle.at(-1).event.busy, false);
});

test("tab operation runner times out, removes spinner, and ignores late updates", async () => {
  const { lifecycle, runner, spinners, updates } = createHarness();

  const result = await runner.runTabOperation(9, {
    kind: "render-mode-inspection",
    operationId: "op:timeout",
    message: "Inspecting page...",
    timeoutMs: 5,
    spinner: { key: "render-mode:9" }
  }, async ({ update }) => {
    await delay(20);
    await update({ message: "Too late" });
    return { ok: true };
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.error, /Operation timed out after 5 ms/);
  assert.deepEqual(spinners.map((entry) => entry.phase), ["set", "remove"]);
  assert.equal(lifecycle[0].event.phase, LIFECYCLE_PHASES.STARTED);
  assert.equal(lifecycle.at(-1).event.phase, LIFECYCLE_PHASES.FAILED);
  assert.equal(lifecycle.at(-1).event.busy, false);
  assert.equal(lifecycle.at(-1).event.timedOut, true);

  await delay(30);
  assert.deepEqual(updates, []);
});

test("tab operation runner normalizes spinner infrastructure failures", async () => {
  const lifecycle = [];
  const runner = createTabOperationRunner({
    updateLifecycleState(tabId, event) {
      lifecycle.push({ tabId, event });
    },
    // deno-lint-ignore require-await -- preserves existing promise/callback contract.
    async withTabSpinner() {
      throw new Error("spinner failed");
    }
  });

  const result = await runner.runTabOperation(13, {
    kind: "render-mode-inspection",
    operationId: "op:spinner-failed",
    message: "Inspecting page...",
    timeoutMs: 100,
    spinner: { key: "render-mode:13" }
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  }, async () => ({ ok: true }));

  assert.equal(result.ok, false);
  assert.equal(result.operationId, "op:spinner-failed");
  assert.equal(result.error, "spinner failed");
  assert.equal(lifecycle[0].event.phase, LIFECYCLE_PHASES.STARTED);
  assert.equal(lifecycle.at(-1).event.phase, LIFECYCLE_PHASES.FAILED);
  assert.equal(lifecycle.at(-1).event.error, "spinner failed");
});

test("tab operation runner treats lifecycle emission as best-effort", async () => {
  const runner = createTabOperationRunner({
    updateLifecycleState() {
      throw new Error("lifecycle unavailable");
    }
  });

  const result = await runner.runTabOperation(14, {
    kind: "render-mode-inspection",
    operationId: "op:lifecycle-unavailable",
    message: "Inspecting page...",
    timeoutMs: 100,
    spinner: false
  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  }, async () => ({ ok: true }));

  assert.equal(result.ok, true);
  assert.equal(result.operationId, "op:lifecycle-unavailable");
});
