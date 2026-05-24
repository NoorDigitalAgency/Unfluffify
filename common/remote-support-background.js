import {
  REMOTE_SUPPORT_FRAME_INTERVAL_MS,
  REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS,
  REMOTE_SUPPORT_DATA_CHANNEL_BUFFER_LIMIT_BYTES,
  REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
  REMOTE_SUPPORT_MODE_SUPPORTING,
  REMOTE_SUPPORT_PAYLOAD_MAX_BYTES,
  REMOTE_SUPPORT_PORT_CONSOLE,
  REMOTE_SUPPORT_PORT_NETWORK,
  REMOTE_SUPPORT_ROLE_REQUESTER,
  REMOTE_SUPPORT_ROLE_SUPPORTER,
  REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES,
  clampPayloadSize,
  createInactiveRemoteSupportState,
  isAjaxResourceType,
  normalizeRemoteSupportCode,
  parseRemoteSupportMessage,
  resolveEndpointUrl,
  serializeRemoteSupportMessage
} from "./remote-support.js";

const sessionState = createInactiveRemoteSupportState();

let signalingSocket = null;
let peerConnection = null;
let dataChannel = null;
let frameIntervalId = 0;
let inactivityIntervalId = 0;
let payloadBudgetBytes = 0;

const networkPendingRequests = new Map();
const consolePorts = new Set();
const networkPorts = new Set();

function getPublicState() {
  return {
    ...sessionState,
    active: Boolean(sessionState.active),
    connected: Boolean(sessionState.connected),
    streaming: Boolean(sessionState.streaming),
    includePayloads: Boolean(sessionState.includePayloads)
  };
}

function resetRuntimeResources() {
  if (frameIntervalId) {
    globalThis.clearInterval(frameIntervalId);
    frameIntervalId = 0;
  }
  if (inactivityIntervalId) {
    globalThis.clearInterval(inactivityIntervalId);
    inactivityIntervalId = 0;
  }
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
      // Ignore close errors.
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
      // Ignore close errors.
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
      // Ignore close errors.
    }
  }
  signalingSocket = null;
  networkPendingRequests.clear();
  payloadBudgetBytes = 0;
}

function publishRuntimeEvent(message) {
  chrome.runtime.sendMessage(message).then().catch(() => {
    // Ignore when no popup/devtools listeners are active.
  });
}

function broadcastState() {
  publishRuntimeEvent({
    type: "remoteSupportStateChanged",
    state: getPublicState()
  });
}

function postToPorts(ports, event) {
  ports.forEach((port) => {
    try {
      port.postMessage(event);
    } catch {
      // Ignore disconnected ports.
    }
  });
}

function broadcastConsoleEntry(entry) {
  postToPorts(consolePorts, { type: "remoteSupportConsoleEntry", entry });
}

function broadcastNetworkEntry(entry) {
  postToPorts(networkPorts, { type: "remoteSupportNetworkEntry", entry });
}

function updateActivity() {
  sessionState.lastActivityAt = Date.now();
}

function shouldHandleForSessionTab(tabId) {
  return (
    Boolean(sessionState.active) &&
    sessionState.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED &&
    sessionState.role === REMOTE_SUPPORT_ROLE_REQUESTER &&
    Number.isFinite(tabId) &&
    Number(tabId) === Number(sessionState.tabId)
  );
}

