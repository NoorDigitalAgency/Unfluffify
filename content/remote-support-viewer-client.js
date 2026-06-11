export function createRemoteSupportViewerClient(deps) {
  let viewerPort = null;
  let viewerReady = false;
  let viewerReadyWaiters = [];
  let viewerRequestId = 0;
  const viewerPendingRequests = new Map();
  let viewerIntrinsicWidth = 0;
  let viewerIntrinsicHeight = 0;
  let viewerVideoActive = false;

  const getTimerHost = () => globalThis.window || globalThis;

  const getViewerUrl = () => {
    try {
      const origin = deps.getViewerOrigin();
      if (origin && origin !== "*") {
        return new URL(deps.REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH, `${origin}/`).href;
      }
    } catch (error) {
      // Fall through to the extension runtime fallback.
    }

    try {
      return chrome.runtime.getURL(deps.REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH);
    } catch (error) {
      return deps.REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_PATH;
    }
  };

  const resolveWaiters = (result) => {
    if (!viewerReadyWaiters.length) {
      return;
    }

    const waiters = viewerReadyWaiters.slice();
    viewerReadyWaiters = [];
    waiters.forEach((waiter) => {
      try {
        waiter(Boolean(result));
      } catch (error) {
        // Ignore waiter resolution failures.
      }
    });
  };

  const clearPendingRequests = (errorMessage = "Remote support viewer unavailable") => {
    if (!viewerPendingRequests.size) {
      return;
    }

    const timerHost = getTimerHost();
    for (const pendingRequest of viewerPendingRequests.values()) {
      timerHost.clearTimeout(pendingRequest.timeoutId);
      pendingRequest.resolve({ ok: false, error: errorMessage });
    }
    viewerPendingRequests.clear();
  };

  const syncVisibility = () => {
    const viewerElement = deps.getViewerElement() || deps.getViewerFrame();
    if (!viewerElement) {
      return;
    }

    viewerElement.hidden = !(deps.isSupportPageActive() && viewerVideoActive);
  };

  const updateVideoState = ({ active = false, width = 0, height = 0 } = {}) => {
    viewerVideoActive = Boolean(active);
    viewerIntrinsicWidth = Number.isFinite(Number(width)) ? Math.max(0, Math.trunc(Number(width))) : 0;
    viewerIntrinsicHeight = Number.isFinite(Number(height)) ? Math.max(0, Math.trunc(Number(height))) : 0;
    syncVisibility();
    deps.renderFrame();
  };

  const isFrameBitmap = (value) => Boolean(
    value &&
    typeof value === "object" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.close === "function"
  );

  const closeFrameBitmap = (bitmap) => {
    if (!bitmap || typeof bitmap.close !== "function") {
      return;
    }

    try {
      bitmap.close();
    } catch (error) {
      // Ignore decoded frame cleanup mismatches.
    }
  };

  const resetConnection = (
    errorMessage = "Remote support viewer unavailable",
    { resolveReadyWaiters = true } = {}
  ) => {
    if (viewerPort) {
      try {
        viewerPort.onmessage = null;
        viewerPort.close();
      } catch (error) {
        // Ignore viewer port shutdown races.
      }
    }

    viewerPort = null;
    viewerReady = false;
    if (resolveReadyWaiters) {
      resolveWaiters(false);
    }
    clearPendingRequests(errorMessage);
    updateVideoState({ active: false, width: 0, height: 0 });
  };

  const handlePortMessage = (event) => {
    const message = event && event.data && typeof event.data === "object"
      ? event.data
      : null;
    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "ready") {
      viewerReady = true;
      resolveWaiters(true);
      return;
    }

    if (message.type === "response") {
      const requestId = typeof message.requestId === "string" ? message.requestId : "";
      const pendingRequest = requestId ? viewerPendingRequests.get(requestId) : null;
      if (!pendingRequest) {
        return;
      }

      viewerPendingRequests.delete(requestId);
      getTimerHost().clearTimeout(pendingRequest.timeoutId);
      pendingRequest.resolve(message.response && typeof message.response === "object" ? message.response : { ok: false });
      return;
    }

    if (message.type === "transport-event") {
      deps.sendRuntimeMessageSafely({
        type: "remoteSupportTransportEvent",
        source: "remoteSupportViewer",
        event: message.event && typeof message.event === "object" ? message.event : {}
      });
      return;
    }

    if (message.type === "video-state") {
      updateVideoState({
        active: Boolean(message.active),
        width: message.width,
        height: message.height
      });
      deps.sendRuntimeMessageSafely({
        type: "remoteSupportTransportEvent",
        source: "remoteSupportViewer",
        event: {
          type: "video-state",
          sessionId: typeof message.sessionId === "string" ? message.sessionId : "",
          active: Boolean(message.active)
        }
      });
      return;
    }

    if (message.type === "frame") {
      deps.onFrameMessage(message.frame);
    }
  };

  const initializeViewer = (viewerFrame = deps.getViewerFrame()) => {
    if (!viewerFrame || viewerFrame.dataset.ufRemoteSupportViewerInitialized === "true") {
      return;
    }

    viewerFrame.dataset.ufRemoteSupportViewerInitialized = "true";
    viewerFrame.src = getViewerUrl();
    viewerFrame.addEventListener("load", () => {
      resetConnection("Remote support viewer unavailable", { resolveReadyWaiters: false });

      if (!viewerFrame.contentWindow || typeof MessageChannel !== "function") {
        return;
      }

      const channel = new MessageChannel();
      viewerPort = channel.port1;
      viewerPort.onmessage = handlePortMessage;
      if (typeof viewerPort.start === "function") {
        viewerPort.start();
      }

      try {
        viewerFrame.contentWindow.postMessage(
          { type: "unfluffify:remote-support-viewer-init" },
          deps.getViewerOrigin(),
          [channel.port2]
        );
      } catch (error) {
        resetConnection();
      }
    });
  };

  const waitUntilReady = async (timeoutMs = 4000) => {
    if (viewerReady && viewerPort) {
      return true;
    }

    const viewerFrame = deps.getViewerFrame();
    if (!viewerFrame) {
      return false;
    }
    initializeViewer(viewerFrame);

    return new Promise((resolve) => {
      const timerHost = getTimerHost();
      const timeoutId = timerHost.setTimeout(() => {
        viewerReadyWaiters = viewerReadyWaiters.filter(
          (waiter) => waiter !== handleReady
        );
        resolve(false);
      }, timeoutMs);

      const handleReady = (ready) => {
        timerHost.clearTimeout(timeoutId);
        resolve(Boolean(ready));
      };

      viewerReadyWaiters.push(handleReady);
      if (viewerReady && viewerPort) {
        resolveWaiters(true);
      }
    });
  };

  const sendRequest = async (requestType, payload = {}) => {
    const ready = await waitUntilReady();
    if (!ready || !viewerPort) {
      return {
        ok: false,
        error: "Remote support viewer unavailable"
      };
    }

    const requestId = `viewer-${Date.now()}-${(viewerRequestId += 1)}`;
    return new Promise((resolve) => {
      const timerHost = getTimerHost();
      const timeoutId = timerHost.setTimeout(() => {
        viewerPendingRequests.delete(requestId);
        resolve({ ok: false, error: "Remote support viewer timed out" });
      }, deps.REMOTE_SUPPORT_SUPPORT_PAGE_VIEWER_REQUEST_TIMEOUT_MS);

      viewerPendingRequests.set(requestId, {
        resolve,
        timeoutId
      });

      try {
        viewerPort.postMessage({
          type: "request",
          requestId,
          requestType,
          ...payload
        });
      } catch (error) {
        viewerPendingRequests.delete(requestId);
        timerHost.clearTimeout(timeoutId);
        resolve({ ok: false, error: "Remote support viewer unavailable" });
      }
    });
  };

  return {
    closeFrameBitmap,
    getIntrinsicHeight: () => viewerIntrinsicHeight,
    getIntrinsicWidth: () => viewerIntrinsicWidth,
    initializeViewer,
    isFrameBitmap,
    isVideoActive: () => viewerVideoActive,
    resetConnection,
    sendRequest,
    syncVisibility,
    updateVideoState,
    waitUntilReady
  };
}
