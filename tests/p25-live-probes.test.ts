import { describe, expect, it } from "vitest";
import { readFileSync } from "./file-kit.ts";
import {
  AUTHORITATIVE_RESIZE_POSTURES,
  appliedResizePostureMatches,
  applyAuthoritativeResizePosture,
  authoritativeResizePosture,
  classifyVisualSourcePaint,
  composedVisibilityEvidence,
  executeResizePerturbation,
  filterLongTasksToCollectorWindow,
  snapshotMatchesAuthoritativePosture,
  topHitPaintEvidence,
  waitForPresentationOpportunity,
  bridgeXpathForElement,
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
  clipPath?: string;
}>;

class FakeElement {
  parentElement: FakeElement | null = null;
  assignedSlot: FakeElement | null = null;
  root: Readonly<{ host?: FakeElement }> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  style: FakeStyle = { display: "block", visibility: "visible", opacity: "1", contentVisibility: "visible" };
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
    const document = {
      documentElement: html,
      body,
      querySelectorAll: (tag: string) => tag === "body" ? [body] : tag === "html" ? [html] : [],
    };

    expect(resolveBridgeXpath("/body[1]/main[1]/p[1]", { document })).toBe(paragraph);
    expect(resolveBridgeXpath("/html[1]/body[1]/main[1]", { document })).toBe(main);
    expect(resolveBridgeXpath("/html[1]/body[1]/div[1]/nav[1]", { document })).toBe(navigation);
    expect(resolveBridgeXpath("/body[2]/main[1]", { document })).toBeNull();
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
});

describe("P25 frame collector Long Task evidence", () => {
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
});
