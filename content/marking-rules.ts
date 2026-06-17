type ToggleableBoundaryOptions = {
  hasDirectOwnText?: unknown;
  hasVisibleTextualDescendant?: unknown;
  hasExplicitlyMarkedDescendant?: unknown;
};

type CollectToggleableBoundaryOptions = {
  isToggleableDefaultExcluded?: unknown;
  isHiddenSubtree?: unknown;
  isWithinAiIncluded?: unknown;
  isWithinAiPopover?: unknown;
  isWithinExplicitIncluded?: unknown;
  isWithinConsent?: unknown;
  isWithinExtensionUi?: unknown;
  isImmutableExcluded?: unknown;
};

type AutoSeedOptions = {
  hasAiSelectors?: unknown;
  hasSavedMarkingsForPage?: unknown;
  suppressAutoSeed?: unknown;
};

type ExcludeParentCandidate = {
  isStructuredGroup?: unknown;
  isToggleableBoundary?: unknown;
  isMarkable?: unknown;
  value?: unknown;
};

export function shouldSelfMarkToggleableDefaultBoundary(options: ToggleableBoundaryOptions = {}): boolean {
  const hasDirectOwnText = Boolean(options.hasDirectOwnText);
  const hasVisibleTextualDescendant = Boolean(options.hasVisibleTextualDescendant);
  const hasExplicitlyMarkedDescendant = Boolean(options.hasExplicitlyMarkedDescendant);
  if (hasDirectOwnText) {
    return true;
  }
  return !hasVisibleTextualDescendant && !hasExplicitlyMarkedDescendant;
}

export function shouldCollectToggleableDefaultBoundary(options: CollectToggleableBoundaryOptions = {}): boolean {
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

export function shouldAutoSeedMarkingsFromAiSelectors(options: AutoSeedOptions = {}): boolean {
  return Boolean(
    options.hasAiSelectors &&
    !options.hasSavedMarkingsForPage &&
    !options.suppressAutoSeed
  );
}

export function isStoredExcludeStateUserModified(options: { isExcluded?: unknown; isDefaultExcluded?: unknown } = {}): boolean {
  return Boolean(Boolean(options.isExcluded) !== Boolean(options.isDefaultExcluded));
}

export function shouldAllowParentMarkingBoundary(options: { hasDirectText?: unknown; markableDescendantCount?: number } = {}): boolean {
  const markableDescendantCount = Number.isFinite(options.markableDescendantCount)
    ? (options.markableDescendantCount as number)
    : 0;
  return Boolean(
    options.hasDirectText ||
    markableDescendantCount >= 1
  );
}

export function chooseExcludeParentBoundaryTarget(
  options: {
    selfValue?: unknown;
    selfStructuredGroup?: unknown;
    selfToggleableBoundary?: unknown;
    ancestors?: unknown;
  } = {}
): unknown {
  const selfValue = Object.prototype.hasOwnProperty.call(options, "selfValue")
    ? options.selfValue
    : null;
  if (options.selfStructuredGroup || options.selfToggleableBoundary) {
    return selfValue;
  }
  const ancestors = (Array.isArray(options.ancestors) ? options.ancestors : []) as ExcludeParentCandidate[];
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
    delay: 0,
    minInterval: 120,
    invalidate: true,
    reason: "explicit-toggle-full-rebuild"
  };
}

export const USER_TOGGLE_DUPLICATE_WINDOW_MS = 320;

export function shouldIgnoreDuplicateUserToggle(
  options: {
    targetXpath?: unknown;
    mode?: unknown;
    now?: unknown;
    inFlightKey?: unknown;
    lastActionKey?: unknown;
    lastActionAt?: unknown;
  } = {}
): boolean {
  const {
    targetXpath = "",
    mode = "exclude",
    now = 0,
    inFlightKey = "",
    lastActionKey = "",
    lastActionAt = 0
  } = options;
  const normalizedTargetXpath = typeof targetXpath === "string" ? targetXpath : "";
  const normalizedMode = typeof mode === "string" ? mode : "exclude";
  const normalizedNow = Number.isFinite(now) ? (now as number) : 0;
  const normalizedInFlightKey = typeof inFlightKey === "string" ? inFlightKey : "";
  const normalizedLastActionKey = typeof lastActionKey === "string" ? lastActionKey : "";
  const normalizedLastActionAt = Number.isFinite(lastActionAt) ? (lastActionAt as number) : 0;

  if (!normalizedTargetXpath) {
    return false;
  }
  const key = `${normalizedMode}:${normalizedTargetXpath}`;
  if (normalizedInFlightKey && normalizedInFlightKey === key) {
    return true;
  }
  if (!normalizedLastActionKey || normalizedLastActionKey !== key) {
    return false;
  }
  return normalizedNow - normalizedLastActionAt <= USER_TOGGLE_DUPLICATE_WINDOW_MS;
}

export function getExplicitMarkingPresentation(options: { type?: unknown; ghost?: unknown } = {}) {
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
