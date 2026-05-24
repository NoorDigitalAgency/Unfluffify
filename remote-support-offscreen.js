import { REMOTE_SUPPORT_PORT_TRANSPORT } from "./common/remote-support.js";

const REMOTE_SUPPORT_TRANSPORT_TARGET = "remoteSupportOffscreen";

const transportSessions = new Map();

let keepAlivePort = null;
let keepAliveReconnectTimer = 0;

function normalizeErrorMessage(error, fallback) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasActiveSessions() {
  return transportSessions.size > 0;
}

function getTransportRuntime(sessionId) {
  if (!isNonEmptyString(sessionId)) {
    return null;
  }

  return transportSessions.get(sessionId.trim()) || null;
}

function createTransportRuntime(session) {
  return {
    sessionId: session.sessionId.trim(),
    supportCode: session.supportCode.trim(),
    role: session.role,
    wsUrl: session.wsUrl.trim(),
    signalingSocket: null,
    peerConnection: null,
    dataChannel: null,
    shuttingDown: false
  };
}

function postTransportEvent(event) {
  chrome.runtime.sendMessage({
    type: "remoteSupportTransportEvent",
    source: "remoteSupportOffscreen",
    event
  }).catch(() => {});
}

function scheduleKeepAliveReconnect() {
  if (keepAliveReconnectTimer || !hasActiveSessions()) {
    return;
  }

  keepAliveReconnectTimer = setTimeout(() => {
    keepAliveReconnectTimer = 0;
    if (!hasActiveSessions()) {
      return;
    }

    try {
      connectKeepAlivePort();
    } catch (error) {
      scheduleKeepAliveReconnect();
    }
  }, 1000);
}

function connectKeepAlivePort() {
  if (keepAlivePort) {
    return;
  }

  const port = chrome.runtime.connect({ name: REMOTE_SUPPORT_PORT_TRANSPORT });
  keepAlivePort = port;

  port.onDisconnect.addListener(() => {
    if (keepAlivePort === port) {
      keepAlivePort = null;
    }

    scheduleKeepAliveReconnect();
  });
}

function closeDataChannel(channel) {
  if (!channel || typeof channel.close !== "function") {
    return;
  }

  try {
    channel.close();
  } catch (error) {
    // Ignore channel shutdown races.
  }
}

function closePeerConnection(peerConnection) {
  if (!peerConnection || typeof peerConnection.close !== "function") {
    return;
  }

  try {
    peerConnection.close();
  } catch (error) {
    // Ignore connection shutdown races.
  }
}

function closeSignalingSocket(socket) {
  if (!socket || typeof socket.close !== "function") {
    return;
  }

  try {
    socket.close();
  } catch (error) {
    // Ignore socket shutdown races.
  }
}

function resetTransportResources(runtime) {
  if (!runtime) {
    return;
  }

  closeDataChannel(runtime.dataChannel);
  closePeerConnection(runtime.peerConnection);
  closeSignalingSocket(runtime.signalingSocket);

  runtime.dataChannel = null;
  runtime.peerConnection = null;
  runtime.signalingSocket = null;
}

function sendSignal(runtime, signalType, payload = {}) {
  if (!runtime || !runtime.signalingSocket || runtime.signalingSocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    runtime.signalingSocket.send(JSON.stringify({
      type: "signal",
      timestamp: Date.now(),
      payload: {
        signalType,
        sessionId: runtime.sessionId,
        role: runtime.role,
        ...payload
      }
    }));
    return true;
  } catch (error) {
    return false;
  }
}

function parseTransportMessage(rawMessage) {
  if (typeof rawMessage !== "string" || !rawMessage.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawMessage);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

function bindDataChannel(runtime, channel) {
  if (!runtime || !channel) {
    return;
  }

  runtime.dataChannel = channel;
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    postTransportEvent({
      type: "channel-open",
      sessionId: runtime.sessionId
    });
  };

  channel.onclose = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (!activeRuntime || activeRuntime.shuttingDown) {
      return;
    }

    handleFatalTransportError(runtime.sessionId, "Remote support data channel closed");
  };

  channel.onerror = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (!activeRuntime || activeRuntime.shuttingDown) {
      return;
    }

    handleFatalTransportError(runtime.sessionId, "Remote support data channel failed");
  };

  channel.onmessage = (event) => {
    const message = parseTransportMessage(event && event.data);
    if (!message) {
      return;
    }

    postTransportEvent({
      type: "incoming-message",
      sessionId: runtime.sessionId,
      message
    });
  };
}

