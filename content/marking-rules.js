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
    delay: 50,
    minInterval: 0,
    invalidate: true
  };
}

export function getExplicitMarkingPresentation(options = {}) {
  const type = options.type === "include" ? "include" : "exclude";
  return {
    ghost: false,
    className: type === "include" ? "uf-explicit-include" : "uf-explicit-exclude"
  };
}
