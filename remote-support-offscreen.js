import {
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_PORT_TRANSPORT
} from "./common/remote-support.js";

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

function normalizeTransportStateValue(value) {
  return isNonEmptyString(value) ? value.trim() : "";
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

function createIceServerKey(entry) {
  return `${entry.urls.join("\u001f")}\u001e${entry.username || ""}\u001e${entry.credential || ""}`;
}

function normalizeIceServerEntries(iceServers) {
  const normalized = [];
  const seenKeys = new Set();

  for (const candidate of Array.isArray(iceServers) ? iceServers : []) {
    if (!candidate) {
      continue;
    }

    if (typeof candidate === "string") {
      const trimmedValue = candidate.trim();
      if (trimmedValue) {
        normalized.push({ urls: [trimmedValue] });
      }
      continue;
    }

    if (typeof candidate !== "object") {
      continue;
    }

    const rawUrls = Array.isArray(candidate.urls)
      ? candidate.urls
      : [candidate.urls];
    const urls = rawUrls
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!urls.length) {
      continue;
    }

    const normalizedEntry = { urls };

    if (isNonEmptyString(candidate.username)) {
      normalizedEntry.username = candidate.username.trim();
    }

    if (isNonEmptyString(candidate.credential)) {
      normalizedEntry.credential = candidate.credential.trim();
    }

    const entryKey = createIceServerKey(normalizedEntry);
    if (seenKeys.has(entryKey)) {
      continue;
    }

    seenKeys.add(entryKey);
    normalized.push(normalizedEntry);
  }

  return normalized;
}

function normalizeIceServers(iceServers) {
  return normalizeIceServerEntries(iceServers);
}

function haveMatchingTransportConfig(runtime, session, iceServers) {
  if (!runtime || !session) {
    return false;
  }

  if (runtime.supportCode !== session.supportCode.trim()) {
    return false;
  }

  if (runtime.role !== session.role) {
    return false;
  }

  if (runtime.wsUrl !== session.wsUrl.trim()) {
    return false;
  }

  if (runtime.iceServers.length !== iceServers.length) {
    return false;
  }

  for (let index = 0; index < iceServers.length; index += 1) {
    if (createIceServerKey(runtime.iceServers[index]) !== createIceServerKey(iceServers[index])) {
      return false;
    }
  }

  return true;
}

function createTransportRuntime(session) {
  return {
    sessionId: session.sessionId.trim(),
    supportCode: session.supportCode.trim(),
    role: session.role,
    wsUrl: session.wsUrl.trim(),
    iceServers: normalizeIceServers(session.iceServers),
    pendingIceCandidates: [],
    signalingSocket: null,
    peerConnection: null,
    dataChannel: null,
    lastPeerConnectionState: "",
    lastIceConnectionState: "",
    lastIceGatheringState: "",
    lastSignalingState: "",
    lastDataChannelState: "",
    lastIceCandidateError: "",
    shuttingDown: false
  };
}

function updatePeerConnectionDiagnostics(runtime, peerConnection = runtime && runtime.peerConnection) {
  if (!runtime || !peerConnection) {
    return;
  }

  runtime.lastPeerConnectionState = normalizeTransportStateValue(peerConnection.connectionState);
  runtime.lastIceConnectionState = normalizeTransportStateValue(peerConnection.iceConnectionState);
  runtime.lastIceGatheringState = normalizeTransportStateValue(peerConnection.iceGatheringState);
  runtime.lastSignalingState = normalizeTransportStateValue(peerConnection.signalingState);
}

function updateDataChannelDiagnostics(runtime, channel = runtime && runtime.dataChannel) {
  if (!runtime || !channel) {
    return;
  }

  runtime.lastDataChannelState = normalizeTransportStateValue(channel.readyState);
}

function formatIceCandidateError(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const parts = [];

  if (Number.isFinite(event.errorCode)) {
    parts.push(`code=${event.errorCode}`);
  }

  if (isNonEmptyString(event.errorText)) {
    parts.push(event.errorText.trim());
  }

  if (isNonEmptyString(event.url)) {
    parts.push(event.url.trim());
  }

  if (isNonEmptyString(event.address)) {
    parts.push(event.address.trim());
  }

  if (Number.isFinite(event.port)) {
    parts.push(`port=${event.port}`);
  }

  return parts.join(" | ");
}

function getTransportDiagnostics(runtime) {
  if (!runtime) {
    return "";
  }

  const diagnostics = [];

  if (runtime.lastPeerConnectionState && runtime.lastPeerConnectionState !== "new") {
    diagnostics.push(`connection=${runtime.lastPeerConnectionState}`);
  }

  if (runtime.lastIceConnectionState && runtime.lastIceConnectionState !== "new") {
    diagnostics.push(`ice=${runtime.lastIceConnectionState}`);
  }

  if (runtime.lastIceGatheringState && runtime.lastIceGatheringState !== "new") {
    diagnostics.push(`gathering=${runtime.lastIceGatheringState}`);
  }

  if (runtime.lastSignalingState && runtime.lastSignalingState !== "stable") {
    diagnostics.push(`signaling=${runtime.lastSignalingState}`);
  }

  if (runtime.lastDataChannelState && runtime.lastDataChannelState !== "open") {
    diagnostics.push(`data=${runtime.lastDataChannelState}`);
  }

  if (runtime.lastIceCandidateError) {
    diagnostics.push(`iceError=${runtime.lastIceCandidateError}`);
  }

  return diagnostics.join(", ");
}

