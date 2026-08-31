import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "./file-kit.ts";
import {
  AUTHORITATIVE_RESIZE_POSTURES,
  appliedResizePostureMatches,
  applyAuthoritativeResizePosture,
  authoritativeResizePosture,
  classifyVisualSourcePaint,
  collectorWindowShouldContinue,
  composedVisibilityEvidence,
  executeResizePerturbation,
  filterLongTasksToCollectorWindow,
  markingOwnerBelongsToCandidate,
  preparedMarkingContextIsClean,
  preparedMarkingContextCanBeCleared,
  preparedMarkingTargetIsUsable,
  stablePreparedMarkingTargetAuthority,
  resolveCollectorPerformanceWindow,
  resizeProbeApplicability,
  serializeLongTaskEntry,
  selectActiveOverlayRoot,
  snapshotMatchesAuthoritativePosture,
  topHitPaintEvidence,
  waitForPresentationOpportunity,
  bridgeXpathForElement,
  captureResizeGeometrySnapshot,
  collectOverlayRoots,
  markingDecisionExpression,
  markingDecisionProbeInstallerExpression,
  resolveBridgeXpath,
} from "../scripts/performance/p25/live-probes.mjs";

type FakeStyle = Readonly<{
  display?: string;
  visibility?: string;
  opacity?: string;
  contentVisibility?: string;
  overflow?: string;
  overflowX?: string;
  overflowY?: string;
  clip?: string;
  clipPath?: string;
  pointerEvents?: string;
}>;

class FakeElement {
  parentElement: FakeElement | null = null;
  assignedSlot: FakeElement | null = null;
  root: Readonly<{ host?: FakeElement }> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  style: FakeStyle = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    contentVisibility: "visible",
    pointerEvents: "auto",
  };
  rect = { left: 10, top: 10, right: 110, bottom: 70, width: 100, height: 60 };

  append(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getRootNode() {
    return this.root;
  }
}

