export function shouldSelfMarkToggleableDefaultBoundary(options = {}) {
  const hasVisibleTextualDescendant = Boolean(options.hasVisibleTextualDescendant);
  return !hasVisibleTextualDescendant;
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
