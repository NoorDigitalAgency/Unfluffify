import { describe, expect, it, vi } from "vitest";

import {
  CONSENT_BYPASS_STYLE_ID,
  CONSENT_HIDDEN_ATTR,
  LEGACY_CONSENT_BYPASS_STYLE_ID,
} from "../../../../src/content/consent";
import {
  createDomBridgeView,
  createMarkingEngine,
  createOverlayRenderer,
  captureFlattenedHtml,
  getComposedHitElements,
  installClosedShadowHostInstrumentation,
  isPaintReachable,
  MARKING_OVERLAY_STYLE_ID,
  markClosedShadowHost,
  previewTextForElement,
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
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    return selector.toLowerCase() === this.tagName.toLowerCase();
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
      overflowY: element.style.overflowY ?? "visible",
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
  const hoverRender = vi.fn();
  const createRenderer = vi.fn((options: Parameters<typeof createOverlayRenderer>[0]) => {
    const renderer = createOverlayRenderer(options);
    return {
      ...renderer,
      render(...args: Parameters<typeof renderer.render>): void {
        markingRender();
        renderer.render(...args);
      },
      renderBranch(...args: Parameters<typeof renderer.renderBranch>): void {
        branchRender();
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
      setHover(...args: Parameters<typeof renderer.setHover>): void {
        hoverRender(...args);
        renderer.setHover(...args);
      },
    };
  });
  return { createRenderer, markingRender, branchRender, silentRender, silentBranchRender, hoverRender };
}

describe("P6 DOM bridge", () => {
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

  it("rejects genuinely covered elements even when they appear below the top hit", () => {
    const doc = new FakeDocument();
    const target = new FakeElement("P", rect(0, 0, 100, 20), "Covered");
    const cover = new FakeElement("DIV", rect(0, 0, 100, 20));
    target.ownerDocument = doc;
    cover.ownerDocument = doc;
    doc.hits = [cover, target];

    expect(isPaintReachable(target as unknown as Element, doc as unknown as Document)).toBe(false);
  });

  it("reuses hover resolution until a bridge refresh invalidates it", () => {
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

    engine.hoverAtPoint(20, 15, "exclude", false, hint);
    const firstProbeReads = doc.hitReadCount;
    const firstHoverRenders = rendererSeam.hoverRender.mock.calls.length;
    engine.hoverAtPoint(40, 15, "exclude", false, hint);

    expect(doc.hitReadCount).toBe(firstProbeReads);
    expect(rendererSeam.hoverRender).toHaveBeenCalledTimes(firstHoverRenders);

    engine.refresh();
    engine.hoverAtPoint(40, 15, "exclude", false, hint);

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

    expect(engine.resolveAtPoint(20, 15, "exclude", false, {
      overlayXpath: "/main[1]/stale[1]",
    })?.xpath).toBe("/main[1]/p[1]");
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

    expect(engine.resolveAtPoint(20, 15, "exclude")?.xpath).toBe("/main[1]/article[1]/p[1]");
    expect(doc.hitReadCount).toBe(1);

    // Reachability must still use the full point stack before root filtering:
    // an unrelated painted cover outside the engine root blocks every root
    // candidate, without causing a second native hit-test per candidate.
    doc.hits = [cover, paragraph, article, root];
    doc.hitReadCount = 0;
    expect(engine.resolveAtPoint(20, 15, "exclude")).toBeNull();
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
    expect(engine.resolveAtPoint(10, 30, "exclude")?.xpath).not.toBe(blankXpath);

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
    const target = engine.resolveAtPoint(10, 10, "exclude");
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
    expect(engine.overlayRoot().style.position).toBe("fixed");
    expect(engine.overlayRoot().getAttribute("data-uf-extension-ui")).toBe("true");
    expect(doc.documentElement.children.some((element) => element.id === MARKING_OVERLAY_STYLE_ID)).toBe(true);

    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    renderer.clear();
    expect(renderer.root.children).toHaveLength(13);
    expect(renderer.root.children.every((layer) => layer.children.length === 0)).toBe(true);
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
    expect(engine.activatePreviewRow(before.projectionId, original!.id)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(engine.emphasizePreviewRow("stale-projection", original!.id, true)).toBe(false);
    expect(engine.activatePreviewRow(before.projectionId, "missing-row")).toBe(false);

    const after = engine.projectPreview("https://example.com/page", selectors);
    const rebased = after.rows.find((row) => row.text === "Original target");
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(rebased).toMatchObject({ id: original!.id, xpath: "/main[1]/p[2]" });
  });

  it("falls back to the root scroller when a storefront ignores scrollIntoView", () => {
    const doc = new FakeDocument();
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
    expect(doc.documentElement.scrollTop).toBe(520);
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
    renderer.hoverRender.mockClear();

    const decoy = new FakeElement("P", rect(0, 0, 120, 20), "Prepended decoy");
    decoy.ownerDocument = doc;
    decoy.parentElement = root;
    root.children.unshift(decoy);
    root.childNodes.unshift(decoy);
    engine.refresh();

    expect(renderer.hoverRender).toHaveBeenLastCalledWith(
      target as unknown as Element,
      "/main[1]/p[2]",
    );

    renderer.hoverRender.mockClear();
    target.remove();
    engine.refresh();
    expect(renderer.hoverRender).toHaveBeenLastCalledWith(null);
    expect(engine.emphasizePreviewRow(projection.projectionId, rowId, true)).toBe(false);

    // Reappearance alone must not resurrect an emphasis whose identity was
    // cleared when the row disappeared.
    renderer.hoverRender.mockClear();
    root.appendChild(target);
    engine.refresh();
    expect(renderer.hoverRender).not.toHaveBeenCalled();
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
    renderer.hoverRender.mockClear();

    const excluded = engine.projectPreview("https://example.com/page", {
      inclusionSelectors: [],
      exclusionSelectors: ["main"],
    });
    expect(excluded.projectionId).toBe(included.projectionId);
    expect(excluded.rows.some((row) => row.id === inherited.id)).toBe(false);
    expect(renderer.hoverRender).toHaveBeenLastCalledWith(null);

    renderer.hoverRender.mockClear();
    engine.projectPreview("https://example.com/page", {
      inclusionSelectors: ["main"],
      exclusionSelectors: [],
    });
    expect(renderer.hoverRender).not.toHaveBeenCalled();
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

    const unicode = new FakeElement("P", rect(0, 0, 10, 10), "😀".repeat(90));
    const bounded = previewTextForElement(unicode as unknown as Element);
    expect(Array.from(bounded)).toHaveLength(80);
    expect(bounded).toBe(`${"😀".repeat(77)}...`);
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
    const debugBoxes = renderer.root.children.flatMap((layer) => layer.children);
    expect(debugBoxes.every((box) => box.getAttribute("data-uf-silent-copy") === "true")).toBe(true);
    expect(debugBoxes.map((box) => box.getAttribute("title"))).toContain("XPath: /p[1]");
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
    expect(stages).toEqual(["bridge", "store-evaluate", "candidate-index", "marking-render"]);
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
    expect(stages).toEqual(["bridge", "store-evaluate", "candidate-index", "marking-render"]);
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
    expect(stages).toEqual(["bridge", "store-evaluate", "candidate-index", "silent-render"]);
    expect(engine.lastInitializationSeededSelectors()).toBe(true);
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
      const target = engine.resolveAtPoint(20, 18, "exclude");

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

  it("keeps visible explicit includes through transient covers and ghosts hidden retained includes", () => {
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
    const target = engine.resolveAtPoint(20, 15, "exclude");
    engine.toggle(target!, "include");
    const overlays = (): FakeElement[] => engine.overlayRoot().children
      .flatMap((layer) => layer.children)
      .filter((overlay) => overlay.getAttribute("data-uf-overlay-xpath") === "/main[1]/p[1]");

    doc.hits = [root];
    engine.renderReadOnly();
    expect(overlays().map((overlay) => overlay.className)).toEqual(["uf-rect uf-explicit-include"]);

    paragraph.style.visibility = "hidden";
    engine.refresh();
    engine.renderReadOnly();
    expect(overlays().map((overlay) => overlay.className)).toEqual(["uf-rect uf-explicit-include-ghost"]);
    expect(engine.overlayRoot().children.flatMap((layer) => layer.children).some((overlay) =>
      overlay.className.includes("uf-explicit-exclude-ghost")
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
    const target = engine.resolveAtPoint(20, 15, "exclude");
    engine.toggle(target!, "exclude");
    paragraph.style.visibility = "hidden";
    engine.refresh();
    engine.renderReadOnly();

    expect(engine.rows().some((row) => row.xpath === "/main[1]/p[1]" && row.excluded)).toBe(true);
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
    const target = engine.resolveAtPoint(20, 15, "exclude");
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

  it("rebuilds for page mutations but not extension or consent-suppressed mutations", () => {
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

    const second = new FakeElement("P", rect(0, 30, 120, 20), "Second");
    second.ownerDocument = doc;
    root.appendChild(second);
    mutation?.([{
      type: "childList",
      target: root,
      addedNodes: [second],
      removedNodes: [],
    } as unknown as MutationRecord]);

    expect(animationFrames).toHaveLength(0);
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
    vi.advanceTimersByTime(75);
    expect(animationFrames).toHaveLength(0);
    vi.advanceTimersByTime(75);
    expect(animationFrames).toHaveLength(1);
    animationFrames[0]?.();
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[3]", excluded: false });
    engine.dispose();
    vi.useRealTimers();
  });

  it("coalesces presentation attribute churn into one quiet structural refresh", () => {
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
      const engine = createMarkingEngine(root as unknown as Element, {
        instrumentation: { createBridge },
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
      vi.advanceTimersByTime(149);
      expect(animationFrames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();

      expect(createBridge).toHaveBeenCalledTimes(2);
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

  it("keeps the 250 ms marking debounce when silent highlights are also armed", () => {
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
      vi.advanceTimersByTime(249);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      vi.advanceTimersByTime(1);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
      // A settled viewport scroll goes straight to its repaint. It must not
      // enqueue the general stabilizer's sampling frames first.
      expect(animationFrames).toHaveLength(0);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains and repositions a silent-only engine on the next scroll frame", () => {
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
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(1);

      animationFrames.shift()?.();
      expect(animationFrames).toHaveLength(0);
      expect(silentBoxes()).toEqual([retainedBox]);
      expect(retainedBox?.style.visibility).toBe("hidden");

      paragraph.clientRects = [rect(10, 12, 120, 20)];
      doc.hits = [paragraph, root];
      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      animationFrames.shift()?.();
      expect(silentBoxes()).toEqual([retainedBox]);
      expect(retainedBox?.style.visibility).toBe("");
      expect(retainedBox?.style.left).toBe("10px");
      expect(retainedBox?.style.top).toBe("12px");
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
      vi.advanceTimersByTime(19);
      expect(paragraph.clientRectReadCount).toBe(readsBefore);
      vi.advanceTimersByTime(1);
      expect(paragraph.clientRectReadCount).toBeGreaterThan(readsBefore);
      const readsAfterFirstFallback = paragraph.clientRectReadCount;

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      vi.advanceTimersByTime(20);
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

    const target = engine.resolveAtPoint(20, 15, "exclude");
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

    const target = engine.resolveAtPoint(20, 15, "exclude");
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
    const staleTarget = engine.resolveAtPoint(10, 10, "exclude");
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

  it("matches the legacy 052c Shift-widening golden fixture", () => {
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

  it("reconstructs the ancestor hit path so a plain click clears a widened owner", () => {
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
    const shadowTarget = engine.resolveAtPoint(10, 10, "exclude");
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

    expect(engine.resolveAtPoint(10, 10, "exclude")?.xpath).toBe("/main[1]/p[1]");
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
    expect(engine.resolveAtPoint(10, 10, "exclude")?.xpath).toBe("/section[1]/div[1]");
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

  it("omits live consent-suppressed subtrees from rows and capture without mutating the page", () => {
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

    expect(view.byElement.has(suppressed as unknown as Element)).toBe(false);
    expect(view.byElement.get(content as unknown as Element)?.evaluationNode.xpath).toBe("/main[1]/p[1]");
    expect(engine.rows().some((row) => row.xpath === "/main[1]/p[2]")).toBe(false);
    expect(captured).toBe("<main><p>Page content</p></main>");
    expect(submission.pages[0]?.renderedHtml).toBe(captured);
    expect(suppressed.attributes).toEqual(before);
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

  it("removes legacy consent-hidden subtrees without touching adjacent content", () => {
    expect(stripUncapturableHtml(
      '<main><div data-uf-consent-hidden="true" style="color: red"><p>Modal copy</p></div><p style="color: blue">Page copy</p></main>',
    )).toBe('<main><p style="color: blue">Page copy</p></main>');
  });

  it("removes consent-hidden subtrees regardless of helper attribute quoting", () => {
    expect(stripUncapturableHtml(
      `<main><section ${CONSENT_HIDDEN_ATTR}='true'><div>Country modal</div></section><p>Content</p></main>`,
    )).toBe("<main><p>Content</p></main>");
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

  it("keeps closed explicit include descendants untargetable in the engine", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300), "Boundary");
    const child = new FakeElement("P", rect(0, 0, 100, 20), "Child");
    root.ownerDocument = doc;
    child.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(child);
    doc.hits = [root];
    const engine = createMarkingEngine(root as unknown as Element);
    engine.toggle(engine.resolveAtPoint(10, 10, "exclude")!, "include");
    doc.hits = [child, root];

    expect(engine.resolveAtPoint(10, 10, "exclude")).toBeNull();
  });
});
