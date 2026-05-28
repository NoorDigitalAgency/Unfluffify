import {
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR,
  REMOTE_SUPPORT_DATA_CHANNEL_LABEL_DEFAULT,
  REMOTE_SUPPORT_PORT_TRANSPORT
} from "./common/remote-support.js";

const REMOTE_SUPPORT_TRANSPORT_TARGET = "remoteSupportOffscreen";
const REMOTE_SUPPORT_CHUNK_MESSAGE_TYPE = "__remoteSupportChunk";
const REMOTE_SUPPORT_FALLBACK_MAX_MESSAGE_SIZE_BYTES = 64 * 1024;
const REMOTE_SUPPORT_SIDEBAR_STREAM_CHANNEL_NAME = "unfluffify-remote-support-sidebar-stream";
const REMOTE_SUPPORT_SIDEBAR_DEFAULT_WIDTH = 420;
const REMOTE_SUPPORT_SIDEBAR_DEFAULT_HEIGHT = 760;
const REMOTE_SUPPORT_SESSION_END_GRACE_MS = 400;
const REMOTE_SUPPORT_VIDEO_MAX_FRAME_RATE = 60;
const REMOTE_SUPPORT_CAMERA_PREVIEW_MAX_WIDTH = 200;
const REMOTE_SUPPORT_CAMERA_PREVIEW_MAX_HEIGHT = 112;
const REMOTE_SUPPORT_CAMERA_PREVIEW_INTERVAL_MS = 700;

const transportSessions = new Map();
const dataChannelTextEncoder = new TextEncoder();

let keepAlivePort = null;
let keepAliveReconnectTimer = 0;
let nextChunkTransferId = 0;
let sidebarStreamChannel = null;

function normalizeTabId(value) {
  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) ? Math.trunc(normalizedValue) : null;
}

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

function normalizeMediaStreamId(value) {
  return isNonEmptyString(value) ? value.trim() : "";
}

function normalizeCaptureSource(value) {
  return value === "display" || value === "tab" || value === "screen" ? value : "display";
}

function normalizeBooleanFlag(value) {
  return value === true;
}

function normalizeTransportStateValue(value) {
  return isNonEmptyString(value) ? value.trim() : "";
}

function ensureSidebarStreamChannel() {
  if (sidebarStreamChannel || typeof BroadcastChannel !== "function") {
    return sidebarStreamChannel;
  }

  sidebarStreamChannel = new BroadcastChannel(REMOTE_SUPPORT_SIDEBAR_STREAM_CHANNEL_NAME);
  sidebarStreamChannel.onmessage = (event) => {
    handleSidebarStreamMessage(event && event.data);
  };
  return sidebarStreamChannel;
}

