import {
  hasEstablishedRemoteSupportPeerTransport,
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_DATA_CHANNEL_KEY_DEFAULT,
  REMOTE_SUPPORT_DATA_CHANNEL_LABEL_DEFAULT,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED,
  REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED,
  REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP,
  REMOTE_SUPPORT_DOCK_STATE_FULLSCREEN_ACTIVE,
  normalizeRemoteSupportDockState
} from "./common/remote-support.js";

const REMOTE_SUPPORT_CHUNK_MESSAGE_TYPE = "__remoteSupportChunk";
const REMOTE_SUPPORT_FALLBACK_MAX_MESSAGE_SIZE_BYTES = 64 * 1024;
const REMOTE_SUPPORT_SESSION_END_GRACE_MS = 400;

const dataChannelTextEncoder = new TextEncoder();

let controlPort = null;
let activeRuntime = null;
let currentDockState = REMOTE_SUPPORT_DOCK_STATE_EMBEDDED;
let dockPiPWindow = null;
let pipClosingProgrammatically = false;
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
    remoteCameraStream: null,
    localCameraStream: null,
    remoteVideoSurfaceCount: 0,
    remoteAudioAttached: false,
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

function postPortMessage(message, transfer = []) {
  if (!controlPort) {
    return false;
  }

  try {
    controlPort.postMessage(message, transfer);
    return true;
  } catch (error) {
    // Ignore parent messaging failures.
  }

  return false;
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
    remoteCameraVideo: document.getElementById("remote-camera-video"),
    localCameraVideo: document.getElementById("local-camera-video"),
    remoteAudio: document.getElementById("remote-audio"),
    muteButton: document.getElementById("viewer-toggle-mute"),
    silentButton: document.getElementById("viewer-toggle-silent"),
    externalButton: document.getElementById("viewer-open-external"),
    endButton: document.getElementById("viewer-end-session"),
    placeholder: document.getElementById("viewer-placeholder")
  };
}

function applyToggleButtonState(button, active) {
  if (!button) {
    return;
  }

  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.classList.toggle("is-active", active);
}

function setMuteState(muted) {
  const stream = activeRuntime && activeRuntime.localCameraStream;
  if (stream && typeof stream.getAudioTracks === "function") {
    for (const track of stream.getAudioTracks()) {
      if (track) {
        track.enabled = !muted;
      }
    }
  }

  applyToggleButtonState(ensureViewerElements().muteButton, muted);
}

function setSilentState(silent) {
  const elements = ensureViewerElements();
  if (elements.remoteAudio) {
    elements.remoteAudio.muted = Boolean(silent);
  }

  applyToggleButtonState(elements.silentButton, Boolean(silent));
}

function applyDockState(dockState) {
  currentDockState = normalizeRemoteSupportDockState(dockState);
  document.body.dataset.dockState = currentDockState;
}

function syncDockPiPWindow() {
  if (!dockPiPWindow || dockPiPWindow.closed) {
    return;
  }
  const pipDocument = dockPiPWindow.document;
  const remoteCamera = pipDocument.getElementById("pip-remote-camera");
  const localCamera = pipDocument.getElementById("pip-local-camera");
  if (remoteCamera) {
    remoteCamera.srcObject = activeRuntime && activeRuntime.remoteCameraStream ? activeRuntime.remoteCameraStream : null;
  }
  if (localCamera) {
    localCamera.srcObject = activeRuntime && activeRuntime.localCameraStream ? activeRuntime.localCameraStream : null;
  }
}

async function persistDockState(dockState) {
  if (!activeRuntime || !globalThis.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
    return;
  }
  try {
    await chrome.runtime.sendMessage({
      type: "remoteSupportSetDockState",
      tabId: activeRuntime.tabId,
      sessionId: activeRuntime.sessionId,
      dockState
    });
  } catch (error) {
    // Ignore background reload races.
  }
}

