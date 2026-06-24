import { test } from "./test-kit.ts";
import { assert } from "./test-kit.ts";

import { runBackgroundTask } from "../background/async-tasks.js";

test("runBackgroundTask returns successful work results", async () => {
  const valueResult = await runBackgroundTask("value-success", Promise.resolve("ok"));
  assert.equal(valueResult, "ok");

  // deno-lint-ignore require-await -- preserves existing promise/callback contract.
  const thunkResult = await runBackgroundTask("thunk-success", async () => 42);
  assert.equal(thunkResult, 42);
});

test("runBackgroundTask reports rejections via trace and resolves undefined", async () => {
  const traces = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const result = await runBackgroundTask(
      "failing-task",
      // deno-lint-ignore require-await -- preserves existing promise/callback contract.
      async () => {
        throw new Error("boom");
      },
      {
        tabId: 17,
        appendTrace: (...args) => {
          traces.push(args);
        }
      }
    );

    assert.equal(result, undefined);
    assert.equal(traces.length, 1);
    assert.deepEqual(traces[0], [17, "task", "error", { label: "failing-task", message: "boom" }]);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /\[background-task\] failing-task failed:/);
  } finally {
    console.warn = originalWarn;
  }
});
