import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  adoptCandidateDisposition,
  createCandidateDispositionRecord,
  evaluateCandidateValidity,
  measureTrustedProjectionInterval,
  physicalActivatePopupControl,
  physicalActivatePreviewPageTarget,
  physicalActivatePreviewRow,
  popupControlIsActionable,
  popupRecoveryTransitioned,
  proveRequestedRenderMode,
  readableTextsCorrespond,
  silentPosturePass,
  validateCandidateDispositionRecord,
  validateExactMarkingGestureEvidence,
  validateFullWorkflowEvidence,
  viewportPostureMatches,
} from "../scripts/performance/p25/workflow-probes.mjs";

describe("P25 popup recovery acknowledgement", () => {
  const state = (controls: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) => ({
    view: "lock",
    busy: false,
    bodyLead: "Another editor owns this page",
    spinnerText: null,
    toast: null,
    controls,
    ...overrides,
  });

  it("recognizes a recovery control that is still physically actionable", () => {
    expect(popupControlIsActionable(state([
      { id: "lock-take-over", disabled: false, visible: true },
    ]), "lock-take-over")).toBe(true);
    expect(popupControlIsActionable(state([
      { id: "lock-take-over", disabled: true, visible: true },
    ]), "lock-take-over")).toBe(false);
  });

  it("treats a disappearing stale-lock action as an acknowledged race", () => {
    const before = state([{ id: "lock-take-over", disabled: false, visible: true }]);
    const after = state([{ id: "toggle-enabled", disabled: false, visible: true }], {
      view: "marking",
      bodyLead: "You hold the editor lock",
    });
    expect(popupRecoveryTransitioned(before, after, "lock-take-over")).toBe(true);
  });

  it("does not acknowledge an unchanged recovery surface", () => {
    const before = state([{ id: "lock-take-over", disabled: false, visible: true }]);
    expect(popupRecoveryTransitioned(before, structuredClone(before), "lock-take-over")).toBe(false);
  });
});

describe("P25 silent viewport authority", () => {
  const posture = {
    viewport: { width: 1920, height: 1080 },
    interactiveViewport: { left: 0, top: 0, width: 1912, height: 1080 },
    markingRootCount: 1,
    silentHighlightCount: 35,
    shield: [{
      connected: true,
      pointerEvents: "auto",
      opacity: 1,
      rect: [0, 0, 1912, 1080],
    }],
  };

  it("accepts the exact visual viewport while preserving the native scrollbar gutter", () => {
    expect(silentPosturePass(posture)).toBe(true);
  });

  it("rejects duplicate renderer ownership and shield geometry outside the interactive viewport", () => {
    expect(silentPosturePass({ ...posture, markingRootCount: 2 })).toBe(false);
    expect(silentPosturePass({
      ...posture,
      shield: [{ ...posture.shield[0], rect: [0, 0, 1920, 1080] }],
    })).toBe(false);
  });
});

