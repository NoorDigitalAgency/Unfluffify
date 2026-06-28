import type { SecondaryGatesViewState } from "../common/bus/contracts/secondary-gates-state";

export type ProjectedSecondaryGatesProjectionState = {
  currentTabId: number | null;
  projectedTabId: number | null;
  secondaryGates: SecondaryGatesViewState | null;
};

export type ProjectedSecondaryGatesViewStatePatch = Readonly<{
  pageSaveBlockedReason: string;
  pageRevertBlockedReason: string;
  markingPreviewBlockedReason: string;
  saveExcludesButtonDisabled: boolean;
  saveExcludesBlockedReason: string;
  previewLatestButtonDisabled: boolean;
  previewLatestBlockedReason: string;
  desktopPreviewVisible: boolean;
  desktopPreviewEnabled: boolean;
  desktopPreviewDisabled: boolean;
  desktopPreviewBlockedReason: string;
  lynxChecklistSendBlockedReason: string;
  lynxChecklistSendBlockedPageTypeKeys: string[];
  navigationInspectionActive: boolean;
}>;

export type ProjectedSecondaryGatesSnapshotEffect = {
  patch: ProjectedSecondaryGatesViewStatePatch | null;
  refreshRequired: boolean;
};

export function hasProjectedSecondaryGatesForTab(
  state: ProjectedSecondaryGatesProjectionState,
): boolean {
  return Boolean(
    state.currentTabId &&
      state.projectedTabId === state.currentTabId &&
      state.secondaryGates
  );
}

export function buildProjectedSecondaryGatesViewStatePatch(
  state: ProjectedSecondaryGatesProjectionState,
): ProjectedSecondaryGatesViewStatePatch | null {
  if (!hasProjectedSecondaryGatesForTab(state) || !state.secondaryGates) {
    return null;
  }
  return {
    pageSaveBlockedReason: state.secondaryGates.pageSaveBlockedReason,
    pageRevertBlockedReason: state.secondaryGates.pageRevertBlockedReason,
    markingPreviewBlockedReason: state.secondaryGates.markingPreviewBlockedReason,
    saveExcludesButtonDisabled: state.secondaryGates.saveExcludesButtonDisabled,
    saveExcludesBlockedReason: state.secondaryGates.saveExcludesBlockedReason,
    previewLatestButtonDisabled: state.secondaryGates.previewLatestButtonDisabled,
    previewLatestBlockedReason: state.secondaryGates.previewLatestBlockedReason,
    desktopPreviewVisible: state.secondaryGates.desktopPreviewVisible,
    desktopPreviewEnabled: state.secondaryGates.desktopPreviewEnabled,
    desktopPreviewDisabled: state.secondaryGates.desktopPreviewDisabled,
    desktopPreviewBlockedReason: state.secondaryGates.desktopPreviewBlockedReason,
    lynxChecklistSendBlockedReason: state.secondaryGates.lynxChecklistSendBlockedReason.code,
    lynxChecklistSendBlockedPageTypeKeys: [
      ...state.secondaryGates.lynxChecklistSendBlockedReason.pageTypeKeys
    ],
    navigationInspectionActive: state.secondaryGates.navigationInspectionActive,
  };
}

export function deriveProjectedSecondaryGatesSnapshotEffect(
  state: ProjectedSecondaryGatesProjectionState & { hadProjectedSecondaryGates: boolean },
): ProjectedSecondaryGatesSnapshotEffect {
  const patch = buildProjectedSecondaryGatesViewStatePatch(state);
  return {
    patch,
    refreshRequired: !patch && state.hadProjectedSecondaryGates,
  };
}
