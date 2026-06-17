export const DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES = 3;
export const DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS = 2600;

type SilentHighlightRenderOptions = {
  shouldBeActive?: unknown;
  isFullRefresh?: unknown;
  renderChanged?: unknown;
  positionRefreshPending?: unknown;
  hasOverlay?: unknown;
};

type SilentHighlightCollectOptions = {
  isWithinIncluded?: unknown;
  hasRenderableText?: unknown;
};

type SilentHighlightRetainOptions = {
  explicitlyIncluded?: unknown;
  visibleToUser?: unknown;
};

type SilentHighlightSettleState = {
  lastSignature?: unknown;
  stableSamples?: unknown;
};

type SilentHighlightSettleOptions = {
  requiredStableSamples?: unknown;
  maxWaitMs?: unknown;
};

export function shouldRenderSilentHighlightOverlay(options: SilentHighlightRenderOptions = {}): boolean {
  const shouldBeActive = Boolean(options.shouldBeActive);
  if (!shouldBeActive) {
    return false;
  }
  return Boolean(
    options.isFullRefresh ||
    options.renderChanged ||
    options.positionRefreshPending ||
    !options.hasOverlay
  );
}

export function shouldCollectSilentExcludedSource(options: SilentHighlightCollectOptions = {}): boolean {
  return Boolean(
    !options.isWithinIncluded &&
    options.hasRenderableText
  );
}

export function shouldRetainIncludedSource(options: SilentHighlightRetainOptions = {}): boolean {
  return Boolean(
    options.explicitlyIncluded ||
    options.visibleToUser
  );
}

export function sampleSettledSilentHighlightPosition(
  previousState: SilentHighlightSettleState = {},
  signature: unknown = "",
  elapsedMs: unknown = 0,
  options: SilentHighlightSettleOptions = {}
) {
  const normalizedSignature = typeof signature === "string" ? signature : "";
  const normalizedElapsedMs = Number.isFinite(elapsedMs) ? (elapsedMs as number) : 0;
  const requiredStableSamplesValue = options?.requiredStableSamples;
  const maxWaitMsValue = options?.maxWaitMs;
  const stableSamplesValue = previousState?.stableSamples;
  const requiredStableSamples = Number.isFinite(options && options.requiredStableSamples)
    ? Math.max(0, Math.trunc(requiredStableSamplesValue as number))
    : DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES;
  const maxWaitMs = Number.isFinite(options && options.maxWaitMs)
    ? Math.max(0, Math.trunc(maxWaitMsValue as number))
    : DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS;
  let lastSignature = typeof previousState.lastSignature === "string"
    ? previousState.lastSignature
    : "";
  let stableSamples = Number.isFinite(previousState.stableSamples)
    ? Math.max(0, Math.trunc(stableSamplesValue as number))
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
      normalizedElapsedMs >= maxWaitMs
  };
}