async function ensurePeerConnection(runtime, offerer) {
  if (runtime.peerConnection) {
    return runtime.peerConnection;
  }

  if (typeof RTCPeerConnection !== "function") {
    throw new Error("WebRTC is unavailable in the offscreen document");
  }

  const peerConnection = new RTCPeerConnection();
  runtime.peerConnection = peerConnection;

  peerConnection.onicecandidate = (event) => {
    if (!event || !event.candidate) {
      return;
    }

    sendSignal(runtime, "ice", {
      candidate: event.candidate
    });
  };

  peerConnection.onconnectionstatechange = () => {
    if (!getTransportRuntime(runtime.sessionId) || runtime.shuttingDown) {
      return;
    }

    if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
      handleFatalTransportError(runtime.sessionId, "Peer connection closed");
    }
  };

  peerConnection.ondatachannel = (event) => {
    if (offerer || !event || !event.channel) {
      return;
    }

    bindDataChannel(runtime, event.channel);
  };

  if (offerer) {
    bindDataChannel(runtime, peerConnection.createDataChannel("remote-support"));
  }

  return peerConnection;
}

function sendDataMessage(runtime, messageType, payload) {
  if (
    !runtime ||
    !runtime.dataChannel ||
    runtime.dataChannel.readyState !== "open"
  ) {
    return false;
  }

  try {
    runtime.dataChannel.send(JSON.stringify({
      type: messageType,
      payload
    }));
    return true;
  } catch (error) {
    return false;
  }
}

async function shutdownTransport(sessionId, reason = "Session ended", options = {}) {
  const runtime = getTransportRuntime(sessionId);
  if (!runtime) {
    return;
  }

  runtime.shuttingDown = true;
  resetTransportResources(runtime);
  transportSessions.delete(runtime.sessionId);
  runtime.shuttingDown = false;

  if (options.reportError) {
    postTransportEvent({
      type: "transport-error",
      sessionId: runtime.sessionId,
      error: reason
    });
  }

  if (options.notifyBackground) {
    postTransportEvent({
      type: "session-ended",
      sessionId: runtime.sessionId,
      reason
    });
  }
}

async function shutdownAllTransports(reason = "Session ended", options = {}) {
  const activeSessionIds = Array.from(transportSessions.keys());
  for (const sessionId of activeSessionIds) {
    await shutdownTransport(sessionId, reason, options);
  }
}

function handleFatalTransportError(sessionId, error) {
  const runtime = getTransportRuntime(sessionId);
  if (!runtime || runtime.shuttingDown) {
    return;
  }

  const reason = normalizeErrorMessage(error, "Remote support transport failed");
  shutdownTransport(sessionId, reason, {
    notifyBackground: true,
    reportError: true
  }).then();
}

