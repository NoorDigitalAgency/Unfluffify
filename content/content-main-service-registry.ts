// @ts-nocheck
export function createContentMainServiceRegistry(factories) {
  let pageToastClient = null;
  let pageSaveReconciliationClearHandler = null;
  let pageSaveReconciliationPendingHandler = null;
  let renderModeInspectionClient = null;
  let renderModeInspectionHandlers = null;
  let inspectionStatusResolver = null;
  let pageDraftStatusHandler = null;
  let pageDraftRevertHandler = null;
  let pageDraftSaveHandler = null;
  let aiPreviewCloseHandler = null;
  let aiPreviewComputeLockHandler = null;
  let aiPreviewExpandedModeHandler = null;
  let aiPreviewGetStateHandler = null;
  let aiPreviewShowHandler = null;
  let aiPreviewStateResponseBuilder = null;
  let aiSubmissionXpathsHandler = null;
  let capturePageSnapshotHandler = null;
  let collectPageDataHandler = null;
  let configUpdatedHandler = null;
  let defaultExclusionsHandler = null;
  let describeXpathsHandler = null;
  let explicitMarkingHandler = null;
  let focusHandler = null;
  let forceRefreshHandler = null;
  let invisibleXpathsHandler = null;
  let propertyLockPortClient = null;
  let propertyLockStateMachine = null;
  let visibleXpathsHandler = null;

  return {
    getPageToastClient() {
      if (!pageToastClient) {
        pageToastClient = factories.createPageToastClient();
      }
      return pageToastClient;
    },
    getPageSaveReconciliationClearHandler() {
      if (!pageSaveReconciliationClearHandler) {
        pageSaveReconciliationClearHandler = factories.createPageSaveReconciliationClearHandler();
      }
      return pageSaveReconciliationClearHandler;
    },
    getPageSaveReconciliationPendingHandler() {
      if (!pageSaveReconciliationPendingHandler) {
        pageSaveReconciliationPendingHandler = factories.createPageSaveReconciliationPendingHandler();
      }
      return pageSaveReconciliationPendingHandler;
    },
    getRenderModeInspectionClient() {
      if (!renderModeInspectionClient) {
        renderModeInspectionClient = factories.createRenderModeInspectionClient();
      }
      return renderModeInspectionClient;
    },
    getRenderModeInspectionHandlers() {
      if (!renderModeInspectionHandlers) {
        renderModeInspectionHandlers = factories.createRenderModeInspectionHandlers();
      }
      return renderModeInspectionHandlers;
    },
    getInspectionStatusResolver() {
      if (!inspectionStatusResolver) {
        inspectionStatusResolver = factories.createInspectionStatusResolver();
      }
      return inspectionStatusResolver;
    },
    getPageDraftRevertHandler() {
      if (!pageDraftRevertHandler) {
        pageDraftRevertHandler = factories.createPageDraftRevertHandler();
      }
      return pageDraftRevertHandler;
    },
    getPageDraftSaveHandler() {
      if (!pageDraftSaveHandler) {
        pageDraftSaveHandler = factories.createPageDraftSaveHandler();
      }
      return pageDraftSaveHandler;
    },
    getExplicitMarkingHandler() {
      if (!explicitMarkingHandler) {
        explicitMarkingHandler = factories.createExplicitMarkingHandler();
      }
      return explicitMarkingHandler;
    },
    getPageDraftStatusHandler() {
      if (!pageDraftStatusHandler) {
        pageDraftStatusHandler = factories.createPageDraftStatusHandler();
      }
      return pageDraftStatusHandler;
    },
    getAiPreviewStateResponseBuilder() {
      if (!aiPreviewStateResponseBuilder) {
        aiPreviewStateResponseBuilder = factories.createAiPreviewStateResponseBuilder();
      }
      return aiPreviewStateResponseBuilder;
    },
    getAiPreviewCloseHandler() {
      if (!aiPreviewCloseHandler) {
        aiPreviewCloseHandler = factories.createAiPreviewCloseHandler();
      }
      return aiPreviewCloseHandler;
    },
    getAiPreviewComputeLockHandler() {
      if (!aiPreviewComputeLockHandler) {
        aiPreviewComputeLockHandler = factories.createAiPreviewComputeLockHandler();
      }
      return aiPreviewComputeLockHandler;
    },
    getAiPreviewExpandedModeHandler() {
      if (!aiPreviewExpandedModeHandler) {
        aiPreviewExpandedModeHandler = factories.createAiPreviewExpandedModeHandler();
      }
      return aiPreviewExpandedModeHandler;
    },
    getAiPreviewGetStateHandler() {
      if (!aiPreviewGetStateHandler) {
        aiPreviewGetStateHandler = factories.createAiPreviewGetStateHandler();
      }
      return aiPreviewGetStateHandler;
    },
    getAiPreviewShowHandler() {
      if (!aiPreviewShowHandler) {
        aiPreviewShowHandler = factories.createAiPreviewShowHandler();
      }
      return aiPreviewShowHandler;
    },
    getAiSubmissionXpathsHandler() {
      if (!aiSubmissionXpathsHandler) {
        aiSubmissionXpathsHandler = factories.createAiSubmissionXpathsHandler();
      }
      return aiSubmissionXpathsHandler;
    },
    getCapturePageSnapshotHandler() {
      if (!capturePageSnapshotHandler) {
        capturePageSnapshotHandler = factories.createCapturePageSnapshotHandler();
      }
      return capturePageSnapshotHandler;
    },
    getConfigUpdatedHandler() {
      if (!configUpdatedHandler) {
        configUpdatedHandler = factories.createConfigUpdatedHandler();
      }
      return configUpdatedHandler;
    },
    getCollectPageDataHandler() {
      if (!collectPageDataHandler) {
        collectPageDataHandler = factories.createCollectPageDataHandler();
      }
      return collectPageDataHandler;
    },
    getDefaultExclusionsHandler() {
      if (!defaultExclusionsHandler) {
        defaultExclusionsHandler = factories.createDefaultExclusionsHandler();
      }
      return defaultExclusionsHandler;
    },
    getDescribeXpathsHandler() {
      if (!describeXpathsHandler) {
        describeXpathsHandler = factories.createDescribeXpathsHandler();
      }
      return describeXpathsHandler;
    },
    getFocusHandler() {
      if (!focusHandler) {
        focusHandler = factories.createFocusHandler();
      }
      return focusHandler;
    },
    getForceRefreshHandler() {
      if (!forceRefreshHandler) {
        forceRefreshHandler = factories.createForceRefreshHandler();
      }
      return forceRefreshHandler;
    },
    getInvisibleXpathsHandler() {
      if (!invisibleXpathsHandler) {
        invisibleXpathsHandler = factories.createInvisibleXpathsHandler();
      }
      return invisibleXpathsHandler;
    },
    getVisibleXpathsHandler() {
      if (!visibleXpathsHandler) {
        visibleXpathsHandler = factories.createVisibleXpathsHandler();
      }
      return visibleXpathsHandler;
    },
    getPropertyLockPortClient() {
      if (!propertyLockPortClient) {
        propertyLockPortClient = factories.createPropertyLockPortClient();
      }
      return propertyLockPortClient;
    },
    getPropertyLockStateMachine() {
      if (!propertyLockStateMachine) {
        propertyLockStateMachine = factories.createPropertyLockStateMachine();
      }
      return propertyLockStateMachine;
    }
  };
}
