export type PreviewExitAttemptResult = Readonly<{
  exited: boolean;
  attempts: number;
  error: string | null;
}>;

/**
 * Runs one operator-owned Preview exit as a bounded, idempotent protocol.
 * Content remains the only authority that can declare restoration complete;
 * retries merely replay the same false→true request edge when either half of
 * the extension message round trip was lost.
 */
export async function runPreviewExitAttempts(options: Readonly<{
  attempt: (attemptNumber: number) => Promise<boolean>;
  isTerminal: () => boolean;
  isCurrent: () => boolean;
  maxAttempts?: number;
}>): Promise<PreviewExitAttemptResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  let attempts = 0;
  let error: string | null = null;
  while (attempts < maxAttempts) {
    if (options.isTerminal()) {
      return { exited: true, attempts, error };
    }
    if (!options.isCurrent()) {
      return { exited: false, attempts, error };
    }
    attempts += 1;
    try {
      if (await options.attempt(attempts) || options.isTerminal()) {
        return { exited: true, attempts, error };
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  return { exited: options.isTerminal(), attempts, error };
}
