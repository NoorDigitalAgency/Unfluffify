const AI_SUBMISSION_DOCUMENT_ROOT_XPATHS = new Set<string>([
  "/html[1]",
  "/html[1]/body[1]"
]);

type AiSubmissionRowStateOptions = {
  explicitlyIncluded?: boolean;
  excludedRow?: boolean;
  explicitlyExcluded?: boolean;
  immutableExcludedRoot?: boolean;
  insideExcludedAncestor?: boolean;
  markableTextual?: boolean;
  visibleToUser?: boolean;
};

type AiSubmissionRowState = {
  shouldSubmit: boolean;
  excluded: boolean;
};

export function isAiSubmissionDocumentRootXpath(xpath: unknown): boolean {
  return AI_SUBMISSION_DOCUMENT_ROOT_XPATHS.has(
    typeof xpath === "string" ? xpath.trim() : ""
  );
}

export function resolveAiSubmissionRowState(options: AiSubmissionRowStateOptions = {}): AiSubmissionRowState {
  const explicitlyIncluded = Boolean(options.explicitlyIncluded);
  const excludedRow = Boolean(options.excludedRow || options.explicitlyExcluded);

  if (options.immutableExcludedRoot) {
    return { shouldSubmit: false, excluded: false };
  }

  if (explicitlyIncluded) {
    return { shouldSubmit: true, excluded: false };
  }

  if (options.insideExcludedAncestor) {
    return { shouldSubmit: false, excluded: false };
  }

  if (excludedRow) {
    return { shouldSubmit: true, excluded: true };
  }

  if (!options.markableTextual) {
    return { shouldSubmit: false, excluded: false };
  }

  if (!options.visibleToUser) {
    return { shouldSubmit: true, excluded: true };
  }

  return { shouldSubmit: true, excluded: false };
}
