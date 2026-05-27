const AI_SUBMISSION_DOCUMENT_ROOT_XPATHS = new Set([
  "/html[1]",
  "/html[1]/body[1]"
]);

export function isAiSubmissionDocumentRootXpath(xpath) {
  return AI_SUBMISSION_DOCUMENT_ROOT_XPATHS.has(
    typeof xpath === "string" ? xpath.trim() : ""
  );
}

export function resolveAiSubmissionRowState(options = {}) {
  const explicitlyIncluded = Boolean(options.explicitlyIncluded);

  if (explicitlyIncluded) {
    return { shouldSubmit: true, excluded: false };
  }

  if (options.insideExcludedAncestor) {
    return { shouldSubmit: false, excluded: false };
  }

  if (options.explicitlyExcluded) {
    return { shouldSubmit: true, excluded: true };
  }

  if (
    options.consentExcludedRoot ||
    options.immutableExcludedRoot ||
    options.hiddenToggleableRoot
  ) {
    return { shouldSubmit: true, excluded: true };
  }

  if (!options.visibleToUser) {
    return { shouldSubmit: false, excluded: false };
  }

  if (!options.markableTextual) {
    return { shouldSubmit: false, excluded: false };
  }

  return { shouldSubmit: true, excluded: false };
}