function postSidebarStreamMessage(message) {
  const channel = ensureSidebarStreamChannel();
  if (!channel) {
    return;
  }

  try {
    channel.postMessage(message);
  } catch (error) {
    // Ignore local sidebar mirror messaging failures.
  }
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

function getRequesterRuntimeByTabId(tabId) {
  const normalizedTabId = normalizeTabId(tabId);
  if (normalizedTabId === null) {
    return null;
  }

  for (const runtime of transportSessions.values()) {
    if (runtime.role === "requester" && runtime.tabId === normalizedTabId) {
      return runtime;
    }
  }

  return null;
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

  if (runtime.mediaStreamId !== normalizeMediaStreamId(session.mediaStreamId || session.fallbackMediaStreamId)) {
    return false;
  }

  if (runtime.captureSource !== normalizeCaptureSource(session.captureSource)) {
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
    tabId: normalizeTabId(session.tabId),
    wsUrl: session.wsUrl.trim(),
    mediaStreamId: normalizeMediaStreamId(session.mediaStreamId || session.fallbackMediaStreamId),
    captureSource: normalizeCaptureSource(session.captureSource),
    canRequestAudioTrack: normalizeBooleanFlag(session.canRequestAudioTrack),
    iceServers: normalizeIceServers(session.iceServers),
    dataChannelDescriptors: normalizeDataChannelDescriptors(session.dataChannels),
    pendingIceCandidates: [],
    signalingSocket: null,
    peerConnection: null,
    localCaptureStream: null,
    localCaptureTrack: null,
    localCameraStream: null,
    remoteCameraStream: null,
    localCameraPreviewEl: null,
    remoteCameraPreviewEl: null,
    popupPreviewLoopActive: false,
    sidebarCaptureCanvas: null,
    sidebarCaptureContext: null,
    sidebarCaptureStream: null,
    sidebarCaptureTrack: null,
    sidebarCaptureWidth: 0,
    sidebarCaptureHeight: 0,
    sidebarFrameVersion: 0,
    dataChannels: new Map(),
    dataChannelBindingIds: new Map(),
    nextDataChannelBindingId: 0,
    pendingFatalTransportTimer: 0,
    pendingFatalTransportReason: "",
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

function getFirstTrack(stream, kind) {
  if (!stream || typeof stream.getTracks !== "function") {
    return null;
  }

  return stream.getTracks().find((track) => track && track.kind === kind) || null;
}

function getRequesterMediaState(runtime) {
  const cameraTrack = getFirstTrack(runtime && runtime.localCameraStream, "video");
  const microphoneTrack = getFirstTrack(runtime && runtime.localCameraStream, "audio");
  const soundTrack = getFirstTrack(runtime && runtime.localCaptureStream, "audio");

  return {
    cameraAvailable: Boolean(cameraTrack),
    cameraEnabled: Boolean(cameraTrack && cameraTrack.enabled !== false),
    microphoneAvailable: Boolean(microphoneTrack),
    microphoneEnabled: Boolean(microphoneTrack && microphoneTrack.enabled !== false),
    soundAvailable: Boolean(soundTrack),
    soundEnabled: Boolean(soundTrack && soundTrack.enabled !== false)
  };
}

function postRequesterMediaState(runtime) {
  if (!runtime || runtime.role !== "requester") {
    return;
  }

  postTransportEvent({
    type: "media-state",
    sessionId: runtime.sessionId,
    mediaState: getRequesterMediaState(runtime)
  });
}

function setRequesterMediaTrackEnabled(runtime, control, enabled) {
  if (!runtime || runtime.role !== "requester") {
    return getRequesterMediaState(runtime);
  }

  const nextEnabled = Boolean(enabled);
  let track = null;
  if (control === "camera") {
    track = getFirstTrack(runtime.localCameraStream, "video");
  } else if (control === "microphone") {
    track = getFirstTrack(runtime.localCameraStream, "audio");
  } else if (control === "sound") {
    track = getFirstTrack(runtime.localCaptureStream, "audio");
  }

  if (track) {
    track.enabled = nextEnabled;
  }

  return getRequesterMediaState(runtime);
}

function createCameraPreviewVideo(stream) {
  if (!stream || typeof document === "undefined") {
    return null;
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  return video;
}

async function captureStreamBitmap(videoElement) {
  if (!videoElement || !videoElement.srcObject || typeof createImageBitmap !== "function") {
    return null;
  }
  const track = getFirstTrack(videoElement.srcObject, "video");
  if (!track || track.readyState === "ended") {
    return null;
  }
  try {
    const origWidth = videoElement.videoWidth || REMOTE_SUPPORT_CAMERA_PREVIEW_MAX_WIDTH;
    const origHeight = videoElement.videoHeight || REMOTE_SUPPORT_CAMERA_PREVIEW_MAX_HEIGHT;
    const scale = Math.min(
      REMOTE_SUPPORT_CAMERA_PREVIEW_MAX_WIDTH / origWidth,
      REMOTE_SUPPORT_CAMERA_PREVIEW_MAX_HEIGHT / origHeight
    );
    const resizeWidth = Math.max(1, Math.round(origWidth * scale));
    const resizeHeight = Math.max(1, Math.round(origHeight * scale));
    return await createImageBitmap(videoElement, { resizeWidth, resizeHeight, resizeQuality: "medium" });
  } catch {
    return null;
  }
}

function postRequesterPopupMediaPreview(runtime, {
  localCameraBitmap = null,
  remoteCameraBitmap = null
} = {}) {
  if (!runtime || runtime.role !== "requester" || typeof BroadcastChannel !== "function") {
    return;
  }

  try {
    const channel = new BroadcastChannel("unfluffify-remote-support-popup-media");
    channel.postMessage({
      tabId: runtime.tabId,
      sessionId: runtime.sessionId,
      localCameraBitmap,
      remoteCameraBitmap
    });
    channel.close();
  } catch (error) {
    // Ignore preview publication failures.
  }
}

function stopRequesterPopupMediaPreview(runtime) {
  if (!runtime) {
    return;
  }
  runtime.popupPreviewLoopActive = false;
  postRequesterPopupMediaPreview(runtime, {});
}

function schedulePopupPreviewTick(runtime) {
  window.setTimeout(async () => {
    if (!runtime.popupPreviewLoopActive) {
      return;
    }
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (!activeRuntime || activeRuntime.shuttingDown) {
      stopRequesterPopupMediaPreview(runtime);
      return;
    }
    const [localCameraBitmap, remoteCameraBitmap] = await Promise.all([
      captureStreamBitmap(activeRuntime.localCameraPreviewEl),
      captureStreamBitmap(activeRuntime.remoteCameraPreviewEl)
    ]);
    postRequesterPopupMediaPreview(activeRuntime, { localCameraBitmap, remoteCameraBitmap });
    localCameraBitmap?.close();
    remoteCameraBitmap?.close();
    if (runtime.popupPreviewLoopActive) {
      schedulePopupPreviewTick(runtime);
    }
  }, REMOTE_SUPPORT_CAMERA_PREVIEW_INTERVAL_MS);
}

function startRequesterPopupMediaPreview(runtime) {
  if (
    !runtime ||
    runtime.role !== "requester" ||
    runtime.popupPreviewLoopActive ||
    typeof BroadcastChannel !== "function" ||
    typeof document === "undefined"
  ) {
    return;
  }

  runtime.popupPreviewLoopActive = true;
  schedulePopupPreviewTick(runtime);
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

function clearDataChannelHandlers(channel) {
  if (!channel) {
    return;
  }

  channel.onopen = null;
  channel.onclose = null;
  channel.onerror = null;
  channel.onmessage = null;
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

function stopLocalCaptureStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") {
    return;
  }

  for (const track of stream.getTracks()) {
    if (!track || typeof track.stop !== "function") {
      continue;
    }

    try {
      track.stop();
    } catch (error) {
      // Ignore media track shutdown races.
    }
  }
}

function configureLowLatencyVideoTrack(track) {
  if (!track || !("contentHint" in track)) {
    return;
  }

  try {
    track.contentHint = "motion";
  } catch (error) {
    // Ignore contentHint support mismatches.
  }
}

function configureLowLatencyVideoSender(sender) {
  if (
    !sender ||
    typeof sender.getParameters !== "function" ||
    typeof sender.setParameters !== "function"
  ) {
    return;
  }

  try {
    const parameters = sender.getParameters() || {};
    parameters.degradationPreference = "maintain-framerate";
    const setParametersResult = sender.setParameters(parameters);
    if (setParametersResult && typeof setParametersResult.catch === "function") {
      void setParametersResult.catch(() => {});
    }
  } catch (error) {
    // Ignore sender parameter mismatches in older WebRTC implementations.
  }
}

function clearRequesterSidebarCaptureSurface(runtime) {
  if (!runtime || !runtime.sidebarCaptureCanvas || !runtime.sidebarCaptureContext) {
    return;
  }

  runtime.sidebarCaptureContext.fillStyle = "#04080f";
  runtime.sidebarCaptureContext.fillRect(
    0,
    0,
    runtime.sidebarCaptureCanvas.width,
    runtime.sidebarCaptureCanvas.height
  );
}

function setRequesterSidebarCaptureSize(runtime, width, height) {
  if (!runtime || !runtime.sidebarCaptureCanvas || !runtime.sidebarCaptureContext) {
    return;
  }

  const nextWidth = Math.max(1, Math.trunc(Number(width) || REMOTE_SUPPORT_SIDEBAR_DEFAULT_WIDTH));
  const nextHeight = Math.max(1, Math.trunc(Number(height) || REMOTE_SUPPORT_SIDEBAR_DEFAULT_HEIGHT));
  if (
    runtime.sidebarCaptureCanvas.width === nextWidth &&
    runtime.sidebarCaptureCanvas.height === nextHeight
  ) {
    return;
  }

  runtime.sidebarCaptureCanvas.width = nextWidth;
  runtime.sidebarCaptureCanvas.height = nextHeight;
  runtime.sidebarCaptureWidth = nextWidth;
  runtime.sidebarCaptureHeight = nextHeight;
  clearRequesterSidebarCaptureSurface(runtime);
}

async function ensureRequesterSidebarVideoTrack(runtime, peerConnection) {
  if (
    !runtime ||
    runtime.role !== "requester" ||
    runtime.sidebarCaptureTrack
  ) {
    return;
  }

  if (typeof document !== "object" || typeof document.createElement !== "function") {
    return;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || typeof canvas.captureStream !== "function") {
    return;
  }

  runtime.sidebarCaptureCanvas = canvas;
  runtime.sidebarCaptureContext = context;
  setRequesterSidebarCaptureSize(runtime, REMOTE_SUPPORT_SIDEBAR_DEFAULT_WIDTH, REMOTE_SUPPORT_SIDEBAR_DEFAULT_HEIGHT);

  const stream = canvas.captureStream();
  const track = stream && typeof stream.getVideoTracks === "function"
    ? stream.getVideoTracks()[0]
    : null;
  if (!track) {
    stopLocalCaptureStream(stream);
    runtime.sidebarCaptureCanvas = null;
    runtime.sidebarCaptureContext = null;
    return;
  }

  configureLowLatencyVideoTrack(track);

  runtime.sidebarCaptureStream = stream;
  runtime.sidebarCaptureTrack = track;
  clearRequesterSidebarCaptureSurface(runtime);

  if (typeof peerConnection.addTrack === "function") {
    configureLowLatencyVideoSender(peerConnection.addTrack(track, stream));
  }
}

function isImageBitmapLike(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.close === "function"
  );
}

function isBlobLike(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
  );
}

function closeFrameSource(source) {
  if (!source || typeof source.close !== "function") {
    return;
  }

  try {
    source.close();
  } catch (error) {
    // Ignore decoded frame cleanup mismatches.
  }
}

async function createRequesterSidebarFrameSource(frame) {
  if (!frame || typeof frame !== "object") {
    return null;
  }

  if (isImageBitmapLike(frame.bitmap)) {
    return frame.bitmap;
  }

  if (isBlobLike(frame.blob) && typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(frame.blob);
    } catch (error) {
      return null;
    }
  }

  if (!isNonEmptyString(frame.dataUrl) || typeof Image !== "function") {
    return null;
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      resolve(null);
    };
    image.src = frame.dataUrl;
  });
}