describe("P25 live site-session visibility", () => {
  it("foregrounds the candidate before frame and physical-input probes", () => {
    const source = readFileSync(new URL("../scripts/performance/p25/live-probes.mjs", import.meta.url), "utf8");
    expect(source).toMatch(/async function withSiteSession[\s\S]*?Page\.enable[\s\S]*?Page\.bringToFront[\s\S]*?callback\(session\)/);
    expect(source).toMatch(/async function withSiteSession[\s\S]*?finally \{[\s\S]*?await session\.close\(\)/);
    expect(source).toContain("ariaBusy: element.getAttribute('aria-busy') === 'true'");
    expect(source).toContain("document.querySelector('[data-popup-toast]')");
  });

  it("waits on the observer clock and never depends on page timers or animation frames", async () => {
    const evaluations: Array<{ expression: string; options: unknown }> = [];
    const value = await waitForPresentationOpportunity({
      async evaluate(expression: string, options: unknown) {
        evaluations.push({ expression, options });
        return 42;
      },
    }, { frameCount: 2, timeoutMs: 16 });

    expect(value).toBe(42);
    expect(evaluations).toEqual([{
      expression: "performance.now()",
      options: { awaitPromise: false, timeoutMs: 2_000 },
    }]);
  });

  it("chooses a horizontally visible, physically reachable text point for gesture preparation", () => {
    const source = readFileSync(new URL("../scripts/performance/p25/live-probes.mjs", import.meta.url), "utf8");
    expect(source).toContain("rect.left < innerWidth && rect.right > 0");
    expect(source).toContain("document.createTreeWalker(candidate, NodeFilter.SHOW_TEXT)");
    expect(source).toContain("document.elementsFromPoint(x, y).find");
    expect(source).toContain("pointReachable: Boolean(point)");
    expect(source).toContain("Prepared marking target is no longer physically reachable");
    expect(source).toContain("candidate.closest('article,[role=\"article\"]')");
    expect(source).toContain("const attemptLimit = options.attemptLimit ?? 128");
    expect(source).toContain("lastRejections.length > 12");
    expect(source).toContain("const deadline = Date.now() + 500");
    expect(source).toContain("document.querySelectorAll('[data-uf-marking-menu=\"true\"]')");
    expect(source).toContain("Marking context menu did not dismiss after trusted Escape input");
  });
});

describe("P25 configured-target preparation", () => {
  const actions = (clearDisabled: boolean) => [
    { action: "include", disabled: false },
    { action: "exclude", disabled: clearDisabled ? false : true },
    { action: "widen", disabled: true },
    { action: "clear", disabled: clearDisabled },
  ];

  it("distinguishes a clean target from a physically clearable configured target", () => {
    expect(preparedMarkingContextIsClean(actions(true))).toBe(true);
    expect(preparedMarkingContextCanBeCleared(actions(true))).toBe(false);
    expect(preparedMarkingContextIsClean(actions(false))).toBe(false);
    expect(preparedMarkingContextCanBeCleared(actions(false))).toBe(true);
  });
});

describe("P25 active overlay frame authority", () => {
  it("collects roots through indexed document lookups without a document selector walk", () => {
    const legacy = {};
    const silent = {};
    const rewrite = {};
    const querySelectorAll = vi.fn();
    const documentNode = {
      querySelectorAll,
      getElementById: vi.fn((id: string) => id === "unfluffify-overlay" ? legacy : silent),
      getElementsByClassName: vi.fn(() => [rewrite, legacy]),
    };

    expect(collectOverlayRoots(documentNode)).toEqual([legacy, silent, rewrite]);
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it("installs the heavy marking decision probe once and keeps timed calls compile-light", () => {
    const installer = markingDecisionProbeInstallerExpression();
    const call = markingDecisionExpression({
      xpath: "/html[1]/body[1]/main[1]/h1[1]",
      domXpath: "/html[1]/body[1]/main[1]/h1[1]",
      xpathMode: "bridge",
    });

    expect(installer).toContain("__unfluffifyP25MarkingDecisionProbeV2");
    expect(installer).toContain("collectOverlayRoots(document)");
    expect(installer).toContain("root.querySelectorAll(selector)");
    expect(installer).not.toContain("document.querySelectorAll('[data-uf-overlay-xpath]");
    expect(call).toContain("globalThis[\"__unfluffifyP25MarkingDecisionProbeV2\"]");
    expect(call).not.toContain("querySelectorAll");
    expect(call.length).toBeLessThan(400);
  });

  it("selects the painted current root and the newest root when paint counts tie", () => {
    const root = (paintCount: number) => ({
      querySelectorAll: () => Array.from({ length: paintCount }),
    });
    const stale = root(0);
    const current = root(4);
    const newestEmpty = root(0);

    expect(selectActiveOverlayRoot([stale, current])).toBe(current);
    expect(selectActiveOverlayRoot([stale, newestEmpty])).toBe(newestEmpty);
    expect(selectActiveOverlayRoot([])).toBeNull();
  });

  it("does not inspect descendants when there is only one current root", () => {
    const root = { querySelectorAll: vi.fn() };

    expect(selectActiveOverlayRoot([root])).toBe(root);
    expect(root.querySelectorAll).not.toHaveBeenCalled();
  });
});

function fakeEnvironment(elementsFromPoint: () => FakeElement[] = () => []) {
  return {
    Element: FakeElement,
    innerWidth: 1280,
    innerHeight: 900,
    getComputedStyle: (element: FakeElement) => element.style,
    document: { elementsFromPoint },
  };
}

describe("P25 authoritative resize probe posture", () => {
  it("keeps expensive paint and full-document visibility diagnostics outside the timed resize window", async () => {
    let expression = "";
    await captureResizeGeometrySnapshot({
      async evaluate(value: string) {
        expression = value;
        return {
          viewport: { width: 388, height: 960 },
          sourceRectSignature: "/html[1]/body[1]/h1[1]:8,8,371,37",
        };
      },
    });

    expect(expression).toContain("sourceRectSignature");
    expect(expression).toContain("getClientRects");
    expect(expression).not.toContain("elementsFromPoint");
    expect(expression).not.toContain("querySelectorAll('body *')");
    expect(expression).not.toContain("composedVisibilityEvidence");
    expect(expression).not.toContain("topHitPaintEvidence");
  });

  it("does not demand movement when only a non-responsive layout viewport changes", () => {
    const before = {
      viewport: { width: 981, height: 2284 },
      sourceRectSignature: "/html[1]/body[1]/h1[1]:8,8,964,37",
    };
    const unchangedSource = {
      viewport: { width: 981, height: 2425 },
      sourceRectSignature: before.sourceRectSignature,
    };
    expect(resizeProbeApplicability(before, unchangedSource)).toEqual({
      applicable: false,
      reason: "source-highlight-geometry-unchanged",
      layoutViewportChanged: true,
      sourceGeometryChanged: false,
    });

    expect(resizeProbeApplicability(before, {
      ...unchangedSource,
      sourceRectSignature: "/html[1]/body[1]/h1[1]:8,8,940,37",
    })).toEqual({
      applicable: true,
      reason: null,
      layoutViewportChanged: true,
      sourceGeometryChanged: true,
    });
  });

  it("maps marking and silent stages to the production mobile/desktop posture including scale", () => {
    expect(authoritativeResizePosture("marking-resize")).toMatchObject({
      mode: "mobile",
      width: 412,
      height: 960,
      mobile: true,
      scale: 0.85,
    });
    expect(authoritativeResizePosture("silent-resize")).toMatchObject({
      mode: "desktop",
      width: 1920,
      height: 1080,
      mobile: false,
      scale: 0.7,
    });
    expect(() => authoritativeResizePosture("unscoped-resize")).toThrow(/does not identify an authoritative/);
  });

  it.each([
    [AUTHORITATIVE_RESIZE_POSTURES.mobile, 388],
    [AUTHORITATIVE_RESIZE_POSTURES.desktop, 1896],
  ] as const)("reasserts every authoritative CDP posture component for $mode", async (posture, probeWidth) => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const evidence = await applyAuthoritativeResizePosture({
      async send(method: string, params: Record<string, unknown>) {
        calls.push({ method, params });
      },
    }, posture, probeWidth);

    expect(calls).toEqual([
      {
        method: "Emulation.setDeviceMetricsOverride",
        params: {
          width: probeWidth,
          height: posture.height,
          deviceScaleFactor: 1,
          mobile: posture.mobile,
          scale: posture.scale,
        },
      },
      { method: "Emulation.setPageScaleFactor", params: { pageScaleFactor: 1 } },
      { method: "Emulation.setTouchEmulationEnabled", params: { ...posture.touch } },
      { method: "Emulation.setEmulatedMedia", params: { media: "", features: posture.mediaFeatures.map((feature) => ({ ...feature })) } },
    ]);
    expect(evidence.metrics.scale).toBe(posture.scale);
    expect(evidence.metrics.mobile).toBe(posture.mobile);
    const restored = await applyAuthoritativeResizePosture({ async send() {} }, posture);
    expect(appliedResizePostureMatches(restored, posture).matches).toBe(true);
  });

  it("does not accept a restored command record with the wrong compositor scale", () => {
    const posture = AUTHORITATIVE_RESIZE_POSTURES.desktop;
    expect(appliedResizePostureMatches({
      metrics: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, scale: 1 },
      pageScale: { pageScaleFactor: 1 },
      touch: { enabled: false },
      media: { media: "", features: [] },
    }, posture)).toMatchObject({ metricsMatch: false, matches: false });
  });

  it("attempts the complete authoritative restore when the perturbation action throws", async () => {
    const calls: string[] = [];
    const result = await executeResizePerturbation({
      async send(method: string) { calls.push(method); },
    }, AUTHORITATIVE_RESIZE_POSTURES.mobile, 388, async () => { throw new Error("capture failed"); });

    expect(result.actionError).toBe("capture failed");
    expect(result.restoreError).toBeNull();
    expect(result.applied.restored?.metrics).toMatchObject({ width: 412, height: 960, scale: 0.85, mobile: true });
    expect(calls).toHaveLength(8);
    expect(calls.slice(4)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setPageScaleFactor",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setEmulatedMedia",
    ]);
  });

  it("rejects width-only restoration evidence", () => {
    const posture = AUTHORITATIVE_RESIZE_POSTURES.mobile;
    expect(snapshotMatchesAuthoritativePosture({ viewport: { width: 412, height: 960 } }, posture)).toMatchObject({
      viewportMatches: true,
      deviceScaleMatches: false,
      pageScaleMatches: false,
      modeMatches: false,
      matches: false,
    });
    expect(snapshotMatchesAuthoritativePosture({
      viewport: { width: 412, height: 960 },
      emulation: {
        devicePixelRatio: 1,
        visualViewportScale: 1,
        maxTouchPoints: 1,
        pointerCoarse: true,
        hoverNone: true,
      },
    }, posture).matches).toBe(true);
  });

  it("accepts an exact interactive viewport when responsive layout metadata is wider", () => {
    const posture = AUTHORITATIVE_RESIZE_POSTURES.mobile;
    expect(snapshotMatchesAuthoritativePosture({
      viewport: { width: 424, height: 988 },
      interactiveViewport: { width: 412, height: 960 },
      emulation: {
        devicePixelRatio: 1,
        visualViewportScale: 1,
        maxTouchPoints: 1,
        pointerCoarse: true,
        hoverNone: true,
      },
    }, posture)).toMatchObject({
      viewportMatches: true,
      layoutViewportMatches: false,
      interactiveViewportMatches: true,
      matches: true,
    });
  });
});