function sendSignal(type, payload) {
  if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
    return;
  }
  signalingSocket.send(
    serializeRemoteSupportMessage("signal", {
      signalType: type,
      sessionId: sessionState.sessionId,
      role: sessionState.role,
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
    updateActivity();
    return true;
  } catch {
    return false;
  }
}

async function relayCommandToSupportedTab(command) {
  if (!shouldHandleForSessionTab(sessionState.tabId) || !command || typeof command !== "object") {
    return;
  }
  try {
    await chrome.tabs.sendMessage(sessionState.tabId, {
      type: "remoteSupportExecuteCommand",
      command
    });
    updateActivity();
  } catch {
    // Ignore transient tab or script availability issues.
  }
}

function handleIncomingDataMessage(message) {
  if (!message) {
    return;
  }
  if (message.type === "command") {
    relayCommandToSupportedTab(message.payload).then();
    return;
  }
  if (message.type === "telemetry") {
    const payload = message.payload || {};
    if (payload.channel === "console") {
      broadcastConsoleEntry(payload.entry || {});
      return;
    }
    if (payload.channel === "network") {
      broadcastNetworkEntry(payload.entry || {});
      return;
    }
    return;
  }
  if (message.type === "frame") {
    publishRuntimeEvent({
      type: "remoteSupportFrame",
      frame: message.payload || null
    });
    return;
  }
  if (message.type === "control-include-payloads") {
    sessionState.includePayloads = Boolean(message.payload && message.payload.enabled);
    broadcastState();
  }
}

function bindDataChannel(channel) {
  dataChannel = channel;
  dataChannel.onopen = () => {
    sessionState.connected = true;
    sessionState.partnerConnected = true;
    sessionState.streaming = sessionState.mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED;
    updateActivity();
    broadcastState();
  };
  dataChannel.onclose = () => {
    sessionState.connected = false;
    sessionState.streaming = false;
    broadcastState();
  };
  dataChannel.onerror = () => {
    sessionState.error = "Remote data channel error";
    broadcastState();
  };
  dataChannel.onmessage = (event) => {
    const message = parseRemoteSupportMessage(event && event.data);
    if (!message) {
      return;
    }
    updateActivity();
    handleIncomingDataMessage(message);
  };
}

async function ensurePeerConnection(offerer) {
  if (peerConnection) {
    return peerConnection;
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
    const state = peerConnection ? peerConnection.connectionState : "closed";
    if (state === "connected") {
      sessionState.connected = true;
      sessionState.partnerConnected = true;
      updateActivity();
      broadcastState();
      return;
    }
    if (state === "failed" || state === "disconnected" || state === "closed") {
      terminateRemoteSupportSession("Connection ended").then();
    }
  };

  if (offerer) {
    const channel = peerConnection.createDataChannel("remote-support", {
      ordered: true
    });
    bindDataChannel(channel);
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

function startInactivityMonitor() {
  if (inactivityIntervalId) {
    globalThis.clearInterval(inactivityIntervalId);
  }
  inactivityIntervalId = globalThis.setInterval(() => {
    if (!sessionState.active) {
      return;
    }
    const now = Date.now();
    const last = Number(sessionState.lastActivityAt || 0);
    if (!last || now - last <= REMOTE_SUPPORT_INACTIVITY_TIMEOUT_MS) {
      return;
    }
    terminateRemoteSupportSession("Session ended due to inactivity").then();
  }, 30_000);
}

function startFrameStreaming() {
  if (frameIntervalId || sessionState.mode !== REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    return;
  }
  frameIntervalId = globalThis.setInterval(async () => {
    if (!sessionState.active || !sessionState.tabId) {
      return;
    }
    if (!dataChannel || dataChannel.readyState !== "open") {
      return;
    }
    let tab;
    try {
      tab = await chrome.tabs.get(sessionState.tabId);
    } catch {
      tab = null;
    }
    if (!tab || !tab.active) {
      return;
    }
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 45 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        return;
      }
      sendDataMessage("frame", {
        dataUrl,
        capturedAt: Date.now(),
        pageUrl: tab.url || ""
      });
    });
  }, REMOTE_SUPPORT_FRAME_INTERVAL_MS);
}

function stopFrameStreaming() {
  if (!frameIntervalId) {
    return;
  }
  globalThis.clearInterval(frameIntervalId);
  frameIntervalId = 0;
}

