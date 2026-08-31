import { describe, expect, it } from "vitest";
import { readFileSync } from "./file-kit.ts";
import {
  CANDIDATE_MATRIX,
  LEGACY_DEBUG_UNAVAILABLE,
  P25_LIVE_COMPARISON_SCHEMA_VERSION,
  P25_LIVE_SCHEMA_VERSION,
  PINNED_LEGACY_HEAD,
  REQUIRED_LIVE_STAGE_IDS,
  baseManifestVersion,
  createStageExpectation,
  matrixVariantDisposition,
  normalizeLiveUrl,
  resolveCandidateDisposition,
  sha256,
  validateComparisonPair,
  validateComparisonMatrix,
  validateRunAggregate,
  validateRunIdentity,
  validateStageRecord,
} from "../scripts/performance/p25/live-comparison-contract.mjs";
import { classifyExtensionRequest, finalPublishRoute } from "../scripts/performance/p25/live-cdp.mjs";
import { normalizeRenderModeEvidence, resolveLiveTargets } from "../scripts/performance/p25/live-probes.mjs";

const hash = (seed: string): string => sha256(seed);

function identity(implementation: "legacy" | "rewrite" = "rewrite", label = "dpj") {
  const candidate = CANDIDATE_MATRIX.find((entry) => entry.label === label)!;
  return {
    schemaVersion: P25_LIVE_SCHEMA_VERSION,
    runNonce: implementation === "legacy" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    createdAt: "2026-08-28T10:00:00.000Z",
    label,
    expectedUrl: candidate.url,
    normalizedUrl: normalizeLiveUrl(candidate.url),
    implementation,
    build: {
      variant: "production",
      source: {
        head: implementation === "legacy" ? PINNED_LEGACY_HEAD : "b".repeat(40),
        tree: implementation === "legacy" ? "ebfb2f160763e3acc3331e62f9824ac18d45fcad" : "c".repeat(40),
        workspaceHead: "b".repeat(40),
        dirty: false,
        clean: true,
        statusDigest: hash("status"),
        packageLockSha256: hash("package-lock"),
        buildCommand: "pnpm build",
      },
      bundle: {
        sha256: hash(`${implementation}-bundle`),
        inventoryDigest: hash(`${implementation}-bundle-inventory`),
        fileCount: 12,
        manifestVersion: implementation === "legacy" ? "1.10.0.47" : "2.0.0.48",
      },
    },
    browser: {
      fingerprint: hash("browser"),
      instanceNonce: implementation === "legacy" ? "cccccccccccccccccccccccccccccccc" : "dddddddddddddddddddddddddddddddd",
    },
    profile: { fingerprint: hash("profile"), pathDigest: hash("profile-path") },
    launchProvenance: {
      schemaVersion: "browser-live-provenance/v1",
      launchNonce: implementation === "legacy" ? "12121212-1212-4212-8212-121212121212" : "34343434-3434-4434-8434-343434343434",
      createdAt: "2026-08-28T09:59:00.000Z",
      sha256: hash(`${implementation}-launch-provenance`),
    },
    publicationContract: {
      finalPublishForbidden: true,
      fenceRequiredBeforeActivation: true,
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      guardNonce: implementation === "legacy" ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" : "ffffffff-ffff-4fff-8fff-ffffffffffff",
    },
    legacyLoadCompatibility: implementation === "legacy"
      ? { policy: "installed-before-activation" }
      : { policy: "not-applicable" },
  };
}

function stageRows(disposition = { parityEligible: true }) {
  const ids = disposition.parityEligible ? REQUIRED_LIVE_STAGE_IDS : ["preflight", "publication-fence"];
  return ids.map((id, sequence) => ({
    id,
    sequence,
    status: "passed",
    exitCode: 0,
    validation: { pass: true },
    renderMode: id === "render-mode-with-javascript"
      ? "with-javascript"
      : id === "render-mode-without-javascript" ? "without-javascript" : null,
    documentKey: disposition.parityEligible && sequence >= 3 ? "workflow-document" : null,
  }));
}