async function openDockPiP() {
  if (!window.documentPictureInPicture || typeof window.documentPictureInPicture.requestWindow !== "function") {
    await setDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED);
    return false;
  }
  if (dockPiPWindow && !dockPiPWindow.closed) {
    syncDockPiPWindow();
    return true;
  }
  try {
    dockPiPWindow = await window.documentPictureInPicture.requestWindow({
      width: 360,
      height: 320
    });
    const pipDocument = dockPiPWindow.document;
    pipDocument.head.innerHTML = `
      <style>
        body{margin:0;padding:12px;background:#04080f;color:#dbe8ff;font:500 12px/1.4 system-ui,sans-serif}
        .dock{display:grid;gap:10px}
        .tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .tile{min-height:96px;overflow:hidden;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:#101a2b}
        video{width:100%;height:100%;display:block;object-fit:cover;background:#04080f}
        .actions{display:flex;flex-wrap:wrap;gap:8px}
        button{flex:1 1 0;min-height:30px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#101a2b;color:#fff}
        .danger{background:#7f1d2d}
        dl{display:grid;gap:6px;margin:0}
        dt{font-size:10px;text-transform:uppercase;color:#9eb4d2}
        dd{margin:0;font-size:12px}
      </style>
    `;
    pipDocument.body.innerHTML = `
      <div class="dock">
        <div class="tiles">
          <div class="tile"><video id="pip-remote-camera" autoplay playsinline muted></video></div>
          <div class="tile"><video id="pip-local-camera" autoplay playsinline muted></video></div>
        </div>
        <div class="actions">
          <button id="pip-mute">Mute</button>
          <button id="pip-silent">Silent</button>
          <button id="pip-end" class="danger">Terminate</button>
        </div>
      </div>
    `;
    pipDocument.getElementById("pip-mute").addEventListener("click", () => {
      ensureViewerElements().muteButton?.click();
    });
    pipDocument.getElementById("pip-silent").addEventListener("click", () => {
      ensureViewerElements().silentButton?.click();
    });
    pipDocument.getElementById("pip-end").addEventListener("click", () => {
      ensureViewerElements().endButton?.click();
    });
    dockPiPWindow.addEventListener("pagehide", () => {
      dockPiPWindow = null;
      if (!pipClosingProgrammatically) {
        setDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED).then();
      }
      pipClosingProgrammatically = false;
    }, { once: true });
    syncDockPiPWindow();
    return true;
  } catch (error) {
    dockPiPWindow = null;
    await setDockState(REMOTE_SUPPORT_DOCK_STATE_EMBEDDED_MINIMIZED);
    return false;
  }
}

async function setDockState(nextDockState, { persist = true } = {}) {
  const normalizedDockState = normalizeRemoteSupportDockState(nextDockState);
  applyDockState(normalizedDockState);
  if (normalizedDockState === REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP) {
    const pipOpened = await openDockPiP();
    if (!pipOpened) {
      return false;
    }
  } else if (dockPiPWindow && !dockPiPWindow.closed) {
    try {
      pipClosingProgrammatically = true;
      dockPiPWindow.close();
    } catch (error) {
      pipClosingProgrammatically = false;
    }
    dockPiPWindow = null;
  }
  if (persist) {
    await persistDockState(normalizedDockState);
  }
  return true;
}