async function connectSignalingSocket({ wsUrl, role, supportCode }) {
  return new Promise((resolve, reject) => {
    try {
      signalingSocket = new WebSocket(wsUrl);
    } catch (error) {
      reject(new Error("Unable to open signaling channel"));
      return;
    }

    let resolved = false;

    signalingSocket.onopen = async () => {
      signalingSocket.send(
        serializeRemoteSupportMessage("register", {
          sessionId: sessionState.sessionId,
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

      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    signalingSocket.onmessage = async (event) => {
      const message = parseRemoteSupportMessage(event && event.data);
      if (!message) {
        return;
      }

      if (message.type === "partner-ready") {
        sessionState.partnerConnected = true;
        updateActivity();
        broadcastState();
        return;
      }

      if (message.type !== "signal") {
        return;
      }

      const payload = message.payload || {};
      if (payload.sessionId !== sessionState.sessionId) {
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
    };

    signalingSocket.onerror = () => {
      sessionState.error = "Signaling connection error";
      broadcastState();
    };

    signalingSocket.onclose = () => {
      if (!sessionState.active) {
        return;
      }
      if (!resolved) {
        reject(new Error("Signaling channel closed"));
        return;
      }
      sessionState.connected = false;
      sessionState.streaming = false;
      broadcastState();
    };
  });
}

async function fetchSupportSessionInit({ endpointBaseUrl, token, path, body }) {
  const endpointUrl = resolveEndpointUrl(endpointBaseUrl, path);
  if (!endpointUrl) {
    throw new Error("Invalid configuration endpoint");
  }
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body || {})
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error((payload && payload.error) || "Remote support request failed");
  }
  return payload;
}

async function setContentModeForSessionTab(active) {
  if (!sessionState.tabId) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(sessionState.tabId, { type: "activateContentMain" });
  } catch {
    // Content loader may not be reachable yet.
  }
  try {
    await chrome.tabs.sendMessage(sessionState.tabId, {
      type: "remoteSupportModeChanged",
      active,
      mode: active ? sessionState.mode : "inactive",
      role: active ? sessionState.role : "",
      supportCode: active ? sessionState.supportCode : "",
      sessionId: active ? sessionState.sessionId : "",
      includePayloads: active ? Boolean(sessionState.includePayloads) : false
    });
  } catch {
    // Content script may be unavailable on unsupported pages.
  }
}

async function beginSession({
  mode,
  role,
  tabId,
  sessionId,
  supportCode,
  expiresAt,
  includePayloads,
  wsUrl
}) {
  resetRuntimeResources();

  Object.assign(sessionState, {
    ...createInactiveRemoteSupportState(),
    active: true,
    mode,
    role,
    tabId,
    sessionId,
    supportCode,
    expiresAt: expiresAt || "",
    includePayloads: Boolean(includePayloads),
    lastActivityAt: Date.now()
  });

  broadcastState();
  await setContentModeForSessionTab(true);
  startInactivityMonitor();

  await connectSignalingSocket({
    wsUrl,
    role,
    supportCode
  });

  if (mode === REMOTE_SUPPORT_MODE_BEING_SUPPORTED) {
    startFrameStreaming();
  }

  broadcastState();
}

export async function terminateRemoteSupportSession(reason = "Session ended") {
  const hadActiveSession = Boolean(sessionState.active);
  stopFrameStreaming();
  resetRuntimeResources();
  const previousTabId = sessionState.tabId;
  Object.assign(sessionState, {
    ...createInactiveRemoteSupportState(),
    error: reason || ""
  });
  if (hadActiveSession && previousTabId) {
    try {
      await chrome.tabs.sendMessage(previousTabId, {
        type: "remoteSupportModeChanged",
        active: false,
        mode: "inactive",
        role: "",
        supportCode: "",
        sessionId: ""
      });
    } catch {
      // Ignore tab teardown races.
    }
  }
  broadcastState();
}

function buildWebRtcSocketUrl(endpointBaseUrl, tokenValue, responsePayload) {
  const responseUrl =
    responsePayload && typeof responsePayload.webrtcWsUrl === "string"
      ? responsePayload.webrtcWsUrl
      : "";
  if (responseUrl) {
    return responseUrl;
  }
  const fallback = resolveEndpointUrl(endpointBaseUrl, "/webrtc");
  if (!fallback) {
    return "";
  }
  try {
    const parsed = new URL(fallback);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    if (tokenValue) {
      parsed.searchParams.set("token", tokenValue);
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

async function handleRequestSupportCode(message) {
  const endpointValue = typeof message.endpointValue === "string" ? message.endpointValue.trim() : "";
  const tokenValue = typeof message.tokenValue === "string" ? message.tokenValue.trim() : "";
  const tabId = Number.isFinite(message.tabId) ? message.tabId : null;
  if (!endpointValue || !tokenValue || !tabId) {
    throw new Error("Missing endpoint, token, or active tab");
  }

  const payload = await fetchSupportSessionInit({
    endpointBaseUrl: endpointValue,
    token: tokenValue,
    path: "/request-support",
    body: {
      tabId,
      pageUrl: typeof message.pageUrl === "string" ? message.pageUrl : "",
      requestedAt: new Date().toISOString(),
      extension: "Unfluffify"
    }
  });

  const supportCode = normalizeRemoteSupportCode(payload.supportCode || payload.code || "");
  const sessionId = String(payload.sessionId || "").trim();
  if (!supportCode || !sessionId) {
    throw new Error("Support service did not return a valid code/session");
  }

  const wsUrl = buildWebRtcSocketUrl(endpointValue, tokenValue, payload);
  if (!wsUrl) {
    throw new Error("Unable to resolve WebRTC signaling URL");
  }

  await beginSession({
    mode: REMOTE_SUPPORT_MODE_BEING_SUPPORTED,
    role: REMOTE_SUPPORT_ROLE_REQUESTER,
    tabId,
    sessionId,
    supportCode,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    includePayloads: false,
    wsUrl
  });

  return {
    ok: true,
    state: getPublicState()
  };
}

async function handleJoinSupportSession(message) {
  const endpointValue = typeof message.endpointValue === "string" ? message.endpointValue.trim() : "";
  const tokenValue = typeof message.tokenValue === "string" ? message.tokenValue.trim() : "";
  const supportCode = normalizeRemoteSupportCode(message.supportCode);
  const tabId = Number.isFinite(message.tabId) ? message.tabId : null;
  if (!endpointValue || !tokenValue || !supportCode) {
    throw new Error("Missing endpoint, token, or support code");
  }

  const payload = await fetchSupportSessionInit({
    endpointBaseUrl: endpointValue,
    token: tokenValue,
    path: "/support",
    body: {
      supportCode,
      joinedAt: new Date().toISOString(),
      extension: "Unfluffify"
    }
  });

  const sessionId = String(payload.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Support service did not return a valid session id");
  }

  const wsUrl = buildWebRtcSocketUrl(endpointValue, tokenValue, payload);
  if (!wsUrl) {
    throw new Error("Unable to resolve WebRTC signaling URL");
  }

  await beginSession({
    mode: REMOTE_SUPPORT_MODE_SUPPORTING,
    role: REMOTE_SUPPORT_ROLE_SUPPORTER,
    tabId,
    sessionId,
    supportCode,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
    includePayloads: Boolean(message.includePayloads),
    wsUrl
  });

  sendDataMessage("control-include-payloads", {
    enabled: Boolean(message.includePayloads)
  });

  return {
    ok: true,
    state: getPublicState()
  };
}

function handleTelemetryFromContent(message, sender) {
  if (!shouldHandleForSessionTab(sender && sender.tab && sender.tab.id)) {
    return { ok: true };
  }
  const channel = message.channel === "network" ? "network" : "console";
  const entry = message.entry && typeof message.entry === "object" ? message.entry : {};
  sendDataMessage("telemetry", {
    channel,
    entry
  });
  return { ok: true };
}

function handleWebRequestBefore(details) {
  if (!shouldHandleForSessionTab(details.tabId)) {
    return;
  }
  const startedAt = Number(details.timeStamp) || Date.now();
  let requestPayload = "";

  if (sessionState.includePayloads && isAjaxResourceType(details.type)) {
    const requestBody = details.requestBody;
    if (requestBody && Array.isArray(requestBody.raw) && requestBody.raw.length) {
      const first = requestBody.raw[0];
      if (first && first.bytes) {
        try {
          requestPayload = clampPayloadSize(
            new TextDecoder().decode(first.bytes),
            REMOTE_SUPPORT_PAYLOAD_MAX_BYTES
          );
        } catch {
          requestPayload = "";
        }
      }
    }
  }

  networkPendingRequests.set(details.requestId, {
    startedAt,
    method: details.method,
    url: details.url,
    type: details.type,
    requestPayload
  });
}

function emitNetworkTelemetry(details, options = {}) {
  if (!shouldHandleForSessionTab(details.tabId)) {
    return;
  }
  const requestId = details.requestId;
  const pending = networkPendingRequests.get(requestId) || {};
  networkPendingRequests.delete(requestId);

  const completedAt = Number(details.timeStamp) || Date.now();
  const startedAt = Number(pending.startedAt) || completedAt;
  const loadTimeMs = Math.max(0, completedAt - startedAt);

  let payload = null;
  if (
    sessionState.includePayloads &&
    isAjaxResourceType(details.type || pending.type) &&
    typeof pending.requestPayload === "string" &&
    pending.requestPayload
  ) {
    const nextBudget = payloadBudgetBytes + pending.requestPayload.length;
    if (nextBudget <= REMOTE_SUPPORT_TOTAL_PAYLOAD_MAX_BYTES) {
      payloadBudgetBytes = nextBudget;
      payload = {
        request: pending.requestPayload,
        response: "",
        truncated: pending.requestPayload.length >= REMOTE_SUPPORT_PAYLOAD_MAX_BYTES
      };
    }
  }

  sendDataMessage("telemetry", {
    channel: "network",
    entry: {
      id: requestId,
      url: pending.url || details.url,
      method: pending.method || details.method || "GET",
      type: details.type || pending.type || "other",
      statusCode: Number.isFinite(options.statusCode) ? options.statusCode : 0,
      startedAt,
      completedAt,
      loadTimeMs,
      fromCache: Boolean(details.fromCache),
      payload
    }
  });
}

function handlePortConnection(port) {
  if (!port) {
    return;
  }
  if (port.name === REMOTE_SUPPORT_PORT_CONSOLE) {
    consolePorts.add(port);
  } else if (port.name === REMOTE_SUPPORT_PORT_NETWORK) {
    networkPorts.add(port);
  } else {
    return;
  }

  port.postMessage({ type: "remoteSupportStateChanged", state: getPublicState() });

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "setIncludePayloads") {
      const enabled = Boolean(message.enabled);
      sessionState.includePayloads = enabled;
      if (sessionState.mode === REMOTE_SUPPORT_MODE_SUPPORTING) {
        sendDataMessage("control-include-payloads", { enabled });
      }
      broadcastState();
    }
  });

  port.onDisconnect.addListener(() => {
    consolePorts.delete(port);
    networkPorts.delete(port);
  });
}

export function initRemoteSupportBackground() {
  chrome.runtime.onConnect.addListener(handlePortConnection);

  chrome.webRequest.onBeforeRequest.addListener(
    handleWebRequestBefore,
    { urls: ["<all_urls>"] },
    ["requestBody"]
  );

  chrome.webRequest.onCompleted.addListener((details) => {
    emitNetworkTelemetry(details, { statusCode: details.statusCode || 0 });
  }, { urls: ["<all_urls>"] });

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    emitNetworkTelemetry(details, { statusCode: 0 });
  }, { urls: ["<all_urls>"] });
}

export async function handleRemoteSupportBackgroundMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    return null;
  }

  if (message.type === "getRemoteSupportState") {
    return { ok: true, state: getPublicState() };
  }

  if (message.type === "remoteSupportRequestCode") {
    try {
      return await handleRequestSupportCode(message);
    } catch (error) {
      return {
        ok: false,
        error: (error && error.message) || "Unable to request support code"
      };
    }
  }

  if (message.type === "remoteSupportJoin") {
    try {
      return await handleJoinSupportSession(message);
    } catch (error) {
      return {
        ok: false,
        error: (error && error.message) || "Unable to join support session"
      };
    }
  }

  if (message.type === "remoteSupportEnd") {
    await terminateRemoteSupportSession("Session ended");
    return { ok: true, state: getPublicState() };
  }

  if (message.type === "remoteSupportSendCommand") {
    const sent = sendDataMessage("command", message.command || {});
    return { ok: sent };
  }

  if (message.type === "remoteSupportSetIncludePayloads") {
    const enabled = Boolean(message.enabled);
    sessionState.includePayloads = enabled;
    if (sessionState.mode === REMOTE_SUPPORT_MODE_SUPPORTING) {
      sendDataMessage("control-include-payloads", { enabled });
    }
    broadcastState();
    return { ok: true, state: getPublicState() };
  }

  if (message.type === "remoteSupportTelemetryFromContent") {
    return handleTelemetryFromContent(message, sender);
  }

  return null;
}

export async function handleRemoteSupportTabRemoved(tabId) {
  if (!sessionState.active) {
    return;
  }
  if (Number(sessionState.tabId) !== Number(tabId)) {
    return;
  }
  await terminateRemoteSupportSession("Session ended because the active tab was closed");
}
