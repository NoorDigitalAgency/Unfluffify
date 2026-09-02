import { describe, expect, it, vi } from "vitest";

import {
  CONSENT_BYPASS_STYLE_ID,
  CONSENT_HIDDEN_ATTR,
  LEGACY_CONSENT_BYPASS_STYLE_ID,
} from "../../../../src/content/consent";
import {
  forgetInteractionShieldCaptureState,
  rememberInteractionShieldCaptureState,
} from "../../../../src/content/interaction-shield-capture";
import { MOTION_CAPTURE_LEDGER_ATTR } from "../../../../src/content/marking/capture-hygiene";
import {
  createDomBridgeView,
  createDomBridgeViewCursor,
  createDomBridgePresentationRefreshCursor,
  createMarkingEngine,
  createOverlayRenderer,
  captureFlattenedHtml,
  buildPreviewTextMetadata,
  getComposedHitElements,
  installClosedShadowHostInstrumentation,
  isPaintReachable,
  isCurrentlyVisuallyVisible,
  MARKING_OVERLAY_STYLE_ID,
  markClosedShadowHost,
  previewTextForElement,
  refreshDomBridgePresentation,
} from "../../../../src/content/marking";
import { stripUncapturableHtml } from "../../../../src/content/marking/submit";

type Rect = { left: number; top: number; width: number; height: number; right: number; bottom: number };

class FakeElement {
  readonly childNodes: Array<{ nodeType?: number; textContent?: string } | FakeElement> = [];
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  shadowHost: FakeElement | null = null;
  assigned: FakeElement[] = [];
  ownerDocument!: FakeDocument;
  shadowRoot?: { children: FakeElement[]; childNodes?: Array<{ nodeType?: number; textContent?: string } | FakeElement>; elementsFromPoint: (_x: number, _y: number) => FakeElement[] } | null;
  className = "";
  id = "";
  hidden = false;
  clientRects: Rect[] | null = null;
  clientRectReadCount = 0;
  rectReadCount = 0;
  roleReadCount = 0;
  readonly attributeReadCount = new Map<string, number>();
  scrollTop = 0;

  constructor(readonly tagName: string, readonly rect: Rect, text = "") {
    if (text) {
      this.childNodes.push({ nodeType: 3, textContent: text });
    }
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  get parentNode(): FakeElement | null {
    return this.parentElement;
  }

  getRootNode(): { host?: FakeElement } {
    return this.shadowHost ? { host: this.shadowHost } : {};
  }

  replaceChildren(): void {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children.splice(0);
    for (let index = this.childNodes.length - 1; index >= 0; index -= 1) {
      if (this.childNodes[index] instanceof FakeElement) {
        this.childNodes.splice(index, 1);
      }
    }
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    const childIndex = parent.children.indexOf(this);
    if (childIndex >= 0) {
      parent.children.splice(childIndex, 1);
    }
    const nodeIndex = parent.childNodes.indexOf(this);
    if (nodeIndex >= 0) {
      parent.childNodes.splice(nodeIndex, 1);
    }
    this.parentElement = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    this.attributeReadCount.set(name, (this.attributeReadCount.get(name) ?? 0) + 1);
    if (name === "role") {
      this.roleReadCount += 1;
    }
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  closest(selector: string): FakeElement | null {
    if (selector === '[data-uf-extension-ui="true"]' && this.getAttribute("data-uf-extension-ui") === "true") {
      return this;
    }
    if (selector === "[data-uf-consent-hidden]" && this.hasAttribute("data-uf-consent-hidden")) {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  contains(element: FakeElement): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }

  matches(selector: string): boolean {
    return selector.split(",").some((candidate) => {
      const normalized = candidate.trim();
      if (normalized.startsWith(".")) {
        return this.className.split(/\s+/).includes(normalized.slice(1));
      }
      return normalized.toLowerCase() === this.tagName.toLowerCase();
    });
  }

  assignedNodes(): FakeElement[] {
    return this.assigned;
  }

  getBoundingClientRect(): Rect {
    this.rectReadCount += 1;
    return this.rect;
  }

  getClientRects(): Rect[] {
    this.clientRectReadCount += 1;
    return this.clientRects ?? [this.rect];
  }
}

class FakeDocument {
  readonly documentElement: FakeElement;
  readonly scrollingElement: FakeElement;
  readonly defaultView = {
    innerWidth: 412,
    getComputedStyle: (element: FakeElement) => ({
      display: element.style.display ?? "block",
      visibility: element.style.visibility ?? "visible",
      opacity: element.style.opacity ?? "1",
      clip: element.style.clip ?? "auto",
      clipPath: element.style.clipPath ?? "none",
      contentVisibility: element.style.contentVisibility ?? "visible",
      overflow: element.style.overflow ?? "visible",
      overflowX: element.style.overflowX ?? element.style.overflow ?? "visible",
      overflowY: element.style.overflowY ?? element.style.overflow ?? "visible",
      pointerEvents: element.style.pointerEvents ?? "auto",
    }),
  };
  hits: FakeElement[] = [];
  pointHits: ((x: number, y: number) => FakeElement[]) | null = null;
  hitReadCount = 0;
  createElementCount = 0;

  constructor() {
    this.documentElement = this.createElement("html");
    this.scrollingElement = this.documentElement;
  }

  createElement(tagName: string): FakeElement {
    this.createElementCount += 1;
    const element = new FakeElement(tagName.toUpperCase(), {
      left: 0,
      top: 0,
      width: 100,
      height: 20,
      right: 100,
      bottom: 20,
    });
    element.ownerDocument = this;
    return element;
  }

  elementsFromPoint(x: number, y: number): FakeElement[] {
    this.hitReadCount += 1;
    return this.pointHits?.(x, y) ?? this.hits;
  }
}

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function createRendererTestSeam() {
  const markingRender = vi.fn();
  const branchRender = vi.fn();
  const silentRender = vi.fn();
  const silentBranchRender = vi.fn();
  const geometryRender = vi.fn();
  const geometryBranchRender = vi.fn();
  const hoverRender = vi.fn();
  const focusRender = vi.fn();
  const focusRefresh = vi.fn();
  const createRenderer = vi.fn((options: Parameters<typeof createOverlayRenderer>[0]) => {
    const renderer = createOverlayRenderer(options);
    return {
      ...renderer,
      render(...args: Parameters<typeof renderer.render>): void {
        markingRender();
        renderer.render(...args);
      },
      renderBranch(...args: Parameters<typeof renderer.renderBranch>): void {
        branchRender(args[1].size, args[3]?.size ?? args[1].size);
        renderer.renderBranch(...args);
      },
      renderSilentHighlights(...args: Parameters<typeof renderer.renderSilentHighlights>): void {
        silentRender();
        renderer.renderSilentHighlights(...args);
      },
      renderSilentHighlightsBranch(...args: Parameters<typeof renderer.renderSilentHighlightsBranch>): void {
        silentBranchRender();
        renderer.renderSilentHighlightsBranch(...args);
      },
      reposition(...args: Parameters<typeof renderer.reposition>): void {
        geometryRender(args[0].size);
        renderer.reposition(...args);
      },
      repositionBranch(...args: Parameters<typeof renderer.repositionBranch>): void {
        geometryBranchRender(args[0].size, args[1]?.final === true);
        renderer.repositionBranch(...args);
      },
      setHover(...args: Parameters<typeof renderer.setHover>): void {
        hoverRender(...args);
        renderer.setHover(...args);
      },
      setFocus(...args: Parameters<typeof renderer.setFocus>): void {
        focusRender(...args);
        renderer.setFocus(...args);
      },
      refreshFocus(): void {
        focusRefresh();
        renderer.refreshFocus();
      },
    };
  });
  return {
    createRenderer,
    markingRender,
    branchRender,
    silentRender,
    silentBranchRender,
    geometryRender,
    geometryBranchRender,
    hoverRender,
    focusRender,
    focusRefresh,
  };
}

describe("P6 DOM bridge", () => {
  it("refreshes visibility only inside stable presentation branches", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const header = new FakeElement("HEADER", rect(0, 0, 300, 80));
    const label = new FakeElement("P", rect(10, 10, 120, 20), "Header copy");
    const article = new FakeElement("ARTICLE", rect(0, 100, 300, 160), "Body copy");
    for (const element of [root, header, label, article]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(header);
    header.appendChild(label);
    root.appendChild(article);
    const bridge = createDomBridgeView(root as unknown as Element);
    const rootReads = root.rectReadCount;
    const articleReads = article.rectReadCount;

    header.style.display = "none";
    const refreshed = refreshDomBridgePresentation(bridge, [
      label as unknown as Element,
      header as unknown as Element,
    ]);

    expect(refreshed.branchRoots.map((node) => node.xpath)).toEqual(["/main[1]/header[1]"]);
    expect(refreshed.view.byElement.get(header as unknown as Element)?.evaluationNode.visible).toBe(false);
    expect(refreshed.view.byElement.get(label as unknown as Element)?.evaluationNode.visible).toBe(false);
    expect(bridge.byElement.get(label as unknown as Element)?.evaluationNode.visible).toBe(true);
    expect(root.rectReadCount).toBe(rootReads);
    expect(article.rectReadCount).toBe(articleReads);
  });

  it("captures a broad presentation refresh in caller-bounded layout slices", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 3_000));
    root.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    const paragraphs = Array.from({ length: 130 }, (_, index) => {
      const paragraph = new FakeElement("P", rect(0, index * 22, 120, 20), `Row ${index}`);
      paragraph.ownerDocument = doc;
      root.appendChild(paragraph);
      return paragraph;
    });
    const bridge = createDomBridgeView(root as unknown as Element);
    for (const element of [root, ...paragraphs]) element.rectReadCount = 0;
    root.style.display = "none";

    const cursor = createDomBridgePresentationRefreshCursor(bridge, [root as unknown as Element]);
    expect(cursor.totalNodes).toBe(131);
    expect(cursor.step(32)).toBe(false);
    expect(cursor.processedNodes).toBe(32);
    expect([root, ...paragraphs].reduce((sum, element) => sum + element.rectReadCount, 0)).toBe(32);
    expect(() => cursor.finish()).toThrow(/capture is incomplete/i);
    while (!cursor.step(32)) {
      // Exercise the same bounded cursor contract used by the live engine.
    }
    const refreshed = cursor.finish();
    expect(cursor.processedNodes).toBe(131);
    expect(refreshed.view.byElement.get(paragraphs[129] as unknown as Element)?.evaluationNode.visible).toBe(false);
  });

  it("captures a complete bridge in caller-bounded post-order slices", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 3_000));
    root.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    const paragraphs = Array.from({ length: 130 }, (_, index) => {
      const paragraph = new FakeElement("P", rect(0, index * 22, 120, 20), `Row ${index}`);
      paragraph.ownerDocument = doc;
      root.appendChild(paragraph);
      return paragraph;
    });

