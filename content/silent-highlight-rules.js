export const DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES = 3;
export const DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS = 2600;

export function shouldRenderSilentHighlightOverlay(options = {}) {
  const shouldBeActive = Boolean(options.shouldBeActive);
  if (!shouldBeActive) {
    return false;
  }
  return Boolean(
    options.renderChanged ||
    options.positionRefreshPending ||
    !options.hasOverlay
  );
}

export function shouldCollectSilentExcludedSource(options = {}) {
  return Boolean(
    !options.isWithinIncluded &&
    options.hasRenderableText
  );
}

export function sampleSettledSilentHighlightPosition(
  previousState = {},
  signature = "",
  elapsedMs = 0,
  options = {}
) {
  const normalizedSignature = typeof signature === "string" ? signature : "";
  const requiredStableSamples = Number.isFinite(options && options.requiredStableSamples)
    ? Math.max(0, Math.trunc(options.requiredStableSamples))
    : DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES;
  const maxWaitMs = Number.isFinite(options && options.maxWaitMs)
    ? Math.max(0, Math.trunc(options.maxWaitMs))
    : DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS;
  let lastSignature = typeof previousState.lastSignature === "string"
    ? previousState.lastSignature
    : "";
  let stableSamples = Number.isFinite(previousState.stableSamples)
    ? Math.max(0, Math.trunc(previousState.stableSamples))
    : 0;

  if (normalizedSignature && normalizedSignature === lastSignature) {
    stableSamples += 1;
  } else {
    lastSignature = normalizedSignature;
    stableSamples = 0;
  }

  return {
    lastSignature,
    stableSamples,
    shouldFinalize:
      (normalizedSignature && stableSamples >= requiredStableSamples) ||
      elapsedMs >= maxWaitMs
  };
}