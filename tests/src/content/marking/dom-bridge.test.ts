import { describe, expect, it } from "vitest";

import {
  createDomBridgeView,
  createMarkingEngine,
  createOverlayRenderer,
  captureFlattenedHtml,
  getComposedHitElements,
  installClosedShadowHostInstrumentation,
  isPaintReachable,
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
    this.children.splice(0);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  contains(element: FakeElement): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }

  getBoundingClientRect(): Rect {
    return this.rect;
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

  constructor() {
    this.documentElement = this.createElement("html");
  }

  createElement(tagName: string): FakeElement {
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
    expect(engine.overlayRoot().children.length).toBeGreaterThan(0);
    expect(engine.overlayRoot().style.pointerEvents).toBe("none");
    expect(engine.overlayRoot().style.position).toBe("fixed");

    const renderer = createOverlayRenderer({ document: doc as unknown as Document });
    renderer.clear();
    expect(renderer.root.children.length).toBe(0);
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

    expect([...view.byXpath.keys()]).toContain("/section[1]/div[1]");
    expect([...view.byXpath.keys()].some((xpath) => xpath.includes("__closed-shadow"))).toBe(true);
    expect(engine.resolveAtPoint(10, 10, "exclude")).toBeNull();
    expect(engine.captureRenderedHtml()).toBe("<section><div>Content</div></section>");
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