function markingGestureEvidence() {
  const targetXpath = "/html[1]/body[1]/main[1]/article[1]/h2[1]";
  const shiftedOwnerXpath = "/html[1]/body[1]/main[1]/article[1]";
  const unchangedTargetDelta = { created: [], removed: [], changed: [], ambientCreated: [], ambientRemoved: [] };
  const acknowledged = { acknowledged: true, acknowledgementLatencyMs: 20 };
  return {
    target: { xpath: targetXpath, shiftedOwnerXpath },
    operations: [
      {
        id: "plain-exclude",
        ...acknowledged,
        changed: true,
        assertion: {
          kind: "explicit-exclusion",
          ownerRelation: "exact",
          ownerXpath: targetXpath,
        },
      },
      {
        id: "plain-exclude-unmark",
        ...acknowledged,
        changed: true,
        assertion: { removedExactOwner: true, remainingTargetOwned: 0 },
      },
      {
        id: "alt-include",
        ...acknowledged,
        changed: true,
        assertion: { kind: "explicit-inclusion", ownerRelation: "exact", ownerXpath: targetXpath },
      },
      { id: "native-context-menu", ...acknowledged, changed: false, targetDelta: unchangedTargetDelta },
      {
        id: "plain-include-unmark",
        ...acknowledged,
        changed: true,
        assertion: { removedExactOwner: true, remainingTargetOwned: 0 },
      },
      {
        id: "shift-expand",
        ...acknowledged,
        changed: true,
        assertion: {
          kind: "explicit-exclusion",
          ownerRelation: "ancestor",
          ownerXpath: shiftedOwnerXpath,
          breadthIncreased: true,
        },
      },
    ],
    nativeContextMenu: {
      eventObserved: true,
      defaultPrevented: false,
      extensionMenuCount: 0,
    },
    timing: { count: 5, medianMs: 40, p95Ms: 80, worstMs: 80 },
  };
}

function aggregate(implementation: "legacy" | "rewrite" = "rewrite", aiMode = "measured-current-run", label = "dpj") {
  const runIdentity = identity(implementation, label);
  const candidateDisposition = { eligibility: "candidate", reasonCode: null, reason: null, parityEligible: true };
  const documents: Record<string, {
    fingerprint: string;
    comparableFingerprint: string;
    normalizedUrl: string;
    loaderId: string;
    timeOrigin: number;
  }> = {
    "workflow-document": {
      fingerprint: hash("workflow-document"),
      comparableFingerprint: hash("comparable-document"),
      normalizedUrl: runIdentity.normalizedUrl,
      loaderId: "stable-loader",
      timeOrigin: 1_776_000_000_000,
    },
  };
  return {
    schemaVersion: P25_LIVE_SCHEMA_VERSION,
    startedAt: "2026-08-28T10:00:00.000Z",
    finishedAt: "2026-08-28T10:10:00.000Z",
    identity: runIdentity,
    candidateDisposition,
    documents,
    stages: stageRows(candidateDisposition),
    probes: {
      cardinality: {
        sourceCount: 10,
        sourceFragmentCount: 12,
        paintedRectCount: 9,
        visibleLayerCount: 4,
        physicalHitCount: 8,
        markableCandidateCount: 50,
      },
      borders: [{ width: "2px", style: "solid", count: 9 }],
      layers: [{ layer: "default", zIndex: "3", count: 9 }],
      markingGestures: markingGestureEvidence(),
      markingScrollFade: { scrolled: true, faded: true, repositioned: true, restored: true },
      silentScrollFade: { scrolled: true, faded: true, repositioned: true, restored: true },
      markingResize: { repositioned: true, viewportRestored: true },
      silentResize: { repositioned: true, viewportRestored: true },
    },
    frames: [
      "activation-network",
      "marking-visual",
      "marking-gestures",
      "marking-scroll-fade",
      "marking-resize",
      "silent-visual",
      "silent-scroll-fade",
      "silent-resize",
    ].map((stage) => ({ stage, rAF: { count: 30, p95Ms: 16 }, compositorFrames: 20, worstLongTaskMs: 12 })),
    network: { activation: [{ url: "https://unfluffify.lynxdev.se/load", status: 200 }] },
    publicationFence: {
      installedBeforeActivation: true,
      finalPublishForbidden: true,
      abortBeforeTransmission: true,
      attemptCount: 0,
    },
    ai: aiMode === "measured-current-run"
      ? { mode: aiMode, parityEligible: true, durationMs: 1000, requestCount: 1 }
      : { mode: "retained-reference-only", parityEligible: false, durationMs: 490178, referenceArtifact: "retained/legacy-ledigajobb.json", reason: "Historical reference only" },
  };
}

