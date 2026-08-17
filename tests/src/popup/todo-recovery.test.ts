import { describe, expect, it } from "vitest";

import { TODO_RECOVERY_INTERVAL_MS, todoRefreshDue } from "../../../src/popup/todo-recovery";

describe("Todo canonical-feed refresh cadence", () => {
  it("does not turn the signal poll into a Hub poll and refreshes at exactly 15 seconds", () => {
    expect(todoRefreshDue("managed_candidate", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS - 1)).toBe(false);
    expect(todoRefreshDue("managed_candidate", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS)).toBe(true);
    expect(todoRefreshDue("suspended_candidate_removed", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS)).toBe(true);
    expect(todoRefreshDue("suspended_candidate_feed_conflict", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS)).toBe(true);
    expect(todoRefreshDue("unresolved", 0, TODO_RECOVERY_INTERVAL_MS)).toBe(false);
  });
});
