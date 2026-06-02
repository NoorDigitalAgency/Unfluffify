export function shouldSelfMarkToggleableDefaultBoundary(options = {}) {
  const hasDirectOwnText = Boolean(options.hasDirectOwnText);
  const hasVisibleTextualDescendant = Boolean(options.hasVisibleTextualDescendant);
  const hasExplicitlyMarkedDescendant = Boolean(options.hasExplicitlyMarkedDescendant);
  if (hasDirectOwnText) {
    return true;
  }
  return !hasVisibleTextualDescendant && !hasExplicitlyMarkedDescendant;
}

export function shouldCollectToggleableDefaultBoundary(options = {}) {
  if (!options.isToggleableDefaultExcluded) {
    return false;
  }
  if (options.isHiddenSubtree) {
    return false;
  }
  if (
    options.isWithinAiIncluded ||
    options.isWithinAiPopover ||
    options.isWithinExplicitIncluded ||
    options.isWithinConsent ||
    options.isWithinExtensionUi ||
    options.isImmutableExcluded
  ) {
    return false;
  }
  return true;
}

export function shouldAutoSeedMarkingsFromAiSelectors(options = {}) {
  return Boolean(
    options.hasAiSelectors &&
    !options.hasSavedMarkingsForPage &&
    !options.suppressAutoSeed
  );
}

export function isStoredExcludeStateUserModified(options = {}) {
  return Boolean(Boolean(options.isExcluded) !== Boolean(options.isDefaultExcluded));
}

export function shouldAllowParentMarkingBoundary(options = {}) {
  return Boolean(
    options.hasDirectText ||
    options.markableDescendantCount >= 1
  );
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

export function getExplicitMarkingFullRenderOptions() {
  return {
    delay: 40,
    minInterval: 120,
    invalidate: true,
    reason: "explicit-toggle-full-rebuild"
  };
}

export const USER_TOGGLE_DUPLICATE_WINDOW_MS = 320;

export function shouldIgnoreDuplicateUserToggle(options = {}) {
  const {
    targetXpath = "",
    mode = "exclude",
    now = 0,
    inFlightKey = "",
    lastActionKey = "",
    lastActionAt = 0
  } = options;
  if (!targetXpath) {
    return false;
  }
  const key = `${mode}:${targetXpath}`;
  if (inFlightKey && inFlightKey === key) {
    return true;
  }
  if (!lastActionKey || lastActionKey !== key) {
    return false;
  }
  return now - lastActionAt <= USER_TOGGLE_DUPLICATE_WINDOW_MS;
}

export function getExplicitMarkingPresentation(options = {}) {
  const type = options.type === "include" ? "include" : "exclude";
  const ghost = Boolean(options.ghost);
  return {
    ghost,
    className: type === "include"
      ? ghost
        ? "uf-explicit-include-ghost"
        : "uf-explicit-include"
      : ghost
        ? "uf-explicit-exclude-ghost"
        : "uf-explicit-exclude"
  };
}
