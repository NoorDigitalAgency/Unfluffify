import type { RuntimeMessage, RuntimeMessageReply } from "../types/messaging.ts";

type RuntimeResponse = RuntimeMessageReply | Record<string, unknown>;
type RuntimePromiseResponse = Promise<RuntimeResponse>;

interface AsyncMessageHandler {
  handleMessage(message?: RuntimeMessage): RuntimePromiseResponse;
}

interface SyncMessageHandler {
  handleMessage(message?: RuntimeMessage): RuntimeResponse;
}

interface ExplicitMarkingResult {
  ok?: boolean;
  [key: string]: unknown;
}

interface RuntimeMessageHandlerDeps {
  state: { baseUrl: string; config: Record<string, unknown> | null };
  locationHref(): string;
  matchesActiveBaseUrl(baseUrl: string): boolean;
  checkPropertyLockBlocksMarking(): boolean;
  isPageSaveReconciliationPending(pageUrl: string): boolean;
  sendPropertyLockActivity(): void;
  handleSetEnabledCommand(message: RuntimeMessage): RuntimePromiseResponse;
  handleGetInspectionStatusCommand(): RuntimeResponse;
  handleSetPopupBusyOnPageCommand(message: RuntimeMessage): RuntimeResponse;
  handleRenderModeInspectionBeginCommand(message: RuntimeMessage): RuntimeResponse;
  handleRunRenderModeRevealOnceCommand(message: RuntimeMessage): RuntimePromiseResponse;
  handleCaptureRenderModeInspectionHtmlCommand(message: RuntimeMessage): RuntimePromiseResponse;
  handleRenderModeInspectionEndCommand(message: RuntimeMessage): RuntimeResponse;
  handleHideConsentForInspectionCommand(): RuntimeResponse;
  getAiPreviewGetStateHandler(): SyncMessageHandler;
  getAiPreviewExpandedModeHandler(): SyncMessageHandler;
  getAiPreviewComputeLockHandler(): AsyncMessageHandler;
  getAiPreviewCloseHandler(): AsyncMessageHandler;
  getConfigUpdatedHandler(): {
    handleMessage(message?: RuntimeMessage): RuntimeResponse | Promise<RuntimeResponse>;
  };
  getForceRefreshHandler(): AsyncMessageHandler;
  getDefaultExclusionsHandler(): SyncMessageHandler;
  getCollectPageDataHandler(): AsyncMessageHandler;
  getVisibleXpathsHandler(): SyncMessageHandler;
  getAiSubmissionXpathsHandler(): SyncMessageHandler;
  getInvisibleXpathsHandler(): SyncMessageHandler;
  getDescribeXpathsHandler(): SyncMessageHandler;
  getFocusHandler(): {
    handleFocusMessage(message: RuntimeMessage): RuntimeResponse;
    handleClearFocusMessage(): RuntimeResponse;
  };
  getCapturePageSnapshotHandler(): {
    capture(options: {
      targetBaseUrl: string;
      shouldPersist: boolean;
      pageType: string;
    }): RuntimePromiseResponse;
  };
  getPageDraftStatusHandler(): {
    getStatus(options: { targetBaseUrl: string }): RuntimePromiseResponse;
  };
  getPageSaveReconciliationPendingHandler(): {
    setPending(options: {
      targetBaseUrl: string;
      pageUrl: string;
      reason: string;
    }): RuntimePromiseResponse;
  };
  getPageSaveReconciliationClearHandler(): {
    clear(options: { targetBaseUrl: string; pageUrl: string }): RuntimePromiseResponse;
  };
  getExplicitMarkingHandler(): {
    setExplicitExclude(options: {
      targetBaseUrl: string;
      xpath: string;
      excluded: boolean;
    }): ExplicitMarkingResult | null;
    setExplicitInclude(options: {
      targetBaseUrl: string;
      xpath: string;
      included: boolean;
    }): ExplicitMarkingResult | null;
  };
  getPageDraftSaveHandler(): {
    saveCurrentPageDraft(options: { baseUrl: string; pageType: string }): RuntimePromiseResponse;
  };
  getPageDraftRevertHandler(): {
    revert(options: { targetBaseUrl: string }): RuntimePromiseResponse;
  };
  getAiPreviewShowHandler(): AsyncMessageHandler;
}

