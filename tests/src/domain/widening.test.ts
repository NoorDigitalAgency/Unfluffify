import { describe, expect, it } from "vitest";

import type { WidenNode } from "../../../src/domain/widening";
import { chooseWidenTarget, isGroupingWidenTarget } from "../../../src/domain/widening";

function link(parent: WidenNode, children: WidenNode[]): WidenNode {
  for (const child of children as (WidenNode & { parent?: WidenNode })[]) {
    child.parent = parent;
  }
  return parent;
}

const target = (key: string, count = 2): WidenNode => ({
  key,
  tagName: "ARTICLE",
  depthFromBody: 4,
  visible: true,
  structuralRole: "article",
  textualMarkableContentCount: count,
});

const group = (key: string, children: WidenNode[], overrides: Partial<WidenNode> = {}): WidenNode =>
  link(
    {
      key,
      tagName: "DIV",
      depthFromBody: 3,
      visible: true,
      structuralRole: "card-group",
      children,
      fullWidth: true,
      ...overrides,
    },
    children,
  );

describe("P0 widening chooser (INV-3.18..INV-3.21)", () => {
  it("qualifies groups by two eligible direct descendants regardless of width", () => {
    const parent = group("wide", [target("a"), target("b")], { fullWidth: true });
    expect(isGroupingWidenTarget(parent)).toBe(true);
  });

  it("keeps a clicked group and otherwise chooses the nearest group", () => {
    const inner = group("inner", [target("a"), target("b")]);
    const sibling = target("c");
    const outer = group("outer", [inner, sibling], { depthFromBody: 2 });
    inner.parent = outer;
    sibling.parent = outer;
    const clicked = target("clicked", 1);
    clicked.parent = inner;

    expect(chooseWidenTarget(clicked)).toBe(inner);
    expect(chooseWidenTarget(inner)).toBe(inner);
  });

  it("matches the legacy four-step priority across an ineligible gap", () => {
    const clicked = target("clicked", 1);
    const gap = group("gap", [clicked], { structuralRole: "generic", textualMarkableContentCount: 1 });
    const toggleable = group("toggleable", [gap], {
      tagName: "FOOTER",
      ownsDirectText: true,
      textualMarkableContentCount: 1,
    });
    const nearestStructuredGroup = group("nearest-group", [toggleable, target("sibling")]);
    const broadPlain = group("broad-plain", [nearestStructuredGroup], {
      structuralRole: "generic",
      ownsDirectText: true,
      textualMarkableContentCount: 1,
    });
    nearestStructuredGroup.parent = broadPlain;

    // Step 2 wins: the nearest structured group outranks the nearer
    // toggleable boundary and the broader ordinary markable ancestor. The
    // single-child gap must not terminate the ancestor scan.
    expect(chooseWidenTarget(clicked)).toBe(nearestStructuredGroup);
  });

  it("falls through to nearest toggleable, then broadest ordinary markable", () => {
    const clicked = target("clicked", 1);
    const footer = group("footer", [clicked], {
      tagName: "FOOTER",
      ownsDirectText: true,
      textualMarkableContentCount: 1,
    });
    const outerPlain = group("outer-plain", [footer], {
      structuralRole: "generic",
      ownsDirectText: true,
      textualMarkableContentCount: 1,
    });
    footer.parent = outerPlain;
    expect(chooseWidenTarget(clicked)).toBe(footer);

    const ordinaryClicked = target("ordinary-clicked", 1);
    const innerPlain = group("inner-plain", [ordinaryClicked], {
      structuralRole: "generic",
      ownsDirectText: true,
      textualMarkableContentCount: 1,
    });
    const gap = group("gap", [innerPlain], { structuralRole: "generic", textualMarkableContentCount: 1 });
    const broadestPlain = group("broadest-plain", [gap], {
      structuralRole: "generic",
      ownsDirectText: true,
      textualMarkableContentCount: 1,
    });
    gap.parent = broadestPlain;
    expect(chooseWidenTarget(ordinaryClicked)).toBe(broadestPlain);
  });

  it("stops before page shells and document roots", () => {
    const inner = group("inner", [target("a"), target("b")]);
    const shell = group("shell", [inner, target("c")], {
      pageShell: true,
      depthFromBody: 1,
    });
    inner.parent = shell;

    expect(chooseWidenTarget(inner)).toBe(inner);
    expect(isGroupingWidenTarget(group("single", [target("only")]))).toBe(false);
    const body = group("body", [inner, target("c")], { tagName: "BODY", pageShell: false });
    inner.parent = body;
    expect(chooseWidenTarget(inner)).toBe(inner);
  });

  it("selects descendants-only widen targets with two markable descendants", () => {
    const first = target("first", 1);
    const second = target("second", 1);
    const wrapper = group("wrapper", [first, second], {
      structuralRole: "generic",
      textualMarkableContentCount: 2,
    });

    expect(chooseWidenTarget(first)).toBe(wrapper);
  });
});