async function drawRequesterSidebarFrame(runtime, frame, width, height) {
  if (!runtime || !runtime.sidebarCaptureCanvas || !runtime.sidebarCaptureContext || !frame || typeof frame !== "object") {
    return;
  }

  setRequesterSidebarCaptureSize(runtime, width, height);
  const currentFrameVersion = (runtime.sidebarFrameVersion += 1);
  const source = await createRequesterSidebarFrameSource(frame);
  if (!source) {
    return;
  }

  try {
    if (runtime.sidebarFrameVersion !== currentFrameVersion || !runtime.sidebarCaptureContext || !runtime.sidebarCaptureCanvas) {
      return;
    }

    runtime.sidebarCaptureContext.clearRect(
      0,
      0,
      runtime.sidebarCaptureCanvas.width,
      runtime.sidebarCaptureCanvas.height
    );
    runtime.sidebarCaptureContext.drawImage(
      source,
      0,
      0,
      runtime.sidebarCaptureCanvas.width,
      runtime.sidebarCaptureCanvas.height
    );
    if (runtime.sidebarCaptureTrack && typeof runtime.sidebarCaptureTrack.requestFrame === "function") {
      runtime.sidebarCaptureTrack.requestFrame();
    }
  } finally {
    closeFrameSource(source);
  }
}

