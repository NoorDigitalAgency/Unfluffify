export const ARTIFACT_SCHEMA_VERSION = "p14-marking-browser-gate/v1";

export const LEGACY_SOURCE = Object.freeze({
  annotatedTagObject: "0ceb013d4bababa5b82b3cfa1df71d779798c7d9",
  peeledCommit: "28974c2a0c859c91a7167f4757cf84a47ea31e28",
  tree: "ebfb2f160763e3acc3331e62f9824ac18d45fcad",
  blobs: Object.freeze({
    "src/content/core.ts": "821f121555945b14441b49eba505057dc3f17a7f",
    "src/content-main.ts": "ba776d876290b753528dbe8147a5a487fcf90179",
    "src/content/layers/layer-host.ts": "2c578d4fa13ae70fbb5207b43dc4c3cae61ba340",
  }),
});

export const SELECTORS = Object.freeze({
  exclusionSelectors: ["[data-p14-seed='exclude']"],
  inclusionSelectors: ["[data-p14-seed='include']"],
});

export const SELECTORS_BY_MODE = Object.freeze({
  silent: SELECTORS,
  // N-05 separately locks the selector-seeding transaction and include-wins
  // semantics. The marking performance A/B uses the common clean baseline;
  // legacy intentionally paints selector-origin marks through AI layers while
  // the rewrite immediately treats the simulated marks as ordinary explicit rows.
  marking: Object.freeze({ exclusionSelectors: [], inclusionSelectors: [] }),
});

export const FIXTURES = Object.freeze({
  small: Object.freeze({
    name: "small",
    sections: 3,
    cardsPerSection: 4,
    paragraphsPerCard: 2,
  }),
  large: Object.freeze({
    name: "large",
    sections: 20,
    cardsPerSection: 20,
    paragraphsPerCard: 4,
  }),
});

export const OPERATION_NAMES = Object.freeze([
  "silentActivation",
  "silentScrollReposition",
  "silentMutationStabilization",
  "markingActivation",
  "markingHover",
  "markingClickCommitPaint",
  "markingScrollReposition",
  "markingMutationStabilization",
]);

const sharedRelative = Object.freeze({
  p50Ratio: 2,
  p95Ratio: 2,
  slackMs: 50,
});

function operationBudget(p50Ms, p95Ms, relative, rationale) {
  return Object.freeze({
    absoluteMs: Object.freeze({ p50: p50Ms, p95: p95Ms }),
    relative: relative ?? sharedRelative,
    rationale: Object.freeze(rationale),
  });
}

const strictClickRelative = Object.freeze({ p50Ratio: 1.10, p95Ratio: 1.10, slackMs: 0 });

function rationale(absolute, relative) {
  return Object.freeze({ absolute, relative });
}

/**
 * Budgets are intentionally explicit per fixture and percentile. The relative
 * check permits a small fixed slack because frame-aligned operations become
 * ratio-noisy when the legacy median is one or two frames.
 */
