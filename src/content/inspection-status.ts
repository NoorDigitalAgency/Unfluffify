type InspectionStatusDeps = {
  getPageUrl: () => string;
  getPageSaveReconciliationState: (pageUrl: string) => { reason?: string } | null;
  isPageSaveReconciliationPending: (pageUrl: string) => boolean;
  isPageInspectionUiActive: () => boolean;
  SILENT_HIGHLIGHTING_PREPARATION_REASON: string;
  getSilentHighlightEditorActivationPromise: () => Promise<unknown> | null | undefined;
  getPropertyLockEditorClaimPending: () => unknown;
  isRenderModeInspectionActive: () => boolean;
  isMarkingEnabled: () => unknown;
  getCurrentContentMode: () => unknown;
};

export function createInspectionStatusResolver(deps: InspectionStatusDeps) {
  function resolve(): {
    ok: true;
    active: boolean;
    pending: boolean;
    renderModeInspectionActive: boolean;
    markingEnabled: boolean;
    mode: unknown;
    lockClaimPending: boolean;
    pendingReason: string;
  } {
    const pageUrl = deps.getPageUrl();
    const reconciliation = deps.getPageSaveReconciliationState(pageUrl);
    const reconciliationPending = deps.isPageSaveReconciliationPending(pageUrl);
    const inspectionActive = deps.isPageInspectionUiActive();
    const silentHighlightPreparationActive = Boolean(
      reconciliation &&
      reconciliation.reason === deps.SILENT_HIGHLIGHTING_PREPARATION_REASON
    );
    const editorPreparationPending = Boolean(
      silentHighlightPreparationActive ||
      deps.getSilentHighlightEditorActivationPromise()
    );
    const lockClaimPending = Boolean(deps.getPropertyLockEditorClaimPending());
    const inspectionPending = inspectionActive || editorPreparationPending || reconciliationPending;

    return {
      ok: true,
      active: inspectionActive,
      pending: inspectionPending,
      renderModeInspectionActive: deps.isRenderModeInspectionActive(),
      markingEnabled: Boolean(deps.isMarkingEnabled()),
      mode: deps.getCurrentContentMode(),
      lockClaimPending,
      pendingReason: reconciliation && (reconciliationPending || editorPreparationPending)
        ? reconciliation.reason || "pending"
        : ""
    };
  }

  return { resolve };
}