function initializeViewerControls() {
  const elements = ensureViewerElements();
  if (elements.muteButton && elements.muteButton.dataset.ufInitialized !== "true") {
    elements.muteButton.dataset.ufInitialized = "true";
    elements.muteButton.addEventListener("click", () => {
      const nextMuted = elements.muteButton.getAttribute("aria-pressed") !== "true";
      setMuteState(nextMuted);
    });
  }

  if (elements.silentButton && elements.silentButton.dataset.ufInitialized !== "true") {
    elements.silentButton.dataset.ufInitialized = "true";
    elements.silentButton.addEventListener("click", () => {
      const nextSilent = elements.silentButton.getAttribute("aria-pressed") !== "true";
      setSilentState(nextSilent);
    });
  }

  if (elements.externalButton && elements.externalButton.dataset.ufInitialized !== "true") {
    elements.externalButton.dataset.ufInitialized = "true";
    elements.externalButton.addEventListener("click", () => {
      setDockState(REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP).then();
    });
  }

  if (elements.endButton && elements.endButton.dataset.ufInitialized !== "true") {
    elements.endButton.dataset.ufInitialized = "true";
    elements.endButton.addEventListener("click", () => {
      if (!activeRuntime) {
        return;
      }
      shutdownTransport(activeRuntime.sessionId, "Session ended", { notifyBackground: true }).then();
    });
  }

  setMuteState(false);
  setSilentState(false);
  applyDockState(currentDockState);
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
  if (elements.video) {
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

  if (elements.remoteCameraVideo) {
    try { elements.remoteCameraVideo.pause(); } catch (error) {}
    elements.remoteCameraVideo.hidden = true;
    elements.remoteCameraVideo.srcObject = null;
  }

  if (elements.localCameraVideo) {
    try { elements.localCameraVideo.pause(); } catch (error) {}
    elements.localCameraVideo.hidden = true;
    elements.localCameraVideo.srcObject = null;
  }

  if (elements.remoteAudio) {
    elements.remoteAudio.srcObject = null;
  }

  setSilentState(false);
  syncDockPiPWindow();
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
  detachRemoteStream();
  stopLocalMediaStream(runtime.localCameraStream);

  runtime.dataChannels.clear();
  runtime.peerConnection = null;
  runtime.pendingIceCandidates = [];
  runtime.signalingSocket = null;
  runtime.remoteStream = null;
  runtime.remoteCameraStream = null;
  runtime.localCameraStream = null;
  runtime.remoteVideoSurfaceCount = 0;
  runtime.remoteAudioAttached = false;
  runtime.pendingFatalTransportTimer = 0;
  runtime.pendingFatalTransportReason = "";
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

function sendResponse(requestId, response) {
  postPortMessage({ type: "response", requestId, response });
}


function stopLocalMediaStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") {
    return;
  }
  for (const track of stream.getTracks()) {
    if (track && typeof track.stop === "function") {
      try { track.stop(); } catch (error) {}
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
    const elements = ensureViewerElements();
    if (elements.localCameraVideo) {
      elements.localCameraVideo.srcObject = stream;
      elements.localCameraVideo.hidden = false;
      void elements.localCameraVideo.play().catch(() => {});
    }
    syncDockPiPWindow();
    setMuteState(elements.muteButton && elements.muteButton.getAttribute("aria-pressed") === "true");
    if (typeof peerConnection.addTrack === "function") {
      for (const track of stream.getTracks()) {
        peerConnection.addTrack(track, stream);
      }
    }
  } catch (error) {
    postTransportEvent({
      type: "media-warning",
      sessionId: runtime.sessionId,
      error: "Camera or microphone was not shared; continuing with receive-only guidance"
    });
  }
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

  if (track && track.kind === "audio") {
    runtime.remoteAudioAttached = true;
    if (elements.remoteAudio && elements.remoteAudio.srcObject !== stream) {
      elements.remoteAudio.srcObject = stream;
      elements.remoteAudio.muted = elements.silentButton && elements.silentButton.getAttribute("aria-pressed") === "true";
      void elements.remoteAudio.play().catch(() => {});
    }
    return;
  }

  const surfaceIndex = runtime.remoteVideoSurfaceCount;
  runtime.remoteVideoSurfaceCount += 1;

  if (surfaceIndex === 0) {
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
    return;
  }

  if (surfaceIndex === 1 && elements.remoteCameraVideo) {
    runtime.remoteCameraStream = stream;
    if (elements.remoteCameraVideo.srcObject !== stream) {
      elements.remoteCameraVideo.srcObject = stream;
    }
    elements.remoteCameraVideo.hidden = false;
    void elements.remoteCameraVideo.play().catch(() => {});
    syncDockPiPWindow();
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
    scheduleFatalTransportError(
      runtime.sessionId,
      formatTransportError(currentRuntime, "Remote support data channel closed"),
      { allowGrace: true }
    );
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
    scheduleFatalTransportError(
      runtime.sessionId,
      formatTransportError(currentRuntime, "Remote support data channel failed"),
      {
        allowGrace:
          channel.readyState === "closing" ||
          channel.readyState === "closed"
      }
    );
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
      peerConnection.addTransceiver("audio", { direction: "recvonly" });
    } catch (error) {
      // Ignore negotiation mismatches if Chrome adjusts the offer shape automatically.
    }
    for (let index = 0; index < 3; index += 1) {
      try {
        peerConnection.addTransceiver("video", { direction: "recvonly" });
      } catch (error) {
        // Ignore negotiation mismatches if Chrome adjusts the offer shape automatically.
        break;
      }
    }
  }

  if (offerer) {
    await ensureLocalCameraAndMicTracks(runtime, peerConnection);
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

  if (options.notifyPeer) {
    sendSessionEnded(runtime, reason);
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

      const closeError = formatTransportError(runtime, "Signaling channel closed");
      runtime.signalingSocket = null;
      if (hasEstablishedRemoteSupportPeerTransport(runtime)) {
        postTransportEvent({
          type: "transport-error",
          sessionId: runtime.sessionId,
          error: closeError
        });
        return;
      }

      handleFatalTransportError(runtime.sessionId, closeError);
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
  initializeViewerControls();
  setViewerPlaceholder("Connecting to the remote page...");
  setDockState(REMOTE_SUPPORT_DOCK_STATE_FLOATING_PIP).then();

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
    shutdownTransport(sessionId, isNonEmptyString(message.reason) ? message.reason : "Session ended", { notifyPeer: Boolean(message.notifyPeer) })
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

  if (message.requestType === "remoteSupportUpdateDockState") {
    setDockState(message.dockState, { persist: false })
      .then(() => {
        sendResponse(requestId, { ok: true });
      })
      .catch((error) => {
        sendResponse(requestId, {
          ok: false,
          error: normalizeErrorMessage(error, "Failed to update remote support dock")
        });
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

initializeViewerControls();

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
  if (dockPiPWindow && !dockPiPWindow.closed) {
    try {
      dockPiPWindow.close();
    } catch (error) {}
    dockPiPWindow = null;
  }
  if (!activeRuntime) {
    return;
  }

  shutdownTransport(activeRuntime.sessionId, "Support viewer closed", { notifyBackground: true }).then();
});