function handleRequesterSidebarMirrorCommand(runtime, command) {
  if (!runtime || runtime.tabId === null || !command || typeof command !== "object") {
    return;
  }

  postSidebarStreamMessage({
    type: "command",
    tabId: runtime.tabId,
    command
  });
}

function handleSidebarStreamMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  const runtime = getRequesterRuntimeByTabId(message.tabId);
  if (!runtime) {
    return;
  }

  if (message.type === "frame") {
    void drawRequesterSidebarFrame(runtime, message, message.width, message.height);
  }
}

function clearPendingFatalTransport(runtime) {
  if (!runtime || !runtime.pendingFatalTransportTimer) {
    return;
  }

  window.clearTimeout(runtime.pendingFatalTransportTimer);
  runtime.pendingFatalTransportTimer = 0;
  runtime.pendingFatalTransportReason = "";
}

function shouldAwaitSessionEnded(runtime) {
  return Boolean(
    runtime &&
    runtime.signalingSocket &&
    runtime.signalingSocket.readyState === WebSocket.OPEN
  );
}

function scheduleFatalTransportError(sessionId, error, options = {}) {
  const runtime = getTransportRuntime(sessionId);
  if (!runtime || runtime.shuttingDown) {
    return;
  }

  const reason = normalizeErrorMessage(error, "Remote support transport failed");
  const allowGrace = Boolean(options.allowGrace);
  if (!allowGrace || !shouldAwaitSessionEnded(runtime)) {
    handleFatalTransportError(sessionId, reason);
    return;
  }

  if (
    runtime.pendingFatalTransportTimer &&
    runtime.pendingFatalTransportReason === reason
  ) {
    return;
  }

  clearPendingFatalTransport(runtime);
  runtime.pendingFatalTransportReason = reason;
  runtime.pendingFatalTransportTimer = window.setTimeout(() => {
    const activeRuntime = getTransportRuntime(sessionId);
    if (!activeRuntime || activeRuntime.shuttingDown) {
      return;
    }

    activeRuntime.pendingFatalTransportTimer = 0;
    activeRuntime.pendingFatalTransportReason = "";
    handleFatalTransportError(sessionId, reason);
  }, REMOTE_SUPPORT_SESSION_END_GRACE_MS);
}