    const cursor = createDomBridgeViewCursor(root as unknown as Element);
    expect(cursor.step(32)).toBe(false);
    expect(cursor.processedNodes).toBe(32);
    expect(() => cursor.finish()).toThrow(/capture is incomplete/i);
    while (!cursor.step(32)) {
      // Exercise the same bounded post-order cursor used by structural refresh.
    }
    const bridge = cursor.finish();
    expect(cursor.processedNodes).toBe(131);
    expect(bridge.byXpath.size).toBe(131);
    expect(bridge.byXpath.get("/main[1]/p[130]")?.element).toBe(paragraphs[129]);
  });

  it("pierces pointer-events-suppressed descendants and accepts ancestor transparency as reachable", () => {
    const doc = new FakeDocument();
    const header = new FakeElement("HEADER", rect(0, 0, 300, 80));
    const span = new FakeElement("SPAN", rect(10, 10, 100, 20), "FAQ");
    span.style.pointerEvents = "none";
    header.ownerDocument = doc;
    span.ownerDocument = doc;
    header.appendChild(span);
    doc.hits = [header];

    expect(getComposedHitElements(doc as unknown as Document, 20, 15)[0]).toBe(span);
    expect(isPaintReachable(span as unknown as Element, doc as unknown as Document)).toBe(true);
  });

  it("bounds pointer-suppressed recovery to the top visible hit branch", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("BUTTON", rect(10, 10, 100, 30), "Target");
    const suppressed = new FakeElement("SPAN", rect(15, 15, 60, 20), "Label");
    suppressed.style.pointerEvents = "none";
    for (const element of [root, target, suppressed]) {
      element.ownerDocument = doc;
    }
    root.appendChild(target);
    target.appendChild(suppressed);
    const decoys = Array.from({ length: 500 }, (_, index) => {
      const decoy = new FakeElement("DIV", rect(0, 100 + index, 300, 1));
      decoy.ownerDocument = doc;
      root.appendChild(decoy);
      return decoy;
    });
    doc.hits = [target, root, doc.documentElement];

    expect(getComposedHitElements(doc as unknown as Document, 20, 20)[0]).toBe(suppressed);
    expect(decoys.every((decoy) => decoy.clientRectReadCount === 0)).toBe(true);
  });

  it("prunes hidden consent recovery branches before descendant geometry or style reads", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 412, 960));
    const hiddenConsent = new FakeElement("DIALOG", rect(0, 0, 412, 960));
    hiddenConsent.setAttribute("data-uf-consent-hidden", "true");
    hiddenConsent.style.pointerEvents = "none";
    const hiddenDescendants = Array.from({ length: 500 }, () =>
      new FakeElement("DIV", rect(0, 0, 412, 960))
    );
    const valid = new FakeElement("BUTTON", rect(20, 20, 120, 40), "Valid target");
    valid.style.pointerEvents = "none";
    for (const element of [root, hiddenConsent, valid, ...hiddenDescendants]) {
      element.ownerDocument = doc;
    }
    root.appendChild(hiddenConsent);
    for (const descendant of hiddenDescendants) hiddenConsent.appendChild(descendant);
    root.appendChild(valid);
    doc.hits = [root, doc.documentElement];
    const styleReads = vi.spyOn(doc.defaultView, "getComputedStyle");

    const hits = getComposedHitElements(doc as unknown as Document, 30, 30);

    expect(hits[0]).toBe(valid);
    expect(hiddenConsent.clientRectReadCount).toBe(0);
    expect(hiddenDescendants.every((element) => element.clientRectReadCount === 0)).toBe(true);
    expect(styleReads.mock.calls.some(([element]) =>
      element === hiddenConsent || hiddenDescendants.includes(element)
    )).toBe(false);
  });

  it("rejects genuinely covered elements even when they appear below the top hit", () => {
    const doc = new FakeDocument();
    const target = new FakeElement("P", rect(0, 0, 100, 20), "Covered");
    const cover = new FakeElement("DIV", rect(0, 0, 100, 20));
    target.ownerDocument = doc;
    cover.ownerDocument = doc;
    doc.hits = [cover, target];

    expect(isPaintReachable(target as unknown as Element, doc as unknown as Document)).toBe(false);
  });

  it("reuses hover target resolution while validating the visible hit branch", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(10, 10, 100, 20), "Hover copy");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    root.appendChild(target);
    doc.hits = [target, root];
    const rendererSeam = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createRenderer: rendererSeam.createRenderer },
    });
    const hint = { overlayXpath: "/main[1]/p[1]" };

    engine.hoverAtPoint(20, 15, "include", false, hint);
    const firstProbeReads = doc.hitReadCount;
    const firstHoverRenders = rendererSeam.hoverRender.mock.calls.length;
    engine.hoverAtPoint(40, 15, "include", false, hint);

    expect(doc.hitReadCount).toBe(firstProbeReads + 1);
    expect(rendererSeam.hoverRender).toHaveBeenCalledTimes(firstHoverRenders);

    engine.refresh();
    engine.hoverAtPoint(40, 15, "include", false, hint);

    expect(doc.hitReadCount).toBeGreaterThan(firstProbeReads);
  });

  it("falls back to composed hit testing when an overlay hint is stale", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(10, 10, 100, 20), "Hover copy");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    root.appendChild(target);
    doc.hits = [target, root];
    const engine = createMarkingEngine(root as unknown as Element);

    expect(engine.resolveAtPoint(20, 15, "exclude", true, {
      overlayXpath: "/main[1]/stale[1]",
    })?.xpath).toBe("/main[1]/p[1]");
    expect(doc.hitReadCount).toBe(1);
    engine.dispose();
  });

  it("lets an ordinary click create an exclusion without requiring Shift", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(10, 10, 100, 20), "Included copy");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    root.appendChild(target);
    doc.hits = [target, root];
    const engine = createMarkingEngine(root as unknown as Element);

    const ordinary = engine.resolveAtPoint(20, 15, "exclude", false);
    expect(ordinary?.xpath).toBe("/main[1]/p[1]");
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[1]", excluded: false });
    expect(engine.acknowledge(ordinary!, "exclude")).toBe(true);
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[1]", excluded: false });
    expect(engine.toggle(ordinary!, "exclude")).toBe(true);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    expect(engine.acknowledge(ordinary!, "exclude")).toBe(true);
    engine.dispose();
  });

  it("uses the live physical hit path when a CSS carousel moves snapshot-hidden content onscreen", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const card = new FakeElement("ARTICLE", rect(-500, 10, 260, 120));
    const title = new FakeElement("H2", rect(-480, 20, 180, 24), "Late visible title");
    const copy = new FakeElement("P", rect(-480, 54, 180, 40), "Late visible copy");
    const offscreenSiblings = Array.from({ length: 120 }, (_, index) =>
      new FakeElement("DIV", rect(-900, 140 + index * 20, 180, 18), `Offscreen ${index}`)
    );
    for (const element of [root, card, title, copy, ...offscreenSiblings]) {
      element.ownerDocument = doc;
    }
    root.appendChild(card);
    card.appendChild(title);
    card.appendChild(copy);
    for (const sibling of offscreenSiblings) card.appendChild(sibling);
    doc.hits = [title, card, root];
    const engine = createMarkingEngine(root as unknown as Element);

    // A transform-only carousel transition emits no DOM mutation, so these
    // nodes retain their original horizontally clipped bridge visibility.
    Object.assign(card.rect, rect(10, 10, 260, 120));
    Object.assign(title.rect, rect(20, 20, 180, 24));
    Object.assign(copy.rect, rect(20, 54, 180, 40));

    const include = engine.resolveAtPoint(40, 30, "include");
    expect(include?.xpath).toBe("/main[1]/article[1]/h2[1]");

    const styleReads = vi.spyOn(doc.defaultView, "getComputedStyle");
    styleReads.mockClear();
    const widened = engine.resolveAtPoint(40, 30, "exclude", true);
    expect(widened?.xpath).toBe("/main[1]/article[1]");
    expect(styleReads.mock.calls.some(([element]) => offscreenSiblings.includes(element))).toBe(false);
    expect(engine.acknowledge(include!, "include")).toBe(true);
    expect(engine.toggle(include!, "include")).toBe(true);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/article[1]/h2[1]",
      excluded: false,
      explicit: true,
    });
    engine.dispose();
  });

  it("rebinds an in-flight gesture across bridge generations only for the same Element", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const article = new FakeElement("ARTICLE", rect(10, 10, 260, 120));
    const copy = new FakeElement("P", rect(20, 20, 180, 40), "Stable physical copy");
    for (const element of [root, article, copy]) {
      element.ownerDocument = doc;
    }
    root.appendChild(article);
    article.appendChild(copy);
    doc.hits = [copy, article, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const resolved = engine.resolveAtPoint(40, 30, "exclude", true)!;
    expect(resolved.xpath).toBe("/main[1]/article[1]/p[1]");

    engine.refresh();
    expect(engine.acknowledge(resolved, "exclude")).toBe(true);
    engine.refresh();
    expect(engine.toggle(resolved, "exclude")).toBe(true);
    expect(engine.rows()).toContainEqual({
      xpath: resolved.xpath,
      excluded: true,
      explicit: true,
    });

    engine.refresh();
    expect(engine.hasExplicitMark(resolved)).toBe(true);
    expect(engine.acknowledge(resolved, "clear")).toBe(true);
    engine.refresh();
    expect(engine.clear(resolved)).toBe(true);
    expect(engine.hasExplicitMark(resolved)).toBe(false);
    engine.dispose();
  });

  it("rejects an in-flight gesture when a replacement Element reuses its XPath", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const original = new FakeElement("P", rect(20, 20, 180, 40), "Original copy");
    for (const element of [root, original]) {
      element.ownerDocument = doc;
    }
    root.appendChild(original);
    doc.hits = [original, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const resolved = engine.resolveAtPoint(40, 30, "include")!;

    original.remove();
    const replacement = new FakeElement("P", rect(20, 20, 180, 40), "Replacement copy");
    replacement.ownerDocument = doc;
    root.appendChild(replacement);
    doc.hits = [replacement, root];
    engine.refresh();

    expect(replacement.parentElement).toBe(root);
    expect(engine.acknowledge(resolved, "include")).toBe(false);
    expect(engine.toggle(resolved, "include")).toBe(false);
    expect(engine.clear(resolved)).toBe(false);
    expect(engine.hasExplicitMark(resolved)).toBe(false);
    engine.dispose();
  });

  it("resolves exact painted exclusion fragments without scanning canonical owners", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(10, 10, 210, 20), "Fragmented exclusion");
    target.clientRects = [rect(10, 10, 80, 20), rect(140, 10, 80, 20)];
    for (const element of [root, target]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    doc.pointHits = (x) => x < 90 || x > 140 ? [target, root] : [root];
    const engine = createMarkingEngine(root as unknown as Element, { render: true });
    const shifted = engine.resolveAtPoint(20, 15, "exclude", true)!;
    engine.toggle(shifted, "exclude");

    doc.hitReadCount = 0;
    expect(engine.resolveAtPoint(150, 15, "exclude")?.xpath).toBe("/main[1]/p[1]");
    expect(doc.hitReadCount).toBe(1);
    // The bounding box spans this gap, but no painted fragment owns it.
    expect(engine.resolveAtPoint(110, 15, "exclude")).toBeNull();
    expect(doc.hitReadCount).toBe(2);
    engine.dispose();
  });

  it("prefers an overlapping explicit exclusion over a default boundary", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const footer = new FakeElement("FOOTER", rect(10, 10, 160, 40), "Default footer");
    const paragraph = new FakeElement("P", rect(10, 10, 160, 40), "Explicit paragraph");
    for (const element of [root, footer, paragraph]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(footer);
    root.appendChild(paragraph);
    doc.hits = [paragraph, footer, root];
    const engine = createMarkingEngine(root as unknown as Element, { render: true });
    const shifted = engine.resolveAtPoint(20, 20, "exclude", true)!;
    expect(shifted.xpath).toBe("/main[1]/p[1]");
    engine.toggle(shifted, "exclude");

    doc.hitReadCount = 0;
    expect(engine.resolveAtPoint(20, 20, "exclude")?.xpath).toBe("/main[1]/p[1]");
    expect(doc.hitReadCount).toBe(1);
    engine.dispose();
  });

  it("shares one composed hit stack across every point-resolution candidate", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const article = new FakeElement("ARTICLE", rect(0, 0, 200, 100));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Target copy");
    const cover = new FakeElement("DIV", rect(0, 0, 200, 100));
    for (const element of [root, article, paragraph, cover]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    article.appendChild(paragraph);
    root.appendChild(article);
    doc.hits = [paragraph, article, root];
    const engine = createMarkingEngine(root as unknown as Element);
    doc.hitReadCount = 0;

    expect(engine.resolveAtPoint(20, 15, "exclude", true)?.xpath).toBe("/main[1]/article[1]/p[1]");
    expect(doc.hitReadCount).toBe(1);

    // Reachability must still use the full point stack before root filtering:
    // an unrelated painted cover outside the engine root blocks every root
    // candidate, without causing a second native hit-test per candidate.
    doc.hits = [cover, paragraph, article, root];
    doc.hitReadCount = 0;
    expect(engine.resolveAtPoint(20, 15, "exclude", true)).toBeNull();
    expect(doc.hitReadCount).toBe(1);
    engine.dispose();
  });

  it("builds an Element-backed shadow-flattened bridge view", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const shadow = new FakeElement("P", rect(0, 0, 100, 20), "Shadow copy");
    const light = new FakeElement("P", rect(0, 30, 100, 20), "Light copy");
    const chrome = new FakeElement("DIV", rect(0, 60, 100, 20), "Chrome");
    chrome.setAttribute("data-uf-extension-ui", "true");
    root.ownerDocument = doc;
    shadow.ownerDocument = doc;
    light.ownerDocument = doc;
    chrome.ownerDocument = doc;
    root.shadowRoot = { children: [shadow], childNodes: [shadow], elementsFromPoint: () => [shadow] };
    shadow.shadowHost = root;
    root.appendChild(light);
    root.appendChild(chrome);

    const view = createDomBridgeView(root as unknown as Element);

    expect([...view.byXpath.keys()]).toContain("/section[1]/p[1]");
    expect([...view.byXpath.keys()]).toContain("/section[1]/p[2]");
    expect(view.byElement.has(chrome as unknown as Element)).toBe(false);
  });

  it("does not let extension UI shift captured sibling XPath indexes", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const chrome = new FakeElement("DIV", rect(0, 0, 100, 20), "Chrome");
    const content = new FakeElement("DIV", rect(0, 30, 100, 20), "Content");
    chrome.setAttribute("data-uf-extension-ui", "true");
    root.ownerDocument = doc;
    chrome.ownerDocument = doc;
    content.ownerDocument = doc;
    root.appendChild(chrome);
    root.appendChild(content);

    const view = createDomBridgeView(root as unknown as Element);

    expect([...view.byXpath.keys()]).toContain("/section[1]/div[1]");
    expect([...view.byXpath.keys()]).not.toContain("/section[1]/div[2]");
  });

  it("does not let browser automation roots shift captured sibling XPath indexes", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const automation = new FakeElement("browser-mcp-container", rect(0, 0, 100, 20), "Automation");
    const content = new FakeElement("DIV", rect(0, 30, 100, 20), "Content");
    root.ownerDocument = doc;
    automation.ownerDocument = doc;
    content.ownerDocument = doc;
    root.appendChild(automation);
    root.appendChild(content);

    const view = createDomBridgeView(root as unknown as Element);

    expect([...view.byXpath.keys()]).toContain("/section[1]/div[1]");
    expect([...view.byXpath.keys()]).not.toContain("/section[1]/div[2]");
  });

  it("feeds hidden, aria-hidden, sr-only, and interaction-gated metadata into visibility", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const hidden = new FakeElement("P", rect(0, 0, 100, 20), "Hidden");
    const aria = new FakeElement("P", rect(0, 30, 100, 20), "Aria");
    const srOnly = new FakeElement("P", rect(0, 60, 100, 20), "Screen reader");
    const gated = new FakeElement("P", rect(0, 90, 100, 20), "Collapsed");
    hidden.hidden = true;
    aria.setAttribute("aria-hidden", "true");
    srOnly.className = "visually-hidden";
    gated.setAttribute("aria-expanded", "false");
    for (const element of [root, hidden, aria, srOnly, gated]) {
      element.ownerDocument = doc;
    }
    root.appendChild(hidden);
    root.appendChild(aria);
    root.appendChild(srOnly);
    root.appendChild(gated);

    const view = createDomBridgeView(root as unknown as Element);

    expect([...view.byXpath.values()].filter((node) => node.element !== root).map((node) => node.evaluationNode.visible))
      .toEqual([false, false, false, false]);
  });

  it("keeps accessibility-hidden prose eligible when it is actually painted", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const aria = new FakeElement("P", rect(0, 20, 100, 20), "Visible aria copy");
    const srOnly = new FakeElement("P", rect(0, 60, 100, 20), "Visible sr-only copy");
    aria.setAttribute("aria-hidden", "true");
    srOnly.className = "sr-only";
    for (const element of [root, aria, srOnly]) {
      element.ownerDocument = doc;
    }
    root.appendChild(aria);
    root.appendChild(srOnly);
    doc.pointHits = (_x, y) => y < 50 ? [aria, root] : [srOnly, root];

    const view = createDomBridgeView(root as unknown as Element);

    expect(view.byElement.get(aria as unknown as Element)?.evaluationNode.visible).toBe(true);
    expect(view.byElement.get(srOnly as unknown as Element)?.evaluationNode.visible).toBe(true);
  });

  it("keeps above-viewport document content classified when the bridge rebuilds while scrolled", () => {
    const doc = new FakeDocument();
    Object.assign(doc.defaultView, { scrollY: 600, pageYOffset: 600 });
    const root = new FakeElement("MAIN", rect(0, -600, 300, 1_200));
    const paragraph = new FakeElement("P", rect(0, -500, 120, 20), "Earlier document copy");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    root.appendChild(paragraph);

    const view = createDomBridgeView(root as unknown as Element);

    expect(view.byElement.get(paragraph as unknown as Element)?.evaluationNode.visible).toBe(true);
  });

  it("keeps silent whitespace in submission only and drops it when text arrives", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const blank = new FakeElement("SECTION", rect(0, 20, 200, 60));
    const prose = new FakeElement("P", rect(0, 100, 200, 20), "Real copy");
    for (const element of [root, blank, prose]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(blank);
    root.appendChild(prose);
    doc.hits = [blank, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const blankXpath = "/main[1]/section[1]";

    engine.renderReadOnly();
    const before = engine.buildSubmission({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
    });

    expect(before.pages[0]?.renderedXPaths).toContainEqual({
      xpath: blankXpath,
      excluded: true,
      explicit: true,
    });
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath") === blankXpath
    )).toBe(false);
    expect(engine.resolveAtPoint(10, 30, "exclude")).toBeNull();

    blank.childNodes.push({ nodeType: 3, textContent: "Loaded copy" });
    engine.refresh();

    expect(engine.rows()).not.toContainEqual({
      xpath: blankXpath,
      excluded: true,
      explicit: true,
    });
    expect(engine.rows()).toContainEqual({ xpath: blankXpath, excluded: false });
  });

  it("propagates ancestor hidden styles to descendants", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const child = new FakeElement("P", rect(0, 0, 100, 20), "Hidden by parent");
    root.style.opacity = "0";
    root.ownerDocument = doc;
    child.ownerDocument = doc;
    root.appendChild(child);

    const view = createDomBridgeView(root as unknown as Element);

    expect(view.byXpath.get("/section[1]/p[1]")?.evaluationNode.visible).toBe(false);
  });

  it("does not re-accept toggleable defaults that the domain rejects as page shells", () => {
    const doc = new FakeDocument();
    const footer = new FakeElement("FOOTER", rect(0, 0, 300, 300), "Footer shell");
    const header = new FakeElement("HEADER", rect(0, 0, 300, 50), "Header");
    const nav = new FakeElement("NAV", rect(0, 50, 300, 50), "Nav");
    footer.ownerDocument = doc;
    header.ownerDocument = doc;
    nav.ownerDocument = doc;
    footer.appendChild(header);
    footer.appendChild(nav);
    const view = createDomBridgeView(footer as unknown as Element);

    expect(view.root.structuralBoundary).toBe(false);
    expect(view.root.pageShell).toBe(true);
  });

  it("does not infer page-shell status from viewport width", () => {
    const doc = new FakeDocument();
    const section = new FakeElement("SECTION", rect(0, 0, 412, 200), "Full-width content");
    section.ownerDocument = doc;

    const view = createDomBridgeView(section as unknown as Element);

    expect(view.root.pageShell).toBe(false);
    expect(view.root.structuralBoundary).toBe(true);
  });

  it("detects nested and role landmarks as page-shell metadata", () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SECTION", rect(0, 0, 400, 400), "Wrapper");
    const inner = new FakeElement("DIV", rect(0, 0, 300, 200));
    const banner = new FakeElement("DIV", rect(0, 0, 300, 50));
    const nav = new FakeElement("DIV", rect(0, 50, 300, 50));
    banner.setAttribute("role", "banner");
    nav.setAttribute("role", "navigation");
    wrapper.ownerDocument = doc;
    inner.ownerDocument = doc;
    banner.ownerDocument = doc;
    nav.ownerDocument = doc;
    inner.appendChild(banner);
    inner.appendChild(nav);
    wrapper.appendChild(inner);

    const view = createDomBridgeView(wrapper as unknown as Element);

    expect(view.root.landmarkCount).toBe(2);
    expect(view.root.pageShell).toBe(true);
    expect(view.root.structuralBoundary).toBe(false);
  });

  it("memoizes landmark and geometry reads for one bridge pass", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 800), "Root");
    root.ownerDocument = doc;
    const elements = [root];
    let parent = root;
    for (let index = 0; index < 40; index += 1) {
      const child = new FakeElement("DIV", rect(0, index * 20, 280, 20), `Level ${index}`);
      parent.appendChild(child);
      elements.push(child);
      parent = child;
    }

    createDomBridgeView(root as unknown as Element);

    expect(elements.reduce((total, element) => total + element.rectReadCount, 0)).toBe(elements.length);
    expect(elements.reduce((total, element) => total + element.roleReadCount, 0)).toBeLessThanOrEqual(elements.length * 2);
  });

  it("ignores stripped automation landmarks when computing page-shell metadata", () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SECTION", rect(0, 0, 200, 200), "Content wrapper");
    const automation = new FakeElement("browser-mcp-container", rect(0, 0, 200, 200));
    const header = new FakeElement("HEADER", rect(0, 0, 200, 50), "Header");
    const nav = new FakeElement("NAV", rect(0, 50, 200, 50), "Nav");
    wrapper.ownerDocument = doc;
    automation.ownerDocument = doc;
    header.ownerDocument = doc;
    nav.ownerDocument = doc;
    automation.appendChild(header);
    automation.appendChild(nav);
    wrapper.appendChild(automation);

    const view = createDomBridgeView(wrapper as unknown as Element);

    expect(view.root.landmarkCount).toBe(0);
    expect(view.root.pageShell).toBe(false);
  });

  it("renders layered overlays and drives a real-element MarkingEngine facade", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const p = new FakeElement("P", rect(0, 0, 120, 20), "Content");
    root.ownerDocument = doc;
    p.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(p);
    doc.hits = [p, root];

    const engine = createMarkingEngine(root as unknown as Element);
    const target = engine.resolveAtPoint(10, 10, "exclude", true);
    expect(target?.xpath).toBe("/main[1]/p[1]");
    if (target) {
      engine.toggle(target, "exclude");
    }

    expect(engine.rows()).toEqual([{ xpath: "/main[1]/p[1]", excluded: true, explicit: true }]);
    const renderedOverlay = engine.overlayRoot().children.flatMap((layer) => layer.children)[0];
    expect(renderedOverlay).toBeDefined();
    expect(renderedOverlay?.className).toContain("uf-rect");
    expect(renderedOverlay?.className).toContain("uf-explicit-exclude");
    expect(engine.overlayRoot().style.pointerEvents).toBe("auto");
    engine.setInputTransparent(true);
    expect(engine.overlayRoot().style.pointerEvents).toBe("none");
    expect(engine.overlayRoot().className).not.toContain("uf-marking-temporarily-disabled");
    expect(renderedOverlay?.className).toContain("uf-explicit-exclude");
    engine.setPassthrough(true);
    engine.setInputTransparent(false);
    expect(engine.overlayRoot().style.pointerEvents).toBe("none");
    engine.setPassthrough(false);
    expect(engine.overlayRoot().style.pointerEvents).toBe("auto");
    engine.setPassthrough(true);
    expect(engine.overlayRoot().style.pointerEvents).toBe("none");
    expect(engine.overlayRoot().className).toContain("uf-marking-temporarily-disabled");
    engine.setPassthrough(false);
    expect(engine.overlayRoot().style.pointerEvents).toBe("auto");
    const interactionLayer = engine.overlayRoot().children.find((layer) =>
      layer.getAttribute("data-layer") === "interaction"
    );
    expect(interactionLayer?.children.length).toBeGreaterThan(0);
    engine.setPageInspectionActive(true);
    expect(engine.overlayRoot().className).toContain("uf-page-inspection-active");
    expect(engine.overlayRoot().children
      .some((layer) => layer.children.some((candidate) => candidate === renderedOverlay))).toBe(true);
    expect(interactionLayer?.children).toHaveLength(0);
    engine.setPageInspectionActive(false);
    expect(engine.overlayRoot().className).not.toContain("uf-page-inspection-active");
    expect(engine.overlayRoot().style.position).toBe("fixed");
    expect(engine.overlayRoot().getAttribute("data-uf-extension-ui")).toBe("true");
    expect(doc.documentElement.children.some((element) => element.id === MARKING_OVERLAY_STYLE_ID)).toBe(true);

    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    renderer.clear();
    expect(renderer.root.children).toHaveLength(13);
    expect(renderer.root.children.every((layer) => layer.children.length === 0)).toBe(true);
  });

  it("keeps a prewarmed renderer page-inert until an authorized presentation attaches", () => {
    const doc = new FakeDocument();
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const hasOverlayStyle = (): boolean => doc.documentElement.children.some((element) =>
      element.id === MARKING_OVERLAY_STYLE_ID
    );

    expect(renderer.root.parentElement).toBeNull();
    expect(hasOverlayStyle()).toBe(false);

    renderer.attach();
    expect(renderer.root.parentElement).toBe(doc.documentElement);
    expect(hasOverlayStyle()).toBe(true);

    renderer.detach();
    expect(renderer.root.parentElement).toBeNull();
    expect(hasOverlayStyle()).toBe(false);

    const previewTarget = new FakeElement("P", rect(10, 20, 120, 24), "Preview target");
    previewTarget.ownerDocument = doc;
    doc.hits = [previewTarget];
    renderer.setHover(previewTarget as unknown as Element, "/p[1]");
    expect(renderer.root.parentElement).toBe(doc.documentElement);
    expect(hasOverlayStyle()).toBe(true);

    renderer.detach();
    renderer.setHover(null);
    expect(renderer.root.parentElement).toBeNull();
    expect(hasOverlayStyle()).toBe(false);

    renderer.renderSilentHighlights([], new Map());
    expect(renderer.root.parentElement).toBe(doc.documentElement);
    expect(hasOverlayStyle()).toBe(true);

    renderer.dispose();
    expect(renderer.root.parentElement).toBeNull();
    expect(hasOverlayStyle()).toBe(false);
  });

  it("switches ordinary Silent by root state without reallocating retained classifications", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(10, 20, 180, 30), "Included paragraph");
    for (const element of [root, paragraph]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph, root];
    const engine = createMarkingEngine(root as unknown as Element, { render: true });
    const overlay = engine.overlayRoot() as unknown as FakeElement;
    const classificationBoxes = (): FakeElement[] => overlay.children
      .filter((layer) => !String(layer.getAttribute("data-layer") ?? "").startsWith("silent-"))
      .flatMap((layer) => layer.children)
      .filter((box) => box.getAttribute("data-uf-overlay-xpath") !== null);
    const retained = classificationBoxes();
    expect(retained).not.toHaveLength(0);

    // A non-interactive maintenance refresh may replace the evaluation model,
    // but it deliberately leaves the already-allocated classification boxes in
    // place. Silent presentation must hide them by class, not delete them.
    engine.refresh({ render: false });
    engine.renderSilentHighlights();
    expect(overlay.className).toContain("uf-silent-presentation");
    expect(classificationBoxes()).toEqual(retained);
    const createdAfterFirstSilent = doc.createElementCount;

    engine.renderSilentHighlights();
    expect(doc.createElementCount).toBe(createdAfterFirstSilent);
    expect(classificationBoxes()).toEqual(retained);

    engine.renderMarking();
    expect(overlay.className).not.toContain("uf-silent-presentation");
    expect(classificationBoxes()).toEqual(retained);
    engine.dispose();
  });

  it("prewarms and reuses hover rectangles across target changes", () => {
    const doc = new FakeDocument();
    const first = new FakeElement("P", rect(10, 20, 140, 24), "First");
    const second = new FakeElement("P", rect(30, 60, 180, 28), "Second");
    first.ownerDocument = doc;
    second.ownerDocument = doc;
    doc.pointHits = (_x, y) => y < 50 ? [first] : [second];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const hoverLayer = renderer.root.children.find((layer) =>
      layer.getAttribute("data-layer") === "hover"
    )!;
    const retained = hoverLayer.children[0]!;
    const createdAfterPrewarm = doc.createElementCount;

    expect(retained.style.display).toBe("none");
    expect(retained.getAttribute("data-uf-overlay-hover")).toBeNull();
    renderer.setHover(first as unknown as Element, "/p[1]");
    expect(hoverLayer.children).toEqual([retained]);
    expect(retained.getAttribute("data-uf-overlay-hover")).toBe("/p[1]");
    expect(retained.style.display).toBe("");
    renderer.setHover(second as unknown as Element, "/p[2]");
    expect(hoverLayer.children).toEqual([retained]);
    expect(retained.getAttribute("data-uf-overlay-hover")).toBe("/p[2]");
    expect(retained.style.left).toBe("30px");
    expect(doc.createElementCount).toBe(createdAfterPrewarm);
    renderer.setHover(null);
    expect(retained.style.display).toBe("none");
    renderer.dispose();
  });

  it("links preview rows back to the exact composed element without rebuilding the model", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "Content");
    const scrollIntoView = vi.fn();
    Object.assign(paragraph, { scrollIntoView });
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);

    const engine = createMarkingEngine(root as unknown as Element);
    const xpath = "/main[1]/p[1]";
    doc.hits = [paragraph, root];
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    const row = projection.rows.find((candidate) => candidate.xpath === xpath);

    expect(engine.emphasizeXpath(xpath)).toBe(true);
    expect(engine.previewRowAtPoint(10, 10)).toEqual({
      projectionId: projection.projectionId,
      rowId: row?.id,
    });
    expect(engine.scrollXpathIntoView(xpath)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    expect(engine.emphasizeXpath("/main[1]/missing[1]")).toBe(false);
    expect(engine.scrollXpathIntoView("/main[1]/missing[1]")).toBe(false);
    engine.dispose();
  });

  it("defers full-document preview text work until the first projection", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const control = new FakeElement("DIV", rect(0, 0, 120, 20));
    control.setAttribute("placeholder", "Search jobs");
    root.ownerDocument = doc;
    control.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(control);

    const engine = createMarkingEngine(root as unknown as Element);

    expect(control.attributeReadCount.get("placeholder") ?? 0).toBe(0);
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["div"],
      exclusionSelectors: [],
    });
    expect(control.attributeReadCount.get("placeholder") ?? 0).toBeGreaterThan(0);
    expect(projection.rows.find((row) => row.xpath === "/main[1]/div[1]")?.text).toBe("Search jobs");
    engine.dispose();
  });

  it("routes a replaced visible element through its retained silent rectangle", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const original = new FakeElement("P", rect(0, 0, 120, 20), "Content");
    root.ownerDocument = doc;
    original.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(original);
    doc.hits = [original, root];

    const engine = createMarkingEngine(root as unknown as Element);
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    engine.renderSilentHighlights();
    const row = projection.rows.find((candidate) => candidate.xpath === "/main[1]/p[1]");
    const replacement = new FakeElement("P", rect(0, 0, 120, 20), "Content");
    replacement.ownerDocument = doc;
    original.remove();
    root.appendChild(replacement);
    doc.hits = [replacement, root];

    expect(engine.previewRowAtPoint(10, 10)).toEqual({
      projectionId: projection.projectionId,
      rowId: row?.id,
    });
    engine.dispose();
  });

  it("routes a replaced painted leaf before its surviving broad owner", () => {
    const doc = new FakeDocument();
    const footer = new FakeElement("FOOTER", rect(0, 0, 300, 200), "Contact footer");
    const original = new FakeElement("IMG", rect(20, 40, 80, 30));
    original.setAttribute("alt", "Kontakta oss");
    footer.ownerDocument = doc;
    original.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(footer);
    footer.appendChild(original);
    doc.pointHits = () => [original, footer];

    const selectors = {
      inclusionSelectors: ["footer"],
      exclusionSelectors: ["img"],
    };
    const engine = createMarkingEngine(footer as unknown as Element, { selectors, render: true });
    const projection = engine.projectPreview("https://example.com/page", selectors);
    const imageXpath = "/footer[1]/img[1]";
    const imageRow = projection.rows.find((candidate) => candidate.xpath === imageXpath);
    expect(imageRow).toBeDefined();
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).map((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath")
    )).toContain(imageXpath);

    const replacement = new FakeElement("IMG", rect(20, 40, 80, 30));
    replacement.setAttribute("alt", "Kontakta oss");
    replacement.ownerDocument = doc;
    original.remove();
    footer.appendChild(replacement);
    doc.pointHits = () => [replacement, footer];

    expect(engine.previewRowAtPoint(60, 55)).toEqual({
      projectionId: projection.projectionId,
      rowId: imageRow?.id,
    });
    engine.dispose();
  });

  it("ranks only projection-owned retained rectangles for Preview clicks", () => {
    const doc = new FakeDocument();
    const header = new FakeElement("HEADER", rect(0, 0, 300, 100), "Header navigation");
    const logo = new FakeElement("IMG", rect(16, 50, 139, 25));
    header.ownerDocument = doc;
    logo.ownerDocument = doc;
    header.appendChild(logo);
    doc.pointHits = () => [logo, header];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const headerXpath = "/header[1]";
    const logoXpath = "/header[1]/img[1]";

    renderer.render({
      rows: [
        { xpath: headerXpath, excluded: true, explicit: true },
        { xpath: logoXpath, excluded: true, explicit: true },
      ],
      overlay: new Map([
        [headerXpath, "exception"],
        [logoXpath, "immutable"],
      ]),
    }, new Map([
      [headerXpath, { element: header as unknown as Element, visible: true }],
      [logoXpath, { element: logo as unknown as Element, visible: true }],
    ]));

    expect(renderer.previewXpathAtPoint(
      85.5,
      66,
      new Set([headerXpath, logoXpath]),
    )).toBe(logoXpath);
    expect(renderer.previewXpathAtPoint(
      85.5,
      66,
      new Set([headerXpath]),
    )).toBe(headerXpath);
    renderer.dispose();
  });

  it("scrolls before focus paint and refreshes that exact Preview target on captured frames", () => {
    const doc = new FakeDocument();
    const animationFrames: Array<() => void> = [];
    Object.assign(doc.defaultView, {
      requestAnimationFrame(callback: () => void) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 900));
    const target = new FakeElement("P", rect(0, 640, 120, 20), "Preview target");
    const order: string[] = [];
    Object.assign(target, { scrollIntoView: () => order.push("scroll") });
    for (const element of [root, target]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    doc.hits = [target, root];
    const renderer = createRendererTestSeam();
    renderer.focusRender.mockImplementation(() => order.push("focus"));
    renderer.focusRefresh.mockImplementation(() => order.push("refresh"));
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createRenderer: renderer.createRenderer },
    });
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    const row = projection.rows.find((candidate) => candidate.text === "Preview target");

    expect(engine.emphasizePreviewRow(projection.projectionId, row!.id, true)).toBe(true);
    order.splice(0);
    expect(engine.activatePreviewRow(projection.projectionId, row!.id)).toBe(true);
    expect(order).toEqual(["scroll"]);
    expect(animationFrames).toHaveLength(1);
    animationFrames.shift()?.();
    expect(order).toEqual(["scroll", "focus", "refresh"]);
    expect(animationFrames).toHaveLength(1);
    animationFrames.shift()?.();
    expect(renderer.focusRefresh).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it("keeps Preview focus tracking across a scroll-driven bridge generation", () => {
    const doc = new FakeDocument();
    const animationFrames: Array<() => void> = [];
    Object.assign(doc.defaultView, {
      requestAnimationFrame(callback: () => void) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 900));
    const target = new FakeElement("P", rect(0, 640, 120, 20), "Stable Preview target");
    Object.assign(target, { scrollIntoView: vi.fn() });
    for (const element of [root, target]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    doc.hits = [target, root];
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createRenderer: renderer.createRenderer },
    });
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    const row = projection.rows.find((candidate) => candidate.text === "Stable Preview target");

    expect(engine.emphasizePreviewRow(projection.projectionId, row!.id, true)).toBe(true);
    expect(engine.activatePreviewRow(projection.projectionId, row!.id)).toBe(true);
    animationFrames.shift()?.();
    expect(renderer.focusRefresh).toHaveBeenCalledTimes(1);

    // Sticky-header/lazy-content mutations during native smooth scrolling can
    // refresh the immutable bridge without replacing this row's Element key.
    engine.refresh();
    animationFrames.shift()?.();
    expect(renderer.focusRefresh).toHaveBeenCalledTimes(2);
    engine.dispose();
  });

  it("omits clipped and overflow-clipped technical rows from Preview", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const clipped = new FakeElement("A", rect(0, 0, 20, 10), "Skip to footer");
    const viewport = new FakeElement("DIV", rect(0, 20, 120, 30));
    const overflowClipped = new FakeElement("SPAN", rect(0, 90, 80, 20), "Screen-reader status");
    // Common screen-reader-only CSS uses equal non-zero edges. Its nominal
    // layout box is still measurable, but the legacy clip has no paint area.
    clipped.style.clip = "rect(1px, 1px, 1px, 1px)";
    viewport.style.overflow = "hidden";
    for (const element of [root, clipped, viewport, overflowClipped]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(clipped);
    root.appendChild(viewport);
    viewport.appendChild(overflowClipped);

    expect(isCurrentlyVisuallyVisible(clipped as unknown as Element)).toBe(false);
    expect(isCurrentlyVisuallyVisible(overflowClipped as unknown as Element)).toBe(false);
    const engine = createMarkingEngine(root as unknown as Element);
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: ["a", "span"],
    });
    expect(projection.rows.some((row) => row.text === "Skip to footer")).toBe(false);
    expect(projection.rows.some((row) => row.text === "Screen-reader status")).toBe(false);
    engine.dispose();
  });

  it("omits an in-viewport covered row from Preview", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(10, 20, 160, 24), "Covered target");
    const cover = new FakeElement("DIV", rect(0, 0, 300, 80), "Cover");
    for (const element of [root, target, cover]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    root.appendChild(cover);
    doc.hits = [cover, root];

    const engine = createMarkingEngine(root as unknown as Element);
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    expect(projection.rows.some((candidate) => candidate.text === "Covered target")).toBe(false);
    engine.dispose();
  });

  it("projects Content List through Silent annotations and restores the marking surface on exit", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(10, 20, 180, 30), "Included paragraph");
    const footer = new FakeElement("FOOTER", rect(0, 200, 300, 80), "Excluded footer");
    for (const element of [root, paragraph, footer]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    root.appendChild(footer);
    doc.pointHits = (_x, y) => y < 100 ? [paragraph, root] : [footer, root];
    const engine = createMarkingEngine(root as unknown as Element, { render: true });

    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: ["footer"],
    });
    const included = projection.rows.find((row) => row.text === "Included paragraph")!;
    const overlay = engine.overlayRoot() as unknown as FakeElement;
    const layer = (name: string) => overlay.children.find((child) =>
      child.getAttribute("data-layer") === name
    );

    expect(overlay.className).toContain("uf-preview-presentation");
    expect(overlay.className).not.toContain("uf-silent-presentation");
    expect(layer("silent-content")?.children.length).toBeGreaterThan(0);
    expect(layer("silent-excluded")?.children.length).toBeGreaterThan(0);
    expect(engine.previewRowAtPoint(20, 30)).toEqual({
      projectionId: projection.projectionId,
      rowId: included.id,
    });
    expect([
      "default",
      "saved-explicit-exclude",
      "saved-explicit-include",
      "session-explicit-exclude",
      "session-explicit-include",
    ].some((name) => (layer(name)?.children.length ?? 0) > 0)).toBe(true);

    engine.retirePreviewProjection();

    expect(overlay.className).not.toContain("uf-preview-presentation");
    expect(overlay.className).not.toContain("uf-silent-presentation");
    expect(layer("silent-content")?.children).toHaveLength(0);
    expect(layer("silent-excluded")?.children).toHaveLength(0);
    expect([
      "default",
      "saved-explicit-exclude",
      "saved-explicit-include",
      "session-explicit-exclude",
      "session-explicit-include",
    ].some((name) => (layer(name)?.children.length ?? 0) > 0)).toBe(true);
    engine.dispose();
  });

  it("keeps ordinary Silent distinct from retained Marking and restores each origin exactly", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(10, 20, 180, 30), "Included paragraph");
    const footer = new FakeElement("FOOTER", rect(0, 200, 300, 80), "Excluded footer");
    for (const element of [root, paragraph, footer]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    root.appendChild(footer);
    doc.pointHits = (_x, y) => y < 100 ? [paragraph, root] : [footer, root];
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createRenderer: renderer.createRenderer },
    });
    const overlay = engine.overlayRoot() as unknown as FakeElement;

    engine.renderSilentHighlights();
    expect(overlay.className).toContain("uf-silent-presentation");
    expect(overlay.className).not.toContain("uf-preview-presentation");
    expect(renderer.markingRender).not.toHaveBeenCalled();

    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: ["footer"],
    });
    expect(projection.rows).not.toHaveLength(0);
    expect(overlay.className).toContain("uf-silent-presentation");
    expect(overlay.className).toContain("uf-preview-presentation");

    engine.retirePreviewProjection();
    expect(overlay.className).toContain("uf-silent-presentation");
    expect(overlay.className).not.toContain("uf-preview-presentation");

    engine.renderMarking();
    expect(overlay.className).not.toContain("uf-silent-presentation");
    expect(renderer.markingRender).toHaveBeenCalledOnce();

    // Silent highlights intentionally armed over an interactive/read-only
    // comparison do not suppress its classification presentation.
    engine.renderSilentHighlights();
    expect(overlay.className).not.toContain("uf-silent-presentation");
    engine.renderReadOnly();
    expect(overlay.className).not.toContain("uf-silent-presentation");
    engine.dispose();
  });

  it("keeps preview row identity and exact targeting when a same-tag sibling shifts XPath", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 20, 120, 20), "Original target");
    const scrollIntoView = vi.fn();
    Object.assign(target, { scrollIntoView });
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    const engine = createMarkingEngine(root as unknown as Element);
    const selectors = { inclusionSelectors: ["p"], exclusionSelectors: [] };
    const before = engine.projectPreview("https://example.com/page", selectors);
    const original = before.rows.find((row) => row.text === "Original target");
    expect(original).toMatchObject({ xpath: "/main[1]/p[1]", classification: "explicit-included" });

    const decoy = new FakeElement("P", rect(0, 0, 120, 20), "Prepended decoy");
    decoy.ownerDocument = doc;
    decoy.parentElement = root;
    root.children.unshift(decoy);
    root.childNodes.unshift(decoy);
    engine.refresh();

    // The stored projection is rebased during refresh, so the old opaque target
    // remains valid before the popup asks for the newer row snapshot.
    expect(engine.emphasizePreviewRow(before.projectionId, original!.id, true)).toBe(true);
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-focus") === "/main[1]/p[2]" &&
      overlay.className === "uf-rect uf-focus"
    )).toBe(true);
    expect(engine.activatePreviewRow(before.projectionId, original!.id)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(engine.emphasizePreviewRow("stale-projection", original!.id, true)).toBe(false);
    expect(engine.activatePreviewRow(before.projectionId, "missing-row")).toBe(false);

    const after = engine.projectPreview("https://example.com/page", selectors);
    const rebased = after.rows.find((row) => row.text === "Original target");
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(rebased).toMatchObject({
      id: original!.id,
      xpath: "/main[1]/p[2]",
      classification: "explicit-included",
    });
  });

  it("rebases a dirty mutable decision by Element identity instead of transferring it to a same-XPath decoy", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 20, 120, 20), "Marked target");
    for (const element of [root, target]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    doc.hits = [target, root];
    const engine = createMarkingEngine(root as unknown as Element, { render: true });

    const resolved = engine.resolveAtPoint(20, 25, "exclude", false);
    expect(resolved?.xpath).toBe("/main[1]/p[1]");
    expect(engine.toggle(resolved!, "exclude")).toBe(true);

    const decoy = new FakeElement("P", rect(0, 0, 120, 20), "Prepended decoy");
    decoy.ownerDocument = doc;
    decoy.parentElement = root;
    root.children.unshift(decoy);
    root.childNodes.unshift(decoy);
    doc.hits = [target, root];
    engine.refresh({ render: true });

    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[2]",
      excluded: true,
      explicit: true,
    });
    expect(engine.rows()).not.toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: [],
    });
    expect(projection.rows.find((row) => row.text === "Marked target")).toMatchObject({
      xpath: "/main[1]/p[2]",
      classification: "excluded",
    });
    expect(projection.rows.some((row) => row.text === "Prepended decoy")).toBe(false);
    engine.dispose();
  });

  it("reapplies silent selector authority after structural mutation without inheriting positional marks", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const original = new FakeElement("P", rect(0, 20, 120, 20), "Original match");
    for (const element of [root, original]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(original);
    const selectors = { inclusionSelectors: ["p"], exclusionSelectors: [] };
    const engine = createMarkingEngine(root as unknown as Element, { selectors });
    engine.renderSilentHighlights();

    const newcomer = new FakeElement("P", rect(0, 0, 120, 20), "New selector match");
    newcomer.ownerDocument = doc;
    newcomer.parentElement = root;
    root.children.unshift(newcomer);
    root.childNodes.unshift(newcomer);
    engine.refresh();

    expect(engine.rows()).toEqual(expect.arrayContaining([
      { xpath: "/main[1]/p[1]", excluded: false, explicit: true },
      { xpath: "/main[1]/p[2]", excluded: false, explicit: true },
    ]));
    const projection = engine.projectPreview("https://example.com/page", selectors);
    expect(projection.rows.filter((row) => row.classification === "explicit-included")).toHaveLength(2);
    engine.dispose();
  });

  it("projects a saved silent broad exclusion as one shallow owner after structural refresh", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 412, 800));
    const broad = new FakeElement("SECTION", rect(0, 70, 397, 600), "Patient guide");
    const heading = new FakeElement("H1", rect(24, 100, 360, 80), "Patient guide heading");
    const paragraph = new FakeElement("P", rect(24, 200, 360, 80), "Covered copy");
    broad.className = "saved-broad-exclusion";
    for (const element of [root, broad, heading, paragraph]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    broad.appendChild(heading);
    broad.appendChild(paragraph);
    root.appendChild(broad);
    const selectors = {
      inclusionSelectors: [],
      exclusionSelectors: [".saved-broad-exclusion"],
    };
    const engine = createMarkingEngine(root as unknown as Element, { selectors });
    engine.renderSilentHighlights();
    const broadXpath = "/main[1]/section[1]";
    const branchRows = (projection: ReturnType<typeof engine.projectPreview>) =>
      projection.rows.filter((row) =>
        row.xpath === broadXpath || row.xpath.startsWith(`${broadXpath}/`)
      );

    const before = engine.projectPreview("https://www.aleris.se/page", selectors);
    expect(branchRows(before)).toEqual([
      expect.objectContaining({
        xpath: broadXpath,
        classification: "excluded",
        selector: ".saved-broad-exclusion",
      }),
    ]);

    const lateHeading = new FakeElement("H2", rect(24, 300, 360, 60), "Late covered heading");
    lateHeading.ownerDocument = doc;
    broad.appendChild(lateHeading);
    engine.refresh();
    const after = engine.projectPreview("https://www.aleris.se/page", selectors);

    expect(after.revision).toBeGreaterThan(before.revision);
    expect(branchRows(after)).toEqual([
      expect.objectContaining({
        xpath: broadXpath,
        classification: "excluded",
        selector: ".saved-broad-exclusion",
      }),
    ]);
    engine.dispose();
  });

  it("keeps selector seeding one-shot inside an active clean marking session", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const original = new FakeElement("P", rect(0, 20, 120, 20), "Seeded at activation");
    for (const element of [root, original]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(original);
    const selectors = { inclusionSelectors: ["p"], exclusionSelectors: [] };
    const engine = createMarkingEngine(root as unknown as Element, {
      render: true,
      selectors,
    });

    const newcomer = new FakeElement("P", rect(0, 0, 120, 20), "Added during marking");
    newcomer.ownerDocument = doc;
    newcomer.parentElement = root;
    root.children.unshift(newcomer);
    root.childNodes.unshift(newcomer);
    engine.refresh({ render: true });

    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[2]",
      excluded: false,
      explicit: true,
    });
    expect(engine.rows()).not.toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: false,
      explicit: true,
    });
    const projection = engine.projectPreview("https://example.com/page", selectors);
    expect(projection.rows.find((row) => row.text === "Seeded at activation")).toMatchObject({
      xpath: "/main[1]/p[2]",
      classification: "explicit-included",
    });
    expect(projection.rows.find((row) => row.text === "Added during marking")).toMatchObject({
      xpath: "/main[1]/p[1]",
      classification: "undetected",
    });
    engine.dispose();
  });

  it("falls back to the root scroller when a storefront ignores scrollIntoView", () => {
    const doc = new FakeDocument();
    const animationFrames: Array<() => void> = [];
    Object.assign(doc.defaultView, {
      requestAnimationFrame(callback: () => void) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      cancelAnimationFrame() {},
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 900));
    const target = new FakeElement("P", rect(0, 640, 120, 20), "Offscreen target");
    const scrollIntoView = vi.fn();
    Object.assign(target, { scrollIntoView });
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.scrollTop = 20;
    Object.assign(doc.defaultView, { innerHeight: 300 });
    doc.documentElement.appendChild(root);
    root.appendChild(target);

    const engine = createMarkingEngine(root as unknown as Element);
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    const row = projection.rows.find((candidate) => candidate.text === "Offscreen target");

    expect(engine.activatePreviewRow(projection.projectionId, row!.id)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    expect(doc.documentElement.scrollTop).toBe(20);
    animationFrames.shift()?.();
    expect(doc.documentElement.scrollTop).toBe(520);
  });

  it("omits an off-document technical row from Preview", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, -200, 300, 900));
    const hiddenMenuTarget = new FakeElement("P", rect(100, -320, 25, 24), "Off-canvas item");
    const scrollIntoView = vi.fn();
    Object.assign(hiddenMenuTarget, { scrollIntoView });
    root.ownerDocument = doc;
    hiddenMenuTarget.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.scrollTop = 200;
    doc.documentElement.appendChild(root);
    root.appendChild(hiddenMenuTarget);

    const engine = createMarkingEngine(root as unknown as Element);
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: ["p"],
    });
    expect(projection.rows.some((candidate) => candidate.text === "Off-canvas item")).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("omits a zero-box technical row from Preview", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 900));
    const footer = new FakeElement("FOOTER", rect(0, 640, 300, 20), "Footer landmark");
    const scrollIntoView = vi.fn();
    Object.assign(footer, { scrollIntoView });
    root.ownerDocument = doc;
    footer.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(footer);

    const engine = createMarkingEngine(root as unknown as Element);
    // Model the live DPJ footer: it was renderable when the bridge generation
    // was captured, then collapsed to a zero-height box before Preview opened.
    footer.clientRects = [];
    Object.assign(footer.rect, { height: 0, bottom: 640 });
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: ["footer"],
    });
    expect(projection.rows.some((candidate) => candidate.text === "Footer landmark")).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("advances one projection revision when only the preview selector set changes", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 20, 120, 20), "Selector target");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    const engine = createMarkingEngine(root as unknown as Element);

    const included = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    const excluded = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: ["p"],
    });

    expect(excluded.projectionId).toBe(included.projectionId);
    expect(excluded.revision).toBe(included.revision + 1);
    expect(included.rows).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        classification: "explicit-included",
        selector: "p",
      }),
    ]);
    expect(excluded.rows).toEqual([
      expect.objectContaining({
        id: included.rows[0]?.id,
        classification: "excluded",
        selector: "p",
      }),
    ]);
  });

  it("rotates projection authority between preview occurrences while preserving element row identity", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 20, 120, 20), "Same element");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    const engine = createMarkingEngine(root as unknown as Element);
    const selectors = { inclusionSelectors: ["p"], exclusionSelectors: [] };

    const cycleOne = engine.projectPreview("https://example.com/page", selectors);
    const rowId = cycleOne.rows[0]!.id;
    expect(engine.emphasizePreviewRow(cycleOne.projectionId, rowId, true)).toBe(true);

    engine.retirePreviewProjection();
    expect(engine.currentPreviewProjection()).toBeNull();

    const cycleTwo = engine.projectPreview("https://example.com/page", selectors);
    expect(cycleTwo.projectionId).not.toBe(cycleOne.projectionId);
    expect(cycleTwo.rows[0]?.id).toBe(rowId);
    expect(engine.emphasizePreviewRow(cycleOne.projectionId, rowId, true)).toBe(false);
    expect(engine.activatePreviewRow(cycleOne.projectionId, rowId)).toBe(false);
    expect(engine.emphasizePreviewRow(cycleTwo.projectionId, rowId, true)).toBe(true);
    expect(engine.activatePreviewRow(cycleTwo.projectionId, rowId)).toBe(true);
  });

  it("keeps retained Preview projection paint-idle until a material bridge refresh", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 20, 120, 20), "Stable target");
    for (const element of [root, target]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createRenderer: renderer.createRenderer },
    });
    const selectors = { inclusionSelectors: ["p"], exclusionSelectors: [] };

    const initial = engine.projectPreview("https://example.com/page", selectors);
    const geometryReadsAfterInitial = target.rectReadCount + target.clientRectReadCount;
    expect(renderer.silentRender).toHaveBeenCalledTimes(1);

    const retained = engine.projectPreview("https://example.com/page", selectors);
    expect(retained).toBe(initial);
    expect(renderer.silentRender).toHaveBeenCalledTimes(1);
    expect(target.rectReadCount + target.clientRectReadCount).toBe(geometryReadsAfterInitial);

    const inserted = new FakeElement("P", rect(0, 50, 120, 20), "Inserted target");
    inserted.ownerDocument = doc;
    root.appendChild(inserted);
    engine.refresh();
    const refreshed = engine.currentPreviewProjection();
    expect(refreshed?.revision).toBeGreaterThan(initial.revision);
    expect(refreshed?.rows.some((row) => row.text === "Inserted target")).toBe(true);
    expect(renderer.silentRender).toHaveBeenCalledTimes(2);

    expect(engine.projectPreview("https://example.com/page", selectors)).toBe(refreshed);
    expect(renderer.silentRender).toHaveBeenCalledTimes(2);

    doc.hits = [target, root];
    const mutable = engine.resolveAtPoint(10, 25, "exclude");
    expect(mutable?.xpath).toBe("/main[1]/p[1]");
    expect(engine.toggle(mutable!, "exclude")).toBe(true);
    expect(engine.currentPreviewProjection()).toBeNull();
    const changed = engine.projectPreview("https://example.com/page", selectors);
    expect(changed.revision).toBeGreaterThan(refreshed!.revision);
    expect(renderer.silentRender).toHaveBeenCalledTimes(3);
    expect(engine.projectPreview("https://example.com/page", selectors)).toBe(changed);
    expect(renderer.silentRender).toHaveBeenCalledTimes(3);
    engine.dispose();
  });

  it("rebinds active preview hover after XPath rebase and forgets it when the row disappears", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 20, 120, 20), "Hovered target");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createRenderer: renderer.createRenderer },
    });
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["p"],
      exclusionSelectors: [],
    });
    const rowId = projection.rows[0]!.id;
    expect(engine.emphasizePreviewRow(projection.projectionId, rowId, true)).toBe(true);
    renderer.focusRender.mockClear();

    const decoy = new FakeElement("P", rect(0, 0, 120, 20), "Prepended decoy");
    decoy.ownerDocument = doc;
    decoy.parentElement = root;
    root.children.unshift(decoy);
    root.childNodes.unshift(decoy);
    engine.refresh();

    expect(renderer.focusRender).toHaveBeenLastCalledWith(
      target as unknown as Element,
      "/main[1]/p[2]",
    );

    renderer.focusRender.mockClear();
    target.remove();
    engine.refresh();
    expect(renderer.focusRender).toHaveBeenLastCalledWith(null);
    expect(engine.emphasizePreviewRow(projection.projectionId, rowId, true)).toBe(false);

    // Reappearance alone must not resurrect an emphasis whose identity was
    // cleared when the row disappeared.
    renderer.focusRender.mockClear();
    root.appendChild(target);
    engine.refresh();
    expect(renderer.focusRender).not.toHaveBeenCalled();
  });

  it("clears active preview hover when selector-only reprojection removes the row", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 20, 120, 20), "Inherited target");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createRenderer: renderer.createRenderer },
    });
    const included = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["main"],
      exclusionSelectors: [],
    });
    const inherited = included.rows.find((row) => row.classification === "implicit-included")!;
    expect(engine.emphasizePreviewRow(included.projectionId, inherited.id, true)).toBe(true);
    renderer.focusRender.mockClear();

    const excluded = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: ["main"],
    });
    expect(excluded.projectionId).toBe(included.projectionId);
    expect(excluded.rows.some((row) => row.id === inherited.id)).toBe(false);
    expect(renderer.focusRender).toHaveBeenLastCalledWith(null);

    renderer.focusRender.mockClear();
    engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["main"],
      exclusionSelectors: [],
    });
    expect(renderer.focusRender).not.toHaveBeenCalled();
  });

  it("distinguishes force-open and inaccessible closed-shadow provenance without dropping light children", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const forceOpen = new FakeElement("X-CARD", rect(0, 0, 200, 80));
    forceOpen.className = "force-open";
    forceOpen.setAttribute("data-uf-closed-shadow-host", "true");
    const shadowText = new FakeElement("P", rect(0, 0, 160, 20), "Shadow text");
    shadowText.shadowHost = forceOpen;
    forceOpen.shadowRoot = { children: [shadowText], childNodes: [shadowText], elementsFromPoint: () => [] };
    const inaccessible = new FakeElement("X-PRIVATE", rect(0, 100, 200, 80));
    inaccessible.setAttribute("data-uf-closed-shadow-host", "true");
    const lightText = new FakeElement("P", rect(0, 100, 160, 20), "Accessible light text");
    for (const element of [root, forceOpen, shadowText, inaccessible, lightText]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(forceOpen);
    root.appendChild(inaccessible);
    inaccessible.appendChild(lightText);

    const engine = createMarkingEngine(root as unknown as Element);
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [".force-open"],
      exclusionSelectors: [],
    });
    const byText = new Map(projection.rows.map((row) => [row.text, row]));

    expect(byText.get("Shadow text")).toMatchObject({
      classification: "implicit-included",
      selector: ".force-open",
      shadow: "force-open-closed",
    });
    expect(projection.rows.find((row) => row.xpath === "/main[1]/x-card[1]")).toMatchObject({
      classification: "explicit-included",
      shadow: "force-open-closed",
    });
    expect(projection.rows.find((row) => row.xpath === "/main[1]/x-private[1]")).toMatchObject({
      classification: "closed-shadow",
      shadow: "inaccessible-closed",
    });
    expect(byText.get("Accessible light text")).toMatchObject({
      classification: "undetected",
      shadow: "light",
    });
  });

  it("extracts bounded readable text while excluding hostile and extension-owned descendants", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("ARTICLE", rect(0, 0, 300, 300), " Safe\tcopy\u0000 ");
    const script = new FakeElement("SCRIPT", rect(0, 0, 0, 0), "alert('hostile')");
    const hidden = new FakeElement("SPAN", rect(0, 0, 10, 10), "Hidden copy");
    hidden.setAttribute("hidden", "");
    const ariaHidden = new FakeElement("SPAN", rect(0, 0, 10, 10), "ARIA hidden copy");
    ariaHidden.setAttribute("aria-hidden", "true");
    const extension = new FakeElement("ASIDE", rect(0, 0, 10, 10), "Extension diagnostic");
    extension.setAttribute("data-uf-extension-ui", "true");
    for (const element of [root, script, hidden, ariaHidden, extension]) {
      element.ownerDocument = doc;
    }
    root.appendChild(script);
    root.appendChild(hidden);
    root.appendChild(ariaHidden);
    root.appendChild(extension);

    expect(previewTextForElement(root as unknown as Element)).toBe("Safe copy");

    const image = new FakeElement("IMG", rect(0, 0, 10, 10));
    image.setAttribute("aria-label", "Accessible image");
    image.setAttribute("alt", "Fallback alt");
    expect(previewTextForElement(image as unknown as Element)).toBe("Accessible image");

    const search = new FakeElement("INPUT", rect(0, 0, 160, 32));
    search.setAttribute("placeholder", "Search the catalogue");
    expect(previewTextForElement(search as unknown as Element)).toBe("Search the catalogue");

    search.setAttribute("aria-label", "Product search");
    search.setAttribute("value", "private operator input");
    expect(previewTextForElement(search as unknown as Element)).toBe("Product search");

    const unicode = new FakeElement("P", rect(0, 0, 10, 10), "😀".repeat(90));
    const bounded = previewTextForElement(unicode as unknown as Element);
    expect(Array.from(bounded)).toHaveLength(80);
    expect(bounded).toBe(`${"😀".repeat(77)}...`);
  });

  it("builds deeply nested preview labels in one bounded generation pass", () => {
    const doc = new FakeDocument();
    const depth = 3_000;
    const elements = Array.from({ length: depth }, (_, index) =>
      new FakeElement(index === depth - 1 ? "P" : "DIV", rect(0, 0, 100, 20),
        index === depth - 1 ? "Deep copy" : "")
    );
    for (const element of elements) element.ownerDocument = doc;
    for (let index = 1; index < elements.length; index += 1) {
      elements[index - 1]!.appendChild(elements[index]!);
    }
    let descendantReads = 0;
    let innerTextReads = 0;
    let selectorScans = 0;
    let closestScans = 0;
    for (const element of elements) {
      const childNodes = element.childNodes;
      Object.defineProperty(element, "childNodes", {
        configurable: true,
        get() { descendantReads += 1; return childNodes; },
      });
      Object.defineProperty(element, "innerText", {
        configurable: true,
        get() { innerTextReads += 1; return "layout traversal must not run"; },
      });
      (element as unknown as { querySelectorAll: () => Element[] }).querySelectorAll = () => {
        selectorScans += 1;
        return [];
      };
      element.closest = () => {
        closestScans += 1;
        return null;
      };
    }

    const metadata = buildPreviewTextMetadata(elements[0] as unknown as Element);

    expect(metadata.get(elements[0] as unknown as Element)?.text).toBe("Deep copy");
    expect(metadata.get(elements.at(-1) as unknown as Element)?.text).toBe("Deep copy");
    expect(descendantReads).toBeLessThanOrEqual(depth);
    expect(innerTextReads).toBe(0);
    expect(selectorScans).toBe(0);
    expect(closestScans).toBe(0);
  });

  it("gives an unlabeled visual target the nearest semantic control label", () => {
    const doc = new FakeDocument();
    const link = new FakeElement("A", rect(0, 0, 180, 40));
    const iconWrapper = new FakeElement("DIV", rect(0, 0, 24, 24));
    const svg = new FakeElement("SVG", rect(0, 0, 24, 24));
    const label = new FakeElement("SPAN", rect(30, 0, 120, 24), "Kontakta oss");
    for (const element of [link, iconWrapper, svg, label]) element.ownerDocument = doc;
    iconWrapper.appendChild(svg);
    link.appendChild(iconWrapper);
    link.appendChild(label);

    const metadata = buildPreviewTextMetadata(link as unknown as Element);

    expect(metadata.get(svg as unknown as Element)?.text).toBe("Kontakta oss");
    expect(metadata.get(link as unknown as Element)?.text).toBe("Kontakta oss");
  });

  it("labels an unlabeled wrapper from its sole semantic link destination", () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SPAN", rect(0, 0, 47, 47));
    const link = new FakeElement("A", rect(0, 0, 47, 47));
    const icon = new FakeElement("I", rect(12, 12, 23, 23));
    link.setAttribute("href", "/sparade-aktiviteter/");
    for (const element of [wrapper, link, icon]) element.ownerDocument = doc;
    link.appendChild(icon);
    wrapper.appendChild(link);

    const metadata = buildPreviewTextMetadata(wrapper as unknown as Element);

    expect(metadata.get(link as unknown as Element)?.text).toBe("sparade aktiviteter");
    expect(metadata.get(wrapper as unknown as Element)?.text).toBe("sparade aktiviteter");
  });

  it("treats non-string DOM id properties as ordinary content", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const svg = new FakeElement("SVG", rect(0, 0, 100, 100), "Chart label");
    root.ownerDocument = doc;
    svg.ownerDocument = doc;
    (svg as unknown as { id: unknown }).id = { baseVal: "chart" };
    root.appendChild(svg);

    expect(() => createDomBridgeView(root as unknown as Element)).not.toThrow();
    expect(() => previewTextForElement(root as unknown as Element)).not.toThrow();
    expect(captureFlattenedHtml(root as unknown as Element)).toContain("Chart label");
  });

  it("keeps a collapsed wrapper XPath while drawing its visible descendant geometry", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const wrapper = new FakeElement("SECTION", rect(0, 0, 0, 0));
    const paragraph = new FakeElement("P", rect(20, 40, 180, 30), "Visible descendant");
    for (const element of [root, wrapper, paragraph]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    wrapper.appendChild(paragraph);
    root.appendChild(wrapper);
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });

    renderer.render({
      rows: [{ xpath: "/main[1]/section[1]", excluded: false, explicit: true }],
      overlay: new Map([["/main[1]/section[1]", "explicit-include"]]),
    }, new Map([["/main[1]/section[1]", {
      element: wrapper as unknown as Element,
      visible: true,
    }]]));

    const box = renderer.root.children.flatMap((layer) => layer.children).find((candidate) =>
      candidate.getAttribute("data-uf-overlay-xpath") === "/main[1]/section[1]"
    );
    expect(box).toBeDefined();
    expect(box?.style.left).toBe("20px");
    expect(box?.style.top).toBe("40px");
    expect(box?.getAttribute("data-uf-overlay-xpath")).toBe("/main[1]/section[1]");
    renderer.dispose();
  });

  it("retains a collapsed exclusion owner without borrowing visible descendant geometry", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const wrapper = new FakeElement("SECTION", rect(0, 0, 0, 0));
    const paragraph = new FakeElement("P", rect(20, 40, 180, 30), "Visible descendant");
    for (const element of [root, wrapper, paragraph]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    wrapper.appendChild(paragraph);
    root.appendChild(wrapper);
    doc.hits = [paragraph, root];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/main[1]/section[1]";

    renderer.render({
      rows: [{ xpath, excluded: true, explicit: true }],
      overlay: new Map([[xpath, "exception"]]),
    }, new Map([[xpath, {
      element: wrapper as unknown as Element,
      visible: true,
    }]]));

    expect(renderer.root.children.flatMap((layer) => layer.children).some((candidate) =>
      candidate.getAttribute("data-uf-overlay-xpath") === xpath
    )).toBe(false);
    renderer.dispose();
  });

  it("searches the legacy-bounded collapsed corpus once and retains its painted anchor", async () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SECTION", rect(0, 0, 0, 0));
    wrapper.ownerDocument = doc;
    const spacers = Array.from({ length: 80 }, () => {
      const spacer = new FakeElement("SPAN", rect(0, 0, 0, 0));
      spacer.ownerDocument = doc;
      wrapper.appendChild(spacer);
      return spacer;
    });
    const paragraph = new FakeElement("P", rect(24, 48, 170, 28), "Late visible copy");
    paragraph.ownerDocument = doc;
    wrapper.appendChild(paragraph);
    doc.hits = [paragraph];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/section[1]";

    const evaluation = {
      rows: [{ xpath, excluded: false, explicit: true }],
      overlay: new Map([[xpath, "explicit-include" as const]]),
    };
    const targets = new Map([[xpath, { element: wrapper as unknown as Element, visible: true }]]);

    renderer.render(evaluation, targets);

    const box = renderer.root.children.flatMap((layer) => layer.children).find((candidate) =>
      candidate.getAttribute("data-uf-overlay-xpath") === xpath
    );
    expect(box?.style.left).toBe("24px");
    expect(box?.style.top).toBe("48px");

    await Promise.resolve();
    for (const spacer of spacers) spacer.clientRectReadCount = 0;
    paragraph.clientRectReadCount = 0;
    renderer.reposition(targets);

    expect(spacers.every((spacer) => spacer.clientRectReadCount === 0)).toBe(true);
    expect(paragraph.clientRectReadCount).toBeGreaterThan(0);
    renderer.dispose();
  });

  it("does not invent descendant geometry for a textless collapsed boundary", () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SECTION", rect(0, 0, 0, 0));
    const image = new FakeElement("IMG", rect(24, 48, 170, 28));
    wrapper.ownerDocument = doc;
    image.ownerDocument = doc;
    wrapper.appendChild(image);
    doc.hits = [image];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/section[1]";

    renderer.render({
      rows: [{ xpath, excluded: false, explicit: true }],
      overlay: new Map([[xpath, "explicit-include"]]),
    }, new Map([[xpath, { element: wrapper as unknown as Element, visible: true }]]));

    expect(renderer.root.children.flatMap((layer) => layer.children).some((candidate) =>
      candidate.getAttribute("data-uf-overlay-xpath") === xpath
    )).toBe(false);
    renderer.dispose();
  });

  it("paints only canonical implicit rows while retaining non-implicit wrapper states", () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SECTION", rect(0, 0, 240, 120));
    const paragraph = new FakeElement("P", rect(10, 10, 200, 20), "Canonical text");
    const locked = new FakeElement("IMG", rect(10, 40, 40, 40));
    for (const element of [wrapper, paragraph, locked]) {
      element.ownerDocument = doc;
    }
    doc.pointHits = (_x, y) => y < 35 ? [paragraph, wrapper] : [locked, wrapper];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const targets = new Map([
      ["/section[1]", { element: wrapper as unknown as Element, visible: true }],
      ["/section[1]/p[1]", { element: paragraph as unknown as Element, visible: true }],
      ["/section[1]/img[1]", { element: locked as unknown as Element, visible: true }],
    ]);

    renderer.render({
      rows: [{ xpath: "/section[1]/p[1]", excluded: false }],
      overlay: new Map([
        ["/section[1]", "implicit-include"],
        ["/section[1]/p[1]", "implicit-include"],
        ["/section[1]/img[1]", "immutable"],
      ]),
    }, targets);

    const paintedXpaths = renderer.root.children
      .flatMap((layer) => layer.children)
      .map((box) => box.getAttribute("data-uf-overlay-xpath"));
    expect(paintedXpaths).not.toContain("/section[1]");
    expect(paintedXpaths).toContain("/section[1]/p[1]");
    expect(paintedXpaths).toContain("/section[1]/img[1]");

    renderer.renderBranch({
      rows: [{ xpath: "/section[1]/p[1]", excluded: false }],
      overlay: new Map([
        ["/section[1]", "implicit-include"],
        ["/section[1]/p[1]", "implicit-include"],
        ["/section[1]/img[1]", "immutable"],
      ]),
    }, targets);
    expect(renderer.root.children
      .flatMap((layer) => layer.children)
      .map((box) => box.getAttribute("data-uf-overlay-xpath")))
      .not.toContain("/section[1]");
    renderer.dispose();
  });

  it("reuses paint geometry only across one synchronous marking and silent transaction", async () => {
    const doc = new FakeDocument();
    const paragraph = new FakeElement("P", rect(10, 10, 200, 20), "Canonical text");
    paragraph.ownerDocument = doc;
    doc.pointHits = () => [paragraph];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/p[1]";
    const evaluation = {
      rows: [{ xpath, excluded: false }],
      overlay: new Map([[xpath, "implicit-include" as const]]),
    };
    const targets = new Map([[xpath, {
      element: paragraph as unknown as Element,
      visible: true,
    }]]);

    paragraph.clientRectReadCount = 0;
    renderer.render(evaluation, targets);
    renderer.renderSilentHighlights([xpath], targets);
    expect(paragraph.clientRectReadCount).toBe(1);

    paragraph.clientRectReadCount = 0;
    renderer.render(evaluation, targets);
    await Promise.resolve();
    renderer.renderSilentHighlights([xpath], targets);
    expect(paragraph.clientRectReadCount).toBe(2);

    paragraph.clientRectReadCount = 0;
    renderer.renderBranch(evaluation, targets);
    renderer.renderSilentHighlightsBranch([xpath], targets);
    expect(paragraph.clientRectReadCount).toBe(1);
    renderer.dispose();
  });

  it("does not scan marking targets during a silent-only geometry transaction", () => {
    const doc = new FakeDocument();
    const paragraph = new FakeElement("P", rect(10, 10, 200, 20), "Canonical text");
    paragraph.ownerDocument = doc;
    doc.pointHits = () => [paragraph];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/p[1]";
    const backing = new Map([[xpath, {
      element: paragraph as unknown as Element,
      visible: true,
    }]]);
    let targetCorpusIterations = 0;
    const targets = new Proxy(backing, {
      get(target, property) {
        if (property === Symbol.iterator) {
          return () => {
            targetCorpusIterations += 1;
            return target[Symbol.iterator]();
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    renderer.renderSilentHighlights([xpath], backing);
    paragraph.clientRectReadCount = 0;
    renderer.reposition(targets);

    expect(targetCorpusIterations).toBe(0);
    expect(paragraph.clientRectReadCount).toBe(1);
    renderer.dispose();
  });

  it("renders the three legacy silent border classes on separate reusable layers", () => {
    const doc = new FakeDocument();
    const content = new FakeElement("P", rect(0, 0, 120, 20), "Content");
    const immutable = new FakeElement("IMG", rect(0, 30, 120, 20));
    const excluded = new FakeElement("FOOTER", rect(0, 60, 120, 20), "Footer");
    for (const element of [content, immutable, excluded]) {
      element.ownerDocument = doc;
    }
    doc.pointHits = (_x, y) => y < 25
      ? [content]
      : y < 55
        ? [immutable]
        : [excluded];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const targets = new Map([
      ["/p[1]", { element: content as unknown as Element, visible: true }],
      ["/img[1]", { element: immutable as unknown as Element, visible: true }],
      ["/footer[1]", { element: excluded as unknown as Element, visible: true }],
    ]);

    renderer.renderSilentHighlights(["/p[1]"], targets, {
      immutableXpaths: ["/img[1]"],
      excludedXpaths: ["/footer[1]"],
    });

    const classes = renderer.root.children.flatMap((layer) => layer.children).map((box) => box.className);
    expect(classes).toContain("uf-silent-rect uf-silent-content");
    expect(classes).toContain("uf-silent-rect uf-silent-immutable");
    expect(classes).toContain("uf-silent-rect uf-silent-excluded");
    renderer.setSilentDebugAnnotations(true);
    const debugBoxes = renderer.root.children.flatMap((layer) => layer.children).filter((box) =>
      box.getAttribute("data-uf-silent-highlight") !== null
    );
    expect(debugBoxes.every((box) => box.getAttribute("data-uf-silent-copy") === "true")).toBe(true);
    expect(debugBoxes.map((box) => box.getAttribute("title"))).toContain("XPath: /p[1]");
    renderer.dispose();
  });

  it("does not paint silent exclusion classes from descendant-only geometry", () => {
    const doc = new FakeDocument();
    const excluded = new FakeElement("SECTION", rect(0, 0, 0, 0));
    const copy = new FakeElement("P", rect(20, 40, 180, 30), "Visible descendant");
    excluded.ownerDocument = doc;
    copy.ownerDocument = doc;
    excluded.appendChild(copy);
    doc.hits = [copy];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/section[1]";

    renderer.renderSilentHighlights([], new Map([
      [xpath, { element: excluded as unknown as Element, visible: true }],
    ]), { excludedXpaths: [xpath] });

    expect(renderer.root.children.flatMap((layer) => layer.children).some((box) =>
      box.getAttribute("data-uf-silent-highlight") === xpath
    )).toBe(false);
    renderer.dispose();
  });

  it("sizes the capture overlay to RTL scrollbar gutters and refreshed zoom geometry", () => {
    const doc = new FakeDocument();
    Object.assign(doc.defaultView, { innerWidth: 1_000, innerHeight: 800 });
    Object.assign(doc.documentElement, { clientWidth: 980, clientHeight: 780, dir: "rtl" });
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });

    expect(renderer.root.style.left).toBe("20px");
    expect(renderer.root.style.width).toBe("980px");
    expect(renderer.root.style.height).toBe("780px");

    Object.assign(doc.defaultView, { innerWidth: 1_200, innerHeight: 900 });
    Object.assign(doc.documentElement, { clientWidth: 960, clientHeight: 860, dir: "ltr" });
    renderer.reposition(new Map());
    expect(renderer.root.style.left).toBe("0px");
    expect(renderer.root.style.width).toBe("960px");
    expect(renderer.root.style.height).toBe("860px");
    renderer.dispose();
  });

  it("does not paint silent geometry behind forced scrollbar gutters", () => {
    const doc = new FakeDocument();
    Object.assign(doc.defaultView, { innerWidth: 1_000, innerHeight: 800 });
    Object.assign(doc.documentElement, { clientWidth: 980, clientHeight: 780 });
    const behindHorizontalScrollbar = new FakeElement(
      "H2",
      rect(20, 785, 240, 30),
      "Hidden behind the scrollbar",
    );
    behindHorizontalScrollbar.ownerDocument = doc;
    doc.pointHits = () => [behindHorizontalScrollbar];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });

    renderer.renderSilentHighlights(["/h2[1]"], new Map([
      ["/h2[1]", {
        element: behindHorizontalScrollbar as unknown as Element,
        visible: true,
      }],
    ]));

    expect(renderer.root.children.flatMap((layer) => layer.children).some((box) =>
      box.getAttribute("data-uf-silent-highlight") === "/h2[1]"
    )).toBe(false);
    renderer.dispose();
  });

  it("initializes and refreshes defaults in one bridge, evaluation, candidate-index, and render transaction", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Default content");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    const stages: string[] = [];
    const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
    const renderer = createRendererTestSeam();

    const engine = createMarkingEngine(root as unknown as Element, {
      render: true,
      instrumentation: {
        createBridge,
        createRenderer: renderer.createRenderer,
        onWorkStage: (stage) => stages.push(stage),
      },
    });

    expect(createBridge).toHaveBeenCalledTimes(1);
    expect(renderer.createRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.markingRender).toHaveBeenCalledTimes(1);
    expect(renderer.silentRender).not.toHaveBeenCalled();
    expect(stages).toEqual(["bridge", "store-evaluate", "candidate-index", "marking-render"]);
    expect(engine.lastInitializationSeededSelectors()).toBe(false);

    stages.length = 0;
    expect(engine.refresh({ render: true })).toBe(false);
    expect(createBridge).toHaveBeenCalledTimes(2);
    expect(renderer.createRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.markingRender).toHaveBeenCalledTimes(2);
    expect(renderer.silentRender).not.toHaveBeenCalled();
    expect(stages).toEqual(["bridge", "store-evaluate", "candidate-index", "marking-render"]);
    engine.dispose();
  });

  it("parks and remounts a warm silent engine without rebuilding its DOM bridge", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Warm content");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph, root];
    const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: {
        createBridge,
        createRenderer: renderer.createRenderer,
      },
    });

    engine.renderSilentHighlights();
    expect(renderer.silentRender).toHaveBeenCalledOnce();
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-silent-highlight") !== null
    )).toBe(true);

    engine.parkPresentation();
    expect(engine.overlayRoot().parentElement).toBeNull();
    engine.renderMarking();

    expect(createBridge).toHaveBeenCalledOnce();
    expect(renderer.markingRender).toHaveBeenCalledOnce();
    expect(engine.overlayRoot().parentElement).toBe(doc.documentElement);
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-silent-highlight") !== null
    )).toBe(false);
    engine.dispose();
  });

  it("initializes selector marks in the same single transaction with inclusion winning", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Selected content");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph, root];
    const stages: string[] = [];
    const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      render: true,
      selectors: {
        inclusionSelectors: ["p"],
        exclusionSelectors: ["p"],
      },
      instrumentation: {
        createBridge,
        createRenderer: renderer.createRenderer,
        onWorkStage: (stage) => stages.push(stage),
      },
    });

    expect(createBridge).toHaveBeenCalledTimes(1);
    expect(renderer.createRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.markingRender).toHaveBeenCalledTimes(1);
    expect(renderer.silentRender).not.toHaveBeenCalled();
    expect(stages).toEqual(["bridge", "selector-match", "store-evaluate", "candidate-index", "marking-render"]);
    expect(engine.lastInitializationSeededSelectors()).toBe(true);

    const selectorBox = engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .find((box) => box.getAttribute("data-uf-overlay-xpath") === "/main[1]/p[1]");
    expect(selectorBox?.className).toBe("uf-rect uf-explicit-include");
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: false,
      explicit: true,
    });

    engine.dispose();
  });

  it("invalidates an identical selector projection after a mutable edit or bridge refresh", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Mutable content");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph, root];
    const selectors = { inclusionSelectors: ["p"], exclusionSelectors: [] };
    const stages: string[] = [];
    const engine = createMarkingEngine(root as unknown as Element, {
      selectors,
      instrumentation: { onWorkStage: (stage) => stages.push(stage) },
    });

    stages.length = 0;
    expect(engine.replaceSelectors(selectors)).toBe(true);
    expect(stages).toEqual([]);

    const target = engine.resolveAtPoint(20, 15, "exclude", false);
    expect(target?.xpath).toBe("/main[1]/p[1]");
    expect(engine.toggle(target!, "exclude")).toBe(true);
    stages.length = 0;
    expect(engine.replaceSelectors(selectors)).toBe(true);
    // The DOM and selector match cache remain valid, but the edited marking
    // store and candidate projection must be replaced atomically.
    expect(stages).toEqual(["store-evaluate", "candidate-index"]);

    const clearTarget = engine.resolveAtPoint(20, 15, "exclude", false);
    expect(clearTarget?.xpath).toBe("/main[1]/p[1]");
    expect(engine.clear(clearTarget!)).toBe(true);
    stages.length = 0;
    expect(engine.replaceSelectors(selectors)).toBe(true);
    expect(stages).toEqual(["store-evaluate", "candidate-index"]);

    stages.length = 0;
    expect(engine.refresh({ selectors })).toBe(true);
    expect(stages).toEqual(["bridge", "selector-match", "store-evaluate", "candidate-index"]);
    stages.length = 0;
    expect(engine.replaceSelectors(selectors)).toBe(true);
    expect(stages).toEqual(["store-evaluate", "candidate-index"]);
    engine.dispose();
  });

  it("bounds dense selector matching with ordered groups and isolates invalid selectors", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 600, 4_500));
    root.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    let selected: FakeElement | null = null;
    for (let index = 0; index < 200; index += 1) {
      const paragraph = new FakeElement("P", rect(0, index * 22, 300, 20), `Row ${index}`);
      paragraph.ownerDocument = doc;
      if (index === 199) {
        paragraph.className = "selector-95";
        selected = paragraph;
      }
      root.appendChild(paragraph);
    }
    const bridge = createDomBridgeView(root as unknown as Element);
    const originalMatches = FakeElement.prototype.matches;
    const matches = vi.spyOn(FakeElement.prototype, "matches").mockImplementation(function (
      this: FakeElement,
      selector: string,
    ) {
      if (selector === "[invalid-selector") {
        throw new Error("invalid selector");
      }
      return originalMatches.call(this, selector);
    });
    const inclusionSelectors = [
      "[invalid-selector",
      ...Array.from({ length: 96 }, (_, index) => `.selector-${index}`),
    ];

    const engine = createMarkingEngine(root as unknown as Element, {
      selectors: { inclusionSelectors, exclusionSelectors: [] },
      instrumentation: { createBridge: () => bridge },
    });

    expect(matches.mock.calls.length).toBeLessThan(1_000);
    expect(selected).not.toBeNull();
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[200]",
      excluded: false,
      explicit: true,
    });
    engine.dispose();
    matches.mockRestore();
  });

  it("preserves document-scoped selector semantics without adding an initialization pass", () => {
    const doc = new FakeDocument();
    const body = new FakeElement("BODY", rect(0, 0, 300, 200));
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200), "Scoped content");
    body.ownerDocument = doc;
    root.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(body);
    body.appendChild(root);
    const querySelectorAll = vi.fn((selector: string) =>
      selector === ":scope > body > main" ? [root] : []
    );
    Object.assign(doc, { querySelectorAll });
    const stages: string[] = [];
    const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
    const renderer = createRendererTestSeam();

    const engine = createMarkingEngine(root as unknown as Element, {
      render: true,
      selectors: {
        // The ordinary non-match also proves that only `:scope` selectors use
        // the owner-document compatibility query.
        inclusionSelectors: [":scope > body > main", "aside"],
        exclusionSelectors: [],
      },
      instrumentation: {
        createBridge,
        createRenderer: renderer.createRenderer,
        onWorkStage: (stage) => stages.push(stage),
      },
    });

    expect(querySelectorAll).toHaveBeenCalledTimes(1);
    expect(querySelectorAll).toHaveBeenCalledWith(":scope > body > main");
    expect(createBridge).toHaveBeenCalledTimes(1);
    expect(renderer.markingRender).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(["bridge", "selector-match", "store-evaluate", "candidate-index", "marking-render"]);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]",
      excluded: false,
      explicit: true,
    });
    engine.dispose();
  });

  it("initializes silent selector highlighting with one bridge, evaluation, index, and silent render", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Silent content");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    const stages: string[] = [];
    const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
    const renderer = createRendererTestSeam();

    const engine = createMarkingEngine(root as unknown as Element, {
      selectors: { inclusionSelectors: ["p"], exclusionSelectors: [] },
      instrumentation: {
        createBridge,
        createRenderer: renderer.createRenderer,
        onWorkStage: (stage) => stages.push(stage),
      },
    });
    engine.renderSilentHighlights();

    expect(createBridge).toHaveBeenCalledTimes(1);
    expect(renderer.createRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.markingRender).not.toHaveBeenCalled();
    expect(renderer.silentRender).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(["bridge", "selector-match", "store-evaluate", "candidate-index", "silent-render"]);
    expect(engine.lastInitializationSeededSelectors()).toBe(true);
    engine.dispose();
  });

  it("replaces authoritative selector marks without rebuilding a current DOM bridge", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Silent content");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    const stages: string[] = [];
    const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: {
        createBridge,
        createRenderer: renderer.createRenderer,
        onWorkStage: (stage) => stages.push(stage),
      },
    });

    stages.length = 0;
    expect(engine.replaceSelectors({ inclusionSelectors: ["p"], exclusionSelectors: [] })).toBe(true);
    engine.renderSilentHighlights();

    expect(createBridge).toHaveBeenCalledTimes(1);
    expect(renderer.createRenderer).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(["selector-match", "store-evaluate", "candidate-index", "silent-render"]);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: false,
      explicit: true,
    });

    stages.length = 0;
    expect(engine.replaceSelectors({ inclusionSelectors: ["p"], exclusionSelectors: [] })).toBe(true);
    engine.renderSilentHighlights();
    expect(stages).toEqual(["silent-render"]);
    expect(renderer.silentRender).toHaveBeenCalledTimes(2);

    stages.length = 0;
    expect(engine.replaceSelectors({ inclusionSelectors: [], exclusionSelectors: ["p"] })).toBe(true);
    expect(stages).toEqual(["selector-match", "store-evaluate", "candidate-index"]);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    engine.dispose();
  });

  it("projects one exclusion boundary instead of stacking boxes for every descendant", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const footer = new FakeElement("FOOTER", rect(0, 100, 300, 100));
    const paragraph = new FakeElement("P", rect(10, 120, 200, 20), "Footer copy");
    root.ownerDocument = doc;
    footer.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(footer);
    footer.appendChild(paragraph);
    doc.hits = [paragraph, footer, root];
    const engine = createMarkingEngine(root as unknown as Element);

    engine.renderReadOnly();

    const excludedBoxes = engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .filter((overlay) => overlay.getAttribute("data-uf-overlay-classification") === "exception");
    expect(excludedBoxes.map((overlay) => overlay.getAttribute("data-uf-overlay-xpath")))
      .toEqual(["/main[1]/footer[1]"]);
  });

  it("draws an immediate mode-coloured acknowledgement and clears it after the pulse", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(10, 12, 120, 20), "Content");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const engine = createMarkingEngine(root as unknown as Element);
      const target = engine.resolveAtPoint(20, 18, "include");

      engine.toggle(target!, "include");

      const interactionLayer = engine.overlayRoot().children.find((layer) =>
        layer.getAttribute("data-layer") === "interaction"
      );
      const acknowledgement = interactionLayer?.children[0];
      expect(acknowledgement?.getAttribute("data-uf-interaction-ack")).toBe("/main[1]/p[1]");
      expect(acknowledgement?.className).toBe("uf-rect uf-explicit-include uf-interaction-ack");
      expect(acknowledgement?.style.left).toBe("10px");
      expect(acknowledgement?.style.top).toBe("12px");

      vi.advanceTimersByTime(179);
      expect(interactionLayer?.children).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(interactionLayer?.children).toHaveLength(0);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws one keyed, reusable box per client rect", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const wrapped = new FakeElement("SPAN", rect(10, 10, 180, 42), "Wrapped content");
    wrapped.clientRects = [rect(10, 10, 180, 20), rect(10, 32, 110, 20)];
    root.ownerDocument = doc;
    wrapped.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(wrapped);
    // The bounding-box centre falls in the inter-line gap, where only the
    // ancestor is painted. Rect-level reachability must still keep both lines.
    doc.pointHits = (_x, y) => y >= 30 && y < 32 ? [root] : [wrapped, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const boxes = (): FakeElement[] => engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .filter((overlay) => overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/span[1]");

    engine.renderReadOnly();
    const firstBoxes = boxes();
    expect(firstBoxes).toHaveLength(2);
    expect(firstBoxes.map((box) => ({
      left: box.style.left,
      top: box.style.top,
      width: box.style.width,
      height: box.style.height,
    }))).toEqual([
      { left: "10px", top: "10px", width: "180px", height: "20px" },
      { left: "10px", top: "32px", width: "110px", height: "20px" },
    ]);

    engine.renderReadOnly();
    expect(boxes()).toEqual(firstBoxes);

    wrapped.clientRects = [rect(12, 14, 170, 20)];
    engine.renderReadOnly();
    expect(boxes()).toEqual([firstBoxes[0]]);
    expect(firstBoxes[0]?.style.left).toBe("12px");
    expect(firstBoxes[1]?.parentElement).toBeNull();
  });

  it("never admits empty hit stacks from outside the viewport as paint proof", () => {
    const doc = new FakeDocument();
    Object.assign(doc.defaultView, { innerHeight: 100 });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 100));
    const clippedAbove = new FakeElement("IMG", rect(10, -10, 80, 20));
    const clippedBelow = new FakeElement("IMG", rect(10, 90, 80, 20));
    const onePixelSliver = new FakeElement("IMG", rect(110, 99, 80, 20));
    for (const element of [root, clippedAbove, clippedBelow, onePixelSliver]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(clippedAbove);
    root.appendChild(clippedBelow);
    root.appendChild(onePixelSliver);
    // Out-of-bounds probes produce no native hits. Every point in the actual
    // viewport intersection is covered by the root and must therefore reject
    // both immutable-source rectangles.
    doc.pointHits = (x, y) => {
      if (x >= 110 && y >= 99 && y < 100) {
        return [onePixelSliver, root];
      }
      return y >= 0 && y < 100 ? [root] : [];
    };
    const engine = createMarkingEngine(root as unknown as Element);

    engine.renderReadOnly();

    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).filter((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath")?.startsWith("/main[1]/img[")
    )).toHaveLength(0);
    engine.dispose();
  });

  it("retains explicit includes in state without painting covered or hidden ghosts", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Retained content");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const target = engine.resolveAtPoint(20, 15, "include");
    engine.toggle(target!, "include");
    const overlays = (): FakeElement[] => engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .filter((overlay) => overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/p[1]");

    doc.hits = [root];
    engine.renderReadOnly();
    expect(overlays()).toEqual([]);

    paragraph.style.visibility = "hidden";
    engine.refresh();
    engine.renderReadOnly();
    expect(overlays()).toEqual([]);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: false,
      explicit: true,
    });
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: [],
    });
    expect(projection.rows.some((row) => row.text === "Retained content")).toBe(false);
    expect(engine.buildSubmission({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
    }).pages[0]?.renderedXPaths).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: false,
      explicit: true,
    });
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.className.includes("-ghost")
    )).toBe(false);
    engine.dispose();
  });

  it("retains an invisible explicit exclusion without drawing raw fallback geometry", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Hidden exclusion");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const target = engine.resolveAtPoint(20, 15, "exclude", true);
    engine.toggle(target!, "exclude");
    paragraph.style.visibility = "hidden";
    engine.refresh();
    engine.renderReadOnly();

    expect(engine.rows().some((row) => row.xpath === "/main[1]/p[1]" && row.excluded)).toBe(true);
    expect(engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: [],
    }).rows.some((row) => row.text === "Hidden exclusion")).toBe(false);
    expect(engine.buildSubmission({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
    }).pages[0]?.renderedXPaths).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/p[1]"
    )).toBe(false);
    engine.dispose();
  });

  it("removes an exclusion rectangle when a live ancestor becomes transparent", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const modal = new FakeElement("SECTION", rect(0, 0, 260, 120));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Hidden exclusion");
    for (const element of [root, modal, paragraph]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(modal);
    modal.appendChild(paragraph);
    doc.hits = [paragraph];
    const engine = createMarkingEngine(root as unknown as Element);
    const target = engine.resolveAtPoint(20, 15, "exclude", true);
    engine.toggle(target!, "exclude");

    modal.style.opacity = "0";
    engine.renderReadOnly();

    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/section[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/section[1]/p[1]"
    )).toBe(false);
    engine.dispose();
  });

  it("prunes a newly invisible exclusion in the mutation delivery before the structural quiet window", () => {
    const doc = new FakeDocument();
    const callbacks: Array<(records: MutationRecord[]) => void> = [];
    Object.assign(doc.defaultView, {
      MutationObserver: class {
        constructor(callback: (records: MutationRecord[]) => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const modal = new FakeElement("SECTION", rect(0, 0, 260, 120));
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Transient exclusion");
    for (const element of [root, modal, paragraph]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(modal);
    modal.appendChild(paragraph);
    doc.hits = [paragraph, modal, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const target = engine.resolveAtPoint(20, 15, "exclude", true);
    engine.toggle(target!, "exclude");
    engine.renderReadOnly();
    const painted = (): boolean => engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .some((overlay) =>
        overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/section[1]/p[1]"
      );
    expect(painted()).toBe(true);

    modal.style.opacity = "0";
    modal.setAttribute("style", "opacity: 0");
    callbacks[0]?.([{
      type: "attributes",
      target: modal,
      attributeName: "style",
      oldValue: null,
    } as unknown as MutationRecord]);

    expect(painted()).toBe(false);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/section[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    engine.dispose();
  });

  it("prunes a covered implicit inclusion in the mutation delivery", () => {
    const doc = new FakeDocument();
    const callbacks: Array<(records: MutationRecord[]) => void> = [];
    Object.assign(doc.defaultView, {
      MutationObserver: class {
        constructor(callback: (records: MutationRecord[]) => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const link = new FakeElement("A", rect(10, 10, 140, 24), "Visible content link");
    const cover = new FakeElement("NAV", rect(0, 0, 300, 60), "Sticky navigation");
    for (const element of [root, link, cover]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(link);
    root.appendChild(cover);
    doc.hits = [link, root];
    const engine = createMarkingEngine(root as unknown as Element);
    engine.renderReadOnly();
    const painted = (): boolean => engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .some((overlay) =>
        overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/a[1]" &&
        overlay.className === "uf-rect uf-default"
      );
    expect(painted()).toBe(true);

    doc.hits = [cover, link, root];
    cover.setAttribute("class", "sticky");
    callbacks[0]?.([{
      type: "attributes",
      target: cover,
      attributeName: "class",
      oldValue: null,
    } as unknown as MutationRecord]);

    expect(painted()).toBe(false);
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/a[1]", excluded: false });
    engine.dispose();
  });

  it("does not paint visually hidden immutable exclusions in marking or silent mode", () => {
    const doc = new FakeDocument();
    const image = new FakeElement("IMG", rect(10, 10, 120, 80));
    image.ownerDocument = doc;
    image.style.opacity = "0";
    doc.hits = [image];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/img[1]";
    const targets = new Map([[xpath, {
      element: image as unknown as Element,
      visible: false,
    }]]);

    renderer.render({
      rows: [{ xpath, excluded: true }],
      overlay: new Map([[xpath, "immutable"]]),
    }, targets);
    renderer.renderSilentHighlights([], targets, {
      immutableXpaths: [xpath],
      excludedXpaths: [xpath],
    });

    expect(renderer.root.children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath") === xpath
      || overlay.getAttribute("data-uf-silent-highlight") === xpath
    )).toBe(false);
    renderer.dispose();
  });

  it("does not paint an opacity-zero implicit inclusion retained in the hit stack", () => {
    const doc = new FakeDocument();
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Hidden carousel copy");
    paragraph.ownerDocument = doc;
    paragraph.style.opacity = "0";
    doc.hits = [paragraph];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/p[1]";

    renderer.render({
      rows: [{ xpath, excluded: false }],
      overlay: new Map([[xpath, "implicit-include"]]),
    }, new Map([[xpath, { element: paragraph as unknown as Element, visible: true }]]));

    expect(renderer.root.children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath") === xpath
    )).toBe(false);
    renderer.dispose();
  });

  it("does not restore raw immutable geometry when another page surface covers it", () => {
    const doc = new FakeDocument();
    const image = new FakeElement("IMG", rect(10, 10, 120, 80));
    const cover = new FakeElement("DIV", rect(0, 0, 200, 120));
    image.ownerDocument = doc;
    cover.ownerDocument = doc;
    doc.hits = [cover, image];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/img[1]";

    renderer.render({
      rows: [{ xpath, excluded: true }],
      overlay: new Map([[xpath, "immutable"]]),
    }, new Map([[xpath, { element: image as unknown as Element, visible: true }]]), 4);

    expect(renderer.root.children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath") === xpath
    )).toBe(false);
    expect(renderer.paintedExclusionOwnerAtPoint(20, 20, 4)).toBeNull();
    renderer.dispose();
  });

  it("uses current paint proof rather than aria-hidden metadata for exclusion paint", () => {
    const doc = new FakeDocument();
    const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "Painted aria-hidden copy");
    paragraph.ownerDocument = doc;
    paragraph.setAttribute("aria-hidden", "true");
    doc.hits = [paragraph];
    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    const xpath = "/p[1]";

    renderer.render({
      rows: [{ xpath, excluded: true, explicit: true }],
      overlay: new Map([[xpath, "exception"]]),
    }, new Map([[xpath, { element: paragraph as unknown as Element, visible: true }]]), 9);

    expect(renderer.root.children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.getAttribute("data-uf-overlay-xpath") === xpath
    )).toBe(true);
    expect(renderer.paintedExclusionOwnerAtPoint(20, 15, 8)).toBeNull();
    expect(renderer.paintedExclusionOwnerAtPoint(20, 15, 9)).toBe(xpath);
    expect(renderer.paintedMutableBoundaryAtPoint(11, 15, 8)).toBeNull();
    expect(renderer.paintedMutableBoundaryAtPoint(20, 15, 9)).toBeNull();
    expect(renderer.paintedMutableBoundaryAtPoint(11, 15, 9)).toBe(xpath);
    renderer.dispose();
  });

  it("rebuilds for page and consent-suppressed mutations but not extension mutations", () => {
    vi.useFakeTimers();
    const doc = new FakeDocument();
    const callbacks: Array<(records: MutationRecord[]) => void> = [];
    const animationFrames: Array<() => void> = [];
    Object.assign(doc.defaultView, {
      MutationObserver: class {
        constructor(callback: (records: MutationRecord[]) => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
      requestAnimationFrame(callback: () => void) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const first = new FakeElement("P", rect(0, 0, 120, 20), "First");
    root.ownerDocument = doc;
    first.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(first);
    const engine = createMarkingEngine(root as unknown as Element);
    const mutation = callbacks[0];
    expect(mutation).toBeDefined();

    const extensionRoot = new FakeElement("DIV", rect(0, 0, 300, 20));
    extensionRoot.ownerDocument = doc;
    extensionRoot.setAttribute("data-uf-extension-ui", "true");
    root.appendChild(extensionRoot);
    mutation?.([{
      type: "childList",
      target: root,
      addedNodes: [extensionRoot],
      removedNodes: [],
    } as unknown as MutationRecord]);
    const transientChrome = new FakeElement("ASIDE", rect(0, 0, 300, 20), "Lock banner");
    transientChrome.ownerDocument = doc;
    extensionRoot.appendChild(transientChrome);
    transientChrome.parentElement = null;
    mutation?.([{
      type: "childList",
      target: extensionRoot,
      addedNodes: [],
      removedNodes: [transientChrome],
    } as unknown as MutationRecord]);

    expect(animationFrames).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(animationFrames).toHaveLength(0);

    const suppressedRoot = new FakeElement("DIALOG", rect(0, 0, 300, 20));
    suppressedRoot.ownerDocument = doc;
    suppressedRoot.setAttribute("data-uf-consent-hidden", "");
    root.appendChild(suppressedRoot);
    mutation?.([{
      type: "childList",
      target: root,
      addedNodes: [suppressedRoot],
      removedNodes: [],
    } as unknown as MutationRecord]);
    const suppressedChild = new FakeElement("BUTTON", rect(0, 0, 80, 20), "Accept");
    suppressedChild.ownerDocument = doc;
    suppressedRoot.appendChild(suppressedChild);
    mutation?.([{
      type: "childList",
      target: suppressedRoot,
      addedNodes: [suppressedChild],
      removedNodes: [],
    } as unknown as MutationRecord]);

    expect(animationFrames).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(animationFrames).toHaveLength(1);
    animationFrames[0]?.();

    const second = new FakeElement("P", rect(0, 30, 120, 20), "Second");
    second.ownerDocument = doc;
    root.appendChild(second);
    mutation?.([{
      type: "childList",
      target: root,
      addedNodes: [second],
      removedNodes: [],
    } as unknown as MutationRecord]);

    expect(animationFrames).toHaveLength(1);
    vi.advanceTimersByTime(75);
    const third = new FakeElement("P", rect(0, 60, 120, 20), "Third");
    third.ownerDocument = doc;
    root.appendChild(third);
    mutation?.([{
      type: "childList",
      target: root,
      addedNodes: [third],
      removedNodes: [],
    } as unknown as MutationRecord]);
    vi.advanceTimersByTime(99);
    expect(animationFrames).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(animationFrames).toHaveLength(2);
    animationFrames[1]?.();
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[3]", excluded: false });
    engine.dispose();
    vi.useRealTimers();
  });

  it("defers an authoritative child-list refresh until viewport input has repainted", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const mutationCallbacks: Array<(records: MutationRecord[]) => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      const animationFrames: Array<() => void> = [];
      const idleCallbacks: Array<() => void> = [];
      const cancelIdleCallback = vi.fn();
      Object.assign(doc.defaultView, {
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            mutationCallbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        requestIdleCallback(callback: () => void) {
          idleCallbacks.push(callback);
          return 40 + idleCallbacks.length;
        },
        cancelIdleCallback,
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 3_000));
      const first = new FakeElement("P", rect(0, 0, 120, 20), "First");
      for (const element of [root, first]) element.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(first);
      const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
      const engine = createMarkingEngine(root as unknown as Element, {
        render: true,
        instrumentation: { createBridge },
      });

      const appended = new FakeElement("P", rect(0, 40, 120, 20), "Appended during scroll");
      appended.ownerDocument = doc;
      root.appendChild(appended);
      mutationCallbacks[0]?.([{
        type: "childList",
        target: root,
        addedNodes: [appended],
        removedNodes: [],
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(100);
      expect(idleCallbacks).toHaveLength(1);
      expect(animationFrames).toHaveLength(0);
      listeners.get("scroll")?.({ target: doc } as unknown as Event);

      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      expect(cancelIdleCallback).toHaveBeenCalledWith(41);
      vi.advanceTimersByTime(229);
      expect(animationFrames).toHaveLength(0);
      expect(createBridge).toHaveBeenCalledTimes(1);
      expect(engine.rows()).not.toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });

      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(createBridge).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(99);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(idleCallbacks).toHaveLength(2);
      expect(animationFrames).toHaveLength(0);
      idleCallbacks[1]?.();
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(createBridge).toHaveBeenCalledTimes(2);
      expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("frame-slices a broad child-list bridge rebuild through authoritative adoption", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const callbacks: Array<(records: MutationRecord[]) => void> = [];
      const animationFrames: Array<() => void> = [];
      Object.assign(doc.defaultView, {
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        cancelAnimationFrame() {},
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 8_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      const paragraphs = Array.from({ length: 320 }, (_, index) => {
        const paragraph = new FakeElement("P", rect(0, index * 22, 120, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
        return paragraph;
      });
      const engine = createMarkingEngine(root as unknown as Element);
      const appended = new FakeElement("P", rect(0, 7_100, 120, 20), "Appended");
      appended.ownerDocument = doc;
      root.appendChild(appended);
      callbacks[0]?.([{
        type: "childList",
        target: root,
        addedNodes: [appended],
        removedNodes: [],
      }] as unknown as MutationRecord[]);

      vi.advanceTimersByTime(100);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(engine.rows()).not.toContainEqual({ xpath: "/main[1]/p[321]", excluded: false });
      let frameCount = 1;
      while (animationFrames.length > 0) {
        animationFrames.shift()?.();
        frameCount += 1;
      }

      expect(frameCount).toBeGreaterThan(4);
      expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[321]", excluded: false });
      expect(paragraphs.every((paragraph) => paragraph.rectReadCount > 0)).toBe(true);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains sibling identities when consent suppression makes a bridged element non-interactive", () => {
    vi.useFakeTimers();
    const doc = new FakeDocument();
    const callbacks: Array<(records: MutationRecord[]) => void> = [];
    const animationFrames: Array<() => void> = [];
    Object.assign(doc.defaultView, {
      MutationObserver: class {
        constructor(callback: (records: MutationRecord[]) => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
      requestAnimationFrame(callback: () => void) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const suppressed = new FakeElement("DIV", rect(0, 0, 120, 80), "Modal");
    const content = new FakeElement("DIV", rect(0, 90, 120, 80));
    const paragraph = new FakeElement("P", rect(0, 90, 120, 20), "Page copy");
    root.ownerDocument = doc;
    suppressed.ownerDocument = doc;
    content.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(suppressed);
    root.appendChild(content);
    content.appendChild(paragraph);
    doc.hits = [paragraph, content, root];
    const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { createBridge },
    });
    engine.renderReadOnly();
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/div[2]/p[1]",
      excluded: false,
    });

    suppressed.setAttribute("data-uf-consent-hidden", "true");
    callbacks[0]?.([{
      type: "attributes",
      target: suppressed,
      attributeName: "data-uf-consent-hidden",
      oldValue: null,
    } as unknown as MutationRecord]);

    expect(animationFrames).toHaveLength(0);
    vi.advanceTimersByTime(249);
    expect(animationFrames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(animationFrames).toHaveLength(1);
    animationFrames.shift()?.();
    expect(createBridge).toHaveBeenCalledTimes(2);
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/div[2]/p[1]",
      excluded: false,
    });
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/div[1]",
      excluded: true,
      explicit: true,
    });
    engine.dispose();
    vi.useRealTimers();
  });

  it("coalesces presentation attribute churn into one quiet branch refresh", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const callbacks: Array<(records: MutationRecord[]) => void> = [];
      const animationFrames: Array<() => void> = [];
      Object.assign(doc.defaultView, {
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createBridge, createRenderer: renderer.createRenderer },
      });

      callbacks[0]?.([{
        type: "attributes",
        target: paragraph,
        attributeName: "class",
        oldValue: "slide active",
      } as unknown as MutationRecord]);
      callbacks[0]?.([{
        type: "attributes",
        target: paragraph,
        attributeName: "style",
        oldValue: "transform: translateX(0)",
      } as unknown as MutationRecord]);
      vi.advanceTimersByTime(249);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(0);
      expect(renderer.branchRender).toHaveBeenCalledTimes(1);
      expect(createBridge).toHaveBeenCalledTimes(1);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-evaluates hidden text through the branch path without rebuilding topology", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const callbacks: Array<(records: MutationRecord[]) => void> = [];
      Object.assign(doc.defaultView, {
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "Visible copy");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createBridge, createRenderer: renderer.createRenderer },
      });
      expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[1]", excluded: false });

      paragraph.style.display = "none";
      paragraph.setAttribute("style", "display: none;");
      callbacks[0]?.([{
        type: "attributes",
        target: paragraph,
        attributeName: "style",
        oldValue: null,
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(250);

      expect(createBridge).toHaveBeenCalledTimes(1);
      expect(renderer.branchRender).toHaveBeenCalledTimes(1);
      expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[1]", excluded: true, explicit: true });
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("frame-slices broad responsive presentation refreshes before adopting their branch", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const callbacks: Array<(records: MutationRecord[]) => void> = [];
      const animationFrames: Array<() => void> = [];
      Object.assign(doc.defaultView, {
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        cancelAnimationFrame() {},
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 4_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      const paragraphs = Array.from({ length: 130 }, (_, index) => {
        const paragraph = new FakeElement("P", rect(0, index * 22, 120, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
        return paragraph;
      });
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      for (const element of [root, ...paragraphs]) element.rectReadCount = 0;

      root.style.display = "none";
      root.setAttribute("style", "display: none;");
      callbacks[0]?.([{
        type: "attributes",
        target: root,
        attributeName: "style",
        oldValue: null,
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(250);

      expect(animationFrames).toHaveLength(1);
      expect(renderer.branchRender).not.toHaveBeenCalled();
      const readsPerFrame: number[] = [];
      let priorReads = 0;
      while (animationFrames.length > 0) {
        animationFrames.shift()?.();
        const nextReads = [root, ...paragraphs]
          .reduce((sum, element) => sum + element.rectReadCount, 0);
        readsPerFrame.push(nextReads - priorReads);
        priorReads = nextReads;
      }

      expect(readsPerFrame.filter((count) => count > 0).every((count) => count <= 48)).toBe(true);
      expect(readsPerFrame.filter((count) => count === 0).length).toBeGreaterThanOrEqual(4);
      expect(renderer.branchRender.mock.calls.length).toBeGreaterThan(1);
      expect(renderer.branchRender.mock.calls.every(([targets, affected]) =>
        Number(targets) <= 4 && Number(affected) <= 256
      )).toBe(true);
      expect(engine.rows().every((row) => row.excluded)).toBe(true);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops net-zero responsive churn, branch-refreshes class, and rebuilds role", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const callbacks: Array<(records: MutationRecord[]) => void> = [];
      const animationFrames: Array<() => void> = [];
      Object.assign(doc.defaultView, {
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const header = new FakeElement("DIV", rect(0, 0, 300, 48), "Header");
      root.ownerDocument = doc;
      header.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(header);
      header.setAttribute("class", "sticky-top no-transition");
      header.setAttribute("style", "min-height: 48px; width: 181px; margin-right: 20px;");
      const createBridge = vi.fn((element: Element) => createDomBridgeView(element));
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createBridge, createRenderer: renderer.createRenderer },
      });

      header.setAttribute("style", "min-height: auto;");
      callbacks[0]?.([{
        type: "attributes",
        target: header,
        attributeName: "class",
        oldValue: "sticky-top no-transition",
      }, {
        type: "attributes",
        target: header,
        attributeName: "style",
        oldValue: "min-height: 48px; width: 181px; margin-right: 20px;",
      }] as unknown as MutationRecord[]);
      // The real P25 probe restores its viewport after 180 ms. Presentation
      // authority must retain the first oldValue beyond that point so this
      // responsive A -> B -> A train is discarded without two full evaluations.
      vi.advanceTimersByTime(180);
      // Responsive carousels commonly restore identical declarations in a
      // different serialized order. That is the same presentation endpoint,
      // so it must not pay for a branch evaluation after the resize settles.
      header.setAttribute("style", "margin-right:20px; min-height: 48px; width:181px;");
      callbacks[0]?.([{
        type: "attributes",
        target: header,
        attributeName: "style",
        oldValue: "min-height: auto;",
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(500);
      expect(animationFrames).toHaveLength(0);
      expect(renderer.branchRender).not.toHaveBeenCalled();
      expect(createBridge).toHaveBeenCalledTimes(1);

      header.setAttribute("class", "sticky-top compact");
      callbacks[0]?.([{
        type: "attributes",
        target: header,
        attributeName: "class",
        oldValue: "sticky-top no-transition",
      }, {
        type: "attributes",
        target: header,
        attributeName: "class",
        oldValue: "sticky-top measuring",
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(250);
      expect(animationFrames).toHaveLength(0);
      expect(renderer.branchRender).toHaveBeenCalledTimes(1);
      expect(createBridge).toHaveBeenCalledTimes(1);

      header.setAttribute("role", "navigation");
      callbacks[0]?.([{
        type: "attributes",
        target: header,
        attributeName: "role",
        oldValue: null,
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(250);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(createBridge).toHaveBeenCalledTimes(2);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops freeze-owned style locks but retains page-authored style changes", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const callbacks: Array<(records: MutationRecord[]) => void> = [];
      Object.assign(doc.defaultView, {
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            callbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const slide = new FakeElement("DIV", rect(0, 0, 181, 80), "Slide");
      root.ownerDocument = doc;
      slide.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(slide);
      const authoredStyle = "width: 181px; transform: matrix(1, 0, 0, 1, 0, 0) !important;";
      slide.setAttribute("style", authoredStyle);
      slide.setAttribute(MOTION_CAPTURE_LEDGER_ATTR, JSON.stringify({
        version: 1,
        hadStyleAttribute: true,
        properties: [
          { name: "translate", value: "", priority: "" },
          { name: "rotate", value: "", priority: "" },
          { name: "scale", value: "", priority: "" },
          { name: "offset-distance", value: "", priority: "" },
        ],
      }));
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createRenderer: renderer.createRenderer },
      });

      const lockedStyle = `${authoredStyle} translate: none !important; rotate: none !important; scale: none !important; offset-distance: 0px !important;`;
      slide.setAttribute("style", lockedStyle);
      callbacks[0]?.([{
        type: "attributes",
        target: slide,
        attributeName: "style",
        oldValue: authoredStyle,
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(500);
      expect(renderer.branchRender).not.toHaveBeenCalled();

      const pageChangedStyle = lockedStyle.replace("width: 181px", "width: 165px");
      slide.setAttribute("style", pageChangedStyle);
      callbacks[0]?.([{
        type: "attributes",
        target: slide,
        attributeName: "style",
        oldValue: lockedStyle,
      }] as unknown as MutationRecord[]);
      vi.advanceTimersByTime(250);
      expect(renderer.branchRender).toHaveBeenCalledTimes(1);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces a scroll storm into geometry-only work", () => {
    vi.useFakeTimers();
    const doc = new FakeDocument();
    const animationFrames: Array<() => void> = [];
    const listeners = new Map<string, () => void>();
    Object.assign(doc.defaultView, {
      requestAnimationFrame(callback: () => void) {
        animationFrames.push(callback);
        return animationFrames.length;
      },
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const first = new FakeElement("P", rect(0, 0, 120, 20), "First");
    root.ownerDocument = doc;
    first.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(first);
    doc.hits = [first, root];
    const engine = createMarkingEngine(root as unknown as Element);
    engine.renderReadOnly();

    const second = new FakeElement("P", rect(0, 30, 120, 20), "Second");
    second.ownerDocument = doc;
    root.appendChild(second);
    for (let index = 0; index < 100; index += 1) {
      listeners.get("scroll")?.();
    }

    expect(animationFrames).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(animationFrames).toHaveLength(1);
    animationFrames[0]?.();
    expect(second.rectReadCount).toBe(0);
    expect(engine.rows()).not.toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });
    engine.dispose();
    vi.useRealTimers();
  });

  it("tracks visual viewport scroll and resize until the engine is disposed", () => {
    const doc = new FakeDocument();
    const viewportListeners = new Map<string, EventListener>();
    const visualViewport = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        viewportListeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => {
        viewportListeners.delete(type);
      }),
    };
    Object.assign(doc.defaultView, {
      visualViewport,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
    root.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph, root];

    const engine = createMarkingEngine(root as unknown as Element);

    expect(viewportListeners.has("scroll")).toBe(true);
    expect(viewportListeners.has("resize")).toBe(true);
    engine.dispose();
    expect(viewportListeners.size).toBe(0);
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("does not restart root-scroll quiet time for the matching visual viewport signal", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, EventListener>();
      const viewportListeners = new Map<string, EventListener>();
      const visualViewport = {
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
        scale: 1,
        addEventListener(type: string, listener: EventListener) {
          viewportListeners.set(type, listener);
        },
        removeEventListener(type: string) {
          viewportListeners.delete(type);
        },
      };
      Object.assign(doc.defaultView, {
        scrollX: 0,
        scrollY: 0,
        visualViewport,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: EventListener) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      engine.renderSilentHighlights();
      renderer.geometryRender.mockClear();

      Object.assign(doc.defaultView, { scrollY: 240 });
      Object.assign(visualViewport, { pageTop: 240 });
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(100);
      viewportListeners.get("scroll")?.({ target: visualViewport } as unknown as Event);
      vi.advanceTimersByTime(19);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(renderer.geometryRender).toHaveBeenCalledTimes(1);

      // A genuine visual-viewport pan has a new signature and owns a fresh
      // trailing transaction even when the layout viewport does not move.
      Object.assign(visualViewport, { offsetTop: 12, pageTop: 252 });
      viewportListeners.get("scroll")?.({ target: visualViewport } as unknown as Event);
      vi.advanceTimersByTime(119);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(renderer.geometryRender).toHaveBeenCalledTimes(2);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces window, visual viewport, and root resize into one silent geometry commit", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, EventListener>();
      const viewportListeners = new Map<string, EventListener>();
      let resizeObserverCallback: ResizeObserverCallback | null = null;
      class FakeResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback;
        }
        observe(): void {}
        disconnect(): void {}
      }
      const visualViewport = {
        addEventListener(type: string, listener: EventListener) {
          viewportListeners.set(type, listener);
        },
        removeEventListener(type: string) {
          viewportListeners.delete(type);
        },
      };
      Object.assign(doc.defaultView, {
        ResizeObserver: FakeResizeObserver,
        visualViewport,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: EventListener) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      engine.renderSilentHighlights();
      renderer.silentRender.mockClear();
      renderer.geometryRender.mockClear();

      for (let index = 0; index < 20; index += 1) {
        listeners.get("resize")?.({} as Event);
        viewportListeners.get("resize")?.({} as Event);
        resizeObserverCallback?.([], {} as ResizeObserver);
      }

      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(0);
      expect(renderer.silentRender).not.toHaveBeenCalled();
      vi.advanceTimersByTime(119);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();

      // Viewport motion reuses the approved silent presentation. Rebuilding
      // selector classifications here was the DPJ resize hot loop.
      expect(renderer.silentRender).not.toHaveBeenCalled();
      expect(renderer.geometryRender).toHaveBeenCalledTimes(1);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(0);
      engine.dispose();
      expect(listeners.has("resize")).toBe(false);
      expect(viewportListeners.has("resize")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the marking resize deadline ahead of induced scroll and duplicate observers", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, EventListener>();
      const viewportListeners = new Map<string, EventListener>();
      let resizeObserverCallback: ResizeObserverCallback | null = null;
      class FakeResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback;
        }
        observe(): void {}
        disconnect(): void {}
      }
      const visualViewport = {
        width: 412,
        height: 960,
        scale: 1,
        addEventListener(type: string, listener: EventListener) {
          viewportListeners.set(type, listener);
        },
        removeEventListener(type: string) {
          viewportListeners.delete(type);
        },
      };
      Object.assign(doc.defaultView, {
        innerWidth: 412,
        innerHeight: 960,
        ResizeObserver: FakeResizeObserver,
        visualViewport,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: EventListener) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 412, 960));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        render: true,
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      renderer.geometryRender.mockClear();

      Object.assign(doc.defaultView, { innerWidth: 388 });
      Object.assign(visualViewport, { width: 388 });
      listeners.get("resize")?.({ target: doc.defaultView } as unknown as Event);
      for (let index = 0; index < 20; index += 1) {
        // Chromium reports the metrics change through all three sources and can
        // adjust scrollY as part of the same emulation transaction.
        listeners.get("scroll")?.({ target: doc } as unknown as Event);
        viewportListeners.get("resize")?.({} as Event);
        resizeObserverCallback?.([], {} as ResizeObserver);
      }

      vi.advanceTimersByTime(49);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(renderer.geometryRender).toHaveBeenCalledTimes(1);

      Object.assign(doc.defaultView, { innerWidth: 412 });
      Object.assign(visualViewport, { width: 412 });
      listeners.get("resize")?.({ target: doc.defaultView } as unknown as Event);
      vi.advanceTimersByTime(50);
      animationFrames.shift()?.();
      expect(renderer.geometryRender).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(500);
      expect(animationFrames).toHaveLength(0);
      expect(renderer.geometryRender).toHaveBeenCalledTimes(2);

      // A root-only layout shift with stable viewport dimensions remains real
      // geometry authority; deduplication is scoped per source.
      Object.assign(root.rect, rect(0, 0, 400, 960));
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.advanceTimersByTime(50);
      animationFrames.shift()?.();
      expect(renderer.geometryRender).toHaveBeenCalledTimes(3);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts the marking repaint at 230 ms when silent highlights are also armed", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      Object.assign(doc.defaultView, {
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const engine = createMarkingEngine(root as unknown as Element, { render: true });
      engine.renderSilentHighlights();

      listeners.get("scroll")?.({ target: paragraph } as unknown as Event);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      while (animationFrames.length > 0) {
        animationFrames.shift()?.();
      }

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      vi.advanceTimersByTime(229);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      vi.advanceTimersByTime(1);
      // Retained marking nodes stay faded until their coalesced repaint has
      // placed current geometry; stale boxes never flash between timer and rAF.
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      // A settled viewport scroll goes straight to its one repaint. It must not
      // enqueue another observer sampling loop first.
      expect(animationFrames).toHaveLength(0);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles a large marking document in bounded faded frame chunks", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      Object.assign(doc.defaultView, {
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 3_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      const paragraphs: FakeElement[] = [];
      for (let index = 0; index < 120; index += 1) {
        const paragraph = new FakeElement("P", rect(0, index * 22, 120, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
        paragraphs.push(paragraph);
      }
      doc.pointHits = (_x, y) => {
        const paragraph = paragraphs.find((candidate) =>
          y >= candidate.rect.top && y <= candidate.rect.bottom
        );
        return paragraph ? [paragraph, root] : [root];
      };
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        render: true,
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      renderer.geometryBranchRender.mockClear();

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(230);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();

      // Cheap two-target chunks may share a frame, but the deterministic
      // count cap still fences expensive geometry even when a test clock does
      // not advance inside the renderer seam.
      expect(renderer.geometryBranchRender).toHaveBeenCalledTimes(4);
      expect(renderer.geometryBranchRender).toHaveBeenLastCalledWith(2, false);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(1);

      while (animationFrames.length > 0) {
        animationFrames.shift()?.();
      }
      expect(renderer.geometryBranchRender.mock.calls.length).toBeGreaterThan(1);
      expect(renderer.geometryBranchRender.mock.calls.every(([count]) => count <= 2)).toBe(true);
      expect(renderer.geometryBranchRender).toHaveBeenLastCalledWith(expect.any(Number), true);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");

      engine.clearOverlays();
      engine.renderSilentHighlights();
      renderer.geometryBranchRender.mockClear();
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(230);
      animationFrames.shift()?.();
      expect(renderer.geometryBranchRender).toHaveBeenCalledWith(2, false);
      while (animationFrames.length > 0) animationFrames.shift()?.();
      expect(renderer.geometryBranchRender).toHaveBeenLastCalledWith(expect.any(Number), true);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("frame-chunks IntersectionObserver registration for large marking corpora", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const observed: Element[] = [];
      class FakeIntersectionObserver {
        constructor(_callback: IntersectionObserverCallback) {}
        observe(target: Element): void {
          observed.push(target);
        }
        disconnect(): void {
          observed.splice(0);
        }
      }
      Object.assign(doc.defaultView, {
        IntersectionObserver: FakeIntersectionObserver,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 20_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      for (let index = 0; index < 600; index += 1) {
        const paragraph = new FakeElement("P", rect(0, index * 22, 120, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
      }

      const engine = createMarkingEngine(root as unknown as Element, { render: true });

      expect(observed).toHaveLength(256);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(observed).toHaveLength(512);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(observed).toHaveLength(601);
      expect(animationFrames).toHaveLength(0);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals reconciled retained boxes before progressive viewport entrants finish", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      const observed: Element[] = [];
      let intersectionCallback: IntersectionObserverCallback | null = null;
      class FakeIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }
        observe(target: Element): void {
          observed.push(target);
        }
        disconnect(): void {
          observed.splice(0);
        }
      }
      Object.assign(doc.defaultView, {
        IntersectionObserver: FakeIntersectionObserver,
        innerHeight: 200,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 3_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      const paragraphs = Array.from({ length: 10 }, (_, index) => {
        const top = index < 2 ? index * 30 : 1_000 + index * 30;
        const paragraph = new FakeElement("P", rect(0, top, 120, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
        return paragraph;
      });
      doc.pointHits = (_x, y) => {
        const paragraph = paragraphs.find((candidate) =>
          y >= candidate.rect.top && y <= candidate.rect.bottom
        );
        return paragraph ? [paragraph, root] : [root];
      };
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        render: true,
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      const retainedXpaths = new Set(["/main[1]/p[1]", "/main[1]/p[2]"]);
      const presentationXpaths = new Set(paragraphs.map((_paragraph, index) =>
        `/main[1]/p[${index + 1}]`
      ));
      const rendererInstance = renderer.createRenderer.mock.results[0]?.value;
      Object.assign(rendererInstance!, {
        retainedViewportXpaths: () => retainedXpaths,
        viewportPresentationXpaths: () => presentationXpaths,
      });

      intersectionCallback?.(observed.map((target) => ({
        target,
        isIntersecting: false,
        intersectionRatio: 0,
      } as IntersectionObserverEntry)), {} as IntersectionObserver);
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      const entrants = new Set<Element>(paragraphs.slice(2) as unknown as Element[]);
      intersectionCallback?.(observed
        .filter((target) => entrants.has(target))
        .map((target) => ({
          target,
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry)), {} as IntersectionObserver);
      renderer.geometryBranchRender.mockClear();

      vi.advanceTimersByTime(230);
      animationFrames.shift()?.();

      expect(renderer.geometryBranchRender).toHaveBeenLastCalledWith(2, false);
      expect(animationFrames.length).toBeGreaterThan(0);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      while (animationFrames.length > 0) animationFrames.shift()?.();
      expect(renderer.geometryBranchRender).toHaveBeenLastCalledWith(expect.any(Number), true);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds settled viewport geometry to retained paint instead of stable intersections", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      const observed: Element[] = [];
      let intersectionCallback: IntersectionObserverCallback | null = null;
      class FakeIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }
        observe(target: Element): void {
          observed.push(target);
        }
        disconnect(): void {
          observed.splice(0);
        }
      }
      Object.assign(doc.defaultView, {
        IntersectionObserver: FakeIntersectionObserver,
        innerHeight: 200,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 3_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      const paragraphs: FakeElement[] = [];
      for (let index = 0; index < 120; index += 1) {
        const paragraph = new FakeElement("P", rect(0, index * 22, 120, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
        paragraphs.push(paragraph);
      }
      doc.pointHits = (_x, y) => {
        const paragraph = paragraphs.find((candidate) =>
          y >= candidate.rect.top && y <= candidate.rect.bottom
        );
        return paragraph ? [paragraph, root] : [root];
      };
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        render: true,
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      const retainedXpaths = new Set(
        renderer.createRenderer.mock.results[0]?.value.retainedViewportXpaths() ?? [],
      );
      const intersecting = new Set<Element>([root, ...paragraphs] as unknown as Element[]);
      intersectionCallback?.(observed.map((target) => ({
        target,
        isIntersecting: intersecting.has(target),
        intersectionRatio: intersecting.has(target) ? 1 : 0,
      } as IntersectionObserverEntry)), {} as IntersectionObserver);
      for (const paragraph of paragraphs) {
        paragraph.clientRectReadCount = 0;
      }
      renderer.geometryBranchRender.mockClear();

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(230);
      animationFrames.shift()?.();

      expect(renderer.geometryBranchRender).toHaveBeenCalledWith(2, false);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      while (animationFrames.length > 0) animationFrames.shift()?.();
      expect(renderer.geometryBranchRender.mock.calls.every(([count]) => count <= 2)).toBe(true);
      expect(renderer.geometryBranchRender).toHaveBeenLastCalledWith(expect.any(Number), true);
      const retainedParagraphs = paragraphs.filter((_paragraph, index) =>
        retainedXpaths.has(`/main[1]/p[${index + 1}]`)
      );
      const stableUnpaintedParagraphs = paragraphs.filter((_paragraph, index) =>
        !retainedXpaths.has(`/main[1]/p[${index + 1}]`)
      );
      expect(retainedParagraphs.length).toBeGreaterThan(0);
      expect(stableUnpaintedParagraphs.length).toBeGreaterThan(50);
      expect(retainedParagraphs.every((paragraph) => paragraph.clientRectReadCount > 0)).toBe(true);
      expect(stableUnpaintedParagraphs.every((paragraph) => paragraph.clientRectReadCount === 0)).toBe(true);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds viewport geometry to retained paint while the initial intersection snapshot is incomplete", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      const observed: Element[] = [];
      let intersectionCallback: IntersectionObserverCallback | null = null;
      class FakeIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }
        observe(target: Element): void {
          observed.push(target);
        }
        disconnect(): void {
          observed.splice(0);
        }
      }
      Object.assign(doc.defaultView, {
        IntersectionObserver: FakeIntersectionObserver,
        innerHeight: 960,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 6_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      const paragraphs = Array.from({ length: 120 }, (_, index) => {
        const top = index < 3 ? index * 22 : 2_000 + index * 22;
        const paragraph = new FakeElement("P", rect(0, top, 120, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
        return paragraph;
      });
      doc.pointHits = (_x, y) => {
        const paragraph = paragraphs.find((candidate) =>
          y >= candidate.rect.top && y <= candidate.rect.bottom
        );
        return paragraph ? [paragraph, root] : [root];
      };
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        render: true,
        instrumentation: { createRenderer: renderer.createRenderer },
      });

      // Chromium may split the first observation of a large corpus over many
      // tasks. Supply only the viewport-positive prefix and deliberately leave
      // the remaining targets pending.
      const initialViewportTargets = new Set<Element>(
        [root, ...paragraphs.slice(0, 3)] as unknown as Element[],
      );
      intersectionCallback?.(observed
        .filter((target) => initialViewportTargets.has(target))
        .map((target) => ({
          target,
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry)), {} as IntersectionObserver);
      for (const paragraph of paragraphs) paragraph.clientRectReadCount = 0;
      renderer.geometryBranchRender.mockClear();

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(230);
      let frameCount = 0;
      while (animationFrames.length > 0 && frameCount < 12) {
        animationFrames.shift()?.();
        frameCount += 1;
      }

      expect(frameCount).toBeLessThan(12);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(renderer.geometryBranchRender.mock.calls.every(([count]) => count <= 2)).toBe(true);

      renderer.geometryRender.mockClear();
      intersectionCallback?.(observed
        .filter((target) => !initialViewportTargets.has(target))
        .map((target) => ({
          target,
          isIntersecting: false,
          intersectionRatio: 0,
        } as IntersectionObserverEntry)), {} as IntersectionObserver);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      // The structural root is observed for authority but owns no marking
      // presentation, so it must not enter the geometry batch.
      expect(renderer.geometryRender).toHaveBeenCalledWith(initialViewportTargets.size - 1);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("paint-fences activation geometry after restored-scroll sticky UI settles", async () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      Object.assign(doc.defaultView, {
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "First");
      const stickyHeader = new FakeElement("HEADER", rect(0, 0, 300, 60));
      for (const element of [root, paragraph, stickyHeader]) {
        element.ownerDocument = doc;
      }
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(stickyHeader);
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.pointHits = () => [paragraph, root];
      const engine = createMarkingEngine(root as unknown as Element, { render: true });
      const boxesForParagraph = (): FakeElement[] => engine.overlayRoot().children
        .flatMap((layer) => layer.children)
        .filter((overlay) => overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/p[1]");
      expect(boxesForParagraph()).not.toHaveLength(0);

      // The page commits its sticky restored-scroll posture one frame after the
      // synchronous activation render.
      doc.pointHits = () => [stickyHeader];
      let acknowledged = false;
      const settled = engine.settlePresentation().then(() => {
        acknowledged = true;
      });
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      expect(boxesForParagraph()).toHaveLength(0);
      await Promise.resolve();
      expect(acknowledged).toBe(false);

      animationFrames.shift()?.();
      await settled;
      expect(acknowledged).toBe(true);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminalizes a pending resize fade before guardian settlement acknowledges paint", async () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      Object.assign(doc.defaultView, {
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        cancelAnimationFrame: vi.fn(),
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(10, 10, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.pointHits = () => [paragraph, root];
      const engine = createMarkingEngine(root as unknown as Element, { render: true });

      listeners.get("resize")?.({ target: doc.defaultView } as unknown as Event);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");

      const settled = engine.settlePresentation();
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      animationFrames.shift()?.();
      await settled;
      const framesAfterSettlement = animationFrames.length;

      vi.advanceTimersByTime(500);
      expect(animationFrames).toHaveLength(framesAfterSettlement);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains silent nodes while one quiet scroll transaction repositions them", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      Object.assign(doc.defaultView, {
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const engine = createMarkingEngine(root as unknown as Element);
      engine.renderSilentHighlights();
      const silentBoxes = (): FakeElement[] => engine.overlayRoot().children
        .flatMap((layer) => layer.children)
        .filter((overlay) => overlay.getAttribute("data-uf-silent-highlight") !== null);
      const retainedBox = silentBoxes()[0];
      expect(retainedBox).toBeDefined();

      paragraph.clientRects = [rect(500, 0, 120, 20)];
      doc.hits = [root];
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      expect(silentBoxes()).toEqual([retainedBox]);
      expect(retainedBox?.style.left).toBe("0px");
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(119);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(1);

      animationFrames.shift()?.();
      expect(animationFrames).toHaveLength(0);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(silentBoxes()).toEqual([retainedBox]);
      expect(retainedBox?.style.visibility).toBe("hidden");

      paragraph.clientRects = [rect(10, 12, 120, 20)];
      doc.hits = [paragraph, root];
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      expect(silentBoxes()).toEqual([retainedBox]);
      vi.advanceTimersByTime(120);
      animationFrames.shift()?.();
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(silentBoxes()).toEqual([retainedBox]);
      expect(retainedBox?.style.visibility).toBe("");
      expect(retainedBox?.style.left).toBe("10px");
      expect(retainedBox?.style.top).toBe("12px");
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not prune silent exclusions during a viewport fade transaction", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const listeners = new Map<string, (event?: Event) => void>();
      const mutationCallbacks: Array<(records: MutationRecord[]) => void> = [];
      Object.assign(doc.defaultView, {
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
        MutationObserver: class {
          constructor(callback: (records: MutationRecord[]) => void) {
            mutationCallbacks.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "Excluded copy");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const engine = createMarkingEngine(root as unknown as Element);
      const exclusion = engine.resolveAtPoint(10, 10, "exclude", true);
      expect(exclusion).not.toBeNull();
      engine.toggle(exclusion!, "exclude");
      engine.renderSilentHighlights();
      const silentBoxes = (): FakeElement[] => engine.overlayRoot().children
        .flatMap((layer) => layer.children)
        .filter((overlay) => overlay.getAttribute("data-uf-silent-highlight") !== null);
      const retainedBoxes = silentBoxes();
      expect(retainedBoxes).not.toHaveLength(0);

      paragraph.clientRects = [rect(500, 0, 120, 20)];
      doc.hits = [root];
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      paragraph.setAttribute("class", "page-scrolled");
      mutationCallbacks[0]?.([{
        type: "attributes",
        target: paragraph,
        attributeName: "class",
        oldValue: null,
      } as unknown as MutationRecord]);

      expect(silentBoxes()).toEqual(retainedBoxes);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds silent viewport geometry while retaining offscreen node identity", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      const observed: Element[] = [];
      let intersectionCallback: IntersectionObserverCallback | null = null;
      class FakeIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }
        observe(target: Element): void {
          observed.push(target);
        }
        disconnect(): void {
          observed.splice(0);
        }
      }
      Object.assign(doc.defaultView, {
        IntersectionObserver: FakeIntersectionObserver,
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const first = new FakeElement("P", rect(0, 0, 120, 20), "First");
      const second = new FakeElement("P", rect(0, 30, 120, 20), "Second");
      for (const element of [root, first, second]) {
        element.ownerDocument = doc;
      }
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(first);
      root.appendChild(second);
      doc.pointHits = (_x, y) => y < 25 ? [first, root] : [second, root];
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createRenderer: renderer.createRenderer },
      });
      engine.renderSilentHighlights();
      const silentBox = (xpath: string): FakeElement | undefined => engine.overlayRoot().children
        .flatMap((layer) => layer.children)
        .find((overlay) => overlay.getAttribute("data-uf-silent-highlight") === xpath);
      const secondBox = silentBox("/main[1]/p[2]");
      expect(secondBox).toBeDefined();

      intersectionCallback?.(observed.map((target) => ({
        target,
        isIntersecting: target !== second as unknown as Element,
        intersectionRatio: target !== second as unknown as Element ? 1 : 0,
      } as IntersectionObserverEntry)), {} as IntersectionObserver);
      first.clientRectReadCount = 0;
      second.clientRectReadCount = 0;
      second.clientRects = [rect(500, 0, 120, 20)];
      renderer.geometryRender.mockClear();

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(120);
      animationFrames.shift()?.();

      // Both retained semantic rows are geometry-bearing even when the
      // observer has already reported one outside the viewport: the retained
      // box still has to be measured once so it can be hidden without losing
      // identity. Its structural root remains outside the paint transaction.
      expect(renderer.geometryRender).toHaveBeenLastCalledWith(2);
      expect(first.clientRectReadCount).toBeGreaterThan(0);
      expect(second.clientRectReadCount).toBeGreaterThan(0);
      expect(silentBox("/main[1]/p[2]")).toBe(secondBox);
      expect(secondBox?.style.visibility).toBe("hidden");

      second.clientRects = [rect(0, 40, 120, 20)];
      doc.pointHits = (_x, y) => y < 25 ? [first, root] : [second, root];
      intersectionCallback?.([{
        target: second as unknown as Element,
        isIntersecting: true,
        intersectionRatio: 1,
      } as IntersectionObserverEntry], {} as IntersectionObserver);
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(120);
      animationFrames.shift()?.();

      expect(renderer.geometryRender).toHaveBeenLastCalledWith(2);
      expect(silentBox("/main[1]/p[2]")).toBe(secondBox);
      expect(secondBox?.style.visibility).toBe("");
      expect(secondBox?.style.top).toBe("40px");
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("repositions silent geometry through the bounded fallback when page rAF starves", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const animationFrames: Array<() => void> = [];
      const listeners = new Map<string, (event?: Event) => void>();
      Object.assign(doc.defaultView, {
        requestAnimationFrame(callback: () => void) {
          animationFrames.push(callback);
          return animationFrames.length;
        },
        cancelAnimationFrame: vi.fn(),
        addEventListener(type: string, listener: (event?: Event) => void) {
          listeners.set(type, listener);
        },
        removeEventListener(type: string) {
          listeners.delete(type);
        },
      });
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const paragraph = new FakeElement("P", rect(0, 0, 120, 20), "First");
      root.ownerDocument = doc;
      paragraph.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      root.appendChild(paragraph);
      doc.hits = [paragraph, root];
      const engine = createMarkingEngine(root as unknown as Element);
      engine.renderSilentHighlights();
      const readsBefore = paragraph.clientRectReadCount;

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(139);
      expect(paragraph.clientRectReadCount).toBe(readsBefore);
      vi.advanceTimersByTime(1);
      expect(paragraph.clientRectReadCount).toBeGreaterThan(readsBefore);
      const readsAfterFirstFallback = paragraph.clientRectReadCount;

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(140);
      expect(paragraph.clientRectReadCount).toBeGreaterThan(readsAfterFirstFallback);
      expect(animationFrames).toHaveLength(2);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-renders only the toggled branch", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 600, 1000));
    const left = new FakeElement("ARTICLE", rect(0, 0, 280, 100));
    const leftText = new FakeElement("P", rect(10, 10, 240, 20), "Left");
    const right = new FakeElement("ARTICLE", rect(300, 0, 280, 1000));
    const rightTexts: FakeElement[] = [];
    for (const element of [root, left, leftText, right]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    left.appendChild(leftText);
    root.appendChild(left);
    root.appendChild(right);
    for (let index = 0; index < 40; index += 1) {
      const paragraph = new FakeElement("P", rect(310, index * 22, 240, 20), `Right ${index}`);
      paragraph.ownerDocument = doc;
      right.appendChild(paragraph);
      rightTexts.push(paragraph);
    }
    doc.pointHits = (x, y) => {
      if (x < 300) {
        return [leftText, left, root];
      }
      const paragraph = rightTexts.find((element) =>
        y >= element.rect.top && y <= element.rect.bottom
      );
      return paragraph ? [paragraph, right, root] : [right, root];
    };
    const engine = createMarkingEngine(root as unknown as Element);
    engine.renderReadOnly();
    const rightOverlayXpath = "/main[1]/article[2]";
    const overlays = (): FakeElement[] => engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .filter((overlay) => overlay.getAttribute("data-uf-overlay-xpath")?.startsWith(rightOverlayXpath));
    const rightOverlaysBefore = overlays();
    const createdBefore = doc.createElementCount;

    const target = engine.resolveAtPoint(20, 15, "exclude", true);
    expect(target?.xpath).toBe("/main[1]/article[1]/p[1]");
    engine.toggle(target!, "exclude");

    expect(overlays()).toEqual(rightOverlaysBefore);
    expect(rightOverlaysBefore.length).toBeGreaterThan(20);
    // One interaction acknowledgement plus one new branch classification box.
    expect(doc.createElementCount - createdBefore).toBe(2);
  });

  it("yields oversized branch paint after committing and acknowledging the toggle", () => {
    vi.useFakeTimers();
    try {
      const doc = new FakeDocument();
      const root = new FakeElement("MAIN", rect(0, 0, 600, 5_000));
      root.ownerDocument = doc;
      doc.documentElement.ownerDocument = doc;
      doc.documentElement.appendChild(root);
      for (let index = 0; index < 205; index += 1) {
        const paragraph = new FakeElement("P", rect(10, index * 22, 300, 20), `Row ${index}`);
        paragraph.ownerDocument = doc;
        root.appendChild(paragraph);
      }
      doc.hits = [root];
      let bridge: ReturnType<typeof createDomBridgeView> | null = null;
      const renderer = createRendererTestSeam();
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: {
          createBridge(element, options) {
            bridge = createDomBridgeView(element, options);
            return bridge;
          },
          createRenderer: renderer.createRenderer,
        },
      });

      expect(engine.toggle(bridge!.root, "exclude")).toBe(true);
      expect(renderer.branchRender).not.toHaveBeenCalled();
      expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
        overlay.getAttribute("data-uf-interaction-ack") === bridge!.root.xpath
      )).toBe(true);

      vi.runOnlyPendingTimers();
      expect(renderer.branchRender).toHaveBeenCalledOnce();
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates armed silent highlights only inside the toggled branch", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 600, 1000));
    const left = new FakeElement("ARTICLE", rect(0, 0, 280, 100));
    const leftText = new FakeElement("P", rect(10, 10, 240, 20), "Left");
    const right = new FakeElement("ARTICLE", rect(300, 0, 280, 1000));
    const rightTexts: FakeElement[] = [];
    for (const element of [root, left, leftText, right]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    left.appendChild(leftText);
    root.appendChild(left);
    root.appendChild(right);
    for (let index = 0; index < 40; index += 1) {
      const paragraph = new FakeElement("P", rect(310, index * 22, 240, 20), `Right ${index}`);
      paragraph.ownerDocument = doc;
      right.appendChild(paragraph);
      rightTexts.push(paragraph);
    }
    doc.pointHits = (x, y) => {
      if (x < 300) {
        return [leftText, left, root];
      }
      const paragraph = rightTexts.find((element) =>
        y >= element.rect.top && y <= element.rect.bottom
      );
      return paragraph ? [paragraph, right, root] : [right, root];
    };
    const renderer = createRendererTestSeam();
    const stages: string[] = [];
    const engine = createMarkingEngine(root as unknown as Element, {
      render: true,
      instrumentation: {
        createRenderer: renderer.createRenderer,
        onWorkStage: (stage) => stages.push(stage),
      },
    });
    engine.renderSilentHighlights();

    const rightXpath = "/main[1]/article[2]";
    const silentBoxes = (): FakeElement[] => engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .filter((overlay) => overlay.getAttribute("data-uf-silent-highlight")?.startsWith(rightXpath));
    const rightBoxesBefore = silentBoxes();
    expect(rightBoxesBefore).toHaveLength(40);
    expect(renderer.silentRender).toHaveBeenCalledTimes(1);
    expect(renderer.silentBranchRender).not.toHaveBeenCalled();
    for (const element of [right, ...rightTexts]) {
      element.rectReadCount = 0;
    }
    stages.length = 0;

    const target = engine.resolveAtPoint(20, 15, "exclude", true);
    expect(target?.xpath).toBe("/main[1]/article[1]/p[1]");
    expect(engine.toggle(target!, "exclude")).toBe(true);

    expect(renderer.silentRender).toHaveBeenCalledTimes(1);
    expect(renderer.silentBranchRender).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(["silent-render"]);
    expect(silentBoxes()).toEqual(rightBoxesBefore);
    expect([right, ...rightTexts].every((element) => element.rectReadCount === 0)).toBe(true);
    const leftSilentBoxes = engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .filter((overlay) => overlay.getAttribute("data-uf-silent-highlight") === "/main[1]/article[1]/p[1]");
    expect(leftSilentBoxes.map((overlay) => overlay.className)).toEqual([
      "uf-silent-rect uf-silent-excluded",
    ]);
    engine.dispose();
  });

  it("rejects a stale toggle target after the DOM generation is rebuilt", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const original = new FakeElement("P", rect(0, 0, 120, 20), "Original");
    root.ownerDocument = doc;
    original.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(original);
    doc.hits = [original, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const staleTarget = engine.resolveAtPoint(10, 10, "exclude", true);
    expect(staleTarget).not.toBeNull();

    root.replaceChildren();
    const replacement = new FakeElement("P", rect(0, 0, 120, 20), "Replacement");
    replacement.ownerDocument = doc;
    root.appendChild(replacement);
    doc.hits = [replacement, root];
    engine.refresh();

    expect(engine.toggle(staleTarget!, "exclude")).toBe(false);
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[1]", excluded: false });
    expect(engine.rows()).not.toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    engine.dispose();
  });

  it("matches the legacy 052c widening golden fixture through Ctrl breadth", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 400, 400));
    const broadPlain = new FakeElement("DIV", rect(0, 0, 380, 360), "Outer copy");
    const nearestGroup = new FakeElement("SECTION", rect(10, 10, 360, 320));
    const toggleable = new FakeElement("FOOTER", rect(20, 20, 160, 200), "Footer copy");
    const gap = new FakeElement("DIV", rect(30, 30, 140, 100));
    const clicked = new FakeElement("P", rect(40, 40, 120, 20), "Clicked copy");
    const sibling = new FakeElement("ARTICLE", rect(200, 20, 150, 200), "Sibling copy");
    for (const element of [root, broadPlain, nearestGroup, toggleable, gap, clicked, sibling]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    gap.appendChild(clicked);
    toggleable.appendChild(gap);
    nearestGroup.appendChild(toggleable);
    nearestGroup.appendChild(sibling);
    broadPlain.appendChild(nearestGroup);
    root.appendChild(broadPlain);
    doc.hits = [clicked, gap, toggleable, nearestGroup, broadPlain, root];

    const widened = createMarkingEngine(root as unknown as Element)
      .resolveAtPoint(50, 45, "exclude", true);

    // Legacy priority chooses the nearest structured group. It crosses the
    // ineligible one-child gap, outranks the nearer footer boundary, and does
    // not climb to the broad ordinary markable wrapper.
    expect(widened?.xpath).toBe("/main[1]/div[1]/section[1]");
  });

  it("rehydrates an expanded exclusion and excludes its ordinary clicked descendant", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 400, 400));
    const group = new FakeElement("SECTION", rect(10, 10, 360, 320));
    const paragraph = new FakeElement("P", rect(40, 40, 120, 20), "Clicked copy");
    const sibling = new FakeElement("ARTICLE", rect(200, 40, 120, 100), "Sibling copy");
    for (const element of [root, group, paragraph, sibling]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    group.appendChild(paragraph);
    group.appendChild(sibling);
    root.appendChild(group);
    // Native elementsFromPoint commonly returns only the painted leaf. The
    // engine must restore its candidate ancestors from the bridge.
    doc.hits = [paragraph];
    const engine = createMarkingEngine(root as unknown as Element);
    const widened = engine.resolveAtPoint(50, 45, "exclude", true);
    expect(widened?.xpath).toBe("/main[1]/section[1]");
    expect(engine.toggle(widened!, "exclude")).toBe(true);

    const descendant = engine.resolveAtPoint(50, 45, "exclude", false);
    expect(descendant?.xpath).toBe("/main[1]/section[1]/p[1]");
    expect(engine.toggle(descendant!, "exclude")).toBe(true);
    expect(engine.rows()).not.toContainEqual({
      xpath: "/main[1]/section[1]",
      excluded: true,
      explicit: true,
    });
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/section[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    engine.dispose();
  });

  it("keeps a painted expanded-exclusion boundary hoverable and toggleable while Shift has no effect", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 412, 3_200));
    const group = new FakeElement("SECTION", rect(0, 0, 412, 2_800));
    const paragraph = new FakeElement("P", rect(0, 80, 380, 60), "Aleris lead copy");
    const sibling = new FakeElement("ARTICLE", rect(20, 180, 360, 100), "Aleris sibling copy");
    for (const element of [root, group, paragraph, sibling]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    group.appendChild(paragraph);
    group.appendChild(sibling);
    root.appendChild(group);
    // Model the real failure: the descendant wins Chromium's composed hit
    // stack even at the broad owner's literal painted border.
    doc.hits = [paragraph, group, root];
    const renderer = createRendererTestSeam();
    const engine = createMarkingEngine(root as unknown as Element, {
      render: true,
      instrumentation: { createRenderer: renderer.createRenderer },
    });
    const expanded = engine.resolveAtPoint(40, 100, "exclude", true);
    expect(expanded?.xpath).toBe("/main[1]/section[1]");
    expect(engine.toggle(expanded!, "exclude")).toBe(true);

    const interior = engine.resolveAtPoint(40, 100, "exclude", false);
    const plainBoundary = engine.resolveAtPoint(1, 100, "exclude", false);
    const ctrlBoundary = engine.resolveAtPoint(1, 100, "exclude", true);
    const altAtBoundary = engine.resolveAtPoint(1, 100, "include", false);
    expect(interior?.xpath).toBe("/main[1]/section[1]/p[1]");
    expect(plainBoundary?.xpath).toBe("/main[1]/section[1]");
    expect(ctrlBoundary?.xpath).toBe("/main[1]/section[1]");
    expect(altAtBoundary?.xpath).toBe("/main[1]/section[1]/p[1]");

    engine.hoverAtPoint(40, 100, "exclude", false);
    engine.hoverAtPoint(1, 100, "exclude", false);
    expect(renderer.hoverRender).toHaveBeenLastCalledWith(
      group as unknown as Element,
      "/main[1]/section[1]",
    );

    // The content entrypoint maps Shift-held input to this exact plain=false
    // path. Shift has no effect on an expanded exclusion: clicking its literal
    // boundary removes it and rehydrates ordinary descendant defaults exactly
    // as the same click with no modifier keys held.
    expect(engine.toggle(plainBoundary!, "exclude")).toBe(true);
    expect(engine.rows()).not.toContainEqual({
      xpath: "/main[1]/section[1]",
      excluded: true,
      explicit: true,
    });
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/section[1]/p[1]",
      excluded: false,
    });
    engine.dispose();
  });

  it("reprojects the active canonical session after a Ctrl-expanded exclusion", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 412, 800));
    const group = new FakeElement("SECTION", rect(0, 0, 412, 600));
    const paragraph = new FakeElement("P", rect(20, 40, 300, 40), "Projected child");
    const sibling = new FakeElement("ARTICLE", rect(20, 120, 300, 80), "Projected sibling");
    for (const element of [root, group, paragraph, sibling]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    group.appendChild(paragraph);
    group.appendChild(sibling);
    root.appendChild(group);
    doc.hits = [paragraph, group, root];
    const engine = createMarkingEngine(root as unknown as Element);
    const selectors = { inclusionSelectors: [], exclusionSelectors: [] };
    const before = engine.projectPreview("https://www.aleris.se/", selectors);
    expect(before.rows.some((row) => row.xpath === "/main[1]/section[1]/p[1]")).toBe(true);

    const expanded = engine.resolveAtPoint(40, 60, "exclude", true);
    expect(expanded?.xpath).toBe("/main[1]/section[1]");
    expect(engine.toggle(expanded!, "exclude")).toBe(true);
    const after = engine.projectPreview("https://www.aleris.se/", selectors);

    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.rows).toContainEqual(expect.objectContaining({
      xpath: "/main[1]/section[1]",
      classification: "excluded",
    }));
    expect(after.rows.some((row) => row.xpath === "/main[1]/section[1]/p[1]")).toBe(false);
    expect(after.rows.some((row) => row.xpath === "/main[1]/section[1]/article[1]")).toBe(false);
    engine.dispose();
  });

  it("resolves an Alt-created explicit inclusion for plain-key unmarking", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 200));
    const paragraph = new FakeElement("P", rect(20, 20, 180, 24), "Included copy");
    for (const element of [root, paragraph]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(paragraph);
    doc.hits = [paragraph];
    const workStages: string[] = [];
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: { onWorkStage: (stage) => workStages.push(stage) },
    });
    const include = engine.resolveAtPoint(40, 30, "include", false);
    expect(include?.xpath).toBe("/main[1]/p[1]");
    expect(engine.toggle(include!, "include")).toBe(true);
    expect(engine.hasExplicitMark(include!)).toBe(true);

    workStages.splice(0);
    const plainOwner = engine.resolveAtPoint(40, 30, "exclude", false);
    expect(workStages).not.toContain("candidate-index");
    expect(plainOwner?.xpath).toBe("/main[1]/p[1]");
    expect(engine.clear(plainOwner!)).toBe(true);
    expect(engine.hasExplicitMark(plainOwner!)).toBe(false);
    engine.dispose();
  });

  it("uses visible expanded-owner geometry when an overlapping sibling replaces the native hit", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 400, 400));
    const group = new FakeElement("SECTION", rect(10, 10, 360, 320));
    const paragraph = new FakeElement("P", rect(40, 40, 120, 20), "Clicked copy");
    const sibling = new FakeElement("ARTICLE", rect(200, 40, 120, 100), "Sibling copy");
    const floating = new FakeElement("BUTTON", rect(0, 0, 180, 90), "Overlapping control");
    for (const element of [root, group, paragraph, sibling, floating]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    group.appendChild(paragraph);
    group.appendChild(sibling);
    root.appendChild(group);
    root.appendChild(floating);
    doc.hits = [paragraph];
    const engine = createMarkingEngine(root as unknown as Element);
    const widened = engine.resolveAtPoint(50, 45, "exclude", true);
    expect(widened?.xpath).toBe("/main[1]/section[1]");
    expect(engine.toggle(widened!, "exclude")).toBe(true);

    doc.hits = [floating];
    const owner = engine.resolveAtPoint(50, 45, "exclude", false);
    expect(owner?.xpath).toBe("/main[1]/section[1]");
    expect(engine.toggle(owner!, "exclude")).toBe(true);
    expect(engine.rows()).not.toContainEqual({
      xpath: "/main[1]/section[1]",
      excluded: true,
      explicit: true,
    });
    engine.dispose();
  });

  it("seeds toggleable default exclusions before the first read-only render", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const footer = new FakeElement("FOOTER", rect(0, 220, 300, 60), "Footer fluff");
    root.ownerDocument = doc;
    footer.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(footer);
    doc.hits = [footer, root];

    const engine = createMarkingEngine(root as unknown as Element);
    engine.renderReadOnly();
    const footerOverlay = engine.overlayRoot().children.flatMap((layer) => layer.children).find((child) =>
      child.getAttribute("data-uf-overlay-xpath") === "/main[1]/footer[1]"
    );

    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/footer[1]", excluded: true });
    expect(footerOverlay?.className).toBe("uf-rect uf-explicit-exclude");

    const boundary = engine.resolveAtPoint(10, 250, "exclude");
    expect(boundary?.xpath).toBe("/main[1]/footer[1]");
    engine.toggle(boundary!, "exclude");
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/footer[1]", excluded: false });
  });

  it("seeds a landmark-bearing full-width footer and suppresses descendant includes", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 412, 300));
    const footer = new FakeElement("FOOTER", rect(0, 220, 412, 80));
    const header = new FakeElement("HEADER", rect(0, 220, 412, 40));
    const headerText = new FakeElement("SPAN", rect(16, 230, 160, 20), "Footer heading");
    const nav = new FakeElement("NAV", rect(0, 260, 412, 40));
    const navText = new FakeElement("A", rect(16, 270, 120, 20), "Footer link");
    for (const element of [root, footer, header, headerText, nav, navText]) {
      element.ownerDocument = doc;
    }
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    header.appendChild(headerText);
    nav.appendChild(navText);
    footer.appendChild(header);
    footer.appendChild(nav);
    root.appendChild(footer);

    const engine = createMarkingEngine(root as unknown as Element);
    const submission = engine.buildSubmission({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/jobs",
    });

    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/footer[1]", excluded: true });
    expect(submission.pages[0]?.renderedXPaths).toEqual([
      { xpath: "/main[1]/footer[1]", excluded: true },
    ]);
  });

  it("resolves through current mark state and composed shadow containment", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const shadow = new FakeElement("P", rect(0, 0, 120, 20), "Shadow");
    root.ownerDocument = doc;
    shadow.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.shadowRoot = { children: [shadow], childNodes: [shadow], elementsFromPoint: () => [shadow] };
    shadow.shadowHost = root;
    doc.hits = [shadow, root];

    const engine = createMarkingEngine(root as unknown as Element);
    const shadowTarget = engine.resolveAtPoint(10, 10, "exclude", true);
    expect(shadowTarget?.xpath).toBe("/main[1]/p[1]");
    if (shadowTarget) {
      engine.toggle(shadowTarget, "exclude");
    }
    const includeTarget = engine.resolveAtPoint(10, 10, "include");
    expect(includeTarget?.xpath).toBe("/main[1]/p[1]");
  });

  it("treats a shadow host top hit as reachable for open-shadow content", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const shadow = new FakeElement("P", rect(10, 10, 100, 20), "Shadow");
    host.ownerDocument = doc;
    shadow.ownerDocument = doc;
    shadow.shadowHost = host;
    doc.hits = [host];

    expect(isPaintReachable(shadow as unknown as Element, doc as unknown as Document)).toBe(true);
  });

  it("uses the clicked point for engine paint reachability instead of only the target center", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const target = new FakeElement("P", rect(0, 0, 100, 100), "Large target");
    const cover = new FakeElement("DIV", rect(40, 40, 30, 30), "Center cover");
    root.ownerDocument = doc;
    target.ownerDocument = doc;
    cover.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(target);
    doc.pointHits = (x) => x < 20 ? [target, root] : [cover, target, root];

    const engine = createMarkingEngine(root as unknown as Element);

    expect(engine.resolveAtPoint(10, 10, "exclude", true)?.xpath).toBe("/main[1]/p[1]");
  });

  it("flattens and marks a closed root captured by early instrumentation", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("X-CLOSED", rect(0, 0, 100, 20), "host");
    const shadow = new FakeElement("P", rect(0, 0, 100, 20), "Shadow copy");
    host.ownerDocument = doc;
    shadow.ownerDocument = doc;
    shadow.shadowHost = host;
    host.shadowRoot = { children: [shadow], childNodes: [shadow], elementsFromPoint: () => [shadow] };

    markClosedShadowHost(host as unknown as Element);
    const view = createDomBridgeView(host as unknown as Element);

    expect(view.root.closedShadow).toBe(false);
    expect(view.byXpath.get("/x-closed[1]/p[1]")?.element).toBe(shadow);
    expect(captureFlattenedHtml(host as unknown as Element)).toBe(
      "<x-closed><p>Shadow copy</p>host</x-closed>",
    );
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(host);
    const engine = createMarkingEngine(host as unknown as Element, {
      selectors: { inclusionSelectors: ["p"], exclusionSelectors: [] },
    });
    expect(engine.lastInitializationSeededSelectors()).toBe(true);
    expect(engine.rows()).toContainEqual({
      xpath: "/x-closed[1]/p[1]",
      excluded: false,
      explicit: true,
    });
    engine.dispose();
  });

  it("omits only an inaccessible closed root while preserving its host and light DOM", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const closed = new FakeElement("DIV", rect(0, 0, 100, 20), "Closed");
    const light = new FakeElement("SPAN", rect(0, 0, 80, 20), "Light");
    const content = new FakeElement("DIV", rect(0, 30, 100, 20), "Content");
    markClosedShadowHost(closed as unknown as Element);
    root.ownerDocument = doc;
    closed.ownerDocument = doc;
    light.ownerDocument = doc;
    content.ownerDocument = doc;
    closed.appendChild(light);
    root.appendChild(closed);
    root.appendChild(content);
    doc.hits = [closed, root];

    const view = createDomBridgeView(root as unknown as Element);
    const engine = createMarkingEngine(root as unknown as Element);
    engine.renderReadOnly();
    const submission = engine.buildSubmission({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
    });
    expect([...view.byXpath.keys()]).toContain("/section[1]/div[1]");
    expect([...view.byXpath.keys()]).toContain("/section[1]/div[1]/span[1]");
    expect([...view.byXpath.keys()]).toContain("/section[1]/div[2]");
    expect([...view.byXpath.keys()].some((xpath) => xpath.includes("__closed-shadow"))).toBe(false);
    expect(engine.resolveAtPoint(10, 10, "include")?.xpath).toBe("/section[1]/div[1]");
    expect(engine.captureRenderedHtml()).toBe(
      "<section><div>Closed<span>Light</span></div><div>Content</div></section>",
    );
    expect(submission.pages[0]?.renderedXPaths).toContainEqual({
      xpath: "/section[1]/div[1]",
      excluded: false,
    });
    expect(submission.pages[0]?.renderedXPaths.every((row) =>
      /^\/(?:[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\])(?:\/[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\])*$/.test(row.xpath)
    )).toBe(true);
  });

  it("captures nested open and captured-closed shadow HTML", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const shadow = new FakeElement("P", rect(0, 0, 100, 20), "Shadow");
    const closed = new FakeElement("DIV", rect(0, 30, 100, 20), "Closed");
    const closedShadow = new FakeElement("EM", rect(0, 30, 80, 20), "Captured");
    const content = new FakeElement("DIV", rect(0, 60, 100, 20), "Content");
    markClosedShadowHost(closed as unknown as Element);
    for (const element of [root, shadow, closed, closedShadow, content]) {
      element.ownerDocument = doc;
    }
    root.shadowRoot = { children: [shadow], childNodes: [shadow], elementsFromPoint: () => [shadow] };
    closedShadow.shadowHost = closed;
    closed.shadowRoot = {
      children: [closedShadow],
      childNodes: [closedShadow],
      elementsFromPoint: () => [closedShadow],
    };
    root.appendChild(closed);
    root.appendChild(content);

    expect(captureFlattenedHtml(root as unknown as Element)).toBe(
      "<section><p>Shadow</p><div><em>Captured</em>Closed</div><div>Content</div></section>",
    );
  });

  it("captures direct open-shadow text nodes", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    root.ownerDocument = doc;
    root.shadowRoot = {
      children: [],
      childNodes: [{ nodeType: 3, textContent: "Shadow text" }],
      elementsFromPoint: () => [],
    } as unknown as FakeElement["shadowRoot"];

    expect(captureFlattenedHtml(root as unknown as Element)).toBe("<section>Shadow text</section>");
  });

  it("flattens slotted nodes in composed order without duplicating light DOM", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const before = new FakeElement("P", rect(0, 0, 100, 20), "Before");
    const slot = new FakeElement("SLOT", rect(0, 20, 100, 20));
    const assigned = new FakeElement("P", rect(0, 20, 100, 20), "Assigned");
    const after = new FakeElement("P", rect(0, 40, 100, 20), "After");
    const unassigned = new FakeElement("P", rect(0, 60, 100, 20), "Unassigned light");
    for (const element of [host, before, slot, assigned, after, unassigned]) {
      element.ownerDocument = doc;
    }
    slot.assigned = [assigned];
    assigned.shadowHost = host;
    before.shadowHost = host;
    slot.shadowHost = host;
    after.shadowHost = host;
    host.shadowRoot = {
      children: [before, slot, after],
      childNodes: [before, slot, after],
      elementsFromPoint: () => [],
    };
    host.appendChild(assigned);
    host.appendChild(unassigned);

    const view = createDomBridgeView(host as unknown as Element);
    expect([...view.byXpath.keys()]).toEqual([
      "/section[1]/p[1]",
      "/section[1]/p[2]",
      "/section[1]/p[3]",
      "/section[1]/p[4]",
      "/section[1]",
    ]);
    expect(captureFlattenedHtml(host as unknown as Element)).toBe(
      "<section><p>Before</p><p>Assigned</p><p>After</p><p>Unassigned light</p></section>",
    );
  });

  it("flattens a slot nested below a shadow wrapper without duplicating its assigned light node", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("X-CARD", rect(0, 0, 300, 300));
    const wrapper = new FakeElement("DIV", rect(0, 0, 300, 100));
    const slot = new FakeElement("SLOT", rect(0, 20, 100, 20));
    const assigned = new FakeElement("P", rect(0, 20, 100, 20), "Assigned nested");
    const unassigned = new FakeElement("P", rect(0, 60, 100, 20), "Unassigned light");
    for (const element of [host, wrapper, slot, assigned, unassigned]) {
      element.ownerDocument = doc;
    }
    wrapper.shadowHost = host;
    slot.shadowHost = host;
    assigned.shadowHost = host;
    wrapper.appendChild(slot);
    slot.assigned = [assigned];
    host.shadowRoot = {
      children: [wrapper],
      childNodes: [wrapper],
      elementsFromPoint: () => [],
    };
    host.appendChild(assigned);
    host.appendChild(unassigned);

    expect(captureFlattenedHtml(host as unknown as Element)).toBe(
      "<x-card><div><p>Assigned nested</p></div><p>Unassigned light</p></x-card>",
    );
    expect([...createDomBridgeView(host as unknown as Element).byXpath.keys()]).toEqual([
      "/x-card[1]/div[1]/p[1]",
      "/x-card[1]/div[1]",
      "/x-card[1]/p[1]",
      "/x-card[1]",
    ]);
  });

  it("keeps consent-suppressed page DOM in payload rows and capture without making it interactive", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const suppressed = new FakeElement("P", rect(0, 0, 200, 40), "Hidden modal copy");
    const content = new FakeElement("P", rect(0, 50, 200, 40), "Page content");
    for (const element of [root, suppressed, content]) {
      element.ownerDocument = doc;
    }
    suppressed.setAttribute("class", "cookie-modal");
    suppressed.setAttribute("style", "opacity: 0 !important; visibility: hidden !important; pointer-events: none !important");
    suppressed.setAttribute(CONSENT_HIDDEN_ATTR, "true");
    root.appendChild(suppressed);
    root.appendChild(content);

    const before = new Map(suppressed.attributes);
    const view = createDomBridgeView(root as unknown as Element);
    const captured = captureFlattenedHtml(root as unknown as Element);
    const engine = createMarkingEngine(root as unknown as Element);
    const submission = engine.buildSubmission({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
    });
    const projection = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: [],
    });

    expect(view.byElement.has(suppressed as unknown as Element)).toBe(true);
    expect(view.byElement.get(suppressed as unknown as Element)?.evaluationNode).toMatchObject({
      xpath: "/main[1]/p[1]",
      visible: false,
      interactionSuppressed: true,
    });
    expect(view.byElement.get(content as unknown as Element)?.evaluationNode.xpath).toBe("/main[1]/p[2]");
    expect(engine.rows()).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });
    expect(projection.rows.some((row) => row.text === "Hidden modal copy")).toBe(false);
    expect(projection.rows.some((row) => row.text === "Page content")).toBe(true);
    expect(captured).toBe('<main><p class="cookie-modal">Hidden modal copy</p><p>Page content</p></main>');
    expect(submission.pages[0]?.renderedHtml).toBe(captured);
    expect(submission.pages[0]?.renderedXPaths).toContainEqual({
      xpath: "/main[1]/p[1]",
      excluded: true,
      explicit: true,
    });
    expect(suppressed.attributes).toEqual(before);
  });

  it("projects authored top-layer display, inert, and pointer-events through shield neutralization", () => {
    const doc = new FakeDocument();
    const dialog = new FakeElement("DIALOG", rect(0, 0, 300, 200), "Authored dialog");
    dialog.ownerDocument = doc;
    dialog.setAttribute("style", "color: red; display: none !important; pointer-events: none !important");
    dialog.setAttribute("inert", "site-lock");
    rememberInteractionShieldCaptureState(dialog as unknown as Element, {
      hadStyleAttribute: true,
      display: { value: "grid", priority: "important" },
      pointerEvents: { value: "auto", priority: "important" },
      inertAttribute: "site-lock",
    });

    try {
      expect(captureFlattenedHtml(dialog as unknown as Element)).toBe(
        '<dialog style="color: red; display: grid !important; pointer-events: auto !important" inert="site-lock">Authored dialog</dialog>',
      );
      expect(dialog.getAttribute("style")).toBe(
        "color: red; display: none !important; pointer-events: none !important",
      );
      expect(dialog.getAttribute("inert")).toBe("site-lock");
    } finally {
      forgetInteractionShieldCaptureState(dialog as unknown as Element);
    }
  });

  it("removes extension-added top-layer display, inert, and pointer-events only from capture", () => {
    const doc = new FakeDocument();
    const dialog = new FakeElement("DIALOG", rect(0, 0, 300, 200), "Shielded dialog");
    dialog.ownerDocument = doc;
    dialog.setAttribute("style", "display: none !important; pointer-events: none !important");
    dialog.setAttribute("inert", "");
    rememberInteractionShieldCaptureState(dialog as unknown as Element, {
      hadStyleAttribute: false,
      display: { value: "", priority: "" },
      pointerEvents: { value: "", priority: "" },
      inertAttribute: null,
    });

    try {
      expect(captureFlattenedHtml(dialog as unknown as Element)).toBe(
        "<dialog>Shielded dialog</dialog>",
      );
      expect(dialog.getAttribute("style")).toBe(
        "display: none !important; pointer-events: none !important",
      );
      expect(dialog.getAttribute("inert")).toBe("");
    } finally {
      forgetInteractionShieldCaptureState(dialog as unknown as Element);
    }
  });

  it("projects a neutralized open-shadow top layer without mutating its live ledger state", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("X-MODAL", rect(0, 0, 300, 200));
    const dialog = new FakeElement("DIALOG", rect(0, 0, 300, 200), "Shadow dialog");
    for (const element of [host, dialog]) element.ownerDocument = doc;
    dialog.shadowHost = host;
    dialog.setAttribute("style", "display: none !important; pointer-events: none !important");
    dialog.setAttribute("inert", "");
    host.shadowRoot = {
      children: [dialog],
      childNodes: [dialog],
      elementsFromPoint: () => [dialog],
    };
    rememberInteractionShieldCaptureState(dialog as unknown as Element, {
      hadStyleAttribute: true,
      display: { value: "grid", priority: "important" },
      pointerEvents: { value: "auto", priority: "important" },
      inertAttribute: null,
    });

    try {
      expect(captureFlattenedHtml(host as unknown as Element)).toBe(
        '<x-modal><dialog style="display: grid !important; pointer-events: auto !important">Shadow dialog</dialog></x-modal>',
      );
      expect(dialog.getAttribute("style")).toBe(
        "display: none !important; pointer-events: none !important",
      );
      expect(dialog.getAttribute("inert")).toBe("");
    } finally {
      forgetInteractionShieldCaptureState(dialog as unknown as Element);
    }
  });

  it("leaves neutralized live state untouched when capture serialization throws", () => {
    const doc = new FakeDocument();
    const dialog = new FakeElement("DIALOG", rect(0, 0, 300, 200), "Hostile dialog");
    dialog.ownerDocument = doc;
    dialog.setAttribute("style", "display: none !important; pointer-events: none !important");
    dialog.setAttribute("inert", "");
    dialog.setAttribute("data-hostile", "value");
    const originalGetAttribute = dialog.getAttribute.bind(dialog);
    dialog.getAttribute = (name: string): string | null => {
      if (name === "data-hostile") throw new Error("hostile attribute getter");
      return originalGetAttribute(name);
    };
    rememberInteractionShieldCaptureState(dialog as unknown as Element, {
      hadStyleAttribute: false,
      display: { value: "", priority: "" },
      pointerEvents: { value: "", priority: "" },
      inertAttribute: null,
    });

    try {
      expect(() => captureFlattenedHtml(dialog as unknown as Element)).toThrow("hostile attribute getter");
      expect(dialog.getAttribute("style")).toBe(
        "display: none !important; pointer-events: none !important",
      );
      expect(dialog.getAttribute("inert")).toBe("");
    } finally {
      forgetInteractionShieldCaptureState(dialog as unknown as Element);
    }
  });

  it("omits current and live-update legacy consent bypass styles from every capture path", () => {
    for (const bypassId of [CONSENT_BYPASS_STYLE_ID, LEGACY_CONSENT_BYPASS_STYLE_ID]) {
      const doc = new FakeDocument();
      const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
      const bypass = new FakeElement("STYLE", rect(0, 0, 0, 0), "helper");
      const content = new FakeElement("P", rect(0, 20, 100, 20), "Content");
      bypass.id = bypassId;
      for (const element of [root, bypass, content]) {
        element.ownerDocument = doc;
      }
      root.appendChild(bypass);
      root.appendChild(content);

      expect(captureFlattenedHtml(root as unknown as Element)).toBe("<main><p>Content</p></main>");
      expect(stripUncapturableHtml(`<main><style id="${bypassId}">helper</style><p>Content</p></main>`))
        .toBe("<main><p>Content</p></main>");
    }
  });

  it("removes extension cursor classes from every captured HTML path", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("HTML", rect(0, 0, 300, 300));
    root.ownerDocument = doc;
    root.setAttribute("class", "site-theme uf-cursor-exclude uf-cursor-disabled");

    expect(captureFlattenedHtml(root as unknown as Element)).toBe(
      '<html class="site-theme"></html>',
    );
    expect(stripUncapturableHtml(
      '<html class="site-theme uf-cursor-include uf-cursor-passthrough"><body>Content</body></html>',
    )).toBe('<html class="site-theme"><body>Content</body></html>');
    expect(stripUncapturableHtml(
      "<html class='uf-cursor-exclude'><body>Content</body></html>",
    )).toBe("<html><body>Content</body></html>");
  });

  it("removes root blocker posture classes without changing nested authored classes", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("HTML", rect(0, 0, 300, 300));
    const body = new FakeElement("BODY", rect(0, 0, 300, 300));
    const content = new FakeElement("MAIN", rect(0, 0, 300, 300), "Content");
    root.ownerDocument = doc;
    body.ownerDocument = doc;
    content.ownerDocument = doc;
    root.setAttribute("class", "theme noScroll modal-open");
    body.setAttribute("class", "page detect-customer-type-country--active");
    content.setAttribute("class", "modal-open");
    root.appendChild(body);
    body.appendChild(content);

    expect(captureFlattenedHtml(root as unknown as Element)).toBe(
      '<html class="theme"><body class="page"><main class="modal-open">Content</main></body></html>',
    );
    expect(stripUncapturableHtml(
      '<html class="theme no-scroll"><body class="page detect-customer-type-country--active"><main class="modal-open">Content</main></body></html>',
    )).toBe(
      '<html class="theme"><body class="page"><main class="modal-open">Content</main></body></html>',
    );
  });

  it("retains legacy consent-hidden page content while stripping helper attributes", () => {
    expect(stripUncapturableHtml(
      '<main><div data-uf-consent-hidden="true" style="color: red"><p>Modal copy</p></div><p style="color: blue">Page copy</p></main>',
    )).toBe('<main><div style="color: red"><p>Modal copy</p></div><p style="color: blue">Page copy</p></main>');
  });

  it("retains consent-hidden subtrees regardless of helper attribute quoting", () => {
    expect(stripUncapturableHtml(
      `<main><section ${CONSENT_HIDDEN_ATTR}='true'><div>Country modal</div></section><p>Content</p></main>`,
    )).toBe("<main><section><div>Country modal</div></section><p>Content</p></main>");
  });

  it("strips production source bodies without disturbing element identity or adjacent content", () => {
    const source = [
      '<main><p>Before</p>',
      '<ScRiPt data-expression="1 > 0">window.template = "<section>not markup</section>";</sCrIpT>',
      '<style media="screen and (width > 1px)">.cookie-banner { display: block; }</STYLE>',
      '<NOSCRIPT><aside><p>Enable JavaScript</p></aside></noscript>',
      '<script type="application/ld+json" />',
      '<p class="real-copy">After</p></main>',
    ].join("");

    expect(stripUncapturableHtml(source)).toBe(
      '<main><p>Before</p><ScRiPt data-expression="1 > 0"></sCrIpT><style media="screen and (width > 1px)"></STYLE><NOSCRIPT></noscript><script type="application/ld+json" /><p class="real-copy">After</p></main>',
    );
  });

  it("submits a row for direct open-shadow text captured on the host", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    root.ownerDocument = doc;
    root.shadowRoot = {
      children: [],
      childNodes: [{ nodeType: 3, textContent: "Shadow text" }],
      elementsFromPoint: () => [],
    } as unknown as FakeElement["shadowRoot"];

    const engine = createMarkingEngine(root as unknown as Element);

    expect(engine.rows()).toEqual([{ xpath: "/section[1]", excluded: false }]);
  });

  it("includes captured-closed descendants in composed page-shell metadata", () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SECTION", rect(0, 0, 200, 200), "Wrapper");
    const closed = new FakeElement("X-CLOSED", rect(0, 0, 200, 200));
    const header = new FakeElement("HEADER", rect(0, 0, 200, 50), "Header");
    const nav = new FakeElement("NAV", rect(0, 50, 200, 50), "Nav");
    markClosedShadowHost(closed as unknown as Element);
    for (const element of [wrapper, closed, header, nav]) {
      element.ownerDocument = doc;
    }
    header.shadowHost = closed;
    nav.shadowHost = closed;
    closed.shadowRoot = { children: [header, nav], childNodes: [header, nav], elementsFromPoint: () => [] };
    wrapper.appendChild(closed);

    const view = createDomBridgeView(wrapper as unknown as Element);

    expect(view.root.landmarkCount).toBe(2);
    expect(view.root.pageShell).toBe(true);
  });

  it("does not build or target descendants inside immutable subtrees", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const svg = new FakeElement("svg", rect(0, 0, 100, 100));
    const title = new FakeElement("text", rect(0, 0, 100, 20), "Icon text");
    root.ownerDocument = doc;
    svg.ownerDocument = doc;
    title.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    svg.appendChild(title);
    root.appendChild(svg);
    doc.hits = [title, svg, root];

    const view = createDomBridgeView(root as unknown as Element);
    const engine = createMarkingEngine(root as unknown as Element);

    expect(view.byElement.has(title as unknown as Element)).toBe(false);
    expect(engine.resolveAtPoint(10, 10, "exclude")).toBeNull();
  });

  it("keeps actual shadow paint hits before recovered pointer-suppressed descendants", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const painted = new FakeElement("P", rect(0, 0, 100, 20), "Painted");
    const suppressed = new FakeElement("SPAN", rect(0, 0, 100, 20), "Suppressed");
    suppressed.style.pointerEvents = "none";
    host.ownerDocument = doc;
    painted.ownerDocument = doc;
    suppressed.ownerDocument = doc;
    host.shadowRoot = { children: [suppressed, painted], elementsFromPoint: () => [painted] };
    doc.hits = [host];

    expect(getComposedHitElements(doc as unknown as Document, 10, 10)[0]).toBe(painted);
  });

  it("looks through the pointer-capturing extension overlay to the page hit stack", () => {
    const doc = new FakeDocument();
    const overlay = new FakeElement("DIV", rect(0, 0, 300, 300));
    const paragraph = new FakeElement("P", rect(0, 0, 100, 20), "Painted");
    overlay.ownerDocument = doc;
    paragraph.ownerDocument = doc;
    overlay.setAttribute("data-uf-extension-ui", "true");
    doc.hits = [overlay, paragraph];

    expect(getComposedHitElements(doc as unknown as Document, 10, 10)).toEqual([paragraph]);
  });

  it("orders pointer-suppressed descendants before their painted shadow ancestor", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const header = new FakeElement("HEADER", rect(0, 0, 200, 50), "Header");
    const span = new FakeElement("SPAN", rect(10, 10, 100, 20), "Transparent text");
    span.style.pointerEvents = "none";
    host.ownerDocument = doc;
    header.ownerDocument = doc;
    span.ownerDocument = doc;
    header.appendChild(span);
    host.shadowRoot = { children: [header], elementsFromPoint: () => [header] };
    doc.hits = [host];

    expect(getComposedHitElements(doc as unknown as Document, 10, 10).slice(0, 2)).toEqual([span, header]);
  });

  it("orders nested open-shadow hits deepest-first", () => {
    const doc = new FakeDocument();
    const outer = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const innerHost = new FakeElement("ARTICLE", rect(0, 0, 200, 200), "Host");
    const innerLeaf = new FakeElement("P", rect(10, 10, 100, 20), "Leaf");
    outer.ownerDocument = doc;
    innerHost.ownerDocument = doc;
    innerLeaf.ownerDocument = doc;
    innerHost.shadowRoot = { children: [innerLeaf], elementsFromPoint: () => [innerLeaf] };
    outer.shadowRoot = { children: [innerHost], elementsFromPoint: () => [innerHost] };
    doc.hits = [outer];

    expect(getComposedHitElements(doc as unknown as Document, 10, 10).slice(0, 2)).toEqual([innerLeaf, innerHost]);
  });

  it("fences Chromium shadow hit stacks that repeat their hosts without losing nested order", () => {
    const doc = new FakeDocument();
    const outerHost = new FakeElement("X-OUTER", rect(0, 0, 300, 300));
    const innerHost = new FakeElement("X-INNER", rect(0, 0, 200, 200), "Host");
    const innerLeaf = new FakeElement("P", rect(10, 10, 100, 20), "Leaf");
    for (const element of [outerHost, innerHost, innerLeaf]) {
      element.ownerDocument = doc;
    }
    const innerHits = vi.fn(() => [innerLeaf, innerHost]);
    const outerHits = vi.fn(() => [innerHost, outerHost]);
    innerHost.shadowRoot = { children: [innerLeaf], elementsFromPoint: innerHits };
    outerHost.shadowRoot = { children: [innerHost], elementsFromPoint: outerHits };
    doc.hits = [outerHost];

    expect(getComposedHitElements(doc as unknown as Document, 10, 10)).toEqual([
      innerLeaf,
      innerHost,
      outerHost,
    ]);
    expect(outerHits).toHaveBeenCalledOnce();
    expect(innerHits).toHaveBeenCalledOnce();
  });

  it("installs an attachShadow hook that marks closed hosts", () => {
    class InstrumentedElement extends FakeElement {
      attachShadow(_init: ShadowRootInit): ShadowRoot {
        return {} as ShadowRoot;
      }
    }
    const win = { Element: InstrumentedElement } as unknown as Window;
    const restore = installClosedShadowHostInstrumentation(win);
    const host = new InstrumentedElement("X-CLOSED", rect(0, 0, 100, 20));

    host.attachShadow({ mode: "closed" });
    restore();

    expect(host.getAttribute("data-uf-closed-shadow-host")).toBe("true");
  });

  it("keeps explicit inclusions plain-clearable while Alt transfers them to descendants", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300), "Boundary");
    const child = new FakeElement("P", rect(0, 0, 140, 30));
    const span = new FakeElement("SPAN", rect(5, 5, 120, 20));
    const strong = new FakeElement("STRONG", rect(10, 5, 100, 20), "Nested child");
    for (const element of [root, child, span, strong]) element.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    span.appendChild(strong);
    child.appendChild(span);
    root.appendChild(child);
    doc.hits = [root];
    const engine = createMarkingEngine(root as unknown as Element, {
      instrumentation: {
        // The renderer's spatial owner index is intentionally unavailable for
        // a short generation-fenced window after a paint/scroll refresh. The
        // semantic fallback must still recognize and clear the closed explicit
        // include owner immediately instead of waiting for that fast path.
        createRenderer: (options) => ({
          ...createOverlayRenderer(options),
          paintedExplicitOwnerAtPoint: () => null,
          paintedExclusionOwnerAtPoint: () => null,
          paintedMutableBoundaryAtPoint: () => null,
        }),
      },
    });
    engine.toggle(engine.resolveAtPoint(10, 10, "include")!, "include");
    doc.hits = [child, root];

    const plainOwner = engine.resolveAtPoint(10, 10, "exclude");
    expect(plainOwner?.xpath).toBe("/section[1]");
    expect(engine.toggle(plainOwner!, "exclude")).toBe(true);
    expect(engine.hasExplicitMark(plainOwner!)).toBe(false);
    // Start a fresh explicit parent decision, then prove Alt targets and moves
    // that decision to the painted child instead of closing at the parent.
    doc.hits = [root];
    expect(engine.toggle(engine.resolveAtPoint(10, 10, "include")!, "include")).toBe(true);
    doc.hits = [strong, span, child, root];
    const altChild = engine.resolveAtPoint(10, 10, "include");
    expect(altChild?.xpath).toBe("/section[1]/p[1]/span[1]/strong[1]");
    expect(engine.toggle(altChild!, "include")).toBe(true);
    expect(engine.hasExplicitMark(altChild!)).toBe(true);
    expect(engine.hasExplicitMark(plainOwner!)).toBe(false);
    const painted = engine.overlayRoot().children.flatMap((layer) => layer.children);
    const formerOwner = painted.find((box) =>
      box.getAttribute("data-uf-overlay-xpath") === "/section[1]"
    );
    const transferredChild = painted.find((box) =>
      box.getAttribute("data-uf-overlay-xpath") === "/section[1]/p[1]/span[1]/strong[1]"
    );
    expect(formerOwner?.className).not.toContain("uf-explicit-include");
    expect(transferredChild?.className).toBe("uf-rect uf-explicit-include");

    const preview = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: [],
    });
    expect(preview.rows.filter((row) => row.classification === "explicit-included"))
      .toEqual([expect.objectContaining({ xpath: altChild?.xpath })]);
    const submission = engine.buildSubmission({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
    });
    expect(submission.pages[0]?.renderedXPaths.filter((row) => row.explicit === true))
      .toEqual([{ xpath: altChild?.xpath, excluded: false, explicit: true }]);

    // Repeating Alt clears then recreates only the descendant decision. The
    // former ancestor never regains an explicit layer or payload row.
    expect(engine.toggle(altChild!, "include")).toBe(true);
    expect(engine.hasExplicitMark(altChild!)).toBe(false);
    expect(engine.hasExplicitMark(plainOwner!)).toBe(false);
    expect(engine.toggle(altChild!, "include")).toBe(true);
    expect(engine.hasExplicitMark(altChild!)).toBe(true);
    expect(engine.hasExplicitMark(plainOwner!)).toBe(false);
    engine.dispose();
  });
});
