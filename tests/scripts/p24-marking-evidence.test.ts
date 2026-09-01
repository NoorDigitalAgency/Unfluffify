import { describe, expect, it } from "vitest";

import {
  diffDecisionRows,
  explicitExclusionEvidence,
  explicitInclusionEvidence,
  normalizeDecisionRows,
  widenedOwnerClearEvidence,
} from "../../scripts/p24-marking-evidence.mjs";

const status = (
  markingToggleSeq: number,
  contentRows: Array<{ xpath: string; classification: "included" | "excluded" }>,
) => ({ markingToggleSeq, contentRows });

describe("P24 canonical marking evidence", () => {
  it("deduplicates and orders current decision rows without using the dirty counter", () => {
    expect(normalizeDecisionRows({
      markedCount: 99,
      contentRows: [
        { xpath: "/b", classification: "excluded" },
        { xpath: "/a", classification: "included" },
        { xpath: "/b", classification: "excluded" },
      ],
    })).toEqual([
      { xpath: "/a", classification: "included" },
      { xpath: "/b", classification: "excluded" },
    ]);
  });

  it("treats an already-excluded no-op as a no-op rather than a contract failure", () => {
    const before = status(4, [{ xpath: "/main/header", classification: "excluded" }]);
    const after = status(4, [{ xpath: "/main/header", classification: "excluded" }]);
    expect(diffDecisionRows(before, after)).toMatchObject({ added: [], removed: [] });
    expect(explicitExclusionEvidence(before, after).passed).toBe(false);
  });

  it("proves explicit inclusion and exclusion through classification-specific row diffs", () => {
    const baseline = status(1, []);
    expect(explicitInclusionEvidence(
      baseline,
      status(2, [{ xpath: "/main/p[1]", classification: "included" }]),
    ).passed).toBe(true);
    expect(explicitExclusionEvidence(
      baseline,
      status(2, [{ xpath: "/main/p[2]", classification: "excluded" }]),
    ).passed).toBe(true);
  });

  it("passes exact widened-owner clear when the added owner disappears even as the dirty counter rises", () => {
    const beforeCtrl = { markedCount: 5, ...status(10, []) };
    const afterCtrl = {
      markedCount: 6,
      ...status(11, [{ xpath: "/main/section[2]", classification: "excluded" }]),
    };
    const afterClear = { markedCount: 7, ...status(12, []) };
    expect(widenedOwnerClearEvidence(beforeCtrl, afterCtrl, afterClear)).toMatchObject({
      passed: true,
      removedWidenedOwners: [{ xpath: "/main/section[2]", classification: "excluded" }],
    });
  });
});
