import type { MarkMode } from "../../domain/schema/marking";

export type MarkingCandidate = Readonly<{
  key: string;
  xpath: string;
  selfMarkable: boolean;
  excluded?: boolean;
  explicitInclude?: boolean;
  children?: readonly MarkingCandidate[];
  parent?: MarkingCandidate | null;
}>;

function descendants(node: MarkingCandidate): readonly MarkingCandidate[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}

export function resolveTarget(
  hitPath: readonly MarkingCandidate[],
  mode: MarkMode,
): MarkingCandidate | null {
  if (mode === "disabled" || mode === "passthrough") {
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
    for (const hit of hitPath) {
      const candidate = [hit, ...descendants(hit)].find((node) => node.selfMarkable);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }
  const includeBoundary = hitPath.find((hit) => hit.explicitInclude);
  if (includeBoundary) {
    return hitPath[0] === includeBoundary ? includeBoundary : null;
  }
  for (const hit of hitPath) {
    if (hit.selfMarkable && hit.excluded && hitPath[0] === hit) {
      const drilled = descendants(hit).find((node) => node.selfMarkable && !node.excluded);
      if (drilled) {
        return drilled;
      }
      return hit;
    }
    if (hit.selfMarkable && !hit.excluded) {
      return hit;
    }
    const drilled = descendants(hit).find((node) => node.selfMarkable && !node.excluded);
    if (drilled) {
      return drilled;
    }
  }
  return null;
}
