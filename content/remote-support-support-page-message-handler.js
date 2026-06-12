const SUPPORT_PAGE_MESSAGE_TYPES = new Set([
  "remoteSupportViewerTransportStart",
  "remoteSupportViewerTransportStop",
  "remoteSupportViewerTransportSendData",
  "remoteSupportStateChanged",
  "remoteSupportFrame"
]);

export function handleRemoteSupportSupportPageMessage(message, sendResponse, deps) {
  if (!message || !SUPPORT_PAGE_MESSAGE_TYPES.has(message.type)) {
    return null;
  }

  const supportPage = deps.getRemoteSupportSupportPage();
  if (!supportPage.isSupportPage()) {
    return null;
  }

  if (message.type === "remoteSupportViewerTransportStart") {
    supportPage.sendViewerRequest("remoteSupportTransportStart", {
      session: message.session && typeof message.session === "object" ? message.session : null
    }).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    });
    return true;
  }

  if (message.type === "remoteSupportViewerTransportStop") {
    supportPage.sendViewerRequest("remoteSupportTransportStop", {
      sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
      reason: typeof message.reason === "string" ? message.reason : "Session ended",
      notifyPeer: Boolean(message.notifyPeer)
    }).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    });
    return true;
  }

  if (message.type === "remoteSupportViewerTransportSendData") {
    supportPage.sendViewerRequest("remoteSupportTransportSendData", {
      sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
      messageType: typeof message.messageType === "string" ? message.messageType : "",
      payload: message.payload,
      channelKey: typeof message.channelKey === "string" ? message.channelKey : ""
    }).then((response) => {
      sendResponse(response && typeof response === "object" ? response : { ok: false });
    });
    return true;
  }

  if (message.type === "remoteSupportStateChanged") {
    if (
      Number.isFinite(supportPage.getTabId()) &&
      Number.isFinite(message.tabId) &&
      Math.trunc(message.tabId) !== supportPage.getTabId()
    ) {
      return;
    }

    supportPage.applyState(message.state || null);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "remoteSupportFrame") {
    if (!supportPage.handleFrameMessage(message)) {
      return;
    }
    sendResponse({ ok: true });
  }
}
