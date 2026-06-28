import type { PropertyLockViewState } from "../common/bus/contracts/property-lock-state";

export type ProjectedPropertyLockProjectionState = {
  featureEnabled: boolean;
  currentTabId: number | null;
  projectedTabId: number | null;
  propertyLockView: PropertyLockViewState | null;
};

export type ProjectedPropertyLockViewStatePatch = Partial<PropertyLockViewState>;

export type ProjectedPropertyLockSnapshotEffect = {
  patch: ProjectedPropertyLockViewStatePatch | null;
  refreshRequired: boolean;
};

export function hasProjectedPropertyLockViewForTab(
  state: ProjectedPropertyLockProjectionState,
): boolean {
  return Boolean(
    state.featureEnabled &&
      state.currentTabId &&
      state.projectedTabId === state.currentTabId &&
      state.propertyLockView
  );
}

export function buildProjectedPropertyLockViewStatePatch(
  state: ProjectedPropertyLockProjectionState,
): ProjectedPropertyLockViewStatePatch | null {
  if (!hasProjectedPropertyLockViewForTab(state) || !state.propertyLockView) {
    return null;
  }
  return { ...state.propertyLockView };
}

export function deriveProjectedPropertyLockSnapshotEffect(
  state: ProjectedPropertyLockProjectionState & { hadProjectedPropertyLockView: boolean },
): ProjectedPropertyLockSnapshotEffect {
  const patch = buildProjectedPropertyLockViewStatePatch(state);
  return {
    patch,
    refreshRequired: !patch && state.hadProjectedPropertyLockView,
  };
}
