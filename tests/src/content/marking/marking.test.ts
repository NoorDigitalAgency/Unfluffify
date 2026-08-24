import { describe, expect, it } from "vitest";

import type { EvaluationNode } from "../../../../src/domain/evaluate";
import { getXPath } from "../../../../src/domain/xpath";
import {
  buildSilentHighlights,
  buildSubmissionSnapshot,
  createMarkingStore,
  flattenNode,
  MARKING_OVERLAY_CLASSES,
  MARKING_OVERLAY_STYLES,
  overlayClassFor,
  resolveTarget,
  type MarkingCandidate,
} from "../../../../src/content/marking";
import { stripUncapturableHtml } from "../../../../src/content/marking/submit";

const leaf = (key: string, xpath: string): EvaluationNode => ({
  key,
  tagName: "P",
  xpath,
  visible: true,
  ownsDirectText: true,
});

describe("P6 content marking engine", () => {
  it("uses only the actual hit path when refining an excluded boundary", () => {
    const child: MarkingCandidate = {
      key: "child",
      xpath: "/html[1]/body[1]/footer[1]/p[1]",
      selfMarkable: true,
    };
    const footer: MarkingCandidate = {
      key: "footer",
      xpath: "/html[1]/body[1]/footer[1]",
      selfMarkable: true,
      excluded: true,
      children: [child],
    };

    expect(resolveTarget([child, footer], "exclude")).toBe(child);
    expect(resolveTarget([footer], "exclude")).toMatchObject({ key: "footer" });
    expect(resolveTarget([footer], "include")).toBe(footer);
    expect(resolveTarget([footer], "passthrough")).toBeNull();
  });

  it("promotes the nearest mixed direct-text ancestor in include mode", () => {
    const child: MarkingCandidate = {
      key: "child",
      xpath: "/html[1]/body[1]/aside[1]/span[1]",
      selfMarkable: true,
    };
    const mixed: MarkingCandidate = {
      key: "mixed",
      xpath: "/html[1]/body[1]/aside[1]",
      selfMarkable: true,
      excluded: true,
      ownsDirectText: true,
    };

    expect(resolveTarget([child, mixed], "include")).toBe(mixed);
  });

  it("does not create explicit includes for ordinary already-included content", () => {
    expect(resolveTarget([{
      key: "content",
      xpath: "/html[1]/body[1]/main[1]/p[1]",
      selfMarkable: true,
    }], "include")).toBeNull();
  });

  it("keeps explicit include boundaries closed until the boundary itself is removed", () => {
    const include: MarkingCandidate = {
      key: "include",
      xpath: "/html[1]/body[1]/section[1]",
      selfMarkable: true,
      explicitInclude: true,
    };
    const child: MarkingCandidate = {
      key: "child",
      xpath: "/html[1]/body[1]/section[1]/p[1]",
      selfMarkable: true,
      parent: include,
    };

    expect(resolveTarget([child, include], "exclude")).toBeNull();
    expect(resolveTarget([include], "exclude")).toBe(include);
    expect(resolveTarget([child, include], "include")).toBe(include);
  });

  it("flattens open shadow children, skips extension UI, and marks closed shadow hosts", () => {
    const flattened = flattenNode({
      key: "host",
      tagName: "SECTION",
      shadowChildren: [{ key: "shadow", tagName: "P" }],
      children: [
        { key: "chrome", tagName: "DIV", extensionUi: true },
        { key: "closed", tagName: "X-CLOSED", closedShadow: true },
      ],
    });

    expect(flattened).not.toBeNull();
    if (!flattened) {
      return;
    }
    expect(getXPath(flattened.shadowChildren?.[0] ?? flattened)).toBe("/section[1]/p[1]");
    expect(flattened.children?.map((child) => child.key)).toEqual(["closed"]);
    expect(flattened.children?.[0].closedShadow).toBe(true);
  });

  it("keeps flattened parent identity so shadow/light siblings get distinct XPath indexes", () => {
    const flattened = flattenNode({
      key: "host",
      tagName: "SECTION",
      shadowChildren: [
        { key: "shadow-a", tagName: "P" },
        { key: "shadow-b", tagName: "P" },
      ],
      children: [{ key: "light", tagName: "P" }],
    });

    expect(flattened?.shadowChildren?.map((child) => getXPath(child))).toEqual([
      "/section[1]/p[1]",
      "/section[1]/p[2]",
    ]);
    expect(getXPath(flattened?.children?.[0] ?? flattened!)).toBe("/section[1]/p[3]");
  });

  it("updates only the toggled branch through the pure evaluation pass", () => {
    const left = leaf("left", "/html[1]/body[1]/main[1]/p[1]");
    const right = leaf("right", "/html[1]/body[1]/main[1]/p[2]");
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [left, right],
    };
    const store = createMarkingStore({ root });
    const beforeRight = store.currentEvaluation().overlay.get(right.xpath);

    const after = store.toggle(left, "exclude");

    expect(after.overlay.get(left.xpath)).toBe("exception");
    expect(after.overlay.get(right.xpath)).toBe(beforeRight);
    expect(store.rows()).toContainEqual({ xpath: left.xpath, excluded: true, explicit: true });
  });

  it("normalizes overlapping rows and preserves excluded ancestor context in branch evaluation", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      structuralBoundary: true,
      children: [child],
    };
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [section],
    };
    const store = createMarkingStore({ root }, {
      rows: [
        { xpath: section.xpath, excluded: true },
        { xpath: child.xpath, excluded: false, explicit: true },
      ],
    });

    store.toggle(section, "exclude");
    expect(store.canonicalSet().rows).toEqual([{ xpath: section.xpath, excluded: false }]);
    expect(store.rows()).toEqual([{ xpath: child.xpath, excluded: false }]);
  });

  it("drilled descendant exclusions replace broader excluded ancestors", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      structuralBoundary: true,
      children: [child],
    };
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [section],
    };
    const store = createMarkingStore({ root }, {
      rows: [{ xpath: section.xpath, excluded: true }],
    });

    store.toggle(child, "exclude");

    expect(store.canonicalSet().rows).toEqual([{ xpath: child.xpath, excluded: true, explicit: true }]);
    expect(store.rows()).toEqual([{ xpath: child.xpath, excluded: true, explicit: true }]);
  });

  it("converts auto toggleable-default ancestors to unexcluded rows when drilling", () => {
    const child = leaf("child", "/html[1]/body[1]/footer[1]/p[1]");
    const footer: EvaluationNode = {
      key: "footer",
      tagName: "FOOTER",
      xpath: "/html[1]/body[1]/footer[1]",
      visible: true,
      structuralBoundary: true,
      children: [child],
    };
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [footer],
    };
    const store = createMarkingStore({ root }, {
      rows: [{ xpath: footer.xpath, excluded: true }],
    });

    store.toggle(child, "exclude");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: footer.xpath, excluded: false },
      { xpath: child.xpath, excluded: true, explicit: true },
    ]);
    expect(store.rows()).toEqual([{ xpath: child.xpath, excluded: true, explicit: true }]);
  });

  it("preserves broader submitted excluded ancestor context past unexcluded default boundaries", () => {
    const grandchild = leaf("grandchild", "/html[1]/body[1]/article[1]/footer[1]/section[1]/p[1]");
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/article[1]/footer[1]/section[1]",
      visible: true,
      structuralBoundary: true,
      children: [grandchild],
    };
    const footer: EvaluationNode = {
      key: "footer",
      tagName: "FOOTER",
      xpath: "/html[1]/body[1]/article[1]/footer[1]",
      visible: true,
      structuralBoundary: true,
      children: [section],
    };
    const article: EvaluationNode = {
      key: "article",
      tagName: "ARTICLE",
      xpath: "/html[1]/body[1]/article[1]",
      visible: true,
      structuralBoundary: true,
      children: [footer],
    };
    const store = createMarkingStore({ root: article }, {
      rows: [
        { xpath: article.xpath, excluded: true },
        { xpath: footer.xpath, excluded: false },
      ],
    });

    store.toggle(section, "include");

    expect(store.rows()).toEqual([
      { xpath: article.xpath, excluded: true },
      { xpath: section.xpath, excluded: false, explicit: true },
    ]);
  });

  it("keeps default-excluded ancestors excluded when including a child", () => {
    const child = leaf("child", "/html[1]/body[1]/footer[1]/p[1]");
    const footer: EvaluationNode = {
      key: "footer",
      tagName: "FOOTER",
      xpath: "/html[1]/body[1]/footer[1]",
      visible: true,
      structuralBoundary: true,
      children: [child],
    };
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [footer],
    };
    const store = createMarkingStore({ root }, {
      rows: [{ xpath: footer.xpath, excluded: true }],
    });

    store.toggle(child, "include");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: footer.xpath, excluded: true },
      { xpath: child.xpath, excluded: false, explicit: true },
    ]);
    expect(store.rows()).toEqual([
      { xpath: footer.xpath, excluded: true },
      { xpath: child.xpath, excluded: false, explicit: true },
    ]);
  });

  it("does not inherit node-local unexclude rows as subtree includes", () => {
    const hidden = { ...leaf("hidden", "/html[1]/body[1]/footer[1]/p[1]"), visible: false };
    const footer: EvaluationNode = {
      key: "footer",
      tagName: "FOOTER",
      xpath: "/html[1]/body[1]/footer[1]",
      visible: true,
      structuralBoundary: true,
      children: [hidden],
    };
    const store = createMarkingStore({ root: footer }, {
      rows: [{ xpath: footer.xpath, excluded: false }],
    });

    store.toggle(hidden, "include");
    store.toggle(hidden, "include");

    expect(store.rows()).toEqual([{ xpath: hidden.xpath, excluded: true }]);
  });

  it("toggles an exact excluded target off instead of re-adding the exclusion", () => {
    const footer: EvaluationNode = {
      key: "footer",
      tagName: "FOOTER",
      xpath: "/html[1]/body[1]/footer[1]",
      visible: true,
      ownsDirectText: true,
    };
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [footer],
    };
    const store = createMarkingStore({ root }, {
      rows: [{ xpath: footer.xpath, excluded: true }],
    });

    store.toggle(footer, "exclude");

    expect(store.canonicalSet().rows).toEqual([{ xpath: footer.xpath, excluded: false }]);
    expect(store.rows()).toEqual([{ xpath: footer.xpath, excluded: false }]);
  });

  it("unmarks only the boundary, preserving descendant excludes and clearing dependent include punches", () => {
    const excludedChild = leaf("excluded-child", "/html[1]/body[1]/footer[1]/p[1]");
    const includedChild = leaf("included-child", "/html[1]/body[1]/footer[1]/p[2]");
    const footer: EvaluationNode = {
      key: "footer",
      tagName: "FOOTER",
      xpath: "/html[1]/body[1]/footer[1]",
      visible: true,
      structuralBoundary: true,
      children: [excludedChild, includedChild],
    };
    const store = createMarkingStore({ root: footer }, {
      rows: [
        { xpath: footer.xpath, excluded: true },
        { xpath: excludedChild.xpath, excluded: true, explicit: true },
        { xpath: includedChild.xpath, excluded: false, explicit: true },
      ],
    });

    store.toggle(footer, "exclude");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: excludedChild.xpath, excluded: true, explicit: true },
      { xpath: footer.xpath, excluded: false },
    ]);
  });

  it("keeps an unexcluded textual leaf visible but lets a descendant-text boundary step aside", () => {
    const paragraph = leaf("paragraph", "/html[1]/body[1]/footer[1]/p[1]");
    const footer: EvaluationNode = {
      key: "footer",
      tagName: "FOOTER",
      xpath: "/html[1]/body[1]/footer[1]",
      visible: true,
      structuralBoundary: true,
      children: [paragraph],
    };
    const footerStore = createMarkingStore({ root: footer }, {
      rows: [{ xpath: footer.xpath, excluded: false }],
    });
    const button: EvaluationNode = {
      key: "button",
      tagName: "BUTTON",
      xpath: "/html[1]/body[1]/button[1]",
      visible: true,
      ownsDirectText: true,
      structuralBoundary: true,
    };
    const buttonStore = createMarkingStore({ root: button }, {
      rows: [{ xpath: button.xpath, excluded: false }],
    });

    expect(footerStore.currentEvaluation().overlay.has(footer.xpath)).toBe(false);
    expect(footerStore.currentEvaluation().overlay.get(paragraph.xpath)).toBe("implicit-include");
    expect(buttonStore.currentEvaluation().overlay.get(button.xpath)).toBe("implicit-include");
    expect(buttonStore.rows()).toEqual([{ xpath: button.xpath, excluded: false }]);
  });

  it("removes explicit include boundaries instead of converting them into exclusions", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      structuralBoundary: true,
      children: [child],
    };
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [section],
    };
    const store = createMarkingStore({ root }, {
      rows: [{ xpath: section.xpath, excluded: false, explicit: true }],
    });

    store.toggle(section, "exclude");

    expect(store.canonicalSet().rows).toEqual([]);
    expect(store.rows()).not.toContainEqual({ xpath: section.xpath, excluded: true, explicit: true });
  });

  it("removes active explicit includes when include mode resolves back to the boundary", () => {
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      ownsDirectText: true,
    };
    const store = createMarkingStore({ root: section }, {
      rows: [{ xpath: section.xpath, excluded: false, explicit: true }],
    });

    store.toggle(section, "include");

    expect(store.canonicalSet().rows).toEqual([]);
  });

  it("clears only an explicit context-menu mark and restores the calculated default", () => {
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      ownsDirectText: true,
    };
    const store = createMarkingStore({ root: section }, {
      rows: [{ xpath: section.xpath, excluded: true, explicit: true }],
    });

    expect(store.clear(section)).not.toBeNull();
    expect(store.canonicalSet().rows).toEqual([]);
    expect(store.currentEvaluation().overlay.get(section.xpath)).toBe("implicit-include");
    expect(store.clear(section)).toBeNull();
  });

  it("maps every evaluation category into the legacy overlay grammar", () => {
    expect(MARKING_OVERLAY_CLASSES).toHaveLength(16);
    expect(overlayClassFor("implicit-include")).toBe("uf-default");
    expect(overlayClassFor("explicit-include")).toBe("uf-explicit-include");
    expect(overlayClassFor("exception")).toBe("uf-explicit-exclude");
    expect(overlayClassFor("immutable")).toBe("uf-hard-locked");
    expect(overlayClassFor("closed-shadow")).toBe("uf-hard-locked uf-closed-shadow");
  });

  it("keeps the legacy overlay colours and metrics exact", () => {
    expect(MARKING_OVERLAY_STYLES).toContain("border-radius: 4px");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 2px solid #ffb300");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 1px solid #2e7d32");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 3px solid #1b5e20");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 3px solid #c62828");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 2px dashed rgba(225, 70, 70, 0.4)");
    expect(MARKING_OVERLAY_STYLES).toContain("animation: uf-ai-content-dash 2s linear infinite");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 2px dashed #44b532");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 1px dashed rgba(156, 107, 107, 0.45)");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 2px dashed #b03b3b");
    expect(MARKING_OVERLAY_STYLES).toContain("animation-play-state: paused !important");
    expect(MARKING_OVERLAY_STYLES).toContain("border: 3px dashed #c62828");
    expect(MARKING_OVERLAY_STYLES).toContain('[data-uf-marking-menu="true"]');
  });

  it("retains silent highlights with the shared visibility policy", () => {
    const left = leaf("left", "/html[1]/body[1]/main[1]/p[1]");
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [left],
    };
    const evaluation = createMarkingStore({ root }).currentEvaluation();
    const visible = new Map([
      [left.xpath, { rect: { left: 0, top: 0, width: 100, height: 20 }, viewportWidth: 412 }],
    ]);

    expect(buildSilentHighlights(evaluation, visible)).toEqual([left.xpath]);
  });

  it("retains hidden explicit includes in silent highlights", () => {
    const evaluation = {
      overlay: new Map(),
      rows: [{ xpath: "/html[1]/body[1]/main[1]/p[1]", excluded: false, explicit: true }],
    };
    const hiddenGeometry = new Map([
      ["/html[1]/body[1]/main[1]/p[1]", {
        rect: { left: 0, top: 0, width: 100, height: 20 },
        viewportWidth: 412,
        style: { display: "none" },
      }],
    ]);

    expect(buildSilentHighlights(evaluation, hiddenGeometry)).toEqual([
      "/html[1]/body[1]/main[1]/p[1]",
    ]);
  });

  it("builds AI submission snapshots from evaluated rows and immutable defaults", () => {
    const left = leaf("left", "/html[1]/body[1]/main[1]/p[1]");
    const root: EvaluationNode = {
      key: "body",
      tagName: "BODY",
      xpath: "/html[1]/body[1]",
      visible: true,
      children: [left],
    };
    const evaluation = createMarkingStore({ root }).currentEvaluation();

    expect(buildSubmissionSnapshot({
      baseUrl: "https://example.com",
      renderMode: "rendered",
      pageUrl: "https://example.com/page",
      renderedHtml: "<html></html>",
      evaluation,
    })).toMatchObject({
      baseUrl: "https://example.com",
      defaultExclusionSelectors: ["IMG", "INPUT", "NOSCRIPT", "SELECT", "TITLE", "STYLE", "SCRIPT", "TEMPLATE", "IFRAME", "VIDEO", "SVG"],
      pages: [{ renderedXPaths: [{ xpath: left.xpath, excluded: false }] }],
    });
  });

  it("preserves captured-shadow hosts while stripping extension and automation artifacts", () => {
    expect(stripUncapturableHtml(
      '<section><div data-uf-closed-shadow-host="true"><p>Closed</p></div><div>Content</div></section>',
    )).toBe("<section><div><p>Closed</p></div><div>Content</div></section>");
    expect(stripUncapturableHtml(
      '<section><browser-mcp-container><div>Automation</div></browser-mcp-container><div data-uf-extension-ui="true">Overlay</div><div>Content</div></section>',
    )).toBe("<section><div>Content</div></section>");

    const left = leaf("left", "/html[1]/body[1]/main[1]/p[1]");
    const evaluation = createMarkingStore({
      root: {
        key: "body",
        tagName: "BODY",
        xpath: "/html[1]/body[1]",
        visible: true,
        children: [left],
      },
    }).currentEvaluation();
    const snapshot = buildSubmissionSnapshot({
      baseUrl: "https://example.com",
      renderMode: "static",
      pageUrl: "https://example.com/page",
      renderedHtml: '<main data-uf-motion-paused="true"><aside data-uf-consent-hidden="true">Hidden rendered modal</aside><p>Rendered</p></main>',
      rawHtml: '<main><div id="unfluffify-consent-bypass-style">Helper</div><aside data-uf-consent-hidden="true">Hidden static modal</aside><p>Static</p></main>',
      evaluation,
    });
    expect(snapshot.pages[0]?.renderedHtml).toBe("<main><p>Rendered</p></main>");
    expect(snapshot.pages[0]?.rawHtml).toBe("<main><p>Static</p></main>");
  });
});