function resetTransportResources(runtime) {
  if (!runtime) {
    return;
  }

  clearPendingFatalTransport(runtime);

  for (const channel of runtime.dataChannels.values()) {
    closeDataChannel(channel);
  }
  closePeerConnection(runtime.peerConnection);
  closeSignalingSocket(runtime.signalingSocket);
  stopLocalCaptureStream(runtime.localCaptureStream);
  stopLocalCaptureStream(runtime.localCameraStream);
  stopLocalCaptureStream(runtime.remoteCameraStream);
  stopLocalCaptureStream(runtime.sidebarCaptureStream);
  stopRequesterPopupMediaPreview(runtime);

  runtime.dataChannels.clear();
  runtime.dataChannelBindingIds.clear();
  runtime.peerConnection = null;
  runtime.pendingIceCandidates = [];
  runtime.signalingSocket = null;
  runtime.localCaptureStream = null;
  runtime.localCaptureTrack = null;
  runtime.localCameraStream = null;
  runtime.remoteCameraStream = null;
  runtime.localCameraPreviewEl = null;
  runtime.remoteCameraPreviewEl = null;
  runtime.popupPreviewLoopActive = false;
  runtime.sidebarCaptureCanvas = null;
  runtime.sidebarCaptureContext = null;
  runtime.sidebarCaptureStream = null;
  runtime.sidebarCaptureTrack = null;
  runtime.sidebarCaptureWidth = 0;
  runtime.sidebarCaptureHeight = 0;
  runtime.sidebarFrameVersion = 0;
  runtime.nextDataChannelBindingId = 0;
  runtime.pendingFatalTransportTimer = 0;
  runtime.pendingFatalTransportReason = "";
  runtime.lastIceCandidateError = "";
  runtime.chunkAssemblies.clear();

  postRequesterMediaState(runtime);
}

