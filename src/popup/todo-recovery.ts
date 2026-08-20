import type { PageContextResolution } from "../domain/schema/context";

export const TODO_RECOVERY_INTERVAL_MS = 15_000;

type TodoStatus = PageContextResolution["status"] | "unresolved";

/** Refresh every settled canonical feed on a deliberate cadence. That both
 * discovers removal/conflict and lets either suspension recover, without
 * turning the popup's 500 ms signal poll into a Hub polling loop. */
export function todoRefreshDue(status: TodoStatus, refreshedAt: number, now: number): boolean {
  return status !== "unresolved" && now - refreshedAt >= TODO_RECOVERY_INTERVAL_MS;
}

/** Current and incomplete groups open adaptively; a manual per-property choice
 * wins until that property key is left and later revisited. */
export function todoSectionExpanded(
  input: Readonly<{ current: boolean; markedCount: number }>,
  manualOverride?: boolean,
): boolean {
  return manualOverride ?? (input.current || input.markedCount < 1);
}
