export function resolveAiSubmissionRowState(options = {}) {
  if (options.explicitlyExcluded) {
    return { shouldSubmit: true, excluded: true };
  }

  const explicitlyIncluded = Boolean(options.explicitlyIncluded);
  const visibleToUser = Boolean(options.visibleToUser);

  if (options.insideExcludedAncestor && !explicitlyIncluded) {
    return { shouldSubmit: false, excluded: false };
  }

  if (explicitlyIncluded) {
    return { shouldSubmit: true, excluded: !visibleToUser };
  }

  if (!options.markableTextual) {
    return { shouldSubmit: false, excluded: false };
  }

  return { shouldSubmit: true, excluded: !visibleToUser };
}