describe("P25 composed visual visibility evidence", () => {
  it("resolves bridge-relative body XPaths instead of misclassifying their overlays as source-less", () => {
    const node = (
      tagName: string,
      children: unknown[] = [],
      attributes: Record<string, string> = {},
    ) => ({
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      childNodes: children,
      getAttribute: (name: string) => attributes[name] ?? null,
      hasAttribute: (name: string) => Object.hasOwn(attributes, name),
    });
    const paragraph = node("p");
    const main = node("main", [paragraph]);
    const navigation = node("nav");
    const pageHeader = node("div", [navigation]);
    const suppressedModal = node("div", [node("button")], {
      "data-uf-consent-hidden": "true",
    });
    const body = node("body", [suppressedModal, pageHeader, main]);
    const html = node("html", [body]);
    const querySelectorAll = vi.fn((tag: string) =>
      tag === "body" ? [body] : tag === "html" ? [html] : []
    );
    const document = {
      documentElement: html,
      body,
      querySelectorAll,
    };

    expect(resolveBridgeXpath("/body[1]/main[1]/p[1]", { document })).toBe(paragraph);
    expect(resolveBridgeXpath("/html[1]/body[1]/main[1]", { document })).toBe(main);
    expect(resolveBridgeXpath("/html[1]/body[1]/div[1]/nav[1]", { document })).toBe(navigation);
    expect(resolveBridgeXpath("/body[2]/main[1]", { document })).toBeNull();
    expect(querySelectorAll).not.toHaveBeenCalled();
    expect(bridgeXpathForElement(navigation, { document })).toBe("/html[1]/body[1]/div[1]/nav[1]");
    expect(bridgeXpathForElement(main, { document })).toBe("/html[1]/body[1]/main[1]");
    expect(bridgeXpathForElement(suppressedModal, { document })).toBeNull();
  });

  it("rejects a geometrically visible source hidden by a composed ancestor", () => {
    const host = new FakeElement();
    host.style = { ...host.style, opacity: "0" };
    const source = new FakeElement();
    source.root = { host };

    expect(composedVisibilityEvidence(source, fakeEnvironment())).toEqual({
      visible: false,
      suppressed: false,
      reason: "composed-ancestor-opacity",
    });
  });

  it("independently rejects consent suppression on an ancestor", () => {
    const suppressed = new FakeElement();
    suppressed.attributes.set("data-uf-consent-hidden", "true");
    const source = suppressed.append(new FakeElement());

    expect(composedVisibilityEvidence(source, fakeEnvironment())).toEqual({
      visible: false,
      suppressed: true,
      reason: "composed-ancestor-suppressed",
    });
  });

  it("rejects the source element's own screen-reader clipping", () => {
    const source = new FakeElement();
    source.style = { ...source.style, clip: "rect(0px, 0px, 0px, 0px)" };

    expect(composedVisibilityEvidence(source, fakeEnvironment())).toEqual({
      visible: false,
      suppressed: false,
      reason: "composed-ancestor-clip-path",
    });
  });

  it("rejects a nonzero source rect that is fully clipped by a composed ancestor", () => {
    const clipper = new FakeElement();
    clipper.style = { ...clipper.style, overflow: "hidden" };
    clipper.rect = { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 };
    const source = clipper.append(new FakeElement());
    source.rect = { left: 20, top: 20, right: 120, bottom: 80, width: 100, height: 60 };
    const visibility = composedVisibilityEvidence(source, fakeEnvironment(() => [clipper]));
    const paint = topHitPaintEvidence(source, fakeEnvironment(() => [clipper]));

    expect(visibility).toEqual({ visible: false, suppressed: false, reason: "composed-ancestor-clipped" });
    expect(paint.reachable).toBe(false);
    expect(classifyVisualSourcePaint({ painted: true, sourceExpected: true, sourceResolved: true, visibility, paint }))
      .toMatchObject({ invalid: true, composedInvisible: true, covered: true });
  });

  it("uses the top non-extension hit so a covered source cannot pass from a deeper hit", () => {
    const source = new FakeElement();
    const cover = new FakeElement();
    const evidence = topHitPaintEvidence(source, fakeEnvironment(() => [cover, source]));

    expect(evidence).toMatchObject({
      reachable: false,
      sampledPointCount: 5,
      reachablePointCount: 0,
      reason: "covered-at-sampled-points",
    });
    expect(classifyVisualSourcePaint({
      painted: true,
      sourceExpected: true,
      sourceResolved: true,
      visibility: { visible: true },
      paint: evidence,
    })).toMatchObject({ invalid: true, composedInvisible: false, covered: true, reachable: false });
  });

  it("ignores extension evidence layers but accepts a source or composed descendant as the top page hit", () => {
    const source = new FakeElement();
    const descendant = source.append(new FakeElement());
    const extensionRoot = new FakeElement();
    extensionRoot.attributes.set("data-uf-extension-ui", "true");
    const overlay = extensionRoot.append(new FakeElement());

    expect(topHitPaintEvidence(source, fakeEnvironment(() => [overlay, descendant, source]))).toMatchObject({
      reachable: true,
      sampledPointCount: 5,
      reachablePointCount: 5,
      reason: null,
    });
  });

  it("accepts a visible pointer-suppressed SVG through its first interactive ancestor", () => {
    const button = new FakeElement();
    const source = button.append(new FakeElement());
    source.style = { ...source.style, pointerEvents: "none" };

    expect(topHitPaintEvidence(source, fakeEnvironment(() => [button]))).toMatchObject({
      reachable: true,
      sampledPointCount: 5,
      reachablePointCount: 5,
      reason: null,
    });
  });
});

