export type GeometryStabilizerOptions = Readonly<{
  sample: () => string;
  onSample: () => void;
  onSettled?: () => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  maxSamples?: number;
  requiredStableSamples?: number;
}>;

/**
 * Coalesces geometry-observer storms and follows a changing layout for a small,
 * bounded number of animation frames. Two matching samples are enough to stop;
 * an endlessly animating page can never keep the extension busy indefinitely.
 */
export function createGeometryStabilizer(options: GeometryStabilizerOptions) {
  const maxSamples = Math.max(1, options.maxSamples ?? 4);
  const requiredStableSamples = Math.max(1, options.requiredStableSamples ?? 2);
  let frameHandle = 0;
  let sampleCount = 0;
  let stableSamples = 0;
  let previousSample = "";

  const finish = (): void => {
    frameHandle = 0;
    sampleCount = 0;
    stableSamples = 0;
    previousSample = "";
    options.onSettled?.();
  };

  const sampleFrame = (): void => {
    frameHandle = 0;
    const currentSample = options.sample();
    sampleCount += 1;
    stableSamples = currentSample === previousSample ? stableSamples + 1 : 1;
    previousSample = currentSample;
    options.onSample();
    if (stableSamples >= requiredStableSamples || sampleCount >= maxSamples) {
      finish();
      return;
    }
    frameHandle = options.requestFrame(sampleFrame);
  };

  return {
    request(): void {
      if (frameHandle !== 0) {
        return;
      }
      frameHandle = options.requestFrame(sampleFrame);
    },
    cancel(): void {
      if (frameHandle !== 0) {
        options.cancelFrame(frameHandle);
      }
      frameHandle = 0;
      sampleCount = 0;
      stableSamples = 0;
      previousSample = "";
    },
  };
}
