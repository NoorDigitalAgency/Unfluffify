import type { RuntimeMessage } from "../types/messaging.ts";
interface AsyncMessageHandler {
  handleMessage(message?: RuntimeMessage): Promise<unknown>;
}

interface SyncMessageHandler {
  handleMessage(message?: RuntimeMessage): unknown;
}

interface ExplicitMarkingResult {
  ok?: boolean;
  [key: string]: unknown;
}

interface RuntimeMessageHandlerDeps {
  state: { baseUrl: string; config: unknown };
  locationHref(): string;
  matchesActiveBaseUrl(baseUrl: unknown): boolean;
  checkPropertyLockBlocksMarking(): boolean;
  isPageSaveReconciliationPending(pageUrl: unknown): boolean;
  sendPropertyLockActivity(): void;
  handleSetEnabledCommand(message: RuntimeMessage): Promise<unknown>;
  handleGetInspectionStatusCommand(): unknown;
  handleSetPopupBusyOnPageCommand(message: RuntimeMessage): unknown;
  handleRenderModeInspectionBeginCommand(message: RuntimeMessage): unknown;
  handleRunRenderModeRevealOnceCommand(message: RuntimeMessage): Promise<unknown>;
  handleCaptureRenderModeInspectionHtmlCommand(message: RuntimeMessage): Promise<unknown>;
  handleRenderModeInspectionEndCommand(message: RuntimeMessage): unknown;
  handleHideConsentForInspectionCommand(): unknown;
  getAiPreviewGetStateHandler(): SyncMessageHandler;
  getAiPreviewExpandedModeHandler(): SyncMessageHandler;
  getAiPreviewComputeLockHandler(): AsyncMessageHandler;
  getAiPreviewCloseHandler(): AsyncMessageHandler;
  getConfigUpdatedHandler(): SyncMessageHandler;
  getForceRefreshHandler(): AsyncMessageHandler;
  getDefaultExclusionsHandler(): SyncMessageHandler;
  getCollectPageDataHandler(): AsyncMessageHandler;
  getVisibleXpathsHandler(): SyncMessageHandler;
  getAiSubmissionXpathsHandler(): SyncMessageHandler;
  getInvisibleXpathsHandler(): SyncMessageHandler;
  getDescribeXpathsHandler(): SyncMessageHandler;
  getFocusHandler(): {
    handleFocusMessage(message: RuntimeMessage): unknown;
    handleClearFocusMessage(): unknown;
  };
  getCapturePageSnapshotHandler(): {
    capture(options: {
      targetBaseUrl: unknown;
      shouldPersist: boolean;
      pageType: string;
    }): Promise<unknown>;
  };
  getPageDraftStatusHandler(): {
    getStatus(options: { targetBaseUrl: unknown }): Promise<unknown>;
  };
  getPageSaveReconciliationPendingHandler(): {
    setPending(options: {
      targetBaseUrl: unknown;
      pageUrl: string;
      reason: unknown;
    }): Promise<unknown>;
  };
  getPageSaveReconciliationClearHandler(): {
    clear(options: { targetBaseUrl: unknown; pageUrl: string }): Promise<unknown>;
  };
  getExplicitMarkingHandler(): {
    setExplicitExclude(options: {
      targetBaseUrl: unknown;
      xpath: unknown;
      excluded: boolean;
    }): ExplicitMarkingResult | null;
    setExplicitInclude(options: {
      targetBaseUrl: unknown;
      xpath: unknown;
      included: boolean;
    }): ExplicitMarkingResult | null;
  };
  getPageDraftSaveHandler(): {
    saveCurrentPageDraft(options: { baseUrl: unknown; pageType: string }): Promise<unknown>;
  };
  getPageDraftRevertHandler(): {
    revert(options: { targetBaseUrl: unknown }): Promise<unknown>;
  };
  getAiPreviewShowHandler(): AsyncMessageHandler;
}

export function handleRuntimeMessage(message: RuntimeMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void, deps: RuntimeMessageHandlerDeps) {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "setEnabled") {
    deps.handleSetEnabledCommand(message)
      .then((response: unknown) => {
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
      .then((response: unknown) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "captureRenderModeInspectionHtml") {
    deps.handleCaptureRenderModeInspectionHtmlCommand(message)
      .then((response: unknown) => {
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
      .then((response: unknown) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "closeAiPreview") {
    deps.getAiPreviewCloseHandler().handleMessage()
      .then((response: unknown) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "configUpdated") {
    const response: unknown = deps.getConfigUpdatedHandler().handleMessage(message);
    if (response && typeof (response as { then?: unknown }).then === "function") {
      (response as Promise<unknown>).then((result: unknown) => {
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
    deps.getForceRefreshHandler().handleMessage().then((response: unknown) => {
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
    deps.getCollectPageDataHandler().handleMessage(message).then((response: unknown) => {
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
    if (!targetBaseUrl) {
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
    }).then((response: unknown) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "getPageDraftStatus") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
      sendResponse({ ok: false });
      return;
    }
    deps.getPageDraftStatusHandler().getStatus({ targetBaseUrl }).then((response: unknown) => {
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
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || pageUrl !== deps.locationHref()) {
      sendResponse({ ok: false });
      return;
    }
    deps.getPageSaveReconciliationPendingHandler().setPending({
      targetBaseUrl,
      pageUrl,
      reason: message.reason
    }).then((response: unknown) => {
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
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || pageUrl !== deps.locationHref()) {
      sendResponse({ ok: false });
      return;
    }
    deps.getPageSaveReconciliationClearHandler().clear({ targetBaseUrl, pageUrl })
      .then((response: unknown) => {
        sendResponse(response && typeof response === "object" ? response : { ok: false });
      })
      .catch(() => {
        sendResponse({ ok: false });
      });
    return true;
  }

  if (message.type === "setExplicitExclude") {
    const targetBaseUrl = message.baseUrl || deps.state.baseUrl;
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
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
    const xpath = message.xpath || "";
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
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
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
    const xpath = message.xpath || "";
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
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
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
    }).then((result: unknown) => {
      if (result && (result as { ok?: unknown }).ok) {
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
    if (!targetBaseUrl || !deps.matchesActiveBaseUrl(targetBaseUrl) || !deps.state.config) {
      sendResponse({ ok: false });
      return;
    }
    if (!deps.checkPropertyLockBlocksMarking()) {
      sendResponse({ ok: false, locked: true });
      return;
    }
    deps.getPageDraftRevertHandler().revert({ targetBaseUrl }).then((response: unknown) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "showAiPreview") {
    deps.getAiPreviewShowHandler().handleMessage(message).then((response: unknown) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }
}
