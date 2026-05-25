import {
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT,
  REMOTE_SUPPORT_DATA_CHANNEL_LABEL_DEFAULT
} from "./common/remote-support.js";

const REMOTE_SUPPORT_CHUNK_MESSAGE_TYPE = "__remoteSupportChunk";
const REMOTE_SUPPORT_FALLBACK_MAX_MESSAGE_SIZE_BYTES = 64 * 1024;

const dataChannelTextEncoder = new TextEncoder();

let controlPort = null;
let activeRuntime = null;
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

function getTransportRuntime(sessionId) {
  if (!activeRuntime || !isNonEmptyString(sessionId)) {
    return null;
  }

  return activeRuntime.sessionId === sessionId.trim()
    ? activeRuntime
    : null;
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
    remoteStream: null,
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
  return JSON.stringify({ type, payload });
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

function parseTransportMessage(rawMessage) {
  if (typeof rawMessage !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(rawMessage);
    if (!parsed || typeof parsed !== "object" || !isNonEmptyString(parsed.type)) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
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
    assembly = { chunks: [], finalIndex: null };
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

function postPortMessage(message) {
  if (!controlPort) {
    return;
  }

  try {
    controlPort.postMessage(message);
  } catch (error) {
    // Ignore parent messaging failures.
  }
}

function postTransportEvent(event) {
  postPortMessage({ type: "transport-event", event });
}

function postVideoState(runtime, active, width = 0, height = 0) {
  postPortMessage({
    type: "video-state",
    sessionId: runtime && runtime.sessionId ? runtime.sessionId : "",
    active: Boolean(active),
    width: Number.isFinite(Number(width)) ? Math.max(0, Math.trunc(Number(width))) : 0,
    height: Number.isFinite(Number(height)) ? Math.max(0, Math.trunc(Number(height))) : 0
  });
}

function ensureViewerElements() {
  return {
    video: document.getElementById("viewer-video"),
    placeholder: document.getElementById("viewer-placeholder")
  };
}

function setViewerPlaceholder(text) {
  const elements = ensureViewerElements();
  if (!elements.placeholder) {
    return;
  }

  elements.placeholder.hidden = false;
  elements.placeholder.textContent = text;
}

function setViewerVideoVisibility(visible) {
  const elements = ensureViewerElements();
  if (!elements.video || !elements.placeholder) {
    return;
  }

  elements.video.hidden = !visible;
  elements.placeholder.hidden = visible;
}

function detachRemoteStream() {
  const elements = ensureViewerElements();
  if (!elements.video) {
    return;
  }

  try {
    elements.video.pause();
  } catch (error) {
    // Ignore media pause races.
  }

  elements.video.hidden = true;
  elements.video.onloadedmetadata = null;
  elements.video.onresize = null;
  elements.video.srcObject = null;
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
  detachRemoteStream();

  runtime.dataChannels.clear();
  runtime.peerConnection = null;
  runtime.pendingIceCandidates = [];
  runtime.signalingSocket = null;
  runtime.remoteStream = null;
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

function sendResponse(requestId, response) {
  postPortMessage({ type: "response", requestId, response });
}

function attachRemoteStream(runtime, streamLike, track = null) {
  const elements = ensureViewerElements();
  if (!elements.video) {
    return;
  }

  const stream = streamLike && typeof streamLike.getTracks === "function"
    ? streamLike
    : track
      ? new MediaStream([track])
      : null;
  if (!stream) {
    return;
  }

  runtime.remoteStream = stream;
  if (elements.video.srcObject !== stream) {
    elements.video.srcObject = stream;
  }

  const syncVideoState = () => {
    const width = Number(elements.video.videoWidth) || 0;
    const height = Number(elements.video.videoHeight) || 0;
    const active = Boolean(width && height);
    if (active) {
      setViewerVideoVisibility(true);
      postVideoState(runtime, true, width, height);
    } else {
      setViewerPlaceholder("Connected. Waiting for the live remote surface...");
      setViewerVideoVisibility(false);
      postVideoState(runtime, false, 0, 0);
    }
  };

  elements.video.onloadedmetadata = () => {
    syncVideoState();
    void elements.video.play().catch(() => {
      // Ignore autoplay restrictions for muted inline playback.
    });
  };
  elements.video.onresize = syncVideoState;
  syncVideoState();

  if (track && typeof track.addEventListener === "function") {
    track.addEventListener("ended", () => {
      const currentRuntime = getTransportRuntime(runtime.sessionId);
      if (!currentRuntime || currentRuntime.shuttingDown) {
        return;
      }

      setViewerPlaceholder("Remote video track ended.");
      setViewerVideoVisibility(false);
      postVideoState(currentRuntime, false, 0, 0);
    });
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
    const currentRuntime = getTransportRuntime(runtime.sessionId);
    if (!currentRuntime || currentRuntime.shuttingDown) {
      return;
    }

    if (getDataChannel(currentRuntime, normalizedChannelKey) !== channel) {
      return;
    }

    updateDataChannelDiagnostics(currentRuntime, channel, normalizedChannelKey);
    handleFatalTransportError(runtime.sessionId, formatTransportError(currentRuntime, "Remote support data channel closed"));
  };

  channel.onerror = () => {
    const currentRuntime = getTransportRuntime(runtime.sessionId);
    if (!currentRuntime || currentRuntime.shuttingDown) {
      return;
    }

    if (getDataChannel(currentRuntime, normalizedChannelKey) !== channel) {
      return;
    }

    updateDataChannelDiagnostics(currentRuntime, channel, normalizedChannelKey);
    handleFatalTransportError(runtime.sessionId, formatTransportError(currentRuntime, "Remote support data channel failed"));
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
    throw new Error("WebRTC is unavailable in the support viewer");
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

    sendSignal(runtime, "ice", { candidate: event.candidate });
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

  peerConnection.ontrack = (event) => {
    if (!event) {
      return;
    }

    const track = event.track || null;
    const stream = Array.isArray(event.streams) && event.streams[0]
      ? event.streams[0]
      : track
        ? new MediaStream([track])
        : null;
    if (!stream) {
      return;
    }

    attachRemoteStream(runtime, stream, track);
  };

  if (typeof peerConnection.addTransceiver === "function") {
    try {
      peerConnection.addTransceiver("video", { direction: "recvonly" });
    } catch (error) {
      // Ignore negotiation mismatches if Chrome adjusts the offer shape automatically.
    }
  }

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

  if (!runtime || !dataChannel || dataChannel.readyState !== "open") {
    return false;
  }

  const bufferedAmount = Number(dataChannel.bufferedAmount);
  if (Number.isFinite(bufferedAmount) && bufferedAmount >= REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES) {
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
      if (Number.isFinite(nextBufferedAmount) && nextBufferedAmount >= REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES) {
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
  if (activeRuntime === runtime) {
    activeRuntime = null;
  }
  runtime.shuttingDown = false;

  postVideoState(runtime, false, 0, 0);
  setViewerPlaceholder(reason || "Waiting for the live remote surface...");

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
    sendSignal(runtime, "offer", { description: offer });
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

      if (message.type !== "signal") {
        return;
      }

      const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
      if (payload.sessionId && payload.sessionId !== runtime.sessionId) {
        return;
      }

      const activePeerConnection = await ensurePeerConnection(runtime, offerer);
      const signalType = typeof payload.signalType === "string" ? payload.signalType : "";
      if (signalType === "offer") {
        if (!payload.description) {
          throw new Error("Missing remote offer description");
        }

        await activePeerConnection.setRemoteDescription(payload.description);
        updatePeerConnectionDiagnostics(runtime, activePeerConnection);
        await flushPendingIceCandidates(runtime, activePeerConnection);

        const answer = await activePeerConnection.createAnswer();
        await activePeerConnection.setLocalDescription(answer);
        updatePeerConnectionDiagnostics(runtime, activePeerConnection);

        sendSignal(runtime, "answer", {
          description: answer,
          sessionId: payload.sessionId || runtime.sessionId
        });
        return;
      }

      if (signalType === "answer") {
        if (!payload.description) {
          throw new Error("Missing remote answer description");
        }

        await activePeerConnection.setRemoteDescription(payload.description);
        updatePeerConnectionDiagnostics(runtime, activePeerConnection);
        await flushPendingIceCandidates(runtime, activePeerConnection);
        return;
      }

      if (signalType === "ice") {
        if (!payload.candidate) {
          return;
        }

        if (!hasRemoteDescription(activePeerConnection)) {
          runtime.pendingIceCandidates.push(payload.candidate);
          return;
        }

        await activePeerConnection.addIceCandidate(payload.candidate);
        return;
      }
    } catch (error) {
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
  if (session.role !== "supporter") {
    throw new Error("Remote support viewer only supports the supporter role");
  }
  if (!isNonEmptyString(session.wsUrl)) {
    throw new Error("Missing remote support signaling url");
  }

  const iceServers = normalizeIceServers(session.iceServers);
  if (!iceServers.length) {
    throw new Error("Missing remote support ICE servers");
  }

  const dataChannelDescriptors = normalizeDataChannelDescriptors(session.dataChannels);
  const existingRuntime = getTransportRuntime(session.sessionId);
  if (existingRuntime && haveMatchingTransportConfig(existingRuntime, session, iceServers, dataChannelDescriptors)) {
    return;
  }

  if (activeRuntime) {
    await shutdownTransport(activeRuntime.sessionId, "Session restarted");
  }

  const runtime = createTransportRuntime({
    ...session,
    iceServers,
    dataChannels: dataChannelDescriptors
  });
  activeRuntime = runtime;
  setViewerPlaceholder("Connecting to the remote page...");

  void connectSignalingSocket(runtime).catch((error) => {
    handleFatalTransportError(runtime.sessionId, error);
  });
}

function handleControlRequest(message, requestId) {
  if (!message || typeof message !== "object") {
    sendResponse(requestId, { ok: false, error: "Invalid viewer request" });
    return;
  }

  if (message.requestType === "remoteSupportTransportStart") {
    startTransport(message.session)
      .then(() => {
        sendResponse(requestId, { ok: true });
      })
      .catch((error) => {
        sendResponse(requestId, {
          ok: false,
          error: normalizeErrorMessage(error, "Failed to start remote support transport")
        });
      });
    return;
  }

  if (message.requestType === "remoteSupportTransportStop") {
    const sessionId = isNonEmptyString(message.sessionId)
      ? message.sessionId.trim()
      : (activeRuntime ? activeRuntime.sessionId : "");
    shutdownTransport(sessionId, isNonEmptyString(message.reason) ? message.reason : "Session ended")
      .then(() => {
        sendResponse(requestId, { ok: true });
      })
      .catch((error) => {
        sendResponse(requestId, {
          ok: false,
          error: normalizeErrorMessage(error, "Failed to stop remote support transport")
        });
      });
    return;
  }

  if (message.requestType === "remoteSupportTransportSendData") {
    const runtime = getTransportRuntime(message.sessionId);
    if (!runtime) {
      sendResponse(requestId, { ok: false });
      return;
    }

    sendResponse(requestId, {
      ok: sendDataMessage(runtime, message.messageType, message.payload, message.channelKey)
    });
    return;
  }

  sendResponse(requestId, { ok: false, error: "Unknown viewer request" });
}

function attachControlPort(port) {
  controlPort = port;
  controlPort.onmessage = (event) => {
    const message = event && event.data && typeof event.data === "object" ? event.data : null;
    if (!message || message.type !== "request") {
      return;
    }

    handleControlRequest(message, typeof message.requestId === "string" ? message.requestId : "");
  };

  if (typeof controlPort.start === "function") {
    controlPort.start();
  }

  postPortMessage({ type: "ready" });
  if (activeRuntime && activeRuntime.remoteStream) {
    const elements = ensureViewerElements();
    postVideoState(activeRuntime, Boolean(elements.video && elements.video.videoWidth && elements.video.videoHeight), elements.video && elements.video.videoWidth, elements.video && elements.video.videoHeight);
  }
}

window.addEventListener("message", (event) => {
  if (controlPort || !event || event.source !== window.parent) {
    return;
  }

  const message = event.data && typeof event.data === "object" ? event.data : null;
  if (!message || message.type !== "unfluffify:remote-support-viewer-init") {
    return;
  }

  const port = event.ports && event.ports[0];
  if (!port) {
    return;
  }

  attachControlPort(port);
});

window.addEventListener("beforeunload", () => {
  if (!activeRuntime) {
    return;
  }

  shutdownTransport(activeRuntime.sessionId, "Support viewer closed", { notifyBackground: true }).then();
});