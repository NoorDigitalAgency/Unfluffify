type ToggleableBoundaryOptions = {
  hasDirectOwnText?: boolean;
  hasVisibleTextualDescendant?: boolean;
  hasExplicitlyMarkedDescendant?: boolean;
};

type CollectToggleableBoundaryOptions = {
  isToggleableDefaultExcluded?: boolean;
  isHiddenSubtree?: boolean;
  isWithinAiIncluded?: boolean;
  isWithinAiPopover?: boolean;
  isWithinExplicitIncluded?: boolean;
  isWithinConsent?: boolean;
  isWithinExtensionUi?: boolean;
  isImmutableExcluded?: boolean;
};

type AutoSeedOptions = {
  hasAiSelectors?: boolean;
  hasSavedMarkingsForPage?: boolean;
  suppressAutoSeed?: boolean;
};

type ExcludeParentCandidate<T> = {
  isStructuredGroup?: boolean;
  isToggleableBoundary?: boolean;
  isMarkable?: boolean;
  value?: T | null;
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

export function isStoredExcludeStateUserModified(options: { isExcluded?: boolean; isDefaultExcluded?: boolean } = {}): boolean {
  return Boolean(Boolean(options.isExcluded) !== Boolean(options.isDefaultExcluded));
}

export function shouldAllowParentMarkingBoundary(options: { hasDirectText?: boolean; markableDescendantCount?: number } = {}): boolean {
  const markableDescendantCount = Number.isFinite(options.markableDescendantCount ?? Number.NaN)
    ? Number(options.markableDescendantCount)
    : 0;
  // F3 LOCKED (deliberate 052c deviation, see marking-widening-review.md):
  // a descendants-only widen target must GROUP several content pieces — at
  // least two markable descendants. Single-child wrappers stop being widen
  // targets (the user excludes the child directly instead).
  return Boolean(
    options.hasDirectText ||
    markableDescendantCount >= 2
  );
}

export function chooseExcludeParentBoundaryTarget<T>(
  options: {
    selfValue?: T | null;
    selfStructuredGroup?: boolean;
    selfToggleableBoundary?: boolean;
    ancestors?: ExcludeParentCandidate<T>[];
  } = {}
): T | null {
  const selfValue: T | null = Object.prototype.hasOwnProperty.call(options, "selfValue")
    ? (options.selfValue ?? null)
    : null;
  if (options.selfStructuredGroup || options.selfToggleableBoundary) {
    return selfValue;
  }
  const ancestors = Array.isArray(options.ancestors) ? options.ancestors : [];
  const structuredGroupAncestor = ancestors.find(
    (candidate) => candidate && candidate.isStructuredGroup && candidate.value
  );
  if (structuredGroupAncestor) {
    return structuredGroupAncestor.value ?? null;
  }
  const toggleableAncestor = ancestors.find(
    (candidate) => candidate && candidate.isToggleableBoundary && candidate.value
  );
  if (toggleableAncestor) {
    return toggleableAncestor.value ?? null;
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
    targetXpath?: string;
    mode?: string;
    now?: number;
    inFlightKey?: string;
    lastActionKey?: string;
    lastActionAt?: number;
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
  const normalizedNow = Number.isFinite(now) ? now : 0;
  const normalizedInFlightKey = typeof inFlightKey === "string" ? inFlightKey : "";
  const normalizedLastActionKey = typeof lastActionKey === "string" ? lastActionKey : "";
  const normalizedLastActionAt = Number.isFinite(lastActionAt) ? lastActionAt : 0;

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

export function getExplicitMarkingPresentation(options: { type?: string; ghost?: boolean } = {}) {
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
