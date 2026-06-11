export function createInspectionStatusResolver(deps) {
  function resolve() {
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