async function ensureRequesterDisplayTrack(runtime, peerConnection) {
  if (!runtime || runtime.role !== "requester" || runtime.localCaptureStream) {
    return;
  }

  if (!globalThis.navigator || !navigator.mediaDevices) {
    throw new Error("Remote support screen sharing is unavailable");
  }

  let stream = null;
  if (runtime.mediaStreamId && typeof navigator.mediaDevices.getUserMedia === "function") {
    const chromeMediaSource = runtime.captureSource === "tab" ? "tab" : "desktop";
    stream = await navigator.mediaDevices.getUserMedia({
      audio: runtime.canRequestAudioTrack
        ? {
            mandatory: {
              chromeMediaSource,
              chromeMediaSourceId: runtime.mediaStreamId
            }
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource,
          chromeMediaSourceId: runtime.mediaStreamId,
          maxFrameRate: REMOTE_SUPPORT_VIDEO_MAX_FRAME_RATE
        }
      }
    });
  } else if (typeof navigator.mediaDevices.getDisplayMedia === "function") {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "monitor",
        frameRate: { ideal: REMOTE_SUPPORT_VIDEO_MAX_FRAME_RATE, max: REMOTE_SUPPORT_VIDEO_MAX_FRAME_RATE }
      },
      audio: true,
      monitorTypeSurfaces: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude"
    });
  } else {
    throw new Error("Remote support screen sharing is unavailable");
  }

  const track = stream && typeof stream.getVideoTracks === "function" ? stream.getVideoTracks()[0] : null;
  if (!track) {
    stopLocalCaptureStream(stream);
    throw new Error("Remote support screen sharing did not provide a video track");
  }

  configureLowLatencyVideoTrack(track);
  runtime.localCaptureStream = stream;
  runtime.localCaptureTrack = track;
  postRequesterMediaState(runtime);

  if (typeof track.addEventListener === "function") {
    track.addEventListener("ended", () => {
      const activeRuntime = getTransportRuntime(runtime.sessionId);
      if (!activeRuntime || activeRuntime.shuttingDown || activeRuntime.localCaptureTrack !== track) {
        return;
      }
      postRequesterMediaState(activeRuntime);
      handleFatalTransportError(runtime.sessionId, formatTransportError(activeRuntime, "Remote support screen sharing ended"));
    });
  }

  if (typeof peerConnection.addTrack === "function") {
    for (const mediaTrack of stream.getTracks()) {
      configureLowLatencyVideoSender(peerConnection.addTrack(mediaTrack, stream));
    }
  }
}

