export const NAVIGATION_INSPECTION_TIMEOUT_MS = 1_500;

export type NavigationInspection = Readonly<{
  decision: "allow" | "block";
  dirty: "clean" | "dirty" | "unknown";
  reason?: string;
}>;

export type CandidateNavigationResult =
  | Readonly<{ status: "navigated"; warning: string | null }>
  | Readonly<{ status: "blocked"; reason: string }>
  | Readonly<{ status: "failed"; reason: string; restored: boolean }>;

async function boundedInspection(
  inspect: () => Promise<NavigationInspection>,
  timeoutMs: number,
): Promise<NavigationInspection> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      inspect().catch(() => ({
        decision: "allow" as const,
        dirty: "unknown" as const,
        reason: "Navigation state could not be inspected.",
      })),
      new Promise<NavigationInspection>((resolve) => {
        timer = setTimeout(() => resolve({
          decision: "allow",
          dirty: "unknown",
          reason: "Navigation state inspection timed out.",
        }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Runs only after the inline confirmation. Inspection failures are bounded and
 * fail open with a generic warning; an explicit block never is. If navigation
 * itself fails, a page that was active is made usable again. */
export async function executeConfirmedCandidateNavigation(input: Readonly<{
  inspect: () => Promise<NavigationInspection>;
  restoreNeeded: boolean;
  deactivate: () => Promise<boolean>;
  navigate: () => Promise<void>;
  reapplyMobile: () => Promise<void>;
  restore: () => Promise<boolean>;
  timeoutMs?: number;
}>): Promise<CandidateNavigationResult> {
  const inspection = await boundedInspection(
    input.inspect,
    input.timeoutMs ?? NAVIGATION_INSPECTION_TIMEOUT_MS,
  );
  if (inspection.decision === "block") {
    return { status: "blocked", reason: inspection.reason ?? "Navigation was blocked." };
  }

  const warning = inspection.dirty === "unknown"
    ? inspection.reason ?? "Navigation state could not be inspected."
    : null;
  const deactivated = await input.deactivate().catch(() => false);
  try {
    await input.navigate();
  } catch (error) {
    const restored = input.restoreNeeded && deactivated
      ? await input.restore().catch(() => false)
      : true;
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "Candidate navigation failed.",
      restored,
    };
  }
  await input.reapplyMobile().catch(() => undefined);
  return {
    status: "navigated",
    warning: warning ?? (deactivated ? null : "Page cleanup could not be confirmed before navigation."),
  };
}
