import { describe, expect, it } from "vitest";

import {
  TODO_RECOVERY_INTERVAL_MS,
  todoRefreshDue,
  todoSectionExpanded,
} from "../../../src/popup/todo-recovery";

describe("Todo canonical-feed refresh cadence", () => {
  it("does not turn the signal poll into a Hub poll and refreshes at exactly 15 seconds", () => {
    expect(todoRefreshDue("managed_candidate", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS - 1)).toBe(false);
    expect(todoRefreshDue("managed_candidate", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS)).toBe(true);
    expect(todoRefreshDue("suspended_candidate_removed", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS)).toBe(true);
    expect(todoRefreshDue("suspended_candidate_feed_conflict", 1_000, 1_000 + TODO_RECOVERY_INTERVAL_MS)).toBe(true);
    expect(todoRefreshDue("unresolved", 0, TODO_RECOVERY_INTERVAL_MS)).toBe(false);
  });

  it("opens current and incomplete groups, closes completed groups, and preserves an override", () => {
    expect(todoSectionExpanded({ current: true, markedCount: 1 })).toBe(true);
    expect(todoSectionExpanded({ current: false, markedCount: 0 })).toBe(true);
    expect(todoSectionExpanded({ current: false, markedCount: 1 })).toBe(false);
    expect(todoSectionExpanded({ current: false, markedCount: 1 }, true)).toBe(true);
    expect(todoSectionExpanded({ current: true, markedCount: 0 }, false)).toBe(false);
  });
});
