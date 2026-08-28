import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUDGETS,
  FIXTURES,
  INPUT_LONG_TASK_BUDGET_MS,
  INPUT_OPERATION_NAMES_BY_MODE,
  LEGACY_SOURCE,
  OPERATION_NAMES,
  SELECTORS,
  SELECTORS_BY_MODE,
  createRunPlan,
  evaluateBudget,
  normalizeSemanticSignature,
  percentile,
  semanticDifference,
  summarizeSamples,
  validateInputLongTaskWindows,
} from "../scripts/performance/p14/contract.mjs";
import { renderFixtureBody, renderFixturePage } from "../scripts/performance/p14/fixture.mjs";

const EXPECTED_LEGACY_SOURCE = {
  annotatedTagObject: "0ceb013d4bababa5b82b3cfa1df71d779798c7d9",
  peeledCommit: "28974c2a0c859c91a7167f4757cf84a47ea31e28",
  tree: "ebfb2f160763e3acc3331e62f9824ac18d45fcad",
  blobs: {
    "src/content/core.ts": "821f121555945b14441b49eba505057dc3f17a7f",
    "src/content-main.ts": "ba776d876290b753528dbe8147a5a487fcf90179",
    "src/content/layers/layer-host.ts": "2c578d4fa13ae70fbb5207b43dc4c3cae61ba340",
  },
} as const;

const EXPECTED_OPERATIONS = [
  "silentActivation",
  "silentScrollReposition",
  "silentMutationStabilization",
  "markingActivation",
  "markingHover",
  "markingClickCommitPaint",
  "markingScrollReposition",
  "markingMutationStabilization",
] as const;

const EXPECTED_BUDGETS = {
  small: {
    silentActivation: [300, 600, 2, 2, 50],
    silentScrollReposition: [350, 650, 2, 2, 50],
    silentMutationStabilization: [1_650, 2_100, 1.5, 1.5, 250],
    markingActivation: [400, 900, 2, 2, 50],
    markingHover: [100, 180, 2, 2, 50],
    markingClickCommitPaint: [180, 400, 1.10, 1.10, 0],
    markingScrollReposition: [450, 800, 2, 2, 50],
    markingMutationStabilization: [1_650, 2_100, 2, 2, 350],
  },
  large: {
    silentActivation: [2_500, 4_500, 2, 2, 50],
    silentScrollReposition: [900, 1_600, 2, 2, 50],
    silentMutationStabilization: [3_000, 5_000, 2, 2, 500],
    markingActivation: [2_500, 4_500, 2, 2, 50],
    markingHover: [200, 350, 2, 2, 50],
    markingClickCommitPaint: [600, 1_100, 1.10, 1.10, 0],
    markingScrollReposition: [1_000, 1_800, 2, 2, 50],
    markingMutationStabilization: [3_000, 5_000, 2, 2, 600],
  },
} as const;

function compactBudget(budget: (typeof BUDGETS)[keyof typeof BUDGETS][string]) {
  return [
    budget.absoluteMs.p50,
    budget.absoluteMs.p95,
    budget.relative.p50Ratio,
    budget.relative.p95Ratio,
    budget.relative.slackMs,
  ];
}

const CANONICAL_SIGNATURE = {
  rows: [
    { id: "implicit-include", xpath: "/html[1]/body[1]/main[1]/p[1]", excluded: false, explicit: false },
    { id: "explicit-include", xpath: "/html[1]/body[1]/main[1]/p[2]", excluded: false, explicit: true },
    { id: "implicit-exception", xpath: "/html[1]/body[1]/main[1]/p[3]", excluded: true, explicit: false },
    { id: "explicit-exception", xpath: "/html[1]/body[1]/main[1]/p[4]", excluded: true, explicit: true },
  ],
  classes: [
    { id: "implicit-include", classification: "implicit-include" },
    { id: "explicit-include", classification: "explicit-include" },
    { id: "implicit-exception", classification: "exception" },
    { id: "explicit-exception", classification: "immutable" },
  ],
} as const;