describe("P25 frame collector Long Task evidence", () => {
  it("retains execution-context attribution for every observed Long Task", () => {
    expect(serializeLongTaskEntry({
      name: "cross-origin-descendant",
      entryType: "longtask",
      startTime: 120,
      duration: 90,
      attribution: [{
        name: "unknown",
        entryType: "taskattribution",
        startTime: 0,
        duration: 0,
        containerType: "iframe",
        containerSrc: "https://widgets.example/frame",
        containerId: "reviews",
        containerName: "reviews-frame",
      }],
    })).toEqual({
      name: "cross-origin-descendant",
      entryType: "longtask",
      startTime: 120,
      duration: 90,
      attribution: [{
        name: "unknown",
        entryType: "taskattribution",
        startTime: 0,
        duration: 0,
        containerType: "iframe",
        containerSrc: "https://widgets.example/frame",
        containerId: "reviews",
        containerName: "reviews-frame",
      }],
    });
  });

  it("attributes only Long Tasks that start inside the current collector window", () => {
    expect(filterLongTasksToCollectorWindow([
      { startTime: 90, duration: 80 },
      { startTime: 100, duration: 12 },
      { startTime: 140, duration: 22 },
      { startTime: 200, duration: 35 },
      { startTime: 201, duration: 99 },
      { startTime: Number.NaN, duration: 1 },
    ], 100, 200)).toEqual([
      { startTime: 100, duration: 12 },
      { startTime: 140, duration: 22 },
      { startTime: 200, duration: 35 },
    ]);
  });

  it("fails closed for invalid or missing collector bounds", () => {
    expect(filterLongTasksToCollectorWindow([{ startTime: 100, duration: 12 }], Number.NaN, 200)).toEqual([]);
    expect(filterLongTasksToCollectorWindow([{ startTime: 100, duration: 12 }], 200, 100)).toEqual([]);
  });

  it("keeps collecting through a long action and its settled tail", () => {
    const base = { startedAt: 100, durationMs: 2_200, frameCount: 240 };
    expect(collectorWindowShouldContinue({ ...base, now: 2_500, actionFinishedAt: null })).toBe(true);
    expect(collectorWindowShouldContinue({ ...base, now: 4_500, actionFinishedAt: 4_400 })).toBe(true);
    expect(collectorWindowShouldContinue({ ...base, now: 4_581, actionFinishedAt: 4_400 })).toBe(false);
  });

  it("uses explicit operator-action bounds instead of harness preparation bounds", () => {
    expect(resolveCollectorPerformanceWindow({
      performanceWindow: { startedAt: 300, endedAt: 700 },
    }, 100, 900, { startedAt: 200, endedAt: 800 })).toEqual({
      startedAt: 300,
      endedAt: 700,
      source: "action",
    });
    expect(resolveCollectorPerformanceWindow({}, 100, 900, {
      startedAt: 200,
      endedAt: 500,
    })).toEqual({
      startedAt: 200,
      endedAt: 500,
      source: "during",
    });
    expect(resolveCollectorPerformanceWindow({}, 100, 900)).toEqual({
      startedAt: 100,
      endedAt: 900,
      source: "collector",
    });
  });

  it("keeps in-action Long Tasks but excludes unrelated collector-tail work", () => {
    const window = resolveCollectorPerformanceWindow({}, 100, 1_700, {
      startedAt: 200,
      endedAt: 600,
    });
    expect(filterLongTasksToCollectorWindow([
      { startTime: 180, duration: 90 },
      { startTime: 364, duration: 98 },
      { startTime: 1_220, duration: 55 },
    ], window.startedAt, window.endedAt)).toEqual([
      { startTime: 364, duration: 98 },
    ]);
  });
});

