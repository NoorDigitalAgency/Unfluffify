import type { MarkMode } from "../../domain/schema/marking";

export type MarkingCandidate = Readonly<{
  key: string;
  xpath: string;
  selfMarkable: boolean;
  excluded?: boolean;
  explicitInclude?: boolean;
  explicitExclude?: boolean;
  closedShadow?: boolean;
  ownsDirectText?: boolean;
  children?: readonly MarkingCandidate[];
  parent?: MarkingCandidate | null;
}>;

export function resolveTarget(
  hitPath: readonly MarkingCandidate[],
  mode: MarkMode,
): MarkingCandidate | null {
  if (mode === "disabled" || mode === "passthrough") {
    return null;
  }
  if (hitPath[0]?.closedShadow) {
    return null;
  }
  if (mode === "include") {
    const includeBoundary = hitPath.find((hit) => hit.explicitInclude);
    if (includeBoundary) {
      return includeBoundary;
    }
    const directTargetIndex = hitPath.findIndex((hit) => hit.selfMarkable);
    if (directTargetIndex < 0) {
      return null;
    }
    // Legacy include targeting promotes the nearest eligible mixed-text ancestor
    // before falling back to the deepest hit. It never searches unrelated
    // descendants elsewhere in the clicked subtree.
    const mixedTextAncestor = hitPath
      .slice(directTargetIndex + 1)
      .find((hit) => hit.selfMarkable && hit.ownsDirectText);
    return mixedTextAncestor ?? hitPath[directTargetIndex] ?? null;
  }
  const includeBoundary = hitPath.find((hit) => hit.explicitInclude);
  if (includeBoundary) {
    // Explicit include boundaries are closed: every painted descendant routes
    // back to the owning include until that exact boundary is cleared. The
    // renderer's owner index is only a fast path and may be generation-fenced
    // during scroll/resize settling, so correctness must also live here in the
    // composed candidate path.
    return includeBoundary;
  }
  // A widened exclusion owns the visible interaction surface for everything
  // below it. Resolve that exact explicit boundary first so a plain click (or
  // Clear mark) removes only the widened mark instead of creating a nested row.
  const explicitExcludeBoundary = hitPath.find((hit) => hit.explicitExclude);
  if (explicitExcludeBoundary) {
    return explicitExcludeBoundary;
  }
  for (const hit of hitPath) {
    if (hit.selfMarkable && hit.excluded && hitPath[0] === hit) {
      return hit;
    }
    if (hit.selfMarkable && !hit.excluded) {
      return hit;
    }
  }
  return null;
}