async function connectSignalingSocket(runtime) {
  const signalingSocket = new WebSocket(runtime.wsUrl);
  runtime.signalingSocket = signalingSocket;

  let opened = false;

  await new Promise((resolve, reject) => {
    signalingSocket.onopen = () => {
      opened = true;
      resolve();
    };

    signalingSocket.onerror = () => {
      if (!opened) {
        reject(new Error("Failed to connect signaling channel"));
        return;
      }

      postTransportEvent({
        type: "transport-error",
        sessionId: runtime.sessionId,
        error: "Remote support signaling error"
      });
    };

    signalingSocket.onclose = () => {
      if (!getTransportRuntime(runtime.sessionId) || runtime.shuttingDown) {
        return;
      }

      if (!opened) {
        reject(new Error("Failed to connect signaling channel"));
        return;
      }

      handleFatalTransportError(runtime.sessionId, "Signaling channel closed");
    };
  });

  signalingSocket.send(JSON.stringify({
    type: "register",
    timestamp: Date.now(),
    payload: {
      sessionId: runtime.sessionId,
      supportCode: runtime.supportCode,
      role: runtime.role
    }
  }));

  const offerer = runtime.role === "supporter";
  const peerConnection = await ensurePeerConnection(runtime, offerer);

  if (offerer) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal(runtime, "offer", {
      description: offer
    });
  }

  signalingSocket.onmessage = async (event) => {
    if (!getTransportRuntime(runtime.sessionId)) {
      return;
    }

    const message = parseTransportMessage(event && event.data);
    if (!message) {
      return;
    }

    if (message.type === "partner-ready") {
      postTransportEvent({
        type: "partner-ready",
        sessionId: runtime.sessionId
      });
      return;
    }

    if (message.type === "session-ended") {
      const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
      if (payload.sessionId && payload.sessionId !== runtime.sessionId) {
        return;
      }

      await shutdownTransport(
        runtime.sessionId,
        isNonEmptyString(payload.reason) ? payload.reason : "Session ended",
        { notifyBackground: true }
      );
      return;
    }

    if (message.type !== "signal") {
      return;
    }

    const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
    if (payload.sessionId !== runtime.sessionId) {
      return;
    }

    const activePeerConnection = await ensurePeerConnection(runtime, offerer);

    if (payload.signalType === "offer" && payload.description) {
      await activePeerConnection.setRemoteDescription(payload.description);
      const answer = await activePeerConnection.createAnswer();
      await activePeerConnection.setLocalDescription(answer);
      sendSignal(runtime, "answer", {
        description: answer
      });
      return;
    }

    if (payload.signalType === "answer" && payload.description) {
      await activePeerConnection.setRemoteDescription(payload.description);
      return;
    }

    if (payload.signalType === "ice" && payload.candidate) {
      await activePeerConnection.addIceCandidate(payload.candidate);
    }
  };
}

async function startTransport(session) {
  if (!session || typeof session !== "object") {
    throw new Error("Missing remote support session payload");
  }

  if (!isNonEmptyString(session.sessionId)) {
    throw new Error("Missing remote support session id");
  }

  if (!isNonEmptyString(session.supportCode)) {
    throw new Error("Missing support code");
  }

  if (session.role !== "requester" && session.role !== "supporter") {
    throw new Error("Missing remote support role");
  }

  if (!isNonEmptyString(session.wsUrl)) {
    throw new Error("Missing remote support signaling url");
  }

  connectKeepAlivePort();

  if (getTransportRuntime(session.sessionId)) {
    await shutdownTransport(session.sessionId, "Session restarted");
  }

  const runtime = createTransportRuntime(session);
  transportSessions.set(runtime.sessionId, runtime);

  void connectSignalingSocket(runtime).catch((error) => {
    handleFatalTransportError(runtime.sessionId, error);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== REMOTE_SUPPORT_TRANSPORT_TARGET) {
    return false;
  }

  if (message.type === "remoteSupportTransportStart") {
    startTransport(message.session)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: normalizeErrorMessage(error, "Failed to start remote support transport")
        });
      });
    return true;
  }

  if (message.type === "remoteSupportTransportStop") {
    const promise = isNonEmptyString(message.sessionId)
      ? shutdownTransport(message.sessionId, isNonEmptyString(message.reason) ? message.reason : "Session ended")
      : shutdownAllTransports(isNonEmptyString(message.reason) ? message.reason : "Session ended");

    promise
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: normalizeErrorMessage(error, "Failed to stop remote support transport")
        });
      });
    return true;
  }

  if (message.type === "remoteSupportTransportSendData") {
    const runtime = getTransportRuntime(message.sessionId);
    if (!runtime) {
      sendResponse({ ok: false });
      return false;
    }

    sendResponse({
      ok: sendDataMessage(runtime, message.messageType, message.payload)
    });
    return false;
  }

  return false;
});

window.addEventListener("beforeunload", () => {
  shutdownAllTransports("Offscreen document closed").then();
});

connectKeepAlivePort();