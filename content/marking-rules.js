export function shouldSelfMarkToggleableDefaultBoundary(options = {}) {
  const hasVisibleTextualDescendant = Boolean(options.hasVisibleTextualDescendant);
  const hasExplicitlyMarkedDescendant = Boolean(options.hasExplicitlyMarkedDescendant);
  return !hasVisibleTextualDescendant && !hasExplicitlyMarkedDescendant;
}

export function shouldAutoSeedMarkingsFromAiSelectors(options = {}) {
  return Boolean(options.hasAiSelectors && !options.hasSavedMarkingsForPage);
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
    delay: 0,
    minInterval: 500,
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
  return {
    ghost: false,
    className: type === "include" ? "uf-explicit-include" : "uf-explicit-exclude"
  };
}
