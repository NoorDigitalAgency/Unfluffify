type ContentMainServiceFactory = () => object;

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
  let pageToastClient: object | null = null;
  let pageSaveReconciliationClearHandler: object | null = null;
  let pageSaveReconciliationPendingHandler: object | null = null;
  let renderModeInspectionClient: object | null = null;
  let renderModeInspectionHandlers: object | null = null;
  let inspectionStatusResolver: object | null = null;
  let pageDraftStatusHandler: object | null = null;
  let pageDraftRevertHandler: object | null = null;
  let pageDraftSaveHandler: object | null = null;
  let aiPreviewCloseHandler: object | null = null;
  let aiPreviewComputeLockHandler: object | null = null;
  let aiPreviewExpandedModeHandler: object | null = null;
  let aiPreviewGetStateHandler: object | null = null;
  let aiPreviewShowHandler: object | null = null;
  let aiPreviewStateResponseBuilder: object | null = null;
  let aiSubmissionXpathsHandler: object | null = null;
  let capturePageSnapshotHandler: object | null = null;
  let collectPageDataHandler: object | null = null;
  let configUpdatedHandler: object | null = null;
  let defaultExclusionsHandler: object | null = null;
  let describeXpathsHandler: object | null = null;
  let explicitMarkingHandler: object | null = null;
  let focusHandler: object | null = null;
  let forceRefreshHandler: object | null = null;
  let invisibleXpathsHandler: object | null = null;
  let propertyLockPortClient: object | null = null;
  let propertyLockStateMachine: object | null = null;
  let visibleXpathsHandler: object | null = null;

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
