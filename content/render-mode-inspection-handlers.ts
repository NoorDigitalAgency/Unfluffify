// @ts-nocheck
export function createRenderModeInspectionHandlers(deps) {
  function resolveOperationId(message = {}) {
    return typeof message.operationId === "string" && message.operationId
      ? message.operationId
      : deps.createLifecycleOperationId(deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION);
  }

  function begin(message = {}) {
    deps.setRenderModeInspectionActive(true);
    deps.cancelSilentHighlightEditorActivation();
    deps.emitLifecycleEvent({
      operationId: resolveOperationId(message),
      kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
      phase: deps.LIFECYCLE_PHASES.STARTED,
      busy: true,
      message: "Inspecting page..."
    });
    return { ok: true };
  }

  async function revealOnce(message = {}) {
    const operationId = resolveOperationId(message);
    deps.setRenderModeInspectionActive(true);
    deps.cancelSilentHighlightEditorActivation();
    const pageUrl = deps.getPageUrl();
    const baseUrl = message.baseUrl || await deps.resolveBaseUrlForCurrentPage();
    if (!baseUrl || !deps.isPageWithinBaseUrl(pageUrl, baseUrl)) {
      deps.finishPageInspectionUi();
      deps.emitLifecycleEvent({
        operationId,
        kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
        phase: deps.LIFECYCLE_PHASES.FAILED,
        busy: false,
        message: ""
      });
      return { ok: false };
    }
    if (!deps.consumePageVisitRevealFreezeAttempt(baseUrl, pageUrl)) {
      deps.finishPageInspectionUi();
      deps.emitLifecycleEvent({
        operationId,
        kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
        phase: deps.LIFECYCLE_PHASES.REVEAL_FINISHED,
        busy: true,
        message: "Inspecting page..."
      });
      return { ok: true, pageUrl, skippedReveal: true };
    }

    const revealId = deps.nextRevealId();
    deps.setSilentHighlightEditorRevealInFlight(revealId);
    const isStillCurrent = () =>
      deps.isRenderModeInspectionFlagSet() &&
      deps.getSilentHighlightEditorRevealInFlight() === revealId &&
      deps.getPageUrl() === pageUrl &&
      deps.isPageWithinBaseUrl(deps.getPageUrl(), baseUrl);

    deps.emitLifecycleEvent({
      operationId,
      kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
      phase: deps.LIFECYCLE_PHASES.REVEAL_STARTED,
      busy: true,
      message: "Inspecting page..."
    });
    deps.armRenderModeInspectionWatchdog();

    try {
      const prepared = await deps.warmupSilentHighlightingBeforeMotionPause(
        baseUrl,
        pageUrl,
        deps.SILENT_HIGHLIGHTING_MOTION_PAUSE_REASON,
        {
          keepUiActive: true,
          onRevealProgress: () => {
            if (deps.isRenderModeInspectionFlagSet()) {
              deps.armRenderModeInspectionWatchdog();
            }
          }
        }
      );
      if (deps.isRenderModeInspectionFlagSet()) {
        deps.armRenderModeInspectionWatchdog();
      }
      if (!prepared || !isStillCurrent()) {
        deps.finishPageInspectionUi();
        deps.emitLifecycleEvent({
          operationId,
          kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
          phase: deps.LIFECYCLE_PHASES.FAILED,
          busy: false,
          message: ""
        });
        return { ok: false };
      }
      deps.markSilentHighlightEditorRevealPrepared(baseUrl, pageUrl);
      deps.emitLifecycleEvent({
        operationId,
        kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
        phase: deps.LIFECYCLE_PHASES.REVEAL_FINISHED,
        busy: true,
        message: "Inspecting page..."
      });
      return { ok: true, pageUrl };
    } catch {
      deps.finishPageInspectionUi();
      return { ok: false };
    }
  }

  async function captureHtml(message = {}) {
    const operationId = resolveOperationId(message);
    if (deps.isRenderModeInspectionActive()) {
      deps.armRenderModeInspectionWatchdog();
    }
    try {
      const snapshot = deps.createCurrentPageSnapshot();
      const pageUrl = deps.getPageUrl();
      const rawHtml = await deps.fetchCurrentPageRawHtml(pageUrl);
      deps.finishPageInspectionUi();
      deps.emitLifecycleEvent({
        operationId,
        kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
        phase: deps.LIFECYCLE_PHASES.HTML_CAPTURED,
        busy: true,
        message: "Inspecting page..."
      });
      return {
        ok: Boolean(snapshot && snapshot.renderedHtml && typeof rawHtml === "string"),
        pageUrl,
        renderedHtml: snapshot && typeof snapshot.renderedHtml === "string" ? snapshot.renderedHtml : "",
        rawHtml: typeof rawHtml === "string" ? rawHtml : "",
        renderMode: snapshot && typeof snapshot.renderMode === "string" ? snapshot.renderMode : ""
      };
    } catch {
      deps.finishPageInspectionUi();
      return { ok: false };
    }
  }

  function end(message = {}) {
    const operationId = resolveOperationId(message);
    deps.setRenderModeInspectionActive(false);
    if (deps.getSilentHighlightEditorRevealInFlight()) {
      deps.setSilentHighlightEditorRevealInFlight(0);
    }
    deps.finishPageInspectionUi();
    if (deps.getPropertyLockBannerMode() === "editor_inspection_reconnecting") {
      deps.updatePropertyLockBannerMode();
      deps.renderPropertyLockBanner();
    }
    deps.emitLifecycleEvent({
      operationId,
      kind: deps.LIFECYCLE_KINDS.RENDER_MODE_INSPECTION,
      phase: deps.LIFECYCLE_PHASES.FINISHED,
      busy: false,
      message: ""
    });
    return { ok: true };
  }

  function hideConsent() {
    const hiddenCount = deps.hideConsentElements();
    return { ok: true, hiddenCount };
  }

  return {
    begin,
    revealOnce,
    captureHtml,
    end,
    hideConsent
  };
}
