import {
  SECONDARY_GATES_BLOCK_REASONS,
  type SecondaryGatesViewState
} from "../common/bus/contracts/secondary-gates-state";

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

export const NEUTRAL_SECONDARY_GATES_VIEW_PATCH: ProjectedSecondaryGatesViewStatePatch = {
  pageSaveBlockedReason: SECONDARY_GATES_BLOCK_REASONS.NOT_READY,
  pageRevertBlockedReason: SECONDARY_GATES_BLOCK_REASONS.NOT_READY,
  markingPreviewBlockedReason: SECONDARY_GATES_BLOCK_REASONS.NOT_READY,
  saveExcludesButtonDisabled: true,
  saveExcludesBlockedReason: SECONDARY_GATES_BLOCK_REASONS.NOT_READY,
  previewLatestButtonDisabled: true,
  previewLatestBlockedReason: SECONDARY_GATES_BLOCK_REASONS.NOT_READY,
  desktopPreviewVisible: false,
  desktopPreviewEnabled: false,
  desktopPreviewDisabled: true,
  desktopPreviewBlockedReason: SECONDARY_GATES_BLOCK_REASONS.NOT_READY,
  lynxChecklistSendBlockedReason: SECONDARY_GATES_BLOCK_REASONS.NOT_READY,
  lynxChecklistSendBlockedPageTypeKeys: [],
  navigationInspectionActive: false,
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

export function resolveSecondaryGatesViewStatePatch(
  state: ProjectedSecondaryGatesProjectionState,
): ProjectedSecondaryGatesViewStatePatch {
  return buildProjectedSecondaryGatesViewStatePatch(state) || NEUTRAL_SECONDARY_GATES_VIEW_PATCH;
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
