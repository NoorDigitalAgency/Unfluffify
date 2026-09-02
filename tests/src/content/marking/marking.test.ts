import { describe, expect, it, vi } from "vitest";

import type { EvaluationNode } from "../../../../src/domain/evaluate";
import { getXPath } from "../../../../src/domain/xpath";
import {
  buildSilentHighlights,
  buildSubmissionSnapshot,
  canonicalMarkingFingerprint,
  createMarkingStore,
  flattenNode,
  MARKING_OVERLAY_CLASSES,
  MARKING_OVERLAY_STYLES,
  overlayClassFor,
  resolveTarget,
  shallowXpathBoundaries,
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
  it("fingerprints canonical decisions independent of row order and optional false flags", () => {
    const left = canonicalMarkingFingerprint({ rows: [
      { xpath: "/html[1]/body[1]/main[1]/p[1]", excluded: false, explicit: true },
      { xpath: "/html[1]/body[1]/aside[1]", excluded: true },
    ] });
    const right = canonicalMarkingFingerprint({ rows: [
      { xpath: "/html[1]/body[1]/aside[1]", excluded: true, explicit: false },
      { xpath: "/html[1]/body[1]/main[1]/p[1]", excluded: false, explicit: true },
    ] });

    expect(right).toBe(left);
    expect(canonicalMarkingFingerprint({ rows: [] })).not.toBe(left);
  });

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

  it("keeps Alt inclusion on the deepest painted mixed-text target", () => {
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

    expect(resolveTarget([child, mixed], "include")).toBe(child);
    expect(resolveTarget([mixed], "include")).toBe(mixed);
  });

  it("allows Alt to create an explicit include for ordinary implicitly-included content", () => {
    expect(resolveTarget([{
      key: "content",
      xpath: "/html[1]/body[1]/main[1]/p[1]",
      selfMarkable: true,
    }], "include")).toMatchObject({ key: "content" });
  });

  it("keeps descendants of an expanded exclusion independently targetable", () => {
    const widened: MarkingCandidate = {
      key: "section",
      xpath: "/html[1]/body[1]/main[1]/section[1]",
      selfMarkable: true,
      excluded: true,
      explicitExclude: true,
    };
    const child: MarkingCandidate = {
      key: "paragraph",
      xpath: "/html[1]/body[1]/main[1]/section[1]/p[1]",
      selfMarkable: true,
      parent: widened,
    };
    expect(resolveTarget([child, widened], "exclude")).toBe(child);
    expect(resolveTarget([widened], "exclude")).toBe(widened);
  });

  it("keeps explicit includes plain-clickable while Alt can transfer to a descendant", () => {
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

    expect(resolveTarget([child, include], "exclude")).toBe(include);
    expect(resolveTarget([include], "exclude")).toBe(include);
    expect(resolveTarget([child, include], "include")).toBe(child);
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

  it("drilling an expanded exclusion clears sibling decisions and rehydrates sibling defaults", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const defaultSibling: EvaluationNode = {
      ...leaf("default-sibling", "/html[1]/body[1]/section[1]/button[1]"),
      tagName: "BUTTON",
    };
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      structuralBoundary: true,
      children: [child, defaultSibling],
    };
    const store = createMarkingStore({ root: section }, {
      rows: [
        { xpath: section.xpath, excluded: true, explicit: true },
        { xpath: defaultSibling.xpath, excluded: false, explicit: true },
      ],
    });

    store.toggle(child, "exclude");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: defaultSibling.xpath, excluded: true },
      { xpath: child.xpath, excluded: true, explicit: true },
    ]);
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

  it("plain-clicking an explicitly included expanded descendant removes only that inclusion", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      structuralBoundary: true,
      children: [child],
    };
    const store = createMarkingStore({ root: section }, {
      rows: [
        { xpath: section.xpath, excluded: true, explicit: true },
        { xpath: child.xpath, excluded: false, explicit: true },
      ],
    });

    store.toggle(child, "exclude");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: section.xpath, excluded: true, explicit: true },
    ]);
    expect(store.rows()).toEqual([
      { xpath: section.xpath, excluded: true, explicit: true },
    ]);
  });

  it("Alt converts an explicit exclusion to an explicit inclusion", () => {
    const paragraph = leaf("paragraph", "/html[1]/body[1]/main[1]/p[1]");
    const store = createMarkingStore({ root: paragraph }, {
      rows: [{ xpath: paragraph.xpath, excluded: true, explicit: true }],
    });

    store.toggle(paragraph, "include");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: paragraph.xpath, excluded: false, explicit: true },
    ]);
  });

  it("always emits a hidden explicit inclusion through a mutable expanded exclusion", () => {
    const child = {
      ...leaf("child", "/html[1]/body[1]/section[1]/p[1]"),
      visible: false,
    };
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      structuralBoundary: true,
      children: [child],
    };
    const store = createMarkingStore({ root: section }, {
      rows: [
        { xpath: section.xpath, excluded: true, explicit: true },
        { xpath: child.xpath, excluded: false, explicit: true },
      ],
    });

    expect(store.rows()).toEqual([
      { xpath: section.xpath, excluded: true, explicit: true },
      { xpath: child.xpath, excluded: false, explicit: true },
    ]);
  });

  it("omits immutable roots and descendants even if stale canonical marks name them", () => {
    const child = leaf("child", "/html[1]/body[1]/img[1]/p[1]");
    const immutable: EvaluationNode = {
      key: "image",
      tagName: "IMG",
      xpath: "/html[1]/body[1]/img[1]",
      visible: true,
      immutable: true,
      children: [child],
    };
    const store = createMarkingStore({ root: immutable }, {
      rows: [
        { xpath: immutable.xpath, excluded: true, explicit: true },
        { xpath: child.xpath, excluded: false, explicit: true },
      ],
    });

    expect(store.rows()).toEqual([]);
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

    expect(store.rows()).toEqual([{ xpath: hidden.xpath, excluded: true, explicit: true }]);
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

  it("unmarks an expanded boundary by clearing descendant decisions and rehydrating defaults", () => {
    const excludedChild = leaf("excluded-child", "/html[1]/body[1]/footer[1]/p[1]");
    const includedChild: EvaluationNode = {
      ...leaf("included-child", "/html[1]/body[1]/footer[1]/button[1]"),
      tagName: "BUTTON",
    };
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
      { xpath: footer.xpath, excluded: false },
      { xpath: includedChild.xpath, excluded: true },
    ]);
  });

  it("clears an explicit inclusion back to the target's calculated default", () => {
    const button: EvaluationNode = {
      ...leaf("button", "/html[1]/body[1]/button[1]"),
      tagName: "BUTTON",
    };
    const store = createMarkingStore({ root: button }, {
      rows: [{ xpath: button.xpath, excluded: false, explicit: true }],
    });

    store.toggle(button, "exclude");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: button.xpath, excluded: true },
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

  it("atomically transfers an Alt inclusion from an ancestor to its painted descendant", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const section: EvaluationNode = {
      key: "section",
      tagName: "SECTION",
      xpath: "/html[1]/body[1]/section[1]",
      visible: true,
      ownsDirectText: true,
      children: [child],
    };
    const store = createMarkingStore({ root: section }, {
      rows: [{ xpath: section.xpath, excluded: false, explicit: true }],
    });

    store.toggle(child, "include");

    expect(store.canonicalSet().rows).toEqual([
      { xpath: child.xpath, excluded: false, explicit: true },
    ]);
  });

  it("can clear one exact explicit mark and restore its calculated default", () => {
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
    expect(MARKING_OVERLAY_CLASSES).toContain("uf-page-inspection-active");
    expect(MARKING_OVERLAY_CLASSES).toContain("uf-silent-presentation");
    expect(MARKING_OVERLAY_CLASSES).toContain("uf-preview-presentation");
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
    expect(MARKING_OVERLAY_STYLES).not.toContain('[data-uf-marking-menu="true"]');
    expect(MARKING_OVERLAY_STYLES).not.toContain("-ghost");
  });

  it("fades the pre-composited overlay root while scroll geometry is stale", () => {
    expect(MARKING_OVERLAY_STYLES).toContain("will-change: opacity");
    expect(MARKING_OVERLAY_STYLES).toContain(`.uf-marking-layer-root.uf-scrolling {
  /* One pre-composited root fade`);
    expect(MARKING_OVERLAY_STYLES).toContain("opacity: 0;\n  transition-duration: 0s;");
    expect(MARKING_OVERLAY_STYLES).not.toContain(".uf-marking-layer-root.uf-scrolling .uf-layer");
    // Removing uf-scrolling restores the shared root 150 ms transition; only
    // the stale-geometry edge is synchronous.
    expect(MARKING_OVERLAY_STYLES).toContain("transition: opacity 0.15s ease");
  });

  it("physically hides every annotation layer during inspection without tinting the page", () => {
    expect(MARKING_OVERLAY_STYLES).toContain(
      '.uf-marking-layer-root.uf-page-inspection-active .uf-layer {\n  /* Reveal/freeze',
    );
    expect(MARKING_OVERLAY_STYLES).toContain("opacity: 0 !important;\n  pointer-events: none !important;");
    expect(MARKING_OVERLAY_STYLES.indexOf("uf-page-inspection-active .uf-layer"))
      .toBeGreaterThan(MARKING_OVERLAY_STYLES.lastIndexOf("uf-preview-presentation .uf-layer"));
    expect(MARKING_OVERLAY_STYLES).not.toContain(
      ".uf-marking-layer-root.uf-page-inspection-active {\n  background:",
    );
  });

  it("gives ordinary Silent exactly its three-layer presentation vocabulary", () => {
    expect(MARKING_OVERLAY_STYLES).toContain(
      '.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="hard"],',
    );
    expect(MARKING_OVERLAY_STYLES).toContain(
      '.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="interaction"] {\n' +
        "  /* Structural maintenance retains these boxes",
    );
    expect(MARKING_OVERLAY_STYLES).toContain(
      '.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="silent-immutable"],',
    );
    expect(MARKING_OVERLAY_STYLES).toContain(
      '.uf-marking-layer-root.uf-silent-presentation .uf-layer[data-layer="silent-excluded"] {\n' +
        "  opacity: 1;\n  filter: none;",
    );
    // Preview is a later, orthogonal state and must be able to reveal its focus
    // layer even when it was opened from ordinary Silent.
    expect(MARKING_OVERLAY_STYLES.indexOf("uf-preview-presentation .uf-layer"))
      .toBeGreaterThan(MARKING_OVERLAY_STYLES.lastIndexOf("uf-silent-presentation .uf-layer"));
    // Render/reveal suppression remains the final visual authority.
    expect(MARKING_OVERLAY_STYLES.indexOf("uf-page-inspection-active .uf-layer"))
      .toBeGreaterThan(MARKING_OVERLAY_STYLES.lastIndexOf("uf-preview-presentation .uf-layer"));
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

  it("retains hidden explicit decisions without creating silent highlights", () => {
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

    expect(buildSilentHighlights(evaluation, hiddenGeometry)).toEqual([]);
  });

  it("projects silent content shallowly while retaining explicit occurrences", () => {
    const ancestor = "/html[1]/body[1]/main[1]/section[1]";
    const implicitChild = `${ancestor}/p[1]`;
    const explicitChild = `${ancestor}/p[2]`;
    const evaluation = {
      overlay: new Map(),
      rows: [
        { xpath: implicitChild, excluded: false },
        { xpath: explicitChild, excluded: false, explicit: true },
        { xpath: ancestor, excluded: false },
      ],
    };

    expect(buildSilentHighlights(evaluation, new Map())).toEqual([ancestor, explicitChild]);
  });

  it("prunes implicit descendants before resolving silent layout geometry", () => {
    const ancestor = "/html[1]/body[1]/main[1]/section[1]";
    const implicitChild = `${ancestor}/p[1]`;
    const explicitChild = `${ancestor}/p[2]`;
    const get = vi.fn((xpath: string) => ({
      rect: { left: 0, top: 0, width: xpath === ancestor ? 300 : 100, height: 20 },
      viewportWidth: 412,
    }));

    expect(buildSilentHighlights({
      overlay: new Map(),
      rows: [
        { xpath: implicitChild, excluded: false },
        { xpath: explicitChild, excluded: false, explicit: true },
        { xpath: ancestor, excluded: false },
      ],
    }, { get })).toEqual([ancestor, explicitChild]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(ancestor);
    expect(get).toHaveBeenCalledWith(explicitChild);
  });

  it("deduplicates descendant silent exclusions under the shallow owner", () => {
    const ancestor = "/html[1]/body[1]/main[1]/section[1]";
    expect(shallowXpathBoundaries([
      `${ancestor}/p[1]/span[1]`,
      ancestor,
      `${ancestor}/p[1]`,
      "/html[1]/body[1]/main[1]/aside[1]",
    ])).toEqual([
      ancestor,
      "/html[1]/body[1]/main[1]/aside[1]",
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
    expect(snapshot.pages[0]?.renderedHtml).toBe("<main><aside>Hidden rendered modal</aside><p>Rendered</p></main>");
    expect(snapshot.pages[0]?.rawHtml).toBe("<main><aside>Hidden static modal</aside><p>Static</p></main>");
  });
});