function comparisonPair(
  legacy = aggregate("legacy"),
  rewrite = aggregate("rewrite"),
) {
  const legacyDocument = legacy.documents["workflow-document"];
  const rewriteDocument = rewrite.documents["workflow-document"];
  return {
    schemaVersion: P25_LIVE_COMPARISON_SCHEMA_VERSION,
    createdAt: "2026-08-28T10:11:00.000Z",
    label: legacy.identity.label,
    normalizedUrl: legacy.identity.normalizedUrl,
    runs: { legacy, rewrite },
    documentEquivalence: {
      equivalent: true,
      legacy: {
        fingerprint: legacyDocument.fingerprint,
        comparableFingerprint: legacyDocument.comparableFingerprint,
        normalizedUrl: legacyDocument.normalizedUrl,
      },
      rewrite: {
        fingerprint: rewriteDocument.fingerprint,
        comparableFingerprint: rewriteDocument.comparableFingerprint,
        normalizedUrl: rewriteDocument.normalizedUrl,
      },
    },
    aiParity: { claimed: true },
    comparison: {
      cardinality: { legacy: legacy.probes.cardinality, rewrite: rewrite.probes.cardinality },
      markingGestureTiming: {
        legacy: legacy.probes.markingGestures.timing,
        rewrite: rewrite.probes.markingGestures.timing,
      },
      frames: { legacy: legacy.frames, rewrite: rewrite.frames },
    },
  };
}

function recordedComparisonPair(label = "dpj") {
  const pair = comparisonPair(aggregate("legacy", "measured-current-run", label), aggregate("rewrite", "measured-current-run", label));
  const validation = validateComparisonPair(pair);
  return { ...pair, validation, overall: validation.pass ? "passed" : "failed" };
}