export function handleRuntimeMessage(
  message: RuntimeMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: RuntimeResponse | null) => void,
  deps: RuntimeMessageHandlerDeps
) {
  const isPromiseResponse = (
    value: RuntimeResponse | Promise<RuntimeResponse>
  ): value is Promise<RuntimeResponse> =>
    Boolean(value) && typeof (value as { then?: unknown }).then === "function";

  if (!message || !message.type) {
    return;
  }

  if (message.type === "setEnabled") {
    deps.handleSetEnabledCommand(message)
      .then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "getInspectionStatus") {
    sendResponse(deps.handleGetInspectionStatusCommand());
    return;
  }

  if (message.type === "setPopupBusyOnPage") {
    sendResponse(deps.handleSetPopupBusyOnPageCommand(message));
    return;
  }

  if (message.type === "renderModeInspectionBegin") {
    sendResponse(deps.handleRenderModeInspectionBeginCommand(message));
    return;
  }

  if (message.type === "runRenderModeRevealOnce") {
    deps.handleRunRenderModeRevealOnceCommand(message)
      .then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "captureRenderModeInspectionHtml") {
    deps.handleCaptureRenderModeInspectionHtmlCommand(message)
      .then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "renderModeInspectionEnd") {
    sendResponse(deps.handleRenderModeInspectionEndCommand(message));
    return;
  }

  if (message.type === "hideConsentForInspection") {
    sendResponse(deps.handleHideConsentForInspectionCommand());
    return;
  }

  if (message.type === "getAiPreviewState") {
    const response = deps.getAiPreviewGetStateHandler().handleMessage();
    sendResponse(response && typeof response === "object" ? response : { ok: false });
    return;
  }

  if (message.type === "setAiPreviewExpandedMode") {
    try {
      const response = deps.getAiPreviewExpandedModeHandler().handleMessage(message);
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    } catch {
      sendResponse({ ok: false });
    }
    return;
  }

  if (message.type === "setAiComputeLock") {
    deps.getAiPreviewComputeLockHandler().handleMessage(message)
      .then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "closeAiPreview") {
    deps.getAiPreviewCloseHandler().handleMessage()
      .then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "configUpdated") {
    const response = deps.getConfigUpdatedHandler().handleMessage(message);
    if (isPromiseResponse(response)) {
      response.then((result) => {
        sendResponse(result && typeof result === "object" ? result : { ok: false });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }
    sendResponse(response && typeof response === "object" ? response : { ok: false });
    return;
  }

  if (message.type === "forceRefresh") {
    deps.getForceRefreshHandler().handleMessage().then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "getDefaultExclusions") {
    sendResponse(deps.getDefaultExclusionsHandler().handleMessage());
    return;
  }

  if (message.type === "collectPageData") {
    deps.getCollectPageDataHandler().handleMessage(message).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "filterXPathsOnPage") {
    sendResponse(deps.getVisibleXpathsHandler().handleMessage(message));
    return;
  }

  if (message.type === "collectAiSubmissionXpaths") {
    sendResponse(deps.getAiSubmissionXpathsHandler().handleMessage());
    return;
  }

  if (message.type === "filterInvisibleXpathsOnPage") {
    sendResponse(deps.getInvisibleXpathsHandler().handleMessage(message));
    return;
  }

  if (message.type === "describeXPathsOnPage") {
    sendResponse(deps.getDescribeXpathsHandler().handleMessage(message));
    return;
  }

  if (message.type === "focusElement") {
    sendResponse(deps.getFocusHandler().handleFocusMessage(message));
    return;
  }

  if (message.type === "clearFocus") {
    sendResponse(deps.getFocusHandler().handleClearFocusMessage());
    return;
  }

  if (message.type === "capturePageSnapshot") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl) {
      sendResponse({ ok: false });
      return;
    }
    const shouldPersist = Boolean(message.persist);
    if (shouldPersist && !deps.checkPropertyLockBlocksMarking()) {
      sendResponse({ ok: false, locked: true });
      return;
    }
    if (shouldPersist && deps.isPageSaveReconciliationPending(deps.locationHref())) {
      sendResponse({ ok: false, reconciliationPending: true });
      return;
    }

    deps.getCapturePageSnapshotHandler().capture({
      targetBaseUrl,
      shouldPersist,
      pageType: typeof message.pageType === "string" ? message.pageType : ""
    }).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "getPageDraftStatus") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
      sendResponse({ ok: false });
      return;
    }
    deps.getPageDraftStatusHandler().getStatus({ targetBaseUrl }).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "setPageSaveReconciliationPending") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    const pageUrl = typeof message.pageUrl === "string" && message.pageUrl
      ? message.pageUrl
      : deps.locationHref();
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || pageUrl !== deps.locationHref()) {
      sendResponse({ ok: false });
      return;
    }
    deps.getPageSaveReconciliationPendingHandler().setPending({
      targetBaseUrl,
      pageUrl,
      reason: typeof message.reason === "string" ? message.reason : ""
    }).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "clearPageSaveReconciliation") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    const pageUrl = typeof message.pageUrl === "string" && message.pageUrl
      ? message.pageUrl
      : deps.locationHref();
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || pageUrl !== deps.locationHref()) {
      sendResponse({ ok: false });
      return;
    }
    deps.getPageSaveReconciliationClearHandler().clear({ targetBaseUrl, pageUrl })
      .then((response) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "setExplicitExclude") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
      sendResponse({ ok: false });
      return;
    }
    if (!deps.checkPropertyLockBlocksMarking()) {
      sendResponse({ ok: false, locked: true });
      return;
    }
    if (deps.isPageSaveReconciliationPending(deps.locationHref())) {
      sendResponse({ ok: false, reconciliationPending: true });
      return;
    }
    const xpath = typeof message.xpath === "string" ? message.xpath : "";
    if (!xpath) {
      sendResponse({ ok: false });
      return;
    }
    const response = deps.getExplicitMarkingHandler().setExplicitExclude({
      targetBaseUrl,
      xpath,
      excluded: Boolean(message.excluded)
    });
    if (response && response.ok) {
      deps.sendPropertyLockActivity();
    }
    sendResponse(response);
    return;
  }

  if (message.type === "setExplicitInclude") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
      sendResponse({ ok: false });
      return;
    }
    if (!deps.checkPropertyLockBlocksMarking()) {
      sendResponse({ ok: false, locked: true });
      return;
    }
    if (deps.isPageSaveReconciliationPending(deps.locationHref())) {
      sendResponse({ ok: false, reconciliationPending: true });
      return;
    }
    const xpath = typeof message.xpath === "string" ? message.xpath : "";
    if (!xpath) {
      sendResponse({ ok: false });
      return;
    }
    const response = deps.getExplicitMarkingHandler().setExplicitInclude({
      targetBaseUrl,
      xpath,
      included: Boolean(message.included)
    });
    if (response && response.ok) {
      deps.sendPropertyLockActivity();
    }
    sendResponse(response);
    return;
  }

  if (message.type === "savePageDraft") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
      sendResponse({ ok: false });
      return;
    }
    if (!deps.checkPropertyLockBlocksMarking()) {
      sendResponse({ ok: false, locked: true });
      return;
    }
    deps.getPageDraftSaveHandler().saveCurrentPageDraft({
      baseUrl: targetBaseUrl,
      pageType: typeof message.pageType === "string" ? message.pageType : ""
    }).then((result) => {
      if (result && result.ok) {
        deps.sendPropertyLockActivity();
      }
      sendResponse(result && typeof result === "object" ? result : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "revertPageDraft") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (typeof targetBaseUrl !== "string" || !targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
      sendResponse({ ok: false });
      return;
    }
    if (!deps.checkPropertyLockBlocksMarking()) {
      sendResponse({ ok: false, locked: true });
      return;
    }
    deps.getPageDraftRevertHandler().revert({ targetBaseUrl }).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "showAiPreview") {
    deps.getAiPreviewShowHandler().handleMessage(message).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }
}
