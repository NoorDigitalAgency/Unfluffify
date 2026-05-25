import {
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT,
  REMOTE_SUPPORT_DATA_CHANNEL_LABEL_DEFAULT,
  REMOTE_SUPPORT_PORT_TRANSPORT
} from "./common/remote-support.js";

const REMOTE_SUPPORT_TRANSPORT_TARGET = "remoteSupportOffscreen";
const REMOTE_SUPPORT_CHUNK_MESSAGE_TYPE = "__remoteSupportChunk";
const REMOTE_SUPPORT_FALLBACK_MAX_MESSAGE_SIZE_BYTES = 64 * 1024;

const transportSessions = new Map();
const dataChannelTextEncoder = new TextEncoder();

let keepAlivePort = null;
let keepAliveReconnectTimer = 0;
let nextChunkTransferId = 0;

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

function createDataChannelLabel(channelKey) {
  const normalizedChannelKey = isNonEmptyString(channelKey)
    ? channelKey.trim()
    : REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT;

  return normalizedChannelKey === REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT
    ? REMOTE_SUPPORT_DATA_CHANNEL_LABEL_DEFAULT
    : `remote-support-${normalizedChannelKey}`;
}

function normalizeDataChannelDescriptor(candidate) {
  if (typeof candidate === "string") {
    const key = candidate.trim();
    if (!key) {
      return null;
    }

    return {
      key,
      label: createDataChannelLabel(key)
    };
  }

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const key = isNonEmptyString(candidate.key)
    ? candidate.key.trim()
    : REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT;
  const label = isNonEmptyString(candidate.label)
    ? candidate.label.trim()
    : createDataChannelLabel(key);

  if (!key || !label) {
    return null;
  }

  return { key, label };
}

function normalizeDataChannelDescriptors(dataChannels) {
  const normalized = [];
  const seenKeys = new Set();

  for (const candidate of Array.isArray(dataChannels) ? dataChannels : []) {
    const descriptor = normalizeDataChannelDescriptor(candidate);
    if (!descriptor || seenKeys.has(descriptor.key)) {
      continue;
    }

    seenKeys.add(descriptor.key);
    normalized.push(descriptor);
  }

  return normalized.length
    ? normalized
    : [{
        key: REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT,
        label: REMOTE_SUPPORT_DATA_CHANNEL_LABEL_DEFAULT
      }];
}

function createDataChannelDescriptorKey(descriptor) {
  return `${descriptor.key}\u001e${descriptor.label}`;
}

function haveMatchingTransportConfig(runtime, session, iceServers, dataChannelDescriptors) {
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

  if (runtime.dataChannelDescriptors.length !== dataChannelDescriptors.length) {
    return false;
  }

  for (let index = 0; index < iceServers.length; index += 1) {
    if (createIceServerKey(runtime.iceServers[index]) !== createIceServerKey(iceServers[index])) {
      return false;
    }
  }

  for (let index = 0; index < dataChannelDescriptors.length; index += 1) {
    if (createDataChannelDescriptorKey(runtime.dataChannelDescriptors[index]) !== createDataChannelDescriptorKey(dataChannelDescriptors[index])) {
      return false;
    }
  }

  return true;
}

function getDefaultDataChannelKey(runtime) {
  if (!runtime || !Array.isArray(runtime.dataChannelDescriptors) || !runtime.dataChannelDescriptors.length) {
    return REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT;
  }

  return runtime.dataChannelDescriptors.some((descriptor) => descriptor.key === REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT)
    ? REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT
    : runtime.dataChannelDescriptors[0].key;
}

function getDataChannelDescriptorByKey(runtime, channelKey = getDefaultDataChannelKey(runtime)) {
  if (!runtime || !Array.isArray(runtime.dataChannelDescriptors)) {
    return null;
  }

  return runtime.dataChannelDescriptors.find((descriptor) => descriptor.key === channelKey) || null;
}

function getDataChannelKeyByLabel(runtime, label) {
  if (!runtime || !Array.isArray(runtime.dataChannelDescriptors)) {
    return "";
  }

  const normalizedLabel = isNonEmptyString(label) ? label.trim() : "";
  if (!normalizedLabel) {
    return runtime.dataChannelDescriptors.length === 1
      ? runtime.dataChannelDescriptors[0].key
      : "";
  }

  const descriptor = runtime.dataChannelDescriptors.find((candidate) => candidate.label === normalizedLabel);
  return descriptor ? descriptor.key : "";
}

function getDataChannel(runtime, channelKey = getDefaultDataChannelKey(runtime)) {
  if (!runtime || !(runtime.dataChannels instanceof Map)) {
    return null;
  }

  return runtime.dataChannels.get(channelKey) || null;
}

