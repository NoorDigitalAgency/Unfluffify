import { describe, expect, it } from "vitest";

import type { EvaluationNode } from "../../../../src/domain/evaluate";
import { getXPath } from "../../../../src/domain/xpath";
import {
  buildSilentHighlights,
  buildSubmissionSnapshot,
  createMarkingStore,
  flattenNode,
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
  it("resolves exclude by drilling and include by reaching in", () => {
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

    expect(resolveTarget([footer], "exclude")).toBe(child);
    expect(resolveTarget([{ ...footer, children: [] }], "exclude")).toMatchObject({ key: "footer" });
    expect(resolveTarget([footer], "include")).toBe(footer);
    expect(resolveTarget([footer], "passthrough")).toBeNull();
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

  it("maps overlay categories including closed shadow", () => {
    expect(overlayClassFor("implicit-include")).toBe("uf-overlay-include");
    expect(overlayClassFor("closed-shadow")).toBe("uf-overlay-closed-shadow");
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

  it("strips closed-shadow hosts from submitted rendered HTML to preserve XPath alignment", () => {
    expect(stripUncapturableHtml(
      '<section><div data-uf-closed-shadow-host="true"><p>Closed</p></div><div>Content</div></section>',
    )).toBe("<section><div>Content</div></section>");
    expect(stripUncapturableHtml(
      '<section><div data-uf-closed-shadow-host="true"><div>Closed</div></div><div>Content</div></section>',
    )).toBe("<section><div>Content</div></section>");
  });
});
