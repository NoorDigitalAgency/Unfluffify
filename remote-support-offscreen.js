import {
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_PORT_TRANSPORT,
  REMOTE_SUPPORT_ROLE_SUPPORTER,
  parseRemoteSupportMessage,
  serializeRemoteSupportMessage
} from "./common/remote-support.js";

const REMOTE_SUPPORT_OFFSCREEN_TARGET = "remoteSupportOffscreen";
const REMOTE_SUPPORT_OFFSCREEN_SOURCE = "remoteSupportOffscreen";

let keepAlivePort = null;
let keepAliveReconnectTimer = 0;
let signalingSocket = null;
let peerConnection = null;
let dataChannel = null;
let activeSessionId = "";
let activeSupportCode = "";
let activeRole = "";
let shuttingDown = false;

function getErrorMessage(error, fallback) {
  return (error && error.message) || fallback;
}

function isActiveSession(sessionId) {
  return Boolean(activeSessionId) && (!sessionId || activeSessionId === sessionId);
}

function clearKeepAliveReconnectTimer() {
  if (!keepAliveReconnectTimer) {
    return;
  }
  globalThis.clearTimeout(keepAliveReconnectTimer);
  keepAliveReconnectTimer = 0;
}

function scheduleKeepAliveReconnect() {
  if (keepAliveReconnectTimer) {
    return;
  }
  keepAliveReconnectTimer = globalThis.setTimeout(() => {
    keepAliveReconnectTimer = 0;
    connectKeepAlivePort();
  }, 250);
}

function connectKeepAlivePort() {
  clearKeepAliveReconnectTimer();
  try {
    const port = chrome.runtime.connect({ name: REMOTE_SUPPORT_PORT_TRANSPORT });
    keepAlivePort = port;
    port.onDisconnect.addListener(() => {
      if (keepAlivePort !== port) {
        return;
      }
      keepAlivePort = null;
      scheduleKeepAliveReconnect();
    });
  } catch {
    scheduleKeepAliveReconnect();
  }
}

function postBackgroundEvent(event) {
  chrome.runtime.sendMessage({
    type: "remoteSupportTransportEvent",
    source: REMOTE_SUPPORT_OFFSCREEN_SOURCE,
    event
  }).then().catch(() => {
    // Ignore background availability races.
  });
}

function resetRuntimeResources() {
  if (dataChannel) {
    try {
      dataChannel.onopen = null;
      dataChannel.onclose = null;
      dataChannel.onmessage = null;
      dataChannel.onerror = null;
      if (dataChannel.readyState === "open" || dataChannel.readyState === "connecting") {
        dataChannel.close();
      }
    } catch {
      // Ignore close races.
    }
  }
  dataChannel = null;

  if (peerConnection) {
    try {
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.ondatachannel = null;
      peerConnection.close();
    } catch {
      // Ignore close races.
    }
  }
  peerConnection = null;

  if (signalingSocket) {
    try {
      signalingSocket.onopen = null;
      signalingSocket.onmessage = null;
      signalingSocket.onerror = null;
      signalingSocket.onclose = null;
      if (
        signalingSocket.readyState === WebSocket.OPEN ||
        signalingSocket.readyState === WebSocket.CONNECTING
      ) {
        signalingSocket.close();
      }
    } catch {
      // Ignore close races.
    }
  }
  signalingSocket = null;
}

function sendSignal(type, payload) {
  if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
    return;
  }
  signalingSocket.send(
    serializeRemoteSupportMessage("signal", {
      signalType: type,
      sessionId: activeSessionId,
      role: activeRole,
      ...payload
    })
  );
}

function sendDataMessage(type, payload = {}) {
  if (!dataChannel || dataChannel.readyState !== "open") {
    return false;
  }

  const raw = serializeRemoteSupportMessage(type, payload);
  if (
    typeof dataChannel.bufferedAmount === "number" &&
    dataChannel.bufferedAmount > REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES
  ) {
    return false;
  }

  try {
    dataChannel.send(raw);
    return true;
  } catch {
    return false;
  }
}

function bindDataChannel(channel) {
  dataChannel = channel;
  dataChannel.onopen = () => {
    postBackgroundEvent({
      type: "channel-open",
      sessionId: activeSessionId
    });
  };
  dataChannel.onclose = () => {
    postBackgroundEvent({
      type: "channel-close",
      sessionId: activeSessionId
    });
  };
  dataChannel.onerror = () => {
    postBackgroundEvent({
      type: "transport-error",
      sessionId: activeSessionId,
      error: "Remote data channel error"
    });
  };
  dataChannel.onmessage = (event) => {
    const message = parseRemoteSupportMessage(event && event.data);
    if (!message) {
      return;
    }
    postBackgroundEvent({
      type: "incoming-message",
      sessionId: activeSessionId,
      message
    });
  };
}

async function ensurePeerConnection(offerer) {
  if (peerConnection) {
    return peerConnection;
  }
  if (typeof RTCPeerConnection !== "function") {
    throw new Error("WebRTC peer connection is not available in the remote support transport document");
  }

  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
  });

  peerConnection.onicecandidate = (event) => {
    if (!event || !event.candidate) {
      return;
    }
    sendSignal("ice", { candidate: event.candidate });
  };

  peerConnection.onconnectionstatechange = () => {
    const connectionState = peerConnection ? peerConnection.connectionState : "closed";
    if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
      handleFatalTransportError("Connection ended");
    }
  };

  if (offerer) {
    bindDataChannel(peerConnection.createDataChannel("remote-support", { ordered: true }));
  } else {
    peerConnection.ondatachannel = (event) => {
      if (!event || !event.channel) {
        return;
      }
      bindDataChannel(event.channel);
    };
  }

  return peerConnection;
}