export const BUDGETS = Object.freeze({
  small: Object.freeze({
    silentActivation: operationBudget(300, 600, sharedRelative, rationale(
      "A small fixed page should reveal within 600 ms at p95; 300 ms p50 preserves an immediate-feeling silent-mode entry.",
      "The 2x legacy ceiling plus 50 ms covers frame alignment and the rewrite's second painted-frame proof without accepting a multi-second regression.",
    )),
    silentScrollReposition: operationBudget(350, 650, sharedRelative, rationale(
      "The 650 ms p95 ceiling includes the shipping scroll debounce and still restores feedback well below one second on the small fixture.",
      "The 2x legacy ceiling plus 50 ms covers the releases' different fixed scroll debounce/frame phases; wheel-to-paint remains bounded absolutely.",
    )),
    silentMutationStabilization: operationBudget(1_650, 2_100, {
      p50Ratio: 1.5,
      p95Ratio: 1.5,
      slackMs: 250,
    }, rationale(
      "The 2.1 s p95 ceiling contains the real 300 ms mutation debounce and 1.2 s minimum-refresh throttle even if a sample lands near the throttle boundary.",
      "The 1.5x comparison plus 250 ms represents the shipping observer/throttle phase difference after quiescence; it is fixed scheduling cost, not frame-noise allowance.",
    )),
    markingActivation: operationBudget(400, 900, sharedRelative, rationale(
      "A small marking surface, cursor, and armed silent overlay should become usable within 900 ms p95.",
      "The 2x legacy ceiling plus 50 ms covers frame-aligned dual-surface paint while retaining a sub-second absolute limit.",
    )),
    markingHover: operationBudget(100, 180, sharedRelative, rationale(
      "Hover feedback must remain perceptually immediate: at most 180 ms p95 and 100 ms p50.",
      "The 2x legacy ceiling plus 50 ms covers one scheduling/paint-frame phase without permitting sluggish hover feedback.",
    )),
    markingClickCommitPaint: operationBudget(180, 400, strictClickRelative, rationale(
      "The trusted click, canonical commit, persistent exception layer, and two painted frames must finish within 400 ms p95 on the small fixture.",
      "P3's strict contract is rewrite p50 and p95 <= legacy * 1.10 with exactly zero fixed slack.",
    )),
    markingScrollReposition: operationBudget(450, 800, sharedRelative, rationale(
      "The small marking overlay must settle after wheel input within 800 ms p95, including its shipping debounce.",
      "The 2x legacy ceiling plus 50 ms covers fixed debounce/frame-phase differences and is backed by the absolute UX ceiling.",
    )),
    markingMutationStabilization: operationBudget(1_650, 2_100, {
      p50Ratio: 2,
      p95Ratio: 2,
      slackMs: 350,
    }, rationale(
      "The 2.1 s p95 ceiling spans the marking observer's settle/reconcile floors without allowing a prolonged stale overlay.",
      "The 2x comparison plus 350 ms covers the rewrite's 300 ms debounce/1.2 s throttle posture versus legacy's 120 ms debounce/250 ms floor after both are quiesced.",
    )),
  }),
  large: Object.freeze({
    silentActivation: operationBudget(2_500, 4_500, sharedRelative, rationale(
      "The roughly 2,000-node fixture may perform a full classification/layout pass, but silent reveal must remain below 4.5 s p95.",
      "The 2x legacy ceiling plus 50 ms permits the rewrite's complete bridge/evaluator work while the absolute ceiling prevents unbounded scaling.",
    )),
    silentScrollReposition: operationBudget(900, 1_600, sharedRelative, rationale(
      "A large silent overlay must repaint after wheel input within 1.6 s p95, including shipping debounce and full geometry work.",
      "The 2x legacy ceiling plus 50 ms is the initial parity guard for the different fixed debounce/render pipelines; the independent absolute limit remains authoritative.",
    )),
    silentMutationStabilization: operationBudget(3_000, 5_000, {
      p50Ratio: 2,
      p95Ratio: 2,
      slackMs: 500,
    }, rationale(
      "The 5 s p95 ceiling covers the real 300 ms debounce, 1.2 s refresh floor, and a complete roughly 2,000-node rebuild.",
      "The 2x comparison plus 500 ms accounts for fixed throttle alignment plus corpus-scale layout, rather than treating the allowance as random frame noise.",
    )),
    markingActivation: operationBudget(2_500, 4_500, sharedRelative, rationale(
      "The complete large marking and silent surfaces must become usable within 4.5 s p95.",
      "The 2x legacy ceiling plus 50 ms permits the rewrite's shared bridge/evaluation transaction but rejects superlinear multi-second drift.",
    )),
    markingHover: operationBudget(200, 350, sharedRelative, rationale(
      "Even over roughly 2,000 nodes, hover feedback must paint within 350 ms p95.",
      "The 2x legacy ceiling plus 50 ms covers candidate-resolution and frame alignment while the absolute ceiling protects interaction feel.",
    )),
    markingClickCommitPaint: operationBudget(600, 1_100, strictClickRelative, rationale(
      "The production-shaped trusted click through canonical commit and persistent paint must remain below 1.1 s p95 on the large corpus.",
      "P3's strict contract is rewrite p50 and p95 <= legacy * 1.10 with exactly zero fixed slack.",
    )),
    markingScrollReposition: operationBudget(1_000, 1_800, sharedRelative, rationale(
      "A large marking overlay must settle after wheel input within 1.8 s p95, including its shipping debounce and full geometry pass.",
      "The 2x legacy ceiling plus 50 ms is the parity guard for differing fixed debounce/render phases; the independent absolute ceiling limits UX impact.",
    )),
    markingMutationStabilization: operationBudget(3_000, 5_000, {
      p50Ratio: 2,
      p95Ratio: 2,
      slackMs: 600,
    }, rationale(
      "The 5 s p95 ceiling includes the shipping observer/throttle floors and a complete large-corpus reconcile.",
      "The 2x comparison plus 600 ms covers rewrite 300 ms/1.2 s scheduling versus legacy 120 ms/250 ms scheduling plus large-DOM layout after quiescence.",
    )),
  }),
});

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("percentile requires at least one sample");
  }
  const sorted = values.map(Number).sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((percentileValue / 100) * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

export function summarizeSamples(values) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function normalizeSemanticSignature(signature) {
  const rows = Array.isArray(signature?.rows) ? signature.rows : [];
  const classes = Array.isArray(signature?.classes) ? signature.classes : [];
  return {
    rows: rows
      .map((row) => ({
        id: String(row.id),
        xpath: String(row.xpath).toLowerCase(),
        excluded: Boolean(row.excluded),
        explicit: row.explicit === true,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    classes: classes
      .map((entry) => ({ id: String(entry.id), classification: String(entry.classification) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function semanticDifference(left, right) {
  const normalizedLeft = normalizeSemanticSignature(left);
  const normalizedRight = normalizeSemanticSignature(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
    ? null
    : { rewrite: normalizedLeft, legacy: normalizedRight };
}

export function evaluateBudget(rewriteSummary, legacySummary, budget) {
  const absolute = {
    p50: rewriteSummary.p50 <= budget.absoluteMs.p50,
    p95: rewriteSummary.p95 <= budget.absoluteMs.p95,
  };
  const relativeLimits = {
    p50: legacySummary.p50 * budget.relative.p50Ratio + budget.relative.slackMs,
    p95: legacySummary.p95 * budget.relative.p95Ratio + budget.relative.slackMs,
  };
  const relative = {
    p50: rewriteSummary.p50 <= relativeLimits.p50,
    p95: rewriteSummary.p95 <= relativeLimits.p95,
  };
  return {
    pass: absolute.p50 && absolute.p95 && relative.p50 && relative.p95,
    absolute,
    relative,
    limits: {
      absoluteMs: budget.absoluteMs,
      relativeMs: relativeLimits,
      relativeFormula: budget.relative,
    },
  };
}

export function createRunPlan({ warmups = 3, samples = 21 } = {}) {
  const plan = [];
  let sequence = 0;
  for (const [fixtureIndex, fixture] of Object.keys(FIXTURES).entries()) {
    for (let sample = -warmups; sample < samples; sample += 1) {
      for (const [modeIndex, mode] of ["silent", "marking"].entries()) {
        const runtimes = (fixtureIndex + sample + modeIndex) % 2 === 0
          ? ["rewrite", "legacy"]
          : ["legacy", "rewrite"];
        for (const runtime of runtimes) {
          plan.push({
            sequence,
            fixture,
            mode,
            runtime,
            warmup: sample < 0,
            sample: sample < 0 ? sample + warmups : sample,
          });
          sequence += 1;
        }
      }
    }
  }
  return plan;
}
