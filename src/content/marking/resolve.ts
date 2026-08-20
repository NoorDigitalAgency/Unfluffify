import type { MarkMode } from "../../domain/schema/marking";

export type MarkingCandidate = Readonly<{
  key: string;
  xpath: string;
  selfMarkable: boolean;
  excluded?: boolean;
  explicitInclude?: boolean;
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
    const excludedContext = hitPath.some((hit) => hit.excluded);
    if (!excludedContext) {
      return null;
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
    return hitPath[0] === includeBoundary ? includeBoundary : null;
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
