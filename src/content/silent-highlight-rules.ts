export const DEFAULT_SILENT_HIGHLIGHT_SETTLE_STABLE_SAMPLES = 3;
export const DEFAULT_SILENT_HIGHLIGHT_SETTLE_MAX_WAIT_MS = 2600;

type SilentHighlightRenderOptions = {
  shouldBeActive?: boolean;
  isFullRefresh?: boolean;
  renderChanged?: boolean;
  positionRefreshPending?: boolean;
  hasOverlay?: boolean;
};

type SilentHighlightCollectOptions = {
  isWithinIncluded?: boolean;
  hasRenderableText?: boolean;
};

type SilentHighlightRetainOptions = {
  explicitlyIncluded?: boolean;
  visibleToUser?: boolean;
};

type SilentHighlightSettleState = {
  lastSignature?: string;
  stableSamples?: number;
};

type SilentHighlightSettleOptions = {
  requiredStableSamples?: number;
  maxWaitMs?: number;
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
  signature: string = "",
  elapsedMs: number = 0,
  options: SilentHighlightSettleOptions = {}
) {
  const normalizedSignature = signature;
  const normalizedElapsedMs = elapsedMs;
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