import { describe, expect, it } from "vitest";

import {
  evaluate,
  evaluateBranch,
  type EvaluationNode,
  type EvaluationResult,
} from "../src/domain/evaluate";
import type { CanonicalMarkSet } from "../src/domain/schema/marking";

const BRANCH_COUNT = 100;
const LEAVES_PER_BRANCH = 20;
const SAMPLE_COUNT = 11;
const OPERATIONS_PER_SAMPLE = 1;

function standardLargeDomFixture(): Readonly<{
  root: EvaluationNode;
  target: EvaluationNode;
}> {
  const branches = Array.from({ length: BRANCH_COUNT }, (_, branchIndex): EvaluationNode => ({
    key: `section-${branchIndex + 1}`,
    tagName: "SECTION",
    xpath: `/html[1]/body[1]/main[1]/section[${branchIndex + 1}]`,
    visible: true,
    structuralBoundary: true,
    children: Array.from({ length: LEAVES_PER_BRANCH }, (_, leafIndex): EvaluationNode => ({
      key: `section-${branchIndex + 1}-paragraph-${leafIndex + 1}`,
      tagName: "P",
      xpath: `/html[1]/body[1]/main[1]/section[${branchIndex + 1}]/p[${leafIndex + 1}]`,
      visible: true,
      ownsDirectText: true,
    })),
  }));
  const main: EvaluationNode = {
    key: "main",
    tagName: "MAIN",
    xpath: "/html[1]/body[1]/main[1]",
    visible: true,
    structuralBoundary: true,
    children: branches,
  };
  const root: EvaluationNode = {
    key: "html",
    tagName: "HTML",
    xpath: "/html[1]",
    visible: true,
    children: [{
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [main],
    }],
  };
  return { root, target: branches[Math.floor(BRANCH_COUNT / 2)]! };
}

function normalized(result: EvaluationResult): Readonly<{
  overlay: readonly (readonly [string, string])[];
  rows: EvaluationResult["rows"];
}> {
  return {
    overlay: [...result.overlay.entries()].sort(([left], [right]) => left.localeCompare(right)),
    rows: result.rows,
  };
}

function p95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1]!;
}

describe("large-tree evaluator splice performance and output equivalence", () => {
  it("keeps pure branch evaluation exact and p95 within the pure full-tree evaluation budget", () => {
    const fixture = standardLargeDomFixture();
    const emptyMarks: CanonicalMarkSet = { rows: [] };
    const marked: CanonicalMarkSet = {
      rows: [{ xpath: fixture.target.xpath, excluded: true, explicit: true }],
    };
    const baseline = evaluate(emptyMarks, { root: fixture.root });
    const runBranch = (): EvaluationResult => evaluateBranch(baseline, {
      root: fixture.target,
      canonicalMarks: marked,
    });
    // This is intentionally a Node-only evaluator comparison. It measures no DOM
    // bridge, hit testing, event dispatch, layout, overlay construction, or paint;
    // the full-tree evaluator is only the semantic oracle and comparative budget.
    const runLegacyFullTree = (): EvaluationResult => evaluate(marked, { root: fixture.root });

    for (let warmup = 0; warmup < 3; warmup += 1) {
      runBranch();
      runLegacyFullTree();
    }

    expect(normalized(runBranch())).toEqual(normalized(runLegacyFullTree()));

    const branchSamples: number[] = [];
    const legacySamples: number[] = [];
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      let started = performance.now();
      for (let operation = 0; operation < OPERATIONS_PER_SAMPLE; operation += 1) {
        runBranch();
      }
      branchSamples.push(performance.now() - started);

      started = performance.now();
      for (let operation = 0; operation < OPERATIONS_PER_SAMPLE; operation += 1) {
        runLegacyFullTree();
      }
      legacySamples.push(performance.now() - started);
    }

    const branchP95 = p95(branchSamples);
    const legacyP95 = p95(legacySamples);
    // Branch work must retain a wide margin below a full-tree pass. This catches
    // accidental document-wide XPath comparisons/assertion maps in the physical
    // input path while remaining relative to the host's current CPU speed.
    expect(branchP95, `branch p95 ${branchP95.toFixed(2)}ms; legacy p95 ${legacyP95.toFixed(2)}ms`)
      .toBeLessThanOrEqual(legacyP95 * 0.2);
  }, 15_000);
});