describe("P25 live-comparison identity and candidate contract", () => {
  it("waits through transient Render Inspection controls and terminalizes one Cancel dispatch", () => {
    const source = readFileSync(new URL("../scripts/performance/p25-live-comparison.mjs", import.meta.url), "utf8");
    expect(source).toMatch(/implementation === "rewrite" &&\s*\(!alternate \|\| alternate\.disabled \|\| alternate\.visible === false\)/);
    expect(source).toMatch(/requestedReadyDeadline[\s\S]*?while \(control\?\.disabled[\s\S]*?settledProof = proveMode/);
    expect(source).toMatch(/async function waitForRenderModeExitTerminal[\s\S]*?while \(Date\.now\(\) < deadline\)[\s\S]*?toggle-enabled[\s\S]*?return last/);
    expect(source).toMatch(/recovery\.id === "render-mode-cancel"[\s\S]*?state = await waitForRenderModeExitTerminal\(popup, deadline\)[\s\S]*?continue/);
    expect(source).not.toContain("state.renderInspectionView !== state.renderChoice");
  });

  it("normalizes fragment, query ordering, default ports, and trailing slash coherently", () => {
    expect(normalizeLiveUrl("https://WWW.DPJ.SE:443/path/?b=2&a=1#fragment"))
      .toBe("https://www.dpj.se/path?a=1&b=2");
  });

  it("accepts launcher-stamped manifest counters without weakening the pinned base version", () => {
    expect(baseManifestVersion("1.10.0.47")).toBe("1.10.0");
    expect(baseManifestVersion("2.0.0.48")).toBe("2.0.0");
    expect(baseManifestVersion("2.0.1.48")).toBe("2.0.1");
    expect(baseManifestVersion("2.0")).toBeNull();
    expect(validateRunIdentity(identity("legacy")).pass).toBe(true);
    const wrong = identity("rewrite");
    wrong.build.bundle.manifestVersion = "2.0.1.48";
    expect(validateRunIdentity(wrong).checks.find((check) => check.id === "bundle-manifest-version")?.pass).toBe(false);
  });

  it("makes debug parity explicitly N/A when the legacy baseline has no debug build", () => {
    expect(LEGACY_DEBUG_UNAVAILABLE).toMatchObject({
      parityEligible: false,
      reasonCode: "legacy-debug-artifact-unavailable",
    });
    expect(matrixVariantDisposition("production")).toEqual({ parityEligible: true, reasonCode: null, reason: null });
    expect(matrixVariantDisposition("debug")).toEqual(LEGACY_DEBUG_UNAVAILABLE);
    expect(() => matrixVariantDisposition("canary")).toThrow(/Unknown P25 matrix build variant/);
  });

  it("retains exact durable N/A and external-block reasons", () => {
    expect(resolveCandidateDisposition({ label: "bigbag", url: "https://bigbag.se/", runtimeEligibility: "unavailable" }))
      .toMatchObject({ parityEligible: false, reasonCode: "hub-no-authoritative-candidate" });
    expect(resolveCandidateDisposition({
      label: "3dprima-se",
      url: "https://www.3dprima.com/se/3d-skrivare-mer/tillverkare/anycubic",
      runtimeEligibility: "unavailable",
    })).toMatchObject({ parityEligible: false, reasonCode: "site-owned-404-candidate" });
    expect(resolveCandidateDisposition({
      label: "aleris",
      url: "https://www.aleris.se/kirurgi/brack/aderbrack/",
      runtimeEligibility: "unavailable",
    })).toMatchObject({ parityEligible: false, reasonCode: "site-not-found-body" });
  });

  it("accepts only the loaded extension's side panel or exact legacy bound popup", () => {
    const site = { type: "page", url: "https://www.dpj.se/", webSocketDebuggerUrl: "ws://site" };
    const worker = { type: "service_worker", url: "chrome-extension://abcdefghijklmnop/background.js", webSocketDebuggerUrl: "ws://worker" };
    const legacy = { type: "page", url: "chrome-extension://abcdefghijklmnop/popup.html?debugTabId=42", webSocketDebuggerUrl: "ws://popup" };
    expect(resolveLiveTargets([site, worker, legacy], "https://www.dpj.se/")).toMatchObject({ operatorSurface: "bound-popup", extensionId: "abcdefghijklmnop" });
    const foreign = { ...legacy, url: "chrome-extension://ponmlkjihgfedcba/popup.html?debugTabId=42" };
    expect(() => resolveLiveTargets([site, worker, foreign], "https://www.dpj.se/")).toThrow(/found 0/);
    const malformed = { ...legacy, url: "chrome-extension://abcdefghijklmnop/popup.html?debugTabId=42&extra=1" };
    expect(() => resolveLiveTargets([site, worker, malformed], "https://www.dpj.se/")).toThrow(/found 0/);
  });

  it("maps confirmed choices and inspection views onto the same render-mode vocabulary", () => {
    expect(normalizeRenderModeEvidence("rendered")).toBe("with-javascript");
    expect(normalizeRenderModeEvidence("with_javascript")).toBe("with-javascript");
    expect(normalizeRenderModeEvidence("static")).toBe("without-javascript");
    expect(normalizeRenderModeEvidence("without_javascript")).toBe("without-javascript");
    expect(normalizeRenderModeEvidence("undetermined")).toBeNull();
  });

  it("requires pinned legacy source, exact bundle/browser/profile digests, and the final-publish ban", () => {
    expect(validateRunIdentity(identity("legacy")).pass).toBe(true);
    const invalid = identity("legacy");
    invalid.build.source.head = "f".repeat(40);
    invalid.publicationContract.finalPublishForbidden = false;
    const validation = validateRunIdentity(invalid);
    expect(validation.pass).toBe(false);
    expect(validation.checks.filter((check) => !check.pass).map((check) => check.id))
      .toEqual(expect.arrayContaining(["legacy-head-pinned", "final-publish-forbidden"]));
  });
});

describe("P25 live-comparison stage and aggregate contract", () => {
  it("rejects stale/coherence-mismatched stages and non-matching observed exit codes", () => {
    const runIdentity = identity();
    const document = {
      fingerprint: hash("document"),
      normalizedUrl: runIdentity.normalizedUrl,
    };
    const expected = createStageExpectation({
      runIdentity,
      id: "preflight",
      sequence: 0,
      stageNonce: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      documentKey: "document-one",
    });
    const stage = {
      ...expected,
      startedAt: "2026-08-28T10:00:01.000Z",
      finishedAt: "2026-08-28T10:00:02.000Z",
      status: "passed",
      exitCode: 0,
      documentFingerprint: document.fingerprint,
    };
    expect(validateStageRecord({
      stage,
      expected,
      runIdentity,
      documents: { "document-one": document },
      fileMtimeMs: Date.parse(stage.finishedAt),
      observedExitCode: 0,
    }).pass).toBe(true);

    const stale = { ...stage, runNonce: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
    const validation = validateStageRecord({
      stage: stale,
      expected,
      runIdentity,
      documents: { "document-one": document },
      fileMtimeMs: Date.parse(runIdentity.createdAt) - 1,
      observedExitCode: 1,
    });
    expect(validation.pass).toBe(false);
    expect(validation.checks.filter((check) => !check.pass).map((check) => check.id))
      .toEqual(expect.arrayContaining(["coherence-runNonce", "fresh-file-mtime", "stage-exit-code-recorded"]));
  });

  it("fails missing/nonzero stages, missing current visual probes, and every publish attempt", () => {
    const run = aggregate();
    expect(validateRunAggregate(run).pass).toBe(true);

    run.stages = run.stages.filter((stage) => stage.id !== "silent-resize");
    run.stages[0].exitCode = 7;
    run.publicationFence.attemptCount = 1;
    const validation = validateRunAggregate(run);
    expect(validation.pass).toBe(false);
    expect(validation.exitCode).toBe(1);
    expect(validation.checks.filter((check) => !check.pass).map((check) => check.id))
      .toEqual(expect.arrayContaining(["stage-completeness", "stage-exits", "zero-publish-attempts"]));
  });

  it("accepts only the exact non-applicable scroll and resize evidence produced by the live probes", () => {
    const run = aggregate();
    run.probes.markingScrollFade = {
      applicable: false,
      reason: "no-scrollable-viewport-owner",
      scrolled: false,
      faded: false,
      repositioned: false,
      restored: true,
    };
    run.probes.silentScrollFade = { ...run.probes.markingScrollFade };
    run.probes.markingResize = {
      applicable: false,
      reason: "source-highlight-geometry-unchanged",
      repositioned: false,
      viewportRestored: true,
    };
    run.probes.silentResize = { ...run.probes.markingResize };

    expect(validateRunAggregate(run).checks.find((check) => check.id === "scroll-fade-resize-proof"))
      .toMatchObject({ pass: true });

    run.probes.markingScrollFade.reason = "unknown-scroll-failure";
    expect(validateRunAggregate(run).checks.find((check) => check.id === "scroll-fade-resize-proof"))
      .toMatchObject({ pass: false });

    run.probes.markingScrollFade.reason = "no-scrollable-viewport-owner";
    run.probes.markingResize.reason = "unknown-resize-failure";
    expect(validateRunAggregate(run).checks.find((check) => check.id === "scroll-fade-resize-proof"))
      .toMatchObject({ pass: false });
  });

  it("accepts unrelated dynamic overlay churn alongside the exact plain-click toggle", () => {
    const run = aggregate();
    const operation = run.probes.markingGestures.operations.find((candidate) => candidate.id === "plain-exclude")!;
    operation.targetDelta = { created: [], removed: [], changed: [], ambientCreated: [], ambientRemoved: [] };
    operation.targetDelta.ambientRemoved = [{
      ownerXpath: "/html[1]/body[1]/aside[1]",
      kind: "explicit-exclusion",
      layer: "session-explicit-exclude",
      ownerRelation: "unrelated",
      breadth: 10,
      fragments: 1,
    }];

    expect(validateRunAggregate(run).checks.find((check) => check.id === "gesture-probes"))
      .toMatchObject({ pass: true });
  });

  it("rejects same-URL document replacement during the comparable workflow", () => {
    const run = aggregate();
    run.documents["replacement-document"] = {
      ...run.documents["workflow-document"],
      fingerprint: hash("replacement-document"),
      loaderId: "replacement-loader",
      timeOrigin: run.documents["workflow-document"].timeOrigin + 1,
    };
    const replacedStage = run.stages.find((stage) => stage.id === "silent-visual")!;
    replacedStage.documentKey = "replacement-document";

    const validation = validateRunAggregate(run);
    expect(validation.pass).toBe(false);
    expect(validation.checks.find((check) => check.id === "stable-workflow-document"))
      .toMatchObject({ pass: false });
  });

  it.each(["marking-resize", "silent-resize"])("rejects a Long Task in the %s input stage", (stage) => {
    const run = aggregate();
    const frame = run.frames.find((candidate) => candidate.stage === stage)!;
    frame.worstLongTaskMs = 51;
    const validation = validateRunAggregate(run);
    expect(validation.checks.find((check) => check.id === "input-long-tasks"))
      .toMatchObject({ pass: false });
  });

  it("allows exact non-candidate evidence without turning candidate-only work into a pass", () => {
    const runIdentity = identity("rewrite", "bigbag");
    const disposition = resolveCandidateDisposition({ label: "bigbag", url: runIdentity.expectedUrl, runtimeEligibility: "unavailable" });
    const run = {
      schemaVersion: P25_LIVE_SCHEMA_VERSION,
      startedAt: runIdentity.createdAt,
      finishedAt: "2026-08-28T10:01:00.000Z",
      identity: runIdentity,
      candidateDisposition: disposition,
      stages: stageRows(disposition),
      probes: {},
      network: { activation: [] },
      publicationFence: { installedBeforeActivation: false, finalPublishForbidden: true, attemptCount: 0 },
      ai: { mode: "not-run", parityEligible: false, reason: disposition.reason },
    };
    expect(validateRunAggregate(run).pass).toBe(true);
    expect(disposition.parityEligible).toBe(false);
  });

  it("classifies Acapedia's repeatable post-reload 403 as an external block", () => {
    expect(resolveCandidateDisposition({
      label: "acapedia",
      url: "https://acapedia.no/",
      runtimeEligibility: "candidate",
    })).toMatchObject({
      eligibility: "external-block",
      reasonCode: "site-403-after-required-reload",
      parityEligible: false,
    });
  });
});

describe("P25 pair and publication safety contract", () => {
  it("does not allow the retained 490178 ms legacy sample to masquerade as current AI parity", () => {
    const legacy = aggregate("legacy", "retained-reference-only");
    const rewrite = aggregate("rewrite");
    const pair = comparisonPair(legacy, rewrite);
    pair.aiParity.claimed = false;
    const validation = validateComparisonPair(pair);
    expect(validation.pass).toBe(false);
    expect(validation.checks.find((check) => check.id === "ai-current-comparable")?.pass).toBe(false);
  });

  it("accepts only equivalent, current-run, zero-publish legacy/rewrite pairs", () => {
    const pair = comparisonPair();
    expect(validateComparisonPair(pair).pass).toBe(true);
    pair.runs.rewrite.publicationFence.attemptCount = 1;
    expect(validateComparisonPair(pair).pass).toBe(false);
  });

  it("binds top-level pair identity and document evidence to both validated runs", () => {
    const pair = comparisonPair();
    pair.label = "humanova";
    pair.normalizedUrl = normalizeLiveUrl("https://www.humanova.com/");
    pair.documentEquivalence.rewrite.comparableFingerprint = hash("tampered-document");

    const validation = validateComparisonPair(pair);
    expect(validation.pass).toBe(false);
    expect(validation.checks.filter((check) => !check.pass).map((check) => check.id))
      .toEqual(expect.arrayContaining(["pair-label", "pair-url", "document-equivalence"]));
  });

  it("rejects cardinality, visual-semantic, and relative p95 divergence", () => {
    const pair = comparisonPair();
    pair.runs.rewrite.probes.cardinality.markableCandidateCount += 1;
    pair.runs.rewrite.probes.borders = [{ width: "4px", style: "dashed", count: 9 }];
    pair.runs.rewrite.probes.markingGestures.operations[1].changed = false;
    pair.runs.rewrite.probes.markingGestures.timing.p95Ms = 84.001;
    pair.runs.rewrite.frames[0].rAF.p95Ms = 16.801;
    pair.comparison.cardinality.rewrite = pair.runs.rewrite.probes.cardinality;
    pair.comparison.markingGestureTiming.rewrite = pair.runs.rewrite.probes.markingGestures.timing;
    pair.comparison.frames.rewrite = pair.runs.rewrite.frames;

    const validation = validateComparisonPair(pair);
    expect(validation.pass).toBe(false);
    expect(validation.checks.filter((check) => !check.pass).map((check) => check.id))
      .toEqual(expect.arrayContaining([
        "cardinality-parity",
        "border-parity",
        "gesture-semantic-parity",
        "relative-p95-parity",
      ]));
  });

  it("rejects missing, duplicate, unknown, mislabeled, or stale matrix pairs", () => {
    const requiredLabels = CANDIDATE_MATRIX.filter((candidate) => candidate.eligibility === "candidate").map((candidate) => candidate.label);
    const complete = requiredLabels.map((label) => recordedComparisonPair(label));
    expect(validateComparisonMatrix({ pairs: complete, buildVariant: "production" }).pass).toBe(true);

    const missing = validateComparisonMatrix({ pairs: complete.slice(1), buildVariant: "production" });
    expect(missing.pass).toBe(false);
    expect(missing.checks.find((check) => check.id === "complete-eligible-matrix")?.pass).toBe(false);

    const duplicate = validateComparisonMatrix({ pairs: [...complete, complete[0]], buildVariant: "production" });
    expect(duplicate.checks.find((check) => check.id === "unique-matrix-labels")?.pass).toBe(false);

    const unknown = structuredClone(complete[0]);
    unknown.label = "unknown-candidate";
    expect(validateComparisonMatrix({ pairs: [...complete, unknown], buildVariant: "production" }).checks
      .find((check) => check.id === "known-matrix-labels")?.pass).toBe(false);

    const mislabeled = structuredClone(complete[0]);
    mislabeled.normalizedUrl = normalizeLiveUrl("https://www.humanova.com/");
    expect(validateComparisonMatrix({ pairs: [mislabeled, ...complete.slice(1)], buildVariant: "production" }).checks
      .find((check) => check.id === "validated-matrix-pairs")?.pass).toBe(false);

    const stale = structuredClone(complete[0]);
    stale.validation.pass = false;
    stale.overall = "passed";
    expect(validateComparisonMatrix({ pairs: [stale, ...complete.slice(1)], buildVariant: "production" }).checks
      .find((check) => check.id === "validated-matrix-pairs")?.pass).toBe(false);
  });

  it("keeps debug matrix parity explicit N/A with zero pair artifacts", () => {
    expect(validateComparisonMatrix({ pairs: [], buildVariant: "debug" }).pass).toBe(true);
    expect(validateComparisonMatrix({ pairs: [recordedComparisonPair()], buildVariant: "debug" }).pass).toBe(false);
  });

  it("matches only the sole final /publish route for pre-transmission abortion", () => {
    expect(finalPublishRoute("https://unfluffify.lynxdev.se/publish")).toBe(true);
    expect(finalPublishRoute("https://unfluffify.lynxdev.se/api/publish?operation=one")).toBe(true);
    expect(finalPublishRoute("https://unfluffify.lynxdev.se/save")).toBe(false);
    expect(finalPublishRoute("https://example.com/publisher")).toBe(false);
  });

  it("aborts final publication and patches legacy load before either request is transmitted", () => {
    expect(classifyExtensionRequest({
      implementation: "rewrite",
      legacyEnvironmentKey: null,
      request: { method: "POST", url: "https://unfluffify.lynxdev.se/publish", postData: "{}" },
    })).toEqual({ action: "abort-final-publish" });
    expect(classifyExtensionRequest({
      implementation: "legacy",
      legacyEnvironmentKey: "a.lynxdev.se",
      request: { method: "POST", url: "https://unfluffify.lynxdev.se/load", postData: JSON.stringify({ url: "https://www.dpj.se/" }) },
    })).toEqual({
      action: "patch-legacy-load",
      payload: { environmentKey: "a.lynxdev.se", url: "https://www.dpj.se/" },
    });
    expect(classifyExtensionRequest({
      implementation: "rewrite",
      legacyEnvironmentKey: null,
      request: { method: "POST", url: "https://unfluffify.lynxdev.se/save", postData: "{}" },
    })).toEqual({ action: "continue" });
  });
});
