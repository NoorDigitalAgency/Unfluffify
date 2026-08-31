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
    // Alt is individual-target inclusion mode. The native hit stack already
    // distinguishes direct text on a parent from a painted descendant: direct
    // text resolves to the parent, while descendant paint resolves to that
    // descendant. Do not close the branch at an explicit-inclusion ancestor;
    // Alt-clicking a child transfers the explicit inclusion atomically.
    return hitPath.find((hit) => hit.selfMarkable) ?? null;
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
  // An expanded exclusion is not a closed interaction surface. Its exact
  // boundary resolves when that boundary is the deepest eligible painted hit;
  // an ordinary descendant resolves independently so the store can remove the
  // ancestor, rehydrate defaults, and exclude the clicked target. Explicit
  // inclusions remain the one exception handled above: a plain/Shift click on
  // their painted branch removes that exact inclusion without disturbing an
  // expanded exclusion ancestor.
  return hitPath.find((hit) => hit.selfMarkable) ?? null;
}
