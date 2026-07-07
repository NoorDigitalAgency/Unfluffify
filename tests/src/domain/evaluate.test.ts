import { describe, expect, it } from "vitest";

import type { EvaluationNode } from "../../../src/domain/evaluate";
import { evaluate, evaluateBranch } from "../../../src/domain/evaluate";

const leaf = (key: string, xpath: string, overrides: Partial<EvaluationNode> = {}): EvaluationNode => ({
  key,
  tagName: "P",
  xpath,
  visible: true,
  ownsDirectText: true,
  ...overrides,
});

const node = (
  key: string,
  xpath: string,
  children: EvaluationNode[],
  overrides: Partial<EvaluationNode> = {},
): EvaluationNode => ({
  key,
  tagName: "DIV",
  xpath,
  visible: true,
  structuralBoundary: true,
  children,
  ...overrides,
});

describe("P0 evaluate pass (INV-2.5..INV-2.10, INV-4.1..INV-4.4, INV-5.1..INV-5.4)", () => {
  it("uses nearest marked ancestor for overlay classification and explicit include rescue", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const parent = node("parent", "/html[1]/body[1]/section[1]", [child], {
      tagName: "SECTION",
    });
    const root = node("body", "/html[1]/body[1]", [parent], { tagName: "BODY" });

    const result = evaluate(
      {
        rows: [
          { xpath: parent.xpath, excluded: true, explicit: true },
          { xpath: child.xpath, excluded: false, explicit: true },
        ],
      },
      { root },
    );

    expect(result.overlay.get(parent.xpath)).toBe("exception");
    expect(result.overlay.get(child.xpath)).toBe("explicit-include");
    expect(result.rows).toEqual([
      { xpath: parent.xpath, excluded: true, explicit: true },
      { xpath: child.xpath, excluded: false, explicit: true },
    ]);
  });

  it("emits shallow-boundary excludes and suppresses excluded descendants", () => {
    const hiddenChild = leaf("hidden", "/html[1]/body[1]/section[1]/p[1]", { visible: false });
    const excludedChild = leaf("excluded-child", "/html[1]/body[1]/section[1]/p[2]");
    const parent = node("parent", "/html[1]/body[1]/section[1]", [hiddenChild, excludedChild], {
      tagName: "SECTION",
    });

    const result = evaluate(
      {
        rows: [
          { xpath: parent.xpath, excluded: true },
          { xpath: excludedChild.xpath, excluded: true },
        ],
      },
      { root: node("body", "/html[1]/body[1]", [parent], { tagName: "BODY" }) },
    );

    expect(result.rows).toEqual([{ xpath: parent.xpath, excluded: true }]);
  });

  it("keeps immutable tags out of per-page rows", () => {
    const title = leaf("title", "/html[1]/body[1]/svg[1]/title[1]");
    const img = leaf("img", "/html[1]/body[1]/svg[1]", {
      tagName: "svg",
      children: [title],
    });
    const result = evaluate(
      {
        rows: [
          { xpath: img.xpath, excluded: true, explicit: true },
          { xpath: title.xpath, excluded: false, explicit: true },
        ],
      },
      { root: node("body", "/html[1]/body[1]", [img], { tagName: "BODY" }) },
    );

    expect(result.overlay.get(img.xpath)).toBe("immutable");
    expect(result.overlay.has(title.xpath)).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it("treats non-explicit include rows as node-local rather than subtree includes", () => {
    const hiddenChild = leaf("hidden", "/html[1]/body[1]/footer[1]/p[1]", { visible: false });
    const footer = node("footer", "/html[1]/body[1]/footer[1]", [hiddenChild], {
      tagName: "FOOTER",
      ownsDirectText: true,
    });

    const result = evaluate(
      { rows: [{ xpath: footer.xpath, excluded: false }] },
      { root: node("body", "/html[1]/body[1]", [footer], { tagName: "BODY" }) },
    );

    expect(result.overlay.get(footer.xpath)).toBe("implicit-include");
    expect(result.overlay.has(hiddenChild.xpath)).toBe(false);
    expect(result.rows).toEqual([
      { xpath: footer.xpath, excluded: false },
      { xpath: hiddenChild.xpath, excluded: true },
    ]);
  });

  it("recomputes only the toggled branch and preserves sibling overlay entries", () => {
    const left = leaf("left", "/html[1]/body[1]/main[1]/p[1]");
    const right = leaf("right", "/html[1]/body[1]/main[1]/p[2]");
    const main = node("main", "/html[1]/body[1]/main[1]", [left, right], { tagName: "MAIN" });
    const previous = evaluate({ rows: [] }, { root: node("body", "/html[1]/body[1]", [main]) });

    const updated = evaluateBranch(previous, {
      root: left,
      canonicalMarks: { rows: [{ xpath: left.xpath, excluded: true, explicit: true }] },
    });

    expect(updated.overlay.get(left.xpath)).toBe("exception");
    expect(updated.overlay.get(right.xpath)).toBe(previous.overlay.get(right.xpath));
    expect(updated.rows).toContainEqual({ xpath: left.xpath, excluded: true, explicit: true });
    expect(updated.rows).toContainEqual({ xpath: right.xpath, excluded: false });
  });

  it("keeps branch recompute identical under a submitted excluded ancestor", () => {
    const child = leaf("child", "/html[1]/body[1]/section[1]/p[1]");
    const parent = node("parent", "/html[1]/body[1]/section[1]", [child], {
      tagName: "SECTION",
    });
    const previous = evaluate(
      { rows: [{ xpath: parent.xpath, excluded: true }] },
      { root: node("body", "/html[1]/body[1]", [parent], { tagName: "BODY" }) },
    );

    const updated = evaluateBranch(previous, {
      root: child,
      canonicalMarks: { rows: [{ xpath: parent.xpath, excluded: true }] },
      inheritedAncestorMark: { xpath: parent.xpath, excluded: true },
    });

    expect(updated.rows).toEqual([{ xpath: parent.xpath, excluded: true }]);
  });

  it("can suppress an uncapturable branch during branch recompute", () => {
    const child = leaf("child", "/html[1]/body[1]/svg[1]/text[1]");
    const previous = evaluate({ rows: [] }, { root: node("body", "/html[1]/body[1]", [child]) });
    const updated = evaluateBranch(previous, {
      root: child,
      canonicalMarks: { rows: [{ xpath: child.xpath, excluded: false, explicit: true }] },
      inheritedUncapturable: true,
    });

    expect(updated.overlay.has(child.xpath)).toBe(false);
    expect(updated.rows).toEqual([]);
  });

  it("classifies closed shadow hosts distinctly", () => {
    const closed = leaf("closed", "/html[1]/body[1]/custom-el[1]", {
      tagName: "CUSTOM-EL",
      closedShadow: true,
    });
    const result = evaluate(
      { rows: [] },
      { root: node("body", "/html[1]/body[1]", [closed], { tagName: "BODY" }) },
    );
    expect(result.overlay.get(closed.xpath)).toBe("closed-shadow");
    expect(result.rows).toEqual([]);
  });
});
