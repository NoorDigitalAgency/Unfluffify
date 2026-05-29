export function shouldSelfMarkToggleableDefaultBoundary(options = {}) {
  const hasVisibleTextualDescendant = Boolean(options.hasVisibleTextualDescendant);
  const hasExplicitlyMarkedDescendant = Boolean(options.hasExplicitlyMarkedDescendant);
  return !hasVisibleTextualDescendant && !hasExplicitlyMarkedDescendant;
}

export function shouldPromoteDefaultBoundaryToInclude(options = {}) {
  if (options.mode !== "exclude") {
    return false;
  }
  if (options.shiftHeld || options.altHeld) {
    return false;
  }
  if (!options.defaultBoundaryExists) {
    return false;
  }
  if (options.isWithinAiIncluded || options.isWithinExplicitIncluded) {
    return false;
  }
  if (options.defaultBoundaryAlreadyUserModified) {
    return false;
  }
  return true;
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

export function getExplicitMarkingRenderOptions() {
  return {
    delay: 80,
    minInterval: 200,
    invalidate: false,
    reason: "explicit-toggle-reposition"
  };
}

export function getExplicitMarkingFullRenderOptions() {
  return {
    delay: 120,
    minInterval: 500,
    invalidate: true,
    reason: "explicit-toggle-full-rebuild"
  };
}

export function filterDefaultElementsForExplicitMarks(defaultElements = [], explicitElements = []) {
  if (!Array.isArray(defaultElements) || defaultElements.length === 0) {
    return [];
  }
  if (!Array.isArray(explicitElements) || explicitElements.length === 0) {
    return defaultElements;
  }
  return defaultElements.filter((defaultElement) => {
    if (!defaultElement) {
      return false;
    }
    return !explicitElements.some((explicitElement) => {
      if (!explicitElement) {
        return false;
      }
      return defaultElement === explicitElement ||
        (typeof defaultElement.contains === "function" && defaultElement.contains(explicitElement)) ||
        (typeof explicitElement.contains === "function" && explicitElement.contains(defaultElement));
    });
  });
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
