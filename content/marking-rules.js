export function shouldSelfMarkToggleableDefaultBoundary(options = {}) {
  const hasDirectOwnText = Boolean(options.hasDirectOwnText);
  const hasVisibleTextualDescendant = Boolean(options.hasVisibleTextualDescendant);
  const hasExplicitlyMarkedDescendant = Boolean(options.hasExplicitlyMarkedDescendant);
  if (hasDirectOwnText) {
    return true;
  }
  return !hasVisibleTextualDescendant && !hasExplicitlyMarkedDescendant;
}

export function shouldAutoSeedMarkingsFromAiSelectors(options = {}) {
  return Boolean(
    options.hasAiSelectors &&
    !options.hasSavedMarkingsForPage &&
    !options.suppressAutoSeed
  );
}

export function chooseExcludeParentBoundaryTarget(options = {}) {
  const selfValue = Object.prototype.hasOwnProperty.call(options, "selfValue")
    ? options.selfValue
    : null;
  if (options.selfStructuredGroup || options.selfToggleableBoundary) {
    return selfValue;
  }
  if (options.selfContentBoundary) {
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
  const contentBoundaryAncestor = ancestors.find(
    (candidate) => candidate && candidate.isContentBoundary && candidate.value
  );
  if (contentBoundaryAncestor) {
    return contentBoundaryAncestor.value;
  }
  let broadestMarkableAncestor = null;
  ancestors.forEach((candidate) => {
    if (candidate && candidate.isMarkable && candidate.value) {
      broadestMarkableAncestor = candidate.value;
    }
  });
  return broadestMarkableAncestor;
}

export function isValidExpandedExclusionBoundary(options = {}) {
  const hasDirectOwnText = Boolean(options.hasDirectOwnText);
  const hasDirectTextualBoundary = Boolean(options.hasDirectTextualBoundary);
  const qualifyingChildBoundaryCount = Math.max(
    0,
    Math.trunc(Number(options.qualifyingChildBoundaryCount) || 0)
  );
  const hasOnlyLayoutWrapperChain = Boolean(options.hasOnlyLayoutWrapperChain);
  const hasMixedSiblingContent = Boolean(options.hasMixedSiblingContent);
  if (hasDirectOwnText || hasDirectTextualBoundary) {
    return true;
  }
  if (hasOnlyLayoutWrapperChain || hasMixedSiblingContent) {
    return false;
  }
  return qualifyingChildBoundaryCount >= 2;
}

export function shouldBlockExpandedExclusionRoot(options = {}) {
  return Boolean(options.isBody || options.isSoleVisualBodyWrapper);
}

export function getExplicitMarkingRenderOptions() {
  return {
    delay: 0,
    minInterval: 0,
    invalidate: true
  };
}

export function shouldAllowExplicitIncludeDescendantTarget(options = {}) {
  if (!options.insideExplicitIncludeAncestor) {
    return true;
  }
  return Boolean(options.isExactExplicitInclude);
}

export function getExplicitMarkingPresentation(options = {}) {
  const type = options.type === "include" ? "include" : "exclude";
  const visible = Boolean(options.visible);
  if (visible) {
    return {
      ghost: false,
      className: type === "include" ? "uf-explicit-include" : "uf-explicit-exclude"
    };
  }
  return {
    ghost: true,
    className: type === "include" ? "uf-ghost-include" : "uf-ghost-exclude"
  };
}