async function ensureLocalCameraAndMicTracks(runtime, peerConnection) {
  if (!runtime || runtime.localCameraStream || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    runtime.localCameraStream = stream;
    runtime.localCameraPreviewEl = createCameraPreviewVideo(stream);
    postRequesterMediaState(runtime);
    startRequesterPopupMediaPreview(runtime);
    if (typeof peerConnection.addTrack === "function") {
      for (const track of stream.getTracks()) {
        configureLowLatencyVideoSender(peerConnection.addTrack(track, stream));
      }
    }
  } catch (error) {
    postRequesterMediaState(runtime);
    postTransportEvent({
      type: "media-warning",
      sessionId: runtime.sessionId,
      error: "Camera or microphone was not shared; continuing with screen sharing only"
    });
  }
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

function sendSessionEnded(runtime, reason = "Session ended") {
  if (!runtime || !runtime.signalingSocket || runtime.signalingSocket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    runtime.signalingSocket.send(JSON.stringify({
      type: "session-ended",
      timestamp: Date.now(),
      payload: {
        sessionId: runtime.sessionId,
        role: runtime.role,
        reason: isNonEmptyString(reason) ? reason.trim() : "Session ended"
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
  const bindingId = (runtime.nextDataChannelBindingId += 1);
  const existingChannel = getDataChannel(runtime, normalizedChannelKey);
  runtime.dataChannels.set(normalizedChannelKey, channel);
  runtime.dataChannelBindingIds.set(normalizedChannelKey, bindingId);

  if (existingChannel && existingChannel !== channel) {
    clearDataChannelHandlers(existingChannel);
    closeDataChannel(existingChannel);
  }

  channel.binaryType = "arraybuffer";
  updateDataChannelDiagnostics(runtime, channel, normalizedChannelKey);

  channel.onopen = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (
      !activeRuntime ||
      activeRuntime.shuttingDown ||
      activeRuntime.dataChannelBindingIds.get(normalizedChannelKey) !== bindingId
    ) {
      return;
    }

    updateDataChannelDiagnostics(runtime, channel, normalizedChannelKey);
    postTransportEvent({
      type: "channel-open",
      sessionId: runtime.sessionId,
      channelKey: normalizedChannelKey
    });
  };

  channel.onclose = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (
      !activeRuntime ||
      activeRuntime.shuttingDown ||
      activeRuntime.dataChannelBindingIds.get(normalizedChannelKey) !== bindingId
    ) {
      return;
    }

    if (getDataChannel(activeRuntime, normalizedChannelKey) !== channel) {
      return;
    }

    updateDataChannelDiagnostics(activeRuntime, channel, normalizedChannelKey);
    scheduleFatalTransportError(
      runtime.sessionId,
      formatTransportError(activeRuntime, "Remote support data channel closed"),
      { allowGrace: true }
    );
  };

  channel.onerror = () => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (
      !activeRuntime ||
      activeRuntime.shuttingDown ||
      activeRuntime.dataChannelBindingIds.get(normalizedChannelKey) !== bindingId
    ) {
      return;
    }

    if (getDataChannel(activeRuntime, normalizedChannelKey) !== channel) {
      return;
    }

    updateDataChannelDiagnostics(activeRuntime, channel, normalizedChannelKey);
    scheduleFatalTransportError(
      runtime.sessionId,
      formatTransportError(activeRuntime, "Remote support data channel failed"),
      {
        allowGrace:
          channel.readyState === "closing" ||
          channel.readyState === "closed"
      }
    );
  };

  channel.onmessage = (event) => {
    const activeRuntime = getTransportRuntime(runtime.sessionId);
    if (
      !activeRuntime ||
      activeRuntime.shuttingDown ||
      activeRuntime.dataChannelBindingIds.get(normalizedChannelKey) !== bindingId
    ) {
      return;
    }

    const parsedMessage = parseTransportMessage(event && event.data);
    if (!parsedMessage) {
      return;
    }

    const message = consumeChunkedDataChannelMessage(runtime, parsedMessage);
    if (!message) {
      return;
    }

    if (
      runtime.role === "requester" &&
      normalizedChannelKey === REMOTE_SUPPORT_DATA_CHANNEL_KEY_SIDEBAR &&
      message.type === "command"
    ) {
      handleRequesterSidebarMirrorCommand(runtime, message.payload || {});
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

    if (peerConnection.connectionState === "failed") {
      scheduleFatalTransportError(
        runtime.sessionId,
        formatTransportError(runtime, "Peer connection closed")
      );
      return;
    }

    if (["disconnected", "closed"].includes(peerConnection.connectionState)) {
      scheduleFatalTransportError(
        runtime.sessionId,
        formatTransportError(runtime, "Peer connection closed"),
        { allowGrace: true }
      );
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

  peerConnection.ontrack = (event) => {
    if (!event || !event.track || runtime.role !== "requester") {
      return;
    }
    if (event.track.kind === "video") {
      runtime.remoteCameraStream = event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track]);
      runtime.remoteCameraPreviewEl = createCameraPreviewVideo(runtime.remoteCameraStream);
      startRequesterPopupMediaPreview(runtime);
    }
  };

  if (offerer && typeof peerConnection.addTransceiver === "function") {
    try {
      peerConnection.addTransceiver("audio", { direction: "recvonly" });
    } catch (error) {
      // Ignore transceiver negotiation mismatches in older test doubles.
    }
    for (let index = 0; index < 3; index += 1) {
      try {
        peerConnection.addTransceiver("video", { direction: "recvonly" });
      } catch (error) {
        // Ignore transceiver negotiation mismatches in older test doubles.
        break;
      }
    }
  }

  if (!offerer) {
    await ensureRequesterDisplayTrack(runtime, peerConnection);
    await ensureLocalCameraAndMicTracks(runtime, peerConnection);
    await ensureRequesterSidebarVideoTrack(runtime, peerConnection);
    startRequesterPopupMediaPreview(runtime);
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

  if (options.notifyPeer) {
    sendSessionEnded(runtime, reason);
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
  ensureSidebarStreamChannel();

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
      ? shutdownTransport(message.sessionId, isNonEmptyString(message.reason) ? message.reason : "Session ended", { notifyPeer: Boolean(message.notifyPeer) })
      : shutdownAllTransports(isNonEmptyString(message.reason) ? message.reason : "Session ended", { notifyPeer: Boolean(message.notifyPeer) });

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

  if (message.type === "remoteSupportTransportSetMediaState") {
    const runtime = getTransportRuntime(message.sessionId);
    if (!runtime) {
      sendResponse({ ok: false, mediaState: getRequesterMediaState(null) });
      return false;
    }

    const normalizedControl = typeof message.control === "string" ? message.control.trim() : "";
    if (!["camera", "microphone", "sound"].includes(normalizedControl)) {
      sendResponse({ ok: false, error: "Unsupported media control", mediaState: getRequesterMediaState(runtime) });
      return false;
    }

    const mediaState = setRequesterMediaTrackEnabled(runtime, normalizedControl, Boolean(message.enabled));
    postRequesterMediaState(runtime);
    sendResponse({ ok: true, mediaState });
    return false;
  }

  return false;
});

window.addEventListener("beforeunload", () => {
  shutdownAllTransports("Offscreen document closed").then();
});

connectKeepAlivePort();
