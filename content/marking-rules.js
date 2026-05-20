export function shouldSelfMarkToggleableDefaultBoundary(options = {}) {
  const hasDirectOwnText = Boolean(options.hasDirectOwnText);
  const hasVisibleTextualDescendant = Boolean(options.hasVisibleTextualDescendant);
  const hasExplicitlyMarkedDescendant = Boolean(options.hasExplicitlyMarkedDescendant);
  if (hasDirectOwnText) {
    return true;
  }
  return !hasVisibleTextualDescendant && !hasExplicitlyMarkedDescendant;
}

export function chooseExcludeParentBoundaryTarget(options = {}) {
  const selfValue = Object.prototype.hasOwnProperty.call(options, "selfValue")
    ? options.selfValue
    : null;
  if (options.selfStructuredGroup || options.selfToggleableBoundary) {
    return selfValue;
  }
  const ancestors = Array.isArray(options.ancestors) ? options.ancestors : [];
  const structuredGroupAncestor = ancestors.find(
    (candidate) => candidate && candidate.isStructuredGroup && candidate.value
  );
  if (structuredGroupAncestor) {
    return structuredGroupAncestor.value;
  }
  const toggleableAncestor = ancestors.find(
    (candidate) => candidate && candidate.isToggleableBoundary && candidate.value
  );
  if (toggleableAncestor) {
    return toggleableAncestor.value;
  }
  let broadestMarkableAncestor = null;
  ancestors.forEach((candidate) => {
    if (candidate && candidate.isMarkable && candidate.value) {
      broadestMarkableAncestor = candidate.value;
    }
  });
  return broadestMarkableAncestor;
}