function formatTransportError(runtime, error, fallback) {
  const baseMessage = normalizeErrorMessage(error, fallback);
  const diagnostics = getTransportDiagnostics(runtime);
  return diagnostics ? `${baseMessage} (${diagnostics})` : baseMessage;
}

function hasRemoteDescription(peerConnection) {
  return Boolean(peerConnection && peerConnection.remoteDescription);
}

async function flushPendingIceCandidates(runtime, peerConnection = runtime && runtime.peerConnection) {
  if (!runtime || !peerConnection || !hasRemoteDescription(peerConnection)) {
    return;
  }

  while (runtime.pendingIceCandidates.length) {
    const candidate = runtime.pendingIceCandidates.shift();
    await peerConnection.addIceCandidate(candidate);
  }
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
  runtime.pendingIceCandidates = [];
  runtime.signalingSocket = null;
  runtime.lastIceCandidateError = "";
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
  updateDataChannelDiagnostics(runtime, channel);

  channel.onopen = () => {
    updateDataChannelDiagnostics(runtime, channel);
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

    updateDataChannelDiagnostics(activeRuntime, channel);
    handleFatalTransportError(runtime.sessionId, formatTransportError(activeRuntime, "Remote support data channel closed"));
  };

  channel.onerror = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (!activeRuntime || activeRuntime.shuttingDown) {
      return;
    }

    updateDataChannelDiagnostics(activeRuntime, channel);
    handleFatalTransportError(runtime.sessionId, formatTransportError(activeRuntime, "Remote support data channel failed"));
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

  const peerConnection = new RTCPeerConnection({
    iceServers: runtime.iceServers,
    iceCandidatePoolSize: 4
  });
  runtime.peerConnection = peerConnection;
  updatePeerConnectionDiagnostics(runtime, peerConnection);

  peerConnection.onicecandidate = (event) => {
    if (!event || !event.candidate) {
      return;
    }

    sendSignal(runtime, "ice", {
      candidate: event.candidate
    });
  };

  peerConnection.onicecandidateerror = (event) => {
    runtime.lastIceCandidateError = formatIceCandidateError(event);
  };

  peerConnection.oniceconnectionstatechange = () => {
    updatePeerConnectionDiagnostics(runtime, peerConnection);
  };

  peerConnection.onicegatheringstatechange = () => {
    updatePeerConnectionDiagnostics(runtime, peerConnection);
  };

  peerConnection.onsignalingstatechange = () => {
    updatePeerConnectionDiagnostics(runtime, peerConnection);
  };

  peerConnection.onconnectionstatechange = () => {
    updatePeerConnectionDiagnostics(runtime, peerConnection);
    if (!getTransportRuntime(runtime.sessionId) || runtime.shuttingDown) {
      return;
    }

    if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
      handleFatalTransportError(runtime.sessionId, formatTransportError(runtime, "Peer connection closed"));
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

  const bufferedAmount = Number(runtime.dataChannel.bufferedAmount);
  if (
    Number.isFinite(bufferedAmount) &&
    bufferedAmount >= REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES
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
        error: formatTransportError(runtime, "Remote support signaling error")
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

      handleFatalTransportError(runtime.sessionId, formatTransportError(runtime, "Signaling channel closed"));
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
    updatePeerConnectionDiagnostics(runtime, peerConnection);
    sendSignal(runtime, "offer", {
      description: offer
    });
  }

  signalingSocket.onmessage = async (event) => {
    if (!getTransportRuntime(runtime.sessionId)) {
      return;
    }

    try {
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
        updatePeerConnectionDiagnostics(runtime, activePeerConnection);
        await flushPendingIceCandidates(runtime, activePeerConnection);

        const answer = await activePeerConnection.createAnswer();
        await activePeerConnection.setLocalDescription(answer);
        updatePeerConnectionDiagnostics(runtime, activePeerConnection);
        sendSignal(runtime, "answer", {
          description: answer
        });
        return;
      }

      if (payload.signalType === "answer" && payload.description) {
        await activePeerConnection.setRemoteDescription(payload.description);
        updatePeerConnectionDiagnostics(runtime, activePeerConnection);
        await flushPendingIceCandidates(runtime, activePeerConnection);
        return;
      }

      if (payload.signalType === "ice" && payload.candidate) {
        if (!hasRemoteDescription(activePeerConnection)) {
          runtime.pendingIceCandidates.push(payload.candidate);
          return;
        }

        await activePeerConnection.addIceCandidate(payload.candidate);
      }
    } catch (error) {
      updatePeerConnectionDiagnostics(runtime, runtime.peerConnection);
      handleFatalTransportError(runtime.sessionId, formatTransportError(runtime, error, "Remote support transport failed"));
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

  const iceServers = normalizeIceServers(session.iceServers);
  if (!iceServers.length) {
    throw new Error("Missing remote support ICE servers");
  }

  connectKeepAlivePort();

  const existingRuntime = getTransportRuntime(session.sessionId);
  if (existingRuntime && haveMatchingTransportConfig(existingRuntime, session, iceServers)) {
    return;
  }

  if (existingRuntime) {
    await shutdownTransport(session.sessionId, "Session restarted");
  }

  const runtime = createTransportRuntime({
    ...session,
    iceServers
  });
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