describe("P25 emulation viewport authority", () => {
  it("accepts an exact layout viewport when the interactive viewport excludes a desktop gutter", () => {
    expect(viewportPostureMatches({
      viewport: { width: 1920, height: 1080 },
      interactiveViewport: { width: 1912, height: 1080 },
    }, 1920, 1080)).toBe(true);
  });

  it("accepts an exact interactive viewport when page scaling expands the mobile layout viewport", () => {
    expect(viewportPostureMatches({
      viewport: { width: 424, height: 988 },
      interactiveViewport: { width: 412, height: 960 },
    }, 412, 960)).toBe(true);
  });

  it("rejects a posture when neither viewport proves the requested dimensions", () => {
    expect(viewportPostureMatches({
      viewport: { width: 424, height: 988 },
      interactiveViewport: { width: 400, height: 900 },
    }, 412, 960)).toBe(false);
  });
});

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
    expect(evidence.readiness).toMatchObject({ waitMs: expect.any(Number), attempts: 1, initialBlocker: null });
    expect(evidence.dispatchedAtEpochMs).toEqual(expect.any(Number));
    expect(evidence.dispatchedAt).toBe(new Date(evidence.dispatchedAtEpochMs).toISOString());
  });

  it("waits only for the real busy curtain and records the physical readiness delay", async () => {
    const sends: Array<{ method: string; params?: unknown }> = [];
    let evaluation = 0;
    const session = {
      async evaluate() {
        evaluation += 1;
        return {
          id: "render-mode-edit",
          tag: "BUTTON",
          disabled: false,
          checked: null,
          rect: { x: 20, y: 30, width: 80, height: 30 },
          viewport: { width: 400, height: 700 },
          hitMatches: evaluation > 1,
          hit: evaluation > 1
            ? { id: "render-mode-edit", tag: "BUTTON", className: "", transientSurface: null }
            : { id: "ui-curtain", tag: "DIV", className: "ui-curtain", transientSurface: "popup-busy-curtain" },
        };
      },
      async send(method: string, params?: unknown) {
        sends.push({ method, params });
      },
    };

    const evidence = await physicalActivatePopupControl(
      session,
      "render-mode-edit",
      "pointer",
      null,
      { hitTargetTimeoutMs: 100, pollIntervalMs: 0 },
    );

    expect(evaluation).toBe(2);
    expect(evidence.readiness.attempts).toBe(2);
    expect(evidence.readiness.initialBlocker.hit.id).toBe("ui-curtain");
    expect(sends.slice(-3).map(({ method }) => method)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
  });

  it("retries a cross-target pointer dispatch only until a trusted click is observed", async () => {
    const sends: Array<{ method: string; params?: unknown }> = [];
    let released = 0;
    const session = {
      async evaluate(expression: string) {
        if (expression.includes("scrollIntoView")) {
          return {
            id: "preview-exit",
            tag: "BUTTON",
            disabled: false,
            checked: null,
            rect: { x: 20, y: 30, width: 80, height: 30 },
            viewport: { width: 400, height: 700 },
            hitMatches: true,
            hit: { id: "preview-exit", tag: "BUTTON", className: "" },
          };
        }
        if (expression.includes("addEventListener('click'")) {
          return { rect: { x: 20, y: 30, width: 80, height: 30 } };
        }
        if (expression.includes("const proof = globalThis")) {
          return released >= 2
            ? { token: expression.match(/proof\?\.token === "([^"]+)/)?.[1], trusted: true, atEpochMs: Date.now() }
            : null;
        }
        return null;
      },
      async send(method: string, params?: unknown) {
        sends.push({ method, params });
        if (method === "Input.dispatchMouseEvent" && (params as { type?: string })?.type === "mouseReleased") {
          released += 1;
        }
      },
    };

    const evidence = await physicalActivatePopupControl(
      session,
      "preview-exit",
      "pointer",
      ".preview-sidebar__dismiss",
      { trustedActivation: true, activationAckTimeoutMs: 0, maxDispatchAttempts: 3 },
    );

    expect(evidence.trustedActivation).toMatchObject({ required: true, attempts: 2 });
    expect(sends.filter(({ method }) => method === "Input.dispatchMouseEvent")).toHaveLength(6);
    expect(sends.filter(({ method }) => method === "Page.bringToFront")).toHaveLength(2);
  });

  it("never waits through an unrelated overlay", async () => {
    let evaluation = 0;
    const session = {
      async evaluate() {
        evaluation += 1;
        return {
          id: "toggle-enabled",
          tag: "INPUT",
          disabled: false,
          checked: false,
          rect: { x: 20, y: 30, width: 16, height: 16 },
          viewport: { width: 400, height: 700 },
          hitMatches: false,
          hit: { id: "unexpected-overlay", tag: "DIV", className: "", transientSurface: null },
        };
      },
      async send() {},
    };

    await expect(physicalActivatePopupControl(
      session,
      "toggle-enabled",
      "pointer",
      null,
      { hitTargetTimeoutMs: 100, pollIntervalMs: 0 },
    )).rejects.toThrow("not the physical hit target");
    expect(evaluation).toBe(1);
  });

  it("proves native semantic preview-row activation with a trusted Space click", async () => {
    const sends: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let evaluation = 0;
    const expressions: string[] = [];
    const session = {
      async evaluate(expression: string) {
        expressions.push(expression);
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
    expect(expressions[0]).toContain("!candidate.disabled");
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

  it("accepts Shift creation on a meaningful boundary that legacy keeps exact", () => {
    const evidence = exactGestureEvidence();
    const xpath = "/html[1]/body[1]/main[1]/p[1]";
    Object.assign(evidence, { target: { xpath, shiftedOwnerXpath: xpath } });
    evidence.operations[1] = {
      id: "shift-expand",
      acknowledged: true,
      acknowledgementLatencyMs: 13,
      assertion: {
        kind: "explicit-exclusion",
        ownerXpath: xpath,
        ownerRelation: "exact",
        breadthIncreased: false,
      },
    } as never;
    expect(validateExactMarkingGestureEvidence(evidence)).toEqual({ pass: true, failures: [] });
  });

  it("validates only shared gestures when pinned legacy has no action-menu contract", () => {
    const evidence = exactGestureEvidence();
    const legacyEvidence = {
      ...evidence,
      operations: evidence.operations.filter((operation) => operation.id !== "context-menu"),
      contextMenu: [],
      contextExpectedDisabled: {},
    };
    expect(validateExactMarkingGestureEvidence(legacyEvidence, { requireContextMenu: false }))
      .toEqual({ pass: true, failures: [] });
    expect(validateExactMarkingGestureEvidence(legacyEvidence).failures)
      .toContain("context-menu:operation-missing");
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

  it("accepts paired target acknowledgements for a canonical exclusion that intentionally has no settled box", () => {
    const evidence = exactGestureEvidence();
    const ownerXpath = "/main[1]/section[1]";
    evidence.operations[1] = {
      id: "shift-expand",
      acknowledged: true,
      acknowledgementLatencyMs: 18,
      assertion: { kind: null, ownerRelation: null, breadthIncreased: false },
      interactionAcknowledgement: {
        kind: "explicit-exclusion",
        ownerRelation: "ancestor",
        ownerXpath,
      },
    } as never;
    evidence.operations[2] = {
      id: "plain-exact-unmark",
      acknowledged: true,
      acknowledgementLatencyMs: 16,
      assertion: { removedExactOwner: false, remainingTargetOwned: 0 },
      interactionAcknowledgement: {
        kind: "explicit-exclusion",
        ownerRelation: "ancestor",
        ownerXpath,
      },
    } as never;

    expect(validateExactMarkingGestureEvidence(evidence)).toEqual({ pass: true, failures: [] });
  });

  it("rejects unpainted create/clear acknowledgements that name different owners", () => {
    const evidence = exactGestureEvidence();
    evidence.operations[1] = {
      id: "shift-expand",
      acknowledged: true,
      acknowledgementLatencyMs: 18,
      assertion: {},
      interactionAcknowledgement: {
        kind: "explicit-exclusion",
        ownerRelation: "ancestor",
        ownerXpath: "/main[1]/section[1]",
      },
    } as never;
    evidence.operations[2] = {
      id: "plain-exact-unmark",
      acknowledged: true,
      acknowledgementLatencyMs: 16,
      assertion: {},
      interactionAcknowledgement: {
        kind: "explicit-exclusion",
        ownerRelation: "ancestor",
        ownerXpath: "/main[1]/section[2]",
      },
    } as never;

    expect(validateExactMarkingGestureEvidence(evidence).failures).toEqual(expect.arrayContaining([
      "shift-expand:not-widened-exclusion",
      "plain-exact-unmark:exact-owner-not-removed",
    ]));
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
    dirtyEdit: { acknowledged: true, inputDispatchedAtEpochMs: 10_000 },
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
      inputDispatchedAtEpochMs: 10_000,
      observedAtEpochMs: 10_180,
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
    expect(harness).toContain("activatedRow: rowActivation.before");
    expect(harness).toContain("await physicalActivatePreviewPageTarget(site)");
    expect(harness).toContain("allowContextPreclean: identity.implementation === \"rewrite\"");
    expect(harness).toContain("preparationReset");
    expect(harness).toContain("integerOption(options, \"activation-timeout-ms\", 45_000)");
    expect(harness).toContain("await runDiscardWorkflow(popup)");
    expect(harness).toContain("waitForDirtyFreshnessProjection(popup, dirtyEdit.inputDispatchedAtEpochMs)");
    expect(harness).toContain("waitForDirtyFreshnessProjection(popup, saveEdit.inputDispatchedAtEpochMs)");
    expect(harness).not.toContain("const freshnessStarted = performance.now()");
    expect(harness).toContain("const saveRequests = await waitForTerminalGuardRequests(");
    expect(harness).toContain("silentPosture: await captureSiteWorkflowPosture(session)");
    expect(harness).toContain("physicalActivatePopupControl(session, \"save-excludes\", \"pointer\")");
    expect(harness).not.toContain("getElementById('lynx-checklist-send').click");
    expect(harness).toContain('implementation === "legacy" ? "config-toggle" : "header-kebab-toggle"');
    expect(harness).toContain('implementation === "legacy" ? "render-mode-open-view" : "render-mode-open"');
    expect(harness).toContain("const openerDeadline = Date.now() + Math.min(timeoutMs, 10_000)");
    expect(harness).toContain("waitForPopupRefreshTerminal(");
    expect(harness).toContain('terminalKind: "stable-idle-fast-terminal"');
    expect(harness).toContain('physicalActivatePopupControl(popup, "lock-refresh", "pointer")');
    expect(harness).toContain("Timed out waiting for explicit Refresh to terminalize; evidence=");
    expect(harness).toContain("Timed out waiting for marking toggle=${expectedChecked}; evidence=");
    expect(harness).toContain('"AI returned to idle without opening a usable Content List or showing a failure"');
    expect(harness).toContain("[state.bodyLead, state.spinnerText]");
    expect(harness).toContain("Property lock unavailable|saved endpoints did not answer|site lookup");
    expect(harness).toContain('integerOption(options, "ai-timeout-ms", AI_WORKFLOW_TIMEOUT_MS)');
    expect(harness).toContain("const initialInspectionView = before.renderInspectionView");
    expect(harness).toContain("last.renderInspectionView === renderMode && initialInspectionView !== renderMode");
    expect(harness).toContain('options["diagnostic-observe-only-reason"]');
    expect(harness).toContain("diagnostic-observe-only-no-render-control-dispatch");
    expect(harness).toContain("diagnosticObserveOnly: true");
    expect(harness).toContain("const initialBefore = await ensurePopupSessionView(");
    expect(harness).toContain('"lock-take-over",');
    expect(harness).toContain("if (recovery?.id)");
    expect(harness).toContain("state.renderInspectionView !== state.renderChoice");
    expect(harness).toContain("renderMode: state.renderChoice");
    expect(harness).toContain('id: "interrupted-stage"');
    expect(harness).toContain("Stage process ended before stage.json was committed; treated as interrupted and failed.");
    expect(harness).toContain('physicalActivatePopupControl(popup, "desktop-preview-enabled", "pointer")');
    expect(harness).toContain("viewportMatches(data.silentDesktopSetup?.posture, 1920, 1080)");
    expect(harness).toContain("viewportMatches(data.markingPosture, 412, 960)");
    expect(harness).toContain("data.workflow.freshAi.feedbackMs <= 100");
    expect(harness).toContain("const initialFeedback = await capturePopupAiFeedback(popup)");
    expect(harness).toContain("initialFeedback.capturedAtEpochMs - feedbackStartedAt");
    const app = readFileSync(resolve(process.cwd(), "src/popup/App.tsx"), "utf8");
    expect(app).toContain("onClick={onExitPreview}");
    expect(app).not.toContain("bindPreviewExitButton");
    expect(app).toContain("exposeImmediateBusyCurtain(\"Starting AI run\")");
    expect(app).toContain('id="ui-curtain"');
    const probes = readFileSync(resolve(process.cwd(), "scripts/performance/p25/workflow-probes.mjs"), "utf8");
    expect(probes).toContain("'toggle-enabled','desktop-preview-enabled','compute'");
    expect(probes).toContain("element.querySelector('.preview-sidebar__item-copy')");
    const postureProbe = probes.slice(
      probes.indexOf("export async function captureSiteWorkflowPosture"),
      probes.indexOf("export function viewportPostureMatches"),
    );
    expect(postureProbe).toContain("const semanticDescribe =");
    expect(postureProbe).toContain("elements.findIndex((element) => semanticDescribe(element).length > 0)");
    expect(postureProbe).toContain("semanticDescribe(ownerNode) || semanticDescribe(underlay.exact) || semanticDescribe(underlay.source) || xpathTerminalTag(xpath)");
    expect(postureProbe.indexOf("const semanticDescribe =")).toBeLessThan(postureProbe.indexOf("semanticDescribe(ownerNode)"));
    expect(probes).toContain('#unfluffify-overlay [data-layer="ai-content"] .uf-rect');
    expect(probes).toContain("'[data-uf-interaction-shield=\"true\"], #unfluffify-overlay'");
    const liveProbes = readFileSync(resolve(process.cwd(), "scripts/performance/p25/live-probes.mjs"), "utf8");
    expect(liveProbes).toContain("const deltaY = availableDown > 16 ? 640 : -640");
    expect(liveProbes).toContain("expectedScrollTop");
    expect(liveProbes).toContain("afterRestoration");
    expect(liveProbes).toContain("invalidSourceEvidence");
    expect(liveProbes).toContain("retainedInvalidSourceIds");
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
    ["freshness origin", (value: ReturnType<typeof completeWorkflowEvidence>) => { value.freshness.inputDispatchedAtEpochMs -= 1; }, "post-ai-freshness-origin"],
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

  it("measures freshness from trusted input dispatch rather than harness setup", () => {
    expect(measureTrustedProjectionInterval(10_000, 10_085)).toEqual({
      inputDispatchedAtEpochMs: 10_000,
      observedAtEpochMs: 10_085,
      projectedWithinMs: 85,
    });
    expect(() => measureTrustedProjectionInterval(10_001, 10_000)).toThrow(/monotonic trusted-input epoch/i);
  });

  it("correlates preview routes to the activated readable target and rejects an unrelated row", () => {
    expect(readableTextsCorrespond("2. Specialist acne treatment. Included", "Specialist acne treatment")) .toBe(true);
    expect(readableTextsCorrespond("3. 15 %. Included", "15 %")).toBe(true);
    expect(readableTextsCorrespond("15 %", "20 %")).toBe(false);
    expect(readableTextsCorrespond("Specialist acne treatment", "Book a moving company in Stockholm")).toBe(false);
    const evidence = completeWorkflowEvidence();
    evidence.contentList.rowToPage.targetCorresponds = false;
    expect(validateFullWorkflowEvidence(evidence).failures).toContain("content-list-row-to-page");
  });
});
