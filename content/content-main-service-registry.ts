type ContentMainServiceFactory = () => unknown;

type ContentMainServiceFactories = {
  createPageToastClient: ContentMainServiceFactory;
  createPageSaveReconciliationClearHandler: ContentMainServiceFactory;
  createPageSaveReconciliationPendingHandler: ContentMainServiceFactory;
  createRenderModeInspectionClient: ContentMainServiceFactory;
  createRenderModeInspectionHandlers: ContentMainServiceFactory;
  createInspectionStatusResolver: ContentMainServiceFactory;
  createPageDraftStatusHandler: ContentMainServiceFactory;
  createPageDraftRevertHandler: ContentMainServiceFactory;
  createPageDraftSaveHandler: ContentMainServiceFactory;
  createAiPreviewCloseHandler: ContentMainServiceFactory;
  createAiPreviewComputeLockHandler: ContentMainServiceFactory;
  createAiPreviewExpandedModeHandler: ContentMainServiceFactory;
  createAiPreviewGetStateHandler: ContentMainServiceFactory;
  createAiPreviewShowHandler: ContentMainServiceFactory;
  createAiPreviewStateResponseBuilder: ContentMainServiceFactory;
  createAiSubmissionXpathsHandler: ContentMainServiceFactory;
  createCapturePageSnapshotHandler: ContentMainServiceFactory;
  createCollectPageDataHandler: ContentMainServiceFactory;
  createConfigUpdatedHandler: ContentMainServiceFactory;
  createDefaultExclusionsHandler: ContentMainServiceFactory;
  createDescribeXpathsHandler: ContentMainServiceFactory;
  createExplicitMarkingHandler: ContentMainServiceFactory;
  createFocusHandler: ContentMainServiceFactory;
  createForceRefreshHandler: ContentMainServiceFactory;
  createInvisibleXpathsHandler: ContentMainServiceFactory;
  createPropertyLockPortClient: ContentMainServiceFactory;
  createPropertyLockStateMachine: ContentMainServiceFactory;
  createVisibleXpathsHandler: ContentMainServiceFactory;
};

export function createContentMainServiceRegistry(factories: ContentMainServiceFactories) {
  let pageToastClient: unknown = null;
  let pageSaveReconciliationClearHandler: unknown = null;
  let pageSaveReconciliationPendingHandler: unknown = null;
  let renderModeInspectionClient: unknown = null;
  let renderModeInspectionHandlers: unknown = null;
  let inspectionStatusResolver: unknown = null;
  let pageDraftStatusHandler: unknown = null;
  let pageDraftRevertHandler: unknown = null;
  let pageDraftSaveHandler: unknown = null;
  let aiPreviewCloseHandler: unknown = null;
  let aiPreviewComputeLockHandler: unknown = null;
  let aiPreviewExpandedModeHandler: unknown = null;
  let aiPreviewGetStateHandler: unknown = null;
  let aiPreviewShowHandler: unknown = null;
  let aiPreviewStateResponseBuilder: unknown = null;
  let aiSubmissionXpathsHandler: unknown = null;
  let capturePageSnapshotHandler: unknown = null;
  let collectPageDataHandler: unknown = null;
  let configUpdatedHandler: unknown = null;
  let defaultExclusionsHandler: unknown = null;
  let describeXpathsHandler: unknown = null;
  let explicitMarkingHandler: unknown = null;
  let focusHandler: unknown = null;
  let forceRefreshHandler: unknown = null;
  let invisibleXpathsHandler: unknown = null;
  let propertyLockPortClient: unknown = null;
  let propertyLockStateMachine: unknown = null;
  let visibleXpathsHandler: unknown = null;

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