describe("P25 prepared marking target authority", () => {
  const target = { xpath: "/html[1]/body[1]/main[1]/h1[1]" };

  it("accepts an exact Alt owner, a contractual Shift owner, and a clean final owner set", () => {
    expect(preparedMarkingTargetIsUsable({
      target,
      includedOwnerXpath: target.xpath,
      shiftedOwnerXpath: "/html[1]/body[1]/main[1]",
      decision: { targetOwned: [] },
    })).toBe(true);
  });

  it("accepts the clicked node when the legacy widening ladder keeps a meaningful boundary exact", () => {
    expect(preparedMarkingTargetIsUsable({
      target,
      includedOwnerXpath: target.xpath,
      shiftedOwnerXpath: target.xpath,
      decision: { targetOwned: [] },
    })).toBe(true);
  });

  it("requires context-menu authority to prove there is no latent explicit owner", () => {
    const clean = [
      { action: "include", disabled: false },
      { action: "exclude", disabled: false },
      { action: "widen", disabled: true },
      { action: "clear", disabled: true },
    ];
    expect(preparedMarkingContextIsClean(clean)).toBe(true);
    expect(preparedMarkingContextIsClean(clean.map((action) =>
      action.action === "clear" ? { ...action, disabled: false } : action
    ))).toBe(false);
    expect(preparedMarkingContextIsClean(clean.filter((action) => action.action !== "exclude"))).toBe(false);
  });

  it("normalizes a related nested physical owner before exact Alt and Shift proof", () => {
    const nestedOwnerXpath = `${target.xpath}/a[1]`;
    expect(markingOwnerBelongsToCandidate(target.xpath, nestedOwnerXpath)).toBe(true);
    expect(preparedMarkingTargetIsUsable({
      target: { xpath: nestedOwnerXpath },
      includedOwnerXpath: nestedOwnerXpath,
      shiftedOwnerXpath: "/html[1]/body[1]/main[1]",
      decision: { targetOwned: [] },
    })).toBe(true);
    expect(markingOwnerBelongsToCandidate(target.xpath, "/html[1]/body[1]/aside[1]")).toBe(false);
  });

  it("requires the exact Alt owner and contractual Shift owner to survive a second authority observation", () => {
    const initial = {
      target,
      includedOwnerXpath: target.xpath,
      shiftedOwnerXpath: "/html[1]/body[1]/main[1]",
      decision: { targetOwned: [] },
    };

    expect(stablePreparedMarkingTargetAuthority(initial, { ...initial })).toBe(true);
    expect(stablePreparedMarkingTargetAuthority(initial, {
      ...initial,
      shiftedOwnerXpath: "/html[1]/body[1]",
    })).toBe(false);
    expect(stablePreparedMarkingTargetAuthority(initial, {
      ...initial,
      decision: { targetOwned: [{ ownerRelation: "ancestor" }] },
    })).toBe(false);
  });

  it.each([
    ["late ancestor ownership", target.xpath, "/html[1]/body[1]/main[1]", [{ ownerRelation: "ancestor" }]],
    ["descendant Alt owner", `${target.xpath}/a[1]`, "/html[1]/body[1]/main[1]", []],
    ["descendant Shift owner", target.xpath, `${target.xpath}/span[1]`, []],
  ])("rejects %s", (_label, includedOwnerXpath, shiftedOwnerXpath, targetOwned) => {
    expect(preparedMarkingTargetIsUsable({
      target,
      includedOwnerXpath,
      shiftedOwnerXpath,
      decision: { targetOwned },
    })).toBe(false);
  });
});
