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

describe("large-DOM marking performance and output equivalence", () => {
  it("keeps branch toggle-to-paint output exact and p95 within the legacy full-tree budget", () => {
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
    // Legacy repainted from a full document evaluation. Retain that exact work
    // profile as both the semantic oracle and the comparative time budget.
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
    expect(branchP95, `branch p95 ${branchP95.toFixed(2)}ms; legacy p95 ${legacyP95.toFixed(2)}ms`)
      .toBeLessThanOrEqual(legacyP95 * 1.1);
  }, 15_000);
});