describe("P14 real-browser performance gate contract", () => {
  it("pins the annotated legacy release, peeled commit, tree, and every source blob", () => {
    expect(LEGACY_SOURCE).toEqual(EXPECTED_LEGACY_SOURCE);
  });

  it("uses real selector seeds for silent mode and a common clean baseline for the marking A/B", () => {
    expect(SELECTORS).toEqual({
      exclusionSelectors: ["[data-p14-seed='exclude']"],
      inclusionSelectors: ["[data-p14-seed='include']"],
    });
    expect(SELECTORS_BY_MODE).toEqual({
      silent: SELECTORS,
      marking: { exclusionSelectors: [], inclusionSelectors: [] },
    });
    expect(SELECTORS_BY_MODE.silent).toBe(SELECTORS);
  });

  it("keeps the default plan at three warmups and 21 samples with alternating runtime order", () => {
    const plan = createRunPlan();

    expect(plan).toHaveLength(2 * (3 + 21) * 2 * 2);
    expect(plan.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: plan.length }, (_, index) => index),
    );

    for (const [fixtureIndex, fixture] of ["small", "large"].entries()) {
      const fixturePlan = plan.filter((entry) => entry.fixture === fixture);
      expect(fixturePlan).toHaveLength((3 + 21) * 2 * 2);

      for (let runIndex = 0; runIndex < 24; runIndex += 1) {
        const group = fixturePlan.slice(runIndex * 4, runIndex * 4 + 4);
        const warmup = runIndex < 3;
        const sample = warmup ? runIndex : runIndex - 3;

        expect(group.map((entry) => ({ mode: entry.mode, warmup: entry.warmup, sample: entry.sample })))
          .toEqual([
            { mode: "silent", warmup, sample },
            { mode: "silent", warmup, sample },
            { mode: "marking", warmup, sample },
            { mode: "marking", warmup, sample },
          ]);
        expect(group.slice(0, 2).map((entry) => entry.runtime).sort()).toEqual(["legacy", "rewrite"]);
        expect(group.slice(2, 4).map((entry) => entry.runtime)).toEqual(
          [...group.slice(0, 2).map((entry) => entry.runtime)].reverse(),
        );

        if (runIndex > 0) {
          const priorSilentOrder = fixturePlan
            .slice((runIndex - 1) * 4, (runIndex - 1) * 4 + 2)
            .map((entry) => entry.runtime);
          expect(group.slice(0, 2).map((entry) => entry.runtime)).toEqual(
            [...priorSilentOrder].reverse(),
          );
        }
      }

      const firstSilentOrder = fixturePlan.slice(0, 2).map((entry) => entry.runtime);
      expect(firstSilentOrder).toEqual(fixtureIndex === 0
        ? ["legacy", "rewrite"]
        : ["rewrite", "legacy"]);
    }
  });

  it("locks the large corpus to 20 sections by 20 cards by four text leaves", () => {
    expect(FIXTURES.large).toEqual({
      name: "large",
      sections: 20,
      cardsPerSection: 20,
      paragraphsPerCard: 4,
    });

    const body = renderFixtureBody("large");
    expect(body.match(/data-p14-section=/g)).toHaveLength(20);
    expect(body.match(/data-p14-card=/g)).toHaveLength(20 * 20);
    expect(body.match(/data-p14-id="s\d+-c\d+-p\d+"/g)).toHaveLength(20 * 20 * 4);

    const page = renderFixturePage({ fixture: "large", runtime: "rewrite", nonce: "contract" });
    const stableIds = [...page.matchAll(/\bdata-p14-id="([^"]+)"/g)].map((match) => match[1]!);
    const pageElements = [...page.matchAll(/<[a-z][a-z0-9-]*\b[^>]*>/gi)].map((match) => match[0]);

    expect(stableIds).toHaveLength(2_038);
    expect(new Set(stableIds).size).toBe(2_038);
    expect(pageElements).toHaveLength(2_038);
    expect(pageElements.filter((element) => !/\bdata-p14-id="[^"]+"/.test(element))).toEqual([]);
    expect(stableIds).toEqual(expect.arrayContaining([
      "html",
      "head",
      "meta-charset",
      "meta-viewport",
      "title",
      "fixture-style",
      "extension-api-shim",
      "runtime-script",
      "body",
      "header",
      "fixture-root",
      "control-block",
      "click-boundary",
      "seed-exclude",
      "seed-include",
      "click-target",
      "scroll-anchor",
      "mutation-anchor",
    ]));
    expect(page).toContain('<p id="p14-page-banner" data-p14-id="header">');
    expect(page).toContain('<main id="p14-fixture-root" data-p14-id="fixture-root"');
    expect(page).toContain('<section id="p14-mutation-slot" data-p14-id="control-block">');
  });

  it("locks every operation budget for both fixtures and keeps click comparison strict", () => {
    expect(OPERATION_NAMES).toEqual(EXPECTED_OPERATIONS);

    for (const fixture of ["small", "large"] as const) {
      expect(Object.keys(BUDGETS[fixture])).toEqual(EXPECTED_OPERATIONS);
      for (const operation of EXPECTED_OPERATIONS) {
        const budget = BUDGETS[fixture][operation];
        expect(compactBudget(budget)).toEqual(EXPECTED_BUDGETS[fixture][operation]);
        expect(budget.rationale.absolute.trim().length).toBeGreaterThan(40);
        expect(budget.rationale.relative.trim().length).toBeGreaterThan(40);
      }

      const clickBudget = BUDGETS[fixture].markingClickCommitPaint;
      expect(clickBudget.rationale.relative).toContain("<= legacy * 1.10");
      expect(clickBudget.rationale.relative).toContain("zero fixed slack");
      const legacy = { p50: 100, p95: 100 };
      expect(evaluateBudget({ p50: 110, p95: 110 }, legacy, clickBudget).pass).toBe(true);
      const p50Failure = evaluateBudget({ p50: 110.001, p95: 110 }, legacy, clickBudget);
      expect(p50Failure).toMatchObject({
        pass: false,
        relative: { p50: false, p95: true },
      });
      expect(p50Failure.limits.relativeMs.p50).toBeCloseTo(110);
      expect(p50Failure.limits.relativeMs.p95).toBeCloseTo(110);
      expect(evaluateBudget({ p50: 110, p95: 110.001 }, legacy, clickBudget)).toMatchObject({
        pass: false,
        relative: { p50: true, p95: false },
      });
    }
  });

  it("normalizes ordering and XPath case while comparing every canonical row and class", () => {
    const equivalent = {
      rows: [...CANONICAL_SIGNATURE.rows]
        .reverse()
        .map((row) => ({ ...row, xpath: row.xpath.toUpperCase() })),
      classes: [...CANONICAL_SIGNATURE.classes].reverse(),
    };

    expect(semanticDifference(equivalent, CANONICAL_SIGNATURE)).toBeNull();
    expect(normalizeSemanticSignature(equivalent)).toEqual(normalizeSemanticSignature(CANONICAL_SIGNATURE));

    for (let index = 0; index < CANONICAL_SIGNATURE.rows.length; index += 1) {
      const row = CANONICAL_SIGNATURE.rows[index]!;
      const mutations = [
        { ...row, id: `${row.id}-changed` },
        { ...row, xpath: `${row.xpath}/span[1]` },
        { ...row, excluded: !row.excluded },
        { ...row, explicit: !row.explicit },
      ];
      for (const mutated of mutations) {
        const rows = CANONICAL_SIGNATURE.rows.map((entry, rowIndex) => rowIndex === index ? mutated : entry);
        expect(semanticDifference({ ...CANONICAL_SIGNATURE, rows }, CANONICAL_SIGNATURE), `row ${index}`)
          .not.toBeNull();
      }
    }

    for (let index = 0; index < CANONICAL_SIGNATURE.classes.length; index += 1) {
      const entry = CANONICAL_SIGNATURE.classes[index]!;
      for (const mutated of [
        { ...entry, id: `${entry.id}-changed` },
        { ...entry, classification: `${entry.classification}-changed` },
      ]) {
        const classes = CANONICAL_SIGNATURE.classes.map((candidate, classIndex) => (
          classIndex === index ? mutated : candidate
        ));
        expect(semanticDifference({ ...CANONICAL_SIGNATURE, classes }, CANONICAL_SIGNATURE), `class ${index}`)
          .not.toBeNull();
      }
    }
  });

  it("uses nearest-rank percentiles and reports the exact measured sample cardinality", () => {
    const samples = [21, 1, 20, 2, 19, 3, 18, 4, 17, 5, 16, 6, 15, 7, 14, 8, 13, 9, 12, 10, 11];
    const originalOrder = [...samples];

    expect(percentile(samples, 50)).toBe(11);
    expect(percentile(samples, 95)).toBe(20);
    expect(summarizeSamples(samples)).toEqual({ count: 21, p50: 11, p95: 20, min: 1, max: 21 });
    expect(samples).toEqual(originalOrder);
    expect(() => percentile([], 50)).toThrow("percentile requires at least one sample");
  });

  it("requires complete Chromium long-task evidence for every physical input window", () => {
    expect(INPUT_LONG_TASK_BUDGET_MS).toBe(50);
    expect(INPUT_OPERATION_NAMES_BY_MODE).toEqual({
      silent: ["silentScrollReposition"],
      marking: ["markingHover", "markingClickCommitPaint", "markingScrollReposition"],
    });
    const windowFor = (operation: string, duration = 0) => ({
      operation,
      startTime: 100,
      endTime: 200,
      supported: true,
      entries: duration > 0
        ? [{ name: "self", entryType: "longtask", startTime: 120, duration }]
        : [],
      maxDurationMs: duration,
    });
    const runs = [
      {
        sequence: 0,
        mode: "silent",
        runtime: "rewrite",
        inputLongTasks: [windowFor("silentScrollReposition")],
      },
      {
        sequence: 1,
        mode: "marking",
        runtime: "rewrite",
        inputLongTasks: INPUT_OPERATION_NAMES_BY_MODE.marking.map((operation) => windowFor(operation)),
      },
    ];
    expect(validateInputLongTaskWindows(runs)).toMatchObject({ pass: true, budgetMs: 50 });
    expect(validateInputLongTaskWindows([])).toMatchObject({ pass: false });
    expect(validateInputLongTaskWindows([{
      ...runs[1],
      inputLongTasks: [
        windowFor("markingHover", 50.001),
        ...runs[1]!.inputLongTasks.slice(1),
      ],
    }])).toMatchObject({ pass: false });
    expect(validateInputLongTaskWindows([{
      ...runs[0],
      inputLongTasks: [],
    }])).toMatchObject({ pass: false });
    expect(validateInputLongTaskWindows([{
      ...runs[0],
      inputLongTasks: [{ ...windowFor("silentScrollReposition"), supported: false }],
    }])).toMatchObject({ pass: false });
    expect(validateInputLongTaskWindows([{
      ...runs[0],
      runtime: "legacy",
      inputLongTasks: [windowFor("silentScrollReposition", 75)],
    }])).toMatchObject({
      pass: true,
      checks: [{ budgetApplies: false, windows: [{ withinBudget: false }] }],
    });

    const controller = readFileSync("scripts/performance/p14/playwright-controller.js", "utf8");
    expect(controller).toContain('PerformanceObserver.supportedEntryTypes?.includes("longtask")');
    expect(controller).toContain('observer?.observe({ type: "longtask", buffered: true })');
    expect(controller).toContain("capture?.observer?.takeRecords()");
  });
});
