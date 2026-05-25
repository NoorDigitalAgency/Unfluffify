export function resolveAiSubmissionRowState(options = {}) {
  if (options.explicitlyExcluded) {
    return { shouldSubmit: true, excluded: true };
  }

  const explicitlyIncluded = Boolean(options.explicitlyIncluded);

  if (explicitlyIncluded) {
    return { shouldSubmit: true, excluded: false };
  }

  if (options.insideExcludedAncestor) {
    return { shouldSubmit: false, excluded: false };
  }

  if (
    options.consentExcludedRoot ||
    options.immutableExcludedRoot ||
    options.hiddenToggleableRoot
  ) {
    return { shouldSubmit: true, excluded: true };
  }

  if (!options.markableTextual) {
    return { shouldSubmit: false, excluded: false };
  }

  return { shouldSubmit: true, excluded: false };
}