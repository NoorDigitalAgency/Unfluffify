import { describe, expect, it } from "vitest";

import type { BoundaryNode } from "../../../src/domain/boundary";
import {
  isSelfMarkable,
  isStructuralBoundary,
  isToggleableBoundary,
} from "../../../src/domain/boundary";

const node = (overrides: Partial<BoundaryNode>): BoundaryNode => ({
  key: "n",
  tagName: "DIV",
  depthFromBody: 3,
  visible: true,
  ...overrides,
});

describe("P0 boundary predicates (INV-3.5..INV-3.6)", () => {
  it("requires visibility, non-immutable, non-chrome, and direct text or boundary", () => {
    expect(isSelfMarkable(node({ ownsDirectText: true }))).toBe(true);
    expect(isSelfMarkable(node({ visible: false, ownsDirectText: true }))).toBe(false);
    expect(isSelfMarkable(node({ tagName: "svg", ownsDirectText: true }))).toBe(false);
    expect(isSelfMarkable(node({ chrome: true, ownsDirectText: true }))).toBe(false);
    expect(isSelfMarkable(node({ structuralRole: "section" }))).toBe(true);
  });

  it("accepts semantic boundaries and toggleable defaults", () => {
    expect(isStructuralBoundary(node({ structuralRole: "article" }))).toBe(true);
    expect(isStructuralBoundary(node({ structuralRole: "card-group" }))).toBe(true);
    expect(isStructuralBoundary(node({ structuralRole: "list" }))).toBe(true);
    expect(isStructuralBoundary(node({ structuralRole: "table" }))).toBe(true);
    expect(isStructuralBoundary(node({ tagName: "footer" }))).toBe(true);
  });

  it("rejects shallow generic page shells and multi-landmark wrappers", () => {
    expect(isStructuralBoundary(node({ structuralRole: "generic", depthFromBody: 1 }))).toBe(
      false,
    );
    expect(isStructuralBoundary(node({ structuralRole: "section", landmarkCount: 2 }))).toBe(
      false,
    );
    expect(isSelfMarkable(node({ structuralRole: "section", pageShell: true }))).toBe(false);
  });

  it("shares one toggleable-boundary decision for closed and silent surfaces", () => {
    expect(isToggleableBoundary(node({ ownsDirectText: true }))).toBe(true);
    expect(isToggleableBoundary(node({ ownsDirectText: true, closedShadow: true }))).toBe(false);
    expect(isToggleableBoundary(node({ ownsDirectText: true, silentWhitespaceExclusion: true }))).toBe(false);
    expect(isToggleableBoundary(
      node({ ownsDirectText: true, silentWhitespaceExclusion: true }),
      { hasOwnMark: () => true },
    )).toBe(true);
  });
});