async function shutdownTransport(reason = "Session ended", options = {}) {
  const { notifyBackground = false, reportError = false } = options;
  const closedSessionId = activeSessionId;

  shuttingDown = true;
  resetRuntimeResources();
  activeSessionId = "";
  activeSupportCode = "";
  activeRole = "";
  shuttingDown = false;

  if (reportError && closedSessionId) {
    postBackgroundEvent({
      type: "transport-error",
      sessionId: closedSessionId,
      error: reason
    });
  }

  if (notifyBackground && closedSessionId) {
    postBackgroundEvent({
      type: "session-ended",
      sessionId: closedSessionId,
      reason
    });
  }
}

function handleFatalTransportError(error) {
  const message = getErrorMessage(error, "Remote support transport failed");
  if (shuttingDown || !activeSessionId) {
    return;
  }
  shutdownTransport(message, {
    notifyBackground: true,
    reportError: true
  }).then();
}

async function connectSignalingSocket({ wsUrl, role, supportCode, sessionId }) {
  await new Promise((resolve, reject) => {
    try {
      signalingSocket = new WebSocket(wsUrl);
    } catch {
      reject(new Error("Unable to open signaling channel"));
      return;
    }

    let opened = false;

    signalingSocket.onopen = async () => {
      try {
        signalingSocket.send(
          serializeRemoteSupportMessage("register", {
            sessionId,
            supportCode,
            role
          })
        );

        const offerer = role === REMOTE_SUPPORT_ROLE_SUPPORTER;
        const pc = await ensurePeerConnection(offerer);
        if (offerer) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal("offer", { description: pc.localDescription });
        }

        opened = true;
        resolve();
      } catch (error) {
        reject(new Error(getErrorMessage(error, "Unable to initialize remote support signaling")));
      }
    };

    signalingSocket.onmessage = async (event) => {
      try {
        const message = parseRemoteSupportMessage(event && event.data);
        if (!message || !isActiveSession(sessionId)) {
          return;
        }

        if (message.type === "partner-ready") {
          postBackgroundEvent({
            type: "partner-ready",
            sessionId
          });
          return;
        }

        if (message.type !== "signal") {
          return;
        }

        const payload = message.payload || {};
        if (payload.sessionId !== sessionId) {
          return;
        }

        const pc = await ensurePeerConnection(role === REMOTE_SUPPORT_ROLE_SUPPORTER);
        const signalType = payload.signalType;

        if (signalType === "offer" && payload.description) {
          await pc.setRemoteDescription(payload.description);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal("answer", { description: pc.localDescription });
          return;
        }

        if (signalType === "answer" && payload.description) {
          await pc.setRemoteDescription(payload.description);
          return;
        }

        if (signalType === "ice" && payload.candidate) {
          try {
            await pc.addIceCandidate(payload.candidate);
          } catch {
            // Ignore malformed or stale candidates.
          }
        }
      } catch (error) {
        handleFatalTransportError(error);
      }
    };

    signalingSocket.onerror = () => {
      if (!isActiveSession(sessionId)) {
        return;
      }
      postBackgroundEvent({
        type: "transport-error",
        sessionId,
        error: "Signaling connection error"
      });
    };

    signalingSocket.onclose = () => {
      if (!isActiveSession(sessionId) || shuttingDown) {
        return;
      }
      if (!opened) {
        reject(new Error("Signaling channel closed"));
        return;
      }
      handleFatalTransportError("Signaling channel closed");
    };
  });
}

async function startTransport(session) {
  if (!session || typeof session !== "object") {
    throw new Error("Remote support transport start message is missing a session payload");
  }

  const sessionId = typeof session.sessionId === "string" ? session.sessionId.trim() : "";
  const supportCode = typeof session.supportCode === "string" ? session.supportCode.trim() : "";
  const role = typeof session.role === "string" ? session.role.trim() : "";
  const wsUrl = typeof session.wsUrl === "string" ? session.wsUrl.trim() : "";

  if (!sessionId || !supportCode || !role || !wsUrl) {
    throw new Error("Remote support transport start message is missing required fields");
  }

  await shutdownTransport("Session restarted");

  activeSessionId = sessionId;
  activeSupportCode = supportCode;
  activeRole = role;

  void connectSignalingSocket({
    wsUrl,
    role,
    supportCode,
    sessionId
  }).catch((error) => {
    handleFatalTransportError(error);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== REMOTE_SUPPORT_OFFSCREEN_TARGET) {
    return;
  }

  if (message.type === "remoteSupportTransportStart") {
    startTransport(message.session)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error, "Unable to start remote support transport")
        });
      });
    return true;
  }

  if (message.type === "remoteSupportTransportStop") {
    shutdownTransport(typeof message.reason === "string" ? message.reason : "Session ended")
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error, "Unable to stop remote support transport")
        });
      });
    return true;
  }

  if (message.type === "remoteSupportTransportSendData") {
    if (!isActiveSession(message.sessionId)) {
      sendResponse({ ok: false, error: "Remote support transport session is not active" });
      return;
    }

    sendResponse({
      ok: sendDataMessage(message.messageType, message.payload || {})
    });
    return;
  }
});

connectKeepAlivePort();