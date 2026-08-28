import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  adoptCandidateDisposition,
  createCandidateDispositionRecord,
  evaluateCandidateValidity,
  physicalActivatePopupControl,
  physicalActivatePreviewPageTarget,
  physicalActivatePreviewRow,
  proveRequestedRenderMode,
  readableTextsCorrespond,
  validateCandidateDispositionRecord,
  validateExactMarkingGestureEvidence,
  validateFullWorkflowEvidence,
} from "../scripts/performance/p25/workflow-probes.mjs";

describe("P25 physical popup activation", () => {
  it("foregrounds, centers, and hit-verifies the real side-panel control before pointer input", async () => {
    const sends: Array<{ method: string; params?: unknown }> = [];
    const expressions: string[] = [];
    const session = {
      async evaluate(expression: string) {
        expressions.push(expression);
        return {
          id: "toggle-enabled",
          tag: "INPUT",
          disabled: false,
          checked: false,
          rect: { x: 20, y: 30, width: 16, height: 16 },
          viewport: { width: 400, height: 700 },
          hitMatches: true,
          hit: { id: "toggle-enabled", tag: "INPUT", className: "" },
        };
      },
      async send(method: string, params?: unknown) {
        sends.push({ method, params });
      },
    };

    const evidence = await physicalActivatePopupControl(session, "toggle-enabled", "pointer");

    expect(expressions[0]).toContain("scrollIntoView");
    expect(expressions[0]).toContain("elementFromPoint");
    expect(sends.slice(0, 2).map(({ method }) => method)).toEqual([
      "Page.enable",
      "Page.bringToFront",
    ]);
    expect(sends.slice(2).map(({ method }) => method)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
    expect(evidence.before.hitMatches).toBe(true);
    expect(evidence.dispatchedAtEpochMs).toEqual(expect.any(Number));
    expect(evidence.dispatchedAt).toBe(new Date(evidence.dispatchedAtEpochMs).toISOString());
  });

  it("proves native semantic preview-row activation with a trusted Space click", async () => {
    const sends: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let evaluation = 0;
    const session = {
      async evaluate() {
        evaluation += 1;
        if (evaluation === 1) {
          return {
            name: "2. Main story. Included",
            readableText: "Main story",
            title: null,
            focused: true,
            semanticButton: true,
            token: "keyboard-token",
          };
        }
        return {
          tokenMatches: true,
          events: [
            { type: "keydown", trusted: true, key: " ", detail: 0 },
            { type: "keyup", trusted: true, key: " ", detail: 0 },
            { type: "click", trusted: true, key: null, detail: 0 },
          ],
        };
      },
      async send(method: string, params?: Record<string, unknown>) {
        sends.push({ method, params });
      },
    };

    const evidence = await physicalActivatePreviewRow(session, 1);

    expect(evidence).toMatchObject({ trustedKeyboard: true, activationKey: "Space" });
    expect(sends.map(({ method }) => method)).toEqual([
      "Page.enable",
      "Page.bringToFront",
      "Input.dispatchKeyEvent",
      "Input.dispatchKeyEvent",
    ]);
    expect(sends[2]?.params).toMatchObject({ type: "rawKeyDown", key: " ", code: "Space" });
    expect(sends[3]?.params).toMatchObject({ type: "keyUp", key: " ", code: "Space" });
  });

  it("clicks visible preview overlay geometry even when its absolute XPath is stale", async () => {
    const sends: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let expression = "";
    const session = {
      async evaluate(value: string) {
        expression = value;
        return {
          x: 120,
          y: 240,
          identity: "/html[1]/body[1]/main[1]/h2[1]",
          readableText: "Candidate heading",
          sourceKind: "visible-overlay-underlay",
        };
      },
      async send(method: string, params?: Record<string, unknown>) {
        sends.push({ method, params });
      },
    };

    const evidence = await physicalActivatePreviewPageTarget(session);

    expect(expression).toContain("document.elementsFromPoint");
    expect(expression).toContain("geometry: overlay");
    expect(expression).toContain("visible-overlay-underlay");
    expect(evidence).toMatchObject({
      trustedPointer: true,
      target: { x: 120, y: 240, readableText: "Candidate heading" },
    });
    expect(sends.map(({ method }) => method)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
  });
});

const validSignals = {
  expectedNormalizedUrl: "https://www.aleris.se/kirurgi/brack/aderbrack",
  observedNormalizedUrl: "https://www.aleris.se/kirurgi/brack/aderbrack",
  httpStatus: 200,
  statusAvailable: true,
  title: "Åderbråck – behandling",
  primaryHeading: "Behandling av åderbråck",
  bodyLeadSha256: "a".repeat(64),
  bodyTextLength: 8_000,
  mainTextLength: 6_000,
  meaningfulBlockCount: 18,
  headingCount: 4,
  contentElementCount: 32,
  hasMainLandmark: true,
  readyState: "complete",
};

const validAnalysis = {
  title: validSignals.title,
  primaryHeading: validSignals.primaryHeading,
  bodyLead: "This is a substantive treatment page. ".repeat(120),
};

const declaredRuntimeBlock = {
  eligibility: "external-block",
  reasonCode: "site-not-found-body",
  reason: "Live validation required",
  parityEligible: false,
};

describe("P25 implementation-neutral candidate preflight", () => {
  it("promotes a runtime-validation candidate only from substantive live document facts", () => {
    const evaluation = evaluateCandidateValidity({ signals: validSignals, analysis: validAnalysis });
    expect(evaluation.valid).toBe(true);
    expect(adoptCandidateDisposition({
      declared: declaredRuntimeBlock,
      matrixEligibility: "runtime-validation-required",
      evaluation,
      signals: validSignals,
      evidenceArtifact: { path: "candidate-disposition.json", sha256: "b".repeat(64) },
    })).toMatchObject({ parityEligible: true, eligibility: "candidate", source: "preflight" });
  });

  it("cannot falsely promote a known not-found document despite otherwise substantive counts", () => {
    const evaluation = evaluateCandidateValidity({
      signals: { ...validSignals, httpStatus: 404, title: "Page not found" },
      analysis: { ...validAnalysis, title: "Page not found", primaryHeading: "404" },
    });
    expect(evaluation).toMatchObject({ valid: false, reasonCode: "site-not-found-body" });
    expect(adoptCandidateDisposition({
      declared: declaredRuntimeBlock,
      matrixEligibility: "runtime-validation-required",
      evaluation,
      signals: validSignals,
      evidenceArtifact: { path: "candidate-disposition.json", sha256: "b".repeat(64) },
    }).parityEligible).toBe(false);
  });

  it("does not treat an incidental 404 mention in a real article as a not-found page", () => {
    const evaluation = evaluateCandidateValidity({
      signals: validSignals,
      analysis: { ...validAnalysis, bodyLead: `${"Clinical content. ".repeat(80)} An old link could return 404.` },
    });
    expect(evaluation.valid).toBe(true);
    expect(evaluation.checks.definitiveNotFound).toBe(false);
  });

  it("never promotes a matrix-level external or missing candidate", () => {
    const evaluation = evaluateCandidateValidity({ signals: validSignals, analysis: validAnalysis });
    const adopted = adoptCandidateDisposition({
      declared: { ...declaredRuntimeBlock, eligibility: "n/a", reasonCode: "hub-no-authoritative-candidate" },
      matrixEligibility: "n/a",
      evaluation,
      signals: validSignals,
      evidenceArtifact: { path: "candidate-disposition.json", sha256: "b".repeat(64) },
    });
    expect(adopted).toMatchObject({ parityEligible: false, reasonCode: "hub-no-authoritative-candidate" });
  });

  it("binds the durable decision to run, URL, document, signals, and digest", () => {
    const identity = {
      runNonce: "11111111-2222-4333-8444-555555555555",
      label: "aleris",
      normalizedUrl: validSignals.expectedNormalizedUrl,
      candidateDisposition: declaredRuntimeBlock,
      declaredCandidateDisposition: declaredRuntimeBlock,
    };
    const document = { fingerprint: "c".repeat(64) };
    const record = createCandidateDispositionRecord({
      identity,
      document,
      matrixEligibility: "runtime-validation-required",
      captured: { signals: validSignals, analysis: validAnalysis },
    });
    expect(validateCandidateDispositionRecord(record, identity, document)).toEqual({ pass: true, failures: [] });
    expect(validateCandidateDispositionRecord({ ...record, label: "dpj" }, identity, document)).toMatchObject({ pass: false });
    expect(validateCandidateDispositionRecord({ ...record, signals: { ...record.signals, bodyTextLength: 1 } }, identity, document).failures)
      .toEqual(expect.arrayContaining(["evidence-digest", "candidate-signals"]));
  });
});

describe("P25 implementation-neutral render-mode proof", () => {
  it("accepts exact lifecycle or confirmed-choice evidence", () => {
    expect(proveRequestedRenderMode({ renderInspectionView: "without-javascript" }, "without-javascript"))
      .toEqual({ modeProven: true, proofSource: "inspection-lifecycle" });
    expect(proveRequestedRenderMode({ renderChoice: "with-javascript" }, "with-javascript"))
      .toEqual({ modeProven: true, proofSource: "confirmed-render-choice" });
  });

  it("rejects the wrong requested mode even for a legacy-shaped popup", () => {
    const legacyPopup = { renderChoice: "with-javascript", renderInspectionView: null };
    expect(proveRequestedRenderMode(legacyPopup, "without-javascript"))
      .toEqual({ modeProven: false, proofSource: null });
  });
});

function exactGestureEvidence() {
  return {
    operations: [
      { id: "plain-no-create", acknowledged: true, acknowledgementLatencyMs: 12, targetDelta: { created: [], removed: [], changed: [] } },
      { id: "shift-expand", acknowledged: true, acknowledgementLatencyMs: 13, assertion: { kind: "explicit-exclusion", ownerRelation: "ancestor", breadthIncreased: true } },
      { id: "plain-exact-unmark", acknowledged: true, acknowledgementLatencyMs: 11, assertion: { removedExactOwner: true, remainingTargetOwned: 0 } },
      { id: "alt-include", acknowledged: true, acknowledgementLatencyMs: 14, assertion: { kind: "explicit-inclusion", ownerRelation: "exact" } },
      { id: "context-menu", acknowledged: true, acknowledgementLatencyMs: 15 },
      { id: "plain-include-unmark", acknowledged: true, acknowledgementLatencyMs: 10, assertion: { removedExactOwner: true, remainingTargetOwned: 0 } },
    ],
    contextExpectedDisabled: { clear: false, exclude: true, include: false, widen: false },
    contextMenu: ["clear", "exclude", "include", "widen"].map((action) => ({
      action,
      disabled: action === "exclude",
    })),
  };
}

describe("P25 exact marking gesture acceptance", () => {
  it("accepts target-keyed exclusion, removal, inclusion, and exact menu evidence", () => {
    expect(validateExactMarkingGestureEvidence(exactGestureEvidence())).toEqual({ pass: true, failures: [] });
  });

  it("rejects an ambient aggregate change on a different target", () => {
    const evidence = exactGestureEvidence();
    evidence.operations[1] = {
      id: "shift-expand",
      changed: true,
      assertion: { kind: "explicit-exclusion", ownerRelation: "unrelated", breadthIncreased: true },
    } as never;
    expect(validateExactMarkingGestureEvidence(evidence).failures).toContain("shift-expand:not-widened-exclusion");
  });

  it("rejects the right target with the wrong marking kind", () => {
    const evidence = exactGestureEvidence();
    evidence.operations[3] = {
      id: "alt-include",
      assertion: { kind: "explicit-exclusion", ownerRelation: "exact" },
    } as never;
    expect(validateExactMarkingGestureEvidence(evidence).failures).toContain("alt-include:not-explicit-inclusion");
  });

  it("rejects fingerprint-only changes and incomplete context actions", () => {
    const evidence = exactGestureEvidence();
    evidence.operations[1] = { id: "shift-expand", changed: true } as never;
    evidence.contextMenu.pop();
    const validation = validateExactMarkingGestureEvidence(evidence);
    expect(validation.failures).toEqual(expect.arrayContaining([
      "shift-expand:not-widened-exclusion",
      "context-menu:widen:missing",
      "context-menu:unexpected-action-set",
    ]));
  });

  it("rejects a falsely enabled Exclude action for an independently proven explicit owner", () => {
    const evidence = exactGestureEvidence();
    evidence.contextMenu.find((action) => action.action === "exclude")!.disabled = false;
    expect(validateExactMarkingGestureEvidence(evidence).failures).toContain("context-menu:exclude:disabled-state-mismatch");
  });

  it("rejects a correct eventual state without a target-keyed paint acknowledgement", () => {
    const evidence = exactGestureEvidence();
    evidence.operations.find((operation) => operation.id === "alt-include")!.acknowledged = false;
    expect(validateExactMarkingGestureEvidence(evidence).failures).toContain("alt-include:target-acknowledgement-missing");
  });
});

function completeWorkflowEvidence() {
  return {
    initialAi: { success: true, requestCount: 1 },
    freshAi: { success: true, requestCount: 1 },
    contentList: {
      openActivation: { method: "ai-auto-open" },
      firstPaintMs: 120,
      rowCount: 4,
      rowToPage: { trustedKeyboard: true, focusPainted: true, targetCorresponds: true },
      pageToRow: { trustedPointer: true, rowFocused: true, targetCorresponds: true },
    },
    freshness: {
      projectedWithinMs: 180,
      saveBlockedReason: "requires-ai-run",
      previewBlockedReason: "requires-ai-run",
    },
    save: { trustedPointer: true, requestCount: 1, authoritativeAdopted: true },
    discard: { trustedPointer: true, confirmed: true, restored: true },
    silentTransition: { trustedPointer: true, acknowledged: true },
    payloadHygiene: { pass: true },
  };
}

describe("P25 full workflow fail-closed acceptance", () => {
  it("is wired into the real workflow, silent, and publication stages", () => {
    const harness = readFileSync(resolve(process.cwd(), "scripts/performance/p25-live-comparison.mjs"), "utf8");
    expect(harness).toContain("runMeasuredFullWorkflow({ popup: session, site: targets.site, guard, identity, options })");
    expect(harness).toContain("await physicalActivatePreviewRow(popup, firstPaint.preview.rowCount > 1 ? 1 : 0)");
    expect(harness).toContain("await physicalActivatePreviewPageTarget(site)");
    expect(harness).toContain("await runDiscardWorkflow(popup)");
    expect(harness).toContain("const saveRequests = await waitForTerminalGuardRequests(");
    expect(harness).toContain("silentPosture: await captureSiteWorkflowPosture(session)");
    expect(harness).toContain("physicalActivatePopupControl(session, \"save-excludes\", \"pointer\")");
    expect(harness).not.toContain("getElementById('lynx-checklist-send').click");
    expect(harness).toContain('implementation === "legacy" ? "config-toggle" : "header-kebab-toggle"');
    expect(harness).toContain('implementation === "legacy" ? "render-mode-open-view" : "render-mode-open"');
    expect(harness).toContain('"AI returned to idle without opening a usable Content List or showing a failure"');
    expect(harness).toContain('integerOption(options, "ai-timeout-ms", AI_WORKFLOW_TIMEOUT_MS)');
    expect(harness).toContain("const initialInspectionView = before.renderInspectionView");
    expect(harness).toContain("last.renderInspectionView === renderMode && initialInspectionView !== renderMode");
    expect(harness).toContain("const initialBefore = await ensurePopupSessionView(popup, identity.implementation)");
    expect(harness).toContain('physicalActivatePopupControl(popup, "desktop-preview-enabled", "pointer")');
    expect(harness).toContain("viewportMatches(data.silentDesktopSetup?.posture, 1920, 1080)");
    expect(harness).toContain("viewportMatches(data.markingPosture, 412, 960)");
    expect(harness).toContain("data.workflow.freshAi.feedbackMs <= 100");
    const probes = readFileSync(resolve(process.cwd(), "scripts/performance/p25/workflow-probes.mjs"), "utf8");
    expect(probes).toContain("'toggle-enabled','desktop-preview-enabled','compute'");
    expect(probes).toContain('#unfluffify-overlay [data-layer="ai-content"] .uf-rect');
    expect(probes).toContain("'[data-uf-interaction-shield=\"true\"], #unfluffify-overlay'");
  });

  it("requires every real-control route and authoritative mutation boundary", () => {
    expect(validateFullWorkflowEvidence(completeWorkflowEvidence())).toEqual({ pass: true, failures: [] });
  });

  it.each([
    ["Content List first paint", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.contentList.firstPaintMs = 1_001; }, "content-list-first-paint"],
    ["Content List AI auto-open", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.contentList.openActivation.method = "pointer"; }, "content-list-ai-auto-open"],
    ["page-to-row route", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.contentList.pageToRow.rowFocused = false; }, "content-list-page-to-row"],
    ["initial AI terminal success", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.initialAi.success = false; }, "initial-ai-terminal-success"],
    ["fresh AI terminal success", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.freshAi.success = false; }, "fresh-ai-terminal-success"],
    ["duplicate AI request", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.freshAi.requestCount = 2; }, "ai-single-request-per-run"],
    ["freshness", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.freshness.projectedWithinMs = 1_001; }, "post-ai-freshness"],
    ["duplicate Save", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.save.requestCount = 2; }, "save-authoritative-single-request"],
    ["Discard confirmation", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.discard.confirmed = false; }, "discard-flow"],
    ["silent acknowledgement", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.silentTransition.acknowledged = false; }, "silent-transition"],
    ["payload hygiene", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.payloadHygiene.pass = false; }, "payload-hygiene"],
  ])("rejects missing %s evidence", (_label, tamper, expected) => {
    const evidence = completeWorkflowEvidence();
    tamper(evidence);
    expect(validateFullWorkflowEvidence(evidence).failures).toContain(expected);
  });

  it("correlates preview routes to the activated readable target and rejects an unrelated row", () => {
    expect(readableTextsCorrespond("2. Specialist acne treatment. Included", "Specialist acne treatment")) .toBe(true);
    expect(readableTextsCorrespond("Specialist acne treatment", "Book a moving company in Stockholm")).toBe(false);
    const evidence = completeWorkflowEvidence();
    evidence.contentList.rowToPage.targetCorresponds = false;
    expect(validateFullWorkflowEvidence(evidence).failures).toContain("content-list-row-to-page");
  });
});