function createTransportRuntime(session) {
  return {
    sessionId: session.sessionId.trim(),
    supportCode: session.supportCode.trim(),
    role: session.role,
    wsUrl: session.wsUrl.trim(),
    iceServers: normalizeIceServers(session.iceServers),
    dataChannelDescriptors: normalizeDataChannelDescriptors(session.dataChannels),
    pendingIceCandidates: [],
    signalingSocket: null,
    peerConnection: null,
    dataChannels: new Map(),
    lastPeerConnectionState: "",
    lastIceConnectionState: "",
    lastIceGatheringState: "",
    lastSignalingState: "",
    lastDataChannelState: "",
    lastDataChannelKey: REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT,
    lastIceCandidateError: "",
    chunkAssemblies: new Map(),
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

function updateDataChannelDiagnostics(runtime, channel = getDataChannel(runtime), channelKey = getDefaultDataChannelKey(runtime)) {
  if (!runtime || !channel) {
    return;
  }

  runtime.lastDataChannelState = normalizeTransportStateValue(channel.readyState);
  runtime.lastDataChannelKey = isNonEmptyString(channelKey)
    ? channelKey.trim()
    : getDefaultDataChannelKey(runtime);
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
    diagnostics.push(
      runtime.lastDataChannelKey && runtime.lastDataChannelKey !== REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT
        ? `data[${runtime.lastDataChannelKey}]=${runtime.lastDataChannelState}`
        : `data=${runtime.lastDataChannelState}`
    );
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

function getSerializedMessageByteLength(serializedMessage) {
  return dataChannelTextEncoder.encode(serializedMessage).length;
}

function getMaxDataChannelMessageSize(runtime) {
  const maxMessageSize = Number(
    runtime &&
    runtime.peerConnection &&
    runtime.peerConnection.sctp &&
    runtime.peerConnection.sctp.maxMessageSize
  );

  if (Number.isFinite(maxMessageSize) && maxMessageSize > 0) {
    return Math.trunc(maxMessageSize);
  }

  return REMOTE_SUPPORT_FALLBACK_MAX_MESSAGE_SIZE_BYTES;
}

function serializeDataChannelMessage(type, payload = {}) {
  return JSON.stringify({
    type,
    payload
  });
}

function createChunkTransferId(runtime) {
  const transferId = nextChunkTransferId;
  nextChunkTransferId += 1;
  return `${runtime.sessionId}:${runtime.role}:${transferId.toString(36)}`;
}

function splitSerializedMessageIntoChunks(runtime, serializedMessage, maxMessageSize) {
  const chunks = [];
  const transferId = createChunkTransferId(runtime);
  let start = 0;
  let index = 0;

  while (start < serializedMessage.length) {
    let bestEnd = start;
    let low = start + 1;
    let high = serializedMessage.length;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const chunkEnvelope = serializeDataChannelMessage(REMOTE_SUPPORT_CHUNK_MESSAGE_TYPE, {
        transferId,
        index,
        final: middle >= serializedMessage.length,
        data: serializedMessage.slice(start, middle)
      });

      if (getSerializedMessageByteLength(chunkEnvelope) <= maxMessageSize) {
        bestEnd = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (bestEnd === start) {
      return [];
    }

    chunks.push(serializeDataChannelMessage(REMOTE_SUPPORT_CHUNK_MESSAGE_TYPE, {
      transferId,
      index,
      final: bestEnd >= serializedMessage.length,
      data: serializedMessage.slice(start, bestEnd)
    }));

    start = bestEnd;
    index += 1;
  }

  return chunks;
}

function consumeChunkedDataChannelMessage(runtime, message) {
  if (!runtime || !message || message.type !== REMOTE_SUPPORT_CHUNK_MESSAGE_TYPE) {
    return message;
  }

  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  const transferId = isNonEmptyString(payload.transferId) ? payload.transferId.trim() : "";
  const index = Number(payload.index);
  const final = Boolean(payload.final);
  const data = typeof payload.data === "string" ? payload.data : "";

  if (!transferId || !Number.isInteger(index) || index < 0) {
    return null;
  }

  let assembly = runtime.chunkAssemblies.get(transferId);
  if (!assembly) {
    assembly = {
      chunks: [],
      finalIndex: null
    };
    runtime.chunkAssemblies.set(transferId, assembly);
  }

  assembly.chunks[index] = data;
  if (final) {
    assembly.finalIndex = index;
  }

  if (assembly.finalIndex === null) {
    return null;
  }

  for (let chunkIndex = 0; chunkIndex <= assembly.finalIndex; chunkIndex += 1) {
    if (typeof assembly.chunks[chunkIndex] !== "string") {
      return null;
    }
  }

  runtime.chunkAssemblies.delete(transferId);
  return parseTransportMessage(assembly.chunks.slice(0, assembly.finalIndex + 1).join(""));
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

  for (const channel of runtime.dataChannels.values()) {
    closeDataChannel(channel);
  }
  closePeerConnection(runtime.peerConnection);
  closeSignalingSocket(runtime.signalingSocket);

  runtime.dataChannels.clear();
  runtime.peerConnection = null;
  runtime.pendingIceCandidates = [];
  runtime.signalingSocket = null;
  runtime.lastIceCandidateError = "";
  runtime.chunkAssemblies.clear();
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

function bindDataChannel(runtime, channel, channelKey = getDefaultDataChannelKey(runtime)) {
  if (!runtime || !channel) {
    return;
  }

  const normalizedChannelKey = isNonEmptyString(channelKey)
    ? channelKey.trim()
    : getDefaultDataChannelKey(runtime);
  const existingChannel = getDataChannel(runtime, normalizedChannelKey);
  runtime.dataChannels.set(normalizedChannelKey, channel);

  if (existingChannel && existingChannel !== channel) {
    closeDataChannel(existingChannel);
  }

  channel.binaryType = "arraybuffer";
  updateDataChannelDiagnostics(runtime, channel, normalizedChannelKey);

  channel.onopen = () => {
    updateDataChannelDiagnostics(runtime, channel, normalizedChannelKey);
    postTransportEvent({
      type: "channel-open",
      sessionId: runtime.sessionId,
      channelKey: normalizedChannelKey
    });
  };

  channel.onclose = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (!activeRuntime || activeRuntime.shuttingDown) {
      return;
    }

    if (getDataChannel(activeRuntime, normalizedChannelKey) !== channel) {
      return;
    }

    updateDataChannelDiagnostics(activeRuntime, channel, normalizedChannelKey);
    handleFatalTransportError(runtime.sessionId, formatTransportError(activeRuntime, "Remote support data channel closed"));
  };

  channel.onerror = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (!activeRuntime || activeRuntime.shuttingDown) {
      return;
    }

    if (getDataChannel(activeRuntime, normalizedChannelKey) !== channel) {
      return;
    }

    updateDataChannelDiagnostics(activeRuntime, channel, normalizedChannelKey);
    handleFatalTransportError(runtime.sessionId, formatTransportError(activeRuntime, "Remote support data channel failed"));
  };

  channel.onmessage = (event) => {
    const parsedMessage = parseTransportMessage(event && event.data);
    if (!parsedMessage) {
      return;
    }

    const message = consumeChunkedDataChannelMessage(runtime, parsedMessage);
    if (!message) {
      return;
    }

    postTransportEvent({
      type: "incoming-message",
      sessionId: runtime.sessionId,
      channelKey: normalizedChannelKey,
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

    const channelKey = getDataChannelKeyByLabel(runtime, event.channel.label);
    if (!channelKey) {
      closeDataChannel(event.channel);
      return;
    }

    bindDataChannel(runtime, event.channel, channelKey);
  };

  if (offerer) {
    for (const descriptor of runtime.dataChannelDescriptors) {
      bindDataChannel(runtime, peerConnection.createDataChannel(descriptor.label), descriptor.key);
    }
  }

  return peerConnection;
}

function sendDataMessage(runtime, messageType, payload, channelKey = getDefaultDataChannelKey(runtime)) {
  const resolvedChannelKey = isNonEmptyString(channelKey)
    ? channelKey.trim()
    : getDefaultDataChannelKey(runtime);
  const dataChannel = getDataChannel(runtime, resolvedChannelKey);

  if (
    !runtime ||
    !dataChannel ||
    dataChannel.readyState !== "open"
  ) {
    return false;
  }

  const bufferedAmount = Number(dataChannel.bufferedAmount);
  if (
    Number.isFinite(bufferedAmount) &&
    bufferedAmount >= REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES
  ) {
    return false;
  }

  const serializedMessage = serializeDataChannelMessage(messageType, payload);
  const maxMessageSize = getMaxDataChannelMessageSize(runtime);
  const outboundMessages = getSerializedMessageByteLength(serializedMessage) <= maxMessageSize
    ? [serializedMessage]
    : splitSerializedMessageIntoChunks(runtime, serializedMessage, maxMessageSize);

  if (!outboundMessages.length) {
    return false;
  }

  try {
    for (const rawMessage of outboundMessages) {
      const nextBufferedAmount = Number(dataChannel.bufferedAmount);
      if (
        Number.isFinite(nextBufferedAmount) &&
        nextBufferedAmount >= REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES
      ) {
        return false;
      }

      dataChannel.send(rawMessage);
    }
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

  const dataChannelDescriptors = normalizeDataChannelDescriptors(session.dataChannels);

  connectKeepAlivePort();

  const existingRuntime = getTransportRuntime(session.sessionId);
  if (existingRuntime && haveMatchingTransportConfig(existingRuntime, session, iceServers, dataChannelDescriptors)) {
    return;
  }

  if (existingRuntime) {
    await shutdownTransport(session.sessionId, "Session restarted");
  }

  const runtime = createTransportRuntime({
    ...session,
    iceServers,
    dataChannels: dataChannelDescriptors
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
      ok: sendDataMessage(runtime, message.messageType, message.payload, message.channelKey)
    });
    return false;
  }

  return false;
});

window.addEventListener("beforeunload", () => {
  shutdownAllTransports("Offscreen document closed").then();
});

connectKeepAlivePort();