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

  it("climbs to the broadest qualifying group", () => {
    const inner = group("inner", [target("a"), target("b")]);
    const sibling = target("c");
    const outer = group("outer", [inner, sibling], { depthFromBody: 2 });
    inner.parent = outer;
    sibling.parent = outer;
    const clicked = target("clicked", 1);
    clicked.parent = inner;

    expect(chooseWidenTarget(clicked)).toBe(outer);
    expect(chooseWidenTarget(inner)).toBe(outer);
  });

  it("stops before page shells and non-qualifying ancestors", () => {
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
