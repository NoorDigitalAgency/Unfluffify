import { describe, expect, it, vi } from "vitest";

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
} from "../../../../src/content/marking";

type Rect = { left: number; top: number; width: number; height: number; right: number; bottom: number };

class FakeElement {
  readonly childNodes: Array<{ nodeType?: number; textContent?: string } | FakeElement> = [];
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  shadowHost: FakeElement | null = null;
  ownerDocument!: FakeDocument;
  shadowRoot?: { children: FakeElement[]; childNodes?: Array<{ nodeType?: number; textContent?: string } | FakeElement>; elementsFromPoint: (_x: number, _y: number) => FakeElement[] } | null;
  className = "";
  id = "";
  hidden = false;
  clientRects: Rect[] | null = null;
  rectReadCount = 0;
  roleReadCount = 0;

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
    return this.parentElement?.closest(selector) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  contains(element: FakeElement): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }

  getBoundingClientRect(): Rect {
    this.rectReadCount += 1;
    return this.rect;
  }

  getClientRects(): Rect[] {
    return this.clientRects ?? [this.rect];
  }
}

class FakeDocument {
  readonly documentElement: FakeElement;
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
  createElementCount = 0;

  constructor() {
    this.documentElement = this.createElement("html");
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
    return this.pointHits?.(x, y) ?? this.hits;
  }
}

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
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
    expect([...view.byElement.keys()]).not.toContain(chrome as unknown as Element);
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
    expect(engine.overlayRoot().style.pointerEvents).toBe("none");
    expect(engine.overlayRoot().style.position).toBe("fixed");
    expect(engine.overlayRoot().getAttribute("data-uf-extension-ui")).toBe("true");
    expect(doc.documentElement.children.some((element) => element.id === MARKING_OVERLAY_STYLE_ID)).toBe(true);

    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    renderer.clear();
    expect(renderer.root.children).toHaveLength(11);
    expect(renderer.root.children.every((layer) => layer.children.length === 0)).toBe(true);
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

  it("rebuilds for page mutations but not extension chrome mutations", () => {
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
    animationFrames[0]?.();
    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });
  });

  it("coalesces a scroll storm into geometry-only work", () => {
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

    expect(animationFrames).toHaveLength(1);
    animationFrames[0]?.();
    expect(second.rectReadCount).toBe(0);
    expect(engine.rows()).not.toContainEqual({ xpath: "/main[1]/p[2]", excluded: false });
    engine.dispose();
  });

  it("hides layers only for viewport scroll and redraws after the 250 ms debounce", () => {
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
      engine.renderReadOnly();

      listeners.get("scroll")?.({ target: paragraph } as unknown as Event);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      animationFrames.shift()?.();

      listeners.get("scroll")?.({ target: doc } as unknown as Event);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      animationFrames.shift()?.();
      vi.advanceTimersByTime(249);
      expect(engine.overlayRoot().className).toContain("uf-scrolling");
      vi.advanceTimersByTime(1);
      expect(engine.overlayRoot().className).not.toContain("uf-scrolling");
      expect(animationFrames).toHaveLength(1);
      animationFrames.shift()?.();
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

  it("seeds toggleable default exclusions before the first read-only render", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("MAIN", rect(0, 0, 300, 300));
    const footer = new FakeElement("FOOTER", rect(0, 220, 300, 60), "Footer fluff");
    root.ownerDocument = doc;
    footer.ownerDocument = doc;
    doc.documentElement.ownerDocument = doc;
    doc.documentElement.appendChild(root);
    root.appendChild(footer);

    const engine = createMarkingEngine(root as unknown as Element);
    engine.renderReadOnly();
    const footerOverlay = engine.overlayRoot().children.flatMap((layer) => layer.children).find((child) =>
      child.getAttribute("data-uf-overlay-xpath") === "/main[1]/footer[1]"
    );

    expect(engine.rows()).toContainEqual({ xpath: "/main[1]/footer[1]", excluded: true });
    expect(footerOverlay?.className).toBe("uf-rect uf-explicit-exclude");
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

  it("can mark closed shadow hosts through instrumentation metadata", () => {
    const doc = new FakeDocument();
    const host = new FakeElement("X-CLOSED", rect(0, 0, 100, 20), "host");
    host.ownerDocument = doc;

    markClosedShadowHost(host as unknown as Element);
    const view = createDomBridgeView(host as unknown as Element);

    expect(view.root.closedShadow).toBe(true);
  });

  it("keeps closed-shadow hosts out of canonical sibling indexes and unmarkable", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const closed = new FakeElement("DIV", rect(0, 0, 100, 20), "Closed");
    const content = new FakeElement("DIV", rect(0, 30, 100, 20), "Content");
    markClosedShadowHost(closed as unknown as Element);
    root.ownerDocument = doc;
    closed.ownerDocument = doc;
    content.ownerDocument = doc;
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
    const closedOverlay = engine.overlayRoot().children.flatMap((layer) => layer.children).find((child) =>
      child.getAttribute("data-uf-overlay-xpath")?.includes("__closed-shadow")
    );

    expect([...view.byXpath.keys()]).toContain("/section[1]/div[1]");
    expect([...view.byXpath.keys()].some((xpath) => xpath.includes("__closed-shadow"))).toBe(true);
    expect(engine.resolveAtPoint(10, 10, "exclude")).toBeNull();
    expect(engine.captureRenderedHtml()).toBe("<section><div>Content</div></section>");
    expect(closedOverlay?.className).toBe("uf-rect uf-hard-locked uf-closed-shadow");
    expect(submission.pages[0]?.renderedXPaths).toEqual([
      { xpath: "/section[1]/div[1]", excluded: false },
    ]);
    expect(submission.pages[0]?.renderedXPaths.every((row) =>
      /^\/(?:[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\])(?:\/[A-Za-z][A-Za-z0-9:_-]*\[[1-9]\d*\])*$/.test(row.xpath)
    )).toBe(true);
  });

  it("captures flattened open shadow HTML while skipping extension and closed-shadow hosts", () => {
    const doc = new FakeDocument();
    const root = new FakeElement("SECTION", rect(0, 0, 300, 300));
    const shadow = new FakeElement("P", rect(0, 0, 100, 20), "Shadow");
    const closed = new FakeElement("DIV", rect(0, 30, 100, 20), "Closed");
    const content = new FakeElement("DIV", rect(0, 60, 100, 20), "Content");
    markClosedShadowHost(closed as unknown as Element);
    for (const element of [root, shadow, closed, content]) {
      element.ownerDocument = doc;
    }
    root.shadowRoot = { children: [shadow], childNodes: [shadow], elementsFromPoint: () => [shadow] };
    root.appendChild(closed);
    root.appendChild(content);

    expect(captureFlattenedHtml(root as unknown as Element)).toBe(
      "<section><p>Shadow</p><div>Content</div></section>",
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

  it("ignores closed-shadow descendants when computing ancestor page-shell metadata", () => {
    const doc = new FakeDocument();
    const wrapper = new FakeElement("SECTION", rect(0, 0, 200, 200), "Wrapper");
    const closed = new FakeElement("X-CLOSED", rect(0, 0, 200, 200));
    const header = new FakeElement("HEADER", rect(0, 0, 200, 50), "Header");
    const nav = new FakeElement("NAV", rect(0, 50, 200, 50), "Nav");
    markClosedShadowHost(closed as unknown as Element);
    for (const element of [wrapper, closed, header, nav]) {
      element.ownerDocument = doc;
    }
    closed.appendChild(header);
    closed.appendChild(nav);
    wrapper.appendChild(closed);

    const view = createDomBridgeView(wrapper as unknown as Element);

    expect(view.root.landmarkCount).toBe(0);
    expect(view.root.pageShell).toBe(false);
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

    expect([...view.byElement.keys()]).not.toContain(title as unknown as Element);
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
